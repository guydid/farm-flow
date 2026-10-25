import { getToken } from "@/api/localClient";

export const BASE_URL = import.meta.env.VITE_API_URL || "/api";

export async function apiFetch(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}`, ...(options.headers || {}) },
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = { error: text.slice(0, 200) }; }
  if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { status: res.status, data });
  return data;
}

export const DIRECTIONS = { pay: "אנחנו שוכרים (משלמים)", receive: "אנחנו משכירים (מקבלים)" };
export const ASSET_TYPES = { land: "קרקע / חלקה", building: "מבנה / מחסן", housing: "דיור", equipment: "ציוד / כלי", vehicle: "רכב", other: "אחר" };
export const FREQUENCIES = { monthly: "חודשי", quarterly: "רבעוני", yearly: "שנתי", once: "חד-פעמי" };
export const STATUSES = { active: "פעיל", draft: "טיוטה", ended: "הסתיים" };
export const METHODS = { transfer: "העברה בנקאית", cheque: "צ'ק", cash: "מזומן", credit: "אשראי", standing_order: "הוראת קבע", other: "אחר" };
export const METER_TYPES = { electricity: { label: "חשמל", unit: "קוט\"ש" }, water: { label: "מים", unit: "מ\"ק" }, gas: { label: "גז", unit: "מ\"ק" }, other: { label: "אחר", unit: "יח'" } };
export const KINDS = { rent: "שכירות", housing: "מגורי עובדים", electricity: "חשמל", water: "מים", gas: "גז", other: "חיוב", credit: "זיכוי" };
// סוגים שמוזנים כסכום חיובי אך נשמרים כסכום שלילי (מקזזים את החוב)
export const CREDIT_KINDS = new Set(["credit"]);
export const PAYMENT_STATUS = {
  due: { label: "ממתין", cls: "bg-blue-100 text-blue-800" },
  overdue: { label: "באיחור", cls: "bg-red-100 text-red-800" },
  paid: { label: "שולם", cls: "bg-green-100 text-green-800" },
  cancelled: { label: "בוטל", cls: "bg-gray-100 text-gray-600" },
};

export const money = (n) => { const v = Number(n) || 0; const s = `₪${Math.abs(v).toLocaleString("he-IL", { maximumFractionDigits: 0 })}`; return v < 0 ? `−${s}` : s; };
export const fmtDate = (iso) => { if (!iso) return ""; const [y, m, d] = String(iso).slice(0, 10).split("-"); return `${d}/${m}/${y}`; };
export const todayIso = () => new Date().toISOString().slice(0, 10);
export const daysUntil = (iso) => Math.round((Date.parse(String(iso).slice(0, 10)) - Date.parse(todayIso())) / 86400000);
