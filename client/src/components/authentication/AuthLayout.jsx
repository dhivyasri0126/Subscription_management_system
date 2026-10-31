const renewals = [
  { plan: "Pro plan", who: "Greenleaf Traders", when: "Renews in 3 days", tone: "soon" },
  { plan: "Starter plan", who: "Kavin Bakery", when: "Renews in 12 days", tone: "ok" },
  { plan: "Business plan", who: "Nila Clinic", when: "Payment failed", tone: "late" },
];

export default function AuthLayout({ title, subtitle, children, footer }) {
  return (
    <div className="auth-shell">
      <aside className="auth-aside">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          Subscription Manager
        </div>

        <div className="aside-body">
          <h2>Know what renews, and when.</h2>
          <p>
            Track customers, plans and billing cycles in one place, so nothing lapses by surprise.
          </p>

          <ul className="renewal-list" aria-hidden="true">
            {renewals.map((r) => (
              <li key={r.who} className={`renewal renewal-${r.tone}`}>
                <div>
                  <strong>{r.who}</strong>
                  <span>{r.plan}</span>
                </div>
                <em>{r.when}</em>
              </li>
            ))}
          </ul>
        </div>
      </aside>

      <main className="auth-main">
        <div className="auth-card">
          <h1>{title}</h1>
          <p className="auth-sub">{subtitle}</p>
          {children}
          <p className="auth-footer">{footer}</p>
        </div>
      </main>
    </div>
  );
}