import { AppError, makeFilters } from './http.js';

/**
 * THE one reusable scope rule.
 * Admin sees everything. Staff see a subscription when they are its assigned staff
 * OR it has a line whose product is assigned to them in product_staff.
 * Invoices, payments and receipts inherit this through their subscription.
 *
 * Pushes the staff id onto `params` and returns a SQL condition.
 */
export function subscriptionScope(user, alias, params) {
  if (user.role === 'admin') return 'TRUE';
  params.push(user.id);
  const p = `$${params.length}`;
  return `(${alias}.assigned_staff_id = ${p} OR EXISTS (
    SELECT 1 FROM subscription_lines sl
    JOIN product_staff ps ON ps.product_id = sl.product_id
    WHERE sl.subscription_id = ${alias}.id AND ps.staff_id = ${p}))`;
}

// params + filter builder with the scope already applied as the first condition
export function scopedFilters(user, alias) {
  const params = [];
  const f = makeFilters(params);
  f.where.push(subscriptionScope(user, alias, params));
  return { params, f };
}

// Load (and optionally row-lock) a subscription the user may touch, with plan rules.
export async function getScopedSubscription(db, user, id, { lock = false } = {}) {
  const params = [id];
  const scope = subscriptionScope(user, 's', params);
  const { rows } = await db.query(
    `SELECT s.*, p.name AS plan_name, p.billing_period, p.allow_pause, p.allow_early_close,
            p.allow_renew, p.auto_close_on_end
       FROM subscriptions s JOIN plans p ON p.id = s.plan_id
      WHERE s.id = $1 AND ${scope}
      ${lock ? 'FOR UPDATE OF s' : ''}`,
    params
  );
  if (!rows[0]) throw new AppError(404, 'Subscription not found');
  return rows[0];
}