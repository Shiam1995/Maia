# Design brief — "How Mainframe works"

## The ask

Design a **single-page system diagram** that explains how Mainframe works to
someone seeing it for the first time. Not a UI mockup — a piece of explanatory
information design. The reader should finish it able to say: *"one local graph,
four modules, one assistant, nothing leaves the machine."*

Deliverable: one poster-shaped page (portrait or 16:9, your call), readable at
full-screen and still legible when scrolled on a phone.

## What Mainframe is

A self-hosted **personal operating system** for one person. It replaces
MyFitnessPal + Notion + spreadsheets + note apps with one data layer where
cross-domain connections are first-class: the paper you read, the meal you ate,
the money you spent and the task you finished all live in the same graph and can
link to each other.

Core principle, and it should come through in the design: **one brain, many
mouths.** The server owns the truth. Every screen is a window into it.

Second principle, equally important: **local-first.** Neo4j on localhost, Ollama
on localhost, speech-to-text and text-to-speech on the machine. There is no
cloud provider anywhere in the stack. This is a deliberate design decision, not
a limitation — the diagram should make the absence of a cloud visible rather
than just unmentioned.

## The architecture, in the layers it should be drawn in

Draw it as a stack. Top = what the user touches, bottom = where truth lives.

**1 — Boot + Home**
A CRT boot screen animates on first paint, then hands over to a home screen:
four tall module cards, a lifetime stat strip, a period snapshot, and a
customisable background (gradient / image slideshow / video, with dim and
particle controls). The home screen is an overlay *above* the app shell —
opening a module hides it, "← mainframe" brings it back.

**2 — The shell: two-tier navigation**
- **Top bar — Mainframe-level tabs**, shared and visible inside every module:
  `Tasks · Calendar · Progress · Work · Ideas · Learning · Activity · Gantt ·
  Mind · Project · Log · FAQ`
  Tasks is first and is the default view: tasks are the spine of the whole
  system. Calendar sits directly after it — that's where tasks meet real time.
- **Second bar — the active module's own tabs**, tinted with that module's
  accent colour. Switching module reskins the shell.

**3 — The four modules** (each with its accent colour — use these exactly):

| Module | Accent | Domain | Its tabs |
|---|---|---|---|
| **SYNAPSE** | `#00D4AA` teal | Research & knowledge | repo, workspace, dictionary, scanner, reference graph, timeline, knowledge graph, deep dive, decomposition, custom headers |
| **PULSE** | `#F4709C` pink | Body & habits | benchmark, habits, tracking, experiments, routines, fitness, nutrition, recovery, medical, medications |
| **VISION** | `#FF4757` red | Content & output | blueprint, youtube, writing, portfolio, network, sandbox |
| **VAULT** | `#D4A017` gold | Finance & assets | overview, accounts, transactions, budget, investments, analytics, inventory, financial diary |

Modules are declared in one manifest file — adding a fifth is one entry plus its
views. Worth conveying: this is an **extensible slot**, not a fixed set of four.

**4 — The API**
FastAPI. **426 endpoints across 34 routers**, namespaced by module
(`/api/synapse/*`, `/api/pulse/*`, `/api/vault/*`, `/api/vision/*`, plus
Mainframe-level `/api/tasks`, `/api/calendar`, `/api/work`, `/api/agent`…).

**5 — The store**
A **single Neo4j graph** holds every module's data — ~90 node types, from
`Paper` and `Task` to `Workout`, `Transaction`, `CalEvent` and `Idea`. One graph
is the reason cross-module links work at all. Files (paper PDFs, images,
wallpapers, exports) live under `~/.mainframe/`.

Notable scale detail worth a callout: **4 million foods** are permanently
resident in the graph — USDA, Open Food Facts and UK CoFID — as their own
catalogue node type.

## The assistant — give this its own panel

Reachable with **Ctrl+K from any view**. It is a deliberate layer *over* the API,
and the design should show why:

- The app has 426 routes. Handing a 7B local model 426 tools produces a confused
  assistant, not a capable one. So there's a hand-written registry of ~23 broad,
  verb-shaped **capabilities** ("log time on a task", not six task endpoints).
- **The safety model is the whole design: reads run, writes need a yes.** A read
  executes immediately and feeds its result back to the model. A write or delete
  is *never* executed by the model — it's captured, described in plain English,
  and returned as a pending action that only a human pressing confirm can run.
  This is enforced in code, not in the prompt. Draw this as a gate.
- The model is never allowed to compute a date or invent an ID. Natural words
  ("tomorrow", "the website task") pass straight through and are resolved
  server-side against real rows.
- Voice pipeline, all local: **whisper** hears → **Ollama** (`qwen2.5:7b-instruct`)
  thinks → **piper** speaks.

## Visual direction

The app's own language is a **dark terminal / CRT aesthetic**, and the diagram
should feel like it belongs to the same product:

```
bg      #0B0F14      text    #dfe6ee      mono   JetBrains Mono
surface #141A22      muted   #8194a8      sans   Inter
raised  #1B2330      border  #232d3b
```

Module accents (teal / pink / red / gold above) are the only saturated colour —
use them to carry the eye through the stack, so a reader can trace "Pulse" from
its home-screen card down through its tabs to its slice of the graph. Boot-screen
palette, if you want a nod to it: phosphor green `#33FF33`, electric blue `#00BFFF`.

Mono for anything that is literally a path, endpoint or identifier. Sans for
prose.

## Constraints

- **Every number in this brief is real** — 426 routes, 34 routers, 4 modules, 12
  shared tabs, ~23 capabilities, 4M foods. Don't round them into vagueness and
  don't invent new ones.
- Don't draw a cloud, an external API, or a third-party service. There aren't
  any, and that's the point.
- Don't make it a marketing landing page. No hero copy, no feature grid, no
  call-to-action. It's an explainer.
- Legibility over density: if the four modules' full tab lists crowd the page,
  show Synapse's in full as the worked example and summarise the rest by count.

## Success test

A reader who has never seen Mainframe should be able to answer, unprompted:
Where does my data live? What are the four modules and what does each own? What
happens when I hold Ctrl+K and say "log 40 minutes on the website task"?
