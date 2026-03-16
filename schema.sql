-- =============================================================================
-- aCount — PostgreSQL Schema
-- Version 1.0 — March 2026
-- Run: psql -U acount_user -d acount_db -f schema.sql
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 5.1 Inventory
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory (
    inventory_id    SERIAL PRIMARY KEY,
    sku             VARCHAR(100)    NOT NULL,
    shoe_name       VARCHAR(500)    NOT NULL,
    size            DOUBLE PRECISION NOT NULL,
    date_purchased  TIMESTAMP       NOT NULL,
    purchase_cost   DECIMAL(10, 2)  NOT NULL,                -- PHP
    listed_price    DECIMAL(10, 2),                          -- USD
    status          VARCHAR(20)     NOT NULL DEFAULT 'Available'
                        CHECK (status IN ('Available', 'Sold', 'Consigned')),
    linked_sale_id  INTEGER         REFERENCES sales(sale_id) ON DELETE SET NULL,
    source          VARCHAR(255),
    notes           TEXT,
    created_at      TIMESTAMP       NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMP       NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 5.2 Sales
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sales (
    sale_id                 SERIAL PRIMARY KEY,
    order_number            BIGINT          NOT NULL,
    parent_order_number     BIGINT,
    platform                VARCHAR(100)    NOT NULL DEFAULT 'Alias',
    sku                     VARCHAR(100)    NOT NULL,
    shoe_name               VARCHAR(500)    NOT NULL,
    size                    DOUBLE PRECISION NOT NULL,
    condition               VARCHAR(20)     CHECK (condition IN ('New', 'Used')),
    box_condition           VARCHAR(30)     CHECK (box_condition IN ('Good Condition', 'No Box', 'Badly Damaged')),
    selling_price           DECIMAL(10, 2),                  -- USD
    amount_made             DECIMAL(10, 2),                  -- USD
    sale_date               TIMESTAMP       NOT NULL,
    status                  VARCHAR(30)     NOT NULL DEFAULT 'Pending'
                                CHECK (status IN (
                                    'Pending', 'Confirmed', 'Shipped', 'Completed',
                                    'Cancelled', 'Attention Needed', 'Consigned', 'Returned'
                                )),
    issue_type              VARCHAR(255),
    discount_offered        DECIMAL(10, 2),                  -- USD
    confirmation_datetime   TIMESTAMP,
    shipment_deadline       TIMESTAMP,
    pickup_address          TEXT,
    pickup_window           VARCHAR(255),
    shipment_date           TIMESTAMP,
    completion_date         DATE,
    cancellation_date       DATE,
    cancellation_type       VARCHAR(30)     CHECK (cancellation_type IN ('Unconfirmed', 'Confirmed', 'Attention Needed')),
    cancellation_fee        DECIMAL(10, 2),                  -- USD
    tracking_number         VARCHAR(255),
    inventory_match_status  VARCHAR(20)     NOT NULL DEFAULT 'Unmatched'
                                CHECK (inventory_match_status IN ('Matched', 'Unmatched')),
    notes                   TEXT,
    created_at              TIMESTAMP       NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMP       NOT NULL DEFAULT NOW()
);

-- Forward reference: inventory.linked_sale_id → sales
ALTER TABLE inventory
    ADD CONSTRAINT IF NOT EXISTS fk_inventory_linked_sale
    FOREIGN KEY (linked_sale_id) REFERENCES sales(sale_id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- 5.3 BankTransfers
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bank_transfers (
    transfer_id             SERIAL PRIMARY KEY,
    amount_php              DECIMAL(12, 2)  NOT NULL,
    bank_name               VARCHAR(255)    NOT NULL,
    account_last4           VARCHAR(4)      NOT NULL,
    transfer_date           TIMESTAMP       NOT NULL,
    reconciliation_status   VARCHAR(30)     NOT NULL DEFAULT 'Unreconciled'
                                CHECK (reconciliation_status IN ('Reconciled', 'Partially Reconciled', 'Unreconciled')),
    notes                   TEXT,
    created_at              TIMESTAMP       NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 5.4 BankTransferAllocations (Junction Table)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bank_transfer_allocations (
    allocation_id       SERIAL PRIMARY KEY,
    transfer_id         INTEGER         NOT NULL REFERENCES bank_transfers(transfer_id) ON DELETE CASCADE,
    sale_id             INTEGER         NOT NULL REFERENCES sales(sale_id) ON DELETE CASCADE,
    allocated_amount    DECIMAL(12, 2)  NOT NULL,            -- PHP
    UNIQUE (transfer_id, sale_id)
);

-- ---------------------------------------------------------------------------
-- 5.5 Expenses
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS expenses (
    expense_id          SERIAL PRIMARY KEY,
    category            VARCHAR(30)     NOT NULL
                            CHECK (category IN (
                                'Platform Fee', 'Subscription', 'Personal Order',
                                'Sneaker Purchase', 'Other'
                            )),
    description         VARCHAR(500)    NOT NULL,
    amount_original     DECIMAL(10, 2)  NOT NULL,
    original_currency   VARCHAR(3)      NOT NULL DEFAULT 'PHP',
    amount_php          DECIMAL(10, 2)  NOT NULL,
    conversion_rate     DECIMAL(10, 4),
    expense_date        DATE            NOT NULL,
    source              VARCHAR(255),
    linked_sale_id      INTEGER         REFERENCES sales(sale_id) ON DELETE SET NULL,
    notes               TEXT,
    created_at          TIMESTAMP       NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 5.6 Subscriptions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS subscriptions (
    subscription_id     SERIAL PRIMARY KEY,
    name                VARCHAR(255)    NOT NULL,
    amount_original     DECIMAL(10, 2)  NOT NULL,
    original_currency   VARCHAR(3)      NOT NULL DEFAULT 'PHP',
    amount_php          DECIMAL(10, 2)  NOT NULL,
    billing_cycle       VARCHAR(20)     NOT NULL DEFAULT 'Monthly'
                            CHECK (billing_cycle IN ('Monthly', 'Quarterly', 'Annual')),
    next_billing_date   DATE,
    status              VARCHAR(20)     NOT NULL DEFAULT 'Active'
                            CHECK (status IN ('Active', 'Paused', 'Cancelled')),
    payment_method      VARCHAR(255),
    notes               TEXT,
    created_at          TIMESTAMP       NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMP       NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 5.7 EmailProcessingLog
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_processing_log (
    log_id              SERIAL PRIMARY KEY,
    gmail_message_id    VARCHAR(255)    NOT NULL UNIQUE,
    email_type          VARCHAR(30)     NOT NULL
                            CHECK (email_type IN (
                                'Sale', 'Confirmation', 'Shipped', 'Completed',
                                'Cancelled', 'Attention', 'BankTransfer',
                                'Purchase', 'Subscription', 'Receipt', 'Other'
                            )),
    processed_at        TIMESTAMP       NOT NULL DEFAULT NOW(),
    parsed_data         JSONB,
    status              VARCHAR(20)     NOT NULL DEFAULT 'Success'
                            CHECK (status IN ('Success', 'Failed', 'Skipped')),
    error_message       TEXT,
    linked_record_type  VARCHAR(100),
    linked_record_id    INTEGER
);

-- ---------------------------------------------------------------------------
-- Indexes for common query patterns
-- ---------------------------------------------------------------------------

-- Inventory: filter by status, SKU+size for FIFO matching
CREATE INDEX IF NOT EXISTS idx_inventory_status          ON inventory(status);
CREATE INDEX IF NOT EXISTS idx_inventory_sku_size_status ON inventory(sku, size, status);
CREATE INDEX IF NOT EXISTS idx_inventory_date_purchased  ON inventory(date_purchased);

-- Sales: filter by status, order_number lookups, FIFO matching
CREATE INDEX IF NOT EXISTS idx_sales_status              ON sales(status);
CREATE INDEX IF NOT EXISTS idx_sales_order_number        ON sales(order_number);
CREATE INDEX IF NOT EXISTS idx_sales_sku_size            ON sales(sku, size);
CREATE INDEX IF NOT EXISTS idx_sales_inventory_match     ON sales(inventory_match_status);
CREATE INDEX IF NOT EXISTS idx_sales_sale_date           ON sales(sale_date);

-- BankTransfers: reconciliation queries
CREATE INDEX IF NOT EXISTS idx_bank_transfers_recon      ON bank_transfers(reconciliation_status);
CREATE INDEX IF NOT EXISTS idx_bank_transfers_date       ON bank_transfers(transfer_date);

-- Expenses: category + date range queries
CREATE INDEX IF NOT EXISTS idx_expenses_category         ON expenses(category);
CREATE INDEX IF NOT EXISTS idx_expenses_date             ON expenses(expense_date);

-- EmailProcessingLog: duplicate detection
CREATE INDEX IF NOT EXISTS idx_email_log_message_id      ON email_processing_log(gmail_message_id);
CREATE INDEX IF NOT EXISTS idx_email_log_status          ON email_processing_log(status);

-- ---------------------------------------------------------------------------
-- updated_at auto-update trigger (applies to inventory, sales, subscriptions)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_inventory_updated_at
    BEFORE UPDATE ON inventory
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE OR REPLACE TRIGGER trg_sales_updated_at
    BEFORE UPDATE ON sales
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE OR REPLACE TRIGGER trg_subscriptions_updated_at
    BEFORE UPDATE ON subscriptions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
