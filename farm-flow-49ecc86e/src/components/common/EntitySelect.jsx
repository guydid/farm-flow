import React, { useMemo, useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import QuickAddDialog from "./QuickAddDialog";
import { QUICK_ADD } from "./quickAddRegistry";

/**
 * בורר רשומה אחיד עם "הוספה מהירה": Select + כפתור ➕ שפותח טופס מינימלי,
 * ואחרי השמירה הרשומה החדשה נבחרת אוטומטית והפוקוס חוזר לטופס.
 *
 *  - options       מערך רשומות
 *  - value / onValueChange
 *  - getLabel      (rec) => string   (ברירת מחדל: name / full_name)
 *  - quickAdd      מפתח QUICK_ADD ('customer' / 'supplier' / ...) או false
 *  - farmId        משק פעיל
 *  - onCreated     (rec) => void — ההורה מוסיף לרשימה שלו
 *  - noneLabel     אם מוגדר, מתווסף פריט "ללא" עם הערך "__none__"
 *  - quickAddInitial  ערכים ראשוניים לטופס ההוספה
 */
export default function EntitySelect({
  options = [], value, onValueChange, getLabel, placeholder = "בחר...", quickAdd, farmId, onCreated,
  noneLabel, disabled, required, id, className, triggerClassName, quickAddInitial, quickAddExtraFields, size,
}) {
  const [adding, setAdding] = useState(false);
  const label = getLabel || ((r) => r?.name || r?.full_name || [r?.first_name, r?.last_name].filter(Boolean).join(" ") || r?.id);
  const cfg = quickAdd ? QUICK_ADD[quickAdd] : null;
  const sorted = useMemo(() => [...(Array.isArray(options) ? options : [])].filter(Boolean), [options]);

  const handleCreated = (rec) => {
    onCreated?.(rec);
    onValueChange?.(rec.id);
  };

  return (
    <div className={cn("flex gap-2", className)}>
      <Select value={value || (noneLabel ? "__none__" : undefined)} onValueChange={(v) => onValueChange?.(v === "__none__" ? "" : v)} disabled={disabled} required={required}>
        <SelectTrigger id={id} className={cn("flex-1 min-w-0", size === "sm" && "h-9 md:h-8 text-xs", triggerClassName)} aria-required={required || undefined}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {noneLabel && <SelectItem value="__none__">{noneLabel}</SelectItem>}
          {sorted.map((r) => <SelectItem key={r.id} value={r.id}>{label(r)}</SelectItem>)}
          {sorted.length === 0 && !noneLabel && <div className="px-3 py-2 text-sm text-muted-foreground">אין רשומות עדיין</div>}
        </SelectContent>
      </Select>
      {cfg && (
        <>
          <Button type="button" variant="outline" size="icon" className="shrink-0" disabled={disabled}
                  aria-label={`${cfg.labelOne} חדש`} title={`${cfg.labelOne} חדש`} onClick={() => setAdding(true)}>
            <Plus className="w-4 h-4" aria-hidden="true" />
          </Button>
          <QuickAddDialog kind={quickAdd} open={adding} onOpenChange={setAdding} farmId={farmId}
                          initial={quickAddInitial} extraFields={quickAddExtraFields} onCreated={handleCreated} />
        </>
      )}
    </div>
  );
}
