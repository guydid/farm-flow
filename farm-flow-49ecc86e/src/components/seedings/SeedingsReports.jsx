import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Download, Printer, Filter, ChevronDown, X, Loader2 } from "lucide-react";
import { format, parseISO, startOfMonth, startOfYear, subDays, subYears, endOfYear } from "date-fns";
import { useToast } from "@/components/ui/use-toast";
import { DateInput } from "@/components/ui/date-input";
import { getMeCached, getFarmCached } from "@/api/cachedReads";
import { batchFetch } from "@/api/localClient";
import { printA4, escapeHtml } from "@/components/print/a4";

// ─── עזרים ───────────────────────────────────────────────────────────────
const STATUS_LABELS = {
  ordered: "מוזמן", preparation: "הכנה", growing: "גידול",
  harvesting: "קטיף", uprooted: "עקירה", archived: "בארכיון",
};
const ACTIVE_STATUSES = ["ordered", "preparation", "growing", "harvesting"];
const STATUS_FILTERS = [
  { value: "all", label: "כל הסטטוסים" },
  { value: "active", label: "פעילים" },
  { value: "uprooted", label: "שהסתיימו (עקירה)" },
  { value: "archived", label: "בארכיון" },
];
const GROUP_BY = [
  { value: "crop", label: "סוג גידול" },
  { value: "seeding", label: "מזרע" },
  { value: "plot", label: "חלקה" },
  { value: "variety", label: "זן" },
  { value: "month", label: "חודש" },
];
const NO_CROP = "ללא סוג גידול";
const iso = (d) => format(d, "yyyy-MM-dd");
const DATE_PRESETS = [
  { key: "30d", label: "30 יום", range: () => [iso(subDays(new Date(), 29)), iso(new Date())] },
  { key: "90d", label: "90 יום", range: () => [iso(subDays(new Date(), 89)), iso(new Date())] },
  { key: "month", label: "החודש", range: () => [iso(startOfMonth(new Date())), iso(new Date())] },
  { key: "ytd", label: "מתחילת השנה", range: () => [iso(startOfYear(new Date())), iso(new Date())] },
  { key: "lastyear", label: "שנה שעברה", range: () => { const d = subYears(new Date(), 1); return [iso(startOfYear(d)), iso(endOfYear(d))]; } },
  // עונה חקלאית: 1/8 עד 31/7
  { key: "season", label: "העונה", range: () => {
      const now = new Date(); const y = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
      return [`${y}-08-01`, `${y + 1}-07-31`];
    } },
];

const num = (v) => (typeof v === "number" && isFinite(v) ? v : parseFloat(v) || 0);
const day = (d) => (d ? String(d).slice(0, 10) : "");
const fmtDate = (d) => { try { return d ? format(parseISO(day(d)), "dd/MM/yyyy") : ""; } catch { return day(d); } };
const money = (v) => `₪${Math.round(num(v)).toLocaleString("he-IL")}`;
const qty = (v, digits = 0) => num(v).toLocaleString("he-IL", { maximumFractionDigits: digits });
const harvestKg = (h) => num(h.weight) || num(h.quantity);
const harvestRevenue = (h) => num(h.quantity) * num(h.price_per_unit);
const monthLabel = (ym) => { try { return format(parseISO(`${ym}-01`), "MM/yyyy"); } catch { return ym; } };
const csvCell = (v) => { const s = String(v ?? ""); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

const EMPTY_FILTERS = {
  crops: [], plotIds: [], seedingIds: [], varieties: [],
  status: "all", date_from: "", date_to: "", preset: "",
  activity_type: "", quality: "",
};

// ─── בחירה מרובה (Popover + תיבות סימון + חיפוש) ─────────────────────────
function MultiPick({ label, allLabel, options, value, onChange, emptyText = "אין אפשרויות" }) {
  const [q, setQ] = useState("");
  const selected = new Set(value);
  const shown = q ? options.filter(o => o.label.toLowerCase().includes(q.toLowerCase())) : options;
  const toggle = (v) => {
    const next = new Set(selected);
    next.has(v) ? next.delete(v) : next.add(v);
    onChange([...next]);
  };
  const summary = value.length === 0 ? allLabel
    : value.length === 1 ? (options.find(o => o.value === value[0])?.label ?? "1 נבחר")
    : `${value.length} נבחרו`;
  return (
    <div>
      <Label>{label}</Label>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" className="w-full justify-between font-normal">
            <span className={`truncate ${value.length ? "text-gray-900" : "text-gray-500"}`}>{summary}</span>
            <ChevronDown className="w-4 h-4 opacity-50 shrink-0" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-0" dir="rtl">
          {options.length > 8 && (
            <div className="p-2 border-b">
              <Input value={q} onChange={e => setQ(e.target.value)} placeholder="חיפוש..." className="h-8" />
            </div>
          )}
          <div className="max-h-64 overflow-y-auto p-1">
            {shown.length === 0 && <div className="p-3 text-sm text-gray-500 text-center">{emptyText}</div>}
            {shown.map(o => (
              <label key={o.value} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-50 cursor-pointer text-sm">
                <Checkbox checked={selected.has(o.value)} onCheckedChange={() => toggle(o.value)} />
                <span className="flex-1 truncate">{o.label}</span>
                {o.hint && <span className="text-xs text-gray-400">{o.hint}</span>}
              </label>
            ))}
          </div>
          {value.length > 0 && (
            <div className="p-2 border-t">
              <Button variant="ghost" size="sm" className="w-full" onClick={() => onChange([])}>נקה בחירה</Button>
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}

function Kpi({ label, value, sub, tone }) {
  const color = tone === "pos" ? "text-green-600" : tone === "neg" ? "text-red-600" : "text-gray-900";
  return (
    <div className="rounded-xl border bg-white p-3 text-center">
      <div className={`text-lg font-bold tabular-nums ${color}`}>{value}</div>
      <div className="text-xs text-gray-500">{label}</div>
      {sub && <div className="text-[11px] text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}

// ─── הקומפוננטה ──────────────────────────────────────────────────────────
export default function SeedingsReports() {
  const [data, setData] = useState({ activities: [], harvests: [], sprayings: [], seedings: [], plots: [], links: [] });
  const [farm, setFarm] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  // בנייד המסננים סגורים כברירת מחדל כדי שהנתונים יופיעו מיד
  const [showFilters, setShowFilters] = useState(() => typeof window === "undefined" || window.innerWidth >= 768);
  const [groupBy, setGroupBy] = useState("crop");
  const [tab, setTab] = useState("summary");
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const { toast } = useToast();
  const setF = (patch) => setFilters(prev => ({ ...prev, ...patch }));

  useEffect(() => {
    let alive = true;
    (async () => {
      setIsLoading(true);
      try {
        const user = await getMeCached();
        const fid = user?.current_farm_id;
        if (!fid) { if (alive) setIsLoading(false); return; }
        getFarmCached(fid).then(f => alive && setFarm(f)).catch(() => {});
        const ff = { farm_id: fid };
        const [seedings, plots, links, activities, harvests, sprayings] = await batchFetch([
          { entity: "seedings", filter: ff },
          { entity: "plots", filter: ff },
          { entity: "plot_seedings" },
          { entity: "activities", sort: "-date" },
          { entity: "harvests", sort: "-date" },
          { entity: "sprayings", sort: "-date" },
        ]);
        const arr = (x) => (Array.isArray(x) ? x : []);
        // רק אירועים של מזרעי המשק הנוכחי
        const ids = new Set(arr(seedings).map(s => s.id));
        const mine = (x) => arr(x).filter(e => ids.has(e.seeding_id));
        if (alive) setData({
          seedings: arr(seedings), plots: arr(plots), links: arr(links),
          activities: mine(activities), harvests: mine(harvests), sprayings: mine(sprayings),
        });
      } catch (error) {
        console.error("Error loading reports data:", error);
        toast({ title: "שגיאה", description: "טעינת הנתונים נכשלה", variant: "destructive" });
      }
      if (alive) setIsLoading(false);
    })();
    return () => { alive = false; };
  }, [toast]);

  // ── מפות עזר ──
  const lookups = useMemo(() => {
    const seedingById = new Map(data.seedings.map(s => [s.id, s]));
    const plotById = new Map(data.plots.map(p => [p.id, p]));
    const plotsOfSeeding = new Map();
    data.links.forEach(l => {
      if (!seedingById.has(l.seeding_id)) return;
      if (!plotsOfSeeding.has(l.seeding_id)) plotsOfSeeding.set(l.seeding_id, new Set());
      plotsOfSeeding.get(l.seeding_id).add(l.plot_id);
    });
    return { seedingById, plotById, plotsOfSeeding };
  }, [data]);
  const { seedingById, plotById, plotsOfSeeding } = lookups;
  const cropOf = (seedingId) => seedingById.get(seedingId)?.crop_type || NO_CROP;
  const seedingName = (id) => seedingById.get(id)?.name || "לא ידוע";
  const plotName = (id) => plotById.get(id)?.name || "";
  const eventPlotLabel = (e) => {
    if (e.plot_id) return plotName(e.plot_id) || "—";
    const ps = [...(plotsOfSeeding.get(e.seeding_id) || [])].map(plotName).filter(Boolean);
    return ps.length ? ps.join(" + ") : "—";
  };

  // ── אפשרויות למסננים (מצטמצמות לפי בחירות קודמות) ──
  const cropOptions = useMemo(() => {
    const counts = {};
    data.seedings.forEach(s => { const c = s.crop_type || NO_CROP; counts[c] = (counts[c] || 0) + 1; });
    return Object.keys(counts).sort((a, b) => a.localeCompare(b, "he")).map(c => ({ value: c, label: c, hint: counts[c] }));
  }, [data.seedings]);

  const plotOptions = useMemo(() =>
    [...data.plots].sort((a, b) => String(a.name).localeCompare(String(b.name), "he"))
      .map(p => ({ value: p.id, label: p.name || "ללא שם", hint: p.size ? `${p.size} ד'` : "" })),
  [data.plots]);

  const statusOk = (s) => {
    if (filters.status === "all") return true;
    if (filters.status === "active") return ACTIVE_STATUSES.includes(s.status);
    return s.status === filters.status;
  };
  const seedingInPlots = (s) => {
    if (!filters.plotIds.length) return true;
    const ps = plotsOfSeeding.get(s.id);
    return !!ps && filters.plotIds.some(p => ps.has(p));
  };
  const cropOk = (s) => !filters.crops.length || filters.crops.includes(s.crop_type || NO_CROP);

  const seedingOptions = useMemo(() =>
    data.seedings.filter(s => cropOk(s) && seedingInPlots(s) && statusOk(s))
      .sort((a, b) => day(b.planting_date || b.start_date).localeCompare(day(a.planting_date || a.start_date)))
      .map(s => ({ value: s.id, label: s.name || "ללא שם", hint: STATUS_LABELS[s.status] || "" })),
  [data.seedings, filters.crops, filters.plotIds, filters.status, plotsOfSeeding]);

  const varietyOptions = useMemo(() => {
    const set = new Set();
    data.seedings.filter(s => cropOk(s)).forEach(s => (s.varieties || []).forEach(v => v?.name && set.add(v.name)));
    data.harvests.forEach(h => { if (h.variety && (!filters.crops.length || filters.crops.includes(cropOf(h.seeding_id)))) set.add(h.variety); });
    return [...set].sort((a, b) => a.localeCompare(b, "he")).map(v => ({ value: v, label: v }));
  }, [data.seedings, data.harvests, filters.crops]);

  // ── סינון ──
  const filtered = useMemo(() => {
    const seedingOk = (s) => {
      if (!s) return false;
      if (!cropOk(s) || !statusOk(s) || !seedingInPlots(s)) return false;
      if (filters.seedingIds.length && !filters.seedingIds.includes(s.id)) return false;
      if (filters.varieties.length && !(s.varieties || []).some(v => filters.varieties.includes(v?.name))) {
        return false;
      }
      return true;
    };
    const seedings = data.seedings.filter(seedingOk);
    const okIds = new Set(seedings.map(s => s.id));

    const eventOk = (e) => {
      if (!okIds.has(e.seeding_id)) return false;
      const d = day(e.date);
      if (filters.date_from && d < filters.date_from) return false;
      if (filters.date_to && d > filters.date_to) return false;
      // אירוע ששויך לחלקה מסוימת חייב להיות באחת החלקות שנבחרו
      if (filters.plotIds.length && e.plot_id && !filters.plotIds.includes(e.plot_id)) return false;
      return true;
    };
    const byDate = (a, b) => day(b.date).localeCompare(day(a.date));
    const activities = data.activities
      .filter(a => eventOk(a) && (!filters.activity_type || a.activity_type === filters.activity_type))
      .sort(byDate);
    const harvests = data.harvests
      .filter(h => eventOk(h)
        && (!filters.quality || h.quality === filters.quality)
        && (!filters.varieties.length || !h.variety || filters.varieties.includes(h.variety)))
      .sort(byDate);
    const sprayings = data.sprayings.filter(eventOk).sort(byDate);

    // מזרעים שנכנסים לסיכום: אם יש טווח תאריכים — רק כאלה עם פעילות בטווח או שנשתלו בו
    const hasRange = filters.date_from || filters.date_to;
    const touched = new Set([...activities, ...harvests, ...sprayings].map(e => e.seeding_id));
    const inRange = (d) => d && (!filters.date_from || d >= filters.date_from) && (!filters.date_to || d <= filters.date_to);
    const reportSeedings = hasRange
      ? seedings.filter(s => touched.has(s.id) || inRange(day(s.planting_date || s.start_date)))
      : seedings;

    return { seedings: reportSeedings, activities, harvests, sprayings };
  }, [data, filters, plotsOfSeeding]);

  // שטח מזרע בתוך הדוח: אם נבחרו חלקות — רק החלק שבחלקות האלה
  const seedingArea = (s) => {
    const ps = [...(plotsOfSeeding.get(s.id) || [])];
    if (filters.plotIds.length && ps.length) {
      const inSel = ps.filter(p => filters.plotIds.includes(p));
      // כל חלקות המזרע נבחרו: השטח המלא של המזרע
      if (inSel.length === ps.length && num(s.total_area) > 0) return num(s.total_area);
      const sum = inSel.reduce((t, p) => t + num(plotById.get(p)?.size), 0);
      if (sum > 0) return sum;
    }
    return num(s.total_area) || ps.reduce((t, p) => t + num(plotById.get(p)?.size), 0);
  };

  // ── סיכום וקיבוץ ──
  const totals = useMemo(() => {
    const t = {
      seedings: filtered.seedings.length,
      area: filtered.seedings.reduce((sum, s) => sum + seedingArea(s), 0),
      kg: filtered.harvests.reduce((sum, h) => sum + harvestKg(h), 0),
      packages: filtered.harvests.reduce((sum, h) => sum + num(h.package_count), 0),
      revenue: filtered.harvests.reduce((sum, h) => sum + harvestRevenue(h), 0),
      activityCost: filtered.activities.reduce((sum, a) => sum + num(a.total_cost), 0),
      sprayCost: filtered.sprayings.reduce((sum, s) => sum + num(s.total_cost), 0),
    };
    t.cost = t.activityCost + t.sprayCost;
    t.profit = t.revenue - t.cost;
    return t;
  }, [filtered]);

  const groups = useMemo(() => {
    const map = new Map();
    const get = (key, label) => {
      if (!map.has(key)) map.set(key, { key, label, seedings: new Set(), area: 0, kg: 0, revenue: 0, activityCost: 0, sprayCost: 0, harvests: 0, noCost: false, noArea: false });
      return map.get(key);
    };
    // מפתח קבוצה לאירוע
    const keyOf = (e, kind) => {
      switch (groupBy) {
        case "crop": { const c = cropOf(e.seeding_id); return [c, c]; }
        case "seeding": return [e.seeding_id, seedingName(e.seeding_id)];
        case "plot": {
          if (e.plot_id) return [e.plot_id, plotName(e.plot_id) || "—"];
          const ps = [...(plotsOfSeeding.get(e.seeding_id) || [])];
          if (ps.length === 1) return [ps[0], plotName(ps[0]) || "—"];
          return ["__multi__", "לא שויך לחלקה"];
        }
        case "variety": {
          if (kind === "harvest" && e.variety) return [e.variety, e.variety];
          if (kind === "harvest") return ["__nov__", "ללא זן"];
          return null;
        }
        case "month": { const m = day(e.date).slice(0, 7); return [m, monthLabel(m)]; }
        default: return null;
      }
    };
    const add = (e, kind) => {
      const k = keyOf(e, kind);
      if (!k) return;
      const g = get(k[0], k[1]);
      g.seedings.add(e.seeding_id);
      if (kind === "harvest") { g.kg += harvestKg(e); g.revenue += harvestRevenue(e); g.harvests += 1; }
      if (kind === "activity") g.activityCost += num(e.total_cost);
      if (kind === "spraying") g.sprayCost += num(e.total_cost);
    };
    filtered.harvests.forEach(h => add(h, "harvest"));
    filtered.activities.forEach(a => add(a, "activity"));
    filtered.sprayings.forEach(s => add(s, "spraying"));

    // שטח: לפי גידול / מזרע מסכמים שטח מזרעים; לפי חלקה — גודל החלקה; לפי זן/חודש — לא רלוונטי
    if (groupBy === "crop" || groupBy === "seeding") {
      filtered.seedings.forEach(s => {
        const g = groupBy === "crop" ? get(s.crop_type || NO_CROP, s.crop_type || NO_CROP) : get(s.id, s.name || "ללא שם");
        g.seedings.add(s.id);
      });
      map.forEach(g => { g.area = [...g.seedings].reduce((sum, id) => sum + (seedingById.get(id) ? seedingArea(seedingById.get(id)) : 0), 0); });
    } else if (groupBy === "plot") {
      map.forEach(g => { g.area = g.key === "__multi__" ? 0 : num(plotById.get(g.key)?.size); g.noArea = g.key === "__multi__"; });
    } else {
      map.forEach(g => { g.noArea = true; });
    }
    if (groupBy === "variety") map.forEach(g => { g.noCost = true; });

    const rows = [...map.values()].map(g => ({
      ...g,
      seedingCount: g.seedings.size,
      cost: g.activityCost + g.sprayCost,
      profit: g.revenue - g.activityCost - g.sprayCost,
    }));
    if (groupBy === "month") rows.sort((a, b) => b.key.localeCompare(a.key));
    else rows.sort((a, b) => b.revenue - a.revenue || b.cost - a.cost || a.label.localeCompare(b.label, "he"));
    return rows;
  }, [filtered, groupBy]);

  const uniqueActivityTypes = useMemo(
    () => [...new Set(data.activities.map(a => a.activity_type).filter(Boolean))].sort((a, b) => a.localeCompare(b, "he")),
    [data.activities]);
  const uniqueQualities = useMemo(
    () => [...new Set(data.harvests.map(h => h.quality).filter(Boolean))],
    [data.harvests]);

  // ── תיאור המסננים (לכותרת הדוח המודפס) ──
  const filterSummary = useMemo(() => {
    const parts = [];
    if (filters.date_from || filters.date_to) parts.push(`תאריכים: ${filters.date_from ? fmtDate(filters.date_from) : "…"} – ${filters.date_to ? fmtDate(filters.date_to) : "…"}`);
    if (filters.crops.length) parts.push(`גידול: ${filters.crops.join(", ")}`);
    if (filters.plotIds.length) parts.push(`חלקות: ${filters.plotIds.map(plotName).join(", ")}`);
    if (filters.seedingIds.length) parts.push(`מזרעים: ${filters.seedingIds.map(seedingName).join(", ")}`);
    if (filters.varieties.length) parts.push(`זנים: ${filters.varieties.join(", ")}`);
    if (filters.status !== "all") parts.push(`סטטוס: ${STATUS_FILTERS.find(s => s.value === filters.status)?.label}`);
    if (filters.activity_type) parts.push(`פעילות: ${filters.activity_type}`);
    if (filters.quality) parts.push(`איכות: ${filters.quality}`);
    return parts;
  }, [filters, data]);
  const activeFilterCount = filterSummary.length;

  // ── הגדרת הטבלאות (משותפת למסך, ל-CSV ולהדפסה) ──
  const groupLabel = GROUP_BY.find(g => g.value === groupBy)?.label;
  const perDunam = (v, area) => (area > 0 ? v / area : null);
  const reports = {
    summary: {
      title: `דוח מזרעים מסכם — לפי ${groupLabel}`,
      cols: [
        { h: groupLabel, w: 34, r: true, v: g => g.label, total: () => "סה\"כ" },
        { h: "מזרעים", w: 13, v: g => g.seedingCount, total: () => totals.seedings },
        { h: "שטח (ד')", w: 14, v: g => (g.noArea ? "—" : qty(g.area, 1)), total: () => qty(totals.area, 1) },
        { h: "קטיף (ק\"ג)", w: 19, v: g => qty(g.kg), total: () => qty(totals.kg) },
        { h: "ק\"ג/ד'", w: 14, v: g => { const x = g.noArea ? null : perDunam(g.kg, g.area); return x == null ? "—" : qty(x); }, total: () => { const x = perDunam(totals.kg, totals.area); return x == null ? "—" : qty(x); } },
        { h: "הכנסה", w: 20, v: g => money(g.revenue), total: () => money(totals.revenue) },
        { h: "עלות", w: 20, v: g => (g.noCost ? "—" : money(g.cost)), total: () => money(totals.cost) },
        { h: "רווח", w: 20, v: g => (g.noCost ? "—" : money(g.profit)), tone: g => (g.noCost ? null : g.profit), total: () => money(totals.profit), totalTone: () => totals.profit },
        { h: "רווח/ד'", w: 16, v: g => { const x = g.noCost || g.noArea ? null : perDunam(g.profit, g.area); return x == null ? "—" : money(x); }, total: () => { const x = perDunam(totals.profit, totals.area); return x == null ? "—" : money(x); } },
      ],
      rows: groups,
      key: g => g.key,
    },
    activities: {
      title: "דוח פעילויות",
      cols: [
        { h: "תאריך", w: 20, v: a => fmtDate(a.date), total: () => "סה\"כ" },
        { h: "גידול", w: 18, v: a => cropOf(a.seeding_id) },
        { h: "מזרע", w: 34, r: true, v: a => seedingName(a.seeding_id) },
        { h: "חלקה", w: 24, v: eventPlotLabel },
        { h: "פעילות", w: 26, v: a => a.activity_type || "" },
        { h: "שטח (ד')", w: 16, v: a => qty(a.area_covered, 1), total: () => qty(filtered.activities.reduce((s, a) => s + num(a.area_covered), 0), 1) },
        { h: "עלות", w: 22, v: a => money(a.total_cost), total: () => money(totals.activityCost) },
        { h: "מבצע", w: 26, v: a => a.performed_by || "" },
      ],
      rows: filtered.activities,
      key: a => a.id,
    },
    harvests: {
      title: "דוח קטיפים",
      cols: [
        { h: "תאריך", w: 20, v: h => fmtDate(h.date), total: () => "סה\"כ" },
        { h: "גידול", w: 17, v: h => cropOf(h.seeding_id) },
        { h: "מזרע", w: 31, r: true, v: h => seedingName(h.seeding_id) },
        { h: "חלקה", w: 20, v: eventPlotLabel },
        { h: "זן", w: 20, v: h => h.variety || "" },
        { h: "איכות", w: 13, v: h => h.quality || "" },
        { h: "אריזות", w: 14, v: h => (num(h.package_count) ? qty(h.package_count) : ""), total: () => qty(totals.packages) },
        { h: "משקל (ק\"ג)", w: 17, v: h => qty(harvestKg(h)), total: () => qty(totals.kg) },
        { h: "הכנסה", w: 18, v: h => money(harvestRevenue(h)), total: () => money(totals.revenue) },
      ],
      rows: filtered.harvests,
      key: h => h.id,
    },
    sprayings: {
      title: "דוח הדברות",
      cols: [
        { h: "תאריך", w: 20, v: s => fmtDate(s.date), total: () => "סה\"כ" },
        { h: "גידול", w: 18, v: s => cropOf(s.seeding_id) },
        { h: "מזרע", w: 32, r: true, v: s => seedingName(s.seeding_id) },
        { h: "חלקה", w: 22, v: eventPlotLabel },
        { h: "סוג טיפול", w: 20, v: s => s.treatment_type || "" },
        { h: "חומרים", w: 52, r: true, v: s => (s.applied_pesticides || []).map(p => p.pesticide_name).filter(Boolean).join(", ") },
        { h: "עלות", w: 22, v: s => (num(s.total_cost) ? money(s.total_cost) : ""), total: () => money(totals.sprayCost) },
      ],
      rows: filtered.sprayings,
      key: s => s.id,
    },
  };

  const exportCsv = (id) => {
    const rep = reports[id];
    const lines = [rep.cols.map(c => csvCell(c.h)).join(",")];
    rep.rows.forEach(row => lines.push(rep.cols.map(c => csvCell(c.v(row))).join(",")));
    if (rep.rows.length) lines.push(rep.cols.map(c => csvCell(c.total ? c.total() : "")).join(","));
    const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `seedings_${id}_${format(new Date(), "yyyy-MM-dd")}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  };

  const printReport = async (id) => {
    const rep = reports[id];
    const e = escapeHtml;
    const kpis = [
      ["מזרעים", totals.seedings], ["שטח (ד')", qty(totals.area, 1)], ["קטיף (ק\"ג)", qty(totals.kg)],
      ["הכנסה", money(totals.revenue)], ["עלות", money(totals.cost)], ["רווח", money(totals.profit)],
    ];
    const html = `
      <div class="ff-doc">
        <div class="ff-head">
          <div class="ff-brand"><h1>${e(farm?.name || "")}</h1>
            <div class="ff-sub">${filterSummary.length ? filterSummary.map(e).join("<br>") : "ללא סינון — כל המזרעים"}</div></div>
          <div class="ff-title"><div class="ff-title-text"><h2>${e(rep.title)}</h2>
            <div class="ff-sub">הופק ${e(format(new Date(), "dd/MM/yyyy HH:mm"))}</div></div></div>
        </div>
        <div class="ff-kpis">${kpis.map(([l, v]) => `<div class="ff-kpi"><div class="v">${e(v)}</div><div class="l">${e(l)}</div></div>`).join("")}</div>
        ${rep.rows.length === 0 ? `<div class="ff-empty">אין נתונים לפי הסינון שנבחר</div>` : `
        <table class="ff-table">
          <colgroup>${rep.cols.map(c => `<col style="width:${c.w}mm">`).join("")}</colgroup>
          <thead><tr>${rep.cols.map(c => `<th>${e(c.h)}</th>`).join("")}</tr></thead>
          <tbody>${rep.rows.map(row => `<tr>${rep.cols.map(c => `<td class="${c.r ? "r" : ""}">${e(c.v(row))}</td>`).join("")}</tr>`).join("")}
            <tr class="ff-total">${rep.cols.map(c => `<td class="${c.r ? "r" : ""}">${e(c.total ? c.total() : "")}</td>`).join("")}</tr>
          </tbody>
        </table>`}
        <div class="ff-foot"><span>FarmFlow · דוחות מזרעים</span><span>${rep.rows.length} שורות</span></div>
      </div>`;
    try {
      await printA4({ title: rep.title, bodyHtml: html });
    } catch (err) {
      console.error(err);
      toast({ title: "שגיאה", description: "ההדפסה נכשלה", variant: "destructive" });
    }
  };

  const toneClass = (v) => (v == null ? "" : v >= 0 ? "text-green-700" : "text-red-600");
  const renderTable = (id) => {
    const rep = reports[id];
    if (!rep.rows.length) return <div className="text-center py-10 text-gray-500">אין נתונים לפי הסינון שנבחר</div>;
    return (
      <div className="overflow-x-auto -mx-4 sm:mx-0">
        <Table className="min-w-[640px]">
          <TableHeader>
            <TableRow>{rep.cols.map(c => <TableHead key={c.h} className="text-right whitespace-nowrap">{c.h}</TableHead>)}</TableRow>
          </TableHeader>
          <TableBody>
            {rep.rows.map(row => (
              <TableRow key={rep.key(row)}>
                {rep.cols.map(c => (
                  <TableCell key={c.h} className={`tabular-nums ${c.r ? "font-medium" : ""} ${c.tone ? toneClass(c.tone(row)) : ""}`}>
                    {c.h === "איכות" && c.v(row) ? <Badge variant="outline">{c.v(row)}</Badge> : c.v(row)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow className="font-bold">
              {rep.cols.map(c => (
                <TableCell key={c.h} className={`tabular-nums ${c.totalTone ? toneClass(c.totalTone()) : ""}`}>{c.total ? c.total() : ""}</TableCell>
              ))}
            </TableRow>
          </TableFooter>
        </Table>
      </div>
    );
  };

  const actions = (id) => (
    <div className="flex gap-2">
      <Button variant="outline" size="sm" onClick={() => exportCsv(id)} disabled={!reports[id].rows.length}>
        <Download className="w-4 h-4 ml-1" />יצוא
      </Button>
      <Button variant="outline" size="sm" onClick={() => printReport(id)}>
        <Printer className="w-4 h-4 ml-1" />הדפסה
      </Button>
    </div>
  );

  if (isLoading) {
    return <div className="flex items-center justify-center gap-2 p-8 text-gray-500"><Loader2 className="w-4 h-4 animate-spin" />טוען נתונים...</div>;
  }

  const applyPreset = (key) => {
    if (filters.preset === key) { setF({ preset: "", date_from: "", date_to: "" }); return; }
    const [from, to] = DATE_PRESETS.find(p => p.key === key).range();
    setF({ preset: key, date_from: from, date_to: to });
  };

  return (
    <div className="space-y-4">
      {/* מסננים */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex justify-between items-center gap-2">
            <CardTitle>דוחות מזרעים</CardTitle>
            <div className="flex gap-2">
              {activeFilterCount > 0 && (
                <Button variant="ghost" size="sm" onClick={() => setFilters(EMPTY_FILTERS)}>
                  <X className="w-4 h-4 ml-1" />נקה
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={() => setShowFilters(!showFilters)}>
                <Filter className="w-4 h-4 ml-1" />סינון{activeFilterCount ? ` (${activeFilterCount})` : ""}
              </Button>
            </div>
          </div>
        </CardHeader>
        {showFilters && (
          <CardContent className="border-t pt-4 space-y-4">
            {/* טווח תאריכים */}
            <div>
              <Label className="mb-1.5 block">טווח תאריכים</Label>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {DATE_PRESETS.map(p => (
                  <Button key={p.key} size="sm" variant={filters.preset === p.key ? "default" : "outline"} className="h-7 px-2.5 text-xs" onClick={() => applyPreset(p.key)}>
                    {p.label}
                  </Button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-3 sm:max-w-md">
                <div>
                  <Label className="text-xs text-gray-500">מתאריך</Label>
                  <DateInput value={filters.date_from} onChange={e => setF({ date_from: e.target.value, preset: "" })} />
                </div>
                <div>
                  <Label className="text-xs text-gray-500">עד תאריך</Label>
                  <DateInput value={filters.date_to} onChange={e => setF({ date_to: e.target.value, preset: "" })} />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              <MultiPick label="סוג גידול" allLabel="כל הגידולים" options={cropOptions} value={filters.crops}
                onChange={v => setF({ crops: v, seedingIds: [], varieties: [] })} />
              <MultiPick label="חלקות" allLabel="כל החלקות" options={plotOptions} value={filters.plotIds}
                onChange={v => setF({ plotIds: v, seedingIds: [] })} emptyText="אין חלקות" />
              <MultiPick label="מזרעים" allLabel="כל המזרעים" options={seedingOptions}
                value={filters.seedingIds.filter(id => seedingOptions.some(o => o.value === id))}
                onChange={v => setF({ seedingIds: v })} emptyText="אין מזרעים מתאימים" />
              <MultiPick label="זנים" allLabel="כל הזנים" options={varietyOptions} value={filters.varieties}
                onChange={v => setF({ varieties: v })} emptyText="אין זנים" />
              <div>
                <Label>סטטוס מזרע</Label>
                <Select value={filters.status} onValueChange={v => setF({ status: v, seedingIds: [] })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUS_FILTERS.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {activeFilterCount > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {filterSummary.map(t => <Badge key={t} variant="secondary" className="font-normal">{t}</Badge>)}
              </div>
            )}
          </CardContent>
        )}
      </Card>

      {/* כרטיסי סיכום */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        <Kpi label="מזרעים" value={totals.seedings} sub={`${qty(totals.area, 1)} דונם`} />
        <Kpi label={'קטיף (ק"ג)'} value={qty(totals.kg)} sub={totals.area > 0 ? `${qty(totals.kg / totals.area)} ק"ג לדונם` : `${filtered.harvests.length} קטיפים`} />
        <Kpi label="הכנסה" value={money(totals.revenue)} sub={`${filtered.harvests.length} קטיפים`} />
        <Kpi label="עלות פעילויות" value={money(totals.activityCost)} sub={`${filtered.activities.length} פעילויות`} />
        <Kpi label="עלות הדברות" value={money(totals.sprayCost)} sub={`${filtered.sprayings.length} הדברות`} />
        <Kpi label="רווח" value={money(totals.profit)} tone={totals.profit >= 0 ? "pos" : "neg"}
          sub={totals.area > 0 ? `${money(totals.profit / totals.area)} לדונם` : ""} />
      </div>

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList className="w-full sm:w-auto overflow-x-auto justify-start">
          <TabsTrigger value="summary">סיכום</TabsTrigger>
          <TabsTrigger value="activities">פעילויות ({filtered.activities.length})</TabsTrigger>
          <TabsTrigger value="harvests">קטיפים ({filtered.harvests.length})</TabsTrigger>
          <TabsTrigger value="sprayings">הדברות ({filtered.sprayings.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="summary">
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <CardTitle className="text-base">סיכום לפי</CardTitle>
                <Select value={groupBy} onValueChange={setGroupBy}>
                  <SelectTrigger className="w-36 h-8"><SelectValue /></SelectTrigger>
                  <SelectContent>{GROUP_BY.map(g => <SelectItem key={g.value} value={g.value}>{g.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              {actions("summary")}
            </CardHeader>
            <CardContent>
              {renderTable("summary")}
              {groupBy === "variety" && <p className="text-xs text-gray-500 mt-2">בקיבוץ לפי זן מוצגים נתוני קטיף בלבד — העלויות נרשמות ברמת המזרע ולא ברמת הזן.</p>}
              {groupBy === "plot" && <p className="text-xs text-gray-500 mt-2">אירועים של מזרע שמשתרע על כמה חלקות ולא סומנה בהם חלקה מוצגים בשורה "לא שויך לחלקה".</p>}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="activities">
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <CardTitle className="text-base">פעילויות</CardTitle>
                <Select value={filters.activity_type || "__all__"} onValueChange={v => setF({ activity_type: v === "__all__" ? "" : v })}>
                  <SelectTrigger className="w-44 h-8"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">כל סוגי הפעילויות</SelectItem>
                    {uniqueActivityTypes.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {actions("activities")}
            </CardHeader>
            <CardContent>{renderTable("activities")}</CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="harvests">
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <CardTitle className="text-base">קטיפים</CardTitle>
                <Select value={filters.quality || "__all__"} onValueChange={v => setF({ quality: v === "__all__" ? "" : v })}>
                  <SelectTrigger className="w-36 h-8"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">כל האיכויות</SelectItem>
                    {uniqueQualities.map(q => <SelectItem key={q} value={q}>{q}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {actions("harvests")}
            </CardHeader>
            <CardContent>{renderTable("harvests")}</CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sprayings">
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-base">הדברות</CardTitle>
              {actions("sprayings")}
            </CardHeader>
            <CardContent>{renderTable("sprayings")}</CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
