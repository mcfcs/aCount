"""
Sale lifecycle maintenance.

Alias silently expires orders the operator never acts on (and some
cancellation emails arrive before their Sale row exists, leaving the sale
"live" forever). These routines keep statuses honest:

- apply_unlinked_cancellations: back-fill Cancelled emails whose log row never
  matched a sale (linked_record_id IS NULL).
- expire_stale_sales: Pending sales older than STALE_SALE_EXPIRY_DAYS, and
  Confirmed sales whose shipment_deadline passed that long ago, are marked
  Cancelled (no fee) and their inventory restored.

Run periodically from the Gmail poller loop, or on demand via
POST /api/settings/maintenance/lifecycle.
"""

import logging
import os
from datetime import timedelta

from app import db
from app.gmail.processor import apply_cancellation
from app.models.models import EmailProcessingLog, Sale
from app.time_utils import now

logger = logging.getLogger(__name__)

DEFAULT_EXPIRY_DAYS = 7
# Auto-created lifecycle types only; In Person sales are completed manually and
# Consignment stock lives at Alias with no shipment deadline of ours.
_EXPIRABLE_SALE_TYPES = ("Regular", "FilledOffer")


def _expiry_days() -> int:
    try:
        return max(1, int(os.getenv("STALE_SALE_EXPIRY_DAYS", str(DEFAULT_EXPIRY_DAYS))))
    except ValueError:
        return DEFAULT_EXPIRY_DAYS


def _append_note(sale: Sale, note: str):
    sale.notes = f"{sale.notes}\n{note}" if sale.notes else note


def apply_unlinked_cancellations() -> dict:
    """Apply Cancelled emails that never found their sale. Returns counts."""
    applied, missing = 0, 0
    logs = (
        EmailProcessingLog.query
        .filter_by(email_type="Cancelled", status="Success", linked_record_id=None)
        .all()
    )
    for log in logs:
        data = log.parsed_data or {}
        order_number = data.get("order_number")
        if not order_number:
            missing += 1
            continue
        sale = Sale.query.filter_by(order_number=order_number).first()
        if not sale:
            missing += 1
            continue
        changed = apply_cancellation(
            sale,
            cancellation_type=data.get("cancellation_type", "Unconfirmed"),
            fee_amount=data.get("fee_amount"),
        )
        log.linked_record_type = "Sale"
        log.linked_record_id = sale.sale_id
        if changed:
            _append_note(sale, "Cancelled via back-filled cancellation email.")
            applied += 1
    db.session.commit()
    if applied:
        logger.info(f"Back-filled {applied} cancellation emails onto sales.")
    return {"cancellations_applied": applied, "cancellations_unmatched": missing}


def expire_stale_sales() -> dict:
    """Auto-cancel abandoned sales. Returns counts + affected order numbers."""
    days = _expiry_days()
    cutoff = now() - timedelta(days=days)

    stale_pending = (
        Sale.query
        .filter(Sale.status == "Pending")
        .filter(Sale.sale_type.in_(_EXPIRABLE_SALE_TYPES) | (Sale.sale_type == None))  # noqa: E711
        .filter(Sale.created_at <= cutoff)
        .all()
    )
    stale_confirmed = (
        Sale.query
        .filter(Sale.status == "Confirmed")
        .filter(Sale.sale_type.in_(_EXPIRABLE_SALE_TYPES) | (Sale.sale_type == None))  # noqa: E711
        .filter(Sale.shipment_deadline != None)  # noqa: E711
        .filter(Sale.shipment_deadline <= cutoff)
        .all()
    )

    expired_pending, expired_confirmed = [], []
    for sale in stale_pending:
        if apply_cancellation(sale, cancellation_type="Unconfirmed"):
            _append_note(sale, f"Auto-expired: no confirmation within {days} days (Alias auto-cancels unaccepted orders).")
            expired_pending.append(sale.order_number)
    for sale in stale_confirmed:
        if apply_cancellation(sale, cancellation_type="Unconfirmed"):
            _append_note(sale, f"Auto-expired: shipment deadline passed more than {days} days ago with no shipment.")
            expired_confirmed.append(sale.order_number)

    db.session.commit()
    if expired_pending or expired_confirmed:
        logger.info(
            f"Auto-expired {len(expired_pending)} pending and {len(expired_confirmed)} "
            f"confirmed-but-unshipped sales (> {days}d)."
        )
    return {
        "expired_pending": len(expired_pending),
        "expired_confirmed_overdue": len(expired_confirmed),
        "expired_order_numbers": expired_pending + expired_confirmed,
        "expiry_days": days,
    }


def run_lifecycle_maintenance() -> dict:
    """Back-fill unlinked cancellations first (real emails win), then expire
    what remains abandoned. Must run inside an app context. Never raises."""
    summary = {}
    try:
        summary.update(apply_unlinked_cancellations())
    except Exception:
        db.session.rollback()
        logger.exception("apply_unlinked_cancellations failed")
    try:
        summary.update(expire_stale_sales())
    except Exception:
        db.session.rollback()
        logger.exception("expire_stale_sales failed")
    return summary
