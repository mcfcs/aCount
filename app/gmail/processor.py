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
from app.models.models import (
    Sale, Inventory, BankTransfer, BankTransferAllocation, Expense, EmailProcessingLog,
)
from app.gmail.classifier import classify_email
from app.gmail import parsers

logger = logging.getLogger(__name__)

# Issue-type keyword groups for Attention Needed branching (Spec §4.4)
_MOLD_KEYWORDS = {"mold"}
_WRONG_SIZE_SKU_KEYWORDS = {"wrong size", "wrong sku", "incorrect size", "incorrect sku"}


def process_message(gmail_message_id: str, subject: str, sender: str, body: str, sent_at=None) -> dict:
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
        result = _dispatch(email_type, subject, body, parsed_data, sent_at=sent_at)
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

def _dispatch(email_type: str, subject: str, body: str, parsed_data: dict, sent_at=None):
    """Route to the correct handler. Returns (record_type, record_id) or None."""

    if email_type == "Sale":
        data = parsers.parse_sale_notification(subject, body)
        parsed_data.update(data)
        return _handle_sale(data, sent_at=sent_at)

    elif email_type == "Confirmation":
        data = parsers.parse_confirmation(subject, body)
        parsed_data.update(data)
        return _handle_confirmation(data)

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
        # Buyer accepted discount — sale resumes normal flow, no status change needed
        logger.info(f"Buyer accepted for order {data.get('order_number')} — awaiting Completed email.")
        return None

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

def _handle_sale(data: dict, sent_at=None):
    """
    Spec 4.2 steps 1–5: Create Sale record + FIFO inventory match.
    """
    order_number = data.get("order_number")
    if not order_number:
        raise ValueError("Could not parse order_number from sale email.")

    existing_sale = Sale.query.filter_by(order_number=order_number).first()
    if existing_sale:
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
        sale_date=sent_at or datetime.utcnow(),
        status=initial_status,
        sale_type=sale_type,
        inventory_match_status="Unmatched",
        platform="Alias",
    )
    db.session.add(sale)
    db.session.flush()

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
            logger.info(f"FIFO matched sale #{order_number} → inventory_id={matched.inventory_id}")

    # Same-day emails (Sale + Confirmation/Completed) may arrive out of order.
    # If those emails were processed before this Sale was created, back-fill them now.
    _apply_deferred_confirmation(sale, order_number)
    if sale_type == "Consignment":
        _apply_deferred_completion(sale, order_number)

    db.session.commit()
    logger.info(f"Created Sale #{order_number} (sale_id={sale.sale_id})")
    return "Sale", sale.sale_id


def _handle_confirmation(data: dict):
    """
    Spec 4.2 step 20: Update sale to Confirmed, store deadline + pickup info.
    Never downgrades a sale that has already moved past Confirmed.
    """
    sale = _find_sale(data.get("order_number"))
    if not sale:
        return None

    _STATUS_ORDER = ["Pending", "Confirmed", "Shipped", "Completed"]
    current_rank = _STATUS_ORDER.index(sale.status) if sale.status in _STATUS_ORDER else -1
    confirmed_rank = _STATUS_ORDER.index("Confirmed")
    if current_rank < confirmed_rank:
        sale.status = "Confirmed"

    # Always update pickup/deadline fields regardless of status (re-scrape safe)
    sale.confirmation_datetime = sale.confirmation_datetime or datetime.utcnow()
    if data.get("shipment_deadline"):
        sale.shipment_deadline = data["shipment_deadline"]
    if data.get("pickup_address"):
        sale.pickup_address = data["pickup_address"]
    if data.get("pickup_window"):
        sale.pickup_window = data["pickup_window"]
    if data.get("amount_made"):
        sale.amount_made = data["amount_made"]

    db.session.commit()
    logger.info(f"Sale #{data.get('order_number')} → Confirmed (was {sale.status})")
    return "Sale", sale.sale_id


def _handle_shipped(data: dict):
    """Spec 4.2 step 21: Update sale to Shipped. Never downgrades."""
    sale = _find_sale(data.get("order_number"))
    if not sale:
        return None

    if sale.status not in ("Completed", "Shipped", "Cancelled", "Returned"):
        sale.status = "Shipped"
        sale.shipment_date = sale.shipment_date or datetime.utcnow()

    db.session.commit()
    logger.info(f"Sale #{data.get('order_number')} → Shipped")
    return "Sale", sale.sale_id


def _handle_completed(data: dict):
    """Spec 4.2 step 22: Update sale to Completed. Always applies (terminal forward state)."""
    sale = _find_sale(data.get("order_number"))
    if not sale:
        return None

    sale.status = "Completed"
    sale.completion_date = sale.completion_date or datetime.utcnow().date()
    if data.get("amount_made"):
        sale.amount_made = data["amount_made"]

    db.session.commit()
    logger.info(f"Sale #{data.get('order_number')} → Completed")
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
        sale.status = "Cancelled"
        sale.cancellation_date = datetime.utcnow().date()
        sale.cancellation_type = "Attention Needed"
        _restore_inventory(sale)
        db.session.commit()
        logger.info(f"Sale #{sale.order_number} → Cancelled (buyer declined discount)")
        return "Sale", sale.sale_id

    # Variant 2 — Standard attention needed
    issue_type = (data.get("issue_type") or "").lower()
    sale.issue_type = data.get("issue_type")

    # Path C — Mold
    if "mold" in issue_type:
        return _handle_mold_issue(sale)

    # Path B — Wrong Size or SKU
    if any(kw in issue_type for kw in _WRONG_SIZE_SKU_KEYWORDS):
        return _handle_wrong_size_sku_issue(sale)

    # Path A — Used Product / Authentication Issue (default)
    sale.status = "Attention Needed"
    sale.attention_needed_deadline = datetime.utcnow() + timedelta(hours=48)
    db.session.commit()
    logger.info(
        f"Sale #{data.get('order_number')} → Attention Needed (used product/auth issue), "
        f"deadline={sale.attention_needed_deadline.isoformat()}"
    )
    return "Sale", sale.sale_id


def _handle_mold_issue(sale: Sale):
    """
    Spec 4.4 Path C — Mold: cancel immediately, restore inventory, create fee placeholder.
    Fee amount is not specified in the spec — created with $0 for manual update.
    """
    sale.status = "Cancelled"
    sale.cancellation_date = datetime.utcnow().date()
    sale.cancellation_type = "Attention Needed"

    _restore_inventory(sale)

    expense = Expense(
        category="Platform Fee",
        description=f"Mold/Return fee — Order #{sale.order_number}",
        amount_original=0,
        original_currency="USD",
        amount_php=0,
        expense_date=date.today(),
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
    sale.status = "Cancelled"
    sale.cancellation_date = datetime.utcnow().date()
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
    if sale.status == "Cancelled":
        logger.info(f"Sale #{data.get('order_number')} already Cancelled — skipping.")
        return "Sale", sale.sale_id

    cancellation_type = data.get("cancellation_type", "Unconfirmed")
    fee_amount = data.get("fee_amount")

    sale.status = "Cancelled"
    sale.cancellation_date = datetime.utcnow().date()
    sale.cancellation_type = cancellation_type
    if fee_amount:
        sale.cancellation_fee = fee_amount

    _restore_inventory(sale)

    # Create fee expense for confirmed cancellations (Spec 4.3 Path B)
    if cancellation_type == "Confirmed" and fee_amount:
        conversion_rate = 56.0  # Default; replaced by live rate when available
        expense = Expense(
            category="Platform Fee",
            description=f"Cancellation fee — Order #{sale.order_number}",
            amount_original=fee_amount,
            original_currency="USD",
            amount_php=fee_amount * conversion_rate,
            conversion_rate=conversion_rate,
            expense_date=date.today(),
            source="Alias",
            linked_sale_id=sale.sale_id,
        )
        db.session.add(expense)
        logger.info(f"Created cancellation fee expense for Order #{sale.order_number}")

    db.session.commit()
    logger.info(f"Sale #{data.get('order_number')} → Cancelled ({cancellation_type})")
    return "Sale", sale.sale_id


def _handle_buyer_declined(sale: Sale):
    """
    Spec §2.1.3 / §4.4: Buyer declined discount after Attention Needed.

    1. Cancel original order (cancellation_type = Attention Needed).
    2. Create new Sale with order_number = original + 1, parent_order_number = original.
       New sale is Pending — seller will choose Consign or Return via the app.
    """
    sale.status = "Cancelled"
    sale.cancellation_date = datetime.utcnow().date()
    sale.cancellation_type = "Attention Needed"

    _restore_inventory(sale)

    # New re-order (Spec: order# = original + 1)
    new_order_number = sale.order_number + 1
    if not Sale.query.filter_by(order_number=new_order_number).first():
        reorder = Sale(
            order_number=new_order_number,
            parent_order_number=sale.order_number,
            sku=sale.sku,
            shoe_name=sale.shoe_name,
            size=sale.size,
            condition=sale.condition,
            box_condition=sale.box_condition,
            sale_date=datetime.utcnow(),
            status="Pending",
            inventory_match_status="Unmatched",
            platform="Alias",
            notes=f"Re-order: buyer declined discount on Order #{sale.order_number}. Awaiting Consign/Return.",
        )
        db.session.add(reorder)
        logger.info(f"Created re-order #{new_order_number} (parent #{sale.order_number}) — awaiting Consign/Return")

    db.session.commit()
    logger.info(f"Sale #{sale.order_number} → Cancelled (Buyer Declined)")
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
    transfer_date = sent_at or data.get("transfer_date") or datetime.utcnow()

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
                sale.status = "Confirmed"
                sale.confirmation_datetime = sale.confirmation_datetime or datetime.utcnow()
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
                sale.status = "Completed"
                sale.completion_date = datetime.utcnow().date()
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
    except Exception as e:
        logger.error(f"Failed to write EmailProcessingLog: {e}")
        db.session.rollback()
