import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { Search, Loader2, ShoppingCart, ClipboardCheck, History, Trash2, AlertTriangle, Package, Plus } from 'lucide-react';
import { createPageUrl } from '@/utils';
import { apiFetch, BASE_URL } from '@/api/localClient';
import { PesticideStock } from '@/entities/all';
import { parseDosage } from './pestConstants';
import PriceEditor from './PriceEditor';
import { savePesticidePrice } from '@/api/pesticidePrices';

const fmtDate = (d) => { try { return format(parseISO(d), 'dd/MM/yy'); } catch { return d || ''; } };
const UNITS = ['ליטר', 'מ"ל', 'ק"ג', 'גרם', "יח'"];
const STOCK_STATUS = {
  ok:  { label: 'במלאי', cls: 'bg-emerald-100 text-emerald-700', num: 'text-gray-900' },
  low: { label: 'מלאי נמוך', cls: 'bg-amber-100 text-amber-800', num: 'text-amber-700' },
  out: { label: 'אזל', cls: 'bg-red-100 text-red-700', num: 'text-red-600' },
};
const MOVE_TYPES = {
  purchase:   { label: 'קנייה', icon: ShoppingCart, hint: 'הכמות שהתקבלה — מתווספת למלאי' },
  count:      { label: 'ספירת מלאי', icon: ClipboardCheck, hint: 'הכמות שנספרה בפועל — קובעת את היתרה מתאריך זה' },
  adjustment: { label: 'תיקון', icon: Plus, hint: 'פחת, החזרה לספק, העברה — מספר שלילי מוריד מהמלאי' },
};
const EVENT_LABEL = { purchase: 'קנייה', count: 'ספירה', adjustment: 'תיקון', usage: 'הדברה' };

export function fetchStock(params = '') {
  return apiFetch(`${BASE_URL}/pesticide-stock${params}`);
}

// טאב "מלאי חומרים": היתרה מחושבת בשרת — ספירות + קניות − הכמויות שנרשמו בהדברות,
// כך שכל הדברה שנשמרת (גם מביצוע המלצה) מורידה מהמלאי אוטומטית.
export default function StockTab({ stock, loading, pesticides, me, onChanged }) {
  const [search, setSearch] = useState('');
  const [moving, setMoving] = useState(null); // { type, product? }
  const [historyOf, setHistoryOf] = useState(null);

  const q = search.trim().toLowerCase();
  const list = useMemo(() => stock
    .filter(p => !q || p.product_name.toLowerCase().includes(q))
    .sort((a, b) => ({ out: 0, low: 1, ok: 2 }[a.status] - { out: 0, low: 1, ok: 2 }[b.status]) || a.product_name.localeCompare(b.product_name, 'he')),
  [stock, q]);
  const alerts = stock.filter(p => p.status !== 'ok').length;

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="חיפוש תכשיר במלאי" className="pr-9 bg-white" />
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setMoving({ type: 'count' })} className="flex-1 sm:flex-none bg-white">
            <ClipboardCheck className="w-4 h-4 ml-1" /> ספירת מלאי
          </Button>
          <Button onClick={() => setMoving({ type: 'purchase' })} className="flex-1 sm:flex-none bg-emerald-600 hover:bg-emerald-700">
            <ShoppingCart className="w-4 h-4 ml-1" /> קנייה
          </Button>
        </div>
      </div>

      {alerts > 0 && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-amber-50 border border-amber-200 text-sm text-amber-800">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          {alerts} תכשירים אזלו או במלאי נמוך
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-7 h-7 animate-spin text-emerald-600" /></div>
      ) : !stock.length ? (
        <Card><CardContent className="p-8 text-center text-gray-500 space-y-2">
          <Package className="w-10 h-10 mx-auto text-gray-300" />
          <p>עדיין לא מנוהל מלאי.</p>
          <p className="text-sm">התחל ב"ספירת מלאי" לכל תכשיר שיש במחסן — מאותו רגע כל הדברה שנרשמת מורידה מהמלאי אוטומטית.</p>
        </CardContent></Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {list.map(p => {
            const st = STOCK_STATUS[p.status] || STOCK_STATUS.ok;
            return (
              <Card key={p.key} className="overflow-hidden">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-semibold text-gray-900 truncate">{p.product_name}</div>
                      <span className={`inline-block mt-1 text-xs px-2 py-0.5 rounded-full ${st.cls}`}>{st.label}</span>
                    </div>
                    <div className="text-left flex-shrink-0">
                      <div className={`text-2xl font-bold ${st.num}`} dir="ltr">{p.balance}</div>
                      <div className="text-xs text-gray-500">{p.unit}</div>
                    </div>
                  </div>
                  <div className="text-xs text-gray-500 space-y-0.5">
                    <div>שימוש ב-30 יום: {p.used_last_30d.qty} {p.used_last_30d.unit}</div>
                    {p.last_count && <div>ספירה אחרונה: {fmtDate(p.last_count.date)} ({p.last_count.qty} {p.last_count.unit})</div>}
                    {p.last_purchase && <div>קנייה אחרונה: {fmtDate(p.last_purchase.date)}{p.last_purchase.supplier ? ` · ${p.last_purchase.supplier}` : ''}</div>}
                    <div className="flex items-center gap-1.5 flex-wrap">
                      מחיר קנייה:
                      <PriceEditor productName={p.product_name} pesticideId={p.pesticide_id} price={p.purchase_price}
                                   defaultUnit={p.base_unit === 'g' ? 'ק"ג' : 'ליטר'} compact onSaved={onChanged} />
                      {p.stock_value != null && <span className="text-gray-400">· שווי מלאי ₪{Math.round(p.stock_value).toLocaleString('he-IL')}</span>}
                    </div>
                    {p.warnings.map(w => <div key={w} className="text-amber-700">⚠ {w}</div>)}
                  </div>
                  <div className="flex gap-1.5">
                    <Button size="sm" variant="outline" className="flex-1" onClick={() => setMoving({ type: 'purchase', product: p })}>
                      <ShoppingCart className="w-3.5 h-3.5 ml-1" /> קנייה
                    </Button>
                    <Button size="sm" variant="outline" className="flex-1" onClick={() => setMoving({ type: 'count', product: p })}>
                      <ClipboardCheck className="w-3.5 h-3.5 ml-1" /> ספירה
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setHistoryOf(p)} aria-label="היסטוריה">
                      <History className="w-4 h-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
          {!list.length && <p className="text-sm text-gray-500 col-span-full text-center py-6">לא נמצא תכשיר</p>}
        </div>
      )}

      {moving && (
        <MovementDialog init={moving} pesticides={pesticides} stock={stock} me={me}
                        onClose={() => setMoving(null)} onSaved={() => { setMoving(null); onChanged(); }} />
      )}
      {historyOf && (
        <HistoryDialog product={historyOf} onClose={() => setHistoryOf(null)}
                       onChanged={onChanged} onAdjust={() => { setMoving({ type: 'adjustment', product: historyOf }); setHistoryOf(null); }} />
      )}
    </div>
  );
}

function MovementDialog({ init, pesticides, stock, me, onClose, onSaved }) {
  const { toast } = useToast();
  const [type, setType] = useState(init.type);
  const [product, setProduct] = useState(init.product ? { name: init.product.product_name, pesticide_id: init.product.pesticide_id } : null);
  const [search, setSearch] = useState('');
  const [quantity, setQuantity] = useState('');
  // קנייה/ספירה בדרך כלל ביחידות גדולות — גם אם היתרה מוצגת כרגע בגרם/מ"ל
  const bigUnit = (s) => (s?.base_unit === 'g' ? 'ק"ג' : s?.base_unit === 'ml' ? 'ליטר' : s?.unit);
  const [unit, setUnit] = useState(bigUnit(init.product) || 'ליטר');
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [supplier, setSupplier] = useState('');
  const [cost, setCost] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // מוצרים לבחירה: מה שכבר במלאי + הקטלוג (שורה אחת לכל תכשיר)
  const options = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return stock.slice(0, 8).map(s => ({ name: s.product_name, pesticide_id: s.pesticide_id, sub: `במלאי: ${s.balance} ${s.unit}` }));
    const seen = new Set();
    const out = [];
    for (const s of stock) if (s.product_name.toLowerCase().includes(q)) { seen.add(s.key); out.push({ name: s.product_name, pesticide_id: s.pesticide_id, sub: `במלאי: ${s.balance} ${s.unit}` }); }
    for (const p of pesticides) {
      const key = String(p.product_name || '').trim().replace(/\s+/g, ' ').toLowerCase();
      if (!key || seen.has(key) || !(key.includes(q) || String(p.active_ingredients || '').toLowerCase().includes(q))) continue;
      seen.add(key);
      out.push({ name: p.product_name.trim(), pesticide_id: p.id, sub: [p.active_ingredients, p.manufacturer].filter(Boolean).join(' · '), unit: parseDosage(p).unit });
      if (out.length >= 30) break;
    }
    return out;
  }, [search, stock, pesticides]);

  const pick = (o) => {
    setProduct(o);
    setSearch('');
    const inStock = stock.find(s => s.product_name === o.name);
    if (inStock) setUnit(bigUnit(inStock));
    else if (o.unit) setUnit({ 'מ"ל': 'ליטר', 'גרם': 'ק"ג' }[o.unit] || o.unit);
  };

  const save = async () => {
    const qty = parseFloat(quantity);
    if (!product?.name) return setError('בחר תכשיר');
    if (!Number.isFinite(qty) || (type !== 'adjustment' && qty < 0) || (type === 'purchase' && qty === 0)) return setError('כמות לא תקינה');
    setSaving(true);
    setError(null);
    try {
      await PesticideStock.create({
        farm_id: me.current_farm_id, type, product_name: product.name, pesticide_id: product.pesticide_id || null,
        quantity: qty, unit, date,
        ...(type === 'purchase' ? { supplier: supplier.trim(), cost_per_unit: cost === '' ? null : parseFloat(cost) } : {}),
        notes: notes.trim(), created_by: me.full_name || me.email,
      });
      // קנייה עם מחיר מעדכנת את מחירון המשק
      if (type === 'purchase' && cost !== '' && Number.isFinite(parseFloat(cost))) {
        await savePesticidePrice({ product_name: product.name, pesticide_id: product.pesticide_id || null, price: parseFloat(cost), unit,
                                   supplier: supplier.trim(), source: 'purchase', date }).catch(() => {});
      }
      toast({ title: `${MOVE_TYPES[type].label} נשמרה`, description: `${product.name} · ${qty} ${unit}` });
      onSaved();
    } catch (e) {
      setError(e.message || 'השמירה נכשלה');
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md max-h-[92vh] overflow-y-auto" dir="rtl">
        <DialogHeader><DialogTitle>עדכון מלאי</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-1 p-1 bg-gray-100 rounded-xl">
            {Object.entries(MOVE_TYPES).map(([id, t]) => (
              <button key={id} type="button" onClick={() => setType(id)}
                      className={`py-1.5 rounded-lg text-sm font-medium ${type === id ? 'bg-white shadow text-gray-900' : 'text-gray-600'}`}>{t.label}</button>
            ))}
          </div>
          <p className="text-xs text-gray-500 -mt-2">{MOVE_TYPES[type].hint}</p>

          <div className="space-y-1.5">
            <Label>תכשיר *</Label>
            {product ? (
              <div className="flex items-center justify-between p-2.5 rounded-xl border bg-gray-50">
                <span className="font-medium text-sm">{product.name}</span>
                {!init.product && <button type="button" className="text-xs text-emerald-700" onClick={() => setProduct(null)}>החלף</button>}
              </div>
            ) : (
              <div className="space-y-1">
                <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="חיפוש בקטלוג או במלאי" autoFocus />
                <div className="border rounded-xl max-h-56 overflow-y-auto divide-y">
                  {options.map(o => (
                    <button key={o.name} type="button" onClick={() => pick(o)} className="w-full text-right px-3 py-2 hover:bg-emerald-50">
                      <div className="text-sm font-medium">{o.name}</div>
                      {o.sub && <div className="text-xs text-gray-500 truncate">{o.sub}</div>}
                    </button>
                  ))}
                  {search.trim() && (
                    <button type="button" onClick={() => pick({ name: search.trim() })} className="w-full text-right px-3 py-2 text-sm text-emerald-700 hover:bg-emerald-50">
                      + הוסף "{search.trim()}" (לא מהקטלוג)
                    </button>
                  )}
                  {!search.trim() && !options.length && <div className="px-3 py-2 text-xs text-gray-500">הקלד שם תכשיר לחיפוש בקטלוג</div>}
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{type === 'count' ? 'כמות שנספרה *' : type === 'adjustment' ? 'שינוי (+/−) *' : 'כמות *'}</Label>
              <Input type="number" inputMode="decimal" step="any" value={quantity} onChange={e => setQuantity(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>יחידה</Label>
              <div className="flex flex-wrap gap-1">
                {UNITS.map(u => (
                  <button key={u} type="button" onClick={() => setUnit(u)}
                          className={`px-2 py-1 rounded-lg border text-xs ${unit === u ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-gray-700'}`}>{u}</button>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>תאריך</Label>
            <Input type="date" value={date} onChange={e => setDate(e.target.value)} />
          </div>

          {type === 'purchase' && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>ספק</Label>
                <Input value={supplier} onChange={e => setSupplier(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>מחיר ליחידה (₪)</Label>
                <Input type="number" inputMode="decimal" step="any" value={cost} onChange={e => setCost(e.target.value)} />
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>הערות</Label>
            <Textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={onClose}>ביטול</Button>
            <Button className="flex-1 bg-emerald-600 hover:bg-emerald-700" onClick={save} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 animate-spin ml-1" />} שמור
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function HistoryDialog({ product, onClose, onChanged, onAdjust }) {
  const { toast } = useToast();
  const [items, setItems] = useState(null);
  const [deleting, setDeleting] = useState(null);

  const load = React.useCallback(() => {
    fetchStock(`?history=1&key=${encodeURIComponent(product.key)}`)
      .then(r => setItems(r.products?.[0]?.history || []))
      .catch(e => { toast({ title: 'שגיאה בטעינה', description: e.message, variant: 'destructive' }); setItems([]); });
  }, [product.key, toast]);
  React.useEffect(() => { load(); }, [load]);

  const remove = async (e) => {
    if (!window.confirm(`למחוק את ה${EVENT_LABEL[e.kind]} מ-${fmtDate(e.date)}?`)) return;
    setDeleting(e.id);
    try {
      await PesticideStock.delete(e.id);
      onChanged();
      load();
    } catch (err) {
      toast({ title: 'המחיקה נכשלה', description: err.message, variant: 'destructive' });
    } finally {
      setDeleting(null);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md max-h-[92vh] overflow-y-auto" dir="rtl">
        <DialogHeader><DialogTitle>{product.product_name}</DialogTitle></DialogHeader>
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-500">יתרה: <b className="text-gray-900"><bdi dir="ltr">{product.balance}</bdi> {product.unit}</b> · מנוהל מ-{fmtDate(product.tracking_since)}</span>
          <Button size="sm" variant="outline" onClick={onAdjust}>תיקון</Button>
        </div>
        {items === null ? (
          <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-emerald-600" /></div>
        ) : (
          <div className="divide-y border rounded-xl">
            {items.map((e, i) => (
              <div key={`${e.kind}-${e.id}-${i}`} className="flex items-center gap-2 px-3 py-2 text-sm">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium">{EVENT_LABEL[e.kind]}</span>
                    <span className="text-xs text-gray-400">{fmtDate(e.date)}</span>
                  </div>
                  <div className="text-xs text-gray-500 truncate">
                    {e.kind === 'usage'
                      ? <Link to={createPageUrl(`SeedingDetail?id=${e.seeding_id}`)} className="text-emerald-700 hover:underline">{e.seeding_name || 'מזרע'}</Link>
                      : [e.supplier, e.notes].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <div className="text-left flex-shrink-0">
                  <div className={e.kind === 'usage' ? 'text-red-600' : e.kind === 'count' ? 'text-blue-700' : 'text-emerald-700'}>
                    <bdi dir="ltr">{e.kind === 'usage' ? '−' : e.kind === 'count' ? '=' : e.quantity >= 0 ? '+' : ''}{e.quantity}</bdi> {e.unit}
                  </div>
                  <div className="text-[11px] text-gray-400">יתרה <bdi dir="ltr">{e.balance_after.qty}</bdi> {e.balance_after.unit}</div>
                </div>
                {e.kind !== 'usage' && (
                  <button type="button" onClick={() => remove(e)} disabled={deleting === e.id} className="p-1 text-gray-300 hover:text-red-500" aria-label="מחק">
                    {deleting === e.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  </button>
                )}
              </div>
            ))}
            {!items.length && <div className="px-3 py-4 text-sm text-gray-500 text-center">אין תנועות</div>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
