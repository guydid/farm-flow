const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

const TOKEN_KEY = 'farm_flow_token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

async function apiFetch(url, options = {}) {
  const token = getToken();
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(url, { ...options, headers });

  if (res.status === 401) {
    const err = await res.json().catch(() => ({}));
    const error = Object.assign(new Error(err.error || 'Unauthorized'), {
      status: 401,
      type: 'auth_required',
    });
    throw error;
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw Object.assign(new Error(err.error || res.statusText), { status: res.status });
  }

  return res.json();
}

export function createEntity(entityName) {
  const base = `${BASE_URL}/${entityName}`;
  return {
    list: () => apiFetch(base),
    get: (id) => apiFetch(`${base}/${id}`),
    create: (data) => apiFetch(base, { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => apiFetch(`${base}/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id) => apiFetch(`${base}/${id}`, { method: 'DELETE' }),
    filter: (conditions) => {
      const params = new URLSearchParams(
        Object.entries(conditions)
          .filter(([, v]) => v != null)
          .map(([k, v]) => [k, String(v)])
      );
      return apiFetch(`${base}?${params}`);
    },
    bulkCreate: (items) => apiFetch(base, { method: 'POST', body: JSON.stringify(items) }),
  };
}

export const localAuth = {
  me: () => apiFetch(`${BASE_URL}/auth/me`),
  updateMyUserData: (data) =>
    apiFetch(`${BASE_URL}/auth/me`, { method: 'PUT', body: JSON.stringify(data) }),
  login: async (email, password) => {
    const res = await apiFetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    setToken(res.token);
    return res.user;
  },
  register: async (email, password, full_name) => {
    const res = await apiFetch(`${BASE_URL}/auth/register`, {
      method: 'POST',
      body: JSON.stringify({ email, password, full_name }),
    });
    setToken(res.token);
    return res.user;
  },
  logout: () => {
    clearToken();
    window.location.href = '/login';
  },
  redirectToLogin: () => {
    window.location.href = '/login';
  },
  isAuthenticated: () => !!getToken(),
  adminResetPassword: (userId, newPassword) =>
    apiFetch(`${BASE_URL}/admin/users/${userId}`, {
      method: 'PUT',
      body: JSON.stringify({ new_password: newPassword }),
    }),
  googleConfig: () =>
    apiFetch(`${BASE_URL}/auth/google/config`).catch(() => ({ enabled: false })),
};
