"""initial food module schema

Revision ID: 0001_initial_food
Revises:
Create Date: 2026-07-20
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0001_initial_food"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

meal_type_enum = postgresql.ENUM(
    "breakfast", "lunch", "dinner", "snack", name="meal_type"
)


def upgrade() -> None:
    meal_type_enum.create(op.get_bind(), checkfirst=True)

    op.create_table(
        "meals",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("eaten_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "meal_type",
            postgresql.ENUM(
                "breakfast", "lunch", "dinner", "snack",
                name="meal_type", create_type=False,
            ),
            nullable=False,
        ),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("photo_path", sa.String(length=512), nullable=True),
        sa.Column("source", sa.String(length=64), nullable=False, server_default="web"),
        sa.Column("total_calories", sa.Float(), nullable=True),
        sa.Column("total_protein_g", sa.Float(), nullable=True),
        sa.Column("total_carbs_g", sa.Float(), nullable=True),
        sa.Column("total_fat_g", sa.Float(), nullable=True),
        sa.Column("total_sugar_g", sa.Float(), nullable=True),
        sa.Column("total_fibre_g", sa.Float(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_index("ix_meals_eaten_at", "meals", ["eaten_at"])
    op.create_index("ix_meals_meal_type", "meals", ["meal_type"])

    op.create_table(
        "food_items",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("meal_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("name", sa.String(length=256), nullable=False),
        sa.Column("quantity", sa.Float(), nullable=True),
        sa.Column("unit", sa.String(length=64), nullable=True),
        sa.Column("estimated_grams", sa.Float(), nullable=True),
        sa.Column("matched", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("source_db", sa.String(length=32), nullable=True),
        sa.Column("source_ref", sa.String(length=128), nullable=True),
        sa.Column("matched_name", sa.String(length=256), nullable=True),
        sa.Column("calories", sa.Float(), nullable=True),
        sa.Column("protein_g", sa.Float(), nullable=True),
        sa.Column("carbs_g", sa.Float(), nullable=True),
        sa.Column("fat_g", sa.Float(), nullable=True),
        sa.Column("sugar_g", sa.Float(), nullable=True),
        sa.Column("fibre_g", sa.Float(), nullable=True),
        sa.Column("micronutrients", postgresql.JSONB(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["meal_id"], ["meals.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_food_items_meal_id", "food_items", ["meal_id"])


def downgrade() -> None:
    op.drop_index("ix_food_items_meal_id", table_name="food_items")
    op.drop_table("food_items")
    op.drop_index("ix_meals_meal_type", table_name="meals")
    op.drop_index("ix_meals_eaten_at", table_name="meals")
    op.drop_table("meals")
    meal_type_enum.drop(op.get_bind(), checkfirst=True)
