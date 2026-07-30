"""/api/projects — the Project area (Mainframe-level, not Synapse-specific).

A project holds files the user either UPLOADS (copied to ~/.mainframe/projects/,
size recorded) or LINKS (a path/URL to something they already own, with a note).
Every mutation writes a `project` ChangeEvent, which feeds the contribution grid.
"""
from __future__ import annotations

import os
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, Response, UploadFile
from fastapi.responses import FileResponse

from activity import record
from config import settings
from db import run_read, run_write
from models import ProjectCreate, ProjectLinkCreate, ProjectPush, ProjectUpdate
from routes.work import create_session
from models import WorkSessionCreate

router = APIRouter(prefix="/api/projects", tags=["projects"])


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# Every project read carries its work totals so the card can show hours spent
# without a second round trip.
_SESSION_ROLLUP = """
OPTIONAL MATCH (w:WorkSession)-[:ON]->(p)
WITH p, files, collect(w{.*}) AS ws
WITH p, files, ws,
     reduce(s = 0, x IN ws | s + coalesce(x.mins, 0)) AS total_mins,
     size([x IN ws WHERE x.pushed]) AS push_count
"""


def _shape(row: dict) -> dict:
    proj = row["project"]
    proj["files"] = [f for f in row["files"] if f.get("id")]
    sessions = [s for s in row.get("sessions") or [] if s.get("id")]
    sessions.sort(key=lambda s: (s.get("date") or "", s.get("start") or ""), reverse=True)
    proj["sessions"] = sessions
    proj["total_mins"] = row.get("total_mins") or 0
    proj["push_count"] = row.get("push_count") or 0
    proj["last_worked"] = sessions[0]["date"] if sessions else None
    proj.setdefault("contributes", True)
    return proj


async def _with_files(project_id: str) -> dict:
    rows = await run_read(
        f"""
        MATCH (p:Project {{id: $id}})
        OPTIONAL MATCH (p)-[:HAS_FILE]->(f:ProjectFile)
        WITH p, f ORDER BY f.created_at
        WITH p, collect(f{{.*}}) AS files
        {_SESSION_ROLLUP}
        RETURN p{{.*}} AS project, files, ws AS sessions, total_mins, push_count
        """,
        id=project_id,
    )
    if not rows:
        raise HTTPException(404, "project not found")
    return _shape(rows[0])


@router.get("")
async def list_projects() -> list[dict]:
    rows = await run_read(
        f"""
        MATCH (p:Project)
        OPTIONAL MATCH (p)-[:HAS_FILE]->(f:ProjectFile)
        WITH p, f ORDER BY f.created_at
        WITH p, collect(f{{.*}}) AS files
        {_SESSION_ROLLUP}
        RETURN p{{.*}} AS project, files, ws AS sessions, total_mins, push_count
        ORDER BY project.created_at DESC
        """
    )
    return [_shape(r) for r in rows]


@router.post("", status_code=201)
async def create_project(body: ProjectCreate) -> dict:
    pid = str(uuid.uuid4())
    await run_write(
        """
        CREATE (p:Project {
            id: $id, name: $name, note: $note, created_at: $now,
            contributes: true, status: 'active', repo: ''
        })
        """,
        id=pid, name=body.name.strip(), note=body.note, now=_now(),
    )
    await record("project", "created", detail=body.name[:70])
    return await _with_files(pid)


@router.patch("/{project_id}")
async def update_project(project_id: str, patch: ProjectUpdate) -> dict:
    fields = patch.model_dump(exclude_none=True)
    if fields:
        sets = ", ".join(f"p.{k} = ${k}" for k in fields)
        rows = await run_write(f"MATCH (p:Project {{id: $id}}) SET {sets} RETURN p", id=project_id, **fields)
        if not rows:
            raise HTTPException(404, "project not found")
        await record("project", "updated", detail=", ".join(fields))
    return await _with_files(project_id)


@router.delete("/{project_id}", status_code=204, response_class=Response)
async def delete_project(project_id: str) -> Response:
    # remove uploaded files from disk
    files = await run_read(
        "MATCH (:Project {id: $id})-[:HAS_FILE]->(f:ProjectFile) WHERE f.kind = 'upload' RETURN f.path AS path",
        id=project_id,
    )
    for f in files:
        if f["path"]:
            Path(f["path"]).unlink(missing_ok=True)
    proj_dir = settings.projects_dir / project_id
    if proj_dir.exists():
        shutil.rmtree(proj_dir, ignore_errors=True)
    await run_write(
        "MATCH (p:Project {id: $id}) OPTIONAL MATCH (p)-[:HAS_FILE]->(f:ProjectFile) DETACH DELETE f, p",
        id=project_id,
    )
    await record("project", "deleted", detail=project_id)
    return Response(status_code=204)


@router.post("/{project_id}/push", status_code=201)
async def push_project(project_id: str, body: ProjectPush) -> dict:
    """Record a push — writes a work session flagged `pushed`, which puts a ★ on
    that day's contribution square and lands a row in the work database."""
    rows = await run_read("MATCH (p:Project {id: $id}) RETURN p.name AS name", id=project_id)
    if not rows:
        raise HTTPException(404, "project not found")
    await create_session(WorkSessionCreate(
        date=body.date,
        mins=body.mins,
        module="mainframe",
        ref_kind="project",
        ref_id=project_id,
        ref_title=rows[0]["name"],
        what=body.note or "pushed",
        pushed=True,
    ))
    return await _with_files(project_id)


@router.get("/{project_id}/master")
async def project_master(project_id: str) -> dict:
    """Everything written about this project, rolled into one readable document:
    the note, every file note, and every work session's text — plus the totals
    (hours spent, sessions, pushes, span) so they're readable at a glance."""
    proj = await _with_files(project_id)
    sessions = proj["sessions"]
    dates = sorted(s["date"] for s in sessions if s.get("date"))
    # every piece of prose attached to the project, in one place
    blocks = []
    if (proj.get("note") or "").strip():
        blocks.append({"source": "project note", "date": None, "text": proj["note"].strip()})
    for f in proj["files"]:
        if (f.get("note") or "").strip():
            blocks.append({"source": "file · " + f.get("name", ""), "date": None, "text": f["note"].strip()})
    for s in sessions:
        text = " · ".join(x for x in (s.get("what"), s.get("notes")) if (x or "").strip())
        if text:
            blocks.append({
                "source": "session · " + (s.get("date") or ""),
                "date": s.get("date"),
                "mins": s.get("mins") or 0,
                "text": text,
            })
    focus_mins = {"active": 0, "passive": 0, "none": 0}
    for s in sessions:
        focus_mins[s.get("focus") or "none"] = focus_mins.get(s.get("focus") or "none", 0) + (s.get("mins") or 0)
    return {
        "id": proj["id"],
        "name": proj["name"],
        "contributes": proj.get("contributes", True),
        "total_mins": proj["total_mins"],
        "session_count": len(sessions),
        "push_count": proj["push_count"],
        "first_worked": dates[0] if dates else None,
        "last_worked": dates[-1] if dates else None,
        "distinct_days": len(set(dates)),
        "distraction_mins": sum(s.get("distraction_mins") or 0 for s in sessions),
        "focus_mins": focus_mins,
        "file_count": len(proj["files"]),
        "blocks": blocks,
    }


@router.post("/{project_id}/files", status_code=201)
async def upload_file(project_id: str, file: UploadFile = File(...)) -> dict:
    ctx = await run_read("MATCH (p:Project {id: $id}) RETURN p", id=project_id)
    if not ctx:
        raise HTTPException(404, "project not found")
    fid = str(uuid.uuid4())
    proj_dir = settings.projects_dir / project_id
    proj_dir.mkdir(parents=True, exist_ok=True)
    name = os.path.basename(file.filename or "file")
    dest = proj_dir / f"{fid}__{name}"
    with dest.open("wb") as out:
        shutil.copyfileobj(file.file, out)
    size = dest.stat().st_size
    await run_write(
        """
        MATCH (p:Project {id: $pid})
        CREATE (p)-[:HAS_FILE]->(f:ProjectFile {
            id: $id, name: $name, kind: 'upload', size: $size,
            path: $path, url: null, note: '', created_at: $now
        })
        """,
        pid=project_id, id=fid, name=name, size=size, path=str(dest), now=_now(),
    )
    await record("project", "file uploaded", detail=f"{name} ({size} B)")
    return await _with_files(project_id)


@router.post("/{project_id}/links", status_code=201)
async def add_link(project_id: str, body: ProjectLinkCreate) -> dict:
    ctx = await run_read("MATCH (p:Project {id: $id}) RETURN p", id=project_id)
    if not ctx:
        raise HTTPException(404, "project not found")
    if not (body.url or body.path):
        raise HTTPException(400, "provide a url or a path")
    # if it's a local path that exists, record its size for reference
    size = None
    if body.path:
        try:
            p = Path(os.path.expanduser(body.path))
            if p.is_file():
                size = p.stat().st_size
        except Exception:  # noqa: BLE001
            size = None
    fid = str(uuid.uuid4())
    await run_write(
        """
        MATCH (p:Project {id: $pid})
        CREATE (p)-[:HAS_FILE]->(f:ProjectFile {
            id: $id, name: $name, kind: 'link', size: $size,
            path: $path, url: $url, note: $note, created_at: $now
        })
        """,
        pid=project_id, id=fid, name=body.name.strip(), size=size,
        path=body.path, url=body.url, note=body.note, now=_now(),
    )
    await record("project", "link added", detail=body.name[:70])
    return await _with_files(project_id)


@router.delete("/{project_id}/files/{file_id}", status_code=204, response_class=Response)
async def delete_file(project_id: str, file_id: str) -> Response:
    rows = await run_read(
        "MATCH (:Project {id: $pid})-[:HAS_FILE]->(f:ProjectFile {id: $fid}) RETURN f.kind AS kind, f.path AS path",
        pid=project_id, fid=file_id,
    )
    if rows and rows[0]["kind"] == "upload" and rows[0]["path"]:
        Path(rows[0]["path"]).unlink(missing_ok=True)
    await run_write("MATCH (f:ProjectFile {id: $fid}) DETACH DELETE f", fid=file_id)
    await record("project", "file removed", detail=file_id)
    return Response(status_code=204)


@router.get("/{project_id}/files/{file_id}/download")
async def download_file(project_id: str, file_id: str) -> FileResponse:
    rows = await run_read(
        "MATCH (:Project {id: $pid})-[:HAS_FILE]->(f:ProjectFile {id: $fid}) RETURN f.path AS path, f.name AS name, f.kind AS kind",
        pid=project_id, fid=file_id,
    )
    if not rows or rows[0]["kind"] != "upload" or not rows[0]["path"]:
        raise HTTPException(404, "no downloadable file")
    path = Path(rows[0]["path"])
    if not path.exists():
        raise HTTPException(404, "file missing on disk")
    return FileResponse(str(path), filename=rows[0]["name"])
