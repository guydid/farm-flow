
import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Seeding, Employee, Vehicle, WeighingCertificate,
  Harvest, Spraying, Activity, Variety, Pesticide,
  ActivityType, User, Farm
} from "@/entities/all";
import { createPageUrl } from "@/utils";
import { getMeCached, getFarmCached, getListCached } from "@/api/cachedReads";
import { useToast } from "@/components/ui/use-toast";
import { format, parseISO, differenceInDays } from "date-fns";
import {
  Plus, Tractor, Droplets, Users, Scale, MapPin, ChevronRight, ChevronLeft,
  Zap, Trash2, Truck, Settings, Layers, AlertTriangle, Bell,
  ClipboardList, Sprout, LayoutGrid, X, BellOff, CheckCircle2, ShieldAlert
} from "lucide-react";
import { getCropIcon } from "../seedings/CropIcons";
import { segmentMeta, ALERT_SEGMENT_ORDER } from "../layout/alertSegments";

/* ─── Page shortcuts config ──────────────────────────────────────── */
const PAGE_SHORTCUTS = [
  { label: "מזרעים",        page: "Seedings",            icon: Sprout,        bg: "bg-green-500",  light: "bg-green-50  border-green-200  text-green-700"  },
  { label: "חלקות",         page: "Plots",               icon: MapPin,        bg: "bg-teal-500",   light: "bg-teal-50   border-teal-200   text-teal-700"   },
  { label: "עובדים",        page: "Employees",           icon: Users,         bg: "bg-blue-500",   light: "bg-blue-50   border-blue-200   text-blue-700"   },
  { label: "רכבים",         page: "Vehicles",            icon: Truck,         bg: "bg-slate-500",  light: "bg-slate-50  border-slate-200  text-slate-700"  },
  { label: "שקילה",         page: "WeighingCertificates",icon: Scale,         bg: "bg-orange-500", light: "bg-orange-50 border-orange-200 text-orange-700" },
  { label: "יריעות",        page: "Sheets",              icon: Layers,        bg: "bg-purple-500", light: "bg-purple-50 border-purple-200 text-purple-700" },
  { label: "עובד שדה",      page: "FieldWorker",         icon: ClipboardList, bg: "bg-yellow-500", light: "bg-yellow-50 border-yellow-200 text-yellow-700" },
  { label: "הגדרות",        page: "Settings",            icon: Settings,      bg: "bg-gray-500",   light: "bg-gray-50   border-gray-200   text-gray-700"   },
];

/* ─── Alert helpers ───────────────────────────────────────────────── */
function buildAlerts(employees, vehicles) {
  const today = new Date();
  const result = [];

  // Employees (סגמנט: עובדים) — דרכון / ויזה
  employees
    .filter(e => e && e.status !== "inactive")
    .forEach(e => {
      const name = e.nickname || `${e.first_name || ""} ${e.last_name || ""}`.trim();
      const link = createPageUrl("EmployeeDetail") + `?id=${e.id}`;
      checkExpiry(e.passport_expiry, `דרכון — ${name}`, link, result, today, "workers");
      checkExpiry(e.visa_expiry,    `ויזה — ${name}`,    link, result, today, "workers");
    });

  // Vehicles (סגמנט: תפעולי) — ביטוח חובה / ביטוח מקיף / טסט
  vehicles
    .filter(v => v && v.status !== "sold" && v.status !== "out_of_order")
    .forEach(v => {
      const link = createPageUrl("VehicleDetail") + `?id=${v.id}`;
      checkExpiry(v.insurance_compulsory?.end_date, `ביטוח חובה — ${v.name}`, link, result, today, "operational");
      checkExpiry(v.insurance_info?.end_date,       `ביטוח מקיף — ${v.name}`, link, result, today, "operational");
      checkExpiry(v.licensing_info?.next_test_date, `טסט — ${v.name}`,         link, result, today, "operational");
    });

  return result;
}

function checkExpiry(dateStr, label, link, out, today, segment) {
  if (!dateStr) return;
  try {
    const d = parseISO(dateStr);
    const diff = differenceInDays(d, today);
    if (diff < 0)       out.push({ kind: "error",   text: `${label} פג תוקף!`,           link, segment });
    else if (diff <= 7)  out.push({ kind: "error",   text: `${label} פג בעוד ${diff} ימים`, link, segment });
    else if (diff <= 30) out.push({ kind: "warning", text: `${label} פג בעוד ${diff} ימים`, link, segment });
  } catch (_) {}
}

/* ─── Component ───────────────────────────────────────────────────── */
export default function MobileDashboard() {
  const [activeSeedings, setActiveSeedings]   = useState([]);
  const [allEmployees, setAllEmployees]       = useState([]);
  const [allVehicles, setAllVehicles]         = useState([]);
  const [todayWeighing, setTodayWeighing]     = useState([]);
  const [varieties, setVarieties]             = useState([]);
  const [pesticides, setPesticides]           = useState([]);
  const [activityTypes, setActivityTypes]     = useState([]);
  const [currentFarm, setCurrentFarm]         = useState(null);
  const [loading, setLoading]                 = useState(true);

  // Dismissed alerts — persisted per-day in localStorage
  const [dismissedKeys, setDismissedKeys] = useState(() => {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const stored = JSON.parse(localStorage.getItem("farmflow_alerts_dismissed") || "{}");
      return stored.date === today ? new Set(stored.keys || []) : new Set();
    } catch { return new Set(); }
  });

  const saveDismissed = (newSet) => {
    try {
      const today = new Date().toISOString().slice(0, 10);
      localStorage.setItem("farmflow_alerts_dismissed", JSON.stringify({ date: today, keys: [...newSet] }));
    } catch {}
    setDismissedKeys(new Set(newSet));
  };

  // ── computed here (before useEffect so dependency arrays are valid) ──
  const allAlerts    = buildAlerts(allEmployees, allVehicles).map(a => ({ ...a, key: `${a.link}|${a.kind}` }));
  const alerts       = allAlerts.filter(a => !dismissedKeys.has(a.key));
  const errCount     = alerts.filter(a => a.kind === "error").length;
  const activeEmployees = allEmployees.filter(e => e?.status === "active");

  const dismissAlert = (e, key) => {
    e.preventDefault();
    e.stopPropagation();
    const next = new Set(dismissedKeys);
    next.add(key);
    saveDismissed(next);
  };

  const dismissAllAlerts = () => {
    const next = new Set(allAlerts.map(a => a.key));
    saveDismissed(next);
  };

  // הסגמנט הפתוח כרגע בתצוגת ההתראות (אגרונומי / עובדים / תפעולי), null = סגור
  const [openSegment, setOpenSegment] = useState(null);

  // קיבוץ ההתראות הפעילות לפי סגמנט
  const alertsBySegment = {};
  ALERT_SEGMENT_ORDER.forEach(s => { alertsBySegment[s] = []; });
  alerts.forEach(a => { (alertsBySegment[a.segment] || alertsBySegment.operational).push(a); });

  // ניקוי כל ההתראות של סגמנט מסוים (להיום)
  const dismissSegment = (seg) => {
    const next = new Set(dismissedKeys);
    (alertsBySegment[seg] || []).forEach(a => next.add(a.key));
    saveDismissed(next);
  };

  // Dialog
  const [activeDialog, setActiveDialog]       = useState(null);
  const [selectedSeeding, setSelectedSeeding] = useState("");

  const { toast } = useToast();

  // Forms
  const emptyHarvest = {
    date: format(new Date(), "yyyy-MM-dd"),
    quantity: "", quality: "א'", price_per_unit: "",
    weight: "", packaging: "משטח פלסטיק", variety: "", package_count: ""
  };
  const emptySpraying = {
    date: format(new Date(), "yyyy-MM-dd"),
    treatment_type: "mechanized", treatment_time: "morning", notes: ""
  };
  const emptyActivity = {
    date: format(new Date(), "yyyy-MM-dd"),
    activity_type: "", area_covered: "", cost_per_unit: "",
    total_cost: "", performed_by: "", notes: ""
  };

  const [harvestForm,        setHarvestForm]        = useState(emptyHarvest);
  const [sprayingForm,       setSprayingForm]        = useState(emptySpraying);
  const [selectedPesticides, setSelectedPesticides]  = useState([]);
  const [activityForm,       setActivityForm]        = useState(emptyActivity);

  /* load ─────────────────────────────────────────────────────────── */
  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const user = await getMeCached();
      if (!user?.current_farm_id) { setLoading(false); return; }
      const farm = await getFarmCached(user.current_farm_id);
      setCurrentFarm(farm);
      const f = { farm_id: user.current_farm_id };

      const [seeds, emps, vehs, weigh, vars, pests, actTypes] = await Promise.all([
        Seeding.filter({ ...f, status: "growing" }).catch(() => []),
        Employee.filter(f).catch(() => []),
        Vehicle.filter(f).catch(() => []),
        WeighingCertificate.filter({ ...f, date: new Date().toISOString().split("T")[0] }).catch(() => []),
        getListCached('varieties', () => Variety.list()).catch(() => []),
        getListCached('pesticides', () => Pesticide.list()).catch(() => []),
        getListCached('activity_types', () => ActivityType.list()).catch(() => [])
      ]);

      setActiveSeedings(Array.isArray(seeds)    ? seeds.slice(0, 10) : []);
      setAllEmployees  (Array.isArray(emps)     ? emps               : []);
      setAllVehicles   (Array.isArray(vehs)     ? vehs               : []);
      setTodayWeighing (Array.isArray(weigh)    ? weigh              : []);
      setVarieties     (Array.isArray(vars)     ? vars               : []);
      setPesticides    (Array.isArray(pests)    ? pests              : []);
      setActivityTypes (Array.isArray(actTypes) ? actTypes           : []);
    } catch (e) {
      console.error("MobileDashboard load error:", e);
    }
    setLoading(false);
  };

  /* quick-action helpers start below */

  /* quick-action helpers ──────────────────────────────────────────── */
  const openQuickDialog = (type) => {
    if (!activeSeedings.length) {
      toast({ title: "שגיאה", description: "אין מזרעים פעילים. צור מזרע חדש תחילה.", variant: "destructive" });
      return;
    }
    setActiveDialog(type);
    setSelectedSeeding("");
    if (type === "spraying") setSelectedPesticides([]);
  };

  const handleQuickHarvest = async () => {
    if (!selectedSeeding) { toast({ title: "שגיאה", description: "בחר מזרע", variant: "destructive" }); return; }
    try {
      await Harvest.create({
        ...harvestForm, seeding_id: selectedSeeding,
        quantity: parseFloat(harvestForm.quantity) || 0,
        price_per_unit: parseFloat(harvestForm.price_per_unit) || 0,
        weight: parseFloat(harvestForm.weight) || 0,
        package_count: harvestForm.package_count ? parseFloat(harvestForm.package_count) : null
      });
      toast({ title: "הצלחה", description: "קטיף נוסף בהצלחה!" });
      setActiveDialog(null); setHarvestForm(emptyHarvest);
    } catch { toast({ title: "שגיאה", description: "הוספת קטיף נכשלה", variant: "destructive" }); }
  };

  const handleQuickSpraying = async () => {
    if (!selectedSeeding) { toast({ title: "שגיאה", description: "בחר מזרע", variant: "destructive" }); return; }
    const seeding = activeSeedings.find(s => s.id === selectedSeeding);
    if (!seeding?.farm_id) { toast({ title: "שגיאה", description: "לא ניתן למצוא את המשק", variant: "destructive" }); return; }
    try {
      await Spraying.create({
        ...sprayingForm, seeding_id: selectedSeeding, farm_id: seeding.farm_id,
        applied_pesticides: selectedPesticides.map(p => ({
          pesticide_id: p.pesticide_id, pesticide_name: p.pesticide_name,
          quantity: parseFloat(p.quantity || 0), unit: p.unit
        }))
      });
      toast({ title: "הצלחה", description: "הדברה נוספה בהצלחה!" });
      setActiveDialog(null); setSprayingForm(emptySpraying); setSelectedPesticides([]);
    } catch { toast({ title: "שגיאה", description: "הוספת הדברה נכשלה", variant: "destructive" }); }
  };

  const handleQuickActivity = async () => {
    if (!selectedSeeding) { toast({ title: "שגיאה", description: "בחר מזרע", variant: "destructive" }); return; }
    try {
      await Activity.create({
        ...activityForm, seeding_id: selectedSeeding,
        area_covered: parseFloat(activityForm.area_covered) || 0,
        cost_per_unit: parseFloat(activityForm.cost_per_unit) || 0,
        total_cost: parseFloat(activityForm.total_cost) || 0
      });
      toast({ title: "הצלחה", description: "פעילות נוספה בהצלחה!" });
      setActiveDialog(null); setActivityForm(emptyActivity);
    } catch { toast({ title: "שגיאה", description: "הוספת פעילות נכשלה", variant: "destructive" }); }
  };

  const addPesticide = (p) => {
    if (!selectedPesticides.find(x => x.pesticide_id === p.id))
      setSelectedPesticides([...selectedPesticides, { pesticide_id: p.id, pesticide_name: p.name, quantity: p.recommended_dosage_per_dunam || "", unit: p.unit || 'סמ"ק' }]);
  };
  const removePesticide = (i) => setSelectedPesticides(selectedPesticides.filter((_, idx) => idx !== i));
  const updatePesticide = (i, field, val) => {
    const n = [...selectedPesticides]; n[i][field] = val; setSelectedPesticides(n);
  };

  const getSeedingVarieties = (seedingId) => {
    const s = activeSeedings.find(x => x.id === seedingId);
    if (!s?.varieties) return [];
    return s.varieties.map(sv => varieties.find(v => v.id === sv.variety_id)).filter(Boolean);
  };

  /* ─── render ─────────────────────────────────────────────────────── */
  return (
    <div className="p-3 pb-6 space-y-4" dir="rtl">

      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between pt-1">
        <div>
          <h1 className="text-xl font-bold text-gray-800">
            {currentFarm ? currentFarm.name : "בקרה"}
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {new Date().toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "long" })}
          </p>
        </div>
        <div className="flex gap-2 items-center">
          {todayWeighing.length > 0 && (
            <Link to={createPageUrl("WeighingCertificates")}>
              <div className="flex items-center gap-1.5 bg-orange-50 border border-orange-200 rounded-lg px-2.5 py-1.5">
                <Scale className="w-4 h-4 text-orange-600" />
                <span className="text-sm font-medium text-orange-700">{todayWeighing.length} שקילות</span>
              </div>
            </Link>
          )}
          {allAlerts.length > 0 && alerts.length === 0 && (
            <button onClick={() => saveDismissed(new Set())} className="flex items-center gap-1 bg-gray-100 border border-gray-200 rounded-lg px-2.5 py-1.5">
              <BellOff className="w-4 h-4 text-gray-400" />
              <span className="text-sm text-gray-500">שחזר</span>
            </button>
          )}
          {errCount > 0 && (
            <div className="flex items-center gap-1 bg-red-50 border border-red-200 rounded-lg px-2.5 py-1.5">
              <Bell className="w-4 h-4 text-red-600" />
              <span className="text-sm font-bold text-red-700">{errCount}</span>
            </div>
          )}
        </div>
      </div>

      {/* ── Alert Segments (3 icons) ───────────────────────────────── */}
      {(() => {
        const SEG_ICON = { agronomic: Sprout, workers: Users, operational: Truck };
        const allDismissed = allAlerts.length > 0 && alerts.length === 0;

        return (
          <div className="space-y-2">
            <div className="grid grid-cols-3 gap-2">
              {ALERT_SEGMENT_ORDER.map(seg => {
                const meta = segmentMeta(seg);
                const Icon = SEG_ICON[seg] || ShieldAlert;
                const list = alertsBySegment[seg] || [];
                const errs = list.filter(a => a.kind === "error").length;
                const sev = errs > 0 ? "error" : list.length > 0 ? "warning" : "ok";
                const card = sev === "error" ? "bg-red-50 border-red-200"
                  : sev === "warning" ? "bg-amber-50 border-amber-200"
                  : "bg-green-50 border-green-200";
                const iconWrap = sev === "error" ? "bg-red-500"
                  : sev === "warning" ? "bg-amber-500"
                  : "bg-green-500";
                const isOpen = openSegment === seg;
                return (
                  <button
                    key={seg}
                    onClick={() => setOpenSegment(isOpen ? null : seg)}
                    className={`relative rounded-2xl border p-2.5 flex flex-col items-center gap-1 transition-all ${card} ${isOpen ? "ring-2 ring-offset-1 ring-gray-300" : ""}`}
                  >
                    <div className={`relative w-10 h-10 rounded-full ${iconWrap} flex items-center justify-center`}>
                      <Icon className="w-5 h-5 text-white" />
                      {list.length > 0 && (
                        <span className="absolute -top-1 -left-1 min-w-[18px] h-[18px] px-1 rounded-full bg-white border border-gray-200 text-[11px] font-bold text-gray-800 flex items-center justify-center">
                          {list.length}
                        </span>
                      )}
                      {sev === "ok" && (
                        <CheckCircle2 className="absolute -top-1 -left-1 w-4 h-4 text-green-600 bg-white rounded-full" />
                      )}
                    </div>
                    <span className="text-xs font-semibold text-gray-700">{meta.label}</span>
                    <span className="text-[11px] text-gray-400 leading-none">
                      {sev === "ok" ? "תקין" : sev === "error" ? `${errs} דחופות` : `${list.length} התראות`}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* רשימת ההתראות של הסגמנט הפתוח */}
            {openSegment && (
              <div className="rounded-2xl border border-gray-200 bg-white p-2 space-y-1.5">
                {(alertsBySegment[openSegment] || []).length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-3">
                    אין התראות פעילות ב{segmentMeta(openSegment).label}
                  </p>
                ) : (
                  <>
                    {alertsBySegment[openSegment].map(a => {
                      const isErr = a.kind === "error";
                      return (
                        <div
                          key={a.key}
                          className={`flex items-center gap-2 rounded-xl border px-2 py-2 ${isErr ? "bg-red-50 border-red-200" : "bg-amber-50 border-amber-200"}`}
                        >
                          <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${isErr ? "bg-red-500" : "bg-amber-500"}`}>
                            <AlertTriangle className="w-4 h-4 text-white" />
                          </div>
                          <Link
                            to={a.link}
                            className={`flex-1 text-sm font-medium leading-snug ${isErr ? "text-red-800" : "text-amber-800"}`}
                          >
                            {a.text}
                          </Link>
                          <button
                            onClick={(e) => dismissAlert(e, a.key)}
                            className={`p-1 rounded-lg flex-shrink-0 ${isErr ? "text-red-300 hover:bg-red-100" : "text-amber-300 hover:bg-amber-100"} transition-colors`}
                            aria-label="סגור"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      );
                    })}
                    <button
                      onClick={() => dismissSegment(openSegment)}
                      className="w-full text-xs text-gray-400 hover:text-gray-600 py-1 transition-colors"
                    >
                      נקה התראות {segmentMeta(openSegment).label}
                    </button>
                  </>
                )}
              </div>
            )}

            {/* שחזור התראות שהוסתרו */}
            {allDismissed && (
              <button
                onClick={() => saveDismissed(new Set())}
                className="w-full flex items-center justify-center gap-1.5 text-sm text-blue-500 font-medium py-1.5 rounded-xl bg-blue-50 border border-blue-100"
              >
                <BellOff className="w-4 h-4" /> שחזר {allAlerts.length} התראות מוסתרות להיום
              </button>
            )}
          </div>
        );
      })()}

      {/* ── All Pages Shortcuts ─────────────────────────────────────── */}
      <div>
        <h2 className="text-base font-semibold text-gray-600 flex items-center gap-1.5 mb-2">
          <LayoutGrid className="w-4 h-4 text-blue-500" />
          ניווט
        </h2>
        <div className="grid grid-cols-4 gap-2">
          {PAGE_SHORTCUTS.map((s, i) => (
            <Link key={i} to={createPageUrl(s.page)}>
              <div className={`rounded-2xl flex flex-col items-center justify-center gap-1.5 py-3.5 border active:scale-95 transition-transform ${s.light}`}>
                <div className={`w-10 h-10 rounded-full ${s.bg} flex items-center justify-center`}>
                  <s.icon className="w-5 h-5 text-white" />
                </div>
                <span className="text-sm font-medium leading-tight text-center">{s.label}</span>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* ── Active Seedings ─────────────────────────────────────────── */}
      {activeSeedings.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-base font-semibold text-gray-600 flex items-center gap-1.5">
              <Tractor className="w-4 h-4 text-green-500" />
              מזרעים פעילים ({activeSeedings.length})
            </h2>
            <Link to={createPageUrl("Seedings")}>
              <span className="text-sm text-blue-600 flex items-center gap-0.5">
                הכל <ChevronRight className="w-4 h-4" />
              </span>
            </Link>
          </div>
          <div className="space-y-2">
            {activeSeedings.map(s => (
              <Link key={s.id} to={createPageUrl("SeedingDetail") + `?id=${s.id}`}>
                <div className="flex items-center gap-3 px-3 py-2.5 bg-green-50 border border-green-100 rounded-xl active:scale-98 transition-transform">
                  <div className="flex-shrink-0">{getCropIcon(s.crop_type, "w-5 h-5")}</div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-base text-green-800 truncate">{s.name}</p>
                    <p className="text-sm text-green-600">{s.crop_type}</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-green-400 flex-shrink-0" />
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* ── Active Employees mini strip ─────────────────────────────── */}
      {activeEmployees.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-base font-semibold text-gray-600 flex items-center gap-1.5">
              <Users className="w-4 h-4 text-blue-500" />
              עובדים פעילים ({activeEmployees.length})
            </h2>
            <Link to={createPageUrl("Employees")}>
              <span className="text-sm text-blue-600 flex items-center gap-0.5">
                הכל <ChevronRight className="w-4 h-4" />
              </span>
            </Link>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {activeEmployees.slice(0, 10).map(e => (
              <Link key={e.id} to={createPageUrl("EmployeeDetail") + `?id=${e.id}`} className="flex-shrink-0">
                <div className="flex flex-col items-center gap-1 w-16">
                  <div className="w-12 h-12 rounded-full bg-blue-100 border-2 border-blue-200 flex items-center justify-center">
                    <span className="text-sm font-bold text-blue-700">
                      {(e.nickname || e.first_name || "?").slice(0, 2)}
                    </span>
                  </div>
                  <p className="text-xs text-gray-600 text-center truncate w-full">
                    {e.nickname || e.first_name}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* ══════════════ Dialogs ════════════════════════════════════════ */}

      {/* Harvest dialog */}
      <Dialog open={activeDialog === "harvest"} onOpenChange={() => setActiveDialog(null)}>
        <DialogContent dir="rtl" className="max-w-lg w-full h-[90dvh] sm:h-auto overflow-y-auto rounded-t-2xl sm:rounded-lg mx-0 sm:mx-auto bottom-0 sm:bottom-auto top-auto sm:top-[50%] translate-y-0 sm:-translate-y-1/2 fixed">
          <DialogHeader><DialogTitle>קטיף מהיר</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>בחר מזרע</Label>
              <Select value={selectedSeeding} onValueChange={setSelectedSeeding}>
                <SelectTrigger><SelectValue placeholder="בחר מזרע..." /></SelectTrigger>
                <SelectContent>
                  {activeSeedings.map(s => <SelectItem key={s.id} value={s.id}>{s.name} - {s.crop_type}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>תאריך</Label><Input type="date" value={harvestForm.date} onChange={e => setHarvestForm({...harvestForm, date: e.target.value})} /></div>
              <div><Label>כמות</Label><Input type="number" value={harvestForm.quantity} onChange={e => setHarvestForm({...harvestForm, quantity: e.target.value})} placeholder="כמות" /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>משקל (ק"ג)</Label><Input type="number" value={harvestForm.weight} onChange={e => setHarvestForm({...harvestForm, weight: e.target.value})} placeholder="משקל" /></div>
              <div>
                <Label>איכות</Label>
                <Select value={harvestForm.quality} onValueChange={v => setHarvestForm({...harvestForm, quality: v})}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="א'">א'</SelectItem>
                    <SelectItem value="ב'">ב'</SelectItem>
                    <SelectItem value="ג'">ג'</SelectItem>
                    <SelectItem value="תעשייתי">תעשייתי</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {selectedSeeding && (
              <div>
                <Label>זן</Label>
                <Select value={harvestForm.variety} onValueChange={v => setHarvestForm({...harvestForm, variety: v})}>
                  <SelectTrigger><SelectValue placeholder="בחר זן..." /></SelectTrigger>
                  <SelectContent>
                    {getSeedingVarieties(selectedSeeding).map(v => <SelectItem key={v.id} value={v.name}>{v.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div><Label>מחיר ליחידה</Label><Input type="number" step="0.01" value={harvestForm.price_per_unit} onChange={e => setHarvestForm({...harvestForm, price_per_unit: e.target.value})} placeholder="מחיר" /></div>
            <div><Label>מספר אריזות</Label><Input type="number" value={harvestForm.package_count} onChange={e => setHarvestForm({...harvestForm, package_count: e.target.value})} placeholder="מספר אריזות" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setActiveDialog(null)}>ביטול</Button>
            <Button onClick={handleQuickHarvest}>הוסף קטיף</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Spraying dialog */}
      <Dialog open={activeDialog === "spraying"} onOpenChange={() => setActiveDialog(null)}>
        <DialogContent dir="rtl" className="max-w-lg w-full h-[90dvh] sm:h-auto overflow-y-auto rounded-t-2xl sm:rounded-lg mx-0 sm:mx-auto bottom-0 sm:bottom-auto top-auto sm:top-[50%] translate-y-0 sm:-translate-y-1/2 fixed">
          <DialogHeader><DialogTitle>הדברה מהירה</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>בחר מזרע</Label>
              <Select value={selectedSeeding} onValueChange={setSelectedSeeding}>
                <SelectTrigger><SelectValue placeholder="בחר מזרע..." /></SelectTrigger>
                <SelectContent>
                  {activeSeedings.map(s => <SelectItem key={s.id} value={s.id}>{s.name} - {s.crop_type}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>תאריך</Label><Input type="date" value={sprayingForm.date} onChange={e => setSprayingForm({...sprayingForm, date: e.target.value})} /></div>
              <div>
                <Label>סוג טיפול</Label>
                <Select value={sprayingForm.treatment_type} onValueChange={v => setSprayingForm({...sprayingForm, treatment_type: v})}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="mechanized">ממוכן</SelectItem>
                    <SelectItem value="spray_gun">אקדח ריסוס</SelectItem>
                    <SelectItem value="backpack">ריסוס גב</SelectItem>
                    <SelectItem value="drench">הגמעה</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>זמן טיפול</Label>
              <Select value={sprayingForm.treatment_time} onValueChange={v => setSprayingForm({...sprayingForm, treatment_time: v})}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="morning">בוקר</SelectItem>
                  <SelectItem value="noon">צהריים</SelectItem>
                  <SelectItem value="evening">ערב</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>חומרי הדברה</Label>
              <div className="space-y-2 max-h-32 overflow-y-auto">
                {selectedPesticides.length > 0 ? selectedPesticides.map((p, i) => (
                  <div key={i} className="flex items-center justify-between p-2 bg-gray-50 rounded-md text-sm">
                    <div className="flex-1">
                      <div className="font-medium">{p.pesticide_name}</div>
                      <div className="flex gap-2 mt-1">
                        <Input type="number" placeholder="כמות" value={p.quantity} onChange={e => updatePesticide(i, "quantity", e.target.value)} className="h-6 text-xs w-16" />
                        <Input placeholder="יחידה" value={p.unit} onChange={e => updatePesticide(i, "unit", e.target.value)} className="h-6 text-xs w-16" />
                      </div>
                    </div>
                    <Button type="button" variant="ghost" size="sm" onClick={() => removePesticide(i)} className="text-red-500 h-6 w-6 p-0"><Trash2 className="w-3 h-3" /></Button>
                  </div>
                )) : <div className="text-center py-2 text-gray-500 text-sm bg-gray-50 rounded-md">לא נבחרו תכשירים</div>}
                <Select onValueChange={v => { const p = pesticides.find(x => x.id === v); if (p) addPesticide(p); }}>
                  <SelectTrigger className="h-8"><SelectValue placeholder="הוסף תכשיר..." /></SelectTrigger>
                  <SelectContent>
                    {pesticides.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div><Label>הערות</Label><Textarea value={sprayingForm.notes} onChange={e => setSprayingForm({...sprayingForm, notes: e.target.value})} placeholder="הערות נוספות..." className="h-16" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setActiveDialog(null)}>ביטול</Button>
            <Button onClick={handleQuickSpraying}>הוסף הדברה</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Activity dialog */}
      <Dialog open={activeDialog === "activity"} onOpenChange={() => setActiveDialog(null)}>
        <DialogContent dir="rtl" className="max-w-lg w-full h-[90dvh] sm:h-auto overflow-y-auto rounded-t-2xl sm:rounded-lg mx-0 sm:mx-auto bottom-0 sm:bottom-auto top-auto sm:top-[50%] translate-y-0 sm:-translate-y-1/2 fixed">
          <DialogHeader><DialogTitle>פעילות מהירה</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>בחר מזרע</Label>
              <Select value={selectedSeeding} onValueChange={setSelectedSeeding}>
                <SelectTrigger><SelectValue placeholder="בחר מזרע..." /></SelectTrigger>
                <SelectContent>
                  {activeSeedings.map(s => <SelectItem key={s.id} value={s.id}>{s.name} - {s.crop_type}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>תאריך</Label><Input type="date" value={activityForm.date} onChange={e => setActivityForm({...activityForm, date: e.target.value})} /></div>
              <div>
                <Label>סוג פעילות</Label>
                <Select value={activityForm.activity_type} onValueChange={v => setActivityForm({...activityForm, activity_type: v})}>
                  <SelectTrigger><SelectValue placeholder="בחר פעילות..." /></SelectTrigger>
                  <SelectContent>
                    {activityTypes.map(t => <SelectItem key={t.id} value={t.name}>{t.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>שטח (דונם)</Label><Input type="number" step="0.1" value={activityForm.area_covered} onChange={e => setActivityForm({...activityForm, area_covered: e.target.value})} placeholder="שטח" /></div>
              <div><Label>עלות כוללת</Label><Input type="number" step="0.01" value={activityForm.total_cost} onChange={e => setActivityForm({...activityForm, total_cost: e.target.value})} placeholder="עלות" /></div>
            </div>
            <div><Label>מבצע</Label><Input value={activityForm.performed_by} onChange={e => setActivityForm({...activityForm, performed_by: e.target.value})} placeholder="שם המבצע" /></div>
            <div><Label>הערות</Label><Textarea value={activityForm.notes} onChange={e => setActivityForm({...activityForm, notes: e.target.value})} placeholder="הערות נוספות..." /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setActiveDialog(null)}>ביטול</Button>
            <Button onClick={handleQuickActivity}>הוסף פעילות</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
