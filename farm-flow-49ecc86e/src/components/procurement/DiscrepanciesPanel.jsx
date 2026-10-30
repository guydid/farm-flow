import React, { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, AlertTriangle, Scale, Coins, Receipt, CalendarClock, MessageSquareWarning, CheckCircle2 } from "lucide-react";
import { apiFetch, money, fmtDate, DIRECTIONS } from "./procurementUtils";

const Section = ({ icon: Icon, title, items, render, empty }) => (
  <Card>
    <CardContent className="p-3 space-y-2">
      <h3 className="text-sm font-semibold inline-flex items-center gap-2"><Icon className={`w-4 h-4 ${items.length ? "text-amber-600" : "text-green-600"}`} aria-hidden="true" />{title} <span className="text-xs font-normal text-muted-foreground">({items.length})</span></h3>
      {items.length === 0 ? <p className="text-xs text-muted-foreground inline-flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5 text-green-600" aria-hidden="true" />{empty}</p> : <ul className="space-y-1 text-sm">{items.map(render)}</ul>}
    </CardContent>
  </Card>
);

/** פערים: כמות, מחיר, תעודות בלי חשבונית, הערות פער והזמנות באיחור. */
export default function DiscrepanciesPanel({ farmId, direction, onOpenOrder, onOpenNote, refreshKey }) {
  const [days, setDays] = useState(14);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const qs = new URLSearchParams({ farm_id: farmId, days_without_invoice: String(days) });
      if (direction) qs.set("direction", direction);
      setData(await apiFetch(`/procurement/discrepancies?${qs}`));
    } catch (e) { setError(e.data?.error || e.message); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [farmId, direction, days, refreshKey]);

  const row = (key, onClick, content) => <li key={key}><button type="button" onClick={onClick} className="w-full text-start rounded-md border p-2 min-h-11 hover:bg-accent flex flex-wrap items-center gap-x-2 gap-y-0.5">{content}</button></li>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1"><Label htmlFor="disc-days" className="text-xs">תעודה ללא חשבונית אחרי (ימים)</Label><Input id="disc-days" type="number" min="0" max="365" className="h-9 w-28" value={days} onChange={(e) => setDays(Math.max(0, Number(e.target.value) || 0))} /></div>
        <Button size="sm" variant="outline" onClick={load} disabled={loading}>{loading ? <Loader2 className="w-4 h-4 animate-spin ml-1" aria-hidden="true" /> : <AlertTriangle className="w-4 h-4 ml-1" aria-hidden="true" />} בדוק שוב</Button>
        {data && <span className="text-sm text-muted-foreground">נכון ל-{fmtDate(data.as_of)} · {data.total} פערים</span>}
      </div>
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
      {!data ? <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" aria-label="טוען" /></div> : (
        <div className="grid gap-3 lg:grid-cols-2">
          <Section icon={Scale} title="פערי כמות" items={data.quantity} empty="הכמויות שסופקו תואמות להזמנות"
            render={(q) => row(q.order_item_id, () => onOpenOrder?.(q.order_id), <>
              <span className="font-medium">{q.order_number}</span><span>{q.counterparty_name}</span><span>{q.product_name}</span>
              <span className={`tabular-nums ${q.kind === "over" ? "text-amber-700" : "text-red-700"}`}>{q.kind === "over" ? "סופק יותר" : "חסר"}: {Math.abs(q.diff)} {q.unit}</span>
              <span className="text-xs text-muted-foreground">הוזמן {q.ordered} · סופק {q.delivered}</span>
            </>)} />
          <Section icon={Coins} title="פערי מחיר" items={data.price} empty="המחירים בתעודות תואמים להזמנות ולמחירון"
            render={(p, i) => row(`${p.item_id}-${p.reference}-${i}`, () => onOpenNote?.(p.delivery_note_id), <>
              <span className="font-medium">{p.note_number}</span><span>{p.counterparty_name}</span><span>{p.product_name}</span>
              <span className={`tabular-nums ${p.diff > 0 ? "text-red-700" : "text-green-700"}`}>{money(p.delivered_price)} לעומת {money(p.reference_price)} ({p.diff > 0 ? "+" : ""}{money(p.diff)})</span>
              <span className="text-xs text-muted-foreground">{p.reference === "order" ? "מול ההזמנה" : p.reference === "pesticide_prices" ? "מול מחירון הקנייה" : p.reference === "customer_product_pricing" ? "מול מחירון הלקוח" : "מול המחיר האחרון ללקוח"}</span>
            </>)} />
          <Section icon={Receipt} title={`תעודות ללא חשבונית מעל ${data.days_without_invoice} ימים`} items={data.missing_invoice} empty="לכל התעודות שנקלטו יש חשבונית"
            render={(m) => row(m.delivery_note_id, () => onOpenNote?.(m.delivery_note_id), <>
              <span className="font-medium">{m.note_number}</span><span>{m.counterparty_name}</span><span className="text-muted-foreground">{fmtDate(m.delivery_date)}</span>
              <span className="tabular-nums">{money(m.total_amount)}</span><span className="text-xs text-amber-700">{m.days_since_delivery} ימים</span>
            </>)} />
          <Section icon={CalendarClock} title="הזמנות באיחור" items={data.overdue_orders} empty="אין הזמנות שעבר תאריך האספקה שלהן"
            render={(o) => row(o.order_id, () => onOpenOrder?.(o.order_id), <>
              <span className="font-medium">{o.order_number}</span><span>{o.counterparty_name}</span>
              <span className="text-red-700">צפוי {fmtDate(o.expected_delivery_date)}</span><span className="text-xs text-muted-foreground">סופק {o.fulfillment_pct}%</span>
            </>)} />
          <Section icon={MessageSquareWarning} title="הערות פער בתעודות" items={data.noted} empty="אין הערות פער פתוחות"
            render={(n) => row(n.item_id, () => onOpenNote?.(n.delivery_note_id), <>
              <span className="font-medium">{n.note_number}</span><span>{n.counterparty_name}</span><span>{n.product_name}</span><span className="text-amber-800">{n.note}</span>
            </>)} />
        </div>
      )}
      {direction && <p className="text-xs text-muted-foreground">מוצגים פערי {DIRECTIONS[direction]} בלבד.</p>}
    </div>
  );
}
