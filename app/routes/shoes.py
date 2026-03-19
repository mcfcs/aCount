"""
Shoe Master API Routes.
"""

from flask import Blueprint, request, jsonify
import re

from app import db
from app.models.models import Shoe
from app.shoe_utils import ensure_shoe_exists
from sqlalchemy import or_

shoes_bp = Blueprint("shoes", __name__)


@shoes_bp.route("", methods=["GET"])
def list_shoes():
    """
    GET /api/shoes
    Query params:
      - sku
      - brand
      - name
      - q
      - page
      - per_page
      - sort_by
      - order
    """
    query = Shoe.query

    q = request.args.get("q")
    if q:
        keyword = f"%{q}%"
        query = query.filter(
            or_(
                Shoe.sku.ilike(keyword),
                Shoe.name.ilike(keyword),
            )
        )

    sku = request.args.get("sku")
    if sku:
        query = query.filter(Shoe.sku.ilike(f"%{sku}%"))

    brand = request.args.get("brand")
    if brand:
        query = query.filter(Shoe.brand.ilike(f"%{brand}%"))

    name = request.args.get("name")
    if name:
        query = query.filter(Shoe.name.ilike(f"%{name}%"))

    page = request.args.get("page", 1, type=int)
    per_page = request.args.get("per_page", 25, type=int)
    per_page = min(per_page, 200)

    sort_by = request.args.get("sort_by", "sku")
    order = request.args.get("order", "asc")
    sort_col = getattr(Shoe, sort_by, Shoe.sku)
    if order == "desc":
        sort_col = sort_col.desc()
    query = query.order_by(sort_col)

    pagination = query.paginate(page=page, per_page=per_page, error_out=False)
    return jsonify({
        "items": [s.to_dict() for s in pagination.items],
        "total": pagination.total,
        "page": pagination.page,
        "per_page": pagination.per_page,
        "pages": pagination.pages,
    }), 200


@shoes_bp.get("/by-sku/<string:sku>")
def get_shoe_by_sku(sku: str):
    """
    GET /api/shoes/by-sku/:sku
    """
    trimmed = (sku or "").strip()
    if not trimmed:
        return jsonify({"error": "sku is required."}), 400

    def derive_model_name(name):
        cleaned = (name or "").strip()
        # Strip trailing colorway/variant in quotes, keep base model (e.g. AF1 '07)
        return re.sub(r"\s+'[^']+'$", "", cleaned).strip() if "'" in cleaned else cleaned

    def derive_new_balance_name_from_sku(sku_value):
        text = re.sub(r"\s+", "", str(sku_value or "").upper())
        match = re.search(r"\d+", text)
        if not match:
            return None
        number = str(int(match.group(0)))
        if text.startswith("BB") or text.startswith("U") or text.startswith("NB"):
            return f"New Balance {number}"
        return None

    shoe = Shoe.query.filter_by(sku=trimmed).first()
    if shoe:
        return jsonify(shoe.to_dict()), 200

    prefix = trimmed.split(" ", 1)[0]
    shoe = Shoe.query.filter(Shoe.sku.ilike(f"{prefix}%")).first()
    if not shoe:
        inferred_name = derive_new_balance_name_from_sku(trimmed)
        if inferred_name:
            return jsonify({
                "sku": trimmed,
                "name": inferred_name,
                "brand": "New Balance",
                "status": "inferred"
            }), 200
        return jsonify({"error": "No shoe found for this SKU."}), 404

    payload = shoe.to_dict()
    payload["name"] = derive_model_name(payload["name"])
    return jsonify(payload), 200


@shoes_bp.post("/ensure")
def ensure_shoe():
    """
    POST /api/shoes/ensure
    Payload: { sku, name, brand? }
    """
    data = request.get_json(silent=True) or {}
    sku = data.get("sku")
    name = data.get("name")
    brand = data.get("brand")

    if not sku:
        return jsonify({"error": "'sku' is required."}), 400

    created, shoe = ensure_shoe_exists(sku, name, brand=brand)
    db.session.commit()
    return jsonify({
        "created": created,
        "shoe": shoe.to_dict() if shoe else None,
    }), 200
