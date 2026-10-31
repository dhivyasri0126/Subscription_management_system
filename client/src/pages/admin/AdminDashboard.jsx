import { useEffect, useRef, useState } from "react";
import { useAuth } from "../authentication/AuthContext";
import { useNavigate } from "react-router-dom";

import {
  getAdminDashboard,
  getAdminResource,
  createAdminResource,
  getPlanStaff,
  savePlanStaff,
  getProductStaff,
  saveProductStaff,
  getAdminLookups,
  updateAdminResource,
  deleteAdminResource,
  runInvoiceAction,
  generateInvoice,
  downloadInvoicePdf
} from "../../services/adminApi";

import "../../styles/admin.css";

const menu = [
  { id: "dashboard", name: "Dashboard", icon: "▦" },
  { id: "customers", name: "Customers", icon: "♙" },
  { id: "staff", name: "Staff", icon: "♧" },
  { id: "products", name: "Products", icon: "▣" },
  { id: "taxes", name: "Taxes", icon: "%" },
  { id: "plans", name: "Subscription Plans", icon: "◇" },
  { id: "quotations", name: "Quotations", icon: "▤" },
  { id: "subscriptions", name: "Subscriptions", icon: "↻" },
  { id: "invoices", name: "Invoices", icon: "▧" },
  { id: "payments", name: "Payments", icon: "₹" },
  { id: "discounts", name: "Discounts", icon: "%" },
  { id: "reports", name: "Finance & Reports", icon: "▥" }
];

// Columns shown in each table.
// FIX: quotations/subscriptions now show customer and plan NAMES instead of raw ids.
const fields = {
  customers: ["name", "email", "phone", "address", "business_type"],
  staff: ["name", "email", "status"],
  products: ["name", "type", "sales_price", "cost_price", "tax_id", "notes", "status"],
  taxes: ["name", "rate", "description", "status"],
  plans: [
    "name", "price", "billing_period", "min_quantity", "available_from",
    "available_to", "auto_close_on_end", "allow_early_close", "allow_pause",
    "allow_renew", "status", "assigned_staff_count"
  ],
  quotations: [
    "subscription_number", "customer_name", "plan_name", "status",
    "start_date", "expiry_date"
  ],
  subscriptions: [
    "subscription_number", "customer_name", "plan_name", "status",
    "start_date", "expiry_date"
  ],
  invoices: [
    "invoice_number", "customer_name", "subscription_id", "invoice_date",
    "due_date", "total_amount", "amount_paid", "status", "receipt_number"
  ],
  payments: ["invoice_id", "method", "amount", "payment_date", "reference", "receipt_number"],
  discounts: [
    "name", "type", "value", "min_purchase_amount", "min_quantity",
    "start_date", "end_date", "usage_limit", "times_used", "status"
  ]
};

// FIX: status values must match what the database allows.
//   products: active | archived     plans: active | paused | closed
const STATUS_OPTIONS = {
  products: ["active", "archived"],
  plans: ["active", "paused", "closed"],
  subscriptions: ["draft", "quotation", "confirmed", "active", "closed"],
  quotations: ["draft", "quotation", "confirmed", "active", "closed"]
};
const PRODUCT_TYPES = ["service", "goods", "addon"];
const THEME_STORAGE_KEY = "sms_admin_theme";

function getInitialTheme() {
  try {
    const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
    if (savedTheme === "light" || savedTheme === "dark") return savedTheme;
  } catch {
    // Theme preference storage is optional; fall back to the system preference.
  }
  const systemTheme = window.matchMedia?.("(prefers-color-scheme: dark)");
  return systemTheme?.matches ? "dark" : "light";
}

const DATE_KEY = /(_date|^available_from|^available_to)$/;
const PLAN_FLAGS = ["auto_close_on_end", "allow_early_close", "allow_pause", "allow_renew"];
const NUMBER_FIELDS = ["price", "cost_price", "rate", "value", "amount", "min_purchase_amount", "usage_limit", "min_quantity", "payment_term_days"];
const MONEY_FIELDS = ["price", "cost_price", "rate", "value", "amount", "min_purchase_amount"];
const DATE_FIELDS = [
  "available_from", "available_to", "start_date", "expiry_date",
  "due_date", "payment_date", "end_date"
];
const SELECT_FIELDS = [
  "customer_id", "plan_id", "assigned_staff_id", "invoice_id", "subscription_id",
  "tax_id", "status", "billing_period", "type", "method"
];

const currency = value =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0
  }).format(Number(value || 0));

// FIX: show booleans / ISO timestamps readably instead of raw values.
function formatCell(value) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString("en-IN");
  }
  return String(value);
}

// FIX: <input type="date"> only accepts YYYY-MM-DD. Editing used to show empty
// dates, which then got saved as NULL and tripped "dates required" errors.
function normalizeForEdit(record) {
  const next = { ...record };
  Object.keys(next).forEach(key => {
    if (DATE_KEY.test(key) && typeof next[key] === "string") {
      next[key] = next[key].slice(0, 10);
    }
    if (next[key] === null) next[key] = "";
  });
  return next;
}

function defaultFormFor(active) {
  switch (active) {
    case "plans":
      return {
        status: "active", min_quantity: 1, auto_close_on_end: false,
        allow_early_close: false, allow_pause: false, allow_renew: true
      };
    case "products":
      return { status: "active", type: "service" };
    case "subscriptions":
      return { status: "draft", payment_term_days: 0 };
    case "payments":
      return { method: "bank_transfer" };
    case "discounts":
      return {
        type: "fixed", status: "active", min_purchase_amount: 0, min_quantity: 0,
        start_date: new Date().toISOString().slice(0, 10)
      };
    default:
      return { status: "active" };
  }
}

export default function AdminDashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const [theme, setTheme] = useState(getInitialTheme);
  const [active, setActive] = useState("dashboard");
  const [dashboard, setDashboard] = useState({});
  const [records, setRecords] = useState([]);

  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({});
  const [editingRecord, setEditingRecord] = useState(null);
  const [lookups, setLookups] = useState({
    customers: [], plans: [], subscriptions: [], invoices: [],
    staff: [], taxes: [], products: []
  });
  const [staffAssignmentPlan, setStaffAssignmentPlan] = useState(null);
  const [planStaff, setPlanStaff] = useState([]);
  const [selectedStaffIds, setSelectedStaffIds] = useState([]);
  const [loadingPlanStaff, setLoadingPlanStaff] = useState(false);
  const [savingPlanStaff, setSavingPlanStaff] = useState(false);
  const [assignmentError, setAssignmentError] = useState("");
  const [notice, setNotice] = useState("");

  // FIX: ignore responses from a previous tab so slow requests can't
  // overwrite the table of the tab you are looking at now.
  const requestId = useRef(0);

  useEffect(() => {
    try {
      if (localStorage.getItem(THEME_STORAGE_KEY)) return undefined;
    } catch {
      return undefined;
    }

    const systemTheme = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!systemTheme) return undefined;
    const syncSystemTheme = event => setTheme(event.matches ? "dark" : "light");
    systemTheme.addEventListener?.("change", syncSystemTheme);
    return () => systemTheme.removeEventListener?.("change", syncSystemTheme);
  }, []);

  function toggleTheme() {
    const nextTheme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    } catch {
      // Keep the theme active for this visit when storage is unavailable.
    }
  }

  const currentFields = fields[active] || [];
  const formFieldsByResource = {
    customers: ["name", "email", "password", "phone", "address", "business_type"],
    staff: ["name", "email", "password", "status"],
    products: ["name", "type", "sales_price", "cost_price", "tax_id", "notes", "status"],
    taxes: ["name", "rate", "description", "status"],
    plans: [
      "name", "price", "billing_period", "min_quantity", "available_from",
      "available_to", "auto_close_on_end", "allow_early_close", "allow_pause",
      "allow_renew", "status"
    ],
    quotations: editingRecord
      ? ["customer_id", "plan_id", "assigned_staff_id", "status", "start_date", "expiry_date", "payment_term_days"]
      : ["customer_id", "plan_id"],
    subscriptions: [
      "customer_id", "plan_id", "assigned_staff_id", "status", "start_date",
      "expiry_date", "payment_term_days"
    ],
    invoices: ["subscription_id", "due_date"],
    payments: ["invoice_id", "method", "amount", "payment_date", "reference", "note"],
    discounts: [
      "name", "type", "value", "min_purchase_amount", "min_quantity",
      "start_date", "end_date", "usage_limit", "status"
    ]
  };
  const formFields = formFieldsByResource[active] || currentFields;

  async function loadData(tab = active) {
    const myRequest = ++requestId.current;
    setLoading(true);
    setError("");

    try {
      if (tab === "dashboard" || tab === "reports") {
        const data = await getAdminDashboard();
        if (myRequest === requestId.current) setDashboard(data);
      } else {
        const data = await getAdminResource(tab, search);
        if (myRequest !== requestId.current) return;
        setRecords(data.items || []);
        if (
          ["customers", "staff", "products", "taxes", "plans", "quotations",
            "subscriptions", "invoices", "payments"].includes(tab)
        ) {
          const lookupData = await getAdminLookups();
          if (myRequest === requestId.current) setLookups(lookupData);
        }
      }
    } catch (err) {
      if (myRequest === requestId.current) setError(err.message);
    } finally {
      if (myRequest === requestId.current) setLoading(false);
    }
  }

  useEffect(() => {
    setRecords([]); // FIX: don't render the previous tab's rows under new columns
    loadData(active);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  async function handleSearch(e) {
    e.preventDefault();
    await loadData();
  }

  async function openStaffAssignment(plan) {
    setStaffAssignmentPlan(plan);
    setPlanStaff([]);
    setSelectedStaffIds([]);
    setAssignmentError("");
    setLoadingPlanStaff(true);

    try {
      const data = plan.assignmentType === "product"
        ? await getProductStaff(plan.id)
        : await getPlanStaff(plan.id);
      setPlanStaff(data.staff || []);
      setSelectedStaffIds(
        (data.staff || []).filter(staff => staff.assigned).map(staff => String(staff.id))
      );
    } catch (err) {
      setAssignmentError(err.message);
    } finally {
      setLoadingPlanStaff(false);
    }
  }

  async function handleSavePlanStaff() {
    if (!staffAssignmentPlan) return;
    setSavingPlanStaff(true);
    setAssignmentError("");

    try {
      if (staffAssignmentPlan.assignmentType === "product") {
        await saveProductStaff(staffAssignmentPlan.id, selectedStaffIds);
      } else {
        await savePlanStaff(staffAssignmentPlan.id, selectedStaffIds);
      }
      setRecords(currentRecords =>
        currentRecords.map(record =>
          record.id === staffAssignmentPlan.id
            ? { ...record, assigned_staff_count: selectedStaffIds.length }
            : record
        )
      );
      setNotice(`Staff assignments saved for ${staffAssignmentPlan.name}.`);
      setStaffAssignmentPlan(null);
    } catch (err) {
      setAssignmentError(err.message);
    } finally {
      setSavingPlanStaff(false);
    }
  }

  async function handleCreate(e) {
    e.preventDefault();
    setNotice("");
    setError("");
    setLoading(true);

    try {
      const payload = { ...form };

      // FIX: only check the password when CREATING. Editing a customer/staff
      // member has no password field, so this check used to block every edit.
      if (!editingRecord && (active === "customers" || active === "staff")) {
        const password = payload.password || "";
        if (
          password.length < 9 ||
          !/[a-z]/.test(password) ||
          !/[A-Z]/.test(password) ||
          !/[^A-Za-z0-9]/.test(password)
        ) {
          throw new Error(
            "Password must be longer than 8 characters and include uppercase, lowercase, and a special character."
          );
        }
      }

      if (editingRecord) {
        await updateAdminResource(active, editingRecord.id, payload);
        setNotice("Record updated successfully.");
      } else if (active === "invoices") {
        await generateInvoice(payload);
        setNotice("Invoice generated as a draft. Confirm it to accept payments.");
      } else {
        await createAdminResource(active, payload);
        setNotice("Record created successfully.");
      }

      setForm({});
      setShowForm(false);
      setEditingRecord(null);
      setLoading(false);
      await loadData();
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  }

  function beginCreate() {
    setError("");
    setNotice("");
    setEditingRecord(null);
    setForm(defaultFormFor(active));
    setShowForm(true);
  }

  function beginEdit(record) {
    setError("");
    setNotice("");
    setEditingRecord(record);
    setForm(normalizeForEdit(record));
    setShowForm(true);
  }

  async function handleDelete(record) {
    if (!window.confirm(`Delete this ${active.slice(0, -1)} record? This cannot be undone.`)) {
      return;
    }
    setError("");
    setNotice("");
    try {
      await deleteAdminResource(active, record.id);
      setNotice("Record deleted successfully.");
      await loadData();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleInvoiceAction(invoice, action) {
    setError("");
    setNotice("");
    try {
      await runInvoiceAction(invoice.id, action);
      setNotice(
        `Invoice ${invoice.invoice_number} ${
          action === "send" ? "marked as sent" : action === "confirm" ? "confirmed" : "cancelled"
        }.`
      );
      await loadData();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleInvoicePdf(invoice) {
    setError("");
    try {
      const pdf = await downloadInvoicePdf(invoice.id);
      const url = URL.createObjectURL(pdf);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${invoice.invoice_number}.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message);
    }
  }

  function handleLogout() {
    logout();
    navigate("/login", { replace: true });
  }

  // Options for every <select> in the form.
  function renderOptions(field) {
    switch (field) {
      case "customer_id":
        return lookups.customers.map(option => (
          <option key={option.id} value={option.id}>{option.name} ({option.email})</option>
        ));
      case "plan_id":
        return lookups.plans.map(option => (
          <option key={option.id} value={option.id}>
            {option.name} — {currency(option.price)} / {option.billing_period}
          </option>
        ));
      case "assigned_staff_id":
        return (
          <>
            <option value="">Unassigned</option>
            {lookups.staff
              .filter(option =>
                !form.plan_id ||
                option.assigned_plan_ids.some(planId => String(planId) === String(form.plan_id))
              )
              .map(option => (
                <option key={option.id} value={option.id}>{option.name}</option>
              ))}
          </>
        );
      case "invoice_id":
        return lookups.invoices.map(option => (
          <option key={option.id} value={option.id}>
            {option.invoice_number} — balance {currency(Number(option.total_amount) - Number(option.amount_paid))}
          </option>
        ));
      case "subscription_id":
        return lookups.subscriptions.map(option => (
          <option key={option.id} value={option.id}>
            {option.subscription_number} — {option.customer_name} / {option.plan_name}
          </option>
        ));
      case "tax_id":
        return (
          <>
            <option value="">No tax</option>
            {lookups.taxes.map(option => (
              <option key={option.id} value={option.id}>{option.name} ({option.rate}%)</option>
            ))}
          </>
        );
      case "status":
        return (STATUS_OPTIONS[active] || ["active", "inactive"]).map(value => (
          <option key={value} value={value}>{value}</option>
        ));
      case "billing_period":
        return ["daily", "weekly", "monthly", "yearly"].map(value => (
          <option key={value} value={value}>{value}</option>
        ));
      case "type":
        return (active === "products" ? PRODUCT_TYPES : ["fixed", "percentage"]).map(value => (
          <option key={value} value={value}>{value}</option>
        ));
      case "method":
        return ["bank_transfer", "upi", "card", "cash", "cheque", "other"].map(value => (
          <option key={value} value={value}>{value.replaceAll("_", " ")}</option>
        ));
      default:
        return null;
    }
  }

  function selectDefault(field) {
    if (field === "status") {
      if (active === "subscriptions") return "draft";
      return "active";
    }
    if (field === "method") return "bank_transfer";
    if (field === "type" && active === "products") return "service";
    return "";
  }

  const isAccountForm = active === "staff" || active === "customers";

  function renderInput(field) {
    const isPassword = isAccountForm && field === "password";
    return (
      <input
        type={
          isPassword ? "password"
            : field === "email" ? "email"
              : NUMBER_FIELDS.includes(field) ? "number"
                : DATE_FIELDS.includes(field) ? "date"
                  : "text"
        }
        min={
          field === "min_quantity" && active === "plans" ? 1
            : NUMBER_FIELDS.includes(field) ? 0
              : undefined
        }
        step={
          MONEY_FIELDS.includes(field) ? "0.01"
            : ["min_quantity", "usage_limit", "payment_term_days"].includes(field) ? "1"
              : undefined
        }
        required={
          (isAccountForm && ["name", "email", "password"].includes(field)) ||
          (active === "plans" && ["name", "price", "min_quantity", "available_from"].includes(field)) ||
          (active === "taxes" && ["name", "rate"].includes(field)) ||
          (active === "products" && ["name", "sales_price"].includes(field)) ||
          (active === "discounts" && ["name", "value", "start_date"].includes(field)) ||
          (active === "payments" && field === "amount")
        }
        minLength={isPassword ? 9 : undefined}
        autoComplete={isPassword ? "new-password" : undefined}
        title={isPassword ? "Use more than 8 characters with uppercase, lowercase, and a special character." : undefined}
        value={form[field] ?? ""}
        onChange={e => setForm({ ...form, [field]: e.target.value })}
        placeholder={`Enter ${field.replaceAll("_", " ")}`}
      />
    );
  }

  const stats = [
    { label: "Total Customers", value: dashboard.customers ?? "—", icon: "♙" },
    { label: "Active Subscriptions", value: dashboard.activeSubscriptions ?? "—", icon: "↻" },
    { label: "Pending Quotations", value: dashboard.pendingQuotations ?? "—", icon: "▤" },
    { label: "Revenue Collected", value: currency(dashboard.revenueCollected), icon: "₹" },
    { label: "Outstanding Balance", value: currency(dashboard.outstandingBalance), icon: "◷" },
    { label: "Overdue Invoices", value: dashboard.overdueInvoices ?? "—", icon: "!" }
  ];

  const showNoPayableInvoices =
    showForm && active === "payments" && !editingRecord && lookups.invoices.length === 0;
  const showNoBillableSubs =
    showForm && active === "invoices" && lookups.subscriptions.length === 0;

  return (
    <div className="admin-layout" data-theme={theme}>

      {/* SIDEBAR */}

      <aside className="admin-sidebar">

        <div className="admin-brand">
          <div className="brand-logo">S</div>
          <div>
            <h2>Subscription</h2>
            <span>Manager</span>
          </div>
        </div>

        <p className="sidebar-heading">WORKSPACE</p>

        <nav className="sidebar-menu">
          {menu.map(item => (
            <button
              key={item.id}
              className={active === item.id ? "nav-item active" : "nav-item"}
              onClick={() => {
                setActive(item.id);
                setShowForm(false);
                setEditingRecord(null);
                setSearch("");
                setError("");
                setNotice("");
              }}
            >
              <span className="nav-icon">{item.icon}</span>
              {item.name}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="admin-profile">
            <div className="profile-avatar">
              {(user?.name || "A").charAt(0).toUpperCase()}
            </div>
            <div>
              <strong>{user?.name || "Admin"}</strong>
              <small>Administrator</small>
            </div>
          </div>

          <button className="logout-btn" onClick={handleLogout}>
            ↪ Logout
          </button>
        </div>

      </aside>

      {/* MAIN CONTENT */}

      <main className="admin-main">

        <header className="admin-header">
          <div>
            <span>Subscription Manager / </span>
            <strong>{menu.find(item => item.id === active)?.name}</strong>
          </div>

          <div className="header-controls">
            <button
              type="button"
              className="theme-toggle"
              onClick={toggleTheme}
              aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
              aria-pressed={theme === "dark"}
            >
              <span aria-hidden="true">{theme === "dark" ? "☀" : "◐"}</span>
              {theme === "dark" ? "Light mode" : "Dark mode"}
            </button>
            <div className="header-user">
              <span className="online-dot"></span>
              {user?.email}
            </div>
          </div>
        </header>

        <section className="admin-content">

          <div className="page-heading">
            <div>
              <p className="eyebrow">BRIGHTLOOP SOFTWARE</p>

              <h1>
                {active === "dashboard"
                  ? "Welcome back, Admin!"
                  : menu.find(item => item.id === active)?.name}
              </h1>

              <p>Manage your business from one place.</p>
            </div>

            {currentFields.length > 0 && active !== "reports" && (
              <button
                className="primary-btn"
                onClick={() => {
                  if (showForm) {
                    setShowForm(false);
                    setEditingRecord(null);
                  } else {
                    beginCreate();
                  }
                }}
              >
                {showForm
                  ? "Close Form"
                  : active === "invoices"
                    ? "+ Generate Invoice"
                    : "+ Add New"}
              </button>
            )}
          </div>

          {error && <div className="error-message">{error}</div>}
          {notice && <div className="success-message">{notice}</div>}

          {/* DASHBOARD */}

          {(active === "dashboard" || active === "reports") && (
            <>
              <div className="stats-grid">
                {stats.map(stat => (
                  <div className="stat-card" key={stat.label}>
                    <div className="stat-top">
                      <span>{stat.label}</span>
                      <div className="stat-icon">{stat.icon}</div>
                    </div>
                    <h2>{stat.value}</h2>
                    <small>Database summary</small>
                  </div>
                ))}
              </div>

              <div className="dashboard-panel">
                <h3>Business Overview</h3>
                <p>
                  Monitor customers, subscriptions, payments
                  and invoices using the navigation menu.
                </p>
                {loading && <p>Loading dashboard...</p>}
              </div>

              {active === "reports" && (
                <div className="dashboard-panel report-panel">
                  <h3>Monthly revenue</h3>
                  {dashboard.monthlyRevenue?.length ? (
                    <div className="table-container">
                      <table>
                        <thead>
                          <tr><th>Month</th><th>Revenue collected</th></tr>
                        </thead>
                        <tbody>
                          {dashboard.monthlyRevenue.map(row => (
                            <tr key={row.month}>
                              <td>
                                {new Date(`${String(row.month).slice(0, 10)}T00:00:00`).toLocaleDateString("en-IN", {
                                  month: "long",
                                  year: "numeric"
                                })}
                              </td>
                              <td>{currency(row.revenue)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p>No payment revenue recorded yet.</p>
                  )}
                </div>
              )}
            </>
          )}

          {/* CREATE / EDIT FORM */}

          {showForm && (
            <form className="admin-form" onSubmit={handleCreate}>
              <h3>
                {editingRecord ? "Edit" : active === "invoices" ? "Generate" : "Add"}{" "}
                {menu.find(item => item.id === active)?.name}
              </h3>

              {showNoPayableInvoices && (
                <div className="error-message">
                  No payable invoices. Generate an invoice, then use "Confirm" on the
                  Invoices page before recording a payment.
                </div>
              )}
              {showNoBillableSubs && (
                <div className="error-message">
                  No confirmed or active subscriptions to invoice. Confirm or activate a
                  subscription first (with start and expiry dates).
                </div>
              )}

              <div className="form-grid">
                {formFields
                  .filter(field =>
                    field !== "id" &&
                    field !== "subscription_number" &&
                    field !== "invoice_number" &&
                    field !== "assigned_staff_count" &&
                    !(editingRecord && field === "password")
                  )
                  .map(field => (
                    <label key={field}>
                      {field.replaceAll("_", " ").toUpperCase()}

                      {SELECT_FIELDS.includes(field) ? (
                        <select
                          required={
                            ["customer_id", "plan_id", "subscription_id"].includes(field) ||
                            (active === "payments" && field === "invoice_id") ||
                            (active === "plans" && field === "billing_period")
                          }
                          value={form[field] ?? selectDefault(field)}
                          onChange={e => setForm({ ...form, [field]: e.target.value })}
                        >
                          <option value="">Select {field.replaceAll("_", " ")}</option>
                          {renderOptions(field)}
                        </select>
                      ) : active === "plans" && PLAN_FLAGS.includes(field) ? (
                        <input
                          type="checkbox"
                          checked={form[field] ?? field === "allow_renew"}
                          onChange={e => setForm({ ...form, [field]: e.target.checked })}
                        />
                      ) : (
                        renderInput(field)
                      )}
                    </label>
                  ))}
              </div>

              <div className="form-buttons">
                <button
                  type="button"
                  className="cancel-btn"
                  onClick={() => {
                    setShowForm(false);
                    setEditingRecord(null);
                  }}
                >
                  Cancel
                </button>

                <button className="primary-btn" type="submit" disabled={loading}>
                  {loading
                    ? "Saving..."
                    : editingRecord
                      ? "Update"
                      : active === "invoices"
                        ? "Generate invoice"
                        : "Save"}
                </button>
              </div>
            </form>
          )}

          {/* SEARCH */}

          {currentFields.length > 0 && (
            <form className="search-form" onSubmit={handleSearch}>
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={`Search ${active}...`}
              />
              <button type="submit" className="secondary-btn">Search</button>
            </form>
          )}

          {/* RECORD TABLE */}

          {currentFields.length > 0 && (
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    {currentFields.map(field => (
                      <th key={field}>{field.replaceAll("_", " ")}</th>
                    ))}
                    {["plans", "products"].includes(active) && <th>Staff assignment</th>}
                    {active === "invoices" && <th>Invoice PDF</th>}
                    <th>Actions</th>
                  </tr>
                </thead>

                <tbody>
                  {records.map((record, index) => (
                    <tr key={record.id || index}>
                      {currentFields.map(field => (
                        <td key={field}>
                          {field === "status" && record[field] ? (
                            <span
                              className={`status-badge status-${String(record[field])
                                .toLowerCase()
                                .replace(/[^a-z0-9]+/g, "-")}`}
                            >
                              {formatCell(record[field])}
                            </span>
                          ) : formatCell(record[field])}
                        </td>
                      ))}
                      {["plans", "products"].includes(active) && (
                        <td>
                          <button
                            type="button"
                            className="secondary-btn"
                            onClick={() =>
                              openStaffAssignment(
                                active === "products"
                                  ? { ...record, assignmentType: "product" }
                                  : record
                              )
                            }
                          >
                            Assign staff ({record.assigned_staff_count ?? 0})
                          </button>
                        </td>
                      )}
                      {active === "invoices" && (
                        <td>
                          <button
                            type="button"
                            className="secondary-btn"
                            onClick={() => handleInvoicePdf(record)}
                          >
                            Download PDF
                          </button>
                        </td>
                      )}
                      <td className="record-actions">
                        {["customers", "staff", "products", "taxes", "plans",
                          "quotations", "subscriptions", "discounts"].includes(active) && (
                          <button
                            type="button"
                            className="secondary-btn"
                            onClick={() => beginEdit(record)}
                          >
                            Edit
                          </button>
                        )}
                        {active === "invoices" && (
                          <>
                            {record.status === "draft" && (
                              <>
                                <button type="button" className="secondary-btn" onClick={() => handleInvoiceAction(record, "confirm")}>Confirm</button>
                                <button type="button" className="secondary-btn" onClick={() => handleInvoiceAction(record, "cancel")}>Cancel</button>
                              </>
                            )}
                            {["draft", "confirmed", "partially_paid"].includes(record.status) && (
                              <button type="button" className="secondary-btn" onClick={() => handleInvoiceAction(record, "send")}>Mark sent</button>
                            )}
                          </>
                        )}
                        {["customers", "staff", "products", "taxes", "plans", "discounts"].includes(active) && (
                          <button
                            type="button"
                            className="danger-btn"
                            onClick={() => handleDelete(record)}
                          >
                            Delete
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}

                  {!loading && records.length === 0 && (
                    <tr>
                      <td
                        colSpan={
                          currentFields.length +
                          (["plans", "products"].includes(active) ? 1 : 0) +
                          (active === "invoices" ? 1 : 0) +
                          1
                        }
                        className="empty-table"
                      >
                        No records found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>

              {loading && <p className="loading-text">Loading...</p>}
            </div>
          )}

          {/* STAFF ASSIGNMENT DIALOG */}

          {staffAssignmentPlan && (
            <div
              className="assignment-backdrop"
              onMouseDown={event => {
                if (event.target === event.currentTarget && !savingPlanStaff) {
                  setStaffAssignmentPlan(null);
                }
              }}
            >
              <section
                className="assignment-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="plan-staff-title"
              >
                <h2 id="plan-staff-title">
                  Assign staff to {staffAssignmentPlan.name}
                </h2>
                <p>
                  Select the staff members responsible for this{" "}
                  {staffAssignmentPlan.assignmentType || "plan"}.
                </p>

                {assignmentError && (
                  <div className="error-message">{assignmentError}</div>
                )}

                {loadingPlanStaff ? (
                  <p className="loading-text">Loading staff...</p>
                ) : planStaff.length === 0 ? (
                  <p className="empty-staff">
                    No staff accounts found. Create staff accounts first.
                  </p>
                ) : (
                  <div className="staff-options">
                    {planStaff.map(staff => (
                      <label key={staff.id} className="staff-option">
                        <input
                          type="checkbox"
                          checked={selectedStaffIds.includes(String(staff.id))}
                          onChange={event => {
                            const id = String(staff.id);
                            setSelectedStaffIds(current =>
                              event.target.checked
                                ? [...current, id]
                                : current.filter(selectedId => selectedId !== id)
                            );
                          }}
                        />
                        <span>
                          <strong>{staff.name}</strong>
                          <small>{staff.email}</small>
                          {staff.status !== "active" && (
                            <small className="inactive-staff">Inactive</small>
                          )}
                        </span>
                      </label>
                    ))}
                  </div>
                )}

                <div className="form-buttons">
                  <button
                    type="button"
                    className="cancel-btn"
                    disabled={savingPlanStaff}
                    onClick={() => setStaffAssignmentPlan(null)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="primary-btn"
                    disabled={loadingPlanStaff || savingPlanStaff}
                    onClick={handleSavePlanStaff}
                  >
                    {savingPlanStaff ? "Saving..." : "Save assignments"}
                  </button>
                </div>
              </section>
            </div>
          )}

        </section>
      </main>
    </div>
  );
}
