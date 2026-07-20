"""
BankTransfers API Routes — CRUD + allocation management + reconciliation.
Spec references: Sections 2.3.4, 4.5, 5.3, 5.4
"""

from flask import Blueprint, request, jsonify
from app import db
from app.models.models import BankTransfer, BankTransferAllocation, Sale
from datetime import datetime

bank_transfers_bp = Blueprint("bank_transfers", __name__)


# ---- Validation helpers ---------------------------------------------------

VALID_RECONCILIATION_STATUSES = ("Reconciled", "Partially Reconciled", "Unreconciled")


def _parse_transfer_payload(data, is_update=False):
    """Validate and parse incoming BankTransfer JSON. Returns (dict, errors)."""
    errors = []

    if not is_update:
        for field in ("amount_php", "bank_name", "account_last4", "transfer_date"):
            if field not in data or data[field] is None:
                errors.append(f"'{field}' is required.")

    parsed = {}

    if "amount_php" in data and data["amount_php"] is not None:
        try:
            parsed["amount_php"] = float(data["amount_php"])
        except (ValueError, TypeError):
            errors.append("'amount_php' must be a number.")

    if "bank_name" in data:
        parsed["bank_name"] = str(data["bank_name"]).strip()

    if "account_last4" in data:
        val = str(data["account_last4"]).strip()
        if len(val) != 4 or not val.isdigit():
            errors.append("'account_last4' must be exactly 4 digits.")
        else:
            parsed["account_last4"] = val

    if "transfer_date" in data and data["transfer_date"] is not None:
        try:
            parsed["transfer_date"] = datetime.fromisoformat(str(data["transfer_date"]))
        except ValueError:
            errors.append("'transfer_date' must be ISO 8601 format.")

    if "reconciliation_status" in data:
        if data["reconciliation_status"] not in VALID_RECONCILIATION_STATUSES:
            errors.append(f"'reconciliation_status' must be one of {VALID_RECONCILIATION_STATUSES}.")
        else:
            parsed["reconciliation_status"] = data["reconciliation_status"]

    if "notes" in data:
        parsed["notes"] = data["notes"]

    if errors:
        return None, errors
    return parsed, None


# ---- CRUD -----------------------------------------------------------------

@bank_transfers_bp.route("", methods=["GET"])
def list_transfers():
    """
    GET /api/bank-transfers
    Query params: reconciliation_status, bank_name, page, per_page, sort_by, order
    """
    query = BankTransfer.query

    status = request.args.get("reconciliation_status")
    if status:
        query = query.filter(BankTransfer.reconciliation_status == status)

    bank_name = request.args.get("bank_name")
    if bank_name:
        query = query.filter(BankTransfer.bank_name.ilike(f"%{bank_name}%"))

    sort_by = request.args.get("sort_by", "transfer_date")
    order = request.args.get("order", "desc")
    _valid_sort = {c.key for c in BankTransfer.__table__.columns}
    sort_col = getattr(BankTransfer, sort_by) if sort_by in _valid_sort else BankTransfer.transfer_date
    if order == "asc":
        query = query.order_by(sort_col.asc())
    else:
        query = query.order_by(sort_col.desc())

    page = request.args.get("page", 1, type=int)
    per_page = min(request.args.get("per_page", 25, type=int), 100)
    pagination = query.paginate(page=page, per_page=per_page, error_out=False)

    return jsonify({
        "items": [t.to_dict() for t in pagination.items],
        "total": pagination.total,
        "page": pagination.page,
        "per_page": pagination.per_page,
        "pages": pagination.pages,
    }), 200


@bank_transfers_bp.route("/<int:transfer_id>", methods=["GET"])
def get_transfer(transfer_id):
    """GET /api/bank-transfers/<id>"""
    transfer = db.session.get(BankTransfer, transfer_id)
    if not transfer:
        return jsonify({"error": "Bank transfer not found."}), 404
    result = transfer.to_dict()
    result["allocations"] = [a.to_dict() for a in transfer.allocations]
    return jsonify(result), 200


@bank_transfers_bp.route("", methods=["POST"])
def create_transfer():
    """
    POST /api/bank-transfers
    Creates a bank transfer record. Status defaults to Unreconciled.
    Optionally accepts 'allocations' array to link to sales immediately.
    Spec: Section 4.5
    """
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "Request body must be JSON."}), 400

    parsed, errors = _parse_transfer_payload(data)
    if errors:
        return jsonify({"errors": errors}), 422

    transfer = BankTransfer(**parsed)
    if "reconciliation_status" not in parsed:
        transfer.reconciliation_status = "Unreconciled"

    db.session.add(transfer)
    db.session.flush()

    # Optional inline allocations
    allocations_data = data.get("allocations", [])
    allocation_errors = _apply_allocations(transfer, allocations_data)
    if allocation_errors:
        db.session.rollback()
        return jsonify({"errors": allocation_errors}), 422

    _update_reconciliation_status(transfer)
    db.session.commit()

    result = transfer.to_dict()
    result["allocations"] = [a.to_dict() for a in transfer.allocations]
    return jsonify(result), 201


@bank_transfers_bp.route("/<int:transfer_id>", methods=["PUT", "PATCH"])
def update_transfer(transfer_id):
    """PUT/PATCH /api/bank-transfers/<id>"""
    transfer = db.session.get(BankTransfer, transfer_id)
    if not transfer:
        return jsonify({"error": "Bank transfer not found."}), 404

    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "Request body must be JSON."}), 400

    parsed, errors = _parse_transfer_payload(data, is_update=True)
    if errors:
        return jsonify({"errors": errors}), 422

    for key, value in parsed.items():
        setattr(transfer, key, value)

    db.session.commit()
    return jsonify(transfer.to_dict()), 200


@bank_transfers_bp.route("/<int:transfer_id>", methods=["DELETE"])
def delete_transfer(transfer_id):
    """DELETE /api/bank-transfers/<id>"""
    transfer = db.session.get(BankTransfer, transfer_id)
    if not transfer:
        return jsonify({"error": "Bank transfer not found."}), 404
    db.session.delete(transfer)
    db.session.commit()
    return jsonify({"message": f"Bank transfer {transfer_id} deleted."}), 200


# ---- Allocation endpoints -------------------------------------------------

@bank_transfers_bp.route("/<int:transfer_id>/allocations", methods=["GET"])
def list_allocations(transfer_id):
    """GET /api/bank-transfers/<id>/allocations"""
    transfer = db.session.get(BankTransfer, transfer_id)
    if not transfer:
        return jsonify({"error": "Bank transfer not found."}), 404
    return jsonify([a.to_dict() for a in transfer.allocations]), 200


@bank_transfers_bp.route("/<int:transfer_id>/allocations", methods=["POST"])
def add_allocation(transfer_id):
    """
    POST /api/bank-transfers/<id>/allocations
    Body: { "sale_id": 1, "allocated_amount": 45417.60 }
    Links (part of) a bank transfer to a specific sale.
    Spec: Section 5.4
    """
    transfer = db.session.get(BankTransfer, transfer_id)
    if not transfer:
        return jsonify({"error": "Bank transfer not found."}), 404

    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "Request body must be JSON."}), 400

    errors = _apply_allocations(transfer, [data])
    if errors:
        return jsonify({"errors": errors}), 422

    _update_reconciliation_status(transfer)
    db.session.commit()

    result = transfer.to_dict()
    result["allocations"] = [a.to_dict() for a in transfer.allocations]
    return jsonify(result), 201


@bank_transfers_bp.route("/<int:transfer_id>/allocations/<int:allocation_id>", methods=["DELETE"])
def remove_allocation(transfer_id, allocation_id):
    """DELETE /api/bank-transfers/<id>/allocations/<allocation_id>"""
    allocation = db.session.get(BankTransferAllocation, allocation_id)
    if not allocation or allocation.transfer_id != transfer_id:
        return jsonify({"error": "Allocation not found."}), 404

    transfer = allocation.bank_transfer
    db.session.delete(allocation)

    _update_reconciliation_status(transfer)
    db.session.commit()
    return jsonify({"message": f"Allocation {allocation_id} removed."}), 200


# ---- Reconciliation assist ------------------------------------------------

@bank_transfers_bp.route("/auto-reconcile", methods=["POST"])
def auto_reconcile_all():
    """
    POST /api/bank-transfers/auto-reconcile
    Run conservative amount-aware matching over every Unreconciled transfer
    (unique single within ±2%, or unique pair within ±1.5%). Ambiguous ones
    stay Unreconciled for the suggestions flow.
    """
    from app.gmail.processor import auto_reconcile_all_transfers
    return jsonify(auto_reconcile_all_transfers()), 200


@bank_transfers_bp.route("/<int:transfer_id>/suggestions", methods=["GET"])
def allocation_suggestions(transfer_id):
    """
    GET /api/bank-transfers/<id>/suggestions
    Ranked candidate sales for reconciling this transfer. Sales earn USD while
    payouts arrive in PHP, so matches are estimated via the configured rate:
    single sales closest to the amount, plus pair/greedy combos for batched
    cash-outs.
    """
    transfer = db.session.get(BankTransfer, transfer_id)
    if not transfer:
        return jsonify({"error": "Bank transfer not found."}), 404

    from app.gmail.processor import _unallocated_completed_sales
    from app.utils import get_php_estimate_rate

    rate = get_php_estimate_rate()
    amount = float(transfer.amount_php)
    candidates = _unallocated_completed_sales(transfer.transfer_date, window_days=60)

    def entry(sale):
        est = float(sale.amount_made) * rate
        return {
            "sale_id": sale.sale_id,
            "order_number": sale.order_number,
            "shoe_name": sale.shoe_name,
            "completion_date": sale.completion_date.isoformat() if sale.completion_date else None,
            "amount_usd": float(sale.amount_made),
            "est_php": round(est, 2),
            "diff_pct": round(abs(est - amount) / amount * 100, 2) if amount else None,
            # If this sale IS the payout, this was Alias's actual FX rate —
            # comparing it to the configured rate tells the operator what to
            # set in Settings for auto-reconcile to work well.
            "implied_rate": round(amount / float(sale.amount_made), 2) if float(sale.amount_made) else None,
        }

    singles = sorted((entry(s) for s in candidates), key=lambda e: e["diff_pct"])
    singles = [e for e in singles if e["diff_pct"] is not None and e["diff_pct"] <= 10][:10]

    # Pair combos for batched payouts (cap the candidate pool for O(n^2)).
    pool = sorted(candidates, key=lambda s: float(s.amount_made), reverse=True)[:120]
    pairs = []
    for i in range(len(pool)):
        for j in range(i + 1, len(pool)):
            est = (float(pool[i].amount_made) + float(pool[j].amount_made)) * rate
            diff = abs(est - amount) / amount if amount else 1
            if diff <= 0.02:
                pairs.append({
                    "sale_ids": [pool[i].sale_id, pool[j].sale_id],
                    "order_numbers": [pool[i].order_number, pool[j].order_number],
                    "est_php": round(est, 2),
                    "diff_pct": round(diff * 100, 2),
                })
    pairs.sort(key=lambda e: e["diff_pct"])

    # Bounded subset search for larger batches (payouts often cover 3+ sales).
    # DFS over the value-sorted pool, ±3% tolerance to absorb FX-rate error,
    # depth ≤ 6, node budget so response time stays bounded.
    greedy_combo = None
    if amount:
        search_pool = sorted(candidates, key=lambda s: float(s.amount_made), reverse=True)[:60]
        found = []
        budget = [30000]

        def dfs(start, chosen, total_est):
            if budget[0] <= 0 or len(found) >= 5:
                return
            budget[0] -= 1
            diff = abs(total_est - amount) / amount
            if len(chosen) >= 3 and diff <= 0.03:
                found.append((diff, list(chosen)))
                return
            if len(chosen) >= 6 or total_est > amount * 1.03:
                return
            for i in range(start, len(search_pool)):
                sale = search_pool[i]
                dfs(i + 1, chosen + [sale], total_est + float(sale.amount_made) * rate)

        dfs(0, [], 0.0)
        if found:
            found.sort(key=lambda item: item[0])
            diff, combo = found[0]
            total = sum(float(s.amount_made) for s in combo) * rate
            greedy_combo = {
                "sale_ids": [s.sale_id for s in combo],
                "order_numbers": [s.order_number for s in combo],
                "est_php": round(total, 2),
                "diff_pct": round(diff * 100, 2),
            }

    return jsonify({
        "transfer_id": transfer.transfer_id,
        "amount_php": amount,
        "rate_used": rate,
        "candidates_in_window": len(candidates),
        "singles": singles,
        "pairs": pairs[:5],
        "greedy_combo": greedy_combo,
    }), 200


@bank_transfers_bp.route("/duplicates", methods=["GET"])
def duplicate_transfers():
    """
    GET /api/bank-transfers/duplicates
    Same-day, same-amount transfer groups — likely double-ingested payout
    emails (historical dedup compared Numeric to float and missed them).
    Read-only report; deleting is the operator's call.
    """
    groups = {}
    for t in BankTransfer.query.order_by(BankTransfer.transfer_date).all():
        key = (t.transfer_date.date().isoformat(), round(float(t.amount_php), 2))
        groups.setdefault(key, []).append(t)

    duplicates = [
        {
            "transfer_date": key[0],
            "amount_php": key[1],
            "count": len(items),
            "transfers": [t.to_dict() for t in items],
        }
        for key, items in groups.items() if len(items) > 1
    ]
    duplicates.sort(key=lambda g: g["transfer_date"])
    return jsonify({"groups": duplicates, "total_extra_rows": sum(g["count"] - 1 for g in duplicates)}), 200


@bank_transfers_bp.route("/duplicates/clean", methods=["POST"])
def clean_duplicate_transfers():
    """
    POST /api/bank-transfers/duplicates/clean
    Body: { "confirm": "CLEAN-DUPLICATES" }

    Deletes the extra copies in each same-day same-amount group (artifacts of
    force re-scrapes before ingestion dedup was fixed), keeping one row per
    group — preferring a row that has allocations, else the oldest. Explicit
    confirmation required; review GET /api/bank-transfers/duplicates first.
    """
    data = request.get_json(silent=True) or {}
    if str(data.get("confirm", "")).strip() != "CLEAN-DUPLICATES":
        return jsonify({"error": 'Send {"confirm": "CLEAN-DUPLICATES"} to proceed. Review GET /duplicates first.'}), 400

    groups = {}
    for t in BankTransfer.query.all():
        key = (t.transfer_date.date(), round(float(t.amount_php), 2))
        groups.setdefault(key, []).append(t)

    deleted, kept, removed_php = 0, 0, 0.0
    for items in groups.values():
        if len(items) < 2:
            continue
        allocated = {t.transfer_id for t in items
                     if BankTransferAllocation.query.filter_by(transfer_id=t.transfer_id).count() > 0}
        items.sort(key=lambda t: (t.transfer_id not in allocated, t.transfer_id))
        keeper, extras = items[0], items[1:]
        kept += 1
        for extra in extras:
            if extra.transfer_id in allocated:
                continue  # never silently drop a reconciled row
            removed_php += float(extra.amount_php)
            db.session.delete(extra)
            deleted += 1

    db.session.commit()
    return jsonify({
        "deleted": deleted,
        "groups_cleaned": kept,
        "removed_php_total": round(removed_php, 2),
    }), 200


# ---- Summary --------------------------------------------------------------

@bank_transfers_bp.route("/summary", methods=["GET"])
def transfers_summary():
    """GET /api/bank-transfers/summary — totals and reconciliation breakdown."""
    from sqlalchemy import func

    stats = (
        db.session.query(
            BankTransfer.reconciliation_status,
            func.count(BankTransfer.transfer_id).label("count"),
            func.coalesce(func.sum(BankTransfer.amount_php), 0).label("total_php"),
        )
        .group_by(BankTransfer.reconciliation_status)
        .all()
    )

    by_status = {}
    total_php = 0.0
    for status, count, total in stats:
        by_status[status] = {"count": count, "total_php": float(total)}
        total_php += float(total)

    return jsonify({
        "total_transfers": sum(v["count"] for v in by_status.values()),
        "total_php": total_php,
        "by_reconciliation_status": by_status,
    }), 200


# ---- Internal helpers -----------------------------------------------------

def _apply_allocations(transfer, allocations_data):
    """Validate and create BankTransferAllocation records. Returns list of errors."""
    errors = []
    for alloc in allocations_data:
        sale_id = alloc.get("sale_id")
        amount = alloc.get("allocated_amount")

        if sale_id is None:
            errors.append("Each allocation must include 'sale_id'.")
            continue
        if amount is None:
            errors.append("Each allocation must include 'allocated_amount'.")
            continue

        try:
            amount = float(amount)
        except (ValueError, TypeError):
            errors.append("'allocated_amount' must be a number.")
            continue

        sale = db.session.get(Sale, sale_id)
        if not sale:
            errors.append(f"Sale {sale_id} not found.")
            continue

        # Prevent duplicate allocation for same transfer+sale
        existing = BankTransferAllocation.query.filter_by(
            transfer_id=transfer.transfer_id, sale_id=sale_id
        ).first()
        if existing:
            errors.append(f"Sale {sale_id} is already allocated to this transfer.")
            continue

        allocation = BankTransferAllocation(
            transfer_id=transfer.transfer_id,
            sale_id=sale_id,
            allocated_amount=amount,
        )
        db.session.add(allocation)

    return errors


def _update_reconciliation_status(transfer):
    """
    Recompute reconciliation_status based on allocated vs. total amount.
    Spec: Section 5.3 — Reconciled | Partially Reconciled | Unreconciled
    """
    db.session.flush()
    allocations = BankTransferAllocation.query.filter_by(transfer_id=transfer.transfer_id).all()
    allocated_total = sum(float(a.allocated_amount) for a in allocations)
    total = float(transfer.amount_php)

    if allocated_total == 0:
        transfer.reconciliation_status = "Unreconciled"
    elif allocated_total >= total:
        transfer.reconciliation_status = "Reconciled"
    else:
        transfer.reconciliation_status = "Partially Reconciled"
