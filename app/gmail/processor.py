"""
Email processor — orchestrates classify → parse → act → log.
Spec: Sections 3.2, 4.1–4.5, 9

Each processed email is:
  1. Checked against EmailProcessingLog for duplicates (by gmail_message_id)
  2. Classified by classifier.py
  3. Parsed by parsers.py
  4. Acted upon (creates/updates DB records)
  5. Logged to EmailProcessingLog
"""

import logging
from datetime import datetime, date, timedelta

from app import db
from sqlalchemy.exc import IntegrityError
from app.models.models import (
    Sale, Inventory, BankTransfer, BankTransferAllocation, Expense, EmailProcessingLog, Shoe,
)
from app.gmail.classifier import classify_email
from app.gmail import parsers
from app.time_utils import now, date_today
from app.shoe_images import save_shoe_image_bytes
from app.shoe_utils import ensure_shoe_exists

logger = logging.getLogger(__name__)

# Issue-type keyword groups for Attention Needed branching (Spec §4.4)
SALE_STATUS_HIERARCHY = [
    "Pending",
    "Confirmed",
    "Shipped",
    "Attention Needed",
    "Completed",
    "Cancelled",
]
SALE_STATUS_RANK = {status: idx for idx, status in enumerate(SALE_STATUS_HIERARCHY)}
MATCH_ELIGIBLE_STATUSES = ("Pending", "Confirmed")


def _can_advance_sale_status(current_status: str, next_status: str) -> bool:
    """
    Return True if next_status is forward progress for scrape-triggered updates.
    Returned/Consigned are treated as terminal and should not be downgraded.
    """
    if current_status in {"Returned", "Consigned"}:
        return False
    if current_status == next_status:
        return False
    current_rank = SALE_STATUS_RANK.get(current_status, -1)
    next_rank = SALE_STATUS_RANK.get(next_status)
    if next_rank is None:
        return False
    return next_rank > current_rank


def _set_sale_status_if_advanced(sale: Sale, next_status: str) -> bool:
    """
    Set sale.status only if it's a forward transition.
    Returns True only when the DB field changed.
    """
    if _can_advance_sale_status(sale.status, next_status):
        sale.status = next_status
        return True
    return False
def _match_sale_inventory(sale: Sale):
    """
    Attempt FIFO matching for a sale only when it is eligible.
    """
    if sale.inventory_match_status == "Matched":
        return None
    if sale.status not in MATCH_ELIGIBLE_STATUSES:
        return None
    if not sale.sku or sale.size is None:
        return None

    matched = (
        Inventory.query
        .filter_by(sku=sale.sku, size=sale.size, status="Available")
        .order_by(Inventory.date_purchased.asc())
        .first()
    )
    if matched:
        matched.status = "Sold"
        matched.linked_sale_id = sale.sale_id
        sale.inventory_match_status = "Matched"
        sale.purchase_cost = float(matched.purchase_cost) if matched.purchase_cost else None
        logger.info(f"FIFO matched sale #{sale.order_number} -> inventory_id={matched.inventory_id}")
    return matched


def _remove_sale_inventory_from_active(sale: Sale):
    """
    Mark currently linked inventory as sold so it is removed from active stock.
    """
    linked_items = Inventory.query.filter_by(
        linked_sale_id=sale.sale_id,
        status="Available",
    ).all()
    for item in linked_items:
        item.status = "Sold"


def _apply_status_inventory_side_effects(sale: Sale, status_updated: bool, new_status: str):
    if not status_updated:
        return
    if new_status == "Confirmed":
        _match_sale_inventory(sale)
    if new_status == "Shipped":
        _remove_sale_inventory_from_active(sale)

_WRONG_SIZE_SKU_KEYWORDS = {"wrong size", "wrong sku", "incorrect size", "incorrect sku"}


def process_message(gmail_message_id: str, subject: str, sender: str, body: str, sent_at=None, shoe_image=None) -> dict:
    """
    Main entry point. Processes one Gmail message end-to-end.
    Returns a summary dict: {email_type, status, record_type, record_id, error}
    """
    # ---- Duplicate check (Spec 9: check by GmailMessageID) ----------------
    existing = EmailProcessingLog.query.filter_by(
        gmail_message_id=gmail_message_id
    ).first()
    if existing:
        logger.info(f"Skipping duplicate: {gmail_message_id}")
        return {"status": "skipped", "reason": "already processed"}

    email_type = classify_email(sender, subject, body)
    parsed_data = {}
    record_type = None
    record_id = None
    error_message = None
    status = "Success"

    try:
        result = _dispatch(email_type, subject, body, parsed_data, sent_at=sent_at, shoe_image=shoe_image)
        if result:
            record_type, record_id = result
    except Exception as e:
        logger.exception(f"Failed processing {gmail_message_id}: {e}")
        error_message = str(e)
        status = "Failed"
        db.session.rollback()

    # ---- Log to EmailProcessingLog ----------------------------------------
    _write_log(
        gmail_message_id=gmail_message_id,
        email_type=email_type,
        status=status,
        parsed_data=parsed_data,
        error_message=error_message,
        record_type=record_type,
        record_id=record_id,
    )

    return {
        "email_type": email_type,
        "status": status,
        "record_type": record_type,
        "record_id": record_id,
        "error": error_message,
    }


# =============================================================================
# Dispatch table
# =============================================================================

def _dispatch(email_type: str, subject: str, body: str, parsed_data: dict, sent_at=None, shoe_image=None):
    """Route to the correct handler. Returns (record_type, record_id) or None."""

    if email_type == "Sale":
        data = parsers.parse_sale_notification(subject, body)
        parsed_data.update(data)
        return _handle_sale(data, sent_at=sent_at, shoe_image=shoe_image)

    elif email_type == "Confirmation":
        data = parsers.parse_confirmation(subject, body)
        parsed_data.update(data)
        return _handle_confirmation(data, shoe_image=shoe_image)

    elif email_type == "Shipped":
        data = parsers.parse_order_number_only(subject, body)
        parsed_data.update(data)
        return _handle_shipped(data)

    elif email_type == "Completed":
        data = parsers.parse_order_number_only(subject, body)
        parsed_data.update(data)
        return _handle_completed(data)

    elif email_type == "Attention":
        data = parsers.parse_attention_needed(subject, body)
        parsed_data.update(data)
        return _handle_attention_needed(data)

    elif email_type == "BuyerAccepted":
        data = parsers.parse_order_number_only(subject, body)
        parsed_data.update(data)
        return _handle_buyer_accepted(data)

    elif email_type == "Cancelled":
        data = parsers.parse_cancellation(subject, body)
        parsed_data.update(data)
        return _handle_cancellation(data)

    elif email_type == "BankTransfer":
        data = parsers.parse_bank_transfer(subject, body)
        parsed_data.update(data)
        return _handle_bank_transfer(data, sent_at=sent_at)

    elif email_type in ("Purchase", "Receipt", "Subscription", "Other"):
        logger.info(f"Email type '{email_type}' received — not yet implemented.")
        return None

    return None


# =============================================================================
# Handlers — one per email type
# =============================================================================

def _persist_sale_shoe_image_if_missing(data: dict, shoe_image: dict | None) -> str | None:
    if not shoe_image or not data.get("sku"):
        return None

    existing_shoe = Shoe.query.filter_by(sku=data.get("sku")).first()
    if existing_shoe and existing_shoe.image_path:
        return existing_shoe.image_path

    try:
        return save_shoe_image_bytes(
            shoe_image.get("data"),
            filename=shoe_image.get("filename"),
            content_type=shoe_image.get("content_type"),
        )
    except Exception as exc:
        logger.warning(
            f"Could not persist shoe image for SKU {data.get('sku')} from Gmail message: {exc}"
        )
        return None


def _maybe_backfill_shoe_from_email(data: dict, shoe_image: dict | None) -> str | None:
    if not data.get("sku"):
        return None

    image_path = _persist_sale_shoe_image_if_missing(data, shoe_image)
    created, _ = ensure_shoe_exists(
        data.get("sku"),
        data.get("shoe_name"),
        brand=None,
        image_path=image_path,
    )
    if created or image_path:
        db.session.flush()
    return image_path


def _handle_sale(data: dict, sent_at=None, shoe_image=None):
    """
    Spec 4.2 steps 1–5: Create Sale record + FIFO inventory match.
    """
    order_number = data.get("order_number")
    if not order_number:
        raise ValueError("Could not parse order_number from sale email.")

    image_path = _maybe_backfill_shoe_from_email(data, shoe_image)

    existing_sale = Sale.query.filter_by(order_number=order_number).first()
    if existing_sale:
        if existing_sale.status in MATCH_ELIGIBLE_STATUSES and existing_sale.inventory_match_status != "Matched":
            _match_sale_inventory(existing_sale)
        db.session.commit()
        logger.info(f"Sale #{order_number} already exists (sale_id={existing_sale.sale_id}).")
        return "Sale", existing_sale.sale_id

    # Consignment sales are auto-confirmed by Alias — no separate Confirmation email arrives
    sale_type = data.get("sale_type", "Regular")
    initial_status = "Confirmed" if sale_type == "Consignment" else "Pending"

    sale = Sale(
        order_number=order_number,
        sku=data.get("sku", "UNKNOWN"),
        shoe_name=data.get("shoe_name", "Unknown"),
        size=data.get("size", 0),
        condition=data.get("condition"),
        box_condition=data.get("box_condition"),
        selling_price=data.get("selling_price"),
        amount_made=data.get("amount_made"),
        sale_date=sent_at or now(),
        status=initial_status,
        sale_type=sale_type,
        inventory_match_status="Unmatched",
        platform="Alias",
    )
    try:
        db.session.add(sale)
        db.session.flush()
    except IntegrityError:
        # Another thread/workflow already inserted this order_number.
        # Keep operation idempotent by using the existing sale.
        db.session.rollback()
        existing_sale = Sale.query.filter_by(order_number=order_number).first()
        if existing_sale:
            logger.info(
                f"Race condition on Sale #{order_number}; using existing sale_id={existing_sale.sale_id}"
            )
            if existing_sale.status in MATCH_ELIGIBLE_STATUSES and existing_sale.inventory_match_status != "Matched":
                _match_sale_inventory(existing_sale)
            db.session.commit()
            return "Sale", existing_sale.sale_id
        raise

    # FIFO match (Spec 2.2.3)
    if sale.sku and sale.size:
        matched = (
            Inventory.query
            .filter_by(sku=sale.sku, size=sale.size, status="Available")
            .order_by(Inventory.date_purchased.asc())
            .first()
        )
        if matched:
            matched.status = "Sold"
            matched.linked_sale_id = sale.sale_id
            sale.inventory_match_status = "Matched"
            sale.purchase_cost = float(matched.purchase_cost) if matched.purchase_cost else None
            logger.info(f"FIFO matched sale #{order_number} → inventory_id={matched.inventory_id}")

    # Same-day emails (Sale + Confirmation/Completed) may arrive out of order.
    # If those emails were processed before this Sale was created, back-fill them now.
    _apply_deferred_confirmation(sale, order_number)
    if sale_type == "Consignment":
        _apply_deferred_completion(sale, order_number)

    db.session.commit()
    logger.info(f"Created Sale #{order_number} (sale_id={sale.sale_id})")
    return "Sale", sale.sale_id


def _handle_confirmation(data: dict, shoe_image=None):
    """
    Spec 4.2 step 20: Update sale to Confirmed, store deadline + pickup info.
    Never downgrades a sale that has already moved past Confirmed.
    """
    image_path = _maybe_backfill_shoe_from_email(data, shoe_image)
    sale = _find_sale(data.get("order_number"))
    if not sale:
        if image_path:
            db.session.commit()
        return None

    status_updated = _set_sale_status_if_advanced(sale, "Confirmed")
    _apply_status_inventory_side_effects(sale, status_updated, "Confirmed")

    # Always update pickup/deadline fields regardless of status (re-scrape safe)
    sale.confirmation_datetime = sale.confirmation_datetime or now()
    if data.get("shipment_deadline"):
        sale.shipment_deadline = data["shipment_deadline"]
    if data.get("pickup_address"):
        sale.pickup_address = data["pickup_address"]
    if data.get("pickup_window"):
        sale.pickup_window = data["pickup_window"]
    if data.get("amount_made"):
        sale.amount_made = data["amount_made"]

    db.session.commit()
    if status_updated:
        logger.info(f"Sale #{data.get('order_number')} transitioned to Confirmed")
    else:
        logger.info(f"Sale #{data.get('order_number')} confirmation fields updated (status unchanged)")
    return "Sale", sale.sale_id


def _handle_shipped(data: dict):
    """Spec 4.2 step 21: Update sale to Shipped. Never downgrades."""
    sale = _find_sale(data.get("order_number"))
    if not sale:
        return None

    status_updated = _set_sale_status_if_advanced(sale, "Shipped")
    if status_updated:
        sale.shipment_date = sale.shipment_date or now()
    _apply_status_inventory_side_effects(sale, status_updated, "Shipped")

    db.session.commit()
    if status_updated:
        logger.info(f"Sale #{data.get('order_number')} transitioned to Shipped")
    else:
        logger.info(f"Sale #{data.get('order_number')} already at or ahead of Shipped; no status change.")
    return "Sale", sale.sale_id


def _handle_completed(data: dict):
    """Spec 4.2 step 22: Update sale to Completed. Always applies (terminal forward state)."""
    sale = _find_sale(data.get("order_number"))
    if not sale:
        return None

    status_updated = _set_sale_status_if_advanced(sale, "Completed")
    sale.completion_date = sale.completion_date or date_today()
    if data.get("amount_made"):
        sale.amount_made = data["amount_made"]

    db.session.commit()
    if status_updated:
        logger.info(f"Sale #{data.get('order_number')} transitioned to Completed")
    else:
        logger.info(f"Sale #{data.get('order_number')} already at or beyond Completed; no status change.")
    return "Sale", sale.sale_id


def _handle_buyer_accepted(data: dict):
    """Spec 4.3/4.4: update amount after buyer accepted discount offer."""
    sale = _find_sale(data.get("order_number"))
    if not sale:
        return None

    if data.get("amount_made") is not None:
        accepted_amount = data["amount_made"]
        if sale.amount_made is None or accepted_amount < float(sale.amount_made):
            sale.amount_made = accepted_amount
            db.session.commit()
            logger.info(f"Updated amount_made for Sale #{data.get('order_number')} to {accepted_amount} from BuyerAccepted email")
            return "Sale", sale.sale_id
        logger.info(
            f"Ignored higher/equal amount_made for Sale #{data.get('order_number')} "
            f"from BuyerAccepted (existing={sale.amount_made}, incoming={accepted_amount})"
        )
        return "Sale", sale.sale_id

    db.session.commit()
    logger.info(f"No amount_made in BuyerAccepted email for Sale #{data.get('order_number')} (no change)")
    return "Sale", sale.sale_id


def _handle_attention_needed(data: dict):
    """
    Spec 4.4: Two Attention Needed variants.

    Variant 1 — Buyer Declined (second email):
        "the buyer declined the discount" → order already cancelled by Alias.
        Seller must choose Consign or Return. Triggers buyer-declined flow.

    Variant 2 — Standard (first email, issue discovered):
        Path A — Used Product / Auth Issue: set Attention Needed + 48hr deadline.
        Path B — Wrong Size / SKU: auto-consign + cancel.
        Path C — Mold: cancel immediately + fee placeholder.
    """
    sale = _find_sale(data.get("order_number"))
    if not sale:
        return None

    # Variant 1 — Buyer declined the offered discount; order cancelled by Alias
    if data.get("buyer_declined"):
        return _handle_buyer_declined_no_reorder(sale)

    issue_type = (data.get("issue_type") or "").lower()
    sale.issue_type = data.get("issue_type")
    status_updated = _set_sale_status_if_advanced(sale, "Attention Needed")

    # Path C — Mold
    if "mold" in issue_type:
        return _handle_mold_issue(sale)

    # Path B — Wrong Size or SKU
    if any(kw in issue_type for kw in _WRONG_SIZE_SKU_KEYWORDS):
        return _handle_wrong_size_sku_issue(sale)

    # Path A — Used Product / Authentication Issue (default)
    if status_updated:
        sale.attention_needed_deadline = sale.attention_needed_deadline or (
            now() + timedelta(hours=48)
        )

    db.session.commit()
    if status_updated:
        logger.info(f"Sale #{data.get('order_number')} transitioned to Attention Needed")
    else:
        logger.info(f"Sale #{data.get('order_number')} already at or beyond Attention Needed; no status change.")
    return "Sale", sale.sale_id

def _handle_mold_issue(sale: Sale):
    """
    Spec 4.4 Path C — Mold: cancel immediately, restore inventory, create fee placeholder.
    Fee amount is not specified in the spec — created with $0 for manual update.
    """
    if not _set_sale_status_if_advanced(sale, "Cancelled"):
        return "Sale", sale.sale_id

    sale.cancellation_date = date_today()
    sale.cancellation_type = "Attention Needed"

    _restore_inventory(sale)

    expense = Expense(
        category="Platform Fee",
        description=f"Mold/Return fee — Order #{sale.order_number}",
        amount_original=0,
        original_currency="USD",
        amount_php=0,
        expense_date=date_today(),
        source="Alias",
        linked_sale_id=sale.sale_id,
    )
    db.session.add(expense)
    db.session.commit()
    logger.info(f"Sale #{sale.order_number} → Cancelled (Mold) — fee record created for manual update")
    return "Sale", sale.sale_id


def _handle_wrong_size_sku_issue(sale: Sale):
    """
    Spec 4.4 Path B — Wrong Size/SKU:
    Auto-consign inventory, cancel original sale.
    """
    if not _set_sale_status_if_advanced(sale, "Cancelled"):
        return "Sale", sale.sale_id

    sale.cancellation_date = date_today()
    sale.cancellation_type = "Attention Needed"

    # Consign the linked inventory item (Spec 2.2.2: Sold → Consigned)
    linked_items = Inventory.query.filter_by(linked_sale_id=sale.sale_id).all()
    for item in linked_items:
        item.status = "Consigned"
        item.linked_sale_id = None

    db.session.commit()
    logger.info(f"Sale #{sale.order_number} → Cancelled + Inventory Consigned (Wrong Size/SKU)")
    return "Sale", sale.sale_id


def _handle_cancellation(data: dict):
    """
    Spec 4.3: Cancel sale, restore inventory.

    Path A (Unconfirmed) — no fee.
    Path B (Confirmed)   — create $10 expense record.

    Note: Buyer-declined cancellations are now handled directly by the
    second Attention Needed email ("buyer declined the discount") before
    any Cancellation email arrives. If this handler finds an already-
    Cancelled sale, skip gracefully.
    """
    sale = _find_sale(data.get("order_number"))
    if not sale:
        return None

    # Already cancelled (e.g. buyer-declined Attention Needed email processed first)
    if not _set_sale_status_if_advanced(sale, "Cancelled"):
        logger.info(f"Sale #{data.get('order_number')} already at or beyond Cancelled; no status change.")
        return "Sale", sale.sale_id

    cancellation_type = data.get("cancellation_type", "Unconfirmed")
    fee_amount = data.get("fee_amount")

    sale.cancellation_date = date_today()
    sale.cancellation_type = cancellation_type
    if fee_amount:
        sale.cancellation_fee = fee_amount

    _restore_inventory(sale)

    # Create fee expense for confirmed cancellations (Spec 4.3 Path B)
    if cancellation_type == "Confirmed" and fee_amount:
        from app.utils import get_php_estimate_rate
        conversion_rate = get_php_estimate_rate()  # honours the rate set in Settings
        expense = Expense(
            category="Platform Fee",
            description=f"Cancellation fee — Order #{sale.order_number}",
            amount_original=fee_amount,
            original_currency="USD",
            amount_php=fee_amount * conversion_rate,
            conversion_rate=conversion_rate,
            expense_date=date_today(),
            source="Alias",
            linked_sale_id=sale.sale_id,
        )
        db.session.add(expense)
        logger.info(f"Created cancellation fee expense for Order #{sale.order_number}")

    db.session.commit()
    logger.info(f"Sale #{data.get('order_number')} → Cancelled ({cancellation_type})")
    return "Sale", sale.sale_id


def _handle_buyer_declined_no_reorder(sale: Sale):
    """Handle buyer declined without creating a new re-order sale."""
    if not _set_sale_status_if_advanced(sale, "Cancelled"):
        return "Sale", sale.sale_id

    sale.cancellation_date = date_today()
    sale.cancellation_type = "Attention Needed"

    _restore_inventory(sale)

    db.session.commit()
    logger.info(f"Sale #{sale.order_number} -> Cancelled (Buyer Declined / Attention Needed)")
    return "Sale", sale.sale_id

def _handle_bank_transfer(data: dict, sent_at=None):
    """
    Spec 4.5: Create BankTransfer record; auto-reconcile if possible.
    Uses the email's sent date as transfer_date (most reliable).
    Skips creation if a transfer with the same amount + date already exists (dedup).
    """
    amount_php = data.get("amount_php")
    if not amount_php:
        raise ValueError("Could not parse amount_php from bank transfer email.")

    # Use email sent date as the canonical transfer date
    transfer_date = sent_at or data.get("transfer_date") or now()

    # Dedup: skip if a transfer with the same amount on the same day already exists
    existing = BankTransfer.query.filter(
        BankTransfer.amount_php == amount_php,
        db.func.date(BankTransfer.transfer_date) == transfer_date.date(),
    ).first()
    if existing:
        logger.info(
            f"BankTransfer for ₱{amount_php} on {transfer_date.date()} already exists "
            f"(transfer_id={existing.transfer_id}) — skipping."
        )
        return "BankTransfer", existing.transfer_id

    transfer = BankTransfer(
        amount_php=amount_php,
        bank_name=data.get("bank_name", "Unknown"),
        account_last4=data.get("account_last4", "0000"),
        transfer_date=transfer_date,
        reconciliation_status="Unreconciled",
    )
    db.session.add(transfer)
    db.session.flush()

    _auto_reconcile_transfer(transfer)

    db.session.commit()
    logger.info(
        f"Created BankTransfer transfer_id={transfer.transfer_id} "
        f"₱{amount_php:,.2f} [{transfer.reconciliation_status}]"
    )
    return "BankTransfer", transfer.transfer_id


def _auto_reconcile_transfer(transfer: BankTransfer):
    """
    Spec 4.5 step 43: Match transfer to Completed sales by date proximity.

    Strategy:
    - Find Completed sales within the last 30 days not yet allocated to any transfer.
    - If exactly one candidate: allocate 100% → Reconciled.
    - If multiple candidates: flag Unreconciled for manual review.
    """
    window_start = (transfer.transfer_date - timedelta(days=30)).date()

    already_allocated_ids = {
        row[0] for row in db.session.query(BankTransferAllocation.sale_id).all()
    }

    candidates = (
        Sale.query
        .filter(Sale.status == "Completed")
        .filter(Sale.completion_date >= window_start)
        .all()
    )
    unallocated = [s for s in candidates if s.sale_id not in already_allocated_ids]

    if not unallocated:
        logger.info(f"BankTransfer {transfer.transfer_id}: no unallocated completed sales — Unreconciled.")
        return

    if len(unallocated) == 1:
        allocation = BankTransferAllocation(
            transfer_id=transfer.transfer_id,
            sale_id=unallocated[0].sale_id,
            allocated_amount=transfer.amount_php,
        )
        db.session.add(allocation)
        transfer.reconciliation_status = "Reconciled"
        logger.info(
            f"Auto-reconciled transfer {transfer.transfer_id} "
            f"→ sale_id={unallocated[0].sale_id}"
        )
    else:
        logger.info(
            f"BankTransfer {transfer.transfer_id}: {len(unallocated)} candidate sales "
            f"— manual reconciliation required."
        )


# =============================================================================
# Helpers
# =============================================================================

def _apply_deferred_confirmation(sale: Sale, order_number: int):
    """
    If a Confirmation email was processed before the Sale notification (same-day
    ordering), its log entry exists with linked_record_id=None. Apply it now.
    """
    try:
        deferred_logs = (
            EmailProcessingLog.query
            .filter_by(email_type="Confirmation", linked_record_id=None)
            .all()
        )
        for log in deferred_logs:
            if log.parsed_data and log.parsed_data.get("order_number") == order_number:
                data = log.parsed_data
                _set_sale_status_if_advanced(sale, "Confirmed")
                sale.confirmation_datetime = sale.confirmation_datetime or now()
                if data.get("shipment_deadline"):
                    try:
                        sale.shipment_deadline = datetime.fromisoformat(data["shipment_deadline"])
                    except (ValueError, TypeError):
                        pass
                if data.get("pickup_address"):
                    sale.pickup_address = data["pickup_address"]
                if data.get("pickup_window"):
                    sale.pickup_window = data["pickup_window"]
                if data.get("amount_made"):
                    sale.amount_made = float(data["amount_made"])
                _apply_status_inventory_side_effects(sale, True, "Confirmed")
                log.linked_record_id = sale.sale_id
                log.linked_record_type = "Sale"
                logger.info(f"Applied deferred confirmation to #{order_number}")
                break
    except Exception as e:
        logger.warning(f"Could not apply deferred confirmation for #{order_number}: {e}")


def _apply_deferred_completion(sale: Sale, order_number: int):
    """
    If a Completed email was processed before the Sale notification (same-day
    ordering issue), its log entry exists with linked_record_id=None.
    Find it and apply the completion data to the just-created sale.
    """
    try:
        deferred_logs = (
            EmailProcessingLog.query
            .filter_by(email_type="Completed", linked_record_id=None)
            .all()
        )
        for log in deferred_logs:
            if log.parsed_data and log.parsed_data.get("order_number") == order_number:
                amount_made = log.parsed_data.get("amount_made")
                _set_sale_status_if_advanced(sale, "Completed")
                sale.completion_date = date_today()
                if amount_made:
                    sale.amount_made = float(amount_made)
                # Link the log entry now that the sale exists
                log.linked_record_id = sale.sale_id
                log.linked_record_type = "Sale"
                logger.info(
                    f"Applied deferred completion to consignment #{order_number} "
                    f"(amount_made={amount_made})"
                )
                break
    except Exception as e:
        logger.warning(f"Could not apply deferred completion for #{order_number}: {e}")


def _find_sale(order_number: int | None) -> Sale | None:
    if not order_number:
        logger.warning("No order_number parsed — cannot find sale.")
        return None
    sale = Sale.query.filter_by(order_number=order_number).first()
    if not sale:
        logger.warning(f"Sale not found for order_number={order_number}")
    return sale


def _restore_inventory(sale: Sale):
    """Restore linked inventory to Available on cancellation/return (Spec 2.2.2)."""
    linked_items = Inventory.query.filter_by(linked_sale_id=sale.sale_id, status="Sold").all()
    for item in linked_items:
        item.status = "Available"
        item.linked_sale_id = None
    if linked_items:
        sale.inventory_match_status = "Unmatched"


def _serialize_parsed_data(data: dict) -> dict:
    """Convert any non-JSON-serializable values (datetime, date) to ISO strings."""
    result = {}
    for k, v in data.items():
        if isinstance(v, (datetime, date)):
            result[k] = v.isoformat()
        else:
            result[k] = v
    return result


def _write_log(gmail_message_id, email_type, status, parsed_data,
               error_message, record_type, record_id):
    """
    Persist processing metadata.
    Duplicate gmail_message_id conflicts are treated as idempotent replays.
    """
    try:
        log = EmailProcessingLog(
            gmail_message_id=gmail_message_id,
            email_type=email_type,
            status=status,
            parsed_data=_serialize_parsed_data(parsed_data) if parsed_data else None,
            error_message=error_message,
            linked_record_type=record_type,
            linked_record_id=record_id,
        )
        db.session.add(log)
        db.session.commit()
    except IntegrityError as e:
        # Another worker/thread may have already logged this message.
        if "email_processing_log_gmail_message_id_key" in str(e.orig):
            logger.info(f"Skipping duplicate email log for message {gmail_message_id}")
        else:
            logger.warning(f"Integrity error while writing EmailProcessingLog for {gmail_message_id}: {e}")
        db.session.rollback()
    except Exception as e:
        logger.error(f"Failed to write EmailProcessingLog: {e}")
        db.session.rollback()




