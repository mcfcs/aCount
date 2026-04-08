"""add shoe image path

Revision ID: 2c4d6e8f9a10
Revises: 9b6e7a9d2c11
Create Date: 2026-04-07 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = '2c4d6e8f9a10'
down_revision = '9b6e7a9d2c11'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('shoes', sa.Column('image_path', sa.String(length=500), nullable=True))


def downgrade():
    op.drop_column('shoes', 'image_path')
