import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { pool } from "./db.js";
import authRoutes from "./routes/auth.js";
import staffRoutes from "./routes/staff.js";
import { errorHandler } from "./utils/http.js";

const app = express();

app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_ORIGIN, credentials: true }));
app.use(express.json({ limit: "10kb" }));

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
app.use("/api/staff", staffRoutes);

app.use((_req, res) => res.status(404).json({ ok: false, error: "Not found." }));

// Must be last: handles errors from every route above (also the old catch-all's job)
app.use(errorHandler);

const port = process.env.PORT || 5000;
app.listen(port, () => console.log(`API running on http://localhost:${port}`));