/*
  All calls to /api/customer/* live here.
  The saved login token comes from authApi.js, so there is one source of truth.
*/
import { getToken, clearSession } from "./authApi";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

// Re-exported so existing imports (CustomerLayout) keep working.
export { getToken, clearSession };

export class ApiError extends Error {
  constructor(message, status, fields) {
    super(message);
    this.status = status;
    this.fields = fields || {};
  }
}

const qs = (params = {}) => {
  const clean = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "");
  return clean.length ? `?${new URLSearchParams(clean)}` : "";
};

async function request(path, { method = "GET", body } = {}) {
  const token = getToken();
  let res;
  try {
    res = await fetch(`${API_URL}/api/customer${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError("Cannot reach the server. Please check your connection.", 0);
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON response */
  }

  if (res.status === 401) {
    clearSession();
    if (window.location.pathname !== "/login") window.location.assign("/login");
    throw new ApiError("Your session has expired. Please log in again.", 401);
  }
  if (!res.ok || data?.ok === false) {
    throw new ApiError(data?.error || "Something went wrong. Please try again.", res.status, data?.fields);
  }
  return data;
}

export const customerApi = {
  summary: () => request("/summary"),
  getProfile: () => request("/me"),
  updateProfile: (body) => request("/me", { method: "PUT", body }),

  plans: () => request("/plans"),
  products: () => request("/products"),
  createQuotation: (body) => request("/quotations", { method: "POST", body }),

  subscriptions: (params) => request(`/subscriptions${qs(params)}`),
  subscription: (id) => request(`/subscriptions/${id}`),

  invoices: (params) => request(`/invoices${qs(params)}`),
  invoice: (id) => request(`/invoices/${id}`),

  receipts: (params) => request(`/receipts${qs(params)}`),
  receipt: (id) => request(`/receipts/${id}`),
};