import React, { useState, useEffect } from 'react';
import { EmployeeEvent } from '@/entities/all';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/use-toast";
import {
  Plus, Loader2, Calendar, FileText, Trash2,
  UserCheck, PlaneTakeoff, PlaneLanding, RefreshCw,
  ArrowLeftRight, FileCheck, Heart, UserMinus,
  Camera, Upload, CheckCircle2, Stethoscope
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { getToken } from '@/api/localClient';

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

async function uploadFile(file) {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(`${BASE_URL}/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${getToken()}` },
    body: formData,
  });
  if (!res.ok) throw new Error('העלאת הקובץ נכשלה');
  return res.json();
}

// ── Event type config ─────────────────────────────────────────────────────────
const EVENT_TYPES = [
  { value: 'start_employment',  label: 'תחילת העסקה',       icon: UserCheck,     color: 'green'  },
  { value: 'entry_to_country',  label: 'כניסה לארץ',          icon: PlaneLanding,  color: 'blue'   },
  { value: 'inter_visa_exit',   label: 'יציאה לאינטרוויזה',   icon: PlaneTakeoff,  color: 'orange' },
  { value: 'inter_visa_return', label: 'חזרה מאינטרוויזה',    icon: PlaneLanding,  color: 'teal'   },
  { value: 'transfer',          label: 'נייוד',                icon: ArrowLeftRight,color: 'purple' },
  { value: 'contract_signed',   label: 'חוזה נחתם',            icon: FileCheck,     color: 'blue'   },
  { value: 'visa_renewal',      label: 'חידוש אשרה',           icon: RefreshCw,     color: 'indigo' },
  { value: 'passport_renewal',  label: 'חידוש דרכון',          icon: RefreshCw,     color: 'cyan'   },
  { value: 'medical_exam',      label: 'בדיקה רפואית',         icon: Stethoscope,   color: 'rose'   },
  { value: 'end_employment',    label: 'סיום העסקה',           icon: UserMinus,     color: 'red'    },
  { value: 'other',             label: 'אחר',                  icon: CheckCircle2,  color: 'gray'   },
];

const C = {
  green:  { dot: 'bg-green-500',  ring: 'ring-green-200',  badge: 'bg-green-100 text-green-700'    },
  blue:   { dot: 'bg-blue-500',   ring: 'ring-blue-200',   badge: 'bg-blue-100 text-blue-700'      },
  orange: { dot: 'bg-orange-500', ring: 'ring-orange-200', badge: 'bg-orange-100 text-orange-700'  },
  teal:   { dot: 'bg-teal-500',   ring: 'ring-teal-200',   badge: 'bg-teal-100 text-teal-700'      },
  purple: { dot: 'bg-purple-500', ring: 'ring-purple-200', badge: 'bg-purple-100 text-purple-700'  },
  indigo: { dot: 'bg-indigo-500', ring: 'ring-indigo-200', badge: 'bg-indigo-100 text-indigo-700'  },
  cyan:   { dot: 'bg-cyan-500',   ring: 'ring-cyan-200',   badge: 'bg-cyan-100 text-cyan-700'      },
  rose:   { dot: 'bg-rose-500',   ring: 'ring-rose-200',   badge: 'bg-rose-100 text-rose-700'      },
  red:    { dot: 'bg-red-500',    ring: 'ring-red-200',    badge: 'bg-red-100 text-red-700'        },
  gray:   { dot: 'bg-gray-400',   ring: 'ring-gray-200',   badge: 'bg-gray-100 text-gray-600'      },
};

function cfg(type) {
  return EVENT_TYPES.find(e => e.value === type) || EVENT_TYPES[EVENT_TYPES.length - 1];
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function EmployeeTimeline({ employee, currentUser, farmId }) {
  const { toast } = useToast();
  const [events, setEvents]         = useState([]);
  const [loading, setLoading]       = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving]         = useState(false);
  const [uploadingDoc, setUploadingDoc] = useState(false);

  const blankForm = {
    event_type: 'inter_visa_exit',
    event_date: new Date().toISOString().split('T')[0],
    notes: '',
    document_url: '',
  };
  const [form, setForm] = useState(blankForm);

  useEffect(() => { loadEvents(); }, [employee.id]);

  async function loadEvents() {
    setLoading(true);
    try {
      const data = await EmployeeEvent.filter({ employee_id: employee.id });
      const sorted = Array.isArray(data)
        ? [...data].sort((a, b) => (b.event_date || '').localeCompare(a.event_date || ''))
        : [];
      setEvents(sorted);
    } catch (e) { console.error('EmployeeTimeline load:', e); }
    finally { setLoading(false); }
  }

  async function handleDocUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingDoc(true);
    try {
      const { file_url } = await uploadFile(file);
      setForm(prev => ({ ...prev, document_url: file_url }));
      toast({ title: 'מסמך הועלה', description: file.name });
    } catch (err) {
      toast({ title: 'שגיאה', description: err.message, variant: 'destructive' });
    } finally { setUploadingDoc(false); e.target.value = ''; }
  }

  async function handleSave() {
    if (!form.event_type || !form.event_date) return;
    setSaving(true);
    try {
      await EmployeeEvent.create({
        employee_id: employee.id,
        farm_id: farmId || employee.farm_id,
        ...form,
        created_by: currentUser?.full_name || '',
      });
      toast({ title: 'אירוע נשמר' });
      setDialogOpen(false);
      setForm(blankForm);
      loadEvents();
    } catch (e) {
      toast({ title: 'שגיאה', description: e.message, variant: 'destructive' });
    } finally { setSaving(false); }
  }

  async function handleDelete(id) {
    if (!confirm('למחוק אירוע זה?')) return;
    try {
      await EmployeeEvent.delete(id);
      loadEvents();
    } catch (e) {
      toast({ title: 'שגיאה', description: e.message, variant: 'destructive' });
    }
  }

  // Build full timeline — add auto start_employment from employee.start_date if user hasn't
  const allEvents = [...events];
  if (!events.some(e => e.event_type === 'start_employment') && employee.start_date) {
    allEvents.push({
      id: '__auto__',
      _auto: true,
      event_type: 'start_employment',
      event_date: employee.start_date,
      notes: 'תחילת העסקה',
      document_url: employee.contract_url || '',
    });
  }
  allEvents.sort((a, b) => (b.event_date || '').localeCompare(a.event_date || ''));

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex justify-between items-center">
            <span>ציר אירועי העסקה</span>
            <Button size="sm" onClick={() => { setForm(blankForm); setDialogOpen(true); }}>
              <Plus className="w-4 h-4 ml-1.5" />
              הוסף אירוע
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
            </div>
          ) : allEvents.length === 0 ? (
            <p className="text-sm text-center text-gray-400 py-6">לא נרשמו אירועים עדיין</p>
          ) : (
            <div className="relative">
              {/* Vertical line */}
              <div className="absolute right-[18px] top-2 bottom-2 w-0.5 bg-gray-200 z-0" />

              <ul className="space-y-4">
                {allEvents.map((ev, idx) => {
                  const ecfg = cfg(ev.event_type);
                  const col  = C[ecfg.color] || C.gray;
                  const Icon = ecfg.icon;
                  return (
                    <li key={ev.id || idx} className="relative flex gap-4 pr-12">
                      {/* Dot */}
                      <div className={`absolute right-0 top-1.5 w-9 h-9 rounded-full ${col.dot} ring-4 ${col.ring} flex items-center justify-center flex-shrink-0 z-10`}>
                        <Icon className="w-4 h-4 text-white" />
                      </div>

                      {/* Card */}
                      <div className="flex-1 bg-white border rounded-lg p-3 shadow-sm">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <Badge className={`${col.badge} text-xs mb-1`}>{ecfg.label}</Badge>
                            <p className="text-sm font-semibold text-gray-800">
                              {ev.event_date ? format(parseISO(ev.event_date), 'dd/MM/yyyy') : '—'}
                            </p>
                            {ev.notes && <p className="text-sm text-gray-500 mt-0.5">{ev.notes}</p>}
                            {ev.document_url && (
                              <a href={ev.document_url} target="_blank" rel="noopener noreferrer"
                                className="text-xs text-blue-500 hover:underline flex items-center gap-1 mt-1">
                                <FileText className="w-3 h-3" />
                                <span>מסמך מצורף</span>
                              </a>
                            )}
                            {ev.created_by && (
                              <p className="text-xs text-gray-400 mt-1">נרשם ע"י {ev.created_by}</p>
                            )}
                          </div>
                          {!ev._auto && (
                            <Button variant="ghost" size="icon" className="h-7 w-7 flex-shrink-0 text-gray-300 hover:text-red-500"
                              onClick={() => handleDelete(ev.id)}>
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Add Event Dialog ── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle>הוסף אירוע</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Type */}
            <div className="space-y-1.5">
              <Label>סוג אירוע</Label>
              <Select value={form.event_type} onValueChange={v => setForm(p => ({ ...p, event_type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {EVENT_TYPES.map(et => (
                    <SelectItem key={et.value} value={et.value}>{et.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Date */}
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-gray-400" />
                תאריך
              </Label>
              <Input type="date" value={form.event_date}
                onChange={e => setForm(p => ({ ...p, event_date: e.target.value }))} />
            </div>

            {/* Notes */}
            <div className="space-y-1.5">
              <Label>הערות</Label>
              <Textarea rows={2} value={form.notes}
                onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
                placeholder="פרטים על האירוע..." />
            </div>

            {/* Document */}
            <div className="space-y-1.5">
              <Label>מסמך מצורף <span className="text-gray-400 font-normal">(אופציונלי)</span></Label>
              <input id="evdoc-cam" type="file" accept="image/*" capture="environment"
                className="hidden" onChange={handleDocUpload} disabled={uploadingDoc} />
              <input id="evdoc-gal" type="file" accept="image/*,application/pdf"
                className="hidden" onChange={handleDocUpload} disabled={uploadingDoc} />

              {form.document_url ? (
                <div className="flex items-center gap-2 p-2 rounded-lg bg-green-50 border border-green-200">
                  <FileText className="w-4 h-4 text-green-600 flex-shrink-0" />
                  <span className="text-sm text-green-700 flex-1 truncate">מסמך הועלה</span>
                  <Button variant="ghost" size="sm" className="h-6 text-xs text-red-500 px-2"
                    onClick={() => setForm(p => ({ ...p, document_url: '' }))}>הסר</Button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Button type="button" variant="outline" size="sm" disabled={uploadingDoc}
                    className="flex-1 border-blue-200 text-blue-700 hover:bg-blue-50"
                    onClick={() => document.getElementById('evdoc-cam')?.click()}>
                    {uploadingDoc
                      ? <Loader2 className="w-3.5 h-3.5 ml-1 animate-spin" />
                      : <Camera className="w-3.5 h-3.5 ml-1" />}
                    צלם
                  </Button>
                  <Button type="button" variant="outline" size="sm" disabled={uploadingDoc}
                    className="flex-1"
                    onClick={() => document.getElementById('evdoc-gal')?.click()}>
                    {uploadingDoc
                      ? <Loader2 className="w-3.5 h-3.5 ml-1 animate-spin" />
                      : <Upload className="w-3.5 h-3.5 ml-1" />}
                    בחר קובץ
                  </Button>
                </div>
              )}
            </div>
          </div>

          <DialogFooter className="gap-2 flex-row-reverse">
            <Button onClick={handleSave}
              disabled={saving || !form.event_type || !form.event_date}>
              {saving && <Loader2 className="w-4 h-4 ml-2 animate-spin" />}
              שמור אירוע
            </Button>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>ביטול</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
