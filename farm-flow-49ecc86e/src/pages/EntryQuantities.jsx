import React, { useState, useEffect, useMemo, useCallback } from "react";
import { EntryCertificate, EntryItem, Supplier, Product } from "@/entities/all";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { format, startOfMonth } from "date-fns";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { DateInput } from "@/components/ui/date-input";
import { ArrowRight, BarChart3, Loader2, Printer, Tag } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import PageHeader from "@/components/common/PageHeader";
import { getMeCached } from "@/api/cachedReads";
import { printA4, escapeHtml } from "@/components/print/a4";

// דוח כמויות לספקים — סיכום תוצרת שנקלטה בתעודות הכניסה לפי ספק ומוצר, בסינון תאריכים/ספק/מוצר/סטטוס.
// מכל שורה (ספק + מוצר) אפשר לעדכן מחיר לכל הפריטים שבסינון: המחיר והסכום של כל פריט מתעדכנים,
// וסיכומי התעודות מחושבים מחדש. הנוסחה זהה לטופס הפריט (WeighingItemForm.calculateTotal).

const ALL = "__all";
const STATUS_OPTIONS = [["all", "הכל"], ["draft", "טיוטה"], ["completed", "הושלם"]];
const n = (v) => parseFloat(v) || 0;
const kg = (v) => n(v).toLocaleString("he-IL", { maximumFractionDigits: 1 });
const money = (v) => `₪${n(v).toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const round2 = (v) => Math.round(v * 100) / 100;

export function itemTotal({ net_weight, package_count, price_per_unit, discount_percentage, pricing_method }) {
  const price = n(price_per_unit);
  const discount = n(discount_percentage);
  const subtotal = pricing_method === "per_kg" ? n(net_weight) * price : (parseInt(package_count, 10) || 0) * price;
  return round2(discount > 0 && discount < 100 ? subtotal * (1 - discount / 100) : subtotal);
}

export default function EntryQuantities() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [certs, setCerts] = useState([]);
  const [items, setItems] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [products, setProducts] = useState([]);
  const [from, setFrom] = useState(format(startOfMonth(new Date()), "yyyy-MM-dd"));
  const [to, setTo] = useState(format(new Date(), "yyyy-MM-dd"));
  const [supplierId, setSupplierId] = useState(ALL);
  const [productId, setProductId] = useState(ALL);
  const [status, setStatus] = useState("all");
  const [pricing, setPricing] = useState(null); // { supplierId, supplierName, productId, productName, lines }
  const [newPrice, setNewPrice] = useState("");
  const [method, setMethod] = useState("per_kg");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const user = await getMeCached();
      if (!user?.current_farm_id) return;
      const f = { farm_id: user.current_farm_id };
      const [c, i, s, p] = await Promise.all([EntryCertificate.filter(f), EntryItem.filter(f), Supplier.filter(f), Product.filter(f)]);
      setCerts(Array.isArray(c) ? c : []);
      setItems(Array.isArray(i) ? i : []);
      setSuppliers(Array.isArray(s) ? s : []);
      setProducts(Array.isArray(p) ? p : []);
    } catch (e) {
      console.error(e);
      toast({ title: "שגיאה בטעינת הדוח", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  const productName = useCallback((it) => products.find(p => p.id === it.product_id)?.name || it.product_name || "ללא שם מוצר", [products]);

  // תעודות שעוברות את הסינון
  const certMap = useMemo(() => {
    const m = new Map();
    for (const c of certs) {
      const d = String(c.date || "").slice(0, 10);
      if (from && d && d < from) continue;
      if (to && d && d > to) continue;
      if (supplierId !== ALL && c.supplier_id !== supplierId) continue;
      if (status !== "all" && (c.status || "draft") !== status) continue;
      m.set(c.id, c);
    }
    return m;
  }, [certs, from, to, supplierId, status]);

  const lines = useMemo(() => items.filter(it => certMap.has(it.certificate_id) && (productId === ALL || it.product_id === productId)), [items, certMap, productId]);

  // ספק → מוצר
  const groups = useMemo(() => {
    const bySup = new Map();
    for (const it of lines) {
      const c = certMap.get(it.certificate_id);
      const sk = c.supplier_id || "none";
      if (!bySup.has(sk)) bySup.set(sk, { id: c.supplier_id || null, name: c.supplier_name || suppliers.find(s => s.id === c.supplier_id)?.name || "ללא ספק", products: new Map(), w: 0, p: 0, a: 0, certs: new Set() });
      const g = bySup.get(sk);
      const pk = it.product_id || `name:${it.product_name || ""}`;
      if (!g.products.has(pk)) g.products.set(pk, { id: it.product_id || null, name: productName(it), lines: [], w: 0, p: 0, a: 0, certs: new Set(), kgPriced: 0, unitPriced: 0 });
      const r = g.products.get(pk);
      r.lines.push(it);
      r.w += n(it.net_weight); r.p += parseInt(it.package_count, 10) || 0; r.a += n(it.item_total); r.certs.add(it.certificate_id);
      if (it.pricing_method === "per_kg") r.kgPriced += n(it.net_weight); else r.unitPriced += parseInt(it.package_count, 10) || 0;
      g.w += n(it.net_weight); g.p += parseInt(it.package_count, 10) || 0; g.a += n(it.item_total); g.certs.add(it.certificate_id);
    }
    return [...bySup.values()]
      .map(g => ({ ...g, products: [...g.products.values()].sort((a, b) => b.w - a.w) }))
      .sort((a, b) => b.w - a.w);
  }, [lines, certMap, suppliers, productName]);

  const totals = useMemo(() => groups.reduce((t, g) => ({ w: t.w + g.w, p: t.p + g.p, a: t.a + g.a, c: t.c + g.certs.size }), { w: 0, p: 0, a: 0, c: 0 }), [groups]);

  // ספקים לבחירה: חקלאים + כל מי שיש לו תעודת כניסה
  const supplierOptions = useMemo(() => {
    const used = new Set(certs.map(c => c.supplier_id).filter(Boolean));
    return suppliers.filter(s => s.is_farmer || used.has(s.id)).sort((a, b) => String(a.name).localeCompare(String(b.name), "he"));
  }, [suppliers, certs]);
  const productOptions = useMemo(() => {
    const used = new Set(items.map(i => i.product_id).filter(Boolean));
    return products.filter(p => used.has(p.id)).sort((a, b) => String(a.name).localeCompare(String(b.name), "he"));
  }, [products, items]);

  // מחיר ממוצע: לפי ק"ג אם רוב השורות מתומחרות לפי ק"ג, אחרת לפי יחידה
  const avgPrice = (r) => {
    if (r.kgPriced >= r.unitPriced) return r.w > 0 ? `${money(r.a / r.w)}/ק"ג` : "-";
    return r.p > 0 ? `${money(r.a / r.p)}/יח'` : "-";
  };

  const openPricing = (g, r) => {
    const kgLines = r.lines.filter(l => l.pricing_method === "per_kg").length;
    const m = kgLines >= r.lines.length - kgLines ? "per_kg" : "per_unit";
    const prices = [...new Set(r.lines.filter(l => (l.pricing_method || "per_kg") === m).map(l => n(l.price_per_unit)))];
    setMethod(m);
    setNewPrice(prices.length === 1 && prices[0] > 0 ? String(prices[0]) : "");
    setPricing({ supplierName: g.name, productName: r.name, lines: r.lines });
  };

  const preview = useMemo(() => {
    if (!pricing) return null;
    const price = parseFloat(newPrice);
    const valid = Number.isFinite(price) && price >= 0 && newPrice !== "";
    const before = pricing.lines.reduce((s, l) => s + n(l.item_total), 0);
    const after = valid ? pricing.lines.reduce((s, l) => s + itemTotal({ ...l, price_per_unit: price, pricing_method: method }), 0) : null;
    const certCount = new Set(pricing.lines.map(l => l.certificate_id)).size;
    const completed = new Set(pricing.lines.map(l => l.certificate_id).filter(id => certMap.get(id)?.status === "completed")).size;
    return { valid, price, before, after, certCount, completed };
  }, [pricing, newPrice, method, certMap]);

  const applyPricing = async () => {
    if (!pricing || !preview?.valid) return;
    setSaving(true);
    try {
      const updated = new Map();
      const queue = [...pricing.lines];
      // עדכון במנות קטנות — לא להציף את השרת
      while (queue.length) {
        const chunk = queue.splice(0, 5);
        await Promise.all(chunk.map(async (l) => {
          const data = { price_per_unit: preview.price, pricing_method: method, item_total: itemTotal({ ...l, price_per_unit: preview.price, pricing_method: method }) };
          await EntryItem.update(l.id, data);
          updated.set(l.id, { ...l, ...data });
        }));
      }
      const nextItems = items.map(it => updated.get(it.id) || it);
      // סיכומי תעודה מחושבים מכל הפריטים של התעודה (גם אלה שמחוץ לסינון המוצר)
      const certIds = [...new Set(pricing.lines.map(l => l.certificate_id))];
      const certTotals = {};
      await Promise.all(certIds.map(async (cid) => {
        const its = nextItems.filter(it => it.certificate_id === cid);
        const total_amount = round2(its.reduce((s, it) => s + n(it.item_total), 0));
        await EntryCertificate.update(cid, { total_amount });
        certTotals[cid] = total_amount;
      }));
      setItems(nextItems);
      setCerts(prev => prev.map(c => (certTotals[c.id] !== undefined ? { ...c, total_amount: certTotals[c.id] } : c)));
      toast({ title: "המחיר עודכן", description: `${updated.size} שורות ב-${certIds.length} תעודות · ${pricing.supplierName} · ${pricing.productName}` });
      setPricing(null);
    } catch (e) {
      console.error(e);
      toast({ title: "עדכון המחיר נכשל", description: "חלק מהשורות אולי עודכנו — טען את הדוח מחדש ובדוק", variant: "destructive" });
      load();
    } finally {
      setSaving(false);
    }
  };

  const periodText = `${from ? format(new Date(from), "dd/MM/yyyy") : "…"} – ${to ? format(new Date(to), "dd/MM/yyyy") : "…"}`;

  const print = async () => {
    const rows = groups.map(g => `
      <tr class="ff-sub"><td class="r" colspan="2"><b>${escapeHtml(g.name)}</b></td><td>${g.certs.size}</td><td>${g.p}</td><td>${kg(g.w)}</td><td></td><td>${money(g.a)}</td></tr>
      ${g.products.map(r => `<tr><td></td><td class="r">${escapeHtml(r.name)}</td><td>${r.certs.size}</td><td>${r.p}</td><td>${kg(r.w)}</td><td>${escapeHtml(avgPrice(r))}</td><td>${money(r.a)}</td></tr>`).join("")}`).join("");
    const html = `<div class="ff-doc" dir="rtl">
      <header class="ff-head"><div class="ff-brand"><h1>דוח כמויות לספקים</h1><div class="ff-sub">תעודות כניסה · ${escapeHtml(periodText)}${status !== "all" ? ` · ${escapeHtml(STATUS_OPTIONS.find(s => s[0] === status)[1])}` : ""}</div></div></header>
      <table class="ff-table"><colgroup><col style="width:42mm"/><col style="width:40mm"/><col style="width:16mm"/><col style="width:18mm"/><col style="width:22mm"/><col style="width:22mm"/><col style="width:26mm"/></colgroup>
      <thead><tr><th class="r">ספק</th><th class="r">מוצר</th><th>תעודות</th><th>אריזות</th><th>נטו ק"ג</th><th>מחיר ממוצע</th><th>סה"כ</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="7">אין נתונים בסינון</td></tr>`}
      <tr class="ff-total"><td class="r" colspan="2">סה"כ</td><td>${totals.c}</td><td>${totals.p}</td><td>${kg(totals.w)}</td><td></td><td>${money(totals.a)}</td></tr></tbody></table>
      <footer class="ff-foot"><span>דוח כמויות לספקים</span><span>הופק באמצעות FarmFlow · ${format(new Date(), "dd/MM/yyyy HH:mm")}</span></footer></div>`;
    await printA4({ title: "דוח כמויות לספקים", bodyHtml: html });
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-6 h-6 animate-spin text-indigo-600" /></div>;

  return (
    <div className="p-4 sm:p-6 lg:p-8 bg-gray-50/50 min-h-screen" dir="rtl">
      <div className="max-w-screen-xl mx-auto">
        <Link to={createPageUrl("EntryCertificates")} className="inline-flex items-center gap-1 text-sm font-medium text-blue-700 hover:underline min-h-[44px] sm:min-h-0 mb-1">
          <ArrowRight className="w-4 h-4" aria-hidden="true" />חזרה לתעודות הכניסה
        </Link>
        <PageHeader
          icon={BarChart3}
          title="דוח כמויות לספקים"
          subtitle={`תעודות כניסה · ${periodText}`}
          actions={<Button variant="outline" onClick={print} disabled={!groups.length}><Printer className="w-4 h-4 ml-2" aria-hidden="true" />הדפס</Button>}
        />

        <Card className="mb-4">
          <CardContent className="p-3 grid grid-cols-2 md:grid-cols-5 gap-3 items-end">
            <div><Label htmlFor="eq-from">מתאריך</Label><DateInput id="eq-from" value={from} onChange={e => setFrom(e.target.value)} /></div>
            <div><Label htmlFor="eq-to">עד תאריך</Label><DateInput id="eq-to" value={to} onChange={e => setTo(e.target.value)} /></div>
            <div>
              <Label>ספק</Label>
              <Select value={supplierId} onValueChange={setSupplierId}>
                <SelectTrigger aria-label="ספק"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>כל הספקים</SelectItem>
                  {supplierOptions.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>מוצר</Label>
              <Select value={productId} onValueChange={setProductId}>
                <SelectTrigger aria-label="מוצר"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>כל המוצרים</SelectItem>
                  {productOptions.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2 md:col-span-1">
              <Label>סטטוס</Label>
              <div className="flex gap-1.5 mt-1" role="group" aria-label="סטטוס תעודה">
                {STATUS_OPTIONS.map(([k, l]) => (
                  <button key={k} type="button" aria-pressed={status === k} onClick={() => setStatus(k)}
                    className={`px-3 h-9 rounded-full text-sm border ${status === k ? "bg-primary text-primary-foreground border-primary" : "bg-white border-gray-200 text-gray-700"}`}>{l}</button>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          {[["ספקים", groups.length], ["תעודות", totals.c], ['נטו ק"ג', kg(totals.w)], ["סכום קנייה", money(totals.a)]].map(([l, v]) => (
            <Card key={l}><CardContent className="p-3"><div className="text-xs text-gray-500">{l}</div><div className="text-lg font-bold tabular-nums">{v}</div></CardContent></Card>
          ))}
        </div>

        {groups.length === 0 ? (
          <div className="text-center py-16 text-gray-400 text-sm">אין תוצרת שנקלטה בסינון הזה</div>
        ) : (
          <div className="space-y-3">
            {groups.map(g => (
              <Card key={g.id || "none"}>
                <CardContent className="p-0">
                  <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3 border-b bg-gray-50 rounded-t-xl">
                    <h2 className="font-semibold text-gray-900">{g.name}</h2>
                    <div className="text-sm text-gray-600 tabular-nums">{g.certs.size} תעודות · {g.p} אריזות · <b>{kg(g.w)} ק"ג</b> · {money(g.a)}</div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="text-xs text-gray-500">
                        <tr className="border-b">
                          <th className="text-right font-medium px-4 py-2">מוצר</th>
                          <th className="font-medium px-2 py-2 hidden sm:table-cell">תעודות</th>
                          <th className="font-medium px-2 py-2">אריזות</th>
                          <th className="font-medium px-2 py-2">נטו ק"ג</th>
                          <th className="font-medium px-2 py-2 hidden sm:table-cell">מחיר ממוצע</th>
                          <th className="font-medium px-2 py-2">סה"כ</th>
                          <th className="px-2 py-2"><span className="sr-only">פעולות</span></th>
                        </tr>
                      </thead>
                      <tbody>
                        {g.products.map(r => (
                          <tr key={r.id || r.name} className="border-b last:border-0">
                            <td className="px-4 py-2 font-medium">{r.name}</td>
                            <td className="text-center px-2 hidden sm:table-cell tabular-nums">{r.certs.size}</td>
                            <td className="text-center px-2 tabular-nums">{r.p}</td>
                            <td className="text-center px-2 tabular-nums font-semibold">{kg(r.w)}</td>
                            <td className="text-center px-2 hidden sm:table-cell tabular-nums">{avgPrice(r)}</td>
                            <td className="text-center px-2 tabular-nums">{money(r.a)}</td>
                            <td className="px-2 py-1 text-left">
                              <Button size="sm" variant="outline" className="h-8" onClick={() => openPricing(g, r)} aria-label={`עדכון מחיר ל${r.name} של ${g.name}`}>
                                <Tag className="w-3.5 h-3.5 sm:ml-1" aria-hidden="true" /><span className="hidden sm:inline">עדכן מחיר</span>
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Dialog open={!!pricing} onOpenChange={(o) => { if (!o && !saving) setPricing(null); }}>
        <DialogContent dir="rtl" className="max-w-md">
          <DialogHeader>
            <DialogTitle>עדכון מחיר — {pricing?.productName}</DialogTitle>
            <DialogDescription>
              {pricing?.supplierName} · {periodText}. המחיר יעודכן ב-{pricing?.lines.length} שורות ב-{preview?.certCount} תעודות שבסינון, והסכומים יחושבו מחדש.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="eq-price">מחיר חדש (₪)</Label>
                <Input id="eq-price" type="number" inputMode="decimal" min="0" step="0.01" dir="ltr" value={newPrice} onChange={e => setNewPrice(e.target.value)} autoFocus />
              </div>
              <div>
                <Label>תמחור</Label>
                <Select value={method} onValueChange={setMethod}>
                  <SelectTrigger aria-label="שיטת תמחור"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="per_kg">לפי ק"ג</SelectItem>
                    <SelectItem value="per_unit">לפי אריזה / יחידה</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {preview && (
              <div className="rounded-lg bg-gray-50 border p-3 text-sm space-y-1 tabular-nums">
                <div className="flex justify-between"><span>סכום נוכחי</span><span>{money(preview.before)}</span></div>
                <div className="flex justify-between font-semibold"><span>סכום אחרי העדכון</span><span>{preview.after === null ? "—" : money(preview.after)}</span></div>
                {preview.after !== null && <div className="flex justify-between text-gray-600"><span>הפרש</span><span dir="ltr">{preview.after - preview.before >= 0 ? "+" : ""}{money(preview.after - preview.before)}</span></div>}
              </div>
            )}
            {preview?.completed > 0 && (
              <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2">
                {preview.completed} מהתעודות כבר מסומנות "הושלם". כדי לעדכן רק טיוטות, סנן לפי סטטוס "טיוטה".
              </p>
            )}
            <p className="text-xs text-gray-500">הנחה שהוזנה בשורה נשמרת. כדי לעדכן רק חלק מהתקופה, שנה את התאריכים בסינון.</p>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setPricing(null)} disabled={saving}>ביטול</Button>
            <Button onClick={applyPricing} disabled={saving || !preview?.valid}>
              {saving && <Loader2 className="w-4 h-4 animate-spin ml-1" />}
              עדכן {pricing?.lines.length} שורות
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
