from typing import Optional, Tuple

from app import db
from app.models.models import Shoe


BRAND_KEYWORDS = [
    ("air jordan", "Air Jordan"),
    ("new balance", "New Balance"),
    ("adidas", "Adidas"),
    ("nike", "Nike"),
    ("puma", "Puma"),
    ("asics", "Asics"),
    ("converse", "Converse"),
    ("hoka", "Hoka"),
    ("reebok", "Reebok"),
]


def infer_brand_from_name(shoe_name: str | None) -> str:
    """
    Heuristic brand classification from shoe name.
    """
    if not shoe_name:
        return "Other"

    text = str(shoe_name).lower()
    for keyword, brand in BRAND_KEYWORDS:
        if keyword in text:
            return brand
    return "Other"


def ensure_shoe_exists(sku: Optional[str], shoe_name: Optional[str], brand: Optional[str] = None) -> Tuple[bool, Optional[Shoe]]:
    """
    Ensure a Shoes row exists for the given SKU.
    Returns (created, Shoe | None).
    """
    if not sku:
        return False, None

    sku = str(sku).strip()
    if not sku:
        return False, None

    normalized_name = (shoe_name or "").strip() or "Unknown"
    inferred_brand = infer_brand_from_name(normalized_name)
    final_brand = (brand or "").strip() or inferred_brand
    if not final_brand:
        final_brand = "Other"

    shoe = Shoe.query.filter_by(sku=sku).first()
    if shoe:
        if (not shoe.name) or (shoe.name.lower() == "unknown" and normalized_name != "Unknown"):
            shoe.name = normalized_name
        if shoe.brand == "Other" and final_brand != "Other":
            shoe.brand = final_brand
        return False, shoe

    new_shoe = Shoe(sku=sku, name=normalized_name, brand=final_brand)
    db.session.add(new_shoe)
    return True, new_shoe

