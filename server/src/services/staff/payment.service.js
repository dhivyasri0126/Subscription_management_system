import { pool } from '../../db.js';
import { withTransaction } from '../../utils/tx.js';
import { AppError, paging, paged, round2, toId, optDate } from '../../utils/http.js';
import { scopedFilters, subscriptionScope } from '../../utils/staffScope.js';
import { lockInvoice } from './invoice.service.js';

const METHODS = ['cash', 'card', 'upi', 'bank_transfer', 'cheque', 'other'];

export async function getReceipt(db, user, receiptId) {
  const params = [receiptId];
  const scope = subscriptionScope(user, 's', params);
  const { rows } = await db.query(
    `SELECT r.id, r.receipt_number, r.issued_at, r.emailed_at,
            p.id AS payment_id, p.method, p.amount, p.payment_date, p.reference, p.note,
            i.id AS invoice_id, i.invoice_number, i.total_amount, i.amount_paid,
            (i.total_amount - i.amount_paid) AS balance_due, i.status AS invoice_status,
            c.name AS customer_name, c.phone AS customer_phone, c.address AS customer_address,
            u.name AS received_by_name
       FROM receipts r
       JOIN payments p ON p.id = r.payment_id
       JOIN invoices i ON i.id = p.invoice_id
       JOIN subscriptions s ON s.id = i.subscription_id
       JOIN customers c ON c.id = i.customer_id
       LEFT JOIN users u ON u.id = p.received_by
      WHERE r.id = $1 AND ${scope}`,
    params
  );
  if (!rows[0]) throw new AppError(404, 'Receipt not found');
  return rows[0];
}

// ONE transaction: lock invoice -> validate -> payment -> receipt -> update invoice.
export async function recordPayment(user, invoiceId, body) {
  const method = body.method;
  if (!METHODS.includes(method)) throw new AppError(400, `method must be one of: ${METHODS.join(', ')}`);
  const amount = round2(body.amount);
  if (!(amount > 0)) throw new AppError(400, 'Amount must be greater than 0');
  const paymentDate = optDate(body.payment_date, 'payment_date');

  return withTransaction(async (c) => {
    const inv = await lockInvoice(c, user, invoiceId);
    if (inv.status !== 'confirmed') throw new AppError(409, 'Payments can only be recorded on confirmed invoices');

    const balance = round2(Number(inv.total_amount) - Number(inv.amount_paid));
    if (amount > balance) throw new AppError(400, `Amount exceeds the balance due (${balance.toFixed(2)})`);

    const { rows: pay } = await c.query(
      `INSERT INTO payments (invoice_id, method, amount, payment_date, reference, note, received_by)
       VALUES ($1,$2,$3,COALESCE($4::date, CURRENT_DATE),$5,$6,$7) RETURNING id`,
      [invoiceId, method, amount, paymentDate, body.reference || null, body.note || null, user.id]
    );
    const { rows: rec } = await c.query(
      'INSERT INTO receipts (payment_id) VALUES ($1) RETURNING id', [pay[0].id]);

    await c.query(
      `UPDATE invoices
          SET amount_paid = amount_paid + $2,
              status  = CASE WHEN amount_paid + $2 >= total_amount THEN 'paid' ELSE status END,
              paid_at = CASE WHEN amount_paid + $2 >= total_amount THEN CURRENT_TIMESTAMP ELSE paid_at END
        WHERE id = $1`,
      [invoiceId, amount]
    );
    return getReceipt(c, user, rec[0].id);
  });
}

export async function listInvoicePayments(user, invoiceId) {
  const params = [invoiceId];
  const scope = subscriptionScope(user, 's', params);
  const { rows } = await pool.query(
    `SELECT p.*, r.id AS receipt_id, r.receipt_number, u.name AS received_by_name
       FROM payments p
       JOIN invoices i ON i.id = p.invoice_id
       JOIN subscriptions s ON s.id = i.subscription_id
       LEFT JOIN receipts r ON r.payment_id = p.id
       LEFT JOIN users u ON u.id = p.received_by
      WHERE p.invoice_id = $1 AND ${scope}
      ORDER BY p.created_at`,
    params
  );
  return rows;
}

export async function listReceipts(user, q = {}) {
  const { page, limit, offset } = paging(q);
  const { params, f } = scopedFilters(user, 's');
  if (q.customer_id) f.add('i.customer_id = ?', toId(q.customer_id, 'customer_id'));
  if (q.from) f.add('p.payment_date >= ?', optDate(q.from, 'from'));
  if (q.to) f.add('p.payment_date <= ?', optDate(q.to, 'to'));
  if (q.search) f.add('(r.receipt_number ILIKE ? OR i.invoice_number ILIKE ? OR c.name ILIKE ?)', `%${q.search}%`);
  params.push(limit, offset);

  const { rows } = await pool.query(
    `SELECT r.id, r.receipt_number, r.issued_at, r.emailed_at, p.amount, p.method, p.payment_date,
            i.invoice_number, c.name AS customer_name, COUNT(*) OVER() AS total_count
       FROM receipts r
       JOIN payments p ON p.id = r.payment_id
       JOIN invoices i ON i.id = p.invoice_id
       JOIN subscriptions s ON s.id = i.subscription_id
       JOIN customers c ON c.id = i.customer_id
      WHERE ${f.where.join(' AND ')}
      ORDER BY r.issued_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return paged(rows, page, limit);
}