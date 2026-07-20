"""
Action-item alert builder — shared by the dashboard endpoint and the push
notification scheduler (Spec §7).
"""

from datetime import datetime, timedelta

from app import db
from app.models.models import BankTransfer, BankTransferAllocation, Inventory, Sale
from app.time_utils import now
from app.utils import get_php_estimate_rate

# A sale is flagged "at a loss" when estimated payout is below cost by more than
# this (₱; a buffer avoids break-even noise). Only IN-FLIGHT sales are flagged
# (Confirmed/Shipped) — the loss is still worth noticing before it's realized;
# already-Completed losses are historical and would just flood the list.
LOSS_BUFFER_PHP = 50.0
# Earnings "awaiting payout": completed sales unpaid between this many days ago
# and the recent-window cap. The window keeps ancient un-reconcilable rows (data
# artifacts) from dominating the real "Alias owes you recently" signal.
AWAITING_PAYOUT_MIN_DAYS = 5
AWAITING_PAYOUT_WINDOW_DAYS = 45


def _to_naive_dt(value):
    """Return a timezone-naive datetime for comparisons and iso formatting."""
    if not value or not isinstance(value, datetime):
        return None
    return value.replace(tzinfo=None)


def build_alerts():
    """Compute the current action items. Returns a list of alert dicts sorted
    by urgency (critical > high > medium > low). Must run in an app context."""
    now_ts = now()
    items = []

    # --- Pending Confirmation (High, 24-hr risk) ---
    threshold_12h = now_ts - timedelta(hours=12)
    pending_old = (
        Sale.query
        .filter(Sale.status == "Pending")
        .filter(Sale.created_at <= threshold_12h)
        .all()
    )
    for sale in pending_old:
        hours_old = (now_ts - sale.created_at).total_seconds() / 3600
        items.append({
            "type": "pending_confirmation",
            "urgency": "high",
            "sale_id": sale.sale_id,
            "order_number": sale.order_number,
            "shoe_name": sale.shoe_name,
            "message": f"Order #{sale.order_number} has been Pending for {hours_old:.0f}h — confirm within 24h or it auto-cancels.",
        })

    # --- Shipment deadline in next 24h (Critical) ---
    deadline_window = now_ts + timedelta(hours=24)
    upcoming_deadlines = (
        Sale.query
        .filter(Sale.status == "Confirmed")
        .filter(Sale.shipment_deadline != None)  # noqa: E711
        .filter(Sale.shipment_deadline >= now_ts)
        .filter(Sale.shipment_deadline <= deadline_window)
        .all()
    )
    for sale in upcoming_deadlines:
        deadline = _to_naive_dt(sale.shipment_deadline) or sale.shipment_deadline
        if not deadline:
            continue
        hours_left = (deadline - now_ts).total_seconds() / 3600
        items.append({
            "type": "shipment_deadline",
            "urgency": "critical",
            "sale_id": sale.sale_id,
            "order_number": sale.order_number,
            "shoe_name": sale.shoe_name,
            "shipment_deadline": deadline.isoformat(),
            "deadline": deadline.isoformat(),
            "hours_left": round(hours_left, 1),
            "message": f"Order #{sale.order_number} must ship in {hours_left:.0f}h.",
        })

    # --- Overdue shipments (Critical) ---
    overdue = (
        Sale.query
        .filter(Sale.status == "Confirmed")
        .filter(Sale.shipment_deadline != None)  # noqa: E711
        .filter(Sale.shipment_deadline < now_ts)
        .all()
    )
    for sale in overdue:
        deadline = _to_naive_dt(sale.shipment_deadline) or sale.shipment_deadline
        if not deadline:
            continue
        hours_overdue = (now_ts - deadline).total_seconds() / 3600
        items.append({
            "type": "overdue_shipment",
            "urgency": "critical",
            "sale_id": sale.sale_id,
            "order_number": sale.order_number,
            "shoe_name": sale.shoe_name,
            "shipment_deadline": deadline.isoformat(),
            "deadline": deadline.isoformat(),
            "message": f"Order #{sale.order_number} shipment is overdue by {hours_overdue:.0f}h.",
        })

    # --- Attention Needed (High) ---
    attention = Sale.query.filter(Sale.status == "Attention Needed").all()
    for sale in attention:
        deadline = _to_naive_dt(sale.attention_needed_deadline) or sale.attention_needed_deadline
        deadline_str = None
        hours_remaining = None
        if deadline:
            deadline_str = deadline.isoformat()
            hours_remaining = (deadline - now_ts).total_seconds() / 3600

        items.append({
            "type": "attention_needed",
            "urgency": "high",
            "sale_id": sale.sale_id,
            "order_number": sale.order_number,
            "shoe_name": sale.shoe_name,
            "issue_type": sale.issue_type,
            "attention_needed_deadline": deadline_str,
            "deadline": deadline_str,
            "hours_until_auto_discount": round(hours_remaining, 1) if hours_remaining is not None else None,
            "message": (
                f"Order #{sale.order_number} — {sale.issue_type or 'issue unknown'}. "
                + (f"Auto-discount in {hours_remaining:.0f}h." if hours_remaining and hours_remaining > 0 else "Auto-discount deadline passed.")
                if sale.attention_needed_deadline else
                f"Order #{sale.order_number} — {sale.issue_type or 'issue unknown'}. Action required."
            ),
        })

    # --- Unreconciled transfers (Medium) ---
    threshold_48h = now_ts - timedelta(hours=48)
    unreconciled = (
        BankTransfer.query
        .filter(BankTransfer.reconciliation_status == "Unreconciled")
        .filter(BankTransfer.created_at <= threshold_48h)
        .all()
    )
    for transfer in unreconciled:
        transfer_dt = _to_naive_dt(transfer.transfer_date) or transfer.transfer_date
        if not transfer_dt:
            continue
        items.append({
            "type": "unreconciled_transfer",
            "urgency": "medium",
            "transfer_id": transfer.transfer_id,
            "amount_php": float(transfer.amount_php),
            "transfer_date": transfer_dt.isoformat(),
            "message": f"Bank transfer PHP{float(transfer.amount_php):,.2f} on {transfer_dt.date()} is unreconciled.",
        })

    # --- Unmatched sales (Low) ---
    threshold_7d = now_ts - timedelta(days=7)
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

    # --- Consignment nearing 90-day storage window (Medium) ---
    threshold_consign_warn = now_ts - timedelta(days=76)  # 90 - 14 days warning
    expiring_consignments = (
        Inventory.query
        .filter(Inventory.status == "Consigned")
        .filter(Inventory.updated_at <= threshold_consign_warn)
        .all()
    )
    for item in expiring_consignments:
        days_consigned = (now_ts - item.updated_at).days
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

    # --- Sold at a loss (High) — cross-entity: only aCount knows both the USD
    #     payout and the PHP cost basis. Only IN-FLIGHT sales, real losses. ---
    rate = get_php_estimate_rate()
    margin_candidates = (
        Sale.query
        .filter(Sale.status.in_(["Confirmed", "Shipped"]))
        .filter(Sale.amount_made != None)  # noqa: E711
        .filter(Sale.purchase_cost != None)  # noqa: E711
        .all()
    )
    for sale in margin_candidates:
        payout_php = float(sale.amount_made) * rate
        cost_php = float(sale.purchase_cost)
        margin = payout_php - cost_php
        if margin < -LOSS_BUFFER_PHP:
            items.append({
                "type": "sold_at_loss",
                "urgency": "high",
                "sale_id": sale.sale_id,
                "order_number": sale.order_number,
                "shoe_name": sale.shoe_name,
                "margin_php": round(margin, 2),
                "payout_php": round(payout_php, 2),
                "cost_php": round(cost_php, 2),
                "message": (
                    f"Order #{sale.order_number} ({sale.shoe_name}) is set to sell at a loss: "
                    f"≈₱{payout_php:,.0f} payout vs ₱{cost_php:,.0f} cost (−₱{abs(margin):,.0f})."
                ),
            })

    # --- Earnings awaiting payout (Medium) — recent Completed earnings not yet
    #     settled by any transfer, aged AWAITING_PAYOUT_MIN_DAYS..WINDOW. ---
    allocated_ids = {row[0] for row in db.session.query(BankTransferAllocation.sale_id).all()}
    payout_min = (now_ts - timedelta(days=AWAITING_PAYOUT_MIN_DAYS)).date()
    payout_window = (now_ts - timedelta(days=AWAITING_PAYOUT_WINDOW_DAYS)).date()
    awaiting = (
        Sale.query
        .filter(Sale.status == "Completed")
        .filter(Sale.amount_made != None)  # noqa: E711
        .filter(Sale.completion_date != None)  # noqa: E711
        .filter(Sale.completion_date <= payout_min)
        .filter(Sale.completion_date >= payout_window)
        .all()
    )
    awaiting = [s for s in awaiting if s.sale_id not in allocated_ids]
    if awaiting:
        total_usd = sum(float(s.amount_made) for s in awaiting)
        oldest = min(s.completion_date for s in awaiting)
        days_oldest = (now_ts.date() - oldest).days
        items.append({
            "type": "earnings_awaiting_payout",
            "urgency": "medium",
            "sale_count": len(awaiting),
            "total_usd": round(total_usd, 2),
            "est_total_php": round(total_usd * rate, 2),
            "oldest_days": days_oldest,
            "message": (
                f"${total_usd:,.2f} (≈₱{total_usd * rate:,.0f}) across {len(awaiting)} completed "
                f"sale{'s' if len(awaiting) != 1 else ''} is awaiting payout — oldest {days_oldest}d."
            ),
        })

    urgency_order = {"critical": 0, "high": 1, "medium": 2, "low": 3}
    items.sort(key=lambda x: urgency_order.get(x["urgency"], 99))
    return items
