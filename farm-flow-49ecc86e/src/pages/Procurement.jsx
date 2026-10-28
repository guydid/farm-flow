import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { getMeCached } from "@/api/cachedReads";
import { batchFetch } from "@/api/localClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { ShoppingCart, Plus, Search, Loader2, FileText, ClipboardList, Truck, AlertTriangle, Receipt, CalendarClock, ArrowDownLeft, ArrowUpRight, Camera } from "lucide-react";
import PageHeader from "@/components/common/PageHeader";
import Invoices from "./Invoices";
import OrderForm from "../components/procurement/OrderForm";
import OrderDetail from "../components/procurement/OrderDetail";
import DeliveryNoteForm from "../components/procurement/DeliveryNoteForm";
import DeliveryNoteDetail from "../components/procurement/DeliveryNoteDetail";
import DiscrepanciesPanel from "../components/procurement/DiscrepanciesPanel";
import { apiFetch, DIRECTIONS, ORDER_STATUS, DN_STATUS, SOURCES, money, fmtDate, daysUntil, fileHref } from "../components/procurement/procurementUtils";

const TABS = [
  { key: "orders", label: "הזמנות", icon: ClipboardList },
  { key: "notes", label: "תעודות משלוח", icon: Truck },
  { key: "discrepancies", label: "פערים", icon: AlertTriangle },
  { key: "invoices", label: "חשבוניות", icon: Receipt },
];
const DIR_TABS = [
  { key: "purchase", label: "רכש", icon: ArrowDownLeft, hint: "הזמנות מספקים ותעודות משלוח נכנסות" },
  { key: "sale", label: "מכירה", icon: ArrowUpRight, hint: "הזמנות לקוחות ותעודות משלוח יוצאות" },
];
const Status = ({ map, value }) => { const s = map[value] || { label: value, cls: "bg-gray-100 text-gray-700" }; return <Badge className={`${s.cls} border-0 whitespace-nowrap`}>{s.label}</Badge>; };

/** עמוד "רכש": הזמנות (רכש / מכירה), תעודות משלוח, פערים, וחשבוניות הספקים הקיימות — תחת קורת גג אחת. */
export default function Procurement() {
  const { toast } = useToast();
  const location = useLocation();
  const navigate = useNavigate();
  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const [tab, setTab] = useState(() => TABS.some((t) => t.key === params.get("tab")) ? params.get("tab") : "orders");
  const [direction, setDirection] = useState(() => params.get("direction") === "sale" ? "sale" : "purchase");
  const [user, setUser] = useState(null);
  const [farmId, setFarmId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [ref, setRef] = useState({ suppliers: [], customers: [], products: [], plots: [], invoices: [] });
  const [orders, setOrders] = useState([]);
  const [notes, setNotes] = useState([]);
  const [openOrders, setOpenOrders] = useState([]);
  const [summary, setSummary] = useState(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("open");
  const [partyFilter, setPartyFilter] = useState("all");
  const [refreshKey, setRefreshKey] = useState(0);
  // dialogs
  const [orderForm, setOrderForm] = useState({ open: false, order: null });
  const [noteForm, setNoteForm] = useState({ open: false, note: null, order: null });
  const [orderDetail, setOrderDetail] = useState(params.get("order") || null);
  const [noteDetail, setNoteDetail] = useState(params.get("note") || null);

  const canWrite = !!user && (user.is_admin || ["owner", "manager", "worker"].includes(user.role));

  const loadData = useCallback(async (fid) => {
    const [suppliers, customers, products, plots, invoices, ords, nts] = await batchFetch([
      { entity: "suppliers", filter: { farm_id: fid } }, { entity: "customers", filter: { farm_id: fid } }, { entity: "products", filter: { farm_id: fid } },
      { entity: "plots", filter: { farm_id: fid } }, { entity: "invoices", filter: { farm_id: fid }, sort: "-date" },
      { entity: "orders", filter: { farm_id: fid }, sort: "-order_date" }, { entity: "delivery_notes", filter: { farm_id: fid }, sort: "-delivery_date" },
    ]);
    setRef({ suppliers, customers, products, plots, invoices });
    setOrders(ords); setNotes(nts);
    const [sum, open] = await Promise.all([
      apiFetch(`/procurement/summary?farm_id=${encodeURIComponent(fid)}`).catch(() => null),
      apiFetch(`/procurement/orders/open?farm_id=${encodeURIComponent(fid)}`).then((r) => r.orders || []).catch(() => []),
    ]);
    setSummary(sum); setOpenOrders(open);
  }, []);

  const refresh = useCallback(async () => { if (farmId) { await loadData(farmId); setRefreshKey((k) => k + 1); } }, [farmId, loadData]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const me = await getMeCached();
        setUser(me);
        if (!me?.current_farm_id) return;
        setFarmId(me.current_farm_id);
        await loadData(me.current_farm_id);
      } catch (e) { toast({ title: "שגיאה בטעינת רכש", description: e.message, variant: "destructive" }); }
      finally { setLoading(false); }
    })();
  }, [loadData, toast]);

  // פתיחה ישירה מה-URL: ?create=order / ?create=note
  useEffect(() => {
    if (!farmId) return;
    if (params.get("create") === "order") setOrderForm({ open: true, order: null });
    if (params.get("create") === "note") setNoteForm({ open: true, note: null, order: null });
  }, [farmId]);

  const changeTab = (k) => { setTab(k); const p = new URLSearchParams(location.search); p.set("tab", k); p.delete("create"); navigate({ search: `?${p}` }, { replace: true }); };

  const partyOptions = direction === "purchase" ? ref.suppliers : ref.customers;
  const partyKey = direction === "purchase" ? "supplier_id" : "customer_id";
  const dnDir = direction === "purchase" ? "in" : "out";
  const q = search.trim().toLowerCase();
  const visibleOrders = useMemo(() => orders
    .filter((o) => o.direction === direction)
    .filter((o) => statusFilter === "all" || (statusFilter === "open" ? ["draft", "ordered", "confirmed", "partially_delivered"].includes(o.status) : o.status === statusFilter))
    .filter((o) => partyFilter === "all" || o[partyKey] === partyFilter)
    .filter((o) => !q || [o.order_number, o.counterparty_name, o.notes, o.contact_person].some((s) => String(s || "").toLowerCase().includes(q)))
    .sort((a, b) => String(b.order_date || "").localeCompare(String(a.order_date || ""))), [orders, direction, statusFilter, partyFilter, partyKey, q]);
  const visibleNotes = useMemo(() => notes
    .filter((n) => n.direction === dnDir)
    .filter((n) => statusFilter === "all" || statusFilter === "open" ? (statusFilter !== "open" || n.status !== "invoiced") : n.status === statusFilter)
    .filter((n) => partyFilter === "all" || n[partyKey] === partyFilter)
    .filter((n) => !q || [n.note_number, n.counterparty_name, n.order_number, n.driver_name, n.vehicle, n.notes].some((s) => String(s || "").toLowerCase().includes(q)))
    .sort((a, b) => String(b.delivery_date || "").localeCompare(String(a.delivery_date || ""))), [notes, dnDir, statusFilter, partyFilter, partyKey, q]);

  const onPartyCreated = (kind, rec) => setRef((r) => kind === "supplier" ? { ...r, suppliers: [...r.suppliers, rec] } : { ...r, customers: [...r.customers, rec] });
  const afterOrderSaved = async (saved) => { toast({ title: orderForm.order ? "ההזמנה עודכנה" : `הזמנה ${saved.order_number} נוצרה` }); await refresh(); if (!orderForm.order) setOrderDetail(saved.id); };
  const afterNoteSaved = async (r) => {
    const n = r.delivery_note;
    const extra = [r.stock_movements?.length ? `${r.stock_movements.length} שורות נכנסו למלאי` : null, r.linked_weighing_certificates?.length ? `${r.linked_weighing_certificates.length} תעודות שקילה קושרו` : null, ...(r.warnings || [])].filter(Boolean).join(" · ");
    toast({ title: noteForm.note ? "התעודה עודכנה" : `תעודת משלוח ${n.note_number} נקלטה`, description: extra || undefined });
    await refresh();
    if (!noteForm.note) setNoteDetail(n.id);
  };

  if (loading) return <div className="flex justify-center items-center h-64"><Loader2 className="w-8 h-8 animate-spin text-primary" aria-label="טוען" /></div>;
  if (!farmId) return <div className="p-6 text-center text-muted-foreground">בחר משק פעיל כדי לנהל רכש.</div>;

  const statusOptions = tab === "notes" ? DN_STATUS : ORDER_STATUS;
  const kpis = summary && direction === "purchase" ? [
    { label: "הזמנות פתוחות", value: summary.open_orders.purchase, sub: money(summary.open_orders.purchase_total) },
    { label: "אספקות היום / מחר", value: `${summary.expected_today} / ${summary.expected_tomorrow}`, icon: CalendarClock },
    { label: "תעודות ללא חשבונית", value: summary.delivery_notes.without_invoice, warn: summary.delivery_notes.without_invoice > 0 },
    { label: "פערים", value: summary.discrepancies.total, warn: summary.discrepancies.total > 0 },
  ] : summary ? [
    { label: "הזמנות מכירה פתוחות", value: summary.open_orders.sale, sub: money(summary.open_orders.sale_total) },
    { label: "משלוחים היום / מחר", value: `${summary.expected_today} / ${summary.expected_tomorrow}`, icon: CalendarClock },
    { label: "באיחור", value: summary.open_orders.overdue, warn: summary.open_orders.overdue > 0 },
    { label: "פערים", value: summary.discrepancies.total, warn: summary.discrepancies.total > 0 },
  ] : [];

  return (
    <div className="p-3 sm:p-6 space-y-4" dir="rtl">
      {/* לשוניות ראשיות — גם מעל עמוד החשבוניות המוטמע */}
      <nav aria-label="אזורי רכש" className="flex gap-1 overflow-x-auto rounded-xl border bg-card p-1">
        {TABS.map((t) => (
          <button key={t.key} type="button" onClick={() => changeTab(t.key)} aria-current={tab === t.key ? "page" : undefined}
                  className={`flex-1 min-w-max inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition ${tab === t.key ? "bg-primary text-primary-foreground" : "hover:bg-accent text-muted-foreground"}`}>
            <t.icon className="w-4 h-4" aria-hidden="true" />{t.label}
            {t.key === "discrepancies" && summary?.discrepancies.total > 0 && <span className={`text-[10px] rounded-full px-1.5 ${tab === t.key ? "bg-white/20" : "bg-amber-100 text-amber-800"}`}>{summary.discrepancies.total}</span>}
          </button>
        ))}
      </nav>

      {tab === "invoices" ? <Invoices /> : (
        <>
          <PageHeader icon={ShoppingCart} title="רכש" subtitle="הזמנות, תעודות משלוח ופערים — רכש מספקים ומכירה ללקוחות" className="mb-0"
            actions={canWrite && <>
              <Button variant="outline" onClick={() => setNoteForm({ open: true, note: null, order: null })}><Camera className="w-4 h-4 ml-1" aria-hidden="true" /> קלוט תעודת משלוח</Button>
              <Button onClick={() => setOrderForm({ open: true, order: null })}><Plus className="w-4 h-4 ml-1" aria-hidden="true" /> הזמנה חדשה</Button>
            </>} />

          <div className="grid grid-cols-2 gap-2">
            {DIR_TABS.map((t) => (
              <button key={t.key} type="button" onClick={() => { setDirection(t.key); setPartyFilter("all"); }} aria-pressed={direction === t.key}
                      className={`rounded-xl border p-3 text-right transition ${direction === t.key ? "border-primary bg-primary/10" : "bg-card hover:bg-accent"}`}>
                <div className="flex items-center gap-2 font-semibold text-sm"><t.icon className={`w-4 h-4 ${t.key === "purchase" ? "text-rose-500" : "text-emerald-600"}`} aria-hidden="true" />{t.label}
                  <span className="text-xs font-normal text-muted-foreground">({orders.filter((o) => o.direction === t.key && ["draft", "ordered", "confirmed", "partially_delivered"].includes(o.status)).length} פתוחות)</span></div>
                <div className="text-[11px] text-muted-foreground mt-0.5 hidden sm:block">{t.hint}</div>
              </button>
            ))}
          </div>

          {kpis.length > 0 && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
              {kpis.map((k) => (
                <Card key={k.label} className={k.warn ? "border-amber-200 bg-amber-50/60" : ""}><CardContent className="p-3">
                  <div className="text-[11px] text-muted-foreground">{k.label}</div>
                  <div className={`text-lg font-bold tabular-nums ${k.warn ? "text-amber-800" : ""}`}>{k.value}</div>
                  {k.sub && <div className="text-[11px] text-muted-foreground">{k.sub}</div>}
                </CardContent></Card>
              ))}
            </div>
          )}

          {tab === "discrepancies" ? (
            <DiscrepanciesPanel farmId={farmId} direction={direction} refreshKey={refreshKey} onOpenOrder={setOrderDetail} onOpenNote={setNoteDetail} />
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                <div className="relative flex-1 min-w-[12rem]">
                  <Search className="absolute right-2.5 top-2.5 w-4 h-4 text-muted-foreground" aria-hidden="true" />
                  <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tab === "orders" ? "חיפוש הזמנה, ספק/לקוח…" : "חיפוש תעודה, נהג, רכב…"} className="pr-9" aria-label="חיפוש" />
                </div>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-40" aria-label="סינון סטטוס"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="open">{tab === "orders" ? "פתוחות" : "לא חויבו"}</SelectItem>
                    <SelectItem value="all">הכול</SelectItem>
                    {Object.entries(statusOptions).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={partyFilter} onValueChange={setPartyFilter}>
                  <SelectTrigger className="w-44" aria-label={direction === "purchase" ? "סינון ספק" : "סינון לקוח"}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{direction === "purchase" ? "כל הספקים" : "כל הלקוחות"}</SelectItem>
                    {partyOptions.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              {tab === "orders" && (
                <ul className="space-y-2">
                  {visibleOrders.length === 0 && <li className="text-center text-muted-foreground py-10 text-sm">אין הזמנות {DIRECTIONS[direction]} להצגה.{canWrite && " לחץ \"הזמנה חדשה\" כדי להתחיל."}</li>}
                  {visibleOrders.map((o) => {
                    const open = openOrders.find((x) => x.id === o.id);
                    const d = o.expected_delivery_date ? daysUntil(o.expected_delivery_date) : null;
                    const overdue = open?.overdue;
                    return (
                      <li key={o.id}>
                        <button type="button" onClick={() => setOrderDetail(o.id)} className="w-full text-right rounded-xl border bg-card p-3 hover:bg-accent/60 transition">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold">{o.order_number}</span>
                            <span className="text-sm">{o.counterparty_name}</span>
                            <Status map={ORDER_STATUS} value={o.status} />
                            {o.source && o.source !== "app" && <Badge variant="outline" className="text-[10px]">{SOURCES[o.source] || o.source}</Badge>}
                            <span className="ms-auto font-semibold tabular-nums">{money(o.total_amount)}</span>
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                            <span>הוזמן {fmtDate(o.order_date)}</span>
                            {o.expected_delivery_date && <span className={overdue ? "text-red-700 font-medium" : d === 0 ? "text-amber-700 font-medium" : ""}>אספקה {fmtDate(o.expected_delivery_date)}{overdue ? ` · באיחור ${-d} ימים` : d === 0 ? " · היום" : d === 1 ? " · מחר" : ""}</span>}
                            {open && <span>{open.items_count} שורות · סופק {open.fulfillment_pct}%</span>}
                            {o.notes && <span className="truncate max-w-[20rem]">{o.notes}</span>}
                          </div>
                          {open && open.fulfillment_pct > 0 && open.fulfillment_pct < 100 && <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden"><div className="h-full bg-amber-500" style={{ width: `${open.fulfillment_pct}%` }} /></div>}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}

              {tab === "notes" && (
                <ul className="space-y-2">
                  {visibleNotes.length === 0 && <li className="text-center text-muted-foreground py-10 text-sm">אין תעודות משלוח {dnDir === "in" ? "נכנסות" : "יוצאות"} להצגה.{canWrite && " לחץ \"קלוט תעודת משלוח\" כדי לצלם ולקלוט תעודה."}</li>}
                  {visibleNotes.map((n) => (
                    <li key={n.id}>
                      <button type="button" onClick={() => setNoteDetail(n.id)} className="w-full text-right rounded-xl border bg-card p-3 hover:bg-accent/60 transition">
                        <div className="flex flex-wrap items-center gap-2">
                          <FileText className="w-4 h-4 text-primary" aria-hidden="true" />
                          <span className="font-semibold">{n.note_number}</span>
                          <span className="text-sm">{n.counterparty_name}</span>
                          <Status map={DN_STATUS} value={n.status} />
                          {n.order_number && <Badge variant="outline" className="text-[10px]">הזמנה {n.order_number}</Badge>}
                          {n.file_url && <a href={fileHref(n.file_url)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-[11px] text-primary underline inline-flex items-center gap-1"><Camera className="w-3 h-3" aria-hidden="true" /> צילום</a>}
                          <span className="ms-auto font-semibold tabular-nums">{money(n.total_amount)}</span>
                        </div>
                        <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                          <span>{fmtDate(n.delivery_date)}</span>
                          {n.driver_name && <span>נהג {n.driver_name}</span>}
                          {n.vehicle && <span>{n.vehicle}</span>}
                          {n.invoice_id ? <span className="text-emerald-700">מקושרת לחשבונית</span> : n.direction === "in" && n.status !== "expected" && <span className="text-amber-700">ללא חשבונית</span>}
                          {(n.weighing_certificate_ids || []).length > 0 && <span>{n.weighing_certificate_ids.length} תעודות שקילה</span>}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </>
      )}

      <OrderForm open={orderForm.open} onOpenChange={(v) => setOrderForm((s) => ({ ...s, open: v }))} farmId={farmId} order={orderForm.order} direction={direction}
                 suppliers={ref.suppliers} customers={ref.customers} products={ref.products} plots={ref.plots} onSaved={afterOrderSaved} onPartyCreated={onPartyCreated} />
      <DeliveryNoteForm open={noteForm.open} onOpenChange={(v) => setNoteForm((s) => ({ ...s, open: v }))} farmId={farmId} note={noteForm.note} order={noteForm.order} direction={dnDir}
                        openOrders={openOrders} suppliers={ref.suppliers} customers={ref.customers} products={ref.products} invoices={ref.invoices} onSaved={afterNoteSaved} onPartyCreated={onPartyCreated} />
      <OrderDetail open={!!orderDetail} onClose={() => setOrderDetail(null)} orderId={orderDetail} farmId={farmId} canWrite={canWrite} plots={ref.plots}
                   onEdit={(o) => setOrderForm({ open: true, order: o })}
                   onReceive={(o) => setNoteForm({ open: true, note: null, order: { ...o, items: (openOrders.find((x) => x.id === o.id)?.items) || o.items.map((it) => ({ ...it, remaining: Number(it.quantity) - Number(it.delivered_quantity || 0) })) } })}
                   onOpenNote={(n) => setNoteDetail(n.id)} onChanged={refresh} />
      <DeliveryNoteDetail open={!!noteDetail} onClose={() => setNoteDetail(null)} noteId={noteDetail} farmId={farmId} canWrite={canWrite} invoices={ref.invoices}
                          onEdit={(n) => setNoteForm({ open: true, note: n, order: null })} onOpenOrder={(id) => { setNoteDetail(null); setOrderDetail(id); }} onChanged={refresh} />
    </div>
  );
}
