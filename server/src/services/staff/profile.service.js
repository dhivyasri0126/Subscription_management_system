import bcrypt from 'bcryptjs';
import { pool } from '../../db.js';
import { AppError } from '../../utils/http.js';
import { passwordProblem } from '../../utils/password.js';

export async function getProfile(user) {
  const { rows } = await pool.query(
    'SELECT id, name, email, role, status, created_at FROM users WHERE id = $1', [user.id]);
  return rows[0];
}

// users has no phone column (phone lives on customers), so staff can edit their name only.
export async function updateProfile(user, body) {
  const name = (body.name || '').trim();
  if (name.length < 2) throw new AppError(400, 'Name is too short');
  const { rows } = await pool.query(
    'UPDATE users SET name = $2 WHERE id = $1 RETURNING id, name, email, role', [user.id, name]);
  return rows[0];
}

export async function changePassword(user, body) {
  const { current_password: current, new_password: next } = body;
  const problem = passwordProblem(next);
  if (problem) throw new AppError(400, problem);
  const { rows } = await pool.query('SELECT password_hash FROM users WHERE id = $1', [user.id]);
  if (!rows[0] || !(await bcrypt.compare(current || '', rows[0].password_hash))) {
    throw new AppError(400, 'Current password is incorrect');
  }
  const hash = await bcrypt.hash(next, 10);
  await pool.query('UPDATE users SET password_hash = $2 WHERE id = $1', [user.id, hash]);
  return { changed: true };
}   