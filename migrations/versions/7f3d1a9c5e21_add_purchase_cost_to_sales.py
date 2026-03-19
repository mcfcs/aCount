"""add purchase_cost to sales

Revision ID: 7f3d1a9c5e21
Revises: dc746a4eb96c
Create Date: 2026-03-19 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "7f3d1a9c5e21"
down_revision = "dc746a4eb96c"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "sales",
        sa.Column("purchase_cost", sa.Numeric(10, 2), nullable=True),
    )


def downgrade():
    op.drop_column("sales", "purchase_cost")
