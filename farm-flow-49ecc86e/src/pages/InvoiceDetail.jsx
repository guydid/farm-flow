import React, { useState, useEffect, useCallback } from 'react';
import { Invoice, Supplier, User } from '@/entities/all';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { getToken } from '@/api/localClient';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  ArrowRight, Loader2, Save, Trash2, CheckCircle2, XCircle,
  Mail, Upload, FileText, ExternalLink, Plus, X, Send
} from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import SupplierPicker from '@/components/invoices/SupplierPicker';

const BASE_URL = import.meta.env.VITE_API_URL || '/api';

const STATUS_OPTIONS = [
  { value: 'pending', label: 'ממתין לבדיקה' },
  { value: 'reviewed', label: 'נבדק' },
  { value: 'approved', label: 'מאושר' },
  { value: 'rejected', label: 'נדחה' },
];

function fileUrlWithToken(url) {
  if (!url) return null;
  try {
    const u = new URL(url, window.location.origin);
    u.searchParams.set('token', getToken() || '');
    return u.toString();
  } catch { return url; }
}

export default function InvoiceDetail() {
  const location = useLocation();
  const navigate = useNavigate();
  const id = new URLSearchParams(location.search).get('id');
  const [invoice, setInvoice] = useState(null);
  const [suppliers, setSuppliers] = useState([]);
  const [form, setForm] = useState(null);
  const [items, setItems] = useState([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sendOpen, setSendOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendTo, setSendTo] = useState('');
  const [sendCc, setSendCc] = useState('');
  const { toast } = useToast();

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const user = await User.me();
      const [inv, supList] = await Promise.all([
        Invoice.get(id),
        Supplier.filter({ farm_id: user.current_farm_id }),
      ]);
      setInvoice(inv);
      setSuppliers(supList || []);
      setForm({
        supplier_id: inv.supplier_id || '',
        supplier_name: inv.supplier_name || '',
        invoice_number: inv.invoice_number || '',
        invoice_type: inv.invoice_type || '',
        date: inv.date || '',
        due_date: inv.due_date || '',
        subtotal: inv.subtotal ?? '',
        vat_rate: inv.vat_rate ?? '',
        vat_amount: inv.vat_amount ?? '',
        total: inv.total ?? '',
        currency: inv.currency || 'ILS',
        notes: inv.notes || '',
        status: inv.status || 'pending',
      });
      setItems(Array.isArray(inv.items) ? inv.items : []);
    } catch (e) {
      console.error(e);
      toast({ title: 'שגיאה בטעינת חשבונית', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [id, toast]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      await Invoice.update(id, {
        supplier_id: form.supplier_id || null,
        supplier_name: form.supplier_name.trim() || null,
        invoice_number: form.invoice_number.trim() || null,
        invoice_type: form.invoice_type || null,
        date: form.date || null,
        due_date: form.due_date || null,
        subtotal: form.subtotal === '' ? null : Number(form.subtotal),
        vat_rate: form.vat_rate === '' ? null : Number(form.vat_rate),
        vat_amount: form.vat_amount === '' ? null : Number(form.vat_amount),
        total: form.total === '' ? null : Number(form.total),
        currency: form.currency,
        notes: form.notes.trim() || null,
        status: form.status,
        items,
      });
      toast({ title: 'נשמר' });
      load();
    } catch (e) {
      toast({ title: 'שגיאה בשמירה', description: e.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!confirm('למחוק את החשבונית?')) return;
    try {
      await Invoice.delete(id);
      toast({ title: 'נמחק' });
      navigate(createPageUrl('Invoices'));
    } catch (e) {
      toast({ title: 'שגיאה במחיקה', description: e.message, variant: 'destructive' });
    }
  };

  const approve = async () => {
    setForm(f => ({ ...f, status: 'approved' }));
    // Save with new status
    try {
      await Invoice.update(id, { status: 'approved' });
      toast({ title: 'אושר' });
      load();
    } catch (e) {
      toast({ title: 'שגיאה', description: e.message, variant: 'destructive' });
    }
  };

  const openSendDialog = async () => {
    // טען כתובת ברירת מחדל מההגדרות (נופל לכתובת אליה כבר נשלח בעבר)
    try {
      const s = await fetch(`${BASE_URL}/settings/bookkeeper`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      }).then(r => r.json());
      setSendTo(invoice.sent_to || s?.recipient_email || '');
      setSendCc(s?.cc_email || '');
    } catch {
      setSendTo(invoice.sent_to || '');
      setSendCc('');
    }
    setSendOpen(true);
  };

  const doSend = async () => {
    if (!sendTo.trim()) { toast({ title: 'הזן כתובת יעד', variant: 'destructive' }); return; }
    setSending(true);
    try {
      const res = await fetch(`${BASE_URL}/invoices/${id}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ to: sendTo.trim(), cc: sendCc.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);
      toast({ title: 'נשלח למנהלת החשבונות', description: data.to });
      setSendOpen(false);
      load();
    } catch (e) {
      toast({ title: 'שליחה נכשלה', description: e.message, variant: 'destructive' });
    } finally {
      setSending(false);
    }
  };

  const setItem = (i, key, val) => {
    setItems(arr => arr.map((it, idx) => idx === i ? { ...it, [key]: val } : it));
  };
  const addItem = () => setItems(arr => [...arr, { description: '', qty: 1, unit_price: 0, total: 0 }]);
  const removeItem = (i) => setItems(arr => arr.filter((_, idx) => idx !== i));

  if (loading || !invoice) {
    return <div className="flex items-center justify-center h-64"><Loader2 className="w-6 h-6 animate-spin text-indigo-600" /></div>;
  }

  const previewUrl = fileUrlWithToken(invoice.file_url);
  const isPdf = invoice.file_name && /\.pdf$/i.test(invoice.file_name);

  return (
    <div className="p-4 sm:p-6 lg:p-8 bg-gray-50/50 min-h-screen" dir="rtl">
      <div className="max-w-screen-2xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <Link to={createPageUrl('Invoices')}>
            <Button variant="outline" size="sm"><ArrowRight className="w-4 h-4 ml-1" />חזרה</Button>
          </Link>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900 truncate">
              {invoice.supplier_name || suppliers.find(s => s.id === invoice.supplier_id)?.name || 'חשבונית'}
            </h1>
            <p className="text-xs text-gray-500 mt-0.5">
              {invoice.source === 'gmail' ? <><Mail className="w-3 h-3 inline ml-1" />מ-Gmail · </> : invoice.source === 'upload' ? <><Upload className="w-3 h-3 inline ml-1" />מהעלאה · </> : ''}
              נוצר {invoice.created_at?.slice(0, 10)}
            </p>
            {invoice.sent_to_bookkeeper_at && (
              <div className="flex items-center gap-2 flex-wrap mt-1">
                <Badge className="bg-green-100 text-green-700 border-green-200 text-xs">
                  <Mail className="w-3 h-3 ml-1" />נשלח אל {invoice.sent_to} · {invoice.sent_to_bookkeeper_at.slice(0, 10)}
                </Badge>
                {invoice.pdf_url && (
                  <a href={fileUrlWithToken(invoice.pdf_url)} target="_blank" rel="noopener noreferrer"
                     className="text-xs text-indigo-600 hover:underline flex items-center gap-1">
                    <FileText className="w-3 h-3" /> עותק ה-PDF שנשלח
                  </a>
                )}
              </div>
            )}
          </div>
          <Button variant="outline" onClick={remove} className="text-red-600 border-red-200 hover:bg-red-50">
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Original file preview */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><FileText className="w-4 h-4" />הקובץ המקורי</CardTitle></CardHeader>
            <CardContent>
              {!previewUrl ? (
                <div className="text-sm text-gray-400 p-8 text-center">אין קובץ מצורף</div>
              ) : isPdf ? (
                <div className="space-y-2">
                  <iframe src={previewUrl} className="w-full h-96 border rounded" title="invoice" />
                  <a href={previewUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-indigo-600 hover:underline flex items-center gap-1 w-fit">
                    <ExternalLink className="w-3 h-3" /> פתח בחלון נפרד
                  </a>
                </div>
              ) : (
                <div className="space-y-2">
                  <a href={previewUrl} target="_blank" rel="noopener noreferrer">
                    <img src={previewUrl} alt="invoice" className="w-full rounded border max-h-[480px] object-contain bg-gray-50" />
                  </a>
                  <a href={previewUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-indigo-600 hover:underline flex items-center gap-1 w-fit">
                    <ExternalLink className="w-3 h-3" /> פתח בגודל מלא
                  </a>
                </div>
              )}
              {invoice.source === 'gmail' && invoice.source_meta && (
                <div className="mt-3 p-2 bg-gray-50 rounded text-xs space-y-0.5">
                  <p><strong>נושא:</strong> {invoice.source_meta.subject}</p>
                  <p><strong>מאת:</strong> <span dir="ltr">{invoice.source_meta.from}</span></p>
                  <p><strong>קובץ:</strong> {invoice.source_meta.attachment_name}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Editable fields */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center justify-between">
                <span>פרטי חשבונית</span>
                <Select value={form.status} onValueChange={v => setForm({ ...form, status: v })}>
                  <SelectTrigger className="h-8 w-40 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label className="text-xs">שם ספק</Label>
                <Input value={form.supplier_name} onChange={e => setForm({ ...form, supplier_name: e.target.value })} placeholder="שם הספק כפי שיופיע במייל" />
              </div>
              <div>
                <Label className="text-xs">קישור לספק במערכת (אופציונלי)</Label>
                <SupplierPicker
                  suppliers={suppliers}
                  value={form.supplier_id}
                  onSelect={(sup) => {
                    // בחירת ספק קיים מעדכנת גם את שם הספק המוצג; null מנקה את הקישור
                    if (sup) setForm(f => ({ ...f, supplier_id: sup.id, supplier_name: sup.name || f.supplier_name }));
                    else setForm(f => ({ ...f, supplier_id: '' }));
                  }}
                  onSupplierSaved={(saved, isNew) => {
                    setSuppliers(list => {
                      const arr = Array.isArray(list) ? list : [];
                      return isNew ? [...arr, saved] : arr.map(s => (s.id === saved.id ? saved : s));
                    });
                    if (isNew || saved.id === form.supplier_id) {
                      setForm(f => ({ ...f, supplier_id: saved.id, supplier_name: saved.name }));
                    }
                  }}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">מספר חשבונית</Label>
                  <Input value={form.invoice_number} onChange={e => setForm({ ...form, invoice_number: e.target.value })} dir="ltr" />
                </div>
                <div>
                  <Label className="text-xs">סוג</Label>
                  <Select value={form.invoice_type || ''} onValueChange={v => setForm({ ...form, invoice_type: v })}>
                    <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="tax_invoice">חשבונית מס</SelectItem>
                      <SelectItem value="deal_invoice">חשבונית עסקה</SelectItem>
                      <SelectItem value="receipt">קבלה</SelectItem>
                      <SelectItem value="credit">זיכוי</SelectItem>
                      <SelectItem value="other">אחר</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">תאריך</Label>
                  <Input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} />
                </div>
                <div>
                  <Label className="text-xs">תאריך פירעון</Label>
                  <Input type="date" value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label className="text-xs">לפני מע"מ</Label>
                  <Input type="number" step="0.01" value={form.subtotal} onChange={e => setForm({ ...form, subtotal: e.target.value })} />
                </div>
                <div>
                  <Label className="text-xs">מע"מ</Label>
                  <Input type="number" step="0.01" value={form.vat_amount} onChange={e => setForm({ ...form, vat_amount: e.target.value })} />
                </div>
                <div>
                  <Label className="text-xs">סה"כ</Label>
                  <Input type="number" step="0.01" value={form.total} onChange={e => setForm({ ...form, total: e.target.value })} className="font-semibold" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">% מע"מ</Label>
                  <Input type="number" value={form.vat_rate} onChange={e => setForm({ ...form, vat_rate: e.target.value })} />
                </div>
                <div>
                  <Label className="text-xs">מטבע</Label>
                  <Select value={form.currency} onValueChange={v => setForm({ ...form, currency: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ILS">₪ שקל</SelectItem>
                      <SelectItem value="USD">$ דולר</SelectItem>
                      <SelectItem value="EUR">€ יורו</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label className="text-xs">הערות</Label>
                <Textarea rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Line items */}
        <Card className="mt-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center justify-between">
              <span>פריטים ({items.length})</span>
              <Button size="sm" variant="outline" onClick={addItem} className="h-7 text-xs"><Plus className="w-3 h-3 ml-1" />הוסף פריט</Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {items.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">לא חולצו פריטים</p>
            ) : (
              <div className="space-y-2">
                {items.map((it, i) => (
                  <div key={i} className="grid grid-cols-12 gap-2 items-center">
                    <Input value={it.description || ''} onChange={e => setItem(i, 'description', e.target.value)} placeholder="תיאור" className="col-span-12 sm:col-span-5 h-8 text-xs" />
                    <Input type="number" step="0.01" value={it.qty ?? ''} onChange={e => setItem(i, 'qty', Number(e.target.value))} placeholder="כמות" className="col-span-4 sm:col-span-2 h-8 text-xs" />
                    <Input type="number" step="0.01" value={it.unit_price ?? ''} onChange={e => setItem(i, 'unit_price', Number(e.target.value))} placeholder="מחיר יח׳" className="col-span-4 sm:col-span-2 h-8 text-xs" />
                    <Input type="number" step="0.01" value={it.total ?? ''} onChange={e => setItem(i, 'total', Number(e.target.value))} placeholder='סה"כ' className="col-span-3 sm:col-span-2 h-8 text-xs font-semibold" />
                    <Button size="sm" variant="ghost" onClick={() => removeItem(i)} className="col-span-1 h-8 px-1 text-red-500"><X className="w-3 h-3" /></Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Actions bar */}
        <div className="sticky bottom-16 sm:bottom-4 mt-4 flex gap-2 bg-white p-3 rounded-xl shadow-lg border z-10">
          <Button onClick={save} disabled={saving} className="flex-1">
            {saving ? <Loader2 className="w-4 h-4 animate-spin ml-1" /> : <Save className="w-4 h-4 ml-1" />}
            שמור שינויים
          </Button>
          <Button onClick={openSendDialog} variant="outline" className="text-blue-700 border-blue-300 hover:bg-blue-50">
            <Send className="w-4 h-4 ml-1" /> {invoice.sent_to_bookkeeper_at ? 'שלח שוב' : 'שלח לחשבונות'}
          </Button>
          {form.status !== 'approved' && (
            <Button onClick={approve} variant="outline" className="text-green-700 border-green-300 hover:bg-green-50">
              <CheckCircle2 className="w-4 h-4 ml-1" /> אישור
            </Button>
          )}
        </div>

        {/* דיאלוג שליחה למנהלת החשבונות */}
        <Dialog open={sendOpen} onOpenChange={setSendOpen}>
          <DialogContent dir="rtl" className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>שליחה למנהלת החשבונות</DialogTitle>
              <DialogDescription>החשבונית תישלח כקובץ PDF מצורף, עם הפרטים בגוף המייל.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label className="text-xs">כתובת יעד</Label>
                <Input type="email" dir="ltr" value={sendTo} onChange={e => setSendTo(e.target.value)} placeholder="bookkeeper@example.com" />
              </div>
              <div>
                <Label className="text-xs">עותק (CC) — אופציונלי</Label>
                <Input type="email" dir="ltr" value={sendCc} onChange={e => setSendCc(e.target.value)} placeholder="—" />
              </div>
              <div className="text-xs bg-blue-50 border border-blue-200 rounded p-2 text-blue-900 break-words">
                <span className="font-semibold">נושא: </span>
                {['חשבונית', invoice.supplier_name, form.invoice_number && `מס׳ ${form.invoice_number}`, form.total !== '' && `${form.total}₪`, form.date].filter(Boolean).join(' • ')}
              </div>
              <p className="text-[11px] text-gray-400">הפרטים נשלחים לפי הנתונים השמורים — שמור שינויים לפני שליחה.</p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setSendOpen(false)} disabled={sending}>ביטול</Button>
              <Button onClick={doSend} disabled={sending}>
                {sending ? <Loader2 className="w-4 h-4 animate-spin ml-1" /> : <Send className="w-4 h-4 ml-1" />}
                שלח
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
