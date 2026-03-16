"""
aCount Database Models
All entities from Technical Specification Section 5.
"""

from datetime import datetime, date
from app import db


# ---------------------------------------------------------------------------
# Application settings (Section 5.8)
# ---------------------------------------------------------------------------


class AppSetting(db.Model):
    __tablename__ = "app_settings"

    key = db.Column(db.String(64), primary_key=True)
    value = db.Column(db.Numeric(10, 4), nullable=False)
    updated_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self):
        return {
            "key": self.key,
            "value": float(self.value) if self.value is not None else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


# ---------------------------------------------------------------------------
# Inventory (Section 5.1)
# ---------------------------------------------------------------------------

class Inventory(db.Model):
    __tablename__ = "inventory"

    inventory_id    = db.Column(db.Integer, primary_key=True, autoincrement=True)
    sku             = db.Column(db.String(100), nullable=False)
    shoe_name       = db.Column(db.String(500), nullable=False)
    size            = db.Column(db.Float, nullable=False)
    date_purchased  = db.Column(db.DateTime, nullable=False)
    purchase_cost   = db.Column(db.Numeric(10, 2), nullable=False)      # PHP
    listed_price    = db.Column(db.Numeric(10, 2), nullable=True)       # USD
    status          = db.Column(
        db.String(20),
        nullable=False,
        default="Available",
    )  # Available | Sold | Consigned
    linked_sale_id  = db.Column(db.Integer, db.ForeignKey("sales.sale_id", ondelete="SET NULL"), nullable=True)
    source          = db.Column(db.String(255), nullable=True)
    notes           = db.Column(db.Text, nullable=True)
    created_at      = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    updated_at      = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationship
    linked_sale = db.relationship("Sale", backref="inventory_items", foreign_keys=[linked_sale_id])

    VALID_STATUSES = ("Available", "Sold", "Consigned")

    def to_dict(self):
        return {
            "inventory_id": self.inventory_id,
            "sku": self.sku,
            "shoe_name": self.shoe_name,
            "size": self.size,
            "date_purchased": self.date_purchased.isoformat() if self.date_purchased else None,
            "purchase_cost": float(self.purchase_cost) if self.purchase_cost else None,
            "listed_price": float(self.listed_price) if self.listed_price else None,
            "status": self.status,
            "linked_sale_id": self.linked_sale_id,
            "source": self.source,
            "notes": self.notes,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


# ---------------------------------------------------------------------------
# Sales (Section 5.2)
# ---------------------------------------------------------------------------

class Sale(db.Model):
    __tablename__ = "sales"

    sale_id                 = db.Column(db.Integer, primary_key=True, autoincrement=True)
    order_number            = db.Column(db.BigInteger, nullable=False)
    parent_order_number     = db.Column(db.BigInteger, nullable=True)
    platform                = db.Column(db.String(100), nullable=False, default="Alias")
    sale_type               = db.Column(db.String(20), nullable=True)   # Regular | FilledOffer | Consignment
    sku                     = db.Column(db.String(100), nullable=False)
    shoe_name               = db.Column(db.String(500), nullable=False)
    size                    = db.Column(db.Float, nullable=False)
    condition               = db.Column(db.String(20), nullable=True)       # New | Used
    box_condition           = db.Column(db.String(30), nullable=True)       # Good Condition | No Box | Badly Damaged
    selling_price           = db.Column(db.Numeric(10, 2), nullable=True)   # USD
    amount_made             = db.Column(db.Numeric(10, 2), nullable=True)   # USD
    sale_date               = db.Column(db.DateTime, nullable=False)
    status                  = db.Column(
        db.String(30),
        nullable=False,
        default="Pending",
    )  # Pending | Confirmed | Shipped | Completed | Cancelled | Attention Needed | Consigned | Returned
    issue_type                  = db.Column(db.String(255), nullable=True)
    attention_needed_deadline   = db.Column(db.DateTime, nullable=True)     # 48-hr auto-discount timer
    discount_offered            = db.Column(db.Numeric(10, 2), nullable=True)   # USD
    confirmation_datetime   = db.Column(db.DateTime, nullable=True)
    shipment_deadline       = db.Column(db.DateTime, nullable=True)
    pickup_address          = db.Column(db.Text, nullable=True)
    pickup_window           = db.Column(db.Text, nullable=True)
    shipment_date           = db.Column(db.DateTime, nullable=True)
    completion_date         = db.Column(db.Date, nullable=True)
    cancellation_date       = db.Column(db.Date, nullable=True)
    cancellation_type       = db.Column(db.String(30), nullable=True)       # Unconfirmed | Confirmed | Attention Needed
    cancellation_fee        = db.Column(db.Numeric(10, 2), nullable=True)   # USD
    tracking_number         = db.Column(db.String(255), nullable=True)
    inventory_match_status  = db.Column(
        db.String(20),
        nullable=False,
        default="Unmatched",
    )  # Matched | Unmatched
    notes                   = db.Column(db.Text, nullable=True)
    created_at              = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    updated_at              = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    VALID_STATUSES = (
        "Pending", "Confirmed", "Shipped", "Completed",
        "Cancelled", "Attention Needed", "Consigned", "Returned",
    )
    VALID_CONDITIONS = ("New", "Used")
    VALID_BOX_CONDITIONS = ("Good Condition", "No Box", "Badly Damaged")
    VALID_CANCELLATION_TYPES = ("Unconfirmed", "Confirmed", "Attention Needed")
    VALID_MATCH_STATUSES = ("Matched", "Unmatched")

    def to_dict(self):
        return {
            "sale_id": self.sale_id,
            "order_number": self.order_number,
            "parent_order_number": self.parent_order_number,
            "platform": self.platform,
            "sale_type": self.sale_type,
            "sku": self.sku,
            "shoe_name": self.shoe_name,
            "size": self.size,
            "condition": self.condition,
            "box_condition": self.box_condition,
            "selling_price": float(self.selling_price) if self.selling_price else None,
            "amount_made": float(self.amount_made) if self.amount_made else None,
            "sale_date": self.sale_date.isoformat() if self.sale_date else None,
            "status": self.status,
            "issue_type": self.issue_type,
            "attention_needed_deadline": self.attention_needed_deadline.isoformat() if self.attention_needed_deadline else None,
            "discount_offered": float(self.discount_offered) if self.discount_offered else None,
            "confirmation_datetime": self.confirmation_datetime.isoformat() if self.confirmation_datetime else None,
            "shipment_deadline": self.shipment_deadline.isoformat() if self.shipment_deadline else None,
            "pickup_address": self.pickup_address,
            "pickup_window": self.pickup_window,
            "shipment_date": self.shipment_date.isoformat() if self.shipment_date else None,
            "completion_date": self.completion_date.isoformat() if self.completion_date else None,
            "cancellation_date": self.cancellation_date.isoformat() if self.cancellation_date else None,
            "cancellation_type": self.cancellation_type,
            "cancellation_fee": float(self.cancellation_fee) if self.cancellation_fee else None,
            "tracking_number": self.tracking_number,
            "inventory_match_status": self.inventory_match_status,
            "notes": self.notes,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


# ---------------------------------------------------------------------------
# BankTransfers (Section 5.3)
# ---------------------------------------------------------------------------

class BankTransfer(db.Model):
    __tablename__ = "bank_transfers"

    transfer_id           = db.Column(db.Integer, primary_key=True, autoincrement=True)
    amount_php            = db.Column(db.Numeric(12, 2), nullable=False)
    bank_name             = db.Column(db.String(255), nullable=False)
    account_last4         = db.Column(db.String(4), nullable=False)
    transfer_date         = db.Column(db.DateTime, nullable=False)
    reconciliation_status = db.Column(
        db.String(30),
        nullable=False,
        default="Unreconciled",
    )  # Reconciled | Partially Reconciled | Unreconciled
    notes                 = db.Column(db.Text, nullable=True)
    created_at            = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)

    allocations = db.relationship("BankTransferAllocation", backref="bank_transfer", cascade="all, delete-orphan")

    def to_dict(self):
        return {
            "transfer_id": self.transfer_id,
            "amount_php": float(self.amount_php),
            "bank_name": self.bank_name,
            "account_last4": self.account_last4,
            "transfer_date": self.transfer_date.isoformat() if self.transfer_date else None,
            "reconciliation_status": self.reconciliation_status,
            "notes": self.notes,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


# ---------------------------------------------------------------------------
# BankTransferAllocations (Section 5.4) — Junction Table
# ---------------------------------------------------------------------------

class BankTransferAllocation(db.Model):
    __tablename__ = "bank_transfer_allocations"

    allocation_id    = db.Column(db.Integer, primary_key=True, autoincrement=True)
    transfer_id      = db.Column(db.Integer, db.ForeignKey("bank_transfers.transfer_id", ondelete="CASCADE"), nullable=False)
    sale_id          = db.Column(db.Integer, db.ForeignKey("sales.sale_id", ondelete="CASCADE"), nullable=False)
    allocated_amount = db.Column(db.Numeric(12, 2), nullable=False)  # PHP

    sale = db.relationship("Sale", backref="transfer_allocations")

    def to_dict(self):
        return {
            "allocation_id": self.allocation_id,
            "transfer_id": self.transfer_id,
            "sale_id": self.sale_id,
            "allocated_amount": float(self.allocated_amount),
        }


# ---------------------------------------------------------------------------
# Expenses (Section 5.5)
# ---------------------------------------------------------------------------

class Expense(db.Model):
    __tablename__ = "expenses"

    expense_id        = db.Column(db.Integer, primary_key=True, autoincrement=True)
    category          = db.Column(db.String(30), nullable=False)
    # Platform Fee | Subscription | Personal Order | Sneaker Purchase | Other
    description       = db.Column(db.String(500), nullable=False)
    amount_original   = db.Column(db.Numeric(10, 2), nullable=False)
    original_currency = db.Column(db.String(3), nullable=False, default="PHP")
    amount_php        = db.Column(db.Numeric(10, 2), nullable=False)
    conversion_rate   = db.Column(db.Numeric(10, 4), nullable=True)
    expense_date      = db.Column(db.Date, nullable=False)
    source            = db.Column(db.String(255), nullable=True)
    linked_sale_id    = db.Column(db.Integer, db.ForeignKey("sales.sale_id", ondelete="SET NULL"), nullable=True)
    notes             = db.Column(db.Text, nullable=True)
    created_at        = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)

    linked_sale = db.relationship("Sale", backref="expenses", foreign_keys=[linked_sale_id])

    VALID_CATEGORIES = ("Platform Fee", "Subscription", "Personal Order", "Sneaker Purchase", "Other")

    def to_dict(self):
        return {
            "expense_id": self.expense_id,
            "category": self.category,
            "description": self.description,
            "amount_original": float(self.amount_original),
            "original_currency": self.original_currency,
            "amount_php": float(self.amount_php),
            "conversion_rate": float(self.conversion_rate) if self.conversion_rate else None,
            "expense_date": self.expense_date.isoformat() if self.expense_date else None,
            "source": self.source,
            "linked_sale_id": self.linked_sale_id,
            "notes": self.notes,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


# ---------------------------------------------------------------------------
# Subscriptions (Section 5.6)
# ---------------------------------------------------------------------------

class Subscription(db.Model):
    __tablename__ = "subscriptions"

    subscription_id   = db.Column(db.Integer, primary_key=True, autoincrement=True)
    name              = db.Column(db.String(255), nullable=False)
    amount_original   = db.Column(db.Numeric(10, 2), nullable=False)
    original_currency = db.Column(db.String(3), nullable=False, default="PHP")
    amount_php        = db.Column(db.Numeric(10, 2), nullable=False)
    billing_cycle     = db.Column(db.String(20), nullable=False, default="Monthly")
    # Monthly | Quarterly | Annual
    next_billing_date = db.Column(db.Date, nullable=True)
    status            = db.Column(db.String(20), nullable=False, default="Active")
    # Active | Paused | Cancelled
    payment_method    = db.Column(db.String(255), nullable=True)
    notes             = db.Column(db.Text, nullable=True)
    created_at        = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    updated_at        = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self):
        return {
            "subscription_id": self.subscription_id,
            "name": self.name,
            "amount_original": float(self.amount_original),
            "original_currency": self.original_currency,
            "amount_php": float(self.amount_php),
            "billing_cycle": self.billing_cycle,
            "next_billing_date": self.next_billing_date.isoformat() if self.next_billing_date else None,
            "status": self.status,
            "payment_method": self.payment_method,
            "notes": self.notes,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


# ---------------------------------------------------------------------------
# EmailProcessingLog (Section 5.7)
# ---------------------------------------------------------------------------

class EmailProcessingLog(db.Model):
    __tablename__ = "email_processing_log"

    log_id             = db.Column(db.Integer, primary_key=True, autoincrement=True)
    gmail_message_id   = db.Column(db.String(255), nullable=False, unique=True)
    email_type         = db.Column(db.String(30), nullable=False)
    # Sale | Confirmation | Shipped | Completed | Cancelled | Attention | BankTransfer | Purchase | Subscription | Receipt | Other
    processed_at       = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    parsed_data        = db.Column(db.JSON, nullable=True)
    status             = db.Column(db.String(20), nullable=False, default="Success")
    # Success | Failed | Skipped
    error_message      = db.Column(db.Text, nullable=True)
    linked_record_type = db.Column(db.String(100), nullable=True)
    linked_record_id   = db.Column(db.Integer, nullable=True)

    def to_dict(self):
        return {
            "log_id": self.log_id,
            "gmail_message_id": self.gmail_message_id,
            "email_type": self.email_type,
            "processed_at": self.processed_at.isoformat() if self.processed_at else None,
            "parsed_data": self.parsed_data,
            "status": self.status,
            "error_message": self.error_message,
            "linked_record_type": self.linked_record_type,
            "linked_record_id": self.linked_record_id,
        }
