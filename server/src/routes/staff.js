import { pool } from '../db.js';
import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler, toId } from '../utils/http.js';
import * as dash from '../services/staff/dashboard.service.js';
import * as cat from '../services/staff/catalogue.service.js';
import * as subs from '../services/staff/subscription.service.js';
import * as cust from '../services/staff/customer.service.js';
import * as inv from '../services/staff/invoice.service.js';
import * as pay from '../services/staff/payment.service.js';
import * as prof from '../services/staff/profile.service.js';

const router = Router();
router.use(requireAuth, requireRole('staff', 'admin'));

const id = (req) => toId(req.params.id);
const wrap = (fn) => asyncHandler(async (req, res) => res.json(await fn(req)));

// Dashboard + reports
router.get('/dashboard', wrap((r) => dash.getDashboard(r.user)));
router.get('/reports/summary', wrap((r) => dash.getReportSummary(r.user, r.query)));
router.get('/reports/monthly', wrap((r) => dash.getMonthlyReport(r.user, r.query)));

// Catalogue (read only)
router.get('/catalogue/products', wrap((r) => cat.listProducts(r.user, r.query)));
router.get('/catalogue/plans', wrap(() => cat.listPlans()));
router.get('/catalogue/taxes', wrap(() => cat.listTaxes()));
router.get('/catalogue/discounts', wrap(() => cat.listDiscounts()));
router.get('/catalogue/templates', wrap(() => cat.listTemplates()));

// Customer quotation requests
router.get('/quotations', wrap((r) => subs.listSubscriptions(r.user, { ...r.query, status: 'quotation', source: 'customer_request' })));
router.post('/quotations/:id/accept', wrap((r) => subs.acceptQuotation(r.user, id(r), r.body)));
router.post('/quotations/:id/reject', wrap((r) => subs.rejectQuotation(r.user, id(r), r.body)));

// Subscriptions
router.get('/subscriptions', wrap((r) => subs.listSubscriptions(r.user, r.query)));
router.post('/subscriptions', asyncHandler(async (req, res) =>
  res.status(201).json(await subs.createQuotation(req.user, req.body))));
router.get('/subscriptions/:id', wrap((r) => subs.getSubscription(r.user, id(r))));
router.put('/subscriptions/:id', wrap((r) => subs.updateDraft(r.user, id(r), r.body)));
router.post('/subscriptions/:id/send-quote', wrap((r) => subs.sendQuote(r.user, id(r), r.body)));
router.post('/subscriptions/:id/activate', wrap((r) => subs.activate(r.user, id(r), r.body)));
router.post('/subscriptions/:id/pause', wrap((r) => subs.setPaused(r.user, id(r), true)));
router.post('/subscriptions/:id/resume', wrap((r) => subs.setPaused(r.user, id(r), false)));
router.post('/subscriptions/:id/close', wrap((r) => subs.closeSubscription(r.user, id(r), r.body)));
router.post('/subscriptions/:id/renew', wrap((r) => subs.renew(r.user, id(r), r.body)));

// Customers (lookup must stay above :id)
router.get('/customers/lookup', wrap((r) => cust.lookupCustomers(r.query)));
router.get('/customers', wrap((r) => cust.listCustomers(r.user, r.query)));
router.get('/customers/:id', wrap((r) => cust.getCustomer(r.user, id(r))));

// Invoices
router.get('/invoices', wrap((r) => inv.listInvoices(r.user, r.query)));
router.get('/invoices/:id', wrap((r) => inv.getInvoice(r.user, id(r))));
router.post('/invoices/:id/confirm', wrap((r) => inv.confirmInvoice(r.user, id(r))));
router.post('/invoices/:id/cancel', wrap((r) => inv.cancelInvoice(r.user, id(r))));
router.post('/invoices/:id/send', wrap((r) => inv.sendInvoice(r.user, id(r))));

// Payments and receipts
router.get('/invoices/:id/payments', wrap((r) => pay.listInvoicePayments(r.user, id(r))));
router.post('/invoices/:id/payments', asyncHandler(async (req, res) =>
  res.status(201).json(await pay.recordPayment(req.user, id(req), req.body))));
router.get('/receipts', wrap((r) => pay.listReceipts(r.user, r.query)));
router.get('/receipts/:id', wrap((r) => pay.getReceipt(pool, r.user, id(r))));

// Overdue follow-up
router.get('/overdue', wrap((r) => inv.listOverdue(r.user, r.query)));

// Profile
router.get('/profile', wrap((r) => prof.getProfile(r.user)));
router.put('/profile', wrap((r) => prof.updateProfile(r.user, r.body)));
router.post('/profile/change-password', wrap((r) => prof.changePassword(r.user, r.body)));

export default router;