import { Link, useParams } from "react-router-dom";
import { customerApi } from "../../services/customerApi";
import { useAsync } from "../../components/customer/useAsync";
import { formatDate, formatMoney, titleCase } from "../../components/customer/format";
import { PageHeader, Loading, ErrorBox } from "../../components/customer/common";

export default function ReceiptDetail() {
  const { id } = useParams();
  const { loading, error, data } = useAsync(() => customerApi.receipt(id), [id]);

  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} />;
  const r = data.receipt;
  const balance = Number(r.invoice_total) - Number(r.invoice_paid);

  return (
    <>
      <PageHeader
        title={r.receipt_number}
        subtitle="Payment receipt"
        actions={
          <button className="cx-btn" onClick={() => window.print()}>
            Print receipt
          </button>
        }
      />

      <article className="cx-card cx-doc cx-doc--narrow">
        <div className="cx-doc-head">
          <div>
            <h2>SubscriptionManager</h2>
            <p className="cx-muted">Payment receipt</p>
          </div>
          <div className="cx-doc-meta">
            <strong>{r.receipt_number}</strong>
            <span>Issued: {formatDate(r.issued_at)}</span>
          </div>
        </div>

        <div className="cx-receipt-amount">
          <span>Amount received</span>
          <strong>{formatMoney(r.amount)}</strong>
        </div>

        <dl className="cx-facts">
          <div><dt>Received from</dt><dd>{r.customer_name}</dd></div>
          <div><dt>Payment date</dt><dd>{formatDate(r.payment_date)}</dd></div>
          <div><dt>Method</dt><dd>{titleCase(r.method)}</dd></div>
          <div><dt>Reference</dt><dd>{r.reference || "—"}</dd></div>
          <div><dt>Applied to invoice</dt><dd>{r.invoice_number}</dd></div>
          <div><dt>Subscription</dt><dd>{r.subscription_number}</dd></div>
          <div><dt>Invoice total</dt><dd>{formatMoney(r.invoice_total)}</dd></div>
          <div><dt>Balance after payment</dt><dd>{formatMoney(balance)}</dd></div>
        </dl>
        {r.note && <p className="cx-muted">{r.note}</p>}
      </article>

      <p className="cx-noprint">
        <Link to={`/customer/invoices/${r.invoice_id}`}>View invoice</Link> ·{" "}
        <Link to="/customer/receipts">All receipts</Link>
      </p>
    </>
  );
}