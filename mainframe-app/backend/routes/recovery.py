"""/api/pulse/recovery — the Recovery area of Pulse.

Log recovery/mindfulness sessions (meditation, breathing, forest bathing, …).
The session types are a config list you can extend or trim; each session records
a type, date, duration, how it felt and a note. Owned by the Pulse module; every
mutation hits the shared activity log. Loose cross-cutting thoughts still belong
in the Mainframe-level Mind Dump — this note field is per-session context.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Response

from activity import record
from db import run_read, run_write
from models import RecoverySessionCreate, RecoveryTypeCreate

router = APIRouter(prefix="/api/pulse/recovery", tags=["recovery"])

# Seed types on first read: (key, name, icon). The three the user named plus a
# few common practices — all editable/removable from the UI.
_DEFAULT_TYPES = [
    ("meditation", "Meditation", "🧘"),
    ("breathing", "Breathing", "🌬️"),
    ("forest", "Forest Bathing", "🌲"),
    ("sauna", "Sauna", "♨️"),
    ("cold", "Cold Exposure", "🧊"),
    ("nap", "Nap", "😴"),
    ("yoganidra", "Yoga Nidra", "🌙"),
    ("walk", "Nature Walk", "🥾"),
]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _own(node_var: str) -> str:
    return f"MERGE (mod:Module {{name: 'pulse'}}) MERGE ({node_var})-[:OWNED_BY]->(mod)"


# =========================================================================== #
# TYPES  (config list)
# =========================================================================== #
async def _seed_types() -> None:
    rows = await run_read("MATCH (t:RecoveryType) RETURN count(t) AS n")
    if rows and rows[0]["n"]:
        return
    for i, (key, name, icon) in enumerate(_DEFAULT_TYPES):
        await run_write(
            f"""
            MERGE (t:RecoveryType {{id: $id}})
            SET t.name = $name, t.icon = $icon, t.ord = $ord, t.custom = false
            WITH t {_own('t')}
            """,
            id=key, name=name, icon=icon, ord=i,
        )


@router.get("/types")
async def list_types() -> list[dict]:
    await _seed_types()
    rows = await run_read("MATCH (t:RecoveryType) RETURN t{.*} AS t ORDER BY t.ord, t.name")
    return [r["t"] for r in rows]


@router.post("/types", status_code=201)
async def add_type(body: RecoveryTypeCreate) -> dict:
    name = body.name.strip()
    if not name:
        raise HTTPException(422, "name required")
    tid = str(uuid.uuid4())
    icon = (body.icon or "✨").strip() or "✨"
    rows = await run_write(
        f"""
        MATCH (x:RecoveryType) WITH coalesce(max(x.ord), -1) + 1 AS nextOrd
        CREATE (t:RecoveryType {{id: $id, name: $name, icon: $icon, ord: nextOrd, custom: true}})
        WITH t {_own('t')}
        RETURN t{{.*}} AS t
        """,
        id=tid, name=name, icon=icon,
    )
    await record("recovery", "type added", detail=name[:60])
    return rows[0]["t"]


@router.delete("/types/{tid}", status_code=204, response_class=Response)
async def del_type(tid: str) -> Response:
    # Detach the type but keep past sessions (they snapshot the type name).
    await run_write("MATCH (t:RecoveryType {id: $id}) DETACH DELETE t", id=tid)
    await record("recovery", "type removed", detail=tid)
    return Response(status_code=204)


# =========================================================================== #
# SESSIONS
# =========================================================================== #
@router.get("/sessions")
async def list_sessions(limit: int = 60) -> list[dict]:
    rows = await run_read(
        """
        MATCH (s:RecoverySession)
        RETURN s{.*} AS s
        ORDER BY s.date DESC, s.created_at DESC
        LIMIT $limit
        """,
        limit=max(1, min(limit, 500)),
    )
    return [r["s"] for r in rows]


@router.post("/sessions", status_code=201)
async def log_session(body: RecoverySessionCreate) -> dict:
    trows = await run_read(
        "MATCH (t:RecoveryType {id: $id}) RETURN t.name AS name, t.icon AS icon",
        id=body.type_id,
    )
    if not trows:
        raise HTTPException(404, "recovery type not found")
    type_name, type_icon = trows[0]["name"], trows[0]["icon"]
    sid = str(uuid.uuid4())
    rows = await run_write(
        f"""
        MATCH (t:RecoveryType {{id: $type_id}})
        CREATE (s:RecoverySession {{
            id: $id, date: $date, type_id: $type_id, type_name: $type_name,
            type_icon: $type_icon, duration: $duration, feel: $feel, notes: $notes,
            created_at: $now
        }})
        CREATE (s)-[:OF_TYPE]->(t)
        WITH s {_own('s')}
        RETURN s{{.*}} AS s
        """,
        id=sid, date=body.date, type_id=body.type_id, type_name=type_name,
        type_icon=type_icon, duration=body.duration, feel=body.feel.strip(),
        notes=body.notes.strip(), now=_now(),
    )
    await record("recovery", "session logged", detail=f"{type_name} · {body.date} · {body.duration}min")
    return rows[0]["s"]


@router.delete("/sessions/{sid}", status_code=204, response_class=Response)
async def del_session(sid: str) -> Response:
    await run_write("MATCH (s:RecoverySession {id: $id}) DETACH DELETE s", id=sid)
    await record("recovery", "session deleted", detail=sid)
    return Response(status_code=204)


# =========================================================================== #
# STATS  (this week + streak + per-type)
# =========================================================================== #
@router.get("/stats")
async def stats() -> dict:
    today = date.today()
    monday = today - timedelta(days=today.weekday())
    week_start = monday.isoformat()

    week = await run_read(
        """
        MATCH (s:RecoverySession) WHERE s.date >= $start
        RETURN s.type_name AS type, s.type_icon AS icon, s.duration AS duration
        """,
        start=week_start,
    )
    sessions = len(week)
    minutes = sum(int(r["duration"] or 0) for r in week)
    by_type: dict[str, dict] = {}
    for r in week:
        t = r["type"] or "—"
        b = by_type.setdefault(t, {"type": t, "icon": r["icon"] or "✨", "count": 0, "minutes": 0})
        b["count"] += 1
        b["minutes"] += int(r["duration"] or 0)
    breakdown = sorted(by_type.values(), key=lambda x: -x["count"])

    # Streak: consecutive days back from today (or yesterday) with ≥1 session.
    days = await run_read("MATCH (s:RecoverySession) RETURN DISTINCT s.date AS d")
    logged = {r["d"][:10] for r in days if r["d"]}
    streak = 0
    cur = today
    if cur.isoformat() not in logged:
        cur = cur - timedelta(days=1)
    while cur.isoformat() in logged:
        streak += 1
        cur = cur - timedelta(days=1)

    total = await run_read(
        "MATCH (s:RecoverySession) RETURN count(s) AS n, sum(s.duration) AS mins"
    )
    return {
        "week_start": week_start,
        "week_sessions": sessions,
        "week_minutes": minutes,
        "streak": streak,
        "by_type": breakdown,
        "total_sessions": (total[0]["n"] if total else 0) or 0,
        "total_minutes": int((total[0]["mins"] if total else 0) or 0),
    }
