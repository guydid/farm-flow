// העלאת חשבונית ספק ל-Invoice Maven כהוצאה (POST /api/integrations/maven/expense).
import { getToken } from '@/api/localClient';

const BASE_URL = import.meta.env.VITE_API_URL || '/api';

async function call(path, init = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}`, ...(init.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(data.error || `HTTP ${res.status}`);
    e.code = data.code || null;
    e.status = res.status;
    e.data = data;
    throw e;
  }
  return data;
}

// מצב האינטגרציה במשק (null אם לא נטען / אין הרשאה)
export async function getMavenConfig(farmId) {
  try {
    return await call(`/integrations/maven/config${farmId ? `?farm_id=${encodeURIComponent(farmId)}` : ''}`);
  } catch {
    return null;
  }
}

export function uploadInvoiceToMaven(invoice, { force = false } = {}) {
  return call('/integrations/maven/expense', {
    method: 'POST',
    body: JSON.stringify({ invoice_id: invoice.id, farm_id: invoice.farm_id || undefined, force }),
  });
}

// תיאור קצר להצגה בתג
export function mavenExpenseLabel(me) {
  if (!me) return '';
  const when = me.uploaded_at ? ` · ${me.uploaded_at.slice(8, 10)}/${me.uploaded_at.slice(5, 7)}` : '';
  if (me.test) return `נבדק מול Maven (מצב בדיקה)${when}`;
  return `${me.duplicate ? 'כבר קיים ב-Maven' : 'הועלה ל-Maven'}${me.expense_id ? ` · הוצאה ${me.expense_id}` : ''}${when}`;
}
