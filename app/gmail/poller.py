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
import threading
from datetime import datetime

from app.gmail.auth import get_gmail_service
from app.gmail.parsers import get_message_parts
from app.gmail.processor import process_message

logger = logging.getLogger(__name__)

STATE_FILE = os.path.join(os.path.dirname(__file__), ".poll_state.json")
ALIAS_SENDER = "info@alias.org"


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

        processed = 0
        results = []

        for msg_id in messages:
            try:
                full_msg = service.users().messages().get(
                    userId="me", id=msg_id, format="full"
                ).execute()

                subject, sender, body = get_message_parts(full_msg)
                result = process_message(msg_id, subject, sender, body)
                results.append(result)

                if result.get("status") != "skipped":
                    processed += 1

                # Update historyId to the latest seen
                msg_history_id = full_msg.get("historyId")
                if msg_history_id:
                    if not state.get("history_id") or int(msg_history_id) > int(state["history_id"]):
                        state["history_id"] = msg_history_id

            except Exception as e:
                logger.exception(f"Error processing message {msg_id}: {e}")

        state["last_poll"] = datetime.utcnow().isoformat()
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
