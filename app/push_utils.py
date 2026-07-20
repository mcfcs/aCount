"""
Web Push delivery helpers (VAPID, via pywebpush).

The app is single-operator: every stored browser subscription receives every
notification. `notify_once` layers a DB-backed dedup key on top so an event or
deadline stage pushes at most once ever (poller restarts and re-scrapes included).
"""

import json
import logging
from datetime import timedelta

from flask import current_app
from sqlalchemy.exc import IntegrityError

from app import db
from app.models.models import PushSentLog, PushSubscription
from app.time_utils import now

logger = logging.getLogger(__name__)

SENT_LOG_RETENTION_DAYS = 30


def push_configured() -> bool:
    """Push is available once VAPID keys are set. Must run in an app context."""
    return bool(current_app.config.get("VAPID_PRIVATE_KEY") and current_app.config.get("VAPID_PUBLIC_KEY"))


def send_push_to_all(title, body, url="/", tag=None) -> int:
    """Send one notification to every stored subscription.

    Returns the number of successful sends. Dead endpoints (404/410) are
    pruned. Never raises — push failure must not break callers.
    """
    if not push_configured():
        return 0

    from pywebpush import webpush, WebPushException

    subscriptions = PushSubscription.query.all()
    if not subscriptions:
        return 0

    payload = json.dumps({"title": title, "body": body, "url": url, "tag": tag})
    sent = 0
    for sub in subscriptions:
        try:
            webpush(
                subscription_info={
                    "endpoint": sub.endpoint,
                    "keys": {"p256dh": sub.p256dh, "auth": sub.auth},
                },
                data=payload,
                vapid_private_key=current_app.config["VAPID_PRIVATE_KEY"],
                vapid_claims={"sub": current_app.config.get("VAPID_SUBJECT", "mailto:admin@example.com")},
                ttl=6 * 3600,
            )
            sent += 1
        except WebPushException as exc:
            status = getattr(getattr(exc, "response", None), "status_code", None)
            if status in (404, 410):
                # Browser dropped the subscription — prune it.
                db.session.delete(sub)
            else:
                logger.warning("Web push failed (%s): %s", status, exc)
        except Exception:
            logger.exception("Unexpected web push failure")
    try:
        db.session.commit()
    except Exception:
        db.session.rollback()
    return sent


def notify_once(dedup_key, title, body, url="/", tag=None) -> bool:
    """Send to all subscriptions unless `dedup_key` was already used.

    The dedup row is committed BEFORE sending, so a concurrent caller (or a
    crash mid-send) can never double-notify; a lost send is the accepted
    trade-off. Returns True when a send was attempted.
    """
    if not push_configured():
        return False

    if PushSentLog.query.filter_by(dedup_key=dedup_key).first():
        return False
    db.session.add(PushSentLog(dedup_key=dedup_key))
    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return False

    send_push_to_all(title, body, url=url, tag=tag)
    return True


def prune_sent_log():
    """Drop dedup rows old enough that their event can never re-fire."""
    cutoff = now() - timedelta(days=SENT_LOG_RETENTION_DAYS)
    try:
        PushSentLog.query.filter(PushSentLog.sent_at < cutoff).delete(synchronize_session=False)
        db.session.commit()
    except Exception:
        db.session.rollback()
