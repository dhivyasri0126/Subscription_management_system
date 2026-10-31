import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { customerApi, clearSession } from "../../services/customerApi";
import { useAsync } from "./useAsync";
import "../../styles/customer.css";

const NAV = [
  { to: "/customer", label: "Dashboard", end: true },
  { to: "/customer/request", label: "Request quotation" },
  { to: "/customer/subscriptions", label: "Subscriptions" },
  { to: "/customer/invoices", label: "Invoices" },
  { to: "/customer/receipts", label: "Receipts" },
  { to: "/customer/profile", label: "My profile" },
];

export default function CustomerLayout() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const { data } = useAsync(() => customerApi.getProfile(), []);
  const name = data?.profile?.name || "";

  const logout = () => {
    clearSession();
    navigate("/login", { replace: true });
  };

  return (
    <div className="cx-app">
      <header className="cx-topbar cx-noprint">
        <button className="cx-menu-btn" onClick={() => setOpen(!open)} aria-label="Toggle menu" aria-expanded={open}>
          ☰
        </button>
        <span className="cx-brand">
          <i className="cx-brand-mark" aria-hidden="true" /> SubscriptionManager
        </span>
      </header>

      <aside className={`cx-sidebar cx-noprint ${open ? "open" : ""}`}>
        <div className="cx-brand cx-brand--side">
          <i className="cx-brand-mark" aria-hidden="true" /> SubscriptionManager
        </div>

        <nav>
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} onClick={() => setOpen(false)}>
              {n.label}
            </NavLink>
          ))}
        </nav>

        <div className="cx-side-foot">
          {name && <span className="cx-user">{name}</span>}
          <button className="cx-btn cx-btn--ghost" onClick={logout}>
            Log out
          </button>
        </div>
      </aside>

      <main className="cx-main">
        <Outlet />
      </main>
    </div>
  );
}