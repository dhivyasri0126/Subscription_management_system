const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

const SESSION_KEY = "sms_session";

function getToken() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY))?.token || "";
  } catch {
    return "";
  }
}

export async function adminRequest(path, options = {}) {
  const response = await fetch(`${API_URL}/api/admin${path}`, {
    ...options,
    headers: {
      ...options.headers,
      "Content-Type": "application/json",
      Authorization: `Bearer ${getToken()}`,
    },
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "Something went wrong.");
  }

  return data;
}

export const getAdminDashboard = () =>
  adminRequest("/dashboard");

export const getAdminResource = (resource, search = "") =>
  adminRequest(`/${resource}?search=${encodeURIComponent(search)}`);

export const createAdminResource = (resource, body) =>
  adminRequest(`/${resource}`, {
    method: "POST",
    body: JSON.stringify(body),
  });

export const getPlanStaff = (planId) =>
  adminRequest(`/plans/${encodeURIComponent(planId)}/staff`);

export const savePlanStaff = (planId, staffIds) =>
  adminRequest(`/plans/${encodeURIComponent(planId)}/staff`, {
    method: "PUT",
    body: JSON.stringify({ staffIds }),
  });

export const getProductStaff = (productId) =>
  adminRequest(`/products/${encodeURIComponent(productId)}/staff`);

export const saveProductStaff = (productId, staffIds) =>
  adminRequest(`/products/${encodeURIComponent(productId)}/staff`, {
    method: "PUT",
    body: JSON.stringify({ staffIds }),
  });

export const getAdminLookups = () =>
  adminRequest("/lookups");

export const updateAdminResource = (resource, id, body) =>
  adminRequest(`/${resource}/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });

export const deleteAdminResource = (resource, id) =>
  adminRequest(`/${resource}/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });

export const runInvoiceAction = (invoiceId, action) =>
  adminRequest(`/invoices/${encodeURIComponent(invoiceId)}/action`, {
    method: "PATCH",
    body: JSON.stringify({ action }),
  });

export const generateInvoice = (body) =>
  adminRequest("/invoices/generate", {
    method: "POST",
    body: JSON.stringify(body),
  });

export async function downloadInvoicePdf(invoiceId) {
  const response = await fetch(
    `${API_URL}/api/admin/invoices/${encodeURIComponent(invoiceId)}/pdf`,
    {
      headers: { Authorization: `Bearer ${getToken()}` },
    }
  );
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "Could not generate the invoice PDF.");
  }
  return response.blob();
}
