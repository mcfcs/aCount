-- aCount performance indexes
-- Fresh databases get these automatically from the SQLAlchemy models. Run this
-- ONCE against an existing database (e.g. the Supabase SQL editor) to add them.
-- Safe to re-run: each statement is guarded with IF NOT EXISTS (PostgreSQL).

-- Deferred confirmation/completion lookups in the Gmail pipeline.
CREATE INDEX IF NOT EXISTS ix_email_log_type_linked
    ON email_processing_log (email_type, linked_record_id);

-- Bank-transfer reconciliation filters allocations by sale.
CREATE INDEX IF NOT EXISTS ix_bta_sale_id
    ON bank_transfer_allocations (sale_id);

-- Expenses are looked up / nulled by their linked sale.
CREATE INDEX IF NOT EXISTS ix_expense_linked_sale
    ON expenses (linked_sale_id);
