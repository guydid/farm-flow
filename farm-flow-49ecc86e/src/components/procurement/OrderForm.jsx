import React, { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DateInput } from "@/components/ui/date-input";
import EntitySelect from "@/components/common/EntitySelect";
import { Loader2, Save } from "lucide-react";
import ItemsEditor, { emptyItem } from "./ItemsEditor";
import { apiFetch, DIRECTIONS, SOURCES, ORDER_STATUS, todayIso } from "./procurementUtils";

const blank = (direction) => ({ direction, supplier_id: "", customer_id: "", order_number: "", order_date: todayIso(), expected_delivery_date: "", status: "ordered", plot_id: "", contact_person: "", source: "app", source_ref: "", notes: "", vat_included: false, items: [emptyItem()] });

/** יצירה / עריכה של הזמנה. בעריכה — פרטי הכותרת בלבד (שורות מתנהלות בכרטיס ההזמנה). */
export default function OrderForm({ open, onOpenChange, farmId, order, direction = "purchase", suppliers, customers, products, plots, onSaved, onPartyCreated }) {
  const [form, setForm] = useState(blank(direction));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const editing = !!order;
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  useEffect(() => {
    if (!open) return;
    setError(null);
    setForm(order ? { ...blank(order.direction), ...order, supplier_id: order.supplier_id || "", customer_id: order.customer_id || "", plot_id: order.plot_id || "", expected_delivery_date: order.expected_delivery_date || "", items: [] } : blank(direction));
  }, [open, order, direction]);

  const isPurchase = form.direction === "purchase";
  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if (isPurchase && !form.supplier_id) return setError("בחר ספק");
    if (!isPurchase && !form.customer_id) return setError("בחר לקוח");
    const items = form.items.filter((it) => it.product_name?.trim() || it.product_id).map((it) => ({ ...it, quantity: Number(it.quantity), unit_price: it.unit_price === "" ? null : Number(it.unit_price) }));
    if (!editing && items.some((it) => !(it.quantity > 0))) return setError("לכל שורה נדרשת כמות חיובית");
    setSaving(true);
    try {
      const payload = {
        direction: form.direction, supplier_id: isPurchase ? form.supplier_id : undefined, customer_id: isPurchase ? undefined : form.customer_id,
        order_number: form.order_number || undefined, order_date: form.order_date || undefined, expected_delivery_date: form.expected_delivery_date || null,
        plot_id: form.plot_id || null, contact_person: form.contact_person, source: form.source, source_ref: form.source_ref, notes: form.notes, vat_included: !!form.vat_included,
      };
      const saved = editing
        ? await apiFetch(`/procurement/orders/${order.id}?farm_id=${encodeURIComponent(farmId)}`, { method: "PUT", body: JSON.stringify(payload) })
        : await apiFetch(`/procurement/orders?farm_id=${encodeURIComponent(farmId)}`, { method: "POST", body: JSON.stringify({ ...payload, status: form.status, items }) });
      onSaved?.(saved);
      onOpenChange(false);
    } catch (err) { setError(err.data?.error || err.message); } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle>{editing ? `עריכת הזמנה ${order.order_number}` : `הזמנת ${DIRECTIONS[form.direction]} חדשה`}</DialogTitle>
          <DialogDescription>{isPurchase ? "הזמנה מספק: מה הוזמן, כמה ולמתי. תעודות המשלוח שייקלטו יעדכנו את מצב האספקה." : "הזמנת מכירה ללקוח. תעודות המשלוח היוצאות ותעודות השקילה יתקשרו אליה."}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          {!editing && (
            <div className="inline-flex w-full gap-1 rounded-xl bg-muted p-1" role="group" aria-label="סוג ההזמנה">
              {Object.entries(DIRECTIONS).map(([k, l]) => (
                <button type="button" key={k} onClick={() => set({ direction: k, supplier_id: "", customer_id: "" })} className={`flex-1 min-h-10 rounded-lg px-3 text-sm transition-colors ${form.direction === k ? "bg-background text-foreground font-semibold shadow-sm" : "text-muted-foreground hover:text-foreground font-medium"}`} aria-pressed={form.direction === k}>הזמנת {l}</button>
              ))}
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>{isPurchase ? "ספק *" : "לקוח *"}</Label>
              {isPurchase
                ? <EntitySelect options={suppliers} value={form.supplier_id} onValueChange={(v) => set({ supplier_id: v })} quickAdd="supplier" farmId={farmId} onCreated={(r) => onPartyCreated?.("supplier", r)} placeholder="בחר ספק" />
                : <EntitySelect options={customers} value={form.customer_id} onValueChange={(v) => set({ customer_id: v })} quickAdd="customer" farmId={farmId} onCreated={(r) => onPartyCreated?.("customer", r)} placeholder="בחר לקוח" />}
            </div>
            <div className="space-y-1"><Label>מספר הזמנה</Label><Input value={form.order_number} onChange={(e) => set({ order_number: e.target.value })} placeholder="נוצר אוטומטית" /></div>
            <div className="space-y-1"><Label>תאריך הזמנה</Label><DateInput value={form.order_date} onChange={(e) => set({ order_date: e.target.value })} /></div>
            <div className="space-y-1"><Label>אספקה צפויה</Label><DateInput value={form.expected_delivery_date} onChange={(e) => set({ expected_delivery_date: e.target.value })} /></div>
            {!editing && (
              <div className="space-y-1"><Label>סטטוס</Label>
                <Select value={form.status} onValueChange={(v) => set({ status: v })}><SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{["draft", "ordered", "confirmed"].map((s) => <SelectItem key={s} value={s}>{ORDER_STATUS[s].label}</SelectItem>)}</SelectContent></Select>
              </div>
            )}
            <div className="space-y-1"><Label>חלקה (אופציונלי)</Label><EntitySelect options={plots} value={form.plot_id} onValueChange={(v) => set({ plot_id: v })} noneLabel="ללא" placeholder="חלקה" /></div>
            <div className="space-y-1"><Label>איש קשר</Label><Input value={form.contact_person} onChange={(e) => set({ contact_person: e.target.value })} /></div>
            <div className="space-y-1"><Label>מקור ההזמנה</Label>
              <Select value={form.source} onValueChange={(v) => set({ source: v })}><SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(SOURCES).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent></Select>
            </div>
            <div className="space-y-1 sm:col-span-2"><Label>הערות</Label><Textarea rows={2} value={form.notes} onChange={(e) => set({ notes: e.target.value })} /></div>
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={!!form.vat_included} onCheckedChange={(v) => set({ vat_included: !!v })} /> המחירים כוללים מע"מ</label>
          </div>
          {!editing && (
            <div className="space-y-1">
              <Label>שורות ההזמנה</Label>
              <ItemsEditor items={form.items} onChange={(items) => set({ items })} products={products} />
            </div>
          )}
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>ביטול</Button>
            <Button type="submit" disabled={saving}>{saving ? <Loader2 className="w-4 h-4 animate-spin ml-1" aria-hidden="true" /> : <Save className="w-4 h-4 ml-1" aria-hidden="true" />} {editing ? "שמור" : "צור הזמנה"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
