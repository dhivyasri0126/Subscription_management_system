import { pool } from '../../db.js';
import { optDate } from '../../utils/http.js';
import { scopedFilters } from '../../utils/staffScope.js';

export async function getDashboard(user) {
  const a = scopedFilters(user, 's');
  const b = scopedFilters(user, 's');
  const c = scopedFilters(user, 's');

  const [subs, invs, pays] = await Promise.all([
    pool.query(
      `SELECT COUNT(*) FILTER (WHERE s.status='quotation' AND s.source='customer_request') AS pending_quotations,
              COUNT(*) FILTER (WHERE s.status='confirmed') AS awaiting_activation,
              COUNT(*) FILTER (WHERE s.status='active')    AS active_subscriptions
         FROM subscriptions s WHERE ${a.f.where.join(' AND ')}`, a.params),
    pool.query(
      `SELECT COUNT(*) FILTER (WHERE i.status='draft') AS invoices_to_confirm,
              COUNT(*) FILTER (WHERE i.status='confirmed' AND i.due_date < CURRENT_DATE AND i.amount_paid < i.total_amount) AS overdue_invoices
         FROM invoices i JOIN subscriptions s ON s.id = i.subscription_id
        WHERE ${b.f.where.join(' AND ')}`, b.params),
    pool.query(
      `SELECT COALESCE(SUM(pay.amount),0) AS collected_this_month
         FROM payments pay JOIN invoices i ON i.id = pay.invoice_id
         JOIN subscriptions s ON s.id = i.subscription_id
        WHERE ${c.f.where.join(' AND ')} AND pay.payment_date >= date_trunc('month', CURRENT_DATE)`, c.params),
  ]);
  return { ...subs.rows[0], ...invs.rows[0], ...pays.rows[0] };
}

export async function getReportSummary(user, q = {}) {
  const from = optDate(q.from, 'from');
  const to = optDate(q.to, 'to');

  const rev = scopedFilters(user, 's');
  if (from) rev.f.add('pay.payment_date >= ?', from);
  if (to) rev.f.add('pay.payment_date <= ?', to);
  const out = scopedFilters(user, 's');

  const [revenue, open] = await Promise.all([
    pool.query(
      `SELECT COALESCE(SUM(pay.amount),0) AS revenue_collected, COUNT(*) AS payments_count
         FROM payments pay JOIN invoices i ON i.id = pay.invoice_id
         JOIN subscriptions s ON s.id = i.subscription_id
        WHERE ${rev.f.where.join(' AND ')}`, rev.params),
    pool.query(
      `SELECT COALESCE(SUM(i.total_amount - i.amount_paid),0) AS outstanding_balance,
              COUNT(*) AS open_invoices,
              COALESCE(SUM(i.total_amount - i.amount_paid) FILTER (WHERE i.due_date < CURRENT_DATE),0) AS overdue_balance,
              COUNT(*) FILTER (WHERE i.due_date < CURRENT_DATE) AS overdue_invoices
         FROM invoices i JOIN subscriptions s ON s.id = i.subscription_id
        WHERE ${out.f.where.join(' AND ')} AND i.status = 'confirmed' AND i.amount_paid < i.total_amount`, out.params),
  ]);
  return { ...revenue.rows[0], ...open.rows[0] };
}

// Same idea as v_monthly_revenue, but scoped to the staff member's products
export async function getMonthlyReport(user, q = {}) {
  const { params, f } = scopedFilters(user, 's');
  const from = optDate(q.from, 'from');
  const to = optDate(q.to, 'to');
  if (from) f.add('pay.payment_date >= ?', from);
  if (to) f.add('pay.payment_date <= ?', to);
  const { rows } = await pool.query(
    `SELECT date_trunc('month', pay.payment_date)::date AS month,
            COUNT(*) AS payments_count, SUM(pay.amount) AS revenue_collected
       FROM payments pay JOIN invoices i ON i.id = pay.invoice_id
       JOIN subscriptions s ON s.id = i.subscription_id
      WHERE ${f.where.join(' AND ')}
      GROUP BY 1 ORDER BY 1 DESC LIMIT 12`, params);
  return rows;
}