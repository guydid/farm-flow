import React, { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Pencil, FileText, ExternalLink, Scale, Link2, Package } from "lucide-react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { apiFetch, DN_DIRECTIONS, DN_STATUS, SOURCES, money, fmtDate, fileHref, isImage } from "./procurementUtils";

const Status = ({ value }) => { const s = DN_STATUS[value] || { label: value, cls: "bg-gray-100 text-gray-700" }; return <Badge className={`${s.cls} border-0`}>{s.label}</Badge>; };

/** כרטיס תעודת משלוח: פרטים, צילום, שורות מול ההזמנה, קישור חשבונית, סטטוס והיסטוריה. */
export default function DeliveryNoteDetail({ open, onClose, noteId, farmId, canWrite, invoices = [], onEdit, onOpenOrder, onChanged }) {
  const [note, setNote] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [matchInfo, setMatchInfo] = useState(null);
  const qs = `?farm_id=${encodeURIComponent(farmId)}`;

  const load = async () => {
    if (!noteId) return;
    setLoading(true); setError(null); setMatchInfo(null);
    try { setNote(await apiFetch(`/procurement/delivery-notes/${noteId}${qs}`)); }
    catch (e) { setError(e.data?.error || e.message); } finally { setLoading(false); }
  };
  useEffect(() => { if (open) load(); else setNote(null); }, [open, noteId]);

  const patch = async (body) => {
    setBusy(true); setError(null);
    try { const r = await apiFetch(`/procurement/delivery-notes/${note.id}${qs}`, { method: "PUT", body: JSON.stringify(body) }); setNote(r.delivery_note); onChanged?.(); return r; }
    catch (e) { setError(e.data?.error || e.message); } finally { setBusy(false); }
  };
  const linkInvoice = async (invoice_id) => {
    if (!invoice_id) return patch({ invoice_id: null, status: note.status === "invoiced" ? "checked" : note.status, status_note: "הוסר קישור לחשבונית" });
    setBusy(true); setError(null);
    try {
      const r = await apiFetch(`/procurement/match-invoice${qs}`, { method: "POST", body: JSON.stringify({ invoice_id, delivery_note_ids: [note.id] }) });
      setMatchInfo(r.matched ? "החשבונית קושרה לתעודה" : r.reason);
      await load(); onChanged?.();
    } catch (e) { setError(e.data?.error || e.message); } finally { setBusy(false); }
  };

  const partyInvoices = note ? invoices.filter((inv) => !note.supplier_id || inv.supplier_id === note.supplier_id).slice(0, 60) : [];
  const linkedInvoice = note?.invoice_id ? invoices.find((i) => i.id === note.invoice_id) : null;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto" dir="rtl">
        {loading || !note ? (
          <div className="py-10 flex justify-center">{error ? <p className="text-destructive text-sm">{error}</p> : <Loader2 className="w-6 h-6 animate-spin text-primary" aria-label="טוען" />}</div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2">
                תעודת משלוח {DN_DIRECTIONS[note.direction]} {note.note_number}
                <Status value={note.status} />
                {note.source && note.source !== "app" && <Badge variant="outline">{SOURCES[note.source] || note.source}</Badge>}
              </DialogTitle>
              <DialogDescription>
                {note.counterparty_name} · {fmtDate(note.delivery_date)} · {money(note.total_amount)}
                {note.driver_name ? ` · נהג: ${note.driver_name}` : ""}{note.vehicle ? ` · ${note.vehicle}` : ""}{note.received_by ? ` · ${note.direction === "in" ? "נקלט ע\"י" : "נמסר ע\"י"} ${note.received_by}` : ""}
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-3 sm:grid-cols-3 text-sm">
              <div className="rounded-lg border p-3 space-y-1">
                <div className="text-xs text-muted-foreground">הזמנה</div>
                {note.order_id
                  ? <button type="button" className="text-primary underline inline-flex items-center gap-1" onClick={() => onOpenOrder?.(note.order_id)}><Package className="w-3.5 h-3.5" aria-hidden="true" />{note.order_number || "פתח הזמנה"}</button>
                  : <span className="text-muted-foreground">ללא הזמנה</span>}
              </div>
              <div className="rounded-lg border p-3 space-y-1">
                <div className="text-xs text-muted-foreground">חשבונית</div>
                {note.direction === "in" && canWrite ? (
                  <Select value={note.invoice_id || "__none__"} onValueChange={(v) => linkInvoice(v === "__none__" ? "" : v)} disabled={busy}>
                    <SelectTrigger className="h-9"><SelectValue placeholder="ללא" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">ללא חשבונית</SelectItem>
                      {partyInvoices.map((inv) => <SelectItem key={inv.id} value={inv.id}>{inv.invoice_number ? `מס' ${inv.invoice_number}` : "ללא מספר"} · {inv.date || ""} · ₪{Number(inv.total || 0).toLocaleString("he-IL")}</SelectItem>)}
                    </SelectContent>
                  </Select>
                ) : linkedInvoice || note.invoice_id ? <span>{linkedInvoice?.invoice_number ? `מס' ${linkedInvoice.invoice_number}` : "מקושרת"}</span> : <span className="text-muted-foreground">ללא</span>}
                {note.invoice_id && <Link to={`${createPageUrl("InvoiceDetail")}?id=${note.invoice_id}`} className="text-xs text-primary inline-flex items-center gap-1"><Link2 className="w-3 h-3" aria-hidden="true" /> פתח חשבונית</Link>}
                {matchInfo && <div className="text-[11px] text-muted-foreground">{matchInfo}</div>}
              </div>
              <div className="rounded-lg border p-3 space-y-2">
                <div className="text-xs text-muted-foreground">סטטוס</div>
                {canWrite ? (
                  <Select value={note.status} onValueChange={(v) => patch({ status: v })} disabled={busy}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>{Object.entries(DN_STATUS).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent>
                  </Select>
                ) : <Status value={note.status} />}
              </div>
            </div>

            {(note.weighing_certificates || []).length > 0 && (
              <div className="rounded-lg border p-3 text-sm flex flex-wrap items-center gap-2">
                <Scale className="w-4 h-4 text-primary" aria-hidden="true" /> תעודות שקילה מקושרות:
                {note.weighing_certificates.map((c) => <Link key={c.id} to={`${createPageUrl("WeighingDetail")}?id=${c.id}`} className="text-primary underline">{c.certificate_number || c.id.slice(0, 6)}</Link>)}
              </div>
            )}

            {canWrite && (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => onEdit?.(note)}><Pencil className="w-4 h-4 ml-1" aria-hidden="true" /> ערוך תעודה</Button>
                {note.file_url && <Button asChild size="sm" variant="outline"><a href={fileHref(note.file_url)} target="_blank" rel="noreferrer"><ExternalLink className="w-4 h-4 ml-1" aria-hidden="true" /> פתח צילום</a></Button>}
              </div>
            )}
            {error && <p className="text-sm text-destructive" role="alert">{error}</p>}

            <section aria-labelledby="dn-items-h">
              <h3 id="dn-items-h" className="text-sm font-semibold mb-1">שורות התעודה</h3>
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs text-muted-foreground"><tr><th className="text-right p-2">מוצר</th><th className="p-2">כמות</th><th className="p-2">בהזמנה</th><th className="p-2">מחיר</th><th className="p-2">מחיר בהזמנה</th><th className="p-2">הערת פער</th></tr></thead>
                  <tbody>
                    {note.items.map((it) => {
                      const qtyDiff = it.ordered_quantity != null && Number(it.quantity) !== Number(it.ordered_quantity);
                      const priceDiff = it.order_unit_price != null && it.unit_price != null && Number(it.unit_price) !== Number(it.order_unit_price);
                      return (
                        <tr key={it.id} className="border-t">
                          <td className="p-2">{it.product_name}{it.not_in_order && <span className="ms-1 text-[10px] text-amber-700">לא בהזמנה</span>}{it.stock_movement_id && <span className="ms-1 text-[10px] text-emerald-700">במלאי</span>}</td>
                          <td className={`p-2 text-center tabular-nums ${qtyDiff ? "text-amber-700 font-semibold" : ""}`}>{it.quantity} {it.unit}</td>
                          <td className="p-2 text-center tabular-nums text-muted-foreground">{it.ordered_quantity ?? "—"}</td>
                          <td className={`p-2 text-center tabular-nums ${priceDiff ? "text-amber-700 font-semibold" : ""}`}>{money(it.unit_price)}</td>
                          <td className="p-2 text-center tabular-nums text-muted-foreground">{money(it.order_unit_price)}</td>
                          <td className="p-2 text-xs">{it.discrepancy_note || ""}</td>
                        </tr>
                      );
                    })}
                    {note.items.length === 0 && <tr><td colSpan={6} className="p-3 text-center text-muted-foreground">אין שורות</td></tr>}
                  </tbody>
                </table>
              </div>
            </section>

            {note.file_url && (
              <section aria-labelledby="dn-file-h">
                <h3 id="dn-file-h" className="text-sm font-semibold mb-1 inline-flex items-center gap-1"><FileText className="w-4 h-4" aria-hidden="true" /> צילום התעודה</h3>
                {isImage(note.file_url)
                  ? <a href={fileHref(note.file_url)} target="_blank" rel="noreferrer"><img src={fileHref(note.file_url)} alt={`צילום תעודת משלוח ${note.note_number}`} className="max-h-72 rounded-lg border object-contain" /></a>
                  : <iframe src={fileHref(note.file_url)} title={`תעודת משלוח ${note.note_number}`} className="w-full h-72 rounded-lg border" />}
              </section>
            )}

            {note.notes && <p className="text-sm text-muted-foreground">{note.notes}</p>}

            <section aria-labelledby="dn-hist-h">
              <h3 id="dn-hist-h" className="text-sm font-semibold mb-1">היסטוריה</h3>
              <ol className="text-xs space-y-1 text-muted-foreground">
                {[...(note.history || [])].reverse().map((h, i) => (
                  <li key={i} className="flex flex-wrap gap-1">
                    <span className="tabular-nums">{fmtDate(h.at)} {String(h.at).slice(11, 16)}</span>
                    <span className="text-foreground">{h.by}</span>
                    <span>{h.action === "created" ? "קלט/ה" : h.action === "status" ? `סטטוס: ${DN_STATUS[h.from]?.label || h.from || "—"} → ${DN_STATUS[h.to]?.label || h.to}` : `עדכון${h.fields ? ` (${h.fields.join(", ")})` : ""}`}</span>
                    {h.note && <span>· {h.note}</span>}
                  </li>
                ))}
              </ol>
            </section>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
