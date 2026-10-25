import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Sprout, Wheat, SprayCan, Activity, Bug, Package, Tag, FileText, Scale, Map, Car, User,
  Bot, Loader2, RefreshCw, History,
} from 'lucide-react';
import { createPageUrl } from '@/utils';
import { apiFetch, BASE_URL } from '@/api/localClient';

const ICONS = {
  sprout:   { Icon: Sprout,   cls: 'bg-green-100 text-green-700' },
  harvest:  { Icon: Wheat,    cls: 'bg-amber-100 text-amber-700' },
  spray:    { Icon: SprayCan, cls: 'bg-blue-100 text-blue-700' },
  activity: { Icon: Activity, cls: 'bg-violet-100 text-violet-700' },
  bug:      { Icon: Bug,      cls: 'bg-emerald-100 text-emerald-700' },
  stock:    { Icon: Package,  cls: 'bg-teal-100 text-teal-700' },
  price:    { Icon: Tag,      cls: 'bg-sky-100 text-sky-700' },
  invoice:  { Icon: FileText, cls: 'bg-indigo-100 text-indigo-700' },
  scale:    { Icon: Scale,    cls: 'bg-orange-100 text-orange-700' },
  plot:     { Icon: Map,      cls: 'bg-lime-100 text-lime-700' },
  vehicle:  { Icon: Car,      cls: 'bg-gray-100 text-gray-700' },
  employee: { Icon: User,     cls: 'bg-pink-100 text-pink-700' },
};

const FILTERS = [
  { id: 'all', label: 'הכל', types: null },
  { id: 'field', label: 'שטח', types: 'seedings,harvests,activities,plots' },
  { id: 'pest', label: 'הדברה', types: 'sprayings,pest_recommendations,pesticide_stock,pesticide_prices' },
  { id: 'money', label: 'כספים', types: 'invoices,expenses,weighing_certificates,lease_payments,leases' },
];

// updated_at מגיע כ-ISO (Z) או כ-"YYYY-MM-DD HH:MM:SS" (UTC, מברירת המחדל של SQLite)
const toDate = (s) => new Date(/Z$|[+-]\d\d:?\d\d$/.test(s) ? s : `${String(s).replace(' ', 'T')}Z`);
function timeAgo(s) {
  const d = toDate(s);
  const sec = Math.round((Date.now() - d.getTime()) / 1000);
  if (!Number.isFinite(sec)) return '';
  if (sec < 60) return 'עכשיו';
  if (sec < 3600) return `לפני ${Math.floor(sec / 60)} דק'`;
  if (sec < 86400) return `לפני ${Math.floor(sec / 3600)} שע'`;
  if (sec < 172800) return 'אתמול';
  if (sec < 7 * 86400) return `לפני ${Math.floor(sec / 86400)} ימים`;
  return d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

// "עדכונים אחרונים" — מה נוצר/עודכן לאחרונה במשק (כולל פעולות של סוכן AI). מוצג בדשבורד בדסקטופ ובנייד.
export default function RecentUpdates({ compact = false, pageSize = compact ? 6 : 12 }) {
  const [filter, setFilter] = useState('all');
  const [items, setItems] = useState([]);
  const [next, setNext] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);

  const types = FILTERS.find(f => f.id === filter)?.types;
  const url = useCallback((before) => {
    const q = new URLSearchParams({ limit: String(pageSize) });
    if (types) q.set('types', types);
    if (before) q.set('before', before);
    return `${BASE_URL}/recent-updates?${q}`;
  }, [pageSize, types]);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const r = await apiFetch(url());
      setItems(r.items || []);
      setNext(r.next || null);
      setError(null);
    } catch (e) {
      if (!silent) setError(e.message || 'שגיאה בטעינה');
    } finally {
      setLoading(false);
    }
  }, [url]);

  useEffect(() => { load(); }, [load]);
  // רענון שקט כל דקה כשהלשונית גלויה
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') load(true); }, 60000);
    return () => clearInterval(t);
  }, [load]);

  const more = async () => {
    setLoadingMore(true);
    try {
      const r = await apiFetch(url(next));
      setItems(prev => [...prev, ...(r.items || []).filter(it => !prev.some(p => p.id === it.id && p.entity === it.entity))]);
      setNext(r.next || null);
    } catch { /* keep current list */ } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div className={`bg-white border border-gray-200 ${compact ? 'rounded-2xl' : 'rounded-xl shadow-sm'}`} dir="rtl">
      <div className={`flex items-center justify-between gap-2 ${compact ? 'px-3 pt-3' : 'px-5 pt-4'}`}>
        <h2 className={`font-bold text-gray-800 flex items-center gap-2 ${compact ? 'text-base' : 'text-lg'}`}>
          <History className="w-5 h-5 text-indigo-500" /> עדכונים אחרונים
        </h2>
        <button type="button" onClick={() => load()} className="p-1.5 text-gray-400 hover:text-gray-700" aria-label="רענון">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className={`flex gap-1.5 overflow-x-auto ${compact ? 'px-3 pt-2' : 'px-5 pt-3'}`}>
        {FILTERS.map(f => (
          <button key={f.id} type="button" onClick={() => setFilter(f.id)}
                  className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap border ${filter === f.id ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-200'}`}>
            {f.label}
          </button>
        ))}
      </div>

      <div className={compact ? 'p-2' : 'p-3'}>
        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-indigo-500" /></div>
        ) : error ? (
          <p className="text-sm text-red-600 px-2 py-4">{error}</p>
        ) : !items.length ? (
          <p className="text-sm text-gray-500 px-2 py-6 text-center">אין עדכונים להצגה</p>
        ) : (
          <ul className={`divide-y divide-gray-100 ${compact ? '' : 'md:grid md:grid-cols-2 md:gap-x-6 md:divide-y-0'}`}>
            {items.map(it => {
              const { Icon, cls } = ICONS[it.icon] || ICONS.activity;
              const body = (
                <div className="flex items-start gap-3 py-2.5 px-2 rounded-lg hover:bg-gray-50">
                  <div className={`w-9 h-9 rounded-lg flex-shrink-0 flex items-center justify-center ${cls}`}>
                    <Icon className="w-[18px] h-[18px]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium text-sm text-gray-900 truncate">{it.title}</span>
                      {it.action === 'updated' && <span className="text-[10px] px-1.5 rounded bg-gray-100 text-gray-500 shrink-0">עודכן</span>}
                    </div>
                    {it.detail && <div className="text-xs text-gray-500 truncate mt-0.5">{it.detail}</div>}
                    <div className="text-[11px] text-gray-400 mt-0.5 flex items-center gap-1 min-w-0">
                      <span className="shrink-0">{timeAgo(it.at)}</span>
                      {it.by && (
                        <span className={`truncate flex items-center gap-0.5 ${it.by_agent ? 'text-violet-600' : ''}`}>
                          · {it.by_agent && <Bot className="w-3 h-3 shrink-0" />}{it.by}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
              return (
                <li key={`${it.entity}-${it.id}`} className={compact ? '' : 'md:border-b md:border-gray-100'}>
                  {it.page ? <Link to={createPageUrl(it.page)}>{body}</Link> : body}
                </li>
              );
            })}
          </ul>
        )}
        {next && !loading && (
          <button type="button" onClick={more} disabled={loadingMore}
                  className="w-full mt-1 py-2 text-sm text-indigo-600 font-medium flex items-center justify-center gap-1">
            {loadingMore && <Loader2 className="w-4 h-4 animate-spin" />} הצג עוד
          </button>
        )}
      </div>
    </div>
  );
}
