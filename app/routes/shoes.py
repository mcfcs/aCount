"""
Shoe Master API Routes.
"""

import re

from flask import Blueprint, request, jsonify, send_from_directory

from app import db
from app.models.models import Shoe
from app.shoe_images import get_shoe_image_upload_dir, save_uploaded_shoe_image, save_shoe_image_from_url
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
    _valid_sort = {c.key for c in Shoe.__table__.columns}
    sort_col = getattr(Shoe, sort_by) if sort_by in _valid_sort else Shoe.sku
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
        # Strip trailing colorway/variant in straight or curly quotes, keep the base model.
        # Examples:
        #   Wmns Air Jordan 1 Mid 'French Blue' -> Wmns Air Jordan 1 Mid
        #   Wmns Air Jordan 1 Mid ‘French Blue’ -> Wmns Air Jordan 1 Mid
        # Keep model names like AF1 '07' because they end in digits, not a colorway phrase.
        return re.sub(r"\s+['‘’][^'‘’]*[A-Za-z][^'‘’]*['‘’]$", "", cleaned).strip()

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
        payload = shoe.to_dict()
        payload["exact_match"] = True
        return jsonify(payload), 200

    prefix = trimmed.split(" ", 1)[0]
    shoe = Shoe.query.filter(Shoe.sku.ilike(f"{prefix}%")).first()
    if not shoe:
        inferred_name = derive_new_balance_name_from_sku(trimmed)
        if inferred_name:
            return jsonify({
                "sku": trimmed,
                "name": inferred_name,
                "brand": "New Balance",
                "status": "inferred",
                "exact_match": False,
            }), 200
        return jsonify({"error": "No shoe found for this SKU."}), 404

    payload = shoe.to_dict()
    payload["name"] = derive_model_name(payload["name"])
    payload["exact_match"] = False
    return jsonify(payload), 200


@shoes_bp.get("/image/<path:filename>")
def get_shoe_image(filename: str):
    return send_from_directory(get_shoe_image_upload_dir(), filename)


@shoes_bp.post("/ensure")
def ensure_shoe():
    """
    POST /api/shoes/ensure
    Payload: { sku, name, brand?, image? }
    """
    if request.content_type and "multipart/form-data" in request.content_type.lower():
        data = request.form
        image_file = request.files.get("image")
    else:
        data = request.get_json(silent=True) or {}
        image_file = None

    sku = data.get("sku")
    name = data.get("name")
    brand = data.get("brand")
    image_url = data.get("image_url")
    image_path = None

    if not sku:
        return jsonify({"error": "'sku' is required."}), 400

    try:
        if image_file and image_file.filename:
            image_path = save_uploaded_shoe_image(image_file)
        elif image_url:
            image_path = save_shoe_image_from_url(image_url)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    created, shoe = ensure_shoe_exists(sku, name, brand=brand, image_path=image_path)
    if shoe and name:
        shoe.name = str(name).strip() or shoe.name
    if shoe and brand:
        shoe.brand = str(brand).strip() or shoe.brand
    db.session.commit()
    return jsonify({
        "created": created,
        "shoe": shoe.to_dict() if shoe else None,
    }), 200
