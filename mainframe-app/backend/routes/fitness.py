"""/api/pulse/fitness — the Fitness sub-module of Pulse.

Workouts, training cycles, goals, body map, daily activity metrics, stretching.
All nodes are owned by (:Module {name:"pulse"}) and every mutation writes to the
shared Mainframe activity log. Config-driven activity metrics; body map is a set
of clickable regions. (Video form-checker is future — schema leaves room.)
"""
from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Response

from activity import record
from db import run_read, run_write
from models import (
    FitnessBaselineSet,
    CardioUpdate,
    CardioCreate,
    ActivityConfigUpdate, ActivityLogCreate, BodyDayNoteUpdate, BodyDayUpdate,
    BodyNoteCreate, BodyStateUpdate, CycleCreate, CycleUpdate, GoalCreate, GoalUpdate,
    StretchCreate, WorkoutCreate, WorkoutUpdate,
)

router = APIRouter(prefix="/api/pulse/fitness", tags=["fitness"])

METRIC_KEYS = ["steps", "walking", "running", "cycling", "swimming", "standing", "sedentary", "exercise", "intensity", "calories"]
DEFAULT_TRACKED = ["steps", "walking", "running", "exercise", "calories"]

# Workout type → muscle groups worked (for the Day Review).
MUSCLE_MAP = {
    "Push": ["Chest", "Shoulders", "Triceps"],
    "Pull": ["Back", "Biceps", "Rear Delts"],
    "Legs": ["Quads", "Hamstrings", "Glutes", "Calves"],
    "Upper": ["Chest", "Back", "Shoulders", "Arms"],
    "Lower": ["Quads", "Hamstrings", "Glutes", "Calves"],
    "Full Body": ["Chest", "Back", "Legs", "Shoulders", "Arms", "Core"],
    "Cardio": ["Cardio", "Legs"],
    "HIIT": ["Full Body", "Cardio"],
    "Sport": ["Full Body"],
    "Other": [],
}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _own(var: str) -> str:
    return f"MERGE (mod:Module {{name: 'pulse'}}) MERGE ({var})-[:OWNED_BY]->(mod)"


def _current_week(start_date: str, weeks: int) -> int:
    try:
        start = date.fromisoformat(start_date[:10])
        diff = (date.today() - start).days
        if diff < 0:
            return 0
        return min(weeks, diff // 7 + 1)
    except Exception:  # noqa: BLE001
        return 0


# =========================================================================== #
# WORKOUTS
# =========================================================================== #
async def _workout(wid: str) -> dict:
    rows = await run_read(
        """
        MATCH (w:Workout {id: $id})
        OPTIONAL MATCH (w)-[:HAS_EXERCISE]->(e:Exercise)
        RETURN w{.*} AS w, collect(e{.*}) AS exercises
        """,
        id=wid,
    )
    if not rows:
        raise HTTPException(404, "workout not found")
    w = rows[0]["w"]
    w["exercises"] = [e for e in rows[0]["exercises"] if e.get("id")]
    return w


def _pack_workouts(rows: list[dict]) -> list[dict]:
    out = []
    for r in rows:
        w = r["w"]; w["exercises"] = [e for e in r["exercises"] if e.get("id")]; out.append(w)
    return out


@router.get("/workouts")
async def list_workouts(q: str | None = None, type: str | None = None) -> list[dict]:
    rows = await run_read(
        """
        MATCH (w:Workout)
        OPTIONAL MATCH (w)-[:HAS_EXERCISE]->(e:Exercise)
        RETURN w{.*} AS w, collect(e{.*}) AS exercises
        ORDER BY w.date DESC
        """
    )
    items = _pack_workouts(rows)
    if type:
        items = [w for w in items if w.get("type") == type]
    if q:
        ql = q.lower()
        items = [w for w in items if ql in (w.get("type", "").lower() + " " + (w.get("notes") or "").lower() + " " + " ".join(e.get("name", "") for e in w["exercises"]).lower())]
    return items


@router.post("/workouts", status_code=201)
async def create_workout(body: WorkoutCreate) -> dict:
    wid = str(uuid.uuid4())
    await run_write(
        f"""
        CREATE (w:Workout {{
            id: $id, date: $date, type: $type, duration: $duration, intensity: $intensity,
            interrupted: $interrupted, notes: $notes, created_at: $now
        }})
        WITH w {_own('w')}
        """,
        id=wid, date=body.date, type=body.type, duration=body.duration, intensity=body.intensity,
        interrupted=body.interrupted, notes=body.notes, now=_now(),
    )
    for ex in body.exercises:
        await run_write(
            "MATCH (w:Workout {id: $wid}) CREATE (w)-[:HAS_EXERCISE]->(:Exercise {id: $eid, name: $name, detail: $detail})",
            wid=wid, eid=str(uuid.uuid4()), name=ex.name, detail=ex.detail,
        )
    if body.cycle_id:
        await run_write("MATCH (w:Workout {id: $wid}),(c:Cycle {id: $cid}) MERGE (w)-[:IN_CYCLE]->(c)", wid=wid, cid=body.cycle_id)
    await record("fitness", "workout logged", detail=f"{body.type} · {len(body.exercises)} ex · {body.duration}min", module="pulse")
    return await _workout(wid)


@router.put("/workouts/{wid}")
async def update_workout(wid: str, patch: WorkoutUpdate) -> dict:
    fields = patch.model_dump(exclude_none=True)
    if fields:
        sets = ", ".join(f"w.{k} = ${k}" for k in fields)
        rows = await run_write(f"MATCH (w:Workout {{id: $id}}) SET {sets} RETURN w", id=wid, **fields)
        if not rows:
            raise HTTPException(404, "workout not found")
        await record("fitness", "workout updated", detail=", ".join(fields), module="pulse")
    return await _workout(wid)


@router.delete("/workouts/{wid}", status_code=204, response_class=Response)
async def delete_workout(wid: str) -> Response:
    await run_write("MATCH (w:Workout {id: $id}) OPTIONAL MATCH (w)-[:HAS_EXERCISE]->(e:Exercise) DETACH DELETE e, w", id=wid)
    await record("fitness", "workout deleted", detail=wid, module="pulse")
    return Response(status_code=204)


# =========================================================================== #
# CYCLES
# =========================================================================== #
async def _cycle(cid: str) -> dict:
    rows = await run_read("MATCH (c:Cycle {id: $id}) RETURN c{.*} AS c", id=cid)
    if not rows:
        raise HTTPException(404, "cycle not found")
    c = rows[0]["c"]; c.setdefault("weeks_done", []); c["current_week"] = _current_week(c.get("start_date", ""), c.get("weeks", 0))
    return c


@router.get("/cycles")
async def list_cycles() -> list[dict]:
    rows = await run_read("MATCH (c:Cycle) RETURN c{.*} AS c ORDER BY c.created_at DESC")
    out = []
    for r in rows:
        c = r["c"]; c.setdefault("weeks_done", []); c["current_week"] = _current_week(c.get("start_date", ""), c.get("weeks", 0)); out.append(c)
    return out


@router.post("/cycles", status_code=201)
async def create_cycle(body: CycleCreate) -> dict:
    cid = str(uuid.uuid4())
    await run_write(
        f"""
        CREATE (c:Cycle {{
            id: $id, name: $name, weeks: $weeks, start_date: $start, phase: $phase,
            goals: $goals, notes: $notes, status: 'active', weeks_done: [], created_at: $now
        }})
        WITH c {_own('c')}
        """,
        id=cid, name=body.name.strip(), weeks=body.weeks, start=body.start_date,
        phase=body.phase, goals=body.goals, notes=body.notes, now=_now(),
    )
    await record("fitness", "cycle created", detail=f"{body.name[:50]} ({body.weeks}w)", module="pulse")
    return await _cycle(cid)


@router.put("/cycles/{cid}")
async def update_cycle(cid: str, patch: CycleUpdate) -> dict:
    fields = patch.model_dump(exclude_none=True)
    if fields:
        sets = ", ".join(f"c.{k} = ${k}" for k in fields)
        rows = await run_write(f"MATCH (c:Cycle {{id: $id}}) SET {sets} RETURN c", id=cid, **fields)
        if not rows:
            raise HTTPException(404, "cycle not found")
        verb = "completed" if fields.get("status") == "completed" else "week toggled" if "weeks_done" in fields else "updated"
        await record("fitness", "cycle " + verb, detail=", ".join(fields), module="pulse")
    return await _cycle(cid)


@router.delete("/cycles/{cid}", status_code=204, response_class=Response)
async def delete_cycle(cid: str) -> Response:
    await run_write("MATCH (c:Cycle {id: $id}) DETACH DELETE c", id=cid)
    await record("fitness", "cycle deleted", detail=cid, module="pulse")
    return Response(status_code=204)


# =========================================================================== #
# GOALS
# =========================================================================== #
@router.get("/goals")
async def list_goals() -> list[dict]:
    rows = await run_read("MATCH (g:Goal) RETURN g{.*} AS g ORDER BY g.created_at DESC")
    return [r["g"] for r in rows]


@router.post("/goals", status_code=201)
async def create_goal(body: GoalCreate) -> dict:
    gid = str(uuid.uuid4())
    rows = await run_write(
        f"CREATE (g:Goal {{id: $id, text: $text, current: $current, target: $target, created_at: $now}}) WITH g {_own('g')} RETURN g{{.*}} AS g",
        id=gid, text=body.text.strip(), current=body.current, target=body.target, now=_now(),
    )
    await record("fitness", "goal added", detail=body.text[:60], module="pulse")
    return rows[0]["g"]


@router.put("/goals/{gid}")
async def update_goal(gid: str, patch: GoalUpdate) -> dict:
    fields = patch.model_dump(exclude_none=True)
    if not fields:
        raise HTTPException(400, "no fields")
    sets = ", ".join(f"g.{k} = ${k}" for k in fields)
    rows = await run_write(f"MATCH (g:Goal {{id: $id}}) SET {sets} RETURN g{{.*}} AS g", id=gid, **fields)
    if not rows:
        raise HTTPException(404, "goal not found")
    await record("fitness", "goal updated", detail=", ".join(fields), module="pulse")
    return rows[0]["g"]


@router.delete("/goals/{gid}", status_code=204, response_class=Response)
async def delete_goal(gid: str) -> Response:
    await run_write("MATCH (g:Goal {id: $id}) DETACH DELETE g", id=gid)
    await record("fitness", "goal deleted", detail=gid, module="pulse")
    return Response(status_code=204)


# =========================================================================== #
# BODY MAP
# =========================================================================== #
@router.get("/body")
async def get_body() -> dict:
    states = await run_read("MATCH (b:BodyState) WHERE coalesce(b.state,'') <> '' RETURN b.region AS region, b.state AS state")
    notes = await run_read("MATCH (n:BodyNote) RETURN n{.*} AS n ORDER BY n.date DESC")
    return {"points": {s["region"]: s["state"] for s in states}, "notes": [n["n"] for n in notes]}


@router.put("/body/{region}")
async def set_body(region: str, patch: BodyStateUpdate) -> dict:
    await run_write(
        f"""
        MERGE (b:BodyState {{region: $region}})
          ON CREATE SET b.id = $id
        SET b.state = $state, b.date = $now
        WITH b {_own('b')}
        """,
        region=region, id=str(uuid.uuid4()), state=patch.state, now=_now(),
    )
    # history
    await run_write(
        "CREATE (:BodyStateLog {id: $id, region: $region, state: $state, date: $now})",
        id=str(uuid.uuid4()), region=region, state=patch.state, now=_now(),
    )
    await record("fitness", "body region changed", detail=f"{region} → {patch.state or 'clear'}", module="pulse")
    return {"region": region, "state": patch.state}


@router.post("/body/notes", status_code=201)
async def add_body_note(body: BodyNoteCreate) -> dict:
    rows = await run_write(
        f"CREATE (n:BodyNote {{id: $id, text: $text, date: $now}}) WITH n {_own('n')} RETURN n{{.*}} AS n",
        id=str(uuid.uuid4()), text=body.text, now=_now(),
    )
    await record("fitness", "body note added", detail=body.text[:60], module="pulse")
    return rows[0]["n"]


@router.get("/body/history")
async def body_history() -> list[dict]:
    rows = await run_read("MATCH (l:BodyStateLog) RETURN l{.*} AS l ORDER BY l.date DESC LIMIT 200")
    return [r["l"] for r in rows]


# =========================================================================== #
# DAY REVIEW — muscle-group focus for a day + a per-day body map
# =========================================================================== #
@router.get("/day-review")
async def day_review(date: str) -> dict:
    """Aggregate one day: its workouts, the muscle groups worked, the per-day
    body-map key points, and a day note."""
    wrows = await run_read(
        """
        MATCH (w:Workout) WHERE w.date STARTS WITH $date
        OPTIONAL MATCH (w)-[:HAS_EXERCISE]->(e:Exercise)
        RETURN w{.*} AS w, collect(e{.*}) AS exercises
        ORDER BY w.created_at
        """,
        date=date,
    )
    workouts = _pack_workouts(wrows)
    muscles: list[str] = []
    for w in workouts:
        for m in MUSCLE_MAP.get(w.get("type", ""), []):
            if m not in muscles:
                muscles.append(m)
    body = await run_read(
        "MATCH (b:BodyDayState {date: $date}) WHERE coalesce(b.state,'') <> '' RETURN b.region AS region, b.state AS state",
        date=date,
    )
    note = await run_read("MATCH (n:BodyDayNote {date: $date}) RETURN n.text AS text", date=date)
    return {
        "date": date, "workouts": workouts, "muscle_groups": muscles,
        "body_points": {b["region"]: b["state"] for b in body},
        "note": note[0]["text"] if note else "",
    }


@router.put("/day-body/{region}")
async def set_day_body(region: str, body: BodyDayUpdate) -> dict:
    await run_write(
        f"""
        MERGE (b:BodyDayState {{region: $region, date: $date}})
          ON CREATE SET b.id = $id
        SET b.state = $state
        WITH b {_own('b')}
        """,
        region=region, date=body.date, id=str(uuid.uuid4()), state=body.state,
    )
    await record("fitness", "day body logged", detail=f"{body.date} · {region} → {body.state or 'clear'}", module="pulse")
    return {"region": region, "date": body.date, "state": body.state}


@router.put("/day-note")
async def set_day_note(body: BodyDayNoteUpdate) -> dict:
    await run_write(
        f"MERGE (n:BodyDayNote {{date: $date}}) ON CREATE SET n.id = $id SET n.text = $text WITH n {_own('n')}",
        date=body.date, id=str(uuid.uuid4()), text=body.text,
    )
    return {"date": body.date, "text": body.text}


# =========================================================================== #
# ACTIVITY (daily movement metrics)
# =========================================================================== #
async def _tracked() -> list[str]:
    rows = await run_read("MATCH (c:FitnessConfig {id: 'activity'}) RETURN c.tracked AS tracked")
    if rows and rows[0]["tracked"]:
        return rows[0]["tracked"]
    return DEFAULT_TRACKED


@router.get("/activity/config")
async def get_activity_config() -> dict:
    return {"metrics": METRIC_KEYS, "tracked": await _tracked()}


@router.put("/activity/config")
async def set_activity_config(body: ActivityConfigUpdate) -> dict:
    tracked = [m for m in body.tracked if m in METRIC_KEYS]
    await run_write(
        f"MERGE (c:FitnessConfig {{id: 'activity'}}) SET c.tracked = $tracked WITH c {_own('c')}",
        tracked=tracked,
    )
    return {"tracked": tracked}


@router.get("/activity")
async def list_activity() -> list[dict]:
    rows = await run_read("MATCH (a:ActivityLog) RETURN a{.*} AS a ORDER BY a.date DESC")
    return [r["a"] for r in rows]


@router.post("/activity", status_code=201)
async def log_activity(body: ActivityLogCreate) -> dict:
    data = body.model_dump()
    aid = str(uuid.uuid4())
    props = {"id": aid, "date": data.get("date"), "notes": data.get("notes", ""), "created_at": _now()}
    for k in METRIC_KEYS:
        if k in data and data[k] is not None:
            try:
                props[k] = int(data[k])
            except (TypeError, ValueError):
                pass
    sets = ", ".join(f"{k}: ${k}" for k in props)
    rows = await run_write(f"CREATE (a:ActivityLog {{{sets}}}) WITH a {_own('a')} RETURN a{{.*}} AS a", **props)
    await record("fitness", "activity logged", detail=data.get("date", ""), module="pulse")
    return rows[0]["a"]


@router.delete("/activity/{aid}", status_code=204, response_class=Response)
async def delete_activity(aid: str) -> Response:
    await run_write("MATCH (a:ActivityLog {id: $id}) DETACH DELETE a", id=aid)
    await record("fitness", "activity deleted", detail=aid, module="pulse")
    return Response(status_code=204)


# =========================================================================== #
# STRETCHING
# =========================================================================== #
@router.get("/stretching")
async def list_stretch() -> list[dict]:
    rows = await run_read("MATCH (s:StretchSession) RETURN s{.*} AS s ORDER BY s.date DESC")
    return [r["s"] for r in rows]


@router.post("/stretching", status_code=201)
async def log_stretch(body: StretchCreate) -> dict:
    sid = str(uuid.uuid4())
    rows = await run_write(
        f"""
        CREATE (s:StretchSession {{id: $id, date: $date, duration: $duration, stretches: $stretches,
            focus: $focus, notes: $notes, created_at: $now}})
        WITH s {_own('s')} RETURN s{{.*}} AS s
        """,
        id=sid, date=body.date, duration=body.duration, stretches=body.stretches,
        focus=body.focus, notes=body.notes, now=_now(),
    )
    await record("fitness", "stretch session logged", detail=f"{body.date} · {len(body.stretches)} stretches", module="pulse")
    return rows[0]["s"]


@router.delete("/stretching/{sid}", status_code=204, response_class=Response)
async def delete_stretch(sid: str) -> Response:
    await run_write("MATCH (s:StretchSession {id: $id}) DETACH DELETE s", id=sid)
    await record("fitness", "stretch deleted", detail=sid, module="pulse")
    return Response(status_code=204)


# =========================================================================== #
# DASHBOARD (aggregate)
# =========================================================================== #
@router.get("/dashboard")
async def dashboard() -> dict:
    total_w = (await run_read("MATCH (w:Workout) RETURN count(w) AS n"))[0]["n"]
    week_ago = (date.today() - timedelta(days=7)).isoformat()
    this_week = (await run_read("MATCH (w:Workout) WHERE w.date >= $d RETURN count(w) AS n", d=week_ago))[0]["n"]
    total_min = (await run_read("MATCH (w:Workout) RETURN sum(coalesce(w.duration,0)) AS m"))[0]["m"] or 0
    stretch_n = (await run_read("MATCH (s:StretchSession) RETURN count(s) AS n"))[0]["n"]
    body = await run_read("MATCH (b:BodyState) WHERE coalesce(b.state,'') <> '' RETURN b.state AS state")
    pain = sum(1 for r in body if r["state"] == "pain")
    imbalance = sum(1 for r in body if r["state"] == "imbalance")
    cycles = await list_cycles()
    active_cycle = next((c for c in cycles if c.get("status") == "active"), None)
    recent = _pack_workouts(await run_read(
        "MATCH (w:Workout) OPTIONAL MATCH (w)-[:HAS_EXERCISE]->(e:Exercise) RETURN w{.*} AS w, collect(e{.*}) AS exercises ORDER BY w.date DESC LIMIT 5"
    ))
    goals = await list_goals()
    return {
        "stats": {
            "total_workouts": total_w, "this_week": this_week,
            "total_hours": round(total_min / 60, 1), "stretch_sessions": stretch_n,
            "pain_points": pain, "imbalance": imbalance,
        },
        "active_cycle": active_cycle, "recent_workouts": recent, "goals": goals,
    }


# --------------------------------------------------------------------------- #
# Cardio — its own section, kept apart from strength workouts. Sets and reps
# say nothing useful about a run; distance, pace, heart rate and zones do.
# --------------------------------------------------------------------------- #
def _shape_cardio(c: dict) -> dict:
    """Pace is always derived, never stored — it can't drift out of step."""
    dist = c.get("distance_km") or 0
    mins = c.get("duration_mins") or 0
    c["pace_min_per_km"] = round(mins / dist, 2) if dist and mins else None
    c["speed_kmh"] = round(dist / (mins / 60), 2) if dist and mins else None
    z = c.get("zones") or [0, 0, 0, 0, 0]
    c["zones"] = list(z) + [0] * (5 - len(z))
    c["zone_total_mins"] = sum(c["zones"])
    return c


@router.get("/cardio")
async def list_cardio(start: str | None = None, end: str | None = None) -> list[dict]:
    where, params = [], {}
    if start:
        where.append("c.date >= $start"); params["start"] = start
    if end:
        where.append("c.date <= $end"); params["end"] = end
    clause = ("WHERE " + " AND ".join(where)) if where else ""
    rows = await run_read(
        f"MATCH (c:CardioSession) {clause} RETURN c{{.*}} AS c ORDER BY c.date DESC, c.created_at DESC",
        **params,
    )
    return [_shape_cardio(r["c"]) for r in rows]


@router.post("/cardio", status_code=201)
async def create_cardio(body: CardioCreate) -> dict:
    cid = str(uuid.uuid4())
    d = body.model_dump()
    d["id"] = cid
    d["created_at"] = _now()
    d["zones"] = (list(d.get("zones") or []) + [0] * 5)[:5]
    rows = await run_write(
        """
        CREATE (c:CardioSession {
            id: $id, date: $date, type: $type, distance_km: $distance_km,
            duration_mins: $duration_mins, avg_hr: $avg_hr, max_hr: $max_hr,
            zones: $zones, perceived_effort: $perceived_effort, route: $route,
            notes: $notes, created_at: $created_at
        })
        RETURN c{.*} AS c
        """,
        **d,
    )
    await record("fitness", "cardio logged",
                 detail=f"{body.type} · {body.distance_km}km · {body.duration_mins}m")
    return _shape_cardio(rows[0]["c"])


@router.put("/cardio/{cid}")
async def update_cardio(cid: str, patch: CardioUpdate) -> dict:
    fields = patch.model_dump(exclude_none=True)
    if not fields:
        raise HTTPException(400, "no fields to update")
    if "zones" in fields:
        fields["zones"] = (list(fields["zones"]) + [0] * 5)[:5]
    sets = ", ".join(f"c.{k} = ${k}" for k in fields)
    rows = await run_write(
        f"MATCH (c:CardioSession {{id: $id}}) SET {sets} RETURN c{{.*}} AS c", id=cid, **fields)
    if not rows:
        raise HTTPException(404, "cardio session not found")
    await record("fitness", "cardio updated", detail=", ".join(fields))
    return _shape_cardio(rows[0]["c"])


@router.delete("/cardio/{cid}", status_code=204, response_class=Response)
async def delete_cardio(cid: str) -> Response:
    await run_write("MATCH (c:CardioSession {id: $id}) DETACH DELETE c", id=cid)
    await record("fitness", "cardio deleted", detail=cid)
    return Response(status_code=204)


@router.get("/cardio/summary")
async def cardio_summary() -> dict:
    rows = await run_read("MATCH (c:CardioSession) RETURN c{.*} AS c")
    sessions = [_shape_cardio(r["c"]) for r in rows]
    dist = sum(s.get("distance_km") or 0 for s in sessions)
    mins = sum(s.get("duration_mins") or 0 for s in sessions)
    zones = [0] * 5
    for s in sessions:
        for i, v in enumerate(s["zones"][:5]):
            zones[i] += v or 0
    by_type: dict[str, dict] = {}
    for s in sessions:
        t = by_type.setdefault(s.get("type") or "other", {"sessions": 0, "km": 0.0, "mins": 0})
        t["sessions"] += 1
        t["km"] += s.get("distance_km") or 0
        t["mins"] += s.get("duration_mins") or 0
    return {
        "sessions": len(sessions),
        "total_km": round(dist, 2),
        "total_mins": mins,
        "avg_pace": round(mins / dist, 2) if dist else None,
        "zones": zones,
        "by_type": by_type,
    }


# --------------------------------------------------------------------------- #
# Fitness baseline test — the fixed reference every Benchmark compares against
# --------------------------------------------------------------------------- #
@router.get("/baseline-test")
async def get_baseline_test() -> dict:
    rows = await run_read(
        "MATCH (b:FitnessBaseline) RETURN b{.*} AS b ORDER BY coalesce(b.is_reference, false) DESC, b.date DESC")
    tests = [r["b"] for r in rows]
    ref = next((t for t in tests if t.get("is_reference")), tests[0] if tests else None)
    return {"reference": ref, "all": tests}


@router.put("/baseline-test")
async def set_baseline_test(body: FitnessBaselineSet) -> dict:
    """Record the starting point. Marked as the reference by default — exactly
    one baseline holds that flag, so Benchmark always has a single origin."""
    d = {k: v for k, v in body.model_dump().items() if v is not None}
    d["date"] = d.get("date") or datetime.now(timezone.utc).date().isoformat()
    bid = "baseline:" + d["date"]
    d["id"] = bid
    sets = ", ".join(f"b.{k} = ${k}" for k in d if k != "id")
    await run_write("MATCH (b:FitnessBaseline) SET b.is_reference = false")
    rows = await run_write(
        f"MERGE (b:FitnessBaseline {{id: $id}}) SET {sets}, b.is_reference = true RETURN b{{.*}} AS b",
        **d,
    )
    await record("fitness", "baseline test recorded", detail=d["date"])
    return rows[0]["b"]


@router.get("/baseline-test/compare")
async def compare_to_baseline() -> dict:
    """Every later benchmark measured against the reference baseline.

    Delta is signed against the metric's direction — for `run_5k_mins` and
    `resting_hr` lower is better, so an improvement shows as a positive gain.
    """
    base = await get_baseline_test()
    ref = base["reference"]
    if not ref:
        return {"reference": None, "metrics": [], "note": "No baseline test recorded yet."}
    LOWER_IS_BETTER = {"run_5k_mins", "resting_hr", "body_fat_pct", "waist_cm"}
    # weight and body measurements have no universal "better" — cutting and
    # bulking pull opposite ways — so report the change without judging it
    NEUTRAL = {"weight_kg", "height_cm", "chest_cm", "arm_cm", "thigh_cm"}
    latest = await run_read(
        "MATCH (b:FitnessBaseline) WHERE coalesce(b.is_reference, false) = false "
        "RETURN b{.*} AS b ORDER BY b.date DESC LIMIT 1")
    now = latest[0]["b"] if latest else None
    metrics = []
    for k, v in ref.items():
        if k in {"id", "date", "is_reference", "notes"} or not isinstance(v, (int, float)):
            continue
        cur = (now or {}).get(k)
        delta = None if cur is None else round(cur - v, 2)
        gain = None if delta is None else (-delta if k in LOWER_IS_BETTER else delta)
        metrics.append({
            "metric": k, "baseline": v, "current": cur, "delta": delta,
            "improved": None if (gain is None or k in NEUTRAL) else gain > 0,
            "lower_is_better": k in LOWER_IS_BETTER,
            "neutral": k in NEUTRAL,
        })
    return {"reference": ref, "compared_to": now, "metrics": metrics}
