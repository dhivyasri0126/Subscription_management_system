import { Navigate } from "react-router-dom";
import { useAuth } from "./AuthContext";
import { ROLE_HOME } from "./roles";

// Wrap a page: <ProtectedRoute allow={["admin"]}><AdminHome /></ProtectedRoute>
// Not logged in -> /login.  Wrong role -> that user's own home page.
export default function ProtectedRoute({ allow, children }) {
  const { user } = useAuth();

  if (!user) return <Navigate to="/login" replace />;
  if (!allow.includes(user.role)) return <Navigate to={ROLE_HOME[user.role] || "/login"} replace />;

  return children;
}