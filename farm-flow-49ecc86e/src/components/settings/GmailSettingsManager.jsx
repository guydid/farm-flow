import React, { useEffect, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import {
  Mail, CheckCircle2, XCircle, Loader2, RefreshCw, Unlink, AlertTriangle, Info, Clock, Ban
} from 'lucide-react';
import { getToken } from '@/api/localClient';
import { useToast } from '@/components/ui/use-toast';

const BASE_URL = import.meta.env.VITE_API_URL || '/api';

const INTERVAL_LABELS = {
  5: 'כל 5 דקות',
  10: 'כל 10 דקות',
  15: 'כל 15 דקות',
  30: 'כל חצי שעה',
  60: 'כל שעה',
  120: 'כל שעתיים',
  240: 'כל 4 שעות',
  360: 'כל 6 שעות',
  720: 'כל 12 שעות',
  1440: 'פעם ביום',
};

async function api(path, opts = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}`, ...(opts.headers || {}) },
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`); }
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export default function GmailSettingsManager() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [label, setLabel] = useState('');
  const [subjectFilter, setSubjectFilter] = useState('');
  const [autoSync, setAutoSync] = useState(true);
  const [intervalMin, setIntervalMin] = useState(15);
  const [allowedIntervals, setAllowedIntervals] = useState([5, 10, 15, 30, 60, 120, 240, 360, 720, 1440]);
  const [savingSettings, setSavingSettings] = useState(false);
  const [ignoreRules, setIgnoreRules] = useState([]);
  const wasSyncingRef = useRef(false);
  const { toast } = useToast();

  const load = async () => {
    setLoading(true);
    try {
      const s = await api('/gmail/status');
      setStatus(s);
      setLabel(s.label || '');
      setSubjectFilter(s.subject_filter || '');
      setAutoSync(s.auto_sync !== false);
      if (s.sync_interval_min) setIntervalMin(s.sync_interval_min);
      if (Array.isArray(s.allowed_intervals)) setAllowedIntervals(s.allowed_intervals);
      if (s.connected) loadIgnoreRules();
    } catch (e) {
      toast({ title: 'שגיאה בטעינת מצב Gmail', description: e.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // Handle return-from-OAuth query params
    const params = new URLSearchParams(window.location.search);
    if (params.get('connected') === '1') {
      toast({ title: 'חיבור Gmail הושלם בהצלחה' });
      // Clean URL
      const url = new URL(window.location);
      url.searchParams.delete('connected');
      window.history.replaceState({}, '', url);
    } else if (params.get('error')) {
      toast({ title: 'חיבור Gmail נכשל', description: params.get('error'), variant: 'destructive' });
    }
  }, []);

  // תשאול חי כל עוד סנכרון רץ — בין אם הופעל מכאן ובין אם ע"י הפולר ברקע
  useEffect(() => {
    if (!status?.syncing) return;
    let alive = true;
    const t = setInterval(async () => {
      try {
        const s = await api('/gmail/status');
        if (alive) setStatus(s);
      } catch { /* תקלת רשת חולפת — הניסיון הבא ימשיך */ }
    }, 2000);
    return () => { alive = false; clearInterval(t); };
  }, [status?.syncing]);

  // טוסט סיכום ברגע שהסנכרון מסתיים
  useEffect(() => {
    if (status?.syncing) { wasSyncingRef.current = true; return; }
    if (!wasSyncingRef.current || !status) return;
    wasSyncingRef.current = false;
    setSyncing(false);
    if (status.needs_reauth) {
      toast({ title: 'סנכרון נכשל', description: status.last_error || 'חיבור ה-Gmail פג תוקף.', variant: 'destructive' });
    } else if (status.last_sync_result) {
      const r = status.last_sync_result;
      const filed = r.filedToEmployees ? ` · ${r.filedToEmployees} שויכו לתיקי עובדים` : '';
      toast({ title: 'סנכרון הושלם', description: `נסרקו ${r.scanned}, נשמרו ${r.saved}, דולגו ${r.skipped}${filed}` });
      loadIgnoreRules();
    }
  }, [status?.syncing]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadIgnoreRules = async () => {
    try {
      const { rules } = await api('/gmail/ignore-rules');
      setIgnoreRules(Array.isArray(rules) ? rules : []);
    } catch { /* לא קריטי — הכרטיס פשוט יישאר ריק */ }
  };

  const deleteIgnoreRule = async (id) => {
    try {
      await api(`/gmail/ignore-rules/${id}`, { method: 'DELETE' });
      toast({ title: 'הכלל בוטל', description: 'קבצים בתבנית זו ייסרקו שוב בסנכרון הבא.' });
      loadIgnoreRules();
    } catch (e) {
      toast({ title: 'שגיאה בביטול הכלל', description: e.message, variant: 'destructive' });
    }
  };

  const connect = async () => {
    setConnecting(true);
    try {
      const { url } = await api('/gmail/connect');
      window.location.href = url;
    } catch (e) {
      toast({ title: 'שגיאה ביצירת קישור OAuth', description: e.message, variant: 'destructive' });
      setConnecting(false);
    }
  };

  const disconnect = async () => {
    if (!confirm('לנתק את חשבון ה-Gmail מהמערכת?')) return;
    try {
      await api('/gmail/disconnect', { method: 'DELETE' });
      toast({ title: 'נותק' });
      load();
    } catch (e) {
      toast({ title: 'שגיאה בניתוק', description: e.message, variant: 'destructive' });
    }
  };

  // הסנכרון רץ בשרת ברקע (סריקת 30 יום אורכת דקות) — ה-POST חוזר מיד עם 202 והתקדמות
  // נקראת מ-/gmail/status. בלי זה Cloudflare חותך את הבקשה אחרי ~100 שניות ומדווח כישלון שווא.
  const sync = async () => {
    setSyncing(true);
    try {
      await api('/gmail/sync', { method: 'POST' });
      const s = await api('/gmail/status');
      setStatus(s); // מדליק את התשאול החי שב-useEffect
      if (!s.syncing) setSyncing(false);
    } catch (e) {
      toast({ title: 'סנכרון נכשל', description: e.message, variant: 'destructive' });
      setSyncing(false);
      load(); // ריענון הסטטוס — ייתכן שהשרת סימן את החיבור כדורש חיבור מחדש
    }
  };

  const saveSettings = async () => {
    setSavingSettings(true);
    try {
      await api('/gmail/settings', { method: 'PUT', body: JSON.stringify({
        label: label.trim() || null,
        subject_filter: subjectFilter.trim() || null,
        auto_sync: autoSync,
        sync_interval_min: intervalMin,
      }) });
      toast({ title: 'ההגדרות נשמרו' });
      load();
    } catch (e) {
      toast({ title: 'שגיאה בשמירה', description: e.message, variant: 'destructive' });
    } finally {
      setSavingSettings(false);
    }
  };

  if (loading) {
    return <div className="flex justify-center items-center h-40"><Loader2 className="w-6 h-6 animate-spin text-indigo-600" /></div>;
  }

  // total הוא resultSizeEstimate של Gmail — הערכה, ולכן חוסמים את האחוז ב-100
  const prog = status?.progress;
  const syncPercent = prog?.total
    ? Math.min(100, Math.round((prog.scanned / prog.total) * 100))
    : 0;
  const extractingFile = prog?.phase?.startsWith('extracting:') ? prog.phase.slice('extracting:'.length) : null;

  if (!status?.oauth_configured) {
    return (
      <Card>
        <CardContent className="p-6 text-center space-y-3">
          <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto" />
          <p className="font-medium text-gray-800">Google OAuth לא מוגדר בשרת</p>
          <p className="text-sm text-gray-500">יש להגדיר את משתני הסביבה GOOGLE_CLIENT_ID ו-GOOGLE_CLIENT_SECRET, ולהוסיף בקונסול Google Cloud את redirect URI הבא:</p>
          <code className="block bg-gray-100 px-3 py-2 rounded text-xs text-gray-700" dir="ltr">{`${window.location.origin}/api/gmail/callback`}</code>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4" dir="rtl">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Mail className="w-5 h-5 text-red-500" />חיבור Gmail</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3 p-3 rounded-lg bg-gray-50">
            {status?.connected && status?.needs_reauth ? (
              <>
                <AlertTriangle className="w-5 h-5 text-amber-500" />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-amber-700">החיבור פג תוקף</p>
                  <p className="text-sm text-gray-500 truncate" dir="ltr">{status.email}</p>
                </div>
                <Badge className="bg-amber-100 text-amber-700 border-amber-200">דורש חיבור מחדש</Badge>
              </>
            ) : status?.connected ? (
              <>
                <CheckCircle2 className="w-5 h-5 text-green-500" />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-green-700">מחובר</p>
                  <p className="text-sm text-gray-500 truncate" dir="ltr">{status.email}</p>
                </div>
                <Badge className="bg-green-100 text-green-700 border-green-200">פעיל</Badge>
              </>
            ) : (
              <>
                <XCircle className="w-5 h-5 text-gray-400" />
                <div className="flex-1">
                  <p className="font-medium text-gray-700">לא מחובר</p>
                </div>
                <Badge variant="outline">לא פעיל</Badge>
              </>
            )}
          </div>

          {status?.syncing && (
            <div className="p-3 rounded-lg bg-indigo-50 border border-indigo-100 space-y-2">
              <div className="flex items-center gap-2 text-sm text-indigo-800">
                <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />
                <span className="font-medium">סורק את תיבת הדואר…</span>
              </div>
              <Progress value={syncPercent} className="h-2" />
              <div className="flex justify-between text-xs text-indigo-700">
                <span>
                  נסרקו {status.progress?.scanned ?? 0}
                  {status.progress?.total ? ` מתוך ~${status.progress.total}` : ''}
                </span>
                <span>נשמרו {status.progress?.saved ?? 0} · דולגו {status.progress?.skipped ?? 0}</span>
              </div>
              {extractingFile && (
                <p className="text-xs text-indigo-600 truncate" dir="ltr" title={extractingFile}>
                  ⚙ {extractingFile}
                </p>
              )}
              <p className="text-xs text-gray-500">אפשר לעזוב את העמוד — הסריקה ממשיכה בשרת.</p>
            </div>
          )}

          {status?.needs_reauth && (
            <div className="flex gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-medium">הסנכרון האוטומטי מושבת — הרשאת הגישה ל-Gmail בוטלה או פגה.</p>
                <p className="mt-1">לחץ <strong>נתק</strong> ואז <strong>חבר חשבון Gmail</strong> כדי לחדש.</p>
                {status.last_error && (
                  <p className="mt-1 text-xs text-amber-700" dir="ltr">{status.last_error}</p>
                )}
                {status.last_error_at && (
                  <p className="mt-1 text-xs text-amber-600">מאז {new Date(status.last_error_at).toLocaleString('he-IL')}</p>
                )}
              </div>
            </div>
          )}

          {!status?.connected && (
            <div className="flex gap-2 p-3 rounded-lg bg-blue-50 border border-blue-100 text-sm text-blue-700">
              <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <div>
                <p>חיבור Gmail אישי — כל משתמש מחבר את התיבה שלו בנפרד. המערכת תסרוק אוטומטית בתדירות שתבחר, תאתר חשבוניות ספקים (PDF/תמונה), תחלץ נתונים ותשמור כטיוטה לבדיקתך.</p>
                <p className="mt-1 text-xs text-blue-600">הרשאת קריאה בלבד (gmail.readonly) — המערכת אינה יכולה לשלוח או למחוק הודעות.</p>
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {!status?.connected ? (
              <Button onClick={connect} disabled={connecting} className="bg-red-600 hover:bg-red-700">
                {connecting ? <Loader2 className="w-4 h-4 animate-spin ml-1" /> : <Mail className="w-4 h-4 ml-1" />}
                חבר חשבון Gmail
              </Button>
            ) : (
              <>
                <Button onClick={sync} disabled={syncing || status?.needs_reauth}>
                  {syncing ? <Loader2 className="w-4 h-4 animate-spin ml-1" /> : <RefreshCw className="w-4 h-4 ml-1" />}
                  סנכרן עכשיו
                </Button>
                <Button onClick={disconnect} variant="outline" className="text-red-600 border-red-200 hover:bg-red-50">
                  <Unlink className="w-4 h-4 ml-1" /> נתק
                </Button>
              </>
            )}
          </div>

          {status?.connected && status.last_sync_at && (
            <p className="text-xs text-gray-500">סנכרון אחרון: {new Date(status.last_sync_at).toLocaleString('he-IL')}</p>
          )}
        </CardContent>
      </Card>

      {status?.connected && (
        <Card>
          <CardHeader><CardTitle className="text-base">הגדרות סריקה</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label className="flex items-center gap-1.5"><Clock className="w-4 h-4 text-gray-500" />תדירות סריקה אוטומטית</Label>
              <Select value={String(intervalMin)} onValueChange={v => setIntervalMin(parseInt(v, 10))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {allowedIntervals.map(n => (
                    <SelectItem key={n} value={String(n)}>{INTERVAL_LABELS[n] || `כל ${n} דקות`}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-gray-500 mt-1">קצב גבוה (5–15 דק׳) טוב לסריקה מיידית. קצב נמוך (שעות) חוסך קריאות API ועלות AI.</p>
            </div>
            <div>
              <Label>תווית Gmail לסריקה (אופציונלי)</Label>
              <Input value={label} onChange={e => setLabel(e.target.value)} placeholder="השאר ריק — זיהוי לפי נושא" />
              <p className="text-xs text-gray-500 mt-1"><strong>מומלץ להשאיר ריק.</strong> אם ריק — המערכת סורקת כל הודעה עם קובץ מצורף ש"חשבונית", "invoice", "קבלה" וכו' מופיעים בנושא. אם תגדיר תווית — המערכת תסרוק <u>רק</u> הודעות שסומנו ידנית בתווית זו ב-Gmail.</p>
            </div>
            <div>
              <Label>סינון נושא מותאם (Regex, אופציונלי)</Label>
              <Input value={subjectFilter} onChange={e => setSubjectFilter(e.target.value)} placeholder="חשבונית|invoice" dir="ltr" />
              <p className="text-xs text-gray-500 mt-1">דריסה לברירת המחדל. השאר ריק לברירת המחדל.</p>
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg bg-gray-50">
              <div>
                <p className="font-medium text-sm">סנכרון אוטומטי פעיל</p>
                <p className="text-xs text-gray-500">כיבוי משבית את הסריקה האוטומטית. ניתן עדיין לסנכרן ידנית.</p>
              </div>
              <Switch checked={autoSync} onCheckedChange={setAutoSync} />
            </div>
            <Button onClick={saveSettings} disabled={savingSettings}>
              {savingSettings && <Loader2 className="w-4 h-4 animate-spin ml-1" />}
              שמור הגדרות
            </Button>
          </CardContent>
        </Card>
      )}

      {status?.connected && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Ban className="w-4 h-4 text-gray-500" />
              קבצים שנלמדו כ"לא חשבונית"
            </CardTitle>
          </CardHeader>
          <CardContent>
            {ignoreRules.length === 0 ? (
              <p className="text-sm text-gray-500">
                אין כללים עדיין. בעמוד החשבוניות, לחיצה על "לא חשבונית" בשורה מלמדת את המערכת
                לדלג על קבצים דומים מאותו שולח בסריקות הבאות.
              </p>
            ) : (
              <div className="space-y-2">
                {ignoreRules.map(r => (
                  <div key={r.id} className="flex items-center gap-2 p-2 rounded-lg bg-gray-50 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-xs truncate" dir="ltr">{r.filename_pattern}</p>
                      <p className="text-xs text-gray-500 truncate" dir="ltr">
                        {r.from_email || 'כל שולח'}
                        {r.sample_filename ? ` · לדוגמה: ${r.sample_filename}` : ''}
                      </p>
                    </div>
                    <Button
                      onClick={() => deleteIgnoreRule(r.id)}
                      size="sm"
                      variant="ghost"
                      className="text-red-600 hover:bg-red-50 flex-shrink-0"
                      title="בטל כלל — קבצים כאלה ייסרקו שוב"
                    >
                      <Unlink className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
                <p className="text-xs text-gray-500 pt-1">
                  ‎#‎ מייצג רצף ספרות, כך שכלל אחד מכסה גם את הקבצים הבאים באותה סדרה.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
