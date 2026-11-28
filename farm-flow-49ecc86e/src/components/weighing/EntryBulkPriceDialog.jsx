import React, { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { EntryCertificate, EntryItem } from "@/entities/all";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { itemTotal } from "@/pages/EntryQuantities";

// עדכון מחירים לפריטים של תעודות כניסה שסומנו ברשימה.
// הפריטים מקובצים לפי מוצר + איכות. מחיר בכותרת הקבוצה ממלא את כל השורות שלה; אפשר גם לשנות שורה בודדת.
// בשמירה מתעדכנות רק שורות ששונו, וסיכום כל תעודה מחושב מחדש מכל הפריטים שלה.

const n = (v) => parseFloat(v) || 0;
const round2 = (v) => Math.round(v * 100) / 100;
const kg = (v) => n(v).toLocaleString("he-IL", { maximumFractionDigits: 1 });
const money = (v) => `₪${n(v).toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (d) => { try { return d ? format(new Date(d), "dd/MM") : ""; } catch { return ""; } };
const METHODS = [["per_kg", 'ק"ג'], ["per_unit", "יחידה"]];

export default function EntryBulkPriceDialog({ open, farmId, certificates, onClose, onSaved }) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [allItems, setAllItems] = useState([]);
  const [draft, setDraft] = useState({}); // itemId -> { price: string, method }
  const [groupPrice, setGroupPrice] = useState({}); // groupKey -> string
  const [saving, setSaving] = useState(false);

  const certMap = useMemo(() => new Map((certificates || []).map(c => [c.id, c])), [certificates]);

  useEffect(() => {
    if (!open || !farmId) return;
    let alive = true;
    setLoading(true);
    setDraft({});
    setGroupPrice({});
    EntryItem.filter({ farm_id: farmId })
      .then(items => { if (alive) setAllItems(Array.isArray(items) ? items : []); })
      .catch(e => { console.error("Failed to load entry items:", e); toast({ title: "שגיאה", description: "טעינת הפריטים נכשלה", variant: "destructive" }); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [open, farmId, toast]);

  const items = useMemo(() => allItems.filter(it => certMap.has(it.certificate_id)), [allItems, certMap]);

  const groups = useMemo(() => {
    const m = new Map();
    for (const it of items) {
      const key = `${it.product_id || it.product_name || ""}|${it.quality || ""}`;
      if (!m.has(key)) m.set(key, { key, name: it.product_name || "ללא שם", quality: it.quality || "", rows: [] });
      m.get(key).rows.push(it);
    }
    const list = [...m.values()];
    for (const g of list) g.rows.sort((a, b) => String(certMap.get(a.certificate_id)?.date || "").localeCompare(String(certMap.get(b.certificate_id)?.date || "")));
    return list.sort((a, b) => a.name.localeCompare(b.name, "he"));
  }, [items, certMap]);

  const curIn = (dr, it) => {
    const d = dr[it.id];
    return { price: d ? d.price : (n(it.price_per_unit) ? String(it.price_per_unit) : ""), method: d ? d.method : (it.pricing_method || "per_kg") };
  };
  const cur = (it) => curIn(draft, it);
  const isChanged = (it) => {
    const d = draft[it.id];
    if (!d) return false;
    return n(d.price) !== n(it.price_per_unit) || d.method !== (it.pricing_method || "per_kg");
  };
  const totalOf = (it) => { const c = cur(it); return itemTotal({ ...it, price_per_unit: c.price, pricing_method: c.method }); };

  const setRow = (it, patch) => setDraft(prev => ({ ...prev, [it.id]: { ...curIn(prev, it), ...patch } }));
  const groupMethod = (g) => {
    const kgCount = g.rows.filter(r => cur(r).method === "per_kg").length;
    return kgCount >= g.rows.length - kgCount ? "per_kg" : "per_unit";
  };
  const applyGroup = (g, patch) => setDraft(prev => {
    const next = { ...prev };
    for (const it of g.rows) next[it.id] = { ...curIn(prev, it), ...patch };
    return next;
  });

  const changed = items.filter(isChanged);
  const before = items.reduce((s, it) => s + n(it.item_total), 0);
  const after = items.reduce((s, it) => s + totalOf(it), 0);
  const unpriced = items.filter(it => !n(cur(it).price)).length;

  const save = async () => {
    if (!changed.length) return;
    setSaving(true);
    try {
      const updated = new Map();
      const queue = [...changed];
      while (queue.length) {
        const chunk = queue.splice(0, 5);
        await Promise.all(chunk.map(async (it) => {
          const c = cur(it);
          const price = round2(n(c.price));
          const data = { price_per_unit: price, pricing_method: c.method, item_total: itemTotal({ ...it, price_per_unit: price, pricing_method: c.method }) };
          await EntryItem.update(it.id, data);
          updated.set(it.id, { ...it, ...data });
        }));
      }
      const next = allItems.map(it => updated.get(it.id) || it);
      const certIds = [...new Set(changed.map(it => it.certificate_id))];
      await Promise.all(certIds.map(cid => {
        const total_amount = round2(next.filter(it => it.certificate_id === cid).reduce((s, it) => s + n(it.item_total), 0));
        return EntryCertificate.update(cid, { total_amount });
      }));
      toast({ title: "המחירים עודכנו", description: `${updated.size} שורות ב-${certIds.length} תעודות` });
      onSaved?.();
    } catch (e) {
      console.error("Bulk price update failed:", e);
      toast({ title: "שגיאה", description: "עדכון המחירים נכשל. חלק מהשורות אולי עודכנו — פתח שוב לבדיקה.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const completedCount = (certificates || []).filter(c => c.status === "completed").length;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !saving) onClose(); }}>
      <DialogContent dir="rtl" className="w-[95vw] max-w-3xl max-h-[92vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>עדכון מחירים · {(certificates || []).length} תעודות</DialogTitle>
          <DialogDescription>
            מחיר בשורת המוצר ממלא את כל הפריטים שלו בתעודות שסומנו. אפשר גם לשנות פריט בודד. נשמרים רק פריטים ששונו.
            {completedCount > 0 && ` ${completedCount} מהתעודות כבר הושלמו.`}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto -mx-1 px-1 min-h-[140px]">
          {loading ? (
            <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-indigo-600" /></div>
          ) : groups.length === 0 ? (
            <p className="text-center text-sm text-gray-500 py-10">אין פריטים בתעודות שסומנו</p>
          ) : (
            <div className="space-y-3">
              {groups.map(g => {
                const gm = groupMethod(g);
                const gw = g.rows.reduce((s, r) => s + n(r.net_weight), 0);
                const gp = g.rows.reduce((s, r) => s + (parseInt(r.package_count, 10) || 0), 0);
                const gt = g.rows.reduce((s, r) => s + totalOf(r), 0);
                return (
                  <div key={g.key} className="border rounded-lg">
                    <div className="flex flex-wrap items-center gap-2 px-3 py-2 bg-gray-50 rounded-t-lg">
                      <div className="flex-1 min-w-[140px]">
                        <div className="font-semibold">{g.name}{g.quality && <span className="text-xs font-normal text-gray-500"> · {g.quality}</span>}</div>
                        <div className="text-xs text-gray-500 tabular-nums">{g.rows.length} שורות · {gp} אריזות · {kg(gw)} ק"ג · {money(gt)}</div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Input type="number" inputMode="decimal" min="0" step="0.01" className="w-24 h-9"
                          placeholder="לכולם" aria-label={`מחיר לכל ${g.name}`}
                          value={groupPrice[g.key] ?? ""}
                          onChange={e => { const v = e.target.value; setGroupPrice(p => ({ ...p, [g.key]: v })); if (v !== "") applyGroup(g, { price: v }); }} />
                        <select className="h-9 border rounded-md px-2 text-sm bg-white" aria-label="שיטת תמחור"
                          value={gm} onChange={e => applyGroup(g, { method: e.target.value })}>
                          {METHODS.map(([v, l]) => <option key={v} value={v}>לפי {l}</option>)}
                        </select>
                      </div>
                    </div>
                    <ul className="divide-y">
                      {g.rows.map(it => {
                        const c = cur(it);
                        const cert = certMap.get(it.certificate_id) || {};
                        return (
                          <li key={it.id} className={`flex flex-wrap items-center gap-2 px-3 py-2 text-sm ${isChanged(it) ? "bg-amber-50" : ""}`}>
                            <div className="flex-1 min-w-[150px]">
                              <div className="font-medium">{cert.supplier_name || "ללא ספק"}</div>
                              <div className="text-xs text-gray-500">
                                #{cert.reference_number || String(cert.id || "").slice(-5)} · {fmtDate(cert.date)} · {it.package_count || 0} × {it.packaging_type || "אריזה"} · {kg(it.net_weight)} ק"ג
                              </div>
                            </div>
                            <Input type="number" inputMode="decimal" min="0" step="0.01" className="w-20 h-9"
                              aria-label="מחיר" placeholder="0" value={c.price}
                              onChange={e => setRow(it, { price: e.target.value })} />
                            <span className="text-xs text-gray-500 w-10">/{c.method === "per_kg" ? 'ק"ג' : "יח'"}</span>
                            <span className="w-24 text-left font-semibold tabular-nums">{money(totalOf(it))}</span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:justify-between items-center border-t pt-3">
          <div className="text-sm text-gray-600 tabular-nums">
            {changed.length ? `${changed.length} שורות שונו · ` : ""}סה"כ {money(before)}{Math.abs(after - before) > 0.004 ? ` ← ${money(after)}` : ""}
            {unpriced > 0 && <span className="text-amber-700"> · {unpriced} בלי מחיר</span>}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={saving}>ביטול</Button>
            <Button onClick={save} disabled={saving || !changed.length}>
              {saving && <Loader2 className="w-4 h-4 animate-spin ml-1" />}
              שמור מחירים
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
