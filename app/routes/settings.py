"""
Settings API routes for operational maintenance tasks.
"""

from flask import Blueprint, request, jsonify

from app import db
from app.models.models import (
  BankTransferAllocation,
  BankTransfer,
  Expense,
  Inventory,
  Sale,
  Subscription,
  EmailProcessingLog,
)


settings_bp = Blueprint("settings", __name__)


@settings_bp.post("/reset")
def reset_database():
    """
    POST /api/settings/reset
    Body:
      confirm (required): must be exactly "RESET"
      scope   (optional): currently only "all" is supported
    """
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
            "inventory": Inventory.query.delete(synchronize_session=False),
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
