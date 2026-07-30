"""Trends aggregation for the dashboard.

Buckets meal nutrition by day / week / month over a time range using SQL
aggregation (Postgres `date_trunc`), and computes per-bucket averages.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import Float, cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from modules.food.models import Meal
from modules.food.schemas import NutrientTotals, TrendBucket, TrendsResponse

_GRANULARITIES = {"day", "week", "month"}


async def get_trends(
    session: AsyncSession,
    *,
    start: datetime,
    end: datetime,
    granularity: str = "day",
) -> TrendsResponse:
    if granularity not in _GRANULARITIES:
        granularity = "day"

    bucket = func.date_trunc(granularity, Meal.eaten_at).label("bucket")
    stmt = (
        select(
            bucket,
            func.count(Meal.id).label("meal_count"),
            func.coalesce(func.sum(cast(Meal.total_calories, Float)), 0.0),
            func.coalesce(func.sum(cast(Meal.total_protein_g, Float)), 0.0),
            func.coalesce(func.sum(cast(Meal.total_carbs_g, Float)), 0.0),
            func.coalesce(func.sum(cast(Meal.total_fat_g, Float)), 0.0),
            func.coalesce(func.sum(cast(Meal.total_sugar_g, Float)), 0.0),
            func.coalesce(func.sum(cast(Meal.total_fibre_g, Float)), 0.0),
        )
        .where(Meal.eaten_at >= start, Meal.eaten_at <= end)
        .group_by(bucket)
        .order_by(bucket)
    )
    rows = (await session.execute(stmt)).all()

    buckets: list[TrendBucket] = []
    for row in rows:
        period_dt: datetime = row[0]
        buckets.append(
            TrendBucket(
                period=period_dt.date().isoformat(),
                meal_count=row[1],
                calories=round(row[2], 1),
                protein_g=round(row[3], 1),
                carbs_g=round(row[4], 1),
                fat_g=round(row[5], 1),
                sugar_g=round(row[6], 1),
                fibre_g=round(row[7], 1),
            )
        )

    averages = _averages(buckets)
    return TrendsResponse(
        granularity=granularity,
        start=start,
        end=end,
        buckets=buckets,
        averages=averages,
    )


def _averages(buckets: list[TrendBucket]) -> NutrientTotals:
    n = len(buckets)
    if n == 0:
        return NutrientTotals()
    return NutrientTotals(
        calories=round(sum(b.calories for b in buckets) / n, 1),
        protein_g=round(sum(b.protein_g for b in buckets) / n, 1),
        carbs_g=round(sum(b.carbs_g for b in buckets) / n, 1),
        fat_g=round(sum(b.fat_g for b in buckets) / n, 1),
        sugar_g=round(sum(b.sugar_g for b in buckets) / n, 1),
        fibre_g=round(sum(b.fibre_g for b in buckets) / n, 1),
    )


async def day_totals(
    session: AsyncSession, *, start: datetime, end: datetime
) -> NutrientTotals:
    """Summed totals across a range (used by the advisory layer)."""
    stmt = select(
        func.coalesce(func.sum(cast(Meal.total_calories, Float)), 0.0),
        func.coalesce(func.sum(cast(Meal.total_protein_g, Float)), 0.0),
        func.coalesce(func.sum(cast(Meal.total_carbs_g, Float)), 0.0),
        func.coalesce(func.sum(cast(Meal.total_fat_g, Float)), 0.0),
        func.coalesce(func.sum(cast(Meal.total_sugar_g, Float)), 0.0),
        func.coalesce(func.sum(cast(Meal.total_fibre_g, Float)), 0.0),
    ).where(Meal.eaten_at >= start, Meal.eaten_at <= end)
    row = (await session.execute(stmt)).one()
    return NutrientTotals(
        calories=round(row[0], 1),
        protein_g=round(row[1], 1),
        carbs_g=round(row[2], 1),
        fat_g=round(row[3], 1),
        sugar_g=round(row[4], 1),
        fibre_g=round(row[5], 1),
    )
