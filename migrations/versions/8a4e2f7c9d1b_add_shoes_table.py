"""add shoes table

Revision ID: 8a4e2f7c9d1b
Revises: dc746a4eb96c
Create Date: 2026-03-19 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = "8a4e2f7c9d1b"
down_revision = "dc746a4eb96c"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "shoes",
        sa.Column("shoe_id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("sku", sa.String(length=100), nullable=False),
        sa.Column("brand", sa.String(length=50), nullable=False),
        sa.Column("name", sa.String(length=500), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("shoe_id"),
        sa.UniqueConstraint("sku"),
    )


def downgrade():
    op.drop_table("shoes")
