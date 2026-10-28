import React, { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DateInput } from "@/components/ui/date-input";
import EntitySelect from "@/components/common/EntitySelect";
import { UploadFile } from "@/api/integrations";
import { Loader2, Save, Camera, Upload, FileText, X } from "lucide-react";
import ItemsEditor, { emptyItem } from "./ItemsEditor";
import { apiFetch, DN_DIRECTIONS, DN_STATUS, SOURCES, todayIso, fileHref, isImage } from "./procurementUtils";

const blank = (direction) => ({ direction, order_id: "", supplier_id: "", customer_id: "", note_number: "", delivery_date: todayIso(), driver_name: "", vehicle: "", received_by: "", status: "received", invoice_id: "", file_url: "", notes: "", source: "app", add_to_stock: false, items: [emptyItem()] });

/**
 * קליטת / עריכת תעודת משלוח. order (אופציונלי) — ממלא מראש את הספק/לקוח ואת השורות הפתוחות.
 * openOrders — הזמנות פתוחות לקישור; invoices — חשבוניות של אותו ספק לקישור.
 */
export default function DeliveryNoteForm({ open, onOpenChange, farmId, note, order, direction = "in", openOrders = [], suppliers, customers, products, invoices = [], onSaved, onPartyCreated }) {
  const [form, setForm] = useState(blank(direction));
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const editing = !!note;
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const fromOrder = (o) => o ? {
    direction: o.direction === "purchase" ? "in" : "out", order_id: o.id, supplier_id: o.supplier_id || "", customer_id: o.customer_id || "",
    items: (o.items || []).filter((it) => Number(it.remaining ?? (it.quantity - (it.delivered_quantity || 0))) > 0)
      .map((it) => ({ order_item_id: it.id, product_id: it.product_id || "", product_name: it.product_name, quantity: String(it.remaining ?? (it.quantity - (it.delivered_quantity || 0))), unit: it.unit, unit_price: it.unit_price ?? "", remaining: it.remaining ?? (it.quantity - (it.delivered_quantity || 0)), discrepancy_note: "" })),
  } : {};

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (note) setForm({ ...blank(note.direction), ...note, order_id: note.order_id || "", supplier_id: note.supplier_id || "", customer_id: note.customer_id || "", invoice_id: note.invoice_id || "", file_url: note.file_url || "", items: (note.items || []).map((it) => ({ ...it, quantity: String(it.quantity), unit_price: it.unit_price ?? "" })) });
    else setForm({ ...blank(direction), ...fromOrder(order), ...(order ? {} : { items: [emptyItem()] }) });
  }, [open, note, order, direction]);

  const isIn = form.direction === "in";
  const ordersForDir = useMemo(() => openOrders.filter((o) => (o.direction === "purchase") === isIn), [openOrders, isIn]);
  const partyId = isIn ? form.supplier_id : form.customer_id;
  const partyInvoices = useMemo(() => isIn ? invoices.filter((inv) => !partyId || inv.supplier_id === partyId).slice(0, 60) : [], [invoices, isIn, partyId]);
  const pickOrder = (id) => {
    if (!id) return set({ order_id: "" });
    const o = ordersForDir.find((x) => x.id === id);
    set(fromOrder(o));
  };

  const uploadPhoto = async (file) => {
    if (!file) return;
    setUploading(true); setError(null);
    try {
      const r = await UploadFile({ file });
      if (!r?.file_url) throw new Error(r?.error || "ההעלאה נכשלה");
      set({ file_url: r.file_url });
    } catch (e) { setError(e.message); } finally { setUploading(false); }
  };

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if (isIn && !form.supplier_id) return setError("בחר ספק");
    if (!isIn && !form.customer_id) return setError("בחר לקוח");
    const items = form.items.filter((it) => it.product_name?.trim() || it.product_id).map(({ remaining: _remaining, ...it }) => ({ ...it, quantity: Number(it.quantity), unit_price: it.unit_price === "" ? null : Number(it.unit_price) }));
    if (items.some((it) => !(it.quantity > 0))) return setError("לכל שורה נדרשת כמות חיובית");
    setSaving(true);
    try {
      const payload = {
        direction: form.direction, order_id: form.order_id || null, supplier_id: isIn ? form.supplier_id : undefined, customer_id: isIn ? undefined : form.customer_id,
        note_number: form.note_number || undefined, delivery_date: form.delivery_date, driver_name: form.driver_name, vehicle: form.vehicle, received_by: form.received_by,
        status: form.status, invoice_id: form.invoice_id || null, file_url: form.file_url || null, notes: form.notes, source: form.source, add_to_stock: !!form.add_to_stock, items,
      };
      const qs = `?farm_id=${encodeURIComponent(farmId)}`;
      const r = editing
        ? await apiFetch(`/procurement/delivery-notes/${note.id}${qs}`, { method: "PUT", body: JSON.stringify(payload) })
        : await apiFetch(`/procurement/delivery-notes${qs}`, { method: "POST", body: JSON.stringify(payload) });
      onSaved?.(r);
      onOpenChange(false);
    } catch (err) { setError(err.data?.error || err.message); } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle>{editing ? `עריכת תעודת משלוח ${note.note_number}` : `קליטת תעודת משלוח ${DN_DIRECTIONS[form.direction]}`}</DialogTitle>
          <DialogDescription>{isIn ? "סחורה שהגיעה מספק. קישור להזמנה מעדכן את מצב האספקה; חומרי הדברה ותשומות נכנסים למלאי." : "סחורה שיצאה ללקוח. תעודות שקילה של אותו לקוח באותו יום מתקשרות אוטומטית."}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          {!editing && !order && (
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(DN_DIRECTIONS).map(([k, l]) => (
                <button type="button" key={k} onClick={() => set({ direction: k, order_id: "", supplier_id: "", customer_id: "", items: [emptyItem()] })} className={`rounded-lg border p-2 text-sm font-medium ${form.direction === k ? "border-primary bg-primary/10" : "hover:bg-accent"}`} aria-pressed={form.direction === k}>תעודה {l}</button>
              ))}
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1 sm:col-span-2"><Label>הזמנה מקושרת</Label>
              <Select value={form.order_id || "__none__"} onValueChange={(v) => pickOrder(v === "__none__" ? "" : v)} disabled={!!order && !editing}>
                <SelectTrigger><SelectValue placeholder="ללא הזמנה" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">ללא הזמנה</SelectItem>
                  {ordersForDir.map((o) => <SelectItem key={o.id} value={o.id}>{o.order_number} · {o.counterparty_name} · {o.fulfillment_pct ?? 0}%</SelectItem>)}
                  {order && !ordersForDir.some((o) => o.id === order.id) && <SelectItem value={order.id}>{order.order_number} · {order.counterparty_name}</SelectItem>}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label>{isIn ? "ספק *" : "לקוח *"}</Label>
              {isIn
                ? <EntitySelect options={suppliers} value={form.supplier_id} onValueChange={(v) => set({ supplier_id: v })} quickAdd="supplier" farmId={farmId} onCreated={(r) => onPartyCreated?.("supplier", r)} placeholder="בחר ספק" disabled={!!form.order_id} />
                : <EntitySelect options={customers} value={form.customer_id} onValueChange={(v) => set({ customer_id: v })} quickAdd="customer" farmId={farmId} onCreated={(r) => onPartyCreated?.("customer", r)} placeholder="בחר לקוח" disabled={!!form.order_id} />}
            </div>
            <div className="space-y-1"><Label>מספר תעודה</Label><Input value={form.note_number} onChange={(e) => set({ note_number: e.target.value })} placeholder={isIn ? "המספר שעל תעודת הספק" : "נוצר אוטומטית"} /></div>
            <div className="space-y-1"><Label>תאריך אספקה</Label><DateInput value={form.delivery_date} onChange={(e) => set({ delivery_date: e.target.value })} /></div>
            <div className="space-y-1"><Label>סטטוס</Label>
              <Select value={form.status} onValueChange={(v) => set({ status: v })}><SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(DN_STATUS).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent></Select>
            </div>
            <div className="space-y-1"><Label>נהג</Label><Input value={form.driver_name} onChange={(e) => set({ driver_name: e.target.value })} /></div>
            <div className="space-y-1"><Label>רכב</Label><Input value={form.vehicle} onChange={(e) => set({ vehicle: e.target.value })} placeholder="מספר רישוי" /></div>
            <div className="space-y-1"><Label>{isIn ? "נקלט על ידי" : "נמסר על ידי"}</Label><Input value={form.received_by} onChange={(e) => set({ received_by: e.target.value })} /></div>
            <div className="space-y-1"><Label>מקור</Label>
              <Select value={form.source} onValueChange={(v) => set({ source: v })}><SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(SOURCES).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent></Select>
            </div>
            {isIn && (
              <div className="space-y-1 sm:col-span-2"><Label>חשבונית מקושרת</Label>
                <Select value={form.invoice_id || "__none__"} onValueChange={(v) => set({ invoice_id: v === "__none__" ? "" : v })}>
                  <SelectTrigger><SelectValue placeholder="ללא חשבונית עדיין" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">ללא חשבונית עדיין</SelectItem>
                    {partyInvoices.map((inv) => <SelectItem key={inv.id} value={inv.id}>{inv.invoice_number ? `מס' ${inv.invoice_number}` : "ללא מספר"} · {inv.date || ""} · ₪{Number(inv.total || 0).toLocaleString("he-IL")}{inv.supplier_name ? ` · ${inv.supplier_name}` : ""}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1 sm:col-span-2">
              <Label>צילום התעודה</Label>
              <div className="flex flex-wrap items-center gap-2">
                <label className="inline-flex items-center gap-1.5 rounded-md border px-3 h-9 text-sm cursor-pointer hover:bg-accent">
                  {uploading ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Camera className="w-4 h-4" aria-hidden="true" />} צלם
                  <input type="file" className="hidden" accept="image/*" capture="environment" onChange={(e) => uploadPhoto(e.target.files?.[0])} />
                </label>
                <label className="inline-flex items-center gap-1.5 rounded-md border px-3 h-9 text-sm cursor-pointer hover:bg-accent">
                  <Upload className="w-4 h-4" aria-hidden="true" /> העלה קובץ
                  <input type="file" className="hidden" accept="image/*,.pdf" onChange={(e) => uploadPhoto(e.target.files?.[0])} />
                </label>
                {form.file_url && (
                  <span className="inline-flex items-center gap-1 text-sm">
                    <a href={fileHref(form.file_url)} target="_blank" rel="noreferrer" className="text-primary inline-flex items-center gap-1 underline"><FileText className="w-4 h-4" aria-hidden="true" /> צורף</a>
                    <button type="button" className="text-muted-foreground hover:text-destructive" onClick={() => set({ file_url: "" })} aria-label="הסר קובץ"><X className="w-4 h-4" aria-hidden="true" /></button>
                  </span>
                )}
              </div>
              {form.file_url && isImage(form.file_url) && <img src={fileHref(form.file_url)} alt="צילום תעודת המשלוח" className="mt-2 max-h-40 rounded-md border object-contain" />}
            </div>
            {isIn && <label className="flex items-center gap-2 text-sm sm:col-span-2"><Checkbox checked={!!form.add_to_stock} onCheckedChange={(v) => set({ add_to_stock: !!v })} /> הוסף את כל השורות למלאי (ברירת מחדל: רק תכשירים ותשומות מזוהים)</label>}
            <div className="space-y-1 sm:col-span-2"><Label>הערות</Label><Textarea rows={2} value={form.notes} onChange={(e) => set({ notes: e.target.value })} /></div>
          </div>
          <div className="space-y-1">
            <Label>שורות התעודה</Label>
            <ItemsEditor items={form.items} onChange={(items) => set({ items })} products={products} withDiscrepancy />
          </div>
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>ביטול</Button>
            <Button type="submit" disabled={saving || uploading}>{saving ? <Loader2 className="w-4 h-4 animate-spin ml-1" aria-hidden="true" /> : <Save className="w-4 h-4 ml-1" aria-hidden="true" />} {editing ? "שמור" : "קלוט תעודה"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
