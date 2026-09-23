import React, { useState, useEffect, useCallback } from 'react';
import { getToken } from '@/api/localClient';
import { useAuth } from '@/lib/AuthContext';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Users, Database, Server, ShieldCheck, ShieldOff, Trash2,
  RefreshCw, Eye, EyeOff, Crown, UserX, UserCheck, Building2,
  AlertTriangle, BarChart3, HardDrive, Clock, Bell, Send, CheckCircle2
} from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter
} from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

function adminFetch(path, opts = {}) {
  return fetch(`${BASE_URL}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}`, ...opts.headers },
  }).then(r => r.json());
}

function formatBytes(bytes) {
  if (bytes == null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

// פס שימוש צבעוני: ירוק עד 80%, כתום 80-90%, אדום מעל 90%
function UsageBar({ percent }) {
  const p = Math.max(0, Math.min(100, percent || 0));
  const color = p >= 90 ? 'bg-red-500' : p >= 80 ? 'bg-amber-500' : 'bg-green-500';
  return (
    <div className="h-2 w-full rounded-full bg-gray-200 overflow-hidden">
      <div className={`h-full ${color} transition-all`} style={{ width: `${p}%` }} />
    </div>
  );
}

function formatUptime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}ש' ${m}ד'`;
}

// ─── STAT CARD ────────────────────────────────────────────────────────────────
function StatCard({ icon: Icon, label, value, sub, color = 'blue' }) {
  const colors = {
    blue: 'bg-blue-50 text-blue-600',
    green: 'bg-green-50 text-green-600',
    orange: 'bg-orange-50 text-orange-600',
    purple: 'bg-purple-50 text-purple-600',
  };
  return (
    <Card>
      <CardContent className="p-5 flex items-center gap-4">
        <div className={`p-3 rounded-xl ${colors[color]}`}>
          <Icon className="w-6 h-6" />
        </div>
        <div>
          <div className="text-2xl font-bold">{value}</div>
          <div className="text-sm text-gray-500">{label}</div>
          {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
export default function AdminPanel() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [stats, setStats] = useState(null);
  const [serverStatus, setServerStatus] = useState(null);
  const [users, setUsers] = useState([]);
  const [farms, setFarms] = useState([]);
  const [sentNotifs, setSentNotifs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('stats');

  // New notification form
  const [notifForm, setNotifForm] = useState({ title: '', body: '', type: 'info', farm_id: '', recipient_id: '' });
  const [sendingNotif, setSendingNotif] = useState(false);
  const [notifResult, setNotifResult] = useState(null);

  // Dialogs
  const [editUser, setEditUser] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [newPassword, setNewPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, u, f, n, ss] = await Promise.all([
        adminFetch('/admin/stats'),
        adminFetch('/admin/users'),
        adminFetch('/admin/farms'),
        adminFetch('/admin/notifications'),
        adminFetch('/admin/server-status').catch(() => null),
      ]);
      setStats(s);
      setServerStatus(ss);
      setUsers(Array.isArray(u) ? u : []);
      setFarms(Array.isArray(f) ? f : []);
      setSentNotifs(Array.isArray(n) ? n : []);
    } catch (e) {
      toast({ title: 'שגיאה בטעינת נתוני אדמין', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const loadServerStatus = useCallback(async () => {
    try { const ss = await adminFetch('/admin/server-status'); if (ss && !ss.error) setServerStatus(ss); } catch { /* ignore */ }
  }, []);

  const [cleaningUploads, setCleaningUploads] = useState(false);
  const cleanupUploads = async () => {
    if (!window.confirm('למחוק קבצים ישנים שאינם מקושרים לאף רשומה (מעל 14 יום)? קבצים של חשבוניות/עובדים נשמרים תמיד.')) return;
    setCleaningUploads(true);
    try {
      const r = await adminFetch('/admin/cleanup-uploads', { method: 'POST', body: JSON.stringify({}) });
      if (r.success) {
        toast({ title: `נמחקו ${r.deleted} קבצים`, description: `שוחררו ${formatBytes(r.freed_bytes)} · נשמרו ${r.kept_referenced} מקושרים` });
        loadServerStatus();
      } else {
        toast({ title: 'שגיאה בניקוי', description: r.error || '', variant: 'destructive' });
      }
    } catch { toast({ title: 'שגיאת רשת', variant: 'destructive' }); }
    finally { setCleaningUploads(false); }
  };

  useEffect(() => {
    if (!user?.is_admin) { navigate('/'); return; }
    load();
  }, [user, navigate, load]);

  // רענון אוטומטי של מצב השרת כל 30 שניות בטאב הסטטיסטיקות (בקרה חיה)
  useEffect(() => {
    if (activeTab !== 'stats' || !user?.is_admin) return;
    const id = setInterval(loadServerStatus, 30000);
    return () => clearInterval(id);
  }, [activeTab, user, loadServerStatus]);

  const updateUser = async (id, changes) => {
    setSaving(true);
    try {
      const result = await adminFetch(`/admin/users/${id}`, {
        method: 'PUT',
        body: JSON.stringify(changes),
      });
      if (result.error) throw new Error(result.error);
      setUsers(prev => prev.map(u => u.id === id ? { ...u, ...result } : u));
      toast({ title: 'המשתמש עודכן בהצלחה' });
      setEditUser(null);
      setNewPassword('');
    } catch (e) {
      toast({ title: e.message || 'שגיאה בעדכון', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const deleteUser = async (id) => {
    setSaving(true);
    try {
      const result = await adminFetch(`/admin/users/${id}`, { method: 'DELETE' });
      if (result.error) throw new Error(result.error);
      setUsers(prev => prev.filter(u => u.id !== id));
      setFarms(prev => prev.filter(f => f.owner?.id !== id));
      toast({ title: `משתמש נמחק (${result.deleted_farms} משקים)` });
      setDeleteConfirm(null);
    } catch (e) {
      toast({ title: e.message || 'שגיאה במחיקה', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  if (!user?.is_admin) return null;

  const sendNotification = async () => {
    if (!notifForm.title.trim()) return;
    setSendingNotif(true); setNotifResult(null);
    try {
      const body = { ...notifForm };
      if (!body.farm_id) delete body.farm_id;
      if (!body.recipient_id) delete body.recipient_id;
      const res = await fetch(`${BASE_URL}/admin/notifications`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify(body),
      });
      // fallback: use /api/notifications directly since admin can send system-wide
      const res2 = await fetch(`${BASE_URL}/notifications`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify(body),
      });
      if (res2.ok) {
        setNotifResult({ ok: true, msg: 'ההתראה נשלחה בהצלחה' });
        setNotifForm({ title: '', body: '', type: 'info', farm_id: '', recipient_id: '' });
        load();
      } else {
        const d = await res2.json();
        setNotifResult({ ok: false, msg: d.error || 'שגיאה בשליחה' });
      }
    } catch {
      setNotifResult({ ok: false, msg: 'שגיאת רשת' });
    }
    setSendingNotif(false);
  };

  const tabs = [
    { id: 'stats', label: 'סטטיסטיקות', icon: BarChart3 },
    { id: 'users', label: `משתמשים (${users.length})`, icon: Users },
    { id: 'farms', label: `משקים (${farms.length})`, icon: Building2 },
    { id: 'notifications', label: `התראות (${sentNotifs.length})`, icon: Bell },
  ];

  return (
    <div className="p-4 lg:p-8 max-w-7xl mx-auto" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="bg-red-600 p-2 rounded-xl">
            <ShieldCheck className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">פאנל ניהול</h1>
            <p className="text-sm text-gray-500">גישת מנהל מערכת</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`w-4 h-4 ml-2 ${loading ? 'animate-spin' : ''}`} />
          רענן
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
              activeTab === tab.id
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── STATS TAB ── */}
      {activeTab === 'stats' && stats && (
        <div className="space-y-6">
          {/* ── מצב שרת (בקרה) ── */}
          {serverStatus && (
            <Card className={serverStatus.disk?.use_percent >= 90 ? 'border-red-300 bg-red-50/30' : ''}>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center justify-between">
                  <span className="flex items-center gap-2"><Server className="w-4 h-4" /> מצב שרת</span>
                  <Button variant="ghost" size="sm" onClick={loadServerStatus} className="h-7 text-xs text-gray-500">
                    <RefreshCw className="w-3.5 h-3.5 ml-1" /> רענן
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {serverStatus.disk && (
                  <div>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-gray-600 flex items-center gap-1"><HardDrive className="w-3.5 h-3.5" /> דיסק</span>
                      <span className={`font-medium ${serverStatus.disk.use_percent >= 90 ? 'text-red-600' : serverStatus.disk.use_percent >= 80 ? 'text-amber-600' : 'text-gray-700'}`}>
                        {formatBytes(serverStatus.disk.used)} / {formatBytes(serverStatus.disk.total)} · {serverStatus.disk.use_percent}%
                      </span>
                    </div>
                    <UsageBar percent={serverStatus.disk.use_percent} />
                    <p className="text-xs text-gray-400 mt-1">פנוי: {formatBytes(serverStatus.disk.free)}</p>
                    {serverStatus.disk.use_percent >= 90 && (
                      <p className="text-xs text-red-600 mt-1 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> הדיסק כמעט מלא — פנה מקום בהקדם</p>
                    )}
                  </div>
                )}
                {serverStatus.memory && (
                  <div>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-gray-600">זיכרון (RAM)</span>
                      <span className="font-medium text-gray-700">{formatBytes(serverStatus.memory.used)} / {formatBytes(serverStatus.memory.total)} · {serverStatus.memory.use_percent}%</span>
                    </div>
                    <UsageBar percent={serverStatus.memory.use_percent} />
                    <p className="text-xs text-gray-400 mt-1">תהליך farm-flow: {formatBytes(serverStatus.memory.process_rss)}</p>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm pt-1 border-t">
                  <div className="flex justify-between pt-2"><span className="text-gray-500">קבצים מצורפים</span><span className="font-medium">{serverStatus.uploads?.count ?? 0} · {formatBytes(serverStatus.uploads?.size_bytes ?? 0)}</span></div>
                  <div className="flex justify-between pt-2"><span className="text-gray-500">גודל DB</span><span className="font-medium">{formatBytes(serverStatus.db_size_bytes ?? 0)}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500 flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> פעילות</span><span className="font-medium">{formatUptime(serverStatus.uptime_seconds)}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">עומס (1/5/15ד')</span><span className="font-medium font-mono text-xs">{(serverStatus.load_avg || []).join(' · ') || '—'}</span></div>
                </div>
                <div className="pt-2 border-t flex items-center justify-between gap-2">
                  <span className="text-xs text-gray-400">ניקוי אוטומטי רץ יומית. קבצים מקושרים לחשבוניות/עובדים נשמרים תמיד.</span>
                  <Button variant="outline" size="sm" onClick={cleanupUploads} disabled={cleaningUploads} className="h-8 text-xs flex-shrink-0">
                    {cleaningUploads ? <RefreshCw className="w-3.5 h-3.5 ml-1 animate-spin" /> : <Trash2 className="w-3.5 h-3.5 ml-1" />}
                    נקה קבצים ישנים
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard icon={Users} label="סה״כ משתמשים" value={stats.users.total}
              sub={`${stats.users.active} פעילים`} color="blue" />
            <StatCard icon={Crown} label="מנהלי מערכת" value={stats.users.admins}
              sub={`${stats.users.recent_30d} חדשים ב-30י'`} color="purple" />
            <StatCard icon={Building2} label="סה״כ משקים" value={stats.farms.total}
              color="green" />
            <StatCard icon={Database} label="רשומות נתונים" value={stats.entities.total.toLocaleString()}
              color="orange" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Entity breakdown */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">סוגי נתונים</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {stats.entities.breakdown.map(e => (
                    <div key={e.entity_type} className="flex justify-between items-center text-sm">
                      <span className="text-gray-600 capitalize">{e.entity_type.replace(/_/g, ' ')}</span>
                      <Badge variant="secondary">{e.cnt.toLocaleString()}</Badge>
                    </div>
                  ))}
                  {stats.entities.breakdown.length === 0 && (
                    <p className="text-gray-400 text-sm text-center py-4">אין נתונים</p>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* System info */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Server className="w-4 h-4" /> מידע מערכת
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500 flex items-center gap-1"><HardDrive className="w-3.5 h-3.5" /> גודל DB</span>
                  <span className="font-medium">{formatBytes(stats.system.db_size_bytes)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500 flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> זמן פעילות</span>
                  <span className="font-medium">{formatUptime(stats.system.uptime_seconds)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">גרסת Node.js</span>
                  <span className="font-medium font-mono">{stats.system.node_version}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">משתמשים חדשים (30י')</span>
                  <Badge className="bg-green-100 text-green-700">{stats.users.recent_30d}</Badge>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* ── USERS TAB ── */}
      {activeTab === 'users' && (
        <div className="space-y-3">
          {loading ? (
            <div className="text-center py-12 text-gray-400">טוען...</div>
          ) : users.map(u => (
            <Card key={u.id} className={`${!u.is_active ? 'opacity-60' : ''}`}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  {/* User info */}
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-semibold flex-shrink-0 ${
                      u.is_admin ? 'bg-red-500' : 'bg-indigo-500'
                    }`}>
                      {(u.full_name || u.email).charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium truncate">{u.full_name || '—'}</span>
                        {u.is_admin && <Badge className="bg-red-100 text-red-700 text-xs">אדמין</Badge>}
                        {!u.is_active && <Badge variant="outline" className="text-xs text-gray-400">מושבת</Badge>}
                        {u.id === user.id && <Badge className="bg-blue-100 text-blue-700 text-xs">אתה</Badge>}
                      </div>
                      <div className="text-sm text-gray-500 truncate">{u.email}</div>
                      <div className="text-xs text-gray-400">
                        {u.farms.map(f => f.name).join(', ') || 'אין משקים'} · {u.entity_count} רשומות
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  {u.id !== user.id && (
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {/* Toggle active */}
                      <Button
                        variant="outline" size="sm"
                        onClick={() => updateUser(u.id, { is_active: !u.is_active })}
                        className={u.is_active ? 'text-orange-600 border-orange-200' : 'text-green-600 border-green-200'}
                      >
                        {u.is_active ? <UserX className="w-4 h-4" /> : <UserCheck className="w-4 h-4" />}
                        <span className="mr-1 hidden sm:inline">{u.is_active ? 'השבת' : 'הפעל'}</span>
                      </Button>

                      {/* Toggle admin */}
                      <Button
                        variant="outline" size="sm"
                        onClick={() => updateUser(u.id, { is_admin: !u.is_admin })}
                        className={u.is_admin ? 'text-gray-600' : 'text-purple-600 border-purple-200'}
                      >
                        {u.is_admin ? <ShieldOff className="w-4 h-4" /> : <ShieldCheck className="w-4 h-4" />}
                        <span className="mr-1 hidden sm:inline">{u.is_admin ? 'הסר אדמין' : 'הפוך אדמין'}</span>
                      </Button>

                      {/* Edit */}
                      <Button
                        variant="outline" size="sm"
                        onClick={() => { setEditUser(u); setNewPassword(''); }}
                      >
                        עריכה
                      </Button>

                      {/* Delete */}
                      <Button
                        variant="outline" size="sm"
                        className="text-red-600 border-red-200"
                        onClick={() => setDeleteConfirm(u)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  )}
                </div>
                <div className="mt-2 text-xs text-gray-400">
                  נרשם: {u.created_at ? new Date(u.created_at).toLocaleDateString('he-IL') : '—'}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* ── FARMS TAB ── */}
      {activeTab === 'farms' && (
        <div className="space-y-3">
          {loading ? (
            <div className="text-center py-12 text-gray-400">טוען...</div>
          ) : farms.map(f => (
            <Card key={f.id}>
              <CardContent className="p-4 flex items-center justify-between flex-wrap gap-3">
                <div>
                  <div className="font-medium">{f.name}</div>
                  <div className="text-sm text-gray-500">
                    בעלים: {f.owner ? `${f.owner.full_name || f.owner.email}` : 'לא ידוע'}
                  </div>
                  <div className="text-xs text-gray-400">
                    {f.entity_count} רשומות · {f.created_at ? new Date(f.created_at).toLocaleDateString('he-IL') : ''}
                  </div>
                </div>
                <Badge variant="secondary">{f.entity_count} רשומות</Badge>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* ── EDIT USER DIALOG ── */}
      <Dialog open={!!editUser} onOpenChange={() => setEditUser(null)}>
        <DialogContent className="max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle>עריכת משתמש</DialogTitle>
          </DialogHeader>
          {editUser && (
            <div className="space-y-4 py-2">
              <div>
                <label className="text-sm font-medium text-gray-700 block mb-1">אימייל</label>
                <Input value={editUser.email} disabled className="bg-gray-50" />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700 block mb-1">שם מלא</label>
                <Input
                  value={editUser.full_name || ''}
                  onChange={e => setEditUser(u => ({ ...u, full_name: e.target.value }))}
                  placeholder="שם מלא"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700 block mb-1">איפוס סיסמה (השאר ריק לאי-שינוי)</label>
                <div className="relative">
                  <Input
                    type={showPassword ? 'text' : 'password'}
                    value={newPassword}
                    onChange={e => setNewPassword(e.target.value)}
                    placeholder="סיסמה חדשה (לפחות 6 תווים)"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(v => !v)}
                    className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={editUser.is_admin}
                    onChange={e => setEditUser(u => ({ ...u, is_admin: e.target.checked }))}
                    className="rounded"
                  />
                  מנהל מערכת
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={editUser.is_active}
                    onChange={e => setEditUser(u => ({ ...u, is_active: e.target.checked }))}
                    className="rounded"
                  />
                  חשבון פעיל
                </label>
              </div>
            </div>
          )}
          <DialogFooter className="flex gap-2">
            <Button variant="outline" onClick={() => setEditUser(null)}>ביטול</Button>
            <Button
              disabled={saving}
              onClick={() => updateUser(editUser.id, {
                full_name: editUser.full_name,
                is_admin: editUser.is_admin,
                is_active: editUser.is_active,
                ...(newPassword ? { new_password: newPassword } : {}),
              })}
            >
              {saving ? 'שומר...' : 'שמור'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── NOTIFICATIONS TAB ── */}
      {activeTab === 'notifications' && (
        <div className="space-y-6">
          {/* Send form */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Send className="w-4 h-4 text-indigo-600" /> שלח התראה חדשה
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div>
                  <Label className="mb-1 block">כותרת *</Label>
                  <Input placeholder="נושא ההתראה"
                    value={notifForm.title}
                    onChange={e => setNotifForm(p => ({ ...p, title: e.target.value }))} />
                </div>
                <div>
                  <Label className="mb-1 block">סוג</Label>
                  <Select value={notifForm.type} onValueChange={val => setNotifForm(p => ({ ...p, type: val }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="info">💬 מידע</SelectItem>
                      <SelectItem value="success">✅ הצלחה</SelectItem>
                      <SelectItem value="warning">⚠️ אזהרה</SelectItem>
                      <SelectItem value="error">🚨 דחוף</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label className="mb-1 block">תוכן</Label>
                <textarea
                  className="w-full border rounded-md px-3 py-2 text-sm min-h-[80px] resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="פרטים נוספים..."
                  value={notifForm.body}
                  onChange={e => setNotifForm(p => ({ ...p, body: e.target.value }))}
                />
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div>
                  <Label className="mb-1 block">משק יעד (ריק = כל המערכת)</Label>
                  <Select value={notifForm.farm_id || '__all__'} onValueChange={val => setNotifForm(p => ({ ...p, farm_id: val === '__all__' ? '' : val }))}>
                    <SelectTrigger><SelectValue placeholder="כל המשתמשים" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">🌐 כל המשתמשים</SelectItem>
                      {farms.map(f => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="mb-1 block">משתמש ספציפי (אופציונלי)</Label>
                  <Select value={notifForm.recipient_id || '__all__'} onValueChange={val => setNotifForm(p => ({ ...p, recipient_id: val === '__all__' ? '' : val }))}>
                    <SelectTrigger><SelectValue placeholder="כולם" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">👥 כולם</SelectItem>
                      {users.map(u => <SelectItem key={u.id} value={u.id}>{u.full_name || u.email}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {notifResult && (
                <div className={`flex items-center gap-2 text-sm p-2 rounded border ${notifResult.ok ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
                  {notifResult.ok ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
                  {notifResult.msg}
                </div>
              )}
              <Button onClick={sendNotification} disabled={sendingNotif || !notifForm.title.trim()} className="w-full lg:w-auto">
                {sendingNotif ? <RefreshCw className="w-4 h-4 animate-spin ml-2" /> : <Send className="w-4 h-4 ml-2" />}
                שלח התראה
              </Button>
            </CardContent>
          </Card>

          {/* History */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">היסטוריית התראות</CardTitle>
            </CardHeader>
            <CardContent>
              {sentNotifs.length === 0 ? (
                <p className="text-gray-400 text-sm text-center py-6">לא נשלחו התראות עדיין</p>
              ) : (
                <div className="space-y-2">
                  {sentNotifs.map(n => (
                    <div key={n.id} className="flex items-start justify-between gap-3 py-3 border-b last:border-0">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm">{n.type === 'error' ? '🚨' : n.type === 'warning' ? '⚠️' : n.type === 'success' ? '✅' : '💬'}</span>
                          <span className="font-medium text-sm truncate">{n.title}</span>
                        </div>
                        {n.body && <p className="text-xs text-gray-500 mt-0.5 truncate">{n.body}</p>}
                        <p className="text-xs text-gray-400 mt-0.5">
                          {n.sender_name || n.sender_email || '—'} ·{' '}
                          {n.farm_id ? `למשק ${farms.find(f => f.id === n.farm_id)?.name || n.farm_id.slice(0,8)}` : 'כל המערכת'} ·{' '}
                          {n.created_at ? new Date(n.created_at).toLocaleString('he-IL') : ''}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── DELETE CONFIRM DIALOG ── */}
      <Dialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <DialogContent className="max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="w-5 h-5" /> מחיקת משתמש
            </DialogTitle>
          </DialogHeader>
          {deleteConfirm && (
            <div className="py-2 space-y-3">
              <p className="text-gray-700">
                האם למחוק את המשתמש <strong>{deleteConfirm.full_name || deleteConfirm.email}</strong>?
              </p>
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
                <strong>פעולה בלתי הפיכה!</strong> יימחקו:
                <ul className="mt-1 list-disc list-inside">
                  <li>{deleteConfirm.farms.length} משקים</li>
                  <li>{deleteConfirm.entity_count} רשומות נתונים</li>
                </ul>
              </div>
            </div>
          )}
          <DialogFooter className="flex gap-2">
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>ביטול</Button>
            <Button
              variant="destructive"
              disabled={saving}
              onClick={() => deleteUser(deleteConfirm.id)}
            >
              {saving ? 'מוחק...' : 'מחק לצמיתות'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
