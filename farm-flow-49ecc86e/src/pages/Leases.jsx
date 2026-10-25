import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Lease } from "@/entities/all";
import { getMeCached, getFarmCached } from "@/api/cachedReads";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/use-toast";
import { Plus, KeyRound, Search, Loader2, FileText, Gauge, AlertTriangle, CalendarClock, ArrowDownLeft, ArrowUpRight, Bell } from "lucide-react";
import LeaseForm from "../components/leases/LeaseForm";
import LeaseDetail from "../components/leases/LeaseDetail";
import { apiFetch, ASSET_TYPES, FREQUENCIES, STATUSES, money, fmtDate, daysUntil } from "../components/leases/leaseUtils";

const TABS = [
  { key: "pay", label: "אנחנו שוכרים", icon: ArrowUpRight, hint: "קרקעות, מבנים וציוד שהמשק שוכר ומשלם עליהם" },
  { key: "receive", label: "אנחנו משכירים", icon: ArrowDownLeft, hint: "נכסים שהמשק משכיר ומקבל עליהם תשלום, כולל מוני חשמל ומים" },
];

export default function Leases() {
  const { toast } = useToast();
  const [user, setUser] = useState(null);
  const [farm, setFarm] = useState(null);
  const [leases, setLeases] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState(() => new URLSearchParams(window.location.search).get("tab") === "receive" ? "receive" : "pay");
  const [showEnded, setShowEnded] = useState(false);
  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(() => new URLSearchParams(window.location.search).get("create") === "true");
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState(null);

  const canWrite = !!user && (user.is_admin || ["owner", "manager", "worker"].includes(user.role));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const me = await getMeCached();
      setUser(me);
      if (!me?.current_farm_id) { setLoading(false); return; }
      const f = await getFarmCached(me.current_farm_id);
      setFarm(f);
      const [rows, sum] = await Promise.all([
        Lease.filter({ farm_id: me.current_farm_id }).catch(() => []),
        apiFetch(`/leases/summary?farm_id=${encodeURIComponent(me.current_farm_id)}`).catch(() => null),
      ]);
      setLeases(Array.isArray(rows) ? rows : []);
      setSummary(sum);
    } catch (e) {
      toast({ title: "שגיאה בטעינת שכירויות", description: e.message, variant: "destructive" });
    } finally { setLoading(false); }
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  const refreshSummary = async () => {
    if (!farm?.id) return;
    try { setSummary(await apiFetch(`/leases/summary?farm_id=${encodeURIComponent(farm.id)}`)); } catch { /* ignore */ }
  };

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return leases
      .filter((l) => l.direction === tab)
      .filter((l) => showEnded || l.status !== "ended")
      .filter((l) => !q || [l.title, l.counterparty_name, l.asset_description].some((s) => String(s || "").toLowerCase().includes(q)))
      .sort((a, b) => (a.status === "active" ? 0 : 1) - (b.status === "active" ? 0 : 1) || String(a.title).localeCompare(String(b.title), "he"));
  }, [leases, tab, showEnded, search]);

  const save = async (data) => {
    setSaving(true);
    try {
      if (editing) {
        const updated = await Lease.update(editing.id, { ...data, farm_id: farm.id });
        setLeases((ls) => ls.map((l) => (l.id === editing.id ? { ...l, ...data, ...updated } : l)));
        if (selected?.id === editing.id) setSelected((s) => ({ ...s, ...data, ...updated }));
        toast({ title: "ההסכם עודכן" });
      } else {
        const created = await Lease.create({ ...data, farm_id: farm.id });
        setLeases((ls) => [created, ...ls]);
        toast({ title: "ההסכם נוצר", description: "פתח את ההסכם ולחץ \"צור לוח תשלומים\" כדי ליצור את התשלומים הצפויים." });
        setSelected(created);
      }
      setFormOpen(false); setEditing(null);
      refreshSummary();
    } catch (e) {
      toast({ title: "השמירה נכשלה", description: e.message, variant: "destructive" });
    } finally { setSaving(false); }
  };

  const remove = async (lease) => {
    if (!confirm(`למחוק את ההסכם "${lease.title}"? התשלומים שלו יישארו ברשומות.`)) return;
    try {
      await Lease.delete(lease.id);
      setLeases((ls) => ls.filter((l) => l.id !== lease.id));
      setSelected(null);
      toast({ title: "ההסכם נמחק" });
      refreshSummary();
    } catch (e) { toast({ title: "המחיקה נכשלה", description: e.message, variant: "destructive" }); }
  };

  const dirSummary = summary?.[tab];
  const upcoming = (summary?.upcoming || []).filter((p) => p.direction === tab).slice(0, 4);

  if (loading) return <div className="flex justify-center items-center h-64"><Loader2 className="w-8 h-8 animate-spin text-indigo-500" /></div>;
  if (!farm) return <div className="p-6 text-center text-gray-500">בחר משק פעיל כדי לנהל שכירויות.</div>;

  return (
    <div className="p-3 sm:p-6 space-y-4" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl lg:text-3xl font-bold flex items-center gap-2"><KeyRound className="w-6 h-6 text-indigo-500" /> שכירויות</h1>
          <p className="text-sm text-gray-500 hidden sm:block">הסכמי שכירות, חוזים, תשלומים צפויים, מונים ותזכורות</p>
        </div>
        {canWrite && <Button onClick={() => { setEditing(null); setFormOpen(true); }} className="bg-indigo-600 hover:bg-indigo-700 text-white"><Plus className="w-4 h-4 ml-2" /> הסכם חדש</Button>}
      </div>

      {/* tabs */}
      <div className="grid grid-cols-2 gap-2">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} className={`rounded-xl border p-3 text-right transition ${tab === t.key ? "border-indigo-500 bg-indigo-50" : "border-gray-200 bg-white hover:bg-gray-50"}`}>
            <div className="flex items-center gap-2 font-semibold text-sm"><t.icon className={`w-4 h-4 ${t.key === "pay" ? "text-rose-500" : "text-emerald-600"}`} />{t.label}<span className="text-xs font-normal text-gray-400">({leases.filter((l) => l.direction === t.key && l.status === "active").length})</span></div>
            <div className="text-[11px] text-gray-500 mt-0.5 hidden sm:block">{t.hint}</div>
          </button>
        ))}
      </div>

      {/* KPIs */}
      {dirSummary && (
        <div className="grid grid-cols-3 gap-2">
          <Card><CardContent className="p-3 text-center"><div className="text-[11px] text-gray-500">{tab === "pay" ? "לשלם החודש" : "לקבל החודש"}</div><div className="text-lg font-bold tabular-nums">{money(dirSummary.due_this_month)}</div></CardContent></Card>
          <Card className={dirSummary.overdue > 0 ? "border-red-200 bg-red-50" : ""}><CardContent className="p-3 text-center"><div className="text-[11px] text-gray-500">באיחור</div><div className={`text-lg font-bold tabular-nums ${dirSummary.overdue > 0 ? "text-red-700" : ""}`}>{money(dirSummary.overdue)}</div></CardContent></Card>
          <Card><CardContent className="p-3 text-center"><div className="text-[11px] text-gray-500">{tab === "pay" ? "שולם החודש" : "התקבל החודש"}</div><div className="text-lg font-bold tabular-nums text-green-700">{money(dirSummary.paid_this_month)}</div></CardContent></Card>
        </div>
      )}

      {(upcoming.length > 0 || (summary?.ending_soon || []).length > 0) && (
        <Card className="border-amber-200 bg-amber-50/60">
          <CardContent className="p-3 space-y-1 text-sm">
            {upcoming.map((p) => {
              const d = daysUntil(p.due_date);
              return <div key={p.id} className="flex items-center gap-2"><CalendarClock className="w-4 h-4 text-amber-600 shrink-0" /><span className="flex-1 truncate">{p.lease_title} · {p.description}</span><span className="font-semibold tabular-nums">{money(p.amount)}</span><span className="text-xs text-gray-500 w-16 text-left">{d === 0 ? "היום" : `בעוד ${d} י'`}</span></div>;
            })}
            {(summary?.ending_soon || []).filter((l) => leases.find((x) => x.id === l.id)?.direction === tab).map((l) => (
              <div key={l.id} className="flex items-center gap-2 text-amber-800"><Bell className="w-4 h-4 shrink-0" /><span className="flex-1 truncate">ההסכם "{l.title}" מסתיים ב-{fmtDate(l.end_date)}</span></div>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]"><Search className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" /><Input className="pr-9" placeholder="חפש הסכם, שם, נכס…" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <label className="text-xs text-gray-500 inline-flex items-center gap-1 cursor-pointer"><input type="checkbox" checked={showEnded} onChange={(e) => setShowEnded(e.target.checked)} /> הצג הסכמים שהסתיימו</label>
      </div>

      {visible.length === 0 ? (
        <Card><CardContent className="text-center py-12 text-gray-500"><KeyRound className="w-10 h-10 text-gray-300 mx-auto mb-3" />{tab === "pay" ? "אין הסכמים שהמשק שוכר." : "אין הסכמים שהמשק משכיר."}{canWrite && <div className="mt-3"><Button variant="outline" onClick={() => { setEditing(null); setFormOpen(true); }}><Plus className="w-4 h-4 ml-1" /> הסכם חדש</Button></div>}</CardContent></Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((l) => {
            const endIn = l.end_date ? daysUntil(l.end_date) : null;
            const meters = Array.isArray(l.meters) ? l.meters : [];
            return (
              <Card key={l.id} className="cursor-pointer hover:shadow-md transition" onClick={() => setSelected(l)}>
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-semibold leading-tight">{l.title}</div>
                    <Badge className={l.status === "active" ? "bg-green-100 text-green-800" : l.status === "draft" ? "bg-yellow-100 text-yellow-800" : "bg-gray-100 text-gray-700"}>{STATUSES[l.status] || l.status}</Badge>
                  </div>
                  <div className="text-xs text-gray-500">{ASSET_TYPES[l.asset_type]}{l.asset_description ? ` · ${l.asset_description}` : ""}</div>
                  <div className="text-sm">{l.counterparty_name || <span className="text-gray-400">ללא צד שני</span>}</div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-bold tabular-nums">{money(l.amount)} <span className="text-xs font-normal text-gray-500">{FREQUENCIES[l.frequency]}</span></span>
                    <span className="text-xs text-gray-500">יום {l.due_day || 1} בחודש</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-gray-500">
                    {l.contract_url && <span className="inline-flex items-center gap-1"><FileText className="w-3 h-3" /> חוזה</span>}
                    {meters.length > 0 && <span className="inline-flex items-center gap-1"><Gauge className="w-3 h-3" /> {meters.length} מונים</span>}
                    {l.end_date && <span className={endIn != null && endIn < 60 ? "text-amber-700 inline-flex items-center gap-1" : ""}>{endIn != null && endIn < 60 && <AlertTriangle className="w-3 h-3" />}עד {fmtDate(l.end_date)}</span>}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <LeaseForm open={formOpen} onClose={() => { setFormOpen(false); setEditing(null); }} onSave={save} lease={editing} defaultDirection={tab} saving={saving} />
      <LeaseDetail open={!!selected} lease={selected ? leases.find((l) => l.id === selected.id) || selected : null} farmId={farm.id} canWrite={canWrite}
        onClose={() => setSelected(null)} onEdit={(l) => { setEditing(l); setFormOpen(true); }} onDelete={remove} onChanged={refreshSummary} />
    </div>
  );
}
