import { Link } from "react-router-dom";
import { customerApi } from "../../services/customerApi";
import { useAsync } from "../../components/customer/useAsync";
import { formatDate, formatMoney } from "../../components/customer/format";
import { PageHeader, Loading, ErrorBox, StatusBadge, InvoiceBadge, EmptyState } from "../../components/customer/common";

export default function CustomerDashboard() {
  const { loading, error, data } = useAsync(
    () => Promise.all([customerApi.summary(), customerApi.subscriptions({ limit: 5 }), customerApi.invoices({ limit: 5 })]),
    []
  );

  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} />;

  const [{ summary }, subs, invs] = data;

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle="Your subscriptions and billing at a glance."
        actions={
          <Link className="cx-btn cx-btn--primary" to="/customer/request">
            Request a quotation
          </Link>
        }
      />

      <section className="cx-stats">
        <div className="cx-stat">
          <span>Active subscriptions</span>
          <strong>{summary.active_subscriptions}</strong>
        </div>
        <div className="cx-stat">
          <span>Pending quotations</span>
          <strong>{summary.pending_quotations}</strong>
        </div>
        <div className="cx-stat">
          <span>Outstanding balance</span>
          <strong>{formatMoney(summary.outstanding_balance)}</strong>
        </div>
        <div className={`cx-stat ${summary.overdue_invoices > 0 ? "cx-stat--alert" : ""}`}>
          <span>Overdue invoices</span>
          <strong>{summary.overdue_invoices}</strong>
        </div>
      </section>

      <p className="cx-note">
        Next billing date: <strong>{formatDate(summary.next_billing_date)}</strong>
      </p>

      <div className="cx-grid-2">
        <section className="cx-card">
          <div className="cx-card-head">
            <h2>Recent subscriptions</h2>
            <Link to="/customer/subscriptions">View all</Link>
          </div>
          {subs.items.length === 0 ? (
            <EmptyState title="No subscriptions yet" text="Request a quotation to get started." />
          ) : (
            <ul className="cx-list">
              {subs.items.map((s) => (
                <li key={s.id}>
                  <div>
                    <Link to={`/customer/subscriptions/${s.id}`}>{s.subscription_number}</Link>
                    <small>{s.plan_name}</small>
                  </div>
                  <StatusBadge status={s.status} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="cx-card">
          <div className="cx-card-head">
            <h2>Recent invoices</h2>
            <Link to="/customer/invoices">View all</Link>
          </div>
          {invs.items.length === 0 ? (
            <EmptyState title="No invoices yet" text="Invoices appear here once billing starts." />
          ) : (
            <ul className="cx-list">
              {invs.items.map((i) => (
                <li key={i.id}>
                  <div>
                    <Link to={`/customer/invoices/${i.id}`}>{i.invoice_number}</Link>
                    <small>
                      {formatMoney(i.total_amount)} · due {formatDate(i.due_date)}
                    </small>
                  </div>
                  <InvoiceBadge invoice={i} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}