"""/api/mind — the mind-dump inbox (Mainframe-level, not Synapse-specific).

A global quick-capture list: "stick this idea here", "come look at this",
loose notes. Each item optionally links back to a paper and/or an external URL,
and can be checked off (status open → done). Kept as (:MindDump) nodes so items
can later be promoted to tasks/ideas or wired into the graph.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Response

from activity import record
from db import run_read, run_write
from models import MindDumpCreate, MindDumpUpdate, ReorderRequest

router = APIRouter(prefix="/api/mind", tags=["mind"])


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def reorder_nodes(label: str, ids: list[str]) -> list[dict]:
    """Reassign the positions held by `ids` in the order given (see ReorderRequest).

    Shared by the mind-dump and idea reorder endpoints — both order their cards
    by a `position` float and both need swaps to be filter-safe.
    """
    if len(ids) < 2:
        raise HTTPException(400, "need at least two ids to reorder")
    if len(set(ids)) != len(ids):
        raise HTTPException(400, "duplicate ids")
    rows = await run_read(
        f"MATCH (n:{label}) WHERE n.id IN $ids RETURN n.id AS id, n.position AS pos",
        ids=ids,
    )
    if len(rows) != len(ids):
        raise HTTPException(404, "one or more items not found")
    slots = sorted(
        (r["pos"] if r["pos"] is not None else float(i)) for i, r in enumerate(rows)
    )
    pairs = [{"id": nid, "pos": float(slots[i])} for i, nid in enumerate(ids)]
    await run_write(
        f"UNWIND $pairs AS p MATCH (n:{label} {{id: p.id}}) SET n.position = p.pos",
        pairs=pairs,
    )
    return pairs


@router.get("")
async def list_dumps(status: str | None = None, kind: str | None = None) -> list[dict]:
    clauses = []
    params: dict = {}
    if status:
        clauses.append("m.status = $status")
        params["status"] = status
    if kind:
        clauses.append("m.kind = $kind")
        params["kind"] = kind
    cypher = "MATCH (m:MindDump)"
    if clauses:
        cypher += " WHERE " + " AND ".join(clauses)
    # Manual order first (position ascending); anything not yet positioned falls
    # to the bottom in newest-first order.
    cypher += " RETURN m ORDER BY coalesce(m.position, 1e15) ASC, m.created_at DESC"
    rows = await run_read(cypher, **params)
    return [dict(r["m"]) for r in rows]


@router.post("", status_code=201)
async def create_dump(body: MindDumpCreate) -> dict:
    paper_title = None
    if body.paper_id:
        prows = await run_read("MATCH (p:Paper {id: $id}) RETURN p.title AS title", id=body.paper_id)
        paper_title = prows[0]["title"] if prows else None
    mid = str(uuid.uuid4())
    rows = await run_write(
        """
        OPTIONAL MATCH (x:MindDump)
        WITH coalesce(min(x.position), 0.0) - 1.0 AS pos
        CREATE (m:MindDump {
            id: $id, text: $text, detail: $detail, kind: $kind, status: 'open',
            link: $link, paper_id: $paper_id, paper_title: $paper_title,
            created_at: $now, position: pos
        })
        WITH m
        OPTIONAL MATCH (p:Paper {id: $paper_id})
        FOREACH (_ IN CASE WHEN p IS NULL THEN [] ELSE [1] END |
            MERGE (m)-[:ABOUT]->(p))
        RETURN m
        """,
        id=mid, text=body.text.strip(), detail=body.detail, kind=body.kind,
        link=body.link, paper_id=body.paper_id, paper_title=paper_title, now=_now(),
    )
    await record("mind", "captured", detail=body.text[:70], paper_id=body.paper_id, paper_title=paper_title)
    return dict(rows[0]["m"])


@router.post("/reorder")
async def reorder_dumps(body: ReorderRequest) -> dict:
    pairs = await reorder_nodes("MindDump", body.ids)
    await record("mind", "reordered", detail=f"{len(pairs)} items")
    return {"ok": True, "positions": pairs}


@router.patch("/{dump_id}")
async def update_dump(dump_id: str, patch: MindDumpUpdate) -> dict:
    # exclude_unset (not exclude_none) so a field can be cleared back to empty.
    fields = patch.model_dump(exclude_unset=True)
    if not fields:
        raise HTTPException(400, "no fields to update")
    # Re-point the :ABOUT edge + the denormalised title when the paper changes.
    if "paper_id" in fields:
        title = None
        if fields["paper_id"]:
            prows = await run_read(
                "MATCH (p:Paper {id: $id}) RETURN p.title AS title", id=fields["paper_id"]
            )
            title = prows[0]["title"] if prows else None
        fields["paper_title"] = title
        await run_write(
            """
            MATCH (m:MindDump {id: $id})
            OPTIONAL MATCH (m)-[r:ABOUT]->(:Paper)
            DELETE r
            WITH m
            OPTIONAL MATCH (p:Paper {id: $paper_id})
            FOREACH (_ IN CASE WHEN p IS NULL THEN [] ELSE [1] END |
                MERGE (m)-[:ABOUT]->(p))
            """,
            id=dump_id, paper_id=fields["paper_id"],
        )
    sets = ", ".join(f"m.{k} = ${k}" for k in fields)
    rows = await run_write(
        f"MATCH (m:MindDump {{id: $id}}) SET {sets} RETURN m", id=dump_id, **fields
    )
    if not rows:
        raise HTTPException(404, "mind-dump item not found")
    verb = "done" if fields.get("status") == "done" else "reopened" if fields.get("status") == "open" else "updated"
    await record("mind", verb, detail=", ".join(fields))
    return dict(rows[0]["m"])


@router.delete("/{dump_id}", status_code=204, response_class=Response)
async def delete_dump(dump_id: str) -> Response:
    await run_write("MATCH (m:MindDump {id: $id}) DETACH DELETE m", id=dump_id)
    await record("mind", "deleted", detail=dump_id)
    return Response(status_code=204)
