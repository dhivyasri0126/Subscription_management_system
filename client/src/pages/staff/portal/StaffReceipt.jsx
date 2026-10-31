import { Link, useParams } from 'react-router-dom';
import { staff } from '../../../services/staffApi';
import { useLoad, PageHead, Notice, inr, fmtDate } from '../../../components/staffPortal/ui';

export default function Receipt() {
  const { id } = useParams();
  const { data: r, error, loading } = useLoad(() => staff.get(`/receipts/${id}`), [id]);
  if (!r) return <Notice error={error} loading={loading} />;
  return (
    <div className="sp-receipt">
      <PageHead title={r.receipt_number}>
        <Link className="sp-btn sp-ghost" to={`/staff/invoices/${r.invoice_id}`}>Back to invoice</Link>
        <button className="sp-btn" onClick={() => window.print()}>Print receipt</button>
      </PageHead>
      <div className="sp-panel">
        <p className="sp-muted">Payment received {fmtDate(r.payment_date)}</p>
        <h2 style={{ marginTop: 0 }}>{inr(r.amount)}</h2>
        <div className="sp-kv">
          <div><small>Received from</small>{r.customer_name}</div>
          <div><small>Invoice</small>{r.invoice_number}</div>
          <div><small>Method</small>{r.method.replace('_', ' ')}</div>
          <div><small>Reference</small>{r.reference || '—'}</div>
          <div><small>Received by</small>{r.received_by_name}</div>
          <div><small>Balance after payment</small>{inr(r.balance_due)}</div>
        </div>
        {r.note && <p className="sp-muted">Note: {r.note}</p>}
      </div>
    </div>
  );
}