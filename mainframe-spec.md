# MAINFRAME — Technical Specification

**Version:** 0.1 (Draft)
**Author:** Shiam
**Date:** July 2026

---

## 1. Vision

Mainframe is a self-hosted personal operating system that unifies all aspects of life — body, mind, trajectory — into a single knowledge graph. It replaces fragmented apps (MyFitnessPal, Notion, spreadsheets, note apps) with one data layer where cross-domain connections are first-class citizens. Every device in the ecosystem is a node in a federation, capable of operating independently and syncing changes back to the canonical graph.

**Core principle:** One brain, many mouths. The server owns the truth. Everything else is a window into it and an input device for it.

---

## 2. Domains

### 2.1 Vitality — Body, Mind, Environment

Everything about physical and mental state, plus the environmental context around it.

| Sub-cluster | Tracked entities |
|---|---|
| **Inputs** | Meals, meal timing, macronutrients, micronutrients, supplements, medicine, water intake |
| **Outputs** | Workouts (type, duration, intensity, volume, exercises, sets/reps/weight), body composition, performance metrics |
| **State** | Sleep (duration, quality, interruptions, stages), meditation (duration, type), mood, energy levels, HRV, resting heart rate |
| **Environment** | Room temperature, humidity, light exposure, noise level, air quality |

### 2.2 Cortex — Knowledge, Research, Projects, Content

Everything about what you know, what you're learning, and what you're building.

| Sub-cluster | Tracked entities |
|---|---|
| **Research** | Papers (title, authors, DOI, status, notes, citations), supervisor feedback, EngD modules, conference talks |
| **Projects** | Active builds (name, repo, status, tech stack, dependencies), tasks, blockers |
| **Content** | Videos (idea → script → film → edit → publish), blog posts, tutorials, presentations |
| **Learning** | Books (title, author, status, notes), courses, lectures, podcasts |
| **Wiki** | Auto-generated connective tissue — summaries, concept pages, tag clusters |

### 2.3 Inventory — Goals, Career, Finance, Admin, Decisions

The trajectory layer. Where you're going and the logistics of getting there.

| Sub-cluster | Tracked entities |
|---|---|
| **Goals** | Short/medium/long-term goals, progress tracking, linked to Vitality and Cortex nodes |
| **Career** | Job applications, interviews, outreach, networking contacts, CVs, cover letters |
| **Finance** | Income, expenses, categories, budgets, savings targets |
| **Admin** | Housing, contracts, subscriptions, logistics |
| **Decisions** | Key choices with reasoning and outcome tracking |
| **Milestones** | Achievements, personal records, completions |
| **People** | Contacts, relationships, interaction history, context |

---

## 3. Architecture

### 3.1 Overview

```
┌─────────────────────────────────────────────────────┐
│                   MAINFRAME SERVER                   │
│                    (3090 Desktop)                    │
│                                                     │
│  ┌───────────┐  ┌───────────┐  ┌────────────────┐  │
│  │  Neo4j    │  │  MinIO    │  │  Ollama        │  │
│  │  (graph)  │  │  (files)  │  │  (local LLM)   │  │
│  └─────┬─────┘  └─────┬─────┘  └───────┬────────┘  │
│        │              │                 │           │
│  ┌─────┴──────────────┴─────────────────┴────────┐  │
│  │              FastAPI Service Layer             │  │
│  │                                                │  │
│  │  ┌──────────┐ ┌──────────┐ ┌───────────────┐  │  │
│  │  │  Event   │ │  Sync    │ │  Permission   │  │  │
│  │  │  Store   │ │  Engine  │ │  Manager      │  │  │
│  │  └──────────┘ └──────────┘ └───────────────┘  │  │
│  │  ┌──────────┐ ┌──────────┐ ┌───────────────┐  │  │
│  │  │  Linker  │ │  Insight │ │  Query        │  │  │
│  │  │  Agent   │ │  Agent   │ │  Agent        │  │  │
│  │  └──────────┘ └──────────┘ └───────────────┘  │  │
│  └────────────────────┬───────────────────────────┘  │
│                       │                              │
└───────────────────────┼──────────────────────────────┘
                        │
                   REST + WebSocket
                   (Sync Protocol)
                        │
     ┌──────┬───────────┼───────────┬──────────────┐
     │      │           │           │              │
  Laptop  Phone       Watch        Pi          LLM Agent
  (full   (PWA +      (ESP32,     (voice       (API key,
  React   offline     tiny        terminal,    read +
  client, queue,      slice,      mic/speaker, suggest,
  SQLite  SQLite)     flash       SQLite)      on-request)
  sync)               storage)
```

### 3.2 Stack

| Component | Technology | Rationale |
|---|---|---|
| Graph database | Neo4j Community Edition | Mature, Cypher query language, concurrent client support, free, massive community. LLM agents can generate Cypher queries directly. |
| Backend API | Python FastAPI | Async, typed, fast. Excellent LLM library ecosystem. |
| Event store | PostgreSQL | Append-only event log for sync protocol. Battle-tested, JSONB for flexible event payloads. |
| Object storage | MinIO | Self-hosted S3-compatible. PDFs, images, audio, video files. Graph stores metadata and pointers. |
| Local LLM | Ollama (RTX 3090) | Routine tasks: auto-tagging, linking suggestions, daily summaries. Keeps data private, costs zero. |
| Remote LLM | Claude API | Complex cross-domain reasoning, long-context analysis. Used selectively. |
| Frontend | React + TypeScript + Vite | Rich client for laptop/desktop. D3.js for graph visualisation. |
| Mobile | PWA (Progressive Web App) | Installable, offline-capable, no app store. Service worker + IndexedDB for local event queue. |
| Watch | ESP32 firmware (C/C++) | Minimal client. Quick log buttons, push notifications, flash-based event queue. |
| Voice terminal | Raspberry Pi + Whisper + Piper | Always-listening voice interface. Whisper for STT, Piper for TTS, talks to Mainframe API. |
| Reverse proxy | Caddy | Auto-HTTPS, simple config. Exposes API for remote device access. |
| Orchestration | Docker Compose | Full stack in one `docker-compose.yml`. Neo4j, FastAPI, MinIO, Ollama, PostgreSQL, Caddy. |

---

## 4. Schema Design

### 4.1 Design Principles

1. **Everything is a node.** Meals, workouts, papers, goals, people — all first-class entities in the graph.
2. **Edges across domains are more valuable than edges within them.** "Bad sleep → high room temp → poor workout → missed goal deadline" is a multi-hop cross-domain insight no single app provides.
3. **Open schema, typed core.** Core node types are defined below, but the system accepts arbitrary properties and new node types. The LLM layer proposes schema extensions as usage patterns emerge.
4. **Temporal by default.** Every node has `created_at` and `updated_at`. Most have domain-specific timestamps (meal time, workout start, sleep onset). Time is the universal join key.

### 4.2 Core Node Types

```cypher
// ─── UNIVERSAL BASE ───
// All nodes carry these properties:
//   id:         UUID
//   domain:     "vitality" | "cortex" | "inventory"
//   created_at: ISO datetime
//   updated_at: ISO datetime
//   source:     device/method that created it
//   tags:       [string] (optional, freeform)

// ─── VITALITY ───

(:Meal {
  timestamp: datetime,
  description: string,
  meal_type: "breakfast" | "lunch" | "dinner" | "snack",
  calories: float?,
  protein_g: float?,
  carbs_g: float?,
  fat_g: float?,
  fibre_g: float?,
  notes: string?
})

(:Nutrient {
  name: string,          // e.g. "Vitamin D", "Magnesium", "Zinc"
  amount: float,
  unit: string,          // "mg", "mcg", "IU"
  source_type: "food" | "supplement"
})

(:Workout {
  timestamp: datetime,
  type: string,          // "strength", "cardio", "flexibility", "sport"
  name: string?,         // "Push day", "5k run", "Yoga"
  duration_min: float,
  intensity: "low" | "moderate" | "high",
  notes: string?,
  volume_kg: float?,     // total volume for strength sessions
  exercises: [object]?   // [{name, sets, reps, weight_kg, rpe}]
})

(:SleepLog {
  sleep_onset: datetime,
  wake_time: datetime,
  duration_hr: float,
  quality: int,          // 1-10 subjective
  deep_min: float?,
  rem_min: float?,
  interruptions: int?,
  notes: string?
})

(:Meditation {
  timestamp: datetime,
  duration_min: float,
  type: string,          // "breath", "body_scan", "open_awareness", "guided"
  notes: string?
})

(:Medicine {
  timestamp: datetime,
  name: string,
  dose: string,          // "500mg", "2 tablets"
  reason: string?,
  recurring: boolean?
})

(:EnvironmentLog {
  timestamp: datetime,
  location: string?,     // "bedroom", "office", "gym"
  temperature_c: float?,
  humidity_pct: float?,
  light_lux: float?,
  noise_db: float?,
  co2_ppm: float?
})

(:BodyMetric {
  timestamp: datetime,
  weight_kg: float?,
  body_fat_pct: float?,
  resting_hr: int?,
  hrv_ms: float?,
  blood_pressure: string?,
  notes: string?
})

// ─── CORTEX ───

(:Paper {
  title: string,
  authors: [string],
  year: int,
  doi: string?,
  url: string?,
  status: "queued" | "reading" | "read" | "revisit",
  rating: int?,          // 1-5
  summary: string?,
  key_insights: [string]?,
  file_ref: string?      // MinIO object key
})

(:Book {
  title: string,
  author: string,
  status: "queued" | "reading" | "read",
  rating: int?,
  notes: string?,
  pages: int?,
  current_page: int?
})

(:Project {
  name: string,
  description: string,
  status: "idea" | "active" | "paused" | "complete" | "abandoned",
  repo_url: string?,
  tech_stack: [string]?,
  start_date: date?,
  target_date: date?
})

(:Video {
  title: string,
  status: "idea" | "scripting" | "filming" | "editing" | "published",
  platform: string?,     // "YouTube", "TikTok"
  url: string?,
  script_ref: string?,   // MinIO object key
  publish_date: date?
})

(:Note {
  content: string,
  title: string?,
  note_type: "fleeting" | "literature" | "permanent" | "log",
  linked_source: string? // what prompted this note
})

(:Module {
  name: string,
  code: string?,         // e.g. "WSP085META"
  institution: string,
  term: string,
  status: "active" | "complete"
})

// ─── INVENTORY ───

(:Goal {
  description: string,
  category: "health" | "career" | "learning" | "creative" | "financial" | "personal",
  timeframe: "daily" | "weekly" | "monthly" | "quarterly" | "yearly" | "open",
  target_date: date?,
  status: "active" | "achieved" | "abandoned" | "paused",
  priority: "low" | "medium" | "high" | "critical",
  metric: string?,       // "run 5k under 25 min", "publish 2 papers"
  progress_pct: float?
})

(:Job {
  company: string,
  role: string,
  status: "watching" | "applied" | "interview" | "offer" | "rejected" | "accepted",
  applied_date: date?,
  url: string?,
  contact: string?,
  notes: string?,
  salary_range: string?
})

(:Finance {
  timestamp: datetime,
  type: "income" | "expense",
  amount: float,
  currency: string,      // "GBP" default
  category: string,      // "rent", "food", "equipment", "supplement", "transport"
  description: string?,
  recurring: boolean?
})

(:Decision {
  timestamp: datetime,
  description: string,
  reasoning: string,
  alternatives: [string]?,
  outcome: string?,
  outcome_date: date?,
  satisfaction: int?     // 1-10 retrospective rating
})

(:Person {
  name: string,
  relationship: string,  // "supervisor", "collaborator", "friend", "recruiter"
  affiliation: string?,  // "Loughborough", "UKAEA", "UCL"
  email: string?,
  notes: string?,
  last_contact: date?
})

(:Milestone {
  description: string,
  achieved_at: date,
  category: string,
  linked_goal: string?   // Goal ID
})
```

### 4.3 Core Relationship Types

```cypher
// ─── WITHIN VITALITY ───
(:Meal)-[:CONTAINS]->(:Nutrient)
(:Meal)-[:BEFORE|AFTER]->(:Workout)
(:SleepLog)-[:AFFECTED_BY]->(:EnvironmentLog)
(:Medicine)-[:TAKEN_WITH]->(:Meal)
(:Medicine)-[:IMPACTS]->(:BodyMetric)
(:Workout)-[:RECORDED_ALONGSIDE]->(:BodyMetric)

// ─── WITHIN CORTEX ───
(:Paper)-[:CITES]->(:Paper)
(:Paper)-[:INFORMS]->(:Project)
(:Paper)-[:REQUIRED_BY]->(:Module)
(:Book)-[:RELATES_TO]->(:Paper)
(:Note)-[:ABOUT]->(:Paper | :Book | :Project)
(:Project)-[:PRODUCES]->(:Video)
(:Project)-[:DEPENDS_ON]->(:Project)

// ─── WITHIN INVENTORY ───
(:Goal)-[:PARENT_OF]->(:Goal)          // goal hierarchies
(:Job)-[:TOWARD]->(:Goal)
(:Decision)-[:INFLUENCED]->(:Goal)
(:Finance)-[:BUDGETED_FOR]->(:Goal)
(:Milestone)-[:ACHIEVED]->(:Goal)
(:Person)-[:CONTACT_FOR]->(:Job)

// ─── CROSS-DOMAIN (the magic) ───
(:Workout)-[:TOWARD]->(:Goal)          // vitality → inventory
(:Meal)-[:SUPPORTS]->(:Goal)           // vitality → inventory
(:SleepLog)-[:IMPACTS]->(:Workout)     // vitality → vitality (temporal)
(:Paper)-[:TOWARD]->(:Goal)            // cortex → inventory
(:Project)-[:TOWARD]->(:Goal)          // cortex → inventory
(:Person)-[:SUPERVISES]->(:Project)    // inventory → cortex
(:Person)-[:COLLABORATES_ON]->(:Paper) // inventory → cortex
(:Finance)-[:SPENT_ON]->(:Project)     // inventory → cortex
(:EnvironmentLog)-[:DURING]->(:SleepLog | :Workout | :Meditation) // env context
(:Note)-[:PROMPTED_BY]->(:Meal | :Workout | :SleepLog)           // reflection

// ─── LLM-PROPOSED EDGES ───
// These are suggested by the Linker Agent and require confirmation or auto-approval
(:Entity)-[:RELATED_TO {confidence: float, reason: string, approved: boolean}]->(:Entity)
```

---

## 5. API Contract

### 5.1 Core Endpoints

All endpoints are versioned under `/api/v1/`.

#### Ingest — `POST /api/v1/ingest`

Universal input endpoint. Accepts structured data, natural language, or files. The backend classifies and routes.

```json
// Structured input
{
  "type": "workout",
  "data": {
    "timestamp": "2026-07-14T18:30:00Z",
    "type": "strength",
    "name": "Push day",
    "duration_min": 65,
    "intensity": "high",
    "exercises": [
      {"name": "Bench press", "sets": 4, "reps": 8, "weight_kg": 100, "rpe": 8}
    ]
  },
  "source": "laptop"
}

// Natural language input
{
  "type": "natural",
  "data": {
    "text": "Had chicken breast with rice and broccoli at 7pm, about 650 cals. Then trained push for an hour — bench 4x8 at 100kg felt good.",
    "timestamp": "2026-07-14T19:00:00Z"
  },
  "source": "phone"
}

// File input
{
  "type": "file",
  "data": {
    "filename": "attention_is_all_you_need.pdf",
    "content_base64": "...",
    "context": "Paper for transformer architecture research"
  },
  "source": "laptop"
}
```

Response:
```json
{
  "events": [
    {"event_id": "evt_001", "action": "create_node", "node_type": "Meal", "node_id": "meal_abc"},
    {"event_id": "evt_002", "action": "create_node", "node_type": "Workout", "node_id": "wkt_def"},
    {"event_id": "evt_003", "action": "create_edge", "from": "meal_abc", "to": "wkt_def", "type": "BEFORE"}
  ],
  "linker_suggestions": [
    {"from": "wkt_def", "to": "goal_xyz", "type": "TOWARD", "confidence": 0.87, "reason": "Matches your 'increase bench to 120kg' goal"}
  ]
}
```

#### Query — `POST /api/v1/query`

Natural language or raw Cypher. The Query Agent translates NL to Cypher, executes, and reasons over results.

```json
// Natural language
{
  "mode": "natural",
  "query": "How did my sleep compare on days I meditated vs days I didn't, over the last month?",
  "response_format": "text"  // "text" | "json" | "chart_data"
}

// Raw Cypher
{
  "mode": "cypher",
  "query": "MATCH (s:SleepLog)-[:AFFECTED_BY]->(e:EnvironmentLog) WHERE e.temperature_c > 24 RETURN s.quality, e.temperature_c ORDER BY s.sleep_onset DESC LIMIT 20"
}
```

#### Stream — `WebSocket /api/v1/stream`

Real-time push channel. Clients subscribe to event types.

```json
// Client subscribes
{"action": "subscribe", "channels": ["insights", "sync", "vitality.workout"]}

// Server pushes
{"channel": "insights", "data": {"message": "You've trained 4 days in a row. Recovery day might be wise — sleep quality dropped 15% last night.", "priority": "medium"}}
{"channel": "sync", "data": {"event_id": "evt_099", "action": "create_node", "node_type": "Meal", "source": "phone"}}
```

#### Graph — `GET /api/v1/graph`

Returns subgraph data for visualisation. Supports filtering by domain, time range, depth.

```json
{
  "center": "project_tensortonics",   // node ID or "self" for ego graph
  "depth": 2,                          // hops from center
  "domains": ["cortex", "inventory"],  // filter
  "time_range": {"from": "2026-06-01", "to": "2026-07-14"},
  "limit": 200                         // max nodes returned
}
```

#### Devices — `GET/POST /api/v1/devices`

Device registration and permission management.

```json
// Register new device
POST /api/v1/devices
{
  "name": "watch_v1",
  "type": "esp32",
  "permissions": {
    "read": ["vitality.workout", "vitality.sleep", "inventory.goals"],
    "write": ["vitality.workout", "vitality.meditation"]
  },
  "sync_mode": "push_only"
}

// Response includes API key for that device
{
  "device_id": "dev_watch_001",
  "api_key": "mf_...",
  "registered_at": "2026-07-14T12:00:00Z"
}
```

### 5.2 Authentication

Simple API key per device. All requests carry `Authorization: Bearer mf_<device_key>`. The Permission Manager checks each request against the device's read/write grants before executing. A master key (your laptop) has full access.

---

## 6. Sync Protocol

### 6.1 Event Sourcing Model

Every mutation (create, update, delete) on any device is recorded as an **event** before being applied. Events are the source of truth — the graph state is a projection of the event log.

```json
{
  "event_id": "evt_2026071418300001",
  "timestamp": "2026-07-14T18:30:00.001Z",
  "device_id": "dev_phone_001",
  "action": "create_node",
  "node_type": "Meal",
  "payload": {
    "description": "Chicken and rice",
    "timestamp": "2026-07-14T19:00:00Z",
    "calories": 650
  },
  "status": "pending"  // "pending" | "synced" | "conflict" | "rejected"
}
```

### 6.2 Sync Flow

```
Device (offline)                    Server
     │                                │
     │  [User logs meal]              │
     │  → Create event locally        │
     │  → Store in local event queue  │
     │  → Apply to local subgraph     │
     │                                │
     │  ... time passes ...           │
     │                                │
     │  [Connection restored]         │
     │  ─── POST /api/v1/sync ──────> │
     │       (batch of pending        │
     │        events)                 │
     │                                │  → Validate permissions
     │                                │  → Check for conflicts
     │                                │  → Apply to canonical graph
     │                                │  → Run Linker Agent
     │                                │  → Update event store
     │  <── Sync response ─────────── │
     │       (confirmations,          │
     │        server events since     │
     │        last sync,              │
     │        linker suggestions)     │
     │                                │
     │  → Mark local events synced    │
     │  → Apply server events         │
     │  → Update local subgraph       │
     │                                │
```

### 6.3 Conflict Resolution

**Default: Last-write-wins** using event timestamps. For a personal system this is almost always correct — you're the only writer.

**Event log preserves everything.** Even overwritten values are in the log. You can always reconstruct any past state.

**Manual review queue** for edge cases. If two devices modify the same node within 60 seconds, the event is flagged for review rather than auto-resolved. The React client shows a small conflict queue.

### 6.4 Selective Sync (Subgraph Slicing)

Each device receives only its permitted slice of the graph. The server maintains a **sync manifest** per device:

```json
{
  "device_id": "dev_watch_001",
  "last_sync": "2026-07-14T12:00:00Z",
  "subgraph_filter": {
    "node_types": ["Workout", "Meditation", "SleepLog", "Goal"],
    "max_nodes": 100,
    "time_window": "7d"   // only last 7 days
  },
  "pending_events_from_server": 3
}
```

---

## 7. Device Profiles

| Device | Storage | Read | Write | Sync Mode | Interface |
|---|---|---|---|---|---|
| **3090 Desktop** | Neo4j (canonical) | * | * | — (is the server) | Full React client |
| **Laptop** | SQLite (full replica) | * | * | Full bidirectional | Full React client |
| **Phone** | IndexedDB (PWA) | * | * | Full bidirectional, offline queue | PWA with quick-entry focus |
| **Watch** | Flash (ESP32) | Vitality subset, active goals | Workout, meditation, quick logs | Push-only, pull summaries | Physical buttons, small display |
| **Raspberry Pi** | SQLite (partial) | Vitality, goals, schedule | Notes, vitality logs | Streaming via WebSocket | Voice (Whisper in, Piper out) |
| **LLM Agent** | None (stateless) | Configurable per agent | Suggest-only (proposals require approval) | On-request | API calls |
| **Virtual Assistant** | None | Configurable | Suggest-only | On-request | Conversational (end-of-day review) |

---

## 8. LLM Agent Architecture

### 8.1 Linker Agent

**Trigger:** Every new node insertion.
**Purpose:** Propose edges to existing nodes in the graph.
**Method:** Embedding similarity (local model) + structural pattern matching (Cypher) + LLM reasoning for non-obvious connections.

```
New node: Paper("Protein synthesis and muscle recovery")
  → Embedding search finds: Workout nodes tagged "strength"
  → Cypher finds: Goal("increase lean mass by 3kg")
  → Proposes: Paper -[:INFORMS]-> Goal (confidence: 0.82)
  → Proposes: Paper -[:RELATES_TO]-> Nutrient("protein") (confidence: 0.91)
```

Proposals above a confidence threshold (e.g., 0.85) are auto-approved. Below that, they go to a review queue.

### 8.2 Insight Agent

**Trigger:** Scheduled (daily summary, weekly review) + threshold-based alerts.
**Purpose:** Cross-domain pattern recognition and proactive recommendations.

Example queries it runs daily:
```cypher
// Sleep quality vs room temperature correlation
MATCH (s:SleepLog)-[:AFFECTED_BY]->(e:EnvironmentLog)
WHERE s.sleep_onset > datetime() - duration('P7D')
RETURN avg(s.quality) AS avg_quality, avg(e.temperature_c) AS avg_temp

// Training volume trend vs goal progress
MATCH (w:Workout)-[:TOWARD]->(g:Goal)
WHERE g.status = 'active' AND w.timestamp > datetime() - duration('P30D')
RETURN g.description, count(w) AS sessions, sum(w.volume_kg) AS total_volume

// Nutrition gap detection
MATCH (m:Meal)-[:CONTAINS]->(n:Nutrient)
WHERE m.timestamp > datetime() - duration('P7D')
RETURN n.name, sum(n.amount) AS weekly_total
```

Output: Natural language summary pushed via WebSocket or queued for end-of-day review.

### 8.3 Query Agent

**Trigger:** User query (natural language or voice).
**Purpose:** Translate questions into Cypher, execute, reason over results, respond conversationally.

Pipeline:
1. Parse user intent
2. Identify relevant node types and relationships
3. Generate Cypher query
4. Execute against Neo4j
5. Reason over results with LLM (local for simple, Claude API for complex)
6. Return natural language answer with optional chart data

Example:
```
User: "What did I eat on days where I had my best workouts this month?"
→ Cypher: Find top 5 Workouts by volume this month → traverse AFTER edges to Meals → return meal descriptions
→ Response: "Your highest-volume sessions this month followed meals with 40g+ protein 2-3 hours prior. Chicken and rice appeared 3 out of 5 times."
```

---

## 9. Data Ingestion Channels

| Channel | Description | Implementation |
|---|---|---|
| **Manual entry** | Forms in React client, quick-entry on PWA | Structured JSON → `/api/v1/ingest` |
| **Natural language** | Chat or voice input | Text → LLM parser → structured events → `/api/v1/ingest` |
| **Voice** | Raspberry Pi or phone mic | Whisper STT → NL pipeline → events |
| **Wearable APIs** | Garmin, Fitbit, Apple Health, Oura | Scheduled cron jobs pulling via APIs → batch ingest |
| **File drops** | PDFs, screenshots, CSVs | Upload → OCR/extraction → node creation |
| **Watch buttons** | ESP32 physical inputs | Predefined event templates → event queue → sync |
| **Automated** | Room sensors (temperature, humidity) | MQTT → listener service → EnvironmentLog nodes |

---

## 10. Deployment

### 10.1 Docker Compose Stack

```yaml
# docker-compose.yml
version: '3.8'

services:
  neo4j:
    image: neo4j:5-community
    ports:
      - "7474:7474"   # browser
      - "7687:7687"   # bolt
    volumes:
      - neo4j_data:/data
      - neo4j_logs:/logs
    environment:
      NEO4J_AUTH: neo4j/${NEO4J_PASSWORD}
      NEO4J_PLUGINS: '["apoc"]'

  postgres:
    image: postgres:16
    volumes:
      - postgres_data:/var/lib/postgresql/data
    environment:
      POSTGRES_DB: mainframe_events
      POSTGRES_USER: mainframe
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}

  minio:
    image: minio/minio
    command: server /data --console-address ":9001"
    ports:
      - "9000:9000"
      - "9001:9001"
    volumes:
      - minio_data:/data
    environment:
      MINIO_ROOT_USER: ${MINIO_USER}
      MINIO_ROOT_PASSWORD: ${MINIO_PASSWORD}

  ollama:
    image: ollama/ollama
    ports:
      - "11434:11434"
    volumes:
      - ollama_data:/root/.ollama
    deploy:
      resources:
        reservations:
          devices:
            - capabilities: [gpu]

  api:
    build: ./backend
    ports:
      - "8000:8000"
    depends_on:
      - neo4j
      - postgres
      - minio
      - ollama
    environment:
      NEO4J_URI: bolt://neo4j:7687
      POSTGRES_URI: postgresql://mainframe:${POSTGRES_PASSWORD}@postgres/mainframe_events
      MINIO_ENDPOINT: minio:9000
      OLLAMA_HOST: http://ollama:11434
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY}
    volumes:
      - ./backend:/app

  frontend:
    build: ./frontend
    ports:
      - "3000:3000"
    depends_on:
      - api

  caddy:
    image: caddy:2
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data

volumes:
  neo4j_data:
  neo4j_logs:
  postgres_data:
  minio_data:
  ollama_data:
  caddy_data:
```

### 10.2 Repository Structure

```
mainframe/
├── docker-compose.yml
├── .env.example
├── Caddyfile
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── app/
│   │   ├── main.py              # FastAPI app
│   │   ├── config.py
│   │   ├── models/              # Pydantic models for all node types
│   │   ├── routers/
│   │   │   ├── ingest.py
│   │   │   ├── query.py
│   │   │   ├── graph.py
│   │   │   ├── devices.py
│   │   │   └── sync.py
│   │   ├── services/
│   │   │   ├── neo4j_service.py
│   │   │   ├── event_store.py
│   │   │   ├── sync_engine.py
│   │   │   ├── permission_mgr.py
│   │   │   └── file_store.py
│   │   ├── agents/
│   │   │   ├── linker.py
│   │   │   ├── insight.py
│   │   │   └── query_agent.py
│   │   └── ingestion/
│   │       ├── nl_parser.py     # Natural language → structured events
│   │       ├── file_processor.py
│   │       └── wearable_sync.py
│   └── tests/
├── frontend/
│   ├── Dockerfile
│   ├── package.json
│   ├── src/
│   │   ├── App.tsx
│   │   ├── components/
│   │   │   ├── Dashboard.tsx     # Daily overview
│   │   │   ├── GraphView.tsx     # D3 knowledge graph
│   │   │   ├── WikiView.tsx      # Auto-generated wiki pages
│   │   │   ├── TimelineView.tsx  # Chronological feed
│   │   │   ├── QuickEntry.tsx    # Fast input forms
│   │   │   └── ChatInterface.tsx # Query Agent conversation
│   │   ├── hooks/
│   │   ├── services/
│   │   └── stores/
│   └── public/
│       └── sw.js                # Service worker for PWA
├── firmware/
│   └── watch/
│       ├── platformio.ini
│       └── src/
│           └── main.cpp         # ESP32 watch firmware
├── pi/
│   ├── voice_terminal.py        # Whisper + Piper + API client
│   └── sensor_listener.py       # MQTT env sensor ingestion
└── schema/
    ├── cypher/
    │   ├── constraints.cypher   # Uniqueness, indexes
    │   └── seed.cypher          # Initial schema setup
    └── migrations/              # Schema evolution scripts
```

---

## 11. Phased Roadmap

### Phase 1 — Foundation (Weeks 1-3)

**Goal:** Server running, one client working, basic CRUD on the graph.

- Docker Compose with Neo4j, PostgreSQL, FastAPI, MinIO
- Core schema (constraints, indexes) deployed
- `/ingest` endpoint for structured JSON input
- `/query` endpoint for raw Cypher
- Basic React frontend: quick-entry forms for Workout, Meal, SleepLog
- Simple list/timeline view of recent nodes
- No LLM integration yet — pure data layer

**Milestone:** Log a workout from the React client, see it in Neo4j Browser.

### Phase 2 — Intelligence (Weeks 4-6)

**Goal:** LLM agents operational, natural language input working.

- Ollama integration with a capable local model
- Natural language parser for `/ingest` (text → structured events)
- Linker Agent: auto-suggest edges on node creation
- Query Agent: NL → Cypher → response pipeline
- Graph visualisation (D3) in the React client
- Add remaining node types (Paper, Project, Goal, etc.)

**Milestone:** Type "Had steak and eggs then trained legs for an hour" and see correct nodes + edges created automatically.

### Phase 3 — Sync (Weeks 7-9)

**Goal:** Multi-device support with offline capability.

- Event sourcing layer in PostgreSQL
- Sync protocol implementation (`/sync` endpoint)
- Device registration and permission system
- PWA with service worker and IndexedDB offline queue
- Caddy reverse proxy with HTTPS for remote access
- Laptop SQLite replica with full sync

**Milestone:** Log a meal on phone while offline, connect to WiFi, see it appear in the graph on your desktop.

### Phase 4 — Edge Devices (Weeks 10-12)

**Goal:** Watch and Pi operational.

- ESP32 watch firmware: quick-log buttons, event queue, BLE/WiFi sync
- Raspberry Pi voice terminal: Whisper STT, Piper TTS, conversational interface
- Environment sensor integration (temperature, humidity via MQTT)
- Insight Agent: daily summaries, weekly reviews, pattern detection

**Milestone:** Say "Log 8 hours sleep, felt rested" to the Pi, tap "workout done" on the watch, see both in the graph with auto-linked edges.

### Phase 5 — Wiki & Polish (Weeks 13-16)

**Goal:** Auto-generated wiki, rich dashboards, virtual assistant.

- Wiki generator: LLM creates and maintains concept pages from graph data
- Dashboard views: Vitality trends, Cortex project boards, Inventory goal trackers
- Virtual assistant: end-of-day conversational review agent
- Wearable API integrations (Garmin/Fitbit/Oura)
- Search: full-text + semantic across all nodes
- Export: CSV, JSON, PDF reports from any subgraph

**Milestone:** Open Mainframe, see a wiki page for your EngD research that links to papers, projects, goals, and supervisor notes — all auto-generated and kept current.

---

## 12. Future Extensions

These are not scoped but are natural evolution paths:

- **Embeddings layer:** Vector index (pgvector or Qdrant) alongside the graph for semantic search and similarity-based linking
- **Habit engine:** Goal decomposition into daily habits with streak tracking
- **Social graph:** If you ever want to share read-only views with collaborators or supervisors
- **Time-series DB:** If Vitality data volume grows enough to warrant InfluxDB/TimescaleDB alongside Neo4j
- **Mobile native:** If PWA limitations become painful, Flutter app wrapping the same API
- **AR/VR interface:** Graph exploration in 3D (you've got the Unreal Engine experience for this)
- **Backup & portability:** Automated graph dumps to cold storage, full export for migration
