import DashboardLayout from "../../components/DashboardLayout";
import { useAuth } from "../authentication/AuthContext";

export default function AdminDashboard() {
  const { user } = useAuth();

  return (
    <DashboardLayout role="admin">
      <h1>Admin dashboard</h1>
      <p className="dash-sub">Signed in as {user?.email}. This is a placeholder page.</p>

      <div className="dash-grid">
        <div className="dash-card"><h3>Customers</h3><p>Manage customer accounts.</p></div>
        <div className="dash-card"><h3>Staff</h3><p>Add and manage staff members.</p></div>
        <div className="dash-card"><h3>Subscriptions</h3><p>Plans, billing cycles and renewals.</p></div>
      </div>
    </DashboardLayout>
  );
}