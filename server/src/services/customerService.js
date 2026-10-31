import { pool } from "../utils/pool.js";
import { HttpError } from "../utils/httpError.js";

const QUOTE_VALID_DAYS = 30;
const MAX_LINES = 50;
const MAX_QTY = 10000;
const SUB_STATUSES = ["draft", "quotation", "confirmed", "active", "closed"];

/* ---------- helpers ---------- */

// Money is calculated in paise (integers) so 0.1 + 0.2 style errors never happen.
const toCents = (v) => Math.round(Number(v) * 100);
const fromCents = (c) => (c / 100).toFixed(2);
const isId = (v) => /^\d{1,18}$/.test(String(v));

export function parseId(value, what = "record") {
  if (!isId(value)) throw new HttpError(400, `Invalid ${what} id.`);
  return String(value);
}

export function parsePaging(query) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(query.limit, 10) || 10));
  return { page, limit, offset: (page - 1) * limit };
}

function pageResult(rows, page, limit) {
  const total = rows.length ? Number(rows[0].total_count) : 0;
  return {
    items: rows.map(({ total_count, ...r }) => r),
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
  };
}

/* ---------- dashboard summary ---------- */

export async function getSummary(customerId) {
  const { rows } = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM subscriptions WHERE customer_id = $1 AND status = 'active')::int    AS active_subscriptions,
       (SELECT COUNT(*) FROM subscriptions WHERE customer_id = $1 AND status = 'quotation')::int AS pending_quotations,
       (SELECT COALESCE(SUM(total_amount - amount_paid), 0) FROM invoices
          WHERE customer_id = $1 AND status = 'confirmed')                                       AS outstanding_balance,
       (SELECT COUNT(*) FROM invoices
          WHERE customer_id = $1 AND status = 'confirmed'
            AND due_date < CURRENT_DATE AND amount_paid < total_amount)::int                     AS overdue_invoices,
       (SELECT MIN(next_billing_date) FROM subscriptions
          WHERE customer_id = $1 AND status = 'active' AND is_paused = FALSE)                    AS next_billing_date`,
    [customerId]
  );
  return rows[0];
}

/* ---------- profile ---------- */

export async function getProfile(customerId) {
  const { rows } = await pool.query(
    `SELECT c.id AS customer_id, u.id AS user_id, c.name, u.email, c.phone, c.address, c.business_type
       FROM customers c JOIN users u ON u.id = c.user_id
      WHERE c.id = $1`,
    [customerId]
  );
  if (!rows[0]) throw new HttpError(404, "Profile not found.");
  return rows[0];
}

export async function updateProfile(customerId, userId, body = {}) {
  const fields = {};
  const name = String(body.name ?? "").trim();
  const phone = String(body.phone ?? "").trim();
  const address = String(body.address ?? "").trim();
  const businessType = String(body.businessType ?? "").trim();

  if (name.length < 2 || name.length > 100) fields.name = "Enter your name (2-100 characters).";
  const digits = phone.replace(/^\+91/, "").replace(/[\s-]/g, "");
  if (!/^[6-9]\d{9}$/.test(digits)) fields.phone = "Enter a valid 10-digit mobile number.";
  if (!businessType || businessType.length > 50) fields.businessType = "Select your business type.";
  if (address.length > 500) fields.address = "Address is too long (max 500 characters).";
  if (Object.keys(fields).length) throw new HttpError(400, "Please fix the highlighted fields.", fields);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE customers SET name = $1, phone = $2, address = $3, business_type = $4 WHERE id = $5`,
      [name, phone, address || null, businessType, customerId]
    );
    await client.query("UPDATE users SET name = $1 WHERE id = $2", [name, userId]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  return getProfile(customerId);
}

/* ---------- catalogue (read-only for customers) ---------- */

export async function listPlans() {
  const { rows } = await pool.query(
    `SELECT id, name, price, billing_period, min_quantity, available_from, available_to,
            allow_early_close, allow_pause, allow_renew
       FROM plans
      WHERE status = 'active'
        AND available_from <= CURRENT_DATE
        AND (available_to IS NULL OR available_to >= CURRENT_DATE)
      ORDER BY price, name`
  );
  return rows;
}

// cost_price is deliberately NOT selected: customers must never see it.
export async function listProducts() {
  const { rows } = await pool.query(
    `SELECT p.id, p.name, p.product_type, p.sales_price, p.notes,
            COALESCE(t.rate_percent, 0) AS tax_rate_percent,
            COALESCE(
              json_agg(json_build_object(
                'id', v.id, 'attribute', v.attribute, 'value', v.value, 'extra_price', v.extra_price
              ) ORDER BY v.attribute, v.value) FILTER (WHERE v.id IS NOT NULL),
              '[]'
            ) AS variants
       FROM products p
       LEFT JOIN taxes t ON t.id = p.tax_id AND t.is_active
       LEFT JOIN product_variants v ON v.product_id = p.id
      WHERE p.status = 'active'
      GROUP BY p.id, t.rate_percent
      ORDER BY p.name`
  );
  return rows;
}

/* ---------- quotation request ---------- */

function normalizeLines(rawLines, fields) {
  if (!Array.isArray(rawLines) || rawLines.length === 0) {
    fields.lines = "Add at least one product.";
    return [];
  }
  if (rawLines.length > MAX_LINES) {
    fields.lines = `You can request at most ${MAX_LINES} lines.`;
    return [];
  }

  const merged = new Map(); // same product + variant -> quantities added together
  for (const l of rawLines) {
    const qty = Number(l?.quantity);
    const hasVariant = l?.variantId !== undefined && l?.variantId !== null && l?.variantId !== "";
    if (
      !isId(l?.productId) ||
      (hasVariant && !isId(l.variantId)) ||
      !Number.isInteger(qty) || qty < 1 || qty > MAX_QTY
    ) {
      fields.lines = "Each line needs a valid product and a quantity of at least 1.";
      return [];
    }
    const productId = String(l.productId);
    const variantId = hasVariant ? String(l.variantId) : null;
    const key = `${productId}:${variantId ?? ""}`;
    const existing = merged.get(key);
    if (existing) existing.quantity += qty;
    else merged.set(key, { productId, variantId, quantity: qty });
  }
  return [...merged.values()];
}

export async function createQuotation(customerId, userId, body = {}) {
  const fields = {};
  if (!isId(body.planId)) fields.planId = "Select a plan.";
  const lines = normalizeLines(body.lines, fields);
  const notes = String(body.notes ?? "").trim();
  if (notes.length > 500) fields.notes = "Notes are too long (max 500 characters).";
  if (Object.keys(fields).length) throw new HttpError(400, "Please fix the highlighted fields.", fields);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1. The plan must be open for new subscriptions today.
    const planRes = await client.query(
      `SELECT id, min_quantity FROM plans
        WHERE id = $1 AND status = 'active'
          AND available_from <= CURRENT_DATE
          AND (available_to IS NULL OR available_to >= CURRENT_DATE)`,
      [body.planId]
    );
    const plan = planRes.rows[0];
    if (!plan) throw new HttpError(400, "This plan is not available.", { planId: "This plan is not available." });

    // 2. Products and variants, read fresh from the database (never trust prices from the browser).
    const productIds = [...new Set(lines.map((l) => l.productId))];
    const variantIds = lines.filter((l) => l.variantId).map((l) => l.variantId);

    const prodRes = await client.query(
      `SELECT p.id, p.sales_price, COALESCE(t.rate_percent, 0) AS rate
         FROM products p
         LEFT JOIN taxes t ON t.id = p.tax_id AND t.is_active
        WHERE p.id = ANY($1::bigint[]) AND p.status = 'active'`,
      [productIds]
    );
    const products = new Map(prodRes.rows.map((r) => [String(r.id), r]));

    const varRes = variantIds.length
      ? await client.query(
          "SELECT id, product_id, extra_price FROM product_variants WHERE id = ANY($1::bigint[])",
          [variantIds]
        )
      : { rows: [] };
    const variants = new Map(varRes.rows.map((r) => [String(r.id), r]));

    // 3. Price every line and total them.
    let untaxed = 0;
    let tax = 0;
    const priced = lines.map((l) => {
      const product = products.get(l.productId);
      if (!product) {
        throw new HttpError(400, "One or more products are no longer available.", {
          lines: "One or more products are no longer available.",
        });
      }
      let unit = toCents(product.sales_price);
      if (l.variantId) {
        const v = variants.get(l.variantId);
        if (!v || String(v.product_id) !== l.productId) {
          throw new HttpError(400, "Invalid product option selected.", { lines: "Invalid product option selected." });
        }
        unit += toCents(v.extra_price);
      }
      if (l.quantity < plan.min_quantity) {
        throw new HttpError(400, `This plan needs a minimum quantity of ${plan.min_quantity} per product.`, {
          lines: `Minimum quantity for this plan is ${plan.min_quantity}.`,
        });
      }
      const rate = Number(product.rate);
      const amount = unit * l.quantity;
      untaxed += amount;
      tax += Math.round((amount * rate) / 100);
      return { ...l, unit, rate, amount };
    });

    // 4. Create the subscription in "quotation" status.
    const subRes = await client.query(
      `INSERT INTO subscriptions
         (customer_id, plan_id, created_by, source, status, quotation_valid_until,
          untaxed_amount, tax_amount, total_amount, notes)
       VALUES ($1, $2, $3, 'customer_request', 'quotation', CURRENT_DATE + $4::int, $5, $6, $7, $8)
       RETURNING id`,
      [customerId, plan.id, userId, QUOTE_VALID_DAYS, fromCents(untaxed), fromCents(tax), fromCents(untaxed + tax), notes || null]
    );
    const subscriptionId = subRes.rows[0].id;

    for (const l of priced) {
      await client.query(
        `INSERT INTO subscription_lines
           (subscription_id, product_id, variant_id, quantity, unit_price, tax_rate_percent, amount)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [subscriptionId, l.productId, l.variantId, l.quantity, fromCents(l.unit), l.rate, fromCents(l.amount)]
      );
    }

    await client.query(
      `INSERT INTO subscription_status_history (subscription_id, from_status, to_status, changed_by, note)
       VALUES ($1, NULL, 'quotation', $2, 'Quotation requested by customer')`,
      [subscriptionId, userId]
    );

    await client.query("COMMIT");
    return getSubscription(customerId, subscriptionId);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/* ---------- subscriptions ---------- */

export async function listSubscriptions(customerId, query) {
  const { page, limit, offset } = parsePaging(query);
  const params = [customerId];
  let statusSql = "";
  if (query.status) {
    if (!SUB_STATUSES.includes(query.status)) throw new HttpError(400, "Invalid status filter.");
    params.push(query.status);
    statusSql = `AND s.status = $${params.length}`;
  }
  params.push(limit, offset);

  const { rows } = await pool.query(
    `SELECT s.id, s.subscription_number, s.status, s.start_date, s.expiry_date, s.next_billing_date,
            s.quotation_valid_until, s.total_amount, s.created_at,
            p.name AS plan_name, p.billing_period,
            COUNT(*) OVER() AS total_count
       FROM subscriptions s
       JOIN plans p ON p.id = s.plan_id
      WHERE s.customer_id = $1 ${statusSql}
      ORDER BY s.created_at DESC, s.id DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return pageResult(rows, page, limit);
}

export async function getSubscription(customerId, id) {
  const subRes = await pool.query(
    `SELECT s.id, s.subscription_number, s.status, s.source, s.start_date, s.expiry_date,
            s.quotation_valid_until, s.payment_terms, s.payment_term_days, s.is_paused,
            s.next_billing_date, s.untaxed_amount, s.tax_amount, s.total_amount, s.notes,
            s.confirmed_at, s.activated_at, s.closed_at, s.created_at,
            p.name AS plan_name, p.billing_period, p.price AS plan_price,
            st.name AS staff_name
       FROM subscriptions s
       JOIN plans p ON p.id = s.plan_id
       LEFT JOIN users st ON st.id = s.assigned_staff_id
      WHERE s.id = $1 AND s.customer_id = $2`,
    [id, customerId]
  );
  const subscription = subRes.rows[0];
  if (!subscription) throw new HttpError(404, "Subscription not found.");

  const [lines, history] = await Promise.all([
    pool.query(
      `SELECT l.id, l.product_id, pr.name AS product_name, l.variant_id, v.attribute, v.value AS variant_value,
              l.quantity, l.unit_price, l.tax_rate_percent, l.amount
         FROM subscription_lines l
         JOIN products pr ON pr.id = l.product_id
         LEFT JOIN product_variants v ON v.id = l.variant_id
        WHERE l.subscription_id = $1
        ORDER BY l.id`,
      [id]
    ),
    pool.query(
      `SELECT from_status, to_status, note, changed_at
         FROM subscription_status_history
        WHERE subscription_id = $1
        ORDER BY changed_at, id`,
      [id]
    ),
  ]);

  return { ...subscription, lines: lines.rows, history: history.rows };
}

/* ---------- invoices (customers only see confirmed and paid ones) ---------- */

export async function listInvoices(customerId, query) {
  const { page, limit, offset } = parsePaging(query);
  const params = [customerId];
  let statusSql = "";
  if (query.status) {
    if (!["confirmed", "paid"].includes(query.status)) throw new HttpError(400, "Invalid status filter.");
    params.push(query.status);
    statusSql = `AND i.status = $${params.length}`;
  }
  params.push(limit, offset);

  const { rows } = await pool.query(
    `SELECT i.id, i.invoice_number, i.status, i.invoice_date, i.due_date, i.period_start, i.period_end,
            i.total_amount, i.amount_paid, (i.total_amount - i.amount_paid) AS balance_due,
            (i.status = 'confirmed' AND i.due_date < CURRENT_DATE AND i.amount_paid < i.total_amount) AS is_overdue,
            s.subscription_number,
            COUNT(*) OVER() AS total_count
       FROM invoices i
       JOIN subscriptions s ON s.id = i.subscription_id
      WHERE i.customer_id = $1 AND i.status IN ('confirmed', 'paid') ${statusSql}
      ORDER BY i.invoice_date DESC, i.id DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return pageResult(rows, page, limit);
}

export async function getInvoice(customerId, id) {
  const invRes = await pool.query(
    `SELECT i.id, i.invoice_number, i.status, i.invoice_date, i.due_date, i.period_start, i.period_end,
            i.untaxed_amount, i.discount_amount, i.tax_amount, i.total_amount, i.amount_paid,
            (i.total_amount - i.amount_paid) AS balance_due, i.notes, i.paid_at,
            s.subscription_number,
            c.name AS customer_name, u.email AS customer_email, c.phone AS customer_phone,
            c.address AS customer_address, c.business_type
       FROM invoices i
       JOIN subscriptions s ON s.id = i.subscription_id
       JOIN customers c ON c.id = i.customer_id
       JOIN users u ON u.id = c.user_id
      WHERE i.id = $1 AND i.customer_id = $2 AND i.status IN ('confirmed', 'paid')`,
    [id, customerId]
  );
  const invoice = invRes.rows[0];
  if (!invoice) throw new HttpError(404, "Invoice not found.");

  const [lines, payments] = await Promise.all([
    pool.query(
      `SELECT id, description, quantity, unit_price, discount_amount, tax_rate_percent, tax_amount, line_total
         FROM invoice_lines WHERE invoice_id = $1 ORDER BY id`,
      [id]
    ),
    pool.query(
      `SELECT p.id, p.method, p.amount, p.payment_date, p.reference,
              r.id AS receipt_id, r.receipt_number
         FROM payments p
         LEFT JOIN receipts r ON r.payment_id = p.id
        WHERE p.invoice_id = $1
        ORDER BY p.payment_date, p.id`,
      [id]
    ),
  ]);

  return { ...invoice, lines: lines.rows, payments: payments.rows };
}

/* ---------- receipts ---------- */

export async function listReceipts(customerId, query) {
  const { page, limit, offset } = parsePaging(query);
  const { rows } = await pool.query(
    `SELECT r.id, r.receipt_number, r.issued_at, p.amount, p.method, p.payment_date,
            i.id AS invoice_id, i.invoice_number,
            COUNT(*) OVER() AS total_count
       FROM receipts r
       JOIN payments p ON p.id = r.payment_id
       JOIN invoices i ON i.id = p.invoice_id
      WHERE i.customer_id = $1
      ORDER BY r.issued_at DESC, r.id DESC
      LIMIT $2 OFFSET $3`,
    [customerId, limit, offset]
  );
  return pageResult(rows, page, limit);
}

export async function getReceipt(customerId, id) {
  const { rows } = await pool.query(
    `SELECT r.id, r.receipt_number, r.issued_at,
            p.amount, p.method, p.payment_date, p.reference, p.note,
            i.id AS invoice_id, i.invoice_number, i.total_amount AS invoice_total, i.amount_paid AS invoice_paid,
            s.subscription_number,
            c.name AS customer_name, u.email AS customer_email, c.phone AS customer_phone,
            c.address AS customer_address
       FROM receipts r
       JOIN payments p ON p.id = r.payment_id
       JOIN invoices i ON i.id = p.invoice_id
       JOIN subscriptions s ON s.id = i.subscription_id
       JOIN customers c ON c.id = i.customer_id
       JOIN users u ON u.id = c.user_id
      WHERE r.id = $1 AND i.customer_id = $2`,
    [id, customerId]
  );
  if (!rows[0]) throw new HttpError(404, "Receipt not found.");
  return rows[0];
}