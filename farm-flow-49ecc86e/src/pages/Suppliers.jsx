import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Supplier, Invoice, User } from '@/entities/all';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Plus, Search, Trash2, Edit2, Phone, MapPin, Mail, Loader2, FileText, Building2 } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';

export default function Suppliers() {
  const [suppliers, setSuppliers] = useState([]);
  const [invoiceCounts, setInvoiceCounts] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: '', vat_id: '', phone: '', email: '', address: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const user = await User.me();
      if (!user?.current_farm_id) return;
      const [list, invoices] = await Promise.all([
        Supplier.filter({ farm_id: user.current_farm_id }),
        Invoice.filter({ farm_id: user.current_farm_id }),
      ]);
      setSuppliers(Array.isArray(list) ? list : []);
      const counts = {};
      (invoices || []).forEach(inv => {
        if (inv.supplier_id) counts[inv.supplier_id] = (counts[inv.supplier_id] || 0) + 1;
      });
      setInvoiceCounts(counts);
    } catch (e) {
      console.error(e);
      toast({ title: 'שגיאה בטעינת ספקים', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return suppliers;
    return suppliers.filter(x =>
      String(x.name || '').toLowerCase().includes(s) ||
      String(x.vat_id || '').includes(s) ||
      String(x.phone || '').includes(s) ||
      (Array.isArray(x.email_addresses) && x.email_addresses.some(e => String(e).toLowerCase().includes(s)))
    );
  }, [suppliers, search]);

  const openNew = () => {
    setEditing(null);
    setForm({ name: '', vat_id: '', phone: '', email: '', address: '', notes: '' });
  };

  const openEdit = (s) => {
    setEditing(s);
    setForm({
      name: s.name || '',
      vat_id: s.vat_id || '',
      phone: s.phone || '',
      email: (s.email_addresses || []).join(', '),
      address: s.address || '',
      notes: s.notes || '',
    });
  };

  const save = async () => {
    if (!form.name.trim()) {
      toast({ title: 'שם ספק חובה', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const data = {
        name: form.name.trim(),
        vat_id: form.vat_id.trim() || null,
        phone: form.phone.trim() || null,
        address: form.address.trim() || null,
        email_addresses: form.email.split(',').map(e => e.trim()).filter(Boolean),
        notes: form.notes.trim() || null,
      };
      if (editing) await Supplier.update(editing.id, data);
      else await Supplier.create(data);
      setEditing(null);
      setForm({ name: '', vat_id: '', phone: '', email: '', address: '', notes: '' });
      await load();
      toast({ title: editing ? 'הספק עודכן' : 'ספק חדש נוצר' });
    } catch (e) {
      console.error(e);
      toast({ title: 'שגיאה בשמירת ספק', description: e.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const remove = async (s) => {
    if (!confirm(`למחוק את הספק "${s.name}"?`)) return;
    try {
      await Supplier.delete(s.id);
      await load();
      toast({ title: 'הספק נמחק' });
    } catch (e) {
      toast({ title: 'שגיאה במחיקה', description: e.message, variant: 'destructive' });
    }
  };

  const dialogOpen = editing !== null || (form.name !== '' || form.vat_id !== '' || form.phone !== '' || form.email !== '' || form.address !== '' || form.notes !== '');

  if (isLoading) {
    return <div className="flex items-center justify-center h-64"><Loader2 className="w-6 h-6 animate-spin text-indigo-600" /></div>;
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 bg-gray-50/50 min-h-screen" dir="rtl">
      <div className="max-w-screen-xl mx-auto">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">ספקים</h1>
            <p className="text-sm text-gray-500 mt-1">{filtered.length} מתוך {suppliers.length} ספקים</p>
          </div>
          <Button onClick={openNew} className="flex items-center gap-1.5">
            <Plus className="w-4 h-4" />
            <span>ספק חדש</span>
          </Button>
        </div>

        <Card className="mb-4">
          <CardContent className="p-3">
            <div className="relative">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="חיפוש לפי שם, ח.פ., טלפון או אימייל"
                className="pr-9"
              />
            </div>
          </CardContent>
        </Card>

        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400">
            <Building2 className="w-12 h-12 mb-3" />
            <p className="text-sm">אין ספקים תואמים</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {filtered.map(s => (
              <Card key={s.id} className="hover:shadow-md transition-shadow">
                <CardContent className="p-4">
                  <div className="flex justify-between items-start gap-2 mb-2">
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold text-gray-900 truncate">{s.name}</h3>
                      {s.vat_id && <p className="text-xs text-gray-500 mt-0.5">ח.פ. {s.vat_id}</p>}
                    </div>
                    {invoiceCounts[s.id] > 0 && (
                      <Link to={`${createPageUrl('Invoices')}?supplier_id=${s.id}`}>
                        <Badge className="bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100 cursor-pointer">
                          <FileText className="w-3 h-3 ml-1" />
                          {invoiceCounts[s.id]}
                        </Badge>
                      </Link>
                    )}
                  </div>
                  <div className="space-y-1 text-xs text-gray-600">
                    {s.phone && <div className="flex items-center gap-1.5"><Phone className="w-3 h-3 text-gray-400" />{s.phone}</div>}
                    {Array.isArray(s.email_addresses) && s.email_addresses.length > 0 && (
                      <div className="flex items-center gap-1.5"><Mail className="w-3 h-3 text-gray-400" /><span className="truncate" dir="ltr">{s.email_addresses[0]}{s.email_addresses.length > 1 ? ` +${s.email_addresses.length - 1}` : ''}</span></div>
                    )}
                    {s.address && <div className="flex items-center gap-1.5"><MapPin className="w-3 h-3 text-gray-400" /><span className="truncate">{s.address}</span></div>}
                  </div>
                  <div className="flex gap-2 mt-3 pt-3 border-t">
                    <Button size="sm" variant="outline" onClick={() => openEdit(s)} className="flex-1 h-8 text-xs">
                      <Edit2 className="w-3 h-3 ml-1" /> ערוך
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => remove(s)} className="h-8 text-xs text-red-600 border-red-200 hover:bg-red-50">
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) { setEditing(null); setForm({ name: '', vat_id: '', phone: '', email: '', address: '', notes: '' }); } }}>
        <DialogContent dir="rtl" className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? 'עריכת ספק' : 'ספק חדש'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>שם הספק *</Label>
              <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>ח.פ. / עוסק מורשה</Label>
                <Input value={form.vat_id} onChange={e => setForm({ ...form, vat_id: e.target.value })} dir="ltr" />
              </div>
              <div>
                <Label>טלפון</Label>
                <Input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} dir="ltr" />
              </div>
            </div>
            <div>
              <Label>אימיילים (מופרדים בפסיק)</Label>
              <Input value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} dir="ltr" placeholder="billing@supplier.co.il, sales@..." />
            </div>
            <div>
              <Label>כתובת</Label>
              <Input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} />
            </div>
            <div>
              <Label>הערות</Label>
              <Textarea rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setEditing(null); setForm({ name: '', vat_id: '', phone: '', email: '', address: '', notes: '' }); }}>ביטול</Button>
            <Button onClick={save} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 animate-spin ml-1" />}
              שמור
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
