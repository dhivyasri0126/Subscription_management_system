import { Router } from "express";
import bcrypt from "bcryptjs";
import { pool } from "../db.js";
import { requireAuth, requireRole } from "../middleware/requireAuth.js";
import { buildInvoicePdf } from "../services/invoicePdf.js";
import {
  getColumn,
  getStatusExpression,
  getTableColumns,
  insertMappedRow,
  quoteColumn,
  statusValue,
  updateMappedRow,
} from "../services/adminSchema.js";

const router = Router();

router.use(requireAuth, requireRole("admin"));

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
  products: {
    table: "products",
    searchColumns: ["name", "product_type", "type"],
  },
  taxes: {
    table: "taxes",
    searchColumns: ["name"],
  },
  plans: {
    table: "plans",
    searchColumns: ["name", "billing_period"],
  },
  quotations: {
    table: "subscriptions",
    columns: "id, subscription_number, customer_id, plan_id, status, start_date, expiry_date, created_at",
    searchColumns: ["subscription_number", "status"],
    extraWhere: "status = 'quotation'",
  },
  subscriptions: {
    table: "subscriptions",
    columns: `id, subscription_number, customer_id, plan_id, assigned_staff_id, status,
      start_date, expiry_date, next_billing_date, payment_term_days, subtotal, tax_amount,
      total_amount, created_at`,
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
    columns: "id, code, name, discount_type AS type, discount_value AS value, start_date, end_date, usage_limit, status",
    searchColumns: ["code", "discount_type"],
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
    const searchable = config.searchColumns;
    const searchColumns = await Promise.all(
      searchable.map(async (candidate) =>
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

  const statusColumn = await getColumn(table, ["status", "is_active"], {
    required: false,
  });
  if (statusColumn === "status") {
    conditions.push(`r.${quoteColumn(statusColumn)} IN ('active', 'inactive')`);
  }
  return {
    text: `SELECT ${expressions.join(", ")}
           FROM ${quoteColumn(table)} r
           ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
           ORDER BY r.${quoteColumn("id")} DESC LIMIT 100`,
    values,
  };
}

router.get("/dashboard", async (_req, res, next) => {
  try {
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
          AND payment_date < date_trunc('month', CURRENT_DATE) + INTERVAL '1 month'
      `,
      outstandingBalance: `
        SELECT COALESCE(SUM(total_amount - amount_paid), 0) AS total
        FROM invoices
        WHERE status IN ('confirmed', 'partially_paid')
      `,
      overdueInvoices: "SELECT COUNT(*)::int AS count FROM v_overdue_invoices",
    };

    const results = await Promise.all(
      Object.entries(queries).map(async ([key, sql]) => {
        const { rows } = await pool.query(sql);
        return [key, rows[0]];
      })
    );
    const stats = Object.fromEntries(results);
    const monthlyRevenue = await pool.query(
      `SELECT date_trunc('month', payment_date)::date AS month,
              SUM(amount)::numeric(12,2) AS revenue
       FROM payments
       WHERE payment_date >= date_trunc('month', CURRENT_DATE - INTERVAL '11 months')
       GROUP BY date_trunc('month', payment_date)::date
       ORDER BY month`
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
    next(error);
  }
});

router.get("/lookups", async (_req, res, next) => {
  try {
    const [
      planStatus,
      planAvailability,
      planAvailableTo,
      taxRate,
      taxStatus,
      productPrice,
      productStatus,
    ] =
      await Promise.all([
        getColumn("plans", ["status", "is_active"], { required: false }),
        getColumn("plans", ["available_from"], { required: false }),
        getColumn("plans", ["available_to"], { required: false }),
        getColumn("taxes", ["rate_percent", "rate"]),
        getColumn("taxes", ["status", "is_active"], { required: false }),
        getColumn("products", ["sales_price", "price"]),
        getColumn("products", ["status", "is_active"], { required: false }),
      ]);
    const activeCondition = (column, qualifier = "") => {
      if (!column) return "TRUE";
      const reference = quoteColumn(column, qualifier);
      return column === "is_active"
        ? `${reference} = TRUE`
        : `${reference} = 'active'`;
    };
    const planAvailableCondition = planAvailability
      ? `AND ${quoteColumn(planAvailability)} <= CURRENT_DATE
         ${
           planAvailableTo
             ? `AND (${quoteColumn(planAvailableTo)} IS NULL OR ${quoteColumn(planAvailableTo)} >= CURRENT_DATE)`
             : ""
         }`
      : "";
    const [customers, plans, subscriptions, invoices, staff, taxes, products] =
      await Promise.all([
        pool.query(
          `SELECT c.id, c.name, u.email
           FROM customers c JOIN users u ON u.id = c.user_id
           ORDER BY c.name`
        ),
        pool.query(
          `SELECT id, name, price, billing_period
           FROM plans
           WHERE ${activeCondition(planStatus)}
             ${planAvailableCondition}
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
    next(error);
  }
});

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
       FROM invoice_lines
       WHERE invoice_id = $1
       ORDER BY id`,
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
    next(error);
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
    const periodResult = await client.query(
      `SELECT
         ($1::date + CASE $2
           WHEN 'daily' THEN INTERVAL '1 day'
           WHEN 'weekly' THEN INTERVAL '1 week'
           WHEN 'monthly' THEN INTERVAL '1 month'
           WHEN 'yearly' THEN INTERVAL '1 year'
         END - INTERVAL '1 day')::date AS period_end,
         (CURRENT_DATE + $3::integer)::date AS due_date`,
      [periodStart, subscription.billing_period, subscription.payment_term_days]
    );
    const periodEnd = periodResult.rows[0].period_end;
    const dueDate = req.body?.due_date || periodResult.rows[0].due_date;

    const subscriptionLines = await client.query(
      `SELECT product_id, description, quantity, unit_price, tax_rate
       FROM subscription_lines
       WHERE subscription_id = $1
       ORDER BY id`,
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

    let subtotal = 0;
    let taxAmount = 0;
    const invoiceLines = lines.map((line) => {
      const lineSubtotal = Number(line.quantity) * Number(line.unit_price);
      const lineTax =
        Math.round(
          (lineSubtotal * Number(line.tax_rate) / 100 + Number.EPSILON) * 100
        ) / 100;
      subtotal += lineSubtotal;
      taxAmount += lineTax;
      return {
        ...line,
        line_total: Math.round((lineSubtotal + lineTax + Number.EPSILON) * 100) / 100,
      };
    });
    subtotal = Math.round((subtotal + Number.EPSILON) * 100) / 100;
    taxAmount = Math.round((taxAmount + Number.EPSILON) * 100) / 100;
    const totalAmount =
      Math.round((subtotal + taxAmount + Number.EPSILON) * 100) / 100;

    const invoiceResult = await client.query(
      `INSERT INTO invoices (
         subscription_id, period_start, period_end, invoice_date, due_date,
         status, subtotal, tax_amount, total_amount
       )
       VALUES ($1, $2, $3, CURRENT_DATE, $4, 'draft', $5, $6, $7)
       RETURNING id, invoice_number, subscription_id, invoice_date, due_date,
                 total_amount, amount_paid, status`,
      [
        subscriptionId,
        periodStart,
        periodEnd,
        dueDate,
        subtotal.toFixed(2),
        taxAmount.toFixed(2),
        totalAmount.toFixed(2),
      ]
    );
    const invoice = invoiceResult.rows[0];
    for (const line of invoiceLines) {
      await client.query(
        `INSERT INTO invoice_lines
           (invoice_id, product_id, description, quantity, unit_price, tax_rate, line_total)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          invoice.id,
          line.product_id,
          line.description,
          line.quantity,
          line.unit_price,
          line.tax_rate,
          line.line_total.toFixed(2),
        ]
      );
    }

    await client.query("COMMIT");
    res.status(201).json({ item: invoice });
  } catch (error) {
    if (client) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("Invoice generation rollback failed:", rollbackError);
      }
    }
    if (error.code === "23505") {
      return res.status(409).json({
        error: "An invoice already exists for this subscription billing period.",
      });
    }
    next(error);
  } finally {
    client?.release();
  }
});

router.post("/payments", async (req, res, next) => {
  const invoiceId = Number(req.body?.invoice_id);
  const amount = String(req.body?.amount ?? "");
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
      `INSERT INTO receipts (payment_id)
       VALUES ($1)
       RETURNING id, receipt_number, payment_id, issued_at`,
      [payment.rows[0].id]
    );
    await client.query(
      `UPDATE invoices
       SET amount_paid = amount_paid + $2,
           status = CASE
             WHEN amount_paid + $2 >= total_amount THEN 'paid'
             ELSE 'partially_paid'
           END,
           paid_at = CASE
             WHEN amount_paid + $2 >= total_amount THEN CURRENT_TIMESTAMP
             ELSE paid_at
           END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [invoiceId, amount]
    );
    await client.query("COMMIT");
    res.status(201).json({ item: payment.rows[0], receipt: receipt.rows[0] });
  } catch (error) {
    if (client) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("Payment recording rollback failed:", rollbackError);
      }
    }
    next(error);
  } finally {
    client?.release();
  }
});

router.post("/customers", async (req, res, next) => {
  const { name, email, password } = req.body ?? {};
  const phone = typeof req.body?.phone === "string" ? req.body.phone.trim() : "";
  const address = typeof req.body?.address === "string" ? req.body.address.trim() : "";
  const businessType =
    typeof req.body?.business_type === "string"
      ? req.body.business_type.trim()
      : "";
  if (
    typeof name !== "string" ||
    name.trim().length < 2 ||
    typeof email !== "string" ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
    typeof password !== "string" ||
    password.length < 9 ||
    !/[a-z]/.test(password) ||
    !/[A-Z]/.test(password) ||
    !/[^A-Za-z0-9]/.test(password)
  ) {
    return res.status(400).json({
      error: "Provide a name, valid email, and a password with more than 8 characters, uppercase, lowercase, and a special character.",
    });
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
    res.status(201).json({
      item: { ...customer.rows[0], email: user.rows[0].email },
    });
  } catch (error) {
    if (client) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("Customer creation rollback failed:", rollbackError);
      }
    }
    if (error.code === "23505") {
      return res.status(409).json({ error: "An account with this email already exists." });
    }
    next(error);
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
    next(error);
  }
});

router.patch("/:resource/:id", async (req, res, next) => {
  const { resource } = req.params;
  const id = String(req.params.id);
  if (!/^[1-9]\d*$/.test(id)) {
    return res.status(400).json({ error: "Invalid record ID." });
  }
  const body = req.body ?? {};

  try {
    let result;
    if (resource === "staff") {
      if (!["active", "inactive"].includes(body.status)) {
        return res.status(400).json({ error: "Select active or inactive status." });
      }
      result = await pool.query(
        `UPDATE users SET name = $2, email = $3, status = $4, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND role = 'staff'
         RETURNING id, name, email, role, status, created_at`,
        [id, body.name?.trim(), body.email?.trim().toLowerCase(), body.status]
      );
    } else if (resource === "customers") {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        result = await client.query(
          `UPDATE customers
           SET name = $2, phone = $3, address = $4, business_type = $5,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $1
           RETURNING id, user_id, name, phone, address, business_type, created_at`,
          [
            id,
            body.name?.trim(),
            body.phone || null,
            body.address || null,
            body.business_type || null,
          ]
        );
        if (result.rowCount) {
          await client.query(
            `UPDATE users
             SET name = $2, email = $3, updated_at = CURRENT_TIMESTAMP
             WHERE id = $1`,
            [
              result.rows[0].user_id,
              body.name?.trim(),
              body.email?.trim().toLowerCase(),
            ]
          );
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    } else if (resource === "taxes") {
      const rate = Number(body.rate);
      if (
        typeof body.name !== "string" ||
        !body.name.trim() ||
        !Number.isFinite(rate) ||
        rate < 0 ||
        rate > 100 ||
        !["active", "inactive"].includes(body.status)
      ) {
        return res.status(400).json({ error: "Provide a tax name, a rate between 0 and 100, and a valid status." });
      }
      const statusColumn = await getColumn("taxes", ["status", "is_active"], {
        required: false,
      });
      result = await updateMappedRow(
        "taxes",
        id,
        [
          [body.name?.trim(), ["name"]],
          [rate, ["rate_percent", "rate"]],
          [body.description || null, ["description", "notes"]],
          [statusColumn ? statusValue(statusColumn, body.status) : undefined, ["status", "is_active"]],
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
      if (result.rowCount) {
        result.rows[0].status = body.status;
      }
    } else if (resource === "products") {
      const salesPrice = Number(body.sales_price);
      const costPrice = Number(body.cost_price ?? 0);
      if (
        typeof body.name !== "string" ||
        !body.name.trim() ||
        typeof body.type !== "string" ||
        !body.type.trim() ||
        !Number.isFinite(salesPrice) ||
        salesPrice < 0 ||
        !Number.isFinite(costPrice) ||
        costPrice < 0 ||
        !["active", "inactive"].includes(body.status)
      ) {
        return res.status(400).json({ error: "Provide a product name, type, valid non-negative prices, and a valid status." });
      }
      const statusColumn = await getColumn("products", ["status", "is_active"], {
        required: false,
      });
      result = await updateMappedRow(
        "products",
        id,
        [
          [body.name?.trim(), ["name"]],
          [body.type?.trim(), ["product_type", "type"]],
          [salesPrice, ["sales_price", "price"]],
          [costPrice, ["cost_price"]],
          [body.tax_id || null, ["tax_id"]],
          [body.notes || null, ["notes", "description"]],
          [statusColumn ? statusValue(statusColumn, body.status) : undefined, ["status", "is_active"]],
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
      if (result.rowCount) {
        result.rows[0].status =
          statusColumn === "is_active"
            ? body.status
            : result.rows[0].status;
      }
    } else if (resource === "plans") {
      const price = Number(body.price);
      const minQuantity = Number(body.min_quantity);
      if (
        !Number.isFinite(price) ||
        price < 0 ||
        !Number.isInteger(minQuantity) ||
        minQuantity < 1 ||
        !["daily", "weekly", "monthly", "yearly"].includes(body.billing_period) ||
        !["active", "inactive"].includes(body.status) ||
        !body.available_from ||
        (body.available_to && body.available_to < body.available_from)
      ) {
        return res.status(400).json({ error: "Provide valid plan details and availability dates." });
      }
      const statusColumn = await getColumn("plans", ["status", "is_active"], {
        required: false,
      });
      result = await updateMappedRow(
        "plans",
        id,
        [
          [body.name?.trim(), ["name"]],
          [price, ["price"]],
          [body.billing_period, ["billing_period"]],
          [minQuantity, ["min_quantity"]],
          [body.available_from, ["available_from"]],
          [body.available_to || null, ["available_to"]],
          [body.auto_close_on_end === true, ["auto_close_on_end"]],
          [body.allow_early_close === true, ["allow_early_close"]],
          [body.allow_pause === true, ["allow_pause"]],
          [body.allow_renew === true, ["allow_renew"]],
          [statusColumn ? statusValue(statusColumn, body.status) : undefined, ["status", "is_active"]],
          [new Date(), ["updated_at", "updated_on"]],
        ],
        mappedResourceFields.plans
          .filter(([alias]) => alias !== "created_at")
          .concat([["status", ["status", "is_active"]], ["created_at", ["created_at", "created_on"]]])
      );
      if (result.rowCount) {
        result.rows[0].status = body.status;
      }
    } else if (resource === "discounts") {
      const value = Number(body.value ?? body.discount_value);
      const type = body.type ?? body.discount_type;
      if (
        !Number.isFinite(value) ||
        value <= 0 ||
        !["fixed", "percentage"].includes(type) ||
        (type === "percentage" && value > 100)
      ) {
        return res.status(400).json({ error: "Provide a valid discount type and value." });
      }
      result = await pool.query(
        `UPDATE discounts
         SET code = $2, name = $3, discount_type = $4, discount_value = $5,
             start_date = $6, end_date = $7, usage_limit = $8, status = $9,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1
         RETURNING id, code, name, discount_type AS type, discount_value AS value,
                   start_date, end_date, usage_limit, status`,
        [
          id,
          body.code?.trim().toUpperCase(),
          body.name?.trim() || body.code?.trim().toUpperCase(),
          type,
          value,
          body.start_date || null,
          body.end_date || null,
          body.usage_limit === "" || body.usage_limit == null
            ? null
            : Number(body.usage_limit),
          body.status,
        ]
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
            `SELECT id FROM plan_staff
             WHERE plan_id = $1 AND staff_id = $2`,
            [current.rows[0].plan_id, body.assigned_staff_id]
          );
          if (!staff.rowCount) {
            await client.query("ROLLBACK");
            return res.status(400).json({ error: "Assign this staff member to the plan first." });
          }
        }
        result = await client.query(
          `UPDATE subscriptions
           SET status = $2, start_date = $3, expiry_date = $4,
               assigned_staff_id = $5, payment_term_days = $6,
               next_billing_date = CASE
                 WHEN $2 = 'active' AND status <> 'active' THEN $3
                 ELSE next_billing_date
               END,
               confirmed_at = CASE
                 WHEN $2 IN ('confirmed', 'active') AND confirmed_at IS NULL
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
            [
              id,
              current.rows[0].status,
              status,
              req.user.id,
              body.note || "Updated by admin.",
            ]
          );
        }
        await client.query("COMMIT");
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch (rollbackError) {
          console.error("Subscription update rollback failed:", rollbackError);
        }
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
    if (error.code === "23505") {
      return res.status(409).json({ error: "A record with the same unique value already exists." });
    }
    if (error.code === "23503") {
      return res.status(409).json({ error: "This record is in use and cannot be changed." });
    }
    next(error);
  }
});

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
      const customer = await client.query(
        "DELETE FROM customers WHERE id = $1 RETURNING user_id",
        [id]
      );
      if (customer.rowCount) {
        await client.query("DELETE FROM users WHERE id = $1", [
          customer.rows[0].user_id,
        ]);
      }
      result = customer;
    } else if (resource === "staff") {
      result = await client.query(
        "DELETE FROM users WHERE id = $1 AND role = 'staff' RETURNING id",
        [id]
      );
    } else {
      result = await client.query(
        `DELETE FROM ${table} WHERE id = $1 RETURNING id`,
        [id]
      );
    }
    if (!result.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Record not found." });
    }
    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (error) {
    if (client) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("Admin delete rollback failed:", rollbackError);
      }
    }
    if (error.code === "23503") {
      return res.status(409).json({
        error: "This record is connected to existing subscriptions or transactions and cannot be deleted.",
      });
    }
    next(error);
  } finally {
    client?.release();
  }
});

router.get("/plans/:planId/staff", async (req, res, next) => {
  try {
    const planId = Number(req.params.planId);
    if (!Number.isSafeInteger(planId) || planId < 1) {
      return res.status(400).json({ error: "Invalid plan ID." });
    }

    const plan = await pool.query("SELECT id FROM plans WHERE id = $1", [planId]);
    if (plan.rowCount === 0) {
      return res.status(404).json({ error: "Plan not found." });
    }

    const { rows } = await pool.query(
      `SELECT u.id, u.name, u.email, u.status,
              (ps.staff_id IS NOT NULL) AS assigned
       FROM users u
       LEFT JOIN plan_staff ps
         ON ps.staff_id = u.id AND ps.plan_id = $1
       WHERE u.role = 'staff'
       ORDER BY u.name, u.id`,
      [planId]
    );
    res.json({ staff: rows });
  } catch (error) {
    next(error);
  }
});

router.get("/products/:productId/staff", async (req, res, next) => {
  try {
    const productId = Number(req.params.productId);
    if (!Number.isSafeInteger(productId) || productId < 1) {
      return res.status(400).json({ error: "Invalid product ID." });
    }

    const product = await pool.query("SELECT id FROM products WHERE id = $1", [productId]);
    if (!product.rowCount) {
      return res.status(404).json({ error: "Product not found." });
    }
    const { rows } = await pool.query(
      `SELECT u.id, u.name, u.email, u.status,
              (ps.staff_id IS NOT NULL) AS assigned
       FROM users u
       LEFT JOIN product_staff ps
         ON ps.staff_id = u.id AND ps.product_id = $1
       WHERE u.role = 'staff'
       ORDER BY u.name, u.id`,
      [productId]
    );
    res.json({ staff: rows });
  } catch (error) {
    next(error);
  }
});

router.put("/products/:productId/staff", async (req, res, next) => {
  const productId = Number(req.params.productId);
  const staffIds = req.body?.staffIds;
  if (!Number.isSafeInteger(productId) || productId < 1) {
    return res.status(400).json({ error: "Invalid product ID." });
  }
  if (
    !Array.isArray(staffIds) ||
    staffIds.some(
      (id) =>
        !(typeof id === "number" && Number.isSafeInteger(id) && id > 0) &&
        !(typeof id === "string" && /^[1-9]\d*$/.test(id))
    )
  ) {
    return res.status(400).json({ error: "staffIds must be an array of valid staff IDs." });
  }
  const normalizedIds = [...new Set(staffIds.map(String))];

  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    const product = await client.query(
      "SELECT id FROM products WHERE id = $1 FOR UPDATE",
      [productId]
    );
    if (!product.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Product not found." });
    }
    if (normalizedIds.length) {
      const staff = await client.query(
        `SELECT id FROM users
         WHERE role = 'staff' AND id = ANY($1::bigint[])`,
        [normalizedIds]
      );
      if (staff.rowCount !== normalizedIds.length) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Select only existing staff accounts." });
      }
    }
    await client.query("DELETE FROM product_staff WHERE product_id = $1", [productId]);
    if (normalizedIds.length) {
      const assignmentColumns = await getTableColumns("product_staff");
      const hasAssignedBy = assignmentColumns.has("assigned_by");
      await client.query(
        `INSERT INTO product_staff (
           product_id, staff_id${hasAssignedBy ? ", assigned_by" : ""}
         )
         SELECT $1, selected.staff_id${hasAssignedBy ? ", $3" : ""}
         FROM unnest($2::bigint[]) AS selected(staff_id)`,
        hasAssignedBy ? [productId, normalizedIds, req.user.id] : [productId, normalizedIds]
      );
    }
    await client.query("COMMIT");
    res.json({ ok: true, assignedStaffCount: normalizedIds.length });
  } catch (error) {
    if (client) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("Product staff assignment rollback failed:", rollbackError);
      }
    }
    next(error);
  } finally {
    client?.release();
  }
});

router.put("/plans/:planId/staff", async (req, res, next) => {
  const planId = Number(req.params.planId);
  const staffIds = req.body?.staffIds;
  if (!Number.isSafeInteger(planId) || planId < 1) {
    return res.status(400).json({ error: "Invalid plan ID." });
  }
  if (
    !Array.isArray(staffIds) ||
    staffIds.some(
      (id) =>
        !(typeof id === "number" && Number.isSafeInteger(id) && id > 0) &&
        !(typeof id === "string" && /^[1-9]\d*$/.test(id))
    )
  ) {
    return res.status(400).json({ error: "staffIds must be an array of valid staff IDs." });
  }

  const normalizedIds = [...new Set(staffIds.map(String))];

  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN");

    const plan = await client.query(
      "SELECT id FROM plans WHERE id = $1 FOR UPDATE",
      [planId]
    );
    if (plan.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Plan not found." });
    }

    if (normalizedIds.length) {
      const staff = await client.query(
        `SELECT id
         FROM users
         WHERE role = 'staff' AND id = ANY($1::bigint[])`,
        [normalizedIds]
      );
      if (staff.rowCount !== normalizedIds.length) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Select only existing staff accounts." });
      }
    }

    await client.query("DELETE FROM plan_staff WHERE plan_id = $1", [planId]);
    if (normalizedIds.length) {
      const assignmentColumns = await getTableColumns("plan_staff");
      const hasAssignedBy = assignmentColumns.has("assigned_by");
      await client.query(
        `INSERT INTO plan_staff (
           plan_id, staff_id${hasAssignedBy ? ", assigned_by" : ""}
         )
         SELECT $1, selected.staff_id${hasAssignedBy ? ", $3" : ""}
         FROM unnest($2::bigint[]) AS selected(staff_id)`,
        hasAssignedBy ? [planId, normalizedIds, req.user.id] : [planId, normalizedIds]
      );
    }

    await client.query("COMMIT");
    res.json({ ok: true, assignedStaffCount: normalizedIds.length });
  } catch (error) {
    if (client) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("Plan staff assignment rollback failed:", rollbackError);
      }
    }
    next(error);
  } finally {
    client?.release();
  }
});

router.get("/:resource", async (req, res, next) => {
  try {
    const config = resources[req.params.resource];
    if (!config) {
      return res.status(404).json({ error: "Admin resource not found." });
    }

    if (mappedResourceFields[req.params.resource]) {
      const { text, values } = await getMappedResourceQuery(
        req.params.resource,
        String(req.query.search || "").trim()
      );
      const { rows } = await pool.query(text, values);
      return res.json({ items: rows });
    }

    const values = [];
    const conditions = [];
    if (config.extraWhere) conditions.push(config.extraWhere);

    const search = String(req.query.search || "").trim();
    if (search) {
      values.push(`%${search}%`);
      conditions.push(
        `(${config.searchColumns
          .map((column) => `${column}::text ILIKE $${values.length}`)
          .join(" OR ")})`
      );
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const { rows } = await pool.query(
      `SELECT ${config.columns} FROM ${config.table} ${where} ORDER BY id DESC LIMIT 100`,
      values
    );
    res.json({ items: rows });
  } catch (error) {
    next(error);
  }
});

router.post("/:resource", async (req, res, next) => {
  try {
    const { resource } = req.params;
    const body = req.body ?? {};
    let result;

    if (resource === "quotations" || resource === "subscriptions") {
      const customerId = String(body.customer_id ?? "");
      const planId = String(body.plan_id ?? "");
      const status =
        resource === "quotations" ? "quotation" : body.status || "draft";
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
        const [planStatus, planAvailableFrom, planAvailableTo] =
          await Promise.all([
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
        if (planAvailableFrom) {
          planConditions.push(`${quoteColumn(planAvailableFrom)} <= CURRENT_DATE`);
        }
        if (planAvailableTo) {
          planConditions.push(
            `(${quoteColumn(planAvailableTo)} IS NULL OR ${quoteColumn(planAvailableTo)} >= CURRENT_DATE)`
          );
        }
        const planResult = await client.query(
          `SELECT id, name, price, min_quantity
           FROM plans
           WHERE ${planConditions.join(" AND ")}`,
          [planId]
        );
        if (!planResult.rowCount) {
          await client.query("ROLLBACK");
          return res.status(400).json({ error: "The selected plan is unavailable." });
        }
        const customer = await client.query(
          "SELECT id FROM customers WHERE id = $1",
          [customerId]
        );
        if (!customer.rowCount) {
          await client.query("ROLLBACK");
          return res.status(400).json({ error: "The selected customer does not exist." });
        }
        const plan = planResult.rows[0];
        const amount = (
          Number(plan.price) * Number(plan.min_quantity)
        ).toFixed(2);
        const assignedStaffId = body.assigned_staff_id
          ? String(body.assigned_staff_id)
          : null;
        if (assignedStaffId) {
          const staff = await client.query(
            `SELECT u.id
             FROM users u
             JOIN plan_staff ps ON ps.staff_id = u.id
             WHERE u.id = $1 AND u.role = 'staff' AND ps.plan_id = $2`,
            [assignedStaffId, planId]
          );
          if (!staff.rowCount) {
            await client.query("ROLLBACK");
            return res.status(400).json({ error: "Assign this staff member to the plan before assigning them to a subscription." });
          }
        }
        const subscription = await client.query(
          `INSERT INTO subscriptions (
             customer_id, plan_id, assigned_staff_id, source, status, start_date,
             expiry_date, confirmed_at, payment_term_days, next_billing_date,
             subtotal, tax_amount, total_amount
           )
           VALUES ($1, $2, $3, 'admin', $4, $5, $6, $7, $8, $9, $10, 0, $10)
           RETURNING id, subscription_number, customer_id, plan_id,
                     assigned_staff_id, status, start_date, expiry_date,
                     next_billing_date, payment_term_days, total_amount, created_at`,
          [
            customerId,
            planId,
            assignedStaffId,
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
        try {
          await client.query("ROLLBACK");
        } catch (rollbackError) {
          console.error("Subscription creation rollback failed:", rollbackError);
        }
        throw error;
      } finally {
        client.release();
      }
    } else if (resource === "invoices") {
      return res.status(400).json({
        error: "Generate an invoice from a confirmed or active subscription.",
      });
    } else if (resource === "staff") {
      const { name, email, password } = body;
      const status = body.status || "active";
      if (
        typeof name !== "string" ||
        name.trim().length < 2 ||
        typeof email !== "string" ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
        typeof password !== "string" ||
        password.length < 9 ||
        !/[a-z]/.test(password) ||
        !/[A-Z]/.test(password) ||
        !/[^A-Za-z0-9]/.test(password) ||
        !["active", "inactive"].includes(status)
      ) {
        return res.status(400).json({
          error: "Provide a name, valid email, and a password with more than 8 characters, uppercase, lowercase, and a special character.",
        });
      }

      const passwordHash = await bcrypt.hash(password, 12);
      result = await pool.query(
        `INSERT INTO users (name, email, password_hash, role, status)
         VALUES ($1, $2, $3, 'staff', $4)
         RETURNING id, name, email, role, status, created_at`,
        [name.trim(), email.trim().toLowerCase(), passwordHash, status]
      );
    } else if (resource === "taxes") {
      const rate = Number(body.rate);
      if (
        typeof body.name !== "string" ||
        !body.name.trim() ||
        !Number.isFinite(rate) ||
        rate < 0 ||
        rate > 100 ||
        !["active", "inactive"].includes(body.status || "active")
      ) {
        return res.status(400).json({ error: "Provide a tax name, a rate between 0 and 100, and a valid status." });
      }
      const status = body.status || "active";
      if (!["active", "inactive"].includes(status)) {
        return res.status(400).json({ error: "Select active or inactive tax status." });
      }
      const statusColumn = await getColumn("taxes", ["status", "is_active"], {
        required: false,
      });
      result = await insertMappedRow(
        "taxes",
        [
          [body.name.trim(), ["name"], true],
          [rate, ["rate_percent", "rate"], true],
          [body.description || null, ["description", "notes"]],
          [statusColumn ? statusValue(statusColumn, status) : undefined, ["status", "is_active"]],
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
      if (
        typeof body.name !== "string" ||
        !body.name.trim() ||
        typeof body.type !== "string" ||
        !body.type.trim() ||
        !Number.isFinite(salesPrice) ||
        salesPrice < 0 ||
        !Number.isFinite(costPrice) ||
        costPrice < 0 ||
        !["active", "inactive"].includes(body.status || "active")
      ) {
        return res.status(400).json({ error: "Provide a product name, type, valid non-negative prices, and a valid status." });
      }
      const status = body.status || "active";
      if (!["active", "inactive"].includes(status)) {
        return res.status(400).json({ error: "Select active or inactive product status." });
      }
      const statusColumn = await getColumn("products", ["status", "is_active"], {
        required: false,
      });
      result = await insertMappedRow(
        "products",
        [
          [body.name.trim(), ["name"], true],
          [body.type.trim(), ["product_type", "type"], true],
          [salesPrice, ["sales_price", "price"], true],
          [costPrice, ["cost_price"]],
          [body.tax_id || null, ["tax_id"]],
          [body.notes || null, ["notes", "description"]],
          [statusColumn ? statusValue(statusColumn, status) : undefined, ["status", "is_active"]],
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
      const validDate = (value) => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
        const parsed = new Date(`${value}T00:00:00.000Z`);
        return (
          !Number.isNaN(parsed.getTime()) &&
          parsed.toISOString().slice(0, 10) === value
        );
      };
      const flags = [
        "auto_close_on_end",
        "allow_early_close",
        "allow_pause",
        "allow_renew",
      ];
      if (
        typeof body.name !== "string" ||
        !body.name.trim() ||
        !Number.isFinite(price) ||
        price < 0 ||
        !["daily", "weekly", "monthly", "yearly"].includes(body.billing_period) ||
        !Number.isInteger(minQuantity) ||
        minQuantity < 1 ||
        !validDate(availableFrom) ||
        (availableTo !== null && !validDate(availableTo)) ||
        (availableTo !== null && availableTo < availableFrom) ||
        flags.some((flag) => body[flag] !== undefined && typeof body[flag] !== "boolean") ||
        !["active", "inactive"].includes(body.status || "active")
      ) {
        return res.status(400).json({
          error: "Provide a plan name, non-negative price, valid billing period, positive minimum quantity, and valid availability dates.",
        });
      }
      const status = body.status || "active";
      const statusColumn = await getColumn("plans", ["status", "is_active"], {
        required: false,
      });
      result = await insertMappedRow(
        "plans",
        [
          [body.name.trim(), ["name"], true],
          [price, ["price"], true],
          [body.billing_period, ["billing_period"], true],
          [minQuantity, ["min_quantity"]],
          [availableFrom, ["available_from"]],
          [availableTo, ["available_to"]],
          [body.auto_close_on_end ?? false, ["auto_close_on_end"]],
          [body.allow_early_close ?? false, ["allow_early_close"]],
          [body.allow_pause ?? false, ["allow_pause"]],
          [body.allow_renew ?? true, ["allow_renew"]],
          [statusColumn ? statusValue(statusColumn, status) : undefined, ["status", "is_active"]],
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
      const value = Number(body.value ?? body.discount_value);
      const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
      const name = typeof body.name === "string" ? body.name.trim() : code;
      if (
        !code ||
        !name ||
        !["fixed", "percentage"].includes(type) ||
        !Number.isFinite(value) ||
        value <= 0 ||
        (type === "percentage" && value > 100)
      ) {
        return res.status(400).json({ error: "Provide a code, name, valid discount type, and positive value (percentage discounts cannot exceed 100)." });
      }
      const usageLimit =
        body.usage_limit === "" || body.usage_limit == null
          ? null
          : Number(body.usage_limit);
      if (usageLimit !== null && (!Number.isInteger(usageLimit) || usageLimit < 0)) {
        return res.status(400).json({ error: "Usage limit must be a non-negative whole number." });
      }
      result = await pool.query(
        `INSERT INTO discounts
           (code, name, discount_type, discount_value, start_date, end_date, usage_limit, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, code, name, discount_type AS type, discount_value AS value,
                   start_date, end_date, usage_limit, status`,
        [
          code,
          name,
          type,
          value,
          body.start_date || null,
          body.end_date || null,
          usageLimit,
          body.status || "active",
        ]
      );
    } else {
      return res.status(405).json({
        error: "This resource must be created through its business workflow.",
      });
    }

    res.status(201).json({ item: result.rows[0] });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "A record with the same unique value already exists." });
    }
    next(error);
  }
});

export default router;
