import { NavLink, Outlet } from 'react-router-dom';
import { staff, clearSession } from '../../../services/staffApi';
import { useLoad } from '../../../components/staffPortal/ui';
import './staffPortal.css';

const links = [
  ['/staff', 'Overview', true],
  ['/staff/quotations', 'Quotation requests'],
  ['/staff/subscriptions', 'Subscriptions'],
  ['/staff/invoices', 'Invoices'],
];

export default function StaffLayout() {
  const { data: me } = useLoad(() => staff.get('/profile'), []);
  const signOut = () => { clearSession(); window.location.assign('/login'); };
  return (
    <div className="sp-app">
      <aside className="sp-side">
        <div className="sp-brand">Bright<span>loop</span></div>
        {links.map(([to, label, end]) => (
          <NavLink key={to} to={to} end={end}>{label}</NavLink>
        ))}
        <div className="sp-who">
          {me?.name}
          <div><button className="sp-btn sp-ghost" onClick={signOut}>Sign out</button></div>
        </div>
      </aside>
      <main><Outlet /></main>
    </div>
  );
}