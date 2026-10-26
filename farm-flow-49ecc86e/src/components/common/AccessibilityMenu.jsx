import React, { useEffect, useState } from "react";
import { Accessibility, Minus, Plus, RotateCcw, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { getA11y, setA11y, resetA11y, onA11yChange } from "@/lib/a11y";

/**
 * תפריט נגישות (נדרש לפי תקנות הנגישות / ת"י 5568): גודל טקסט, ניגודיות, הדגשת קישורים,
 * עצירת תנועה, ריווח קריאה, איפוס, וקישור להצהרת הנגישות. ההעדפות נשמרות במכשיר.
 */
export default function AccessibilityMenu({ className, variant = "ghost" }) {
  const [prefs, setPrefs] = useState(getA11y);
  useEffect(() => onA11yChange(() => setPrefs(getA11y())), []);
  const update = (patch) => setPrefs(setA11y(patch));
  const active = prefs.font > 0 || prefs.contrast || prefs.links || prefs.motion || prefs.spacing;

  const Row = ({ id, label, checked, onChange }) => (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <Label htmlFor={id} className="text-sm font-normal cursor-pointer">{label}</Label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant={variant} size="icon" className={className} aria-label="תפריט נגישות" title="נגישות">
          <Accessibility className="h-5 w-5" aria-hidden="true" />
          {active && <span className="sr-only">(הגדרות נגישות פעילות)</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72" dir="rtl" aria-label="הגדרות נגישות">
        <h2 className="text-sm font-bold mb-2 flex items-center gap-1.5"><Accessibility className="w-4 h-4" aria-hidden="true" /> נגישות</h2>

        <div className="flex items-center justify-between gap-3 py-1.5">
          <span className="text-sm" id="a11y-font-label">גודל טקסט</span>
          <div className="flex items-center gap-1" role="group" aria-labelledby="a11y-font-label">
            <Button type="button" variant="outline" size="icon" className="h-8 w-8" onClick={() => update({ font: Math.max(0, prefs.font - 1) })} disabled={prefs.font === 0} aria-label="הקטן טקסט"><Minus className="w-4 h-4" aria-hidden="true" /></Button>
            <span className="w-8 text-center text-sm tabular-nums" aria-live="polite">{["רגיל", "גדול", "גדול+", "ענק"][prefs.font]}</span>
            <Button type="button" variant="outline" size="icon" className="h-8 w-8" onClick={() => update({ font: Math.min(3, prefs.font + 1) })} disabled={prefs.font === 3} aria-label="הגדל טקסט"><Plus className="w-4 h-4" aria-hidden="true" /></Button>
          </div>
        </div>
        <Row id="a11y-contrast" label="ניגודיות גבוהה" checked={prefs.contrast} onChange={(v) => update({ contrast: v })} />
        <Row id="a11y-links" label="הדגשת קישורים" checked={prefs.links} onChange={(v) => update({ links: v })} />
        <Row id="a11y-motion" label="עצירת תנועה ואנימציות" checked={prefs.motion} onChange={(v) => update({ motion: v })} />
        <Row id="a11y-spacing" label="ריווח קריאה" checked={prefs.spacing} onChange={(v) => update({ spacing: v })} />

        <div className="flex items-center justify-between gap-2 pt-3 mt-2 border-t">
          <Button type="button" variant="ghost" size="sm" onClick={resetA11y} disabled={!active}><RotateCcw className="w-3.5 h-3.5" aria-hidden="true" /> איפוס</Button>
          <a href="/accessibility.html" target="_blank" rel="noopener noreferrer" className="text-xs text-primary underline inline-flex items-center gap-1">הצהרת נגישות <ExternalLink className="w-3 h-3" aria-hidden="true" /></a>
        </div>
      </PopoverContent>
    </Popover>
  );
}
