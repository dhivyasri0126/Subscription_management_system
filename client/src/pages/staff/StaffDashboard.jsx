import DashboardLayout from "../../components/DashboardLayout";
import { useAuth } from "../authentication/AuthContext";

export default function StaffDashboard() {
  const { user } = useAuth();

  return (
    <DashboardLayout role="staff">
      <h1>Staff dashboard</h1>
      <p className="dash-sub">Signed in as {user?.email}. This is a placeholder page.</p>

      <div className="dash-grid">
        <div className="dash-card"><h3>Renewals due</h3><p>Customers whose plans renew soon.</p></div>
        <div className="dash-card"><h3>Failed payments</h3><p>Follow up on payments that did not go through.</p></div>
      </div>
    </DashboardLayout>
  );
}