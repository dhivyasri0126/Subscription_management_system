import { pool } from '../../db.js';
import { withTransaction } from '../../utils/tx.js';
import { AppError, paging, paged, toId, optDate } from '../../utils/http.js';
import { scopedFilters, subscriptionScope } from '../../utils/staffScope.js';

// Loads an invoice the user may touch and row-locks it (used by confirm/cancel/send/payments).
export async function lockInvoice(db, user, id) {
  const params = [id];
  const scope = subscriptionScope(user, 's', params);
  const { rows } = await db.query(
    `SELECT i.* FROM invoices i JOIN subscriptions s ON s.id = i.subscription_id
      WHERE i.id = $1 AND ${scope} FOR UPDATE OF i`,
    params
  );
  if (!rows[0]) throw new AppError(404, 'Invoice not found');
  return rows[0];
}

export async function listInvoices(user, q = {}) {
  const { page, limit, offset } = paging(q);
  const { params, f } = scopedFilters(user, 's');
  if (q.status) f.add('i.status = ?', q.status);
  if (q.customer_id) f.add('i.customer_id = ?', toId(q.customer_id, 'customer_id'));
  if (q.subscription_id) f.add('i.subscription_id = ?', toId(q.subscription_id, 'subscription_id'));
  if (q.due_from) f.add('i.due_date >= ?', optDate(q.due_from, 'due_from'));
  if (q.due_to) f.add('i.due_date <= ?', optDate(q.due_to, 'due_to'));
  if (q.overdue === 'true') {
    f.where.push(`(i.status = 'confirmed' AND i.due_date < CURRENT_DATE AND i.amount_paid < i.total_amount)`);
  }
  if (q.search) f.add('(i.invoice_number ILIKE ? OR c.name ILIKE ?)', `%${q.search}%`);
  params.push(limit, offset);

  const { rows } = await pool.query(
    `SELECT i.id, i.invoice_number, i.status, i.invoice_date, i.due_date, i.total_amount, i.amount_paid,
            (i.total_amount - i.amount_paid) AS balance_due, i.sent_at,
            s.id AS subscription_id, s.subscription_number,
            c.id AS customer_id, c.name AS customer_name,
            (i.status = 'confirmed' AND i.due_date < CURRENT_DATE AND i.amount_paid < i.total_amount) AS is_overdue,
            COUNT(*) OVER() AS total_count
       FROM invoices i
       JOIN subscriptions s ON s.id = i.subscription_id
       JOIN customers c ON c.id = i.customer_id
      WHERE ${f.where.join(' AND ')}
      ORDER BY i.invoice_date DESC, i.id DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return paged(rows, page, limit);
}

export async function getInvoice(user, id) {
  const params = [id];
  const scope = subscriptionScope(user, 's', params);
  const { rows } = await pool.query(
    `SELECT i.*, (i.total_amount - i.amount_paid) AS balance_due,
            s.subscription_number, c.name AS customer_name, c.phone AS customer_phone,
            c.address AS customer_address, u.email AS customer_email
       FROM invoices i
       JOIN subscriptions s ON s.id = i.subscription_id
       JOIN customers c ON c.id = i.customer_id
       JOIN users u ON u.id = c.user_id
      WHERE i.id = $1 AND ${scope}`,
    params
  );
  if (!rows[0]) throw new AppError(404, 'Invoice not found');

  const [lines, discounts, payments] = await Promise.all([
    pool.query('SELECT * FROM invoice_lines WHERE invoice_id = $1 ORDER BY id', [id]),
    pool.query(
      `SELECT d.name, du.amount FROM discount_usages du JOIN discounts d ON d.id = du.discount_id
        WHERE du.invoice_id = $1`, [id]),
    pool.query(
      `SELECT p.*, r.id AS receipt_id, r.receipt_number FROM payments p
         LEFT JOIN receipts r ON r.payment_id = p.id
        WHERE p.invoice_id = $1 ORDER BY p.created_at`, [id]),
  ]);
  return { ...rows[0], lines: lines.rows, discounts: discounts.rows, payments: payments.rows };
}

export async function confirmInvoice(user, id) {
  return withTransaction(async (c) => {
    const inv = await lockInvoice(c, user, id);
    if (inv.status !== 'draft') throw new AppError(409, 'Only draft invoices can be confirmed');
    await c.query(`UPDATE invoices SET status='confirmed', confirmed_at=CURRENT_TIMESTAMP WHERE id=$1`, [id]);
    return { id, status: 'confirmed' };
  });
}

// Cancelling frees the discount usage so the limit is not wasted.
export async function cancelInvoice(user, id) {
  return withTransaction(async (c) => {
    const inv = await lockInvoice(c, user, id);
    if (!['draft', 'confirmed'].includes(inv.status)) throw new AppError(409, 'This invoice cannot be cancelled');
    if (Number(inv.amount_paid) > 0) throw new AppError(409, 'Invoice has payments and cannot be cancelled');
    await c.query(
      `UPDATE discounts d SET times_used = GREATEST(d.times_used - 1, 0)
         FROM discount_usages du WHERE du.discount_id = d.id AND du.invoice_id = $1`, [id]);
    await c.query('DELETE FROM discount_usages WHERE invoice_id = $1', [id]);
    await c.query(`UPDATE invoices SET status='cancelled', cancelled_at=CURRENT_TIMESTAMP WHERE id=$1`, [id]);
    return { id, status: 'cancelled' };
  });
}

// Marks the invoice as sent. TODO: plug the email provider in here (Resend / Nodemailer).
export async function sendInvoice(user, id) {
  return withTransaction(async (c) => {
    const inv = await lockInvoice(c, user, id);
    if (!['confirmed', 'paid'].includes(inv.status)) throw new AppError(409, 'Confirm the invoice before sending it');
    await c.query('UPDATE invoices SET sent_at = CURRENT_TIMESTAMP WHERE id = $1', [id]);
    return { id, sent: true };
  });
}

export async function listOverdue(user, q = {}) {
  const { page, limit, offset } = paging(q);
  const { params, f } = scopedFilters(user, 's');
  params.push(limit, offset);
  const { rows } = await pool.query(
    `SELECT v.*, COUNT(*) OVER() AS total_count
       FROM v_overdue_invoices v
       JOIN subscriptions s ON s.id = v.subscription_id
      WHERE ${f.where.join(' AND ')}
      ORDER BY v.days_overdue DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return paged(rows, page, limit);
}