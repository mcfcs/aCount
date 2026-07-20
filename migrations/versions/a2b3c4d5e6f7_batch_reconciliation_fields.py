"""batch reconciliation fields — implied_rate + allocation amount_usd

Revision ID: a2b3c4d5e6f7
Revises: f1a2b3c4d5e6
Create Date: 2026-07-21 00:30:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = 'a2b3c4d5e6f7'
down_revision = 'f1a2b3c4d5e6'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('bank_transfers', sa.Column('implied_rate', sa.Numeric(10, 4), nullable=True))
    op.add_column('bank_transfer_allocations', sa.Column('amount_usd', sa.Numeric(12, 2), nullable=True))


def downgrade():
    op.drop_column('bank_transfer_allocations', 'amount_usd')
    op.drop_column('bank_transfers', 'implied_rate')
