"""
Gmail poller — fetches new emails and dispatches them to the processor.
Spec: Section 3.4 (Polling Strategy)

Uses Gmail API history.list to fetch only messages since the last poll.
Persists the last historyId to a local state file to survive restarts.
Poll interval is configurable via GMAIL_POLL_INTERVAL_SECONDS (default: 300).
"""

import os
import json
import logging
import time
import copy
import threading
from typing import Optional

from app.gmail.auth import get_gmail_service
from app.gmail.parsers import get_message_parts, extract_largest_image_part, extract_shipping_label_url
from app.gmail.processor import process_message
from app.gmail.classifier import classify_email
from googleapiclient.errors import HttpError
from app.time_utils import now

logger = logging.getLogger(__name__)

STATE_FILE = os.path.join(os.path.dirname(__file__), ".poll_state.json")
ALIAS_SENDER = "info@alias.org"

_SCRAPE_STATUS_LOCK = threading.Lock()
_SCRAPE_STATUS = {
    "running": False,
    "after": None,
    "before": None,
    "force": False,
    "cancelling": False,
    "total_fetched": 0,
    "processed": 0,
    "skipped": 0,
    "error": None,
    "started_at": None,
    "finished_at": None,
}
_SCRAPE_CANCEL_EVENT = threading.Event()


def _set_scrape_status(update: dict):
    with _SCRAPE_STATUS_LOCK:
        _SCRAPE_STATUS.update(update)


def get_scrape_status() -> dict:
    with _SCRAPE_STATUS_LOCK:
        return copy.copy(_SCRAPE_STATUS)


def cancel_scrape() -> dict:
    with _SCRAPE_STATUS_LOCK:
        if not _SCRAPE_STATUS["running"]:
            return {"status": "not_running", "message": "No scrape is currently running."}

        _SCRAPE_CANCEL_EVENT.set()
        _SCRAPE_STATUS["cancelling"] = True
        return {"status": "cancelling", "message": "Scrape cancel requested."}


# =============================================================================
# State persistence (last historyId)
# =============================================================================

def _load_state() -> dict:
    if os.path.exists(STATE_FILE):
        try:
            with open(STATE_FILE, "r") as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            pass
    return {"history_id": None, "last_poll": None}


def _save_state(state: dict):
    try:
        with open(STATE_FILE, "w") as f:
            json.dump(state, f)
    except IOError as e:
        logger.error(f"Could not save poll state: {e}")


# =============================================================================
# Core poll logic
# =============================================================================

def poll_once(app) -> dict:
    """
    Fetch and process all new emails since the last poll.
    Must be called within a Flask app context (app.app_context()).
    Returns a summary dict.
    """
    with app.app_context():
        try:
            service = get_gmail_service()
        except RuntimeError as e:
            logger.error(f"Gmail auth failed: {e}")
            return {"status": "error", "error": str(e), "processed": 0}

        state = _load_state()
        history_id = state.get("history_id")

        try:
            if history_id:
                messages = _fetch_since_history(service, history_id)
            else:
                # First run: fetch recent unread emails from alias.org
                messages = _fetch_recent(service)
        except Exception as e:
            logger.error(f"Gmail API fetch failed: {e}")
            return {"status": "error", "error": str(e), "processed": 0}

        # Process oldest-first so state transitions flow correctly
        messages = list(reversed(_dedupe_message_ids(messages)))

        processed = 0
        results = []

        for msg_id in messages:
            try:
                full_msg = service.users().messages().get(
                    userId="me", id=msg_id, format="full"
                ).execute()

                subject, sender, body, sent_at = get_message_parts(full_msg)
                email_type = classify_email(sender, subject, body)
                shoe_image = extract_largest_image_part(service, full_msg) if email_type in {"Sale", "Confirmation"} else None
                shipping_label_url = extract_shipping_label_url(full_msg) if email_type == "Confirmation" else None
                result = process_message(msg_id, subject, sender, body, sent_at=sent_at, shoe_image=shoe_image, shipping_label_url=shipping_label_url)
                results.append(result)

                if result.get("status") != "skipped":
                    processed += 1

                # Update historyId to the latest seen
                msg_history_id = full_msg.get("historyId")
                if msg_history_id:
                    if not state.get("history_id") or int(msg_history_id) > int(state["history_id"]):
                        state["history_id"] = msg_history_id

            except HttpError as e:
                status = getattr(getattr(e, "resp", None), "status", None)
                if str(status) == "404":
                    logger.warning(f"Skipping missing message {msg_id}: {e}")
                    results.append({"message_id": msg_id, "status": "skipped", "reason": "not_found"})
                else:
                    logger.exception(f"Error processing message {msg_id}: {e}")
            except Exception as e:
                logger.exception(f"Error processing message {msg_id}: {e}")

        state["last_poll"] = now().isoformat()
        _save_state(state)

        logger.info(f"Poll complete: {processed} new emails processed.")
        return {
            "status": "ok",
            "processed": processed,
            "total_fetched": len(messages),
            "results": results,
            "last_history_id": state.get("history_id"),
        }


def _fetch_since_history(service, history_id: str) -> list[str]:
    """
    Spec 3.4: Use history.list to fetch only new messages since last poll.
    Returns list of message IDs.
    """
    message_ids = []
    page_token = None

    while True:
        kwargs = {
            "userId": "me",
            "startHistoryId": history_id,
            "historyTypes": ["messageAdded"],
        }
        if page_token:
            kwargs["pageToken"] = page_token

        try:
            response = service.users().history().list(**kwargs).execute()
        except Exception as e:
            # historyId may have expired — fall back to recent fetch
            logger.warning(f"History fetch failed (historyId may be stale): {e}")
            return _fetch_recent(service)

        for history_item in response.get("history", []):
            for msg in history_item.get("messagesAdded", []):
                message_ids.append(msg["message"]["id"])

        page_token = response.get("nextPageToken")
        if not page_token:
            break

    return message_ids


def _fetch_recent(service, max_results: int = 50) -> list[str]:
    """
    Fallback: Fetch recent messages from info@alias.org using messages.list.
    Used on first run or when historyId is stale.
    """
    query = f"from:{ALIAS_SENDER}"
    message_ids = []
    page_token = None

    while len(message_ids) < max_results:
        kwargs = {
            "userId": "me",
            "q": query,
            "maxResults": min(max_results - len(message_ids), 100),
        }
        if page_token:
            kwargs["pageToken"] = page_token

        response = service.users().messages().list(**kwargs).execute()
        for msg in response.get("messages", []):
            message_ids.append(msg["id"])

        page_token = response.get("nextPageToken")
        if not page_token:
            break

    return message_ids


def fetch_date_range(service, after: str, before: str = None, max_results: int = 500) -> list[str]:
    """
    Fetch all messages from info@alias.org between two dates.
    after / before are ISO date strings: "2026-03-01"
    Gmail query uses YYYY/MM/DD format.
    """
    after_gm = after.replace("-", "/")
    query = f"from:{ALIAS_SENDER} after:{after_gm}"
    if before:
        before_gm = before.replace("-", "/")
        query += f" before:{before_gm}"

    message_ids = []
    page_token = None

    while len(message_ids) < max_results:
        kwargs = {
            "userId": "me",
            "q": query,
            "maxResults": min(max_results - len(message_ids), 100),
        }
        if page_token:
            kwargs["pageToken"] = page_token

        response = service.users().messages().list(**kwargs).execute()
        for msg in response.get("messages", []):
            message_ids.append(msg["id"])

        page_token = response.get("nextPageToken")
        if not page_token:
            break

    return message_ids


def scrape_date_range(app, after: str, before: str = None, force: bool = False) -> dict:
    return _scrape_date_range_internal(
        app=app,
        after=after,
        before=before,
        force=force,
        progress_cb=None,
    )


# =============================================================================
# Shipping-label targeted fetch ("capture the latest N labels")
# =============================================================================

LABEL_SUBJECT_PHRASE = "Shipping Label and Instructions"


def fetch_latest_label_message_ids(service, limit: int = 10) -> list[str]:
    """
    Fetch the newest "…Shipping Label and Instructions" message IDs from Alias.
    Gmail messages.list returns newest-first; we return at most `limit` IDs.
    """
    query = f'from:{ALIAS_SENDER} subject:"{LABEL_SUBJECT_PHRASE}"'
    message_ids: list[str] = []
    page_token = None

    while len(message_ids) < limit:
        kwargs = {
            "userId": "me",
            "q": query,
            "maxResults": min(limit - len(message_ids), 100),
        }
        if page_token:
            kwargs["pageToken"] = page_token

        response = service.users().messages().list(**kwargs).execute()
        for msg in response.get("messages", []):
            message_ids.append(msg["id"])

        page_token = response.get("nextPageToken")
        if not page_token:
            break

    return message_ids[:limit]


def scrape_latest_labels(app, limit: int = 10, force: bool = True) -> dict:
    """
    Fetch and (re)process the latest N Alias shipping-label emails so their
    label PDF URLs are captured on the linked sales.

    force=True (default) deletes any existing EmailProcessingLog rows for those
    messages first, so labels are back-filled even when the confirmation email
    was already processed before label capture existed.
    """
    with app.app_context():
        from app.models.models import EmailProcessingLog, Sale
        from app import db

        try:
            service = get_gmail_service()
        except RuntimeError as e:
            logger.error(f"Gmail auth failed: {e}")
            return {"status": "error", "error": str(e), "processed": 0}

        try:
            message_ids = fetch_latest_label_message_ids(service, limit=limit)
        except Exception as e:
            logger.error(f"Latest-label fetch failed: {e}")
            return {"status": "error", "error": str(e), "processed": 0}

        if not message_ids:
            return {
                "status": "ok",
                "requested": limit,
                "total_fetched": 0,
                "processed": 0,
                "labels_captured": 0,
                "labels_total": _count_sales_with_labels(),
                "results": [],
            }

        if force:
            db.session.query(EmailProcessingLog).filter(
                EmailProcessingLog.gmail_message_id.in_(message_ids)
            ).delete(synchronize_session=False)
            db.session.commit()

        # Gmail returns newest-first; process oldest-first so state flows correctly.
        ordered_ids = list(reversed(_dedupe_message_ids(message_ids)))

        processed = 0
        labels_captured = 0
        results = []

        for msg_id in ordered_ids:
            try:
                full_msg = service.users().messages().get(
                    userId="me", id=msg_id, format="full"
                ).execute()

                subject, sender, body, sent_at = get_message_parts(full_msg)
                email_type = classify_email(sender, subject, body)
                shipping_label_url = extract_shipping_label_url(full_msg) if email_type == "Confirmation" else None
                # Shoe-image backfill is intentionally skipped here — this action
                # is label-focused and avoids the extra remote image downloads.
                result = process_message(
                    msg_id, subject, sender, body,
                    sent_at=sent_at, shoe_image=None, shipping_label_url=shipping_label_url,
                )
                results.append(result)

                if result.get("status") != "skipped":
                    processed += 1
                if shipping_label_url:
                    labels_captured += 1

            except HttpError as e:
                status = getattr(getattr(e, "resp", None), "status", None)
                if str(status) == "404":
                    logger.warning(f"Skipping missing label message {msg_id}: {e}")
                    results.append({"message_id": msg_id, "status": "skipped", "reason": "not_found"})
                else:
                    logger.exception(f"Error processing label message {msg_id}: {e}")
            except Exception as e:
                logger.exception(f"Error processing label message {msg_id}: {e}")

        logger.info(f"Latest-label scrape complete: {processed} processed, {labels_captured} labels captured.")
        return {
            "status": "ok",
            "requested": limit,
            "total_fetched": len(ordered_ids),
            "processed": processed,
            "labels_captured": labels_captured,
            "labels_total": _count_sales_with_labels(),
            "results": results,
        }


def _count_sales_with_labels() -> int:
    from app.models.models import Sale
    return (
        Sale.query
        .filter(Sale.shipping_label_url.isnot(None), Sale.shipping_label_url != "")
        .count()
    )


def _scrape_date_range_internal(
    app,
    after: str,
    before: str = None,
    force: bool = False,
    progress_cb=None,
    cancel_event=None,
) -> dict:
    """
    Fetch and process all alias.org emails in a date range.
    force=True deletes existing EmailProcessingLog entries so messages are re-processed.
    """
    with app.app_context():
        from app.models.models import EmailProcessingLog
        from app import db

        try:
            service = get_gmail_service()
        except RuntimeError as e:
            return {"status": "error", "error": str(e), "processed": 0}

        try:
            message_ids = fetch_date_range(service, after, before)
        except Exception as e:
            logger.error(f"Date-range fetch failed: {e}")
            return {"status": "error", "error": str(e), "processed": 0}

        if force and message_ids:
            deleted = (
                db.session.query(EmailProcessingLog)
                .filter(EmailProcessingLog.gmail_message_id.in_(message_ids))
                .delete(synchronize_session=False)
            )
            db.session.commit()
            logger.info(f"Force mode: deleted {deleted} existing log entries.")

        # Gmail returns newest-first; reverse to process oldest-first so the
        # state machine flows correctly: Sale → Confirmation → Shipped → Completed
        message_ids = list(reversed(_dedupe_message_ids(message_ids)))

        processed = 0
        skipped = 0
        results = []

        for msg_id in message_ids:
            if cancel_event is not None and cancel_event.is_set():
                return {
                    "status": "cancelled",
                    "error": "Scrape cancelled by user.",
                    "after": after,
                    "before": before,
                    "total_fetched": len(message_ids),
                    "processed": processed,
                    "skipped": skipped,
                    "results": results,
                }
            try:
                full_msg = service.users().messages().get(
                    userId="me", id=msg_id, format="full"
                ).execute()

                subject, sender, body, sent_at = get_message_parts(full_msg)
                email_type = classify_email(sender, subject, body)
                shoe_image = extract_largest_image_part(service, full_msg) if email_type in {"Sale", "Confirmation"} else None
                shipping_label_url = extract_shipping_label_url(full_msg) if email_type == "Confirmation" else None
                result = process_message(msg_id, subject, sender, body, sent_at=sent_at, shoe_image=shoe_image, shipping_label_url=shipping_label_url)
                results.append(result)

                if result.get("status") == "skipped":
                    skipped += 1
                else:
                    processed += 1

                msg_history_id = full_msg.get("historyId")
                if msg_history_id:
                    state = _load_state()
                    if not state.get("history_id") or int(msg_history_id) > int(state["history_id"]):
                        state["history_id"] = msg_history_id
                        _save_state(state)

            except HttpError as e:
                status = getattr(getattr(e, "resp", None), "status", None)
                if str(status) == "404":
                    logger.warning(f"Skipping missing message {msg_id}: {e}")
                    results.append({"message_id": msg_id, "status": "skipped", "reason": "not_found"})
                    skipped += 1
                else:
                    logger.exception(f"Error processing message {msg_id}: {e}")
            except Exception as e:
                logger.exception(f"Error processing message {msg_id}: {e}")
            if progress_cb:
                progress_cb(processed, skipped, len(message_ids))

        logger.info(f"Scrape complete: {processed} processed, {skipped} skipped.")
        return {
            "status": "ok",
            "after": after,
            "before": before,
            "total_fetched": len(message_ids),
            "processed": processed,
            "skipped": skipped,
            "results": results,
        }


def start_scrape_date_range(app, after: str, before: str = None, force: bool = False) -> bool:
    with _SCRAPE_STATUS_LOCK:
        if _SCRAPE_STATUS["running"]:
            return False

        _SCRAPE_CANCEL_EVENT.clear()
        _SCRAPE_STATUS["running"] = True
        _SCRAPE_STATUS["after"] = after
        _SCRAPE_STATUS["before"] = before
        _SCRAPE_STATUS["force"] = bool(force)
        _SCRAPE_STATUS["cancelling"] = False
        _SCRAPE_STATUS["total_fetched"] = 0
        _SCRAPE_STATUS["processed"] = 0
        _SCRAPE_STATUS["skipped"] = 0
        _SCRAPE_STATUS["error"] = None
        _SCRAPE_STATUS["started_at"] = now().isoformat()
        _SCRAPE_STATUS["finished_at"] = None

    def _worker():
        try:
            result = _scrape_date_range_internal(
                app=app,
                after=after,
                before=before,
                force=force,
                progress_cb=lambda processed, skipped, total_fetched: _set_scrape_status({
                    "processed": processed,
                    "skipped": skipped,
                    "total_fetched": total_fetched,
                }),
                cancel_event=_SCRAPE_CANCEL_EVENT,
            )
            if result.get("status") == "cancelled":
                _set_scrape_status({
                    "running": False,
                    "cancelling": False,
                    "error": result.get("error"),
                    "processed": result.get("processed", 0),
                    "skipped": result.get("skipped", 0),
                    "total_fetched": result.get("total_fetched", 0),
                    "finished_at": now().isoformat(),
                })
                return

            _set_scrape_status({
                "running": False,
                "processed": result.get("processed", 0),
                "skipped": result.get("skipped", 0),
                "total_fetched": result.get("total_fetched", 0),
                "error": result.get("error"),
                "finished_at": now().isoformat(),
            })
        except Exception as exc:
            _set_scrape_status({
                "running": False,
                "error": str(exc),
                "finished_at": now().isoformat(),
            })

    thread = threading.Thread(
        target=_worker,
        daemon=True,
        name="gmail-scrape",
    )
    thread.start()
    return True


def _dedupe_message_ids(message_ids):
    seen = set()
    deduped = []
    for msg_id in message_ids:
        if msg_id in seen:
            continue
        seen.add(msg_id)
        deduped.append(msg_id)
    return deduped

# =============================================================================
# Background polling thread
# =============================================================================

_poll_thread: threading.Thread | None = None
_stop_event = threading.Event()


def start_background_poller(app):
    """
    Start a background thread that calls poll_once() on a configurable interval.
    Spec 3.4: default every 5 minutes.
    """
    global _poll_thread, _stop_event

    interval = int(os.getenv("GMAIL_POLL_INTERVAL_SECONDS", 300))

    if _poll_thread and _poll_thread.is_alive():
        logger.info("Poller already running.")
        return

    _stop_event.clear()

    def _loop():
        logger.info(f"Gmail poller started (interval={interval}s)")
        while not _stop_event.is_set():
            try:
                poll_once(app)
            except Exception as e:
                logger.exception(f"Unexpected error in poll loop: {e}")
            _stop_event.wait(interval)
        logger.info("Gmail poller stopped.")

    _poll_thread = threading.Thread(target=_loop, daemon=True, name="gmail-poller")
    _poll_thread.start()


def stop_background_poller():
    """Signal the background poller to stop."""
    _stop_event.set()


def get_poller_status() -> dict:
    """Return current poller status for the API."""
    state = _load_state()
    return {
        "running": _poll_thread is not None and _poll_thread.is_alive(),
        "last_poll": state.get("last_poll"),
        "last_history_id": state.get("history_id"),
        "poll_interval_seconds": int(os.getenv("GMAIL_POLL_INTERVAL_SECONDS", 300)),
    }

