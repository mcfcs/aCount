"""
Settings API routes for operational maintenance tasks.
"""

from flask import Blueprint, request, jsonify, current_app

from app import db
from app.models.models import (
  BankTransferAllocation,
  BankTransfer,
  Expense,
  AppSetting,
  Inventory,
  Sale,
  Subscription,
  EmailProcessingLog,
  Shoe,
)

PHP_RATE_SETTING_KEY = "php_estimate_rate"
DEFAULT_PHP_ESTIMATE_RATE = 56.0
ALLOWED_RATE_MIN = 0.0001

settings_bp = Blueprint("settings", __name__)


@settings_bp.post("/maintenance/lifecycle")
def run_lifecycle_maintenance_endpoint():
    """
    POST /api/settings/maintenance/lifecycle
    Back-fills unlinked cancellation emails onto their sales and auto-expires
    abandoned Pending / overdue-Confirmed sales (STALE_SALE_EXPIRY_DAYS, default 7).
    Also runs automatically on the background poller interval; this endpoint
    triggers it on demand and returns what changed.
    """
    from app.sale_maintenance import run_lifecycle_maintenance
    summary = run_lifecycle_maintenance()
    return jsonify(summary), 200


@settings_bp.get("/php-rate")
def get_php_rate():
    """
    GET /api/settings/php-rate
    """
    try:
        setting = AppSetting.query.get(PHP_RATE_SETTING_KEY)
    except Exception:
        return jsonify({"rate": DEFAULT_PHP_ESTIMATE_RATE, "source": "default"}), 200

    if setting is None:
        return jsonify({"rate": DEFAULT_PHP_ESTIMATE_RATE, "source": "default"}), 200

    return jsonify({
        "rate": float(setting.value),
        "source": "database",
        "updated_at": setting.updated_at.isoformat() if setting.updated_at else None,
    }), 200


@settings_bp.put("/php-rate")
def set_php_rate():
    """
    PUT /api/settings/php-rate
    Body:
      rate (required): positive numeric PHP per 1 USD
    """
    data = request.get_json(silent=True) or {}
    rate = data.get("rate")

    try:
        rate = float(rate)
    except (TypeError, ValueError):
        return jsonify({"error": "rate must be a positive number"}), 400

    if rate < ALLOWED_RATE_MIN:
        return jsonify({"error": f"rate must be greater than {ALLOWED_RATE_MIN}"}), 400

    try:
        setting = AppSetting.query.get(PHP_RATE_SETTING_KEY)
        if setting is None:
            setting = AppSetting(key=PHP_RATE_SETTING_KEY, value=rate)
            db.session.add(setting)
        else:
            setting.value = rate
        db.session.commit()
        return jsonify({"rate": float(setting.value), "updated_at": setting.updated_at.isoformat() if setting.updated_at else None}), 200
    except Exception as exc:
        db.session.rollback()
        return jsonify({"error": f"Failed to save PHP estimate rate: {str(exc)}"}), 500


@settings_bp.get("/push-prefs")
def get_push_prefs():
    """GET /api/settings/push-prefs — per-category notification preferences.

    Returns each category's current enabled state plus its label/description so
    the UI can render the toggle list. Categories with no stored value use their
    default (exceptions on, routine lifecycle off).
    """
    from app.push_utils import NOTIFICATION_PREFS, get_notification_prefs

    return jsonify({
        "prefs": get_notification_prefs(),
        "options": [
            {"key": p["key"], "label": p["label"], "description": p["description"], "default": p["default"]}
            for p in NOTIFICATION_PREFS
        ],
    }), 200


@settings_bp.put("/push-prefs")
def set_push_prefs():
    """PUT /api/settings/push-prefs — update one or more categories.

    Body: { "<category_key>": true|false, ... } (partial updates allowed).
    Unknown keys are ignored. Returns the full resolved preference map.
    """
    from app.push_utils import NOTIFICATION_PREFS, get_notification_prefs, pref_setting_key

    data = request.get_json(silent=True) or {}
    valid_keys = {p["key"] for p in NOTIFICATION_PREFS}
    try:
        for key, raw in data.items():
            if key not in valid_keys:
                continue
            value = 1 if raw else 0
            setting_key = pref_setting_key(key)
            setting = AppSetting.query.get(setting_key)
            if setting is None:
                db.session.add(AppSetting(key=setting_key, value=value))
            else:
                setting.value = value
        db.session.commit()
        return jsonify({"prefs": get_notification_prefs()}), 200
    except Exception as exc:
        db.session.rollback()
        return jsonify({"error": f"Failed to save push preferences: {str(exc)}"}), 500


@settings_bp.post("/reset")
def reset_database():
    """
    POST /api/settings/reset
    Body:
      confirm (required): must be exactly "RESET"
      scope   (optional): currently only "all" is supported
    """
    if not current_app.config.get("ALLOW_DB_RESET", False):
        return jsonify({
            "error": "Database reset is disabled. Set ALLOW_DB_RESET=true to enable it."
        }), 403

    data = request.get_json(silent=True) or {}
    confirm = str(data.get("confirm", "")).strip()
    scope = str(data.get("scope", "all")).strip().lower()

    if confirm != "RESET":
        return jsonify({"error": "Missing confirmation. Send {\"confirm\": \"RESET\"} to proceed."}), 400

    if scope != "all":
        return jsonify({"error": "Only scope='all' is supported for now."}), 400

    try:
        # Break FK dependencies explicitly before deleting to stay safe across DB backends.
        Expense.query.update({Expense.linked_sale_id: None})
        Inventory.query.update({Inventory.linked_sale_id: None})

        counts = {
            "bank_transfer_allocations": BankTransferAllocation.query.delete(synchronize_session=False),
            "bank_transfers": BankTransfer.query.delete(synchronize_session=False),
            "expenses": Expense.query.delete(synchronize_session=False),
            "sales": Sale.query.delete(synchronize_session=False),
            "subscriptions": Subscription.query.delete(synchronize_session=False),
            "email_processing_log": EmailProcessingLog.query.delete(synchronize_session=False),
        }

        db.session.commit()
        return jsonify({
            "message": "Database reset completed.",
            "counts": counts,
            "scope": scope,
        }), 200
    except Exception as exc:
        db.session.rollback()
        return jsonify({"error": f"Reset failed: {str(exc)}"}), 500
