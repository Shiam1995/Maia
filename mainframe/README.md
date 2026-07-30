# Mainframe — Food module

The first module of **Mainframe**, a self-hosted personal OS. This module is a
self-owned food tracker: describe a meal in natural language, an LLM extracts the
food items, they're matched against public nutrition databases, and everything is
stored, trended, and (eventually) advised on.

It's built so future modules (sleep, fitness, finance, ...) drop in alongside it:
shared `core/` (config + DB), one package per module under `modules/`.

```
mainframe/
├── core/                 # shared config, async DB engine/session, Base
├── modules/
│   └── food/
│       ├── api/          # FastAPI routes
│       ├── models/       # SQLAlchemy models (meals, food_items)
│       ├── schemas/      # Pydantic request/response models
│       └── services/     # llm_parser · nutrient_lookup · photo_storage
│           │             # · meal_service · trends_service · advisory (stub)
├── migrations/           # Alembic
├── frontend/             # React + TS + Vite (dashboard + mobile quick-log)
├── main.py               # FastAPI app entrypoint
├── docker-compose.yml    # Postgres + API + frontend
└── requirements.txt
```

## The nutrient pipeline

```
natural language  →  LLM parser  →  nutrient lookup  →  scale to portion  →  store
"nandos quarter      [{name,          USDA FoodData      per-100g × grams     meals +
 chicken & chips"     grams,...}]      Central / OFF       /100                food_items
```

Each stage is a **swappable service**:

- **LLM parser** (`services/llm_parser.py`) — `LLM_PROVIDER` = `claude` | `ollama`
  | `heuristic`. Defaults to Claude (`claude-opus-4-8`) via the Anthropic SDK
  with structured outputs. **Falls back to a dependency-free heuristic parser**
  if no API key is set, so the app always works out of the box.
- **Nutrient lookup** (`services/nutrient_lookup.py`) — tries sources in
  `NUTRIENT_SOURCES` order: `usda` (FoodData Central) then `openfoodfacts`.
  Adding a source is one adapter function.
- **Photo storage** (`services/photo_storage.py`) — local filesystem; the DB
  stores relative paths. Swap for MinIO/S3 later behind the same interface.
- **Advisory** (`services/advisory.py`) — **stub** exposing the interface for
  future LLM-powered advice ("you're high on sugar today"). A couple of trivial
  rules for now.

## Run it (Docker — recommended)

```bash
cp .env.example .env         # optional: add ANTHROPIC_API_KEY, USDA_API_KEY
docker compose up --build
```

- Frontend → http://localhost:5173
- API + docs → http://localhost:8000/docs

The API container runs `alembic upgrade head` on start. Without an
`ANTHROPIC_API_KEY`, set `LLM_PROVIDER=heuristic` (the compose default) or
`ollama`.

## Run it (local dev)

```bash
# 1. Postgres (via Docker, or your own instance)
docker run -d --name mainframe-db -p 5432:5432 \
  -e POSTGRES_USER=mainframe -e POSTGRES_PASSWORD=mainframe -e POSTGRES_DB=mainframe \
  postgres:16

# 2. Backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
alembic upgrade head
uvicorn main:app --reload

# 3. Frontend (separate terminal) — Vite proxies /api and /media to :8000
cd frontend && npm install && npm run dev
```

## API

Base: `/api/food`

| Method | Path                    | Purpose                                             |
|--------|-------------------------|-----------------------------------------------------|
| POST   | `/preview`              | Parse + look up nutrients **without saving**        |
| POST   | `/meals`                | Log a meal (JSON)                                   |
| POST   | `/meals/quick`          | Log a meal + optional photo (multipart, mobile)     |
| GET    | `/meals`                | List meals (`start`, `end`, `limit`, `offset`)      |
| GET    | `/meals/{id}`           | Get one meal with items                             |
| PATCH  | `/meals/{id}`           | Edit meal type / time / notes                       |
| DELETE | `/meals/{id}`           | Delete a meal (and its photo)                       |
| POST   | `/meals/{id}/photo`     | Attach/replace a photo                             |
| GET    | `/trends`               | Aggregated nutrition (`granularity` day/week/month) |
| GET    | `/advisory`             | Advice for a day (stub)                            |
| GET    | `/meta`                 | Active parser + nutrient sources                    |

## Frontend

- **Dashboard** (`/`) — trends chart (calories/macros/sugar/fibre, day/week/month),
  per-period averages, a log form with a live parse **preview**, timeline of
  recent meals, and the advisor panel. Responsive; collapses to one column.
- **Quick log** (`/log`) — a simplified single-column view for a phone browser:
  one text field, big meal-type buttons, an optional camera photo, one tap to log.

## Configuration

All via environment variables — see `.env.example`. Key ones:

| Var                | Default                        | Notes                                  |
|--------------------|--------------------------------|----------------------------------------|
| `DATABASE_URL`     | `postgresql+asyncpg://...`     | Async URL; Alembic derives the sync one |
| `LLM_PROVIDER`     | `claude`                       | `claude` \| `ollama` \| `heuristic`     |
| `ANTHROPIC_API_KEY`|                                | Required for the `claude` provider      |
| `USDA_API_KEY`     | `DEMO_KEY`                     | Free key raises the rate limit          |
| `NUTRIENT_SOURCES` | `usda,openfoodfacts`           | Lookup order                            |
| `UPLOAD_DIR`       | `uploads`                      | Where photos are written                |

## Data model

- **`meals`** — one eating event: `eaten_at`, `meal_type`, raw `description`,
  `photo_path`, `source`, and denormalized `total_*` macros for fast dashboards.
- **`food_items`** — resolved items per meal: parsed name/quantity/portion,
  lookup provenance (`source_db`, `source_ref`, `matched`), per-item macros, and
  `micronutrients` as flexible JSONB.
