import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plug, Copy, Check, Loader2, Plus, Trash2, ShieldAlert, Info, KeyRound } from "lucide-react";
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

const ACCESS_LEVELS = [
  { id: "read", label: "קריאה בלבד", cls: "bg-gray-100 text-gray-600" },
  { id: "pest", label: "קריאה + פיקוח מזיקים", cls: "bg-emerald-100 text-emerald-700" },
  { id: "write", label: "קריאה + כתיבה מלאה", cls: "bg-orange-100 text-orange-700" },
];
const accessOf = (t) => ACCESS_LEVELS.find(a => a.id === (t.can_write ? "write" : t.pest_write ? "pest" : "read"));

const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" }) : "—");

export default function McpSettingsManager() {
  const [tokens, setTokens] = useState([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [name, setName] = useState("");
  const [access, setAccess] = useState("read");
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState(null); // { token, name } — shown once
  const [copied, setCopied] = useState(null);
  const [message, setMessage] = useState(null);

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    try {
      setTokens(await apiFetch("/mcp/tokens"));
      setForbidden(false);
    } catch (e) {
      if (e.status === 403) setForbidden(true);
      else setMessage({ type: "error", text: e.message || "שגיאה בטעינה" });
    } finally {
      setLoading(false);
    }
  };

  const create = async () => {
    setCreating(true);
    setMessage(null);
    try {
      const d = await apiFetch("/mcp/tokens", {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), access }),
      });
      setCreated(d);
      setName("");
      setAccess("read");
      load();
    } catch (e) {
      setMessage({ type: "error", text: e.message || "שגיאה ביצירה" });
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (t) => {
    if (!window.confirm(`לבטל את הטוקן "${t.name}"? סוכן שמשתמש בו יאבד גישה מיד.`)) return;
    try {
      await apiFetch(`/mcp/tokens/${t.id}`, { method: "DELETE" });
      load();
    } catch (e) {
      setMessage({ type: "error", text: e.message || "שגיאה בביטול" });
    }
  };

  const copy = (text, which) => {
    navigator.clipboard?.writeText(text);
    setCopied(which);
    setTimeout(() => setCopied(null), 1500);
  };

  const mcpUrl = `${window.location.origin}/mcp`;
  const tokenUrl = created ? `${mcpUrl}/${created.token}` : "";
  const claudeCodeCmd = created
    ? `claude mcp add --transport http farm-flow ${mcpUrl} --header "Authorization: Bearer ${created.token}"`
    : "";

  if (loading) return (
    <div className="flex justify-center items-center h-40">
      <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
    </div>
  );

  if (forbidden) return (
    <Card>
      <CardContent className="p-6 flex items-start gap-3 text-sm text-amber-700" dir="rtl">
        <ShieldAlert className="w-5 h-5 flex-shrink-0 mt-0.5" />
        <span>ניהול גישת סוכנים חיצוניים (MCP) זמין לבעלים ומנהלי משק בלבד.</span>
      </CardContent>
    </Card>
  );

  const CopyRow = ({ label, value, id }) => (
    <div className="space-y-1">
      <Label className="text-xs text-gray-500">{label}</Label>
      <div className="flex gap-2">
        <Input value={value} readOnly className="font-mono text-xs" dir="ltr" />
        <Button variant="outline" onClick={() => copy(value, id)}>
          {copied === id ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
        </Button>
      </div>
    </div>
  );

  return (
    <div className="space-y-6" dir="rtl">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plug className="w-5 h-5 text-indigo-500" />
            חיבור MCP לסוכן חיצוני
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2 p-3 rounded-lg border bg-indigo-50 border-indigo-100 text-indigo-700 text-sm">
            <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>
              טוקן MCP מאפשר לסוכן AI חיצוני (Claude, n8n וכד') לקרוא את נתוני המשק הנוכחי — מזרעים, קטיפים,
              פעילויות, תעודות שקילה, חשבוניות ועוד. כל טוקן מוגבל למשק אחד. "פיקוח מזיקים" מאפשר לסוכן לעדכן מחירי קנייה של חומרי הדברה, להציע
              ולעדכן המלצות הדברה (שמופיעות כממתינות עד לביצוע בשטח); "כתיבה מלאה" מאפשר יצירה ועדכון של כל
              הרשומות (ללא מחיקה).
            </span>
          </div>

          <CopyRow label="כתובת שרת ה-MCP" value={mcpUrl} id="url" />

          <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
            <div className="flex-1 space-y-1">
              <Label>שם הסוכן</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="למשל: Claude של גיא" />
            </div>
            <div className="space-y-1">
              <Label>הרשאה</Label>
              <div className="flex gap-1 p-1 bg-gray-100 rounded-lg">
                {ACCESS_LEVELS.map(a => (
                  <button key={a.id} type="button" onClick={() => setAccess(a.id)}
                          className={`px-2.5 py-1.5 rounded-md text-xs font-medium whitespace-nowrap ${access === a.id ? "bg-white shadow text-gray-900" : "text-gray-600"}`}>
                    {a.label}
                  </button>
                ))}
              </div>
            </div>
            <Button onClick={create} disabled={creating} className="bg-indigo-600 hover:bg-indigo-700 text-white">
              {creating ? <Loader2 className="w-4 h-4 animate-spin ml-1" /> : <Plus className="w-4 h-4 ml-1" />}
              צור טוקן
            </Button>
          </div>

          {message && (
            <div className={`text-sm p-2 rounded ${message.type === "error" ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"}`}>
              {message.text}
            </div>
          )}

          {created && (
            <div className="space-y-3 p-4 rounded-lg border-2 border-amber-300 bg-amber-50">
              <div className="flex items-center gap-2 text-sm font-medium text-amber-800">
                <KeyRound className="w-4 h-4" />
                הטוקן "{created.name}" נוצר — העתק אותו עכשיו, הוא לא יוצג שוב.
              </div>
              <CopyRow label="טוקן (Authorization: Bearer …)" value={created.token} id="token" />
              <CopyRow label="Claude Code" value={claudeCodeCmd} id="cc" />
              <CopyRow label="כתובת עם טוקן מובנה (ל-claude.ai Custom Connector / לקוחות בלי headers)" value={tokenUrl} id="turl" />
              <Button variant="ghost" size="sm" onClick={() => setCreated(null)}>סגור</Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">טוקנים פעילים</CardTitle>
        </CardHeader>
        <CardContent>
          {tokens.length === 0 ? (
            <p className="text-sm text-gray-500">אין טוקנים עדיין.</p>
          ) : (
            <div className="divide-y">
              {tokens.map((t) => (
                <div key={t.id} className={`flex items-center gap-3 py-3 ${t.revoked ? "opacity-50" : ""}`}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{t.name}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${accessOf(t).cls}`}>{accessOf(t).label}</span>
                      {t.revoked && <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700">בוטל</span>}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5" dir="ltr" style={{ textAlign: "right" }}>
                      {t.token_prefix}… · {t.user_email}
                    </div>
                    <div className="text-xs text-gray-500">
                      נוצר {fmtDate(t.created_at)} · שימוש אחרון {fmtDate(t.last_used_at)}
                    </div>
                  </div>
                  {!t.revoked && (
                    <Button variant="ghost" size="icon" onClick={() => revoke(t)} title="בטל טוקן">
                      <Trash2 className="w-4 h-4 text-red-500" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
