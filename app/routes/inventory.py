"""
Inventory API Routes — CRUD + FIFO matching support.
Spec references: Section 2.2, 5.1
"""

from flask import Blueprint, request, jsonify
from app import db
from app.models.models import Inventory, Sale
from datetime import datetime

inventory_bp = Blueprint("inventory", __name__)


# ---- Validation helpers ---------------------------------------------------

VALID_STATUSES = ("Available", "Sold", "Consigned")


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
    if "listed_price" in data and data["listed_price"] is not None:
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
    query = Inventory.query

    # Filters
    status = request.args.get("status")
    if status:
        query = query.filter(Inventory.status == status)

    sku = request.args.get("sku")
    if sku:
        query = query.filter(Inventory.sku.ilike(f"%{sku}%"))

    shoe_name = request.args.get("shoe_name")
    if shoe_name:
        query = query.filter(Inventory.shoe_name.ilike(f"%{shoe_name}%"))

    size = request.args.get("size")
    if size:
        try:
            query = query.filter(Inventory.size == float(size))
        except ValueError:
            pass

    source = request.args.get("source")
    if source:
        query = query.filter(Inventory.source.ilike(f"%{source}%"))

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
    per_page = min(per_page, 100)  # cap

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

    item = Inventory(**parsed)
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
    sale.inventory_match_status = "Matched"

    db.session.commit()

    return jsonify({
        "message": "Inventory item linked to sale.",
        "inventory": item.to_dict(),
        "sale": sale.to_dict(),
    }), 200


# ---- Summary endpoint -----------------------------------------------------

@inventory_bp.route("/summary", methods=["GET"])
def inventory_summary():
    """
    GET /api/inventory/summary
    Dashboard KPIs: active count, total value, breakdown by status.
    """
    from sqlalchemy import func

    stats = (
        db.session.query(
            Inventory.status,
            func.count(Inventory.inventory_id).label("count"),
            func.coalesce(func.sum(Inventory.purchase_cost), 0).label("total_cost"),
        )
        .group_by(Inventory.status)
        .all()
    )

    breakdown = {}
    total_count = 0
    total_value = 0.0

    for status, count, cost in stats:
        breakdown[status] = {"count": count, "value_php": float(cost)}
        total_count += count
        if status == "Available":
            total_value = float(cost)

    return jsonify({
        "active_count": breakdown.get("Available", {}).get("count", 0),
        "active_value_php": total_value,
        "total_items": total_count,
        "by_status": breakdown,
    }), 200
