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
