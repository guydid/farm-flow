import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  Users2, UserPlus, Trash2, Crown, Shield, HardHat, Eye,
  Loader2, Info, Bell, Languages, RotateCcw, Mail,
} from 'lucide-react';
import { getToken } from '@/api/localClient';
import { useAuth } from '@/lib/AuthContext';

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

const ROLES = {
  owner:   { label: 'בעלים',  color: 'bg-purple-100 text-purple-800', icon: Crown,   desc: 'ניהול מלא, הגדרות, הזמנת חברים' },
  manager: { label: 'מנהל',   color: 'bg-blue-100 text-blue-800',     icon: Shield,  desc: 'עריכת נתונים, שליחת התראות' },
  worker:  { label: 'עובד',   color: 'bg-green-100 text-green-800',   icon: HardHat, desc: 'עריכת נתונים שוטפים' },
  viewer:  { label: 'צופה',   color: 'bg-gray-100 text-gray-800',     icon: Eye,     desc: 'צפייה בלבד, ללא עריכה' },
};

function apiFetch(path, opts = {}) {
  return fetch(`${BASE_URL}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}`, ...opts.headers },
  });
}

const EMPTY_INVITE = { email: '', full_name: '', password: '', role: 'worker', field_worker: false };
const EMPTY_NOTIF  = { title: '', body: '', type: 'info' };

export default function FarmMembers() {
  const { user } = useAuth();
  const [currentFarm, setCurrentFarm] = useState(null);
  const [members, setMembers]         = useState([]);
  const [loading, setLoading]         = useState(true);
  const [myRole, setMyRole]           = useState(null);

  // Invite dialog
  const [showInvite, setShowInvite]   = useState(false);
  const [invite, setInvite]           = useState(EMPTY_INVITE);
  const [inviting, setInviting]       = useState(false);
  const [inviteErr, setInviteErr]     = useState('');
  const [reinvite, setReinvite]       = useState(false); // מצב הזמנה חוזרת לחבר קיים
  const [sendEmail, setSendEmail]     = useState(true);   // שליחת מייל הזמנה דרך Gmail
  const [inviteResult, setInviteResult] = useState(null); // תוצאה: סטטוס מייל + לינק
  const [copied, setCopied]           = useState(false);

  // Notification dialog
  const [showNotif, setShowNotif]     = useState(false);
  const [notif, setNotif]             = useState(EMPTY_NOTIF);
  const [sending, setSending]         = useState(false);
  const [notifErr, setNotifErr]       = useState('');
  const [notifOk, setNotifOk]         = useState('');

  // Load farm + members
  useEffect(() => {
    if (!user?.current_farm_id) { setLoading(false); return; }

    const load = async () => {
      try {
        const [farmRes, membersRes] = await Promise.all([
          apiFetch(`/farms/${user.current_farm_id}`),
          apiFetch(`/farm-members?farm_id=${user.current_farm_id}`),
        ]);
        if (farmRes.ok) setCurrentFarm(await farmRes.json());
        if (membersRes.ok) {
          const data = await membersRes.json();
          setMembers(data);
          const me = data.find(m => m.user_id === user.id);
          setMyRole(me?.role || null);
        }
      } catch (e) {
        console.error(e);
      }
      setLoading(false);
    };
    load();
  }, [user]);

  const reloadMembers = async () => {
    if (!user?.current_farm_id) return;
    const res = await apiFetch(`/farm-members?farm_id=${user.current_farm_id}`);
    if (res.ok) {
      const data = await res.json();
      setMembers(data);
      setMyRole(data.find(m => m.user_id === user.id)?.role || null);
    }
  };

  const canManage = myRole === 'owner' || user?.is_admin;
  const canNotify = ['owner', 'manager'].includes(myRole) || user?.is_admin;

  // ── Invite ──────────────────────────────────────────────────────────────────
  const handleInvite = async () => {
    if (!invite.email) return;
    setInviting(true); setInviteErr('');
    try {
      const res = await apiFetch('/farm-members/invite', {
        method: 'POST',
        body: JSON.stringify({ ...invite, farm_id: user.current_farm_id }),
      });
      const res2 = await res.json();
      if (!res.ok) { setInviteErr(res2.error || 'שגיאה בהזמנה'); return; }
      await reloadMembers();
      // מציגים מסך תוצאה: סטטוס שליחת המייל + לינק כניסה להעתקה
      setInviteResult({
        email: res2.email,
        password: invite.password && invite.password.length >= 6 ? invite.password : '',
        invite_link: res2.invite_link || '',
        email_sent: !!res2.email_sent,
        email_error: res2.email_error || '',
        reinvited: !!res2.reinvited,
      });
    } catch { setInviteErr('שגיאת רשת'); }
    finally { setInviting(false); }
  };

  // העתקת פרטי הכניסה (לינק + אימייל + סיסמה) ללוח — לשליחה ידנית (וואטסאפ וכו')
  const copyInvite = async () => {
    if (!inviteResult) return;
    const text = [
      'הוזמנת למערכת farm-flow',
      `כניסה: ${inviteResult.invite_link}`,
      `אימייל: ${inviteResult.email}`,
      inviteResult.password ? `סיסמה: ${inviteResult.password}` : null,
    ].filter(Boolean).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('העתק ידנית:', text);
    }
  };

  // הזמנה חוזרת לחבר קיים — ממלא מראש את הטופס לאיפוס פרטי כניסה
  const reinviteMember = (member) => {
    setReinvite(true);
    setInviteErr('');
    setInviteResult(null);
    setInvite({
      email: member.email || '',
      full_name: member.full_name || '',
      password: '',
      role: member.role || 'worker',
      field_worker: !!member.field_worker,
    });
    setShowInvite(true);
  };

  // ── Role change ──────────────────────────────────────────────────────────────
  const handleRoleChange = async (memberId, newRole) => {
    const res = await apiFetch(`/farm-members/${memberId}`, {
      method: 'PUT',
      body: JSON.stringify({ role: newRole }),
    });
    if (res.ok) await reloadMembers();
  };

  // ── Toggle Thai field-worker mode (reduced UI) on an existing member ──────────
  const handleFieldWorkerToggle = async (memberId, value) => {
    const res = await apiFetch(`/farm-members/${memberId}`, {
      method: 'PUT',
      body: JSON.stringify({ field_worker: value }),
    });
    if (res.ok) await reloadMembers();
  };

  // ── Fill English names (name_en) on seedings/varieties/activities for field workers ──
  const [backfilling, setBackfilling] = useState(false);
  const handleBackfillNames = async () => {
    setBackfilling(true);
    try {
      const res = await apiFetch('/i18n/backfill-names', { method: 'POST', body: JSON.stringify({}) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'שגיאה');
      window.alert(`עודכנו ${data.updated} שמות באנגלית (מזרעים, זנים, סוגי פעילות, גידולים).`);
    } catch (e) {
      window.alert(e.message || 'שגיאה במילוי השמות');
    } finally {
      setBackfilling(false);
    }
  };

  // ── Remove ───────────────────────────────────────────────────────────────────
  const handleRemove = async (memberId, name) => {
    if (!window.confirm(`להסיר את ${name} מהמשק?`)) return;
    const res = await apiFetch(`/farm-members/${memberId}`, { method: 'DELETE' });
    if (res.ok) await reloadMembers();
  };

  // ── Send notification ────────────────────────────────────────────────────────
  const handleSendNotif = async () => {
    if (!notif.title.trim()) return;
    setSending(true); setNotifErr(''); setNotifOk('');
    try {
      const res = await apiFetch('/notifications', {
        method: 'POST',
        body: JSON.stringify({ ...notif, farm_id: user.current_farm_id }),
      });
      const data = await res.json();
      if (!res.ok) { setNotifErr(data.error || 'שגיאה בשליחה'); return; }
      setNotifOk('ההתראה נשלחה בהצלחה לכל חברי המשק');
      setNotif(EMPTY_NOTIF);
      setTimeout(() => { setShowNotif(false); setNotifOk(''); }, 2000);
    } catch { setNotifErr('שגיאת רשת'); }
    finally { setSending(false); }
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
    </div>
  );

  return (
    <div className="p-4 lg:p-8 max-w-3xl mx-auto" dir="rtl">

      {/* Header */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Users2 className="h-7 w-7 text-indigo-600" />
            חברי המשק
          </h1>
          {currentFarm && <p className="text-gray-500 text-sm mt-0.5">משק: {currentFarm.name}</p>}
        </div>
        <div className="flex gap-2">
          {canManage && (
            <Button variant="outline" onClick={handleBackfillNames} disabled={backfilling} className="flex items-center gap-2" title="ממלא שמות אנגלית למזרעים/זנים/פעילויות עבור עובדי שדה">
              {backfilling ? <Loader2 className="h-4 w-4 animate-spin" /> : <Languages className="h-4 w-4" />}
              מלא שמות אנגלית
            </Button>
          )}
          {canNotify && (
            <Button variant="outline" onClick={() => setShowNotif(true)} className="flex items-center gap-2">
              <Bell className="h-4 w-4" />
              שלח התראה
            </Button>
          )}
          {canManage && (
            <Button onClick={() => setShowInvite(true)} className="flex items-center gap-2">
              <UserPlus className="h-4 w-4" />
              הזמן חבר
            </Button>
          )}
        </div>
      </div>

      {/* Role legend */}
      <Card className="mb-6">
        <CardHeader className="pb-2 pt-4">
          <CardTitle className="text-sm font-medium text-gray-500 flex items-center gap-1">
            <Info className="h-4 w-4" /> הרשאות לפי תפקיד
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 pb-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {Object.entries(ROLES).map(([role, info]) => {
              const Icon = info.icon;
              return (
                <div key={role} className="flex flex-col items-center text-center gap-1">
                  <Badge className={`${info.color} flex items-center gap-1`}>
                    <Icon className="h-3 w-3" />{info.label}
                  </Badge>
                  <p className="text-xs text-gray-500">{info.desc}</p>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Members list */}
      <div className="space-y-3">
        {members.length === 0 ? (
          <Card>
            <CardContent className="text-center py-12">
              <Users2 className="h-12 w-12 mx-auto text-gray-200 mb-3" />
              <p className="text-gray-500">אין חברים במשק עדיין</p>
            </CardContent>
          </Card>
        ) : members.map(member => {
          const roleInfo = ROLES[member.role] || ROLES.viewer;
          const RoleIcon = roleInfo.icon;
          const isMe = member.user_id === user?.id;
          const displayName = member.full_name || member.email || '?';

          return (
            <Card key={member.id}>
              <CardContent className="py-4 px-5">
                <div className="flex items-center gap-4">
                  <Avatar className="h-10 w-10 flex-shrink-0">
                    <AvatarFallback className="bg-indigo-100 text-indigo-700 font-semibold">
                      {displayName[0].toUpperCase()}
                    </AvatarFallback>
                  </Avatar>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-gray-900">{member.full_name || '—'}</span>
                      {isMe && <span className="text-xs text-gray-400">(אתה)</span>}
                      {!!member.field_worker && (
                        <Badge className="bg-amber-100 text-amber-700 text-xs">🇹🇭 עובד שדה</Badge>
                      )}
                      {!member.is_active && (
                        <Badge variant="outline" className="text-red-600 border-red-300 text-xs">מושבת</Badge>
                      )}
                    </div>
                    <p className="text-sm text-gray-500 truncate">{member.email}</p>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    {canManage && !isMe && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className={`h-8 text-xs ${member.field_worker ? 'bg-amber-600 hover:bg-amber-700 text-white border-amber-600' : 'text-amber-700 border-amber-300'}`}
                        onClick={() => handleFieldWorkerToggle(member.id, !member.field_worker)}
                        title="עובד שדה תאילנדי — ממשק מצומצם בלבד"
                      >
                        🇹🇭 {member.field_worker ? 'תאילנדי' : 'סמן תאילנדי'}
                      </Button>
                    )}
                    {canManage && !isMe ? (
                      <Select value={member.role} disabled={!!member.field_worker} onValueChange={val => handleRoleChange(member.id, val)}>
                        <SelectTrigger className="w-28 h-8 text-sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(ROLES).map(([r, info]) => (
                            <SelectItem key={r} value={r}>{info.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Badge className={`${roleInfo.color} flex items-center gap-1`}>
                        <RoleIcon className="h-3 w-3" />{roleInfo.label}
                      </Badge>
                    )}

                    {canManage && !isMe && (
                      <Button
                        variant="ghost" size="icon"
                        className="h-8 w-8 text-indigo-500 hover:text-indigo-700 hover:bg-indigo-50"
                        onClick={() => reinviteMember(member)}
                        title="הזמנה חוזרת — איפוס פרטי כניסה"
                      >
                        <RotateCcw className="h-4 w-4" />
                      </Button>
                    )}
                    {(canManage || isMe) && !isMe && (
                      <Button
                        variant="ghost" size="icon"
                        className="h-8 w-8 text-red-400 hover:text-red-600 hover:bg-red-50"
                        onClick={() => handleRemove(member.id, displayName)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* ── Invite Dialog ─────────────────────────────────────────────────── */}
      <Dialog open={showInvite} onOpenChange={open => { setShowInvite(open); if (!open) { setInvite(EMPTY_INVITE); setInviteErr(''); setReinvite(false); setInviteResult(null); setCopied(false); setSendEmail(true); } }}>
        <DialogContent className="sm:max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {inviteResult
                ? <><Mail className="h-5 w-5 text-indigo-600" /> ההזמנה נשלחה</>
                : reinvite
                ? <><RotateCcw className="h-5 w-5 text-indigo-600" /> הזמנה חוזרת</>
                : <><UserPlus className="h-5 w-5 text-indigo-600" /> הזמן חבר למשק</>}
            </DialogTitle>
          </DialogHeader>

          {inviteResult ? (
            /* ── מסך תוצאה: סטטוס מייל + לינק להעתקה ── */
            <div className="space-y-3 py-2">
              <div className={`rounded-lg p-3 text-sm ${inviteResult.email_sent ? 'bg-green-50 border border-green-200 text-green-800' : 'bg-amber-50 border border-amber-200 text-amber-800'}`}>
                {inviteResult.email_sent
                  ? `✓ מייל הזמנה נשלח אל ${inviteResult.email}`
                  : `המייל לא נשלח${inviteResult.email_error ? ` (${inviteResult.email_error})` : ''}. העתק את הלינק ושלח ידנית.`}
              </div>
              <div>
                <Label>לינק כניסה</Label>
                <div className="flex gap-2 mt-1">
                  <Input readOnly dir="ltr" value={inviteResult.invite_link} className="bg-gray-50 text-xs" />
                  <Button type="button" variant="outline" onClick={copyInvite} className="flex-shrink-0">
                    {copied ? 'הועתק!' : 'העתק'}
                  </Button>
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  אימייל: <span dir="ltr">{inviteResult.email}</span>
                  {inviteResult.password ? <> · סיסמה: <span dir="ltr">{inviteResult.password}</span></> : null}
                </p>
                <p className="text-xs text-gray-400 mt-1">"העתק" מעתיק לינק + אימייל + סיסמה לשליחה ידנית (וואטסאפ וכו').</p>
              </div>
            </div>
          ) : (
            /* ── טופס הזמנה ── */
            <div className="space-y-4 py-2">
              <div>
                <Label>אימייל *</Label>
                <Input type="email" placeholder="example@email.com" dir="ltr" readOnly={reinvite}
                  className={reinvite ? 'bg-gray-50' : ''}
                  value={invite.email} onChange={e => setInvite(p => ({ ...p, email: e.target.value }))} />
              </div>
              <div>
                <Label>שם מלא</Label>
                <Input placeholder="שם החבר"
                  value={invite.full_name} onChange={e => setInvite(p => ({ ...p, full_name: e.target.value }))} />
              </div>
              <div>
                <Label>סיסמה</Label>
                <Input type="password" placeholder={reinvite ? 'סיסמה חדשה (לפחות 6 תווים)' : 'לפחות 6 תווים (לחשבון חדש)'} dir="ltr"
                  value={invite.password} onChange={e => setInvite(p => ({ ...p, password: e.target.value }))} />
                <p className="text-xs text-gray-400 mt-1">
                  {reinvite
                    ? 'הזן סיסמה חדשה כדי לאפס למשתמש את פרטי הכניסה (השאר ריק כדי לא לשנות).'
                    : 'אם המשתמש כבר קיים במערכת — הסיסמה לא תשתנה'}
                </p>
              </div>
              <div>
                <Label>תפקיד</Label>
                <Select value={invite.field_worker ? 'worker' : invite.role} disabled={invite.field_worker} onValueChange={val => setInvite(p => ({ ...p, role: val }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(ROLES).map(([r, info]) => (
                      <SelectItem key={r} value={r}>
                        <span className="flex items-center gap-2">{info.label} — {info.desc}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <label className="flex items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 p-3 cursor-pointer">
                <input type="checkbox" className="h-4 w-4 accent-indigo-600"
                  checked={sendEmail} onChange={e => setSendEmail(e.target.checked)} />
                <span className="text-sm text-indigo-800 flex items-center gap-1.5">
                  <Mail className="h-4 w-4" /> שלח מייל הזמנה דרך Gmail המחובר
                </span>
              </label>
              <label className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 cursor-pointer">
                <input type="checkbox" className="mt-0.5 h-4 w-4 accent-amber-600"
                  checked={!!invite.field_worker}
                  onChange={e => setInvite(p => ({ ...p, field_worker: e.target.checked }))} />
                <span className="text-sm text-amber-800">
                  <span className="font-medium">עובד שדה (תאילנדית)</span> — ממשק מצומצם בלבד: מזרעים פעילים, הזנת קטיפים ופעילות. נכנס כ"worker".
                </span>
              </label>
              {inviteErr && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2">{inviteErr}</p>}
            </div>
          )}

          <DialogFooter>
            {inviteResult ? (
              <Button onClick={() => setShowInvite(false)}>סיום</Button>
            ) : (
              <>
                <Button variant="outline" onClick={() => setShowInvite(false)}>ביטול</Button>
                <Button onClick={handleInvite} disabled={inviting || !invite.email}>
                  {inviting && <Loader2 className="h-4 w-4 animate-spin ml-2" />}
                  {reinvite ? 'שלח הזמנה חוזרת' : 'הזמן'}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Notification Dialog ───────────────────────────────────────────── */}
      <Dialog open={showNotif} onOpenChange={open => { setShowNotif(open); if (!open) { setNotif(EMPTY_NOTIF); setNotifErr(''); setNotifOk(''); } }}>
        <DialogContent className="sm:max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Bell className="h-5 w-5 text-indigo-600" /> שלח התראה לחברי המשק
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>כותרת *</Label>
              <Input placeholder="נושא ההתראה"
                value={notif.title} onChange={e => setNotif(p => ({ ...p, title: e.target.value }))} />
            </div>
            <div>
              <Label>תוכן</Label>
              <textarea
                className="w-full border rounded-md px-3 py-2 text-sm min-h-[80px] resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="פרטים נוספים (אופציונלי)"
                value={notif.body} onChange={e => setNotif(p => ({ ...p, body: e.target.value }))}
              />
            </div>
            <div>
              <Label>סוג התראה</Label>
              <Select value={notif.type} onValueChange={val => setNotif(p => ({ ...p, type: val }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="info">💬 מידע</SelectItem>
                  <SelectItem value="success">✅ הצלחה</SelectItem>
                  <SelectItem value="warning">⚠️ אזהרה</SelectItem>
                  <SelectItem value="error">🚨 דחוף</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {notifErr && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2">{notifErr}</p>}
            {notifOk  && <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded p-2">{notifOk}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNotif(false)}>ביטול</Button>
            <Button onClick={handleSendNotif} disabled={sending || !notif.title.trim()}>
              {sending && <Loader2 className="h-4 w-4 animate-spin ml-2" />}
              שלח לכולם
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
