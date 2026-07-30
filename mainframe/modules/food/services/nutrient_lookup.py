"""Nutrient lookup.

Given a parsed food item (name + estimated grams), resolve nutrition by querying
external food databases and scaling per-100g values to the eaten portion.

Sources are tried in the order configured by `NUTRIENT_SOURCES`:
  usda          — USDA FoodData Central (free, requires an API key; DEMO_KEY works)
  openfoodfacts — Open Food Facts (free, no auth)

Each source is a small adapter, so adding another (Nutritionix, a local DB, ...)
is just another function returning a `Per100g` result.
"""
from __future__ import annotations

import logging

import httpx

from core.config import settings
from modules.food.schemas import Micronutrient, NutrientProfile, ParsedFoodItem

logger = logging.getLogger(__name__)


class Per100g:
    """Normalised per-100g nutrition from a source, before portion scaling."""

    def __init__(
        self,
        *,
        source_db: str,
        source_ref: str | None,
        matched_name: str,
        calories: float | None = None,
        protein_g: float | None = None,
        carbs_g: float | None = None,
        fat_g: float | None = None,
        sugar_g: float | None = None,
        fibre_g: float | None = None,
        micronutrients: list[Micronutrient] | None = None,
    ) -> None:
        self.source_db = source_db
        self.source_ref = source_ref
        self.matched_name = matched_name
        self.calories = calories
        self.protein_g = protein_g
        self.carbs_g = carbs_g
        self.fat_g = fat_g
        self.sugar_g = sugar_g
        self.fibre_g = fibre_g
        self.micronutrients = micronutrients or []


# USDA FoodData Central nutrient numbers we care about for macros.
_USDA_MACRO_BY_NUMBER = {
    "208": "calories",
    "203": "protein_g",
    "204": "fat_g",
    "205": "carbs_g",
    "269": "sugar_g",
    "291": "fibre_g",
}
# A curated set of micronutrients (nutrientNumber -> display name).
_USDA_MICRO_BY_NUMBER = {
    "301": "Calcium",
    "303": "Iron",
    "304": "Magnesium",
    "305": "Phosphorus",
    "306": "Potassium",
    "307": "Sodium",
    "309": "Zinc",
    "401": "Vitamin C",
    "404": "Thiamin",
    "415": "Vitamin B6",
    "418": "Vitamin B12",
    "320": "Vitamin A",
    "328": "Vitamin D",
    "323": "Vitamin E",
}


async def _lookup_usda(client: httpx.AsyncClient, name: str) -> Per100g | None:
    params = {
        "query": name,
        "api_key": settings.usda_api_key,
        "pageSize": 1,
        "dataType": ["Foundation", "SR Legacy"],
    }
    resp = await client.get(
        f"{settings.usda_base_url}/foods/search", params=params, timeout=20
    )
    resp.raise_for_status()
    foods = resp.json().get("foods") or []
    if not foods:
        return None
    food = foods[0]

    macros: dict[str, float] = {}
    micros: list[Micronutrient] = []
    for n in food.get("foodNutrients", []):
        number = str(n.get("nutrientNumber", ""))
        value = n.get("value")
        if value is None:
            continue
        if number in _USDA_MACRO_BY_NUMBER:
            macros[_USDA_MACRO_BY_NUMBER[number]] = float(value)
        elif number in _USDA_MICRO_BY_NUMBER:
            micros.append(
                Micronutrient(
                    name=_USDA_MICRO_BY_NUMBER[number],
                    amount=float(value),
                    unit=n.get("unitName", "").lower() or "mg",
                )
            )

    if not macros and not micros:
        return None
    return Per100g(
        source_db="usda",
        source_ref=str(food.get("fdcId")),
        matched_name=food.get("description", name),
        micronutrients=micros,
        **macros,
    )


def _num(value) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


async def _lookup_openfoodfacts(
    client: httpx.AsyncClient, name: str
) -> Per100g | None:
    params = {
        "search_terms": name,
        "search_simple": 1,
        "action": "process",
        "json": 1,
        "page_size": 1,
        "fields": "product_name,code,nutriments",
    }
    resp = await client.get(
        f"{settings.openfoodfacts_base_url}/cgi/search.pl", params=params, timeout=20
    )
    resp.raise_for_status()
    products = resp.json().get("products") or []
    if not products:
        return None
    p = products[0]
    nutr = p.get("nutriments") or {}
    calories = _num(nutr.get("energy-kcal_100g"))
    if calories is None:
        kj = _num(nutr.get("energy_100g"))
        calories = round(kj / 4.184, 1) if kj is not None else None

    micro_map = {
        "Sodium": ("sodium_100g", "g"),
        "Calcium": ("calcium_100g", "g"),
        "Iron": ("iron_100g", "g"),
        "Potassium": ("potassium_100g", "g"),
        "Vitamin C": ("vitamin-c_100g", "g"),
    }
    micros: list[Micronutrient] = []
    for label, (key, unit) in micro_map.items():
        amount = _num(nutr.get(key))
        if amount is not None:
            micros.append(Micronutrient(name=label, amount=amount, unit=unit))

    if calories is None and not nutr:
        return None
    return Per100g(
        source_db="openfoodfacts",
        source_ref=str(p.get("code")),
        matched_name=p.get("product_name") or name,
        calories=calories,
        protein_g=_num(nutr.get("proteins_100g")),
        carbs_g=_num(nutr.get("carbohydrates_100g")),
        fat_g=_num(nutr.get("fat_100g")),
        sugar_g=_num(nutr.get("sugars_100g")),
        fibre_g=_num(nutr.get("fiber_100g")),
        micronutrients=micros,
    )


_SOURCE_FUNCS = {
    "usda": _lookup_usda,
    "openfoodfacts": _lookup_openfoodfacts,
}


def _scale(per100: Per100g, grams: float) -> NutrientProfile:
    factor = grams / 100.0

    def s(v: float | None) -> float | None:
        return round(v * factor, 2) if v is not None else None

    return NutrientProfile(
        matched=True,
        source_db=per100.source_db,
        source_ref=per100.source_ref,
        matched_name=per100.matched_name,
        calories=s(per100.calories),
        protein_g=s(per100.protein_g),
        carbs_g=s(per100.carbs_g),
        fat_g=s(per100.fat_g),
        sugar_g=s(per100.sugar_g),
        fibre_g=s(per100.fibre_g),
        micronutrients=[
            Micronutrient(
                name=m.name, amount=round(m.amount * factor, 4), unit=m.unit
            )
            for m in per100.micronutrients
        ],
    )


async def resolve_item(
    client: httpx.AsyncClient, item: ParsedFoodItem
) -> NutrientProfile:
    """Resolve nutrition for one parsed item, scaled to its portion."""
    grams = item.estimated_grams or 100.0
    for source in settings.nutrient_source_list:
        func = _SOURCE_FUNCS.get(source)
        if func is None:
            continue
        try:
            per100 = await func(client, item.name)
        except Exception as exc:
            logger.warning("Nutrient source '%s' failed for '%s': %s", source, item.name, exc)
            continue
        if per100 is not None:
            return _scale(per100, grams)
    # No match anywhere — return an unmatched profile so the item is still stored.
    return NutrientProfile(matched=False, matched_name=item.name)


async def resolve_items(items: list[ParsedFoodItem]) -> list[NutrientProfile]:
    async with httpx.AsyncClient() as client:
        results: list[NutrientProfile] = []
        for item in items:
            results.append(await resolve_item(client, item))
        return results
