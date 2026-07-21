"""
What gets pushed, and when.

Two sources, both driven from the Gmail poller thread:
- `notify_email_event`  — Tier 2 lifecycle pushes, fired per ingested email
  (new sale, confirmed, shipped, completed, cancelled, payout, attention).
- `check_alert_pushes`  — Tier 1 deadline pushes, computed from the same
  `build_alerts()` the dashboard uses; each (record, stage) fires once via
  the push_sent_log dedup table.
"""

import logging

from app.alerts import build_alerts
from app.models.models import BankTransfer, Sale
from app.push_utils import get_notification_prefs, notify_once, prune_sent_log, push_configured

logger = logging.getLogger(__name__)

# Email types that never warrant a push.
_SILENT_EMAIL_TYPES = {"Purchase", "Receipt", "Subscription", "Other", None, ""}

# Each push is gated by a category in the operator's notification preferences
# (Settings → Push). Exception categories default ON; routine lifecycle OFF.


def _sale_label(sale):
    size = f" (size {sale.size:g})" if sale.size else ""
    return f"{sale.shoe_name or 'Sale #' + str(sale.order_number)}{size}"


def _money(value, symbol="$"):
    try:
        return f"{symbol}{float(value):,.2f}"
    except (TypeError, ValueError):
        return None


def notify_email_event(gmail_message_id, result):
    """Push a lifecycle notification for one processed email.

    `result` is the process_message() summary dict. Dedup key is the Gmail
    message id, so force re-scrapes can't re-push. Never raises.
    """
    try:
        if not push_configured():
            return
        if not result or result.get("status") != "Success":
            return
        email_type = result.get("email_type")
        if email_type in _SILENT_EMAIL_TYPES:
            return

        dedup_key = f"evt:{gmail_message_id}"
        record_type = result.get("record_type")
        record_id = result.get("record_id")
        prefs = get_notification_prefs()
        lifecycle_on = prefs["lifecycle"]

        if record_type == "BankTransfer" and record_id:
            transfer = BankTransfer.query.get(record_id)
            if not transfer:
                return
            amount = _money(transfer.amount_php, "₱")
            if transfer.reconciliation_status != "Reconciled":
                if prefs["payouts"]:
                    notify_once(dedup_key, f"Payout unreconciled: {amount}",
                                "Couldn't auto-match sales to this payout — reconcile it manually.",
                                url="/financial", tag="transfer")
            elif lifecycle_on:
                rate = f" at ≈₱{float(transfer.implied_rate):.1f}/$" if transfer.implied_rate else ""
                notify_once(dedup_key, f"Payout reconciled: {amount}",
                            f"{transfer.bank_name} ····{transfer.account_last4} — auto-matched{rate}.",
                            url="/financial", tag="transfer")
            return

        if record_type != "Sale" or not record_id:
            return
        sale = Sale.query.get(record_id)
        if not sale:
            return
        label = _sale_label(sale)

        if email_type == "Sale":
            if sale.inventory_match_status != "Matched":
                if prefs["no_inventory"]:
                    notify_once(f"nomatch:{sale.sale_id}", f"Sold, no inventory match: {label}",
                                f"No available stock for SKU {sale.sku or '?'} size {sale.size:g} — "
                                "add/link inventory or check for an oversell.",
                                url="/sales", tag="nomatch")
            elif lifecycle_on:
                price = _money(sale.selling_price)
                notify_once(dedup_key, f"New sale: {label}",
                            (f"Sold for {price}. " if price else "") + "Confirm within 24h.",
                            url="/sales", tag="sale")
        elif email_type == "Attention":
            if prefs["attention"]:
                deadline = sale.attention_needed_deadline.strftime("%b %d, %H:%M") if sale.attention_needed_deadline else None
                notify_once(dedup_key, f"Needs attention: {label}",
                            (sale.issue_type or "Issue reported")
                            + (f" — respond before {deadline} (auto-discount)." if deadline else " — action required."),
                            url="/sales", tag="attention")
        elif lifecycle_on and email_type == "Confirmation":
            ship_by = sale.shipment_deadline.strftime("%b %d, %H:%M") if sale.shipment_deadline else None
            notify_once(dedup_key, f"Confirmed: {label}",
                        f"Label ready. Ship by {ship_by}." if ship_by else "Label ready.",
                        url="/labels", tag="sale")
        elif lifecycle_on and email_type == "Shipped":
            notify_once(dedup_key, f"Shipped: {label}",
                        f"Tracking {sale.tracking_number}." if sale.tracking_number else "Package is on its way to Alias.",
                        url="/sales", tag="sale")
        elif lifecycle_on and email_type == "Completed":
            amount = _money(sale.amount_made)
            notify_once(dedup_key, f"Completed: {label}",
                        f"{amount} available for cash out." if amount else "Earnings available for cash out.",
                        url="/sales", tag="sale")
        elif lifecycle_on and email_type == "BuyerAccepted":
            amount = _money(sale.amount_made)
            notify_once(dedup_key, f"Discount accepted: {label}",
                        f"Payout revised to {amount}." if amount else "Payout was revised down.",
                        url="/sales", tag="sale")
        elif lifecycle_on and email_type == "Cancelled":
            fee = _money(sale.cancellation_fee)
            notify_once(dedup_key, f"Cancelled: {label}",
                        f"Cancellation fee: {fee}." if fee else "No cancellation fee.",
                        url="/sales", tag="sale")
    except Exception:
        logger.exception("notify_email_event failed")


def check_alert_pushes():
    """Tier 1 deadline scan — push each alert stage exactly once.

    Stages: pending>12h, ship deadline T-24h then T-6h, overdue, attention
    on-appearance then T-6h before the 48h auto-discount. Runs on the poller
    interval inside an app context. Never raises.
    """
    try:
        if not push_configured():
            return
        prefs = get_notification_prefs()
        for item in build_alerts():
            alert_type = item.get("type")
            if alert_type == "pending_confirmation":
                if prefs["deadlines"]:
                    notify_once(f"pend:{item['sale_id']}",
                                "Sale pending too long",
                                item["message"], url="/sales", tag="deadline")
            elif alert_type == "shipment_deadline":
                if prefs["deadlines"]:
                    bucket = "t6" if (item.get("hours_left") is not None and item["hours_left"] <= 6) else "t24"
                    notify_once(f"shipdl:{item['sale_id']}:{bucket}",
                                "Shipment deadline" + (" — under 6h!" if bucket == "t6" else " approaching"),
                                item["message"], url="/labels", tag="deadline")
            elif alert_type == "overdue_shipment":
                if prefs["deadlines"]:
                    notify_once(f"shipov:{item['sale_id']}",
                                "Shipment OVERDUE",
                                item["message"], url="/labels", tag="deadline")
            elif alert_type == "attention_needed":
                if prefs["attention"]:
                    notify_once(f"attn:{item['sale_id']}",
                                "Sale needs attention",
                                item["message"], url="/sales", tag="attention")
                    hours = item.get("hours_until_auto_discount")
                    if hours is not None and 0 < hours <= 6:
                        notify_once(f"attn6:{item['sale_id']}",
                                    "Auto-discount in under 6h",
                                    item["message"], url="/sales", tag="attention")
            # --- Derived-exception pushes: signals only aCount can compute ---
            elif alert_type == "sold_at_loss":
                if prefs["loss"]:
                    notify_once(f"loss:{item['sale_id']}",
                                "Sold at a loss",
                                item["message"], url="/sales", tag="loss")
            elif alert_type == "earnings_awaiting_payout":
                if prefs["payouts"]:
                    # Re-fires only when the backlog changes materially (count +
                    # rounded total in the key), so a steady backlog won't spam.
                    key = f"await:{item['sale_count']}:{int(item['est_total_php'])}"
                    notify_once(key, "Earnings awaiting payout",
                                item["message"], url="/financial", tag="payout")
            elif alert_type == "unmatched_sale":
                if prefs["no_inventory"]:
                    notify_once(f"nomatch7:{item['sale_id']}",
                                "Sale still has no inventory match",
                                item["message"], url="/sales", tag="nomatch")
            # unreconciled_transfer / consignment_expiry stay dashboard-only
            # (the unreconciled payout already pushed once at ingest).
        prune_sent_log()
    except Exception:
        logger.exception("check_alert_pushes failed")
