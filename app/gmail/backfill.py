"""
Historical email backfill.

The processing log records every email ever seen (with its Gmail message id),
but two classes of rows never produced records:

1. Merchant emails (Subscription / Purchase / Receipt) ingested before their
   handlers existed — logged "Success" with no linked record, skipped forever
   by the duplicate check.
2. "Failed" rows — crashes (e.g. the shoes SKU race) permanently dropped real
   sales.

`backfill_from_log` re-fetches those exact messages by id and runs them
through the current pipeline: merchant rows go straight to their handlers and
the log row is updated in place; failed rows are deleted and fully
re-processed via process_message (fresh classification + logging).
"""

import logging

from googleapiclient.errors import HttpError

from app import db
from app.gmail import parsers, processor
from app.gmail.auth import get_gmail_service
from app.gmail.parsers import get_message_parts
from app.models.models import EmailProcessingLog, Expense

logger = logging.getLogger(__name__)

MERCHANT_TYPES = ("Subscription", "Purchase", "Receipt")


def reparse_merchant_expenses(app, limit=1000, dry_run=False) -> dict:
    """Re-parse already-created merchant expenses through the improved parser.

    Corrects rows captured before the net-total fix (which grabbed the
    pre-discount subtotal), fills in the real item name as the description, adds
    the order-breakdown snippet to notes, and stamps the Gmail message id so the
    detail view can open the receipt. Updates each Expense IN PLACE (keyed via
    its EmailProcessingLog), so no duplicate rows are created.

    With dry_run=True nothing is written — the summary's `changes` lists what
    WOULD change (old→new amount), for review first.
    """
    with app.app_context():
        try:
            service = get_gmail_service()
        except RuntimeError as exc:
            return {"status": "error", "error": str(exc)}

        summary = {
            "scanned": 0, "amount_corrected": 0, "description_updated": 0,
            "snippet_added": 0, "message_id_added": 0, "not_found": 0,
            "no_amount": 0, "errors": 0, "total_php_delta": 0.0, "changes": [],
        }

        logs = (
            EmailProcessingLog.query
            .filter(EmailProcessingLog.email_type.in_(MERCHANT_TYPES))
            .filter(EmailProcessingLog.status == "Success")
            .filter(EmailProcessingLog.linked_record_type == "Expense")
            .filter(EmailProcessingLog.linked_record_id.isnot(None))
            .order_by(EmailProcessingLog.processed_at.asc())
            .limit(limit)
            .all()
        )

        for log in logs:
            expense = db.session.get(Expense, log.linked_record_id)
            if not expense:
                continue
            summary["scanned"] += 1

            try:
                message = _fetch_message(service, log.gmail_message_id)
            except HttpError as exc:
                status = getattr(getattr(exc, "resp", None), "status", None)
                if str(status) == "404":
                    summary["not_found"] += 1
                else:
                    summary["errors"] += 1
                continue
            except Exception:
                logger.exception(f"Reparse fetch failed for {log.gmail_message_id}")
                summary["errors"] += 1
                continue

            try:
                subject, sender, body, _sent_at = get_message_parts(message)
                data = parsers.parse_payment_amount(subject, body)
                if not data.get("amount"):
                    summary["no_amount"] += 1
                    continue

                merchant = parsers.parse_merchant(sender)
                amount_original, currency, amount_php, rate = processor._expense_amounts(data)
                items = parsers.parse_order_items(body)
                new_desc = parsers.summarize_items(items)
                snippet = parsers.build_charge_snippet(subject, body, items)

                old_php = float(expense.amount_php or 0)
                changed = False

                if abs(float(amount_original) - float(expense.amount_original or 0)) > 0.005:
                    summary["changes"].append({
                        "expense_id": expense.expense_id,
                        "source": expense.source,
                        "old_php": old_php,
                        "new_php": round(float(amount_php), 2),
                        "description": new_desc or expense.description,
                    })
                    if not dry_run:
                        expense.amount_original = amount_original
                        expense.original_currency = currency
                        expense.amount_php = amount_php
                        expense.conversion_rate = rate
                    summary["amount_corrected"] += 1
                    summary["total_php_delta"] += round(float(amount_php) - old_php, 2)
                    changed = True

                if new_desc and new_desc != expense.description:
                    if not dry_run:
                        expense.description = new_desc
                    summary["description_updated"] += 1
                    changed = True

                if snippet and snippet != (expense.notes or ""):
                    if not dry_run:
                        expense.notes = snippet
                    summary["snippet_added"] += 1
                    changed = True

                if not expense.gmail_message_id:
                    if not dry_run:
                        expense.gmail_message_id = log.gmail_message_id
                    summary["message_id_added"] += 1
                    changed = True

                if changed and not dry_run:
                    db.session.commit()
            except Exception:
                db.session.rollback()
                logger.exception(f"Reparse processing failed for {log.gmail_message_id}")
                summary["errors"] += 1

        summary["total_php_delta"] = round(summary["total_php_delta"], 2)
        logger.info(f"Merchant expense reparse: {summary}")
        return summary


def _fetch_message(service, msg_id):
    return service.users().messages().get(userId="me", id=msg_id, format="full").execute()


def backfill_from_log(app, limit=200, include_failed=True) -> dict:
    """Re-process logged-but-recordless emails. Returns a summary dict."""
    with app.app_context():
        try:
            service = get_gmail_service()
        except RuntimeError as exc:
            return {"status": "error", "error": str(exc)}

        summary = {
            "merchant_processed": 0, "records_created": 0, "no_amount": 0,
            "failed_reprocessed": 0, "not_found": 0, "errors": 0, "remaining": 0,
        }

        merchant_logs = (
            EmailProcessingLog.query
            .filter(EmailProcessingLog.email_type.in_(MERCHANT_TYPES))
            .filter(EmailProcessingLog.status == "Success")
            .filter(EmailProcessingLog.linked_record_id == None)  # noqa: E711
            .filter(EmailProcessingLog.linked_record_type == None)  # noqa: E711  (skip "NoCharge"-stamped rows)
            .order_by(EmailProcessingLog.processed_at.asc())
            .limit(limit)
            .all()
        )

        for log in merchant_logs:
            try:
                message = _fetch_message(service, log.gmail_message_id)
            except HttpError as exc:
                status = getattr(getattr(exc, "resp", None), "status", None)
                if str(status) == "404":
                    summary["not_found"] += 1
                    continue
                logger.warning(f"Backfill fetch failed for {log.gmail_message_id}: {exc}")
                summary["errors"] += 1
                continue

            try:
                subject, sender, body, sent_at = get_message_parts(message)
                data = parsers.parse_payment_amount(subject, body)
                data["merchant"] = parsers.parse_merchant(sender)
                log.parsed_data = data

                if log.email_type == "Subscription":
                    result = processor._handle_subscription_charge(data, subject, sent_at=sent_at)
                else:
                    result = processor._handle_merchant_purchase(data, subject, sent_at=sent_at)

                summary["merchant_processed"] += 1
                if result:
                    log.linked_record_type, log.linked_record_id = result
                    summary["records_created"] += 1
                else:
                    # Promo/no-charge email: stamp it so later runs converge
                    # instead of re-fetching it forever.
                    log.linked_record_type = "NoCharge"
                    summary["no_amount"] += 1
                db.session.commit()
            except Exception:
                db.session.rollback()
                logger.exception(f"Backfill processing failed for {log.gmail_message_id}")
                summary["errors"] += 1

        if include_failed:
            failed_logs = EmailProcessingLog.query.filter_by(status="Failed").all()
            for log in failed_logs:
                msg_id = log.gmail_message_id
                try:
                    message = _fetch_message(service, msg_id)
                except HttpError as exc:
                    status = getattr(getattr(exc, "resp", None), "status", None)
                    if str(status) == "404":
                        summary["not_found"] += 1
                    else:
                        summary["errors"] += 1
                    continue

                try:
                    subject, sender, body, sent_at = get_message_parts(message)
                    email_type = processor.classify_email(sender, subject, body)
                    shoe_image = (
                        parsers.extract_largest_image_part(service, message)
                        if email_type in {"Sale", "Confirmation"} else None
                    )
                    label_url = (
                        parsers.extract_shipping_label_url(message)
                        if email_type == "Confirmation" else None
                    )
                    # Clear the Failed row so process_message's dedup lets it through.
                    db.session.delete(log)
                    db.session.commit()
                    result = processor.process_message(
                        msg_id, subject, sender, body, sent_at=sent_at,
                        shoe_image=shoe_image, shipping_label_url=label_url,
                    )
                    if result.get("status") == "Success":
                        summary["failed_reprocessed"] += 1
                    else:
                        summary["errors"] += 1
                except Exception:
                    db.session.rollback()
                    logger.exception(f"Failed-row reprocess crashed for {msg_id}")
                    summary["errors"] += 1

        summary["remaining"] = (
            EmailProcessingLog.query
            .filter(EmailProcessingLog.email_type.in_(MERCHANT_TYPES))
            .filter(EmailProcessingLog.status == "Success")
            .filter(EmailProcessingLog.linked_record_id == None)  # noqa: E711
            .filter(EmailProcessingLog.linked_record_type == None)  # noqa: E711
            .count()
        )
        logger.info(f"Email backfill: {summary}")
        return summary
