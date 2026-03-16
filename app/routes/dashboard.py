"""
Dashboard API Routes — KPI summary and action item alerts.
Spec: Sections 6.1, 7
"""

from datetime import datetime, timedelta

from flask import Blueprint, jsonify
from sqlalchemy import func

from app import db
from app.models.models import Sale, Inventory, BankTransfer, Expense, BankTransferAllocation

dashboard_bp = Blueprint("dashboard", __name__)


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

    # Total profit = revenue − cost of goods (inventory purchase costs for sold items) − other expenses
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

    Alert types:
      - pending_confirmation: Pending sales > 12 hours old (24-hour auto-cancel risk)
      - shipment_deadline:    Confirmed sales with deadline within 24 hours
      - overdue_shipment:     Confirmed sales past their shipment deadline
      - attention_needed:     Sales in Attention Needed status
      - unreconciled_transfer: Unreconciled bank transfers > 48 hours old
      - unmatched_sale:        Unmatched sales > 7 days old
      - consignment_expiry:    Consigned inventory approaching 90-day storage fee
    """
    now = datetime.utcnow()
    items = []

    # --- Pending Confirmation (Spec §7: High urgency, 24-hr deadline) -------
    threshold_12h = now - timedelta(hours=12)
    pending_old = (
        Sale.query
        .filter(Sale.status == "Pending")
        .filter(Sale.created_at <= threshold_12h)
        .all()
    )
    for sale in pending_old:
        hours_old = (now - sale.created_at).total_seconds() / 3600
        items.append({
            "type": "pending_confirmation",
            "urgency": "high",
            "sale_id": sale.sale_id,
            "order_number": sale.order_number,
            "shoe_name": sale.shoe_name,
            "message": f"Order #{sale.order_number} has been Pending for {hours_old:.0f}h — confirm within 24h or it auto-cancels.",
        })

    # --- Shipment Deadline within 24 hours (Critical) -----------------------
    deadline_window = now + timedelta(hours=24)
    upcoming_deadlines = (
        Sale.query
        .filter(Sale.status == "Confirmed")
        .filter(Sale.shipment_deadline != None)
        .filter(Sale.shipment_deadline >= now)
        .filter(Sale.shipment_deadline <= deadline_window)
        .all()
    )
    for sale in upcoming_deadlines:
        hours_left = (sale.shipment_deadline - now).total_seconds() / 3600
        items.append({
            "type": "shipment_deadline",
            "urgency": "critical",
            "sale_id": sale.sale_id,
            "order_number": sale.order_number,
            "shoe_name": sale.shoe_name,
            "shipment_deadline": sale.shipment_deadline.isoformat(),
            "message": f"Order #{sale.order_number} must ship in {hours_left:.0f}h.",
        })

    # --- Overdue Shipments (Critical) ---------------------------------------
    overdue = (
        Sale.query
        .filter(Sale.status == "Confirmed")
        .filter(Sale.shipment_deadline != None)
        .filter(Sale.shipment_deadline < now)
        .all()
    )
    for sale in overdue:
        hours_overdue = (now - sale.shipment_deadline).total_seconds() / 3600
        items.append({
            "type": "overdue_shipment",
            "urgency": "critical",
            "sale_id": sale.sale_id,
            "order_number": sale.order_number,
            "shoe_name": sale.shoe_name,
            "shipment_deadline": sale.shipment_deadline.isoformat(),
            "message": f"Order #{sale.order_number} shipment is overdue by {hours_overdue:.0f}h.",
        })

    # --- Attention Needed (High) --------------------------------------------
    attention = Sale.query.filter(Sale.status == "Attention Needed").all()
    for sale in attention:
        deadline_str = None
        hours_remaining = None
        if sale.attention_needed_deadline:
            deadline_str = sale.attention_needed_deadline.isoformat()
            hours_remaining = (sale.attention_needed_deadline - now).total_seconds() / 3600

        items.append({
            "type": "attention_needed",
            "urgency": "high",
            "sale_id": sale.sale_id,
            "order_number": sale.order_number,
            "shoe_name": sale.shoe_name,
            "issue_type": sale.issue_type,
            "attention_needed_deadline": deadline_str,
            "hours_until_auto_discount": round(hours_remaining, 1) if hours_remaining is not None else None,
            "message": (
                f"Order #{sale.order_number} — {sale.issue_type or 'issue unknown'}. "
                + (f"Auto-discount in {hours_remaining:.0f}h." if hours_remaining and hours_remaining > 0 else "Auto-discount deadline passed.")
                if sale.attention_needed_deadline else
                f"Order #{sale.order_number} — {sale.issue_type or 'issue unknown'}. Action required."
            ),
        })

    # --- Unreconciled Transfers > 48 hours (Medium) -------------------------
    threshold_48h = now - timedelta(hours=48)
    unreconciled = (
        BankTransfer.query
        .filter(BankTransfer.reconciliation_status == "Unreconciled")
        .filter(BankTransfer.created_at <= threshold_48h)
        .all()
    )
    for transfer in unreconciled:
        items.append({
            "type": "unreconciled_transfer",
            "urgency": "medium",
            "transfer_id": transfer.transfer_id,
            "amount_php": float(transfer.amount_php),
            "transfer_date": transfer.transfer_date.isoformat(),
            "message": f"Bank transfer ₱{float(transfer.amount_php):,.2f} on {transfer.transfer_date.date()} is unreconciled.",
        })

    # --- Unmatched Sales > 7 days (Low) -------------------------------------
    threshold_7d = now - timedelta(days=7)
    unmatched = (
        Sale.query
        .filter(Sale.inventory_match_status == "Unmatched")
        .filter(Sale.status.in_(["Pending", "Confirmed", "Shipped"]))
        .filter(Sale.created_at <= threshold_7d)
        .all()
    )
    for sale in unmatched:
        items.append({
            "type": "unmatched_sale",
            "urgency": "low",
            "sale_id": sale.sale_id,
            "order_number": sale.order_number,
            "shoe_name": sale.shoe_name,
            "sku": sale.sku,
            "size": sale.size,
            "message": f"Sale #{sale.order_number} ({sale.shoe_name}) has no inventory match — add or link inventory.",
        })

    # --- Consignment Expiry within 14 days of 90-day threshold (Medium) -----
    threshold_consign_warn = now - timedelta(days=76)  # 90 - 14 days warning
    expiring_consignments = (
        Inventory.query
        .filter(Inventory.status == "Consigned")
        .filter(Inventory.updated_at <= threshold_consign_warn)
        .all()
    )
    for item in expiring_consignments:
        days_consigned = (now - item.updated_at).days
        days_until_fee = 90 - days_consigned
        items.append({
            "type": "consignment_expiry",
            "urgency": "medium",
            "inventory_id": item.inventory_id,
            "shoe_name": item.shoe_name,
            "sku": item.sku,
            "size": item.size,
            "message": (
                f"{item.shoe_name} (size {item.size}) consignment expires in {days_until_fee} days — $2/month storage fee starts."
                if days_until_fee > 0 else
                f"{item.shoe_name} (size {item.size}) is past 90-day consignment window — $2/month storage fee active."
            ),
        })

    # Sort by urgency
    urgency_order = {"critical": 0, "high": 1, "medium": 2, "low": 3}
    items.sort(key=lambda x: urgency_order.get(x["urgency"], 99))

    return jsonify({
        "total": len(items),
        "alerts": items,
    }), 200
