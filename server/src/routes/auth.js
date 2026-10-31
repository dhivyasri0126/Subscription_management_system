import { Router } from "express";
import { registerCustomer, loginUser, ServiceError } from "../services/authService.js";

const router = Router();

function sendError(res, err, label) {
  if (err instanceof ServiceError) {
    return res.status(err.status).json({ ok: false, error: err.message, fields: err.fields });
  }
  console.error(`${label} failed:`, err);
  return res.status(500).json({ ok: false, error: "Something went wrong. Please try again." });
}

router.post("/register", async (req, res) => {
  try {
    const user = await registerCustomer(req.body);
    res.status(201).json({ ok: true, user });
  } catch (err) {
    sendError(res, err, "register");
  }
});

router.post("/login", async (req, res) => {
  try {
    const { token, user } = await loginUser(req.body);
    res.json({ ok: true, token, user });
  } catch (err) {
    sendError(res, err, "login");
  }
});

export default router;