import { pool } from '../../db.js';

// Read-only catalogue. cost_price is deliberately not exposed to staff.
export async function listProducts(user, q = {}) {
  const params = [user.id];
  let where = `p.status = 'active'`;
  if (q.mine === 'true') where += ' AND EXISTS (SELECT 1 FROM product_staff x WHERE x.product_id = p.id AND x.staff_id = $1)';
  if (q.search) { params.push(`%${q.search}%`); where += ` AND p.name ILIKE $${params.length}`; }
  const { rows } = await pool.query(
    `SELECT p.id, p.name, p.product_type, p.sales_price, p.notes,
            t.name AS tax_name, COALESCE(t.rate_percent,0) AS tax_rate_percent,
            EXISTS (SELECT 1 FROM product_staff x WHERE x.product_id = p.id AND x.staff_id = $1) AS is_mine,
            COALESCE(json_agg(json_build_object('id', v.id, 'attribute', v.attribute,
                     'value', v.value, 'extra_price', v.extra_price) ORDER BY v.id)
                     FILTER (WHERE v.id IS NOT NULL), '[]') AS variants
       FROM products p
       LEFT JOIN taxes t ON t.id = p.tax_id
       LEFT JOIN product_variants v ON v.product_id = p.id
      WHERE ${where}
      GROUP BY p.id, t.id
      ORDER BY p.name`, params);
  return rows;
}

export async function listPlans() {
  const { rows } = await pool.query(
    `SELECT id, name, price, billing_period, min_quantity, available_from, available_to,
            auto_close_on_end, allow_early_close, allow_pause, allow_renew, status
       FROM plans WHERE status <> 'closed' ORDER BY name`);
  return rows;
}

export async function listTaxes() {
  const { rows } = await pool.query('SELECT id, name, rate_percent FROM taxes WHERE is_active ORDER BY name');
  return rows;
}

export async function listDiscounts() {
  const { rows } = await pool.query(
    `SELECT id, name, discount_type, value, applies_to, min_purchase_amount, min_quantity,
            start_date, end_date, usage_limit, times_used
       FROM discounts WHERE status = 'active' ORDER BY name`);
  return rows;
}

export async function listTemplates() {
  const { rows } = await pool.query(
    `SELECT t.id, t.name, t.plan_id, pl.name AS plan_name, t.validity_days
       FROM quotation_templates t JOIN plans pl ON pl.id = t.plan_id
      WHERE t.is_active ORDER BY t.name`);
  return rows;
}