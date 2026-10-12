import React, { useState } from 'react';
import { Check, X, Loader2, Pencil } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { savePesticidePrice } from '@/api/pesticidePrices';

const PRICE_UNITS = ['ליטר', 'מ"ל', 'ק"ג', 'גרם', "יח'"];

// עריכת מחיר קנייה במקום (₪ ליחידה) — נשמר במחירון המשק, לא בקטלוג המשותף
export default function PriceEditor({ productName, pesticideId, price, defaultUnit = 'ליטר', fallback, onSaved, compact = false }) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [unit, setUnit] = useState(price?.unit || defaultUnit);
  const [saving, setSaving] = useState(false);

  const open = (e) => {
    e?.stopPropagation();
    setValue(price?.price != null ? String(price.price) : fallback?.price != null ? String(fallback.price) : '');
    setUnit(price?.unit || fallback?.unit || defaultUnit);
    setEditing(true);
  };

  const save = async () => {
    const v = value.trim() === '' ? null : parseFloat(value);
    if (v !== null && (!Number.isFinite(v) || v < 0)) return toast({ title: 'מחיר לא תקין', variant: 'destructive' });
    setSaving(true);
    try {
      const saved = await savePesticidePrice({ product_name: productName, pesticide_id: pesticideId, price: v, unit, source: 'manual' });
      toast({ title: 'המחיר עודכן', description: v === null ? productName : `${productName} · ₪${v}/${unit}` });
      setEditing(false);
      onSaved?.(saved);
    } catch (e) {
      toast({ title: 'שמירת המחיר נכשלה', description: e.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    const shown = price?.price != null ? price : fallback;
    return (
      <button type="button" onClick={open} className="inline-flex items-center gap-1 text-xs group" title="עדכון מחיר קנייה">
        {shown?.price != null ? (
          <span className={price?.price != null ? 'text-blue-700 font-medium' : 'text-gray-400'}>
            <bdi dir="ltr">₪{shown.price}</bdi> ל{shown.unit || "יח'"}{price?.price == null && !compact ? ' (קטלוג)' : ''}
          </span>
        ) : (
          <span className="text-gray-400">{compact ? 'הוסף מחיר' : '—'}</span>
        )}
        <Pencil className="w-3 h-3 text-gray-300 group-hover:text-blue-600" />
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1" onClick={e => e.stopPropagation()}>
      <span className="text-xs text-gray-500">₪</span>
      <input type="number" inputMode="decimal" step="any" autoFocus value={value}
             onChange={e => setValue(e.target.value)}
             onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
             className="w-20 h-7 px-2 text-sm border rounded-md" aria-label="מחיר" />
      <select value={unit} onChange={e => setUnit(e.target.value)} className="h-7 text-xs border rounded-md px-1 bg-white" aria-label="ליחידה">
        {PRICE_UNITS.map(u => <option key={u} value={u}>/{u}</option>)}
      </select>
      <button type="button" onClick={save} disabled={saving} className="p-1 text-emerald-600" aria-label="שמור">
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
      </button>
      <button type="button" onClick={() => setEditing(false)} className="p-1 text-gray-400" aria-label="ביטול"><X className="w-4 h-4" /></button>
    </div>
  );
}
