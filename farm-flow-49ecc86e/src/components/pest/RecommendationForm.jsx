import React, { useMemo, useState } from 'react';
import { format, addDays } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Search, X, Loader2 } from 'lucide-react';
import {
  SEVERITIES, CONTROL_METHODS, TREATMENT_TYPES, ACTIVE_SEEDING_STATUSES, parseDosage, isPercentUnit, sprayVolumeFromText,
} from './pestConstants';

const Chip = ({ active, onClick, children, className = '' }) => (
  <button type="button" onClick={onClick}
          className={`px-3 py-2 rounded-xl border text-sm font-medium transition-colors ${active ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'} ${className}`}>
    {children}
  </button>
);

const StockBadge = ({ s }) => (s ? (
  <span className={`text-[10px] px-1.5 rounded whitespace-nowrap ${s.status === 'out' ? 'bg-red-100 text-red-700' : s.status === 'low' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-700'}`}>
    {s.status === 'out' ? 'אזל' : `במלאי ${s.balance} ${s.unit}`}
  </span>
) : null);

// טופס המלצת הדברה: הפקח בוחר חלקה (ואופציונלית מזרע), מזיק, חומרה ותכשירים מומלצים.
// ההמלצה נשמרת כ"ממתינה" עד שמבצעים אותה בשטח.
export default function RecommendationForm({ plots, seedings, plotSeedings, pesticides, stock = [], recentPests, initialData, onSubmit, onCancel }) {
  const [data, setData] = useState(() => ({
    plot_id: initialData?.plot_id || '',
    seeding_id: initialData?.seeding_id || '',
    pest: initialData?.pest || '',
    severity: initialData?.severity || 'medium',
    control_method: initialData?.control_method || 'chemical',
    treatment_type: initialData?.treatment_type || 'mechanized',
    recommended_pesticides: initialData?.recommended_pesticides || [],
    due_date: initialData?.due_date || format(addDays(new Date(), 1), 'yyyy-MM-dd'),
    notes: initialData?.notes || '',
    spray_volume: initialData?.spray_volume ? String(initialData.spray_volume) : '',
  }));
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const set = (patch) => setData(prev => ({ ...prev, ...patch }));

  const plotSeedingsFor = useMemo(() => {
    const ids = new Set(plotSeedings.filter(ps => ps.plot_id === data.plot_id).map(ps => ps.seeding_id));
    return seedings.filter(s => (ids.has(s.id) || s.plot_id === data.plot_id) && ACTIVE_SEEDING_STATUSES.includes(s.status));
  }, [plotSeedings, seedings, data.plot_id]);

  // הקטלוג (מהמאגר הממשלתי) מכיל שורה לכל צירוף תכשיר×גידול×נגע — מקבצים לפי תכשיר,
  // אחרת אותו מוצר ממלא את כל הרשימה ותכשירים אחרים "נעלמים"
  const products = useMemo(() => {
    const groups = new Map();
    for (const p of pesticides) {
      if (!p?.product_name) continue;
      if ((data.control_method === 'biological') !== (p.control_type === 'biological')) continue;
      const key = (p.registration_number || p.product_name).toString().trim();
      if (!groups.has(key)) groups.set(key, { key, name: p.product_name, own: !!p.farm_id, rows: [] });
      const g = groups.get(key);
      g.rows.push(p);
      if (p.farm_id) g.own = true;
    }
    return [...groups.values()].sort((a, b) => (b.own - a.own) || a.name.localeCompare(b.name, 'he'));
  }, [pesticides, data.control_method]);

  // מלאי לפי שם תכשיר — מציג יתרה בבחירה ומקדים תכשירים שיש במחסן
  const stockOf = useMemo(() => new Map(stock.map(s => [s.key, s])), [stock]);
  const stockFor = (name) => stockOf.get(String(name || '').trim().replace(/\s+/g, ' ').toLowerCase());

  const [pickerOpen, setPickerOpen] = useState(false);
  const q = search.trim().toLowerCase();
  const has = (v, t) => String(v || '').toLowerCase().includes(t);
  const matches = useMemo(() => {
    const list = q
      ? products.filter(g => g.rows.some(r => [r.product_name, r.active_ingredients, r.manufacturer, r.pest, r.crop].some(v => has(v, q))))
      : products;
    const rank = (g) => { const s = stockFor(g.name); return !s ? 1 : s.status === 'out' ? 2 : 0; };
    return [...list].sort((a, b) => rank(a) - rank(b)).slice(0, 60);
  }, [products, q, stockOf]);

  // השורה המתאימה ביותר לתכשיר: לפי המזיק שבחיפוש/בהמלצה (מינון שונה לכל נגע), אחרת הראשונה עם מינון
  const bestRow = (g) => {
    const pest = data.pest.trim().toLowerCase();
    return (q && g.rows.find(r => has(r.pest, q) || has(r.crop, q)))
      || (pest && g.rows.find(r => has(r.pest, pest) || (r.pest && pest.includes(String(r.pest).toLowerCase()))))
      || g.rows.find(r => r.dosage) || g.rows[0];
  };

  const addPesticide = (p) => {
    if (data.recommended_pesticides.some(x => x.pesticide_id === p.id || x.pesticide_name === p.product_name)) { setSearch(''); setPickerOpen(false); return; }
    const { dose, unit } = parseDosage(p);
    if (unit === '%' && !data.spray_volume) {
      const v = sprayVolumeFromText(p.volume);
      if (v) set({ spray_volume: String(v) });
    }
    set({
      recommended_pesticides: [...data.recommended_pesticides, {
        pesticide_id: p.id, pesticide_name: p.product_name, active_ingredient: p.active_ingredients || '',
        dosage_per_dunam: dose, unit,
      }],
    });
    setSearch('');
    setPickerOpen(false);
  };
  const updatePesticide = (i, patch) => set({
    recommended_pesticides: data.recommended_pesticides.map((x, j) => (j === i ? { ...x, ...patch } : x)),
  });
  const removePesticide = (i) => set({ recommended_pesticides: data.recommended_pesticides.filter((_, j) => j !== i) });

  const submit = async () => {
    if (!data.plot_id) return setError('בחר חלקה');
    if (!data.pest.trim()) return setError('ציין מזיק או מחלה');
    if (!data.recommended_pesticides.length) return setError('הוסף לפחות תכשיר אחד');
    setError(null);
    setSaving(true);
    try {
      const plot = plots.find(p => p.id === data.plot_id);
      const seeding = seedings.find(s => s.id === data.seeding_id);
      await onSubmit({
        ...data,
        pest: data.pest.trim(),
        seeding_id: data.seeding_id || null,
        plot_name: plot?.name || '',
        seeding_name: seeding?.name || '',
        recommended_pesticides: data.recommended_pesticides.map(p => ({
          ...p, dosage_per_dunam: p.dosage_per_dunam === '' || p.dosage_per_dunam == null ? null : parseFloat(p.dosage_per_dunam),
        })),
        spray_volume: data.recommended_pesticides.some(p => isPercentUnit(p.unit)) && parseFloat(data.spray_volume) > 0 ? parseFloat(data.spray_volume) : null,
      });
    } catch (e) {
      setError(e.message || 'השמירה נכשלה');
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5" dir="rtl">
      <section className="space-y-2">
        <Label>חלקה *</Label>
        <div className="flex flex-wrap gap-2">
          {plots.map(p => (
            <Chip key={p.id} active={data.plot_id === p.id} onClick={() => set({ plot_id: p.id, seeding_id: '' })}>
              {p.name}
            </Chip>
          ))}
          {!plots.length && <p className="text-sm text-gray-500">אין חלקות פעילות</p>}
        </div>
      </section>

      {data.plot_id && (
        <section className="space-y-2">
          <Label>מזרע בחלקה</Label>
          <div className="flex flex-wrap gap-2">
            <Chip active={!data.seeding_id} onClick={() => set({ seeding_id: '' })}>כל החלקה</Chip>
            {plotSeedingsFor.map(s => (
              <Chip key={s.id} active={data.seeding_id === s.id} onClick={() => set({ seeding_id: s.id })}>{s.name}</Chip>
            ))}
          </div>
        </section>
      )}

      <section className="space-y-2">
        <Label>מזיק / מחלה *</Label>
        <Input value={data.pest} onChange={e => set({ pest: e.target.value })} placeholder="למשל: כנימת עש, קמחון, תריפס" />
        {recentPests.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {recentPests.map(p => (
              <button key={p} type="button" onClick={() => set({ pest: p })}
                      className="px-2.5 py-1 rounded-full text-xs bg-gray-100 text-gray-700 hover:bg-gray-200">{p}</button>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <Label>חומרת נגיעות</Label>
        <div className="grid grid-cols-3 gap-2">
          {SEVERITIES.map(s => <Chip key={s.id} active={data.severity === s.id} onClick={() => set({ severity: s.id })}>{s.label}</Chip>)}
        </div>
      </section>

      <section className="space-y-2">
        <Label>סוג הדברה</Label>
        <div className="grid grid-cols-2 gap-2">
          {CONTROL_METHODS.map(m => (
            <Chip key={m.id} active={data.control_method === m.id}
                  onClick={() => data.control_method !== m.id && set({ control_method: m.id, recommended_pesticides: [] })}>
              {m.label}
            </Chip>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <Label>תכשירים מומלצים *</Label>
        <div className="relative">
          <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <Input value={search} onChange={e => { setSearch(e.target.value); setPickerOpen(true); }} className="pr-9"
                 onFocus={() => setPickerOpen(true)} onBlur={() => setTimeout(() => setPickerOpen(false), 200)}
                 placeholder="חיפוש לפי שם תכשיר, חומר פעיל, יצרן או מזיק" />
          {pickerOpen && (
            <div className="absolute z-10 mt-1 w-full bg-white border rounded-xl shadow-lg max-h-72 overflow-y-auto">
              {matches.map(g => {
                const r = bestRow(g);
                return (
                  <button key={g.key} type="button" onMouseDown={e => e.preventDefault()} onClick={() => addPesticide(r)}
                          className="w-full text-right px-3 py-2 hover:bg-emerald-50 border-b last:border-0">
                    <div className="text-sm font-medium flex items-center gap-1.5">
                      {g.name}
                      {g.own && <span className="text-[10px] px-1.5 rounded bg-blue-100 text-blue-700">של המשק</span>}
                      <StockBadge s={stockFor(g.name)} />
                    </div>
                    <div className="text-xs text-gray-500">
                      {[r.active_ingredients, r.dosage, r.pest].filter(Boolean).join(' · ')}
                      {g.rows.length > 1 && <span className="text-gray-400"> · {g.rows.length} רישומים</span>}
                    </div>
                  </button>
                );
              })}
              {!matches.length && (
                <div className="px-3 py-3 text-sm text-gray-500">
                  {products.length
                    ? 'לא נמצא תכשיר מתאים'
                    : data.control_method === 'biological'
                      ? 'אין תכשירים ביולוגיים בקטלוג — אפשר להוסיף בהגדרות ← חומרי הדברה'
                      : 'קטלוג חומרי ההדברה ריק — אפשר לייבא מהמאגר הממשלתי בהגדרות ← חומרי הדברה'}
                </div>
              )}
              {matches.length === 60 && <div className="px-3 py-2 text-xs text-gray-400">מוצגים 60 ראשונים — חדד את החיפוש</div>}
            </div>
          )}
        </div>
        {data.recommended_pesticides.map((p, i) => (
          <div key={p.pesticide_id || i} className="flex items-center gap-2 p-2 rounded-xl border bg-gray-50">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate flex items-center gap-1.5">{p.pesticide_name} <StockBadge s={stockFor(p.pesticide_name)} /></div>
              {p.active_ingredient && <div className="text-xs text-gray-500 truncate">{p.active_ingredient}</div>}
            </div>
            <Input type="number" inputMode="decimal" step="any" value={p.dosage_per_dunam ?? ''} className="w-20 h-9 text-center"
                   onChange={e => updatePesticide(i, { dosage_per_dunam: e.target.value })} aria-label="מינון לדונם" />
            <span className="text-xs text-gray-500 w-14">{isPercentUnit(p.unit) ? '% בתרסיס' : `${p.unit}/דונם`}</span>
            <button type="button" onClick={() => removePesticide(i)} className="p-1 text-gray-400 hover:text-red-500" aria-label="הסר">
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
      </section>

      {data.recommended_pesticides.some(p => isPercentUnit(p.unit)) && (
        <section className="space-y-1.5 p-3 rounded-xl border border-amber-200 bg-amber-50/60">
          <Label>נפח תרסיס (ליטר לדונם)</Label>
          <Input type="number" inputMode="decimal" step="any" className="w-28 bg-white" value={data.spray_volume}
                 onChange={e => set({ spray_volume: e.target.value })} />
          <p className="text-xs text-amber-800">מינון באחוזים הוא ריכוז בתרסיס. בביצוע, הכמות תירשם בליטרים: אחוז × נפח תרסיס × שטח.</p>
        </section>
      )}

      <section className="space-y-2">
        <Label>אופן יישום</Label>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {TREATMENT_TYPES.map(t => <Chip key={t.id} active={data.treatment_type === t.id} onClick={() => set({ treatment_type: t.id })}>{t.label}</Chip>)}
        </div>
      </section>

      <section className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>לביצוע עד</Label>
          <Input type="date" value={data.due_date} onChange={e => set({ due_date: e.target.value })} />
        </div>
      </section>

      <section className="space-y-2">
        <Label>תצפית והערות</Label>
        <Textarea value={data.notes} onChange={e => set({ notes: e.target.value })} rows={3}
                  placeholder="איפה נמצאה הנגיעות, שלב הגידול, מה לבדוק אחרי הטיפול..." />
      </section>

      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel} className="flex-1">ביטול</Button>
        <Button type="button" onClick={submit} disabled={saving} className="flex-1 bg-emerald-600 hover:bg-emerald-700">
          {saving && <Loader2 className="w-4 h-4 animate-spin ml-1" />}
          {initialData?.id ? 'שמור שינויים' : 'שמור המלצה'}
        </Button>
      </div>
    </div>
  );
}
