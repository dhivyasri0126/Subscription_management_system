import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { staff } from '../../../services/staffApi';
import { useLoad, PageHead, Notice, Pager, Status, inr, fmtDate } from '../../../components/staffPortal/ui';

export default function Invoices() {
  const [sp, setSp] = useSearchParams();
  const [page, setPage] = useState(1);
  const status = sp.get('status') || '';
  const overdue = sp.get('overdue') || '';
  const search = sp.get('search') || '';
  const { data, error, loading } = useLoad(
    () => staff.get('/invoices', { status, overdue, search, page }), [status, overdue, search, page]);
  const upd = (k, v) => { const n = new URLSearchParams(sp); v ? n.set(k, v) : n.delete(k); setSp(n); setPage(1); };

  return (
    <>
      <PageHead title="Invoices" />
      <div className="sp-filters">
        <select value={status} onChange={(e) => upd('status', e.target.value)} aria-label="Status">
          <option value="">All statuses</option>
          {['draft', 'confirmed', 'paid', 'cancelled'].map((s) => <option key={s}>{s}</option>)}
        </select>
        <select value={overdue} onChange={(e) => upd('overdue', e.target.value)} aria-label="Overdue">
          <option value="">Overdue and not</option>
          <option value="true">Overdue only</option>
        </select>
        <input placeholder="Search invoice or customer" defaultValue={search}
               onKeyDown={(e) => e.key === 'Enter' && upd('search', e.target.value)} />
      </div>
      <Notice error={error} loading={loading} />
      {data && (data.data.length === 0 ? <p className="sp-muted">No invoices match these filters.</p> :
        <div className="sp-table-wrap"><table className="sp-table">
          <thead><tr><th>Invoice</th><th>Customer</th><th>Status</th><th>Due</th><th className="sp-num">Total</th><th className="sp-num">Balance</th></tr></thead>
          <tbody>{data.data.map((i) => (
            <tr key={i.id}>
              <td><Link to={`/staff/invoices/${i.id}`}>{i.invoice_number}</Link></td>
              <td>{i.customer_name}</td>
              <td><Status value={i.status} />{i.is_overdue && <> <span className="sp-badge sp-b-overdue">overdue</span></>}</td>
              <td>{fmtDate(i.due_date)}</td>
              <td className="sp-num">{inr(i.total_amount)}</td><td className="sp-num">{inr(i.balance_due)}</td>
            </tr>))}</tbody>
        </table></div>)}
      {data && <Pager page={page} pages={data.pages} onChange={setPage} />}
    </>
  );
}