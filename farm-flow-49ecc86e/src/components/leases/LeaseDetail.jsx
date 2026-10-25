import React, { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, FileText, ExternalLink, CalendarPlus, Gauge, Check, Undo2, Plus, Pencil, Trash2, Phone } from "lucide-react";
import { LeasePayment, MeterReading } from "@/entities/all";
import { getToken } from "@/api/localClient";
import { apiFetch, DIRECTIONS, ASSET_TYPES, FREQUENCIES, STATUSES, METHODS, METER_TYPES, KINDS, PAYMENT_STATUS, money, fmtDate, todayIso, daysUntil } from "./leaseUtils";

const contractHref = (url) => (url ? `${url}${url.includes("?") ? "&" : "?"}token=${encodeURIComponent(getToken() || "")}` : null);

export default function LeaseDetail({ open, onClose, lease, farmId, onEdit, onDelete, onChanged, canWrite }) {
  const [payments, setPayments] = useState([]);
  const [readings, setReadings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [payDialog, setPayDialog] = useState(null); // payment being marked paid
  const [payForm, setPayForm] = useState({ paid_date: todayIso(), paid_amount: "", method: "transfer", reference: "" });
  const [chargeOpen, setChargeOpen] = useState(false);
  const [charge, setCharge] = useState({ kind: "other", description: "", amount: "", due_date: todayIso() });
  const [meterOpen, setMeterOpen] = useState(false);
  const [meterForm, setMeterForm] = useState({ meter_type: "", reading: "", reading_date: todayIso(), rate_per_unit: "", create_charge: true });

  const load = async () => {
    if (!lease?.id) return;
    setLoading(true);
    try {
      const [p, r] = await Promise.all([
        LeasePayment.filter({ farm_id: farmId, lease_id: lease.id }).catch(() => []),
        MeterReading.filter({ farm_id: farmId, lease_id: lease.id }).catch(() => []),
      ]);
      setPayments((Array.isArray(p) ? p : []).sort((a, b) => (a.due_date || "").localeCompare(b.due_date || "")));
      setReadings((Array.isArray(r) ? r : []).sort((a, b) => (b.reading_date || "").localeCompare(a.reading_date || "")));
    } finally { setLoading(false); }
  };
  useEffect(() => { if (open) { setError(null); load(); } }, [open, lease?.id]);

  const meters = Array.isArray(lease?.meters) ? lease.meters : [];
  const openPayments = useMemo(() => payments.filter((p) => ["due", "overdue"].includes(p.status)), [payments]);
  const totals = useMemo(() => ({
    open: openPayments.reduce((s, p) => s + (Number(p.amount) || 0), 0),
    overdue: openPayments.filter((p) => p.status === "overdue" || daysUntil(p.due_date) < 0).reduce((s, p) => s + (Number(p.amount) || 0), 0),
    paid: payments.filter((p) => p.status === "paid").reduce((s, p) => s + (Number(p.paid_amount ?? p.amount) || 0), 0),
  }), [payments, openPayments]);

  const run = async (key, fn) => { setBusy(key); setError(null); try { await fn(); await load(); onChanged?.(); } catch (e) { setError(e.data?.error || e.message); } finally { setBusy(null); } };
  const farmQs = `?farm_id=${encodeURIComponent(farmId)}`;

  const generateSchedule = () => run("schedule", async () => {
    const r = await apiFetch(`/leases/${lease.id}/schedule${farmQs}`, { method: "POST", body: JSON.stringify({ months_ahead: 12 }) });
    if (!r.created) setError(r.skipped ? "לוח התשלומים כבר קיים לתקופה הקרובה" : "לא נוצרו תשלומים — בדוק סכום ותאריך התחלה");
  });
  const markPaid = (p) => { setPayDialog(p); setPayForm({ paid_date: todayIso(), paid_amount: String(p.amount ?? ""), method: lease.payment_method || "transfer", reference: "" }); };
  const submitPaid = () => run("pay", async () => { await apiFetch(`/lease-payments/${payDialog.id}/pay${farmQs}`, { method: "POST", body: JSON.stringify({ paid: true, ...payForm }) }); setPayDialog(null); });
  const unpay = (p) => run("unpay", async () => { await apiFetch(`/lease-payments/${p.id}/pay${farmQs}`, { method: "POST", body: JSON.stringify({ paid: false }) }); });
  const removePayment = (p) => { if (!confirm("למחוק את התשלום הזה?")) return; run("del", async () => { await LeasePayment.delete(p.id); }); };
  const addCharge = () => run("charge", async () => {
    if (!(Number(charge.amount) > 0)) throw new Error("סכום לא תקין");
    await LeasePayment.create({ farm_id: farmId, lease_id: lease.id, lease_title: lease.title, direction: lease.direction, kind: charge.kind, description: charge.description || KINDS[charge.kind], due_date: charge.due_date, amount: Number(charge.amount), status: charge.due_date < todayIso() ? "overdue" : "due", reminders_sent: [] });
    setChargeOpen(false); setCharge({ kind: "other", description: "", amount: "", due_date: todayIso() });
  });
  const submitMeter = () => run("meter", async () => {
    const r = await apiFetch(`/leases/${lease.id}/meter-reading${farmQs}`, { method: "POST", body: JSON.stringify(meterForm) });
    setMeterOpen(false); setMeterForm({ meter_type: "", reading: "", reading_date: todayIso(), rate_per_unit: "", create_charge: true });
    if (!r.payment) setError(r.consumption ? "הקריאה נשמרה, לא נוצר חיוב (סכום 0)" : "קריאה ראשונה נשמרה כבסיס. החיוב הבא יחושב מהפרש הקריאות.");
  });

  if (!lease) return null;
  const isPay = lease.direction === "pay";

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {lease.title}
            <Badge className={lease.status === "active" ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-700"}>{STATUSES[lease.status] || lease.status}</Badge>
            <Badge variant="outline">{DIRECTIONS[lease.direction]}</Badge>
          </DialogTitle>
          <DialogDescription>
            {ASSET_TYPES[lease.asset_type] || ""}{lease.asset_description ? ` · ${lease.asset_description}` : ""} · {money(lease.amount)} {FREQUENCIES[lease.frequency]} · יום {lease.due_day || 1} · {fmtDate(lease.start_date)}{lease.end_date ? ` – ${fmtDate(lease.end_date)}` : " (ללא סיום)"}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border p-3 text-sm space-y-1">
            <div className="text-gray-500 text-xs">{isPay ? "משכיר" : "שוכר"}</div>
            <div className="font-medium">{lease.counterparty_name || "—"}</div>
            {lease.counterparty_phone && <a href={`tel:${lease.counterparty_phone}`} className="text-blue-600 inline-flex items-center gap-1 text-xs"><Phone className="w-3 h-3" />{lease.counterparty_phone}</a>}
            {lease.counterparty_id_number && <div className="text-xs text-gray-500">ח.פ {lease.counterparty_id_number}</div>}
          </div>
          <div className="rounded-lg border p-3 text-sm space-y-1">
            <div className="text-gray-500 text-xs">תשלומים</div>
            <div>פתוח: <b>{money(totals.open)}</b>{totals.overdue > 0 && <span className="text-red-600"> · באיחור {money(totals.overdue)}</span>}</div>
            <div className="text-xs text-gray-500">{isPay ? "שולם" : "התקבל"} בסה"כ: {money(totals.paid)}</div>
          </div>
          <div className="rounded-lg border p-3 text-sm space-y-1">
            <div className="text-gray-500 text-xs">חוזה</div>
            {lease.contract_url
              ? <a href={contractHref(lease.contract_url)} target="_blank" rel="noreferrer" className="text-blue-600 inline-flex items-center gap-1"><FileText className="w-4 h-4" />{lease.contract_name || "פתח חוזה"}<ExternalLink className="w-3 h-3" /></a>
              : <span className="text-gray-400">לא צורף</span>}
            <div className="text-xs text-gray-500">{METHODS[lease.payment_method] || ""}</div>
          </div>
        </div>

        {canWrite && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={generateSchedule} disabled={!!busy}>{busy === "schedule" ? <Loader2 className="w-4 h-4 animate-spin ml-1" /> : <CalendarPlus className="w-4 h-4 ml-1" />} צור לוח תשלומים (12 חודשים)</Button>
            <Button size="sm" variant="outline" onClick={() => setChargeOpen((v) => !v)}><Plus className="w-4 h-4 ml-1" /> חיוב חד-פעמי</Button>
            {meters.length > 0 && <Button size="sm" variant="outline" onClick={() => { setMeterOpen((v) => !v); setMeterForm((f) => ({ ...f, meter_type: f.meter_type || meters[0].type })); }}><Gauge className="w-4 h-4 ml-1" /> קריאת מונה</Button>}
            <div className="flex-1" />
            <Button size="sm" variant="ghost" onClick={() => onEdit(lease)}><Pencil className="w-4 h-4 ml-1" /> ערוך</Button>
            <Button size="sm" variant="ghost" className="text-red-600" onClick={() => onDelete(lease)}><Trash2 className="w-4 h-4 ml-1" /> מחק</Button>
          </div>
        )}

        {chargeOpen && (
          <div className="rounded-lg border bg-gray-50 p-3 grid gap-2 sm:grid-cols-5 items-end">
            <div className="space-y-1"><Label className="text-xs">סוג</Label><Select value={charge.kind} onValueChange={(v) => setCharge({ ...charge, kind: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(KINDS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-1 sm:col-span-2"><Label className="text-xs">תיאור</Label><Input value={charge.description} onChange={(e) => setCharge({ ...charge, description: e.target.value })} placeholder="למשל: ארנונה, תיקון גדר" /></div>
            <div className="space-y-1"><Label className="text-xs">סכום</Label><Input type="number" dir="ltr" value={charge.amount} onChange={(e) => setCharge({ ...charge, amount: e.target.value })} /></div>
            <div className="space-y-1"><Label className="text-xs">מועד</Label><div className="flex gap-1"><Input type="date" value={charge.due_date} onChange={(e) => setCharge({ ...charge, due_date: e.target.value })} /><Button size="sm" onClick={addCharge} disabled={busy === "charge"}>הוסף</Button></div></div>
          </div>
        )}

        {meterOpen && (
          <div className="rounded-lg border bg-gray-50 p-3 space-y-2">
            <div className="grid gap-2 sm:grid-cols-5 items-end">
              <div className="space-y-1"><Label className="text-xs">מונה</Label><Select value={meterForm.meter_type} onValueChange={(v) => setMeterForm({ ...meterForm, meter_type: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{meters.map((m) => <SelectItem key={m.type} value={m.type}>{METER_TYPES[m.type]?.label || m.type}{m.meter_number ? ` ${m.meter_number}` : ""}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-1"><Label className="text-xs">קריאה נוכחית</Label><Input type="number" step="0.01" dir="ltr" value={meterForm.reading} onChange={(e) => setMeterForm({ ...meterForm, reading: e.target.value })} /></div>
              <div className="space-y-1"><Label className="text-xs">תאריך</Label><Input type="date" value={meterForm.reading_date} onChange={(e) => setMeterForm({ ...meterForm, reading_date: e.target.value })} /></div>
              <div className="space-y-1"><Label className="text-xs">תעריף (ריק = מההסכם)</Label><Input type="number" step="0.001" dir="ltr" value={meterForm.rate_per_unit} onChange={(e) => setMeterForm({ ...meterForm, rate_per_unit: e.target.value })} /></div>
              <Button size="sm" onClick={submitMeter} disabled={busy === "meter" || !meterForm.meter_type || meterForm.reading === ""}>{busy === "meter" ? <Loader2 className="w-4 h-4 animate-spin" /> : "שמור וחייב"}</Button>
            </div>
            {(() => { const m = meters.find((x) => x.type === meterForm.meter_type); const cons = m && m.last_reading != null && meterForm.reading !== "" ? Number(meterForm.reading) - Number(m.last_reading) : null; const rate = meterForm.rate_per_unit !== "" ? Number(meterForm.rate_per_unit) : Number(m?.rate_per_unit) || 0; return m ? <p className="text-xs text-gray-500">קריאה קודמת: {m.last_reading ?? "אין"}{m.last_reading_date ? ` (${fmtDate(m.last_reading_date)})` : ""}{cons != null && cons >= 0 ? ` · צריכה ${cons.toLocaleString("he-IL")} ${m.unit || ""} × ₪${rate} = ${money(cons * rate)}` : ""}</p> : null; })()}
          </div>
        )}

        {error && <div className="p-2 rounded bg-amber-50 border border-amber-200 text-amber-800 text-sm">{error}</div>}

        <div>
          <div className="text-sm font-medium mb-2">תשלומים ({payments.length})</div>
          {loading ? <div className="text-sm text-gray-400 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> טוען…</div>
            : payments.length === 0 ? <p className="text-sm text-gray-400">אין תשלומים. צור לוח תשלומים או הוסף חיוב.</p>
            : (
              <div className="divide-y rounded-lg border">
                {payments.map((p) => {
                  const st = p.status === "due" && daysUntil(p.due_date) < 0 ? "overdue" : p.status;
                  const d = daysUntil(p.due_date);
                  return (
                    <div key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-2 text-sm">
                      <Badge className={PAYMENT_STATUS[st]?.cls}>{PAYMENT_STATUS[st]?.label}</Badge>
                      <span className="tabular-nums text-gray-600">{fmtDate(p.due_date)}</span>
                      <span className="flex-1 min-w-[140px]">{p.description || KINDS[p.kind]}{st !== "paid" && d >= 0 && d <= 7 ? <span className="text-amber-600 text-xs"> · בעוד {d} ימים</span> : null}{st === "overdue" ? <span className="text-red-600 text-xs"> · איחור {-d} ימים</span> : null}</span>
                      <span className="font-semibold tabular-nums">{money(p.amount)}</span>
                      {p.status === "paid" && <span className="text-xs text-gray-500">{fmtDate(p.paid_date)} · {METHODS[p.method] || ""}{p.reference ? ` · ${p.reference}` : ""}</span>}
                      {canWrite && (p.status === "paid"
                        ? <Button size="sm" variant="ghost" onClick={() => unpay(p)} disabled={!!busy} title="בטל סימון שולם"><Undo2 className="w-4 h-4" /></Button>
                        : <><Button size="sm" variant="outline" className="text-green-700 border-green-300" onClick={() => markPaid(p)} disabled={!!busy}><Check className="w-4 h-4 ml-1" />{isPay ? "שולם" : "התקבל"}</Button>
                          <Button size="sm" variant="ghost" className="text-gray-400" onClick={() => removePayment(p)} disabled={!!busy}><Trash2 className="w-4 h-4" /></Button></>)}
                    </div>
                  );
                })}
              </div>
            )}
        </div>

        {meters.length > 0 && (
          <div>
            <div className="text-sm font-medium mb-2">מונים</div>
            <div className="grid gap-2 sm:grid-cols-2">
              {meters.map((m, i) => (
                <div key={i} className="rounded-lg border p-2 text-sm">
                  <div className="font-medium">{METER_TYPES[m.type]?.label || m.type}{m.meter_number ? ` · ${m.meter_number}` : ""}</div>
                  <div className="text-xs text-gray-500">קריאה אחרונה: {m.last_reading ?? "—"}{m.last_reading_date ? ` (${fmtDate(m.last_reading_date)})` : ""} · תעריף ₪{m.rate_per_unit || 0}/{m.unit || "יח'"}</div>
                </div>
              ))}
            </div>
            {readings.length > 0 && (
              <div className="mt-2 text-xs text-gray-600 divide-y rounded-lg border">
                {readings.slice(0, 12).map((r) => (
                  <div key={r.id} className="flex flex-wrap gap-x-3 p-2"><span>{fmtDate(r.reading_date)}</span><span>{METER_TYPES[r.meter_type]?.label}</span><span>{r.previous_reading ?? "—"} → {r.reading}</span><span>צריכה {r.consumption} {r.unit}</span><span className="font-medium">{money(r.amount)}</span></div>
                ))}
              </div>
            )}
          </div>
        )}

        {lease.notes && <div className="text-sm text-gray-600 whitespace-pre-wrap border-t pt-2">{lease.notes}</div>}

        {payDialog && (
          <Dialog open onOpenChange={(v) => { if (!v) setPayDialog(null); }}>
            <DialogContent className="max-w-sm" dir="rtl">
              <DialogHeader><DialogTitle>{isPay ? "סימון תשלום ששולם" : "סימון תשלום שהתקבל"}</DialogTitle><DialogDescription>{payDialog.description} · {money(payDialog.amount)}</DialogDescription></DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1"><Label>תאריך</Label><Input type="date" value={payForm.paid_date} onChange={(e) => setPayForm({ ...payForm, paid_date: e.target.value })} /></div>
                <div className="space-y-1"><Label>סכום</Label><Input type="number" dir="ltr" value={payForm.paid_amount} onChange={(e) => setPayForm({ ...payForm, paid_amount: e.target.value })} /></div>
                <div className="space-y-1"><Label>אמצעי</Label><Select value={payForm.method} onValueChange={(v) => setPayForm({ ...payForm, method: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(METHODS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent></Select></div>
                <div className="space-y-1"><Label>אסמכתא</Label><Input value={payForm.reference} onChange={(e) => setPayForm({ ...payForm, reference: e.target.value })} placeholder="מס' צ'ק / העברה" /></div>
                <div className="flex gap-2 justify-end"><Button variant="outline" onClick={() => setPayDialog(null)}>ביטול</Button><Button onClick={submitPaid} disabled={busy === "pay"} className="bg-green-600 hover:bg-green-700 text-white">{busy === "pay" ? <Loader2 className="w-4 h-4 animate-spin" /> : "אשר"}</Button></div>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </DialogContent>
    </Dialog>
  );
}
