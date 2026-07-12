"""
Barcode Scanning API Routes — UPC/EAN lookup + confirm-to-inventory.

Shoe-box barcodes are GTINs (UPC-A / EAN-13) that identify one style + size.
Lookup order:
  1. Local product_barcodes cache (verified mappings from confirmed scans).
  2. UPCitemdb — keyless free trial tier (~100 lookups/day), or the paid
     tier when UPCITEMDB_API_KEY is set.
"""

import re

import requests
from flask import Blueprint, current_app, jsonify, request

from app import db
from app.models.models import Inventory, ProductBarcode, Shoe
from app.routes.inventory import _parse_inventory_payload
from app.shoe_images import save_shoe_image_from_url
from app.shoe_utils import ensure_shoe_exists, infer_brand_from_name

barcodes_bp = Blueprint("barcodes", __name__)

UPCITEMDB_TRIAL_URL = "https://api.upcitemdb.com/prod/trial/lookup"
UPCITEMDB_PAID_URL = "https://api.upcitemdb.com/prod/v1/lookup"

# Style codes: Nike/Jordan "DD8959-103" (stored as "DD8959 103" to match app
# convention), compact codes like Adidas "GX3605".
NIKE_STYLE_RE = re.compile(r"\b([A-Z]{2}\d{4})[-_ ](\d{3})\b")
COMPACT_STYLE_RE = re.compile(r"^[A-Z]{1,3}\d{4,6}$")


def normalize_gtin(raw):
    """Canonicalize a scanned code to GTIN-13. Returns None when invalid."""
    digits = re.sub(r"\D", "", str(raw or ""))
    if len(digits) == 14 and digits.startswith("0"):
        digits = digits[1:]
    if len(digits) in (8, 12):
        digits = digits.zfill(13)
    if len(digits) != 13:
        return None
    return digits


def _upc_query_code(gtin13):
    # UPC-A codes live in EAN-13 space with a leading 0; UPCitemdb indexes
    # them in their 12-digit form.
    return gtin13[1:] if gtin13.startswith("0") else gtin13


def _parse_size(size_field, title):
    size_text = str(size_field or "").strip()
    if size_text:
        match = re.search(r"(\d{1,2}(?:\.\d)?)", size_text)
        if match:
            return float(match.group(1))
    match = re.search(r"\b(?:size|sz)\s*:?\s*(\d{1,2}(?:\.\d)?)\b", str(title or ""), re.I)
    if match:
        return float(match.group(1))
    return None


def _guess_sku(model, title, images):
    model_text = str(model or "").strip().upper()
    match = NIKE_STYLE_RE.search(model_text)
    if match:
        return f"{match.group(1)} {match.group(2)}"
    if COMPACT_STYLE_RE.match(model_text):
        return model_text
    # Retailer image URLs often embed the style code (e.g. .../DV3950_001?...).
    for text in [str(title or "").upper()] + [str(url).upper() for url in (images or [])]:
        match = NIKE_STYLE_RE.search(text)
        if match:
            return f"{match.group(1)} {match.group(2)}"
    return ""


def _resolve_brand(api_brand, title):
    brand = infer_brand_from_name(f"{api_brand or ''} {title or ''}")
    return "" if brand == "Other" else brand


def _clean_title(title):
    # Drop retailer suffixes like "... from Finish Line".
    return re.sub(r"\s+from\s+[A-Z][\w'. ]+$", "", str(title or "").strip()).strip()


def _lookup_upcitemdb(gtin13):
    """Query UPCitemdb. Returns (parsed_dict | None, error_key | None)."""
    api_key = current_app.config.get("UPCITEMDB_API_KEY")
    if api_key:
        url = UPCITEMDB_PAID_URL
        headers = {"user_key": api_key, "key_type": "3scale"}
    else:
        url = UPCITEMDB_TRIAL_URL
        headers = {}

    try:
        response = requests.get(
            url,
            params={"upc": _upc_query_code(gtin13)},
            headers=headers,
            timeout=15,
        )
    except requests.RequestException:
        current_app.logger.warning("UPCitemdb request failed for %s", gtin13, exc_info=True)
        return None, "network"

    if response.status_code == 429:
        return None, "rate_limited"
    if response.status_code != 200:
        current_app.logger.warning(
            "UPCitemdb returned HTTP %s for %s: %s",
            response.status_code, gtin13, response.text[:200],
        )
        return None, "lookup_failed"

    try:
        payload = response.json()
    except ValueError:
        return None, "lookup_failed"

    items = payload.get("items") or []
    if not items:
        return None, None  # valid response, code simply not indexed

    item = items[0]
    title = _clean_title(item.get("title"))
    images = item.get("images") or []
    return {
        "name": title,
        "brand": _resolve_brand(item.get("brand"), title),
        "size": _parse_size(item.get("size"), item.get("title")),
        "sku": _guess_sku(item.get("model"), item.get("title"), images),
        "image_url": next((str(u) for u in images if u), ""),
        "title": str(item.get("title") or ""),
    }, None


LOOKUP_ERROR_MESSAGES = {
    "rate_limited": "The barcode database's free daily limit was reached. Enter the details manually — they'll be remembered for next time.",
    "network": "Could not reach the barcode database. Check the internet connection and try again, or enter the details manually.",
    "lookup_failed": "The barcode database returned an unexpected response. Enter the details manually.",
}


@barcodes_bp.get("/lookup/<string:code>")
def lookup_barcode(code):
    """
    GET /api/barcodes/lookup/:code
    Resolve a scanned UPC/EAN to shoe details for the confirm popup.
    Always 200 with {found: bool, ...} for a valid code so the UI can fall
    back to manual entry; 400 only when the code itself is malformed.
    """
    gtin = normalize_gtin(code)
    if not gtin:
        return jsonify({"error": "Invalid barcode. Expected an 8/12/13-digit UPC/EAN code."}), 400

    cached = ProductBarcode.query.filter_by(barcode=gtin).first()
    if cached:
        image_url = cached.image_url or ""
        shoe = Shoe.query.filter_by(sku=cached.sku).first() if cached.sku else None
        if shoe and shoe.image_path:
            image_url = f"/api/shoes/image/{shoe.image_path}"
        return jsonify({
            "found": True,
            "source": "local",
            "verified": cached.source == "confirmed",
            "barcode": gtin,
            "name": cached.name or (shoe.name if shoe else ""),
            "brand": cached.brand or (shoe.brand if shoe else ""),
            "size": cached.size,
            "sku": cached.sku or "",
            "image_url": image_url,
        }), 200

    parsed, error = _lookup_upcitemdb(gtin)
    if error:
        return jsonify({
            "found": False,
            "source": "upcitemdb",
            "barcode": gtin,
            "error": error,
            "message": LOOKUP_ERROR_MESSAGES[error],
        }), 200

    if not parsed:
        return jsonify({
            "found": False,
            "source": "upcitemdb",
            "barcode": gtin,
            "message": "This barcode isn't in the product database yet. Enter the details manually — they'll be remembered for next time.",
        }), 200

    # Cache the hit so rescans don't burn the daily lookup quota.
    try:
        db.session.add(ProductBarcode(
            barcode=gtin,
            sku=parsed["sku"] or None,
            size=parsed["size"],
            name=parsed["name"] or None,
            brand=parsed["brand"] or None,
            image_url=parsed["image_url"] or None,
            source="lookup",
        ))
        db.session.commit()
    except Exception:
        db.session.rollback()

    return jsonify({
        "found": True,
        "source": "upcitemdb",
        "verified": False,
        "barcode": gtin,
        **parsed,
    }), 200


@barcodes_bp.post("/confirm")
def confirm_barcode():
    """
    POST /api/barcodes/confirm
    Called after the user verifies the scanned details. Creates the inventory
    item (same required fields as POST /api/inventory), upserts the shoe
    master row, and remembers the barcode → SKU/size mapping.
    Payload: inventory fields + optional { barcode, image_url }.
    """
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "Request body must be JSON."}), 400

    parsed, errors = _parse_inventory_payload(data)
    if errors:
        return jsonify({"errors": errors}), 422

    gtin = normalize_gtin(data.get("barcode"))
    image_url = str(data.get("image_url") or "").strip()

    # Fetch the product image once per shoe; never let it block the add.
    image_path = None
    existing_shoe = Shoe.query.filter_by(sku=parsed["sku"]).first()
    if image_url and not image_url.startswith("/") and not (existing_shoe and existing_shoe.image_path):
        try:
            image_path = save_shoe_image_from_url(image_url)
        except Exception:
            current_app.logger.warning("Shoe image download failed for %s", image_url, exc_info=True)

    ensure_shoe_exists(
        parsed.get("sku"),
        parsed.get("shoe_name"),
        brand=parsed.get("brand"),
        image_path=image_path,
    )

    if gtin:
        mapping = ProductBarcode.query.filter_by(barcode=gtin).first()
        if not mapping:
            mapping = ProductBarcode(barcode=gtin)
            db.session.add(mapping)
        mapping.sku = parsed["sku"]
        mapping.size = parsed["size"]
        mapping.name = parsed["shoe_name"]
        mapping.brand = (parsed.get("brand") or "").strip() or infer_brand_from_name(parsed["shoe_name"])
        if image_url and not image_url.startswith("/"):
            mapping.image_url = image_url
        mapping.source = "confirmed"

    inventory_payload = dict(parsed)
    inventory_payload.pop("brand", None)
    item = Inventory(**inventory_payload)
    if "status" not in parsed:
        item.status = "Available"

    db.session.add(item)
    db.session.commit()

    return jsonify({"item": item.to_dict(), "barcode": gtin}), 201
