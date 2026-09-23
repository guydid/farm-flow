import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { ClockWorker, AttendanceRecord, Employee, User, Farm } from '@/entities/all';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectValue, SelectTrigger } from '@/components/ui/select';
import {
  Clock, UserCheck, UserX, CalendarDays, Timer, RefreshCw, AlertTriangle, Users, Bell, BellOff, Link2, HardHat
} from 'lucide-react';
import { format } from 'date-fns';
import { useLocation, useNavigate } from 'react-router-dom';
import { useToast } from '@/components/ui/use-toast';
import { getToken } from '@/api/localClient';
import TempWorkersTab from '@/components/attendance/TempWorkersTab';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

const HEB_MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
const monthLabel = (ym) => {
  const [y, m] = ym.split('-');
  return `${HEB_MONTHS[parseInt(m, 10) - 1]} ${y}`;
};
const fmtHours = (h) => {
  const n = Number(h) || 0;
  const hh = Math.floor(n);
  const mm = Math.round((n - hh) * 60);
  return `${hh}:${String(mm).padStart(2, '0')}`;
};

export default function Attendance() {
  const [workers, setWorkers] = useState([]);
  const [records, setRecords] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [farmId, setFarmId] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();
  const location = useLocation();
  const navigate = useNavigate();

  // ניווט מהקיצור בנייד: ?tab=temp פותח את הלשונית, ?create=true פותח מיד את הטופס
  const [tab, setTab] = useState('daily');
  const [autoCreateTemp, setAutoCreateTemp] = useState(false);
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const wanted = params.get('tab');
    if (wanted && ['daily', 'active', 'monthly', 'temp'].includes(wanted)) setTab(wanted);
    if (params.get('create') === 'true') setAutoCreateTemp(true);
    if (wanted || params.get('create')) navigate(location.pathname, { replace: true });
  }, [location.search, location.pathname, navigate]);

  const today = format(new Date(), 'yyyy-MM-dd');
  const [month, setMonth] = useState(today.slice(0, 7)); // YYYY-MM

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const user = await User.me();
      if (!user.current_farm_id) {
        setWorkers([]); setRecords([]); setEmployees([]); setFarmId(null);
        setIsLoading(false);
        return;
      }
      setFarmId(user.current_farm_id);
      setIsAdmin(!!user.is_admin);
      const farmFilter = { farm_id: user.current_farm_id };
      const [w, r, e] = await Promise.all([
        ClockWorker.filter(farmFilter).catch(() => []),
        AttendanceRecord.filter(farmFilter).catch(() => []),
        Employee.filter(farmFilter).catch(() => []),
      ]);
      setWorkers(Array.isArray(w) ? w : []);
      setRecords(Array.isArray(r) ? r : []);
      setEmployees(Array.isArray(e) ? e : []);
    } catch (error) {
      toast({ title: 'שגיאה בטעינת נתוני נוכחות', description: error.message || '', variant: 'destructive' });
      setWorkers([]); setRecords([]); setEmployees([]);
    }
    setIsLoading(false);
  }, [toast]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Active workers, most-absent first ──
  const sortedWorkers = useMemo(
    () => [...workers].sort((a, b) => (b.absent_days ?? 0) - (a.absent_days ?? 0)),
    [workers]
  );
  const presentCount = useMemo(() => workers.filter(w => (w.absent_days ?? 99) === 0).length, [workers]);

  // זמן העדכון האחרון = ה-updated_at העדכני ביותר (מתי הגשר דחף נתונים לאחרונה)
  const lastUpdateLabel = useMemo(() => {
    const times = [...workers, ...records].map(x => x.updated_at).filter(Boolean);
    if (!times.length) return null;
    const latest = times.sort().pop(); // מחרוזות ISO ממוינות לקסיקוגרפית
    try {
      return new Date(latest).toLocaleString('he-IL', {
        timeZone: 'Asia/Jerusalem', day: '2-digit', month: '2-digit',
        hour: '2-digit', minute: '2-digit',
      });
    } catch { return null; }
  }, [workers, records]);

  // ── Daily status ──
  const todayRecords = useMemo(() => records.filter(r => r.date === today), [records, today]);
  const firstIn = useMemo(() => todayRecords.map(r => r.first_in).filter(Boolean).sort()[0] || null, [todayRecords]);
  const lastOut = useMemo(() => todayRecords.map(r => r.last_out).filter(Boolean).sort().pop() || null, [todayRecords]);
  const presentIds = useMemo(() => new Set(todayRecords.map(r => String(r.time_clock_id))), [todayRecords]);
  // Only monitored workers count toward "absent" — matches the alert logic.
  const absentToday = useMemo(
    () => workers.filter(w => w.monitored !== false && !presentIds.has(String(w.time_clock_id))),
    [workers, presentIds]
  );

  // ── Monthly hours ──
  // חודשים של עובדים זמניים נכנסים לבורר גם אם אין בהם החתמות שעון כלל
  const [tempMonths, setTempMonths] = useState([]);
  const handleAutoCreateHandled = useCallback(() => setAutoCreateTemp(false), []);

  const handleTempLoaded = useCallback((list) => {
    setTempMonths([...new Set(list.map(g => String(g.date || '').slice(0, 7)).filter(Boolean))]);
  }, []);

  const months = useMemo(() => {
    const set = new Set(records.map(r => (r.date || '').slice(0, 7)).filter(Boolean));
    tempMonths.forEach(m => set.add(m));
    set.add(today.slice(0, 7));
    return [...set].sort().reverse();
  }, [records, tempMonths, today]);

  const monthRows = useMemo(() => {
    const byWorker = {};
    for (const r of records) {
      if ((r.date || '').slice(0, 7) !== month) continue;
      const wid = String(r.time_clock_id);
      if (!byWorker[wid]) byWorker[wid] = { time_clock_id: wid, name: r.name || '', hours: 0, days: 0, incomplete: 0 };
      byWorker[wid].hours += Number(r.hours) || 0;
      byWorker[wid].days += 1;
      if (r.complete === false) byWorker[wid].incomplete += 1;
      if (r.name) byWorker[wid].name = r.name;
    }
    return Object.values(byWorker).sort((a, b) => b.hours - a.hours);
  }, [records, month]);

  const monthTotalHours = useMemo(() => monthRows.reduce((s, r) => s + r.hours, 0), [monthRows]);

  // ── Employee linking ──
  const empName = useCallback((id) => {
    const e = employees.find(x => x.id === id);
    return e ? (e.full_name || `${e.first_name || ''} ${e.last_name || ''}`.trim()) : null;
  }, [employees]);

  const linkEmployee = async (worker, employeeId) => {
    try {
      await ClockWorker.update(worker.id, { employee_id: employeeId === '__none__' ? null : employeeId });
      setWorkers(prev => prev.map(w => w.id === worker.id ? { ...w, employee_id: employeeId === '__none__' ? null : employeeId } : w));
      toast({ title: 'הקישור עודכן' });
    } catch (e) {
      toast({ title: 'שגיאה בקישור', description: e.message || '', variant: 'destructive' });
    }
  };

  const [autoLinking, setAutoLinking] = useState(false);
  // Auto-link clock workers to employees by matching normalized names. Previews
  // (dry-run) and asks for confirmation before writing the links.
  const autoLink = async () => {
    setAutoLinking(true);
    try {
      const call = async (dry) => {
        const res = await fetch(`${API_BASE}/attendance/auto-link`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
          body: JSON.stringify({ dry_run: dry }),
        });
        const d = await res.json();
        if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);
        return d;
      };
      const preview = await call(true);
      const c = preview.counts;
      if (c.linked === 0) {
        toast({ title: 'לא נמצאו התאמות חדשות', description: `${c.ambiguous} מעורפלים · ${c.unmatched} ללא התאמה · ${c.already_linked} כבר מקושרים` });
        return;
      }
      const sample = preview.linked.slice(0, 8).map(l => `${l.name} ← ${l.employee_name}`).join('\n');
      const more = preview.linked.length > 8 ? `\n…ועוד ${preview.linked.length - 8}` : '';
      if (!confirm(`יקושרו ${c.linked} עובדים לפי שם:\n\n${sample}${more}\n\n(${c.ambiguous} מעורפלים · ${c.unmatched} ללא התאמה — יישארו לקישור ידני)\n\nלהמשיך?`)) return;
      const res = await call(false);
      toast({ title: `${res.counts.linked} עובדים קושרו`, description: `${res.counts.unmatched} נותרו ללא התאמה לקישור ידני` });
      await loadData();
    } catch (e) {
      toast({ title: 'שגיאה בקישור אוטומטי', description: e.message || '', variant: 'destructive' });
    } finally {
      setAutoLinking(false);
    }
  };

  const [rebuilding, setRebuilding] = useState(false);
  // Admin resets the base roster: drop all clock workers and re-seed from those who
  // actually clocked in (attendance records). Manual links/removals are preserved.
  const rebuildRoster = async () => {
    if (!confirm('לאפס את מצבת העובדים? הרשימה תימחק ותיבנה מחדש מתוך העובדים שהחתימו בשעון. קישורי עובדים ידניים יישמרו.')) return;
    setRebuilding(true);
    try {
      const res = await fetch(`${API_BASE}/attendance/rebuild-roster`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      toast({ title: 'מצבת העובדים אופסה', description: `${data.roster} עובדים נטענו מההחתמות` });
      await loadData();
    } catch (e) {
      toast({ title: 'שגיאה באיפוס המצבת', description: e.message || '', variant: 'destructive' });
    } finally {
      setRebuilding(false);
    }
  };

  // Admin removes / restores a worker from the absence-monitoring roster.
  const toggleMonitor = async (worker) => {
    const next = worker.monitored === false; // currently off → turn on, else off
    try {
      await ClockWorker.update(worker.id, { monitored: next });
      setWorkers(prev => prev.map(w => w.id === worker.id ? { ...w, monitored: next } : w));
      toast({ title: next ? 'הוחזר למעקב' : 'הוסר מהמעקב' });
    } catch (e) {
      toast({ title: 'שגיאה בעדכון מעקב', description: e.message || '', variant: 'destructive' });
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto"></div>
          <p className="mt-2 text-gray-600">טוען נוכחות...</p>
        </div>
      </div>
    );
  }

  const noData = workers.length === 0 && records.length === 0;

  return (
    <div className="p-3 sm:p-6 lg:p-8 bg-gray-50/50 min-h-screen" dir="rtl">
      <div className="max-w-screen-2xl mx-auto">
        <div className="flex justify-between items-center gap-2 mb-4 lg:mb-6">
          <div className="flex items-center gap-2">
            <Clock className="w-6 h-6 text-indigo-600" />
            <div>
              <h1 className="text-xl lg:text-3xl font-bold text-gray-900">שעון נוכחות</h1>
              <p className="text-xs text-gray-500 mt-0.5">{workers.length} עובדי שעון · {presentCount} נוכחים היום</p>
              {lastUpdateLabel && (
                <p className="text-xs text-gray-400 mt-0.5">עודכן מהשעון: {lastUpdateLabel}</p>
              )}
            </div>
          </div>
          <Button onClick={loadData} disabled={isLoading} variant="outline" size="sm" className="flex items-center gap-1.5">
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">רענן</span>
          </Button>
        </div>

        {noData && (
          <Card className="mb-4 border-amber-200 bg-amber-50">
            <CardContent className="p-4 flex items-start gap-2 text-sm text-amber-800">
              <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>אין עדיין נתוני נוכחות. ודא שגשר הסנכרון (farmflow_sync.py) פועל על מחשב השעון ושמפתח ה-API מוגדר בהגדרות.</span>
            </CardContent>
          </Card>
        )}

        <Tabs value={tab} onValueChange={setTab} dir="rtl">
          <TabsList className="grid grid-cols-4 w-full max-w-2xl mb-4">
            <TabsTrigger value="daily" className="flex items-center gap-1.5"><CalendarDays className="w-4 h-4" />סטטוס יומי</TabsTrigger>
            <TabsTrigger value="active" className="flex items-center gap-1.5"><Users className="w-4 h-4" />עובדים פעילים</TabsTrigger>
            <TabsTrigger value="monthly" className="flex items-center gap-1.5"><Timer className="w-4 h-4" />שעות חודשיות</TabsTrigger>
            <TabsTrigger value="temp" className="flex items-center gap-1.5"><HardHat className="w-4 h-4" />עובדים זמניים</TabsTrigger>
          </TabsList>

          {/* ── סטטוס יומי ── */}
          <TabsContent value="daily">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
              <StatCard label="נכנסו היום" value={todayRecords.length} icon={UserCheck} color="text-green-600" />
              <StatCard label="חסרים" value={absentToday.length} icon={UserX} color="text-red-600" />
              <StatCard label="החתמה ראשונה" value={firstIn || '—'} icon={Clock} color="text-indigo-600" />
              <StatCard label="החתמה אחרונה" value={lastOut || '—'} icon={Clock} color="text-indigo-600" />
            </div>

            <div className="grid lg:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><UserCheck className="w-4 h-4 text-green-600" />נוכחים ({todayRecords.length})</CardTitle></CardHeader>
                <CardContent className="space-y-1.5">
                  {todayRecords.length === 0 && <p className="text-sm text-gray-400 py-2">אף אחד לא החתים היום.</p>}
                  {[...todayRecords].sort((a, b) => (a.first_in || '').localeCompare(b.first_in || '')).map(r => (
                    <div key={r.time_clock_id} className="p-2 rounded-lg bg-gray-50">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-gray-800">{r.name || `#${r.time_clock_id}`}</span>
                        {typeof r.hours === 'number' && r.hours > 0 && (
                          <span className="text-xs text-indigo-700 font-semibold tabular-nums">{fmtHours(r.hours)} ש'</span>
                        )}
                      </div>
                      <div className="mt-1"><PunchRow rec={r} /></div>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><UserX className="w-4 h-4 text-red-600" />חסרים ({absentToday.length})</CardTitle></CardHeader>
                <CardContent className="space-y-1.5">
                  {absentToday.length === 0 && <p className="text-sm text-gray-400 py-2">כולם נוכחים 🎉</p>}
                  {absentToday.map(w => (
                    <div key={w.time_clock_id} className="flex items-center justify-between p-2 rounded-lg bg-gray-50">
                      <span className="text-sm font-medium text-gray-800">{w.name || `#${w.time_clock_id}`}</span>
                      {(w.absent_days ?? 0) > 1 && <Badge className="bg-red-100 text-red-700">{w.absent_days} ימים</Badge>}
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* ── עובדים פעילים ── */}
          <TabsContent value="active">
            <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
              <p className="text-xs text-gray-500 flex-1 min-w-[200px]">
                כל עובד שהחתים בשעון נכנס אוטומטית למצבת המעקב. {isAdmin ? 'מנהל יכול להסיר עובד מהמעקב ("הסר") או לאפס את כל המצבת מההחתמות.' : 'ניהול המצבת זמין למנהל מערכת.'}
              </p>
              {isAdmin && (
                <div className="flex flex-wrap gap-2">
                  <Button onClick={autoLink} disabled={autoLinking} variant="outline" size="sm">
                    <Link2 className={`w-3.5 h-3.5 ml-1 ${autoLinking ? 'animate-pulse' : ''}`} />
                    קשר אוטומטית לפי שם
                  </Button>
                  <Button onClick={rebuildRoster} disabled={rebuilding} variant="outline" size="sm" className="text-amber-700 border-amber-300">
                    <RefreshCw className={`w-3.5 h-3.5 ml-1 ${rebuilding ? 'animate-spin' : ''}`} />
                    אפס מצבת מהחתמות
                  </Button>
                </div>
              )}
            </div>
            <Card>
              <CardContent className="p-0 divide-y">
                {sortedWorkers.length === 0 && <p className="text-sm text-gray-400 p-4">אין עובדי שעון רשומים.</p>}
                {sortedWorkers.map(w => {
                  const absent = (w.absent_days ?? 0) > 0;
                  const unmonitored = w.monitored === false;
                  return (
                    <div key={w.id} className={`flex flex-wrap items-center gap-2 p-3 ${unmonitored ? 'opacity-60' : ''}`}>
                      <div className="flex items-center gap-2 min-w-[140px] flex-1">
                        <span className={`w-2 h-2 rounded-full ${unmonitored ? 'bg-gray-300' : absent ? 'bg-red-400' : 'bg-green-500'}`} />
                        <div>
                          <div className="text-sm font-medium text-gray-800">{w.name || `#${w.time_clock_id}`}</div>
                          <div className="text-[11px] text-gray-400">מס' שעון {w.time_clock_id}{w.last_seen ? ` · נראה ${w.last_seen}` : ''}</div>
                        </div>
                      </div>
                      {unmonitored ? (
                        <Badge className="bg-gray-100 text-gray-500">לא במעקב</Badge>
                      ) : (
                        <Badge className={absent ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}>
                          {absent ? `נעדר ${w.absent_days} ימים` : 'נוכח'}
                        </Badge>
                      )}
                      <Select value={w.employee_id || '__none__'} onValueChange={(v) => linkEmployee(w, v)}>
                        <SelectTrigger className="w-44 h-8 text-xs">
                          <SelectValue placeholder="קשר לעובד">{w.employee_id ? empName(w.employee_id) || 'עובד לא קיים' : 'קשר לעובד'}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">— ללא קישור —</SelectItem>
                          {employees.map(e => (
                            <SelectItem key={e.id} value={e.id}>{e.full_name || `${e.first_name || ''} ${e.last_name || ''}`.trim()}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {isAdmin && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className={`h-8 px-2 text-xs ${unmonitored ? 'text-green-600' : 'text-gray-400 hover:text-red-600'}`}
                          onClick={() => toggleMonitor(w)}
                          title={unmonitored ? 'החזר למעקב היעדרות' : 'הסר ממעקב היעדרות'}
                        >
                          {unmonitored ? <Bell className="w-3.5 h-3.5 ml-1" /> : <BellOff className="w-3.5 h-3.5 ml-1" />}
                          {unmonitored ? 'החזר' : 'הסר'}
                        </Button>
                      )}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── שעות חודשיות ── */}
          <TabsContent value="monthly">
            <div className="flex items-center gap-3 mb-4">
              <Select value={month} onValueChange={setMonth}>
                <SelectTrigger className="w-44 h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {months.map(m => <SelectItem key={m} value={m}>{monthLabel(m)}</SelectItem>)}
                </SelectContent>
              </Select>
              <span className="text-sm text-gray-500">סה"כ {fmtHours(monthTotalHours)} שעות · {monthRows.length} עובדים</span>
            </div>

            <Card>
              <CardContent className="p-0 divide-y">
                <div className="flex items-center gap-2 p-3 text-xs font-semibold text-gray-500 bg-gray-50">
                  <span className="flex-1">עובד</span>
                  <span className="w-20 text-center">שעות</span>
                  <span className="w-16 text-center">ימים</span>
                  <span className="w-20 text-center">חוסרים</span>
                </div>
                {monthRows.length === 0 && <p className="text-sm text-gray-400 p-4">אין נתונים לחודש זה.</p>}
                {monthRows.map(r => (
                  <div key={r.time_clock_id} className="flex items-center gap-2 p-3">
                    <span className="flex-1 text-sm font-medium text-gray-800">{r.name || `#${r.time_clock_id}`}</span>
                    <span className="w-20 text-center text-sm font-semibold tabular-nums text-indigo-700">{fmtHours(r.hours)}</span>
                    <span className="w-16 text-center text-sm tabular-nums text-gray-600">{r.days}</span>
                    <span className="w-20 text-center text-sm tabular-nums">
                      {r.incomplete > 0 ? <Badge className="bg-amber-100 text-amber-700">{r.incomplete}</Badge> : <span className="text-gray-300">—</span>}
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
            <p className="text-[11px] text-gray-400 mt-2">● ימים עם החתמה חסרה (כניסה ללא יציאה) מסומנים בעמודת "חוסרים" ואינם נספרים בשעות.</p>
          </TabsContent>

          {/* ── עובדים זמניים (הזנה ידנית) ── */}
          <TabsContent value="temp">
            <div className="flex items-center gap-3 mb-4">
              <Select value={month} onValueChange={setMonth}>
                <SelectTrigger className="w-44 h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {months.map(m => <SelectItem key={m} value={m}>{monthLabel(m)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <TempWorkersTab
              farmId={farmId}
              month={month}
              monthLabel={monthLabel(month)}
              onLoaded={handleTempLoaded}
              autoCreate={autoCreateTemp}
              onAutoCreateHandled={handleAutoCreateHandled}
            />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

// בונה רצף הקלדות לתצוגה: כניסה/יציאה, עם "הפסקה" בין יציאה לכניסה הבאה.
// עמיד לכמה צורות אפשריות של punches (מהגשר): רשימת זמנים מתחלפת, [{time,type}],
// או מקטעי [{in,out}]. אם אין punches — נופל ל-first_in/last_out.
function punchSequence(rec) {
  const p = rec.punches;
  let events = []; // {type:'in'|'out', time}
  const tval = (x) => x?.time || x?.t || x?.value || '';
  if (Array.isArray(p) && p.length) {
    if (typeof p[0] === 'string') {
      events = p.filter(Boolean).map((t, i) => ({ type: i % 2 === 0 ? 'in' : 'out', time: String(t) }));
    } else if (p[0] && (p[0].in || p[0].out)) {
      for (const seg of p) {
        if (seg.in) events.push({ type: 'in', time: String(seg.in) });
        if (seg.out) events.push({ type: 'out', time: String(seg.out) });
      }
    } else if (p[0] && (p[0].type || p[0].time || p[0].t)) {
      events = p.map((x, i) => {
        const ty = String(x.type || '').toLowerCase();
        const isOut = ty.startsWith('o') || ty.includes('out') || ty.includes('יצ');
        const isIn = ty.startsWith('i') || ty.includes('in') || ty.includes('כנ');
        return { type: isOut ? 'out' : isIn ? 'in' : (i % 2 === 0 ? 'in' : 'out'), time: tval(x) };
      }).filter(e => e.time);
    }
  }
  if (!events.length) {
    if (rec.first_in) events.push({ type: 'in', time: rec.first_in });
    if (rec.last_out) events.push({ type: 'out', time: rec.last_out });
  }
  // נרמול תצוגת זמן ל-HH:MM
  const hhmm = (t) => { const m = String(t).match(/(\d{1,2}):(\d{2})/); return m ? `${m[1].padStart(2, '0')}:${m[2]}` : String(t); };
  const tokens = [];
  for (let i = 0; i < events.length; i++) {
    if (i > 0 && events[i - 1].type === 'out' && events[i].type === 'in') tokens.push({ kind: 'break' });
    tokens.push({ kind: events[i].type, time: hhmm(events[i].time) });
  }
  return tokens;
}

function PunchRow({ rec }) {
  const tokens = punchSequence(rec);
  if (!tokens.length) return <span className="text-xs text-gray-400">—</span>;
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs tabular-nums">
      {tokens.map((t, i) => {
        if (t.kind === 'break') return <span key={i} className="text-amber-600">· הפסקה ·</span>;
        const isIn = t.kind === 'in';
        return (
          <span key={i} className={isIn ? 'text-green-700' : 'text-gray-500'}>
            {isIn ? 'כניסה' : 'יציאה'} {t.time}
          </span>
        );
      })}
      {rec.complete === false && <span className="text-amber-600" title="החתמה חסרה">●</span>}
    </span>
  );
}

function StatCard({ label, value, icon: Icon, color }) {
  return (
    <Card>
      <CardContent className="p-3 flex items-center gap-3">
        <Icon className={`w-5 h-5 ${color}`} />
        <div>
          <div className="text-lg font-bold text-gray-900 tabular-nums leading-tight">{value}</div>
          <div className="text-[11px] text-gray-500">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
}
