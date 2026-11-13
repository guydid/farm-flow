// אשף התחלה למשק חדש: פרטי משק → גידולים → חלקות → עובדים → צוות → מה הלאה.
// כל שלב ניתן לדילוג; מה שנשמר נשמר מיד בסוף השלב. סיום מסמן farm.onboarding_completed_at.
import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { Farm, CompanySettings, Crop, Plot, Employee } from '@/entities/all';
import { getToken } from '@/api/localClient';
import { createPageUrl } from '@/utils';
import { cn } from '@/lib/utils';
import {
  Sprout, Building, Wheat, Map as MapIcon, Users2, UserPlus, Rocket, Plus, Trash2, Loader2, Check,
  Clock, FileText, Settings as SettingsIcon, Copy,
} from 'lucide-react';

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';
const today = () => new Date().toISOString().slice(0, 10);

const STEPS = [
  { key: 'farm', title: 'פרטי המשק', icon: Building },
  { key: 'crops', title: 'גידולים', icon: Wheat },
  { key: 'plots', title: 'חלקות', icon: MapIcon },
  { key: 'employees', title: 'עובדים', icon: Users2 },
  { key: 'team', title: 'צוות', icon: UserPlus },
  { key: 'done', title: 'מה הלאה', icon: Rocket },
];

const COMMON_CROPS = ['עגבנייה', 'עגבניית שרי', 'מלפפון', 'פלפל', 'חסה', 'תות שדה', 'חציל', 'קישוא', 'בצל', 'תפוח אדמה', 'גזר', 'אבטיח', 'מלון', 'עשבי תיבול', 'אבוקדו', 'הדרים'];
const STRUCTURES = { greenhouse: 'חממה', net_house: 'בית רשת', tunnel: 'מנהרות', open_field: 'שטח פתוח', orchard: 'מטע' };
const ROLES = { manager: 'מנהל — עריכת נתונים', worker: 'עובד — עדכונים שוטפים', viewer: 'צופה — צפייה בלבד' };

const emptyPlot = () => ({ name: '', structure_type: 'greenhouse', size: '' });
const emptyEmp = () => ({ first_name: '', last_name: '' });

export const onboardingKey = (farmId) => `onboarding_later_${farmId}`;

export default function OnboardingWizard({ open, onClose, farm, currentUser }) {
  const { toast } = useToast();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [settingsRow, setSettingsRow] = useState(null);
  const [farmForm, setFarmForm] = useState({ name: '', company_type: 'farm', phone: '', address: '' });
  const [existingCrops, setExistingCrops] = useState([]);
  const [crops, setCrops] = useState([]);
  const [customCrop, setCustomCrop] = useState('');
  const [plots, setPlots] = useState([emptyPlot()]);
  const [emps, setEmps] = useState([emptyEmp()]);
  const [invite, setInvite] = useState({ email: '', full_name: '', role: 'worker' });
  const [inviteResult, setInviteResult] = useState(null);
  const [done, setDone] = useState({});

  useEffect(() => {
    if (!open || !farm) return;
    setStep(0);
    setFarmForm(f => ({ ...f, name: farm.name || '' }));
    CompanySettings.filter({ farm_id: farm.id }).then(rows => {
      const s = Array.isArray(rows) ? rows[0] : null;
      setSettingsRow(s || null);
      if (s) setFarmForm(f => ({ ...f, company_type: s.company_type || 'farm', phone: s.phone || '', address: s.address || '' }));
    }).catch(() => {});
    Crop.filter({ farm_id: farm.id }).then(rows => setExistingCrops((rows || []).map(c => c.name))).catch(() => {});
  }, [open, farm?.id]);

  const fail = (e) => toast({ title: 'שגיאה בשמירה', description: e?.message || 'נסה שוב', variant: 'destructive' });

  // ── שמירת כל שלב ────────────────────────────────────────────────────────────
  const saveFarm = async () => {
    const name = farmForm.name.trim();
    if (!name) { toast({ title: 'נא למלא שם משק', variant: 'destructive' }); return false; }
    if (name !== farm.name) await Farm.update(farm.id, { name });
    const payload = { company_name: name, company_type: farmForm.company_type, phone: farmForm.phone.trim(), address: farmForm.address.trim() };
    if (settingsRow) await CompanySettings.update(settingsRow.id, payload);
    else setSettingsRow(await CompanySettings.create({ ...payload, farm_id: farm.id }));
    return true;
  };

  const saveCrops = async () => {
    const toAdd = crops.filter(c => !existingCrops.includes(c));
    for (const name of toAdd) await Crop.create({ farm_id: farm.id, name });
    setExistingCrops(prev => [...prev, ...toAdd]);
    setCrops([]);
    return toAdd.length;
  };

  const savePlots = async () => {
    const rows = plots.filter(p => p.name.trim());
    for (const p of rows) {
      await Plot.create({
        farm_id: farm.id, name: p.name.trim(), structure_type: p.structure_type,
        size: parseFloat(p.size) || 0, ownership_status: 'owned', activity_status: 'active', status_updated_date: today(),
      });
    }
    if (rows.length) setPlots([emptyPlot()]);
    return rows.length;
  };

  const saveEmps = async () => {
    const rows = emps.filter(e => e.first_name.trim());
    for (const e of rows) {
      const first_name = e.first_name.trim(), last_name = e.last_name.trim();
      await Employee.create({ farm_id: farm.id, first_name, last_name, full_name: `${first_name} ${last_name}`.trim(), start_date: today(), status: 'active' });
    }
    if (rows.length) setEmps([emptyEmp()]);
    return rows.length;
  };

  const sendInvite = async () => {
    if (!invite.email.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`${BASE_URL}/farm-members/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ ...invite, email: invite.email.trim(), farm_id: farm.id, send_email: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'ההזמנה נכשלה');
      setInviteResult({ email: data.email || invite.email, link: data.invite_link || '', sent: !!data.email_sent, error: data.email_error || '' });
      setInvite({ email: '', full_name: '', role: 'worker' });
      setDone(d => ({ ...d, team: (d.team || 0) + 1 }));
    } catch (e) { fail(e); }
    finally { setSaving(false); }
  };

  const next = async () => {
    const key = STEPS[step].key;
    setSaving(true);
    try {
      if (key === 'farm') { if (!(await saveFarm())) return; setDone(d => ({ ...d, farm: 1 })); }
      if (key === 'crops') { const n = await saveCrops(); if (n) setDone(d => ({ ...d, crops: (d.crops || 0) + n })); }
      if (key === 'plots') { const n = await savePlots(); if (n) setDone(d => ({ ...d, plots: (d.plots || 0) + n })); }
      if (key === 'employees') { const n = await saveEmps(); if (n) setDone(d => ({ ...d, employees: (d.employees || 0) + n })); }
      setStep(s => Math.min(s + 1, STEPS.length - 1));
    } catch (e) { fail(e); }
    finally { setSaving(false); }
  };

  const skip = () => setStep(s => Math.min(s + 1, STEPS.length - 1));

  const finish = async (page) => {
    setSaving(true);
    try { await Farm.update(farm.id, { onboarding_completed_at: new Date().toISOString() }); } catch { /* לא קריטי */ }
    try { localStorage.setItem(onboardingKey(farm.id), 'done'); } catch { /* */ }
    window.location.href = createPageUrl(page || 'Dashboard');
  };

  const later = () => {
    try { sessionStorage.setItem(onboardingKey(farm.id), '1'); } catch { /* */ }
    onClose();
  };

  if (!farm) return null;
  const S = STEPS[step];
  const firstName = (currentUser?.full_name || '').split(' ')[0];

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) later(); }}>
      <DialogContent dir="rtl" className="max-w-2xl w-[calc(100vw-1rem)] max-h-[92vh] overflow-y-auto p-0 gap-0">
        {/* כותרת + התקדמות */}
        <div className="bg-gradient-to-l from-green-600 to-emerald-500 text-white px-5 pt-5 pb-4 rounded-t-lg">
          <div className="flex items-center gap-2 text-sm opacity-90">
            <Sprout className="h-4 w-4" /> הקמת המשק · שלב {step + 1} מתוך {STEPS.length}
          </div>
          <DialogTitle className="text-xl font-bold mt-1 text-white">
            {step === 0 ? `ברוכים הבאים${firstName ? `, ${firstName}` : ''}!` : S.title}
          </DialogTitle>
          <DialogDescription className="text-white/85 text-sm mt-1">
            {step === 0 ? 'כמה דקות של הגדרה ראשונית, והמערכת מוכנה לעבודה. אפשר לדלג על כל שלב ולהשלים אחר כך.' : STEP_HINT[S.key]}
          </DialogDescription>
          <ol className="flex gap-1.5 mt-4" aria-label="שלבי האשף">
            {STEPS.map((s, i) => (
              <li key={s.key} className="flex-1" aria-current={i === step ? 'step' : undefined}>
                <div className={cn('h-1.5 rounded-full', i < step ? 'bg-white' : i === step ? 'bg-white/80' : 'bg-white/30')} />
                <div className={cn('hidden sm:flex items-center gap-1 text-[11px] mt-1.5', i === step ? 'opacity-100 font-medium' : 'opacity-70')}>
                  <s.icon className="h-3 w-3" />{s.title}
                </div>
              </li>
            ))}
          </ol>
        </div>

        <div className="p-5 space-y-4 min-h-[240px]">
          {S.key === 'farm' && (
            <div className="grid gap-4">
              <div className="grid gap-1.5">
                <Label htmlFor="ob-name">שם המשק *</Label>
                <Input id="ob-name" value={farmForm.name} onChange={e => setFarmForm({ ...farmForm, name: e.target.value })} placeholder="למשל: משק כהן" />
              </div>
              <div className="grid gap-1.5">
                <Label>סוג ישות</Label>
                <Select value={farmForm.company_type} onValueChange={v => setFarmForm({ ...farmForm, company_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="farm">משק חקלאי</SelectItem>
                    <SelectItem value="cooperative">אגודה שיתופית</SelectItem>
                    <SelectItem value="company">חברה</SelectItem>
                    <SelectItem value="moshav">מושב</SelectItem>
                    <SelectItem value="kibbutz">קיבוץ</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="grid gap-1.5">
                  <Label htmlFor="ob-phone">טלפון</Label>
                  <Input id="ob-phone" type="tel" dir="ltr" className="text-right" value={farmForm.phone} onChange={e => setFarmForm({ ...farmForm, phone: e.target.value })} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="ob-address">כתובת / יישוב</Label>
                  <Input id="ob-address" value={farmForm.address} onChange={e => setFarmForm({ ...farmForm, address: e.target.value })} />
                </div>
              </div>
              <p className="text-xs text-gray-500">לוגו, ח.פ., הסמכות ופרטים נוספים — בהגדרות ← פרטי חברה.</p>
            </div>
          )}

          {S.key === 'crops' && (
            <div className="space-y-4">
              {existingCrops.length > 0 && (
                <p className="text-sm text-gray-600">כבר במערכת: {existingCrops.join(', ')}</p>
              )}
              <div className="flex flex-wrap gap-2">
                {[...COMMON_CROPS, ...crops.filter(c => !COMMON_CROPS.includes(c))].map(c => {
                  const exists = existingCrops.includes(c);
                  const on = exists || crops.includes(c);
                  return (
                    <button
                      key={c} type="button" disabled={exists} aria-pressed={on}
                      onClick={() => setCrops(prev => prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c])}
                      className={cn('px-3 py-1.5 rounded-full border text-sm transition-colors min-h-[36px]',
                        on ? 'bg-green-600 border-green-600 text-white' : 'bg-white hover:bg-green-50 border-gray-300',
                        exists && 'opacity-60 cursor-default')}
                    >
                      {on && <Check className="inline h-3.5 w-3.5 ml-1" />}{c}
                    </button>
                  );
                })}
              </div>
              <form className="flex gap-2" onSubmit={e => { e.preventDefault(); const v = customCrop.trim(); if (v && !crops.includes(v)) setCrops([...crops, v]); setCustomCrop(''); }}>
                <Input value={customCrop} onChange={e => setCustomCrop(e.target.value)} placeholder="גידול אחר…" aria-label="גידול נוסף" />
                <Button type="submit" variant="outline"><Plus className="h-4 w-4" /></Button>
              </form>
            </div>
          )}

          {S.key === 'plots' && (
            <div className="space-y-3">
              {plots.map((p, i) => (
                <div key={i} className="grid grid-cols-[1fr_auto] sm:grid-cols-[2fr_1.4fr_1fr_auto] gap-2 items-end border rounded-lg p-3 bg-gray-50">
                  <div className="grid gap-1 col-span-1">
                    <Label className="text-xs">שם החלקה</Label>
                    <Input value={p.name} onChange={e => setPlots(plots.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} placeholder={`חממה ${i + 1}`} />
                  </div>
                  <Button type="button" variant="ghost" size="icon" className="sm:order-last" aria-label="הסר חלקה" disabled={plots.length === 1}
                    onClick={() => setPlots(plots.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
                  <div className="grid gap-1">
                    <Label className="text-xs">סוג</Label>
                    <Select value={p.structure_type} onValueChange={v => setPlots(plots.map((x, j) => j === i ? { ...x, structure_type: v } : x))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{Object.entries(STRUCTURES).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-1">
                    <Label className="text-xs">שטח (דונם)</Label>
                    <Input type="number" inputMode="decimal" min="0" step="0.1" value={p.size} onChange={e => setPlots(plots.map((x, j) => j === i ? { ...x, size: e.target.value } : x))} />
                  </div>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={() => setPlots([...plots, emptyPlot()])}><Plus className="h-4 w-4 ml-1" />חלקה נוספת</Button>
            </div>
          )}

          {S.key === 'employees' && (
            <div className="space-y-3">
              {emps.map((e, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-end">
                  <div className="grid gap-1">
                    <Label className="text-xs">שם פרטי</Label>
                    <Input value={e.first_name} onChange={ev => setEmps(emps.map((x, j) => j === i ? { ...x, first_name: ev.target.value } : x))} />
                  </div>
                  <div className="grid gap-1">
                    <Label className="text-xs">שם משפחה</Label>
                    <Input value={e.last_name} onChange={ev => setEmps(emps.map((x, j) => j === i ? { ...x, last_name: ev.target.value } : x))} />
                  </div>
                  <Button type="button" variant="ghost" size="icon" aria-label="הסר עובד" disabled={emps.length === 1}
                    onClick={() => setEmps(emps.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={() => setEmps([...emps, emptyEmp()])}><Plus className="h-4 w-4 ml-1" />עובד נוסף</Button>
              <p className="text-xs text-gray-500">דרכון, אשרה, ביטוח ומסמכים — בכרטיס העובד. המערכת תתריע לפני שתוקף מסמך פג.</p>
            </div>
          )}

          {S.key === 'team' && (
            <div className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="ob-inv-email">אימייל</Label>
                  <Input id="ob-inv-email" type="email" dir="ltr" value={invite.email} onChange={e => setInvite({ ...invite, email: e.target.value })} placeholder="name@example.com" />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="ob-inv-name">שם</Label>
                  <Input id="ob-inv-name" value={invite.full_name} onChange={e => setInvite({ ...invite, full_name: e.target.value })} />
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label>הרשאה</Label>
                <Select value={invite.role} onValueChange={v => setInvite({ ...invite, role: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(ROLES).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <Button type="button" onClick={sendInvite} disabled={saving || !invite.email.trim()}>
                {saving ? <Loader2 className="h-4 w-4 ml-1 animate-spin" /> : <UserPlus className="h-4 w-4 ml-1" />}שלח הזמנה
              </Button>
              {inviteResult && (
                <div role="status" className={cn('rounded-lg border p-3 text-sm', inviteResult.sent ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200')}>
                  {inviteResult.sent
                    ? <>נשלח מייל הזמנה ל-{inviteResult.email}.</>
                    : <>{inviteResult.email} נוסף/ה למשק, אבל המייל לא נשלח{inviteResult.error ? ` (${inviteResult.error})` : ''}. שלח/י את הקישור ידנית:</>}
                  {!inviteResult.sent && inviteResult.link && (
                    <div className="flex gap-2 mt-2">
                      <Input readOnly dir="ltr" value={inviteResult.link} className="text-xs" aria-label="קישור הזמנה" />
                      <Button type="button" variant="outline" size="icon" aria-label="העתק קישור"
                        onClick={() => navigator.clipboard?.writeText(inviteResult.link).then(() => toast({ title: 'הקישור הועתק' }))}><Copy className="h-4 w-4" /></Button>
                    </div>
                  )}
                </div>
              )}
              <p className="text-xs text-gray-500">חברי צוות נוספים, עובדי שטח (ממשק מקוצר) והרשאות — במסך "חברי משק".</p>
            </div>
          )}

          {S.key === 'done' && (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2 text-sm">
                {done.farm ? <Pill>פרטי המשק נשמרו</Pill> : null}
                {done.crops ? <Pill>{done.crops} גידולים</Pill> : null}
                {done.plots ? <Pill>{done.plots} חלקות</Pill> : null}
                {done.employees ? <Pill>{done.employees} עובדים</Pill> : null}
                {done.team ? <Pill>{done.team} הזמנות</Pill> : null}
              </div>
              <p className="text-sm text-gray-700">המשק מוכן. מאיפה ממשיכים?</p>
              <div className="grid sm:grid-cols-2 gap-2">
                <NextCard icon={Sprout} title="מזרע ראשון" desc="תיעוד שתילה, פעולות, ריסוסים וקטיף" onClick={() => finish('Seedings')} disabled={saving} />
                <NextCard icon={Clock} title="שעון נוכחות" desc="חיבור שעון וחישוב שעות לעובדים" onClick={() => finish('Attendance')} disabled={saving} />
                <NextCard icon={FileText} title="חשבוניות וספקים" desc="קליטת חשבוניות מהמייל ושליחה להנה״ח" onClick={() => finish('Invoices')} disabled={saving} />
                <NextCard icon={SettingsIcon} title="הגדרות המשק" desc="לוגו, מוצרים, לקוחות, תכשירים" onClick={() => finish('Settings')} disabled={saving} />
              </div>
              {farm.plan === 'trial' && farm.trial_ends_at && (
                <p className="text-xs text-gray-500">תקופת הניסיון פעילה עד {new Date(farm.trial_ends_at).toLocaleDateString('he-IL')}.</p>
              )}
            </div>
          )}
        </div>

        {/* פעולות */}
        <div className="border-t px-5 py-3 flex items-center gap-2 sticky bottom-0 bg-white rounded-b-lg">
          {step > 0 && S.key !== 'done' && (
            <Button type="button" variant="ghost" onClick={() => setStep(step - 1)} disabled={saving}>חזרה</Button>
          )}
          {S.key !== 'done' && (
            <button type="button" onClick={later} className="text-sm text-gray-500 hover:text-gray-800 underline-offset-2 hover:underline">
              אמשיך אחר כך
            </button>
          )}
          <div className="flex-1" />
          {S.key === 'done' ? (
            <Button type="button" onClick={() => finish('Dashboard')} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 ml-1 animate-spin" />}ללוח הבקרה
            </Button>
          ) : (
            <>
              {S.key !== 'farm' && <Button type="button" variant="outline" onClick={skip} disabled={saving}>דלג</Button>}
              <Button type="button" onClick={next} disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 ml-1 animate-spin" />}
                {S.key === 'team' ? 'המשך' : 'שמור והמשך'}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

const STEP_HINT = {
  crops: 'בחר את הגידולים במשק — הם יופיעו ברשימות בעת פתיחת מזרע, קטיף ושקילה.',
  plots: 'חממות, בתי רשת ושטחים פתוחים. כל מזרע משויך לחלקה.',
  employees: 'רשימה ראשונית של העובדים — לנוכחות, שיבוץ ומעקב מסמכים.',
  team: 'הזמן שותפים, מנהל עבודה או מנהלת חשבונות לעבוד איתך במערכת.',
  done: 'סיימת את ההקמה הבסיסית.',
};

function Pill({ children }) {
  return <span className="inline-flex items-center gap-1 rounded-full bg-green-50 text-green-800 border border-green-200 px-2.5 py-1"><Check className="h-3.5 w-3.5" />{children}</span>;
}

function NextCard({ icon: Icon, title, desc, onClick, disabled }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className="text-right flex gap-3 items-start rounded-lg border p-3 hover:border-green-400 hover:bg-green-50 transition-colors disabled:opacity-60">
      <span className="rounded-md bg-green-100 text-green-700 p-2"><Icon className="h-5 w-5" /></span>
      <span><span className="block font-medium text-sm">{title}</span><span className="block text-xs text-gray-500">{desc}</span></span>
    </button>
  );
}
