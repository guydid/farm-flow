import React, { useMemo, useState } from 'react';
import { format, addDays } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Search, X, Loader2 } from 'lucide-react';
import {
  SEVERITIES, CONTROL_METHODS, TREATMENT_TYPES, ACTIVE_SEEDING_STATUSES, parseDosage,
} from './pestConstants';

const Chip = ({ active, onClick, children, className = '' }) => (
  <button type="button" onClick={onClick}
          className={`px-3 py-2 rounded-xl border text-sm font-medium transition-colors ${active ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'} ${className}`}>
    {children}
  </button>
);

// טופס המלצת הדברה: הפקח בוחר חלקה (ואופציונלית מזרע), מזיק, חומרה ותכשירים מומלצים.
// ההמלצה נשמרת כ"ממתינה" עד שמבצעים אותה בשטח.
export default function RecommendationForm({ plots, seedings, plotSeedings, pesticides, recentPests, initialData, onSubmit, onCancel }) {
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
  }));
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const set = (patch) => setData(prev => ({ ...prev, ...patch }));

  const plotSeedingsFor = useMemo(() => {
    const ids = new Set(plotSeedings.filter(ps => ps.plot_id === data.plot_id).map(ps => ps.seeding_id));
    return seedings.filter(s => (ids.has(s.id) || s.plot_id === data.plot_id) && ACTIVE_SEEDING_STATUSES.includes(s.status));
  }, [plotSeedings, seedings, data.plot_id]);

  const methodPesticides = pesticides.filter(p =>
    data.control_method === 'biological' ? p.control_type === 'biological' : p.control_type !== 'biological');
  const q = search.trim().toLowerCase();
  const matches = q
    ? methodPesticides.filter(p => [p.product_name, p.active_ingredients, p.pest, p.crop]
        .some(v => String(v || '').toLowerCase().includes(q))).slice(0, 8)
    : [];

  const addPesticide = (p) => {
    if (data.recommended_pesticides.some(x => x.pesticide_id === p.id)) { setSearch(''); return; }
    const { dose, unit } = parseDosage(p);
    set({
      recommended_pesticides: [...data.recommended_pesticides, {
        pesticide_id: p.id, pesticide_name: p.product_name, active_ingredient: p.active_ingredients || '',
        dosage_per_dunam: dose, unit,
      }],
    });
    setSearch('');
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
          <Input value={search} onChange={e => setSearch(e.target.value)} className="pr-9"
                 placeholder="חיפוש לפי שם תכשיר, חומר פעיל או מזיק" />
          {matches.length > 0 && (
            <div className="absolute z-10 mt-1 w-full bg-white border rounded-xl shadow-lg max-h-64 overflow-y-auto">
              {matches.map(p => (
                <button key={p.id} type="button" onClick={() => addPesticide(p)}
                        className="w-full text-right px-3 py-2 hover:bg-emerald-50 border-b last:border-0">
                  <div className="text-sm font-medium">{p.product_name}</div>
                  <div className="text-xs text-gray-500">{[p.active_ingredients, p.dosage, p.pest].filter(Boolean).join(' · ')}</div>
                </button>
              ))}
            </div>
          )}
        </div>
        {data.recommended_pesticides.map((p, i) => (
          <div key={p.pesticide_id || i} className="flex items-center gap-2 p-2 rounded-xl border bg-gray-50">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{p.pesticide_name}</div>
              {p.active_ingredient && <div className="text-xs text-gray-500 truncate">{p.active_ingredient}</div>}
            </div>
            <Input type="number" inputMode="decimal" step="any" value={p.dosage_per_dunam ?? ''} className="w-20 h-9 text-center"
                   onChange={e => updatePesticide(i, { dosage_per_dunam: e.target.value })} aria-label="מינון לדונם" />
            <span className="text-xs text-gray-500 w-14">{p.unit}/דונם</span>
            <button type="button" onClick={() => removePesticide(i)} className="p-1 text-gray-400 hover:text-red-500" aria-label="הסר">
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
      </section>

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
