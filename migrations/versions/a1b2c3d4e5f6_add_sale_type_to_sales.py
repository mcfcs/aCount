"""add sale_type to sales

Revision ID: a1b2c3d4e5f6
Revises: ceb029102352
Create Date: 2026-03-16 21:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = 'a1b2c3d4e5f6'
down_revision = 'ceb029102352'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('sales', schema=None) as batch_op:
        batch_op.add_column(sa.Column('sale_type', sa.String(length=20), nullable=True))


def downgrade():
    with op.batch_alter_table('sales', schema=None) as batch_op:
        batch_op.drop_column('sale_type')
