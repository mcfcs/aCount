"""
Subscriptions API Routes — CRUD for recurring subscription tracking.
Spec references: Sections 2.3.3, 5.6
"""

from flask import Blueprint, request, jsonify
from app import db
from app.models.models import Subscription
from datetime import datetime

subscriptions_bp = Blueprint("subscriptions", __name__)


# ---- Constants ------------------------------------------------------------

VALID_BILLING_CYCLES = ("Monthly", "Quarterly", "Annual")
VALID_STATUSES = ("Active", "Paused", "Cancelled")


# ---- Validation -----------------------------------------------------------

def _parse_subscription_payload(data, is_update=False):
    """Validate and parse incoming Subscription JSON. Returns (dict, errors)."""
    errors = []

    if not is_update:
        for field in ("name", "amount_original", "original_currency", "amount_php", "billing_cycle"):
            if field not in data or data[field] is None:
                errors.append(f"'{field}' is required.")

    parsed = {}

    if "name" in data:
        parsed["name"] = str(data["name"]).strip()

    for num_field in ("amount_original", "amount_php"):
        if num_field in data and data[num_field] is not None:
            try:
                parsed[num_field] = float(data[num_field])
            except (ValueError, TypeError):
                errors.append(f"'{num_field}' must be a number.")

    if "original_currency" in data:
        parsed["original_currency"] = str(data["original_currency"]).upper().strip()

    if "billing_cycle" in data:
        if data["billing_cycle"] not in VALID_BILLING_CYCLES:
            errors.append(f"'billing_cycle' must be one of {VALID_BILLING_CYCLES}.")
        else:
            parsed["billing_cycle"] = data["billing_cycle"]

    if "next_billing_date" in data and data["next_billing_date"] is not None:
        try:
            parsed["next_billing_date"] = datetime.fromisoformat(str(data["next_billing_date"])).date()
        except ValueError:
            errors.append("'next_billing_date' must be ISO 8601 date format.")

    if "status" in data:
        if data["status"] not in VALID_STATUSES:
            errors.append(f"'status' must be one of {VALID_STATUSES}.")
        else:
            parsed["status"] = data["status"]

    if "payment_method" in data:
        parsed["payment_method"] = data["payment_method"]

    if "notes" in data:
        parsed["notes"] = data["notes"]

    if errors:
        return None, errors
    return parsed, None


# ---- CRUD -----------------------------------------------------------------

@subscriptions_bp.route("", methods=["GET"])
def list_subscriptions():
    """
    GET /api/subscriptions
    Query params: status, billing_cycle, page, per_page, sort_by, order
    """
    query = Subscription.query

    status = request.args.get("status")
    if status:
        query = query.filter(Subscription.status == status)

    billing_cycle = request.args.get("billing_cycle")
    if billing_cycle:
        query = query.filter(Subscription.billing_cycle == billing_cycle)

    sort_by = request.args.get("sort_by", "name")
    order = request.args.get("order", "asc")
    _valid_sort = {c.key for c in Subscription.__table__.columns}
    sort_col = getattr(Subscription, sort_by) if sort_by in _valid_sort else Subscription.name
    if order == "asc":
        query = query.order_by(sort_col.asc())
    else:
        query = query.order_by(sort_col.desc())

    page = request.args.get("page", 1, type=int)
    per_page = min(request.args.get("per_page", 25, type=int), 100)
    pagination = query.paginate(page=page, per_page=per_page, error_out=False)

    return jsonify({
        "items": [s.to_dict() for s in pagination.items],
        "total": pagination.total,
        "page": pagination.page,
        "per_page": pagination.per_page,
        "pages": pagination.pages,
    }), 200


@subscriptions_bp.route("/<int:subscription_id>", methods=["GET"])
def get_subscription(subscription_id):
    """GET /api/subscriptions/<id>"""
    sub = db.session.get(Subscription, subscription_id)
    if not sub:
        return jsonify({"error": "Subscription not found."}), 404
    return jsonify(sub.to_dict()), 200


@subscriptions_bp.route("", methods=["POST"])
def create_subscription():
    """POST /api/subscriptions"""
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "Request body must be JSON."}), 400

    parsed, errors = _parse_subscription_payload(data)
    if errors:
        return jsonify({"errors": errors}), 422

    sub = Subscription(**parsed)
    if "status" not in parsed:
        sub.status = "Active"

    db.session.add(sub)
    db.session.commit()
    return jsonify(sub.to_dict()), 201


@subscriptions_bp.route("/<int:subscription_id>", methods=["PUT", "PATCH"])
def update_subscription(subscription_id):
    """PUT/PATCH /api/subscriptions/<id>"""
    sub = db.session.get(Subscription, subscription_id)
    if not sub:
        return jsonify({"error": "Subscription not found."}), 404

    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "Request body must be JSON."}), 400

    parsed, errors = _parse_subscription_payload(data, is_update=True)
    if errors:
        return jsonify({"errors": errors}), 422

    for key, value in parsed.items():
        setattr(sub, key, value)

    db.session.commit()
    return jsonify(sub.to_dict()), 200


@subscriptions_bp.route("/<int:subscription_id>", methods=["DELETE"])
def delete_subscription(subscription_id):
    """DELETE /api/subscriptions/<id>"""
    sub = db.session.get(Subscription, subscription_id)
    if not sub:
        return jsonify({"error": "Subscription not found."}), 404
    db.session.delete(sub)
    db.session.commit()
    return jsonify({"message": f"Subscription {subscription_id} deleted."}), 200


# ---- Summary --------------------------------------------------------------

@subscriptions_bp.route("/summary", methods=["GET"])
def subscriptions_summary():
    """
    GET /api/subscriptions/summary
    Monthly burn rate and totals for active subscriptions.
    Spec: Section 6.4
    """
    from sqlalchemy import func

    active_subs = Subscription.query.filter_by(status="Active").all()

    monthly_total = 0.0
    for sub in active_subs:
        amount = float(sub.amount_php)
        if sub.billing_cycle == "Monthly":
            monthly_total += amount
        elif sub.billing_cycle == "Quarterly":
            monthly_total += amount / 3
        elif sub.billing_cycle == "Annual":
            monthly_total += amount / 12

    by_status = (
        db.session.query(
            Subscription.status,
            func.count(Subscription.subscription_id).label("count"),
            func.coalesce(func.sum(Subscription.amount_php), 0).label("total_php"),
        )
        .group_by(Subscription.status)
        .all()
    )

    status_breakdown = {
        status: {"count": count, "total_php": float(total)}
        for status, count, total in by_status
    }

    return jsonify({
        "monthly_burn_rate_php": round(monthly_total, 2),
        "annual_burn_rate_php": round(monthly_total * 12, 2),
        "by_status": status_breakdown,
    }), 200
