// נתוני הדשבורד — טעינה אחת (batch) + חישובים משותפים לשתי התצוגות:
// "חדר בקרה" (מסך גדול) ו"היום במשק" (מסך קטן).
import { useCallback, useEffect, useState } from "react";
import { addDays, differenceInCalendarDays, format, parseISO, startOfWeek, subDays } from "date-fns";
import { getMeCached, getFarmCached } from "@/api/cachedReads";
import { batchFetch } from "@/api/localClient";
import { createPageUrl } from "@/utils";

/* ── תחומים (4): אגרונומי / עובדים / תפעולי / כספים ─────────────────────── */
export const SEGMENTS = {
  agronomic:   { key: "agronomic",   label: "אגרונומי", dot: "bg-green-500",  text: "text-green-700",  soft: "bg-green-50 border-green-200",   strong: "bg-green-600",  pill: "bg-green-100 text-green-700" },
  workers:     { key: "workers",     label: "עובדים",   dot: "bg-blue-500",   text: "text-blue-700",   soft: "bg-blue-50 border-blue-200",     strong: "bg-blue-600",   pill: "bg-blue-100 text-blue-700" },
  operational: { key: "operational", label: "תפעולי",   dot: "bg-amber-500",  text: "text-amber-700",  soft: "bg-amber-50 border-amber-200",   strong: "bg-amber-500",  pill: "bg-amber-100 text-amber-800" },
  money:       { key: "money",       label: "כספים",    dot: "bg-indigo-500", text: "text-indigo-700", soft: "bg-indigo-50 border-indigo-200", strong: "bg-indigo-600", pill: "bg-indigo-100 text-indigo-700" },
};
export const SEGMENT_ORDER = ["agronomic", "workers", "operational", "money"];

export const SEVERITY = {
  urgent: { rank: 0, label: "דחוף",   bar: "border-s-red-500",   text: "text-red-700",   dot: "bg-red-500" },
  soon:   { rank: 1, label: "בקרוב",  bar: "border-s-amber-500", text: "text-amber-700", dot: "bg-amber-500" },
  plan:   { rank: 2, label: "מתוכנן", bar: "border-s-green-500", text: "text-green-700", dot: "bg-green-500" },
};

const todayStr = () => format(new Date(), "yyyy-MM-dd");
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : parseFloat(v) || 0);
const safe = (a) => (Array.isArray(a) ? a.filter(Boolean) : []);

function daysUntil(dateStr) {
  if (!dateStr) return null;
  try { return differenceInCalendarDays(parseISO(String(dateStr).slice(0, 10)), new Date()); } catch { return null; }
}

export function whenLabel(days, date) {
  if (days == null) return "";
  if (days < -1) return `לפני ${-days} ימים`;
  if (days === -1) return "אתמול";
  if (days === 0) return "היום";
  if (days === 1) return "מחר";
  if (days <= 30) return `בעוד ${days} ימים`;
  return date ? format(date, "dd/MM") : `בעוד ${days} ימים`;
}

/* ── טעינה ─────────────────────────────────────────────────────────────── */
export function useDashboardData() {
  const [state, setState] = useState({ loading: true, error: null, user: null, farm: null, data: null, loadedAt: null });

  const load = useCallback(async (silent = false) => {
    if (!silent) setState(s => ({ ...s, loading: true, error: null }));
    try {
      const user = await getMeCached();
      if (!user?.current_farm_id) { setState({ loading: false, error: null, user, farm: null, data: null, loadedAt: new Date() }); return; }
      const farm = await getFarmCached(user.current_farm_id);
      const f = { farm_id: user.current_farm_id };
      const [seedings, harvests, plots, activities, sprayings, employees, vehicles, sheets, weighingToday, leasePayments, pendingInvoices, clockWorkers] = await batchFetch([
        { entity: "seedings",   filter: f, sort: "-start_date" },
        { entity: "harvests",   filter: f, sort: "-date" },
        { entity: "plots",      filter: f },
        { entity: "activities", filter: f, sort: "-date" },
        { entity: "sprayings",  filter: f, sort: "-date" },
        { entity: "employees",  filter: f },
        { entity: "vehicles",   filter: f },
        { entity: "plastic_sheets", filter: f },
        { entity: "weighing_certificates", filter: { ...f, date: todayStr() } },
        { entity: "lease_payments", filter: f },
        { entity: "invoices", filter: { ...f, status: "pending" } },
        { entity: "clock_workers", filter: f },
      ]);
      setState({
        loading: false, error: null, user, farm, loadedAt: new Date(),
        data: {
          seedings: safe(seedings), harvests: safe(harvests), plots: safe(plots), activities: safe(activities), sprayings: safe(sprayings),
          employees: safe(employees), vehicles: safe(vehicles), sheets: safe(sheets), weighingToday: safe(weighingToday),
          leasePayments: safe(leasePayments), pendingInvoices: safe(pendingInvoices), clockWorkers: safe(clockWorkers),
        },
      });
    } catch (e) {
      console.error("dashboard load failed", e);
      setState(s => ({ ...s, loading: false, error: e?.message || "שגיאה בטעינת נתוני הדשבורד" }));
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  // רענון שקט כל 5 דקות כשהלשונית גלויה
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === "visible") load(true); }, 5 * 60 * 1000);
    return () => clearInterval(t);
  }, [load]);

  return { ...state, reload: load };
}

/* ── "דורש טיפול" — איחוד כל מקורות ההתראה לרשימה אחת ממוינת ─────────── */
export function buildAttention(data) {
  if (!data) return [];
  const out = [];
  const push = (item) => { if (item && item.severity) out.push(item); };
  const sevByDays = (d, { urgentWithin = 7, soonWithin = 30 } = {}) => {
    if (d == null) return null;
    if (d <= urgentWithin) return "urgent";
    if (d <= soonWithin) return "soon";
    return null;
  };
  const expiry = (dateStr, text, link, segment, key) => {
    const d = daysUntil(dateStr);
    const severity = sevByDays(d);
    if (!severity) return;
    push({ key, severity, segment, days: d, link, text: d < 0 ? `${text} פג תוקף` : text, when: whenLabel(d) });
  };

  // עובדים — דרכון / ויזה
  safe(data.employees).filter(e => e.status !== "inactive" && !e.archived).forEach(e => {
    const name = e.nickname || [e.first_name, e.last_name].filter(Boolean).join(" ") || "עובד";
    const link = createPageUrl("EmployeeDetail") + `?id=${e.id}`;
    expiry(e.passport_expiry, `דרכון · ${name}`, link, "workers", `emp-pass-${e.id}`);
    expiry(e.visa_expiry, `ויזה · ${name}`, link, "workers", `emp-visa-${e.id}`);
  });

  // רכבים — ביטוח חובה / מקיף / טסט
  safe(data.vehicles).filter(v => v.status !== "sold" && v.status !== "out_of_order").forEach(v => {
    const link = createPageUrl("VehicleDetail") + `?id=${v.id}`;
    const vn = v.name || v.license_plate || "רכב";
    expiry(v.insurance_compulsory?.end_date, `ביטוח חובה · ${vn}`, link, "operational", `veh-comp-${v.id}`);
    expiry(v.insurance_info?.end_date, `ביטוח מקיף · ${vn}`, link, "operational", `veh-ins-${v.id}`);
    expiry(v.licensing_info?.next_test_date, `טסט · ${vn}`, link, "operational", `veh-test-${v.id}`);
  });

  // יריעות — מועד החלפה משוער
  safe(data.sheets).forEach(s => {
    if (!s.installation_date || !s.replacement_cycle_months) return;
    try {
      const due = addDays(parseISO(s.installation_date), s.replacement_cycle_months * 30);
      const d = differenceInCalendarDays(due, new Date());
      const severity = sevByDays(d);
      if (!severity) return;
      push({ key: `sheet-${s.id}`, severity, segment: "agronomic", days: d, link: createPageUrl("Sheets"), text: `החלפת יריעה ${s.sheet_number || ""}`.trim(), when: whenLabel(d, due) });
    } catch { /* skip */ }
  });

  // שכירויות — תשלומים פתוחים (לקבל/לשלם)
  safe(data.leasePayments).filter(p => ["due", "overdue"].includes(p.status) && num(p.amount) > 0).forEach(p => {
    const d = daysUntil(p.due_date);
    if (d == null || d > 14) return;
    const verb = p.direction === "pay" ? "לשלם" : "לקבל";
    const amt = `₪${Math.round(num(p.amount)).toLocaleString()}`;
    push({ key: `lease-${p.id}`, severity: d < 0 ? "urgent" : "soon", segment: "money", days: d, link: createPageUrl("Leases"),
      text: `${verb} ${amt} · ${p.lease_title || "שכירות"}${p.kind && p.kind !== "rent" && p.description ? ` · ${p.description}` : ""}`, when: whenLabel(d) });
  });

  // חשבוניות ספקים ממתינות — פריט מרוכז אחד
  const pend = safe(data.pendingInvoices);
  if (pend.length) {
    const total = pend.reduce((s, i) => s + num(i.total), 0);
    push({ key: "invoices-pending", severity: pend.length >= 5 ? "urgent" : "soon", segment: "money", days: 0, link: createPageUrl("Invoices"),
      text: `${pend.length} חשבוניות ספקים ממתינות לאישור${total ? ` (₪${Math.round(total).toLocaleString()})` : ""}`, when: "" });
  }

  // מזרעים — קטיף צפוי ושתילה מתוכננת
  safe(data.seedings).forEach(s => {
    if (!s.status || ["uprooted", "archived"].includes(s.status)) return;
    const link = createPageUrl("SeedingDetail") + `?id=${s.id}`;
    if (s.planting_date && s.days_from_planting_to_harvest && !["harvesting"].includes(s.status)) {
      try {
        const hd = addDays(parseISO(s.planting_date), num(s.days_from_planting_to_harvest));
        const d = differenceInCalendarDays(hd, new Date());
        if (d >= 0 && d <= 14) push({ key: `harvest-${s.id}`, severity: "plan", segment: "agronomic", days: d, link, text: `קטיף צפוי · ${s.name}`, when: whenLabel(d, hd) });
      } catch { /* skip */ }
    }
    if (s.planting_date && ["ordered", "preparation"].includes(s.status)) {
      const d = daysUntil(s.planting_date);
      if (d != null && d >= 0 && d <= 14) push({ key: `plant-${s.id}`, severity: "plan", segment: "agronomic", days: d, link, text: `שתילה מתוכננת · ${s.name}`, when: whenLabel(d) });
    }
  });

  return out.sort((a, b) => (SEVERITY[a.severity].rank - SEVERITY[b.severity].rank) || ((a.days ?? 0) - (b.days ?? 0)));
}

/* ── הסתרת פריטים להיום (localStorage, לכל מכשיר) ───────────────────────── */
const DISMISS_KEY = "farmflow_attention_dismissed";
export function loadDismissed() {
  try {
    const st = JSON.parse(localStorage.getItem(DISMISS_KEY) || "{}");
    return st.date === todayStr() ? new Set(st.keys || []) : new Set();
  } catch { return new Set(); }
}
export function saveDismissed(set) {
  try { localStorage.setItem(DISMISS_KEY, JSON.stringify({ date: todayStr(), keys: [...set] })); } catch { /* ignore */ }
}

/* ── מדדים ─────────────────────────────────────────────────────────────── */
function sumKgBetween(harvests, from, to) {
  return harvests.reduce((s, h) => {
    const d = h.date ? String(h.date).slice(0, 10) : "";
    return d >= from && d < to ? s + num(h.weight) : s;
  }, 0);
}
function sumRevenueBetween(harvests, from, to) {
  return harvests.reduce((s, h) => {
    const d = h.date ? String(h.date).slice(0, 10) : "";
    return d >= from && d < to ? s + num(h.quantity) * num(h.price_per_unit) : s;
  }, 0);
}
const pct = (cur, prev) => (prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null);

export function computeKpis(data, rangeDays = 7, attention = []) {
  if (!data) return null;
  const now = new Date();
  const t0 = format(now, "yyyy-MM-dd");
  const from = format(subDays(now, rangeDays - 1), "yyyy-MM-dd");
  const toExcl = format(addDays(now, 1), "yyyy-MM-dd");
  const prevFrom = format(subDays(now, rangeDays * 2 - 1), "yyyy-MM-dd");
  const harvests = safe(data.harvests);

  const seedings = safe(data.seedings);
  const activeSeedings = seedings.filter(s => s.status && !["uprooted", "archived"].includes(s.status));
  const harvestingNow = activeSeedings.filter(s => s.status === "harvesting").length;

  // קטיף — טווח נוכחי מול קודם + סדרה שבועית (8 שבועות)
  const kgCur = sumKgBetween(harvests, from, toExcl);
  const kgPrev = sumKgBetween(harvests, prevFrom, from);
  const weeks = [];
  for (let i = 7; i >= 0; i--) {
    const ws = startOfWeek(subDays(now, i * 7), { weekStartsOn: 0 });
    weeks.push(sumKgBetween(harvests, format(ws, "yyyy-MM-dd"), format(addDays(ws, 7), "yyyy-MM-dd")));
  }
  const kgToday = sumKgBetween(harvests, t0, toExcl);
  const todayHarvest = harvests.find(h => String(h.date || "").slice(0, 10) === t0);
  const todaySeeding = todayHarvest ? seedings.find(s => s.id === todayHarvest.seeding_id) : null;

  const revCur = sumRevenueBetween(harvests, from, toExcl);
  const revPrev = sumRevenueBetween(harvests, prevFrom, from);
  const revSeries = [];
  for (let i = 7; i >= 0; i--) {
    const ws = startOfWeek(subDays(now, i * 7), { weekStartsOn: 0 });
    revSeries.push(sumRevenueBetween(harvests, format(ws, "yyyy-MM-dd"), format(addDays(ws, 7), "yyyy-MM-dd")));
  }

  const weigh = safe(data.weighingToday);
  const weighKg = weigh.reduce((s, c) => s + num(c.total_weight), 0);
  const weighCustomers = new Set(weigh.map(c => c.customer_name || c.customer_id).filter(Boolean)).size;

  const workers = safe(data.clockWorkers).filter(w => w.monitored !== false);
  const present = workers.filter(w => w.status === "present" || w.absent_days === 0).length;

  const urgent = attention.filter(a => a.severity === "urgent").length;

  return {
    seedings: { active: activeSeedings.length, total: seedings.length, harvesting: harvestingNow },
    harvest: { kg: kgCur, delta: pct(kgCur, kgPrev), series: weeks, kgToday, todayLabel: todaySeeding ? `${todaySeeding.name}` : null },
    weighing: { count: weigh.length, kg: weighKg, customers: weighCustomers },
    revenue: { amount: revCur, delta: pct(revCur, revPrev), series: revSeries },
    attendance: workers.length ? { present, total: workers.length, absent: workers.length - present } : null,
    alerts: { total: attention.length, urgent },
    rangeDays,
  };
}

export const fmtKg = (v) => `${Math.round(num(v)).toLocaleString()} ק"ג`;
export const fmtMoney = (v) => {
  const n = Math.round(num(v));
  if (Math.abs(n) >= 100000) return `₪${(n / 1000).toFixed(0)}K`;
  return `₪${n.toLocaleString()}`;
};
export const dateLabel = (d = new Date()) => d.toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "long" });
export function greeting(name) {
  const h = new Date().getHours();
  const g = h < 5 ? "לילה טוב" : h < 12 ? "בוקר טוב" : h < 17 ? "צהריים טובים" : "ערב טוב";
  const first = (name || "").trim().split(/\s+/)[0];
  return first ? `${g}, ${first}` : g;
}
