import { Link, useLocation, useParams } from "react-router-dom";
import { customerApi } from "../../services/customerApi";
import { useAsync } from "../../components/customer/useAsync";
import { formatDate, formatMoney, periodLabel } from "../../components/customer/format";
import { PageHeader, Loading, ErrorBox, StatusBadge } from "../../components/customer/common";

const STAGE_TEXT = {
  draft: "This subscription is still being prepared.",
  quotation: "Our team is reviewing your request. It will move to Confirmed once accepted.",
  confirmed: "Your quotation was accepted. The subscription starts once it is activated.",
  active: "Your subscription is running and invoices are created each billing period.",
  closed: "This subscription has ended.",
};

export default function SubscriptionDetail() {
  const { id } = useParams();
  const location = useLocation();
  const { loading, error, data } = useAsync(() => customerApi.subscription(id), [id]);

  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} />;
  const s = data.subscription;

  return (
    <>
      <PageHeader
        title={s.subscription_number}
        subtitle={`${s.plan_name} · ${formatMoney(s.plan_price)} / ${periodLabel(s.billing_period)}`}
        actions={<StatusBadge status={s.status} />}
      />

      {location.state?.justCreated && (
        <div className="cx-alert cx-alert--ok" role="status">
          Request sent. We will review it shortly.
        </div>
      )}
      <p className="cx-note">{STAGE_TEXT[s.status]}</p>

      <section className="cx-card">
        <dl className="cx-facts">
          <div><dt>Handled by</dt><dd>{s.staff_name || "Not assigned yet"}</dd></div>
          <div><dt>Quotation valid until</dt><dd>{formatDate(s.quotation_valid_until)}</dd></div>
          <div><dt>Start date</dt><dd>{formatDate(s.start_date)}</dd></div>
          <div><dt>Expiry date</dt><dd>{formatDate(s.expiry_date)}</dd></div>
          <div><dt>Next billing</dt><dd>{formatDate(s.next_billing_date)}</dd></div>
          <div><dt>Payment terms</dt><dd>{s.payment_terms}</dd></div>
        </dl>
      </section>

      <section className="cx-card">
        <h2>Products</h2>
        <div className="cx-tablewrap">
          <table className="cx-table">
            <thead>
              <tr>
                <th>Product</th>
                <th className="num">Qty</th>
                <th className="num">Unit price</th>
                <th className="num">Tax</th>
                <th className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {s.lines.map((l) => (
                <tr key={l.id}>
                  <td>
                    {l.product_name}
                    {l.variant_value && <small className="cx-muted"> · {l.attribute}: {l.variant_value}</small>}
                  </td>
                  <td className="num">{l.quantity}</td>
                  <td className="num">{formatMoney(l.unit_price)}</td>
                  <td className="num">{Number(l.tax_rate_percent)}%</td>
                  <td className="num">{formatMoney(l.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <dl className="cx-totals cx-totals--right">
          <div><dt>Untaxed amount</dt><dd>{formatMoney(s.untaxed_amount)}</dd></div>
          <div><dt>Tax</dt><dd>{formatMoney(s.tax_amount)}</dd></div>
          <div className="cx-totals-grand"><dt>Total</dt><dd>{formatMoney(s.total_amount)}</dd></div>
        </dl>
        {s.notes && <p className="cx-muted">Your notes: {s.notes}</p>}
      </section>

      <section className="cx-card">
        <h2>Progress</h2>
        <ol className="cx-timeline">
          {s.history.map((h, i) => (
            <li key={i}>
              <StatusBadge status={h.to_status} />
              <span>{formatDate(h.changed_at)}</span>
              {h.note && <small className="cx-muted">{h.note}</small>}
            </li>
          ))}
        </ol>
      </section>

      <p>
        <Link to="/customer/subscriptions">← Back to subscriptions</Link>
      </p>
    </>
  );
}