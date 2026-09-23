import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Receipt, Loader2, Save, Info } from 'lucide-react';
import { getToken } from '@/api/localClient';
import { useToast } from '@/components/ui/use-toast';

const BASE_URL = import.meta.env.VITE_API_URL || '/api';

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

export default function BookkeeperSettingsManager() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [recipient, setRecipient] = useState('');
  const [cc, setCc] = useState('');
  const [autoSend, setAutoSend] = useState(true);
  const { toast } = useToast();

  const load = async () => {
    setLoading(true);
    try {
      const s = await api('/settings/bookkeeper');
      setRecipient(s.recipient_email || '');
      setCc(s.cc_email || '');
      setAutoSend(s.auto_send !== false);
    } catch (e) {
      toast({ title: 'שגיאה בטעינת ההגדרות', description: e.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const save = async () => {
    setSaving(true);
    try {
      await api('/settings/bookkeeper', {
        method: 'PUT',
        body: JSON.stringify({
          recipient_email: recipient.trim() || null,
          cc_email: cc.trim() || null,
          auto_send: autoSend,
        }),
      });
      toast({ title: 'ההגדרות נשמרו' });
      load();
    } catch (e) {
      toast({ title: 'שגיאה בשמירה', description: e.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-40"><Loader2 className="w-6 h-6 animate-spin text-indigo-600" /></div>;
  }

  return (
    <Card dir="rtl">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Receipt className="w-5 h-5 text-indigo-600" />
          שליחת חשבוניות למנהלת החשבונות
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 max-w-lg">
        <div>
          <Label className="text-xs">כתובת מנהלת החשבונות</Label>
          <Input type="email" dir="ltr" value={recipient} onChange={e => setRecipient(e.target.value)} placeholder="bookkeeper@example.com" />
        </div>
        <div>
          <Label className="text-xs">עותק לעצמך (CC) — אופציונלי</Label>
          <Input type="email" dir="ltr" value={cc} onChange={e => setCc(e.target.value)} placeholder="—" />
        </div>
        <div className="flex items-center justify-between rounded-lg border p-3">
          <div>
            <p className="text-sm font-medium">שליחה אוטומטית אחרי סריקה</p>
            <p className="text-xs text-gray-500">מיד עם סריקת חשבונית, היא תישלח אוטומטית לכתובת היעד.</p>
          </div>
          <Switch checked={autoSend} onCheckedChange={setAutoSend} />
        </div>

        <div className="flex gap-2 text-xs bg-amber-50 border border-amber-200 rounded-lg p-3 text-amber-800">
          <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>השליחה מתבצעת דרך חשבון ה-Gmail המחובר שלך. אם השליחה נכשלת עם בקשת הרשאה,
            עבור ללשונית <strong>Gmail</strong> ולחץ "חבר מחדש" כדי לאשר הרשאת שליחה.</span>
        </div>

        <Button onClick={save} disabled={saving} className="w-full sm:w-auto">
          {saving ? <Loader2 className="w-4 h-4 animate-spin ml-1" /> : <Save className="w-4 h-4 ml-1" />}
          שמור הגדרות
        </Button>
      </CardContent>
    </Card>
  );
}
