// זיהוי פרטים מחדש לחשבונית קיימת (POST /api/invoices/:id/reextract).
import { getToken } from '@/api/localClient';

const BASE_URL = import.meta.env.VITE_API_URL || '/api';

export async function reextractInvoice(id, { overwrite = false } = {}) {
  const res = await fetch(`${BASE_URL}/invoices/${id}/reextract`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
    body: JSON.stringify({ overwrite }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) {
    const e = new Error(data.error || `HTTP ${res.status}`);
    e.status = res.status;
    throw e;
  }
  return data;
}

// חשבונית שהזיהוי לא מילא בה פרטים (אין סכום ואין ספק)
export const isMissingData = (inv) =>
  (inv.total === null || inv.total === undefined || inv.total === '') && !inv.supplier_name && !inv.supplier_id;
