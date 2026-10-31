import { Router } from "express";
import { requireAuth, requireRole, attachCustomer } from "../middleware/auth.js";
import { sendError } from "../utils/httpError.js";
import {
  parseId,
  getSummary,
  getProfile,
  updateProfile,
  listPlans,
  listProducts,
  createQuotation,
  listSubscriptions,
  getSubscription,
  listInvoices,
  getInvoice,
  listReceipts,
  getReceipt,
} from "../services/customerService.js";

const router = Router();

// Every route below needs: a valid token -> role "customer" -> a customers row.
router.use(requireAuth, requireRole("customer"), attachCustomer);

// Wraps a handler so errors always go through sendError.
const handle = (label, fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    sendError(res, err, label);
  }
};

/* Dashboard + profile */
router.get("/summary", handle("summary", async (req, res) => {
  res.json({ ok: true, summary: await getSummary(req.customerId) });
}));

router.get("/me", handle("get profile", async (req, res) => {
  res.json({ ok: true, profile: await getProfile(req.customerId) });
}));

router.put("/me", handle("update profile", async (req, res) => {
  res.json({ ok: true, profile: await updateProfile(req.customerId, req.user.id, req.body) });
}));

/* Catalogue (read-only) */
router.get("/plans", handle("list plans", async (req, res) => {
  res.json({ ok: true, plans: await listPlans() });
}));

router.get("/products", handle("list products", async (req, res) => {
  res.json({ ok: true, products: await listProducts() });
}));

/* Request a quotation */
router.post("/quotations", handle("create quotation", async (req, res) => {
  const subscription = await createQuotation(req.customerId, req.user.id, req.body);
  res.status(201).json({ ok: true, subscription });
}));

/* Subscriptions (own only). Quotations are subscriptions with ?status=quotation */
router.get("/subscriptions", handle("list subscriptions", async (req, res) => {
  res.json({ ok: true, ...(await listSubscriptions(req.customerId, req.query)) });
}));

router.get("/subscriptions/:id", handle("get subscription", async (req, res) => {
  const id = parseId(req.params.id, "subscription");
  res.json({ ok: true, subscription: await getSubscription(req.customerId, id) });
}));

/* Invoices (own, confirmed or paid only) */
router.get("/invoices", handle("list invoices", async (req, res) => {
  res.json({ ok: true, ...(await listInvoices(req.customerId, req.query)) });
}));

router.get("/invoices/:id", handle("get invoice", async (req, res) => {
  const id = parseId(req.params.id, "invoice");
  res.json({ ok: true, invoice: await getInvoice(req.customerId, id) });
}));

/* Receipts (own) */
router.get("/receipts", handle("list receipts", async (req, res) => {
  res.json({ ok: true, ...(await listReceipts(req.customerId, req.query)) });
}));

router.get("/receipts/:id", handle("get receipt", async (req, res) => {
  const id = parseId(req.params.id, "receipt");
  res.json({ ok: true, receipt: await getReceipt(req.customerId, id) });
}));

export default router;