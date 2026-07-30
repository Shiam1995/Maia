"""Neo4j connection layer + schema bootstrap.

All persistent data lives in Neo4j (per the spec — no SQLite, no JSON store).
This module owns a single async driver, exposes small read/write helpers, and
creates the constraints/indexes the app relies on.

Cypher is written inline in the route modules; these helpers just execute it.
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import Any

from neo4j import AsyncDriver, AsyncGraphDatabase

from config import settings

log = logging.getLogger("synapse.db")

_driver: AsyncDriver | None = None


def get_driver() -> AsyncDriver:
    """Return the process-wide async driver (created lazily)."""
    global _driver
    if _driver is None:
        _driver = AsyncGraphDatabase.driver(
            settings.neo4j_uri,
            auth=(settings.neo4j_user, settings.neo4j_password),
        )
    return _driver


async def close_driver() -> None:
    global _driver
    if _driver is not None:
        await _driver.close()
        _driver = None


async def run_write(cypher: str, **params: Any) -> list[dict]:
    """Run a write query in a managed transaction; return rows as dicts."""
    driver = get_driver()
    async with driver.session(database=settings.neo4j_database) as session:
        result = await session.run(cypher, **params)
        return [record.data() async for record in result]


async def run_read(cypher: str, **params: Any) -> list[dict]:
    """Run a read query; return rows as dicts."""
    driver = get_driver()
    async with driver.session(database=settings.neo4j_database) as session:
        result = await session.run(cypher, **params)
        return [record.data() async for record in result]


# Constraints (uniqueness) and indexes. IF NOT EXISTS makes this idempotent, so
# it's safe to run on every startup.
_SCHEMA_STATEMENTS: list[str] = [
    "CREATE CONSTRAINT paper_id IF NOT EXISTS FOR (p:Paper) REQUIRE p.id IS UNIQUE",
    "CREATE CONSTRAINT instance_id IF NOT EXISTS FOR (i:Instance) REQUIRE i.id IS UNIQUE",
    "CREATE CONSTRAINT highlight_id IF NOT EXISTS FOR (h:Highlight) REQUIRE h.id IS UNIQUE",
    "CREATE CONSTRAINT concept_id IF NOT EXISTS FOR (c:Concept) REQUIRE c.id IS UNIQUE",
    # Concepts are MERGEd by name (terms.py) and shared across papers — that's
    # what makes the KG ring indicators work. Without this, a race could leave
    # two nodes of the same name and split a concept's encounters in half.
    "CREATE CONSTRAINT concept_name IF NOT EXISTS FOR (c:Concept) REQUIRE c.name IS UNIQUE",
    "CREATE CONSTRAINT question_id IF NOT EXISTS FOR (q:Question) REQUIRE q.id IS UNIQUE",
    "CREATE CONSTRAINT task_id IF NOT EXISTS FOR (t:Task) REQUIRE t.id IS UNIQUE",
    "CREATE CONSTRAINT entry_id IF NOT EXISTS FOR (e:TaskEntry) REQUIRE e.id IS UNIQUE",
    "CREATE CONSTRAINT author_name IF NOT EXISTS FOR (a:Author) REQUIRE a.name IS UNIQUE",
    "CREATE CONSTRAINT venue_name IF NOT EXISTS FOR (v:Venue) REQUIRE v.name IS UNIQUE",
    "CREATE CONSTRAINT deepdive_id IF NOT EXISTS FOR (d:DeepDive) REQUIRE d.id IS UNIQUE",
    "CREATE CONSTRAINT idea_id IF NOT EXISTS FOR (i:Idea) REQUIRE i.id IS UNIQUE",
    "CREATE CONSTRAINT header_id IF NOT EXISTS FOR (h:CustomHeader) REQUIRE h.id IS UNIQUE",
    "CREATE CONSTRAINT kgnode_id IF NOT EXISTS FOR (n:KGNode) REQUIRE n.id IS UNIQUE",
    "CREATE CONSTRAINT reference_id IF NOT EXISTS FOR (r:Reference) REQUIRE r.id IS UNIQUE",
    "CREATE CONSTRAINT minddump_id IF NOT EXISTS FOR (m:MindDump) REQUIRE m.id IS UNIQUE",
    "CREATE CONSTRAINT refnode_id IF NOT EXISTS FOR (n:RefNode) REQUIRE n.id IS UNIQUE",
    "CREATE CONSTRAINT project_id IF NOT EXISTS FOR (p:Project) REQUIRE p.id IS UNIQUE",
    "CREATE CONSTRAINT projectfile_id IF NOT EXISTS FOR (f:ProjectFile) REQUIRE f.id IS UNIQUE",
    "CREATE CONSTRAINT ddsource_id IF NOT EXISTS FOR (s:DeepDiveSource) REQUIRE s.id IS UNIQUE",
    "CREATE CONSTRAINT heatcell_date IF NOT EXISTS FOR (c:HeatCell) REQUIRE c.date IS UNIQUE",
    "CREATE CONSTRAINT worksession_id IF NOT EXISTS FOR (w:WorkSession) REQUIRE w.id IS UNIQUE",
    "CREATE INDEX worksession_date IF NOT EXISTS FOR (w:WorkSession) ON (w.date)",
    "CREATE CONSTRAINT ideacategory_name IF NOT EXISTS FOR (c:IdeaCategory) REQUIRE c.name IS UNIQUE",
    # Learning Opportunities (Mainframe-level service)
    "CREATE CONSTRAINT learnop_id IF NOT EXISTS FOR (l:LearningOpportunity) REQUIRE l.id IS UNIQUE",
    "CREATE CONSTRAINT learnnote_id IF NOT EXISTS FOR (n:LearningNote) REQUIRE n.id IS UNIQUE",
    "CREATE INDEX learnop_kind IF NOT EXISTS FOR (l:LearningOpportunity) ON (l.kind)",
    # Decomposition module (DECOMPOSITION_SPEC)
    "CREATE CONSTRAINT op_id IF NOT EXISTS FOR (o:Op) REQUIRE o.id IS UNIQUE",
    "CREATE CONSTRAINT snap_id IF NOT EXISTS FOR (s:Snapshot) REQUIRE s.id IS UNIQUE",
    "CREATE CONSTRAINT arch_id IF NOT EXISTS FOR (a:Architecture) REQUIRE a.id IS UNIQUE",
    "CREATE INDEX op_tag IF NOT EXISTS FOR (o:Op) ON (o.tag)",
    "CREATE FULLTEXT INDEX op_text IF NOT EXISTS FOR (o:Op) ON EACH [o.label, o.summary, o.notes]",
    # Pulse module
    "CREATE CONSTRAINT habit_id IF NOT EXISTS FOR (h:Habit) REQUIRE h.id IS UNIQUE",
    "CREATE CONSTRAINT subhabit_id IF NOT EXISTS FOR (s:SubHabit) REQUIRE s.id IS UNIQUE",
    "CREATE CONSTRAINT habitnote_id IF NOT EXISTS FOR (n:HabitNote) REQUIRE n.id IS UNIQUE",
    "CREATE CONSTRAINT habitlog_id IF NOT EXISTS FOR (l:HabitLog) REQUIRE l.id IS UNIQUE",
    "CREATE CONSTRAINT exp_id IF NOT EXISTS FOR (e:Experiment) REQUIRE e.id IS UNIQUE",
    "CREATE CONSTRAINT routine_id IF NOT EXISTS FOR (r:Routine) REQUIRE r.id IS UNIQUE",
    "CREATE CONSTRAINT routinestep_id IF NOT EXISTS FOR (s:RoutineStep) REQUIRE s.id IS UNIQUE",
    "CREATE CONSTRAINT steplog_id IF NOT EXISTS FOR (l:StepLog) REQUIRE l.id IS UNIQUE",
    "CREATE CONSTRAINT routinenote_id IF NOT EXISTS FOR (n:RoutineNote) REQUIRE n.id IS UNIQUE",
    "CREATE CONSTRAINT medentry_id IF NOT EXISTS FOR (m:MedicalEntry) REQUIRE m.id IS UNIQUE",
    "CREATE CONSTRAINT medmed_id IF NOT EXISTS FOR (m:MedEntry) REQUIRE m.id IS UNIQUE",
    "CREATE INDEX habit_cat IF NOT EXISTS FOR (h:Habit) ON (h.category)",
    "CREATE INDEX medentry_section IF NOT EXISTS FOR (m:MedicalEntry) ON (m.section)",
    "CREATE INDEX medmed_section IF NOT EXISTS FOR (m:MedEntry) ON (m.section)",
    # Pulse Fitness sub-module
    "CREATE CONSTRAINT workout_id IF NOT EXISTS FOR (w:Workout) REQUIRE w.id IS UNIQUE",
    "CREATE CONSTRAINT exercise_id IF NOT EXISTS FOR (e:Exercise) REQUIRE e.id IS UNIQUE",
    "CREATE CONSTRAINT cycle_id IF NOT EXISTS FOR (c:Cycle) REQUIRE c.id IS UNIQUE",
    "CREATE CONSTRAINT goal_id IF NOT EXISTS FOR (g:Goal) REQUIRE g.id IS UNIQUE",
    "CREATE CONSTRAINT actlog_id IF NOT EXISTS FOR (a:ActivityLog) REQUIRE a.id IS UNIQUE",
    "CREATE CONSTRAINT stretch_id IF NOT EXISTS FOR (s:StretchSession) REQUIRE s.id IS UNIQUE",
    "CREATE CONSTRAINT bodystate_region IF NOT EXISTS FOR (b:BodyState) REQUIRE b.region IS UNIQUE",
    "CREATE CONSTRAINT bodynote_id IF NOT EXISTS FOR (n:BodyNote) REQUIRE n.id IS UNIQUE",
    "CREATE INDEX workout_date IF NOT EXISTS FOR (w:Workout) ON (w.date)",
    "CREATE INDEX workout_type IF NOT EXISTS FOR (w:Workout) ON (w.type)",
    # Benchmarks
    "CREATE CONSTRAINT assessment_id IF NOT EXISTS FOR (a:Assessment) REQUIRE a.id IS UNIQUE",
    "CREATE CONSTRAINT metricval_id IF NOT EXISTS FOR (m:MetricValue) REQUIRE m.id IS UNIQUE",
    "CREATE CONSTRAINT benchmetric_key IF NOT EXISTS FOR (m:BenchmarkMetric) REQUIRE m.key IS UNIQUE",
    "CREATE INDEX assessment_date IF NOT EXISTS FOR (a:Assessment) ON (a.date)",
    # Nutrition
    "CREATE CONSTRAINT food_id IF NOT EXISTS FOR (f:Food) REQUIRE f.id IS UNIQUE",
    # NUTRITION_SPEC — food log, recipes, water, weight, body, fasting
    "CREATE CONSTRAINT foodentry_id IF NOT EXISTS FOR (f:FoodEntry) REQUIRE f.id IS UNIQUE",
    "CREATE CONSTRAINT recipe_id IF NOT EXISTS FOR (r:Recipe) REQUIRE r.id IS UNIQUE",
    "CREATE CONSTRAINT water_id IF NOT EXISTS FOR (w:WaterEntry) REQUIRE w.id IS UNIQUE",
    "CREATE CONSTRAINT weight_id IF NOT EXISTS FOR (w:WeightEntry) REQUIRE w.id IS UNIQUE",
    "CREATE CONSTRAINT bodymeas_id IF NOT EXISTS FOR (b:BodyMeasurement) REQUIRE b.id IS UNIQUE",
    "CREATE CONSTRAINT fasting_id IF NOT EXISTS FOR (f:FastingSession) REQUIRE f.id IS UNIQUE",
    "CREATE INDEX food_name IF NOT EXISTS FOR (f:Food) ON (f.name)",
    "CREATE INDEX food_category IF NOT EXISTS FOR (f:Food) ON (f.category)",
    "CREATE INDEX food_usecount IF NOT EXISTS FOR (f:Food) ON (f.use_count)",
    "CREATE INDEX foodentry_date IF NOT EXISTS FOR (f:FoodEntry) ON (f.date)",
    "CREATE INDEX weight_date IF NOT EXISTS FOR (w:WeightEntry) ON (w.date)",
    "CREATE CONSTRAINT foodlog_id IF NOT EXISTS FOR (l:FoodLog) REQUIRE l.id IS UNIQUE",
    "CREATE CONSTRAINT intolerance_id IF NOT EXISTS FOR (i:Intolerance) REQUIRE i.id IS UNIQUE",
    "CREATE CONSTRAINT nsupp_id IF NOT EXISTS FOR (s:Supplement) REQUIRE s.id IS UNIQUE",
    "CREATE INDEX foodlog_date IF NOT EXISTS FOR (l:FoodLog) ON (l.date)",
    # Food catalogue — the imported USDA reference table (see foodcatalog.py).
    # Deliberately NOT :Food: your personal library still starts empty and stays
    # small, and 13k reference rows must never appear in "my foods".
    "CREATE CONSTRAINT catalogfood_fdc IF NOT EXISTS FOR (c:CatalogFood) REQUIRE c.fdc_id IS UNIQUE",
    "CREATE INDEX catalogfood_source IF NOT EXISTS FOR (c:CatalogFood) ON (c.source)",
    "CREATE INDEX catalogfood_search IF NOT EXISTS FOR (c:CatalogFood) ON (c.search_name)",
    # Full-text is what makes "chicken breast raw" find the right row out of
    # millions; the CONTAINS fallback in the route covers a missing index.
    # Brand is indexed too, so "tesco hobnobs" works on branded data.
    "CREATE FULLTEXT INDEX catalogfood_search_text IF NOT EXISTS FOR (c:CatalogFood) ON EACH [c.name, c.brand]",
    # Superseded by the index above (which indexed name only). DROP IF EXISTS is
    # a no-op after the first run; keeping it would hold a second copy of
    # millions of product names for nothing.
    "DROP INDEX catalogfood_text IF EXISTS",
    # Barcodes arrive with branded/Open Food Facts data — scanning a packet is
    # the point of having them.
    "CREATE INDEX catalogfood_barcode IF NOT EXISTS FOR (c:CatalogFood) ON (c.barcode)",
    "CREATE CONSTRAINT catalogmeta_id IF NOT EXISTS FOR (m:CatalogMeta) REQUIRE m.id IS UNIQUE",
    # Calendar — a Mainframe-level service, like tasks. Imported events use a
    # composite id (uid + occurrence date), which is what makes a re-import
    # update in place instead of duplicating every repeating event.
    "CREATE CONSTRAINT calevent_id IF NOT EXISTS FOR (e:CalEvent) REQUIRE e.id IS UNIQUE",
    "CREATE INDEX calevent_date IF NOT EXISTS FOR (e:CalEvent) ON (e.date)",
    "CREATE INDEX calevent_source IF NOT EXISTS FOR (e:CalEvent) ON (e.source)",
    # Recovery
    "CREATE CONSTRAINT rectype_id IF NOT EXISTS FOR (t:RecoveryType) REQUIRE t.id IS UNIQUE",
    "CREATE CONSTRAINT recsession_id IF NOT EXISTS FOR (s:RecoverySession) REQUIRE s.id IS UNIQUE",
    "CREATE INDEX recsession_date IF NOT EXISTS FOR (s:RecoverySession) ON (s.date)",
    "CREATE CONSTRAINT logentry_id IF NOT EXISTS FOR (l:LogEntry) REQUIRE l.id IS UNIQUE",
    # Dictionary (:Term nodes — global Mainframe service, distinct from :Concept).
    "CREATE CONSTRAINT term_id IF NOT EXISTS FOR (t:Term) REQUIRE t.id IS UNIQUE",
    "CREATE CONSTRAINT term_name IF NOT EXISTS FOR (t:Term) REQUIRE t.name IS UNIQUE",
    "CREATE CONSTRAINT dictq_id IF NOT EXISTS FOR (q:DictQuestion) REQUIRE q.id IS UNIQUE",
    "CREATE CONSTRAINT dictn_id IF NOT EXISTS FOR (n:DictNote) REQUIRE n.id IS UNIQUE",
    # Lookups the UI does a lot:
    "CREATE INDEX paper_status IF NOT EXISTS FOR (p:Paper) ON (p.status)",
    "CREATE INDEX paper_year IF NOT EXISTS FOR (p:Paper) ON (p.year)",
    "CREATE INDEX log_ts IF NOT EXISTS FOR (l:LogEntry) ON (l.ts)",
    # ChangeEvent = LogEntry (dual-labelled). Index the richer fields.
    "CREATE INDEX ce_module IF NOT EXISTS FOR (l:LogEntry) ON (l.module)",
    "CREATE INDEX ce_trigger IF NOT EXISTS FOR (l:LogEntry) ON (l.trigger)",
    "CREATE INDEX kgnode_paper IF NOT EXISTS FOR (n:KGNode) ON (n.paper_id)",
    "CREATE INDEX task_status IF NOT EXISTS FOR (t:Task) ON (t.status)",
    "CREATE INDEX task_horizon IF NOT EXISTS FOR (t:Task) ON (t.horizon)",
    "CREATE INDEX task_module IF NOT EXISTS FOR (t:Task) ON (t.module)",
    "CREATE INDEX task_parent IF NOT EXISTS FOR (t:Task) ON (t.parent_id)",
    "CREATE INDEX term_type IF NOT EXISTS FOR (t:Term) ON (t.type)",
    "CREATE INDEX term_fam IF NOT EXISTS FOR (t:Term) ON (t.familiarity)",
    # Images — Mainframe-level service, attachable to any entity by context_id.
    "CREATE CONSTRAINT image_id IF NOT EXISTS FOR (i:Image) REQUIRE i.id IS UNIQUE",
    "CREATE INDEX image_module IF NOT EXISTS FOR (i:Image) ON (i.module)",
    "CREATE INDEX image_context IF NOT EXISTS FOR (i:Image) ON (i.context_id)",
    # Vision module (VISION_SPEC)
    "CREATE CONSTRAINT pipeline_id IF NOT EXISTS FOR (p:Pipeline) REQUIRE p.id IS UNIQUE",
    "CREATE CONSTRAINT pstage_id IF NOT EXISTS FOR (s:PipelineStage) REQUIRE s.id IS UNIQUE",
    "CREATE CONSTRAINT tool_name IF NOT EXISTS FOR (t:Tool) REQUIRE t.name IS UNIQUE",
    "CREATE CONSTRAINT video_id IF NOT EXISTS FOR (v:Video) REQUIRE v.id IS UNIQUE",
    "CREATE CONSTRAINT jentry_id IF NOT EXISTS FOR (e:JournalEntry) REQUIRE e.id IS UNIQUE",
    "CREATE INDEX video_type IF NOT EXISTS FOR (v:Video) ON (v.type)",
    "CREATE INDEX video_stage IF NOT EXISTS FOR (v:Video) ON (v.stage)",
    "CREATE CONSTRAINT research_id IF NOT EXISTS FOR (r:ResearchNote) REQUIRE r.id IS UNIQUE",
    "CREATE CONSTRAINT prompt_id IF NOT EXISTS FOR (p:PromptEntry) REQUIRE p.id IS UNIQUE",
    "CREATE CONSTRAINT marker_id IF NOT EXISTS FOR (m:ScriptMarker) REQUIRE m.id IS UNIQUE",
    "CREATE CONSTRAINT panel_id IF NOT EXISTS FOR (p:StoryPanel) REQUIRE p.id IS UNIQUE",
    "CREATE CONSTRAINT thumbopt_id IF NOT EXISTS FOR (t:ThumbnailOption) REQUIRE t.id IS UNIQUE",
    "CREATE CONSTRAINT writing_id IF NOT EXISTS FOR (w:WritingPiece) REQUIRE w.id IS UNIQUE",
    "CREATE CONSTRAINT pfproject_id IF NOT EXISTS FOR (p:PortfolioProject) REQUIRE p.id IS UNIQUE",
    "CREATE CONSTRAINT contact_id IF NOT EXISTS FOR (c:Contact) REQUIRE c.id IS UNIQUE",
    # Vault module (VAULT_SPEC)
    "CREATE CONSTRAINT account_id IF NOT EXISTS FOR (a:Account) REQUIRE a.id IS UNIQUE",
    "CREATE CONSTRAINT tx_id IF NOT EXISTS FOR (t:Transaction) REQUIRE t.id IS UNIQUE",
    "CREATE INDEX tx_date IF NOT EXISTS FOR (t:Transaction) ON (t.date)",
    "CREATE INDEX tx_category IF NOT EXISTS FOR (t:Transaction) ON (t.category)",
    "CREATE INDEX tx_verdict IF NOT EXISTS FOR (t:Transaction) ON (t.verdict)",
    "CREATE CONSTRAINT budget_id IF NOT EXISTS FOR (b:BudgetCategory) REQUIRE b.id IS UNIQUE",
    "CREATE CONSTRAINT income_month IF NOT EXISTS FOR (m:MonthlyIncome) REQUIRE m.month IS UNIQUE",
    "CREATE CONSTRAINT inv_id IF NOT EXISTS FOR (i:Investment) REQUIRE i.id IS UNIQUE",
    "CREATE CONSTRAINT item_id IF NOT EXISTS FOR (i:InventoryItem) REQUIRE i.id IS UNIQUE",
    "CREATE CONSTRAINT findiary_id IF NOT EXISTS FOR (d:FinanceDiary) REQUIRE d.id IS UNIQUE",
    "CREATE INDEX item_status IF NOT EXISTS FOR (i:InventoryItem) ON (i.status)",
]


# Idempotent data migrations run after the schema DDL on every startup. Each is
# a no-op once applied (guarded by WHERE/coalesce), so re-running is harmless.
_MIGRATIONS: list[str] = [
    # The repository holds sources, not only papers (books, video series,
    # courses). Everything that predates `kind` was uploaded as a PDF paper.
    """
    MATCH (p:Paper) WHERE p.kind IS NULL
    SET p.kind = 'paper'
    """,
    # Repository cards became movable. Seed `position` from the order they're
    # already displayed in (year desc, then added_at desc) so nothing jumps the
    # first time an arrow is used — same approach as mind-dumps and ideas.
    """
    MATCH (p:Paper) WHERE p.position IS NULL
    WITH p ORDER BY coalesce(p.year, 0) DESC, p.added_at DESC
    WITH collect(p) AS ps
    UNWIND range(0, size(ps) - 1) AS i
    WITH ps[i] AS node, i
    SET node.position = toFloat(i)
    """,
    # Tasks gained an editable `opened_at` (when the work started, as opposed to
    # `created_at`, when the row was made). Seed it from created_at so every
    # existing task already has a measurable age.
    """
    MATCH (t:Task) WHERE t.opened_at IS NULL
    SET t.opened_at = t.created_at
    """,
    # Reading passes became reorderable and gained two written fields. Seed
    # `position` from `version` so existing passes keep the order they were read
    # in, and default the text to "" — Neo4j drops nulls, which would change the
    # shape of the API response.
    """
    MATCH (i:Instance) WHERE i.position IS NULL
    SET i.position = toFloat(coalesce(i.version, 0))
    """,
    """
    MATCH (i:Instance) WHERE i.look_into IS NULL SET i.look_into = ''
    """,
    # "pushed" became "completed" — same flag, a name that says what it means.
    # The old property is left in place so nothing that still reads it breaks.
    """
    MATCH (w:WorkSession) WHERE w.completed IS NULL
    SET w.completed = coalesce(w.pushed, false)
    """,
    # Learning entries gained a long-form `detail` plus repeatable idea and
    # consultation lists. Default them so the API's response shape is the same
    # for an old entry as a new one (Neo4j drops nulls).
    """
    MATCH (l:LearningOpportunity) WHERE l.detail IS NULL SET l.detail = ''
    """,
    """
    MATCH (l:LearningOpportunity) WHERE l.ideas IS NULL SET l.ideas = []
    """,
    """
    MATCH (l:LearningOpportunity) WHERE l.consulted IS NULL SET l.consulted = []
    """,
    # Register every kind already in use, so the catalogue starts complete and
    # groups can be assigned to what's actually there.
    """
    MATCH (l:LearningOpportunity) WHERE trim(coalesce(l.kind,'')) <> ''
    MERGE (:LearningKind {name: toLower(trim(l.kind))})
    """,
    # Distractions became a list — one entry per interruption — because a single
    # comma-joined string can't say what each one was. Split the old field on
    # commas so anything already written is carried over, not dropped.
    """
    MATCH (i:Instance) WHERE i.distraction_items IS NULL
    SET i.distraction_items =
        CASE WHEN coalesce(i.distraction_types, '') = '' THEN []
             ELSE [x IN split(i.distraction_types, ',') WHERE trim(x) <> '' | trim(x)]
        END
    """,
    # Increment #8: promote legacy :LogEntry rows to the richer ChangeEvent
    # schema — add the :ChangeEvent label + the module/trigger/timestamp fields.
    """
    MATCH (l:LogEntry) WHERE NOT l:ChangeEvent
    SET l:ChangeEvent,
        l.module = coalesce(l.module, 'synapse'),
        l.trigger = coalesce(l.trigger, 'manual'),
        l.timestamp = coalesce(l.timestamp, l.ts)
    """,
    # Deep Dive redesigned topic-first — carry old month/theme/notes into the
    # new topic/info fields so existing dives aren't lost.
    """
    MATCH (d:DeepDive)
    SET d.topic = coalesce(d.topic, d.theme, d.month, 'Untitled'),
        d.info = coalesce(d.info, d.notes, '')
    """,
    # Manual card ordering: seed `position` on pre-existing mind-dumps and ideas
    # from their current (newest-first) display order so nothing jumps around
    # the first time the reorder arrows are used.
    """
    MATCH (m:MindDump) WHERE m.position IS NULL
    WITH m ORDER BY m.created_at DESC
    WITH collect(m) AS ms
    UNWIND range(0, size(ms) - 1) AS i
    WITH ms[i] AS node, i
    SET node.position = toFloat(i)
    """,
    """
    MATCH (i:Idea) WHERE i.position IS NULL
    WITH i ORDER BY i.created_at DESC
    WITH collect(i) AS xs
    UNWIND range(0, size(xs) - 1) AS n
    WITH xs[n] AS node, n
    SET node.position = toFloat(n)
    """,
    # Contribution grid rework: projects gained a "add to the contributions"
    # flag (border on the day square). Existing projects default to opted-in.
    """
    MATCH (p:Project) WHERE p.contributes IS NULL
    SET p.contributes = true, p.status = coalesce(p.status, 'active'), p.repo = coalesce(p.repo, '')
    """,
    # Ideas are now marked by kind, and the colour lives on the kind. Seed the
    # kinds that were previously hard-coded in the frontend, plus any kind
    # already in use on an existing idea, each with a distinct colour.
    """
    UNWIND [
      {name: 'research',       color: '#5A9DE0'},
      {name: 'implementation', color: '#00D4AA'},
      {name: 'tensortonics',   color: '#8B7EC8'},
      {name: 'content',        color: '#FF4757'},
      {name: 'experiment',     color: '#F0A030'},
      {name: 'tool',           color: '#7FA8C8'},
      {name: 'fusion',         color: '#2DE2FF'},
      {name: 'personal',       color: '#F4709C'}
    ] AS seed
    MERGE (c:IdeaCategory {name: seed.name})
      ON CREATE SET c.color = seed.color
    """,
    """
    MATCH (i:Idea) WHERE i.category IS NOT NULL AND trim(i.category) <> ''
    MERGE (c:IdeaCategory {name: i.category})
      ON CREATE SET c.color = '#7FA8C8'
    """,
    # Reading instances gained structured timing (started/ended, time spent,
    # the active/passive split, and a distraction count). Backfill the defaults
    # so existing instances read back with the full shape instead of nulls.
    """
    MATCH (i:Instance) WHERE i.mins IS NULL
    SET i.start = coalesce(i.start, ''),
        i.end = coalesce(i.end, ''),
        i.mins = 0,
        i.active_mins = coalesce(i.active_mins, 0),
        i.passive_mins = coalesce(i.passive_mins, 0),
        i.distractions = coalesce(i.distractions, 0)
    """,
]


async def init_schema() -> None:
    driver = get_driver()
    async with driver.session(database=settings.neo4j_database) as session:
        for stmt in _SCHEMA_STATEMENTS:
            await session.run(stmt)
        for stmt in _MIGRATIONS:
            await session.run(stmt)
    log.info(
        "Neo4j schema ready (%d constraints/indexes, %d migrations)",
        len(_SCHEMA_STATEMENTS), len(_MIGRATIONS),
    )


async def verify_connectivity() -> bool:
    try:
        await get_driver().verify_connectivity()
        return True
    except Exception as exc:  # noqa: BLE001
        log.warning("Neo4j not reachable: %s", exc)
        return False
