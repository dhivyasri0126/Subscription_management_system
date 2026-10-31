import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { staff } from '../../../services/staffApi';
import { useLoad, PageHead, Notice, Pager, Status, inr, fmtDate } from '../../../components/staffPortal/ui';

export default function Subscriptions() {
  const [sp, setSp] = useSearchParams();
  const [page, setPage] = useState(1);
  const status = sp.get('status') || '';
  const search = sp.get('search') || '';
  const { data, error, loading } = useLoad(() => staff.get('/subscriptions', { status, search, page }), [status, search, page]);
  const upd = (k, v) => { const n = new URLSearchParams(sp); v ? n.set(k, v) : n.delete(k); setSp(n); setPage(1); };

  return (
    <>
      <PageHead title="Subscriptions" />
      <div className="sp-filters">
        <select value={status} onChange={(e) => upd('status', e.target.value)} aria-label="Status">
          <option value="">All statuses</option>
          {['draft', 'quotation', 'confirmed', 'active', 'closed'].map((s) => <option key={s}>{s}</option>)}
        </select>
        <input placeholder="Search number or customer" defaultValue={search}
               onKeyDown={(e) => e.key === 'Enter' && upd('search', e.target.value)} />
      </div>
      <Notice error={error} loading={loading} />
      {data && (data.data.length === 0 ? <p className="sp-muted">No subscriptions match these filters.</p> :
        <div className="sp-table-wrap"><table className="sp-table">
          <thead><tr><th>Number</th><th>Customer</th><th>Plan</th><th>Status</th><th>Next billing</th><th className="sp-num">Total</th></tr></thead>
          <tbody>{data.data.map((s) => (
            <tr key={s.id}>
              <td><Link to={`/staff/subscriptions/${s.id}`}>{s.subscription_number}</Link></td>
              <td>{s.customer_name}</td><td>{s.plan_name}</td>
              <td><Status value={s.status} />{s.is_paused && ' (paused)'}</td>
              <td>{fmtDate(s.next_billing_date)}</td><td className="sp-num">{inr(s.total_amount)}</td>
            </tr>))}</tbody>
        </table></div>)}
      {data && <Pager page={page} pages={data.pages} onChange={setPage} />}
    </>
  );
}