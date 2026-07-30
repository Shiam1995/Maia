# Maia
<img width="389" height="556" alt="Maialogo" src="https://github.com/user-attachments/assets/3d43aba8-98e4-4466-8416-365626c6d74a" />

> **愛** — *ai* — Japanese for love.

Maia is a self-hosted personal operating system. One local graph, four modules, one
assistant, and nothing leaves the machine.

It began life as **Mainframe**: an attempt to replace MyFitnessPal + Notion +
spreadsheets + a pile of note apps with a single data layer where cross-domain
connections are first-class. The paper you read, the meal you ate, the money you
spent and the task you finished all live in the same graph and can link to each
other. Renaming it Maia is not cosmetic — it names the thing the architecture was
already reaching for.

---

## The vision — why this is an empathy project

Most assistants are built to *sound* empathetic. They are trained to produce the
cadence of care: the softened refusal, the reflective summary, the "that sounds
really hard." What they almost never have is the thing empathy is actually made
of — **context, retained over time, held in confidence.**

An assistant that has forgotten you by the next session cannot be kind to you. It
can only be polite at you.

Maia takes the opposite bet. Empathy is not a tone; it is an **infrastructure
problem**. Three things have to be true before a machine can care about a person
in any non-decorative sense:

**1. It has to actually know you — across domains, not in silos.**
Your sleep is not a separate fact from your focus. Your grocery spend is not
separate from the week you started a new job. The paper you keep failing to finish
is the same paper you abandoned in March, and the reason is probably in your task
log, not in the PDF. Empathy lives in the *joins*. That's why Maia is one Neo4j
graph — ~90 node types, from `Paper` and `Task` to `Workout`, `Transaction`,
`CalEvent` and `Idea` — and not four tidy apps that don't speak.

**2. It has to be yours — custody is a precondition, not a feature.**
There is no version of "tell me everything about your body, your money, your
unfinished work and your bad weeks" that is safe when the answers are sitting on
someone else's server, subject to someone else's business model. So the entire
stack is local: **Neo4j on localhost, Ollama on localhost, whisper and piper on
the machine.** There is no cloud provider anywhere in it. The absence is the
point. You are not the product because there is no pipe to be the product
through.

**3. It has to respect that you are the one who decides.**
The assistant reads freely and **never writes without a human yes**. Reads execute
immediately. Writes and deletes are never executed by the model — they are
captured, described back in plain English, and returned as a pending action that
only a person pressing *confirm* can run. This is enforced in code, not asked for
in a prompt. An assistant that can silently rewrite your life is not a caring
one, however gently it phrases things.

Put together, the claim is simple: **care requires context, context requires
trust, and trust requires custody.** Maia is what you get when you take that chain
seriously and build downward from it instead of bolting a warm voice onto an API
call.

The people this matters most for are the ones for whom "just use five apps and
hold the thread yourself" is the actual barrier — anyone managing a chronic
condition, a recovery, ADHD, a disability, a hard year. The executive function to
integrate your own life across a dozen dashboards is precisely what those
situations take away. Maia is an attempt to put that integration in the
infrastructure, so it doesn't have to come out of the person.

---

## Architecture

A stack. Top is what you touch; bottom is where truth lives.

### 1 — Boot + Home
A CRT boot screen animates on first paint, then hands to a home screen: four tall
module cards, a lifetime stat strip, a period snapshot, and a customisable
background (gradient / image slideshow / video, with dim and particle controls).
Home is an overlay *above* the app shell — opening a module hides it, `← mainframe`
brings it back.

### 2 — The shell: two-tier navigation
- **Top bar — Maia-level tabs**, shared and visible inside every module:
  `Tasks · Calendar · Progress · Work · Ideas · Learning · Activity · Gantt · Mind · Project · Log · FAQ`
  Tasks is first and is the default view — tasks are the spine of the system.
  Calendar sits directly after it, where tasks meet real time.
- **Second bar — the active module's own tabs**, tinted with that module's accent.
  Switching module reskins the shell.

### 3 — The four modules

| Module | Accent | Domain | Its tabs |
|---|---|---|---|
| **SYNAPSE** | `#00D4AA` teal | Research & knowledge | repo, workspace, dictionary, scanner, reference graph, timeline, knowledge graph, deep dive, decomposition, custom headers |
| **PULSE** | `#F4709C` pink | Body & habits | benchmark, habits, tracking, experiments, routines, fitness, nutrition, recovery, medical, medications |
| **VISION** | `#FF4757` red | Content & output | blueprint, youtube, writing, portfolio, network, sandbox |
| **VAULT** | `#D4A017` gold | Finance & assets | overview, accounts, transactions, budget, investments, analytics, inventory, financial diary |

Modules are declared in one manifest. Adding a fifth is one entry plus its views —
this is an extensible slot, not a fixed set of four.

### 4 — The API
FastAPI. **427 endpoints across 34 route modules**, namespaced by module
(`/api/synapse/*`, `/api/pulse/*`, `/api/vault/*`, `/api/vision/*`) plus
Maia-level `/api/tasks`, `/api/calendar`, `/api/work`, `/api/agent`.

### 5 — The store
A **single Neo4j graph** holds every module's data. One graph is the only reason
cross-module links work at all. Files — paper PDFs, images, wallpapers, exports —
live under `~/.mainframe/`.

Scale detail worth calling out: **4 million foods** are permanently resident in the
graph (USDA + Open Food Facts + UK CoFID) as their own catalogue node type.

---

## The assistant

Reachable with **Ctrl+K from any view**. It is a deliberate layer *over* the API,
and the design reasons matter:

- The app has 427 routes. Handing a 7B local model 427 tools produces a confused
  assistant, not a capable one. So there is a hand-written registry of **23 broad,
  verb-shaped capabilities** — "log time on a task", not six task endpoints.
  **12 are reads, 11 are writes**, and the split is structural.
- **Reads run. Writes need a yes.** Enforced in `backend/agent/runner.py`, not in
  the prompt.
- The model is never allowed to compute a date or invent an ID. Natural words
  ("tomorrow", "the website task") pass through and are resolved server-side
  against real rows.
- Voice, all local: **whisper** hears → **Ollama** (`qwen2.5:7b-instruct`) thinks →
  **piper** speaks.

So `Ctrl+K` → *"log 40 minutes on the website task"* → whisper transcribes locally,
the model picks the `task_log_time` capability, the server resolves "the website
task" to a real node, and you get back a plain-English pending action. Nothing
moves until you confirm. Nothing left the machine at any point.

---

## Running it

```bash
cd mainframe-app
cp backend/.env.example backend/.env   # point it at your local Neo4j
./start.sh                             # backend + frontend
./stop.sh
```

Requires Neo4j on localhost and, for the assistant, Ollama with
`qwen2.5:7b-instruct`. See `mainframe-app/README.md` for the full setup and
`mainframe-app/SYNAPSE_PROGRESS.md` for the detailed build log.

---

## Repository layout

This repo is the working folder as it actually exists, research material included
— not a sanitised export.

| Path | What it is |
|---|---|
| `mainframe-app/` | **The live system.** Neo4j + FastAPI backend, vanilla-JS frontend, local agent. |
| `mainframe/` | The first prototype — food module only, FastAPI + Postgres + React. Kept as history. |
| `MAINFRAME_DESIGN_BRIEF.md` | The system-diagram brief; the clearest single description of how it fits together. |
| `mainframe-spec.md` | Original full specification. |
| `paper-metabolism-prompt.md` | The spec that became Synapse. |
| `Papers/`, `Books/` | Reading that fed the design. Third-party material, included for reference only — all rights remain with their authors and publishers. |
| `Projects/` | C exercises and side work. |
| `Wallpapers/`, `Imageformainframescreen/`, `AI_assistant/` | Background art and module-card imagery used by the UI. |
| `Linkedin Posts/`, `Content(Name pending)/` | Writing and post drafts. |

---

## Design language

Dark terminal / CRT.

```
bg      #0B0F14      text    #dfe6ee      mono   JetBrains Mono
surface #141A22      muted   #8194a8      sans   Inter
raised  #1B2330      border  #232d3b
```

Module accents (teal / pink / red / gold) are the only saturated colour — they
carry the eye from a home-screen card, through that module's tabs, down to its
slice of the graph. Boot palette: phosphor green `#33FF33`, electric blue
`#00BFFF`.

Mono for anything that is literally a path, endpoint or identifier. Sans for prose.
