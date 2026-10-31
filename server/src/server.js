
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { pool } from "./db.js";

import authRoutes from "./routes/auth.js";
import adminRoutes from "./routes/adminroute.js";
import customerRoutes from "./routes/customer.js";
import staffRoutes from "./routes/staff.js";

import { errorHandler } from "./utils/http.js";

const app = express();

app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_ORIGIN, credentials: true }));
app.use(express.json({ limit: "10kb" }));

// Health check
app.get("/api/health", async (_req, res, next) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, db: "connected" });
  } catch (err) {
    next(err);
  }
});

// Authentication
app.use(
  "/api/auth",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 50,
  }),
  authRoutes
);

// Admin portal
app.use("/api/admin", adminRoutes);

// Customer portal
app.use("/api/customer", customerRoutes);

// Staff portal
app.use("/api/staff", staffRoutes);

// 404 handler
app.use((_req, res) => {
  res.status(404).json({
    ok: false,
    error: "Not found.",
  });
});

// Global error handler (must be last)
app.use(errorHandler);

const port = process.env.PORT || 5000;

app.listen(port, () => {
  console.log(`API running on http://localhost:${port}`);
});
