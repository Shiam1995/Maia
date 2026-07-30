"""Mainframe API entrypoint.

Mainframe is a self-hosted personal OS. This process hosts the HTTP API for its
modules; today that's the `food` module, but new modules (sleep, fitness,
finance, ...) register their routers here the same way.
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from core.config import settings
from modules.food.api.routes import router as food_router

logging.basicConfig(level=logging.INFO if not settings.debug else logging.DEBUG)


@asynccontextmanager
async def lifespan(app: FastAPI):
    Path(settings.upload_dir).mkdir(parents=True, exist_ok=True)
    yield


app = FastAPI(
    title=f"{settings.app_name} API",
    version="0.1.0",
    description="Self-hosted personal OS — food module.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve uploaded meal photos.
Path(settings.upload_dir).mkdir(parents=True, exist_ok=True)
app.mount(
    settings.media_url_prefix,
    StaticFiles(directory=settings.upload_dir),
    name="media",
)

app.include_router(food_router)


@app.get("/health", tags=["system"])
async def health() -> dict:
    return {"status": "ok", "app": settings.app_name, "env": settings.environment}
