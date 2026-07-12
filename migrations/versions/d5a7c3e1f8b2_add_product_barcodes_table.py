"""add product_barcodes table

Revision ID: d5a7c3e1f8b2
Revises: c1d2e3f4a5b6
Create Date: 2026-07-12 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = "d5a7c3e1f8b2"
down_revision = "c1d2e3f4a5b6"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "product_barcodes",
        sa.Column("barcode_id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("barcode", sa.String(length=14), nullable=False),
        sa.Column("sku", sa.String(length=100), nullable=True),
        sa.Column("size", sa.Float(), nullable=True),
        sa.Column("name", sa.String(length=500), nullable=True),
        sa.Column("brand", sa.String(length=50), nullable=True),
        sa.Column("image_url", sa.String(length=1000), nullable=True),
        sa.Column("source", sa.String(length=30), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("barcode_id"),
        sa.UniqueConstraint("barcode"),
    )


def downgrade():
    op.drop_table("product_barcodes")
