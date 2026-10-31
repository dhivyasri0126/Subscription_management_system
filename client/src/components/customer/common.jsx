import { Link } from "react-router-dom";

const STATUS_LABEL = {
  draft: "Draft",
  quotation: "Quotation",
  confirmed: "Confirmed",
  active: "Active",
  closed: "Closed",
  paid: "Paid",
  unpaid: "Unpaid",
  overdue: "Overdue",
  cancelled: "Cancelled",
};

export function StatusBadge({ status }) {
  return <span className={`cx-badge cx-badge--${status}`}>{STATUS_LABEL[status] ?? status}</span>;
}

/* Invoices: "confirmed" means unpaid, and unpaid past its due date is overdue. */
export function InvoiceBadge({ invoice }) {
  const status = invoice.is_overdue ? "overdue" : invoice.status === "confirmed" ? "unpaid" : invoice.status;
  return <StatusBadge status={status} />;
}

export function PageHeader({ title, subtitle, actions }) {
  return (
    <header className="cx-pagehead cx-noprint">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="cx-pagehead-actions">{actions}</div>}
    </header>
  );
}

export function Loading({ label = "Loading…" }) {
  return (
    <div className="cx-state" role="status">
      <span className="cx-spinner" aria-hidden="true" /> {label}
    </div>
  );
}

export function ErrorBox({ message }) {
  return (
    <div className="cx-alert cx-alert--error" role="alert">
      {message}
    </div>
  );
}

export function EmptyState({ title, text, actionTo, actionLabel }) {
  return (
    <div className="cx-empty">
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      {actionTo && (
        <Link className="cx-btn cx-btn--primary" to={actionTo}>
          {actionLabel}
        </Link>
      )}
    </div>
  );
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="cx-tabs cx-noprint" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          aria-selected={value === t.value}
          className={value === t.value ? "active" : ""}
          onClick={() => onChange(t.value)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Pagination({ page, totalPages, onChange }) {
  if (totalPages <= 1) return null;
  return (
    <div className="cx-pagination cx-noprint">
      <button className="cx-btn" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        Previous
      </button>
      <span>
        Page {page} of {totalPages}
      </span>
      <button className="cx-btn" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>
        Next
      </button>
    </div>
  );
}