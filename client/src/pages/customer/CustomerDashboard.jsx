import DashboardLayout from "../../components/DashboardLayout";
import { useAuth } from "../authentication/AuthContext";

export default function CustomerDashboard() {
  const { user } = useAuth();

  return (
    <DashboardLayout role="customer">
      <h1>Welcome, {user?.name}</h1>
      <p className="dash-sub">This is a placeholder page. Your subscriptions will appear here.</p>

      <div className="dash-grid">
        <div className="dash-card">
          <h3>Your details</h3>
          <dl className="dash-details">
            <dt>Email</dt><dd>{user?.email}</dd>
            <dt>Phone</dt><dd>{user?.phone}</dd>
            <dt>Address</dt><dd>{user?.address}</dd>
            <dt>Business type</dt><dd>{user?.businessType}</dd>
          </dl>
        </div>
        <div className="dash-card"><h3>My subscriptions</h3><p>No subscriptions yet.</p></div>
      </div>
    </DashboardLayout>
  );
}