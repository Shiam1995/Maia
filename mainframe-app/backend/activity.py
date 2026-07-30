"""Activity log — the spine of everything.

Every mutation in the system (create/update/delete of any entity) calls
`record(...)`, which writes a :ChangeEvent node to Neo4j. Nodes carry BOTH the
`:ChangeEvent` (spec name) and `:LogEntry` (legacy) labels so old read queries
keep working. Where an owning entity id is known, the event is linked with
`(:Entity)-[:HAS_CHANGE]->(:ChangeEvent)`. The /api/log route reads these back.

Keeping this in one helper guarantees the log stays comprehensive.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from db import run_write

log = logging.getLogger("synapse.activity")

# Categories the spec enumerates. Not enforced, but documented here.
CATEGORIES = {
    "paper", "highlight", "term", "task", "ref",
    "kg", "status", "deepdive", "idea", "header", "instance", "question",
    "dictionary", "mind", "project",
    # Pulse module
    "habit", "experiment", "routine", "medical", "medication", "fitness", "nutrition",
    "recovery",
}

# Which Mainframe module a category belongs to. Everything paper-domain is
# Synapse; tasks are Mainframe-level and pass their own module explicitly.
CATEGORY_MODULE = {
    "paper": "synapse", "highlight": "synapse", "term": "synapse",
    "ref": "synapse", "kg": "synapse", "status": "synapse",
    "deepdive": "synapse", "idea": "synapse", "header": "synapse",
    "instance": "synapse", "question": "synapse", "dictionary": "synapse",
    "task": "synapse",  # default; task routes override with the task's own module
    "mind": "synapse",  # mind-dump is Mainframe-level but tagged synapse for now
    "project": "synapse",
    "habit": "pulse", "experiment": "pulse", "routine": "pulse",
    "medical": "pulse", "medication": "pulse", "fitness": "pulse", "nutrition": "pulse",
    "recovery": "pulse", "tracking": "pulse",
    # Images are Mainframe-level: the caller always passes the owning module,
    # this is only the fallback when it doesn't.
    "image": "synapse",
    # Vision — content creation
    "pipeline": "vision", "video": "vision", "writing": "vision",
    "portfolio": "vision", "contact": "vision", "sandbox": "vision",
    # Vault — finance / inventory / assets
    "account": "vault", "transaction": "vault", "budget": "vault",
    "investment": "vault", "inventory": "vault", "findiary": "vault",
}

VALID_TRIGGERS = {"manual", "llm", "system"}


async def record(
    category: str,
    action: str,
    detail: str = "",
    paper_id: str | None = None,
    paper_title: str | None = None,
    module: str | None = None,
    trigger: str = "manual",
    entity_id: str | None = None,
) -> None:
    """Append one timestamped :ChangeEvent to the activity log.

    - `module`: which Mainframe module owns this change. Defaults from category.
    - `trigger`: "manual" | "llm" | "system" — who caused the mutation.
    - `entity_id`: id of the owning entity, if not a paper. When set (or when
      `paper_id` is set), a (:Entity)-[:HAS_CHANGE]->(:ChangeEvent) edge is drawn.

    Never raises — logging must not break the operation it's recording.
    """
    resolved_module = module or CATEGORY_MODULE.get(category, "synapse")
    resolved_trigger = trigger if trigger in VALID_TRIGGERS else "manual"
    # Ids to link the event back to its owning entity/entities (nulls dropped).
    link_ids = [lid for lid in (paper_id, entity_id) if lid]
    try:
        await run_write(
            """
            CREATE (l:ChangeEvent:LogEntry {
                id: $id, ts: $ts, timestamp: $ts,
                category: $category, action: $action, detail: $detail,
                paper_id: $paper_id, paper_title: $paper_title,
                module: $module, trigger: $trigger
            })
            WITH l
            UNWIND $link_ids AS lid
              OPTIONAL MATCH (e) WHERE e.id = lid
              FOREACH (_ IN CASE WHEN e IS NULL THEN [] ELSE [1] END |
                MERGE (e)-[:HAS_CHANGE]->(l))
            """,
            id=str(uuid.uuid4()),
            ts=datetime.now(timezone.utc).isoformat(),
            category=category,
            action=action,
            detail=detail,
            paper_id=paper_id,
            paper_title=paper_title,
            module=resolved_module,
            trigger=resolved_trigger,
            link_ids=link_ids,
        )
    except Exception as exc:  # noqa: BLE001
        log.warning("failed to write change event (%s/%s): %s", category, action, exc)
