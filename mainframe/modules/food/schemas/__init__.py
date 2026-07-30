"""Pydantic schemas for the food module (request/response contracts)."""
from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from modules.food.models import MealType


# --------------------------------------------------------------------------- #
# Internal DTOs (used between services)                                        #
# --------------------------------------------------------------------------- #
class ParsedFoodItem(BaseModel):
    """A single food item extracted from natural language by the LLM layer."""

    name: str
    quantity: float | None = None
    unit: str | None = None
    estimated_grams: float | None = Field(
        default=None, description="Best-effort estimate of the portion in grams."
    )


class Micronutrient(BaseModel):
    name: str
    amount: float
    unit: str


class NutrientProfile(BaseModel):
    """Nutrition for a food item, already scaled to the eaten portion."""

    matched: bool = False
    source_db: str | None = None
    source_ref: str | None = None
    matched_name: str | None = None

    calories: float | None = None
    protein_g: float | None = None
    carbs_g: float | None = None
    fat_g: float | None = None
    sugar_g: float | None = None
    fibre_g: float | None = None
    micronutrients: list[Micronutrient] = Field(default_factory=list)


# --------------------------------------------------------------------------- #
# API request/response models                                                  #
# --------------------------------------------------------------------------- #
class MealCreate(BaseModel):
    """Log a meal from a natural-language description."""

    description: str = Field(..., min_length=1, examples=["chicken breast with rice and spinach"])
    meal_type: MealType
    eaten_at: datetime | None = Field(
        default=None, description="Defaults to now (UTC) if omitted."
    )
    notes: str | None = None
    source: str = "web"


class FoodItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    quantity: float | None
    unit: str | None
    estimated_grams: float | None
    matched: bool
    source_db: str | None
    source_ref: str | None
    matched_name: str | None
    calories: float | None
    protein_g: float | None
    carbs_g: float | None
    fat_g: float | None
    sugar_g: float | None
    fibre_g: float | None
    micronutrients: list[Micronutrient] | None = None


class MealOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    eaten_at: datetime
    meal_type: MealType
    description: str
    notes: str | None
    photo_path: str | None
    photo_url: str | None = None
    source: str
    total_calories: float | None
    total_protein_g: float | None
    total_carbs_g: float | None
    total_fat_g: float | None
    total_sugar_g: float | None
    total_fibre_g: float | None
    created_at: datetime
    items: list[FoodItemOut] = Field(default_factory=list)


class MealUpdate(BaseModel):
    meal_type: MealType | None = None
    eaten_at: datetime | None = None
    notes: str | None = None


# --------------------------------------------------------------------------- #
# Trends dashboard                                                             #
# --------------------------------------------------------------------------- #
class NutrientTotals(BaseModel):
    calories: float = 0.0
    protein_g: float = 0.0
    carbs_g: float = 0.0
    fat_g: float = 0.0
    sugar_g: float = 0.0
    fibre_g: float = 0.0


class TrendBucket(NutrientTotals):
    """Aggregated nutrition for one time bucket (a day, week, or month)."""

    period: str  # ISO date/label for the bucket
    meal_count: int = 0


class TrendsResponse(BaseModel):
    granularity: str  # "day" | "week" | "month"
    start: datetime
    end: datetime
    buckets: list[TrendBucket]
    averages: NutrientTotals


# --------------------------------------------------------------------------- #
# Advisory layer (stub)                                                        #
# --------------------------------------------------------------------------- #
class Advice(BaseModel):
    code: str
    severity: str  # "info" | "warning" | "positive"
    message: str


class AdvisoryResponse(BaseModel):
    date: str
    generated_by: str
    advice: list[Advice]
