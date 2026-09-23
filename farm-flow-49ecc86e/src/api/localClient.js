import { queryClientInstance } from '@/lib/query-client';

export const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

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

export async function apiFetch(url, options = {}) {
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

// טעינה מרוכזת — כמה רשימות/רשומות בבקשת רשת אחת.
// requests: [{ entity, filter?, sort?, id? }]  →  מערך תוצאות באותו סדר ([] / null בכישלון)
export async function batchFetch(requests) {
  const payload = requests.map(r => r.id
    ? { entity: r.entity, id: String(r.id) }
    : { entity: r.entity, params: { ...(r.filter || {}), ...(r.sort ? { sort: String(r.sort) } : {}) } });
  const res = await apiFetch(`${BASE_URL}/batch`, { method: 'POST', body: JSON.stringify({ requests: payload }) });
  const results = Array.isArray(res?.results) ? res.results : [];
  return requests.map((r, i) => {
    const out = results[i];
    if (out?.ok) return out.data;
    console.warn(`batch ${r.entity} failed:`, out?.error);
    return r.id ? null : [];
  });
}

export function createEntity(entityName) {
  const base = `${BASE_URL}/${entityName}`;
  return {
    list: () => apiFetch(base),
    get: (id) => apiFetch(`${base}/${id}`),
    create: (data) => apiFetch(base, { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => apiFetch(`${base}/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id) => apiFetch(`${base}/${id}`, { method: 'DELETE' }),
    filter: (conditions, sort) => {
      const entries = Object.entries(conditions || {})
        .filter(([, v]) => v != null)
        .map(([k, v]) => [k, String(v)]);
      if (sort) entries.push(['sort', String(sort)]);
      const params = new URLSearchParams(entries);
      return apiFetch(`${base}?${params}`);
    },
    bulkCreate: (items) => apiFetch(base, { method: 'POST', body: JSON.stringify(items) }),
    // עדכון מרוכז: [{ id, ...שדות לעדכון }] — בקשת רשת אחת
    bulkUpdate: (items) => apiFetch(base, { method: 'PATCH', body: JSON.stringify(items) }),
  };
}

export const localAuth = {
  me: () => apiFetch(`${BASE_URL}/auth/me`),
  updateMyUserData: async (data) => {
    const res = await apiFetch(`${BASE_URL}/auth/me`, { method: 'PUT', body: JSON.stringify(data) });
    // Cached ['me'] is now stale — drop it so the next read refetches.
    try { queryClientInstance.invalidateQueries({ queryKey: ['me'] }); } catch (_) {}
    return res;
  },
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
