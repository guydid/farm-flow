import React, { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Loader2, PackagePlus, Pencil, FileText, History, MapPin, Phone, Camera } from "lucide-react";
import { apiFetch, DIRECTIONS, ORDER_STATUS, DN_STATUS, SOURCES, money, fmtDate, fileHref } from "./procurementUtils";

const Status = ({ map, value }) => { const s = map[value] || { label: value, cls: "bg-muted text-muted-foreground" }; return <Badge className={`${s.cls} border-0 font-medium`}>{s.label}</Badge>; };

/** כרטיס הזמנה: שורות עם התקדמות אספקה, תעודות המשלוח שלה, שינוי סטטוס והיסטוריה. */
export default function OrderDetail({ open, onClose, orderId, farmId, canWrite, plots = [], onEdit, onReceive, onOpenNote, onChanged }) {
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  const [cancelAsk, setCancelAsk] = useState(false); // ביטול הזמנה — אישור + סיבה בתוך הממשק, לא ב-prompt של הדפדפן
  const [cancelNote, setCancelNote] = useState("");
  const qs = `?farm_id=${encodeURIComponent(farmId)}`;

  const load = async () => {
    if (!orderId) return;
    setLoading(true); setError(null);
    try { setOrder(await apiFetch(`/procurement/orders/${orderId}${qs}`)); }
    catch (e) { setError(e.data?.error || e.message); } finally { setLoading(false); }
  };
  useEffect(() => { if (open) load(); else setOrder(null); }, [open, orderId]);

  const changeStatus = async (status, note = "") => {
    if (!order || status === order.status) return;
    if (status === "cancelled" && !cancelAsk) { setCancelNote(""); setCancelAsk(true); return; }
    setCancelAsk(false);
    setBusy(true); setError(null);
    try { setOrder(await apiFetch(`/procurement/orders/${order.id}/status${qs}`, { method: "POST", body: JSON.stringify({ status, note }) })); onChanged?.(); }
    catch (e) { setError(e.data?.error || e.message); } finally { setBusy(false); }
  };

  const ordered = (order?.items || []).reduce((s, it) => s + Number(it.quantity), 0);
  const delivered = (order?.items || []).reduce((s, it) => s + Number(it.delivered_quantity || 0), 0);
  const pct = ordered ? Math.round((delivered / ordered) * 100) : 0;
  const plot = order?.plot_id ? plots.find((p) => p.id === order.plot_id) : null;
  const canReceive = canWrite && order && !["cancelled", "invoiced"].includes(order.status);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto" dir="rtl">
        {loading || !order ? (
          <div className="py-10 flex justify-center">{error ? <p className="text-destructive text-sm">{error}</p> : <Loader2 className="w-6 h-6 animate-spin text-primary" aria-label="טוען" />}</div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2">
                הזמנת {DIRECTIONS[order.direction]} {order.order_number}
                <Status map={ORDER_STATUS} value={order.status} />
                {order.source && order.source !== "app" && <Badge variant="outline">{SOURCES[order.source] || order.source}</Badge>}
              </DialogTitle>
              <DialogDescription>
                {order.counterparty_name} · הוזמן {fmtDate(order.order_date)}{order.expected_delivery_date ? ` · אספקה צפויה ${fmtDate(order.expected_delivery_date)}` : ""} · {money(order.total_amount)}{order.vat_included ? " כולל מע\"מ" : ""}
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-3 sm:grid-cols-3 text-sm">
              <div className="rounded-lg border p-3 space-y-1">
                <div className="text-xs text-muted-foreground">אספקה</div>
                <Progress value={pct} className="h-2" aria-label={`סופק ${pct}%`} />
                <div className="tabular-nums">{pct}% · {order.delivery_notes.length} תעודות משלוח</div>
              </div>
              <div className="rounded-lg border p-3 space-y-1">
                <div className="text-xs text-muted-foreground">פרטים</div>
                {order.contact_person && <div className="inline-flex items-center gap-1"><Phone className="w-3 h-3" aria-hidden="true" />{order.contact_person}</div>}
                {plot && <div className="inline-flex items-center gap-1"><MapPin className="w-3 h-3" aria-hidden="true" />{plot.name}</div>}
                {order.source_ref && <div className="text-xs text-muted-foreground truncate" title={order.source_ref}>מקור: {order.source_ref}</div>}
                {order.notes && <div className="text-xs">{order.notes}</div>}
                {!order.contact_person && !plot && !order.notes && <div className="text-muted-foreground">—</div>}
              </div>
              <div className="rounded-lg border p-3 space-y-2">
                <div className="text-xs text-muted-foreground">סטטוס</div>
                {canWrite ? (
                  <Select value={order.status} onValueChange={changeStatus} disabled={busy}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>{Object.entries(ORDER_STATUS).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent>
                  </Select>
                ) : <Status map={ORDER_STATUS} value={order.status} />}
                <div className="text-xs text-muted-foreground">סופק חלקית, סופק וחויב נקבעים מהתעודות</div>
              </div>
            </div>

            {canWrite && (
              <div className="flex flex-wrap gap-2">
                {canReceive && <Button size="sm" onClick={() => onReceive?.(order)}><PackagePlus className="w-4 h-4 ml-1" aria-hidden="true" /> {order.direction === "purchase" ? "קלוט תעודת משלוח" : "תעודת משלוח יוצאת"}</Button>}
                <Button size="sm" variant="outline" onClick={() => onEdit?.(order)}><Pencil className="w-4 h-4 ml-1" aria-hidden="true" /> ערוך פרטים</Button>
                <Button size="sm" variant="ghost" onClick={() => setShowHistory((v) => !v)}><History className="w-4 h-4 ml-1" aria-hidden="true" /> היסטוריה ({(order.history || []).length})</Button>
              </div>
            )}
            {error && <p className="text-sm text-destructive" role="alert">{error}</p>}

            <section aria-labelledby="order-items-h">
              <h3 id="order-items-h" className="text-sm font-semibold mb-1">שורות ההזמנה</h3>
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs text-muted-foreground"><tr><th className="text-right p-2">מוצר</th><th className="p-2">הוזמן</th><th className="p-2">סופק</th><th className="p-2">נותר</th><th className="p-2">מחיר</th><th className="p-2">סה"כ</th></tr></thead>
                  <tbody>
                    {order.items.map((it) => {
                      const rem = Number(it.quantity) - Number(it.delivered_quantity || 0);
                      return (
                        <tr key={it.id} className="border-t">
                          <td className="p-2">{it.product_name}{it.notes && <div className="text-xs text-muted-foreground">{it.notes}</div>}</td>
                          <td className="p-2 text-center tabular-nums">{it.quantity} {it.unit}</td>
                          <td className={`p-2 text-center tabular-nums ${Number(it.delivered_quantity) > Number(it.quantity) ? "text-amber-700 font-semibold" : ""}`}>{it.delivered_quantity || 0}</td>
                          <td className={`p-2 text-center tabular-nums ${rem > 0 ? "" : "text-green-700"}`}>{rem > 0 ? rem : "✓"}</td>
                          <td className="p-2 text-center tabular-nums">{money(it.unit_price)}</td>
                          <td className="p-2 text-center tabular-nums">{money((Number(it.quantity) || 0) * (Number(it.unit_price) || 0))}</td>
                        </tr>
                      );
                    })}
                    {order.items.length === 0 && <tr><td colSpan={6} className="p-3 text-center text-muted-foreground">אין שורות</td></tr>}
                  </tbody>
                </table>
              </div>
            </section>

            <section aria-labelledby="order-notes-h">
              <h3 id="order-notes-h" className="text-sm font-semibold mb-1">תעודות משלוח</h3>
              {order.delivery_notes.length === 0 ? <p className="text-sm text-muted-foreground">עדיין לא נקלטו תעודות להזמנה זו.</p> : (
                <ul className="space-y-1">
                  {order.delivery_notes.map((n) => (
                    <li key={n.id} className="flex items-stretch gap-1">
                      <button type="button" onClick={() => onOpenNote?.(n)} className="flex-1 min-w-0 text-start rounded-lg border p-2 min-h-11 hover:bg-accent flex flex-wrap items-center gap-2 text-sm">
                        <FileText className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden="true" />
                        <span className="font-medium tabular-nums">{n.note_number}</span>
                        <span className="text-muted-foreground">{fmtDate(n.delivery_date)}</span>
                        <Status map={DN_STATUS} value={n.status} />
                        <span className="text-xs text-muted-foreground">{n.items.length} שורות · {money(n.total_amount)}</span>
                      </button>
                      {n.file_url && (
                        <a href={fileHref(n.file_url)} target="_blank" rel="noreferrer" aria-label={`צילום תעודת משלוח ${n.note_number}`} title="צילום התעודה"
                           className="flex w-11 items-center justify-center rounded-lg border text-muted-foreground hover:bg-accent hover:text-foreground">
                          <Camera className="w-4 h-4" aria-hidden="true" />
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {showHistory && (
              <section aria-labelledby="order-hist-h">
                <h3 id="order-hist-h" className="text-sm font-semibold mb-1">היסטוריית שינויים</h3>
                <ol className="text-xs space-y-1 text-muted-foreground">
                  {[...(order.history || [])].reverse().map((h, i) => (
                    <li key={i} className="flex flex-wrap gap-1">
                      <span className="tabular-nums">{fmtDate(h.at)} {String(h.at).slice(11, 16)}</span>
                      <span className="text-foreground">{h.by}</span>
                      <span>{h.action === "created" ? "יצר/ה" : h.action === "status" ? `סטטוס: ${ORDER_STATUS[h.from]?.label || h.from || "—"} → ${ORDER_STATUS[h.to]?.label || h.to}` : `עדכון${h.fields ? ` (${h.fields.join(", ")})` : ""}`}</span>
                      {h.note && <span>· {h.note}</span>}
                    </li>
                  ))}
                </ol>
              </section>
            )}
          </>
        )}
      </DialogContent>

      {/* אישור ביטול — פעולה שקשה לבטל מקבלת אזהרה, סיבה וכפתור "חזרה" */}
      <Dialog open={cancelAsk} onOpenChange={(v) => { if (!v) setCancelAsk(false); }}>
        <DialogContent className="sm:max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle>לבטל את הזמנה {order?.order_number}?</DialogTitle>
            <DialogDescription>ההזמנה תסומן כבוטלה ותצא מרשימת ההזמנות הפתוחות. אפשר להחזיר אותה לטיוטה בהמשך.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label htmlFor="cancel-note">סיבת הביטול (לא חובה)</Label>
            <Textarea id="cancel-note" rows={2} value={cancelNote} onChange={(e) => setCancelNote(e.target.value)} placeholder="למשל: הספק לא יכול לספק במועד" />
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => setCancelAsk(false)}>חזרה</Button>
            <Button type="button" variant="destructive" disabled={busy} onClick={() => changeStatus("cancelled", cancelNote.trim())}>בטל הזמנה</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}
