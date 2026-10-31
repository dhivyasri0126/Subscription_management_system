// Shared HTTP helpers: errors, async wrapper, paging, validation, filter builder.
export class AppError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// Mount LAST in server.js: app.use(errorHandler)
export function errorHandler(err, req, res, _next) {
  const send = (status, message, details) =>
    res.status(status).json({ ok: false, error: message, message, details });
  if (err instanceof AppError) return send(err.status, err.message, err.details);
  if (err.type === 'entity.parse.failed') return send(400, 'Invalid JSON body');
  if (err.code === '23505') return send(409, 'Duplicate record');
  if (['23514', '23503', '22P02', '22007'].includes(err.code)) {
    return send(400, 'Invalid data', err.detail || err.message);
  }
  console.error(err);
  return send(500, 'Something went wrong. Please try again.');
}

export function paging(q = {}) {
  const page = Math.max(parseInt(q.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(q.limit, 10) || 20, 1), 100);
  return { page, limit, offset: (page - 1) * limit };
}

// Rows must include "COUNT(*) OVER() AS total_count"
export function paged(rows, page, limit) {
  const total = rows.length ? Number(rows[0].total_count) : 0;
  return {
    data: rows.map(({ total_count, ...r }) => r),
    page,
    limit,
    total,
    pages: Math.ceil(total / limit),
  };
}

export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export function toId(v, name = 'id') {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new AppError(400, `Invalid ${name}`);
  return n;
}

export const isDate = (s) =>
  typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

export function needDate(v, name) {
  if (!isDate(v)) throw new AppError(400, `${name} must be a date (YYYY-MM-DD)`);
  return v;
}

export function optDate(v, name) {
  return v === undefined || v === null || v === '' ? null : needDate(v, name);
}

// Builds "WHERE a AND b" safely with numbered params. Use "?" as the placeholder.
export function makeFilters(params) {
  const where = [];
  return {
    where,
    add(sql, val) {
      params.push(val);
      where.push(sql.replaceAll('?', `$${params.length}`));
    },
  };
}   