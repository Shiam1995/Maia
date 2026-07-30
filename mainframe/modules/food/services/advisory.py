"""Advisory layer (STUB).

Placeholder for the future LLM-powered advice engine ("you're high on sugar
today", meal suggestions, deficiency detection). For v1 this exposes the
*interface* the rest of the system will call, plus a couple of trivial
rule-based checks so the endpoint returns something real.

To implement for real later: swap `generate_advice` for a version that feeds the
day's `NutrientTotals` (and, eventually, cross-domain Mainframe context like
sleep and workouts) to an LLM and returns richer `Advice`.
"""
from __future__ import annotations

from datetime import date

from modules.food.schemas import Advice, AdvisoryResponse, NutrientTotals

# Loose reference thresholds — placeholders, not medical guidance.
_SUGAR_WARN_G = 50.0
_FIBRE_TARGET_G = 30.0
_PROTEIN_TARGET_G = 80.0

GENERATOR_NAME = "stub-rules-v0"


def generate_advice(day: date, totals: NutrientTotals) -> AdvisoryResponse:
    """Return advice for a day's totals. Intentionally minimal for v1."""
    advice: list[Advice] = []

    if totals.sugar_g > _SUGAR_WARN_G:
        advice.append(
            Advice(
                code="high_sugar",
                severity="warning",
                message=(
                    f"Sugar intake is {totals.sugar_g:.0f} g today, above the "
                    f"{_SUGAR_WARN_G:.0f} g soft cap."
                ),
            )
        )
    if totals.fibre_g and totals.fibre_g >= _FIBRE_TARGET_G:
        advice.append(
            Advice(
                code="fibre_on_target",
                severity="positive",
                message=f"Great fibre day: {totals.fibre_g:.0f} g.",
            )
        )
    if totals.calories and totals.protein_g < _PROTEIN_TARGET_G:
        advice.append(
            Advice(
                code="low_protein",
                severity="info",
                message=(
                    f"Protein is {totals.protein_g:.0f} g so far — under the "
                    f"{_PROTEIN_TARGET_G:.0f} g target."
                ),
            )
        )

    if not advice:
        advice.append(
            Advice(
                code="nominal",
                severity="info",
                message="Nothing notable in today's intake yet.",
            )
        )

    return AdvisoryResponse(
        date=day.isoformat(), generated_by=GENERATOR_NAME, advice=advice
    )
