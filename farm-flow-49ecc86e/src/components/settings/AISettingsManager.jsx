import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Brain, Eye, EyeOff, CheckCircle2, XCircle,
  Loader2, Trash2, Sparkles, Info, AlertTriangle, Zap
} from "lucide-react";
import { getToken } from "@/api/localClient";

const BASE_URL = import.meta.env.VITE_API_URL || "/api";

async function apiFetch(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getToken()}`,
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  try { return JSON.parse(text); }
  catch { throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`); }
}

// ── Reusable key card ────────────────────────────────────────────────────────
function ApiKeyCard({
  title, icon, status, apiKey, setApiKey,
  showKey, setShowKey, saving, onSave, onDelete,
  placeholder, prefix, docUrl, docLabel,
  featureList, statusColor = "purple"
}) {
  const colors = {
    purple: { btn: "bg-purple-600 hover:bg-purple-700", badge_on: "bg-purple-100 text-purple-700", info: "bg-purple-50 border-purple-100 text-purple-700", icon: "text-purple-500" },
    blue:   { btn: "bg-blue-600 hover:bg-blue-700",   badge_on: "bg-blue-100 text-blue-700",   info: "bg-blue-50 border-blue-100 text-blue-700",   icon: "text-blue-500" },
  };
  const c = colors[statusColor] || colors.purple;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Status row */}
        <div className="flex items-center gap-3 p-3 rounded-lg bg-gray-50">
          {status?.has_api_key ? (
            <>
              <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" />
              <div className="flex-1">
                <p className="font-medium text-green-700">מפתח API מוגדר</p>
                <p className="text-sm text-gray-500">
                  {status.key_preview} ·{" "}
                  {status.source === "env"
                    ? <span className="text-blue-600">ממשתנה סביבה</span>
                    : <span className={c.icon.replace("text-", "text-")}>מהגדרות המערכת</span>}
                </p>
              </div>
              <Badge className="bg-green-100 text-green-700 border-green-200">פעיל</Badge>
            </>
          ) : (
            <>
              <XCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
              <div className="flex-1">
                <p className="font-medium text-red-600">מפתח API לא מוגדר</p>
              </div>
              <Badge variant="outline" className="text-red-500 border-red-200">לא פעיל</Badge>
            </>
          )}
        </div>

        {/* Feature list */}
        {featureList && (
          <div className={`flex gap-2 p-3 rounded-lg border ${c.info}`}>
            <Sparkles className={`w-4 h-4 ${c.icon} flex-shrink-0 mt-0.5`} />
            <div className="text-sm space-y-1">
              <p className="font-medium">מה מופעל עם מפתח זה?</p>
              <ul className="list-disc list-inside space-y-0.5 opacity-80">
                {featureList.map((f, i) => <li key={i}>{f}</li>)}
              </ul>
            </div>
          </div>
        )}

        {/* Input (hidden when from env) */}
        {status?.source !== "env" && (
          <div className="space-y-2">
            <Label>{title} — מפתח API</Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  type={showKey ? "text" : "password"}
                  value={apiKey}
                  onChange={e => setApiKey(e.target.value)}
                  placeholder={placeholder}
                  className="pl-10 font-mono text-sm"
                  dir="ltr"
                />
                <button type="button" onClick={() => setShowKey(!showKey)}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <Button onClick={onSave} disabled={!apiKey.trim() || saving}
                className={`${c.btn} text-white`}>
                {saving ? <Loader2 className="w-4 h-4 animate-spin ml-1" /> : null}
                שמור
              </Button>
            </div>
            <p className="text-xs text-gray-500 flex items-center gap-1">
              <Info className="w-3 h-3" />
              ניתן להשיג ב-
              <a href={docUrl} target="_blank" rel="noopener noreferrer"
                className="text-blue-500 underline" dir="ltr">{docLabel}</a>
            </p>

            {status?.has_api_key && (
              <Button variant="outline" size="sm" onClick={onDelete}
                className="text-red-500 border-red-200 hover:bg-red-50">
                <Trash2 className="w-3 h-3 ml-1" />
                מחק מפתח
              </Button>
            )}
          </div>
        )}

        {status?.source === "env" && (
          <div className="flex gap-2 p-3 rounded-lg border-blue-200 bg-blue-50 text-sm text-blue-700">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5 text-blue-500" />
            <p>המפתח מוגדר כמשתנה סביבה בשרת. לשינויו עדכן את service ואתחל מחדש.</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function AISettingsManager() {
  // Anthropic
  const [anthropicStatus, setAnthropicStatus] = useState(null);
  const [anthropicKey, setAnthropicKey]     = useState("");
  const [showAnthropic, setShowAnthropic]   = useState(false);
  const [savingAnthropic, setSavingAnthropic] = useState(false);

  // Groq
  const [groqStatus, setGroqStatus]   = useState(null);
  const [groqKey, setGroqKey]         = useState("");
  const [showGroq, setShowGroq]       = useState(false);
  const [savingGroq, setSavingGroq]   = useState(false);

  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(null);

  useEffect(() => { loadAll(); }, []);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [a, g] = await Promise.all([
        apiFetch("/settings/ai"),
        apiFetch("/settings/groq"),
      ]);
      setAnthropicStatus(a);
      setGroqStatus(g);
    } catch (e) {
      setMessage({ type: "error", text: "שגיאה בטעינת הגדרות AI" });
    } finally {
      setLoading(false);
    }
  };

  const msg = (type, text) => { setMessage({ type, text }); setTimeout(() => setMessage(null), 4000); };

  // Anthropic handlers
  const saveAnthropic = async () => {
    setSavingAnthropic(true);
    try {
      const d = await apiFetch("/settings/ai", { method: "POST", body: JSON.stringify({ api_key: anthropicKey.trim() }) });
      d.success ? msg("success", `מפתח Anthropic נשמר (${d.key_preview})`) : msg("error", d.error || "שגיאה");
      if (d.success) { setAnthropicKey(""); loadAll(); }
    } catch (e) { msg("error", e.message); }
    finally { setSavingAnthropic(false); }
  };
  const deleteAnthropic = async () => {
    if (!confirm("למחוק מפתח Anthropic?")) return;
    await apiFetch("/settings/ai", { method: "DELETE" });
    msg("success", "מפתח Anthropic נמחק"); loadAll();
  };

  // Groq handlers
  const saveGroq = async () => {
    setSavingGroq(true);
    try {
      const d = await apiFetch("/settings/groq", { method: "POST", body: JSON.stringify({ api_key: groqKey.trim() }) });
      d.success ? msg("success", `מפתח Groq נשמר (${d.key_preview})`) : msg("error", d.error || "שגיאה");
      if (d.success) { setGroqKey(""); loadAll(); }
    } catch (e) { msg("error", e.message); }
    finally { setSavingGroq(false); }
  };
  const deleteGroq = async () => {
    if (!confirm("למחוק מפתח Groq?")) return;
    await apiFetch("/settings/groq", { method: "DELETE" });
    msg("success", "מפתח Groq נמחק"); loadAll();
  };

  if (loading) return (
    <div className="flex justify-center items-center h-40">
      <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
    </div>
  );

  // Priority indicator
  const activeOCR = anthropicStatus?.has_api_key ? "Claude Vision (Anthropic)"
                  : groqStatus?.has_api_key       ? "Groq Vision (LLaMA 4)"
                  : "Tesseract OCR (מקומי)";

  return (
    <div className="space-y-6" dir="rtl">

      {/* Active method banner */}
      <div className="flex items-center gap-3 p-3 rounded-lg bg-gray-50 border text-sm">
        <Zap className="w-4 h-4 text-yellow-500 flex-shrink-0" />
        <span className="text-gray-600">שיטת זיהוי מסמכים פעילה:</span>
        <Badge className="bg-blue-100 text-blue-700">{activeOCR}</Badge>
        <span className="text-xs text-gray-400">(סדר עדיפות: Anthropic → Groq → Tesseract)</span>
      </div>

      {/* Anthropic */}
      <ApiKeyCard
        title="Anthropic Claude Vision"
        icon={<Brain className="w-5 h-5 text-purple-500" />}
        status={anthropicStatus}
        apiKey={anthropicKey} setApiKey={setAnthropicKey}
        showKey={showAnthropic} setShowKey={setShowAnthropic}
        saving={savingAnthropic}
        onSave={saveAnthropic} onDelete={deleteAnthropic}
        placeholder="sk-ant-api03-..."
        prefix="sk-ant-"
        docUrl="https://console.anthropic.com/settings/keys"
        docLabel="console.anthropic.com"
        statusColor="purple"
        featureList={[
          "זיהוי דרכון עם דיוק גבוה מאוד",
          "זיהוי רישיון רכב",
          "מילוי אוטומטי של שדות בטפסים",
        ]}
      />

      {/* Groq */}
      <ApiKeyCard
        title="Groq Vision (LLaMA 4 Scout) — חינמי"
        icon={<Zap className="w-5 h-5 text-blue-500" />}
        status={groqStatus}
        apiKey={groqKey} setApiKey={setGroqKey}
        showKey={showGroq} setShowKey={setShowGroq}
        saving={savingGroq}
        onSave={saveGroq} onDelete={deleteGroq}
        placeholder="gsk_..."
        prefix="gsk_"
        docUrl="https://console.groq.com/keys"
        docLabel="console.groq.com"
        statusColor="blue"
        featureList={[
          "זיהוי דרכון ורישיון רכב — חינם עד 14,400 בקשות/יום",
          "מניע גם את בוט הטלגרם",
          "גיבוי אוטומטי כשאין מפתח Anthropic",
        ]}
      />

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
