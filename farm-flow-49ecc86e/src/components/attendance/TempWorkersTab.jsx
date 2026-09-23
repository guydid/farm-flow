import { useState, useEffect, useMemo, useCallback } from 'react';
import { TempWorkerGroup, ManpowerCompany } from '@/entities/all';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectValue, SelectTrigger, SelectGroup, SelectLabel, SelectSeparator,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Plus, Pencil, Trash2, HardHat, FileText, Printer, Download } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { format } from 'date-fns';

/** ערך מיוחד בבורר המעסיק שפותח שדה טקסט חופשי */
const FREE_TEXT = '__free__';
/** קידומת לערך בבורר שמייצג שם שהוזן ידנית בעבר (ולא חברה רשומה) */
const FREE_PREFIX = 'free:';
const isFreeValue = (v) => v === FREE_TEXT || String(v || '').startsWith(FREE_PREFIX);
const ALL = '__all__';
const NO_EMPLOYER = '(ללא מעסיק)';

export const TEMP_STATUSES = [
  { value: 'open',   label: 'פתוח', className: 'bg-blue-100 text-blue-700' },
  { value: 'closed', label: 'סגור', className: 'bg-gray-200 text-gray-700' },
  { value: 'paid',   label: 'שולם', className: 'bg-green-100 text-green-700' },
];
const statusMeta = (v) => TEMP_STATUSES.find(s => s.value === v) || TEMP_STATUSES[0];

/** "HH:MM" → דקות מחצות. מחזיר null אם לא תקין. */
function toMinutes(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
  if (!m) return null;
  const h = Number(m[1]), mm = Number(m[2]);
  if (h > 23 || mm > 59) return null;
  return h * 60 + mm;
}

/**
 * משך המשמרת בשעות עשרוניות. משמרת שחוצה חצות (יציאה מוקדמת מהכניסה)
 * נספרת כגלישה ליום המחרת ולא כמשך שלילי.
 */
export function shiftHours(from, to) {
  const a = toMinutes(from), b = toMinutes(to);
  if (a === null || b === null) return 0;
  const span = b >= a ? b - a : b + 24 * 60 - a;
  return span / 60;
}

/**
 * שעות לעובד יחיד, לפי אופן ההזנה שנבחר ברישום.
 * רישומים שנשמרו לפני שנוסף מצב "מספר שעות" חסרי entry_mode —
 * הם נקראים כשעון, בדיוק כפי שהוזנו.
 */
export function perWorkerHours(g) {
  if (g?.entry_mode === 'hours') {
    const n = Number(g.hours_per_worker);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }
  return shiftHours(g?.from_time, g?.to_time);
}

/** סה"כ שעות אדם = שעות לעובד × מספר העובדים */
export function groupTotalHours(g) {
  return perWorkerHours(g) * (Number(g?.count) || 0);
}

const fmtHours = (h) => {
  const n = Number(h) || 0;
  const hh = Math.floor(n);
  const mm = Math.round((n - hh) * 60);
  return `${hh}:${String(mm).padStart(2, '0')}`;
};

const fmtDate = (d) => {
  if (!d) return '—';
  const [, m, day] = String(d).split('-');
  return day && m ? `${day}/${m}` : d;
};

const fmtFullDate = (d) => {
  if (!d) return '';
  const [y, m, day] = String(d).split('-');
  return day && m ? `${day}/${m}/${y}` : d;
};

/** תיאור השעות של רישום — שעון או מספר שעות, לפי אופן ההזנה */
const hoursLabel = (g) =>
  g?.entry_mode === 'hours'
    ? `${fmtHours(perWorkerHours(g))} לעובד`
    : `${g?.from_time || '—'}–${g?.to_time || '—'}`;

const employerOf = (g) => g?.employer_name || NO_EMPLOYER;

const emptyForm = (today) => ({
  date: today,
  employer_id: '',
  employer_name: '',
  count: '',
  entry_mode: 'times',
  from_time: '07:00',
  to_time: '15:00',
  hours_per_worker: '',
  status: 'open',
  notes: '',
});

export default function TempWorkersTab({
  farmId, month, monthLabel, canEdit = true, onLoaded, autoCreate = false, onAutoCreateHandled,
}) {
  const [groups, setGroups] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [saving, setSaving] = useState(false);
  const [employerFilter, setEmployerFilter] = useState(ALL);
  const [form, setForm] = useState(emptyForm(''));
  const { toast } = useToast();

  // תאריך מקומי, לא UTC — אחרת רישום אחרי חצות היה נפתח עם תאריך אתמול
  const today = format(new Date(), 'yyyy-MM-dd');

  const load = useCallback(async () => {
    if (!farmId) { setGroups([]); setCompanies([]); setIsLoading(false); return; }
    setIsLoading(true);
    try {
      const farmFilter = { farm_id: farmId };
      const [g, c] = await Promise.all([
        TempWorkerGroup.filter(farmFilter).catch(() => []),
        ManpowerCompany.filter(farmFilter).catch(() => []),
      ]);
      const list = Array.isArray(g) ? g : [];
      setGroups(list);
      setCompanies(Array.isArray(c) ? c : []);
      onLoaded?.(list);
    } finally {
      setIsLoading(false);
    }
  }, [farmId, onLoaded]);

  useEffect(() => { load(); }, [load]);

  const openNew = useCallback(() => {
    setEditing(null);
    setForm(emptyForm(today));
    setDialogOpen(true);
  }, [today]);

  // כניסה מהקיצור בנייד (?tab=temp&create=true) — פותח את הטופס מיד
  useEffect(() => {
    if (!autoCreate || !canEdit) return;
    openNew();
    onAutoCreateHandled?.();
  }, [autoCreate, canEdit, openNew, onAutoCreateHandled]);

  // כל רישומי החודש הנבחר, החדש למעלה
  const monthRows = useMemo(() => {
    return groups
      .filter(g => String(g.date || '').slice(0, 7) === month)
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  }, [groups, month]);

  /**
   * שמות מעסיקים שהוקלדו ידנית בעבר (רישומים ללא employer_id).
   * נגזר מכל הרישומים ולא רק מהחודש הנבחר — שם שהוזן במרץ צריך להיות
   * זמין גם באוגוסט. שמות שבינתיים נוספו כחברת כוח אדם רשומה מסוננים
   * החוצה כדי שלא יופיעו פעמיים בבורר.
   */
  const rememberedNames = useMemo(() => {
    const official = new Set(companies.map(c => (c.name || '').trim()).filter(Boolean));
    const seen = new Set();
    for (const g of groups) {
      const name = (g.employer_name || '').trim();
      if (!name || g.employer_id || official.has(name)) continue;
      seen.add(name);
    }
    return [...seen].sort((a, b) => a.localeCompare(b, 'he'));
  }, [groups, companies]);

  // רשימת המעסיקים שיש להם רישום בחודש — זה מה שאפשר לסנן לפיו
  const employersInMonth = useMemo(
    () => [...new Set(monthRows.map(employerOf))].sort((a, b) => a.localeCompare(b, 'he')),
    [monthRows]
  );

  // אם המעסיק שסוננו לפיו נעלם מהחודש (מעבר חודש / מחיקה) — חזרה ל"כל המעסיקים"
  useEffect(() => {
    if (employerFilter !== ALL && !employersInMonth.includes(employerFilter)) {
      setEmployerFilter(ALL);
    }
  }, [employersInMonth, employerFilter]);

  const rows = useMemo(
    () => (employerFilter === ALL ? monthRows : monthRows.filter(g => employerOf(g) === employerFilter)),
    [monthRows, employerFilter]
  );

  const totals = useMemo(() => rows.reduce((acc, g) => ({
    hours: acc.hours + groupTotalHours(g),
    workers: acc.workers + (Number(g.count) || 0),
  }), { hours: 0, workers: 0 }), [rows]);

  // סיכום לפי מעסיק — מה שמשלמים לכל קבלן החודש
  const byEmployer = useMemo(() => {
    const map = new Map();
    for (const g of rows) {
      const name = employerOf(g);
      const cur = map.get(name) || { name, hours: 0, workers: 0, days: 0 };
      cur.hours += groupTotalHours(g);
      cur.workers += Number(g.count) || 0;
      cur.days += 1;
      map.set(name, cur);
    }
    return [...map.values()].sort((a, b) => b.hours - a.hours);
  }, [rows]);

  // פילוח לפי סטטוס — כמה מהשעות כבר שולמו וכמה עוד פתוחות
  const byStatus = useMemo(() => TEMP_STATUSES.map(s => {
    const of = rows.filter(g => (g.status || 'open') === s.value);
    return {
      ...s,
      days: of.length,
      workers: of.reduce((n, g) => n + (Number(g.count) || 0), 0),
      hours: of.reduce((n, g) => n + groupTotalHours(g), 0),
    };
  }).filter(s => s.days > 0), [rows]);

  const reportTitle = employerFilter === ALL ? 'כל המעסיקים' : employerFilter;

  const isHoursMode = form.entry_mode === 'hours';
  const durationHours = perWorkerHours(form);
  const previewHours = groupTotalHours(form);
  const crossesMidnight = !isHoursMode
    && toMinutes(form.to_time) !== null
    && toMinutes(form.from_time) !== null
    && toMinutes(form.to_time) < toMinutes(form.from_time);

  /**
   * איזה ערך בבורר מייצג את המעסיק של רישום קיים.
   * שם ידני שבינתיים נרשם כחברת כוח אדם לא נמצא ב-rememberedNames (הוא מסונן
   * משם כדי לא להופיע פעמיים), ולכן מיפוי עיוור ל-free: היה משאיר בורר ריק —
   * במקרה כזה בוחרים את החברה התואמת.
   */
  const employerValueFor = (g) => {
    if (g.employer_id) return g.employer_id;
    const name = (g.employer_name || '').trim();
    if (!name) return '';
    const match = companies.find(c => (c.name || '').trim() === name);
    return match ? match.id : FREE_PREFIX + name;
  };

  const openEdit = (g) => {
    setEditing(g);
    setForm({
      date: g.date || today,
      employer_id: employerValueFor(g),
      employer_name: g.employer_name || '',
      count: String(g.count ?? ''),
      entry_mode: g.entry_mode === 'hours' ? 'hours' : 'times',
      from_time: g.from_time || '07:00',
      to_time: g.to_time || '15:00',
      hours_per_worker: g.hours_per_worker != null ? String(g.hours_per_worker) : '',
      status: g.status || 'open',
      notes: g.notes || '',
    });
    setDialogOpen(true);
  };

  const onEmployerChange = (value) => {
    if (value === FREE_TEXT) {
      setForm(f => ({ ...f, employer_id: FREE_TEXT, employer_name: '' }));
    } else if (String(value).startsWith(FREE_PREFIX)) {
      // שם שהוזן ידנית בעבר — נבחר כמו שהוא, בלי לפתוח שדה טקסט
      setForm(f => ({ ...f, employer_id: value, employer_name: value.slice(FREE_PREFIX.length) }));
    } else {
      const c = companies.find(x => x.id === value);
      setForm(f => ({ ...f, employer_id: value, employer_name: c?.name || '' }));
    }
  };

  /** מעבר בין אופני ההזנה — ממלא את מצב השעות מהשעון כדי לא לאבד מה שכבר הוקלד */
  const switchMode = (mode) => {
    setForm(f => {
      if (f.entry_mode === mode) return f;
      if (mode === 'hours') {
        const h = shiftHours(f.from_time, f.to_time);
        return { ...f, entry_mode: 'hours', hours_per_worker: h > 0 ? String(Number(h.toFixed(2))) : '' };
      }
      return { ...f, entry_mode: 'times' };
    });
  };

  const validate = () => {
    if (!form.date) return 'חסר תאריך.';
    if (!form.employer_name.trim()) return 'צריך לבחור מעסיק או להקליד שם.';
    const n = Number(form.count);
    if (!Number.isInteger(n) || n <= 0) return 'כמות העובדים חייבת להיות מספר שלם גדול מאפס.';

    if (isHoursMode) {
      const h = Number(form.hours_per_worker);
      if (!Number.isFinite(h) || h <= 0) return 'מספר השעות לעובד חייב להיות גדול מאפס.';
      if (h > 24) return 'מספר השעות לעובד לא יכול לעלות על 24.';
    } else {
      if (toMinutes(form.from_time) === null) return 'שעת התחלה לא תקינה (פורמט HH:MM).';
      if (toMinutes(form.to_time) === null) return 'שעת סיום לא תקינה (פורמט HH:MM).';
      if (shiftHours(form.from_time, form.to_time) === 0) return 'שעת ההתחלה והסיום זהות — משך המשמרת אפס.';
    }
    return null;
  };

  const save = async () => {
    const err = validate();
    if (err) { toast({ title: 'לא ניתן לשמור', description: err, variant: 'destructive' }); return; }

    setSaving(true);
    try {
      const mode = isHoursMode ? 'hours' : 'times';
      const payload = {
        farm_id: farmId,
        date: form.date,
        employer_id: isFreeValue(form.employer_id) ? '' : form.employer_id,
        employer_name: form.employer_name.trim(),
        count: Number(form.count),
        entry_mode: mode,
        // רק שדות המצב שנבחר נשמרים — כך לא נשאר נתון סותר מהמצב השני
        from_time: mode === 'times' ? form.from_time : '',
        to_time:   mode === 'times' ? form.to_time : '',
        hours_per_worker: mode === 'hours' ? Number(form.hours_per_worker) : null,
        status: form.status,
        notes: form.notes.trim(),
      };
      if (editing) await TempWorkerGroup.update(editing.id, payload);
      else await TempWorkerGroup.create(payload);

      setDialogOpen(false);
      await load();
      toast({ title: editing ? 'הרישום עודכן' : 'הרישום נוסף' });
    } catch (e) {
      toast({
        title: 'השמירה נכשלה',
        description: e?.message || 'נסה שוב, ואם זה חוזר — בדוק שיש לך הרשאת עריכה בחווה.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    const target = deleting;
    setDeleting(null);
    if (!target) return;
    try {
      await TempWorkerGroup.delete(target.id);
      await load();
      toast({ title: 'הרישום נמחק' });
    } catch (e) {
      toast({ title: 'המחיקה נכשלה', description: e?.message || '', variant: 'destructive' });
    }
  };

  // ── ייצוא ודוח ────────────────────────────────────────────────────────────

  const exportCsv = () => {
    const head = ['תאריך', 'מעסיק', 'כמות עובדים', 'שעות לעובד', 'משעה', 'עד שעה', 'סה"כ שעות', 'סטטוס', 'הערה'];
    const body = [...rows].reverse().map(g => [
      fmtFullDate(g.date),
      employerOf(g),
      g.count ?? '',
      Number(perWorkerHours(g).toFixed(2)),
      g.entry_mode === 'hours' ? '' : (g.from_time || ''),
      g.entry_mode === 'hours' ? '' : (g.to_time || ''),
      Number(groupTotalHours(g).toFixed(2)),
      statusMeta(g.status).label,
      g.notes || '',
    ]);
    body.push([]);
    body.push(['סה"כ', reportTitle, totals.workers, '', '', '', Number(totals.hours.toFixed(2)), '', '']);

    const esc = (v) => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [head, ...body].map(r => r.map(esc).join(',')).join('\r\n');

    // BOM — בלי זה אקסל פותח עברית כג'יבריש
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `עובדים-זמניים_${reportTitle}_${month}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const printReport = () => {
    const esc = (s) => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    const bodyRows = [...rows].reverse().map(g => `
      <tr>
        <td>${esc(fmtFullDate(g.date))}</td>
        <td>${esc(employerOf(g))}</td>
        <td class="n">${esc(g.count)}</td>
        <td>${esc(hoursLabel(g))}</td>
        <td class="n">${esc(fmtHours(groupTotalHours(g)))}</td>
        <td>${esc(statusMeta(g.status).label)}</td>
      </tr>`).join('');

    const statusRows = byStatus.map(s => `
      <tr><td>${esc(s.label)}</td><td class="n">${s.days}</td><td class="n">${s.workers}</td><td class="n">${esc(fmtHours(s.hours))}</td></tr>
    `).join('');

    const html = `<!doctype html><html dir="rtl" lang="he"><head><meta charset="utf-8">
<title>דוח עובדים זמניים — ${esc(reportTitle)} — ${esc(monthLabel)}</title>
<style>
  body{font-family:Arial,Helvetica,sans-serif;margin:24px;color:#111}
  h1{font-size:18px;margin:0 0 4px}
  .sub{color:#555;font-size:13px;margin-bottom:16px}
  table{width:100%;border-collapse:collapse;margin-bottom:18px;font-size:13px}
  th,td{border:1px solid #ccc;padding:6px 8px;text-align:right}
  th{background:#f3f4f6}
  td.n,th.n{text-align:center}
  tfoot td{font-weight:bold;background:#f9fafb}
  h2{font-size:14px;margin:16px 0 6px}
  @media print{body{margin:0}}
</style></head><body>
<h1>דוח עובדים זמניים — ${esc(reportTitle)}</h1>
<div class="sub">${esc(monthLabel)} · הופק ${esc(format(new Date(), 'dd/MM/yyyy HH:mm'))}</div>
<table>
  <thead><tr><th>תאריך</th><th>מעסיק</th><th class="n">כמות</th><th>שעות</th><th class="n">סה"כ</th><th>סטטוס</th></tr></thead>
  <tbody>${bodyRows || '<tr><td colspan="6">אין רישומים</td></tr>'}</tbody>
  <tfoot><tr><td colspan="2">סה"כ</td><td class="n">${totals.workers}</td><td></td><td class="n">${esc(fmtHours(totals.hours))}</td><td></td></tr></tfoot>
</table>
${statusRows ? `<h2>פילוח לפי סטטוס</h2><table>
  <thead><tr><th>סטטוס</th><th class="n">ימים</th><th class="n">ימי-עובד</th><th class="n">שעות</th></tr></thead>
  <tbody>${statusRows}</tbody></table>` : ''}
${byEmployer.length > 1 ? `<h2>סיכום לפי מעסיק</h2><table>
  <thead><tr><th>מעסיק</th><th class="n">ימים</th><th class="n">ימי-עובד</th><th class="n">שעות</th></tr></thead>
  <tbody>${byEmployer.map(e => `<tr><td>${esc(e.name)}</td><td class="n">${e.days}</td><td class="n">${e.workers}</td><td class="n">${esc(fmtHours(e.hours))}</td></tr>`).join('')}</tbody></table>` : ''}
</body></html>`;

    // iframe ולא חלון חדש — חוסמי-פופאפ לא מפילים את זה
    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:fixed;left:-9999px;width:0;height:0;border:0';
    document.body.appendChild(iframe);
    const doc = iframe.contentWindow.document;
    doc.open(); doc.write(html); doc.close();
    iframe.contentWindow.focus();
    iframe.contentWindow.print();
    setTimeout(() => iframe.remove(), 2000);
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <p className="text-xs text-gray-500 flex-1 min-w-[220px]">
          עובדים זמניים מקבלן מוזנים כאן ידנית — הם אינם מחתימים בשעון ולא מופיעים בשאר הלשוניות.
          אפשר להזין שעון (משעה–עד שעה) או מספר שעות ישירות; סה"כ מחושב תמיד כשעות לעובד × כמות.
        </p>
        {canEdit && (
          <Button onClick={openNew} size="sm" className="flex items-center gap-1.5">
            <Plus className="w-4 h-4" />הוסף רישום
          </Button>
        )}
      </div>

      {/* ── סינון לפי מעסיק + דוח ── */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <Select value={employerFilter} onValueChange={setEmployerFilter}>
          <SelectTrigger className="w-52 h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>כל המעסיקים</SelectItem>
            {employersInMonth.map(name => <SelectItem key={name} value={name}>{name}</SelectItem>)}
          </SelectContent>
        </Select>

        <Button variant="outline" size="sm" onClick={() => setReportOpen(true)}
          disabled={rows.length === 0} className="flex items-center gap-1.5">
          <FileText className="w-4 h-4" />דוח סיכום
        </Button>

        {employerFilter !== ALL && (
          <Badge className="bg-indigo-100 text-indigo-700">מסונן: {employerFilter}</Badge>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-3 text-sm text-gray-600">
        <span className="font-medium text-gray-800">{monthLabel}</span>
        <span>·</span>
        <span>{rows.length} רישומים</span>
        <span>·</span>
        <span>{totals.workers} ימי-עובד</span>
        <span>·</span>
        <span className="font-semibold text-indigo-700 tabular-nums">{fmtHours(totals.hours)} שעות</span>
      </div>

      <Card>
        <CardContent className="p-0 divide-y">
          <div className="flex items-center gap-2 p-3 text-xs font-semibold text-gray-500 bg-gray-50">
            <span className="w-14">תאריך</span>
            <span className="flex-1 min-w-0">מעסיק</span>
            <span className="w-14 text-center">כמות</span>
            <span className="w-28 text-center hidden sm:block">שעות</span>
            <span className="w-20 text-center">סה"כ</span>
            <span className="w-20 text-center">סטטוס</span>
            {canEdit && <span className="w-16" />}
          </div>

          {isLoading && <p className="text-sm text-gray-400 p-4">טוען…</p>}

          {!isLoading && rows.length === 0 && (
            <div className="p-6 text-center">
              <HardHat className="w-8 h-8 text-gray-300 mx-auto mb-2" />
              <p className="text-sm text-gray-400">
                {employerFilter === ALL
                  ? 'אין רישומי עובדים זמניים לחודש זה.'
                  : `אין רישומים של ${employerFilter} בחודש זה.`}
              </p>
            </div>
          )}

          {!isLoading && rows.map(g => {
            const st = statusMeta(g.status);
            return (
              <div key={g.id} className="flex items-center gap-2 p-3">
                <span className="w-14 text-sm text-gray-600 tabular-nums">{fmtDate(g.date)}</span>
                <span className="flex-1 min-w-0 text-sm font-medium text-gray-800 truncate" title={g.employer_name}>
                  {g.employer_name || '—'}
                  {g.notes && <span className="block text-[11px] text-gray-400 truncate">{g.notes}</span>}
                </span>
                <span className="w-14 text-center text-sm tabular-nums text-gray-700">{g.count}</span>
                <span className="w-28 text-center text-xs text-gray-500 tabular-nums hidden sm:block">
                  {hoursLabel(g)}
                </span>
                <span className="w-20 text-center text-sm font-semibold tabular-nums text-indigo-700">
                  {fmtHours(groupTotalHours(g))}
                </span>
                <span className="w-20 text-center">
                  <Badge className={st.className}>{st.label}</Badge>
                </span>
                {canEdit && (
                  <span className="w-16 flex items-center justify-end gap-0.5">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(g)} title="ערוך">
                      <Pencil className="w-3.5 h-3.5 text-gray-500" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setDeleting(g)} title="מחק">
                      <Trash2 className="w-3.5 h-3.5 text-red-500" />
                    </Button>
                  </span>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {byEmployer.length > 1 && (
        <Card className="mt-4">
          <CardContent className="p-0 divide-y">
            <div className="flex items-center gap-2 p-3 text-xs font-semibold text-gray-500 bg-gray-50">
              <span className="flex-1">סיכום לפי מעסיק</span>
              <span className="w-16 text-center">ימים</span>
              <span className="w-20 text-center">ימי-עובד</span>
              <span className="w-20 text-center">שעות</span>
            </div>
            {byEmployer.map(e => (
              <button key={e.name} onClick={() => setEmployerFilter(e.name)}
                className="w-full flex items-center gap-2 p-3 text-right hover:bg-gray-50 transition-colors">
                <span className="flex-1 text-sm font-medium text-gray-800 truncate">{e.name}</span>
                <span className="w-16 text-center text-sm tabular-nums text-gray-600">{e.days}</span>
                <span className="w-20 text-center text-sm tabular-nums text-gray-600">{e.workers}</span>
                <span className="w-20 text-center text-sm font-semibold tabular-nums text-indigo-700">{fmtHours(e.hours)}</span>
              </button>
            ))}
          </CardContent>
        </Card>
      )}

      {/* ── דוח סיכום ── */}
      <Dialog open={reportOpen} onOpenChange={setReportOpen}>
        <DialogContent dir="rtl" className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>דוח סיכום — {reportTitle}</DialogTitle>
          </DialogHeader>

          <p className="text-xs text-gray-500 -mt-2">{monthLabel} · {rows.length} רישומים</p>

          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-lg bg-gray-50 p-3 text-center">
              <p className="text-xs text-gray-500">ימי עבודה</p>
              <p className="text-lg font-bold tabular-nums text-gray-800">{rows.length}</p>
            </div>
            <div className="rounded-lg bg-gray-50 p-3 text-center">
              <p className="text-xs text-gray-500">ימי-עובד</p>
              <p className="text-lg font-bold tabular-nums text-gray-800">{totals.workers}</p>
            </div>
            <div className="rounded-lg bg-indigo-50 p-3 text-center">
              <p className="text-xs text-indigo-700">סה"כ שעות</p>
              <p className="text-lg font-bold tabular-nums text-indigo-700">{fmtHours(totals.hours)}</p>
            </div>
          </div>

          {byStatus.length > 0 && (
            <div>
              <p className="text-sm font-semibold text-gray-700 mb-1.5">פילוח לפי סטטוס</p>
              <div className="rounded-lg border divide-y">
                {byStatus.map(s => (
                  <div key={s.value} className="flex items-center gap-2 px-3 py-2">
                    <span className="flex-1"><Badge className={s.className}>{s.label}</Badge></span>
                    <span className="w-16 text-center text-sm tabular-nums text-gray-600">{s.days} ימים</span>
                    <span className="w-24 text-center text-sm font-semibold tabular-nums text-gray-800">{fmtHours(s.hours)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <p className="text-sm font-semibold text-gray-700 mb-1.5">פירוט</p>
            <div className="rounded-lg border divide-y max-h-64 overflow-y-auto">
              {[...rows].reverse().map(g => (
                <div key={g.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <span className="w-14 text-gray-600 tabular-nums">{fmtDate(g.date)}</span>
                  {employerFilter === ALL && (
                    <span className="flex-1 min-w-0 truncate text-gray-700">{employerOf(g)}</span>
                  )}
                  <span className="w-12 text-center tabular-nums text-gray-600">×{g.count}</span>
                  <span className="flex-1 text-center text-xs text-gray-500 tabular-nums">{hoursLabel(g)}</span>
                  <span className="w-16 text-center font-semibold tabular-nums text-indigo-700">{fmtHours(groupTotalHours(g))}</span>
                </div>
              ))}
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={exportCsv} className="flex items-center gap-1.5">
              <Download className="w-4 h-4" />ייצוא CSV
            </Button>
            <Button onClick={printReport} className="flex items-center gap-1.5">
              <Printer className="w-4 h-4" />הדפס
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── טופס הוספה / עריכה ── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent dir="rtl" className="sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? 'עריכת רישום' : 'רישום עובדים זמניים'}</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div>
              <Label htmlFor="tw-date">תאריך *</Label>
              <Input id="tw-date" type="date" value={form.date}
                onChange={(e) => setForm(f => ({ ...f, date: e.target.value }))} />
            </div>

            <div>
              <Label>מעסיק *</Label>
              <Select value={form.employer_id || undefined} onValueChange={onEmployerChange}>
                <SelectTrigger><SelectValue placeholder="בחר חברת כוח אדם" /></SelectTrigger>
                <SelectContent>
                  {companies.length > 0 && (
                    <SelectGroup>
                      <SelectLabel>חברות כוח אדם</SelectLabel>
                      {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                    </SelectGroup>
                  )}
                  {rememberedNames.length > 0 && (
                    <>
                      {companies.length > 0 && <SelectSeparator />}
                      <SelectGroup>
                        <SelectLabel>שמות שהוזנו קודם</SelectLabel>
                        {rememberedNames.map(name => (
                          <SelectItem key={name} value={FREE_PREFIX + name}>{name}</SelectItem>
                        ))}
                      </SelectGroup>
                    </>
                  )}
                  {(companies.length > 0 || rememberedNames.length > 0) && <SelectSeparator />}
                  <SelectItem value={FREE_TEXT}>אחר (הקלדה חופשית)…</SelectItem>
                </SelectContent>
              </Select>
              {form.employer_id === FREE_TEXT && (
                <>
                  <Input
                    className="mt-2"
                    placeholder="שם המעסיק"
                    value={form.employer_name}
                    onChange={(e) => setForm(f => ({ ...f, employer_name: e.target.value }))}
                  />
                  <p className="text-[11px] text-gray-400 mt-1">
                    השם יישמר וייכנס לרשימה לרישומים הבאים.
                  </p>
                </>
              )}
            </div>

            <div>
              <Label htmlFor="tw-count">כמות עובדים *</Label>
              <Input id="tw-count" type="number" min="1" step="1" inputMode="numeric"
                value={form.count}
                onChange={(e) => setForm(f => ({ ...f, count: e.target.value }))} />
            </div>

            {/* ── בחירת אופן הזנת השעות ── */}
            <div>
              <Label>אופן הזנת השעות</Label>
              <div className="grid grid-cols-2 gap-2 mt-1">
                <Button type="button" size="sm" className="h-9"
                  variant={!isHoursMode ? 'default' : 'outline'}
                  onClick={() => switchMode('times')}>
                  משעה – עד שעה
                </Button>
                <Button type="button" size="sm" className="h-9"
                  variant={isHoursMode ? 'default' : 'outline'}
                  onClick={() => switchMode('hours')}>
                  מספר שעות
                </Button>
              </div>
            </div>

            {!isHoursMode ? (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label htmlFor="tw-from">משעה *</Label>
                  <Input id="tw-from" type="time" value={form.from_time}
                    onChange={(e) => setForm(f => ({ ...f, from_time: e.target.value }))} />
                </div>
                <div>
                  <Label htmlFor="tw-to">עד שעה *</Label>
                  <Input id="tw-to" type="time" value={form.to_time}
                    onChange={(e) => setForm(f => ({ ...f, to_time: e.target.value }))} />
                </div>
              </div>
            ) : (
              <div>
                <Label htmlFor="tw-hours">שעות לעובד *</Label>
                <Input id="tw-hours" type="number" min="0" max="24" step="0.25" inputMode="decimal"
                  placeholder="למשל 8 או 7.5"
                  value={form.hours_per_worker}
                  onChange={(e) => setForm(f => ({ ...f, hours_per_worker: e.target.value }))} />
              </div>
            )}

            <div className="rounded-lg bg-indigo-50 px-3 py-2 text-sm text-indigo-900">
              סה"כ שעות: <span className="font-semibold tabular-nums">{fmtHours(previewHours)}</span>
              <span className="text-xs text-indigo-700">
                {' '}({fmtHours(durationHours)} לעובד × {Number(form.count) || 0} עובדים)
              </span>
              {crossesMidnight && (
                <span className="block text-[11px] text-indigo-700 mt-0.5">משמרת חוצה חצות — נספרת עד למחרת.</span>
              )}
            </div>

            <div>
              <Label>סטטוס</Label>
              <Select value={form.status} onValueChange={(v) => setForm(f => ({ ...f, status: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TEMP_STATUSES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="tw-notes">הערה</Label>
              <Input id="tw-notes" value={form.notes} placeholder="לא חובה"
                onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>ביטול</Button>
            <Button onClick={save} disabled={saving}>{saving ? 'שומר…' : 'שמור'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>למחוק את הרישום?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting && `${deleting.employer_name} · ${deleting.count} עובדים · ${fmtDate(deleting.date)}`}
              {' '}— הפעולה אינה הפיכה.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel>ביטול</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-red-600 hover:bg-red-700">מחק</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
