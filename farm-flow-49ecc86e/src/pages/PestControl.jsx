import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { format, parseISO, differenceInCalendarDays } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { Bug, Plus, Loader2, CheckCircle2, XCircle, Pencil, Bot, CalendarClock, MapPin, ExternalLink } from 'lucide-react';
import { createPageUrl } from '@/utils';
import { Plot, Seeding, PlotSeeding, Pesticide, PestRecommendation, Spraying } from '@/entities/all';
import { getMeCached, getListCached } from '@/api/cachedReads';
import RecommendationForm from '@/components/pest/RecommendationForm';
import SprayingForm from '@/components/seedings/SprayingForm';
import { STATUSES, severityOf, treatmentLabel, ACTIVE_SEEDING_STATUSES } from '@/components/pest/pestConstants';

const fmtDate = (d) => { try { return format(parseISO(d), 'dd/MM/yy'); } catch { return d || ''; } };

export default function PestControl() {
  const location = useLocation();
  const { toast } = useToast();
  const [me, setMe] = useState(null);
  const [recs, setRecs] = useState([]);
  const [plots, setPlots] = useState([]);
  const [seedings, setSeedings] = useState([]);
  const [plotSeedings, setPlotSeedings] = useState([]);
  const [pesticides, setPesticides] = useState([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('pending');
  const [plotFilter, setPlotFilter] = useState('all');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [executing, setExecuting] = useState(null);
  const [cancelling, setCancelling] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const user = await getMeCached();
      setMe(user);
      const farm_id = user?.current_farm_id;
      if (!farm_id) return;
      const [r, pl, sd, ps, pe] = await Promise.all([
        PestRecommendation.filter({ farm_id }),
        Plot.filter({ farm_id }),
        Seeding.filter({ farm_id }),
        PlotSeeding.filter({ farm_id }).catch(() => []),
        getListCached('pesticides', () => Pesticide.list()).catch(() => []),
      ]);
      setRecs(Array.isArray(r) ? r : []);
      setPlots((Array.isArray(pl) ? pl : []).filter(p => p.activity_status !== 'inactive').sort((a, b) => String(a.name).localeCompare(String(b.name), 'he')));
      setSeedings(Array.isArray(sd) ? sd : []);
      setPlotSeedings(Array.isArray(ps) ? ps : []);
      setPesticides(Array.isArray(pe) ? pe : []);
    } catch (e) {
      toast({ title: 'שגיאה בטעינה', description: e.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  // ?create=true (קיצור דרך) / ?plot_id=… — פתיחת טופס חדש ישירות
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('create') === 'true') { setEditing(params.get('plot_id') ? { plot_id: params.get('plot_id'), _new: true } : null); setFormOpen(true); }
  }, [location.search]);

  const counts = useMemo(() => Object.fromEntries(STATUSES.map(s => [s.id, recs.filter(r => (r.status || 'pending') === s.id).length])), [recs]);

  const visible = useMemo(() => {
    const list = recs.filter(r => (r.status || 'pending') === status && (plotFilter === 'all' || r.plot_id === plotFilter));
    return status === 'pending'
      ? list.sort((a, b) => String(a.due_date || '9999').localeCompare(String(b.due_date || '9999')))
      : list.sort((a, b) => String(b.executed_at || b.cancelled_at || b.updated_at).localeCompare(String(a.executed_at || a.cancelled_at || a.updated_at)));
  }, [recs, status, plotFilter]);

  const recentPests = useMemo(() => [...new Set(
    [...recs].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).map(r => r.pest).filter(Boolean),
  )].slice(0, 8), [recs]);

  const plotName = (id) => plots.find(p => p.id === id)?.name || recs.find(r => r.plot_id === id)?.plot_name || '—';

  const saveRecommendation = async (data) => {
    if (editing?.id) {
      await PestRecommendation.update(editing.id, data);
      toast({ title: 'ההמלצה עודכנה' });
    } else {
      await PestRecommendation.create({
        ...data,
        farm_id: me.current_farm_id,
        status: 'pending',
        source: 'manual',
        inspection_date: format(new Date(), 'yyyy-MM-dd'),
        inspector_id: me.id,
        inspector_name: me.full_name || me.email,
      });
      toast({ title: 'ההמלצה נשמרה', description: 'תופיע כממתינה עד לביצוע בשטח' });
    }
    setFormOpen(false);
    setEditing(null);
    load();
  };

  const confirmCancel = async (reason) => {
    await PestRecommendation.update(cancelling.id, {
      status: 'cancelled', cancel_reason: reason, cancelled_at: new Date().toISOString(), cancelled_by: me.full_name || me.email,
    });
    setCancelling(null);
    toast({ title: 'ההמלצה בוטלה' });
    load();
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 bg-gray-50/50 min-h-screen pb-24" dir="rtl">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-start justify-between gap-3 mb-5">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 flex items-center gap-2">
              <Bug className="w-7 h-7 text-emerald-600" /> פיקוח מזיקים
            </h1>
            <p className="text-sm text-gray-500 mt-1">המלצות הדברה מהפקח — ממתינות עד לביצוע בשטח</p>
          </div>
          <Button onClick={() => { setEditing(null); setFormOpen(true); }} className="bg-emerald-600 hover:bg-emerald-700 flex-shrink-0">
            <Plus className="w-4 h-4 ml-1" /> המלצה חדשה
          </Button>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <div className="flex gap-1 p-1 bg-gray-100 rounded-xl flex-1 sm:flex-none">
            {STATUSES.map(s => (
              <button key={s.id} onClick={() => setStatus(s.id)}
                      className={`flex-1 sm:flex-none px-3 py-1.5 rounded-lg text-sm font-medium ${status === s.id ? 'bg-white shadow text-gray-900' : 'text-gray-600'}`}>
                {s.label} <span className="text-xs text-gray-400">({counts[s.id] || 0})</span>
              </button>
            ))}
          </div>
          <Select value={plotFilter} onValueChange={setPlotFilter}>
            <SelectTrigger className="sm:w-56 bg-white"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">כל החלקות</SelectItem>
              {plots.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="w-7 h-7 animate-spin text-emerald-600" /></div>
        ) : visible.length === 0 ? (
          <Card><CardContent className="p-10 text-center text-gray-500">
            {status === 'pending' ? 'אין המלצות ממתינות. כל הכבוד!' : 'אין רשומות להצגה'}
          </CardContent></Card>
        ) : (
          <div className="space-y-3">
            {visible.map(r => (
              <RecommendationCard key={r.id} rec={r} plotName={plotName(r.plot_id)}
                                  onExecute={() => setExecuting(r)}
                                  onEdit={() => { setEditing(r); setFormOpen(true); }}
                                  onCancel={() => setCancelling(r)} />
            ))}
          </div>
        )}
      </div>

      <Dialog open={formOpen} onOpenChange={(o) => { if (!o) { setFormOpen(false); setEditing(null); } }}>
        <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing?.id ? 'עריכת המלצת הדברה' : 'המלצת הדברה חדשה'}</DialogTitle></DialogHeader>
          {formOpen && (
            <RecommendationForm plots={plots} seedings={seedings} plotSeedings={plotSeedings} pesticides={pesticides}
                                recentPests={recentPests} initialData={editing}
                                onSubmit={saveRecommendation} onCancel={() => { setFormOpen(false); setEditing(null); }} />
          )}
        </DialogContent>
      </Dialog>

      {executing && (
        <ExecuteDialog rec={executing} me={me} plots={plots} seedings={seedings} plotSeedings={plotSeedings} pesticides={pesticides}
                       onClose={() => setExecuting(null)}
                       onDone={() => { setExecuting(null); load(); }} />
      )}

      {cancelling && <CancelDialog rec={cancelling} onClose={() => setCancelling(null)} onConfirm={confirmCancel} />}
    </div>
  );
}

function RecommendationCard({ rec, plotName, onExecute, onEdit, onCancel }) {
  const sev = severityOf(rec.severity);
  const pending = (rec.status || 'pending') === 'pending';
  const daysLeft = rec.due_date ? differenceInCalendarDays(parseISO(rec.due_date), new Date()) : null;
  const overdue = pending && daysLeft !== null && daysLeft < 0;

  return (
    <Card className={overdue ? 'border-red-300' : ''}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-gray-900">{rec.pest}</span>
              <Badge variant="outline" className={`text-xs ${sev.cls}`}>חומרה {sev.label}</Badge>
              {rec.control_method === 'biological' && <Badge variant="outline" className="text-xs bg-lime-50 text-lime-800 border-lime-200">ביולוגית</Badge>}
              {rec.source === 'agent' && (
                <Badge variant="outline" className="text-xs bg-violet-50 text-violet-700 border-violet-200"><Bot className="w-3 h-3 ml-1" />סוכן AI</Badge>
              )}
            </div>
            <div className="text-sm text-gray-600 mt-1 flex items-center gap-1">
              <MapPin className="w-3.5 h-3.5" /> {plotName}{rec.seeding_name ? ` · ${rec.seeding_name}` : ' · כל החלקה'}
            </div>
          </div>
          {pending && rec.due_date && (
            <div className={`text-xs font-medium flex items-center gap-1 whitespace-nowrap ${overdue ? 'text-red-600' : daysLeft === 0 ? 'text-orange-600' : 'text-gray-500'}`}>
              <CalendarClock className="w-3.5 h-3.5" />
              {overdue ? `באיחור ${-daysLeft} ימים` : daysLeft === 0 ? 'היום' : `עד ${fmtDate(rec.due_date)}`}
            </div>
          )}
        </div>

        <div className="rounded-xl bg-gray-50 border p-2.5 space-y-1">
          {(rec.recommended_pesticides || []).map((p, i) => (
            <div key={i} className="flex justify-between text-sm gap-2">
              <span className="font-medium truncate">{p.pesticide_name}</span>
              <span className="text-gray-600 whitespace-nowrap">{p.dosage_per_dunam != null ? `${p.dosage_per_dunam} ${p.unit || ''}/דונם` : 'מינון לפי תווית'}</span>
            </div>
          ))}
          {rec.treatment_type && <div className="text-xs text-gray-500 pt-1">יישום: {treatmentLabel(rec.treatment_type)}</div>}
        </div>

        {rec.notes && <p className="text-sm text-gray-600 whitespace-pre-line">{rec.notes}</p>}

        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="text-xs text-gray-400">
            {rec.inspector_name || '—'} · {fmtDate(rec.inspection_date || rec.created_at?.slice(0, 10))}
            {rec.status === 'done' && rec.executed_at && ` · בוצע ${fmtDate(rec.executed_at.slice(0, 10))}${rec.executed_by ? ` ע"י ${rec.executed_by}` : ''}`}
            {rec.status === 'cancelled' && ` · בוטל${rec.cancel_reason ? `: ${rec.cancel_reason}` : ''}`}
          </span>
          {pending ? (
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={onCancel} className="text-gray-500"><XCircle className="w-4 h-4 ml-1" />בטל</Button>
              <Button size="sm" variant="outline" onClick={onEdit}><Pencil className="w-4 h-4 ml-1" />ערוך</Button>
              <Button size="sm" onClick={onExecute} className="bg-emerald-600 hover:bg-emerald-700"><CheckCircle2 className="w-4 h-4 ml-1" />בוצע בשטח</Button>
            </div>
          ) : rec.status === 'done' && rec.seeding_id ? (
            <Link to={createPageUrl(`SeedingDetail?id=${rec.seeding_id}`)} className="text-xs text-emerald-700 hover:underline flex items-center gap-1">
              <ExternalLink className="w-3 h-3" /> ההדברה במזרע
            </Link>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

// ביצוע בשטח: טופס ההדברה הרגיל, ממולא מההמלצה. בשמירה נוצרת הדברה (Spraying) וההמלצה נסגרת.
function ExecuteDialog({ rec, me, plots, seedings, plotSeedings, pesticides, onClose, onDone }) {
  const { toast } = useToast();
  const plot = plots.find(p => p.id === rec.plot_id) || { id: rec.plot_id, name: rec.plot_name };
  const plotSeedingList = useMemo(() => {
    const ids = new Set(plotSeedings.filter(ps => ps.plot_id === rec.plot_id).map(ps => ps.seeding_id));
    return seedings.filter(s => (ids.has(s.id) || s.plot_id === rec.plot_id) && ACTIVE_SEEDING_STATUSES.includes(s.status));
  }, [plotSeedings, seedings, rec.plot_id]);
  const [seedingId, setSeedingId] = useState(rec.seeding_id || (plotSeedingList.length === 1 ? plotSeedingList[0].id : ''));
  const seeding = seedings.find(s => s.id === seedingId) || null;
  const needSeeding = !seedingId && plotSeedingList.length > 0;

  const initialData = useMemo(() => ({
    date: format(new Date(), 'yyyy-MM-dd'),
    control_method: rec.control_method || 'chemical',
    plot_id: rec.plot_id,
    treatment_type: rec.treatment_type || 'mechanized',
    area_covered: seeding?.total_area || plot.size || '',
    performed_by: me?.full_name || '',
    notes: `לפי המלצת פיקוח: ${rec.pest}${rec.notes ? ` — ${rec.notes}` : ''}`,
    applied_pesticides: (rec.recommended_pesticides || []).map(p => {
      const cat = pesticides.find(x => x.id === p.pesticide_id) || {};
      return {
        pesticide_id: p.pesticide_id || null, pesticide_name: p.pesticide_name, active_ingredient: p.active_ingredient || cat.active_ingredients || '',
        quantity: '', unit: p.unit || cat.unit || 'מ"ל', recommended_dosage: p.dosage_per_dunam || 0,
        cost_per_unit: cat.cost_per_unit || 0, concentration: cat.concentration || '', formulation: cat.formulation || '',
      };
    }),
  }), [rec, seeding, plot.size, me, pesticides]);

  const submit = async (sprayingData) => {
    try {
      const { id: _ignore, ...rest } = sprayingData;
      const spraying = await Spraying.create({
        ...rest, farm_id: me.current_farm_id, seeding_id: seedingId || null, pest_recommendation_id: rec.id,
      });
      await PestRecommendation.update(rec.id, {
        status: 'done', spraying_id: spraying?.id || null, seeding_id: seedingId || rec.seeding_id || null,
        seeding_name: seeding?.name || rec.seeding_name || '',
        executed_at: new Date().toISOString(), executed_by: sprayingData.performed_by || me.full_name || me.email,
      });
      toast({ title: 'ההדברה נרשמה וההמלצה נסגרה' });
      onDone();
    } catch (e) {
      toast({ title: 'השמירה נכשלה', description: e.message, variant: 'destructive' });
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader><DialogTitle>ביצוע הדברה — {rec.pest} · {plot.name}</DialogTitle></DialogHeader>
        {needSeeding ? (
          <div className="space-y-3" dir="rtl">
            <p className="text-sm text-gray-600">ההמלצה היא לכל החלקה. לאיזה מזרע לרשום את ההדברה?</p>
            <div className="flex flex-wrap gap-2">
              {plotSeedingList.map(s => (
                <button key={s.id} onClick={() => setSeedingId(s.id)}
                        className="px-3 py-2 rounded-xl border text-sm font-medium bg-white hover:bg-emerald-50">{s.name}</button>
              ))}
            </div>
          </div>
        ) : (
          <SprayingForm key={seedingId} seeding={seeding} pesticides={pesticides} plots={[plot]} initialData={initialData}
                        onSubmit={submit} onCancel={onClose} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function CancelDialog({ rec, onClose, onConfirm }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md" dir="rtl">
        <DialogHeader><DialogTitle>ביטול המלצה — {rec.pest}</DialogTitle></DialogHeader>
        <Textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} placeholder="סיבה (לא חובה): הנגיעות ירדה, טופל אחרת..." />
        <div className="flex gap-2 justify-end">
          <Button variant="outline" onClick={onClose}>חזור</Button>
          <Button variant="destructive" disabled={busy} onClick={async () => { setBusy(true); await onConfirm(reason.trim()); }}>בטל המלצה</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
