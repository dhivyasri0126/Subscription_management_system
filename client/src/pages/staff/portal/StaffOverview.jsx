import { Link } from 'react-router-dom';
import { staff } from '../../../services/staffApi';
import { useLoad, PageHead, Notice, inr } from '../../../components/staffPortal/ui';

export default function Dashboard() {
  const { data, error, loading } = useLoad(() => staff.get('/dashboard'), []);
  if (!data) return <Notice error={error} loading={loading} />;

  const queue = [
    [data.pending_quotations, 'quotation requests waiting for your review', '/staff/quotations'],
    [data.awaiting_activation, 'accepted subscriptions waiting to be activated', '/staff/subscriptions?status=confirmed'],
    [data.invoices_to_confirm, 'draft invoices to check and confirm', '/staff/invoices?status=draft'],
    [data.overdue_invoices, 'overdue invoices to follow up', '/staff/invoices?overdue=true', true],
  ];
  return (
    <>
      <PageHead title="Today’s work" />
      <div className="sp-queue">
        {queue.map(([n, label, to, warn]) => (
          <Link key={to} to={to} className={Number(n) === 0 ? 'sp-zero' : warn ? 'sp-warn' : ''}>
            <b>{n}</b><span>{Number(n) === 0 ? `No ${label.split(' waiting')[0].split(' to ')[0]}` : label}</span>
          </Link>
        ))}
      </div>
      <h2>This month</h2>
      <div className="sp-facts">
        <div><b>{data.active_subscriptions}</b><span className="sp-muted">active subscriptions</span></div>
        <div><b>{inr(data.collected_this_month)}</b><span className="sp-muted">collected so far</span></div>
      </div>
    </>
  );
}