import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2, XCircle, Loader2, Trash2,
  Eye, EyeOff, Info, Send, Copy, RefreshCw, AlertTriangle
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
  try { data = JSON.parse(text); } catch { throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`); }
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

// Telegram logo SVG
const TelegramIcon = () => (
  <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current text-blue-500">
    <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12L8.32 13.617l-2.96-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.828.942z"/>
  </svg>
);

export default function TelegramSettings() {
  const [status, setStatus]     = useState(null); // { enabled, bot_username, bot_name, webhook_set }
  const [groqStatus, setGroqStatus] = useState(null); // { has_api_key, source }
  const [loading, setLoading]   = useState(true);
  const [token, setToken]       = useState("");
  const [showToken, setShowToken] = useState(false);
  const [saving, setSaving]     = useState(false);
  const [message, setMessage]   = useState(null);

  // Link code state
  const [linkCode, setLinkCode]   = useState(null); // { code, expires_in }
  const [genningCode, setGenningCode] = useState(false);
  const [copied, setCopied]       = useState(false);
  const [codeTimer, setCodeTimer] = useState(0);

  useEffect(() => { loadStatus(); }, []);

  // Countdown for link code
  useEffect(() => {
    if (!linkCode) return;
    setCodeTimer(linkCode.expires_in);
    const iv = setInterval(() => setCodeTimer(t => {
      if (t <= 1) { clearInterval(iv); setLinkCode(null); return 0; }
      return t - 1;
    }), 1000);
    return () => clearInterval(iv);
  }, [linkCode]);

  const loadStatus = async () => {
    setLoading(true);
    try {
      const [tg, groq] = await Promise.allSettled([
        apiFetch("/telegram/config"),
        apiFetch("/settings/groq"),
      ]);
      if (tg.status === 'fulfilled') setStatus(tg.value);
      if (groq.status === 'fulfilled') setGroqStatus(groq.value);
    } catch { setMessage({ type: "error", text: "שגיאה בטעינת הגדרות" }); }
    finally { setLoading(false); }
  };

  const handleSave = async () => {
    if (!token.trim()) return;
    setSaving(true);
    setMessage(null);
    try {
      const data = await apiFetch("/telegram/config", {
        method: "POST",
        body: JSON.stringify({ token: token.trim() }),
      });
      if (data.success) {
        setMessage({ type: "success", text: `✅ בוט @${data.bot_username} מחובר בהצלחה!` });
        setToken("");
        loadStatus();
      } else {
        setMessage({ type: "error", text: data.error || "שגיאה בחיבור הבוט" });
      }
    } catch (e) {
      setMessage({ type: "error", text: `שגיאה: ${e.message}` });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm("למחוק את חיבור הבוט? ניתן לחבר מחדש בכל עת.")) return;
    setMessage(null);
    try {
      await apiFetch("/telegram/config", { method: "DELETE" });
      setMessage({ type: "success", text: "בוט נותק" });
      loadStatus();
    } catch { setMessage({ type: "error", text: "שגיאה במחיקה" }); }
  };

  const handleGenerateCode = async () => {
    setGenningCode(true);
    try {
      const data = await apiFetch("/telegram/generate-link-code", { method: "POST" });
      setLinkCode(data);
    } catch { setMessage({ type: "error", text: "שגיאה ביצירת קוד" }); }
    finally { setGenningCode(false); }
  };

  const handleCopy = () => {
    if (!linkCode) return;
    navigator.clipboard.writeText(`/link ${linkCode.code}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) return (
    <div className="flex justify-center items-center h-40">
      <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
    </div>
  );

  return (
    <div className="space-y-6" dir="rtl">

      {/* ── Bot status ── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TelegramIcon />
            בוט טלגרם
          </CardTitle>
          <CardDescription>
            חבר בוט טלגרם ייעודי למשק — עובדים יוכלו לשלוח שאלות ולקבל מידע בזמן אמת.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">

          {/* Current status */}
          <div className={`flex items-center gap-3 p-3 rounded-lg ${status?.enabled ? "bg-green-50" : "bg-gray-50"}`}>
            {status?.enabled ? (
              <>
                <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" />
                <div className="flex-1">
                  <p className="font-medium text-green-700">בוט פעיל</p>
                  <p className="text-sm text-gray-500 font-mono">@{status.bot_username}</p>
                </div>
                <Badge className="bg-green-100 text-green-700 border-green-200">מחובר</Badge>
              </>
            ) : (
              <>
                <XCircle className="w-5 h-5 text-gray-400 flex-shrink-0" />
                <div className="flex-1">
                  <p className="font-medium text-gray-600">אין בוט מחובר</p>
                  <p className="text-sm text-gray-400">הגדר בוט כדי לאפשר שאלות בטלגרם</p>
                </div>
                <Badge variant="outline" className="text-gray-500">לא פעיל</Badge>
              </>
            )}
          </div>

          {/* Token input */}
          {!status?.enabled && (
            <div className="space-y-3">
              <div className="space-y-2">
                <Label>Telegram Bot Token</Label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input
                      type={showToken ? "text" : "password"}
                      value={token}
                      onChange={e => setToken(e.target.value)}
                      placeholder="1234567890:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
                      className="pl-10 font-mono text-sm"
                      dir="ltr"
                      onKeyDown={e => e.key === "Enter" && handleSave()}
                    />
                    <button
                      type="button"
                      onClick={() => setShowToken(!showToken)}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <Button onClick={handleSave} disabled={!token.trim() || saving}
                    className="bg-blue-500 hover:bg-blue-600 text-white">
                    {saving ? <Loader2 className="w-4 h-4 animate-spin ml-1" /> : <Send className="w-4 h-4 ml-1" />}
                    חבר
                  </Button>
                </div>
              </div>

              {/* Instructions */}
              <div className="p-3 rounded-lg bg-blue-50 border border-blue-100 space-y-2">
                <p className="text-sm font-medium text-blue-700 flex items-center gap-1">
                  <Info className="w-3.5 h-3.5" />
                  איך יוצרים בוט?
                </p>
                <ol className="text-sm text-blue-600 space-y-1 list-decimal list-inside">
                  <li>פתח טלגרם וחפש <span className="font-mono font-bold">@BotFather</span></li>
                  <li>שלח <span className="font-mono">/newbot</span></li>
                  <li>בחר שם לבוט (לדוגמה: <span className="font-mono">Meshek91Bot</span>)</li>
                  <li>BotFather ישלח לך Token — הדבק אותו למעלה</li>
                </ol>
              </div>
            </div>
          )}

          {/* Active bot actions */}
          {status?.enabled && (
            <Button variant="outline" size="sm" onClick={handleDelete}
              className="text-red-500 border-red-200 hover:bg-red-50">
              <Trash2 className="w-3.5 h-3.5 ml-1.5" />
              נתק בוט
            </Button>
          )}
        </CardContent>
      </Card>

      {/* ── Link my Telegram account ── */}
      {status?.enabled && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">חיבור חשבון אישי</CardTitle>
            <CardDescription>
              צור קוד חד פעמי ושלח אותו לבוט כדי לקשר את חשבון הטלגרם שלך.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!linkCode ? (
              <Button onClick={handleGenerateCode} disabled={genningCode} variant="outline">
                {genningCode
                  ? <><Loader2 className="w-4 h-4 animate-spin ml-2" />יוצר קוד...</>
                  : <><RefreshCw className="w-4 h-4 ml-2" />צור קוד חיבור</>}
              </Button>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-3 p-4 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
                  <div className="flex-1">
                    <p className="text-xs text-gray-500 mb-1">שלח לבוט @{status.bot_username}:</p>
                    <p className="font-mono text-xl font-bold tracking-widest text-gray-800">
                      /link {linkCode.code}
                    </p>
                  </div>
                  <div className="flex flex-col items-center gap-1">
                    <Button size="sm" variant="outline" onClick={handleCopy}>
                      <Copy className="w-3.5 h-3.5 ml-1" />
                      {copied ? "הועתק!" : "העתק"}
                    </Button>
                    <span className="text-xs text-gray-400">{Math.floor(codeTimer / 60)}:{String(codeTimer % 60).padStart(2, "0")}</span>
                  </div>
                </div>
                <p className="text-xs text-gray-500">
                  הקוד תקף ל-10 דקות. פתח צ'אט עם{" "}
                  <a href={`https://t.me/${status.bot_username}`} target="_blank" rel="noreferrer"
                    className="text-blue-500 underline font-mono">@{status.bot_username}</a>
                  {" "}ושלח את הפקודה.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Groq status ── */}
      {status?.enabled && (groqStatus !== null ? (
        <Card className={groqStatus?.has_api_key ? "border-purple-100" : "border-amber-200"}>
          <CardContent className="pt-4">
            {groqStatus?.has_api_key ? (
              <div className="flex gap-2 text-sm text-purple-700">
                <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5 text-purple-500" />
                <div className="space-y-1">
                  <p className="font-medium">שאלות בשפה חופשית מופעלות — Groq AI (LLaMA 3.3)</p>
                  <p className="text-purple-600 text-xs">
                    מפתח Groq:{" "}
                    <Badge className="bg-green-100 text-green-700">פעיל</Badge>
                    {groqStatus.source === "env" && (
                      <span className="mr-2 text-blue-600">ממשתנה סביבה</span>
                    )}
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex gap-2 text-sm text-amber-700">
                <XCircle className="w-4 h-4 flex-shrink-0 mt-0.5 text-amber-500" />
                <div className="space-y-1">
                  <p className="font-medium">⚠️ GROQ_API_KEY לא מוגדר — הבוט לא יוכל לענות על שאלות</p>
                  <p className="text-amber-600 text-xs">
                    הגדר מפתח Groq בחינם בלשונית{" "}
                    <a href="?tab=ai" className="underline font-semibold">הגדרות → AI</a>
                    {" "}(מקבלים ב-{" "}
                    <a href="https://console.groq.com/keys" target="_blank" rel="noopener noreferrer"
                      className="underline" dir="ltr">console.groq.com</a>
                    )
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="flex items-center gap-2 text-sm text-gray-400 p-2">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          <span>בודק הגדרות Groq...</span>
        </div>
      ))}

      {/* Feedback */}
      {message && (
        <div className={`flex items-center gap-2 p-3 rounded-lg text-sm border ${
          message.type === "success"
            ? "bg-green-50 text-green-700 border-green-200"
            : "bg-red-50 text-red-700 border-red-200"
        }`}>
          {message.type === "success"
            ? <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
            : <XCircle className="w-4 h-4 flex-shrink-0" />}
          {message.text}
        </div>
      )}
    </div>
  );
}
