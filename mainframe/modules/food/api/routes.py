"""Food module HTTP API."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_session
from modules.food.models import Meal, MealType
from modules.food.schemas import (
    AdvisoryResponse,
    FoodItemOut,
    MealCreate,
    MealOut,
    MealUpdate,
    ParsedFoodItem,
    TrendsResponse,
)
from modules.food.services import advisory, meal_service, nutrient_lookup, trends_service
from modules.food.services import photo_storage
from modules.food.services.llm_parser import get_parser, parse_meal

router = APIRouter(prefix="/api/food", tags=["food"])


def _to_out(meal: Meal) -> MealOut:
    out = MealOut.model_validate(meal)
    out.photo_url = photo_storage.public_url(meal.photo_path)
    return out


async def _get_meal_or_404(session: AsyncSession, meal_id: uuid.UUID) -> Meal:
    meal = await meal_service.get_meal(session, meal_id)
    if meal is None:
        raise HTTPException(status_code=404, detail="Meal not found")
    return meal


# --------------------------------------------------------------------------- #
# Preview (parse + nutrient lookup without saving)                            #
# --------------------------------------------------------------------------- #
@router.post("/preview", response_model=list[FoodItemOut])
async def preview(payload: MealCreate) -> list[FoodItemOut]:
    """Run the parse + nutrient pipeline and return items without persisting.

    Useful for the frontend to show a live preview before the user commits.
    """
    parsed = await parse_meal(payload.description)
    profiles = await nutrient_lookup.resolve_items(parsed)
    items: list[FoodItemOut] = []
    for p, prof in zip(parsed, profiles):
        items.append(
            FoodItemOut(
                id=uuid.uuid4(),
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
                micronutrients=prof.micronutrients,
            )
        )
    return items


# --------------------------------------------------------------------------- #
# Meals CRUD                                                                    #
# --------------------------------------------------------------------------- #
@router.post("/meals", response_model=MealOut, status_code=201)
async def create_meal(
    payload: MealCreate, session: AsyncSession = Depends(get_session)
) -> MealOut:
    meal = await meal_service.create_meal(session, payload)
    return _to_out(meal)


@router.post("/meals/quick", response_model=MealOut, status_code=201)
async def quick_log(
    description: str = Form(...),
    meal_type: MealType = Form(...),
    eaten_at: datetime | None = Form(default=None),
    notes: str | None = Form(default=None),
    source: str = Form(default="phone"),
    photo: UploadFile | None = File(default=None),
    session: AsyncSession = Depends(get_session),
) -> MealOut:
    """One-shot log with an optional photo (multipart) — the mobile quick-log path."""
    photo_path: str | None = None
    if photo is not None and photo.filename:
        try:
            photo_path = await photo_storage.save(photo)
        except photo_storage.PhotoError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    payload = MealCreate(
        description=description,
        meal_type=meal_type,
        eaten_at=eaten_at,
        notes=notes,
        source=source,
    )
    meal = await meal_service.create_meal(session, payload, photo_path=photo_path)
    return _to_out(meal)


@router.get("/meals", response_model=list[MealOut])
async def list_meals(
    start: datetime | None = Query(default=None),
    end: datetime | None = Query(default=None),
    limit: int = Query(default=100, le=500),
    offset: int = Query(default=0, ge=0),
    session: AsyncSession = Depends(get_session),
) -> list[MealOut]:
    meals = await meal_service.list_meals(
        session, start=start, end=end, limit=limit, offset=offset
    )
    return [_to_out(m) for m in meals]


@router.get("/meals/{meal_id}", response_model=MealOut)
async def get_meal(
    meal_id: uuid.UUID, session: AsyncSession = Depends(get_session)
) -> MealOut:
    meal = await _get_meal_or_404(session, meal_id)
    return _to_out(meal)


@router.patch("/meals/{meal_id}", response_model=MealOut)
async def update_meal(
    meal_id: uuid.UUID,
    payload: MealUpdate,
    session: AsyncSession = Depends(get_session),
) -> MealOut:
    meal = await _get_meal_or_404(session, meal_id)
    if payload.meal_type is not None:
        meal.meal_type = payload.meal_type
    if payload.eaten_at is not None:
        meal.eaten_at = payload.eaten_at
    if payload.notes is not None:
        meal.notes = payload.notes
    await session.flush()
    return _to_out(meal)


@router.delete("/meals/{meal_id}", status_code=204, response_model=None)
async def delete_meal(
    meal_id: uuid.UUID, session: AsyncSession = Depends(get_session)
):
    meal = await _get_meal_or_404(session, meal_id)
    if meal.photo_path:
        photo_storage.delete(meal.photo_path)
    await meal_service.delete_meal(session, meal)


@router.post("/meals/{meal_id}/photo", response_model=MealOut)
async def upload_photo(
    meal_id: uuid.UUID,
    photo: UploadFile = File(...),
    session: AsyncSession = Depends(get_session),
) -> MealOut:
    meal = await _get_meal_or_404(session, meal_id)
    try:
        new_path = await photo_storage.save(photo)
    except photo_storage.PhotoError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if meal.photo_path:
        photo_storage.delete(meal.photo_path)
    await meal_service.attach_photo(session, meal, new_path)
    return _to_out(meal)


# --------------------------------------------------------------------------- #
# Trends & advisory                                                            #
# --------------------------------------------------------------------------- #
def _default_range(days: int) -> tuple[datetime, datetime]:
    end = datetime.now(timezone.utc)
    start = end - timedelta(days=days)
    return start, end


@router.get("/trends", response_model=TrendsResponse)
async def trends(
    granularity: str = Query(default="day", pattern="^(day|week|month)$"),
    start: datetime | None = Query(default=None),
    end: datetime | None = Query(default=None),
    session: AsyncSession = Depends(get_session),
) -> TrendsResponse:
    if start is None or end is None:
        default_days = {"day": 14, "week": 84, "month": 365}[granularity]
        d_start, d_end = _default_range(default_days)
        start = start or d_start
        end = end or d_end
    return await trends_service.get_trends(
        session, start=start, end=end, granularity=granularity
    )


@router.get("/advisory", response_model=AdvisoryResponse)
async def get_advisory(
    day: datetime | None = Query(default=None),
    session: AsyncSession = Depends(get_session),
) -> AdvisoryResponse:
    day = day or datetime.now(timezone.utc)
    start = day.replace(hour=0, minute=0, second=0, microsecond=0)
    end = start + timedelta(days=1)
    totals = await trends_service.day_totals(session, start=start, end=end)
    return advisory.generate_advice(start.date(), totals)


@router.get("/meta")
async def meta() -> dict:
    """Introspection: which parser/nutrient sources are active."""
    from core.config import settings

    return {
        "llm_parser": get_parser().name,
        "nutrient_sources": settings.nutrient_source_list,
        "meal_types": [m.value for m in MealType],
    }
