import { pool } from '../../db.js';
import { withTransaction } from '../../utils/tx.js';
import {
  AppError, paging, paged, round2, toId, needDate, optDate,
} from '../../utils/http.js';
import { scopedFilters, getScopedSubscription } from '../../utils/staffScope.js';

// ---------- helpers ----------
async function logStatus(db, subId, from, to, userId, note = null) {
  await db.query(
    `INSERT INTO subscription_status_history (subscription_id, from_status, to_status, changed_by, note)
     VALUES ($1,$2,$3,$4,$5)`,
    [subId, from, to, userId, note]
  );
}

async function getAvailablePlan(db, planId) {
  const { rows } = await db.query(
    `SELECT * FROM plans
      WHERE id = $1 AND status = 'active'
        AND available_from <= CURRENT_DATE
        AND (available_to IS NULL OR available_to >= CURRENT_DATE)`,
    [planId]
  );
  if (!rows[0]) throw new AppError(400, 'Plan is not available');
  return rows[0];
}

// Copies prices and tax rates onto the lines so later price changes never touch old documents.
async function buildLines(db, user, plan, lines) {
  if (!Array.isArray(lines) || !lines.length) throw new AppError(400, 'At least one line is required');

  const clean = lines.map((l) => {
    const quantity = Number(l.quantity);
    if (!Number.isInteger(quantity) || quantity <= 0) throw new AppError(400, 'Quantity must be a whole number above 0');
    return {
      product_id: toId(l.product_id, 'product_id'),
      variant_id: l.variant_id ? toId(l.variant_id, 'variant_id') : null,
      quantity,
    };
  });

  const productIds = [...new Set(clean.map((l) => l.product_id))];
  const { rows: products } = await db.query(
    `SELECT p.id, p.name, p.sales_price, p.status, COALESCE(t.rate_percent, 0) AS rate
       FROM products p LEFT JOIN taxes t ON t.id = p.tax_id
      WHERE p.id = ANY($1::bigint[])`,
    [productIds]
  );
  const pmap = new Map(products.map((p) => [String(p.id), p]));
  for (const id of productIds) {
    const p = pmap.get(String(id));
    if (!p || p.status !== 'active') throw new AppError(400, `Product ${id} is not available`);
  }

  // Staff may only quote products assigned to them
  if (user.role === 'staff') {
    const { rows } = await db.query(
      'SELECT product_id FROM product_staff WHERE staff_id = $1 AND product_id = ANY($2::bigint[])',
      [user.id, productIds]
    );
    if (rows.length !== productIds.length) throw new AppError(403, 'You can only quote products assigned to you');
  }

  const variantIds = clean.filter((l) => l.variant_id).map((l) => l.variant_id);
  let vmap = new Map();
  if (variantIds.length) {
    const { rows } = await db.query(
      'SELECT id, product_id, extra_price FROM product_variants WHERE id = ANY($1::bigint[])',
      [variantIds]
    );
    vmap = new Map(rows.map((v) => [String(v.id), v]));
  }

  let untaxed = 0, tax = 0, totalQty = 0;
  const built = clean.map((l) => {
    const p = pmap.get(String(l.product_id));
    let extra = 0;
    if (l.variant_id) {
      const v = vmap.get(String(l.variant_id));
      if (!v || String(v.product_id) !== String(l.product_id)) throw new AppError(400, 'Variant does not belong to the product');
      extra = Number(v.extra_price);
    }
    const unit_price = round2(Number(p.sales_price) + extra);
    const amount = round2(l.quantity * unit_price);
    const rate = Number(p.rate);
    untaxed += amount;
    tax += round2((amount * rate) / 100);
    totalQty += l.quantity;
    return { ...l, unit_price, tax_rate_percent: rate, amount };
  });

  if (totalQty < plan.min_quantity) throw new AppError(400, `Plan needs a minimum quantity of ${plan.min_quantity}`);
  untaxed = round2(untaxed);
  tax = round2(tax);
  return { lines: built, untaxed, tax, total: round2(untaxed + tax) };
}

async function insertLines(db, subId, built) {
  for (const l of built.lines) {
    await db.query(
      `INSERT INTO subscription_lines
         (subscription_id, product_id, variant_id, quantity, unit_price, tax_rate_percent, amount)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [subId, l.product_id, l.variant_id, l.quantity, l.unit_price, l.tax_rate_percent, l.amount]
    );
  }
}

// ---------- reads ----------
export async function listSubscriptions(user, q = {}) {
  const { page, limit, offset } = paging(q);
  const { params, f } = scopedFilters(user, 's');
  if (q.status) f.add('s.status = ?', q.status);
  if (q.source) f.add('s.source = ?', q.source);
  if (q.customer_id) f.add('s.customer_id = ?', toId(q.customer_id, 'customer_id'));
  if (q.plan_id) f.add('s.plan_id = ?', toId(q.plan_id, 'plan_id'));
  if (q.search) f.add('(s.subscription_number ILIKE ? OR c.name ILIKE ?)', `%${q.search}%`);
  // renewals due: active subscriptions expiring within N days, soonest first
  const days = Math.min(Math.max(parseInt(q.expiring_days, 10) || 0, 0), 365);
  if (days) f.add(`(s.status = 'active' AND s.expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE + ?::int)`, days);
  const order = days ? 's.expiry_date ASC' : 's.created_at DESC';
  params.push(limit, offset);

  const { rows } = await pool.query(
    `SELECT s.id, s.subscription_number, s.status, s.source, s.start_date, s.expiry_date,
            s.next_billing_date, s.is_paused, s.total_amount, s.quotation_valid_until, s.created_at,
            c.id AS customer_id, c.name AS customer_name,
            pl.name AS plan_name, pl.billing_period,
            COUNT(*) OVER() AS total_count
       FROM subscriptions s
       JOIN customers c ON c.id = s.customer_id
       JOIN plans pl ON pl.id = s.plan_id
      WHERE ${f.where.join(' AND ')}
      ORDER BY ${order}
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return paged(rows, page, limit);
}

export async function getSubscription(user, id) {
  const sub = await getScopedSubscription(pool, user, id);
  const [lines, history, customer, invoices] = await Promise.all([
    pool.query(
      `SELECT sl.*, p.name AS product_name, v.attribute, v.value AS variant_value
         FROM subscription_lines sl
         JOIN products p ON p.id = sl.product_id
         LEFT JOIN product_variants v ON v.id = sl.variant_id
        WHERE sl.subscription_id = $1 ORDER BY sl.id`, [id]),
    pool.query(
      `SELECT h.*, u.name AS changed_by_name FROM subscription_status_history h
         LEFT JOIN users u ON u.id = h.changed_by
        WHERE h.subscription_id = $1 ORDER BY h.changed_at`, [id]),
    pool.query(
      `SELECT c.id, c.name, c.phone, c.address, c.business_type, u.email
         FROM customers c JOIN users u ON u.id = c.user_id WHERE c.id = $1`, [sub.customer_id]),
    pool.query(
      `SELECT id, invoice_number, status, due_date, total_amount, amount_paid
         FROM invoices WHERE subscription_id = $1 ORDER BY period_start DESC`, [id]),
  ]);
  return { ...sub, customer: customer.rows[0], lines: lines.rows, history: history.rows, invoices: invoices.rows };
}

// ---------- create / edit quote ----------
export async function createQuotation(user, body) {
  return withTransaction(async (c) => {
    const customerId = toId(body.customer_id, 'customer_id');
    const { rows: cust } = await c.query('SELECT id FROM customers WHERE id = $1', [customerId]);
    if (!cust[0]) throw new AppError(404, 'Customer not found');

    let planId = body.plan_id;
    let lines = body.lines;
    let templateId = null;

    if (body.template_id) {
      templateId = toId(body.template_id, 'template_id');
      const { rows: t } = await c.query(
        'SELECT plan_id FROM quotation_templates WHERE id = $1 AND is_active', [templateId]);
      if (!t[0]) throw new AppError(404, 'Template not found');
      planId = planId || t[0].plan_id;
      if (!lines?.length) {
        const { rows } = await c.query(
          'SELECT product_id, variant_id, quantity FROM quotation_template_lines WHERE template_id = $1', [templateId]);
        lines = rows;
      }
    }

    const plan = await getAvailablePlan(c, toId(planId, 'plan_id'));
    const built = await buildLines(c, user, plan, lines);

    const { rows } = await c.query(
      `INSERT INTO subscriptions
         (customer_id, plan_id, template_id, assigned_staff_id, created_by, source, status,
          start_date, expiry_date, payment_terms, payment_term_days, notes,
          untaxed_amount, tax_amount, total_amount)
       VALUES ($1,$2,$3,$4,$5,'staff','draft',$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING id`,
      [customerId, plan.id, templateId, user.role === 'staff' ? user.id : null, user.id,
       optDate(body.start_date, 'start_date'), optDate(body.expiry_date, 'expiry_date'),
       body.payment_terms || 'Immediate', Number(body.payment_term_days) || 0, body.notes || null,
       built.untaxed, built.tax, built.total]
    );
    await insertLines(c, rows[0].id, built);
    await logStatus(c, rows[0].id, null, 'draft', user.id, 'Quotation created');
    return { id: rows[0].id };
  });
}

// Edit a draft only
export async function updateDraft(user, id, body) {
  return withTransaction(async (c) => {
    const sub = await getScopedSubscription(c, user, id, { lock: true });
    if (sub.status !== 'draft') throw new AppError(409, 'Only draft quotations can be edited');

    const plan = await getAvailablePlan(c, body.plan_id ? toId(body.plan_id, 'plan_id') : sub.plan_id);
    let totals = { untaxed: sub.untaxed_amount, tax: sub.tax_amount, total: sub.total_amount };

    if (body.lines) {
      const built = await buildLines(c, user, plan, body.lines);
      await c.query('DELETE FROM subscription_lines WHERE subscription_id = $1', [id]);
      await insertLines(c, id, built);
      totals = built;
    }
    await c.query(
      `UPDATE subscriptions SET plan_id=$2, start_date=COALESCE($3,start_date), expiry_date=COALESCE($4,expiry_date),
              payment_terms=COALESCE($5,payment_terms), payment_term_days=COALESCE($6,payment_term_days),
              notes=COALESCE($7,notes), untaxed_amount=$8, tax_amount=$9, total_amount=$10
        WHERE id=$1`,
      [id, plan.id, optDate(body.start_date, 'start_date'), optDate(body.expiry_date, 'expiry_date'),
       body.payment_terms ?? null, body.payment_term_days ?? null, body.notes ?? null,
       totals.untaxed, totals.tax, totals.total]
    );
    return { id };
  });
}

// draft -> quotation (sent to the customer)
export async function sendQuote(user, id, body = {}) {
  return withTransaction(async (c) => {
    const sub = await getScopedSubscription(c, user, id, { lock: true });
    if (sub.status !== 'draft') throw new AppError(409, 'Only draft quotations can be sent');
    let days = Number(body.validity_days);
    if (!days && sub.template_id) {
      const { rows } = await c.query('SELECT validity_days FROM quotation_templates WHERE id=$1', [sub.template_id]);
      days = rows[0]?.validity_days;
    }
    days = days > 0 ? Math.floor(days) : 30;
    await c.query(
      `UPDATE subscriptions SET status='quotation', quotation_valid_until = CURRENT_DATE + $2::int WHERE id=$1`,
      [id, days]);
    await logStatus(c, id, 'draft', 'quotation', user.id, `Quotation sent, valid ${days} days`);
    return { id, status: 'quotation' };
  });
}

// ---------- quotation review ----------
// A confirmed subscription must have start AND expiry dates (DB CHECK), so staff supply them here.
export async function acceptQuotation(user, id, body) {
  const start = needDate(body.start_date, 'start_date');
  const expiry = needDate(body.expiry_date, 'expiry_date');
  if (expiry < start) throw new AppError(400, 'expiry_date must be on or after start_date');

  return withTransaction(async (c) => {
    const sub = await getScopedSubscription(c, user, id, { lock: true });
    if (sub.status !== 'quotation') throw new AppError(409, 'Only quotations can be accepted');
    if (sub.quotation_valid_until && new Date(sub.quotation_valid_until) < new Date(new Date().toDateString())) {
      throw new AppError(409, 'This quotation has expired');
    }
    await c.query(
      `UPDATE subscriptions
          SET status='confirmed', start_date=$2, expiry_date=$3, confirmed_at=CURRENT_TIMESTAMP,
              assigned_staff_id = CASE WHEN $4 = 'staff' THEN $5::bigint ELSE assigned_staff_id END,
              payment_terms = COALESCE($6, payment_terms),
              payment_term_days = COALESCE($7, payment_term_days)
        WHERE id=$1`,
      [id, start, expiry, user.role, user.id, body.payment_terms ?? null, body.payment_term_days ?? null]
    );
    await logStatus(c, id, 'quotation', 'confirmed', user.id, body.note || 'Quotation accepted');
    return { id, status: 'confirmed' };
  });
}

// There is no 'rejected' status in the schema, so a rejection closes the request with a reason.
export async function rejectQuotation(user, id, body) {
  const reason = (body.reason || '').trim();
  if (!reason) throw new AppError(400, 'A reason is required');
  return withTransaction(async (c) => {
    const sub = await getScopedSubscription(c, user, id, { lock: true });
    if (sub.status !== 'quotation') throw new AppError(409, 'Only quotations can be rejected');
    await c.query(
      `UPDATE subscriptions SET status='closed', closed_at=CURRENT_TIMESTAMP, close_reason=$2 WHERE id=$1`,
      [id, `Rejected: ${reason}`]);
    await logStatus(c, id, 'quotation', 'closed', user.id, `Rejected: ${reason}`);
    return { id, status: 'closed' };
  });
}

// ---------- lifecycle ----------
export async function activate(user, id, body = {}) {
  return withTransaction(async (c) => {
    const sub = await getScopedSubscription(c, user, id, { lock: true });
    if (sub.status !== 'confirmed') throw new AppError(409, 'Only confirmed subscriptions can be activated');
    const start = body.start_date ? needDate(body.start_date, 'start_date') : sub.start_date;
    const expiry = body.expiry_date ? needDate(body.expiry_date, 'expiry_date') : sub.expiry_date;
    if (!start || !expiry) throw new AppError(400, 'Start and expiry dates are required');
    await c.query(
      `UPDATE subscriptions
          SET status='active', start_date=$2, expiry_date=$3, next_billing_date=$2,
              activated_at=CURRENT_TIMESTAMP,
              assigned_staff_id = COALESCE(assigned_staff_id, CASE WHEN $4='staff' THEN $5::bigint END)
        WHERE id=$1`,
      [id, start, expiry, user.role, user.id]
    );
    await logStatus(c, id, 'confirmed', 'active', user.id, 'Subscription activated');
    return { id, status: 'active', next_billing_date: start };
  });
}

export async function setPaused(user, id, paused) {
  return withTransaction(async (c) => {
    const sub = await getScopedSubscription(c, user, id, { lock: true });
    if (sub.status !== 'active') throw new AppError(409, 'Only active subscriptions can be paused or resumed');
    if (paused && !sub.allow_pause && user.role !== 'admin') throw new AppError(403, 'This plan does not allow pausing');
    if (sub.is_paused === paused) throw new AppError(409, paused ? 'Already paused' : 'Not paused');
    await c.query('UPDATE subscriptions SET is_paused=$2 WHERE id=$1', [id, paused]);
    await logStatus(c, id, 'active', 'active', user.id, paused ? 'Paused' : 'Resumed');
    return { id, is_paused: paused };
  });
}

export async function closeSubscription(user, id, body) {
  const reason = (body.reason || '').trim();
  if (!reason) throw new AppError(400, 'A reason is required');
  return withTransaction(async (c) => {
    const sub = await getScopedSubscription(c, user, id, { lock: true });
    if (!['confirmed', 'active'].includes(sub.status)) throw new AppError(409, 'This subscription cannot be closed');
    if (sub.status === 'active' && !sub.allow_early_close && user.role !== 'admin') {
      throw new AppError(403, 'This plan does not allow early close');
    }
    await c.query(
      `UPDATE subscriptions SET status='closed', closed_at=CURRENT_TIMESTAMP, close_reason=$2 WHERE id=$1`,
      [id, reason]);
    await logStatus(c, id, sub.status, 'closed', user.id, reason);
    return { id, status: 'closed' };
  });
}

// Renew = extend the expiry date of an active subscription (needs plan.allow_renew)
export async function renew(user, id, body) {
  const newExpiry = needDate(body.new_expiry_date, 'new_expiry_date');
  return withTransaction(async (c) => {
    const sub = await getScopedSubscription(c, user, id, { lock: true });
    if (sub.status !== 'active') throw new AppError(409, 'Only active subscriptions can be renewed');
    if (!sub.allow_renew && user.role !== 'admin') throw new AppError(403, 'This plan does not allow renewal');
    if (new Date(newExpiry) <= new Date(sub.expiry_date)) throw new AppError(400, 'New expiry must be after the current expiry');
    await c.query('UPDATE subscriptions SET expiry_date=$2 WHERE id=$1', [id, newExpiry]);
    await logStatus(c, id, 'active', 'active', user.id, `Renewed until ${newExpiry}`);
    return { id, expiry_date: newExpiry };
  });
}