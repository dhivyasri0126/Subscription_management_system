import { useAuth } from "./authentication/AuthContext";

/* Placeholder so login has somewhere to go. Replace with your real dashboards. */
export default function Dashboard() {
  const { user, logout } = useAuth();

  return (
    <div className="placeholder-page">
      <h1>Hello, {user.name}</h1>
      <p>
        You are logged in as <strong>{user.role}</strong>.
      </p>
      <button className="btn-primary" onClick={logout}>
        Log out
      </button>
    </div>
  );
}