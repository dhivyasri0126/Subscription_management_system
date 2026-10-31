import { useState } from 'react';
import { staff } from '../../../services/staffApi';
import { useLoad, PageHead, Notice, Modal, Pager, inr, fmtDate } from '../../../components/staffPortal/ui';

function Review({ id, onClose, onDone }) {
  const { data: q, error, loading } = useLoad(() => staff.get(`/subscriptions/${id}`), [id]);
  const [f, setF] = useState({ start_date: '', expiry_date: '', reason: '' });
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const act = async (kind) => {
    setBusy(true); setMsg('');
    try {
      await staff.post(`/quotations/${id}/${kind}`,
        kind === 'accept' ? { start_date: f.start_date, expiry_date: f.expiry_date } : { reason: f.reason });
      onDone();
    } catch (e) { setMsg(e.message); setBusy(false); }
  };

  return (
    <Modal title={q ? `${q.subscription_number} for ${q.customer.name}` : 'Quotation'} onClose={onClose}>
      <Notice error={error} loading={loading} />
      {q && (<>
        <p className="sp-muted">{q.plan_name} ({q.billing_period}) · valid until {fmtDate(q.quotation_valid_until)}</p>
        <div className="sp-table-wrap"><table className="sp-table">
          <thead><tr><th>Product</th><th className="sp-num">Qty</th><th className="sp-num">Price</th><th className="sp-num">Amount</th></tr></thead>
          <tbody>{q.lines.map((l) => (
            <tr key={l.id}>
              <td>{l.product_name}{l.variant_value && ` (${l.attribute}: ${l.variant_value})`}</td>
              <td className="sp-num">{l.quantity}</td><td className="sp-num">{inr(l.unit_price)}</td><td className="sp-num">{inr(l.amount)}</td>
            </tr>))}</tbody>
        </table></div>
        <div className="sp-totals">
          <div><span>Untaxed</span><span>{inr(q.untaxed_amount)}</span></div>
          <div><span>Tax</span><span>{inr(q.tax_amount)}</span></div>
          <div className="sp-grand"><span>Total</span><span>{inr(q.total_amount)}</span></div>
        </div>
        <h2>Accept</h2>
        <div className="sp-kv">
          <label>Start date<input type="date" value={f.start_date} onChange={set('start_date')} /></label>
          <label>Expiry date<input type="date" value={f.expiry_date} onChange={set('expiry_date')} /></label>
        </div>
        <button className="sp-btn" disabled={busy || !f.start_date || !f.expiry_date} onClick={() => act('accept')}>Accept quotation</button>
        <h2>Or reject</h2>
        <label>Reason the customer will see<input value={f.reason} onChange={set('reason')} /></label>
        <button className="sp-btn sp-danger" disabled={busy || !f.reason.trim()} onClick={() => act('reject')}>Reject quotation</button>
        {msg && <p className="sp-err">{msg}</p>}
      </>)}
    </Modal>
  );
}

export default function Quotations() {
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(null);
  const { data, error, loading, reload } = useLoad(() => staff.get('/quotations', { page }), [page]);
  return (
    <>
      <PageHead title="Quotation requests" />
      <Notice error={error} loading={loading} />
      {data && (data.data.length === 0
        ? <p className="sp-muted">No requests are waiting. New customer requests for your products will appear here.</p>
        : <div className="sp-table-wrap"><table className="sp-table">
            <thead><tr><th>Number</th><th>Customer</th><th>Plan</th><th className="sp-num">Total</th><th>Valid until</th><th /></tr></thead>
            <tbody>{data.data.map((r) => (
              <tr key={r.id}>
                <td>{r.subscription_number}</td><td>{r.customer_name}</td><td>{r.plan_name}</td>
                <td className="sp-num">{inr(r.total_amount)}</td><td>{fmtDate(r.quotation_valid_until)}</td>
                <td><button className="sp-btn" onClick={() => setOpen(r.id)}>Review</button></td>
              </tr>))}</tbody>
          </table></div>)}
      {data && <Pager page={page} pages={data.pages} onChange={setPage} />}
      {open && <Review id={open} onClose={() => setOpen(null)} onDone={() => { setOpen(null); reload(); }} />}
    </>
  );
}