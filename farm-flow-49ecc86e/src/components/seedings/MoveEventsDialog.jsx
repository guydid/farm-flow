import { useEffect, useMemo, useState } from "react";
import { batchFetch, getToken } from "@/api/localClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import { ArrowLeftRight, Check, Loader2, MapPin, Search } from "lucide-react";

const BASE_URL = import.meta.env.VITE_API_URL || "/api";
const TYPE_HE = { activity: "פעילויות", harvest: "קטיפים", spraying: "הדברות" };
const STATUS_HE = { ordered: "הוזמן", preparation: "הכנה", growing: "גידול", harvesting: "קטיף", uprooted: "נעקר", archived: "בארכיון" };
const ACTIVE = new Set(["ordered", "preparation", "growing", "harvesting"]);

// העברת אירועים (פעילויות / קטיפים / הדברות) ממזרע אחד לאחר באותו משק
export default function MoveEventsDialog({ open, events, seeding, onClose, onMoved }) {
  const { toast } = useToast();
  const [seedings, setSeedings] = useState([]);
  const [plotSeedings, setPlotSeedings] = useState([]);
  const [plots, setPlots] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [targetId, setTargetId] = useState(null);
  const [showInactive, setShowInactive] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !seeding?.farm_id) return;
    setTargetId(null); setSearch("");
    setLoading(true);
    batchFetch([
      { entity: "seedings", filter: { farm_id: seeding.farm_id } },
      { entity: "plot_seedings" },
      { entity: "plots", filter: { farm_id: seeding.farm_id } },
    ]).then(([s, ps, p]) => {
      setSeedings(Array.isArray(s) ? s : []);
      setPlotSeedings(Array.isArray(ps) ? ps : []);
      setPlots(Array.isArray(p) ? p : []);
    }).catch(() => toast({ title: "טעינת המזרעים נכשלה", variant: "destructive" }))
      .finally(() => setLoading(false));
  }, [open, seeding?.farm_id, toast]);

  const plotNamesOf = useMemo(() => {
    const byId = new Map(plots.map(p => [p.id, p.name]));
    return (sid) => plotSeedings.filter(ps => ps?.seeding_id === sid).map(ps => byId.get(ps.plot_id)).filter(Boolean);
  }, [plots, plotSeedings]);

  const candidates = useMemo(() => {
    const q = search.trim().toLowerCase();
    return seedings
      .filter(s => s && s.id !== seeding?.id)
      .filter(s => showInactive || ACTIVE.has(s.status) || s.id === targetId)
      .filter(s => !q || [s.name, s.crop_type, s.variety, ...plotNamesOf(s.id)].filter(Boolean).some(v => String(v).toLowerCase().includes(q)))
      .sort((a, b) =>
        (Number(b.crop_type === seeding?.crop_type) - Number(a.crop_type === seeding?.crop_type)) ||
        (Number(ACTIVE.has(b.status)) - Number(ACTIVE.has(a.status))) ||
        String(b.planting_date || b.start_date || "").localeCompare(String(a.planting_date || a.start_date || "")));
  }, [seedings, seeding, search, showInactive, targetId, plotNamesOf]);

  const counts = useMemo(() => {
    const c = {};
    for (const e of events || []) c[e.type] = (c[e.type] || 0) + 1;
    return Object.entries(c).map(([t, n]) => `${n} ${TYPE_HE[t] || t}`).join(", ");
  }, [events]);

  const target = seedings.find(s => s.id === targetId);
  const targetPlots = target ? plotNamesOf(target.id) : [];

  const doMove = async () => {
    if (!target) return;
    setSaving(true);
    try {
      const res = await fetch(`${BASE_URL}/seedings/move-events`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ target_seeding_id: target.id, events: events.map(e => ({ type: e.type, id: e.id })) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);
      toast({
        title: `הועברו ${data.moved} אירועים ל"${target.name}"`,
        description: data.plot_changed ? `ב-${data.plot_changed} מהם החלקה עודכנה לפי חלקות המזרע החדש` : undefined,
      });
      onMoved?.(data);
    } catch (e) {
      toast({ title: "ההעברה נכשלה", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && !saving) onClose?.(); }}>
      <DialogContent dir="rtl" className="sm:max-w-lg max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><ArrowLeftRight className="w-5 h-5" /> העברה למזרע אחר</DialogTitle>
          <DialogDescription>
            {counts} מ"{seeding?.name}". בחרו את המזרע שאליו לשייך אותם.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" aria-hidden="true" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="חיפוש לפי שם, גידול, זן או חלקה" className="pr-9" aria-label="חיפוש מזרע" />
        </div>
        <label className="flex items-center gap-2 text-xs text-gray-500 cursor-pointer">
          <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />
          הצג גם מזרעים שנעקרו / בארכיון
        </label>

        <div className="flex-1 min-h-[180px] overflow-y-auto border rounded-lg divide-y" role="listbox" aria-label="מזרע יעד">
          {loading ? (
            <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
          ) : candidates.length === 0 ? (
            <div className="text-sm text-gray-400 text-center py-10">לא נמצאו מזרעים</div>
          ) : candidates.map(s => {
            const sel = s.id === targetId;
            const names = plotNamesOf(s.id);
            return (
              <button
                key={s.id}
                type="button"
                role="option"
                aria-selected={sel}
                onClick={() => setTargetId(s.id)}
                className={`w-full text-right px-3 py-2.5 flex items-start gap-2 transition-colors ${sel ? "bg-indigo-50" : "hover:bg-gray-50"}`}
              >
                <span className={`mt-0.5 w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${sel ? "bg-indigo-600 border-indigo-600 text-white" : "border-gray-300"}`}>
                  {sel && <Check className="w-3 h-3" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm text-gray-900">{s.name}</span>
                    <span className="text-[11px] px-1.5 rounded bg-gray-100 text-gray-600">{STATUS_HE[s.status] || s.status}</span>
                  </span>
                  <span className="block text-xs text-gray-500 truncate">
                    {[s.crop_type, s.variety, s.planting_date ? `שתילה ${s.planting_date.slice(8, 10)}/${s.planting_date.slice(5, 7)}/${s.planting_date.slice(2, 4)}` : null].filter(Boolean).join(" · ")}
                  </span>
                  {names.length > 0 && (
                    <span className="block text-[11px] text-gray-400 truncate"><MapPin className="w-3 h-3 inline ml-0.5" />{names.join(", ")}</span>
                  )}
                </span>
              </button>
            );
          })}
        </div>

        {target && (
          <p className="text-xs text-gray-500 bg-gray-50 rounded p-2">
            {targetPlots.length === 1
              ? `אירועים שמשויכים לחלקה שאינה של "${target.name}" יעברו לחלקה ${targetPlots[0]}.`
              : targetPlots.length > 1
                ? `אירועים שמשויכים לחלקה שאינה של "${target.name}" יישארו בלי חלקה. אפשר לבחור חלקה אחר כך בעריכת האירוע.`
                : `ל"${target.name}" אין חלקות, והאירועים יישארו בלי חלקה.`}
            {" "}תאריכי השתילה, הקטיף הראשון והעקירה של שני המזרעים יחושבו מחדש.
          </p>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>ביטול</Button>
          <Button onClick={doMove} disabled={!target || saving}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin ml-1" /> : <ArrowLeftRight className="w-4 h-4 ml-1" />}
            העבר{target ? ` ל"${target.name}"` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
