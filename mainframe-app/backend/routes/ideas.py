"""/api/synapse/ideas — the spreadsheet-like idea table.

Ideas are :Idea nodes. Beyond the default columns, users can add arbitrary
custom columns — stored as flexible properties on the node (Pydantic
`extra=allow`). Supports CSV/JSON export. Category is free text (user-extensible),
not a fixed enum.
"""
from __future__ import annotations

import csv
import io
import json
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Response
from fastapi.responses import JSONResponse

from activity import record
from config import settings
from db import run_read, run_write
from models import IdeaCategoryUpsert, IdeaCreate, IdeaUpdate, ReorderRequest
from routes.mind import reorder_nodes

router = APIRouter(prefix="/api/synapse/ideas", tags=["ideas"])

# Reserved so custom columns can't clobber structural props.
# The last four are computed from work sessions on read, never stored.
_RESERVED = {"id", "created_at", "position", "sessions", "total_mins", "session_count", "last_worked"}
# Computed fields — stripped before export so the CSV stays flat.
_COMPUTED = {"sessions", "total_mins", "session_count", "last_worked"}


# --------------------------------------------------------------------------- #
# Kinds — the colour that marks an idea lives on its kind, not the idea, so
# every idea of a kind reads the same. Kinds are user-extensible.
# --------------------------------------------------------------------------- #
@router.get("/categories")
async def list_categories() -> list[dict]:
    rows = await run_read(
        "MATCH (c:IdeaCategory) RETURN c.name AS name, c.color AS color ORDER BY toLower(c.name)"
    )
    return [{"name": r["name"], "color": r["color"] or "#7FA8C8"} for r in rows if r["name"]]


@router.put("/categories")
async def upsert_category(body: IdeaCategoryUpsert) -> dict:
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "name required")
    await run_write(
        "MERGE (c:IdeaCategory {name: $name}) SET c.color = $color",
        name=name, color=body.color,
    )
    await record("idea", "kind saved", detail=f"{name} {body.color}")
    return {"name": name, "color": body.color}


@router.delete("/categories/{name}", status_code=204, response_class=Response)
async def delete_category(name: str) -> Response:
    """Removes the kind. Ideas already tagged with it keep the text, they just
    fall back to the neutral colour."""
    await run_write("MATCH (c:IdeaCategory {name: $name}) DELETE c", name=name)
    await record("idea", "kind deleted", detail=name)
    return Response(status_code=204)


def _shape(node: dict, sessions: list[dict]) -> dict:
    """An idea plus everything logged against it — one card's worth of data."""
    out = dict(node)
    sessions = [s for s in sessions if s.get("id")]
    sessions.sort(key=lambda s: (s.get("date") or "", s.get("start") or ""), reverse=True)
    out["sessions"] = sessions
    out["total_mins"] = sum(s.get("mins") or 0 for s in sessions)
    out["session_count"] = len(sessions)
    out["last_worked"] = sessions[0]["date"] if sessions else None
    return out


@router.get("")
async def list_ideas() -> list[dict]:
    # Manual row order (position ascending); un-positioned rows fall to the
    # bottom, newest first. Work sessions ride along so the expanded card can
    # show time spent without a second round trip.
    rows = await run_read(
        """
        MATCH (i:Idea)
        OPTIONAL MATCH (w:WorkSession)-[:ON]->(i)
        WITH i, collect(w{.*}) AS sessions
        RETURN i, sessions
        ORDER BY coalesce(i.position, 1e15) ASC, i.created_at DESC
        """
    )
    return [_shape(r["i"], r["sessions"]) for r in rows]


@router.get("/columns")
async def known_columns() -> dict:
    """Union of all property keys across ideas — lets the grid show custom cols."""
    rows = await run_read("MATCH (i:Idea) RETURN keys(i) AS ks")
    cols: set[str] = set()
    for r in rows:
        cols.update(r["ks"])
    return {"columns": sorted(cols)}


@router.post("", status_code=201)
async def create_idea(body: IdeaCreate) -> dict:
    props = body.model_dump(exclude_none=True)
    props.pop("id", None)
    iid = str(uuid.uuid4())
    props["id"] = iid
    props["created_at"] = datetime.now(timezone.utc).isoformat()
    # New rows land at the top of the manual order.
    rows = await run_write(
        """
        OPTIONAL MATCH (x:Idea)
        WITH coalesce(min(x.position), 0.0) - 1.0 AS pos
        CREATE (i:Idea $props) SET i.position = pos
        RETURN i
        """,
        props=props,
    )
    await record("idea", "created", detail=props.get("title", "")[:80])
    return dict(rows[0]["i"])


@router.post("/reorder")
async def reorder_ideas(body: ReorderRequest) -> dict:
    pairs = await reorder_nodes("Idea", body.ids)
    await record("idea", "reordered", detail=f"{len(pairs)} rows")
    return {"ok": True, "positions": pairs}


@router.patch("/{idea_id}")
async def update_idea(idea_id: str, patch: IdeaUpdate) -> dict:
    fields = {k: v for k, v in patch.model_dump(exclude_unset=True).items() if k not in _RESERVED}
    if not fields:
        raise HTTPException(400, "no fields to update")
    sets = ", ".join(f"i.{k} = ${k}" for k in fields)
    rows = await run_write(f"MATCH (i:Idea {{id: $id}}) SET {sets} RETURN i", id=idea_id, **fields)
    if not rows:
        raise HTTPException(404, "idea not found")
    await record("idea", "updated", detail=", ".join(fields))
    return dict(rows[0]["i"])


@router.delete("/{idea_id}", status_code=204, response_class=Response)
async def delete_idea(idea_id: str) -> Response:
    await run_write("MATCH (i:Idea {id: $id}) DETACH DELETE i", id=idea_id)
    await record("idea", "deleted", detail=idea_id)
    return Response(status_code=204)


@router.get("/export")
async def export_ideas(format: str = "json") -> Response:
    # flat rows only — the session list is a nested structure, and `total_mins`
    # is kept as a plain column so time spent still exports
    rows = await list_ideas()
    ideas = [{k: v for k, v in r.items() if k not in _COMPUTED or k == "total_mins"} for r in rows]
    settings.exports_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    if format == "csv":
        cols: list[str] = []
        for it in ideas:
            for k in it:
                if k not in cols:
                    cols.append(k)
        buf = io.StringIO()
        writer = csv.DictWriter(buf, fieldnames=cols, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(ideas)
        data = buf.getvalue()
        (settings.exports_dir / f"ideas-{stamp}.csv").write_text(data)
        return Response(data, media_type="text/csv",
                        headers={"Content-Disposition": f"attachment; filename=ideas-{stamp}.csv"})
    (settings.exports_dir / f"ideas-{stamp}.json").write_text(json.dumps(ideas, indent=2))
    return JSONResponse(ideas)
