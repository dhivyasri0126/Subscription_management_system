import { pool } from '../../db.js';
import { AppError, paging, paged } from '../../utils/http.js';
import { subscriptionScope } from '../../utils/staffScope.js';

// Customers who appear on subscriptions the staff member can see (read only)
export async function listCustomers(user, q = {}) {
  const { page, limit, offset } = paging(q);
  const params = [];
  const scope = subscriptionScope(user, 's', params);
  let search = '';
  if (q.search) {
    params.push(`%${q.search}%`);
    search = `AND (c.name ILIKE $${params.length} OR u.email ILIKE $${params.length})`;
  }
  params.push(limit, offset);
  const { rows } = await pool.query(
    `SELECT c.id, c.name, c.phone, c.business_type, u.email,
            COUNT(DISTINCT s.id) AS subscriptions_count, COUNT(*) OVER() AS total_count
       FROM customers c
       JOIN users u ON u.id = c.user_id
       JOIN subscriptions s ON s.customer_id = c.id
      WHERE ${scope} ${search}
      GROUP BY c.id, u.email
      ORDER BY c.name
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return paged(rows, page, limit);
}

// Picker for "create quotation": any customer, minimal fields only
export async function lookupCustomers(q = {}) {
  const search = `%${(q.search || '').trim()}%`;
  const { rows } = await pool.query(
    `SELECT c.id, c.name, u.email FROM customers c JOIN users u ON u.id = c.user_id
      WHERE c.name ILIKE $1 OR u.email ILIKE $1 ORDER BY c.name LIMIT 20`,
    [search]
  );
  return rows;
}

export async function getCustomer(user, id) {
  const params = [id];
  const scope = subscriptionScope(user, 's', params);
  const { rows } = await pool.query(
    `SELECT c.id, c.name, c.phone, c.address, c.business_type, u.email
       FROM customers c JOIN users u ON u.id = c.user_id
      WHERE c.id = $1 AND EXISTS (SELECT 1 FROM subscriptions s WHERE s.customer_id = c.id AND ${scope})`,
    params
  );
  if (!rows[0]) throw new AppError(404, 'Customer not found');

  const p2 = [id];
  const scope2 = subscriptionScope(user, 's', p2);
  const [subs, invs] = await Promise.all([
    pool.query(
      `SELECT s.id, s.subscription_number, s.status, s.start_date, s.expiry_date, s.total_amount, pl.name AS plan_name
         FROM subscriptions s JOIN plans pl ON pl.id = s.plan_id
        WHERE s.customer_id = $1 AND ${scope2} ORDER BY s.created_at DESC`, p2),
    pool.query(
      `SELECT i.id, i.invoice_number, i.status, i.due_date, i.total_amount, i.amount_paid
         FROM invoices i JOIN subscriptions s ON s.id = i.subscription_id
        WHERE i.customer_id = $1 AND ${scope2} ORDER BY i.invoice_date DESC`, p2),
  ]);
  return { ...rows[0], subscriptions: subs.rows, invoices: invs.rows };
}   