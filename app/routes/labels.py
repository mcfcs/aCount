"""
Shipping Labels API Routes.

Surfaces the prepaid shipping labels captured from Alias "Order #XXXX -
Shipping Label and Instructions" (Confirmation) emails, and compiles the
selected labels into a single print-ready PDF (two source pages per landscape
sheet, fit to printable area).

Endpoints:
  GET  /api/labels        - list sales that have a shipping label PDF
  POST /api/labels/print  - download + combine selected labels into one PDF
"""

import io
import logging

from flask import Blueprint, request, jsonify, send_file
from app import db
from app.models.models import Sale
from app.labels_pdf import download_pdf, build_two_up_pdf, LabelPdfError

logger = logging.getLogger(__name__)

labels_bp = Blueprint("labels", __name__)

MAX_LABELS_PER_PRINT = 50


def _label_row(s: Sale) -> dict:
    return {
        "sale_id": s.sale_id,
        "order_number": s.order_number,
        "shoe_name": s.shoe_name,
        "sku": s.sku,
        "size": s.size,
        "status": s.status,
        "shipping_label_url": s.shipping_label_url,
        "shipment_deadline": s.shipment_deadline.isoformat() if s.shipment_deadline else None,
        "confirmation_datetime": s.confirmation_datetime.isoformat() if s.confirmation_datetime else None,
        "sale_date": s.sale_date.isoformat() if s.sale_date else None,
        "pickup_window": s.pickup_window,
    }


@labels_bp.get("")
def list_labels():
    """
    GET /api/labels
    Query params:
      status - optional exact Sale.status filter
      q      - optional search across shoe_name / sku / order_number
    Only sales that carry a shipping label PDF are returned.
    """
    query = Sale.query.filter(
        Sale.shipping_label_url.isnot(None),
        Sale.shipping_label_url != "",
    )

    status = request.args.get("status")
    if status:
        query = query.filter(Sale.status == status)

    q = (request.args.get("q") or "").strip()
    if q:
        like = f"%{q}%"
        filters = [Sale.shoe_name.ilike(like), Sale.sku.ilike(like)]
        if q.isdigit():
            filters.append(Sale.order_number == int(q))
        query = query.filter(db.or_(*filters))

    sales = query.order_by(Sale.sale_date.desc()).all()
    items = [_label_row(s) for s in sales]
    return jsonify({"items": items, "total": len(items)}), 200


def _resolve_sales(data: dict):
    """Resolve the requested sales, preserving the caller's ordering.

    Returns (sales, error_response). Accepts either 'order_numbers' or
    'sale_ids' as a non-empty list of integers.
    """
    order_numbers = data.get("order_numbers")
    sale_ids = data.get("sale_ids")

    if isinstance(order_numbers, list) and order_numbers:
        try:
            wanted = [int(o) for o in order_numbers]
        except (TypeError, ValueError):
            return None, (jsonify({"error": "'order_numbers' must be integers."}), 400)
        found = {s.order_number: s for s in Sale.query.filter(Sale.order_number.in_(wanted)).all()}
        return [found[o] for o in wanted if o in found], None

    if isinstance(sale_ids, list) and sale_ids:
        try:
            wanted = [int(i) for i in sale_ids]
        except (TypeError, ValueError):
            return None, (jsonify({"error": "'sale_ids' must be integers."}), 400)
        found = {s.sale_id: s for s in Sale.query.filter(Sale.sale_id.in_(wanted)).all()}
        return [found[i] for i in wanted if i in found], None

    return None, (jsonify({"error": "Provide a non-empty 'order_numbers' or 'sale_ids' list."}), 400)


@labels_bp.post("/print")
def print_labels():
    """
    POST /api/labels/print
    Body (JSON): { "order_numbers": [int, ...] }  (or { "sale_ids": [...] })

    Downloads each selected label PDF and returns a single combined PDF with
    two source pages per landscape sheet, scaled to fit the printable area.
    Orders whose PDF could not be downloaded are reported in the
    'X-Labels-Skipped' response header (comma-separated order numbers).
    """
    data = request.get_json(silent=True) or {}
    sales, error = _resolve_sales(data)
    if error:
        return error

    if len(sales) > MAX_LABELS_PER_PRINT:
        return jsonify({"error": f"Too many labels selected (max {MAX_LABELS_PER_PRINT})."}), 400

    # Collect label URLs in the requested order, de-duplicated, skipping any
    # selected sale that has no label.
    seen = set()
    targets = []  # list of (order_number, url)
    for s in sales:
        url = (s.shipping_label_url or "").strip()
        if not url or url in seen:
            continue
        seen.add(url)
        targets.append((s.order_number, url))

    if not targets:
        return jsonify({"error": "None of the selected orders have a shipping label."}), 400

    pdf_bytes_list = []
    skipped = []
    for order_number, url in targets:
        try:
            pdf_bytes_list.append(download_pdf(url))
        except Exception as exc:
            logger.warning(f"Label download failed for order #{order_number}: {exc}")
            skipped.append(str(order_number))

    if not pdf_bytes_list:
        return jsonify({
            "error": "Could not download any of the selected label PDFs.",
            "skipped": skipped,
        }), 502

    try:
        combined = build_two_up_pdf(pdf_bytes_list)
    except LabelPdfError as exc:
        return jsonify({"error": str(exc), "skipped": skipped}), 502

    count = len(pdf_bytes_list)
    if count == 1 and len(targets) == 1:
        download_name = f"shipping-label-{targets[0][0]}.pdf"
    else:
        download_name = f"shipping-labels-{count}.pdf"

    resp = send_file(
        io.BytesIO(combined),
        mimetype="application/pdf",
        as_attachment=False,
        download_name=download_name,
    )
    # Exposed to the browser via CORS expose_headers (see app factory).
    resp.headers["X-Labels-Skipped"] = ",".join(skipped)
    return resp
