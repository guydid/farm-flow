import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Cpu, Search, Save, Loader2, CheckCircle2,
  XCircle, Info, AlertTriangle, Wifi, WifiOff
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

const SENSOR_TYPES = [
  { value: "generic",       label: "כללי"              },
  { value: "soil_moisture", label: "לחות קרקע"         },
  { value: "temperature",   label: "טמפרטורה אוויר"    },
  { value: "soil_temp",     label: "טמפרטורת קרקע"     },
  { value: "ec",            label: "מוליכות EC"         },
  { value: "ph",            label: "חומציות pH"         },
  { value: "flow",          label: "ספיקה"              },
  { value: "pressure",      label: "לחץ"               },
  { value: "wind",          label: "רוח"               },
  { value: "rain",          label: "גשם"               },
  { value: "co2",           label: "CO₂"               },
  { value: "humidity",      label: "לחות אוויר"         },
  { value: "radiation",     label: "קרינה סולארית"      },
];

export default function SensorManager() {
  const [config, setConfig] = useState({ host: "", port: 8899, start_addr: 1, end_addr: 16, sensors: [] });
  const [scanning, setScanning]     = useState(false);
  const [saving, setSaving]         = useState(false);
  const [loading, setLoading]       = useState(true);
  const [scanResults, setScanResults] = useState(null); // null = not scanned yet
  const [message, setMessage]       = useState(null);   // { type, text }

  useEffect(() => { loadConfig(); }, []);

  const loadConfig = async () => {
    setLoading(true);
    try {
      const data = await apiFetch("/sensors/config");
      setConfig(data);
    } catch (e) {
      setMessage({ type: "error", text: "שגיאה בטעינת הגדרות" });
    } finally {
      setLoading(false);
    }
  };

  // ── Scan ────────────────────────────────────────────────────────────────────
  const handleScan = async () => {
    if (!config.host.trim()) {
      setMessage({ type: "error", text: "יש להזין כתובת IP של התקן PUSR" });
      return;
    }
    setScanning(true);
    setMessage(null);
    setScanResults(null);
    try {
      const data = await apiFetch("/sensors/scan", {
        method: "POST",
        body: JSON.stringify({
          host:       config.host,
          port:       config.port,
          start_addr: config.start_addr,
          end_addr:   config.end_addr,
        }),
      });
      if (!data.success) throw new Error(data.error || "שגיאה לא ידועה");

      setScanResults(data.results || []);

      // Merge newly found addresses with existing saved labels
      const found   = (data.results || []).filter(r => r.connected).map(r => r.address);
      const savedMap = Object.fromEntries((config.sensors || []).map(s => [s.address, s]));
      const merged   = found.map(addr => savedMap[addr] || { address: addr, label: `חיישן ${addr}`, type: "generic" });
      // Keep existing saved sensors that didn't appear in this scan too
      const existing = (config.sensors || []).filter(s => !found.includes(s.address));
      setConfig(prev => ({ ...prev, sensors: [...merged, ...existing] }));

      setMessage({
        type: data.connected_count > 0 ? "success" : "error",
        text: data.connected_count > 0
          ? `נמצאו ${data.connected_count} חיישנים מחוברים`
          : "לא נמצאו חיישנים — בדוק חיבור ל-PUSR והפעלת מכשיר",
      });
    } catch (e) {
      setMessage({ type: "error", text: `שגיאת סריקה: ${e.message}` });
    } finally {
      setScanning(false);
    }
  };

  // ── Save ────────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      await apiFetch("/sensors/config", { method: "POST", body: JSON.stringify(config) });
      setMessage({ type: "success", text: "הגדרות נשמרו בהצלחה" });
    } catch (e) {
      setMessage({ type: "error", text: "שגיאה בשמירה" });
    } finally {
      setSaving(false);
    }
  };

  // ── Helpers ─────────────────────────────────────────────────────────────────
  const updateSensor = (addr, field, value) =>
    setConfig(prev => ({
      ...prev,
      sensors: prev.sensors.map(s => s.address === addr ? { ...s, [field]: value } : s),
    }));

  const connectedResults = (scanResults || []).filter(r => r.connected);
  const scanRange = config.end_addr - config.start_addr + 1;

  if (loading) return (
    <div className="flex items-center justify-center h-40">
      <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
    </div>
  );

  return (
    <div className="space-y-6" dir="rtl">

      {/* ── Connection config ── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Cpu className="w-5 h-5 text-blue-500" />
            חיבור התקן PUSR
          </CardTitle>
          <CardDescription>
            ממיר RS485 → TCP לחיישני Modbus. פורט ברירת מחדל: 8899.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {/* IP */}
            <div className="col-span-2">
              <Label>כתובת IP של PUSR</Label>
              <Input
                value={config.host}
                onChange={e => setConfig(p => ({ ...p, host: e.target.value }))}
                placeholder="192.168.1.100"
                dir="ltr"
                className="font-mono"
              />
            </div>
            {/* Port */}
            <div>
              <Label>פורט TCP</Label>
              <Input
                type="number"
                value={config.port}
                onChange={e => setConfig(p => ({ ...p, port: parseInt(e.target.value) || 8899 }))}
                dir="ltr"
                className="font-mono"
              />
            </div>
            {/* Addr range */}
            <div className="col-span-2 md:col-span-1 grid grid-cols-2 gap-2">
              <div>
                <Label>כתובת מ-</Label>
                <Input
                  type="number" min="1" max="247"
                  value={config.start_addr}
                  onChange={e => setConfig(p => ({ ...p, start_addr: parseInt(e.target.value) || 1 }))}
                  dir="ltr"
                />
              </div>
              <div>
                <Label>עד</Label>
                <Input
                  type="number" min="1" max="247"
                  value={config.end_addr}
                  onChange={e => setConfig(p => ({ ...p, end_addr: parseInt(e.target.value) || 16 }))}
                  dir="ltr"
                />
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-1">
            <Button onClick={handleScan} disabled={scanning} className="bg-blue-600 hover:bg-blue-700 text-white">
              {scanning
                ? <><Loader2 className="w-4 h-4 animate-spin ml-2" />סורק {scanRange} כתובות...</>
                : <><Search className="w-4 h-4 ml-2" />סרוק חיישנים</>}
            </Button>
            <Button onClick={handleSave} disabled={saving} variant="outline">
              {saving
                ? <><Loader2 className="w-4 h-4 animate-spin ml-2" />שומר...</>
                : <><Save className="w-4 h-4 ml-2" />שמור הגדרות</>}
            </Button>
          </div>

          {/* Hint */}
          <div className="flex gap-2 p-3 rounded-lg bg-blue-50 border border-blue-100 text-sm text-blue-700">
            <Info className="w-4 h-4 flex-shrink-0 mt-0.5 text-blue-500" />
            <span>
              הסריקה שולחת שאילתות Modbus RTU (FC03) לכל כתובת בטווח ובודקת מי עונה.
              חיישנים שאינם עונים תוך 400ms מסומנים כ"לא מחובר".
            </span>
          </div>
        </CardContent>
      </Card>

      {/* ── Scan results ── */}
      {scanResults !== null && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Wifi className="w-5 h-5 text-green-500" />
              תוצאות סריקה
              <Badge className={connectedResults.length > 0 ? "bg-green-100 text-green-700 border-green-200" : "bg-red-100 text-red-700 border-red-200"}>
                {connectedResults.length} / {scanResults.length} מחוברים
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {connectedResults.length === 0 ? (
              <div className="flex items-center gap-3 p-4 bg-yellow-50 border border-yellow-200 rounded-lg text-yellow-700">
                <AlertTriangle className="w-5 h-5 flex-shrink-0" />
                <div>
                  <p className="font-medium">לא נמצאו חיישנים</p>
                  <p className="text-sm mt-0.5">ודא שה-PUSR מחובר לרשת, כתובת ה-IP נכונה, והחיישנים מופעלים.</p>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-sm text-gray-500 mb-3">ניתן לשנות שם וסוג לכל חיישן ולשמור:</p>
                {connectedResults.map(s => {
                  const saved = config.sensors.find(cs => cs.address === s.address) || { address: s.address, label: `חיישן ${s.address}`, type: "generic" };
                  return (
                    <div key={s.address} className="flex flex-wrap items-center gap-2 p-3 border border-green-200 rounded-lg bg-green-50">
                      <Wifi className="w-4 h-4 text-green-600 flex-shrink-0" />
                      <Badge variant="outline" className="font-mono text-xs bg-white">#{s.address}</Badge>
                      <Input
                        value={saved.label}
                        onChange={e => updateSensor(s.address, "label", e.target.value)}
                        className="h-8 text-sm flex-1 min-w-[120px]"
                        placeholder="שם חיישן"
                      />
                      <select
                        value={saved.type || "generic"}
                        onChange={e => updateSensor(s.address, "type", e.target.value)}
                        className="h-8 text-sm border rounded-md px-2 bg-white"
                      >
                        {SENSOR_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                      {s.registers?.length > 0 && (
                        <span className="text-xs text-gray-400 font-mono" title="ערכי רגיסטרים גולמיים">
                          [{s.registers.join(", ")}]
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Non-responding addresses */}
            {scanResults.filter(r => !r.connected).length > 0 && (
              <details className="mt-2">
                <summary className="text-sm text-gray-400 cursor-pointer select-none">
                  {scanResults.filter(r => !r.connected).length} כתובות ללא תגובה
                </summary>
                <div className="flex flex-wrap gap-1 mt-2">
                  {scanResults.filter(r => !r.connected).map(s => (
                    <Badge key={s.address} variant="outline" className="font-mono text-xs text-gray-400">#{s.address}</Badge>
                  ))}
                </div>
              </details>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Saved sensors (before first scan) ── */}
      {scanResults === null && config.sensors?.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Cpu className="w-4 h-4" />
              חיישנים מוגדרים ({config.sensors.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {config.sensors.map(s => (
                <div key={s.address} className="flex flex-wrap items-center gap-2 p-3 border rounded-lg">
                  <Badge variant="outline" className="font-mono text-xs">#{s.address}</Badge>
                  <Input
                    value={s.label}
                    onChange={e => updateSensor(s.address, "label", e.target.value)}
                    className="h-8 text-sm flex-1 min-w-[120px]"
                  />
                  <select
                    value={s.type || "generic"}
                    onChange={e => updateSensor(s.address, "type", e.target.value)}
                    className="h-8 text-sm border rounded-md px-2"
                  >
                    {SENSOR_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Feedback ── */}
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
