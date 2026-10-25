import React, { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Plug, Loader2, Save, Info, CheckCircle2, XCircle, RefreshCw, Users, Truck, Package, FlaskConical, ExternalLink } from "lucide-react";
import { getToken } from "@/api/localClient";

const BASE_URL = import.meta.env.VITE_API_URL || "/api";

async function apiFetch(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}`, ...(options.headers || {}) },
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = { error: text.slice(0, 200) }; }
  if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { status: res.status, data });
  return data;
}

const fmtTime = (iso) => { try { return new Date(iso).toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" }); } catch { return iso; } };

export default function IntegrationsManager({ currentFarm }) {
  const farmQs = currentFarm?.id ? `?farm_id=${encodeURIComponent(currentFarm.id)}` : "";
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [cfg, setCfg] = useState(null);
  const [form, setForm] = useState({ api_key: "", contact_email: "", contact_phone: "", test_mode: true, vat_included: false, enabled: false });
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [syncing, setSyncing] = useState(null);
  const [message, setMessage] = useState(null);

  const flash = (type, text, ms = 6000) => { setMessage({ type, text }); setTimeout(() => setMessage(null), ms); };

  const load = async () => {
    setLoading(true);
    try {
      const d = await apiFetch(`/integrations/maven/config${farmQs}`);
      setCfg(d);
      setForm({ api_key: "", contact_email: d.contact_email || "", contact_phone: d.contact_phone || "", test_mode: d.test_mode, vat_included: d.vat_included, enabled: d.enabled });
      setForbidden(false);
    } catch (e) {
      if (e.status === 403) setForbidden(true); else flash("error", e.message || "שגיאה בטעינה");
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [currentFarm?.id]);

  const save = async (patch = {}) => {
    setSaving(true);
    try {
      const body = { contact_email: form.contact_email, contact_phone: form.contact_phone, test_mode: form.test_mode, vat_included: form.vat_included, enabled: form.enabled, ...patch };
      if (form.api_key.trim()) body.api_key = form.api_key.trim();
      const d = await apiFetch(`/integrations/maven/config${farmQs}`, { method: "POST", body: JSON.stringify(body) });
      setCfg(d);
      setForm((f) => ({ ...f, api_key: "", enabled: d.enabled, test_mode: d.test_mode, vat_included: d.vat_included }));
      flash("success", "ההגדרות נשמרו");
    } catch (e) {
      if (e.status === 403) setForbidden(true); else flash("error", e.message || "שגיאה בשמירה");
    } finally { setSaving(false); }
  };

  const toggleEnabled = async (v) => {
    if (v && !cfg?.configured && !form.api_key.trim()) { flash("error", "הזן מפתח API ושמור לפני ההפעלה"); return; }
    setForm((f) => ({ ...f, enabled: v }));
    await save({ enabled: v });
  };

  const testConnection = async () => {
    setTesting(true); setTestResult(null);
    try {
      const d = await apiFetch(`/integrations/maven/test${farmQs}`, { method: "POST" });
      setTestResult({ ok: true, text: `החיבור תקין. לקוחות ב-Maven: ${d.customers_total ?? "?"}` });
    } catch (e) {
      setTestResult({ ok: false, text: e.data?.error || e.message });
    } finally { setTesting(false); }
  };

  const sync = async (what) => {
    setSyncing(what);
    try {
      const d = await apiFetch(`/integrations/maven/sync${farmQs}`, { method: "POST", body: JSON.stringify({ what }) });
      const parts = what === "items"
        ? [`${d.pushed}/${d.products} מוצרים נשלחו`, ...(d.errors?.length ? [`שגיאות: ${d.errors.join("; ")}`] : [])]
        : [`${d.remote} ב-Maven`, `${d.created} נוצרו`, `${d.linked} קושרו`, `${d.updated} עודכנו`];
      flash("success", parts.join(" · "), 9000);
      await load();
    } catch (e) {
      flash("error", e.data?.error || e.message || "שגיאת סנכרון", 9000);
    } finally { setSyncing(null); }
  };

  if (loading) return <div className="flex justify-center items-center h-40"><Loader2 className="w-6 h-6 animate-spin text-indigo-500" /></div>;

  const ls = cfg?.last_sync || {};
  const SyncRow = ({ what, icon: Icon, label, hint }) => (
    <div className="flex flex-wrap items-center gap-3 p-3 rounded-lg border bg-gray-50">
      <Button variant="outline" onClick={() => sync(what)} disabled={!cfg?.enabled || !!syncing} className="min-w-[180px]">
        {syncing === what ? <Loader2 className="w-4 h-4 animate-spin ml-1" /> : <Icon className="w-4 h-4 ml-1" />}
        {label}
      </Button>
      <div className="text-xs text-gray-600 flex-1 min-w-[200px]">
        <div>{hint}</div>
        {ls[what]?.at && (
          <div className="text-gray-400 mt-0.5">
            סנכרון אחרון {fmtTime(ls[what].at)} · {what === "items" ? `${ls[what].pushed} נשלחו` : `${ls[what].created} נוצרו, ${ls[what].linked} קושרו`}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="space-y-6" dir="rtl">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plug className="w-5 h-5 text-indigo-500" />
            Invoice Maven — הפקת מסמכים והנהלת חשבונות
            {cfg?.enabled
              ? <span className="text-xs font-normal px-2 py-0.5 rounded-full bg-green-100 text-green-700">מופעל{cfg.test_mode ? " · מצב בדיקה" : ""}</span>
              : <span className="text-xs font-normal px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">כבוי</span>}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {forbidden ? (
            <div className="flex items-start gap-3 text-sm text-amber-700"><Info className="w-5 h-5 shrink-0 mt-0.5" /><span>הגדרת אינטגרציות זמינה לבעלים ולמנהלי המשק בלבד.</span></div>
          ) : (
            <>
              <div className="flex gap-2 p-3 rounded-lg border bg-indigo-50 border-indigo-100 text-indigo-800 text-sm">
                <Info className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  מחברים את המשק לחשבון Invoice Maven. לאחר ההפעלה אפשר למשוך לקוחות וספקים, לסנכרן את המוצרים כפריטים עם מק"ט משותף,
                  ולהפיק תעודת משלוח או חשבונית ישירות מתעודת שקילה. את מפתח ה-API מעתיקים מתוך Maven: הגדרות ← API.{" "}
                  <a href="https://www.invoice-maven.co.il/support/api/" target="_blank" rel="noreferrer" className="underline inline-flex items-center gap-0.5">תיעוד <ExternalLink className="w-3 h-3" /></a>
                </span>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-sm">הפעל את האינטגרציה</Label>
                  <p className="text-[11px] text-gray-400">כשכבוי, כפתורי Maven לא מוצגים בתעודות השקילה.</p>
                </div>
                <Switch checked={!!form.enabled} onCheckedChange={toggleEnabled} disabled={saving} />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2 sm:col-span-2">
                  <Label>מפתח API {cfg?.configured && <span className="text-xs text-gray-400 font-normal">(שמור, מסתיים ב-…{cfg.api_key_last4}. הזן חדש כדי להחליף)</span>}</Label>
                  <Input type="password" dir="ltr" placeholder={cfg?.configured ? "••••••••••••" : "הדבק כאן את המפתח מ-Maven"} value={form.api_key} onChange={(e) => setForm({ ...form, api_key: e.target.value })} className="font-mono" />
                </div>
                <div className="space-y-2">
                  <Label>אימייל איש קשר (נדרש ע"י Maven)</Label>
                  <Input type="email" dir="ltr" value={form.contact_email} onChange={(e) => setForm({ ...form, contact_email: e.target.value })} placeholder="name@example.com" />
                </div>
                <div className="space-y-2">
                  <Label>טלפון איש קשר (נדרש ע"י Maven)</Label>
                  <Input dir="ltr" value={form.contact_phone} onChange={(e) => setForm({ ...form, contact_phone: e.target.value })} placeholder="050-0000000" />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex items-center justify-between p-3 rounded-lg border">
                  <div>
                    <Label className="text-sm flex items-center gap-1"><FlaskConical className="w-4 h-4 text-amber-500" /> מצב בדיקה</Label>
                    <p className="text-[11px] text-gray-400">מסמכים ופריטים לא נשמרים ב-Maven. כבה כשמוכנים לעבוד באמת.</p>
                  </div>
                  <Switch checked={!!form.test_mode} onCheckedChange={(v) => setForm({ ...form, test_mode: v })} />
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg border">
                  <div>
                    <Label className="text-sm">המחירים כוללים מע"מ</Label>
                    <p className="text-[11px] text-gray-400">משפיע על מסמכים ופריטים שנשלחים ל-Maven.</p>
                  </div>
                  <Switch checked={!!form.vat_included} onCheckedChange={(v) => setForm({ ...form, vat_included: v })} />
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button onClick={() => save()} disabled={saving} className="bg-indigo-600 hover:bg-indigo-700 text-white">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin ml-1" /> : <Save className="w-4 h-4 ml-1" />} שמור הגדרות
                </Button>
                <Button variant="outline" onClick={testConnection} disabled={testing || !cfg?.configured}>
                  {testing ? <Loader2 className="w-4 h-4 animate-spin ml-1" /> : <RefreshCw className="w-4 h-4 ml-1" />} בדוק חיבור
                </Button>
                {testResult && (
                  <span className={`inline-flex items-center gap-1 text-sm ${testResult.ok ? "text-green-700" : "text-red-700"}`}>
                    {testResult.ok ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}{testResult.text}
                  </span>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {!forbidden && (
        <Card>
          <CardHeader><CardTitle className="text-base">סנכרון נתונים</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {!cfg?.enabled && <p className="text-sm text-amber-600">הפעל את האינטגרציה כדי לסנכרן.</p>}
            <SyncRow what="customers" icon={Users} label="משוך לקוחות מ-Maven" hint="לקוחות מ-Maven מתווספים לרשימת הלקוחות של המשק. לקוח קיים (לפי ח.פ או שם זהה) מקושר ולא משוכפל." />
            <SyncRow what="suppliers" icon={Truck} label="משוך ספקים מ-Maven" hint="ספקים מ-Maven מתווספים לרשימת הספקים (לחשבוניות). ספק קיים לפי ח.פ או שם מקושר." />
            <SyncRow what="items" icon={Package} label="סנכרן מוצרים כפריטים" hint='המוצרים של המשק נשלחים ל-Maven כפריטים עם מק"ט משותף (FF-xxxxxxxx). שורות במסמכים משתמשות במק"ט הזה.' />
          </CardContent>
        </Card>
      )}

      {message && (
        <div className={`p-3 rounded-lg text-sm border ${message.type === "success" ? "bg-green-50 text-green-700 border-green-200" : "bg-red-50 text-red-700 border-red-200"}`}>{message.text}</div>
      )}
    </div>
  );
}
