// React side: all auth calls to the backend live here, and so does the saved login session.
const API = import.meta.env.VITE_API_URL || "http://localhost:5000";

/* ---------- session (single source of truth for the token) ---------- */
export const TOKEN_KEY = "token";
export const USER_KEY = "user";

export function saveSession({ token, user }) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch {
    /* storage unavailable */
  }
}

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function getUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY));
  } catch {
    return null;
  }
}

export function clearSession() {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  } catch {
    /* ignore */
  }
}

// Where each role lands after login.
export const homePathForRole = (role) =>
  ({ admin: "/admin", staff: "/staff", customer: "/customer" })[role] || "/login";

/* ---------- requests ---------- */
async function post(path, body) {
  try {
    const r = await fetch(`${API}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await r.json().catch(() => ({}));
    return r.ok
      ? { ok: true, ...data }
      : { ok: false, error: data.error || "Request failed.", fields: data.fields };
  } catch {
    return { ok: false, error: "Cannot reach the server. Check your connection." };
  }
}

export const registerRequest = (form) =>
  post("/api/auth/register", {
    name: form.name,
    email: form.email,
    phone: form.phone,
    address: form.address,
    businessType: form.businessType,
    password: form.password,
  });

// On success the token and user are saved here, so every page (and customerApi)
// reads the same values no matter how the Login page stores things.
export async function loginRequest({ identifier, password, role }) {
  const res = await post("/api/auth/login", { email: identifier, password, role });
  if (res.ok && res.token) saveSession({ token: res.token, user: res.user });
  return res;
}