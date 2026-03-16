"""
Expenses API Routes — CRUD for all expense categories.
Spec references: Sections 2.3.2, 5.5
"""

from flask import Blueprint, request, jsonify
from app import db
from app.models.models import Expense, Sale
from datetime import datetime

expenses_bp = Blueprint("expenses", __name__)


# ---- Constants ------------------------------------------------------------

VALID_CATEGORIES = ("Platform Fee", "Subscription", "Personal Order", "Sneaker Purchase", "Other")


# ---- Validation -----------------------------------------------------------

def _parse_expense_payload(data, is_update=False):
    """Validate and parse incoming Expense JSON. Returns (dict, errors)."""
    errors = []

    if not is_update:
        for field in ("category", "description", "amount_original", "original_currency",
                      "amount_php", "expense_date"):
            if field not in data or data[field] is None:
                errors.append(f"'{field}' is required.")

    parsed = {}

    if "category" in data:
        if data["category"] not in VALID_CATEGORIES:
            errors.append(f"'category' must be one of {VALID_CATEGORIES}.")
        else:
            parsed["category"] = data["category"]

    if "description" in data:
        parsed["description"] = str(data["description"]).strip()

    for num_field in ("amount_original", "amount_php"):
        if num_field in data and data[num_field] is not None:
            try:
                parsed[num_field] = float(data[num_field])
            except (ValueError, TypeError):
                errors.append(f"'{num_field}' must be a number.")

    if "conversion_rate" in data and data["conversion_rate"] is not None:
        try:
            parsed["conversion_rate"] = float(data["conversion_rate"])
        except (ValueError, TypeError):
            errors.append("'conversion_rate' must be a number.")

    if "original_currency" in data:
        parsed["original_currency"] = str(data["original_currency"]).upper().strip()

    if "expense_date" in data and data["expense_date"] is not None:
        try:
            parsed["expense_date"] = datetime.fromisoformat(str(data["expense_date"])).date()
        except ValueError:
            errors.append("'expense_date' must be ISO 8601 date format.")

    if "source" in data:
        parsed["source"] = data["source"]

    if "linked_sale_id" in data:
        sale_id = data["linked_sale_id"]
        if sale_id is not None:
            sale = db.session.get(Sale, sale_id)
            if not sale:
                errors.append(f"Sale {sale_id} not found.")
            else:
                parsed["linked_sale_id"] = sale_id
        else:
            parsed["linked_sale_id"] = None

    if "notes" in data:
        parsed["notes"] = data["notes"]

    if errors:
        return None, errors
    return parsed, None


# ---- CRUD -----------------------------------------------------------------

@expenses_bp.route("", methods=["GET"])
def list_expenses():
    """
    GET /api/expenses
    Query params: category, source, linked_sale_id, date_from, date_to, page, per_page, sort_by, order
    """
    query = Expense.query

    category = request.args.get("category")
    if category:
        query = query.filter(Expense.category == category)

    source = request.args.get("source")
    if source:
        query = query.filter(Expense.source.ilike(f"%{source}%"))

    linked_sale_id = request.args.get("linked_sale_id")
    if linked_sale_id:
        try:
            query = query.filter(Expense.linked_sale_id == int(linked_sale_id))
        except ValueError:
            pass

    date_from = request.args.get("date_from")
    if date_from:
        try:
            query = query.filter(Expense.expense_date >= datetime.fromisoformat(date_from).date())
        except ValueError:
            pass

    date_to = request.args.get("date_to")
    if date_to:
        try:
            query = query.filter(Expense.expense_date <= datetime.fromisoformat(date_to).date())
        except ValueError:
            pass

    sort_by = request.args.get("sort_by", "expense_date")
    order = request.args.get("order", "desc")
    sort_col = getattr(Expense, sort_by, Expense.expense_date)
    if order == "asc":
        query = query.order_by(sort_col.asc())
    else:
        query = query.order_by(sort_col.desc())

    page = request.args.get("page", 1, type=int)
    per_page = min(request.args.get("per_page", 25, type=int), 100)
    pagination = query.paginate(page=page, per_page=per_page, error_out=False)

    return jsonify({
        "items": [e.to_dict() for e in pagination.items],
        "total": pagination.total,
        "page": pagination.page,
        "per_page": pagination.per_page,
        "pages": pagination.pages,
    }), 200


@expenses_bp.route("/<int:expense_id>", methods=["GET"])
def get_expense(expense_id):
    """GET /api/expenses/<id>"""
    expense = db.session.get(Expense, expense_id)
    if not expense:
        return jsonify({"error": "Expense not found."}), 404
    return jsonify(expense.to_dict()), 200


@expenses_bp.route("", methods=["POST"])
def create_expense():
    """POST /api/expenses"""
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "Request body must be JSON."}), 400

    parsed, errors = _parse_expense_payload(data)
    if errors:
        return jsonify({"errors": errors}), 422

    expense = Expense(**parsed)
    db.session.add(expense)
    db.session.commit()
    return jsonify(expense.to_dict()), 201


@expenses_bp.route("/<int:expense_id>", methods=["PUT", "PATCH"])
def update_expense(expense_id):
    """PUT/PATCH /api/expenses/<id>"""
    expense = db.session.get(Expense, expense_id)
    if not expense:
        return jsonify({"error": "Expense not found."}), 404

    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "Request body must be JSON."}), 400

    parsed, errors = _parse_expense_payload(data, is_update=True)
    if errors:
        return jsonify({"errors": errors}), 422

    for key, value in parsed.items():
        setattr(expense, key, value)

    db.session.commit()
    return jsonify(expense.to_dict()), 200


@expenses_bp.route("/<int:expense_id>", methods=["DELETE"])
def delete_expense(expense_id):
    """DELETE /api/expenses/<id>"""
    expense = db.session.get(Expense, expense_id)
    if not expense:
        return jsonify({"error": "Expense not found."}), 404
    db.session.delete(expense)
    db.session.commit()
    return jsonify({"message": f"Expense {expense_id} deleted."}), 200


# ---- Summary --------------------------------------------------------------

@expenses_bp.route("/summary", methods=["GET"])
def expenses_summary():
    """
    GET /api/expenses/summary
    Totals by category. Optional date_from / date_to query params.
    Spec: Section 6.4 financial overview
    """
    from sqlalchemy import func

    query = db.session.query(
        Expense.category,
        func.count(Expense.expense_id).label("count"),
        func.coalesce(func.sum(Expense.amount_php), 0).label("total_php"),
    )

    date_from = request.args.get("date_from")
    if date_from:
        try:
            query = query.filter(Expense.expense_date >= datetime.fromisoformat(date_from).date())
        except ValueError:
            pass

    date_to = request.args.get("date_to")
    if date_to:
        try:
            query = query.filter(Expense.expense_date <= datetime.fromisoformat(date_to).date())
        except ValueError:
            pass

    stats = query.group_by(Expense.category).all()

    by_category = {}
    total_php = 0.0
    for category, count, total in stats:
        by_category[category] = {"count": count, "total_php": float(total)}
        total_php += float(total)

    return jsonify({
        "total_expenses_php": total_php,
        "by_category": by_category,
    }), 200
