import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { staff } from '../../../services/staffApi';
import { useLoad, PageHead, Notice, Modal, Status, inr, fmtDate, ymd } from '../../../components/staffPortal/ui';

function PaymentForm({ invoice, onClose, onPaid }) {
  const [f, setF] = useState({ method: 'upi', amount: Number(invoice.balance_due).toFixed(2), payment_date: ymd(), reference: '', note: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { onPaid(await staff.post(`/invoices/${invoice.id}/payments`, { ...f, amount: Number(f.amount) })); }
    catch (x) { setErr(x.message); setBusy(false); }
  };
  return (
    <Modal title={`Record payment for ${invoice.invoice_number}`} onClose={onClose}>
      <form onSubmit={submit}>
        <p className="sp-muted">Balance due: {inr(invoice.balance_due)}</p>
        <div className="sp-kv">
          <label>Method
            <select value={f.method} onChange={set('method')}>
              {['cash', 'card', 'upi', 'bank_transfer', 'cheque', 'other'].map((m) => <option key={m} value={m}>{m.replace('_', ' ')}</option>)}
            </select></label>
          <label>Amount<input type="number" step="0.01" min="0.01" max={invoice.balance_due} value={f.amount} onChange={set('amount')} required /></label>
          <label>Payment date<input type="date" value={f.payment_date} onChange={set('payment_date')} required /></label>
          <label>Reference (cheque no., UPI ref)<input value={f.reference} onChange={set('reference')} /></label>
        </div>
        <label>Note<input value={f.note} onChange={set('note')} /></label>
        {err && <p className="sp-err">{err}</p>}
        <div className="sp-row-end">
          <button type="button" className="sp-btn sp-ghost" onClick={onClose}>Cancel</button>
          <button className="sp-btn" disabled={busy}>Record payment</button>
        </div>
      </form>
    </Modal>
  );
}

export default function InvoiceDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { data: i, error, loading, reload } = useLoad(() => staff.get(`/invoices/${id}`), [id]);
  const [pay, setPay] = useState(false);
  const [msg, setMsg] = useState('');

  const act = async (path) => {
    setMsg('');
    try { await staff.post(`/invoices/${id}/${path}`); reload(); } catch (e) { setMsg(e.message); }
  };
  if (!i) return <Notice error={error} loading={loading} />;

  const overdue = i.status === 'confirmed' && new Date(i.due_date) < new Date(new Date().toDateString());
  return (
    <>
      <PageHead title={i.invoice_number}>
        {i.status === 'draft' && <button className="sp-btn" onClick={() => act('confirm')}>Confirm invoice</button>}
        {i.status === 'confirmed' && <button className="sp-btn" onClick={() => setPay(true)}>Record payment</button>}
        {['confirmed', 'paid'].includes(i.status) && <button className="sp-btn sp-ghost" onClick={() => act('send')}>{i.sent_at ? 'Send again' : 'Send to customer'}</button>}
        <button className="sp-btn sp-ghost" onClick={() => window.print()}>Print</button>
        {['draft', 'confirmed'].includes(i.status) && Number(i.amount_paid) === 0 &&
          <button className="sp-btn sp-danger" onClick={() => window.confirm('Cancel this invoice?') && act('cancel')}>Cancel invoice</button>}
      </PageHead>
      {msg && <p className="sp-err">{msg}</p>}

      <div className="sp-panel sp-kv">
        <div><small>Customer</small>{i.customer_name}<br /><span className="sp-muted">{i.customer_email}</span></div>
        <div><small>Subscription</small><Link to={`/staff/subscriptions/${i.subscription_id}`}>{i.subscription_number}</Link></div>
        <div><small>Status</small><Status value={i.status} />{overdue && <> <span className="sp-badge sp-b-overdue">overdue</span></>}</div>
        <div><small>Billing period</small>{fmtDate(i.period_start)} to {fmtDate(i.period_end)}</div>
        <div><small>Invoice date</small>{fmtDate(i.invoice_date)}</div>
        <div><small>Due date</small>{fmtDate(i.due_date)}</div>
        <div><small>Sent</small>{i.sent_at ? fmtDate(i.sent_at) : 'Not sent'}</div>
      </div>

      <div className="sp-table-wrap"><table className="sp-table">
        <thead><tr><th>Description</th><th className="sp-num">Qty</th><th className="sp-num">Price</th><th className="sp-num">Discount</th><th className="sp-num">Tax</th><th className="sp-num">Total</th></tr></thead>
        <tbody>{i.lines.map((l) => (
          <tr key={l.id}><td>{l.description}</td><td className="sp-num">{l.quantity}</td><td className="sp-num">{inr(l.unit_price)}</td>
            <td className="sp-num">{inr(l.discount_amount)}</td><td className="sp-num">{inr(l.tax_amount)}</td><td className="sp-num">{inr(l.line_total)}</td></tr>))}</tbody>
      </table></div>
      <div className="sp-totals">
        <div><span>Untaxed</span><span>{inr(i.untaxed_amount)}</span></div>
        {Number(i.discount_amount) > 0 && <div><span>Discount</span><span>− {inr(i.discount_amount)}</span></div>}
        <div><span>Tax</span><span>{inr(i.tax_amount)}</span></div>
        <div className="sp-grand"><span>Total</span><span>{inr(i.total_amount)}</span></div>
        <div><span>Paid</span><span>{inr(i.amount_paid)}</span></div>
        <div className="sp-grand"><span>Balance due</span><span>{inr(i.balance_due)}</span></div>
      </div>

      <h2>Payments</h2>
      {i.payments.length === 0 ? <p className="sp-muted">No payments recorded yet.</p> :
        <div className="sp-table-wrap"><table className="sp-table">
          <thead><tr><th>Date</th><th>Method</th><th>Reference</th><th className="sp-num">Amount</th><th>Receipt</th></tr></thead>
          <tbody>{i.payments.map((p) => (
            <tr key={p.id}><td>{fmtDate(p.payment_date)}</td><td>{p.method.replace('_', ' ')}</td><td>{p.reference || '—'}</td>
              <td className="sp-num">{inr(p.amount)}</td><td><Link to={`/staff/receipts/${p.receipt_id}`}>{p.receipt_number}</Link></td></tr>))}</tbody>
        </table></div>}

      {pay && <PaymentForm invoice={i} onClose={() => setPay(false)} onPaid={(r) => nav(`/staff/receipts/${r.id}`)} />}
    </>
  );
}