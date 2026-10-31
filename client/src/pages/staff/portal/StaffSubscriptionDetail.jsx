import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { staff } from '../../../services/staffApi';
import { useLoad, PageHead, Notice, PromptModal, Status, inr, fmtDate, ymd } from '../../../components/staffPortal/ui';

export default function SubscriptionDetail() {
  const { id } = useParams();
  const { data: s, error, loading, reload } = useLoad(() => staff.get(`/subscriptions/${id}`), [id]);
  const [ask, setAsk] = useState(null);
  const [msg, setMsg] = useState('');

  const run = async (path, body) => {
    setMsg('');
    try { await staff.post(`/subscriptions/${id}/${path}`, body); setAsk(null); reload(); }
    catch (e) { setMsg(e.message); throw e; }
  };
  const quick = (path) => run(path).catch(() => {});

  if (!s) return <Notice error={error} loading={loading} />;
  const canClose = s.status === 'confirmed' || (s.status === 'active' && s.allow_early_close);

  return (
    <>
      <PageHead title={s.subscription_number}>
        {s.status === 'draft' && <button className="sp-btn" onClick={() => quick('send-quote')}>Send quotation</button>}
        {s.status === 'confirmed' && <button className="sp-btn" onClick={() => quick('activate')}>Activate</button>}
        {s.status === 'active' && s.allow_pause && !s.is_paused && <button className="sp-btn sp-ghost" onClick={() => quick('pause')}>Pause</button>}
        {s.status === 'active' && s.is_paused && <button className="sp-btn sp-ghost" onClick={() => quick('resume')}>Resume</button>}
        {s.status === 'active' && s.allow_renew && (
          <button className="sp-btn sp-ghost" onClick={() => setAsk({ title: 'Renew subscription', label: 'New expiry date', type: 'date', initial: ymd(s.expiry_date), cta: 'Renew',
            go: (v) => run('renew', { new_expiry_date: v }) })}>Renew</button>)}
        {canClose && (
          <button className="sp-btn sp-danger" onClick={() => setAsk({ title: 'Close subscription', label: 'Reason for closing', cta: 'Close subscription',
            go: (v) => run('close', { reason: v }) })}>Close</button>)}
      </PageHead>
      {msg && <p className="sp-err">{msg}</p>}

      <div className="sp-panel sp-kv">
        <div><small>Customer</small>{s.customer.name}<br /><span className="sp-muted">{s.customer.email}</span></div>
        <div><small>Plan</small>{s.plan_name} ({s.billing_period})</div>
        <div><small>Status</small><Status value={s.status} />{s.is_paused && ' (paused)'}</div>
        <div><small>Period</small>{fmtDate(s.start_date)} to {fmtDate(s.expiry_date)}</div>
        <div><small>Next billing</small>{fmtDate(s.next_billing_date)}</div>
        <div><small>Payment terms</small>{s.payment_terms}</div>
      </div>

      <h2>Lines</h2>
      <div className="sp-table-wrap"><table className="sp-table">
        <thead><tr><th>Product</th><th className="sp-num">Qty</th><th className="sp-num">Price</th><th className="sp-num">Tax</th><th className="sp-num">Amount</th></tr></thead>
        <tbody>{s.lines.map((l) => (
          <tr key={l.id}>
            <td>{l.product_name}{l.variant_value && ` (${l.attribute}: ${l.variant_value})`}</td>
            <td className="sp-num">{l.quantity}</td><td className="sp-num">{inr(l.unit_price)}</td>
            <td className="sp-num">{l.tax_rate_percent}%</td><td className="sp-num">{inr(l.amount)}</td>
          </tr>))}</tbody>
      </table></div>
      <div className="sp-totals">
        <div><span>Untaxed</span><span>{inr(s.untaxed_amount)}</span></div>
        <div><span>Tax</span><span>{inr(s.tax_amount)}</span></div>
        <div className="sp-grand"><span>Total</span><span>{inr(s.total_amount)}</span></div>
      </div>

      <h2>Invoices</h2>
      {s.invoices.length === 0 ? <p className="sp-muted">No invoices yet. They are created automatically on each billing date.</p> :
        <div className="sp-table-wrap"><table className="sp-table">
          <thead><tr><th>Invoice</th><th>Status</th><th>Due</th><th className="sp-num">Total</th><th className="sp-num">Paid</th></tr></thead>
          <tbody>{s.invoices.map((i) => (
            <tr key={i.id}><td><Link to={`/staff/invoices/${i.id}`}>{i.invoice_number}</Link></td>
              <td><Status value={i.status} /></td><td>{fmtDate(i.due_date)}</td>
              <td className="sp-num">{inr(i.total_amount)}</td><td className="sp-num">{inr(i.amount_paid)}</td></tr>))}</tbody>
        </table></div>}

      <h2>History</h2>
      <ul className="sp-timeline">
        {s.history.map((h) => (
          <li key={h.id}><b>{h.to_status}</b> · {fmtDate(h.changed_at)} · {h.changed_by_name || 'System'}
            {h.note && <span className="sp-muted"> — {h.note}</span>}</li>))}
      </ul>

      {ask && <PromptModal {...ask} onSubmit={ask.go} onClose={() => setAsk(null)} />}
    </>
  );
}