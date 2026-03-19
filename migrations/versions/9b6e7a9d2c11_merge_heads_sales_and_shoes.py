"""merge purchase_cost and shoes head revisions

Revision ID: 9b6e7a9d2c11
Revises: 7f3d1a9c5e21, 8a4e2f7c9d1b
Create Date: 2026-03-19 00:00:00.000000
"""
from alembic import op


revision = "9b6e7a9d2c11"
down_revision = ("7f3d1a9c5e21", "8a4e2f7c9d1b")
branch_labels = None
depends_on = None


def upgrade():
    pass


def downgrade():
    pass
