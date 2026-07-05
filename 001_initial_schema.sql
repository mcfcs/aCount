-- ============================================================================
-- aCount - Sneaker Resale Accounting & Financial Management
-- PostgreSQL Database Schema v1.0
-- Based on Technical Specification Document, Section 5
-- ============================================================================

-- ============================================================================
-- ENUM TYPES
-- ============================================================================

CREATE TYPE inventory_status AS ENUM ('Available', 'Sold', 'Consigned');

CREATE TYPE sale_status AS ENUM (
    'Pending',
    'Confirmed',
    'Shipped',
    'Completed',
    'Cancelled',
    'Attention Needed',
    'Consigned',
    'Returned'
);

CREATE TYPE item_condition AS ENUM ('New', 'Used');

CREATE TYPE box_condition AS ENUM ('Good Condition', 'No Box', 'Badly Damaged');

CREATE TYPE cancellation_type AS ENUM ('Unconfirmed', 'Confirmed', 'Attention Needed');

CREATE TYPE inventory_match_status AS ENUM ('Matched', 'Unmatched');

CREATE TYPE reconciliation_status AS ENUM ('Reconciled', 'Partially Reconciled', 'Unreconciled');

CREATE TYPE expense_category AS ENUM (
    'Platform Fee',
    'Subscription',
    'Personal Order',
    'Sneaker Purchase',
    'Other'
);

CREATE TYPE billing_cycle AS ENUM ('Monthly', 'Quarterly', 'Annual');

CREATE TYPE subscription_status AS ENUM ('Active', 'Paused', 'Cancelled');

CREATE TYPE email_type AS ENUM (
    'Sale',
    'Confirmation',
    'Shipped',
    'Completed',
    'Cancelled',
    'Attention',
    'BankTransfer',
    'Purchase',
    'Subscription',
    'Receipt',
    'Other'
);

CREATE TYPE processing_status AS ENUM ('Success', 'Failed', 'Skipped');


-- ============================================================================
-- TABLE: Inventory (Section 5.1)
-- ============================================================================

CREATE TABLE inventory (
    inventory_id    SERIAL PRIMARY KEY,
    sku             VARCHAR(100) NOT NULL,
    shoe_name       VARCHAR(500) NOT NULL,
    size            DOUBLE PRECISION NOT NULL,
    date_purchased  TIMESTAMP NOT NULL,
    purchase_cost   DECIMAL(10, 2) NOT NULL,          -- PHP
    listed_price    DECIMAL(10, 2),                    -- USD on Alias
    status          inventory_status NOT NULL DEFAULT 'Available',
    linked_sale_id  INTEGER,                           -- FK added after sales table
    source          VARCHAR(255),
    notes           TEXT,
    created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_inventory_sku_size ON inventory (sku, size);
CREATE INDEX idx_inventory_status ON inventory (status);
CREATE INDEX idx_inventory_date_purchased ON inventory (date_purchased);


-- ============================================================================
-- TABLE: Sales (Section 5.2)
-- ============================================================================

CREATE TABLE sales (
    sale_id                 SERIAL PRIMARY KEY,
    order_number            BIGINT NOT NULL,
    parent_order_number     BIGINT,
    platform                VARCHAR(100) NOT NULL DEFAULT 'Alias',
    sku                     VARCHAR(100) NOT NULL,
    shoe_name               VARCHAR(500) NOT NULL,
    size                    DOUBLE PRECISION NOT NULL,
    condition               item_condition,
    box_condition           box_condition,
    selling_price           DECIMAL(10, 2),                -- USD
    amount_made             DECIMAL(10, 2),                -- USD (after Alias fees)
    sale_date               TIMESTAMP NOT NULL,
    status                  sale_status NOT NULL DEFAULT 'Pending',
    issue_type              VARCHAR(255),
    discount_offered        DECIMAL(10, 2),                -- USD
    confirmation_datetime   TIMESTAMP,
    shipment_deadline       TIMESTAMP,
    pickup_address          TEXT,
    pickup_window           VARCHAR(255),
    shipment_date           TIMESTAMP,
    completion_date         DATE,
    cancellation_date       DATE,
    cancellation_type       cancellation_type,
    cancellation_fee        DECIMAL(10, 2),                -- USD
    tracking_number         VARCHAR(255),
    shipping_label_url      TEXT,                          -- S3 URL to prepaid label PDF (Confirmation email)
    inventory_match_status  inventory_match_status NOT NULL DEFAULT 'Unmatched',
    notes                   TEXT,
    created_at              TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sales_order_number ON sales (order_number);
CREATE INDEX idx_sales_status ON sales (status);
CREATE INDEX idx_sales_sku_size ON sales (sku, size);
CREATE INDEX idx_sales_sale_date ON sales (sale_date);


-- ============================================================================
-- TABLE: BankTransfers (Section 5.3)
-- ============================================================================

CREATE TABLE bank_transfers (
    transfer_id             SERIAL PRIMARY KEY,
    amount_php              DECIMAL(12, 2) NOT NULL,
    bank_name               VARCHAR(255) NOT NULL,
    account_last4           VARCHAR(4) NOT NULL,
    transfer_date           TIMESTAMP NOT NULL,
    reconciliation_status   reconciliation_status NOT NULL DEFAULT 'Unreconciled',
    notes                   TEXT,
    created_at              TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_bank_transfers_date ON bank_transfers (transfer_date);
CREATE INDEX idx_bank_transfers_recon ON bank_transfers (reconciliation_status);


-- ============================================================================
-- TABLE: BankTransferAllocations (Section 5.4) - Junction Table
-- ============================================================================

CREATE TABLE bank_transfer_allocations (
    allocation_id       SERIAL PRIMARY KEY,
    transfer_id         INTEGER NOT NULL REFERENCES bank_transfers (transfer_id) ON DELETE CASCADE,
    sale_id             INTEGER NOT NULL REFERENCES sales (sale_id) ON DELETE CASCADE,
    allocated_amount    DECIMAL(12, 2) NOT NULL          -- PHP
);

CREATE INDEX idx_bta_transfer ON bank_transfer_allocations (transfer_id);
CREATE INDEX idx_bta_sale ON bank_transfer_allocations (sale_id);


-- ============================================================================
-- TABLE: Expenses (Section 5.5)
-- ============================================================================

CREATE TABLE expenses (
    expense_id          SERIAL PRIMARY KEY,
    category            expense_category NOT NULL,
    description         VARCHAR(500) NOT NULL,
    amount_original     DECIMAL(10, 2) NOT NULL,
    original_currency   VARCHAR(3) NOT NULL DEFAULT 'PHP',
    amount_php          DECIMAL(10, 2) NOT NULL,
    conversion_rate     DECIMAL(10, 4),
    expense_date        DATE NOT NULL,
    source              VARCHAR(255),                    -- Email source or 'Manual'
    linked_sale_id      INTEGER REFERENCES sales (sale_id) ON DELETE SET NULL,
    notes               TEXT,
    created_at          TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_expenses_category ON expenses (category);
CREATE INDEX idx_expenses_date ON expenses (expense_date);
CREATE INDEX idx_expenses_linked_sale ON expenses (linked_sale_id);


-- ============================================================================
-- TABLE: Subscriptions (Section 5.6)
-- ============================================================================

CREATE TABLE subscriptions (
    subscription_id     SERIAL PRIMARY KEY,
    name                VARCHAR(255) NOT NULL,
    amount_original     DECIMAL(10, 2) NOT NULL,
    original_currency   VARCHAR(3) NOT NULL DEFAULT 'PHP',
    amount_php          DECIMAL(10, 2) NOT NULL,
    billing_cycle       billing_cycle NOT NULL DEFAULT 'Monthly',
    next_billing_date   DATE,
    status              subscription_status NOT NULL DEFAULT 'Active',
    payment_method      VARCHAR(255),
    notes               TEXT,
    created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_subscriptions_status ON subscriptions (status);
CREATE INDEX idx_subscriptions_next_billing ON subscriptions (next_billing_date);


-- ============================================================================
-- TABLE: EmailProcessingLog (Section 5.7)
-- ============================================================================

CREATE TABLE email_processing_log (
    log_id              SERIAL PRIMARY KEY,
    gmail_message_id    VARCHAR(255) NOT NULL UNIQUE,
    email_type          email_type NOT NULL,
    processed_at        TIMESTAMP NOT NULL DEFAULT NOW(),
    parsed_data         JSONB,
    status              processing_status NOT NULL DEFAULT 'Success',
    error_message       TEXT,
    linked_record_type  VARCHAR(100),
    linked_record_id    INTEGER
);

CREATE INDEX idx_epl_gmail_id ON email_processing_log (gmail_message_id);
CREATE INDEX idx_epl_type ON email_processing_log (email_type);
CREATE INDEX idx_epl_status ON email_processing_log (status);


-- ============================================================================
-- FOREIGN KEY: Inventory → Sales (deferred to avoid circular dependency)
-- ============================================================================

ALTER TABLE inventory
    ADD CONSTRAINT fk_inventory_linked_sale
    FOREIGN KEY (linked_sale_id) REFERENCES sales (sale_id) ON DELETE SET NULL;

CREATE INDEX idx_inventory_linked_sale ON inventory (linked_sale_id);


-- ============================================================================
-- TRIGGER: Auto-update updated_at columns
-- ============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_inventory_updated_at
    BEFORE UPDATE ON inventory
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_sales_updated_at
    BEFORE UPDATE ON sales
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_subscriptions_updated_at
    BEFORE UPDATE ON subscriptions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
