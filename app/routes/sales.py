"""
Sales API Routes — CRUD + lifecycle status transitions + FIFO matching.
Spec references: Sections 2.1, 2.2.3, 4.2, 4.3, 5.2
"""

from flask import Blueprint, request, jsonify
from app import db
from app.models.models import Sale, Inventory, Expense
from datetime import datetime
from sqlalchemy import func
from app.time_utils import now, date_today
from app.shoe_utils import ensure_shoe_exists

sales_bp = Blueprint("sales", __name__)

MATCH_ELIGIBLE_STATUSES = ("Pending", "Confirmed")

# ---- Constants ------------------------------------------------------------

VALID_STATUSES = (
    "Pending", "Confirmed", "Shipped", "Completed",
    "Cancelled", "Attention Needed", "Consigned", "Returned",
)
VALID_CONDITIONS = ("New", "Used")
VALID_BOX_CONDITIONS = ("Good Condition", "No Box", "Badly Damaged")
VALID_CANCELLATION_TYPES = ("Unconfirmed", "Confirmed", "Attention Needed")
VALID_MATCH_STATUSES = ("Matched", "Unmatched")

# Allowed status transitions (Spec Section 2.1.1)
ALLOWED_TRANSITIONS = {
    "Pending":          ("Confirmed", "Cancelled"),
    "Confirmed":        ("Shipped", "Cancelled"),
    "Shipped":          ("Completed", "Attention Needed"),
    "Completed":        ("Returned",),
    "Cancelled":        (),  # terminal
    "Attention Needed": ("Completed", "Cancelled", "Consigned", "Returned"),
    "Consigned":        ("Completed", "Returned"),
    "Returned":         (),  # terminal
}


# ---- Validation helpers ---------------------------------------------------

def _parse_sale_payload(data, is_update=False):
    """Validate and parse incoming sale JSON."""
    errors = []

    if not is_update:
        for field in ("order_number", "sku", "shoe_name", "size", "sale_date"):
            if field not in data or data[field] is None:
                errors.append(f"'{field}' is required.")

    parsed = {}

    # Integers
    for int_field in ("order_number", "parent_order_number"):
        if int_field in data and data[int_field] is not None:
            try:
                parsed[int_field] = int(data[int_field])
            except (ValueError, TypeError):
                errors.append(f"'{int_field}' must be an integer.")

    # Strings
    for str_field in ("platform", "sku", "shoe_name", "issue_type",
                       "pickup_address", "pickup_window", "tracking_number", "notes"):
        if str_field in data:
            parsed[str_field] = data[str_field]

    # Floats
    for num_field in ("size", "selling_price", "amount_made", "discount_offered", "cancellation_fee"):
        if num_field in data and data[num_field] is not None:
            try:
                parsed[num_field] = float(data[num_field])
            except (ValueError, TypeError):
                errors.append(f"'{num_field}' must be a number.")
    if "purchase_cost" in data and data["purchase_cost"] is not None:
        try:
            parsed["purchase_cost"] = float(data["purchase_cost"])
        except (ValueError, TypeError):
            errors.append("'purchase_cost' must be a number.")

    # Datetimes
    for dt_field in ("sale_date", "confirmation_datetime", "shipment_deadline",
                     "shipment_date", "attention_needed_deadline"):
        if dt_field in data and data[dt_field] is not None:
            try:
                parsed[dt_field] = datetime.fromisoformat(str(data[dt_field]))
            except ValueError:
                errors.append(f"'{dt_field}' must be ISO 8601 format.")

    # Dates
    for d_field in ("completion_date", "cancellation_date"):
        if d_field in data and data[d_field] is not None:
            try:
                parsed[d_field] = datetime.fromisoformat(str(data[d_field])).date()
            except ValueError:
                errors.append(f"'{d_field}' must be ISO 8601 date.")

    # Enums
    if "status" in data:
        if data["status"] not in VALID_STATUSES:
            errors.append(f"'status' must be one of {VALID_STATUSES}.")
        else:
            parsed["status"] = data["status"]

    if "condition" in data and data["condition"] is not None:
        if data["condition"] not in VALID_CONDITIONS:
            errors.append(f"'condition' must be one of {VALID_CONDITIONS}.")
        else:
            parsed["condition"] = data["condition"]

    if "box_condition" in data and data["box_condition"] is not None:
        if data["box_condition"] not in VALID_BOX_CONDITIONS:
            errors.append(f"'box_condition' must be one of {VALID_BOX_CONDITIONS}.")
        else:
            parsed["box_condition"] = data["box_condition"]

    if "cancellation_type" in data and data["cancellation_type"] is not None:
        if data["cancellation_type"] not in VALID_CANCELLATION_TYPES:
            errors.append(f"'cancellation_type' must be one of {VALID_CANCELLATION_TYPES}.")
        else:
            parsed["cancellation_type"] = data["cancellation_type"]

    if "inventory_match_status" in data:
        if data["inventory_match_status"] not in VALID_MATCH_STATUSES:
            errors.append(f"'inventory_match_status' must be one of {VALID_MATCH_STATUSES}.")
        else:
            parsed["inventory_match_status"] = data["inventory_match_status"]

    if errors:
        return None, errors
    return parsed, None


def _lowest_nonzero_purchase_cost(sku, exclude_sale_id=None, exclude_inventory_id=None):
    """
    Return the smallest non-zero purchase_cost across both Inventory and Sales for
    the same sku. Returns None when no value exists.
    """
    if not sku:
        return None

    inv_query = (
        db.session.query(func.min(Inventory.purchase_cost))
        .filter(
            Inventory.sku == sku,
            Inventory.purchase_cost.isnot(None),
            Inventory.purchase_cost > 0,
        )
    )
    if exclude_inventory_id is not None:
        inv_query = inv_query.filter(Inventory.inventory_id != exclude_inventory_id)
    inv_min = inv_query.scalar()

    sale_query = (
        db.session.query(func.min(Sale.purchase_cost))
        .filter(
            Sale.sku == sku,
            Sale.purchase_cost.isnot(None),
            Sale.purchase_cost > 0,
        )
    )
    if exclude_sale_id is not None:
        sale_query = sale_query.filter(Sale.sale_id != exclude_sale_id)
    sale_min = sale_query.scalar()

    values = [v for v in (inv_min, sale_min) if v is not None]
    return float(min(values)) if values else None


def _fifo_match(sku, size):
    """
    FIFO inventory matching (Spec Section 2.2.3):
    Match by SKU + Size + Status=Available, earliest DatePurchased first.
    Returns the matched Inventory item or None.
    """
    return (
        Inventory.query
        .filter_by(sku=sku, size=size, status="Available")
        .order_by(Inventory.date_purchased.asc())
        .first()
    )


def _restore_inventory(sale):
    """
    Restore inventory when a sale is cancelled or returned (Spec Section 2.2.2).
    Sets the linked inventory item back to Available and unlinks it.
    """
    linked_items = Inventory.query.filter_by(linked_sale_id=sale.sale_id, status="Sold").all()
    for item in linked_items:
        item.status = "Available"
        item.linked_sale_id = None
    if linked_items:
        sale.inventory_match_status = "Unmatched"


def _unmatch_sale_inventory(sale):
    """
    Break inventory linkage for a sale and return linked inventory count.
    """
    linked_items = Inventory.query.filter_by(linked_sale_id=sale.sale_id).all()
    for item in linked_items:
        item.linked_sale_id = None
        if item.status == "Sold":
            item.status = "Available"
    sale.purchase_cost = None
    sale.inventory_match_status = "Unmatched"
    return len(linked_items)


def _match_sale_inventory(sale):
    """
    Attempt FIFO match for a sale that is Pending/Confirmed only.
    Skips if already matched.
    """
    if sale.inventory_match_status == "Matched":
        return None
    if sale.status not in MATCH_ELIGIBLE_STATUSES:
        return None

    matched_item = _fifo_match(sale.sku, sale.size)
    if matched_item:
        matched_item.status = "Sold"
        matched_item.linked_sale_id = sale.sale_id
        item_cost = float(matched_item.purchase_cost) if matched_item.purchase_cost else 0
        if item_cost > 0:
            sale.purchase_cost = item_cost
        else:
            fallback_cost = _lowest_nonzero_purchase_cost(sale.sku, exclude_sale_id=sale.sale_id, exclude_inventory_id=matched_item.inventory_id)
            if fallback_cost is not None:
                sale.purchase_cost = fallback_cost
            else:
                sale.purchase_cost = item_cost
        sale.inventory_match_status = "Matched"
    return matched_item


def _remove_sale_inventory_from_active(sale):
    """
    Ensure a matched sale is reflected in non-active inventory.
    If the item is still linked and Available (or already linked as Sold),
    mark it as Sold.
    """
    linked_items = Inventory.query.filter_by(
        linked_sale_id=sale.sale_id,
        status="Available",
    ).all()
    if linked_items:
        for item in linked_items:
            item.status = "Sold"
    return bool(linked_items)


# ---- CRUD -----------------------------------------------------------------

@sales_bp.route("", methods=["GET"])
def list_sales():
    """
    GET /api/sales
    Query params: status, sku, order_number, shoe_name, page, per_page, sort_by, order
    """
    query = Sale.query

    # Filters
    status = request.args.get("status")
    if status:
        query = query.filter(Sale.status == status)

    sku = request.args.get("sku")
    if sku:
        query = query.filter(Sale.sku.ilike(f"%{sku}%"))

    shoe_name = request.args.get("shoe_name")
    if shoe_name:
        query = query.filter(Sale.shoe_name.ilike(f"%{shoe_name}%"))

    order_number = request.args.get("order_number")
    if order_number:
        try:
            query = query.filter(Sale.order_number == int(order_number))
        except ValueError:
            pass

    inventory_match = request.args.get("inventory_match_status")
    if inventory_match:
        query = query.filter(Sale.inventory_match_status == inventory_match)

    matchable = request.args.get("matchable")
    if matchable == "1":
        inv_skus = db.session.query(Inventory.sku).filter(
            Inventory.purchase_cost.isnot(None),
            Inventory.purchase_cost > 0,
        )
        sale_skus = db.session.query(Sale.sku).filter(
            Sale.purchase_cost.isnot(None),
            Sale.purchase_cost > 0,
        )
        query = query.filter(
            Sale.purchase_cost.is_(None),
            db.or_(
                Sale.sku.in_(inv_skus),
                Sale.sku.in_(sale_skus),
            ),
        )

    platform = request.args.get("platform")
    if platform:
        query = query.filter(Sale.platform.ilike(f"%{platform}%"))

    # Sorting
    sort_by = request.args.get("sort_by", "sale_date")
    order = request.args.get("order", "desc")
    sort_col = getattr(Sale, sort_by, Sale.sale_date)
    if order == "asc":
        query = query.order_by(sort_col.asc())
    else:
        query = query.order_by(sort_col.desc())

    # Pagination
    page = request.args.get("page", 1, type=int)
    per_page = request.args.get("per_page", 25, type=int)
    per_page = min(per_page, 100)

    pagination = query.paginate(page=page, per_page=per_page, error_out=False)

    return jsonify({
        "items": [s.to_dict() for s in pagination.items],
        "total": pagination.total,
        "page": pagination.page,
        "per_page": pagination.per_page,
        "pages": pagination.pages,
    }), 200


@sales_bp.route("/<int:sale_id>", methods=["GET"])
def get_sale(sale_id):
    """GET /api/sales/<id>"""
    sale = db.session.get(Sale, sale_id)
    if not sale:
        return jsonify({"error": "Sale not found."}), 404
    return jsonify(sale.to_dict()), 200


@sales_bp.route("/pricing-suggestion", methods=["GET"])
def get_pricing_suggestion():
    """
    GET /api/sales/pricing-suggestion
    Query: sku
    Returns lowest recorded non-zero purchase_cost from Inventory and Sales for same sku.
    """
    sku = request.args.get("sku")
    if not sku:
        return jsonify({"error": "'sku' is required."}), 400

    estimated_cost = _lowest_nonzero_purchase_cost(sku.strip())
    return jsonify({"estimated_purchase_cost": estimated_cost}), 200


@sales_bp.route("", methods=["POST"])
def create_sale():
    """
    POST /api/sales
    Creates a new sale record (defaults to Pending + Unmatched).
    Attempts FIFO inventory match automatically.
    Spec: Section 4.2, steps 1–5.
    """
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "Request body must be JSON."}), 400

    parsed, errors = _parse_sale_payload(data)
    if errors:
        return jsonify({"errors": errors}), 422

    ensure_shoe_exists(
        parsed.get("sku"),
        parsed.get("shoe_name"),
        brand=None,
    )

    sale = Sale(**parsed)
    if "status" not in parsed:
        sale.status = "Pending"
    if "inventory_match_status" not in parsed:
        sale.inventory_match_status = "Unmatched"

    db.session.add(sale)
    db.session.flush()

    # --- FIFO inventory match (Spec 2.2.3) ---
    _match_sale_inventory(sale)

    # --- Smart pricing fallback from historical non-zero costs ---
    if sale.purchase_cost is None:
        sale.purchase_cost = _lowest_nonzero_purchase_cost(sale.sku, exclude_sale_id=sale.sale_id)

    db.session.commit()

    return jsonify(sale.to_dict()), 201


@sales_bp.route("/<int:sale_id>", methods=["PUT", "PATCH"])
def update_sale(sale_id):
    """PUT/PATCH /api/sales/<id>"""
    sale = db.session.get(Sale, sale_id)
    if not sale:
        return jsonify({"error": "Sale not found."}), 404

    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "Request body must be JSON."}), 400

    parsed, errors = _parse_sale_payload(data, is_update=True)
    if errors:
        return jsonify({"errors": errors}), 422

    for key, value in parsed.items():
        setattr(sale, key, value)

    # Re-attempt matching only when status is updated into an active match state.
    if "status" in parsed and parsed["status"] in MATCH_ELIGIBLE_STATUSES:
        _match_sale_inventory(sale)

    # Smart pricing fallback from historical non-zero costs.
    if sale.purchase_cost is None:
        sale.purchase_cost = _lowest_nonzero_purchase_cost(sale.sku, exclude_sale_id=sale.sale_id)

    db.session.commit()
    return jsonify(sale.to_dict()), 200


@sales_bp.route("/<int:sale_id>", methods=["DELETE"])
def delete_sale(sale_id):
    """DELETE /api/sales/<id>"""
    sale = db.session.get(Sale, sale_id)
    if not sale:
        return jsonify({"error": "Sale not found."}), 404

    # Restore linked inventory
    _restore_inventory(sale)

    db.session.delete(sale)
    db.session.commit()
    return jsonify({"message": f"Sale {sale_id} deleted."}), 200


# ---- Status Transition endpoint -------------------------------------------

@sales_bp.route("/<int:sale_id>/transition", methods=["POST"])
def transition_sale_status(sale_id):
    """
    POST /api/sales/<id>/transition
    Body: { "new_status": "Confirmed", ...optional fields for the transition }

    Enforces allowed lifecycle transitions (Spec Section 2.1.1).
    Handles side effects: inventory restoration on cancellation/return,
    fee creation for confirmed cancellations, etc.
    """
    sale = db.session.get(Sale, sale_id)
    if not sale:
        return jsonify({"error": "Sale not found."}), 404

    data = request.get_json(silent=True) or {}
    new_status = data.get("new_status")

    if not new_status:
        return jsonify({"error": "'new_status' is required."}), 400

    if new_status not in VALID_STATUSES:
        return jsonify({"error": f"Invalid status. Must be one of {VALID_STATUSES}."}), 400

    # Enforce allowed transitions
    allowed = ALLOWED_TRANSITIONS.get(sale.status, ())
    if new_status not in allowed:
        return jsonify({
            "error": f"Cannot transition from '{sale.status}' to '{new_status}'.",
            "allowed_transitions": list(allowed),
        }), 409

    old_status = sale.status
    sale.status = new_status

    # --- Side effects by transition ---

    # Confirmed: store deadline and pickup info
    if new_status == "Confirmed":
        _match_sale_inventory(sale)
        if "confirmation_datetime" in data:
            try:
                sale.confirmation_datetime = datetime.fromisoformat(data["confirmation_datetime"])
            except ValueError:
                pass
        else:
            sale.confirmation_datetime = now()
        if "shipment_deadline" in data:
            try:
                sale.shipment_deadline = datetime.fromisoformat(data["shipment_deadline"])
            except ValueError:
                pass
        if "pickup_address" in data:
            sale.pickup_address = data["pickup_address"]
        if "pickup_window" in data:
            sale.pickup_window = data["pickup_window"]

    # Shipped
    elif new_status == "Shipped":
        _remove_sale_inventory_from_active(sale)
        if "shipment_date" in data:
            try:
                sale.shipment_date = datetime.fromisoformat(data["shipment_date"])
            except ValueError:
                pass
        else:
            sale.shipment_date = now()
        if "tracking_number" in data:
            sale.tracking_number = data["tracking_number"]

    # Completed
    elif new_status == "Completed":
        if "completion_date" in data:
            try:
                sale.completion_date = datetime.fromisoformat(data["completion_date"]).date()
            except ValueError:
                sale.completion_date = date_today()
        else:
            sale.completion_date = date_today()
        if "amount_made" in data:
            try:
                sale.amount_made = float(data["amount_made"])
            except (ValueError, TypeError):
                pass

    # Cancelled: restore inventory + optional fee (Spec Section 4.3)
    elif new_status == "Cancelled":
        sale.cancellation_date = date_today()
        if "cancellation_type" in data:
            sale.cancellation_type = data["cancellation_type"]
        if "cancellation_date" in data:
            try:
                sale.cancellation_date = datetime.fromisoformat(data["cancellation_date"]).date()
            except ValueError:
                pass

        # Restore inventory (Spec 2.2.2: Sold → Available)
        _restore_inventory(sale)

        # Create fee record for confirmed cancellations (Spec 4.3 Path B)
        fee_amount = data.get("cancellation_fee")
        if fee_amount or sale.cancellation_type == "Confirmed":
            fee_usd = float(fee_amount) if fee_amount else 10.0
            conversion_rate = float(data.get("conversion_rate", 56.0))
            fee_php = fee_usd * conversion_rate

            sale.cancellation_fee = fee_usd

            expense = Expense(
                category="Platform Fee",
                description=f"Cancellation fee for Order #{sale.order_number}",
                amount_original=fee_usd,
                original_currency="USD",
                amount_php=fee_php,
                conversion_rate=conversion_rate,
                expense_date=sale.cancellation_date or date_today(),
                source="Alias",
                linked_sale_id=sale.sale_id,
            )
            db.session.add(expense)

    # Attention Needed
    elif new_status == "Attention Needed":
        if "issue_type" in data:
            sale.issue_type = data["issue_type"]
        if "discount_offered" in data:
            try:
                sale.discount_offered = float(data["discount_offered"])
            except (ValueError, TypeError):
                pass
        # Set 48-hour auto-discount deadline (Spec §3.3.4)
        from datetime import timedelta
        sale.attention_needed_deadline = now() + timedelta(hours=48)

    # Consigned
    elif new_status == "Consigned":
        # Inventory stays linked but status changes (Spec 2.2.2)
        linked_items = Inventory.query.filter_by(linked_sale_id=sale.sale_id).all()
        for item in linked_items:
            item.status = "Consigned"

    # Returned
    elif new_status == "Returned":
        _restore_inventory(sale)

    db.session.commit()

    return jsonify({
        "message": f"Sale transitioned from '{old_status}' to '{new_status}'.",
        "sale": sale.to_dict(),
    }), 200


# ---- Lookup by order number -----------------------------------------------

@sales_bp.route("/by-order/<int:order_number>", methods=["GET"])
def get_sale_by_order_number(order_number):
    """GET /api/sales/by-order/<order_number>"""
    sale = Sale.query.filter_by(order_number=order_number).first()
    if not sale:
        return jsonify({"error": f"No sale found with order number {order_number}."}), 404
    return jsonify(sale.to_dict()), 200


# ---- Summary endpoint -----------------------------------------------------

@sales_bp.route("/summary", methods=["GET"])
def sales_summary():
    """
    GET /api/sales/summary
    Dashboard KPIs: sales by status, totals, unmatched count.
    """
    status_counts = (
        db.session.query(Sale.status, func.count(Sale.sale_id))
        .group_by(Sale.status)
        .all()
    )

    by_status = {status: count for status, count in status_counts}

    total_sales = sum(by_status.values())
    unmatched = (
        db.session.query(func.count(Sale.sale_id))
        .filter(Sale.inventory_match_status == "Unmatched")
        .scalar()
    ) or 0

    total_amount_made_usd = (
        db.session.query(func.coalesce(func.sum(Sale.amount_made), 0))
        .filter(Sale.status == "Completed")
        .scalar()
    )

    return jsonify({
        "total_sales": total_sales,
        "by_status": by_status,
        "unmatched_sales": unmatched,
        "completed_earnings_usd": float(total_amount_made_usd),
    }), 200


@sales_bp.route("/<int:sale_id>/unmatch", methods=["POST"])
def unmatch_sale(sale_id):
    sale = db.session.get(Sale, sale_id)
    if not sale:
        return jsonify({"error": "Sale not found."}), 404

    _unmatch_sale_inventory(sale)
    db.session.commit()
    return jsonify({
        "message": "Sale inventory match has been removed.",
        "sale": sale.to_dict(),
    }), 200

