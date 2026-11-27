import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { EntryCertificate, EntryItem, Product, Supplier, CompanySettings, PalletType, Packaging } from "@/entities/all";
import { createPageUrl } from "@/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { DateInput } from "@/components/ui/date-input";
import { useToast } from "@/components/ui/use-toast";
import { ArrowRight, Plus, Printer, Edit, Copy, Trash2, Save, Loader2, CheckCircle2, RotateCcw, PackageOpen } from "lucide-react";
import EntitySelect from "@/components/common/EntitySelect";
import WeighingItemForm from "../components/weighing/WeighingItemForm";
import CertificatePrintLayout, { certificateNumber } from "../components/weighing/CertificatePrintLayout";
import { printA4 } from "@/components/print/a4";
import { getMeCached, getListCached } from "@/api/cachedReads";

// תעודת כניסה: תוצרת חקלאית שנקנתה מספק ונשקלה בכניסה — אותו פורמט של תעודת שקילה (משטחים/אריזות,
// ברוטו/טרה/נטו, מחיר קנייה), עם ספק במקום לקוח. נשמרת ב-entry_certificates / entry_items.
const arr = (a) => (Array.isArray(a) ? a : []);
const num = (v, d = 1) => (parseFloat(v) || 0).toLocaleString("he-IL", { maximumFractionDigits: d });
const money = (v) => `₪${(parseFloat(v) || 0).toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const VEHICLE_TYPES = { truck: "משאית", van: "מסחרית", pickup: "טנדר", trailer: "נגרר" };

export default function EntryCertificateDetail() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const id = new URLSearchParams(window.location.search).get("id");
  const [loading, setLoading] = useState(true);
  const [farmId, setFarmId] = useState(null);
  const [cert, setCert] = useState(null);
  const [form, setForm] = useState({});
  const [items, setItems] = useState([]);
  const [products, setProducts] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [packagings, setPackagings] = useState([]);
  const [palletTypes, setPalletTypes] = useState([]);
  const [company, setCompany] = useState({});
  const [itemDialog, setItemDialog] = useState(null); // { item, copy }
  const [saving, setSaving] = useState(false);
  const backUrl = `${createPageUrl("Procurement")}?tab=entries`;

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const me = await getMeCached();
      const fid = me?.current_farm_id;
      setFarmId(fid);
      const f = { farm_id: fid };
      const [c, its, prods, sups, settings, pkgs, pts] = await Promise.all([
        EntryCertificate.get(id),
        EntryItem.filter({ certificate_id: id }),
        getListCached(`products_${fid}`, () => Product.filter(f)),
        Supplier.filter(f),
        getListCached(`company_settings_${fid}`, () => CompanySettings.filter(f)),
        getListCached(`packaging_${fid}`, () => Packaging.filter(f)),
        getListCached("pallet_types", () => PalletType.list()),
      ]);
      setCert(c); setForm(c || {}); setItems(arr(its));
      setProducts(arr(prods)); setSuppliers(arr(sups)); setCompany(arr(settings)[0] || {});
      setPackagings(arr(pkgs)); setPalletTypes(arr(pts));
    } catch (e) {
      toast({ title: "לא ניתן לטעון את התעודה", description: e.message, variant: "destructive" });
    } finally { setLoading(false); }
  }, [id, toast]);
  useEffect(() => { load(); }, [load]);

  const draft = cert?.status !== "completed";
  const supplier = useMemo(() => suppliers.find((s) => s.id === (form.supplier_id || cert?.supplier_id)), [suppliers, form.supplier_id, cert]);
  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e?.target ? e.target.value : e }));

  const totals = (list) => ({
    total_weight: Math.round(list.reduce((s, i) => s + (parseFloat(i.net_weight) || 0), 0) * 100) / 100,
    total_packages: list.reduce((s, i) => s + (parseInt(i.package_count, 10) || 0), 0),
    total_amount: Math.round(list.reduce((s, i) => s + (parseFloat(i.item_total) || 0), 0) * 100) / 100,
  });
  const refreshItems = async () => {
    const list = arr(await EntryItem.filter({ certificate_id: id }));
    setItems(list);
    const t = totals(list);
    await EntryCertificate.update(id, t);
    setCert((c) => ({ ...c, ...t }));
  };

  const saveHeader = async () => {
    setSaving(true);
    try {
      const patch = {
        supplier_id: form.supplier_id || null, supplier_name: supplier?.name || form.supplier_name || "",
        date: form.date || null, time: form.time || null, driver_name: form.driver_name || "", vehicle_type: form.vehicle_type || "",
        vehicle_number: form.vehicle_number || "", reference_number: form.reference_number || cert.reference_number, notes: form.notes || "",
      };
      await EntryCertificate.update(id, patch);
      setCert((c) => ({ ...c, ...patch }));
      toast({ title: "פרטי התעודה נשמרו" });
    } catch (e) { toast({ title: "שמירה נכשלה", description: e.message, variant: "destructive" }); }
    finally { setSaving(false); }
  };

  const onItemSubmit = async (data) => {
    try {
      const editing = itemDialog?.item && !itemDialog.copy;
      if (editing) await EntryItem.update(itemDialog.item.id, { ...data, farm_id: farmId, certificate_id: id });
      else await EntryItem.create({ ...data, farm_id: farmId, certificate_id: id, barcode: `ENTRY-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` });
      setItemDialog(null);
      await refreshItems();
      toast({ title: editing ? "השורה עודכנה" : "השורה נוספה" });
    } catch (e) { toast({ title: "שמירת השורה נכשלה", description: e.message, variant: "destructive" }); }
  };
  const deleteItem = async (it) => {
    if (!window.confirm("למחוק את השורה?")) return;
    try { await EntryItem.delete(it.id); await refreshItems(); } catch (e) { toast({ title: "מחיקה נכשלה", description: e.message, variant: "destructive" }); }
  };

  const setStatus = async (status) => {
    try { await EntryCertificate.update(id, { status }); setCert((c) => ({ ...c, status })); toast({ title: status === "completed" ? "התעודה הושלמה" : "התעודה נפתחה לעריכה" }); }
    catch (e) { toast({ title: "שגיאה", description: e.message, variant: "destructive" }); }
  };
  const removeCert = async () => {
    if (!window.confirm(`למחוק את תעודת הכניסה ${certificateNumber(cert)} וכל השורות שלה?`)) return;
    try {
      for (const it of items) await EntryItem.delete(it.id);
      await EntryCertificate.delete(id);
      navigate(backUrl);
    } catch (e) { toast({ title: "מחיקה נכשלה", description: e.message, variant: "destructive" }); }
  };

  const print = async () => {
    if (!items.length) { toast({ title: "אין שורות בתעודה", variant: "destructive" }); return; }
    try {
      const { renderToStaticMarkup } = await import("react-dom/server");
      const html = renderToStaticMarkup(<CertificatePrintLayout kind="entry" certificate={cert} items={items} companySettings={company} customer={supplier} />);
      await printA4({ title: `תעודת כניסה ${certificateNumber(cert)}`, bodyHtml: html });
    } catch (e) { toast({ title: "ההדפסה נכשלה", description: e.message, variant: "destructive" }); }
  };

  if (loading) return <div className="flex justify-center items-center h-64"><Loader2 className="w-8 h-8 animate-spin text-primary" aria-label="טוען" /></div>;
  if (!cert) return <div className="p-6 text-center text-muted-foreground">התעודה לא נמצאה. <Link to={backUrl} className="text-primary underline">חזרה לרכש</Link></div>;

  return (
    <div className="p-3 sm:p-6 space-y-4 max-w-6xl mx-auto" dir="rtl">
      <div className="flex flex-wrap items-center gap-2">
        <Link to={backUrl}><Button variant="ghost" size="sm"><ArrowRight className="w-4 h-4 ml-1" aria-hidden="true" />תעודות כניסה</Button></Link>
        <h1 className="text-xl font-bold flex items-center gap-2"><PackageOpen className="w-5 h-5 text-primary" aria-hidden="true" />תעודת כניסה {certificateNumber(cert)}</h1>
        <Badge className={draft ? "bg-amber-100 text-amber-800" : "bg-green-100 text-green-800"}>{draft ? "טיוטה" : "הושלמה"}</Badge>
        <div className="ms-auto flex flex-wrap gap-2">
          <Button variant="outline" onClick={print}><Printer className="w-4 h-4 ml-1" aria-hidden="true" />הדפס</Button>
          {draft
            ? <Button onClick={() => setStatus("completed")} disabled={!items.length}><CheckCircle2 className="w-4 h-4 ml-1" aria-hidden="true" />סיים תעודה</Button>
            : <Button variant="outline" onClick={() => setStatus("draft")}><RotateCcw className="w-4 h-4 ml-1" aria-hidden="true" />פתח לעריכה</Button>}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {[["משקל נטו", `${num(cert.total_weight)} ק"ג`], ["אריזות", cert.total_packages || 0], ["סכום קנייה", money(cert.total_amount)]].map(([l, v]) => (
          <div key={l} className="rounded-xl border bg-card px-3 py-2.5"><div className="text-xs text-muted-foreground">{l}</div><div className="text-lg font-bold tabular-nums">{v}</div></div>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-base">שורות ({items.length})</CardTitle>
          {draft && <Button size="sm" onClick={() => setItemDialog({ item: null })}><Plus className="w-4 h-4 ml-1" aria-hidden="true" />הוסף שורה</Button>}
        </CardHeader>
        <CardContent className="p-0 sm:p-6 sm:pt-0">
          {items.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-8">אין שורות עדיין. הוסף משטח / אריזות שנשקלו בכניסה.</p>
          ) : (
            <>
            {/* נייד: כרטיס לשורה */}
            <ul className="sm:hidden divide-y">
              {items.map((it) => (
                <li key={it.id} className="p-3 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{it.product_name}</span>
                    {it.quality && <Badge variant="outline" className="font-normal">{it.quality}</Badge>}
                    <span className="ms-auto font-semibold tabular-nums">{money(it.item_total)}</span>
                  </div>
                  <div className="text-xs text-muted-foreground flex flex-wrap gap-x-3">
                    <span>{it.packaging_type || "ללא אריזה"} · {it.package_count || 0} אריזות</span>
                    <span className="tabular-nums">ברוטו {num(it.gross_weight)} · טרה {num(it.tare_weight)} · <b className="text-foreground">נטו {num(it.net_weight)}</b></span>
                    <span className="tabular-nums">{money(it.price_per_unit)}{it.pricing_method === "per_kg" ? "/ק\"ג" : "/יח'"}</span>
                  </div>
                  {draft && (
                    <div className="flex gap-1 pt-1">
                      <Button variant="outline" size="sm" onClick={() => setItemDialog({ item: it })}><Edit className="w-4 h-4 ml-1" />ערוך</Button>
                      <Button variant="outline" size="sm" onClick={() => setItemDialog({ item: it, copy: true })}><Copy className="w-4 h-4 ml-1" />שכפל</Button>
                      <Button variant="ghost" size="sm" className="text-red-600" onClick={() => deleteItem(it)}><Trash2 className="w-4 h-4 ml-1" />מחק</Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
            <div className="hidden sm:block overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    {["מוצר", "איכות", "אריזה", "אריזות", "ברוטו", "טרה", "נטו", "מחיר", "סה\"כ", ""].map((h) => <TableHead key={h} className="text-right whitespace-nowrap">{h}</TableHead>)}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((it) => (
                    <TableRow key={it.id}>
                      <TableCell className="font-medium">{it.product_name}</TableCell>
                      <TableCell>{it.quality || "-"}</TableCell>
                      <TableCell>{it.packaging_type || "-"}</TableCell>
                      <TableCell className="tabular-nums">{it.package_count || 0}</TableCell>
                      <TableCell className="tabular-nums">{num(it.gross_weight)}</TableCell>
                      <TableCell className="tabular-nums">{num(it.tare_weight)}</TableCell>
                      <TableCell className="tabular-nums font-semibold">{num(it.net_weight)}</TableCell>
                      <TableCell className="tabular-nums whitespace-nowrap">{money(it.price_per_unit)}{it.pricing_method === "per_kg" ? "/ק\"ג" : ""}</TableCell>
                      <TableCell className="tabular-nums font-semibold">{money(it.item_total)}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        {draft && <>
                          <Button variant="ghost" size="icon" aria-label="ערוך" onClick={() => setItemDialog({ item: it })}><Edit className="w-4 h-4" /></Button>
                          <Button variant="ghost" size="icon" aria-label="שכפל" onClick={() => setItemDialog({ item: it, copy: true })}><Copy className="w-4 h-4" /></Button>
                          <Button variant="ghost" size="icon" aria-label="מחק" onClick={() => deleteItem(it)}><Trash2 className="w-4 h-4 text-red-500" /></Button>
                        </>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">פרטי התעודה</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="space-y-1 sm:col-span-2">
            <Label>ספק</Label>
            <EntitySelect options={suppliers} value={form.supplier_id || ""} onValueChange={(v) => setForm((p) => ({ ...p, supplier_id: v }))} quickAdd="supplier" farmId={farmId}
              onCreated={(r) => setSuppliers((s) => [...s, r])} placeholder="בחר ספק" disabled={!draft} />
          </div>
          <div className="space-y-1"><Label htmlFor="ec-ref">מס' תעודה</Label><Input id="ec-ref" value={form.reference_number || ""} onChange={set("reference_number")} disabled={!draft} /></div>
          <div className="space-y-1"><Label>תאריך</Label><DateInput value={form.date || ""} onChange={set("date")} disabled={!draft} /></div>
          <div className="space-y-1"><Label htmlFor="ec-time">שעה</Label><Input id="ec-time" type="time" value={form.time || ""} onChange={set("time")} disabled={!draft} /></div>
          <div className="space-y-1"><Label htmlFor="ec-driver">נהג</Label><Input id="ec-driver" value={form.driver_name || ""} onChange={set("driver_name")} disabled={!draft} /></div>
          <div className="space-y-1">
            <Label htmlFor="ec-vtype">סוג רכב</Label>
            <select id="ec-vtype" value={form.vehicle_type || ""} onChange={set("vehicle_type")} disabled={!draft} className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm">
              <option value="">—</option>
              {Object.entries(VEHICLE_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div className="space-y-1"><Label htmlFor="ec-vnum">מס' רכב</Label><Input id="ec-vnum" value={form.vehicle_number || ""} onChange={set("vehicle_number")} disabled={!draft} dir="ltr" /></div>
          <div className="space-y-1 sm:col-span-3"><Label htmlFor="ec-notes">הערות</Label><Textarea id="ec-notes" rows={2} value={form.notes || ""} onChange={set("notes")} disabled={!draft} /></div>
          {draft && <div className="sm:col-span-3"><Button onClick={saveHeader} disabled={saving}>{saving ? <Loader2 className="w-4 h-4 ml-1 animate-spin" /> : <Save className="w-4 h-4 ml-1" aria-hidden="true" />}שמור פרטים</Button></div>}
        </CardContent>
      </Card>

      {draft && <div className="flex justify-end"><Button variant="ghost" className="text-red-600" onClick={removeCert}><Trash2 className="w-4 h-4 ml-1" aria-hidden="true" />מחק תעודה</Button></div>}

      <Dialog open={!!itemDialog} onOpenChange={(o) => !o && setItemDialog(null)}>
        <DialogContent dir="rtl" className="max-w-2xl max-h-[92vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{itemDialog?.item && !itemDialog.copy ? "עריכת שורה" : "שורה חדשה"} — תעודת כניסה</DialogTitle></DialogHeader>
          {itemDialog && (
            <WeighingItemForm item={itemDialog.item} isCopyMode={!!itemDialog.copy} products={products} packagings={packagings} palletTypes={palletTypes}
              certificateCustomerId={null} onSubmit={onItemSubmit} onCancel={() => setItemDialog(null)} />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
