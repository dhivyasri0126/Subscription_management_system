import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { pool } from "./db.js";
import authRoutes from "./routes/auth.js";
import customerRoutes from "./routes/customer.js";

const app = express();

app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_ORIGIN, credentials: true }));
app.use(express.json({ limit: "10kb" }));
app.use("/api/customer", customerRoutes);
// Quick check: open http://localhost:5000/api/health
app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, db: "connected" });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ ok: false, db: "unreachable" });
  }
});

app.use("/api/auth", rateLimit({ windowMs: 15 * 60 * 1000, limit: 50 }), authRoutes);

app.use((_req, res) => res.status(404).json({ ok: false, error: "Not found." }));

// Catch-all so an unexpected error never crashes the server
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ ok: false, error: "Something went wrong. Please try again." });
});

const port = process.env.PORT || 5000;
app.listen(port, () => console.log(`API running on http://localhost:${port}`));