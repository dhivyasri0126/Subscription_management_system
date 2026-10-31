import { createContext, useContext, useState } from "react";

/*
  DEMO AUTH (localStorage only).
  Replace the bodies of register() and login() with your real API calls
  (fetch / axios) when your backend is ready.
*/

const USERS_KEY = "sms_users";
const SESSION_KEY = "sms_session";

const seedUsers = [
  { id: 1, name: "Admin", username: "admin", email: "admin@demo.com", password: "admin123", role: "admin" },
  { id: 2, name: "Staff", username: "staff", email: "staff@demo.com", password: "staff123", role: "staff" },
];

function readUsers() {
  try {
    const raw = localStorage.getItem(USERS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  try {
    localStorage.setItem(USERS_KEY, JSON.stringify(seedUsers));
  } catch {
    /* ignore */
  }
  return seedUsers;
}

function readSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY));
  } catch {
    return null;
  }
}

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(readSession);

  const register = async ({ name, email, phone, businessType, password }) => {
    const users = readUsers();
    const cleanEmail = email.trim().toLowerCase();

    if (users.some((u) => u.email === cleanEmail)) {
      return { ok: false, error: "An account with this email already exists." };
    }

    const newUser = {
      id: Date.now(),
      name: name.trim(),
      username: cleanEmail.split("@")[0],
      email: cleanEmail,
      phone: phone.trim(),
      businessType,
      password,
      role: "customer", // public signup always creates a customer
    };

    localStorage.setItem(USERS_KEY, JSON.stringify([...users, newUser]));
    return { ok: true };
  };

  const login = async ({ identifier, password, role }) => {
    const id = identifier.trim().toLowerCase();
    const found = readUsers().find(
      (u) => (u.email === id || u.username.toLowerCase() === id) && u.password === password
    );

    if (!found) return { ok: false, error: "Incorrect username/email or password." };
    if (found.role !== role) {
      return { ok: false, error: `This account is not registered as ${role}.` };
    }

    const { password: _pw, ...safeUser } = found;
    localStorage.setItem(SESSION_KEY, JSON.stringify(safeUser));
    setUser(safeUser);
    return { ok: true, user: safeUser };
  };

  const logout = () => {
    localStorage.removeItem(SESSION_KEY);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, register, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}