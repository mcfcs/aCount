"""
Gmail API routes.
Spec: Section 3.4, 3.5

Endpoints:
  GET  /api/gmail/status       - poller status + last poll info
  POST /api/gmail/poll         - trigger a manual poll
  GET  /api/gmail/auth         - check Gmail auth connectivity
  POST /api/gmail/scrape       - trigger range scrape (sync or async)
  GET  /api/gmail/scrape-status - scrape progress/status
"""

import logging
from flask import Blueprint, jsonify, request, current_app

from app.gmail.auth import check_connection
from app.gmail.poller import (
    poll_once,
    get_poller_status,
    scrape_date_range,
    start_scrape_date_range,
    get_scrape_status,
    cancel_scrape,
)

logger = logging.getLogger(__name__)

gmail_bp = Blueprint("gmail", __name__)


@gmail_bp.get("/status")
def status():
    """Return current poller status and last poll metadata."""
    return jsonify(get_poller_status()), 200


@gmail_bp.post("/poll")
def manual_poll():
    """Trigger a manual poll immediately."""
    try:
        result = poll_once(current_app._get_current_object())
        return jsonify(result), 200
    except Exception as e:
        logger.exception(f"Manual poll failed: {e}")
        return jsonify({"status": "error", "error": str(e)}), 500


@gmail_bp.get("/auth")
def auth_check():
    """Verify Gmail API credentials and connectivity."""
    ok, detail = check_connection()
    if ok:
        return jsonify({"status": "ok", "email": detail}), 200
    return jsonify({"status": "error", "error": detail}), 503


@gmail_bp.post("/scrape")
def scrape():
    """
    POST /api/gmail/scrape
    Re-fetch and process all alias.org emails in a date range.

    Body (JSON):
      after   (required) - start date, e.g. "2026-03-01"
      before  (optional) - end date,   e.g. "2026-03-16"
      force   (optional) - if true, re-processes already-seen emails (default: false)
      async   (optional) - if true, run in background (default: true)
    """
    data = request.get_json(silent=True) or {}
    after = data.get("after")
    if not after:
        return jsonify({"error": "'after' date is required (e.g. '2026-03-01')"}), 400

    before = data.get("before")
    force = bool(data.get("force", False))
    asynchronous = bool(data.get("async", True))

    if asynchronous:
        started = start_scrape_date_range(
            current_app._get_current_object(),
            after=after,
            before=before,
            force=force,
        )
        if not started:
            return jsonify({
                "status": "error",
                "error": "A scrape is already running.",
                "scrape_status": get_scrape_status(),
            }), 409

        return jsonify({
            "status": "started",
            "message": "Scrape started in background.",
            "scrape_status": get_scrape_status(),
        }), 202

    try:
        result = scrape_date_range(
            current_app._get_current_object(),
            after=after,
            before=before,
            force=force,
        )
        return jsonify(result), 200
    except Exception as e:
        logger.exception(f"Scrape failed: {e}")
        return jsonify({"status": "error", "error": str(e)}), 500


@gmail_bp.post("/backfill-merchant")
def backfill_merchant():
    """
    POST /api/gmail/backfill-merchant
    Re-process historical Subscription/Purchase/Receipt emails (and recover
    Failed rows) through the current handlers, using their stored Gmail ids.
    Body (optional): { "limit": 200, "include_failed": true }
    Call repeatedly until "remaining" reaches 0.
    """
    data = request.get_json(silent=True) or {}
    limit = min(int(data.get("limit", 200) or 200), 500)
    include_failed = bool(data.get("include_failed", True))

    from app.gmail.backfill import backfill_from_log
    summary = backfill_from_log(current_app._get_current_object(), limit=limit, include_failed=include_failed)
    status = 502 if summary.get("status") == "error" else 200
    return jsonify(summary), status


@gmail_bp.get("/scrape-status")
def scrape_status():
    """Return current background scrape progress."""
    return jsonify(get_scrape_status()), 200


@gmail_bp.post("/scrape-cancel")
def scrape_cancel():
    """Request cancellation of a running scrape."""
    result = cancel_scrape()
    if result.get("status") == "not_running":
        return jsonify(result), 409
    return jsonify(result), 200
