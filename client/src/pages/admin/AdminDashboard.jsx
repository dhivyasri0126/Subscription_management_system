import { useEffect, useState } from "react";
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

const fields = {
  customers: [
    "name", "email", "phone", "address", "business_type"
  ],
  staff: [
    "name", "email", "status"
  ],
  products: [
    "name", "type", "sales_price",
    "cost_price", "tax_id", "notes", "status"
  ],
  taxes: [
    "name", "rate", "description", "status"
  ],
  plans: [
    "name", "price", "billing_period",
    "min_quantity", "available_from", "available_to",
    "auto_close_on_end", "allow_early_close", "allow_pause",
    "allow_renew", "status", "assigned_staff_count"
  ],
  quotations: [
    "subscription_number", "customer_id", "plan_id", "status",
    "start_date", "expiry_date"
  ],
  subscriptions: [
    "subscription_number", "customer_id",
    "plan_id", "status", "start_date", "expiry_date"
  ],
  invoices: [
    "invoice_number", "customer_name", "subscription_id",
    "invoice_date", "due_date", "total_amount", "amount_paid", "status",
    "receipt_number"
  ],
  payments: [
    "invoice_id", "method", "amount",
    "payment_date", "reference", "receipt_number"
  ],
  discounts: [
    "code", "type", "value",
    "start_date", "end_date", "usage_limit", "status"
  ]
};

const currency = value =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0
  }).format(Number(value || 0));

export default function AdminDashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

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
      ? [
          "customer_id", "plan_id", "assigned_staff_id", "status",
          "start_date", "expiry_date", "payment_term_days"
        ]
      : ["customer_id", "plan_id"],
    subscriptions: [
      "customer_id", "plan_id", "assigned_staff_id", "status", "start_date",
      "expiry_date", "payment_term_days"
    ],
    invoices: ["subscription_id", "due_date"],
    payments: ["invoice_id", "method", "amount", "payment_date", "reference", "note"],
    discounts: ["code", "name", "type", "value", "start_date", "end_date", "usage_limit", "status"]
  };
  const formFields = formFieldsByResource[active] || currentFields;

  async function loadData() {
    setLoading(true);
    setError("");

    try {
      if (active === "dashboard" || active === "reports") {
        const data = await getAdminDashboard();
        setDashboard(data);
      } else {
        const data = await getAdminResource(active, search);
        setRecords(data.items || []);
        if (
          ["customers", "staff", "products", "taxes", "plans", "quotations",
            "subscriptions", "invoices", "payments"].includes(active)
        ) {
          setLookups(await getAdminLookups());
        }
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
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
        (data.staff || [])
          .filter(staff => staff.assigned)
          .map(staff => String(staff.id))
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
      if (active === "customers" || active === "staff") {
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
        setNotice("Invoice generated successfully.");
      } else {
        await createAdminResource(active, payload);
        setNotice("Record created successfully.");
      }

      setForm({});
      setShowForm(false);
      setEditingRecord(null);

      await loadData();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function beginCreate() {
    setError("");
    setNotice("");
    setEditingRecord(null);
    setForm(
      active === "staff" || active === "customers"
        ? { status: "active" }
        : active === "plans"
          ? {
              status: "active",
              min_quantity: 1,
              auto_close_on_end: false,
              allow_early_close: false,
              allow_pause: false,
              allow_renew: true
            }
          : active === "subscriptions"
            ? { status: "draft", payment_term_days: 0 }
            : active === "payments"
              ? { method: "bank_transfer" }
              : active === "discounts"
                ? { type: "fixed", status: "active" }
                : { status: "active" }
    );
    setShowForm(true);
  }

  function beginEdit(record) {
    setError("");
    setNotice("");
    setEditingRecord(record);
    setForm({ ...record });
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
      setNotice(`Invoice ${invoice.invoice_number} ${action === "send" ? "marked as sent" : `${action}ed`}.`);
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

  const stats = [
    {
      label: "Total Customers",
      value: dashboard.customers ?? "—",
      icon: "♙"
    },
    {
      label: "Active Subscriptions",
      value: dashboard.activeSubscriptions ?? "—",
      icon: "↻"
    },
    {
      label: "Pending Quotations",
      value: dashboard.pendingQuotations ?? "—",
      icon: "▤"
    },
    {
      label: "Revenue Collected",
      value: currency(dashboard.revenueCollected),
      icon: "₹"
    },
    {
      label: "Outstanding Balance",
      value: currency(dashboard.outstandingBalance),
      icon: "◷"
    },
    {
      label: "Overdue Invoices",
      value: dashboard.overdueInvoices ?? "—",
      icon: "!"
    }
  ];

  return (
    <div className="admin-layout">

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
              className={
                active === item.id ? "nav-item active" : "nav-item"
              }
              onClick={() => {
                setActive(item.id);
                setShowForm(false);
                setSearch("");
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
            <strong>
              {menu.find(item => item.id === active)?.name}
            </strong>
          </div>

          <div className="header-user">
            <span className="online-dot"></span>
            {user?.email}
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

              <p>
                Manage your business from one place.
              </p>
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

          {error && (
            <div className="error-message">
              {error}
            </div>
          )}
          {notice && <div className="success-message">{notice}</div>}

          {/* DASHBOARD */}

          {(active === "dashboard" || active === "reports") && (
            <>
              <div className="stats-grid">
                {stats.map(stat => (
                  <div className="stat-card" key={stat.label}>
                    <div className="stat-top">
                      <span>{stat.label}</span>
                      <div className="stat-icon">
                        {stat.icon}
                      </div>
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
                              <td>{new Date(`${row.month}T00:00:00`).toLocaleDateString("en-IN", {
                                month: "long",
                                year: "numeric"
                              })}</td>
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

          {/* CREATE FORM */}

          {showForm && (
            <form className="admin-form" onSubmit={handleCreate}>
              <h3>
                {editingRecord
                  ? "Edit"
                  : active === "invoices"
                    ? "Generate"
                    : "Add"}{" "}
                {menu.find(item => item.id === active)?.name}
              </h3>

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

                      {[
                        "customer_id",
                        "plan_id",
                        "assigned_staff_id",
                        "invoice_id",
                        "subscription_id",
                        "tax_id",
                        "status",
                        "billing_period",
                        "type",
                        "method"
                      ].includes(field) ? (
                        <select
                          required={
                            ["customer_id", "plan_id", "subscription_id"].includes(field) ||
                            (active === "payments" && field === "invoice_id") ||
                            (active === "plans" && field === "billing_period")
                          }
                          value={
                            form[field] ??
                            (field === "status"
                              ? active === "subscriptions"
                                ? "draft"
                                : "active"
                              : field === "method"
                                ? "bank_transfer"
                                : "")
                          }
                          onChange={e =>
                            setForm({ ...form, [field]: e.target.value })
                          }
                        >
                          <option value="">Select {field.replaceAll("_", " ")}</option>
                          {field === "customer_id" && lookups.customers.map(option => (
                            <option key={option.id} value={option.id}>
                              {option.name} ({option.email})
                            </option>
                          ))}
                          {field === "plan_id" && lookups.plans.map(option => (
                            <option key={option.id} value={option.id}>
                              {option.name} — {currency(option.price)} / {option.billing_period}
                            </option>
                          ))}
                          {field === "assigned_staff_id" && (
                            <>
                              <option value="">Unassigned</option>
                              {lookups.staff
                                .filter(option =>
                                  !form.plan_id ||
                                  option.assigned_plan_ids.some(
                                    planId => String(planId) === String(form.plan_id)
                                  )
                                )
                                .map(option => (
                                <option key={option.id} value={option.id}>{option.name}</option>
                                ))}
                            </>
                          )}
                          {field === "invoice_id" && lookups.invoices.map(option => (
                            <option key={option.id} value={option.id}>
                              {option.invoice_number} — balance {currency(Number(option.total_amount) - Number(option.amount_paid))}
                            </option>
                          ))}
                          {field === "subscription_id" && lookups.subscriptions.map(option => (
                            <option key={option.id} value={option.id}>
                              {option.subscription_number} — {option.customer_name} / {option.plan_name}
                            </option>
                          ))}
                          {field === "tax_id" && (
                            <>
                              <option value="">No tax</option>
                              {lookups.taxes.map(option => (
                                <option key={option.id} value={option.id}>
                                  {option.name} ({option.rate}%)
                                </option>
                              ))}
                            </>
                          )}
                          {field === "status" &&
                            (active === "subscriptions" || active === "quotations"
                              ? ["draft", "quotation", "confirmed", "active", "closed"]
                              : ["active", "inactive"]
                            ).map(value => (
                              <option key={value} value={value}>{value}</option>
                            ))}
                          {field === "billing_period" &&
                            ["daily", "weekly", "monthly", "yearly"].map(value => (
                              <option key={value} value={value}>{value}</option>
                            ))}
                          {field === "type" && active === "discounts" &&
                            ["fixed", "percentage"].map(value => (
                              <option key={value} value={value}>{value}</option>
                            ))}
                          {field === "method" &&
                            ["bank_transfer", "upi", "card", "cash", "cheque", "other"].map(value => (
                              <option key={value} value={value}>
                                {value.replaceAll("_", " ")}
                              </option>
                            ))}
                        </select>
                      ) : active === "plans" &&
                        [
                          "auto_close_on_end",
                          "allow_early_close",
                          "allow_pause",
                          "allow_renew",
                        ].includes(field) ? (
                        <input
                          type="checkbox"
                          checked={
                            form[field] ??
                            (field === "allow_renew")
                          }
                          onChange={e =>
                            setForm({ ...form, [field]: e.target.checked })
                          }
                        />
                      ) : (
                        <input
                          type={
                            (active === "staff" || active === "customers") &&
                            field === "password"
                              ? "password"
                              : field === "email"
                                ? "email"
                                : [
                                    "price", "cost_price", "rate", "value", "amount",
                                    "usage_limit", "min_quantity", "payment_term_days"
                                  ].includes(field)
                                  ? "number"
                                  : [
                                      "available_from", "available_to", "start_date",
                                      "expiry_date", "due_date", "payment_date", "end_date"
                                    ].includes(field)
                                    ? "date"
                                    : "text"
                          }
                          min={
                            ["min_quantity", "usage_limit", "payment_term_days"].includes(field)
                              ? 0
                              : [
                                  "price", "cost_price", "rate", "value", "amount"
                                ].includes(field)
                                ? 0
                                : undefined
                          }
                          step={
                            ["price", "cost_price", "rate", "value", "amount"].includes(field)
                              ? "0.01"
                              : ["min_quantity", "usage_limit", "payment_term_days"].includes(field)
                                ? "1"
                                : undefined
                          }
                          required={
                            ((active === "staff" || active === "customers") &&
                              ["name", "email", "password"].includes(field)) ||
                            (active === "plans" &&
                              ["name", "price", "min_quantity"].includes(field)) ||
                            (active === "taxes" && ["name", "rate"].includes(field)) ||
                            (active === "products" &&
                              ["name", "type", "sales_price"].includes(field)) ||
                            (active === "discounts" &&
                              ["code", "type", "value"].includes(field)) ||
                            (active === "payments" && field === "amount")
                          }
                          minLength={
                            (active === "staff" || active === "customers") &&
                            field === "password"
                              ? 9
                              : undefined
                          }
                          autoComplete={
                            (active === "staff" || active === "customers") &&
                            field === "password"
                              ? "new-password"
                              : undefined
                          }
                          title={
                            (active === "staff" || active === "customers") &&
                            field === "password"
                              ? "Use more than 8 characters with uppercase, lowercase, and a special character."
                              : undefined
                          }
                          value={form[field] ?? ""}
                          onChange={e =>
                            setForm({ ...form, [field]: e.target.value })
                          }
                          placeholder={`Enter ${field.replaceAll("_", " ")}`}
                        />
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
                  {loading ? "Saving..." : editingRecord ? "Update" : active === "invoices" ? "Generate invoice" : "Save"}
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

              <button className="secondary-btn">
                Search
              </button>
            </form>
          )}

          {/* RECORD TABLE */}

          {currentFields.length > 0 && (
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    {currentFields.map(field => (
                      <th key={field}>
                        {field.replaceAll("_", " ")}
                      </th>
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
                          {record[field] ?? "—"}
                        </td>
                      ))}
                      {active === "plans" && (
                        <td>
                          <button
                            type="button"
                            className="secondary-btn"
                            onClick={() => openStaffAssignment(record)}
                          >
                            Assign staff ({record.assigned_staff_count ?? 0})
                          </button>
                        </td>
                      )}
                      {active === "products" && (
                        <td>
                          <button
                            type="button"
                            className="secondary-btn"
                            onClick={() =>
                              openStaffAssignment({
                                ...record,
                                assignmentType: "product"
                              })
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