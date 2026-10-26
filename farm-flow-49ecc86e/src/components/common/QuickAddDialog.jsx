import React, { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Loader2 } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { QUICK_ADD, quickCreate } from "./quickAddRegistry";

/**
 * דיאלוג "הוספה מהירה" גנרי: טופס מינימלי לפי QUICK_ADD[kind], שמירה, ו-onCreated(record)
 * שמחזיר את המשתמש לטופס המקורי עם הרשומה החדשה נבחרת.
 *  - kind         מפתח ב-QUICK_ADD (customer / supplier / product / ...)
 *  - farmId       משק פעיל (נוסף כ-farm_id)
 *  - initial      ערכים ראשוניים (לדוגמה טקסט שהמשתמש חיפש → שם)
 *  - extraFields  שדות נוספים ספציפיים להקשר
 */
export default function QuickAddDialog({ kind, open, onOpenChange, farmId, initial = {}, extraFields = [], onCreated, title }) {
  const cfg = QUICK_ADD[kind];
  const fields = [...(cfg?.fields || []), ...extraFields];
  const blank = () => Object.fromEntries(fields.map(f => [f.key, f.type === "switch" ? (cfg?.defaults?.[f.key] ?? true) : ""]));
  const [values, setValues] = useState(() => ({ ...blank(), ...initial }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const { toast } = useToast();
  const firstRef = useRef(null);
  const uid = useRef(`qa-${Math.random().toString(36).slice(2, 8)}`).current;

  useEffect(() => {
    if (open) { setValues({ ...blank(), ...initial }); setError(""); setTimeout(() => firstRef.current?.focus(), 50); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, kind]);

  if (!cfg) return null;

  const submit = async (e) => {
    e?.preventDefault();
    e?.stopPropagation(); // לא להגיש את הטופס החיצוני
    const missing = fields.find(f => f.required && !String(values[f.key] ?? "").trim());
    if (missing) { setError(`${missing.label} הוא שדה חובה`); firstRef.current?.focus(); return; }
    if (!farmId) { setError("לא נבחר משק פעיל"); return; }
    setSaving(true); setError("");
    try {
      const created = await quickCreate(kind, values, farmId);
      toast({ title: `${cfg.labelOne} נוסף ונבחר`, description: created?.name || [created?.first_name, created?.last_name].filter(Boolean).join(" ") });
      onCreated?.(created);
      onOpenChange(false);
    } catch (err) {
      console.error("quick add failed", err);
      setError(err?.message || `שמירת ${cfg.labelOne} נכשלה`);
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" dir="rtl" onKeyDown={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>{title || cfg.title}</DialogTitle>
          <DialogDescription>הפרטים המינימליים בלבד. את השאר אפשר להשלים בהגדרות.</DialogDescription>
        </DialogHeader>
        {/* form מקונן בתוך form חיצוני אסור ב-HTML, לכן div + Enter */}
        <div className="space-y-3 pt-1" onKeyDown={(e) => { if (e.key === "Enter" && e.target.tagName === "INPUT") { e.preventDefault(); submit(); } }}>
          {fields.map((f, i) => {
            const id = `${uid}-${f.key}`;
            if (f.type === "switch") {
              return (
                <div key={f.key} className="flex items-center justify-between rounded-lg border p-3">
                  <Label htmlFor={id}>{f.label}</Label>
                  <Switch id={id} checked={!!values[f.key]} onCheckedChange={(v) => setValues(s => ({ ...s, [f.key]: v }))} />
                </div>
              );
            }
            return (
              <div key={f.key} className="space-y-1">
                <Label htmlFor={id}>{f.label}{f.required && <span className="text-destructive" aria-hidden="true"> *</span>}</Label>
                <Input
                  id={id}
                  ref={i === 0 ? firstRef : undefined}
                  type={f.type || "text"}
                  step={f.step}
                  dir={f.dir}
                  value={values[f.key] ?? ""}
                  required={f.required}
                  aria-required={f.required || undefined}
                  aria-invalid={!!error && f.required && !String(values[f.key] ?? "").trim() ? true : undefined}
                  onChange={(e) => setValues(s => ({ ...s, [f.key]: e.target.value }))}
                />
              </div>
            );
          })}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>ביטול</Button>
          <Button type="button" onClick={submit} disabled={saving}>
            {saving && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
            שמור ובחר
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
