
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

const BASE = (() => {
  const url = API_URL.replace(/\/+$/, '');
  return url.endsWith('/api') ? url : `${url}/api`;
})();

const TOKEN_KEYS = [
  'token',
  'authToken',
  'accessToken',
  'access_token',
  'jwt'
];

function getToken() {

  // 1. Read the actual session used by AuthContext
  try {
    const session = JSON.parse(
      localStorage.getItem('sms_session') || 'null'
    );

    if (session?.token) {
      return session.token;
    }
  } catch {
    console.error('Unable to read sms_session');
  }

  // 2. Check other common token keys
  for (const key of TOKEN_KEYS) {
    const token =
      localStorage.getItem(key) ||
      sessionStorage.getItem(key);

    if (token) return token;
  }

  // 3. Check tokens stored inside other auth objects
  for (const key of ['user', 'auth', 'authUser']) {
    try {
      const stored =
        localStorage.getItem(key) ||
        sessionStorage.getItem(key);

      if (!stored) continue;

      const obj = JSON.parse(stored);

      const token =
        obj?.token ||
        obj?.accessToken ||
        obj?.access_token ||
        obj?.jwt;

      if (token) return token;

    } catch {
      // Ignore invalid JSON
    }
  }

  return '';
}

export function clearSession() {
  [
    ...TOKEN_KEYS,
    'sms_session',
    'user',
    'auth',
    'authUser'
  ].forEach((key) => {
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
  });
}

async function call(path, { method = 'GET', body, params } = {}) {

  const cleanParams = params
    ? Object.entries(params).filter(
        ([, value]) => value !== '' && value != null
      )
    : [];

  const queryString = cleanParams.length
    ? `?${new URLSearchParams(cleanParams)}`
    : '';

  const endpoint = path.startsWith('/') ? path : `/${path}`;

  const url = `${BASE}/staff${endpoint}${queryString}`;

  const token = getToken();

  console.log('STAFF API REQUEST:', {
    url,
    method,
    tokenExists: Boolean(token)
  });

  const headers = {};

  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let response;

  try {
    response = await fetch(url, {
      method,
      headers,
      body: body !== undefined
        ? JSON.stringify(body)
        : undefined
    });
  } catch (error) {
    console.error('STAFF API NETWORK ERROR:', error);
    throw new Error('Unable to connect to backend.');
  }

  const data = await response.json().catch(() => ({}));

  console.log('STAFF API RESPONSE:', {
    status: response.status,
    data
  });

  // Keep automatic logout disabled during debugging.
  if (!response.ok) {
    throw new Error(
      data.message ||
      data.error ||
      `Request failed: ${response.status}`
    );
  }

  return data;
}

export const staff = {
  get: (path, params) =>
    call(path, { method: 'GET', params }),

  post: (path, body = {}) =>
    call(path, { method: 'POST', body }),

  put: (path, body = {}) =>
    call(path, { method: 'PUT', body })
};
