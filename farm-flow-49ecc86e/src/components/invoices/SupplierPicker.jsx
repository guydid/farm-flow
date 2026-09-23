import React, { useState } from 'react';
import { Supplier } from '@/entities/all';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Check, ChevronsUpDown, Edit2, Plus, X, Loader2, Building2 } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';

const EMPTY_FORM = { name: '', vat_id: '', phone: '', email: '', address: '', notes: '' };

// בורר ספקים עם חיפוש + עריכה/יצירה של ספק שמור, לשימוש בדף חשבונית
export default function SupplierPicker({ suppliers, value, onSelect, onSupplierSaved }) {
  const [open, setOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState(null); // null = new supplier
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const safeSuppliers = Array.isArray(suppliers) ? suppliers : [];
  const selected = safeSuppliers.find(s => s.id === value) || null;

  const openEditor = (supplier) => {
    setEditing(supplier);
    setForm(supplier ? {
      name: supplier.name || '',
      vat_id: supplier.vat_id || '',
      phone: supplier.phone || '',
      email: (supplier.email_addresses || []).join(', '),
      address: supplier.address || '',
      notes: supplier.notes || '',
    } : EMPTY_FORM);
    setOpen(false);
    setEditorOpen(true);
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
      let saved;
      if (editing) {
        saved = await Supplier.update(editing.id, data);
        saved = { ...editing, ...data, ...(saved && saved.id ? saved : {}) };
      } else {
        saved = await Supplier.create(data);
        saved = { ...data, ...(saved && saved.id ? saved : {}) };
      }
      toast({ title: editing ? 'הספק עודכן' : 'ספק חדש נוצר' });
      setEditorOpen(false);
      if (onSupplierSaved) onSupplierSaved(saved, !editing);
    } catch (e) {
      console.error(e);
      toast({ title: 'שגיאה בשמירת ספק', description: e.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="flex gap-1.5">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" role="combobox" aria-expanded={open} className="flex-1 justify-between font-normal">
              <span className={selected ? '' : 'text-gray-400'}>
                {selected ? selected.name : 'חפש או בחר ספק...'}
              </span>
              <ChevronsUpDown className="w-4 h-4 opacity-50 flex-shrink-0" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="p-0 w-[var(--radix-popover-trigger-width)]" align="start" dir="rtl">
            <Command>
              <CommandInput placeholder="חיפוש לפי שם ספק..." />
              <CommandList>
                <CommandEmpty>
                  <div className="py-2 text-sm text-gray-500">
                    <Building2 className="w-6 h-6 mx-auto mb-1 text-gray-300" />
                    לא נמצא ספק
                  </div>
                </CommandEmpty>
                <CommandGroup>
                  {safeSuppliers.map(s => (
                    <CommandItem
                      key={s.id}
                      value={`${s.name} ${s.vat_id || ''}`}
                      onSelect={() => {
                        onSelect(s.id === value ? null : s);
                        setOpen(false);
                      }}
                      className="flex items-center justify-between gap-2"
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <Check className={`w-4 h-4 flex-shrink-0 ${s.id === value ? 'opacity-100' : 'opacity-0'}`} />
                        <span className="truncate">{s.name}</span>
                        {s.vat_id && <span className="text-xs text-gray-400 flex-shrink-0">ח.פ. {s.vat_id}</span>}
                      </span>
                      <button
                        type="button"
                        title="ערוך ספק"
                        className="p-1 rounded hover:bg-gray-200 text-gray-400 hover:text-gray-700 flex-shrink-0"
                        onClick={(e) => { e.stopPropagation(); openEditor(s); }}
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
              <div className="border-t p-1">
                <Button variant="ghost" size="sm" className="w-full justify-start text-indigo-600 h-8" onClick={() => openEditor(null)}>
                  <Plus className="w-4 h-4 ml-1" /> ספק חדש
                </Button>
              </div>
            </Command>
          </PopoverContent>
        </Popover>
        {selected && (
          <>
            <Button variant="outline" size="icon" title="ערוך ספק" onClick={() => openEditor(selected)}>
              <Edit2 className="w-4 h-4" />
            </Button>
            <Button variant="outline" size="icon" title="נקה בחירה" onClick={() => onSelect(null)}>
              <X className="w-4 h-4" />
            </Button>
          </>
        )}
      </div>

      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
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
            <Button variant="outline" onClick={() => setEditorOpen(false)} disabled={saving}>ביטול</Button>
            <Button onClick={save} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 animate-spin ml-1" />}
              שמור
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
