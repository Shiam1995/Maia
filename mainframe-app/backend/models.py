"""Pydantic request/response models.

Neo4j is schemaless at the driver level, so these models are where shape and
validation actually live. Node property names match the spec's data model.
"""
from __future__ import annotations

from datetime import date
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field

# --------------------------------------------------------------------------- #
# Papers
# --------------------------------------------------------------------------- #
# "revisit" = read it, but needs another pass
PaperStatus = Literal["unread", "reading", "read", "revisit"]

# What a repository entry actually is. A :Paper node is really "a source" — the
# label is kept because every paper-scoped view (workspace, instances,
# highlights, terms, references, KG, deep dive) is already built on it, and a
# book or a video series wants all of that machinery, not a copy of it.
# A PDF is optional: a video series or a book you only own on paper still gets
# its own instances, notes and graph nodes.
SourceKind = Literal["paper", "book", "video", "course", "article", "note"]


class PaperUpdate(BaseModel):
    title: Optional[str] = None
    kind: Optional[SourceKind] = None
    authors: Optional[list[str]] = None
    year: Optional[int] = None
    venue: Optional[str] = None
    url: Optional[str] = None
    doi: Optional[str] = None
    arxiv_id: Optional[str] = None
    abstract: Optional[str] = None
    status: Optional[PaperStatus] = None
    understanding: Optional[int] = None   # 0-10, how well you feel you grasp it


class SourceCreate(BaseModel):
    """A repository entry typed in by hand — no file involved."""
    title: str
    kind: SourceKind = "note"
    authors: list[str] = []
    year: Optional[int] = None
    venue: Optional[str] = None      # publisher, channel, platform
    url: Optional[str] = None        # where it lives: a playlist, a course page
    abstract: Optional[str] = None   # your own blurb / what it's about
    status: PaperStatus = "unread"


class Paper(BaseModel):
    id: str
    title: str
    kind: SourceKind = "paper"
    authors: list[str] = []
    year: Optional[int] = None
    venue: Optional[str] = None
    url: Optional[str] = None
    doi: Optional[str] = None
    arxiv_id: Optional[str] = None
    abstract: Optional[str] = None
    original_path: Optional[str] = None
    status: PaperStatus = "unread"
    added_at: Optional[str] = None


# --------------------------------------------------------------------------- #
# Instances / highlights / terms
# --------------------------------------------------------------------------- #
CodeDepth = Literal["L0", "L1", "L2", "L3", "L4", "L5"]
HighlightTag = Literal["knew", "new", "rethink", "implement"]


class InstanceCreate(BaseModel):
    purpose: str = "first read"
    coverage_pre: float = 0.0
    read_date: Optional[str] = None      # when you actually read it (user-set)
    time_spent: Optional[str] = None     # legacy freeform, e.g. "45min" / "1.5hrs"
    notes: Optional[str] = None          # fill-in info after the session
    # Set BEFORE the pass, not after: the things you already know you want to
    # come back to. Surfaces in the Master Instance so it isn't lost in a pass.
    look_into: Optional[str] = None
    # --- structured timing (see InstanceUpdate for the full set) ---
    start: str = ""
    end: str = ""
    mins: int = 0
    active_mins: int = 0
    passive_mins: int = 0
    distractions: int = 0
    # What pulled you away, one entry per interruption. A count alone says a
    # session went badly; the list says what to change, which is what makes it
    # pushable to Learning.
    distraction_items: list[str] = []


class InstanceUpdate(BaseModel):
    purpose: Optional[str] = None
    coverage_pre: Optional[float] = None
    coverage_post: Optional[float] = None
    code_depth: Optional[CodeDepth] = None
    read_date: Optional[str] = None
    time_spent: Optional[str] = None
    notes: Optional[str] = None
    # Structured timing for a reading session. `mins` is derived from
    # start/end when both are set, but a typed value always wins. active +
    # passive split the session; `distractions` is a COUNT, not minutes.
    # Anything that doesn't apply stays 0 / "".
    start: Optional[str] = None          # "HH:MM" started
    end: Optional[str] = None            # "HH:MM" ended
    mins: Optional[int] = None           # total time spent
    active_mins: Optional[int] = None    # of which active reading
    passive_mins: Optional[int] = None   # of which passive
    distractions: Optional[int] = None   # how many times you were pulled away
    distraction_items: Optional[list[str]] = None  # and what each one was
    look_into: Optional[str] = None      # things to come back to
    position: Optional[float] = None     # manual ordering of passes


class HighlightCreate(BaseModel):
    section: str = ""
    excerpt: str = ""
    my_note: str = ""
    tag: HighlightTag = "new"
    page: Optional[int] = None


class HighlightUpdate(BaseModel):
    section: Optional[str] = None
    excerpt: Optional[str] = None
    my_note: Optional[str] = None
    tag: Optional[HighlightTag] = None
    page: Optional[int] = None


class TermCreate(BaseModel):
    name: str
    definition: Optional[str] = None
    domain: Optional[str] = None
    familiarity: int = Field(0, ge=0, le=10)
    optional: bool = False  # "review later" / low-priority flag


class TermUpdate(BaseModel):
    definition: Optional[str] = None
    domain: Optional[str] = None
    familiarity: Optional[int] = Field(None, ge=0, le=10)
    optional: Optional[bool] = None


# --------------------------------------------------------------------------- #
# Dictionary (global Mainframe service — :Term nodes, distinct from :Concept)
# --------------------------------------------------------------------------- #
# The star "tag" classifies each entry. `starred` is a separate quick flag the
# user toggles to mark favourites.
DictEntryType = Literal["term", "concept", "method", "person"]


class DictEntryCreate(BaseModel):
    name: str
    eli5: Optional[str] = None
    definition: Optional[str] = None
    familiarity: int = Field(0, ge=0, le=10)
    video: Optional[str] = None
    domain: Optional[str] = None
    source: Optional[str] = None
    type: DictEntryType = "term"
    starred: bool = False


class DictEntryUpdate(BaseModel):
    name: Optional[str] = None
    eli5: Optional[str] = None
    definition: Optional[str] = None
    familiarity: Optional[int] = Field(None, ge=0, le=10)
    video: Optional[str] = None
    domain: Optional[str] = None
    source: Optional[str] = None
    type: Optional[DictEntryType] = None
    starred: Optional[bool] = None


class DictQuestionCreate(BaseModel):
    question: str
    answer: Optional[str] = None


class DictQuestionUpdate(BaseModel):
    question: Optional[str] = None
    answer: Optional[str] = None


class DictNoteCreate(BaseModel):
    text: str
    image: Optional[str] = None


class DictFromConcept(BaseModel):
    """One-click capture of a workspace :Concept into the dictionary."""
    name: str
    definition: Optional[str] = None
    domain: Optional[str] = None
    familiarity: int = Field(0, ge=0, le=10)
    type: DictEntryType = "term"


# --------------------------------------------------------------------------- #
# Tasks
# --------------------------------------------------------------------------- #
# Tasks are a Mainframe-level service (per TASKS_SPEC) — a task is a living
# journal, not a checkbox. Every field except title + horizon is optional.
Horizon = Literal["long", "medium", "short"]
ModuleName = Literal["synapse", "vitality", "cortex", "inventory"]
TaskStatus = Literal["active", "done", "hidden", "parked"]
Priority = Literal["low", "medium", "high"]
EntryType = Literal[
    "initial_idea", "progress", "note", "blocker", "reflection", "completed"
]


class TaskCreate(BaseModel):
    title: str
    horizon: Horizon = "short"
    module: ModuleName = "synapse"
    est_time: Optional[str] = None
    due_date: Optional[date] = None
    parent_id: Optional[str] = None
    priority: Priority = "medium"
    notes: Optional[str] = None  # if set → becomes the first "initial_idea" entry
    # When the clock starts. Defaults to now, but it's yours to set: a task
    # written down today may have actually begun last week, and `created_at`
    # (when the row was made) can't be changed without lying about the record.
    opened_at: Optional[str] = None


class TaskUpdate(BaseModel):
    title: Optional[str] = None
    horizon: Optional[Horizon] = None
    module: Optional[ModuleName] = None
    est_time: Optional[str] = None
    due_date: Optional[date] = None
    parent_id: Optional[str] = None
    priority: Optional[Priority] = None
    status: Optional[TaskStatus] = None
    done: Optional[bool] = None
    hidden: Optional[bool] = None  # convenience → maps to status active/hidden
    # The two ends of a task's life. Both editable, and both clearable by
    # sending null — together they're what "how long did this take" is measured
    # from, so a wrong one has to be fixable.
    opened_at: Optional[str] = None
    done_at: Optional[str] = None


class TaskEntryCreate(BaseModel):
    """One journal entry appended to a task's timeline.

    `date`/`time_of_day` are user-set (pre-filled with now client-side, but the
    user can log work they did earlier). `time_spent_mins` is what accumulates.
    """
    type: EntryType = "progress"
    date: Optional[str] = None        # ISO datetime the user set (not auto)
    time_of_day: Optional[str] = None
    time_spent_mins: int = 0
    time_spent_label: Optional[str] = None
    notes: str
    learned: Optional[str] = None
    next_step: Optional[str] = None


class TaskEntryUpdate(BaseModel):
    """Edit an existing journal entry (e.g. fix its date from the timeline)."""
    type: Optional[EntryType] = None
    date: Optional[str] = None
    time_of_day: Optional[str] = None
    time_spent_mins: Optional[int] = None
    time_spent_label: Optional[str] = None
    notes: Optional[str] = None
    learned: Optional[str] = None
    next_step: Optional[str] = None


# --------------------------------------------------------------------------- #
# References
# --------------------------------------------------------------------------- #
class RefToggle(BaseModel):
    source_id: str  # cites
    target_id: str  # cited
    state: Literal["none", "cites", "highlighted"]


class ReferenceCreate(BaseModel):
    """One cited work stored on a paper (name + link, citation-map ready)."""
    title: str
    link: Optional[str] = None
    year: Optional[int] = None


# How far you've got with a reference while scanning a bibliography.
# in_library is set automatically when the title matches a paper you own.
RefState = Literal["unread", "read", "in_library", "dismissed"]


class RefStateSet(BaseModel):
    state: RefState


class BulkRefs(BaseModel):
    """A bibliography pasted as text. `commit=False` previews without storing."""
    text: str
    commit: bool = False
    replace: bool = False   # clear the paper's existing references first


class RefNodeCreate(BaseModel):
    """A manual node on the Reference Map (not tied to a paper)."""
    label: str
    type: str = "note"


class RefEdgeCreate(BaseModel):
    """A manual edge between any two Reference-Map nodes (paper/reference/manual)."""
    source_id: str
    target_id: str
    label: str = "relates"


# --------------------------------------------------------------------------- #
# Mind dump — global quick-capture inbox (Mainframe-level)
# --------------------------------------------------------------------------- #
MindKind = Literal["idea", "look-at", "note"]


class MindDumpCreate(BaseModel):
    text: str
    detail: str = ""                 # longer body, shown when the card is expanded
    kind: MindKind = "idea"
    link: Optional[str] = None       # optional URL to "come look at this"
    paper_id: Optional[str] = None   # optional link back to a paper


class MindDumpUpdate(BaseModel):
    text: Optional[str] = None
    detail: Optional[str] = None
    kind: Optional[str] = None
    status: Optional[str] = None     # "open" | "done"
    link: Optional[str] = None
    paper_id: Optional[str] = None


# --------------------------------------------------------------------------- #
# Vault — finance / inventory / assets (VAULT_SPEC)
# --------------------------------------------------------------------------- #
AccountType = Literal["current", "savings", "digital", "cash", "investment", "crypto"]
TxType = Literal["expense", "income", "transfer"]
Verdict = Literal["needed", "wanted", "wasteful", ""]


class AccountCreate(BaseModel):
    name: str
    type: AccountType = "current"
    provider: str = ""
    balance: float = 0.0
    currency: str = "GBP"


class AccountUpdate(BaseModel):
    name: Optional[str] = None
    type: Optional[str] = None
    provider: Optional[str] = None
    balance: Optional[float] = None
    currency: Optional[str] = None


class TransactionCreate(BaseModel):
    date: str
    description: str
    amount: float                  # sign is normalised server-side from `type`
    type: TxType = "expense"
    category: str = "Other"
    account_id: Optional[str] = None
    verdict: Verdict = ""
    tags: list[str] = []
    notes: str = ""


class TransactionUpdate(BaseModel):
    date: Optional[str] = None
    description: Optional[str] = None
    amount: Optional[float] = None
    type: Optional[str] = None
    category: Optional[str] = None
    account_id: Optional[str] = None
    verdict: Optional[str] = None
    tags: Optional[list[str]] = None
    notes: Optional[str] = None


class BudgetCategoryCreate(BaseModel):
    """User-defined — the spec is explicit that budget categories are NOT
    hardcoded. Name should match the transaction category it budgets for."""

    name: str
    icon: str = "📌"
    amount: float = 0.0          # monthly target in £


class BudgetCategoryUpdate(BaseModel):
    name: Optional[str] = None
    icon: Optional[str] = None
    amount: Optional[float] = None
    order: Optional[int] = None


class IncomeSet(BaseModel):
    month: str                   # "YYYY-MM"
    amount: float


class InvestmentCreate(BaseModel):
    """Snapshot values — nothing here auto-updates (spec). `extra=allow` keeps
    the door open for the spec's future api_source / ticker / last_api_sync."""

    model_config = {"extra": "allow"}
    name: str
    type: str = "ETF"            # ETF | Stock | Crypto | Bond | Property | Other
    platform: str = ""
    amount_invested: float = 0.0
    current_value: float = 0.0
    strategy: str = "Monthly DCA"   # Monthly DCA | Lump sum | Opportunistic | Hold
    notes: str = ""


class InvestmentUpdate(BaseModel):
    model_config = {"extra": "allow"}
    name: Optional[str] = None
    type: Optional[str] = None
    platform: Optional[str] = None
    amount_invested: Optional[float] = None
    current_value: Optional[float] = None
    strategy: Optional[str] = None
    notes: Optional[str] = None


class InventoryCreate(BaseModel):
    name: str
    category: str = "other"      # tech|books|gaming|tools|clothing|furniture|other
    location: str = ""
    status: str = "owned"        # active|in-use|owned|stored|need|want|broken|sold
    value: float = 0.0
    notes: str = ""
    link: str = ""


class InventoryUpdate(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None
    location: Optional[str] = None
    status: Optional[str] = None
    value: Optional[float] = None
    notes: Optional[str] = None
    link: Optional[str] = None


class FinDiaryCreate(BaseModel):
    date: str
    title: str = ""
    text: str
    tags: list[str] = []


class FinDiaryUpdate(BaseModel):
    date: Optional[str] = None
    title: Optional[str] = None
    text: Optional[str] = None
    tags: Optional[list[str]] = None


class BulkImport(BaseModel):
    """Paste straight from a banking app. `dry_run` parses and returns a preview
    without writing anything — the spec requires a preview step before import."""

    text: str
    account_id: Optional[str] = None
    dry_run: bool = True


# --------------------------------------------------------------------------- #
# Vision — content-creation module (VISION_SPEC)
# --------------------------------------------------------------------------- #
class PipelineCreate(BaseModel):
    name: str
    description: str = ""


class PipelineUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None


class StageCreate(BaseModel):
    """A pipeline stage. The user defines every field — Blueprint is a template
    builder, so nothing here is a fixed/known stage (spec is explicit)."""

    name: str
    inputs: list[str] = []       # what feeds in — one per line in the UI
    outputs: list[str] = []      # what it produces
    tools: list[str] = []        # tools/LLMs, e.g. "Claude — script refinement"
    process: str = ""            # freeform checklist of how you do this stage


class StageUpdate(BaseModel):
    name: Optional[str] = None
    inputs: Optional[list[str]] = None
    outputs: Optional[list[str]] = None
    tools: Optional[list[str]] = None
    process: Optional[str] = None


class StageReorder(BaseModel):
    stage_ids: list[str]         # full ordered list of this pipeline's stages


VideoType = Literal["educational", "short", "big-project", "tutorial", "vlog", "series"]


class VideoCreate(BaseModel):
    """A YouTube video is a production workspace (VISION_UPDATE_SPEC), not just
    a tracking card. Research/markers/prompts/panels/thumbnails hang off it as
    their own nodes; these are the fields that live on the video itself."""

    title: str
    type: VideoType = "educational"
    pipeline_id: Optional[str] = None    # which Blueprint pipeline it follows
    stage: str = ""                      # comes from that pipeline's stage list
    target_date: Optional[str] = None
    description: str = ""                # concept / hook / angle
    framework: str = ""                  # e.g. "Hook→Story→CTA"
    llms_used: str = ""
    tags: list[str] = []
    notes: str = ""


class VideoUpdate(BaseModel):
    title: Optional[str] = None
    type: Optional[str] = None
    pipeline_id: Optional[str] = None
    stage: Optional[str] = None
    target_date: Optional[str] = None
    thumbnail: Optional[str] = None
    description: Optional[str] = None
    script: Optional[str] = None
    framework: Optional[str] = None
    llms_used: Optional[str] = None
    tags: Optional[list[str]] = None
    notes: Optional[str] = None


class JournalEntryCreate(BaseModel):
    text: str
    date: Optional[str] = None           # defaults to now


class ResearchNoteCreate(BaseModel):
    """Where you dump links, paper references, competitor video analysis."""

    title: str
    url: Optional[str] = None
    summary: str = ""


class ResearchNoteUpdate(BaseModel):
    title: Optional[str] = None
    url: Optional[str] = None
    summary: Optional[str] = None


# The 8 marker labels the spec enumerates. Stored as these keys; the frontend
# owns their icon/colour so the two never drift apart in the database.
MarkerLabel = Literal[
    "hook", "key-point", "abstraction", "data", "transition", "climax", "cta", "broll",
]


class ScriptMarkerCreate(BaseModel):
    """Annotates a LINE RANGE of the script — "the hook is here, the CTA is at
    the end". A visual map of the script's structure, for the user's own eye."""

    line_start: int = Field(1, ge=1)
    line_end: int = Field(1, ge=1)
    label: MarkerLabel = "key-point"
    note: str = ""


class ScriptMarkerUpdate(BaseModel):
    line_start: Optional[int] = Field(None, ge=1)
    line_end: Optional[int] = Field(None, ge=1)
    label: Optional[str] = None
    note: Optional[str] = None


class WritingCreate(BaseModel):
    """A blog/article/thread tracked through a Blueprint pipeline, same as a
    video — the stage list comes from the pipeline, never hardcoded."""

    title: str
    type: str = "Blog"           # Blog | Article | Thread | Newsletter | Essay
    platform: str = "Blog"       # Blog | Medium | Substack | LinkedIn | Twitter | Other
    pipeline_id: Optional[str] = None
    stage: str = ""
    link: str = ""
    notes: str = ""


class WritingUpdate(BaseModel):
    title: Optional[str] = None
    type: Optional[str] = None
    platform: Optional[str] = None
    pipeline_id: Optional[str] = None
    stage: Optional[str] = None
    link: Optional[str] = None
    notes: Optional[str] = None


class PortfolioCreate(BaseModel):
    title: str
    description: str = ""
    type: str = "Code"           # Code | Research | Video | Design | Tool | Writing | Other
    link: str = ""
    image: str = ""
    tags: list[str] = []


class PortfolioUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    type: Optional[str] = None
    link: Optional[str] = None
    image: Optional[str] = None
    tags: Optional[list[str]] = None


class ContactCreate(BaseModel):
    name: str
    role: str = ""               # e.g. "AI YouTuber", "UKAEA researcher"
    platform: str = ""
    link: str = ""
    notes: str = ""
    avatar: str = ""


class ContactUpdate(BaseModel):
    name: Optional[str] = None
    role: Optional[str] = None
    platform: Optional[str] = None
    link: Optional[str] = None
    notes: Optional[str] = None
    avatar: Optional[str] = None


class StoryPanelCreate(BaseModel):
    """One storyboard panel: the PLAN for a shot, never the shot itself.
    `image` is a URL string — either external, or /api/images/<id>/file for one
    uploaded through the Mainframe image service. Video files are never stored."""

    caption: str = ""
    dialog: str = ""
    duration: str = ""           # rough timing, e.g. "0:00-0:15"
    notes: str = ""              # camera angle, b-roll, effects
    image: str = ""


class StoryPanelUpdate(BaseModel):
    caption: Optional[str] = None
    dialog: Optional[str] = None
    duration: Optional[str] = None
    notes: Optional[str] = None
    image: Optional[str] = None


class PanelReorder(BaseModel):
    panel_ids: list[str]


class ThumbnailOptionCreate(BaseModel):
    image: str = ""
    style: str = ""              # e.g. "minimal text", "face close-up"
    notes: str = ""


class ThumbnailOptionUpdate(BaseModel):
    image: Optional[str] = None
    style: Optional[str] = None
    notes: Optional[str] = None
    chosen: Optional[bool] = None


PromptStatus = Literal["draft", "approved", "rejected", "edited"]


class PromptEntryCreate(BaseModel):
    """One LLM prompt/response pair. MANUAL — the user pastes both in; nothing
    here calls a model API (spec is explicit).

    `model_config extra="allow"` deliberately leaves room for the spec's FUTURE
    input_tokens / output_tokens / cost / energy fields without a migration.
    """

    model_config = {"extra": "allow"}
    llm: str                             # e.g. "Claude Opus", "GPT-4o"
    prompt: str
    response: str = ""
    variation: str = ""                  # how this differed from other attempts
    status: PromptStatus = "draft"
    notes: str = ""


class PromptEntryUpdate(BaseModel):
    model_config = {"extra": "allow"}
    llm: Optional[str] = None
    prompt: Optional[str] = None
    response: Optional[str] = None
    variation: Optional[str] = None
    status: Optional[str] = None
    notes: Optional[str] = None


class ImageUpdate(BaseModel):
    """Rename only — the file itself is immutable once uploaded."""

    name: Optional[str] = None


class ReorderRequest(BaseModel):
    """Manual card ordering: the listed ids take the positions those same nodes
    currently occupy, reassigned in the order given. Sending just two ids is a
    swap; sending the whole list is a full reorder. Untouched nodes keep their
    slots, so reordering inside a filtered view is safe."""

    ids: list[str]


# --------------------------------------------------------------------------- #
# Projects — files uploaded or linked, each with a note (Mainframe-level)
# --------------------------------------------------------------------------- #
class ProjectCreate(BaseModel):
    name: str
    note: str = ""


class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    note: Optional[str] = None
    # "add to the contributions" — when true, working on this project puts a
    # border on that day's square in the grid.
    contributes: Optional[bool] = None
    status: Optional[str] = None
    repo: Optional[str] = None


class ProjectLinkCreate(BaseModel):
    """Register a file/repo the user already owns (not uploaded)."""
    name: str
    url: Optional[str] = None     # external URL
    path: Optional[str] = None    # local filesystem path
    note: str = ""


class ProjectPush(BaseModel):
    """Mark that the project was pushed — puts a ★ on that day's square."""
    date: Optional[str] = None    # YYYY-MM-DD; defaults to today
    note: str = ""
    mins: int = 0                 # optional time attached to the push


class HeatCellUpdate(BaseModel):
    date: str            # "YYYY-MM-DD"
    color: Optional[str] = None  # hex; empty/None clears the override


# --------------------------------------------------------------------------- #
# Work sessions — the Mainframe-level "database" row.
#
# One row = one block of work. Every module pushes into the same shape, and the
# same rows drive the contribution grid (time worked → colour, a contributing
# project → border, a push → star). Every field is present on every session;
# anything that doesn't apply to a given row is masked with 0 / "" / "none"
# rather than being absent, so the table stays one uniform grid.
# --------------------------------------------------------------------------- #
WorkModule = Literal["synapse", "pulse", "vision", "vault", "mainframe"]
# What a work session was ON. Deliberately a plain string, not a Literal: the
# kinds are user-extensible (:WorkKind nodes) — "book", "client", whatever you
# work on — and a closed enum would reject a kind you'd just created.
RefKind = str
FocusKind = Literal["active", "passive", "none"]


class WorkSessionCreate(BaseModel):
    date: Optional[str] = None        # YYYY-MM-DD; defaults to today
    start: str = ""                   # "HH:MM" — blank when not tracked
    end: str = ""                     # "HH:MM"
    mins: int = 0                     # duration; 0 = not recorded
    module: WorkModule = "synapse"
    ref_kind: RefKind = "other"
    ref_id: Optional[str] = None
    ref_title: str = ""
    what: str = ""                    # what I did
    focus: FocusKind = "none"         # active learning / passive / n-a
    distraction_mins: int = 0         # legacy: still accepted, no longer shown
    distraction: str = ""             # (the workspace logs distractions properly)
    notes: str = ""
    # Marks the row as a finished piece of work — set by hand from the table.
    # `pushed` is the old name for the same flag and is still accepted so
    # anything posting the old field keeps working.
    completed: bool = False
    pushed: bool = False


class WorkSessionUpdate(BaseModel):
    date: Optional[str] = None
    start: Optional[str] = None
    end: Optional[str] = None
    mins: Optional[int] = None
    module: Optional[WorkModule] = None
    ref_kind: Optional[RefKind] = None
    ref_id: Optional[str] = None
    ref_title: Optional[str] = None
    what: Optional[str] = None
    focus: Optional[FocusKind] = None
    distraction_mins: Optional[int] = None
    distraction: Optional[str] = None
    notes: Optional[str] = None
    completed: Optional[bool] = None
    pushed: Optional[bool] = None


class WorkKindCreate(BaseModel):
    """A user-defined kind of thing you work on — book, client, admin…"""
    name: str


# --------------------------------------------------------------------------- #
# Knowledge graph (triple layer)
# --------------------------------------------------------------------------- #
KGLayer = Literal["manual", "auto", "auto_edit"]


class KGNodeCreate(BaseModel):
    paper_id: Optional[str] = None
    name: str
    type: str = "concept"
    layer: KGLayer = "manual"
    x: Optional[float] = None
    y: Optional[float] = None


class KGNodeUpdate(BaseModel):
    name: Optional[str] = None
    type: Optional[str] = None
    x: Optional[float] = None
    y: Optional[float] = None
    edit_reason: Optional[str] = None


class KGEdgeCreate(BaseModel):
    source_id: str
    target_id: str
    label: str = "RELATES"
    layer: KGLayer = "manual"


# --------------------------------------------------------------------------- #
# Deep dive
# --------------------------------------------------------------------------- #
DeepDiveStatus = Literal["planned", "active", "completed"]


class DeepDiveCreate(BaseModel):
    topic: str
    info: str = ""


class DeepDiveUpdate(BaseModel):
    topic: Optional[str] = None
    info: Optional[str] = None
    sources_text: Optional[str] = None


class DeepDiveSourceCreate(BaseModel):
    title: str
    link: Optional[str] = None


# --------------------------------------------------------------------------- #
# Ideas (spreadsheet-like; extra columns allowed)
# --------------------------------------------------------------------------- #
class IdeaCreate(BaseModel):
    model_config = {"extra": "allow"}  # user-defined custom columns
    title: str = ""
    description: str = ""
    category: str = "research"
    priority: Literal["low", "medium", "high"] = "medium"
    status: Literal["raw", "exploring", "in-progress", "done", "parked"] = "raw"
    paper_id: Optional[str] = None
    notes: str = ""


class IdeaCategoryUpsert(BaseModel):
    """A kind of idea and the colour that marks it. Kinds are user-extensible —
    the colour lives on the kind, so every idea of that kind reads the same."""
    name: str
    color: str = "#7FA8C8"


class IdeaUpdate(BaseModel):
    model_config = {"extra": "allow"}
    title: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    priority: Optional[str] = None
    status: Optional[str] = None
    paper_id: Optional[str] = None
    notes: Optional[str] = None


# --------------------------------------------------------------------------- #
# Custom headers / sections
# --------------------------------------------------------------------------- #
class HeaderCreate(BaseModel):
    name: str
    description: Optional[str] = None
    order: int = 0
    paper_id: Optional[str] = None
    content: str = ""


class HeaderUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    order: Optional[int] = None
    content: Optional[str] = None


# --------------------------------------------------------------------------- #
# Raw Cypher (power user)
# --------------------------------------------------------------------------- #
class CypherQuery(BaseModel):
    cypher: str
    params: dict[str, Any] = {}


# --------------------------------------------------------------------------- #
# PULSE module — habits, experiments, routines, medical, medications
# --------------------------------------------------------------------------- #
HabitFrequency = Literal["daily", "weekdays", "3x-week", "weekly", "custom"]


# Scheduling shared by habits and routines, so a calendar module can read
# either one without knowing which it is. days_of_week: 0=Mon … 6=Sun.
class Schedulable(BaseModel):
    days_of_week: Optional[list[int]] = None
    time_of_day: Optional[str] = None      # "HH:MM"
    duration_mins: Optional[int] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None


class HabitCreate(BaseModel):
    name: str
    category: str
    frequency: HabitFrequency = "daily"
    target: Optional[str] = None
    tags: list[str] = []
    main_notes: str = ""
    days_of_week: list[int] = []
    time_of_day: str = ""
    duration_mins: int = 0


class HabitUpdate(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None
    frequency: Optional[HabitFrequency] = None
    target: Optional[str] = None
    tags: Optional[list[str]] = None
    main_notes: Optional[str] = None
    active: Optional[bool] = None
    days_of_week: Optional[list[int]] = None
    time_of_day: Optional[str] = None
    duration_mins: Optional[int] = None


class SubHabitCreate(BaseModel):
    name: str


class HabitNoteCreate(BaseModel):
    text: str
    date: Optional[str] = None


class HabitLogCreate(BaseModel):
    date: str                        # the day being logged (user-set)
    level: int = Field(0, ge=0, le=4)
    time_spent: str = ""
    notes: str = ""
    feel: str = ""
    connections: str = ""            # links to other Mainframe modules


# An experiment runs for a set span. `unit` is what you typed; `days` is always
# the resolved total, so everything downstream counts in days.
DurationUnit = Literal["days", "weeks"]


class ExperimentCreate(BaseModel):
    name: str
    days: int = Field(..., ge=1)
    unit: DurationUnit = "days"
    start_date: str
    hypothesis: str = ""


class ExperimentUpdate(BaseModel):
    name: Optional[str] = None
    days: Optional[int] = None
    unit: Optional[DurationUnit] = None
    start_date: Optional[str] = None
    hypothesis: Optional[str] = None
    conclusion: Optional[str] = None
    status: Optional[Literal["active", "completed"]] = None
    days_done: Optional[list[int]] = None   # legacy toggle; day journals supersede it


class ExperimentDayUpdate(BaseModel):
    """One day of an experiment — a journal entry, not a checkbox."""
    notes: str = ""
    what_happened: str = ""
    adherence: Optional[int] = Field(None, ge=0, le=4)   # 0 missed → 4 nailed it
    feel: str = ""
    done: Optional[bool] = None


RoutineUnit = Literal["days", "weeks", "months", "ongoing"]


class RoutineCreate(BaseModel):
    name: str
    duration: Optional[int] = None
    unit: RoutineUnit = "ongoing"
    category: str = "other"
    main_notes: str = ""
    days_of_week: list[int] = []
    time_of_day: str = ""
    duration_mins: int = 0
    start_date: Optional[str] = None


class RoutineUpdate(BaseModel):
    name: Optional[str] = None
    duration: Optional[int] = None
    unit: Optional[RoutineUnit] = None
    category: Optional[str] = None
    main_notes: Optional[str] = None
    status: Optional[Literal["active", "completed", "paused"]] = None
    days_of_week: Optional[list[int]] = None
    time_of_day: Optional[str] = None
    duration_mins: Optional[int] = None
    start_date: Optional[str] = None


class RoutineStepCreate(BaseModel):
    name: str


class StepLogCreate(BaseModel):
    date: Optional[str] = None       # pre-filled today client-side
    time: str = ""
    note: str = ""


class RoutineNoteCreate(BaseModel):
    text: str


class MedicalEntryCreate(BaseModel):
    title: str
    date: str
    details: str = ""
    severity: str = ""               # mild|moderate|severe|active|resolved|chronic|monitoring|""
    tags: list[str] = []
    notes: str = ""
    links: str = ""


class MedicalEntryUpdate(BaseModel):
    title: Optional[str] = None
    date: Optional[str] = None
    details: Optional[str] = None
    severity: Optional[str] = None
    tags: Optional[list[str]] = None
    notes: Optional[str] = None
    links: Optional[str] = None


class MedEntryCreate(BaseModel):
    name: str
    date: str
    details: str = ""
    dose: str = ""
    frequency: str = ""
    status: str = ""                 # active|paused|stopped|as-needed|effective|ineffective|side-effects|""
    notes: str = ""
    tags: list[str] = []


class MedEntryUpdate(BaseModel):
    name: Optional[str] = None
    date: Optional[str] = None
    details: Optional[str] = None
    dose: Optional[str] = None
    frequency: Optional[str] = None
    status: Optional[str] = None
    notes: Optional[str] = None
    tags: Optional[list[str]] = None


# --------------------------------------------------------------------------- #
# PULSE FITNESS sub-module
# --------------------------------------------------------------------------- #
WorkoutType = Literal["Push", "Pull", "Legs", "Upper", "Lower", "Full Body", "Cardio", "HIIT", "Sport", "Other"]
Interrupted = Literal["no", "yes — pain", "yes — time", "yes — fatigue"]
CyclePhase = Literal["Hypertrophy", "Strength", "Power", "Endurance", "Deload", "Cut", "Bulk", "Maintenance", "Rehab"]
BodyStateKind = Literal["", "pain", "imbalance", "tight"]


class ExerciseIn(BaseModel):
    name: str
    detail: str = ""


class WorkoutCreate(BaseModel):
    date: str
    type: WorkoutType = "Other"
    duration: int = 0
    intensity: int = Field(5, ge=1, le=10)
    interrupted: Interrupted = "no"
    notes: str = ""
    exercises: list[ExerciseIn] = []
    cycle_id: Optional[str] = None


class WorkoutUpdate(BaseModel):
    date: Optional[str] = None
    type: Optional[WorkoutType] = None
    duration: Optional[int] = None
    intensity: Optional[int] = Field(None, ge=1, le=10)
    interrupted: Optional[Interrupted] = None
    notes: Optional[str] = None


class CycleCreate(BaseModel):
    name: str
    weeks: int = Field(..., ge=1)
    start_date: str
    phase: CyclePhase = "Hypertrophy"
    goals: str = ""
    notes: str = ""


class CycleUpdate(BaseModel):
    name: Optional[str] = None
    weeks: Optional[int] = None
    phase: Optional[CyclePhase] = None
    goals: Optional[str] = None
    notes: Optional[str] = None
    status: Optional[Literal["active", "completed"]] = None
    weeks_done: Optional[list[int]] = None


class GoalCreate(BaseModel):
    text: str
    current: str = ""
    target: str = ""


class GoalUpdate(BaseModel):
    text: Optional[str] = None
    current: Optional[str] = None
    target: Optional[str] = None


class ActivityLogCreate(BaseModel):
    model_config = {"extra": "allow"}   # metric fields vary with what's tracked
    date: str
    notes: str = ""


class StretchCreate(BaseModel):
    date: str
    duration: int = 0
    stretches: list[str] = []
    focus: str = ""
    notes: str = ""


class RecoveryTypeCreate(BaseModel):
    name: str
    icon: str = ""


class RecoverySessionCreate(BaseModel):
    date: str
    type_id: str
    duration: int = 0
    feel: str = ""
    notes: str = ""


class BodyStateUpdate(BaseModel):
    state: BodyStateKind = ""


class BodyNoteCreate(BaseModel):
    text: str


class BodyDayUpdate(BaseModel):
    date: str
    state: BodyStateKind = ""


class BodyDayNoteUpdate(BaseModel):
    date: str
    text: str = ""


# --------------------------------------------------------------------------- #
# Nutrition — Pulse top-level (food DB, diary, targets, intolerances, supps)
# --------------------------------------------------------------------------- #
# NUTRITION_SPEC: nutrition is stated PER SERVING, not per 100g. A serving is
# whatever you actually eat — a slice, a scoop, 150g — so logging is "one of
# those" rather than arithmetic. Only name, serving and the four macros are
# required; every micronutrient is optional (spec's explicit DO-NOT).
SERVING_UNITS = ["g", "ml", "piece", "slice", "cup", "tbsp", "tsp", "scoop", "bowl", "can", "bottle"]

FOOD_CATEGORIES = [
    "protein", "grains", "vegetables", "fruit", "dairy", "nuts_seeds",
    "oils_fats", "bread_bakery", "drinks", "snacks", "condiments",
    "prepared_meals", "other",
]

MEAL_SLOTS = ["breakfast", "lunch", "dinner", "snacks", "pre_workout", "post_workout"]


class FoodCreate(BaseModel):
    model_config = {"extra": "allow"}   # optional micros arrive as extra fields
    name: str
    brand: str = ""
    category: str = "other"
    serving_size: float = 100
    serving_unit: str = "g"
    calories: float = 0
    protein: float = 0
    carbs: float = 0
    fat: float = 0
    # everything below is optional — never demanded when creating a food
    fibre: Optional[float] = None
    sugar: Optional[float] = None
    saturated_fat: Optional[float] = None
    sodium: Optional[float] = None
    potassium: Optional[float] = None
    cholesterol: Optional[float] = None
    vitamin_a: Optional[float] = None
    vitamin_c: Optional[float] = None
    calcium: Optional[float] = None
    iron: Optional[float] = None
    barcode: str = ""      # reserved for a future scanner; no scanner is built
    verified: bool = False


class CalEventCreate(BaseModel):
    """A block of time. Deliberately mirrors :WorkSession's shape — a separate
    `date` plus `HH:MM` start/end — so the whole app agrees on what a time is,
    and the existing date/time input helpers work unchanged."""
    model_config = {"extra": "allow"}
    title: str
    date: str                              # YYYY-MM-DD, the day it starts
    start: str = ""                        # HH:MM, empty for an all-day event
    end: str = ""
    end_date: str = ""                     # set only for multi-day events
    all_day: bool = False
    location: str = ""
    notes: str = ""
    kind: str = "event"                    # event | block | reminder
    module: str = ""                       # which module it belongs to, if any
    task_id: Optional[str] = None          # planning a task into a slot
    colour: str = ""


class CalEventUpdate(BaseModel):
    model_config = {"extra": "allow"}
    title: Optional[str] = None
    date: Optional[str] = None
    start: Optional[str] = None
    end: Optional[str] = None
    end_date: Optional[str] = None
    all_day: Optional[bool] = None
    location: Optional[str] = None
    notes: Optional[str] = None
    kind: Optional[str] = None
    module: Optional[str] = None
    task_id: Optional[str] = None
    colour: Optional[str] = None


class CatalogAdopt(BaseModel):
    """Copy a USDA catalogue food into the personal library at a chosen portion.

    `serving_g` is the bridge between USDA's per-100g data and the spec's
    per-serving library; `serving_label` is what you'll actually read on the
    card ("1 cup", "1 medium banana").
    """
    serving_g: float
    serving_label: str = ""
    name: str = ""            # override the USDA description if it's unwieldy


class FoodUpdate(BaseModel):
    model_config = {"extra": "allow"}
    name: Optional[str] = None
    brand: Optional[str] = None
    category: Optional[str] = None
    serving_size: Optional[float] = None
    serving_unit: Optional[str] = None
    calories: Optional[float] = None
    protein: Optional[float] = None
    carbs: Optional[float] = None
    fat: Optional[float] = None
    verified: Optional[bool] = None
    favourite: Optional[bool] = None


class FoodEntryCreate(BaseModel):
    """One food eaten. `food_id` is optional so a quick-add needs no library entry."""
    date: Optional[str] = None          # defaults to today
    meal_slot: str = "snacks"
    food_id: Optional[str] = None
    food_name: str = ""
    serving_size: float = 1
    serving_unit: str = "serving"
    calories: float = 0
    protein: float = 0
    carbs: float = 0
    fat: float = 0
    fibre: Optional[float] = None
    sugar: Optional[float] = None
    sodium: Optional[float] = None
    notes: str = ""
    time: str = ""


class FoodEntryUpdate(BaseModel):
    meal_slot: Optional[str] = None
    serving_size: Optional[float] = None
    serving_unit: Optional[str] = None
    calories: Optional[float] = None
    protein: Optional[float] = None
    carbs: Optional[float] = None
    fat: Optional[float] = None
    notes: Optional[str] = None
    time: Optional[str] = None
    date: Optional[str] = None


class BulkPasteRequest(BaseModel):
    """Lines like: `Chicken breast, 150g, 248 cal, 46g protein, 0g carbs, 5g fat`."""
    text: str
    date: Optional[str] = None
    meal_slot: str = "snacks"
    dry_run: bool = False


class CopyMealsRequest(BaseModel):
    from_date: str
    to_date: Optional[str] = None       # defaults to today
    meal_slot: Optional[str] = None     # None = the whole day


class RecipeIngredientIn(BaseModel):
    food_id: Optional[str] = None
    food_name: str
    serving_size: float = 1
    serving_unit: str = "serving"
    calories: float = 0
    protein: float = 0
    carbs: float = 0
    fat: float = 0


class RecipeCreate(BaseModel):
    name: str
    servings: int = 1
    ingredients: list[RecipeIngredientIn] = []
    instructions: str = ""
    prep_time: Optional[int] = None
    cook_time: Optional[int] = None
    category: str = "other"


class RecipeUpdate(BaseModel):
    name: Optional[str] = None
    servings: Optional[int] = None
    ingredients: Optional[list[RecipeIngredientIn]] = None
    instructions: Optional[str] = None
    prep_time: Optional[int] = None
    cook_time: Optional[int] = None
    category: Optional[str] = None


class WaterCreate(BaseModel):
    date: Optional[str] = None
    amount: float                        # ml
    time: str = ""


class WeightCreate(BaseModel):
    date: Optional[str] = None
    weight: float                        # kg
    notes: str = ""


class BodyMeasurementCreate(BaseModel):
    model_config = {"extra": "allow"}
    date: Optional[str] = None
    chest: Optional[float] = None
    waist: Optional[float] = None
    hips: Optional[float] = None
    left_arm: Optional[float] = None
    right_arm: Optional[float] = None
    left_thigh: Optional[float] = None
    right_thigh: Optional[float] = None
    left_calf: Optional[float] = None
    right_calf: Optional[float] = None
    neck: Optional[float] = None
    shoulders: Optional[float] = None
    body_fat: Optional[float] = None
    notes: str = ""


class FastingStart(BaseModel):
    target_hours: float = 16
    start_time: Optional[str] = None     # defaults to now
    notes: str = ""


class FastingEnd(BaseModel):
    end_time: Optional[str] = None       # defaults to now
    notes: Optional[str] = None


class NutritionGoalsUpdate(BaseModel):
    daily_calories: Optional[int] = None
    protein_g: Optional[int] = None
    carbs_g: Optional[int] = None
    fat_g: Optional[int] = None
    fibre_g: Optional[int] = None
    water_ml: Optional[int] = None
    weight_target: Optional[float] = None
    weight_goal: Optional[str] = None    # lose | gain | maintain
    fasting_protocol: Optional[str] = None
    macro_mode: Optional[str] = None     # grams | percentage
    height_cm: Optional[float] = None    # for BMI / waist-to-height


class TargetUpdate(BaseModel):
    calories: Optional[float] = None
    protein: Optional[float] = None
    carbs: Optional[float] = None
    fat: Optional[float] = None
    sugar: Optional[float] = None
    fibre: Optional[float] = None
    salt: Optional[float] = None


class IntoleranceCreate(BaseModel):
    name: str
    severity: str = ""
    notes: str = ""


class SupplementCreate(BaseModel):
    name: str
    dose: str = ""
    timing: str = ""
    notes: str = ""


class ActivityConfigUpdate(BaseModel):
    tracked: list[str] = []


# --------------------------------------------------------------------------- #
# Benchmarks (periodic health/fitness assessments) — Pulse Fitness
# --------------------------------------------------------------------------- #
class BaselineUpdate(BaseModel):
    # extra="allow" lets the baseline also carry current metric readings as
    # mv_<metric_key> fields (e.g. mv_glucose) alongside the fixed fields below.
    model_config = {"extra": "allow"}
    age: Optional[str] = None
    height: Optional[str] = None
    weight: Optional[str] = None
    body_fat: Optional[str] = None
    resting_hr: Optional[str] = None
    goals: Optional[str] = None
    notes: Optional[str] = None


class MetricConfigUpdate(BaseModel):
    tracked: Optional[bool] = None
    name: Optional[str] = None
    unit: Optional[str] = None
    higher_is_better: Optional[bool] = None


class CustomMetricCreate(BaseModel):
    name: str
    unit: str = ""
    higher_is_better: bool = True
    category: str = "custom"


class AssessmentCreate(BaseModel):
    date: str
    label: str = ""
    type: Literal["fitness", "blood", "combined"] = "combined"
    notes: str = ""
    values: dict[str, Any] = {}   # {metric_key: {value, notes}}
    baseline: Optional[dict[str, Any]] = None   # frozen baseline fields; None = capture current


class SnapshotQuick(BaseModel):
    """One-click 'save current baseline as a snapshot'."""
    date: Optional[str] = None
    label: str = ""
    notes: str = ""


class ScheduleUpdate(BaseModel):
    frequency: Literal["monthly", "quarterly", "6-monthly", "yearly"] = "quarterly"


class ScanRequest(BaseModel):
    """Paste paper text; get back candidate terms by frequency.

    Deliberately NOT LLM-powered — the spec says the prototype uses the
    frequency algorithm, with LLM extraction as a future enhancement.
    """

    text: str
    limit: int = 80


class BulkAddTerms(BaseModel):
    """Create stub terms from the scanner: name + familiarity 0, nothing else.
    The user fills in ELI5s afterwards."""

    terms: list[str]


class HomePrefsUpdate(BaseModel):
    """Home-screen settings as an opaque blob — background choice, dim level,
    particles on/off, module card art. The frontend owns the shape so a new
    setting never needs a backend change."""

    data: dict[str, Any] = {}


# --------------------------------------------------------------------------- #
# Cardio — kept separate from strength workouts: the metrics that matter are
# distance/pace/heart rate, not sets and reps.
# --------------------------------------------------------------------------- #
CardioType = Literal["run", "walk", "cycle", "swim", "row", "hike", "other"]


class CardioCreate(BaseModel):
    date: str
    type: CardioType = "run"
    distance_km: float = 0.0
    duration_mins: int = 0
    avg_hr: Optional[int] = None
    max_hr: Optional[int] = None
    # minutes spent in each heart-rate zone; index 0 = Z1 … 4 = Z5
    zones: list[int] = [0, 0, 0, 0, 0]
    perceived_effort: Optional[int] = Field(None, ge=1, le=10)
    route: str = ""
    notes: str = ""


class CardioUpdate(BaseModel):
    date: Optional[str] = None
    type: Optional[CardioType] = None
    distance_km: Optional[float] = None
    duration_mins: Optional[int] = None
    avg_hr: Optional[int] = None
    max_hr: Optional[int] = None
    zones: Optional[list[int]] = None
    perceived_effort: Optional[int] = Field(None, ge=1, le=10)
    route: Optional[str] = None
    notes: Optional[str] = None


# --------------------------------------------------------------------------- #
# Fitness baseline test — the reference point every later Benchmark compares to
# --------------------------------------------------------------------------- #
class FitnessBaselineSet(BaseModel):
    """Starting measurements + performance metrics, taken once and frozen.

    `is_reference` marks the row Benchmark assessments measure against. Exactly
    one baseline is the reference at a time.
    """
    date: Optional[str] = None
    # measurements
    weight_kg: Optional[float] = None
    height_cm: Optional[float] = None
    body_fat_pct: Optional[float] = None
    resting_hr: Optional[int] = None
    waist_cm: Optional[float] = None
    chest_cm: Optional[float] = None
    arm_cm: Optional[float] = None
    thigh_cm: Optional[float] = None
    # performance
    push_ups: Optional[int] = None
    pull_ups: Optional[int] = None
    squat_kg: Optional[float] = None
    bench_kg: Optional[float] = None
    deadlift_kg: Optional[float] = None
    plank_secs: Optional[int] = None
    run_5k_mins: Optional[float] = None
    vo2max: Optional[float] = None
    notes: str = ""
