"""
Inventory API Routes — CRUD + FIFO matching support.
Spec references: Section 2.2, 5.1
"""

from flask import Blueprint, request, jsonify
from app import db
from app.models.models import Inventory, Sale
from app.shoe_utils import ensure_shoe_exists
from datetime import datetime
from sqlalchemy import func

inventory_bp = Blueprint("inventory", __name__)


def _lowest_nonzero_purchase_cost(sku, exclude_sale_id=None, exclude_inventory_id=None):
    """
    Return the smallest non-zero purchase_cost across Inventory and Sales for the
    same sku.
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


# ---- Validation helpers ---------------------------------------------------

VALID_STATUSES = ("Available", "Sold", "Consigned")


def _apply_inventory_filters(query, args):
    q = args.get("q")
    if q:
        keyword = f"%{q}%"
        query = query.filter(
            db.or_(
                Inventory.sku.ilike(keyword),
                Inventory.shoe_name.ilike(keyword),
            )
        )

    status = args.get("status")
    if status:
        query = query.filter(Inventory.status == status)

    sku = args.get("sku")
    if sku:
        query = query.filter(Inventory.sku.ilike(f"%{sku}%"))

    shoe_name = args.get("shoe_name")
    if shoe_name:
        query = query.filter(Inventory.shoe_name.ilike(f"%{shoe_name}%"))

    size = args.get("size")
    if size:
        try:
            query = query.filter(Inventory.size == float(size))
        except ValueError:
            pass

    size_type = args.get("size_type")
    if size_type == "womens":
        query = query.filter(
            db.or_(
                Inventory.shoe_name.ilike("%Wmns%"),
                Inventory.shoe_name.ilike("%Women's%"),
                Inventory.shoe_name.ilike("%Womens%"),
            )
        )
    elif size_type == "kids":
        query = query.filter(Inventory.shoe_name.ilike("%GS%"))
    elif size_type == "mens":
        query = query.filter(
            ~Inventory.shoe_name.ilike("%Wmns%"),
            ~Inventory.shoe_name.ilike("%Women's%"),
            ~Inventory.shoe_name.ilike("%Womens%"),
            ~Inventory.shoe_name.ilike("%GS%"),
        )

    source = args.get("source")
    if source:
        query = query.filter(Inventory.source.ilike(f"%{source}%"))

    return query


def _parse_inventory_payload(data, is_update=False):
    """Validate and parse incoming inventory JSON. Returns (dict, error_msg)."""
    errors = []

    if not is_update:
        for field in ("sku", "shoe_name", "size", "date_purchased", "purchase_cost"):
            if field not in data or data[field] is None:
                errors.append(f"'{field}' is required.")

    parsed = {}

    if "sku" in data:
        parsed["sku"] = str(data["sku"]).strip()
    if "shoe_name" in data:
        parsed["shoe_name"] = str(data["shoe_name"]).strip()
    if "size" in data:
        try:
            parsed["size"] = float(data["size"])
        except (ValueError, TypeError):
            errors.append("'size' must be a number.")
    if "date_purchased" in data:
        try:
            parsed["date_purchased"] = datetime.fromisoformat(str(data["date_purchased"]))
        except ValueError:
            errors.append("'date_purchased' must be ISO 8601 format.")
    if "purchase_cost" in data:
        try:
            parsed["purchase_cost"] = float(data["purchase_cost"])
        except (ValueError, TypeError):
            errors.append("'purchase_cost' must be a number.")
    if "listed_price" in data:
        if data["listed_price"] in (None, ""):
            parsed["listed_price"] = None
        else:
            try:
                parsed["listed_price"] = float(data["listed_price"])
            except (ValueError, TypeError):
                errors.append("'listed_price' must be a number.")
    if "status" in data:
        if data["status"] not in VALID_STATUSES:
            errors.append(f"'status' must be one of {VALID_STATUSES}.")
        else:
            parsed["status"] = data["status"]
    if "linked_sale_id" in data:
        parsed["linked_sale_id"] = data["linked_sale_id"]
    if "source" in data:
        parsed["source"] = data["source"]
    if "notes" in data:
        parsed["notes"] = data["notes"]
    if "brand" in data:
        parsed["brand"] = data["brand"]

    if errors:
        return None, errors
    return parsed, None


# ---- CRUD -----------------------------------------------------------------

@inventory_bp.route("", methods=["GET"])
def list_inventory():
    """
    GET /api/inventory
    Query params: status, sku, size, page, per_page, sort_by, order
    """
    query = _apply_inventory_filters(Inventory.query, request.args)

    # Sorting
    sort_by = request.args.get("sort_by", "created_at")
    order = request.args.get("order", "desc")
    sort_col = getattr(Inventory, sort_by, Inventory.created_at)
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
        "items": [item.to_dict() for item in pagination.items],
        "total": pagination.total,
        "page": pagination.page,
        "per_page": pagination.per_page,
        "pages": pagination.pages,
    }), 200


@inventory_bp.route("/<int:inventory_id>", methods=["GET"])
def get_inventory_item(inventory_id):
    """GET /api/inventory/<id>"""
    item = db.session.get(Inventory, inventory_id)
    if not item:
        return jsonify({"error": "Inventory item not found."}), 404
    return jsonify(item.to_dict()), 200


@inventory_bp.route("", methods=["POST"])
def create_inventory_item():
    """
    POST /api/inventory
    Creates a new inventory record (Status defaults to Available).
    After creation, checks for any unmatched sales that could be linked via FIFO.
    """
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "Request body must be JSON."}), 400

    parsed, errors = _parse_inventory_payload(data)
    if errors:
        return jsonify({"errors": errors}), 422

    ensure_shoe_exists(
        parsed.get("sku"),
        parsed.get("shoe_name"),
        brand=parsed.get("brand"),
    )

    inventory_payload = dict(parsed)
    inventory_payload.pop("brand", None)
    item = Inventory(**inventory_payload)
    if "status" not in parsed:
        item.status = "Available"

    db.session.add(item)
    db.session.flush()  # get the ID before checking unmatched sales

    # --- FIFO: check for unmatched sales (Spec 2.2.3, step 5) ---
    unmatched_sale = (
        Sale.query
        .filter_by(sku=item.sku, size=item.size, inventory_match_status="Unmatched")
        .order_by(Sale.sale_date.asc())
        .first()
    )

    prompt_link = None
    if unmatched_sale:
        prompt_link = {
            "message": "An unmatched sale exists for this SKU + Size. Link it?",
            "sale_id": unmatched_sale.sale_id,
            "order_number": unmatched_sale.order_number,
            "shoe_name": unmatched_sale.shoe_name,
        }

    db.session.commit()

    response = {"item": item.to_dict()}
    if prompt_link:
        response["unmatched_sale_prompt"] = prompt_link

    return jsonify(response), 201


@inventory_bp.route("/bulk", methods=["POST"])
def create_inventory_items():
    """
    POST /api/inventory/bulk
    Creates inventory rows in bulk using:
    {
      "sku": "...",
      "shoe_name": "...",
      "purchase_cost": 0,
      "date_purchased": "2026-03-19T00:00:00",
      "items": [
        {"size": 9, "quantity": 2},
        {"size": 10.5, "quantity": 1}
      ],
      "status": "Available",
      ...
    }
    """
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "Request body must be JSON."}), 400

    raw_items = data.get("items")
    if not isinstance(raw_items, list) or not raw_items:
        return jsonify({"error": "'items' must be a non-empty array."}), 422

    created = []

    common = dict(data)
    common.pop("items", None)

    if "size" in common:
        return jsonify({"error": "'size' should be included inside each items entry, not at root."}), 422

    common_payload, errors = _parse_inventory_payload(common, is_update=True)
    if errors:
        return jsonify({"errors": errors}), 422

    missing = [field for field in ("sku", "shoe_name", "date_purchased", "purchase_cost") if field not in common_payload]
    if missing:
        return jsonify({"error": f"Missing required root fields: {', '.join(missing)}."}), 422

    # Validate required root fields and ensure the shoe exists before creating rows.
    # _parse_inventory_payload enforces these in create mode.
    ensure_shoe_exists(
        common_payload.get("sku"),
        common_payload.get("shoe_name"),
        brand=common_payload.get("brand"),
    )
    common_payload.pop("brand", None)

    if "status" not in common_payload:
        common_payload["status"] = "Available"

    for idx, raw in enumerate(raw_items):
        if not isinstance(raw, dict):
            return jsonify({"error": f"items[{idx}] must be an object with size and quantity."}), 422

        row = dict(common_payload)
        row.update(raw)

        quantity = row.pop("quantity", 1)
        try:
            quantity = int(quantity)
        except (TypeError, ValueError):
            return jsonify({"error": f"items[{idx}].quantity must be an integer >= 1."}), 422

        if quantity <= 0:
            return jsonify({"error": f"items[{idx}].quantity must be at least 1."}), 422

        row["quantity"] = quantity
        parsed_row, row_errors = _parse_inventory_payload(row)
        if row_errors:
            return jsonify({"errors": [f"items[{idx}] {err}" for err in row_errors]}), 422

        parsed_row.pop("quantity", None)
        for _ in range(quantity):
            created.append(Inventory(**parsed_row))
            db.session.add(created[-1])

    db.session.commit()
    return jsonify({"items": [item.to_dict() for item in created], "count": len(created)}), 201


@inventory_bp.route("/<int:inventory_id>", methods=["PUT", "PATCH"])
def update_inventory_item(inventory_id):
    """PUT/PATCH /api/inventory/<id>"""
    item = db.session.get(Inventory, inventory_id)
    if not item:
        return jsonify({"error": "Inventory item not found."}), 404

    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "Request body must be JSON."}), 400

    parsed, errors = _parse_inventory_payload(data, is_update=True)
    if errors:
        return jsonify({"errors": errors}), 422

    brand = parsed.pop("brand", None)
    if brand is not None:
        ensure_shoe_exists(parsed.get("sku"), parsed.get("shoe_name"), brand=brand)

    for key, value in parsed.items():
        setattr(item, key, value)

    db.session.commit()
    return jsonify(item.to_dict()), 200


@inventory_bp.route("/<int:inventory_id>", methods=["DELETE"])
def delete_inventory_item(inventory_id):
    """DELETE /api/inventory/<id>"""
    item = db.session.get(Inventory, inventory_id)
    if not item:
        return jsonify({"error": "Inventory item not found."}), 404

    db.session.delete(item)
    db.session.commit()
    return jsonify({"message": f"Inventory item {inventory_id} deleted."}), 200


# ---- FIFO Link endpoint --------------------------------------------------

@inventory_bp.route("/<int:inventory_id>/link-sale/<int:sale_id>", methods=["POST"])
def link_inventory_to_sale(inventory_id, sale_id):
    """
    POST /api/inventory/<id>/link-sale/<sale_id>
    Manually link an inventory item to a sale (for resolving unmatched sales).
    Spec: Section 2.2.3, step 5.
    """
    item = db.session.get(Inventory, inventory_id)
    if not item:
        return jsonify({"error": "Inventory item not found."}), 404

    sale = db.session.get(Sale, sale_id)
    if not sale:
        return jsonify({"error": "Sale not found."}), 404

    if item.status != "Available":
        return jsonify({"error": f"Inventory item is '{item.status}', must be 'Available' to link."}), 409

    item.status = "Sold"
    item.linked_sale_id = sale.sale_id
    linked_cost = float(item.purchase_cost) if item.purchase_cost else 0
    if linked_cost <= 0:
            fallback_cost = _lowest_nonzero_purchase_cost(item.sku, exclude_sale_id=sale.sale_id, exclude_inventory_id=item.inventory_id)
            sale.purchase_cost = fallback_cost if fallback_cost is not None else linked_cost
    else:
        sale.purchase_cost = linked_cost
    sale.inventory_match_status = "Matched"

    db.session.commit()

    return jsonify({
        "message": "Inventory item linked to sale.",
        "inventory": item.to_dict(),
        "sale": sale.to_dict(),
    }), 200


# ---- Purchase cost options endpoint --------------------------------------

@inventory_bp.route("/purchase-costs", methods=["GET"])
def get_purchase_costs():
    """
    GET /api/inventory/purchase-costs?sku=XXX
    Returns all distinct non-zero purchase costs recorded for a SKU
    across both Inventory and Sales tables, sorted ascending, plus the
    most recently recorded listed price from Inventory for that SKU.
    """
    sku = request.args.get("sku", "").strip()
    if not sku:
        return jsonify({"error": "sku is required"}), 400

    inv_costs = (
        db.session.query(Inventory.purchase_cost)
        .filter(
            Inventory.sku == sku,
            Inventory.purchase_cost.isnot(None),
            Inventory.purchase_cost > 0,
        )
        .distinct()
        .all()
    )

    sale_costs = (
        db.session.query(Sale.purchase_cost)
        .filter(
            Sale.sku == sku,
            Sale.purchase_cost.isnot(None),
            Sale.purchase_cost > 0,
        )
        .distinct()
        .all()
    )

    all_costs = sorted({float(r[0]) for r in inv_costs + sale_costs})
    latest_listed_price = (
        db.session.query(Inventory.listed_price)
        .filter(
            Inventory.sku == sku,
            Inventory.listed_price.isnot(None),
        )
        .order_by(Inventory.updated_at.desc(), Inventory.created_at.desc(), Inventory.inventory_id.desc())
        .limit(1)
        .scalar()
    )

    return jsonify({
        "sku": sku,
        "costs": all_costs,
        "listed_price": float(latest_listed_price) if latest_listed_price is not None else None,
    }), 200


# ---- Summary endpoint -----------------------------------------------------

@inventory_bp.route("/summary", methods=["GET"])
def inventory_summary():
    """
    GET /api/inventory/summary
    Dashboard KPIs: active count, total value, breakdown by status.
    """
    from sqlalchemy import func

    query = _apply_inventory_filters(Inventory.query, request.args)

    filtered = query.with_entities(
        Inventory.inventory_id,
        Inventory.status,
        Inventory.purchase_cost,
    ).subquery()

    stats = (
        db.session.query(
            filtered.c.status,
            func.count(filtered.c.inventory_id).label("count"),
            func.coalesce(func.sum(filtered.c.purchase_cost), 0).label("total_cost"),
        )
        .group_by(filtered.c.status)
        .all()
    )

    total_count = db.session.query(func.count(filtered.c.inventory_id)).scalar() or 0

    breakdown = {}
    total_value = 0.0

    for status, count, cost in stats:
        breakdown[status] = {"count": count, "value_php": float(cost)}
        if status == "Available":
            total_value = float(cost)

    return jsonify({
        "active_count": breakdown.get("Available", {}).get("count", 0),
        "active_value_php": total_value,
        "total_items": total_count,
        "by_status": breakdown,
    }), 200
