import React, { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Receipt, ExternalLink, FlaskConical, Check, Ban } from "lucide-react";
import { apiFetch, METHODS, KINDS, BILLING_MODES, INVOICE_STATUS, money, fmtDate, todayIso } from "./leaseUtils";

import { DateInput } from "@/components/ui/date-input";
const thisMonth = () => todayIso().slice(0, 7);

export default function LeaseInvoices({ lease, farmId, invoices, payments, canWrite, onChanged }) {
  const [open, setOpen] = useState(false);
  const [period, setPeriod] = useState(thisMonth());
  const [includeRent, setIncludeRent] = useState(false);
  const [docType, setDocType] = useState("305");
  const [sendEmail, setSendEmail] = useState(false);
  const [paid, setPaid] = useState({ paid_date: todayIso(), method: lease.payment_method || "transfer", reference: "" });
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [payInv, setPayInv] = useState(null);
  const [payForm, setPayForm] = useState({ paid_date: todayIso(), method: lease.payment_method || "transfer", reference: "", issue_receipt: true });

  const farmQs = `?farm_id=${encodeURIComponent(farmId)}`;
  const mode = lease.billing_mode || (lease.frequency === "monthly" ? "monthly_all" : "split");
  const uninvoicedRent = payments.filter((p) => p.kind === "rent" && !p.invoice_id && p.status !== "cancelled");

  useEffect(() => {
    if (!open) return;
    setLoading(true); setError(null);
    apiFetch(`/leases/${lease.id}/invoice-preview${farmQs}&period=${period}&include_rent=${includeRent ? 1 : 0}`)
      .then(setPreview).catch((e) => setError(e.data?.error || e.message)).finally(() => setLoading(false));
  }, [open, period, includeRent, lease.id]);

  const issue = async (payment_ids) => {
    setBusy(true); setError(null);
    try {
      await apiFetch(`/leases/${lease.id}/invoice${farmQs}`, { method: "POST", body: JSON.stringify({ period, include_rent: includeRent, payment_ids, doc_type: Number(docType), send_to_customer: sendEmail, paid: docType === "320" ? paid : undefined }) });
      setOpen(false); await onChanged?.();
    } catch (e) { setError(e.data?.error || e.message); } finally { setBusy(false); }
  };
  const issueRent = async (p) => {
    if (!confirm(`להפיק חשבונית לשכירות ${p.description} (${money(p.amount)})?`)) return;
    setBusy(true); setError(null);
    try { await apiFetch(`/leases/${lease.id}/invoice${farmQs}`, { method: "POST", body: JSON.stringify({ period: String(p.due_date).slice(0, 7), payment_ids: [p.id], doc_type: 305 }) }); await onChanged?.(); }
    catch (e) { setError(e.data?.error || e.message); } finally { setBusy(false); }
  };
  const submitPay = async () => {
    setBusy(true); setError(null);
    try { await apiFetch(`/lease-invoices/${payInv.id}/pay${farmQs}`, { method: "POST", body: JSON.stringify(payForm) }); setPayInv(null); await onChanged?.(); }
    catch (e) { setError(e.data?.error || e.message); } finally { setBusy(false); }
  };
  const cancel = async (inv) => {
    if (!confirm(`לבטל את חשבונית ${inv.number}? החיובים ישוחררו להפקה מחדש.`)) return;
    setBusy(true); setError(null);
    try { await apiFetch(`/lease-invoices/${inv.id}/cancel${farmQs}`, { method: "POST" }); await onChanged?.(); }
    catch (e) { setError(e.data?.error || e.message); } finally { setBusy(false); }
  };

  return (
    <div className="rounded-lg border p-3 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-medium flex items-center gap-2"><Receipt className="w-4 h-4 text-indigo-500" /> חשבוניות לשוכר
          <span className="text-[11px] font-normal text-gray-500">{BILLING_MODES[mode]?.label}</span></div>
        {canWrite && <Button size="sm" variant="outline" onClick={() => { setPeriod(thisMonth()); setOpen(true); }} disabled={busy}><Receipt className="w-4 h-4 ml-1" /> הפק חשבונית לתקופה</Button>}
      </div>
      {mode === "split" && uninvoicedRent.length > 0 && canWrite && (
        <div className="text-xs text-gray-600 space-y-1">
          <div>שכירות ללא חשבונית:</div>
          {uninvoicedRent.slice(0, 4).map((p) => (
            <div key={p.id} className="flex items-center gap-2"><span className="flex-1">{p.description} · {fmtDate(p.due_date)} · {money(p.amount)}</span><Button size="sm" variant="ghost" className="h-7 text-indigo-700" onClick={() => issueRent(p)} disabled={busy}>הפק חשבונית</Button></div>
          ))}
        </div>
      )}
      {invoices.length === 0 ? <p className="text-xs text-gray-400">טרם הופקו חשבוניות להסכם זה.</p> : (
        <div className="divide-y text-sm">
          {invoices.map((inv) => (
            <div key={inv.id} className="py-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
              <Badge className={INVOICE_STATUS[inv.status]?.cls}>{INVOICE_STATUS[inv.status]?.label}</Badge>
              <span className="font-medium">#{inv.number}</span>
              <span className="text-gray-500">{inv.period}</span>
              <span className="text-gray-500 text-xs">{(inv.payment_ids || []).length} חיובים{inv.discount > 0 ? ` · זיכוי ${money(inv.discount)}` : ""}</span>
              <span className="font-semibold tabular-nums">{money(inv.total)}</span>
              {inv.maven?.test && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 inline-flex items-center gap-1"><FlaskConical className="w-3 h-3" /> בדיקה</span>}
              {inv.maven?.pdf_original && <a href={inv.maven.pdf_original} target="_blank" rel="noreferrer" className="text-blue-600 text-xs inline-flex items-center gap-1">PDF <ExternalLink className="w-3 h-3" /></a>}
              {inv.receipt?.pdf_original && <a href={inv.receipt.pdf_original} target="_blank" rel="noreferrer" className="text-blue-600 text-xs inline-flex items-center gap-1">קבלה <ExternalLink className="w-3 h-3" /></a>}
              {inv.status === "paid" && <span className="text-xs text-gray-500">{fmtDate(inv.paid_date || inv.paid_at)}{inv.method ? ` · ${METHODS[inv.method]}` : ""}</span>}
              {canWrite && inv.status === "issued" && <Button size="sm" variant="outline" className="h-7 text-green-700 border-green-300" onClick={() => { setPayInv(inv); setPayForm({ paid_date: todayIso(), method: lease.payment_method || "transfer", reference: "", issue_receipt: !!inv.maven }); }} disabled={busy}><Check className="w-3.5 h-3.5 ml-1" /> התקבל תשלום</Button>}
              {canWrite && inv.status !== "cancelled" && (!inv.maven || inv.maven.test) && <Button size="sm" variant="ghost" className="h-7 text-gray-400" onClick={() => cancel(inv)} disabled={busy} title="בטל"><Ban className="w-3.5 h-3.5" /></Button>}
            </div>
          ))}
        </div>
      )}
      {error && !open && !payInv && <div className="p-2 rounded bg-red-50 text-red-700 text-xs">{error}</div>}

      <Dialog open={open} onOpenChange={(v) => { if (!busy) setOpen(v); }}>
        <DialogContent className="max-w-lg" dir="rtl">
          <DialogHeader><DialogTitle>הפקת חשבונית · {lease.title}</DialogTitle>
            <DialogDescription>{mode === "monthly_all" ? "חשבונית חודשית אחת: שכירות, מונים וחיובים של החודש." : "חשבונית חודשית למונים ולחיובים. שכירות מופקת בנפרד לפי התדירות שלה."}</DialogDescription></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1"><Label className="text-xs">חודש</Label><Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} /></div>
              <div className="space-y-1"><Label className="text-xs">סוג מסמך</Label>
                <Select value={docType} onValueChange={setDocType}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="305">חשבונית מס</SelectItem><SelectItem value="320">חשבונית מס/קבלה (שולם)</SelectItem></SelectContent></Select></div>
            </div>
            {mode === "split" && <label className="flex items-center gap-2 text-sm cursor-pointer"><Checkbox checked={includeRent} onCheckedChange={(v) => setIncludeRent(!!v)} /> כלול גם שכירות שמועדה בחודש זה</label>}
            {loading ? <div className="text-sm text-gray-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> טוען…</div> : preview && (
              <div className="rounded-lg border bg-gray-50 p-3 text-sm space-y-1">
                {preview.payments.length === 0 ? <div className="text-gray-500">אין חיובים פתוחים לתקופה זו.</div> : preview.payments.map((p) => (
                  <div key={p.id} className="flex justify-between gap-2"><span className="truncate">{p.description || KINDS[p.kind]} <span className="text-gray-400 text-xs">{fmtDate(p.due_date)}</span></span><span className={`tabular-nums ${Number(p.amount) < 0 ? "text-emerald-700" : ""}`}>{money(p.amount)}</span></div>
                ))}
                {preview.discount > 0 && <div className="flex justify-between text-emerald-700 border-t pt-1"><span>זיכויים</span><span>−{money(preview.discount)}</span></div>}
                <div className="flex justify-between font-semibold border-t pt-1"><span>סה"כ{preview.vat_exempt ? " (פטור ממע\"מ)" : ""}</span><span>{money(preview.total)}</span></div>
                <div className="text-[11px] text-gray-500">{preview.maven_enabled ? (preview.test_mode ? "יופק ב-Invoice Maven במצב בדיקה (לא נשמר שם)" : "יופק ב-Invoice Maven") : "Maven לא מופעל — תירשם חשבונית פנימית בלבד (ללא PDF)"}</div>
              </div>
            )}
            {docType === "320" && (
              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-1"><Label className="text-xs">תאריך תשלום</Label><DateInput value={paid.paid_date} onChange={(e) => setPaid({ ...paid, paid_date: e.target.value })} /></div>
                <div className="space-y-1"><Label className="text-xs">אמצעי</Label><Select value={paid.method} onValueChange={(v) => setPaid({ ...paid, method: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(METHODS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent></Select></div>
                <div className="space-y-1"><Label className="text-xs">אסמכתא</Label><Input value={paid.reference} onChange={(e) => setPaid({ ...paid, reference: e.target.value })} /></div>
              </div>
            )}
            {preview?.maven_enabled && <label className="flex items-center gap-2 text-sm cursor-pointer"><Checkbox checked={sendEmail} onCheckedChange={(v) => setSendEmail(!!v)} /> שלח לשוכר במייל{preview.customer?.email ? ` (${preview.customer.email})` : " (אין מייל בהסכם)"}</label>}
            {error && <div className="p-2 rounded bg-red-50 text-red-700 text-sm">{error}</div>}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>ביטול</Button>
            <Button onClick={() => issue()} disabled={busy || loading || !preview || preview.payments.length === 0 || preview.total <= 0} >{busy ? <Loader2 className="w-4 h-4 animate-spin ml-1" /> : <Receipt className="w-4 h-4 ml-1" />} הפק חשבונית</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {payInv && (
        <Dialog open onOpenChange={(v) => { if (!v && !busy) setPayInv(null); }}>
          <DialogContent className="max-w-sm" dir="rtl">
            <DialogHeader><DialogTitle>קבלת תשלום · חשבונית #{payInv.number}</DialogTitle><DialogDescription>{money(payInv.total)} · {payInv.period}</DialogDescription></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1"><Label>תאריך</Label><DateInput value={payForm.paid_date} onChange={(e) => setPayForm({ ...payForm, paid_date: e.target.value })} /></div>
              <div className="space-y-1"><Label>אמצעי</Label><Select value={payForm.method} onValueChange={(v) => setPayForm({ ...payForm, method: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(METHODS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-1"><Label>אסמכתא</Label><Input value={payForm.reference} onChange={(e) => setPayForm({ ...payForm, reference: e.target.value })} placeholder="מס' העברה / צ'ק" /></div>
              {payInv.maven && payInv.doc_type === 305 && <label className="flex items-center gap-2 text-sm cursor-pointer"><Checkbox checked={payForm.issue_receipt} onCheckedChange={(v) => setPayForm({ ...payForm, issue_receipt: !!v })} /> הפק קבלה ב-Maven</label>}
              {error && <div className="p-2 rounded bg-red-50 text-red-700 text-sm">{error}</div>}
              <div className="flex gap-2 justify-end"><Button variant="outline" onClick={() => setPayInv(null)} disabled={busy}>ביטול</Button><Button onClick={submitPay} disabled={busy} className="bg-green-600 hover:bg-green-700 text-white">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "אשר תשלום"}</Button></div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
