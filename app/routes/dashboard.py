"""
Dashboard API Routes — KPI summary and action item alerts.
Spec: Sections 6.1, 7
"""

import logging

from flask import Blueprint, jsonify
from sqlalchemy import func

from app import db
from app.alerts import build_alerts
from app.models.models import BankTransfer, Expense, Inventory, Sale

dashboard_bp = Blueprint("dashboard", __name__)
logger = logging.getLogger(__name__)


@dashboard_bp.get("/summary")
def summary():
    """
    GET /api/dashboard/summary
    KPI cards for the main dashboard (Spec §6.1).
    """
    # Total revenue: sum of all bank transfers
    total_revenue_php = db.session.query(
        func.coalesce(func.sum(BankTransfer.amount_php), 0)
    ).scalar()

    # Total expenses (all categories)
    total_expenses_php = db.session.query(
        func.coalesce(func.sum(Expense.amount_php), 0)
    ).scalar()

    # Total profit = revenue - cost of goods (inventory purchase costs for sold items) - other expenses
    cogs_php = db.session.query(
        func.coalesce(func.sum(Inventory.purchase_cost), 0)
    ).filter(Inventory.status == "Sold").scalar()

    platform_fees_php = db.session.query(
        func.coalesce(func.sum(Expense.amount_php), 0)
    ).filter(Expense.category == "Platform Fee").scalar()

    gross_profit = float(total_revenue_php) - float(cogs_php)
    net_profit = gross_profit - float(platform_fees_php)

    # Active inventory
    active_inventory_count = db.session.query(
        func.count(Inventory.inventory_id)
    ).filter(Inventory.status == "Available").scalar() or 0

    active_inventory_value = db.session.query(
        func.coalesce(func.sum(Inventory.purchase_cost), 0)
    ).filter(Inventory.status == "Available").scalar()

    # Sales by status
    status_counts = (
        db.session.query(Sale.status, func.count(Sale.sale_id))
        .group_by(Sale.status)
        .all()
    )
    sales_by_status = {status: count for status, count in status_counts}

    # Unreconciled transfers
    unreconciled = db.session.query(
        func.count(BankTransfer.transfer_id)
    ).filter(BankTransfer.reconciliation_status == "Unreconciled").scalar() or 0

    return jsonify({
        "total_revenue_php": float(total_revenue_php),
        "total_expenses_php": float(total_expenses_php),
        "gross_profit_php": gross_profit,
        "net_profit_php": net_profit,
        "active_inventory_count": active_inventory_count,
        "active_inventory_value_php": float(active_inventory_value),
        "sales_by_status": sales_by_status,
        "unreconciled_transfers": unreconciled,
    }), 200


@dashboard_bp.get("/alerts")
def alerts():
    """
    GET /api/dashboard/alerts
    Action items surfaced on the dashboard (Spec §7).
    Logic lives in app.alerts.build_alerts, shared with the push scheduler.
    """
    try:
        items = build_alerts()
    except Exception:
        logger.exception("Failed to build dashboard alerts")
        items = [{
            "type": "system_error",
            "urgency": "high",
            "message": "Could not load all action items. Please check server logs.",
        }]

    return jsonify({
        "total": len(items),
        "alerts": items,
        "error": None,
    }), 200

