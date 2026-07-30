"""/api/work — the Mainframe-level work database.

One :WorkSession node per block of work. This is the single table every module
pushes into, and the same rows drive the contribution grid:

  time worked that day  → how dark the square is
  a contributing project worked on → the square gets a border
  a push → the square gets a star

Every session carries the full field set. Anything that doesn't apply to a given
row is masked (0 / "" / "none") rather than omitted, so the table stays one
uniform grid instead of going ragged per row type.

Sessions attached to a project are linked `(:WorkSession)-[:ON]->(:Project)` so
the project's master view can aggregate them; sessions on anything else keep the
reference denormalised in ref_kind/ref_id/ref_title.
"""
from __future__ import annotations

import csv
import io
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Response

from activity import record
from db import run_read, run_write
from models import WorkKindCreate, WorkSessionCreate, WorkSessionUpdate

router = APIRouter(prefix="/api/work", tags=["work"])

# every column, in the order the table shows them — also the CSV header order.
# distraction_mins/distraction were dropped from the table (the reading
# workspace records distractions properly, one entry each); the properties are
# still accepted and still on old rows, they're just no longer a column here.
COLUMNS = [
    "date", "start", "end", "mins", "module", "ref_kind", "ref_title",
    "what", "focus", "notes", "completed",
]

# Seeded on first run; add your own with POST /api/work/kinds.
DEFAULT_KINDS = ["project", "task", "idea", "paper", "habit", "other"]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _today() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def _mins_between(start: str, end: str) -> int:
    """Duration from HH:MM..HH:MM. Crossing midnight wraps to the next day."""
    try:
        sh, sm = (int(x) for x in start.split(":")[:2])
        eh, em = (int(x) for x in end.split(":")[:2])
    except (ValueError, AttributeError):
        return 0
    delta = (eh * 60 + em) - (sh * 60 + sm)
    if delta < 0:
        delta += 24 * 60
    return delta


def _derive_mins(mins: int, start: str, end: str) -> int:
    """Explicit `mins` wins; otherwise infer it from start/end if both are set."""
    if mins:
        return max(0, mins)
    if start and end:
        return _mins_between(start, end)
    return 0


# --------------------------------------------------------------------------- #
# List — filterable; the table and every aggregate read through this
# --------------------------------------------------------------------------- #
@router.get("")
async def list_sessions(
    start: Optional[str] = None,      # inclusive YYYY-MM-DD
    end: Optional[str] = None,        # inclusive YYYY-MM-DD
    module: Optional[str] = None,
    ref_id: Optional[str] = None,
    ref_kind: Optional[str] = None,
    limit: int = 2000,
) -> list[dict]:
    where = []
    params: dict = {"limit": max(1, min(limit, 10000))}
    if start:
        where.append("w.date >= $start")
        params["start"] = start
    if end:
        where.append("w.date <= $end")
        params["end"] = end
    if module:
        where.append("w.module = $module")
        params["module"] = module
    if ref_id:
        where.append("w.ref_id = $ref_id")
        params["ref_id"] = ref_id
    if ref_kind:
        where.append("w.ref_kind = $ref_kind")
        params["ref_kind"] = ref_kind
    clause = ("WHERE " + " AND ".join(where)) if where else ""
    rows = await run_read(
        f"""
        MATCH (w:WorkSession)
        {clause}
        RETURN w{{.*}} AS w
        ORDER BY w.date DESC, coalesce(w.start, '') DESC, w.created_at DESC
        LIMIT $limit
        """,
        **params,
    )
    return [r["w"] for r in rows]


# --------------------------------------------------------------------------- #
# Per-day rollup — what the contribution grid draws
# --------------------------------------------------------------------------- #
@router.get("/days")
async def day_summary() -> dict:
    """date → {mins, sessions, pushed, contributed, modules}.

    `contributed` is true when at least one session that day was on a project
    flagged `contributes` (border on the square). `pushed` is true when any
    session that day was a push (star on the square).
    """
    rows = await run_read(
        """
        MATCH (w:WorkSession)
        OPTIONAL MATCH (w)-[:ON]->(p:Project)
        WITH w.date AS day,
             sum(coalesce(w.mins, 0)) AS mins,
             count(w) AS sessions,
             sum(CASE WHEN coalesce(w.completed, w.pushed, false) THEN 1 ELSE 0 END) AS pushes,
             sum(CASE WHEN coalesce(p.contributes, false) THEN 1 ELSE 0 END) AS contribs,
             collect(DISTINCT w.module) AS modules
        WHERE day IS NOT NULL
        RETURN day, mins, sessions, pushes, contribs, modules
        """
    )
    return {
        r["day"]: {
            "mins": r["mins"] or 0,
            "sessions": r["sessions"] or 0,
            "pushed": (r["pushes"] or 0) > 0,
            "contributed": (r["contribs"] or 0) > 0,
            "modules": [m for m in (r["modules"] or []) if m],
        }
        for r in rows
    }


# --------------------------------------------------------------------------- #
# Create / update / delete
# --------------------------------------------------------------------------- #
@router.post("", status_code=201)
async def create_session(body: WorkSessionCreate) -> dict:
    wid = str(uuid.uuid4())
    data = body.model_dump()
    data["id"] = wid
    data["date"] = body.date or _today()
    data["mins"] = _derive_mins(body.mins, body.start, body.end)
    data["created_at"] = _now()
    await run_write(
        """
        CREATE (w:WorkSession {
            id: $id, date: $date, start: $start, end: $end, mins: $mins,
            module: $module, ref_kind: $ref_kind, ref_id: $ref_id,
            ref_title: $ref_title, what: $what, focus: $focus,
            distraction_mins: $distraction_mins, distraction: $distraction,
            notes: $notes, completed: $completed, pushed: $pushed,
            created_at: $created_at
        })
        """,
        **data,
    )
    await _link_ref(wid, body.ref_kind, body.ref_id)
    await record(
        "project" if body.ref_kind == "project" else "task",
        "completed" if (body.completed or body.pushed) else "work logged",
        detail=f"{data['mins']}m · {(body.what or body.ref_title)[:60]}",
        module=body.module if body.module != "mainframe" else None,
        entity_id=body.ref_id,
    )
    return await _get_one(wid)


@router.patch("/{session_id}")
async def update_session(session_id: str, patch: WorkSessionUpdate) -> dict:
    fields = patch.model_dump(exclude_unset=True)
    if not fields:
        return await _get_one(session_id)
    # keep mins consistent when the clock times move
    if ("start" in fields or "end" in fields) and "mins" not in fields:
        cur = await _get_one(session_id)
        s = fields.get("start", cur.get("start") or "")
        e = fields.get("end", cur.get("end") or "")
        if s and e:
            fields["mins"] = _mins_between(s, e)
    sets = ", ".join(f"w.{k} = ${k}" for k in fields)
    rows = await run_write(
        f"MATCH (w:WorkSession {{id: $id}}) SET {sets} RETURN w",
        id=session_id, **fields,
    )
    if not rows:
        raise HTTPException(404, "work session not found")
    if "ref_id" in fields or "ref_kind" in fields:
        cur = await _get_one(session_id)
        await run_write("MATCH (:WorkSession {id: $id})-[r:ON]->() DELETE r", id=session_id)
        await _link_ref(session_id, cur.get("ref_kind"), cur.get("ref_id"))
    await record("task", "work edited", detail=", ".join(fields))
    return await _get_one(session_id)


@router.get("/gap")
async def logging_gap(ref_id: str) -> dict:
    """Has work happened on this thing that you never logged time against?

    Compares two records that already exist and are never otherwise compared:
    the `:ChangeEvent` trail (what you *did*) and `:WorkSession` rows (what you
    *logged*). Anything you did after the last session you logged is, by
    definition, time that isn't in the database.

    Read-only and derived — nothing is written or guessed. `since` is the
    boundary; events on it or before are considered covered.
    """
    sessions = await run_read(
        """
        MATCH (w:WorkSession {ref_id: $id})
        RETURN w.date AS date, coalesce(w.mins,0) AS mins, w.created_at AS created_at
        ORDER BY coalesce(w.created_at,'') DESC
        """,
        id=ref_id,
    )
    total = sum(int(s["mins"] or 0) for s in sessions)
    last = sessions[0]["created_at"] if sessions else None

    # Only count events that represent doing something. "viewed"-style rows and
    # the work log's own entries would otherwise make every paper look unlogged.
    events = await run_read(
        """
        MATCH (c:ChangeEvent)
        WHERE (c.paper_id = $id OR c.entity_id = $id)
          AND coalesce(c.category,'') <> 'status'
          AND NOT coalesce(c.action,'') IN ['work logged', 'completed', 'pushed']
          AND ($since IS NULL OR coalesce(c.timestamp,'') > $since)
        RETURN c.timestamp AS ts, c.category AS category, c.action AS action, c.detail AS detail
        ORDER BY ts DESC LIMIT 50
        """,
        id=ref_id, since=last,
    )
    return {
        "ref_id": ref_id,
        "sessions": len(sessions),
        "total_mins": total,
        "last_logged_at": last,
        "unlogged_count": len(events),
        "unlogged": [{"timestamp": e["ts"], "category": e["category"],
                      "action": e["action"], "detail": e["detail"]} for e in events],
    }


# --------------------------------------------------------------------------- #
# Kinds — what a session can be ON. User-extensible.
# --------------------------------------------------------------------------- #
@router.get("/kinds")
async def list_kinds() -> list[str]:
    """The seeded kinds plus anything you've added, in use-order then name.

    Seeded on first read rather than at startup so a fresh database and an
    existing one behave the same.
    """
    rows = await run_read("MATCH (k:WorkKind) RETURN k.name AS name")
    names = [r["name"] for r in rows if r["name"]]
    if not names:
        await run_write(
            "UNWIND $names AS n MERGE (:WorkKind {name: n})", names=DEFAULT_KINDS
        )
        names = list(DEFAULT_KINDS)
    # Keep the seeded ones in their familiar order; custom ones sort after.
    seeded = [n for n in DEFAULT_KINDS if n in names]
    custom = sorted(n for n in names if n not in DEFAULT_KINDS)
    return seeded + custom


@router.post("/kinds", status_code=201)
async def create_kind(body: WorkKindCreate) -> list[str]:
    name = body.name.strip().lower()
    if not name:
        raise HTTPException(400, "a kind needs a name")
    if len(name) > 24:
        raise HTTPException(400, "keep a kind short — it's a column value, not a sentence")
    await run_write("MERGE (:WorkKind {name: $name})", name=name)
    await record("task", "work kind added", detail=name)
    return await list_kinds()


@router.delete("/kinds/{name}", status_code=200)
async def delete_kind(name: str) -> list[str]:
    """Remove a kind. Rows already filed under it keep their value — deleting
    the label shouldn't silently rewrite history — they just can't be re-picked
    from the dropdown."""
    if name in DEFAULT_KINDS:
        raise HTTPException(400, "the built-in kinds can't be removed")
    await run_write("MATCH (k:WorkKind {name: $name}) DELETE k", name=name)
    await record("task", "work kind removed", detail=name)
    return await list_kinds()


@router.delete("/{session_id}", status_code=204, response_class=Response)
async def delete_session(session_id: str) -> Response:
    await run_write("MATCH (w:WorkSession {id: $id}) DETACH DELETE w", id=session_id)
    await record("task", "work deleted", detail=session_id)
    return Response(status_code=204)


# --------------------------------------------------------------------------- #
# CSV export — the "excel" half of the ask
# --------------------------------------------------------------------------- #
@router.get("/export.csv")
async def export_csv(start: Optional[str] = None, end: Optional[str] = None) -> Response:
    rows = await list_sessions(start=start, end=end, limit=10000)
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=COLUMNS, extrasaction="ignore")
    writer.writeheader()
    for r in rows:
        writer.writerow({c: r.get(c, "") for c in COLUMNS})
    return Response(
        content=buf.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="work.csv"'},
    )


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #
async def _link_ref(session_id: str, ref_kind: Optional[str], ref_id: Optional[str]) -> None:
    """Attach the session to its subject so aggregates can traverse the graph."""
    if not ref_id:
        return
    label = {"project": "Project", "task": "Task", "idea": "Idea", "paper": "Paper"}.get(ref_kind or "")
    if not label:
        return
    await run_write(
        f"""
        MATCH (w:WorkSession {{id: $wid}}), (n:{label} {{id: $rid}})
        MERGE (w)-[:ON]->(n)
        """,
        wid=session_id, rid=ref_id,
    )


async def _get_one(session_id: str) -> dict:
    rows = await run_read("MATCH (w:WorkSession {id: $id}) RETURN w{.*} AS w", id=session_id)
    if not rows:
        raise HTTPException(404, "work session not found")
    return rows[0]["w"]
