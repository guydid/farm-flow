import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Clock, Eye, EyeOff, Copy, Check, Loader2, RefreshCw, ShieldAlert, Info, BellRing, Send
} from "lucide-react";
import { getToken } from "@/api/localClient";

const BASE_URL = import.meta.env.VITE_API_URL || "/api";

async function apiFetch(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getToken()}`,
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { error: text.slice(0, 200) }; }
  if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { status: res.status });
  return data;
}

// dow 0=Sun … 6=Sat (matches the backend / JS getDay())
const DAYS = [
  { dow: 0, label: "א'" }, { dow: 1, label: "ב'" }, { dow: 2, label: "ג'" },
  { dow: 3, label: "ד'" }, { dow: 4, label: "ה'" }, { dow: 5, label: "ו'" }, { dow: 6, label: "ש'" },
];

export default function AttendanceSettingsManager({ currentFarm }) {
  const [apiKey, setApiKey] = useState(null);
  const [syncPath, setSyncPath] = useState("/api/attendance/sync");
  const [loading, setLoading] = useState(true);
  const [rotating, setRotating] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [show, setShow] = useState(false);
  const [copied, setCopied] = useState(null);
  const [message, setMessage] = useState(null);

  // ── Absence-alert config ──
  const [cfg, setCfg] = useState(null);
  const [alertForbidden, setAlertForbidden] = useState(false);
  const [savingCfg, setSavingCfg] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState(null);

  useEffect(() => { load(); loadAlertConfig(); }, []);

  const load = async () => {
    setLoading(true);
    try {
      const d = await apiFetch("/attendance/apikey");
      setApiKey(d.api_key);
      if (d.sync_path) setSyncPath(d.sync_path);
      setForbidden(false);
    } catch (e) {
      if (e.status === 403) setForbidden(true);
      else setMessage({ type: "error", text: e.message || "שגיאה בטעינה" });
    } finally {
      setLoading(false);
    }
  };

  const loadAlertConfig = async () => {
    try {
      const d = await apiFetch("/attendance/alert-config");
      setCfg(d);
      setAlertForbidden(false);
    } catch (e) {
      if (e.status === 403) setAlertForbidden(true);
      else if (e.status === 400) setCfg(null); // no farm selected
    }
  };

  const rotate = async () => {
    if (!confirm("ליצור מפתח חדש? המפתח הישן יפסיק לעבוד וצריך לעדכן את הגשר.")) return;
    setRotating(true);
    try {
      const d = await apiFetch("/attendance/apikey", { method: "POST" });
      setApiKey(d.api_key);
      setMessage({ type: "success", text: "נוצר מפתח חדש" });
      setTimeout(() => setMessage(null), 4000);
    } catch (e) {
      setMessage({ type: "error", text: e.message || "שגיאה" });
    } finally {
      setRotating(false);
    }
  };

  const patchCfg = (patch) => setCfg((c) => ({ ...c, ...patch }));
  const toggleDay = (dow) => {
    const days = new Set(cfg.work_days || []);
    days.has(dow) ? days.delete(dow) : days.add(dow);
    patchCfg({ work_days: [...days].sort((a, b) => a - b) });
  };

  const saveCfg = async () => {
    setSavingCfg(true);
    try {
      const d = await apiFetch("/attendance/alert-config", {
        method: "POST",
        body: JSON.stringify({
          enabled: cfg.enabled,
          check_time: cfg.check_time,
          work_days: cfg.work_days,
          channel_in_app: cfg.channel_in_app,
          channel_telegram: cfg.channel_telegram,
        }),
      });
      setCfg(d);
      setMessage({ type: "success", text: "הגדרות ההתראה נשמרו" });
      setTimeout(() => setMessage(null), 4000);
    } catch (e) {
      setMessage({ type: "error", text: e.message || "שגיאה בשמירה" });
    } finally {
      setSavingCfg(false);
    }
  };

  const runCheck = async (notify) => {
    setChecking(true);
    setCheckResult(null);
    try {
      const d = await apiFetch("/attendance/check-absences", {
        method: "POST",
        body: JSON.stringify({ notify: !!notify }),
      });
      setCheckResult(d);
      if (notify) {
        setMessage({ type: "success", text: `התראה נשלחה (אפליקציה: ${d.dispatched?.in_app ? "כן" : "לא"}, טלגרם: ${d.dispatched?.telegram || 0})` });
        setTimeout(() => setMessage(null), 5000);
      }
    } catch (e) {
      setMessage({ type: "error", text: e.message || "שגיאה בבדיקה" });
    } finally {
      setChecking(false);
    }
  };

  const copy = (text, which) => {
    navigator.clipboard?.writeText(text);
    setCopied(which);
    setTimeout(() => setCopied(null), 1500);
  };

  const syncUrl = `${window.location.origin}${syncPath}`;
  const configSnippet = JSON.stringify({
    farmflow: {
      api_url: window.location.origin,
      api_key: apiKey || "<API_KEY>",
      farm_id: currentFarm?.id || "<FARM_ID>",
    },
  }, null, 2);

  if (loading) return (
    <div className="flex justify-center items-center h-40">
      <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
    </div>
  );

  return (
    <div className="space-y-6" dir="rtl">
      {/* ── מפתח סנכרון (אדמין) ── */}
      {forbidden ? (
        <Card>
          <CardContent className="p-6 flex items-start gap-3 text-sm text-amber-700">
            <ShieldAlert className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <span>ניהול מפתח סנכרון השעון זמין למנהלי מערכת בלבד.</span>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="w-5 h-5 text-indigo-500" />
              שעון נוכחות — מפתח סנכרון
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2 p-3 rounded-lg border bg-indigo-50 border-indigo-100 text-indigo-700 text-sm">
              <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>גשר ה-Python (farmflow_sync.py) שרץ על מחשב השעון משתמש במפתח זה כדי לדחוף נתוני נוכחות. העתק את המפתח וה-URL להגדרות הגשר.</span>
            </div>

            {/* API key */}
            <div className="space-y-2">
              <Label>מפתח API</Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    type={show ? "text" : "password"}
                    value={apiKey || ""}
                    readOnly
                    className="pl-10 font-mono text-sm"
                    dir="ltr"
                  />
                  <button type="button" onClick={() => setShow(!show)}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                    {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <Button variant="outline" onClick={() => copy(apiKey, "key")}>
                  {copied === "key" ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                </Button>
                <Button onClick={rotate} disabled={rotating} className="bg-indigo-600 hover:bg-indigo-700 text-white">
                  {rotating ? <Loader2 className="w-4 h-4 animate-spin ml-1" /> : <RefreshCw className="w-4 h-4 ml-1" />}
                  מפתח חדש
                </Button>
              </div>
            </div>

            {/* Sync URL */}
            <div className="space-y-2">
              <Label>כתובת ה-Sync</Label>
              <div className="flex gap-2">
                <Input value={syncUrl} readOnly className="font-mono text-sm" dir="ltr" />
                <Button variant="outline" onClick={() => copy(syncUrl, "url")}>
                  {copied === "url" ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                </Button>
              </div>
            </div>

            {/* config.json snippet */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>קטע ל-config.json של הגשר</Label>
                <Button variant="ghost" size="sm" onClick={() => copy(configSnippet, "cfg")}>
                  {copied === "cfg" ? <Check className="w-4 h-4 text-green-600 ml-1" /> : <Copy className="w-4 h-4 ml-1" />}
                  העתק
                </Button>
              </div>
              <pre className="p-3 rounded-lg bg-gray-900 text-gray-100 text-xs overflow-x-auto" dir="ltr">{configSnippet}</pre>
              {!currentFarm?.id && (
                <p className="text-xs text-amber-600">בחר משק פעיל כדי לקבל את ה-farm_id הנכון.</p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── התראות היעדרות ── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BellRing className="w-5 h-5 text-amber-500" />
            התראות היעדרות — עובדים שלא הגיעו
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {alertForbidden ? (
            <div className="flex items-start gap-3 text-sm text-amber-700">
              <ShieldAlert className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <span>הגדרת התראות היעדרות זמינה לבעלים/מנהלי משק בלבד.</span>
            </div>
          ) : !cfg ? (
            <p className="text-sm text-amber-600">בחר משק פעיל כדי להגדיר התראות היעדרות.</p>
          ) : (
            <>
              <div className="flex gap-2 p-3 rounded-lg border bg-amber-50 border-amber-100 text-amber-800 text-sm">
                <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>בשעה ובימים שתגדיר, המערכת בודקת אילו עובדים שבמעקב לא הוחתמו בשעון, ושולחת התראה. עובדים נכנסים למעקב אוטומטית; הסרה מתבצעת בעמוד "שעון נוכחות".</span>
              </div>

              {/* enable */}
              <div className="flex items-center justify-between">
                <Label className="text-sm">הפעל התראות יומיות</Label>
                <Switch checked={!!cfg.enabled} onCheckedChange={(v) => patchCfg({ enabled: v })} />
              </div>

              {/* check time */}
              <div className="space-y-2">
                <Label>שעת בדיקה</Label>
                <Input
                  type="time"
                  value={cfg.check_time || "09:00"}
                  onChange={(e) => patchCfg({ check_time: e.target.value })}
                  className="w-36"
                  dir="ltr"
                />
                <p className="text-[11px] text-gray-400">לפי שעון ישראל. הבדיקה רצה פעם ביום בשעה זו או אחריה.</p>
              </div>

              {/* work days */}
              <div className="space-y-2">
                <Label>ימי בדיקה</Label>
                <div className="flex gap-1.5">
                  {DAYS.map((d) => {
                    const on = (cfg.work_days || []).includes(d.dow);
                    return (
                      <button
                        key={d.dow}
                        type="button"
                        onClick={() => toggleDay(d.dow)}
                        className={`w-9 h-9 rounded-full text-sm font-medium transition-colors ${
                          on ? "bg-indigo-600 text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                        }`}
                      >
                        {d.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* channels */}
              <div className="space-y-2">
                <Label>ערוצי התראה</Label>
                <div className="flex items-center gap-2">
                  <Checkbox id="ch-inapp" checked={!!cfg.channel_in_app} onCheckedChange={(v) => patchCfg({ channel_in_app: !!v })} />
                  <Label htmlFor="ch-inapp" className="text-sm font-normal cursor-pointer">התראה באפליקציה</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox id="ch-tg" checked={!!cfg.channel_telegram} onCheckedChange={(v) => patchCfg({ channel_telegram: !!v })} />
                  <Label htmlFor="ch-tg" className="text-sm font-normal cursor-pointer">טלגרם (לבעלים/מנהלים מקושרים)</Label>
                </div>
              </div>

              {cfg.last_run_at && (
                <p className="text-[11px] text-gray-400">
                  בדיקה אחרונה: {cfg.last_run_date}
                  {Array.isArray(cfg.last_absentees) && cfg.last_absentees.length > 0
                    ? ` · נעדרו: ${cfg.last_absentees.join(", ")}`
                    : " · כולם נכחו"}
                </p>
              )}

              <div className="flex flex-wrap gap-2 pt-1">
                <Button onClick={saveCfg} disabled={savingCfg} className="bg-indigo-600 hover:bg-indigo-700 text-white">
                  {savingCfg ? <Loader2 className="w-4 h-4 animate-spin ml-1" /> : <Check className="w-4 h-4 ml-1" />}
                  שמור הגדרות
                </Button>
                <Button variant="outline" onClick={() => runCheck(false)} disabled={checking}>
                  {checking ? <Loader2 className="w-4 h-4 animate-spin ml-1" /> : <RefreshCw className="w-4 h-4 ml-1" />}
                  בדוק עכשיו
                </Button>
                <Button variant="outline" onClick={() => runCheck(true)} disabled={checking} className="text-amber-700 border-amber-300">
                  <Send className="w-4 h-4 ml-1" />
                  שלח התראת בדיקה
                </Button>
              </div>

              {checkResult && (
                <div className="p-3 rounded-lg border bg-gray-50 text-sm space-y-1">
                  <div className="text-gray-700">
                    {checkResult.absentees?.length === 0
                      ? `כל ${checkResult.monitored} העובדים שבמעקב נכחו 🎉`
                      : `${checkResult.absentees.length} מתוך ${checkResult.monitored} לא הגיעו (${checkResult.today}):`}
                  </div>
                  {checkResult.absentees?.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {checkResult.absentees.map((a) => (
                        <span key={a.time_clock_id} className="px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-xs">{a.name}</span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {message && (
        <div className={`flex items-center gap-2 p-3 rounded-lg text-sm border ${
          message.type === "success"
            ? "bg-green-50 text-green-700 border-green-200"
            : "bg-red-50 text-red-700 border-red-200"
        }`}>
          {message.text}
        </div>
      )}
    </div>
  );
}
