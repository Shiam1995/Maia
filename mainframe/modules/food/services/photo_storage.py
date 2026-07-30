"""Photo storage.

Writes uploaded meal photos to the local filesystem and returns a relative path
to store in the database. Swappable: a future MinIO/S3 backend just needs to
implement `save()` / `delete()` returning the same relative-key contract.
"""
from __future__ import annotations

import uuid
from pathlib import Path

from fastapi import UploadFile

from core.config import settings

_ALLOWED_CONTENT_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/heic": ".heic",
    "image/gif": ".gif",
}
_MAX_BYTES = 15 * 1024 * 1024  # 15 MB


class PhotoError(ValueError):
    """Raised for invalid uploads (bad type / too large)."""


def _root() -> Path:
    root = Path(settings.upload_dir) / "food"
    root.mkdir(parents=True, exist_ok=True)
    return root


async def save(file: UploadFile) -> str:
    """Persist an uploaded photo. Returns a path relative to `upload_dir`."""
    ext = _ALLOWED_CONTENT_TYPES.get(file.content_type or "")
    if ext is None:
        raise PhotoError(f"Unsupported image type: {file.content_type}")

    data = await file.read()
    if len(data) > _MAX_BYTES:
        raise PhotoError("Image exceeds the 15 MB limit.")

    filename = f"{uuid.uuid4().hex}{ext}"
    dest = _root() / filename
    dest.write_bytes(data)
    # Relative to upload_dir so it's portable across storage roots.
    return f"food/{filename}"


def delete(relative_path: str) -> None:
    if not relative_path:
        return
    target = Path(settings.upload_dir) / relative_path
    try:
        target.unlink(missing_ok=True)
    except OSError:
        pass


def public_url(relative_path: str | None) -> str | None:
    if not relative_path:
        return None
    return f"{settings.media_url_prefix}/{relative_path}"
