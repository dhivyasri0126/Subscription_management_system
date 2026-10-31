import { createContext, useContext, useState } from "react";
import { registerRequest, loginRequest } from "../../services/authApi"; // adjust the path if your folders differ

const SESSION_KEY = "sms_session";

function readSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY));
  } catch {
    return null;
  }
}

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(readSession); // { token, user }

  const register = (form) => registerRequest(form);

  // Checks email, password and role against the database (users + customers).
  const login = async (form) => {
    const res = await loginRequest(form);
    if (!res.ok) return res;

    const next = { token: res.token, user: res.user };
    localStorage.setItem(SESSION_KEY, JSON.stringify(next));
    setSession(next);
    return { ok: true, user: res.user };
  };

  const logout = () => {
    localStorage.removeItem(SESSION_KEY);
    setSession(null);
  };

  return (
    <AuthContext.Provider
      value={{ user: session?.user ?? null, token: session?.token ?? null, register, login, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}