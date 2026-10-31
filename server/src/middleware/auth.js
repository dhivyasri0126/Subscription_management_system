import jwt from "jsonwebtoken";
import { pool } from "../utils/pool.js";
import { HttpError, sendError } from "../utils/httpError.js";

/*
  requireAuth    - checks the "Authorization: Bearer <token>" header, then loads
                   the user from the database so a blocked/inactive user is
                   refused even if their token has not expired yet.
  requireRole    - allows only the listed roles, e.g. requireRole("customer").
  attachCustomer - for customer users, loads their customers.id into req.customerId.

  When a request is refused, the REASON is printed in the server terminal
  as "[auth] ..." so you can see exactly why (missing header, bad secret, etc.).
*/

function deny(req, reason, message) {
  console.warn(`[auth] ${req.method} ${req.originalUrl} refused: ${reason}`);
  return new HttpError(401, message);
}

export async function requireAuth(req, res, next) {
  try {
    const [scheme, token] = (req.headers.authorization || "").split(" ");
    if (scheme !== "Bearer" || !token) {
      throw deny(req, "no Bearer token in the Authorization header", "Please log in to continue.");
    }

    if (!process.env.JWT_SECRET) {
      console.error("[auth] JWT_SECRET is not set in server/.env");
      throw new HttpError(500, "Server is not configured correctly.");
    }

    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch (e) {
      throw deny(req, `token rejected (${e.name}: ${e.message})`, "Your session has expired. Please log in again.");
    }

    // Accepts the id under any of the usual names used when signing the token.
    const userId =
      payload.id ?? payload.userId ?? payload.user_id ?? payload.uid ?? payload.sub ?? payload.user?.id;
    if (!userId) {
      throw deny(
        req,
        `token has no user id (keys found: ${Object.keys(payload).join(", ")})`,
        "Invalid session. Please log in again."
      );
    }

    const { rows } = await pool.query(
      "SELECT id, name, email, role, status FROM users WHERE id = $1",
      [userId]
    );
    const user = rows[0];
    if (!user) throw deny(req, `no user with id ${userId}`, "This account no longer exists.");
    if (user.status !== "active") throw deny(req, `user ${userId} status is "${user.status}"`, "This account is not active.");

    req.user = user;
    next();
  } catch (err) {
    sendError(res, err, "auth check");
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      console.warn(`[auth] ${req.method} ${req.originalUrl} refused: role "${req.user?.role}" not in [${roles.join(", ")}]`);
      return sendError(res, new HttpError(403, "You do not have access to this."), "role check");
    }
    next();
  };
}

export async function attachCustomer(req, res, next) {
  try {
    const { rows } = await pool.query("SELECT id FROM customers WHERE user_id = $1", [req.user.id]);
    if (!rows[0]) {
      console.warn(`[auth] user ${req.user.id} has role customer but no row in customers`);
      throw new HttpError(403, "No customer profile found for this account.");
    }
    req.customerId = rows[0].id;
    next();
  } catch (err) {
    sendError(res, err, "customer lookup");
  }
}