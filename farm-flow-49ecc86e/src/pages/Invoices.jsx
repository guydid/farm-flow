import React, { useState, useEffect, useMemo, useCallback, useRef, lazy, Suspense } from 'react';
import { Invoice, Supplier, User } from '@/entities/all';
import { getMeCached } from '@/api/cachedReads';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { getToken } from '@/api/localClient';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import {
  Plus, Search, FileText, Camera, Upload, Loader2, Mail,
  CheckCircle2, Clock, AlertTriangle, SlidersHorizontal, ChevronDown, ChevronUp,
  RefreshCw, Trash2, Send, CheckSquare, Square, X, Ban, List, LayoutGrid
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { useToast } from '@/components/ui/use-toast';
// Lazy — react-image-crop only loads when the user actually crops an image
const CropDialog = lazy(() => import('@/components/invoices/CropDialog'));

const BASE_URL = import.meta.env.VITE_API_URL || '/api';

const STATUS_LABEL = {
  pending: 'ממתין לבדיקה',
  reviewed: 'נבדק',
  approved: 'מאושר',
  rejected: 'נדחה',
};
const STATUS_COLOR = {
  pending: 'bg-amber-100 text-amber-700 border-amber-200',
  reviewed: 'bg-blue-100 text-blue-700 border-blue-200',
  approved: 'bg-green-100 text-green-700 border-green-200',
  rejected: 'bg-red-100 text-red-700 border-red-200',
};
const SOURCE_LABEL = { upload: 'העלאה', gmail: 'Gmail', manual: 'ידני' };

// שמות חודשים קשיחים ולא locale של date-fns — נמנע מתלות בטעינת locale שאולי לא מותקן
const MONTH_NAMES = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

function fmtCurrency(n, c) {
  if (n === null || n === undefined || isNaN(Number(n))) return '—';
  const sign = c === 'USD' ? '$' : c === 'EUR' ? '€' : '₪';
  return `${sign}${Number(n).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// מקטין תמונה בדפדפן לפני העלאה — צילום מהנייד יכול להיות 2-5MB, וההעלאה בחיבור
// סלולרי איטית. מורידים ל-1568px ו-JPEG כדי שההעלאה תהיה ~300KB ומהירה.
// PDF וקבצים שאינם תמונה נשלחים כמו שהם. הדפדפן מיישם אוריינטציית EXIF בעת הציור.
async function downscaleImage(file) {
  if (!file || !file.type || !file.type.startsWith('image/')) return file;
  if (file.size < 600 * 1024) return file; // קטן מספיק — לא נוגעים (שמירה על איכות)
  try {
    const dataUrl = await new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.onerror = rej;
      fr.readAsDataURL(file);
    });
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = dataUrl;
    });
    const maxSide = 1568;
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
    const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.82));
    if (!blob) return file;
    const baseName = (file.name || 'invoice').replace(/\.[^.]+$/, '');
    return new File([blob], `${baseName}.jpg`, { type: 'image/jpeg' });
  } catch {
    return file; // נכשל — נשלח את המקור
  }
}

export default function Invoices() {
  const location = useLocation();
  const navigate = useNavigate();
  const [invoices, setInvoices] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [supplierFilter, setSupplierFilter] = useState(new URLSearchParams(location.search).get('supplier_id') || 'all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [cropFile, setCropFile] = useState(null);
  const [view, setView] = useState(() => {
    try { return localStorage.getItem('invoices_view') === 'gallery' ? 'gallery' : 'list'; } catch { return 'list'; }
  });
  const [lightbox, setLightbox] = useState(null); // החשבונית שמוצגת בתצוגה מוגדלת
  const [collapsedMonths, setCollapsedMonths] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('invoices_collapsed_months') || '[]')); } catch { return new Set(); }
  });
  const fileRef = useRef(null);
  const cameraRef = useRef(null);
  const { toast } = useToast();

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const user = await getMeCached();
      if (!user?.current_farm_id) return;
      const [invList, supList] = await Promise.all([
        Invoice.filter({ farm_id: user.current_farm_id }),
        Supplier.filter({ farm_id: user.current_farm_id }),
      ]);
      setInvoices((Array.isArray(invList) ? invList : []).sort((a, b) => String(b.date || b.created_at).localeCompare(String(a.date || a.created_at))));
      setSuppliers(Array.isArray(supList) ? supList : []);
    } catch (e) {
      console.error(e);
      toast({ title: 'שגיאה בטעינה', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  // Auto-open camera when invoked from quick-action FAB (?scan=true)
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('scan') === 'true') {
      // Mobile: prefer camera; otherwise file picker
      const isMobile = typeof window !== 'undefined' && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
      setTimeout(() => {
        if (isMobile) cameraRef.current?.click();
        else fileRef.current?.click();
      }, 80);
      // Strip param so re-renders don't re-trigger
      const url = new URL(window.location);
      url.searchParams.delete('scan');
      window.history.replaceState({}, '', url);
    }
  }, [location.search]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return invoices.filter(inv => {
      if (supplierFilter !== 'all' && inv.supplier_id !== supplierFilter) return false;
      if (statusFilter !== 'all' && (inv.status || 'pending') !== statusFilter) return false;
      if (sourceFilter !== 'all' && inv.source !== sourceFilter) return false;
      if (!s) return true;
      return (
        String(inv.invoice_number || '').toLowerCase().includes(s) ||
        String(inv.supplier_name || '').toLowerCase().includes(s) ||
        String(inv.notes || '').toLowerCase().includes(s)
      );
    });
  }, [invoices, search, supplierFilter, statusFilter, sourceFilter]);

  // קיבוץ לחודשים. הרשימה כבר ממוינת יורד לפי תאריך, כך שהסדר בתוך כל חודש נשמר.
  // סכום נצבר לפי מטבע — חיבור שקלים לדולרים לכותרת אחת היה נותן מספר חסר משמעות.
  const grouped = useMemo(() => {
    const map = new Map();
    for (const inv of filtered) {
      const raw = inv.date || inv.created_at;
      const d = raw ? new Date(raw) : null;
      const valid = d && !isNaN(d.getTime());
      const key = valid ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` : 'unknown';
      const label = valid ? `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}` : 'ללא תאריך';
      if (!map.has(key)) map.set(key, { key, label, items: [], totals: {} });
      const g = map.get(key);
      g.items.push(inv);
      if (typeof inv.total === 'number' && !isNaN(inv.total)) {
        const c = inv.currency || 'ILS';
        g.totals[c] = (g.totals[c] || 0) + inv.total;
      }
    }
    return [...map.values()].sort((a, b) => {
      if (a.key === 'unknown') return 1;
      if (b.key === 'unknown') return -1;
      return b.key.localeCompare(a.key); // חודש אחרון קודם
    });
  }, [filtered]);

  const toggleMonth = (key) => {
    setCollapsedMonths(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      try { localStorage.setItem('invoices_collapsed_months', JSON.stringify([...next])); } catch { /* מצב פרטי */ }
      return next;
    });
  };

  const allCollapsed = grouped.length > 0 && grouped.every(g => collapsedMonths.has(g.key));
  const toggleAllMonths = () => {
    const next = allCollapsed ? new Set() : new Set(grouped.map(g => g.key));
    setCollapsedMonths(next);
    try { localStorage.setItem('invoices_collapsed_months', JSON.stringify([...next])); } catch { /* מצב פרטי */ }
  };

  const selectMonth = (group) => {
    setSelected(prev => {
      const next = new Set(prev);
      const allIn = group.items.every(i => next.has(i.id));
      for (const i of group.items) { if (allIn) next.delete(i.id); else next.add(i.id); }
      return next;
    });
  };

  const supplierName = (id) => suppliers.find(s => s.id === id)?.name || '—';

  // פונקציה ולא קומפוננטה: קומפוננטה שמוגדרת בתוך render היא טיפוס חדש בכל רינדור,
  // ו-React היה מפרק ובונה מחדש את הכותרת בכל שינוי סטייט.
  const renderMonthHeader = (group) => {
    const isCollapsed = collapsedMonths.has(group.key);
    const allIn = selectMode && group.items.every(i => selected.has(i.id));
    return (
      <div className="flex items-center gap-2 sticky top-0 z-10 bg-gray-50/95 backdrop-blur-sm py-2">
        {selectMode && (
          <button
            onClick={() => selectMonth(group)}
            className="text-indigo-600 flex-shrink-0"
            title={allIn ? 'בטל בחירת החודש' : 'בחר את כל החודש'}
          >
            {allIn ? <CheckSquare className="w-5 h-5" /> : <Square className="w-5 h-5 text-gray-300" />}
          </button>
        )}
        <button
          onClick={() => toggleMonth(group.key)}
          className="flex items-center gap-2 flex-1 min-w-0 text-right"
        >
          {isCollapsed ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronUp className="w-4 h-4 text-gray-400" />}
          <span className="font-semibold text-gray-800">{group.label}</span>
          <Badge variant="outline" className="text-xs">{group.items.length}</Badge>
          <span className="flex-1" />
          <span className="text-sm font-bold text-gray-700 whitespace-nowrap">
            {Object.entries(group.totals).map(([c, v]) => fmtCurrency(v, c)).join(' · ') || '—'}
          </span>
        </button>
      </div>
    );
  };

  const switchView = (v) => {
    setView(v);
    try { localStorage.setItem('invoices_view', v); } catch { /* מצב פרטי — לא קריטי */ }
  };

  // הממוזערת מיוצרת ונשמרת במטמון בשרת; PDF מרונדר לעמוד 1. w=400 לרשת, w=1200 לתצוגה מוגדלת.
  const thumbUrl = (inv, w = 400) =>
    inv.file_name ? `${BASE_URL}/files/thumb/${encodeURIComponent(inv.file_name)}?w=${w}&token=${getToken()}` : null;
  const fileUrl = (inv) =>
    inv.file_name ? `${BASE_URL.replace(/\/api$/, '')}/uploads/${encodeURIComponent(inv.file_name)}?token=${getToken()}` : null;

  // תמונה → פותחים מסך קרופ קודם; PDF/אחר → ישר לסריקה
  const handlePicked = (file) => {
    if (fileRef.current) fileRef.current.value = '';
    if (cameraRef.current) cameraRef.current.value = '';
    if (!file) return;
    if (file.type && file.type.startsWith('image/')) setCropFile(file);
    else uploadAndScan(file);
  };

  const uploadAndScan = async (file) => {
    if (!file) return;
    setScanning(true);
    try {
      const toSend = await downscaleImage(file); // הקטנה בדפדפן לפני העלאה (מהיר בנייד)
      const fd = new FormData();
      fd.append('file', toSend);
      const res = await fetch(`${BASE_URL}/invoices/scan`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}` },
        body: fd,
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);
      const invId = data.invoice.id;
      const createdDesc = `סופק: ${data.supplier?.name || '—'} · סה"כ: ${fmtCurrency(data.extracted?.total, data.extracted?.currency)}`;

      // שליחה אוטומטית למנהלת החשבונות (אם הוגדרה כתובת ברירת מחדל ושליחה אוטומטית פעילה)
      let sentTo = null, sendError = null, attempted = false;
      try {
        const settings = await fetch(`${BASE_URL}/settings/bookkeeper`, {
          headers: { Authorization: `Bearer ${getToken()}` },
        }).then(r => r.json());
        if (settings?.recipient_email && settings.auto_send !== false) {
          attempted = true;
          const sres = await fetch(`${BASE_URL}/invoices/${invId}/send`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
            body: JSON.stringify({}),
          });
          const sdata = await sres.json().catch(() => ({}));
          if (sres.ok && sdata.success) sentTo = sdata.to;
          else sendError = sdata.error || `HTTP ${sres.status}`;
        }
      } catch (e) {
        attempted = true;
        sendError = e.message;
      }

      if (sentTo) {
        toast({ title: 'נסרק ונשלח למנהלת החשבונות', description: sentTo });
      } else if (attempted && sendError) {
        toast({ title: 'נסרק — השליחה האוטומטית נכשלה', description: sendError, variant: 'destructive' });
      } else {
        toast({ title: 'חשבונית נוצרה', description: createdDesc });
      }
      navigate(`${createPageUrl('InvoiceDetail')}?id=${invId}`);
    } catch (e) {
      console.error(e);
      toast({ title: 'הסריקה נכשלה', description: e.message, variant: 'destructive' });
    } finally {
      setScanning(false);
      if (fileRef.current) fileRef.current.value = '';
      if (cameraRef.current) cameraRef.current.value = '';
    }
  };

  const syncGmail = async () => {
    setSyncing(true);
    try {
      const res = await fetch(`${BASE_URL}/gmail/sync`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        const err = new Error(data.error || `HTTP ${res.status}`);
        err.needsReauth = !!data.needs_reauth;
        throw err;
      }
      // השרת סורק ברקע (ראה ההערה ב-POST /api/gmail/sync) — מתשאלים סטטוס עד לסיום
      const deadline = Date.now() + 15 * 60 * 1000;
      let st;
      do {
        const sr = await fetch(`${BASE_URL}/gmail/status`, { headers: { Authorization: `Bearer ${getToken()}` } });
        st = await sr.json();
        setSyncStatus(st);
        if (!st?.syncing) break;
        await new Promise(r => setTimeout(r, 2000));
      } while (Date.now() < deadline);

      if (st?.last_sync_result && !st.syncing) {
        const r = st.last_sync_result;
        toast({ title: 'סנכרון Gmail הושלם', description: `נסרקו ${r.scanned}, נשמרו ${r.saved}, דולגו ${r.skipped}` });
      }
      await load();
    } catch (e) {
      toast({
        title: e.needsReauth ? 'חיבור Gmail פג תוקף' : 'סנכרון נכשל',
        description: e.needsReauth ? 'עבור להגדרות ← Gmail וחבר מחדש את החשבון.' : e.message,
        variant: 'destructive',
      });
    } finally {
      setSyncing(false);
    }
  };

  // ─── בחירה מרובה ─────────────────────────────────────────────────────────
  const toggleSelect = (id) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const exitSelect = () => { setSelectMode(false); setSelected(new Set()); };
  const allFilteredSelected = filtered.length > 0 && filtered.every(inv => selected.has(inv.id));
  const toggleSelectAll = () => {
    setSelected(allFilteredSelected ? new Set() : new Set(filtered.map(inv => inv.id)));
  };

  // "לא חשבונית" — מוחק, מונע חזרה בסריקה הבאה, ולומד כלל (שולח + תבנית שם קובץ)
  const markNotInvoice = async (inv) => {
    try {
      const res = await fetch(`${BASE_URL}/invoices/${inv.id}/not-invoice`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      toast({
        title: 'סומן כלא-חשבונית',
        description: data.rule
          ? `נלמד כלל: קבצים בתבנית ${data.rule.filename_pattern} מ-${data.rule.from_email || 'כל שולח'} ידולגו בסריקות הבאות.`
          : 'הרשומה נמחקה.',
      });
      await load();
    } catch (e) {
      toast({ title: 'הפעולה נכשלה', description: e.message, variant: 'destructive' });
    }
  };

  const bulkNotInvoice = async () => {
    const ids = [...selected];
    if (!ids.length) return;
    if (!confirm(`לסמן ${ids.length} רשומות כלא-חשבוניות? הן יימחקו והמערכת תלמד לדלג עליהן.`)) return;
    setBulkBusy(true);
    let ok = 0, fail = 0;
    for (const id of ids) {
      try {
        const res = await fetch(`${BASE_URL}/invoices/${id}/not-invoice`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${getToken()}` },
        });
        if (!res.ok) throw new Error();
        ok++;
      } catch { fail++; }
    }
    setBulkBusy(false);
    toast({
      title: `${ok} סומנו כלא-חשבוניות`,
      description: fail ? `${fail} נכשלו` : 'הכללים נלמדו — סריקות עתידיות ידלגו עליהן.',
      variant: fail ? 'destructive' : undefined,
    });
    exitSelect();
    await load();
  };

  const bulkDelete = async () => {
    const ids = [...selected];
    if (!ids.length) return;
    if (!confirm(`למחוק ${ids.length} חשבוניות? פעולה זו אינה הפיכה.`)) return;
    setBulkBusy(true);
    let ok = 0, fail = 0;
    for (const id of ids) {
      try { await Invoice.delete(id); ok++; } catch { fail++; }
    }
    setBulkBusy(false);
    toast({
      title: `נמחקו ${ok} חשבוניות`,
      description: fail ? `${fail} נכשלו` : undefined,
      variant: fail ? 'destructive' : undefined,
    });
    exitSelect();
    await load();
  };

  const bulkSend = async () => {
    const ids = [...selected];
    if (!ids.length) return;
    if (!confirm(`לשלוח ${ids.length} חשבוניות למנהלת החשבונות?`)) return;
    setBulkBusy(true);
    let ok = 0, fail = 0, firstErr = '';
    for (const id of ids) {
      try {
        const res = await fetch(`${BASE_URL}/invoices/${id}/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
          body: JSON.stringify({}),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.success) ok++;
        else { fail++; if (!firstErr) firstErr = data.error || `HTTP ${res.status}`; }
      } catch (e) { fail++; if (!firstErr) firstErr = e.message; }
    }
    setBulkBusy(false);
    toast({
      title: `נשלחו ${ok} חשבוניות`,
      description: fail ? `${fail} נכשלו · ${firstErr}` : undefined,
      variant: fail ? 'destructive' : undefined,
    });
    exitSelect();
    await load();
  };

  if (isLoading) {
    return <div className="flex items-center justify-center h-64"><Loader2 className="w-6 h-6 animate-spin text-indigo-600" /></div>;
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 bg-gray-50/50 min-h-screen" dir="rtl">
      <div className="max-w-screen-2xl mx-auto">
        {/* Header */}
        {syncStatus?.syncing && (
          <div className="mb-4 p-3 rounded-lg bg-indigo-50 border border-indigo-100 space-y-2">
            <div className="flex items-center gap-2 text-sm text-indigo-800">
              <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />
              <span className="font-medium">סורק את תיבת הדואר…</span>
            </div>
            <Progress
              value={syncStatus.progress?.total
                ? Math.min(100, Math.round((syncStatus.progress.scanned / syncStatus.progress.total) * 100))
                : 0}
              className="h-2"
            />
            <div className="flex justify-between text-xs text-indigo-700">
              <span>
                נסרקו {syncStatus.progress?.scanned ?? 0}
                {syncStatus.progress?.total ? ` מתוך ~${syncStatus.progress.total}` : ''}
              </span>
              <span>נשמרו {syncStatus.progress?.saved ?? 0} · דולגו {syncStatus.progress?.skipped ?? 0}</span>
            </div>
          </div>
        )}

        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">חשבוניות ספקים</h1>
            <p className="text-sm text-gray-500 mt-1">{filtered.length} מתוך {invoices.length} חשבוניות</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <div className="flex rounded-lg border overflow-hidden">
              <button
                onClick={() => switchView('list')}
                className={`px-2.5 py-2 ${view === 'list' ? 'bg-indigo-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}
                title="תצוגת רשימה"
              >
                <List className="w-4 h-4" />
              </button>
              <button
                onClick={() => switchView('gallery')}
                className={`px-2.5 py-2 ${view === 'gallery' ? 'bg-indigo-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}
                title="תצוגת גלריה"
              >
                <LayoutGrid className="w-4 h-4" />
              </button>
            </div>
            {filtered.length > 0 && (
              selectMode ? (
                <Button onClick={exitSelect} variant="outline" className="flex items-center gap-1.5">
                  <X className="w-4 h-4" /> בטל בחירה
                </Button>
              ) : (
                <Button onClick={() => setSelectMode(true)} variant="outline" className="flex items-center gap-1.5">
                  <CheckSquare className="w-4 h-4" /> בחר
                </Button>
              )
            )}
            <Button onClick={syncGmail} variant="outline" disabled={syncing} className="flex items-center gap-1.5">
              {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
              <span className="hidden sm:inline">סנכרן Gmail</span>
            </Button>
            <Button onClick={() => cameraRef.current?.click()} variant="outline" disabled={scanning} className="flex items-center gap-1.5 sm:hidden">
              <Camera className="w-4 h-4" />
              צלם
            </Button>
            <Button onClick={() => fileRef.current?.click()} disabled={scanning} className="flex items-center gap-1.5">
              {scanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              סרוק חשבונית
            </Button>
          </div>
        </div>
        <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={e => handlePicked(e.target.files?.[0])} />
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={e => handlePicked(e.target.files?.[0])} />

        {scanning && (
          <Card className="mb-4 border-indigo-200 bg-indigo-50">
            <CardContent className="p-4 flex items-center gap-3">
              <Loader2 className="w-5 h-5 animate-spin text-indigo-600" />
              <div className="text-sm">
                <p className="font-medium text-indigo-900">מחלץ נתונים מהחשבונית...</p>
                <p className="text-indigo-700 text-xs">עוצר עד 30 שניות. אל תסגור את החלון.</p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Mobile filters toggle */}
        <div className="sm:hidden mb-4">
          <button onClick={() => setFiltersOpen(o => !o)} className="w-full flex items-center justify-between px-3 py-2 rounded-xl bg-gray-100 border border-gray-200 text-sm font-medium text-gray-700">
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="w-4 h-4 text-gray-500" />
              סינון וחיפוש
            </div>
            {filtersOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>

        {/* Filters */}
        <Card className={`mb-4 ${filtersOpen ? '' : 'hidden'} sm:block`}>
          <CardContent className="p-3 sm:p-4">
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div className="relative sm:col-span-2">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="חיפוש לפי מספר/ספק/הערה" className="pr-9" />
              </div>
              <Select value={supplierFilter} onValueChange={setSupplierFilter}>
                <SelectTrigger><SelectValue placeholder="ספק" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">כל הספקים</SelectItem>
                  {suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger><SelectValue placeholder="סטטוס" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">כל הסטטוסים</SelectItem>
                  <SelectItem value="pending">{STATUS_LABEL.pending}</SelectItem>
                  <SelectItem value="reviewed">{STATUS_LABEL.reviewed}</SelectItem>
                  <SelectItem value="approved">{STATUS_LABEL.approved}</SelectItem>
                  <SelectItem value="rejected">{STATUS_LABEL.rejected}</SelectItem>
                </SelectContent>
              </Select>
              <Select value={sourceFilter} onValueChange={setSourceFilter}>
                <SelectTrigger><SelectValue placeholder="מקור" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">כל המקורות</SelectItem>
                  <SelectItem value="upload">העלאה</SelectItem>
                  <SelectItem value="gmail">Gmail</SelectItem>
                  <SelectItem value="manual">ידני</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* List */}
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400">
            <FileText className="w-12 h-12 mb-3" />
            <p className="text-sm">אין חשבוניות תואמות</p>
          </div>
        ) : view === 'gallery' ? (
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              {selectMode && (
                <button onClick={toggleSelectAll} className="flex items-center gap-2 py-2 text-sm font-medium text-indigo-700">
                  {allFilteredSelected ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                  {allFilteredSelected ? 'בטל בחירת הכל' : `בחר הכל (${filtered.length})`}
                </button>
              )}
              <span className="flex-1" />
              <button onClick={toggleAllMonths} className="py-2 text-sm text-gray-500 hover:text-gray-800">
                {allCollapsed ? 'הרחב הכל' : 'כווץ הכל'}
              </button>
            </div>
            {grouped.map(group => (
              <div key={group.key}>
                {renderMonthHeader(group)}
                {!collapsedMonths.has(group.key) && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 pb-2">
              {group.items.map(inv => {
                const isSel = selected.has(inv.id);
                const src = thumbUrl(inv);
                return (
                  <div
                    key={inv.id}
                    onClick={() => (selectMode ? toggleSelect(inv.id) : setLightbox(inv))}
                    className={`group relative rounded-xl border bg-white overflow-hidden cursor-pointer transition-shadow hover:shadow-md ${isSel ? 'ring-2 ring-indigo-500' : ''}`}
                  >
                    <div className="aspect-[3/4] bg-gray-100 flex items-center justify-center overflow-hidden">
                      {src ? (
                        <img
                          src={src}
                          alt={inv.supplier_name || 'מסמך'}
                          loading="lazy"
                          className="w-full h-full object-cover object-top"
                          onError={(e) => { e.currentTarget.style.display = 'none'; }}
                        />
                      ) : (
                        <FileText className="w-10 h-10 text-gray-300" />
                      )}
                    </div>

                    {selectMode && (
                      <div className="absolute top-2 right-2 bg-white/90 rounded-md p-0.5 text-indigo-600 shadow">
                        {isSel ? <CheckSquare className="w-5 h-5" /> : <Square className="w-5 h-5 text-gray-300" />}
                      </div>
                    )}
                    <Badge className={`absolute top-2 left-2 text-xs ${STATUS_COLOR[inv.status || 'pending']}`}>
                      {STATUS_LABEL[inv.status || 'pending']}
                    </Badge>

                    <div className="p-2">
                      <p className="text-sm font-semibold text-gray-900 truncate">
                        {inv.supplier_name || supplierName(inv.supplier_id)}
                      </p>
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-sm font-bold text-gray-900">{fmtCurrency(inv.total, inv.currency)}</span>
                        {inv.date && (
                          <span className="text-xs text-gray-400">
                            {(() => { try { return format(parseISO(inv.date), 'dd/MM/yy'); } catch { return inv.date; } })()}
                          </span>
                        )}
                      </div>
                      {!selectMode && (
                        <div className="flex items-center justify-between mt-1">
                          <Link
                            to={`${createPageUrl('InvoiceDetail')}?id=${inv.id}`}
                            onClick={(e) => e.stopPropagation()}
                            className="text-xs text-indigo-600 hover:underline"
                          >
                            פרטים
                          </Link>
                          {inv.source === 'gmail' && (
                            <button
                              onClick={(e) => { e.preventDefault(); e.stopPropagation(); markNotInvoice(inv); }}
                              className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-red-600"
                              title="הקובץ אינו חשבונית"
                            >
                              <Ban className="w-3 h-3" /> לא חשבונית
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              {selectMode && (
                <button onClick={toggleSelectAll} className="flex items-center gap-2 py-2 text-sm font-medium text-indigo-700">
                  {allFilteredSelected ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                  {allFilteredSelected ? 'בטל בחירת הכל' : `בחר הכל (${filtered.length})`}
                </button>
              )}
              <span className="flex-1" />
              <button onClick={toggleAllMonths} className="py-2 text-sm text-gray-500 hover:text-gray-800">
                {allCollapsed ? 'הרחב הכל' : 'כווץ הכל'}
              </button>
            </div>
            {grouped.map(group => (
              <div key={group.key} className="space-y-2">
                {renderMonthHeader(group)}
                {!collapsedMonths.has(group.key) && group.items.map(inv => {
              const status = inv.status || 'pending';
              const isSel = selected.has(inv.id);
              const cardInner = (
                <Card className={`transition-shadow ${selectMode ? (isSel ? 'ring-2 ring-indigo-500 bg-indigo-50/40' : 'hover:bg-gray-50') : 'hover:shadow-md active:bg-gray-50'}`}>
                  <CardContent className="p-3 sm:p-4">
                    <div className="flex items-start gap-3">
                      {selectMode && (
                        <div className="pt-0.5 flex-shrink-0 text-indigo-600">
                          {isSel ? <CheckSquare className="w-5 h-5" /> : <Square className="w-5 h-5 text-gray-300" />}
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <h3 className="font-semibold text-gray-900 truncate">{inv.supplier_name || supplierName(inv.supplier_id)}</h3>
                          <Badge className={`text-xs ${STATUS_COLOR[status]}`}>{STATUS_LABEL[status]}</Badge>
                          {inv.source === 'gmail' && <Badge variant="outline" className="text-xs"><Mail className="w-3 h-3 ml-1" />{SOURCE_LABEL[inv.source]}</Badge>}
                          {inv.sent_to_bookkeeper_at && <Badge className="text-xs bg-green-100 text-green-700 border-green-200"><Mail className="w-3 h-3 ml-1" />נשלח</Badge>}
                        </div>
                        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-500">
                          {inv.invoice_number && <span>מס׳ {inv.invoice_number}</span>}
                          {inv.date && <span>{(() => { try { return format(parseISO(inv.date), 'dd/MM/yyyy'); } catch { return inv.date; } })()}</span>}
                          {inv.due_date && <span className="text-amber-600">פירעון {(() => { try { return format(parseISO(inv.due_date), 'dd/MM/yyyy'); } catch { return inv.due_date; } })()}</span>}
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-lg font-bold text-gray-900">{fmtCurrency(inv.total, inv.currency)}</p>
                        {inv.vat_amount != null && <p className="text-xs text-gray-500">מע"מ {fmtCurrency(inv.vat_amount, inv.currency)}</p>}
                        {!selectMode && inv.source === 'gmail' && (
                          <button
                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); markNotInvoice(inv); }}
                            className="mt-1 inline-flex items-center gap-1 text-xs text-gray-400 hover:text-red-600 transition-colors"
                            title="הקובץ אינו חשבונית — מחק ולמד לדלג עליו בעתיד"
                          >
                            <Ban className="w-3 h-3" /> לא חשבונית
                          </button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
              return selectMode ? (
                <div key={inv.id} onClick={() => toggleSelect(inv.id)} className="cursor-pointer">{cardInner}</div>
              ) : (
                <Link key={inv.id} to={`${createPageUrl('InvoiceDetail')}?id=${inv.id}`}>{cardInner}</Link>
              );
            })}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* מסך קרופ */}
      {cropFile && (
        <Suspense fallback={null}>
          <CropDialog
            file={cropFile}
            onCancel={() => setCropFile(null)}
            onConfirm={(f) => { setCropFile(null); uploadAndScan(f); }}
          />
        </Suspense>
      )}

      {/* סרגל פעולות מרוכזות */}
      {selectMode && selected.size > 0 && (
        <div className="fixed bottom-16 sm:bottom-4 inset-x-0 z-40 px-4">
          <div className="max-w-md mx-auto bg-white rounded-xl shadow-2xl border p-3 flex items-center gap-2">
            <span className="text-sm font-semibold text-gray-700 px-1">נבחרו {selected.size}</span>
            <div className="flex-1" />
            <Button onClick={bulkSend} disabled={bulkBusy} size="sm" className="flex items-center gap-1.5">
              {bulkBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} שלח מסומנים
            </Button>
            <Button onClick={bulkNotInvoice} disabled={bulkBusy} size="sm" variant="outline" className="flex items-center gap-1.5">
              <Ban className="w-4 h-4" /> לא חשבוניות
            </Button>
            <Button onClick={bulkDelete} disabled={bulkBusy} size="sm" variant="outline" className="flex items-center gap-1.5 text-red-600 border-red-200 hover:bg-red-50">
              <Trash2 className="w-4 h-4" /> מחק מסומנים
            </Button>
          </div>
        </div>
      )}

      {/* תצוגה מוגדלת — JPEG של עמוד 1 (גם ל-PDF), כדי שגם בנייד לא צריך להוריד את הקובץ המלא */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex flex-col"
          onClick={() => setLightbox(null)}
        >
          <div className="flex items-center gap-2 p-3 text-white" onClick={e => e.stopPropagation()}>
            <div className="min-w-0 flex-1">
              <p className="font-semibold truncate">{lightbox.supplier_name || supplierName(lightbox.supplier_id)}</p>
              <p className="text-xs text-white/70 truncate">
                {fmtCurrency(lightbox.total, lightbox.currency)}
                {lightbox.invoice_number ? ` · מס׳ ${lightbox.invoice_number}` : ''}
              </p>
            </div>
            <a
              href={fileUrl(lightbox)}
              target="_blank"
              rel="noreferrer"
              className="text-xs bg-white/15 hover:bg-white/25 rounded-lg px-3 py-2"
            >
              פתח מקור
            </a>
            <Link
              to={`${createPageUrl('InvoiceDetail')}?id=${lightbox.id}`}
              className="text-xs bg-white/15 hover:bg-white/25 rounded-lg px-3 py-2"
            >
              פרטים
            </Link>
            <button onClick={() => setLightbox(null)} className="p-2 hover:bg-white/15 rounded-lg">
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="flex-1 overflow-auto p-3 flex items-start justify-center">
            {thumbUrl(lightbox, 1200) ? (
              <img
                src={thumbUrl(lightbox, 1200)}
                alt={lightbox.supplier_name || 'מסמך'}
                className="max-w-full rounded-lg bg-white"
                onClick={e => e.stopPropagation()}
              />
            ) : (
              <p className="text-white/70 text-sm mt-8">אין קובץ מצורף לחשבונית זו</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
