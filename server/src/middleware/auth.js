import jwt from 'jsonwebtoken';
import { pool } from '../db.js';
import { AppError, asyncHandler } from '../utils/http.js';

// Verifies the Bearer token, then re-checks the user in the DB so blocked/inactive
// accounts and role changes take effect immediately.
export const requireAuth = asyncHandler(async (req, _res, next) => {
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  if (scheme !== 'Bearer' || !token) throw new AppError(401, 'Authentication required');

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    throw new AppError(401, 'Invalid or expired token');
  }

  const userId = payload.id ?? payload.userId ?? payload.sub;
  const { rows } = await pool.query(
    'SELECT id, name, email, role, status FROM users WHERE id = $1',
    [userId]
  );
  const user = rows[0];
  if (!user || user.status !== 'active') throw new AppError(401, 'Account not available');

  req.user = user;
  next();
});

export const requireRole = (...roles) => (req, _res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return next(new AppError(403, 'You do not have access to this resource'));
  }
  next();
};