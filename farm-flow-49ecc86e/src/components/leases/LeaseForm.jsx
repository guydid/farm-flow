import React, { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Save, Upload, FileText, Plus, Trash2, X } from "lucide-react";
import { UploadFile } from "@/api/integrations";
import { DIRECTIONS, ASSET_TYPES, FREQUENCIES, STATUSES, METHODS, METER_TYPES, BILLING_MODES } from "./leaseUtils";

import { DateInput } from "@/components/ui/date-input";
const EMPTY = {
  direction: "pay", title: "", asset_type: "land", asset_description: "",
  counterparty_name: "", counterparty_phone: "", counterparty_id_number: "", counterparty_email: "",
  start_date: "", end_date: "", amount: "", frequency: "monthly", due_day: "1", payment_method: "transfer",
  status: "active", contract_url: "", contract_name: "", notes: "",
  reminders_enabled: true, reminder_days_before: 7, reminder_telegram: false, meters: [],
  billing_mode: "", vat_exempt: false,
};

export default function LeaseForm({ open, onClose, onSave, lease, defaultDirection = "pay", saving }) {
  const [form, setForm] = useState(EMPTY);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setForm(lease ? { ...EMPTY, ...lease, amount: lease.amount ?? "", due_day: String(lease.due_day ?? "1"), meters: Array.isArray(lease.meters) ? lease.meters : [] } : { ...EMPTY, direction: defaultDirection });
  }, [open, lease, defaultDirection]);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const setMeter = (i, patch) => set({ meters: form.meters.map((m, idx) => (idx === i ? { ...m, ...patch } : m)) });
  const addMeter = () => set({ meters: [...form.meters, { type: "electricity", label: "", meter_number: "", unit: METER_TYPES.electricity.unit, rate_per_unit: "", last_reading: "", last_reading_date: "" }] });
  const removeMeter = (i) => set({ meters: form.meters.filter((_, idx) => idx !== i) });

  const uploadContract = async (file) => {
    if (!file) return;
    setUploading(true);
    try {
      const r = await UploadFile({ file });
      if (!r?.file_url) throw new Error(r?.error || "ההעלאה נכשלה");
      set({ contract_url: r.file_url, contract_name: file.name });
    } catch (e) { setError(e.message); } finally { setUploading(false); }
  };

  const submit = (e) => {
    e.preventDefault();
    if (!form.title.trim()) return setError("יש להזין שם להסכם");
    if (!form.start_date) return setError("יש להזין תאריך התחלה");
    if (form.end_date && form.end_date < form.start_date) return setError("תאריך הסיום לפני תאריך ההתחלה");
    if (!(Number(form.amount) >= 0)) return setError("סכום לא תקין");
    const meters = form.meters.filter((m) => m.type).map((m) => ({
      ...m, rate_per_unit: m.rate_per_unit === "" ? 0 : Number(m.rate_per_unit),
      last_reading: m.last_reading === "" || m.last_reading === null ? null : Number(m.last_reading),
    }));
    onSave({ ...form, title: form.title.trim(), amount: Number(form.amount) || 0, due_day: parseInt(form.due_day, 10) || 1, reminder_days_before: parseInt(form.reminder_days_before, 10) || 0, meters });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && !saving) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle>{lease ? "עריכת הסכם שכירות" : "הסכם שכירות חדש"}</DialogTitle>
          <DialogDescription>פרטי ההסכם, התשלום הקבוע, החוזה והתזכורות. מונים (חשמל/מים) מאפשרים חיוב לפי צריכה.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1 sm:col-span-2">
              <Label>כיוון</Label>
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(DIRECTIONS).map(([k, v]) => (
                  <button type="button" key={k} onClick={() => set({ direction: k })}
                    className={`rounded-lg border px-3 py-2 text-sm text-right ${form.direction === k ? "border-indigo-500 bg-indigo-50 text-indigo-800 font-medium" : "border-gray-200 text-gray-600"}`}>{v}</button>
                ))}
              </div>
            </div>
            <div className="space-y-1 sm:col-span-2"><Label>שם ההסכם *</Label><Input value={form.title} onChange={(e) => set({ title: e.target.value })} placeholder='למשל: חלקה 12 מגרנות / דירת עובדים רח" הזית' /></div>
            <div className="space-y-1">
              <Label>סוג הנכס</Label>
              <Select value={form.asset_type} onValueChange={(v) => set({ asset_type: v })}><SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(ASSET_TYPES).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent></Select>
            </div>
            <div className="space-y-1"><Label>תיאור הנכס</Label><Input value={form.asset_description} onChange={(e) => set({ asset_description: e.target.value })} placeholder="כתובת, גוש/חלקה, דונם…" /></div>
          </div>

          <div className="rounded-lg border p-3 space-y-3">
            <div className="text-sm font-medium text-gray-700">{form.direction === "pay" ? "המשכיר (למי משלמים)" : "השוכר (ממי מקבלים)"}</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1"><Label>שם</Label><Input value={form.counterparty_name} onChange={(e) => set({ counterparty_name: e.target.value })} /></div>
              <div className="space-y-1"><Label>טלפון</Label><Input dir="ltr" value={form.counterparty_phone} onChange={(e) => set({ counterparty_phone: e.target.value })} /></div>
              <div className="space-y-1"><Label>ח.פ / ת.ז</Label><Input dir="ltr" value={form.counterparty_id_number} onChange={(e) => set({ counterparty_id_number: e.target.value })} /></div>
              <div className="space-y-1"><Label>אימייל</Label><Input dir="ltr" type="email" value={form.counterparty_email} onChange={(e) => set({ counterparty_email: e.target.value })} /></div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1"><Label>תאריך התחלה *</Label><DateInput value={form.start_date} onChange={(e) => set({ start_date: e.target.value })} /></div>
            <div className="space-y-1"><Label>תאריך סיום</Label><DateInput value={form.end_date} onChange={(e) => set({ end_date: e.target.value })} /></div>
            <div className="space-y-1">
              <Label>סטטוס</Label>
              <Select value={form.status} onValueChange={(v) => set({ status: v })}><SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(STATUSES).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent></Select>
            </div>
            <div className="space-y-1"><Label>סכום (₪)</Label><Input type="number" min="0" step="0.01" dir="ltr" value={form.amount} onChange={(e) => set({ amount: e.target.value })} /></div>
            <div className="space-y-1">
              <Label>תדירות</Label>
              <Select value={form.frequency} onValueChange={(v) => set({ frequency: v })}><SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(FREQUENCIES).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent></Select>
            </div>
            <div className="space-y-1"><Label>יום תשלום בחודש</Label><Input type="number" min="1" max="31" dir="ltr" value={form.due_day} onChange={(e) => set({ due_day: e.target.value })} /></div>
            <div className="space-y-1 sm:col-span-3">
              <Label>אמצעי תשלום</Label>
              <Select value={form.payment_method} onValueChange={(v) => set({ payment_method: v })}><SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(METHODS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent></Select>
            </div>
          </div>

          {form.direction === "receive" && (
            <div className="rounded-lg border p-3 space-y-3">
              <Label className="font-medium">חשבוניות לשוכר</Label>
              <div className="grid gap-2 sm:grid-cols-2">
                {Object.entries(BILLING_MODES).map(([k, v]) => {
                  const effective = form.billing_mode || (form.frequency === "monthly" ? "monthly_all" : "split");
                  return (
                    <button type="button" key={k} onClick={() => set({ billing_mode: k })}
                      className={`rounded-lg border px-3 py-2 text-right ${effective === k ? "border-indigo-500 bg-indigo-50" : "border-gray-200"}`}>
                      <div className="text-sm font-medium">{v.label}</div>
                      <div className="text-[11px] text-gray-500">{v.hint}</div>
                    </button>
                  );
                })}
              </div>
              {(form.billing_mode || (form.frequency === "monthly" ? "monthly_all" : "split")) === "monthly_all" && form.frequency !== "monthly" && (
                <p className="text-xs text-amber-700">במצב "חשבונית חודשית אחת" כדאי שתדירות השכירות תהיה חודשית.</p>
              )}
              <div className="flex items-center justify-between">
                <div><Label className="text-sm">השכירות פטורה ממע"מ</Label><p className="text-[11px] text-gray-400">למשל השכרת דירה למגורים. שורות החשבונית יופקו ללא מע"מ.</p></div>
                <Switch checked={!!form.vat_exempt} onCheckedChange={(v) => set({ vat_exempt: v })} />
              </div>
            </div>
          )}

          <div className="rounded-lg border p-3 space-y-2">
            <div className="flex items-center justify-between">
              <Label className="font-medium">חוזה</Label>
              <label className="inline-flex items-center gap-1 text-sm text-indigo-700 cursor-pointer">
                {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} {form.contract_url ? "החלף קובץ" : "צרף חוזה (PDF / תמונה)"}
                <input type="file" className="hidden" accept=".pdf,image/*" onChange={(e) => uploadContract(e.target.files?.[0])} />
              </label>
            </div>
            {form.contract_url ? (
              <div className="flex items-center gap-2 text-sm"><FileText className="w-4 h-4 text-gray-500" /><span className="truncate">{form.contract_name || "חוזה"}</span>
                <button type="button" className="text-gray-400 hover:text-red-600" onClick={() => set({ contract_url: "", contract_name: "" })}><X className="w-4 h-4" /></button></div>
            ) : <p className="text-xs text-gray-400">לא צורף חוזה.</p>}
          </div>

          <div className="rounded-lg border p-3 space-y-3">
            <div className="flex items-center justify-between">
              <Label className="font-medium">מונים (חשמל / מים / גז)</Label>
              <Button type="button" size="sm" variant="outline" onClick={addMeter}><Plus className="w-4 h-4 ml-1" /> הוסף מונה</Button>
            </div>
            {form.meters.length === 0 && <p className="text-xs text-gray-400">אין מונים. הוסף מונה כדי לחייב לפי צריכה (קריאה נוכחית פחות קודמת × תעריף).</p>}
            {form.meters.map((m, i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-5 items-end border-t pt-2">
                <div className="space-y-1">
                  <Label className="text-xs">סוג</Label>
                  <Select value={m.type} onValueChange={(v) => setMeter(i, { type: v, unit: METER_TYPES[v]?.unit || m.unit })}><SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{Object.entries(METER_TYPES).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent></Select>
                </div>
                <div className="space-y-1"><Label className="text-xs">מס' מונה</Label><Input dir="ltr" value={m.meter_number || ""} onChange={(e) => setMeter(i, { meter_number: e.target.value })} /></div>
                <div className="space-y-1"><Label className="text-xs">תעריף ליח' (₪/{m.unit || "יח'"})</Label><Input type="number" step="0.001" dir="ltr" value={m.rate_per_unit ?? ""} onChange={(e) => setMeter(i, { rate_per_unit: e.target.value })} /></div>
                <div className="space-y-1"><Label className="text-xs">קריאה אחרונה</Label><Input type="number" step="0.01" dir="ltr" value={m.last_reading ?? ""} onChange={(e) => setMeter(i, { last_reading: e.target.value })} /></div>
                <div className="flex items-center gap-1"><DateInput value={m.last_reading_date || ""} onChange={(e) => setMeter(i, { last_reading_date: e.target.value })} /><Button type="button" size="icon" aria-label="מחק" variant="ghost" onClick={() => removeMeter(i)}><Trash2 className="w-4 h-4 text-red-500" /></Button></div>
              </div>
            ))}
          </div>

          <div className="rounded-lg border p-3 space-y-3">
            <div className="flex items-center justify-between"><Label className="font-medium">תזכורות</Label><Switch checked={form.reminders_enabled !== false} onCheckedChange={(v) => set({ reminders_enabled: v })} /></div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1"><Label className="text-xs">ימים לפני מועד התשלום</Label><Input type="number" min="0" max="60" dir="ltr" value={form.reminder_days_before} onChange={(e) => set({ reminder_days_before: e.target.value })} /></div>
              <div className="flex items-center justify-between pt-5"><Label className="text-sm">גם בטלגרם (לבעלים/מנהלים)</Label><Switch checked={!!form.reminder_telegram} onCheckedChange={(v) => set({ reminder_telegram: v })} /></div>
            </div>
            <p className="text-[11px] text-gray-400">התראה באפליקציה נשלחת לפני המועד, ביום התשלום, ואחת לשבוע בזמן איחור.</p>
          </div>

          <div className="space-y-1"><Label>הערות</Label><Textarea rows={2} value={form.notes} onChange={(e) => set({ notes: e.target.value })} /></div>

          {error && <div className="p-2 rounded bg-red-50 text-red-700 text-sm">{error}</div>}
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>ביטול</Button>
            <Button type="submit" disabled={saving || uploading}>{saving ? <Loader2 className="w-4 h-4 animate-spin ml-1" /> : <Save className="w-4 h-4 ml-1" />} שמור</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
