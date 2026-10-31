import { Router } from "express";
import bcrypt from "bcryptjs";
import pg from "pg";
import { pool } from "../db.js";
import { requireAuth, requireRole } from "../middleware/requireAuth.js";
import { buildInvoicePdf } from "../services/invoicePdf.js";
import {
  getColumn,
  getStatusExpression,
  getTableColumns,
  insertMappedRow,
  quoteColumn,
  updateMappedRow,
} from "../services/adminSchema.js";

// FIX: return DATE columns as plain "YYYY-MM-DD" strings. Without this, node-pg
// turns them into JS Dates, and JSON serialisation shifts them by one day in
// non-UTC timezones (e.g. IST) and breaks <input type="date"> on edit.
pg.types.setTypeParser(1082, (value) => value);

const router = Router();
router.use(requireAuth, requireRole("admin"));

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

// FIX: the schema constrains these status values, but the UI used active/inactive
// for everything, so saving "inactive" violated the CHECK constraints.
//   products.status : active | archived
//   plans.status    : active | paused | closed
//   taxes           : active | inactive (is_active boolean)
const STATUS_RULES = {
  products: { allowed: ["active", "archived"], legacy: { inactive: "archived" } },
  plans: { allowed: ["active", "paused", "closed"], legacy: { inactive: "paused" } },
  taxes: { allowed: ["active", "inactive"], legacy: {} },
};
const PRODUCT_TYPES = ["service", "goods", "addon"];

function normalizeStatus(resource, raw) {
  const rule = STATUS_RULES[resource];
  const value = rule.legacy[raw] ?? raw;
  return rule.allowed.includes(value) ? value : null;
}
// Convert a UI status into whatever the real column stores.
function columnStatus(column, status) {
  return column === "is_active" ? status === "active" : status;
}

// FIX: surface real database problems instead of a blank 500, so a failed save
// always tells you why it was rejected.
function sendDbError(error, res, next) {
  const known = {
    23505: [409, "A record with the same unique value already exists."],
    23503: [409, "This record is linked to, or references, another record."],
    23502: [400, `A required field is missing (${error.column || "unknown column"}).`],
    23514: [400, `A value was rejected by a database rule (${error.constraint}).`],
    "22P02": [400, "A value has the wrong format."],
    22007: [400, "A date has the wrong format."],
    "42703": [500, `Database column mismatch: ${error.message}`],
    "42P01": [500, `Database table missing: ${error.message}`],
  };
  const hit = known[error.code];
  if (hit) {
    console.error("Admin API database error:", error.code, error.message);
    return res.status(hit[0]).json({ error: hit[1] });
  }
  return next(error);
}

async function safeRollback(client, label) {
  try {
    await client.query("ROLLBACK");
  } catch (rollbackError) {
    console.error(`${label} rollback failed:`, rollbackError);
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const strongPassword = (p) =>
  typeof p === "string" &&
  p.length >= 9 &&
  /[a-z]/.test(p) &&
  /[A-Z]/.test(p) &&
  /[^A-Za-z0-9]/.test(p);
const PASSWORD_MESSAGE =
  "Provide a name, valid email, and a password with more than 8 characters, uppercase, lowercase, and a special character.";

/* -------------------------------------------------------------------------- */
/* Resource config                                                            */
/* -------------------------------------------------------------------------- */

const subscriptionColumns = `id, subscription_number, customer_id, plan_id, assigned_staff_id,
      status, start_date, expiry_date, payment_term_days, created_at,
      (SELECT c.name FROM customers c WHERE c.id = subscriptions.customer_id) AS customer_name,
      (SELECT p.name FROM plans p WHERE p.id = subscriptions.plan_id) AS plan_name`;

const resources = {
  customers: {
    table: "customers",
    columns: `id, name, phone, address, business_type, created_at,
      (SELECT u.email FROM users u WHERE u.id = customers.user_id) AS email`,
    searchColumns: ["name", "phone", "business_type"],
  },
  staff: {
    table: "users",
    columns: "id, name, email, role, status, created_at",
    searchColumns: ["name", "email"],
    extraWhere: "role = 'staff'",
  },
  products: { table: "products", searchColumns: ["name", "product_type", "type"] },
  taxes: { table: "taxes", searchColumns: ["name"] },
  plans: { table: "plans", searchColumns: ["name", "billing_period"] },
  quotations: {
    table: "subscriptions",
    columns: subscriptionColumns,
    searchColumns: ["subscription_number", "status"],
    extraWhere: "status = 'quotation'",
  },
  subscriptions: {
    table: "subscriptions",
    columns: `${subscriptionColumns}, next_billing_date, untaxed_amount, tax_amount, total_amount`,
    searchColumns: ["subscription_number", "status"],
  },
  invoices: {
    table: "invoices",
    columns: `id, invoice_number, subscription_id, invoice_date, due_date, total_amount,
      amount_paid, status,
      (SELECT c.name FROM subscriptions s JOIN customers c ON c.id = s.customer_id
       WHERE s.id = invoices.subscription_id) AS customer_name,
      (SELECT r.receipt_number FROM receipts r
       JOIN payments p ON p.id = r.payment_id
       WHERE p.invoice_id = invoices.id ORDER BY r.id DESC LIMIT 1) AS receipt_number`,
    searchColumns: ["invoice_number", "status", "subscription_id"],
  },
  payments: {
    table: "payments",
    columns: `id, invoice_id, amount, method, payment_date, reference,
      (SELECT r.receipt_number FROM receipts r WHERE r.payment_id = payments.id) AS receipt_number`,
    searchColumns: ["method", "reference", "invoice_id"],
  },
  discounts: {
    table: "discounts",
    columns: `id, name, discount_type AS type, value, applies_to, min_purchase_amount,
      min_quantity, start_date, end_date, usage_limit, times_used, status`,
    searchColumns: ["name", "discount_type"],
  },
};

const mappedResourceFields = {
  products: [
    ["id", ["id"], "bigint"],
    ["name", ["name"], "text"],
    ["type", ["product_type", "type"], "text"],
    ["sales_price", ["sales_price", "price"], "numeric"],
    ["cost_price", ["cost_price"], "numeric"],
    ["tax_id", ["tax_id"], "bigint"],
    ["notes", ["notes", "description"], "text"],
    ["created_at", ["created_at", "created_on"], "timestamptz"],
  ],
  taxes: [
    ["id", ["id"], "bigint"],
    ["name", ["name"], "text"],
    ["rate", ["rate_percent", "rate"], "numeric"],
    ["description", ["description", "notes"], "text"],
    ["created_at", ["created_at", "created_on"], "timestamptz"],
  ],
  plans: [
    ["id", ["id"], "bigint"],
    ["name", ["name"], "text"],
    ["price", ["price"], "numeric"],
    ["billing_period", ["billing_period"], "text"],
    ["min_quantity", ["min_quantity"], "integer"],
    ["available_from", ["available_from"], "date"],
    ["available_to", ["available_to"], "date"],
    ["auto_close_on_end", ["auto_close_on_end"], "boolean"],
    ["allow_early_close", ["allow_early_close"], "boolean"],
    ["allow_pause", ["allow_pause"], "boolean"],
    ["allow_renew", ["allow_renew"], "boolean"],
    ["created_at", ["created_at", "created_on"], "timestamptz"],
  ],
};

async function getMappedResourceQuery(resource, search) {
  const config = resources[resource];
  const table = config.table;
  const fields = mappedResourceFields[resource];
  const expressions = await Promise.all(
    fields.map(async ([alias, candidates, type]) => {
      const column = await getColumn(table, candidates, {
        required: ["id", "name"].includes(alias),
      });
      return column
        ? `${quoteColumn(column, "r")} AS ${quoteColumn(alias)}`
        : `NULL::${type} AS ${quoteColumn(alias)}`;
    })
  );
  expressions.push(await getStatusExpression(table, "r"));

  const relation =
    resource === "products"
      ? ["product_staff", "product_id"]
      : resource === "plans"
        ? ["plan_staff", "plan_id"]
        : null;
  if (relation) {
    const relationColumns = await getTableColumns(relation[0]);
    expressions.push(
      relationColumns.has(relation[1]) && relationColumns.has("staff_id")
        ? `(SELECT COUNT(*)::int FROM ${quoteColumn(relation[0])} a
            WHERE a.${quoteColumn(relation[1])} = r.${quoteColumn("id")}) AS assigned_staff_count`
        : "0::int AS assigned_staff_count"
    );
  }

  const conditions = [];
  const values = [];
  if (search) {
    const searchColumns = await Promise.all(
      config.searchColumns.map((candidate) =>
        getColumn(table, [candidate], { required: false })
      )
    );
    const available = searchColumns.filter(Boolean);
    if (available.length) {
      values.push(`%${search}%`);
      conditions.push(
        `(${available
          .map((column) => `r.${quoteColumn(column)}::text ILIKE $${values.length}`)
          .join(" OR ")})`
      );
    }
  }
  // FIX: removed the "status IN ('active','inactive')" filter. It silently hid
  // archived products and paused/closed plans, so saved records "disappeared".
  return {
    text: `SELECT ${expressions.join(", ")}
           FROM ${quoteColumn(table)} r
           ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
           ORDER BY r.${quoteColumn("id")} DESC LIMIT 100`,
    values,
  };
}

/* -------------------------------------------------------------------------- */
/* Dashboard + lookups                                                        */
/* -------------------------------------------------------------------------- */

router.get("/dashboard", async (_req, res, next) => {
  try {
    // FIX: overdue invoices now computed directly. The old query depended on a
    // v_overdue_invoices view; if it did not exist the whole dashboard failed.
    const queries = {
      customers: "SELECT COUNT(*)::int AS count FROM customers",
      staff: "SELECT COUNT(*)::int AS count FROM users WHERE role = 'staff'",
      products: "SELECT COUNT(*)::int AS count FROM products",
      activeSubscriptions: "SELECT COUNT(*)::int AS count FROM subscriptions WHERE status = 'active'",
      pendingQuotations: "SELECT COUNT(*)::int AS count FROM subscriptions WHERE status = 'quotation'",
      revenueCollected: `
        SELECT COALESCE(SUM(amount), 0) AS total
        FROM payments
        WHERE payment_date >= date_trunc('month', CURRENT_DATE)
          AND payment_date < date_trunc('month', CURRENT_DATE) + INTERVAL '1 month'`,
      outstandingBalance: `
        SELECT COALESCE(SUM(total_amount - amount_paid), 0) AS total
        FROM invoices WHERE status IN ('confirmed', 'partially_paid')`,
      overdueInvoices: `
        SELECT COUNT(*)::int AS count FROM invoices
        WHERE status IN ('confirmed', 'partially_paid') AND due_date < CURRENT_DATE`,
    };

    const results = await Promise.all(
      Object.entries(queries).map(async ([key, sql]) => {
        const { rows } = await pool.query(sql);
        return [key, rows[0]];
      })
    );
    const stats = Object.fromEntries(results);
    const monthlyRevenue = await pool.query(
      `SELECT to_char(date_trunc('month', payment_date), 'YYYY-MM-DD') AS month,
              SUM(amount)::numeric(12,2) AS revenue
       FROM payments
       WHERE payment_date >= date_trunc('month', CURRENT_DATE - INTERVAL '11 months')
       GROUP BY date_trunc('month', payment_date)
       ORDER BY date_trunc('month', payment_date)`
    );

    res.json({
      customers: stats.customers.count,
      staff: stats.staff.count,
      products: stats.products.count,
      activeSubscriptions: stats.activeSubscriptions.count,
      pendingQuotations: stats.pendingQuotations.count,
      revenueCollected: Number(stats.revenueCollected.total),
      outstandingBalance: Number(stats.outstandingBalance.total),
      overdueInvoices: stats.overdueInvoices.count,
      monthlyRevenue: monthlyRevenue.rows,
    });
  } catch (error) {
    sendDbError(error, res, next);
  }
});

router.get("/lookups", async (_req, res, next) => {
  try {
    const [planStatus, planAvailability, planAvailableTo, taxRate, taxStatus, productPrice, productStatus] =
      await Promise.all([
        getColumn("plans", ["status", "is_active"], { required: false }),
        getColumn("plans", ["available_from"], { required: false }),
        getColumn("plans", ["available_to"], { required: false }),
        getColumn("taxes", ["rate_percent", "rate"]),
        getColumn("taxes", ["status", "is_active"], { required: false }),
        getColumn("products", ["sales_price", "price"]),
        getColumn("products", ["status", "is_active"], { required: false }),
      ]);
    const activeCondition = (column) => {
      if (!column) return "TRUE";
      const reference = quoteColumn(column);
      return column === "is_active" ? `${reference} = TRUE` : `${reference} = 'active'`;
    };
    const planAvailableCondition = planAvailability
      ? `AND ${quoteColumn(planAvailability)} <= CURRENT_DATE
         ${
           planAvailableTo
             ? `AND (${quoteColumn(planAvailableTo)} IS NULL OR ${quoteColumn(planAvailableTo)} >= CURRENT_DATE)`
             : ""
         }`
      : "";
    const [customers, plans, subscriptions, invoices, staff, taxes, products] = await Promise.all([
      pool.query(
        `SELECT c.id, c.name, u.email
         FROM customers c JOIN users u ON u.id = c.user_id
         ORDER BY c.name`
      ),
      pool.query(
        `SELECT id, name, price, billing_period
         FROM plans
         WHERE ${activeCondition(planStatus)} ${planAvailableCondition}
         ORDER BY name`
      ),
      pool.query(
        `SELECT s.id, s.subscription_number, c.name AS customer_name, p.name AS plan_name
         FROM subscriptions s
         JOIN customers c ON c.id = s.customer_id
         JOIN plans p ON p.id = s.plan_id
         WHERE s.status IN ('confirmed', 'active')
         ORDER BY s.id DESC LIMIT 200`
      ),
      pool.query(
        `SELECT id, invoice_number, total_amount, amount_paid
         FROM invoices
         WHERE status IN ('confirmed', 'partially_paid')
         ORDER BY id DESC LIMIT 200`
      ),
      pool.query(
        `SELECT u.id, u.name, u.email,
                COALESCE(array_agg(ps.plan_id) FILTER (WHERE ps.plan_id IS NOT NULL), '{}') AS assigned_plan_ids
         FROM users u
         LEFT JOIN plan_staff ps ON ps.staff_id = u.id
         WHERE u.role = 'staff' AND u.status = 'active'
         GROUP BY u.id
         ORDER BY u.name`
      ),
      pool.query(
        `SELECT id, name, ${quoteColumn(taxRate)} AS rate FROM taxes
         WHERE ${activeCondition(taxStatus)} ORDER BY name`
      ),
      pool.query(
        `SELECT id, name, ${quoteColumn(productPrice)} AS sales_price
         FROM products WHERE ${activeCondition(productStatus)} ORDER BY name`
      ),
    ]);

    res.json({
      customers: customers.rows,
      plans: plans.rows,
      subscriptions: subscriptions.rows,
      invoices: invoices.rows,
      staff: staff.rows,
      taxes: taxes.rows,
      products: products.rows,
    });
  } catch (error) {
    sendDbError(error, res, next);
  }
});

/* -------------------------------------------------------------------------- */
/* Invoices                                                                   */
/* -------------------------------------------------------------------------- */

router.get("/invoices/:invoiceId/pdf", async (req, res, next) => {
  try {
    const invoiceId = Number(req.params.invoiceId);
    if (!Number.isSafeInteger(invoiceId) || invoiceId < 1) {
      return res.status(400).json({ error: "Invalid invoice ID." });
    }
    const invoiceResult = await pool.query(
      `SELECT i.*, s.subscription_number, c.name AS customer_name,
              c.address AS customer_address, c.phone AS customer_phone,
              u.email AS customer_email
       FROM invoices i
       JOIN subscriptions s ON s.id = i.subscription_id
       JOIN customers c ON c.id = s.customer_id
       JOIN users u ON u.id = c.user_id
       WHERE i.id = $1`,
      [invoiceId]
    );
    if (!invoiceResult.rowCount) {
      return res.status(404).json({ error: "Invoice not found." });
    }
    const { rows: lines } = await pool.query(
      `SELECT description, quantity, unit_price, tax_rate, line_total
       FROM invoice_lines WHERE invoice_id = $1 ORDER BY id`,
      [invoiceId]
    );
    const pdf = buildInvoicePdf(invoiceResult.rows[0], lines);
    res
      .status(200)
      .set({
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${invoiceResult.rows[0].invoice_number}.pdf"`,
        "Content-Length": String(pdf.length),
      })
      .send(pdf);
  } catch (error) {
    sendDbError(error, res, next);
  }
});

router.post("/invoices/generate", async (req, res, next) => {
  const subscriptionId = Number(req.body?.subscription_id);
  if (!Number.isSafeInteger(subscriptionId) || subscriptionId < 1) {
    return res.status(400).json({ error: "Select a valid subscription." });
  }

  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN");

    const subscriptionResult = await client.query(
      `SELECT s.id, s.status, s.start_date, s.next_billing_date,
              s.payment_term_days, s.total_amount, p.name AS plan_name,
              p.price AS plan_price, p.min_quantity, p.billing_period
       FROM subscriptions s
       JOIN plans p ON p.id = s.plan_id
       WHERE s.id = $1
       FOR UPDATE OF s`,
      [subscriptionId]
    );
    const subscription = subscriptionResult.rows[0];
    if (!subscription) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Subscription not found." });
    }
    if (subscription.status !== "active" && subscription.status !== "confirmed") {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Only confirmed or active subscriptions can be invoiced." });
    }

    const periodStart =
      subscription.next_billing_date ||
      subscription.start_date ||
      new Date().toISOString().slice(0, 10);
    // FIX: explicit casts + COALESCE so a NULL payment_term_days cannot make due_date NULL.
    const periodResult = await client.query(
      `SELECT
         ($1::date + CASE $2::text
           WHEN 'daily' THEN INTERVAL '1 day'
           WHEN 'weekly' THEN INTERVAL '1 week'
           WHEN 'monthly' THEN INTERVAL '1 month'
           WHEN 'yearly' THEN INTERVAL '1 year'
         END - INTERVAL '1 day')::date AS period_end,
         (CURRENT_DATE + COALESCE($3::integer, 0))::date AS due_date`,
      [periodStart, subscription.billing_period, subscription.payment_term_days]
    );
    const periodEnd = periodResult.rows[0].period_end;
    const dueDate = req.body?.due_date || periodResult.rows[0].due_date;

    const subscriptionLines = await client.query(
      `SELECT product_id, description, quantity, unit_price, tax_rate
       FROM subscription_lines WHERE subscription_id = $1 ORDER BY id`,
      [subscriptionId]
    );
    const lines = subscriptionLines.rows.length
      ? subscriptionLines.rows
      : [{
          product_id: null,
          description: subscription.plan_name,
          quantity: Number(subscription.min_quantity || 1),
          unit_price: Number(subscription.plan_price),
          tax_rate: 0,
        }];

    const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
    let subtotal = 0;
    let taxAmount = 0;
    const invoiceLines = lines.map((line) => {
      const lineSubtotal = Number(line.quantity) * Number(line.unit_price);
      const lineTax = round2((lineSubtotal * Number(line.tax_rate || 0)) / 100);
      subtotal += lineSubtotal;
      taxAmount += lineTax;
      return { ...line, line_total: round2(lineSubtotal + lineTax) };
    });
    subtotal = round2(subtotal);
    taxAmount = round2(taxAmount);
    const totalAmount = round2(subtotal + taxAmount);

    // The subtotal column is "untaxed_amount" on subscriptions; detect what invoices uses.
    const invoiceSubtotalColumn =
      (await getColumn("invoices", ["untaxed_amount", "subtotal"], { required: false })) ||
      "untaxed_amount";
    const invoiceResult = await client.query(
      `INSERT INTO invoices (
         subscription_id, period_start, period_end, invoice_date, due_date,
         status, ${quoteColumn(invoiceSubtotalColumn)}, tax_amount, total_amount
       )
       VALUES ($1, $2, $3, CURRENT_DATE, $4, 'draft', $5, $6, $7)
       RETURNING id, invoice_number, subscription_id, invoice_date, due_date,
                 total_amount, amount_paid, status`,
      [subscriptionId, periodStart, periodEnd, dueDate, subtotal.toFixed(2), taxAmount.toFixed(2), totalAmount.toFixed(2)]
    );
    const invoice = invoiceResult.rows[0];
    for (const line of invoiceLines) {
      await client.query(
        `INSERT INTO invoice_lines
           (invoice_id, product_id, description, quantity, unit_price, tax_rate, line_total)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [invoice.id, line.product_id, line.description, line.quantity, line.unit_price, line.tax_rate || 0, line.line_total.toFixed(2)]
      );
    }

    // FIX: advance the billing date. Previously it never moved, so the second
    // invoice for a subscription always hit the unique-period constraint.
    await client.query(
      `UPDATE subscriptions
       SET next_billing_date = ($2::date + INTERVAL '1 day')::date,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [subscriptionId, periodEnd]
    );

    await client.query("COMMIT");
    res.status(201).json({ item: invoice });
  } catch (error) {
    if (client) await safeRollback(client, "Invoice generation");
    if (error.code === "23505") {
      return res.status(409).json({
        error: "An invoice already exists for this subscription billing period.",
      });
    }
    sendDbError(error, res, next);
  } finally {
    client?.release();
  }
});

router.patch("/invoices/:invoiceId/action", async (req, res, next) => {
  const invoiceId = Number(req.params.invoiceId);
  const action = req.body?.action;
  if (!Number.isSafeInteger(invoiceId) || invoiceId < 1) {
    return res.status(400).json({ error: "Invalid invoice ID." });
  }
  if (!["confirm", "send", "cancel"].includes(action)) {
    return res.status(400).json({ error: "Choose confirm, send, or cancel." });
  }

  try {
    let result;
    if (action === "confirm") {
      result = await pool.query(
        `UPDATE invoices SET status = 'confirmed', updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND status = 'draft' RETURNING id, invoice_number, status`,
        [invoiceId]
      );
    } else if (action === "send") {
      result = await pool.query(
        `UPDATE invoices
         SET status = CASE WHEN status = 'draft' THEN 'confirmed' ELSE status END,
             sent_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND status IN ('draft', 'confirmed', 'partially_paid')
         RETURNING id, invoice_number, status, sent_at`,
        [invoiceId]
      );
    } else {
      result = await pool.query(
        `UPDATE invoices SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND status = 'draft' AND amount_paid = 0
         RETURNING id, invoice_number, status`,
        [invoiceId]
      );
    }
    if (!result.rowCount) {
      return res.status(409).json({
        error: "This invoice cannot perform that action in its current status.",
      });
    }
    res.json({ item: result.rows[0] });
  } catch (error) {
    sendDbError(error, res, next);
  }
});

/* -------------------------------------------------------------------------- */
/* Payments                                                                   */
/* -------------------------------------------------------------------------- */

router.post("/payments", async (req, res, next) => {
  const invoiceId = Number(req.body?.invoice_id);
  const amount = String(req.body?.amount ?? "").trim();
  const method = typeof req.body?.method === "string" ? req.body.method.trim() : "";
  if (
    !Number.isSafeInteger(invoiceId) ||
    invoiceId < 1 ||
    !/^\d{1,10}(\.\d{1,2})?$/.test(amount) ||
    Number(amount) <= 0 ||
    !method ||
    method.length > 30
  ) {
    return res.status(400).json({ error: "Provide an invoice, payment method, and positive amount with up to 2 decimal places." });
  }

  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    const invoice = await client.query(
      "SELECT id, total_amount, amount_paid, status FROM invoices WHERE id = $1 FOR UPDATE",
      [invoiceId]
    );
    if (!invoice.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Invoice not found." });
    }
    if (!["confirmed", "partially_paid"].includes(invoice.rows[0].status)) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Payments can only be recorded for confirmed invoices." });
    }
    if (Number(amount) > Number(invoice.rows[0].total_amount) - Number(invoice.rows[0].amount_paid)) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Payment exceeds the invoice balance." });
    }

    const payment = await client.query(
      `INSERT INTO payments (invoice_id, method, amount, payment_date, reference, note, created_by)
       VALUES ($1, $2, $3, COALESCE($4::timestamptz, CURRENT_TIMESTAMP), $5, $6, $7)
       RETURNING id, invoice_id, amount, method, payment_date, reference`,
      [
        invoiceId,
        method,
        amount,
        req.body.payment_date || null,
        req.body.reference || null,
        req.body.note || null,
        req.user.id,
      ]
    );
    const receipt = await client.query(
      `INSERT INTO receipts (payment_id) VALUES ($1)
       RETURNING id, receipt_number, payment_id, issued_at`,
      [payment.rows[0].id]
    );
    await client.query(
      `UPDATE invoices
       SET amount_paid = amount_paid + $2::numeric,
           status = CASE
             WHEN amount_paid + $2::numeric >= total_amount THEN 'paid'
             ELSE 'partially_paid'
           END,
           paid_at = CASE
             WHEN amount_paid + $2::numeric >= total_amount THEN CURRENT_TIMESTAMP
             ELSE paid_at
           END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [invoiceId, amount]
    );
    await client.query("COMMIT");
    res.status(201).json({ item: payment.rows[0], receipt: receipt.rows[0] });
  } catch (error) {
    if (client) await safeRollback(client, "Payment recording");
    sendDbError(error, res, next);
  } finally {
    client?.release();
  }
});

/* -------------------------------------------------------------------------- */
/* Customers (creates the login user + customer row together)                 */
/* -------------------------------------------------------------------------- */

router.post("/customers", async (req, res, next) => {
  const { name, email, password } = req.body ?? {};
  const clean = (v) => (typeof v === "string" ? v.trim() : "");
  const phone = clean(req.body?.phone);
  const address = clean(req.body?.address);
  const businessType = clean(req.body?.business_type);
  if (
    typeof name !== "string" ||
    name.trim().length < 2 ||
    typeof email !== "string" ||
    !EMAIL_RE.test(email.trim()) ||
    !strongPassword(password)
  ) {
    return res.status(400).json({ error: PASSWORD_MESSAGE });
  }

  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    const user = await client.query(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ($1, $2, $3, 'customer')
       RETURNING id, name, email, role, status, created_at`,
      [name.trim(), email.trim().toLowerCase(), await bcrypt.hash(password, 12)]
    );
    const customer = await client.query(
      `INSERT INTO customers (user_id, name, phone, address, business_type)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, phone, address, business_type, created_at`,
      [user.rows[0].id, name.trim(), phone || null, address || null, businessType || null]
    );
    await client.query("COMMIT");
    res.status(201).json({ item: { ...customer.rows[0], email: user.rows[0].email } });
  } catch (error) {
    if (client) await safeRollback(client, "Customer creation");
    if (error.code === "23505") {
      return res.status(409).json({ error: "An account with this email already exists." });
    }
    sendDbError(error, res, next);
  } finally {
    client?.release();
  }
});

/* -------------------------------------------------------------------------- */
/* Generic update                                                             */
/* -------------------------------------------------------------------------- */

router.patch("/:resource/:id", async (req, res, next) => {
  const { resource } = req.params;
  const id = String(req.params.id);
  if (!/^[1-9]\d*$/.test(id)) {
    return res.status(400).json({ error: "Invalid record ID." });
  }
  const body = req.body ?? {};
  const name = typeof body.name === "string" ? body.name.trim() : "";

  try {
    let result;
    if (resource === "staff") {
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      if (name.length < 2 || !EMAIL_RE.test(email) || !["active", "inactive"].includes(body.status)) {
        return res.status(400).json({ error: "Provide a name, valid email, and active or inactive status." });
      }
      result = await pool.query(
        `UPDATE users SET name = $2, email = $3, status = $4, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND role = 'staff'
         RETURNING id, name, email, role, status, created_at`,
        [id, name, email, body.status]
      );
    } else if (resource === "customers") {
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      if (name.length < 2 || !EMAIL_RE.test(email)) {
        return res.status(400).json({ error: "Provide a name and a valid email." });
      }
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        result = await client.query(
          `UPDATE customers
           SET name = $2, phone = $3, address = $4, business_type = $5,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $1
           RETURNING id, user_id, name, phone, address, business_type, created_at`,
          [id, name, body.phone || null, body.address || null, body.business_type || null]
        );
        if (result.rowCount) {
          await client.query(
            `UPDATE users SET name = $2, email = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
            [result.rows[0].user_id, name, email]
          );
          result.rows[0].email = email;
        }
        await client.query("COMMIT");
      } catch (error) {
        await safeRollback(client, "Customer update");
        throw error;
      } finally {
        client.release();
      }
    } else if (resource === "taxes") {
      const rate = Number(body.rate);
      const status = normalizeStatus("taxes", body.status);
      if (!name || !Number.isFinite(rate) || rate < 0 || rate > 100 || !status) {
        return res.status(400).json({ error: "Provide a tax name, a rate between 0 and 100, and a valid status." });
      }
      const statusColumn = await getColumn("taxes", ["status", "is_active"], { required: false });
      result = await updateMappedRow(
        "taxes",
        id,
        [
          [name, ["name"]],
          [rate, ["rate_percent", "rate"]],
          [body.description || null, ["description", "notes"]],
          [statusColumn ? columnStatus(statusColumn, status) : undefined, ["status", "is_active"]],
          [new Date(), ["updated_at", "updated_on"]],
        ],
        [
          ["id", ["id"]],
          ["name", ["name"]],
          ["rate", ["rate_percent", "rate"]],
          ["description", ["description", "notes"]],
          ["created_at", ["created_at", "created_on"]],
        ]
      );
      if (result.rowCount) result.rows[0].status = status;
    } else if (resource === "products") {
      const salesPrice = Number(body.sales_price);
      const costPrice = Number(body.cost_price ?? 0);
      const type = typeof body.type === "string" ? body.type.trim() : "";
      const status = normalizeStatus("products", body.status);
      if (
        !name ||
        !PRODUCT_TYPES.includes(type) ||
        !Number.isFinite(salesPrice) || salesPrice < 0 ||
        !Number.isFinite(costPrice) || costPrice < 0 ||
        !status
      ) {
        return res.status(400).json({
          error: "Provide a product name, a type (service, goods or addon), valid non-negative prices, and a valid status.",
        });
      }
      const statusColumn = await getColumn("products", ["status", "is_active"], { required: false });
      result = await updateMappedRow(
        "products",
        id,
        [
          [name, ["name"]],
          [type, ["product_type", "type"]],
          [salesPrice, ["sales_price", "price"]],
          [costPrice, ["cost_price"]],
          [body.tax_id || null, ["tax_id"]],
          [body.notes || null, ["notes", "description"]],
          [statusColumn ? columnStatus(statusColumn, status) : undefined, ["status", "is_active"]],
          [new Date(), ["updated_at", "updated_on"]],
        ],
        [
          ["id", ["id"]],
          ["name", ["name"]],
          ["type", ["product_type", "type"]],
          ["sales_price", ["sales_price", "price"]],
          ["cost_price", ["cost_price"]],
          ["tax_id", ["tax_id"]],
          ["status", ["status", "is_active"]],
          ["created_at", ["created_at", "created_on"]],
        ]
      );
      if (result.rowCount && statusColumn === "is_active") result.rows[0].status = status;
    } else if (resource === "plans") {
      const price = Number(body.price);
      const minQuantity = Number(body.min_quantity);
      const status = normalizeStatus("plans", body.status);
      if (
        !name ||
        !Number.isFinite(price) || price < 0 ||
        !Number.isInteger(minQuantity) || minQuantity < 1 ||
        !["daily", "weekly", "monthly", "yearly"].includes(body.billing_period) ||
        !status ||
        !body.available_from ||
        (body.available_to && body.available_to < body.available_from)
      ) {
        return res.status(400).json({ error: "Provide valid plan details and availability dates." });
      }
      const statusColumn = await getColumn("plans", ["status", "is_active"], { required: false });
      result = await updateMappedRow(
        "plans",
        id,
        [
          [name, ["name"]],
          [price, ["price"]],
          [body.billing_period, ["billing_period"]],
          [minQuantity, ["min_quantity"]],
          [body.available_from, ["available_from"]],
          [body.available_to || null, ["available_to"]],
          [body.auto_close_on_end === true, ["auto_close_on_end"]],
          [body.allow_early_close === true, ["allow_early_close"]],
          [body.allow_pause === true, ["allow_pause"]],
          [body.allow_renew === true, ["allow_renew"]],
          [statusColumn ? columnStatus(statusColumn, status) : undefined, ["status", "is_active"]],
          [new Date(), ["updated_at", "updated_on"]],
        ],
        mappedResourceFields.plans
          .filter(([alias]) => alias !== "created_at")
          .concat([["status", ["status", "is_active"]], ["created_at", ["created_at", "created_on"]]])
      );
      if (result.rowCount && statusColumn === "is_active") result.rows[0].status = status;
    } else if (resource === "discounts") {
      const value = Number(body.value);
      const type = body.type ?? body.discount_type;
      const minPurchase = Number(body.min_purchase_amount || 0);
      const minQty = Number(body.min_quantity || 0);
      const usageLimit =
        body.usage_limit === "" || body.usage_limit == null ? null : Number(body.usage_limit);
      if (
        !name ||
        !Number.isFinite(value) || value <= 0 ||
        !["fixed", "percentage"].includes(type) ||
        (type === "percentage" && value > 100) ||
        !Number.isFinite(minPurchase) || minPurchase < 0 ||
        !Number.isInteger(minQty) || minQty < 0 ||
        !body.start_date ||
        (body.end_date && body.end_date < body.start_date) ||
        (usageLimit !== null && (!Number.isInteger(usageLimit) || usageLimit < 0))
      ) {
        return res.status(400).json({
          error: "Provide a name, valid type and value, a start date, and an end date that is not before it.",
        });
      }
      result = await pool.query(
        `UPDATE discounts
         SET name = $2, discount_type = $3, value = $4, min_purchase_amount = $5,
             min_quantity = $6, start_date = $7, end_date = $8, usage_limit = $9,
             status = $10, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1
         RETURNING id, name, discount_type AS type, value, applies_to, min_purchase_amount,
                   min_quantity, start_date, end_date, usage_limit, times_used, status`,
        [id, name, type, value, minPurchase, minQty, body.start_date, body.end_date || null, usageLimit, body.status || "active"]
      );
    } else if (resource === "subscriptions" || resource === "quotations") {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const current = await client.query(
          "SELECT id, plan_id, status FROM subscriptions WHERE id = $1 FOR UPDATE",
          [id]
        );
        if (!current.rowCount) {
          await client.query("ROLLBACK");
          return res.status(404).json({ error: "Subscription not found." });
        }
        const status = body.status;
        if (!["draft", "quotation", "confirmed", "active", "closed"].includes(status)) {
          await client.query("ROLLBACK");
          return res.status(400).json({ error: "Select a valid subscription status." });
        }
        if (
          ["confirmed", "active"].includes(status) &&
          (!body.start_date || !body.expiry_date || body.expiry_date < body.start_date)
        ) {
          await client.query("ROLLBACK");
          return res.status(400).json({ error: "Confirmed and active subscriptions require valid start and expiry dates." });
        }
        if (body.assigned_staff_id) {
          const staff = await client.query(
            `SELECT id FROM plan_staff WHERE plan_id = $1 AND staff_id = $2`,
            [current.rows[0].plan_id, body.assigned_staff_id]
          );
          if (!staff.rowCount) {
            await client.query("ROLLBACK");
            return res.status(400).json({ error: "Assign this staff member to the plan first." });
          }
        }
        // FIX: $2 is cast to text everywhere (avoids "inconsistent types deduced
        // for parameter $2") and next_billing_date is only seeded when empty,
        // so re-saving never resets billing back to the start date.
        result = await client.query(
          `UPDATE subscriptions
           SET status = $2::text, start_date = $3::date, expiry_date = $4::date,
               assigned_staff_id = $5, payment_term_days = $6,
               next_billing_date = CASE
                 WHEN $2::text = 'active' AND next_billing_date IS NULL THEN $3::date
                 ELSE next_billing_date
               END,
               confirmed_at = CASE
                 WHEN $2::text IN ('confirmed', 'active') AND confirmed_at IS NULL
                   THEN CURRENT_TIMESTAMP
                 ELSE confirmed_at
               END,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $1
           RETURNING id, subscription_number, customer_id, plan_id,
                     assigned_staff_id, status, start_date, expiry_date,
                     next_billing_date, payment_term_days, total_amount, created_at`,
          [
            id,
            status,
            body.start_date || null,
            body.expiry_date || null,
            body.assigned_staff_id || null,
            Number(body.payment_term_days || 0),
          ]
        );
        if (current.rows[0].status !== status) {
          await client.query(
            `INSERT INTO subscription_status_history
               (subscription_id, from_status, to_status, changed_by, note)
             VALUES ($1, $2, $3, $4, $5)`,
            [id, current.rows[0].status, status, req.user.id, body.note || "Updated by admin."]
          );
        }
        await client.query("COMMIT");
      } catch (error) {
        await safeRollback(client, "Subscription update");
        throw error;
      } finally {
        client.release();
      }
    } else {
      return res.status(405).json({ error: "This record can only be changed through its workflow." });
    }

    if (!result.rowCount) {
      return res.status(404).json({ error: "Record not found." });
    }
    const { user_id: _userId, ...item } = result.rows[0];
    res.json({ item });
  } catch (error) {
    sendDbError(error, res, next);
  }
});

/* -------------------------------------------------------------------------- */
/* Delete                                                                     */
/* -------------------------------------------------------------------------- */

router.delete("/:resource/:id", async (req, res, next) => {
  const { resource } = req.params;
  const id = String(req.params.id);
  if (!/^[1-9]\d*$/.test(id)) {
    return res.status(400).json({ error: "Invalid record ID." });
  }
  const deleteTables = {
    customers: "customers",
    staff: "users",
    products: "products",
    taxes: "taxes",
    plans: "plans",
    discounts: "discounts",
  };
  const table = deleteTables[resource];
  if (!table) {
    return res.status(405).json({ error: "This record cannot be deleted; use its workflow instead." });
  }

  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    let result;
    if (resource === "customers") {
      const customer = await client.query("DELETE FROM customers WHERE id = $1 RETURNING user_id", [id]);
      if (customer.rowCount) {
        await client.query("DELETE FROM users WHERE id = $1", [customer.rows[0].user_id]);
      }
      result = customer;
    } else if (resource === "staff") {
      result = await client.query("DELETE FROM users WHERE id = $1 AND role = 'staff' RETURNING id", [id]);
    } else {
      result = await client.query(`DELETE FROM ${table} WHERE id = $1 RETURNING id`, [id]);
    }
    if (!result.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Record not found." });
    }
    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (error) {
    if (client) await safeRollback(client, "Admin delete");
    if (error.code === "23503") {
      return res.status(409).json({
        error: "This record is connected to existing subscriptions or transactions and cannot be deleted. Set it to inactive/archived instead.",
      });
    }
    sendDbError(error, res, next);
  } finally {
    client?.release();
  }
});

/* -------------------------------------------------------------------------- */
/* Staff assignment (plans + products share one implementation)               */
/* -------------------------------------------------------------------------- */

const validStaffId = (id) =>
  (typeof id === "number" && Number.isSafeInteger(id) && id > 0) ||
  (typeof id === "string" && /^[1-9]\d*$/.test(id));

function registerStaffAssignment({ path, parentTable, joinTable, parentColumn, label }) {
  router.get(`/${path}/:parentId/staff`, async (req, res, next) => {
    try {
      const parentId = Number(req.params.parentId);
      if (!Number.isSafeInteger(parentId) || parentId < 1) {
        return res.status(400).json({ error: `Invalid ${label} ID.` });
      }
      const parent = await pool.query(`SELECT id FROM ${parentTable} WHERE id = $1`, [parentId]);
      if (!parent.rowCount) {
        return res.status(404).json({ error: `${label[0].toUpperCase()}${label.slice(1)} not found.` });
      }
      const { rows } = await pool.query(
        `SELECT u.id, u.name, u.email, u.status,
                (j.staff_id IS NOT NULL) AS assigned
         FROM users u
         LEFT JOIN ${joinTable} j ON j.staff_id = u.id AND j.${parentColumn} = $1
         WHERE u.role = 'staff'
         ORDER BY u.name, u.id`,
        [parentId]
      );
      res.json({ staff: rows });
    } catch (error) {
      sendDbError(error, res, next);
    }
  });

  router.put(`/${path}/:parentId/staff`, async (req, res, next) => {
    const parentId = Number(req.params.parentId);
    const staffIds = req.body?.staffIds;
    if (!Number.isSafeInteger(parentId) || parentId < 1) {
      return res.status(400).json({ error: `Invalid ${label} ID.` });
    }
    if (!Array.isArray(staffIds) || !staffIds.every(validStaffId)) {
      return res.status(400).json({ error: "staffIds must be an array of valid staff IDs." });
    }
    const normalizedIds = [...new Set(staffIds.map(String))];

    let client;
    try {
      client = await pool.connect();
      await client.query("BEGIN");
      const parent = await client.query(`SELECT id FROM ${parentTable} WHERE id = $1 FOR UPDATE`, [parentId]);
      if (!parent.rowCount) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: `${label[0].toUpperCase()}${label.slice(1)} not found.` });
      }
      if (normalizedIds.length) {
        const staff = await client.query(
          `SELECT id FROM users WHERE role = 'staff' AND id = ANY($1::bigint[])`,
          [normalizedIds]
        );
        if (staff.rowCount !== normalizedIds.length) {
          await client.query("ROLLBACK");
          return res.status(400).json({ error: "Select only existing staff accounts." });
        }
      }
      await client.query(`DELETE FROM ${joinTable} WHERE ${parentColumn} = $1`, [parentId]);
      if (normalizedIds.length) {
        const columns = await getTableColumns(joinTable);
        const hasAssignedBy = columns.has("assigned_by");
        await client.query(
          `INSERT INTO ${joinTable} (${parentColumn}, staff_id${hasAssignedBy ? ", assigned_by" : ""})
           SELECT $1, selected.staff_id${hasAssignedBy ? ", $3" : ""}
           FROM unnest($2::bigint[]) AS selected(staff_id)`,
          hasAssignedBy ? [parentId, normalizedIds, req.user.id] : [parentId, normalizedIds]
        );
      }
      await client.query("COMMIT");
      res.json({ ok: true, assignedStaffCount: normalizedIds.length });
    } catch (error) {
      if (client) await safeRollback(client, `${label} staff assignment`);
      sendDbError(error, res, next);
    } finally {
      client?.release();
    }
  });
}

registerStaffAssignment({ path: "plans", parentTable: "plans", joinTable: "plan_staff", parentColumn: "plan_id", label: "plan" });
registerStaffAssignment({ path: "products", parentTable: "products", joinTable: "product_staff", parentColumn: "product_id", label: "product" });

/* -------------------------------------------------------------------------- */
/* Generic list                                                               */
/* -------------------------------------------------------------------------- */

router.get("/:resource", async (req, res, next) => {
  try {
    const config = resources[req.params.resource];
    if (!config) {
      return res.status(404).json({ error: "Admin resource not found." });
    }
    const search = String(req.query.search || "").trim();

    if (mappedResourceFields[req.params.resource]) {
      const { text, values } = await getMappedResourceQuery(req.params.resource, search);
      const { rows } = await pool.query(text, values);
      return res.json({ items: rows });
    }

    const values = [];
    const conditions = [];
    if (config.extraWhere) conditions.push(config.extraWhere);
    if (search) {
      values.push(`%${search}%`);
      conditions.push(
        `(${config.searchColumns.map((column) => `${column}::text ILIKE $${values.length}`).join(" OR ")})`
      );
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const { rows } = await pool.query(
      `SELECT ${config.columns} FROM ${config.table} ${where} ORDER BY id DESC LIMIT 100`,
      values
    );
    res.json({ items: rows });
  } catch (error) {
    sendDbError(error, res, next);
  }
});

/* -------------------------------------------------------------------------- */
/* Generic create                                                             */
/* -------------------------------------------------------------------------- */

router.post("/:resource", async (req, res, next) => {
  try {
    const { resource } = req.params;
    const body = req.body ?? {};
    const name = typeof body.name === "string" ? body.name.trim() : "";
    let result;

    if (resource === "quotations" || resource === "subscriptions") {
      const customerId = String(body.customer_id ?? "");
      const planId = String(body.plan_id ?? "");
      const status = resource === "quotations" ? "quotation" : body.status || "draft";
      if (
        !/^[1-9]\d*$/.test(customerId) ||
        !/^[1-9]\d*$/.test(planId) ||
        !["draft", "quotation", "confirmed", "active"].includes(status)
      ) {
        return res.status(400).json({ error: "Select a customer, plan, and valid subscription status." });
      }
      if (
        ["confirmed", "active"].includes(status) &&
        (!body.start_date || !body.expiry_date || body.expiry_date < body.start_date)
      ) {
        return res.status(400).json({ error: "Confirmed and active subscriptions require valid start and expiry dates." });
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const [planStatus, planAvailableFrom, planAvailableTo] = await Promise.all([
          getColumn("plans", ["status", "is_active"], { required: false }),
          getColumn("plans", ["available_from"], { required: false }),
          getColumn("plans", ["available_to"], { required: false }),
        ]);
        const planConditions = [`id = $1`];
        if (planStatus) {
          planConditions.push(
            planStatus === "is_active"
              ? `${quoteColumn(planStatus)} = TRUE`
              : `${quoteColumn(planStatus)} = 'active'`
          );
        }
        if (planAvailableFrom) planConditions.push(`${quoteColumn(planAvailableFrom)} <= CURRENT_DATE`);
        if (planAvailableTo) {
          planConditions.push(
            `(${quoteColumn(planAvailableTo)} IS NULL OR ${quoteColumn(planAvailableTo)} >= CURRENT_DATE)`
          );
        }
        const planResult = await client.query(
          `SELECT id, name, price, min_quantity FROM plans WHERE ${planConditions.join(" AND ")}`,
          [planId]
        );
        if (!planResult.rowCount) {
          await client.query("ROLLBACK");
          return res.status(400).json({ error: "The selected plan is unavailable." });
        }
        const customer = await client.query("SELECT id FROM customers WHERE id = $1", [customerId]);
        if (!customer.rowCount) {
          await client.query("ROLLBACK");
          return res.status(400).json({ error: "The selected customer does not exist." });
        }
        const plan = planResult.rows[0];
        const amount = (Number(plan.price) * Number(plan.min_quantity)).toFixed(2);
        const assignedStaffId = body.assigned_staff_id ? String(body.assigned_staff_id) : null;
        if (assignedStaffId) {
          const staff = await client.query(
            `SELECT u.id FROM users u
             JOIN plan_staff ps ON ps.staff_id = u.id
             WHERE u.id = $1 AND u.role = 'staff' AND ps.plan_id = $2`,
            [assignedStaffId, planId]
          );
          if (!staff.rowCount) {
            await client.query("ROLLBACK");
            return res.status(400).json({ error: "Assign this staff member to the plan before assigning them to a subscription." });
          }
        }
        // FIX (main reason subscriptions/quotations were NOT saving):
        // the schema only allows source IN ('staff','customer_request').
        // The old code inserted 'admin', which always failed the CHECK constraint.
        // Also records created_by.
        const subscription = await client.query(
          `INSERT INTO subscriptions (
             customer_id, plan_id, assigned_staff_id, created_by, source, status, start_date,
             expiry_date, confirmed_at, payment_term_days, next_billing_date,
             untaxed_amount, tax_amount, total_amount
           )
           VALUES ($1, $2, $3, $4, 'staff', $5, $6, $7, $8, $9, $10, $11, 0, $11)
           RETURNING id, subscription_number, customer_id, plan_id,
                     assigned_staff_id, status, start_date, expiry_date,
                     next_billing_date, payment_term_days, total_amount, created_at`,
          [
            customerId,
            planId,
            assignedStaffId,
            req.user.id,
            status,
            body.start_date || null,
            body.expiry_date || null,
            ["confirmed", "active"].includes(status) ? new Date() : null,
            Number(body.payment_term_days || 0),
            status === "active" ? body.start_date : null,
            amount,
          ]
        );
        await client.query(
          `INSERT INTO subscription_status_history
             (subscription_id, from_status, to_status, changed_by, note)
           VALUES ($1, NULL, $2, $3, $4)`,
          [
            subscription.rows[0].id,
            status,
            req.user.id,
            `Created by admin${resource === "quotations" ? " as quotation" : ""}.`,
          ]
        );
        await client.query("COMMIT");
        return res.status(201).json({ item: subscription.rows[0] });
      } catch (error) {
        await safeRollback(client, "Subscription creation");
        throw error;
      } finally {
        client.release();
      }
    } else if (resource === "invoices") {
      return res.status(400).json({ error: "Generate an invoice from a confirmed or active subscription." });
    } else if (resource === "staff") {
      const { email, password } = body;
      const status = body.status || "active";
      if (
        name.length < 2 ||
        typeof email !== "string" ||
        !EMAIL_RE.test(email.trim()) ||
        !strongPassword(password) ||
        !["active", "inactive"].includes(status)
      ) {
        return res.status(400).json({ error: PASSWORD_MESSAGE });
      }
      result = await pool.query(
        `INSERT INTO users (name, email, password_hash, role, status)
         VALUES ($1, $2, $3, 'staff', $4)
         RETURNING id, name, email, role, status, created_at`,
        [name, email.trim().toLowerCase(), await bcrypt.hash(password, 12), status]
      );
    } else if (resource === "taxes") {
      const rate = Number(body.rate);
      const status = normalizeStatus("taxes", body.status || "active");
      if (!name || !Number.isFinite(rate) || rate < 0 || rate > 100 || !status) {
        return res.status(400).json({ error: "Provide a tax name, a rate between 0 and 100, and a valid status." });
      }
      const statusColumn = await getColumn("taxes", ["status", "is_active"], { required: false });
      result = await insertMappedRow(
        "taxes",
        [
          [name, ["name"], true],
          [rate, ["rate_percent", "rate"], true],
          [body.description || null, ["description", "notes"]],
          [statusColumn ? columnStatus(statusColumn, status) : undefined, ["status", "is_active"]],
        ],
        [
          ["id", ["id"]],
          ["name", ["name"]],
          ["rate", ["rate_percent", "rate"]],
          ["description", ["description", "notes"]],
          ["created_at", ["created_at", "created_on"]],
        ]
      );
      if (result.rowCount) result.rows[0].status = status;
    } else if (resource === "products") {
      const salesPrice = Number(body.sales_price);
      const costPrice = Number(body.cost_price ?? 0);
      const type = typeof body.type === "string" ? body.type.trim() : "";
      const status = normalizeStatus("products", body.status || "active");
      // FIX: products.product_type is CHECK (service|goods|addon); free text failed.
      if (
        !name ||
        !PRODUCT_TYPES.includes(type) ||
        !Number.isFinite(salesPrice) || salesPrice < 0 ||
        !Number.isFinite(costPrice) || costPrice < 0 ||
        !status
      ) {
        return res.status(400).json({
          error: "Provide a product name, a type (service, goods or addon), valid non-negative prices, and a valid status.",
        });
      }
      const statusColumn = await getColumn("products", ["status", "is_active"], { required: false });
      result = await insertMappedRow(
        "products",
        [
          [name, ["name"], true],
          [type, ["product_type", "type"], true],
          [salesPrice, ["sales_price", "price"], true],
          [costPrice, ["cost_price"]],
          [body.tax_id || null, ["tax_id"]],
          [body.notes || null, ["notes", "description"]],
          [statusColumn ? columnStatus(statusColumn, status) : undefined, ["status", "is_active"]],
          [req.user.id, ["created_by"]],
        ],
        [
          ["id", ["id"]],
          ["name", ["name"]],
          ["type", ["product_type", "type"]],
          ["sales_price", ["sales_price", "price"]],
          ["cost_price", ["cost_price"]],
          ["tax_id", ["tax_id"]],
          ["notes", ["notes", "description"]],
          ["created_at", ["created_at", "created_on"]],
        ]
      );
      if (result.rowCount) result.rows[0].status = status;
    } else if (resource === "plans") {
      const price = Number(body.price);
      const minQuantity = Number(body.min_quantity ?? 1);
      const availableFrom = body.available_from || new Date().toISOString().slice(0, 10);
      const availableTo = body.available_to || null;
      const status = normalizeStatus("plans", body.status || "active");
      const validDate = (value) => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
        const parsed = new Date(`${value}T00:00:00.000Z`);
        return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
      };
      const flags = ["auto_close_on_end", "allow_early_close", "allow_pause", "allow_renew"];
      if (
        !name ||
        !Number.isFinite(price) || price < 0 ||
        !["daily", "weekly", "monthly", "yearly"].includes(body.billing_period) ||
        !Number.isInteger(minQuantity) || minQuantity < 1 ||
        !validDate(availableFrom) ||
        (availableTo !== null && !validDate(availableTo)) ||
        (availableTo !== null && availableTo < availableFrom) ||
        flags.some((flag) => body[flag] !== undefined && typeof body[flag] !== "boolean") ||
        !status
      ) {
        return res.status(400).json({
          error: "Provide a plan name, non-negative price, valid billing period, positive minimum quantity, valid availability dates and status.",
        });
      }
      const statusColumn = await getColumn("plans", ["status", "is_active"], { required: false });
      result = await insertMappedRow(
        "plans",
        [
          [name, ["name"], true],
          [price, ["price"], true],
          [body.billing_period, ["billing_period"], true],
          [minQuantity, ["min_quantity"]],
          [availableFrom, ["available_from"]],
          [availableTo, ["available_to"]],
          [body.auto_close_on_end ?? false, ["auto_close_on_end"]],
          [body.allow_early_close ?? false, ["allow_early_close"]],
          [body.allow_pause ?? false, ["allow_pause"]],
          [body.allow_renew ?? true, ["allow_renew"]],
          [statusColumn ? columnStatus(statusColumn, status) : undefined, ["status", "is_active"]],
          [req.user.id, ["created_by"]],
        ],
        [
          ["id", ["id"]],
          ...mappedResourceFields.plans.filter(([alias]) => alias !== "id"),
          ["status", ["status", "is_active"]],
          ["created_by", ["created_by"]],
        ]
      );
      if (result.rowCount) result.rows[0].status = status;
    } else if (resource === "discounts") {
      const type = body.type ?? body.discount_type;
      const value = Number(body.value);
      const minPurchase = Number(body.min_purchase_amount || 0);
      const minQty = Number(body.min_quantity || 0);
      const usageLimit =
        body.usage_limit === "" || body.usage_limit == null ? null : Number(body.usage_limit);
      if (
        !name ||
        !["fixed", "percentage"].includes(type) ||
        !Number.isFinite(value) || value <= 0 ||
        (type === "percentage" && value > 100) ||
        !Number.isFinite(minPurchase) || minPurchase < 0 ||
        !Number.isInteger(minQty) || minQty < 0 ||
        !body.start_date ||
        (body.end_date && body.end_date < body.start_date)
      ) {
        return res.status(400).json({
          error: "Provide a name, valid type and positive value (percentage cannot exceed 100), a start date, and an end date that is not before it.",
        });
      }
      if (usageLimit !== null && (!Number.isInteger(usageLimit) || usageLimit < 0)) {
        return res.status(400).json({ error: "Usage limit must be a non-negative whole number." });
      }
      result = await pool.query(
        `INSERT INTO discounts
           (name, discount_type, value, min_purchase_amount, min_quantity,
            start_date, end_date, usage_limit, status, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id, name, discount_type AS type, value, applies_to, min_purchase_amount,
                   min_quantity, start_date, end_date, usage_limit, times_used, status`,
        [name, type, value, minPurchase, minQty, body.start_date, body.end_date || null, usageLimit, body.status || "active", req.user.id]
      );
    } else {
      return res.status(405).json({ error: "This resource must be created through its business workflow." });
    }

    res.status(201).json({ item: result.rows[0] });
  } catch (error) {
    sendDbError(error, res, next);
  }
});

export default router;
