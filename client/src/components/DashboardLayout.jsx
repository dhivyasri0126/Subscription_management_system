import { useNavigate } from "react-router-dom";
import { useAuth } from "../pages/authentication/AuthContext";
import "../styles/dashboard.css";

// Shared top bar + logout for the admin, staff and customer dummy pages.
export default function DashboardLayout({ role, children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate("/login", { replace: true });
  };

  return (
    <div className="dash">
      <header className="dash-bar">
        <div className="dash-brand">
          <span className="dash-mark" aria-hidden="true" />
          SubscriptionManager
        </div>

        <div className="dash-user">
          <span className={`dash-role dash-role-${role}`}>{role}</span>
          <span className="dash-name">{user?.name}</span>
          <button type="button" className="dash-logout" onClick={handleLogout}>
            Log out
          </button>
        </div>
      </header>

      <main className="dash-main">{children}</main>
    </div>
  );
}