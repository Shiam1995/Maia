# Paper Metabolism — Build Prompt for Claude CLI

## Context

I have designed a system called **Paper Metabolism** as part of my personal knowledge OS called **Mainframe**. It tracks how deeply I engage with academic papers — from first read through implementation. I have an interactive HTML prototype that validates the UX. Now I need the real system built.

I run Ubuntu Linux on an OMEN MAX Gaming Laptop (username: shiamjuniorchuttoo). I have a dual RTX 3090 desktop at home. I want everything self-hosted and always accessible on my machine.

---

## Tech Stack

- **Database**: Neo4j (always running as a systemd service, bolt://localhost:7687)
- **Backend**: FastAPI (Python), served locally
- **Frontend**: HTML/CSS/JS (served by FastAPI, no framework — vanilla JS or lightweight like Alpine.js/htmx if it simplifies things)
- **PDF processing**: PyMuPDF (fitz) or pdfplumber for text extraction
- **LLM integration**: Ollama (local models) and/or Anthropic API for extraction tasks
- **File storage**: `~/.mainframe/papers/originals/` and `~/.mainframe/papers/instances/`
- **Excel-like tables**: handsontable or a similar JS spreadsheet library for in-browser editable tables

---

## System Architecture

### Three layers:

1. **Presentation** — Browser UI at localhost
2. **API** — FastAPI endpoints
3. **Storage** — Neo4j (structured data) + filesystem (PDFs)

### API Routes:

```
/api/papers          — CRUD for papers (upload PDF, metadata extraction)
/api/instances       — Create/update annotated reading instances per paper
/api/highlights      — CRUD for interesting parts / annotations
/api/terms           — CRUD for extracted terms with 0-10 familiarity scores
/api/tasks           — CRUD for tasks with due dates and completion status
/api/refs            — Citation relationships between papers (with highlight toggle)
/api/kg/nodes        — CRUD for KG nodes across 3 layers
/api/kg/edges        — CRUD for KG edges (labeled relationships between nodes)
/api/kg/query        — Raw Cypher pass-through for power-user queries
/api/deepdive        — Monthly deep dive scheduling and tracking
/api/ideas           — CRUD for idea table entries with dynamic categories
/api/headers         — CRUD for user-defined custom sections/headers
/api/log             — Activity log (every change timestamped)
```

---

## Neo4j Data Model

### Node Labels:

**:Paper**
```
id: UUID
title: String
authors: [String]
year: Int
venue: String
doi: String?
arxiv_id: String?
abstract: String?
original_path: FilePath (to ~/.mainframe/papers/originals/)
status: "unread" | "reading" | "read"
added_at: DateTime
```

**:Instance**
```
id: UUID
version: Int
created_at: DateTime
purpose: String (e.g. "first read", "deep dive", "revisit")
file_path: FilePath (to ~/.mainframe/papers/instances/)
coverage_pre: Float (0-10 avg familiarity before reading)
coverage_post: Float (0-10 avg familiarity after reading)
code_depth: "L0" | "L1" | "L2" | "L3" | "L4" | "L5"
```

**:Highlight**
```
id: UUID
section: String
excerpt: String
my_note: String
tag: "knew" | "new" | "rethink" | "implement"
page: Int?
```

**:Concept** (extracted terms)
```
id: UUID
name: String
definition: String?
domain: String?
familiarity: Int (0-10)
```

**:Question**
```
id: UUID
text: String
source: "paper" | "code" | "idea"
route_to: String (Cortex domain)
status: "open" | "exploring" | "resolved"
```

**:Task**
```
id: UUID
text: String
due_date: Date?
done: Boolean
done_at: DateTime?
```

**:Author**
```
name: String
orcid: String?
```

**:Venue**
```
name: String
type: "conference" | "journal" | "arxiv" | "workshop"
```

**:DeepDive**
```
id: UUID
month: String (e.g. "2026-08")
theme: String?
status: "planned" | "active" | "completed"
notes: String?
```

**:Idea**
```
id: UUID
title: String
description: String
category: String (user-defined, e.g. "research", "implementation", "tensortonics", "content", "experiment", "tool")
priority: "low" | "medium" | "high"
status: "raw" | "exploring" | "in-progress" | "done" | "parked"
created_at: DateTime
```

**:CustomHeader**
```
id: UUID
name: String
description: String?
order: Int
created_at: DateTime
```

### Relationships:

```
(:Paper)-[:HAS_INSTANCE]->(:Instance)
(:Paper)-[:CITES {highlighted: Boolean}]->(:Paper)
(:Paper)-[:INTRODUCES]->(:Concept)
(:Paper)-[:AUTHORED_BY]->(:Author)
(:Paper)-[:PUBLISHED_AT]->(:Venue)
(:Instance)-[:CONTAINS]->(:Highlight)
(:Highlight)-[:ABOUT]->(:Concept)
(:Question)-[:DERIVED_FROM]->(:Paper)
(:Task)-[:BELONGS_TO]->(:Paper)          // optional link
(:DeepDive)-[:FOCUSES_ON]->(:Paper)
(:Idea)-[:RELATED_TO]->(:Paper)          // optional link
(:Idea)-[:CONNECTS_TO]->(:Idea)          // ideas can link to each other
(:CustomHeader)-[:SCOPED_TO]->(:Paper)   // optional
```

### Triple Knowledge Graph (per paper):

Every KG node has a `layer` property:
- `"manual"` — I build this myself
- `"auto"` — LLM-generated, frozen after creation, never modified
- `"auto_edit"` — cloned from auto, then I can edit it

Auto-editable nodes also carry:
```
edit_status: "original" | "edited" | "added" | "removed"
original_name: String? (pre-edit name)
edit_reason: String?
edited_at: DateTime?
auto_source_id: UUID? (points to frozen auto node)
```

KG edge schema:
```
(:KGNode)-[:RELATES {label: String, layer: String}]->(:KGNode)
```

---

## LLM Integration

Use LLMs (via Ollama local or Anthropic API) for these tasks:

1. **PDF metadata extraction** — given extracted text from a PDF, return structured JSON: title, authors, year, venue, abstract, DOI/arXiv ID
2. **Auto KG generation** — given full paper text, extract entities (concepts, methods, results), relationships, and claims as a graph. Return as JSON list of nodes and edges. This becomes the frozen Auto KG layer.
3. **Reference list parsing** — extract cited paper titles/authors from the references section, attempt to match against existing papers in the repository
4. **Concept extraction** — from section headers and abstract, generate a list of key concepts for the pre-read familiarity assessment
5. **Idea suggestion** — optionally, after reading annotations are added, suggest potential research questions or ideas

Each LLM call should:
- Have a well-structured system prompt with JSON output schema
- Fall back gracefully if the model is unavailable
- Log the call and result
- Allow the user to re-trigger extraction with a different prompt

---

## Features in Detail

### 1. Paper Repository
- Upload PDF → store in `~/.mainframe/papers/originals/`
- Auto-extract metadata via LLM
- Manual edit of metadata
- Status cycling: unread → reading → read
- Search and filter by title, author, year, venue, status

### 2. Paper Workspace (Instances)
- Select a paper → create a new reading instance (v1, v2, etc.)
- Annotated copy stored in `~/.mainframe/papers/instances/`
- Add highlights tagged as: knew / new / rethink / implement
- Each highlight has: section reference, excerpt, personal note, page number
- Extract terms with **0–10 familiarity score** (slider + number input)
- Familiarity colour: red (0–3), amber (4–6), teal (7–10)
- Update familiarity score on re-reads (change is logged with old → new value)

### 3. Tasks
- Create tasks with description, optional linked paper, due date
- Checkbox to mark done (with completion timestamp)
- Overdue tasks flagged in red
- Active vs completed separation
- Filter by paper

### 4. Reference Cross-Reference Matrix
- NxN matrix where row cites column
- Click to cycle: · (none) → ✓ (cites) → ★ (highlighted/important) → · (none)
- Show citation density stats (most cited, most citing)

### 5. Publication Timeline
- Auto-sort papers by year
- Show citation flow (cites N / cited by N)
- Read status indicator

### 6. Knowledge Graph (Triple Layer)
- **Add nodes** to any of the 3 layers (manual, auto, auto-editable)
- **Add edges** between nodes with labeled relationships (e.g. USES, ENABLES, CITES, PART_OF)
- **Edit nodes** — change name, type, layer (all changes logged with before/after)
- **Delete nodes** — cascades to remove connected edges
- **Toggle layer visibility** — show/hide each layer independently
- **Drag nodes** on canvas to reposition
- **Double-click** a node to edit it
- Edge rendering: lines between nodes with relationship label at midpoint
- Node list table with edit (✏️) and delete (×) buttons
- Edge list with source → [LABEL] → target and delete button
- Force-directed or manual layout

### 7. Deep Dive (Monthly)
- Schedule 1–3 papers per month for deep engagement
- Each deep dive has: month, theme (optional), list of papers, status, notes
- Track progress: planned → active → completed
- View: calendar/grid of months showing what you deep-dived into
- Link to the paper's workspace instance for that deep dive

### 8. Ideas Table (Excel-like)
- An editable spreadsheet-style table for capturing ideas
- Use a JS spreadsheet library (handsontable, jspreadsheet, or similar) for inline editing, sorting, filtering
- **Default columns** (user can add/remove/rename columns later):
  - Title
  - Description
  - Category (dropdown: research, implementation, tensortonics, content, experiment, tool, fusion, personal — user-extensible)
  - Priority (low / medium / high)
  - Status (raw / exploring / in-progress / done / parked)
  - Linked Paper (dropdown of papers in repo)
  - Created date (auto)
  - Notes
- User can:
  - Add new rows
  - Sort by any column
  - Filter by category, priority, status
  - Edit cells inline
  - Add custom columns (stored as flexible properties on the :Idea node)
  - Export as CSV or JSON

### 9. Custom Headers / Sections
- User can create new named sections that appear as additional tabs
- Each custom header has: name, description, order
- Can be scoped to a specific paper or global
- Content is freeform markdown/text stored as properties
- This allows the system to grow organically — if I want a "Literature Review" section or a "Conference Notes" section, I add it without code changes

### 10. Activity Log
- Every single action timestamped and categorised
- Categories: paper, highlight, term, task, ref, kg, status, deepdive, idea, header
- Filter by category
- Group by day
- Export as JSON
- Log entries include: timestamp, category, action description, detail text, associated paper title

---

## UI Design

- Dark theme: background #0B0F14, surface #141A22, raised #1B2330
- Accent colours: teal (#00D4AA), amber (#F0A030), purple (#8B7EC8), red (#E05A5A), blue (#5A9DE0)
- Typography: JetBrains Mono for labels/data/code, Inter for body text
- Tab-based navigation across the top
- Left panel for paper context when relevant
- Responsive down to tablet width
- Minimal, no unnecessary decoration
- Every interactive element should feel immediate (no loading spinners for local operations)

---

## File Structure

```
~/.mainframe/
├── papers/
│   ├── originals/          # pristine PDFs
│   └── instances/          # annotated copies
├── config/
│   └── settings.yaml       # Neo4j connection, LLM config, custom categories
└── exports/                # log exports, CSV exports

~/mainframe-app/
├── backend/
│   ├── main.py             # FastAPI app
│   ├── models.py           # Pydantic models
│   ├── db.py               # Neo4j connection + queries
│   ├── llm.py              # LLM integration (Ollama/Anthropic)
│   ├── pdf.py              # PDF text extraction
│   ├── routes/
│   │   ├── papers.py
│   │   ├── instances.py
│   │   ├── highlights.py
│   │   ├── terms.py
│   │   ├── tasks.py
│   │   ├── refs.py
│   │   ├── kg.py
│   │   ├── deepdive.py
│   │   ├── ideas.py
│   │   ├── headers.py
│   │   └── log.py
│   └── requirements.txt
├── frontend/
│   ├── index.html
│   ├── css/
│   │   └── main.css
│   └── js/
│       ├── app.js          # routing, state management
│       ├── repo.js         # repository view
│       ├── workspace.js    # paper workspace
│       ├── tasks.js
│       ├── refs.js
│       ├── timeline.js
│       ├── kg.js           # knowledge graph (canvas, nodes, edges, layers)
│       ├── deepdive.js
│       ├── ideas.js        # spreadsheet table
│       ├── headers.js      # custom sections
│       └── log.js
├── docker-compose.yml      # Neo4j + FastAPI
└── README.md
```

---

## Build Order

1. **Neo4j setup** — docker-compose with Neo4j, create constraints and indexes
2. **FastAPI skeleton** — models, db connection, health check
3. **Paper CRUD** — upload PDF, extract text, LLM metadata extraction, store
4. **Workspace** — instances, highlights, terms with familiarity scores
5. **Tasks** — CRUD with dates and checkboxes
6. **References** — citation matrix with highlight toggle
7. **Knowledge Graph** — triple layer nodes, edges, editing, canvas rendering
8. **Deep Dive** — monthly scheduling
9. **Ideas Table** — spreadsheet component with dynamic columns
10. **Custom Headers** — extensible sections
11. **Activity Log** — wired into every operation
12. **Frontend** — connect all views to the API

---

## Important Notes

- Every mutation (create, update, delete) must write to the activity log
- The Auto KG layer should be generated by the LLM on paper ingest and frozen — user cannot edit it directly, only the Auto-Editable clone
- Familiarity is always 0–10, never categories
- Tasks must have checkboxes and due dates
- The ideas table must feel like a spreadsheet — inline editing, not form-based
- Custom headers/sections should be genuinely extensible — no hardcoded list
- The system should work fully offline (Ollama for LLM) with optional Anthropic API for higher quality extraction
- All data lives in Neo4j — no SQLite, no JSON files for primary storage
- The log is the audit trail of everything — it should be comprehensive and exportable
