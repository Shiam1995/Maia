"""SQLAlchemy models for the food module.

Two tables:
  meals       — one logged eating event (NL description, timing, photo).
  food_items  — the structured, nutrient-resolved items that make up a meal.

Macronutrient/calorie totals live denormalised on `meals` for fast trend
queries; per-item detail (incl. micronutrients as JSON) lives on `food_items`.
"""
from __future__ import annotations

import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.database import Base, TimestampMixin


class MealType(str, enum.Enum):
    breakfast = "breakfast"
    lunch = "lunch"
    dinner = "dinner"
    snack = "snack"


def _uuid() -> uuid.UUID:
    return uuid.uuid4()


class Meal(Base, TimestampMixin):
    __tablename__ = "meals"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=_uuid
    )

    # When the meal was eaten (distinct from created_at, when it was logged).
    eaten_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True
    )
    meal_type: Mapped[MealType] = mapped_column(
        Enum(MealType, name="meal_type"), nullable=False, index=True
    )

    # The raw natural-language description the user entered.
    description: Mapped[str] = mapped_column(Text, nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Relative path (under settings.upload_dir) to an attached photo.
    photo_path: Mapped[str | None] = mapped_column(String(512), nullable=True)

    # Device/method that created this entry ("web", "phone", "api", ...).
    source: Mapped[str] = mapped_column(String(64), default="web", nullable=False)

    # Denormalised totals (sum of resolved food_items), cached for dashboards.
    total_calories: Mapped[float | None] = mapped_column(Float, nullable=True)
    total_protein_g: Mapped[float | None] = mapped_column(Float, nullable=True)
    total_carbs_g: Mapped[float | None] = mapped_column(Float, nullable=True)
    total_fat_g: Mapped[float | None] = mapped_column(Float, nullable=True)
    total_sugar_g: Mapped[float | None] = mapped_column(Float, nullable=True)
    total_fibre_g: Mapped[float | None] = mapped_column(Float, nullable=True)

    items: Mapped[list["FoodItem"]] = relationship(
        back_populates="meal",
        cascade="all, delete-orphan",
        order_by="FoodItem.position",
        lazy="selectin",
    )


class FoodItem(Base, TimestampMixin):
    __tablename__ = "food_items"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=_uuid
    )
    meal_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("meals.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    position: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # As parsed from natural language.
    name: Mapped[str] = mapped_column(String(256), nullable=False)
    quantity: Mapped[float | None] = mapped_column(Float, nullable=True)
    unit: Mapped[str | None] = mapped_column(String(64), nullable=True)
    estimated_grams: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Nutrient-lookup provenance.
    matched: Mapped[bool] = mapped_column(default=False, nullable=False)
    source_db: Mapped[str | None] = mapped_column(String(32), nullable=True)
    source_ref: Mapped[str | None] = mapped_column(String(128), nullable=True)
    matched_name: Mapped[str | None] = mapped_column(String(256), nullable=True)

    # Resolved nutrition, scaled to `estimated_grams`.
    calories: Mapped[float | None] = mapped_column(Float, nullable=True)
    protein_g: Mapped[float | None] = mapped_column(Float, nullable=True)
    carbs_g: Mapped[float | None] = mapped_column(Float, nullable=True)
    fat_g: Mapped[float | None] = mapped_column(Float, nullable=True)
    sugar_g: Mapped[float | None] = mapped_column(Float, nullable=True)
    fibre_g: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Micronutrients kept as flexible JSON: [{"name", "amount", "unit"}, ...]
    micronutrients: Mapped[list | None] = mapped_column(JSONB, nullable=True)

    meal: Mapped["Meal"] = relationship(back_populates="items")


__all__ = ["Meal", "FoodItem", "MealType"]
