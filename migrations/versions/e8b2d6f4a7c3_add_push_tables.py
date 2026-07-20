"""add push_subscriptions and push_sent_log tables

Revision ID: e8b2d6f4a7c3
Revises: d5a7c3e1f8b2
Create Date: 2026-07-20 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = "e8b2d6f4a7c3"
down_revision = "d5a7c3e1f8b2"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "push_subscriptions",
        sa.Column("subscription_id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("endpoint", sa.Text(), nullable=False),
        sa.Column("p256dh", sa.String(length=255), nullable=False),
        sa.Column("auth", sa.String(length=255), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("subscription_id"),
        sa.UniqueConstraint("endpoint"),
    )
    op.create_table(
        "push_sent_log",
        sa.Column("sent_id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("dedup_key", sa.String(length=255), nullable=False),
        sa.Column("sent_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("sent_id"),
        sa.UniqueConstraint("dedup_key"),
    )


def downgrade():
    op.drop_table("push_sent_log")
    op.drop_table("push_subscriptions")
