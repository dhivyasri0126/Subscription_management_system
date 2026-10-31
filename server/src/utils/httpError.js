// Small error type for "expected" failures (bad input, not found, not allowed).
// sendError() turns it into the same JSON shape your auth routes use:
//   { ok: false, error: "message", fields: { fieldName: "message" } }
export class HttpError extends Error {
  constructor(status, message, fields) {
    super(message);
    this.status = status;
    this.fields = fields;
  }
}

export function sendError(res, err, label) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ ok: false, error: err.message, fields: err.fields });
  }
  console.error(`${label} failed:`, err);
  return res.status(500).json({ ok: false, error: "Something went wrong. Please try again." });
}