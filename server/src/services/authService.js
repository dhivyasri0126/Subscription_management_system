// Business logic for authentication. Routes call this; this talks to the database.
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { pool } from "../db.js";

export const BUSINESS_TYPES = [
  "Retail", "Restaurant / Food", "Healthcare", "Education",
  "IT / Software", "Manufacturing", "Services", "Other",
];

export const registerSchema = z.object({
  name: z.string().trim().min(2, "Enter the customer name.").max(100),
  email: z.string().trim().toLowerCase().email("Enter a valid email address.").max(150),
  phone: z
    .string()
    .transform((v) => v.replace(/^\+91/, "").replace(/[\s-]/g, ""))
    .refine((v) => /^[6-9]\d{9}$/.test(v), "Enter a valid 10-digit mobile number."),
  address: z.string().trim().min(5, "Enter your address.").max(300),
  businessType: z.enum(BUSINESS_TYPES, {
    errorMap: () => ({ message: "Select your business type." }),
  }),
  password: z
    .string()
    .min(9, "Use more than 8 characters.")
    .max(72)
    .regex(/[a-z]/, "Include a lowercase letter.")
    .regex(/[A-Z]/, "Include an uppercase letter.")
    .regex(/[^A-Za-z0-9]/, "Include a special character."),
});

export class ServiceError extends Error {
  constructor(status, message, fields) {
    super(message);
    this.status = status;
    this.fields = fields;
  }
}

/** Creates a row in `users` and a linked row in `customers`, in one transaction. */
export async function registerCustomer(input) {
  const parsed = registerSchema.safeParse(input);
  if (!parsed.success) {
    const fields = {};
    for (const issue of parsed.error.issues) fields[issue.path[0]] ??= issue.message;
    throw new ServiceError(400, "Please check the highlighted fields.", fields);
  }

  const { name, email, phone, address, businessType, password } = parsed.data;
  const passwordHash = await bcrypt.hash(password, 12);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const { rows } = await client.query(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ($1, $2, $3, 'customer')
       RETURNING id, name, email, role`,
      [name, email, passwordHash]
    );

    await client.query(
      `INSERT INTO customers (user_id, name, phone, address, business_type)
       VALUES ($1, $2, $3, $4, $5)`,
      [rows[0].id, name, phone, address, businessType]
    );

    await client.query("COMMIT");
    return rows[0];
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      console.error("Customer registration rollback failed:", rollbackError);
    }
    if (err.code === "23505") {
      throw new ServiceError(409, "An account with this email already exists.", {
        email: "This email is already registered.",
      });
    }
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------
if (!process.env.JWT_SECRET) {
  throw new Error("JWT_SECRET is missing. Add it to server/.env");
}

export const ROLES = ["admin", "staff", "customer"];

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
  role: z.enum(ROLES),
});

// Used when the email doesn't exist, so response time doesn't reveal which emails are registered.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 12);

/**
 * Checks email + password + chosen role against `users`.
 * Customers are also checked against `customers` and get their profile back.
 */
export async function loginUser(input) {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) {
    throw new ServiceError(400, parsed.error.issues[0].message);
  }
  const { email, password, role } = parsed.data;

  const { rows } = await pool.query(
    `SELECT id, name, email, password_hash, role, status FROM users WHERE email = $1`,
    [email]
  );
  const row = rows[0];

  const passwordOk = await bcrypt.compare(password, row?.password_hash ?? DUMMY_HASH);
  if (!row || !passwordOk) {
    throw new ServiceError(401, "Incorrect email or password.");
  }
  if (row.status !== "active") {
    throw new ServiceError(403, "This account is not active. Please contact support.");
  }
  if (row.role !== role) {
    throw new ServiceError(403, `This account is not registered as ${role}.`);
  }

  const user = { id: row.id, name: row.name, email: row.email, role: row.role };

  if (row.role === "customer") {
    const c = await pool.query(
      `SELECT phone, address, business_type FROM customers WHERE user_id = $1`,
      [row.id]
    );
    if (!c.rows[0]) {
      throw new ServiceError(403, "Customer profile not found. Please contact support.");
    }
    user.phone = c.rows[0].phone;
    user.address = c.rows[0].address;
    user.businessType = c.rows[0].business_type;
  }

  const token = jwt.sign({ sub: String(row.id), role: row.role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "8h",
  });

  return { token, user };
}