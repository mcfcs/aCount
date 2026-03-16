"""
Gmail API routes.
Spec: Section 3.4, 3.5

Endpoints:
  GET  /api/gmail/status   — poller status + last poll info
  POST /api/gmail/poll     — trigger a manual poll
  GET  /api/gmail/auth     — check Gmail auth connectivity
"""

import logging
from flask import Blueprint, jsonify, current_app

from app.gmail.auth import check_connection
from app.gmail.poller import poll_once, get_poller_status

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
