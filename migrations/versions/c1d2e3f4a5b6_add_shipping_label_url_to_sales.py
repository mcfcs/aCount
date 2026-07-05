"""add shipping_label_url to sales

Revision ID: c1d2e3f4a5b6
Revises: 2c4d6e8f9a10
Create Date: 2026-07-05 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = 'c1d2e3f4a5b6'
down_revision = '2c4d6e8f9a10'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('sales', sa.Column('shipping_label_url', sa.Text(), nullable=True))


def downgrade():
    op.drop_column('sales', 'shipping_label_url')
