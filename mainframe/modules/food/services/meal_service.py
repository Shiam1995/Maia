"""Meal orchestration: parse -> nutrient lookup -> persist.

This is the nutrient pipeline glue. The three stages (LLM parse, nutrient lookup,
storage) are independent services; this module wires them together and computes
the denormalised meal totals used by the dashboard.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from modules.food.models import FoodItem, Meal
from modules.food.schemas import MealCreate, NutrientProfile, ParsedFoodItem
from modules.food.services import nutrient_lookup
from modules.food.services.llm_parser import parse_meal


def _sum(values: list[float | None]) -> float | None:
    present = [v for v in values if v is not None]
    return round(sum(present), 2) if present else None


def _build_items(
    parsed: list[ParsedFoodItem], profiles: list[NutrientProfile]
) -> list[FoodItem]:
    items: list[FoodItem] = []
    for pos, (p, prof) in enumerate(zip(parsed, profiles)):
        items.append(
            FoodItem(
                position=pos,
                name=p.name,
                quantity=p.quantity,
                unit=p.unit,
                estimated_grams=p.estimated_grams,
                matched=prof.matched,
                source_db=prof.source_db,
                source_ref=prof.source_ref,
                matched_name=prof.matched_name,
                calories=prof.calories,
                protein_g=prof.protein_g,
                carbs_g=prof.carbs_g,
                fat_g=prof.fat_g,
                sugar_g=prof.sugar_g,
                fibre_g=prof.fibre_g,
                micronutrients=[m.model_dump() for m in prof.micronutrients] or None,
            )
        )
    return items


def _apply_totals(meal: Meal) -> None:
    meal.total_calories = _sum([i.calories for i in meal.items])
    meal.total_protein_g = _sum([i.protein_g for i in meal.items])
    meal.total_carbs_g = _sum([i.carbs_g for i in meal.items])
    meal.total_fat_g = _sum([i.fat_g for i in meal.items])
    meal.total_sugar_g = _sum([i.sugar_g for i in meal.items])
    meal.total_fibre_g = _sum([i.fibre_g for i in meal.items])


async def create_meal(
    session: AsyncSession, payload: MealCreate, photo_path: str | None = None
) -> Meal:
    """Run the full pipeline for a natural-language meal and persist it."""
    parsed = await parse_meal(payload.description)
    profiles = await nutrient_lookup.resolve_items(parsed)

    meal = Meal(
        eaten_at=payload.eaten_at or datetime.now(timezone.utc),
        meal_type=payload.meal_type,
        description=payload.description,
        notes=payload.notes,
        source=payload.source,
        photo_path=photo_path,
    )
    meal.items = _build_items(parsed, profiles)
    _apply_totals(meal)

    session.add(meal)
    await session.flush()
    await session.refresh(meal)
    return meal


async def get_meal(session: AsyncSession, meal_id: uuid.UUID) -> Meal | None:
    return await session.get(Meal, meal_id)


async def list_meals(
    session: AsyncSession,
    *,
    start: datetime | None = None,
    end: datetime | None = None,
    limit: int = 100,
    offset: int = 0,
) -> list[Meal]:
    stmt = select(Meal).order_by(Meal.eaten_at.desc())
    if start is not None:
        stmt = stmt.where(Meal.eaten_at >= start)
    if end is not None:
        stmt = stmt.where(Meal.eaten_at <= end)
    stmt = stmt.limit(limit).offset(offset)
    result = await session.execute(stmt)
    return list(result.scalars().all())


async def attach_photo(session: AsyncSession, meal: Meal, photo_path: str) -> Meal:
    meal.photo_path = photo_path
    await session.flush()
    return meal


async def delete_meal(session: AsyncSession, meal: Meal) -> None:
    await session.delete(meal)
    await session.flush()
