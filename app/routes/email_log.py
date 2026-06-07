"""
EmailProcessingLog API Routes — read-only access + manual log creation for debugging.
Spec references: Section 5.7, 9 (duplicate detection, error logging)
"""

from flask import Blueprint, request, jsonify
from app import db
from app.models.models import EmailProcessingLog
from datetime import datetime

email_log_bp = Blueprint("email_log", __name__)


VALID_EMAIL_TYPES = (
    "Sale", "Confirmation", "Shipped", "Completed", "Cancelled",
    "Attention", "BankTransfer", "Purchase", "Subscription", "Receipt", "Other",
)
VALID_STATUSES = ("Success", "Failed", "Skipped")


@email_log_bp.route("", methods=["GET"])
def list_logs():
    """
    GET /api/email-log
    Query params: status, email_type, linked_record_type, page, per_page, sort_by, order
    """
    query = EmailProcessingLog.query

    status = request.args.get("status")
    if status:
        query = query.filter(EmailProcessingLog.status == status)

    email_type = request.args.get("email_type")
    if email_type:
        query = query.filter(EmailProcessingLog.email_type == email_type)

    linked_type = request.args.get("linked_record_type")
    if linked_type:
        query = query.filter(EmailProcessingLog.linked_record_type == linked_type)

    sort_by = request.args.get("sort_by", "processed_at")
    order = request.args.get("order", "desc")
    _valid_sort = {c.key for c in EmailProcessingLog.__table__.columns}
    sort_col = getattr(EmailProcessingLog, sort_by) if sort_by in _valid_sort else EmailProcessingLog.processed_at
    if order == "asc":
        query = query.order_by(sort_col.asc())
    else:
        query = query.order_by(sort_col.desc())

    page = request.args.get("page", 1, type=int)
    per_page = min(request.args.get("per_page", 25, type=int), 100)
    pagination = query.paginate(page=page, per_page=per_page, error_out=False)

    return jsonify({
        "items": [log.to_dict() for log in pagination.items],
        "total": pagination.total,
        "page": pagination.page,
        "per_page": pagination.per_page,
        "pages": pagination.pages,
    }), 200


@email_log_bp.route("/<int:log_id>", methods=["GET"])
def get_log(log_id):
    """GET /api/email-log/<id>"""
    log = db.session.get(EmailProcessingLog, log_id)
    if not log:
        return jsonify({"error": "Log entry not found."}), 404
    return jsonify(log.to_dict()), 200


@email_log_bp.route("/by-message/<gmail_message_id>", methods=["GET"])
def get_log_by_message_id(gmail_message_id):
    """
    GET /api/email-log/by-message/<gmail_message_id>
    Used by the Gmail poller to check for duplicate processing.
    Spec: Section 9 — duplicate detection via GmailMessageID.
    """
    log = EmailProcessingLog.query.filter_by(gmail_message_id=gmail_message_id).first()
    if not log:
        return jsonify({"error": "No log found for this Gmail message ID."}), 404
    return jsonify(log.to_dict()), 200


@email_log_bp.route("", methods=["POST"])
def create_log():
    """
    POST /api/email-log
    Allows the Gmail integration service to record processed emails.
    Required: gmail_message_id, email_type, status
    """
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "Request body must be JSON."}), 400

    errors = []
    for field in ("gmail_message_id", "email_type", "status"):
        if field not in data or data[field] is None:
            errors.append(f"'{field}' is required.")
    if errors:
        return jsonify({"errors": errors}), 422

    if data["email_type"] not in VALID_EMAIL_TYPES:
        return jsonify({"errors": [f"'email_type' must be one of {VALID_EMAIL_TYPES}."]}), 422

    if data["status"] not in VALID_STATUSES:
        return jsonify({"errors": [f"'status' must be one of {VALID_STATUSES}."]}), 422

    # Enforce uniqueness on gmail_message_id
    existing = EmailProcessingLog.query.filter_by(
        gmail_message_id=data["gmail_message_id"]
    ).first()
    if existing:
        return jsonify({
            "error": "This Gmail message ID has already been logged.",
            "existing_log": existing.to_dict(),
        }), 409

    log = EmailProcessingLog(
        gmail_message_id=data["gmail_message_id"],
        email_type=data["email_type"],
        status=data["status"],
        parsed_data=data.get("parsed_data"),
        error_message=data.get("error_message"),
        linked_record_type=data.get("linked_record_type"),
        linked_record_id=data.get("linked_record_id"),
    )
    db.session.add(log)
    db.session.commit()
    return jsonify(log.to_dict()), 201


@email_log_bp.route("/summary", methods=["GET"])
def log_summary():
    """GET /api/email-log/summary — counts by status and email type."""
    from sqlalchemy import func

    by_status = (
        db.session.query(EmailProcessingLog.status, func.count(EmailProcessingLog.log_id))
        .group_by(EmailProcessingLog.status)
        .all()
    )
    by_type = (
        db.session.query(EmailProcessingLog.email_type, func.count(EmailProcessingLog.log_id))
        .group_by(EmailProcessingLog.email_type)
        .all()
    )

    return jsonify({
        "by_status": {status: count for status, count in by_status},
        "by_email_type": {email_type: count for email_type, count in by_type},
        "total": sum(count for _, count in by_status),
    }), 200
