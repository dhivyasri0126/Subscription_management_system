// React side: all calls to the backend live here.
const API = import.meta.env.VITE_API_URL;

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

export const loginRequest = ({ identifier, password, role }) =>
  post("/api/auth/login", { email: identifier, password, role });