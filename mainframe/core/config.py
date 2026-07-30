"""Central configuration for Mainframe.

All configuration is driven by environment variables (or a local `.env` file).
This module is shared across every Mainframe module (food, sleep, fitness, ...),
so keep it free of module-specific settings — those belong in the module.
"""
from __future__ import annotations

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # --- App ---
    app_name: str = "Mainframe"
    environment: str = Field(default="development")
    debug: bool = Field(default=True)

    # CORS origins for the web frontend (comma separated).
    cors_origins: str = Field(default="http://localhost:5173,http://localhost:3000")

    # --- Database ---
    # Async URL used by the app (asyncpg driver).
    database_url: str = Field(
        default="postgresql+asyncpg://mainframe:mainframe@localhost:5432/mainframe",
    )

    # --- Object / file storage ---
    # Directory where uploaded meal photos are written. Paths (relative to this
    # root) are stored in the database.
    upload_dir: str = Field(default="uploads")
    # Public base path the frontend uses to load photos.
    media_url_prefix: str = Field(default="/media")

    # --- LLM layer (natural-language meal parsing) ---
    # Which parser implementation to use: "claude" | "ollama" | "heuristic".
    # The pipeline falls back to "heuristic" automatically if the configured
    # provider is unavailable (e.g. missing API key), so the app always works.
    llm_provider: str = Field(default="claude")
    anthropic_api_key: str | None = Field(default=None)
    llm_model: str = Field(default="claude-opus-4-8")
    # For a local Ollama endpoint (used when llm_provider == "ollama").
    ollama_host: str = Field(default="http://localhost:11434")
    ollama_model: str = Field(default="llama3.1")

    # --- Nutrient lookup ---
    # USDA FoodData Central. DEMO_KEY works out of the box (rate limited); get a
    # free key at https://fdc.nal.usda.gov/api-key-signup.html
    usda_api_key: str = Field(default="DEMO_KEY")
    usda_base_url: str = Field(default="https://api.nal.usda.gov/fdc/v1")
    openfoodfacts_base_url: str = Field(default="https://world.openfoodfacts.org")
    # Order of nutrient sources to try.
    nutrient_sources: str = Field(default="usda,openfoodfacts")

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def nutrient_source_list(self) -> list[str]:
        return [s.strip() for s in self.nutrient_sources.split(",") if s.strip()]

    @property
    def sync_database_url(self) -> str:
        """Sync SQLAlchemy URL (psycopg2), used by Alembic migrations."""
        return self.database_url.replace("+asyncpg", "+psycopg2")


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
