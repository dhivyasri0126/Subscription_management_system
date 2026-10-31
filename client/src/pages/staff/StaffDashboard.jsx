import { Link } from 'react-router-dom';
import { useAuth } from '../authentication/AuthContext';
import { staff } from '../../services/staffApi';
import { useLoad, PageHead, Notice, inr, fmtDate } from '../../components/staffPortal/ui';
import { BarChart, Donut, compact } from '../../components/staffPortal/charts';

const load = async () => {
  const [d, sum, monthly, overdue, quotes, renewals] = await Promise.all([
    staff.get('/dashboard'),
    staff.get('/reports/summary'),
    staff.get('/reports/monthly'),
    staff.get('/overdue', { limit: 5 }),
    staff.get('/quotations', { limit: 5 }),
    staff.get('/subscriptions', { expiring_days: 30, limit: 5 }),
  ]);
  return { d, sum, monthly, overdue: overdue.data, quotes: quotes.data, renewals: renewals.data };
};

// last 6 months, oldest first, zero-filled
function monthSeries(rows) {
  const k = (d) => `${d.getFullYear()}-${d.getMonth()}`;
  const byMonth = new Map(rows.map((r) => [k(new Date(r.month)), Number(r.revenue_collected)]));
  return Array.from({ length: 6 }, (_, i) => {
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - (5 - i));
    return { label: d.toLocaleDateString('en-IN', { month: 'short' }), value: byMonth.get(k(d)) || 0 };
  });
}

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
};

export default function StaffDashboard() {
  const { user } = useAuth();
  const { data, error, loading, reload } = useLoad(load, []);
  const name = (user?.name || user?.email || '').split(/[ @]/)[0];

  if (!data) return <><PageHead title={`${greeting()}, ${name}`} /><Notice error={error} loading={loading} /></>;
  const { d, sum, monthly, overdue, quotes, renewals } = data;

  const series = monthSeries(monthly);
  const hasRevenue = series.some((s) => s.value > 0);
  const outstanding = Number(sum.outstanding_balance);
  const late = Number(sum.overdue_balance);
  const money = [
    { label: 'Collected this month', value: Number(d.collected_this_month), color: 'var(--teal)' },
    { label: 'Due, not yet late', value: Math.max(outstanding - late, 0), color: 'var(--amber)' },
    { label: 'Overdue', value: late, color: 'var(--red)' },
  ];
  const queue = [
    [d.pending_quotations, 'quotation requests to review', '/staff/quotations'],
    [d.awaiting_activation, 'accepted subscriptions to activate', '/staff/subscriptions?status=confirmed'],
    [d.invoices_to_confirm, 'draft invoices to confirm', '/staff/invoices?status=draft'],
    [d.overdue_invoices, 'overdue invoices to follow up', '/staff/invoices?overdue=true', true],
  ];

  return (
    <>
      <button className="sp-btn sp-ghost" onClick={reload}>
  ↻ Refresh
</button>

      <div className="sp-kpis">
        <div><small>Collected this month</small><b>{inr(d.collected_this_month)}</b></div>
        <div><small>Outstanding</small><b>{inr(sum.outstanding_balance)}</b><span>{sum.open_invoices} open invoices</span></div>
        <div className="sp-kpi-bad"><small>Overdue</small><b>{inr(sum.overdue_balance)}</b><span>{sum.overdue_invoices} invoices</span></div>
        <div><small>Active subscriptions</small><b>{d.active_subscriptions}</b></div>
      </div>

      <div className="sp-dgrid">
        <section className="sp-panel">
          <h2>Revenue collected, last 6 months</h2>
          {hasRevenue ? <BarChart data={series} /> : <p className="sp-muted">No payments yet. Recorded payments will draw this chart.</p>}
        </section>
        <section className="sp-panel">
          <h2>Money position</h2>
          <Donut segments={money} center={`₹${compact(money.reduce((a, s) => a + s.value, 0))}`} />
        </section>
      </div>

      <div className="sp-dgrid sp-even">
        <section className="sp-panel">
          <h2>Needs you today</h2>
          <div className="sp-queue">
            {queue.map(([n, label, to, warn]) => (
              <Link key={to} to={to} className={Number(n) === 0 ? 'sp-zero' : warn ? 'sp-warn' : ''}>
                <b>{n}</b><span>{label}</span>
              </Link>
            ))}
          </div>
        </section>
        <section className="sp-panel">
          <h2>Renewals due in 30 days</h2>
          {renewals.length === 0 ? <p className="sp-muted">No active subscriptions expire in the next 30 days.</p> :
            <table className="sp-table"><thead><tr><th>Subscription</th><th>Customer</th><th>Expires</th></tr></thead>
              <tbody>{renewals.map((s) => (
                <tr key={s.id}><td><Link to={`/staff/subscriptions/${s.id}`}>{s.subscription_number}</Link></td>
                  <td>{s.customer_name}</td><td>{fmtDate(s.expiry_date)}</td></tr>))}</tbody></table>}
        </section>
      </div>

      <div className="sp-dgrid sp-even">
        <section className="sp-panel">
          <h2>Overdue invoices</h2>
          {overdue.length === 0 ? <p className="sp-muted">Nothing is overdue.</p> :
            <table className="sp-table"><thead><tr><th>Invoice</th><th>Customer</th><th className="sp-num">Days late</th><th className="sp-num">Balance</th></tr></thead>
              <tbody>{overdue.map((o) => (
                <tr key={o.id}><td><Link to={`/staff/invoices/${o.id}`}>{o.invoice_number}</Link></td><td>{o.customer_name}</td>
                  <td className="sp-num">{o.days_overdue}</td><td className="sp-num">{inr(o.balance_due)}</td></tr>))}</tbody></table>}
        </section>
        <section className="sp-panel">
          <h2>Latest quotation requests</h2>
          {quotes.length === 0 ? <p className="sp-muted">No requests are waiting for review.</p> :
            <table className="sp-table"><thead><tr><th>Number</th><th>Customer</th><th className="sp-num">Total</th></tr></thead>
              <tbody>{quotes.map((q) => (
                <tr key={q.id}><td><Link to="/staff/quotations">{q.subscription_number}</Link></td>
                  <td>{q.customer_name}</td><td className="sp-num">{inr(q.total_amount)}</td></tr>))}</tbody></table>}
        </section>
      </div>
    </>
  );
}