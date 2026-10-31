
import jwt from "jsonwebtoken";
import { pool } from "../utils/pool.js";
import { HttpError, sendError } from "../utils/httpError.js";

// Verify token and confirm that the user account is active.
export async function requireAuth(req, res, next) {
  try {
    const [scheme, token] = (req.headers.authorization || "").split(" ");

    if (scheme !== "Bearer" || !token) {
      throw new HttpError(401, "Please log in to continue.");
    }

    if (!process.env.JWT_SECRET) {
      throw new HttpError(500, "Server is not configured correctly.");
    }

    let payload;

    try {
      payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      throw new HttpError(
        401,
        "Your session has expired. Please log in again."
      );
    }

    const userId =
      payload.id ??
      payload.userId ??
      payload.user_id ??
      payload.uid ??
      payload.sub ??
      payload.user?.id;

    if (!userId) {
      throw new HttpError(401, "Invalid session. Please log in again.");
    }

    const { rows } = await pool.query(
      "SELECT id, name, email, role, status FROM users WHERE id = $1",
      [userId]
    );

    const user = rows[0];

    if (!user) {
      throw new HttpError(401, "This account no longer exists.");
    }

    if (user.status !== "active") {
      throw new HttpError(401, "This account is not active.");
    }

    req.user = user;
    next();
  } catch (err) {
    sendError(res, err, "auth check");
  }
}

// Restrict routes to specific user roles.
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return sendError(
        res,
        new HttpError(403, "You do not have access to this resource."),
        "role check"
      );
    }

    next();
  };
}

// Load the customer profile for customer-specific routes.
export async function attachCustomer(req, res, next) {
  try {
    const { rows } = await pool.query(
      "SELECT id FROM customers WHERE user_id = $1",
      [req.user.id]
    );

    if (!rows[0]) {
      throw new HttpError(403, "No customer profile found for this account.");
    }

    req.customerId = rows[0].id;
    next();
  } catch (err) {
    sendError(res, err, "customer lookup");
  }
}
