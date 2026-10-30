import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { getMeCached } from "@/api/cachedReads";
import { batchFetch } from "@/api/localClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { ShoppingCart, Plus, Search, Loader2, FileText, ClipboardList, Truck, AlertTriangle, Receipt, ArrowDownLeft, ArrowUpRight, Camera, ChevronLeft } from "lucide-react";
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
  { key: "notes", label: "תעודות משלוח", shortLabel: "תעודות", icon: Truck },
  { key: "discrepancies", label: "פערים", icon: AlertTriangle },
  { key: "invoices", label: "חשבוניות", icon: Receipt },
];
const DIR_TABS = [
  { key: "purchase", label: "רכש", icon: ArrowDownLeft, hint: "הזמנות מספקים ותעודות משלוח נכנסות" },
  { key: "sale", label: "מכירה", icon: ArrowUpRight, hint: "הזמנות ללקוחות ותעודות משלוח יוצאות" },
];
const OPEN_STATUSES = ["draft", "ordered", "confirmed", "partially_delivered"];
const Status = ({ map, value }) => { const s = map[value] || { label: value, cls: "bg-muted text-muted-foreground" }; return <Badge className={`${s.cls} border-0 whitespace-nowrap font-medium`}>{s.label}</Badge>; };

/**
 * פקד מקטעים (segmented control) — אפור שקט עם הבחירה כ"כרטיס" לבן, כמו ב-iOS.
 * הצבע הראשי נשמר לפעולה הראשית בעמוד בלבד.
 */
function Segmented({ items, value, onChange, label, size = "md", className = "" }) {
  const refs = useRef([]);
  const onKey = (e, idx) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    // RTL: חץ שמאלה מתקדם ברשימה
    const dir = e.key === "ArrowLeft" ? 1 : e.key === "ArrowRight" ? -1 : 0;
    const next = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : (idx + dir + items.length) % items.length;
    onChange(items[next].key); refs.current[next]?.focus();
  };
  const h = size === "sm" ? "min-h-9" : "min-h-10";
  return (
    <div role="tablist" aria-label={label} className={`inline-flex w-full gap-1 rounded-xl bg-muted p-1 ${className}`}>
      {items.map((t, idx) => {
        const on = value === t.key;
        return (
          <button key={t.key} ref={(el) => (refs.current[idx] = el)} type="button" role="tab" aria-selected={on} tabIndex={on ? 0 : -1}
                  id={`tab-${t.key}`} aria-controls={`panel-${t.key}`} title={t.hint} onClick={() => onChange(t.key)} onKeyDown={(e) => onKey(e, idx)}
                  className={`flex-1 ${h} inline-flex items-center justify-center gap-1.5 rounded-lg px-2 sm:px-3 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring ${on ? "bg-background text-foreground font-semibold shadow-sm" : "text-muted-foreground hover:text-foreground font-medium"}`}>
            {t.icon && <t.icon className="w-4 h-4 shrink-0" aria-hidden="true" />}
            <span className={t.shortLabel ? "hidden sm:inline" : ""}>{t.label}</span>
            {t.shortLabel && <span className="sm:hidden">{t.shortLabel}</span>}
            {t.badge > 0 && <span className="text-xs tabular-nums rounded-full px-1.5 leading-5 bg-warning/20 text-warning-foreground" aria-label={`${t.badge} פערים`}>{t.badge}</span>}
            {t.count !== undefined && <span className="text-xs tabular-nums text-muted-foreground font-normal">{t.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** מצב ריק עם הצעד הבא כפעולה אמיתית, לא כהוראה. */
function EmptyState({ icon: Icon, title, hint, action }) {
  return (
    <li className="rounded-xl border border-dashed bg-card/50 px-4 py-10 text-center">
      <Icon className="w-8 h-8 mx-auto text-muted-foreground/60" aria-hidden="true" />
      <p className="mt-2 font-medium">{title}</p>
      {hint && <p className="text-sm text-muted-foreground mt-0.5 max-w-md mx-auto">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </li>
  );
}

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
      } catch (e) { toast({ title: "לא ניתן לטעון את נתוני הרכש", description: e.message, variant: "destructive" }); }
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
  const changeDirection = (k) => { setDirection(k); setPartyFilter("all"); const p = new URLSearchParams(location.search); p.set("direction", k); navigate({ search: `?${p}` }, { replace: true }); };

  const partyOptions = direction === "purchase" ? ref.suppliers : ref.customers;
  const partyKey = direction === "purchase" ? "supplier_id" : "customer_id";
  const dnDir = direction === "purchase" ? "in" : "out";
  const q = search.trim().toLowerCase();
  const openCount = (dir) => orders.filter((o) => o.direction === dir && OPEN_STATUSES.includes(o.status)).length;
  const visibleOrders = useMemo(() => orders
    .filter((o) => o.direction === direction)
    .filter((o) => statusFilter === "all" || (statusFilter === "open" ? OPEN_STATUSES.includes(o.status) : o.status === statusFilter))
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
  const newOrder = () => setOrderForm({ open: true, order: null });
  const newNote = () => setNoteForm({ open: true, note: null, order: null });

  if (loading) return <div className="flex justify-center items-center h-64"><Loader2 className="w-8 h-8 animate-spin text-primary" aria-label="טוען" /></div>;
  if (!farmId) return <div className="p-6 text-center text-muted-foreground">בחר משק פעיל כדי לנהל רכש.</div>;

  const statusOptions = tab === "notes" ? DN_STATUS : ORDER_STATUS;
  const tabItems = TABS.map((t) => t.key === "discrepancies" ? { ...t, badge: summary?.discrepancies.total || 0 } : t);
  const dirItems = DIR_TABS.map((t) => ({ ...t, count: openCount(t.key) }));
  const kpis = summary && direction === "purchase" ? [
    { label: "הזמנות פתוחות", value: summary.open_orders.purchase, sub: money(summary.open_orders.purchase_total) },
    { label: "אספקות היום / מחר", value: `${summary.expected_today} / ${summary.expected_tomorrow}` },
    { label: "תעודות ללא חשבונית", value: summary.delivery_notes.without_invoice, warn: summary.delivery_notes.without_invoice > 0 },
    { label: "פערים", value: summary.discrepancies.total, warn: summary.discrepancies.total > 0, onClick: () => changeTab("discrepancies") },
  ] : summary ? [
    { label: "הזמנות מכירה פתוחות", value: summary.open_orders.sale, sub: money(summary.open_orders.sale_total) },
    { label: "משלוחים היום / מחר", value: `${summary.expected_today} / ${summary.expected_tomorrow}` },
    { label: "באיחור", value: summary.open_orders.overdue, warn: summary.open_orders.overdue > 0 },
    { label: "פערים", value: summary.discrepancies.total, warn: summary.discrepancies.total > 0, onClick: () => changeTab("discrepancies") },
  ] : [];
  const subtitle = tab === "invoices" ? "חשבוניות הספקים, סריקה וסנכרון מהמייל" : DIR_TABS.find((d) => d.key === direction)?.hint;

  return (
    <div className="p-3 sm:p-6 space-y-4" dir="rtl">
      <PageHeader icon={ShoppingCart} title="רכש" subtitle={subtitle} compact className="mb-0"
        actions={canWrite && tab !== "invoices" && <>
          <Button variant="outline" onClick={newNote}><Camera className="w-4 h-4 ml-1" aria-hidden="true" /> <span className="hidden sm:inline">קלוט </span>תעודת משלוח</Button>
          <Button onClick={newOrder}><Plus className="w-4 h-4 ml-1" aria-hidden="true" /> הזמנה חדשה</Button>
        </>}>
        <Segmented items={tabItems} value={tab} onChange={changeTab} label="אזורי רכש" className="mt-3" />
      </PageHeader>

      {tab === "invoices" ? (
        <div role="tabpanel" id="panel-invoices" aria-labelledby="tab-invoices"><Invoices embedded /></div>
      ) : (
        <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="space-y-4">
          {/* רכש / מכירה + סינון — שורה אחת במסך רחב, רשת בנייד */}
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
            <Segmented items={dirItems} value={direction} onChange={changeDirection} label="רכש או מכירה" size="sm" className="col-span-2 sm:w-auto sm:min-w-[14rem]" />
            {tab !== "discrepancies" && (
              <>
                <div className="relative col-span-2 sm:flex-1 sm:min-w-[12rem]">
                  <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
                  <Input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tab === "orders" ? "חיפוש הזמנה, ספק או לקוח" : "חיפוש תעודה, נהג או רכב"} className="pr-9" aria-label={tab === "orders" ? "חיפוש בהזמנות" : "חיפוש בתעודות משלוח"} />
                </div>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="sm:w-40" aria-label="סינון לפי סטטוס"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="open">{tab === "orders" ? "פתוחות" : "טרם חויבו"}</SelectItem>
                    <SelectItem value="all">הכול</SelectItem>
                    {Object.entries(statusOptions).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={partyFilter} onValueChange={setPartyFilter}>
                  <SelectTrigger className="sm:w-44" aria-label={direction === "purchase" ? "סינון לפי ספק" : "סינון לפי לקוח"}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{direction === "purchase" ? "כל הספקים" : "כל הלקוחות"}</SelectItem>
                    {partyOptions.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </>
            )}
          </div>

          {kpis.length > 0 && (
            <dl className="grid grid-cols-2 lg:grid-cols-4 gap-2">
              {kpis.map((k) => {
                const Tag = k.onClick ? "button" : "div";
                return (
                  <Tag key={k.label} type={k.onClick ? "button" : undefined} onClick={k.onClick}
                       className={`rounded-xl border bg-card px-3 py-2.5 text-start min-w-0 ${k.warn ? "border-warning/40" : ""} ${k.onClick ? "hover:bg-accent/60 transition-colors focus-visible:ring-2 focus-visible:ring-ring" : ""}`}>
                    <dt className="text-xs text-muted-foreground flex items-center gap-1 truncate">
                      {k.warn && <AlertTriangle className="w-3.5 h-3.5 text-warning shrink-0" aria-hidden="true" />}{k.label}
                    </dt>
                    <dd className="mt-0.5 flex items-baseline gap-2">
                      <span className="text-lg font-semibold tabular-nums leading-tight">{k.value}</span>
                      {k.sub && <span className="text-xs text-muted-foreground tabular-nums truncate">{k.sub}</span>}
                      {k.onClick && <ChevronLeft className="w-3.5 h-3.5 text-muted-foreground ms-auto" aria-hidden="true" />}
                    </dd>
                  </Tag>
                );
              })}
            </dl>
          )}

          {tab === "discrepancies" && (
            <DiscrepanciesPanel farmId={farmId} direction={direction} refreshKey={refreshKey} onOpenOrder={setOrderDetail} onOpenNote={setNoteDetail} />
          )}

          {tab === "orders" && (
            <ul className="space-y-2" aria-label={`הזמנות ${DIRECTIONS[direction]}`}>
              {visibleOrders.length === 0 && (
                <EmptyState icon={ClipboardList} title={`אין הזמנות ${DIRECTIONS[direction]}${statusFilter === "open" ? " פתוחות" : ""}`}
                  hint={q || partyFilter !== "all" ? "נסה לשנות את החיפוש או הסינון." : direction === "purchase" ? "הזמנה מתעדת מה הוזמן מהספק, וכל תעודת משלוח שתיקלט תעדכן את מצב האספקה." : "הזמנת מכירה מתעדת מה הלקוח ביקש; תעודות המשלוח היוצאות ותעודות השקילה יתקשרו אליה."}
                  action={canWrite && !q && partyFilter === "all" && <Button onClick={newOrder}><Plus className="w-4 h-4 ml-1" aria-hidden="true" /> הזמנה חדשה</Button>} />
              )}
              {visibleOrders.map((o) => {
                const open = openOrders.find((x) => x.id === o.id);
                const d = o.expected_delivery_date ? daysUntil(o.expected_delivery_date) : null;
                const overdue = open?.overdue;
                return (
                  <li key={o.id}>
                    <button type="button" onClick={() => setOrderDetail(o.id)} className="w-full text-start rounded-xl border bg-card p-3 hover:bg-accent/60 active:bg-accent transition-colors focus-visible:ring-2 focus-visible:ring-ring">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="font-semibold tabular-nums">{o.order_number}</span>
                        <span className="text-sm truncate max-w-[14rem]">{o.counterparty_name}</span>
                        <Status map={ORDER_STATUS} value={o.status} />
                        {o.source && o.source !== "app" && <Badge variant="outline" className="text-xs font-normal">{SOURCES[o.source] || o.source}</Badge>}
                        <span className="ms-auto font-semibold tabular-nums">{money(o.total_amount)}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span>הוזמן {fmtDate(o.order_date)}</span>
                        {o.expected_delivery_date && (
                          <span className={overdue ? "text-destructive font-medium inline-flex items-center gap-1" : d === 0 ? "text-warning-foreground font-medium" : ""}>
                            {overdue && <AlertTriangle className="w-3 h-3" aria-hidden="true" />}
                            אספקה {fmtDate(o.expected_delivery_date)}{overdue ? ` · באיחור ${-d} ימים` : d === 0 ? " · היום" : d === 1 ? " · מחר" : ""}
                          </span>
                        )}
                        {open && <span>{open.items_count} שורות · סופק {open.fulfillment_pct}%</span>}
                        {o.notes && <span className="truncate max-w-[20rem]">{o.notes}</span>}
                      </div>
                      {open && open.fulfillment_pct > 0 && open.fulfillment_pct < 100 && (
                        <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden" role="progressbar" aria-valuenow={open.fulfillment_pct} aria-valuemin={0} aria-valuemax={100} aria-label="התקדמות האספקה">
                          <div className="h-full bg-warning" style={{ width: `${open.fulfillment_pct}%` }} />
                        </div>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {tab === "notes" && (
            <ul className="space-y-2" aria-label={`תעודות משלוח ${dnDir === "in" ? "נכנסות" : "יוצאות"}`}>
              {visibleNotes.length === 0 && (
                <EmptyState icon={Truck} title={`אין תעודות משלוח ${dnDir === "in" ? "נכנסות" : "יוצאות"}${statusFilter === "open" ? " שטרם חויבו" : ""}`}
                  hint={q || partyFilter !== "all" ? "נסה לשנות את החיפוש או הסינון." : dnDir === "in" ? "צלם את התעודה שהגיעה עם הסחורה; השורות שלה יעדכנו את ההזמנה והמלאי." : "תעודה יוצאת מתעדת סחורה שנמסרה ללקוח ומתקשרת לתעודות השקילה של אותו יום."}
                  action={canWrite && !q && partyFilter === "all" && <Button onClick={newNote}><Camera className="w-4 h-4 ml-1" aria-hidden="true" /> קלוט תעודת משלוח</Button>} />
              )}
              {visibleNotes.map((n) => (
                <li key={n.id} className="flex items-stretch gap-1">
                  <button type="button" onClick={() => setNoteDetail(n.id)} className="flex-1 min-w-0 text-start rounded-xl border bg-card p-3 hover:bg-accent/60 active:bg-accent transition-colors focus-visible:ring-2 focus-visible:ring-ring">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <FileText className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden="true" />
                      <span className="font-semibold tabular-nums">{n.note_number}</span>
                      <span className="text-sm truncate max-w-[14rem]">{n.counterparty_name}</span>
                      <Status map={DN_STATUS} value={n.status} />
                      {n.order_number && <Badge variant="outline" className="text-xs font-normal tabular-nums">הזמנה {n.order_number}</Badge>}
                      <span className="ms-auto font-semibold tabular-nums">{money(n.total_amount)}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span>{fmtDate(n.delivery_date)}</span>
                      {n.driver_name && <span>נהג {n.driver_name}</span>}
                      {n.vehicle && <span className="tabular-nums">{n.vehicle}</span>}
                      {n.invoice_id ? <span className="text-success">מקושרת לחשבונית</span> : n.direction === "in" && n.status !== "expected" && <span className="text-warning-foreground">ללא חשבונית</span>}
                      {(n.weighing_certificate_ids || []).length > 0 && <span>{n.weighing_certificate_ids.length} תעודות שקילה</span>}
                      {(n.maven_documents || []).some((d) => !d.test) && <span className="text-success">הופק ב-Maven</span>}
                    </div>
                  </button>
                  {/* הצילום כיעד הקשה נפרד (לא בתוך הכפתור), ברוחב אצבע */}
                  {n.file_url && (
                    <a href={fileHref(n.file_url)} target="_blank" rel="noreferrer" aria-label={`צילום תעודת משלוח ${n.note_number}`} title="צילום התעודה"
                       className="flex w-11 items-center justify-center rounded-xl border bg-card text-muted-foreground hover:bg-accent hover:text-foreground transition-colors focus-visible:ring-2 focus-visible:ring-ring">
                      <Camera className="w-4 h-4" aria-hidden="true" />
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
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
