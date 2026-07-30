"""/api/learning — Learning Opportunities, a Mainframe-level service.

Sits alongside Tasks and Dictionary: it belongs to no module and every module
feeds it. When you make a mistake or spot something to improve, you log it.

Each opportunity is a living document, not a single entry — it carries a chain
of :LearningNote nodes written over time (observations, things you're trying,
what's working). The card expands into that workspace.

The point of the whole thing is REPEAT DETECTION. Occurrences are grouped by
`kind` — the type of mistake — and the summary reports not just how often a kind
recurs but the *gaps between* occurrences. Widening gaps mean you're improving;
narrowing gaps mean you're logging the same failure faster than you're fixing
it. A raw count alone can't tell those apart.
"""
from __future__ import annotations

import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel

from activity import record
from db import run_read, run_write

router = APIRouter(prefix="/api/learning", tags=["learning"])

# open → working → resolved. Resolved stays in history but leaves the active tally.
STATUSES = ("open", "working", "resolved")
ACTIVE = ("open", "working")


class LOCreate(BaseModel):
    kind: str = ""                    # the TYPE of mistake — what groups repeats
    what_happened: str                # the short overview — one line
    detail: str = ""                  # the long version: what led to it
    occurred_at: Optional[str] = None  # YYYY-MM-DD; defaults to today
    module: str = "mainframe"
    action: str = ""                  # what I will do about it
    status: str = "open"
    # Both grow one entry at a time. Lists rather than one blob so each idea and
    # each conversation stays a separate thing you can add to, reorder or drop.
    ideas: list[str] = []             # "here's idea one, here's idea two…"
    consulted: list[str] = []         # "asked X this, and this came back"


class LOUpdate(BaseModel):
    kind: Optional[str] = None
    what_happened: Optional[str] = None
    detail: Optional[str] = None
    occurred_at: Optional[str] = None
    module: Optional[str] = None
    action: Optional[str] = None
    status: Optional[str] = None
    ideas: Optional[list[str]] = None
    consulted: Optional[list[str]] = None


class KindIn(BaseModel):
    """A type of mistake, and the high-level habit it rolls up into.

    `name` is what you file an entry under ("missed a deadline"); `group` is the
    bigger pattern it belongs to ("scheduling"). Grouping is what lets separate
    small mistakes show up as one habit.
    """
    name: str
    group: str = ""


class NoteIn(BaseModel):
    text: str


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _today() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def _norm_kind(kind: str) -> str:
    """Group key for repeats — case and punctuation shouldn't split a pattern."""
    s = re.sub(r"[^a-z0-9 ]", " ", (kind or "").lower())
    return " ".join(s.split())


async def _one(lid: str) -> dict:
    rows = await run_read(
        """
        MATCH (l:LearningOpportunity {id: $id})
        OPTIONAL MATCH (l)-[:HAS_NOTE]->(n:LearningNote)
        WITH l, n ORDER BY n.created_at
        RETURN l{.*} AS l, collect(n{.*}) AS notes
        """,
        id=lid,
    )
    if not rows:
        raise HTTPException(404, "learning opportunity not found")
    lo = rows[0]["l"]
    lo["notes"] = [n for n in rows[0]["notes"] if n.get("id")]
    return lo


@router.get("")
async def list_opportunities(status: Optional[str] = None, module: Optional[str] = None) -> list[dict]:
    where, params = [], {}
    if status:
        where.append("l.status = $status"); params["status"] = status
    if module:
        where.append("l.module = $module"); params["module"] = module
    clause = ("WHERE " + " AND ".join(where)) if where else ""
    rows = await run_read(
        f"""
        MATCH (l:LearningOpportunity) {clause}
        OPTIONAL MATCH (l)-[:HAS_NOTE]->(n:LearningNote)
        WITH l, n ORDER BY n.created_at
        RETURN l{{.*}} AS l, collect(n{{.*}}) AS notes
        ORDER BY l.occurred_at DESC, l.created_at DESC
        """,
        **params,
    )
    out = []
    for r in rows:
        lo = r["l"]
        lo["notes"] = [n for n in r["notes"] if n.get("id")]
        out.append(lo)
    # annotate each with how many times its kind has been logged
    counts: dict[str, int] = {}
    for lo in out:
        k = _norm_kind(lo.get("kind") or "")
        if k:
            counts[k] = counts.get(k, 0) + 1
    for lo in out:
        lo["kind_count"] = counts.get(_norm_kind(lo.get("kind") or ""), 1)
        lo["repeating"] = lo["kind_count"] > 1
    return out


@router.post("", status_code=201)
async def create_opportunity(body: LOCreate) -> dict:
    if body.status not in STATUSES:
        raise HTTPException(400, f"status must be one of {STATUSES}")
    lid = str(uuid.uuid4())
    await run_write(
        """
        CREATE (l:LearningOpportunity {
            id: $id, kind: $kind, what_happened: $what, detail: $detail,
            occurred_at: $when, module: $module, action: $action,
            status: $status, ideas: $ideas, consulted: $consulted, created_at: $now
        })
        """,
        id=lid, kind=body.kind.strip(), what=body.what_happened.strip(),
        detail=body.detail.strip(),
        when=(body.occurred_at or _today())[:10], module=body.module,
        action=body.action, status=body.status,
        ideas=[i.strip() for i in body.ideas if i.strip()],
        consulted=[c.strip() for c in body.consulted if c.strip()],
        now=_now(),
    )
    # Filing under a kind registers it, so the catalogue always reflects what's
    # actually in use rather than needing to be curated separately.
    if body.kind.strip():
        await run_write("MERGE (:LearningKind {name: $n})", n=body.kind.strip().lower())
    await record("task", "learning logged", detail=(body.kind or body.what_happened)[:70],
                 module=body.module if body.module != "mainframe" else None)
    return await _one(lid)


# --------------------------------------------------------------------------- #
# Kinds — the types of mistake, and the high-level habits they roll into
# --------------------------------------------------------------------------- #
@router.get("/kinds")
async def list_kinds() -> list[dict]:
    """Every kind, with its group and how many entries are filed under it.

    Kinds in use but never explicitly registered still appear — the catalogue
    describes reality rather than constraining it.
    """
    rows = await run_read(
        """
        MATCH (k:LearningKind)
        OPTIONAL MATCH (l:LearningOpportunity) WHERE toLower(trim(l.kind)) = k.name
        RETURN k.name AS name, coalesce(k.group, '') AS group, count(l) AS uses
        ORDER BY group, name
        """
    )
    return [{"name": r["name"], "group": r["group"], "uses": r["uses"]} for r in rows]


@router.post("/kinds", status_code=201)
async def upsert_kind(body: KindIn) -> list[dict]:
    name = body.name.strip().lower()
    if not name:
        raise HTTPException(400, "a kind needs a name")
    await run_write(
        "MERGE (k:LearningKind {name: $n}) SET k.group = $g",
        n=name, g=body.group.strip().lower(),
    )
    await record("task", "learning kind set", detail=f"{name} → {body.group or 'ungrouped'}")
    return await list_kinds()


@router.delete("/kinds/{name}")
async def delete_kind(name: str) -> list[dict]:
    """Drop a kind from the catalogue. Entries filed under it keep their value —
    removing a label shouldn't rewrite what you wrote."""
    await run_write("MATCH (k:LearningKind {name: $n}) DELETE k", n=name.strip().lower())
    await record("task", "learning kind removed", detail=name)
    return await list_kinds()


@router.patch("/{lid}")
async def update_opportunity(lid: str, patch: LOUpdate) -> dict:
    # exclude_unset, not exclude_none: sending an empty list is how you clear
    # every idea or consultation, and exclude_none would drop a legitimate [].
    fields = patch.model_dump(exclude_unset=True)
    fields = {k: v for k, v in fields.items() if v is not None}
    if fields.get("status") and fields["status"] not in STATUSES:
        raise HTTPException(400, f"status must be one of {STATUSES}")
    if fields:
        sets = ", ".join(f"l.{k} = ${k}" for k in fields)
        rows = await run_write(
            f"MATCH (l:LearningOpportunity {{id: $id}}) SET {sets} RETURN l", id=lid, **fields)
        if not rows:
            raise HTTPException(404, "learning opportunity not found")
        await record("task", "learning updated", detail=", ".join(fields))
    return await _one(lid)


@router.delete("/{lid}", status_code=204, response_class=Response)
async def delete_opportunity(lid: str) -> Response:
    await run_write(
        "MATCH (l:LearningOpportunity {id: $id}) "
        "OPTIONAL MATCH (l)-[:HAS_NOTE]->(n:LearningNote) DETACH DELETE n, l",
        id=lid,
    )
    await record("task", "learning deleted", detail=lid)
    return Response(status_code=204)


# --------------------------------------------------------------------------- #
# Notes — the living document inside each card
# --------------------------------------------------------------------------- #
@router.post("/{lid}/notes", status_code=201)
async def add_note(lid: str, body: NoteIn) -> dict:
    if not body.text.strip():
        raise HTTPException(400, "a note needs text")
    rows = await run_write(
        """
        MATCH (l:LearningOpportunity {id: $id})
        CREATE (l)-[:HAS_NOTE]->(n:LearningNote {id: $nid, text: $text, created_at: $now})
        RETURN n
        """,
        id=lid, nid=str(uuid.uuid4()), text=body.text.strip(), now=_now(),
    )
    if not rows:
        raise HTTPException(404, "learning opportunity not found")
    return await _one(lid)


@router.patch("/{lid}/notes/{nid}")
async def edit_note(lid: str, nid: str, body: NoteIn) -> dict:
    await run_write(
        "MATCH (:LearningOpportunity {id: $id})-[:HAS_NOTE]->(n:LearningNote {id: $nid}) "
        "SET n.text = $text, n.updated_at = $now",
        id=lid, nid=nid, text=body.text.strip(), now=_now(),
    )
    return await _one(lid)


@router.delete("/{lid}/notes/{nid}")
async def delete_note(lid: str, nid: str) -> dict:
    await run_write(
        "MATCH (:LearningOpportunity {id: $id})-[:HAS_NOTE]->(n:LearningNote {id: $nid}) DETACH DELETE n",
        id=lid, nid=nid,
    )
    return await _one(lid)


# --------------------------------------------------------------------------- #
# Summary + repeat detection
# --------------------------------------------------------------------------- #
@router.get("/summary")
async def summary() -> dict:
    """The master card: tallies, plus which kinds repeat and on what rhythm.

    For every kind logged more than once we report the gaps between occurrences.
    That's the bit a count can't tell you — three mistakes 40 days apart is a
    habit fading, three in a week is one getting worse.
    """
    rows = await run_read(
        "MATCH (l:LearningOpportunity) "
        "RETURN l.kind AS kind, l.occurred_at AS when, l.status AS status, "
        "l.module AS module, l.what_happened AS what, l.id AS id"
    )
    today = datetime.now(timezone.utc).date()

    tally = {"total": len(rows), "open": 0, "working": 0, "resolved": 0}
    for r in rows:
        tally[r["status"] if r["status"] in STATUSES else "open"] += 1
    tally["active"] = tally["open"] + tally["working"]

    groups: dict[str, list[dict]] = {}
    for r in rows:
        k = _norm_kind(r["kind"] or "")
        if not k:
            continue
        groups.setdefault(k, []).append(r)

    repeats = []
    for key, items in groups.items():
        if len(items) < 2:
            continue
        dates = sorted(d for d in (i["when"] for i in items) if d)
        parsed = []
        for d in dates:
            try:
                parsed.append(datetime.fromisoformat(d[:10]).date())
            except ValueError:
                continue
        gaps = [(parsed[i] - parsed[i - 1]).days for i in range(1, len(parsed))]
        window = lambda n: sum(1 for p in parsed if (today - p).days <= n)  # noqa: E731
        # widening gaps mean the mistake is receding; narrowing means it isn't
        trend = "flat"
        if len(gaps) >= 2:
            first, last = gaps[0], gaps[-1]
            if last > first * 1.25:
                trend = "improving"
            elif last < first * 0.75:
                trend = "worsening"
        unresolved = [i for i in items if i["status"] in ACTIVE]
        repeats.append({
            "kind": next((i["kind"] for i in items if i["kind"]), key),
            "count": len(items),
            "active_count": len(unresolved),
            "dates": [p.isoformat() for p in parsed],
            "last_3_days": window(3),
            "last_7_days": window(7),
            "last_30_days": window(30),
            "days_since_last": (today - parsed[-1]).days if parsed else None,
            "gaps_days": gaps,
            "avg_gap_days": round(sum(gaps) / len(gaps), 1) if gaps else None,
            "latest_gap_days": gaps[-1] if gaps else None,
            "trend": trend,
            "modules": sorted({i["module"] for i in items if i["module"]}),
            "ids": [i["id"] for i in items],
        })
    repeats.sort(key=lambda r: (-r["count"], r["days_since_last"] if r["days_since_last"] is not None else 999))

    tally["repeating_kinds"] = len(repeats)
    tally["repeating_entries"] = sum(r["count"] for r in repeats)

    # --- high-level habits ---
    # Separate small mistakes only read as one habit once they're grouped.
    # Rolls every entry up by its kind's `group`; anything ungrouped is reported
    # as such rather than silently dropped.
    kind_rows = await run_read(
        "MATCH (k:LearningKind) RETURN k.name AS name, coalesce(k.group,'') AS grp"
    )
    group_of = {r["name"]: r["grp"] for r in kind_rows}
    habits: dict[str, dict] = {}
    for r in rows:
        k = _norm_kind(r["kind"] or "")
        grp = group_of.get(k) or ""
        key = grp or "(ungrouped)"
        h = habits.setdefault(key, {"group": key, "grouped": bool(grp), "count": 0,
                                    "active": 0, "resolved": 0, "kinds": set(),
                                    "last": None})
        h["count"] += 1
        if r["status"] in ACTIVE:
            h["active"] += 1
        elif r["status"] == "resolved":
            h["resolved"] += 1
        if r["kind"]:
            h["kinds"].add(r["kind"].strip())
        d = (r["when"] or "")[:10]
        if d and (h["last"] is None or d > h["last"]):
            h["last"] = d
    habit_list = []
    for h in habits.values():
        days_since = None
        if h["last"]:
            try:
                days_since = (today - datetime.fromisoformat(h["last"]).date()).days
            except ValueError:
                pass
        habit_list.append({**h, "kinds": sorted(h["kinds"]), "days_since_last": days_since})
    habit_list.sort(key=lambda h: (-h["count"], h["group"]))

    return {"tally": tally, "repeats": repeats, "habits": habit_list,
            "kinds": sorted({(r["kind"] or "").strip() for r in rows if (r["kind"] or "").strip()})}
