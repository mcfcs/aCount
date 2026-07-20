"""add gmail_message_id to expenses

Revision ID: f1a2b3c4d5e6
Revises: e8b2d6f4a7c3
Create Date: 2026-07-21 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = 'f1a2b3c4d5e6'
down_revision = 'e8b2d6f4a7c3'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('expenses', sa.Column('gmail_message_id', sa.String(length=255), nullable=True))


def downgrade():
    op.drop_column('expenses', 'gmail_message_id')
