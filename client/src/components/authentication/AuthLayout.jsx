const RENEWALS = [
  { name: "Greenleaf Traders", plan: "Pro plan", status: "Renews in 3 days", tone: "soon", fill: "88%" },
  { name: "Kavin Bakery", plan: "Starter plan", status: "Renews in 12 days", tone: "ok", fill: "42%" },
  { name: "Nila Clinic", plan: "Business plan", status: "Payment failed", tone: "late", fill: "100%" },
];

export default function AuthLayout({ title, subtitle, footer, children }) {
  return (
    <div className="auth-shell">
      <aside className="auth-aside">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          SubscriptionManager
        </div>

        <div className="aside-body">
          <h2>Know what renews, and when.</h2>
          <p>Track customers, plans and billing cycles in one place, so nothing lapses by surprise.</p>

          <ul className="renewal-list" aria-hidden="true">
            {RENEWALS.map((r, i) => (
              <li
                key={r.name}
                className={`renewal renewal-${r.tone}`}
                style={{ "--d": `${0.3 + i * 0.14}s`, "--fill": r.fill }}
              >
                <div>
                  <strong>{r.name}</strong>
                  <span>{r.plan}</span>
                </div>
                <em>{r.status}</em>
                <div className="renewal-bar"><i /></div>
              </li>
            ))}
          </ul>
        </div>

        <div className="aside-foot">© {new Date().getFullYear()} SubscriptionManager</div>
      </aside>

      <main className="auth-main">
        <div className="auth-card">
          <h1>{title}</h1>
          {subtitle && <p className="auth-sub">{subtitle}</p>}
          {children}
          {footer && <p className="auth-footer">{footer}</p>}
        </div>
      </main>
    </div>
  );
}