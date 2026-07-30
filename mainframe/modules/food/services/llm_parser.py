"""Natural-language meal parsing.

Turns a free-text meal description ("nandos quarter chicken with chips") into a
list of structured `ParsedFoodItem`s with estimated portions.

This is deliberately a swappable layer: pick the implementation with
`LLM_PROVIDER` (claude | ollama | heuristic). If the configured provider is
unavailable (e.g. no API key, Ollama not running), the pipeline degrades to the
dependency-free heuristic parser so meal logging never hard-fails.
"""
from __future__ import annotations

import json
import logging
import re
from typing import Protocol

import httpx

from core.config import settings
from modules.food.schemas import ParsedFoodItem

logger = logging.getLogger(__name__)


_SYSTEM_PROMPT = (
    "You extract structured food items from a natural-language meal description. "
    "For each distinct food or drink, return its name (singular, lowercase, no "
    "brand unless it changes nutrition), a numeric quantity, a unit, and a "
    "best-effort estimate of the total edible portion in grams. If the user "
    "gives a brand/restaurant item (e.g. 'nandos quarter chicken'), keep enough "
    "detail to look it up. Estimate realistic gram weights for typical servings."
)

_JSON_SCHEMA = {
    "type": "object",
    "properties": {
        "items": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "quantity": {"type": "number"},
                    "unit": {"type": "string"},
                    "estimated_grams": {"type": "number"},
                },
                "required": ["name", "quantity", "unit", "estimated_grams"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["items"],
    "additionalProperties": False,
}


class MealParser(Protocol):
    name: str

    async def parse(self, text: str) -> list[ParsedFoodItem]:
        ...


def _coerce_items(raw_items: list[dict]) -> list[ParsedFoodItem]:
    items: list[ParsedFoodItem] = []
    for it in raw_items:
        name = str(it.get("name", "")).strip()
        if not name:
            continue
        items.append(
            ParsedFoodItem(
                name=name,
                quantity=it.get("quantity"),
                unit=(it.get("unit") or None),
                estimated_grams=it.get("estimated_grams"),
            )
        )
    return items


class ClaudeParser:
    """Uses the Anthropic API with structured outputs to extract food items."""

    name = "claude"

    def __init__(self) -> None:
        # Imported lazily so the package is only needed when this provider is used.
        from anthropic import AsyncAnthropic

        self._client = AsyncAnthropic(api_key=settings.anthropic_api_key)
        self._model = settings.llm_model

    async def parse(self, text: str) -> list[ParsedFoodItem]:
        response = await self._client.messages.create(
            model=self._model,
            max_tokens=2000,
            system=_SYSTEM_PROMPT,
            output_config={"format": {"type": "json_schema", "schema": _JSON_SCHEMA}},
            messages=[{"role": "user", "content": text}],
        )
        payload = next(
            (b.text for b in response.content if b.type == "text"), None
        )
        if not payload:
            return []
        data = json.loads(payload)
        return _coerce_items(data.get("items", []))


class OllamaParser:
    """Uses a local Ollama model (privacy-preserving, zero cost)."""

    name = "ollama"

    async def parse(self, text: str) -> list[ParsedFoodItem]:
        prompt = (
            f"{_SYSTEM_PROMPT}\n\n"
            "Respond ONLY with JSON of the form "
            '{"items":[{"name":str,"quantity":number,"unit":str,'
            '"estimated_grams":number}]}.\n\n'
            f"Meal: {text}"
        )
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                f"{settings.ollama_host}/api/generate",
                json={
                    "model": settings.ollama_model,
                    "prompt": prompt,
                    "format": "json",
                    "stream": False,
                },
            )
            resp.raise_for_status()
            data = json.loads(resp.json()["response"])
        return _coerce_items(data.get("items", []))


# Rough gram estimates for common portion words, used by the fallback parser.
_UNIT_GRAMS = {
    "g": 1.0,
    "gram": 1.0,
    "grams": 1.0,
    "kg": 1000.0,
    "oz": 28.35,
    "lb": 453.6,
    "cup": 200.0,
    "cups": 200.0,
    "tbsp": 15.0,
    "tsp": 5.0,
    "slice": 30.0,
    "slices": 30.0,
    "piece": 80.0,
    "pieces": 80.0,
    "serving": 150.0,
    "servings": 150.0,
    "handful": 30.0,
    "ml": 1.0,
    "l": 1000.0,
}
_QTY_RE = re.compile(r"^\s*(\d+(?:\.\d+)?)\s*([a-zA-Z]+)?\s+(.*)$")


class HeuristicParser:
    """Dependency-free fallback: split on connectors, guess portions.

    Not as good as an LLM, but keeps the app fully functional with no API key.
    """

    name = "heuristic"

    async def parse(self, text: str) -> list[ParsedFoodItem]:
        # Split on commas, "and", "with", "&", "+", newlines.
        chunks = re.split(r"\s*(?:,|\band\b|\bwith\b|&|\+|\n)\s*", text, flags=re.I)
        items: list[ParsedFoodItem] = []
        for chunk in chunks:
            name = chunk.strip().strip(".")
            if not name or len(name) < 2:
                continue
            quantity: float = 1.0
            unit: str | None = None
            grams = 150.0
            m = _QTY_RE.match(name)
            if m:
                quantity = float(m.group(1))
                unit = (m.group(2) or "").lower() or None
                name = m.group(3).strip()
                # Drop a leftover connector like "of" from "2 slices of bread".
                name = re.sub(r"^(?:of|a|an|the)\s+", "", name, flags=re.I)
                if unit and unit in _UNIT_GRAMS:
                    grams = quantity * _UNIT_GRAMS[unit]
                elif unit is None:
                    grams = quantity * 150.0
            items.append(
                ParsedFoodItem(
                    name=name.lower(),
                    quantity=quantity,
                    unit=unit,
                    estimated_grams=round(grams, 1),
                )
            )
        return items


_HEURISTIC = HeuristicParser()


def _build_provider() -> MealParser:
    provider = settings.llm_provider.lower()
    if provider == "claude":
        if not settings.anthropic_api_key:
            logger.warning(
                "LLM_PROVIDER=claude but ANTHROPIC_API_KEY is unset; "
                "falling back to heuristic parser."
            )
            return _HEURISTIC
        try:
            return ClaudeParser()
        except Exception as exc:  # pragma: no cover - defensive
            logger.warning("Failed to init Claude parser (%s); using heuristic.", exc)
            return _HEURISTIC
    if provider == "ollama":
        return OllamaParser()
    return _HEURISTIC


_provider: MealParser | None = None


def get_parser() -> MealParser:
    global _provider
    if _provider is None:
        _provider = _build_provider()
    return _provider


async def parse_meal(text: str) -> list[ParsedFoodItem]:
    """Parse `text` into food items, falling back to the heuristic on any error."""
    parser = get_parser()
    try:
        items = await parser.parse(text)
        if items:
            return items
        logger.info("Parser '%s' returned no items; trying heuristic.", parser.name)
    except Exception as exc:
        logger.warning("Parser '%s' failed (%s); using heuristic.", parser.name, exc)
    return await _HEURISTIC.parse(text)
