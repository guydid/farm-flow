import React, { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { EntryCertificate, EntryItem, WeighingCertificate } from "@/entities/all";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Loader2, Search } from "lucide-react";

// בחירת משטחים שנקלטו בתעודות כניסה (רכש מחקלאי) כדי להוסיף אותם לתעודת שקילה (מכירה).
// משטח זמין = פריט כניסה שלא שויך עדיין לתעודת מכירה קיימת (sold_certificate_id ריק או שהתעודה נמחקה).
// הבחירה מוחזרת ל-onConfirm(entries) — כל רשומה: { item, cert }.

const n = (v) => parseFloat(v) || 0;
const fmtDate = (d) => { try { return d ? format(new Date(d), "dd/MM/yyyy") : ""; } catch { return String(d || ""); } };

export default function EntryPalletPicker({ open, farmId, onClose, onConfirm }) {
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState([]);
  const [selected, setSelected] = useState(() => new Set());
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !farmId) return;
    let alive = true;
    setLoading(true);
    setSelected(new Set());
    setQ("");
    const f = { farm_id: farmId };
    Promise.all([EntryCertificate.filter(f), EntryItem.filter(f), WeighingCertificate.filter(f)])
      .then(([certs, items, sales]) => {
        if (!alive) return;
        const saleIds = new Set((sales || []).map(s => s.id));
        const certMap = new Map((certs || []).map(c => [c.id, c]));
        const list = (items || [])
          .filter(it => certMap.has(it.certificate_id) && !(it.sold_certificate_id && saleIds.has(it.sold_certificate_id)))
          .map(it => ({ item: it, cert: certMap.get(it.certificate_id) }))
          .sort((a, b) => String(b.cert.date || "").localeCompare(String(a.cert.date || "")) || String(b.item.created_at || "").localeCompare(String(a.item.created_at || "")));
        setRows(list);
      })
      .catch(e => console.error("Failed to load entry pallets:", e))
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [open, farmId]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter(({ item, cert }) =>
      [cert.supplier_name, item.product_name, item.quality, item.packaging_type, cert.reference_number, cert.supplier_reference]
        .some(v => String(v || "").toLowerCase().includes(s)));
  }, [rows, q]);

  // קיבוץ לפי תעודת כניסה
  const groups = useMemo(() => {
    const m = new Map();
    for (const r of filtered) {
      if (!m.has(r.cert.id)) m.set(r.cert.id, { cert: r.cert, rows: [] });
      m.get(r.cert.id).rows.push(r);
    }
    return [...m.values()];
  }, [filtered]);

  const toggle = (id) => setSelected(prev => { const s = new Set(prev); if (s.has(id)) s.delete(id); else s.add(id); return s; });
  const chosen = rows.filter(r => selected.has(r.item.id));
  const sum = chosen.reduce((t, r) => ({ p: t.p + (parseInt(r.item.package_count, 10) || 0), w: t.w + n(r.item.net_weight) }), { p: 0, w: 0 });

  const confirm = async () => {
    if (!chosen.length) return;
    setBusy(true);
    try { await onConfirm(chosen); } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent dir="rtl" className="max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>משטחים מתעודות כניסה</DialogTitle>
          <DialogDescription>משטחים שנקלטו מחקלאים ועוד לא נמכרו. המשקלים והאריזות מועתקים; המשטחים נוספים בלי מחיר (מחיר הקנייה לא עובר למכירה) — את מחיר המכירה קובעים בתעודה.</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" aria-hidden="true" />
          <Input value={q} onChange={e => setQ(e.target.value)} placeholder="חיפוש לפי ספק, מוצר, מס' תעודה או ת.מ" className="pr-9" aria-label="חיפוש משטחים" />
        </div>
        <div className="flex-1 overflow-y-auto -mx-1 px-1 min-h-[120px]">
          {loading ? (
            <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-indigo-600" /></div>
          ) : groups.length === 0 ? (
            <p className="text-center text-sm text-gray-500 py-10">{rows.length ? "אין משטחים תואמים לחיפוש" : "אין משטחים פנויים מתעודות כניסה"}</p>
          ) : (
            <div className="space-y-3">
              {groups.map(({ cert, rows: rs }) => (
                <div key={cert.id} className="border rounded-lg">
                  <div className="flex flex-wrap justify-between gap-2 px-3 py-2 bg-gray-50 rounded-t-lg text-sm">
                    <span className="font-semibold">{cert.supplier_name || "ללא ספק"}</span>
                    <span className="text-gray-500 text-xs">
                      כניסה {cert.reference_number || String(cert.id).slice(-5)} · {fmtDate(cert.date)}
                      {cert.supplier_reference ? ` · ת.מ ${cert.supplier_reference}` : ""}
                    </span>
                  </div>
                  <ul className="divide-y">
                    {rs.map(({ item }) => (
                      <li key={item.id}>
                        <label className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-gray-50 min-h-[44px]">
                          <input type="checkbox" className="w-4 h-4 accent-indigo-600" checked={selected.has(item.id)} onChange={() => toggle(item.id)} />
                          <span className="flex-1 min-w-0">
                            <span className="font-medium">{item.product_name || "ללא שם"}</span>
                            {item.quality && <span className="text-xs text-gray-500"> · {item.quality}</span>}
                            <span className="block text-xs text-gray-500">
                              {item.package_count || 0} × {item.packaging_type || "אריזה"}{item.pallet_type ? ` · ${item.pallet_type}` : ""}
                            </span>
                          </span>
                          <span className="font-semibold tabular-nums shrink-0">{n(item.net_weight).toLocaleString("he-IL", { maximumFractionDigits: 1 })} <span className="text-xs font-normal text-gray-400">ק"ג</span></span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
        <DialogFooter className="gap-2 sm:justify-between items-center">
          <span className="text-sm text-gray-600 tabular-nums">{chosen.length ? `נבחרו ${chosen.length} · ${sum.p} אריזות · ${sum.w.toLocaleString("he-IL", { maximumFractionDigits: 1 })} ק"ג` : "לא נבחרו משטחים"}</span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={busy}>ביטול</Button>
            <Button onClick={confirm} disabled={busy || !chosen.length}>
              {busy && <Loader2 className="w-4 h-4 animate-spin ml-1" />}
              הוסף {chosen.length || ""} לתעודה
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
