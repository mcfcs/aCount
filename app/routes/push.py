"""
Web Push API Routes — subscription management + test send.
"""

from flask import Blueprint, current_app, jsonify, request

from app import db
from app.models.models import PushSubscription
from app.push_utils import push_configured, send_push_to_all

push_bp = Blueprint("push", __name__)


@push_bp.get("/public-key")
def public_key():
    """GET /api/push/public-key — VAPID applicationServerKey for the browser."""
    if not push_configured():
        return jsonify({"error": "Push is not configured. Set VAPID keys in .env."}), 503
    return jsonify({"public_key": current_app.config["VAPID_PUBLIC_KEY"]}), 200


@push_bp.get("/status")
def status():
    """GET /api/push/status"""
    return jsonify({
        "configured": push_configured(),
        "subscriptions": PushSubscription.query.count(),
    }), 200


@push_bp.post("/subscribe")
def subscribe():
    """
    POST /api/push/subscribe
    Payload: the browser PushSubscription JSON { endpoint, keys: {p256dh, auth} }.
    Upserts by endpoint.
    """
    data = request.get_json(silent=True) or {}
    endpoint = str(data.get("endpoint") or "").strip()
    keys = data.get("keys") or {}
    p256dh = str(keys.get("p256dh") or "").strip()
    auth = str(keys.get("auth") or "").strip()

    if not endpoint or not p256dh or not auth:
        return jsonify({"error": "Subscription must include endpoint and keys.p256dh / keys.auth."}), 422

    sub = PushSubscription.query.filter_by(endpoint=endpoint).first()
    created = False
    if sub:
        sub.p256dh = p256dh
        sub.auth = auth
    else:
        sub = PushSubscription(endpoint=endpoint, p256dh=p256dh, auth=auth)
        db.session.add(sub)
        created = True
    db.session.commit()
    return jsonify({"created": created, "subscription": sub.to_dict()}), 201 if created else 200


@push_bp.post("/unsubscribe")
def unsubscribe():
    """POST /api/push/unsubscribe — Payload: { endpoint }"""
    data = request.get_json(silent=True) or {}
    endpoint = str(data.get("endpoint") or "").strip()
    if not endpoint:
        return jsonify({"error": "'endpoint' is required."}), 422
    deleted = PushSubscription.query.filter_by(endpoint=endpoint).delete(synchronize_session=False)
    db.session.commit()
    return jsonify({"deleted": deleted}), 200


@push_bp.post("/test")
def test():
    """POST /api/push/test — send a test notification to every subscription."""
    if not push_configured():
        return jsonify({"error": "Push is not configured. Set VAPID keys in .env."}), 503
    if PushSubscription.query.count() == 0:
        return jsonify({"error": "No devices are subscribed yet."}), 400
    sent = send_push_to_all(
        "aCount test notification",
        "Push notifications are working on this device.",
        url="/settings",
        tag="test",
    )
    return jsonify({"sent": sent}), 200
