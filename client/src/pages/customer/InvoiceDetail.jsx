import { Link, useParams } from "react-router-dom";
import { customerApi } from "../../services/customerApi";
import { useAsync } from "../../components/customer/useAsync";
import { formatDate, formatMoney, titleCase } from "../../components/customer/format";
import { PageHeader, Loading, ErrorBox, InvoiceBadge } from "../../components/customer/common";

export default function InvoiceDetail() {
  const { id } = useParams();
  const { loading, error, data } = useAsync(() => customerApi.invoice(id), [id]);

  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} />;
  const inv = data.invoice;
  const overdue = inv.status === "confirmed" && new Date(inv.due_date) < new Date() && Number(inv.balance_due) > 0;

  return (
    <>
      <PageHeader
        title={inv.invoice_number}
        subtitle={`For subscription ${inv.subscription_number}`}
        actions={
          <button className="cx-btn" onClick={() => window.print()}>
            Print invoice
          </button>
        }
      />

      <article className="cx-card cx-doc">
        <div className="cx-doc-head">
          <div>
            <h2>Brightloop Software</h2>
            <p className="cx-muted">Tax invoice</p>
          </div>
          <div className="cx-doc-meta">
            <strong>{inv.invoice_number}</strong>
            <InvoiceBadge invoice={{ ...inv, is_overdue: overdue }} />
            <span>Invoice date: {formatDate(inv.invoice_date)}</span>
            <span>Due date: {formatDate(inv.due_date)}</span>
            <span>
              Period: {formatDate(inv.period_start)} – {formatDate(inv.period_end)}
            </span>
          </div>
        </div>

        <div className="cx-billto">
          <h3>Billed to</h3>
          <strong>{inv.customer_name}</strong>
          <span>{inv.customer_email}</span>
          {inv.customer_phone && <span>{inv.customer_phone}</span>}
          {inv.customer_address && <span>{inv.customer_address}</span>}
        </div>

        <div className="cx-tablewrap">
          <table className="cx-table">
            <thead>
              <tr>
                <th>Description</th>
                <th className="num">Qty</th>
                <th className="num">Unit price</th>
                <th className="num">Discount</th>
                <th className="num">Tax</th>
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {inv.lines.map((l) => (
                <tr key={l.id}>
                  <td>{l.description}</td>
                  <td className="num">{l.quantity}</td>
                  <td className="num">{formatMoney(l.unit_price)}</td>
                  <td className="num">{formatMoney(l.discount_amount)}</td>
                  <td className="num">{Number(l.tax_rate_percent)}%</td>
                  <td className="num">{formatMoney(l.line_total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <dl className="cx-totals cx-totals--right">
          <div><dt>Untaxed amount</dt><dd>{formatMoney(inv.untaxed_amount)}</dd></div>
          {Number(inv.discount_amount) > 0 && <div><dt>Discount</dt><dd>− {formatMoney(inv.discount_amount)}</dd></div>}
          <div><dt>Tax</dt><dd>{formatMoney(inv.tax_amount)}</dd></div>
          <div className="cx-totals-grand"><dt>Total</dt><dd>{formatMoney(inv.total_amount)}</dd></div>
          <div><dt>Paid</dt><dd>{formatMoney(inv.amount_paid)}</dd></div>
          <div className="cx-totals-grand"><dt>Balance due</dt><dd>{formatMoney(inv.balance_due)}</dd></div>
        </dl>

        {inv.payments.length > 0 && (
          <>
            <h3>Payments received</h3>
            <div className="cx-tablewrap">
              <table className="cx-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Method</th>
                    <th>Reference</th>
                    <th className="num">Amount</th>
                    <th className="cx-noprint">Receipt</th>
                  </tr>
                </thead>
                <tbody>
                  {inv.payments.map((p) => (
                    <tr key={p.id}>
                      <td>{formatDate(p.payment_date)}</td>
                      <td>{titleCase(p.method)}</td>
                      <td>{p.reference || "—"}</td>
                      <td className="num">{formatMoney(p.amount)}</td>
                      <td className="cx-noprint">
                        {p.receipt_id ? <Link to={`/customer/receipts/${p.receipt_id}`}>{p.receipt_number}</Link> : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        {inv.notes && <p className="cx-muted">{inv.notes}</p>}
      </article>

      <p className="cx-noprint">
        <Link to="/customer/invoices">← Back to invoices</Link>
      </p>
    </>
  );
}