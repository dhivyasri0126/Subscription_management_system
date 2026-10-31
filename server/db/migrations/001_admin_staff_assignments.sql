DO $$
BEGIN
    IF to_regclass(format('%I.%I', current_schema(), 'users')) IS NULL THEN
        RAISE EXCEPTION 'Cannot add admin staff assignments: users table is missing';
    END IF;
    IF to_regclass(format('%I.%I', current_schema(), 'products')) IS NULL THEN
        RAISE EXCEPTION 'Cannot add product staff assignments: products table is missing';
    END IF;
    IF to_regclass(format('%I.%I', current_schema(), 'plans')) IS NULL THEN
        RAISE EXCEPTION 'Cannot add plan staff assignments: plans table is missing';
    END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS product_staff (
    product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    staff_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    assigned_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (product_id, staff_id)
);

CREATE INDEX IF NOT EXISTS idx_product_staff_staff
    ON product_staff(staff_id);

CREATE TABLE IF NOT EXISTS plan_staff (
    plan_id BIGINT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
    staff_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    assigned_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (plan_id, staff_id)
);

CREATE INDEX IF NOT EXISTS idx_plan_staff_staff
    ON plan_staff(staff_id);
