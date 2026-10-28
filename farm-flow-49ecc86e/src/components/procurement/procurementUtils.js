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

export const DIRECTIONS = { purchase: "רכש", sale: "מכירה" };
export const DN_DIRECTIONS = { in: "נכנסת", out: "יוצאת" };
export const ORDER_STATUS = {
  draft: { label: "טיוטה", cls: "bg-gray-100 text-gray-700" },
  ordered: { label: "הוזמן", cls: "bg-blue-100 text-blue-800" },
  confirmed: { label: "אושר", cls: "bg-indigo-100 text-indigo-800" },
  partially_delivered: { label: "סופק חלקית", cls: "bg-amber-100 text-amber-800" },
  delivered: { label: "סופק", cls: "bg-green-100 text-green-800" },
  invoiced: { label: "חויב", cls: "bg-emerald-100 text-emerald-800" },
  cancelled: { label: "בוטל", cls: "bg-red-100 text-red-700" },
};
export const DN_STATUS = {
  expected: { label: "צפויה", cls: "bg-blue-100 text-blue-800" },
  received: { label: "נקלטה", cls: "bg-amber-100 text-amber-800" },
  checked: { label: "נבדקה", cls: "bg-green-100 text-green-800" },
  disputed: { label: "במחלוקת", cls: "bg-red-100 text-red-700" },
  invoiced: { label: "חויבה", cls: "bg-emerald-100 text-emerald-800" },
};
export const SOURCES = { app: "אפליקציה", whatsapp: "WhatsApp", email: "מייל", phone: "טלפון", agent: "סוכן AI", other: "אחר" };
export const UNITS = ["יח'", "ק\"ג", "ליטר", "שק", "קרטון", "משטח", "שתילים", "מ\"ל", "גרם", "גליל", "טון"];

export const money = (n) => { if (n === null || n === undefined || n === "" || Number.isNaN(Number(n))) return "—"; const v = Number(n); return `₪${v.toLocaleString("he-IL", { maximumFractionDigits: 2 })}`; };
export const fmtDate = (iso) => { if (!iso) return ""; const [y, m, d] = String(iso).slice(0, 10).split("-"); return `${d}/${m}/${y}`; };
export const todayIso = () => new Date().toISOString().slice(0, 10);
export const addDays = (iso, n) => new Date(Date.parse(iso) + n * 86400000).toISOString().slice(0, 10);
export const daysUntil = (iso) => Math.round((Date.parse(String(iso).slice(0, 10)) - Date.parse(todayIso())) / 86400000);
// קובץ שהועלה דרך /api/upload נגיש רק עם טוקן
export const fileHref = (url) => (url ? `${url}${url.includes("?") ? "&" : "?"}token=${encodeURIComponent(getToken() || "")}` : null);
export const isImage = (url) => /\.(jpe?g|png|gif|webp|heic|heif)(\?|$)/i.test(String(url || ""));
export const partyOf = (rec) => rec?.counterparty_name || "—";
export const lineTotal = (it) => (Number(it?.quantity) || 0) * (Number(it?.unit_price) || 0);
