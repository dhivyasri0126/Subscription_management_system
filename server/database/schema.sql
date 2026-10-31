CREATE TABLE IF NOT EXISTS users (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(150) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'customer'
        CHECK (role IN ('admin', 'staff', 'customer')),
    status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'inactive')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

CREATE TABLE IF NOT EXISTS customers (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id BIGINT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    phone VARCHAR(30),
    address VARCHAR(300),
    business_type VARCHAR(80),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user
    ON password_reset_tokens(user_id, expires_at);

CREATE TABLE IF NOT EXISTS taxes (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    rate NUMERIC(5,2) NOT NULL CHECK (rate >= 0 AND rate <= 100),
    description TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'inactive')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS products (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    type VARCHAR(30) NOT NULL,
    sales_price NUMERIC(12,2) NOT NULL CHECK (sales_price >= 0),
    cost_price NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (cost_price >= 0),
    tax_id BIGINT REFERENCES taxes(id) ON DELETE SET NULL,
    notes TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'inactive')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);

CREATE TABLE IF NOT EXISTS product_variants (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    attribute VARCHAR(100) NOT NULL,
    value VARCHAR(150) NOT NULL,
    extra_price NUMERIC(12,2) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (product_id, attribute, value)
);

CREATE TABLE IF NOT EXISTS product_staff (
    product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    staff_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    assigned_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (product_id, staff_id)
);
CREATE INDEX IF NOT EXISTS idx_product_staff_staff ON product_staff(staff_id);

CREATE TABLE IF NOT EXISTS plans (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    price NUMERIC(12,2) NOT NULL CHECK (price >= 0),
    billing_period VARCHAR(20) NOT NULL
        CHECK (billing_period IN ('daily', 'weekly', 'monthly', 'yearly')),
    min_quantity INTEGER NOT NULL DEFAULT 1 CHECK (min_quantity > 0),
    available_from DATE NOT NULL DEFAULT CURRENT_DATE,
    available_to DATE,
    auto_close_on_end BOOLEAN NOT NULL DEFAULT FALSE,
    allow_early_close BOOLEAN NOT NULL DEFAULT FALSE,
    allow_pause BOOLEAN NOT NULL DEFAULT FALSE,
    allow_renew BOOLEAN NOT NULL DEFAULT TRUE,
    status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'inactive')),
    created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (available_to IS NULL OR available_from IS NULL OR available_to >= available_from)
);
ALTER TABLE plans ADD COLUMN IF NOT EXISTS created_by
    BIGINT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE plans ALTER COLUMN available_from SET DEFAULT CURRENT_DATE;
UPDATE plans SET available_from = CURRENT_DATE WHERE available_from IS NULL;
ALTER TABLE plans ALTER COLUMN available_from SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_plans_status ON plans(status);

CREATE TABLE IF NOT EXISTS plan_staff (
    plan_id BIGINT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
    staff_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    assigned_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (plan_id, staff_id)
);
CREATE INDEX IF NOT EXISTS idx_plan_staff_staff ON plan_staff(staff_id);

CREATE TABLE IF NOT EXISTS quotation_templates (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    plan_id BIGINT REFERENCES plans(id) ON DELETE SET NULL,
    validity_days INTEGER NOT NULL DEFAULT 30 CHECK (validity_days > 0),
    status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'inactive')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS quotation_template_lines (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    template_id BIGINT NOT NULL REFERENCES quotation_templates(id) ON DELETE CASCADE,
    product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (template_id, product_id)
);

CREATE SEQUENCE IF NOT EXISTS subscription_number_seq;
CREATE TABLE IF NOT EXISTS subscriptions (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    subscription_number VARCHAR(20) NOT NULL UNIQUE,
    customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    plan_id BIGINT NOT NULL REFERENCES plans(id) ON DELETE RESTRICT,
    assigned_staff_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    source VARCHAR(30) NOT NULL DEFAULT 'customer_request'
        CHECK (source IN ('customer_request', 'staff', 'admin')),
    status VARCHAR(20) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'quotation', 'confirmed', 'active', 'closed')),
    start_date DATE,
    expiry_date DATE,
    confirmed_at TIMESTAMPTZ,
    payment_term_days INTEGER NOT NULL DEFAULT 0 CHECK (payment_term_days >= 0),
    next_billing_date DATE,
    is_paused BOOLEAN NOT NULL DEFAULT FALSE,
    subtotal NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
    tax_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
    total_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (status NOT IN ('confirmed', 'active') OR (start_date IS NOT NULL AND expiry_date IS NOT NULL)),
    CHECK (expiry_date IS NULL OR start_date IS NULL OR expiry_date >= start_date)
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_subscriptions_customer ON subscriptions(customer_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_staff ON subscriptions(assigned_staff_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_billing
    ON subscriptions(status, is_paused, next_billing_date);

CREATE OR REPLACE FUNCTION set_subscription_number()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.subscription_number IS NULL OR NEW.subscription_number = '' THEN
        NEW.subscription_number := 'SUB-' || LPAD(nextval('subscription_number_seq')::TEXT, 6, '0');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_subscription_number ON subscriptions;
CREATE TRIGGER trg_subscription_number
    BEFORE INSERT ON subscriptions
    FOR EACH ROW EXECUTE FUNCTION set_subscription_number();

CREATE TABLE IF NOT EXISTS subscription_lines (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    subscription_id BIGINT NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
    product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    variant_id BIGINT REFERENCES product_variants(id) ON DELETE SET NULL,
    description VARCHAR(255) NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
    tax_rate NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (tax_rate >= 0 AND tax_rate <= 100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_subscription_lines_subscription
    ON subscription_lines(subscription_id);
CREATE INDEX IF NOT EXISTS idx_subscription_lines_product
    ON subscription_lines(product_id);

CREATE TABLE IF NOT EXISTS subscription_status_history (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    subscription_id BIGINT NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
    from_status VARCHAR(20),
    to_status VARCHAR(20) NOT NULL,
    changed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    note TEXT,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'subscription_status_history'
          AND column_name = 'old_status'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'subscription_status_history'
          AND column_name = 'from_status'
    ) THEN
        ALTER TABLE subscription_status_history RENAME COLUMN old_status TO from_status;
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'subscription_status_history'
          AND column_name = 'new_status'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'subscription_status_history'
          AND column_name = 'to_status'
    ) THEN
        ALTER TABLE subscription_status_history RENAME COLUMN new_status TO to_status;
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'subscription_status_history'
          AND column_name = 'created_at'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'subscription_status_history'
          AND column_name = 'changed_at'
    ) THEN
        ALTER TABLE subscription_status_history RENAME COLUMN created_at TO changed_at;
    END IF;
END;
$$;
CREATE INDEX IF NOT EXISTS idx_subscription_history_subscription
    ON subscription_status_history(subscription_id, changed_at DESC);

CREATE TABLE IF NOT EXISTS discounts (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code VARCHAR(80) NOT NULL UNIQUE,
    name VARCHAR(150) NOT NULL,
    discount_type VARCHAR(20) NOT NULL CHECK (discount_type IN ('fixed', 'percentage')),
    discount_value NUMERIC(12,2) NOT NULL CHECK (discount_value > 0),
    minimum_purchase NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (minimum_purchase >= 0),
    minimum_quantity INTEGER NOT NULL DEFAULT 0 CHECK (minimum_quantity >= 0),
    start_date DATE,
    end_date DATE,
    usage_limit INTEGER CHECK (usage_limit IS NULL OR usage_limit >= 0),
    times_used INTEGER NOT NULL DEFAULT 0 CHECK (times_used >= 0),
    applies_to VARCHAR(20) NOT NULL DEFAULT 'subscription'
        CHECK (applies_to IN ('products', 'subscription')),
    status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'inactive')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (discount_type <> 'percentage' OR discount_value <= 100),
    CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS idx_discounts_status_dates
    ON discounts(status, start_date, end_date);

CREATE TABLE IF NOT EXISTS discount_products (
    discount_id BIGINT NOT NULL REFERENCES discounts(id) ON DELETE CASCADE,
    product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    PRIMARY KEY (discount_id, product_id)
);

CREATE TABLE IF NOT EXISTS invoices (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    invoice_number VARCHAR(20) NOT NULL UNIQUE,
    subscription_id BIGINT NOT NULL REFERENCES subscriptions(id) ON DELETE RESTRICT,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    invoice_date DATE NOT NULL DEFAULT CURRENT_DATE,
    due_date DATE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'confirmed', 'partially_paid', 'paid', 'cancelled')),
    subtotal NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
    discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
    tax_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
    total_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
    amount_paid NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
    sent_at TIMESTAMPTZ,
    paid_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (period_end >= period_start),
    CHECK (amount_paid <= total_amount)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_one_per_period
    ON invoices(subscription_id, period_start, period_end)
    WHERE status <> 'cancelled';
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_due_date ON invoices(due_date);
CREATE INDEX IF NOT EXISTS idx_invoices_subscription ON invoices(subscription_id);

CREATE SEQUENCE IF NOT EXISTS invoice_number_seq;
CREATE OR REPLACE FUNCTION set_invoice_number()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.invoice_number IS NULL OR NEW.invoice_number = '' THEN
        NEW.invoice_number := 'INV-' || LPAD(nextval('invoice_number_seq')::TEXT, 6, '0');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_invoice_number ON invoices;
CREATE TRIGGER trg_invoice_number
    BEFORE INSERT ON invoices
    FOR EACH ROW EXECUTE FUNCTION set_invoice_number();

CREATE TABLE IF NOT EXISTS invoice_lines (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    invoice_id BIGINT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    product_id BIGINT REFERENCES products(id) ON DELETE SET NULL,
    description VARCHAR(255) NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
    tax_rate NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (tax_rate >= 0 AND tax_rate <= 100),
    discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
    line_total NUMERIC(12,2) NOT NULL CHECK (line_total >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_invoice_lines_invoice ON invoice_lines(invoice_id);

CREATE TABLE IF NOT EXISTS payments (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    invoice_id BIGINT NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
    method VARCHAR(30) NOT NULL,
    amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    payment_date TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reference VARCHAR(150),
    note TEXT,
    created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_payments_date ON payments(payment_date);

CREATE SEQUENCE IF NOT EXISTS receipt_number_seq;
CREATE TABLE IF NOT EXISTS receipts (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    receipt_number VARCHAR(20) NOT NULL UNIQUE,
    payment_id BIGINT NOT NULL UNIQUE REFERENCES payments(id) ON DELETE RESTRICT,
    issued_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE OR REPLACE FUNCTION set_receipt_number()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.receipt_number IS NULL OR NEW.receipt_number = '' THEN
        NEW.receipt_number := 'RCP-' || LPAD(nextval('receipt_number_seq')::TEXT, 6, '0');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_receipt_number ON receipts;
CREATE TRIGGER trg_receipt_number
    BEFORE INSERT ON receipts
    FOR EACH ROW EXECUTE FUNCTION set_receipt_number();

CREATE TABLE IF NOT EXISTS discount_usages (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    discount_id BIGINT NOT NULL REFERENCES discounts(id) ON DELETE RESTRICT,
    invoice_id BIGINT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
    used_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (discount_id, invoice_id)
);
CREATE INDEX IF NOT EXISTS idx_discount_usages_discount
    ON discount_usages(discount_id);

CREATE OR REPLACE VIEW v_overdue_invoices AS
SELECT i.id, i.invoice_number, i.subscription_id, i.due_date,
       i.total_amount, i.amount_paid, i.total_amount - i.amount_paid AS balance_due
FROM invoices i
WHERE i.due_date < CURRENT_DATE
  AND i.status IN ('confirmed', 'partially_paid');

CREATE OR REPLACE VIEW v_monthly_revenue AS
SELECT date_trunc('month', p.payment_date)::DATE AS month,
       SUM(p.amount)::NUMERIC(12,2) AS revenue
FROM payments p
GROUP BY date_trunc('month', p.payment_date)::DATE;
