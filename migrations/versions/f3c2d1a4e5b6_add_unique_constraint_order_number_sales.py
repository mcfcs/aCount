"""add unique order_number constraint to sales

Revision ID: f3c2d1a4e5b6
Revises: a1b2c3d4e5f6
Create Date: 2026-03-19 00:00:00.000000

"""
from alembic import op


revision = "f3c2d1a4e5b6"
down_revision = "a1b2c3d4e5f6"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("sales", schema=None) as batch_op:
        batch_op.create_unique_constraint("uq_sales_order_number", ["order_number"])


def downgrade():
    with op.batch_alter_table("sales", schema=None) as batch_op:
        batch_op.drop_constraint("uq_sales_order_number", type_="unique")
