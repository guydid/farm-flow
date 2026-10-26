import * as React from "react";
import { DayPicker } from "react-day-picker";
import { he } from "date-fns/locale";
import { addDays, format, isValid, parse, parseISO } from "date-fns";
import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * שדה תאריך אחיד: הקלדה בפורמט dd/mm/yyyy (עם מסכה אוטומטית) + לוח שנה בעברית
 * עם בחירת חודש/שנה מהירה וקיצורים (היום / אתמול / מחר).
 * הערך שנשמר הוא ISO (yyyy-MM-dd) — תואם לכל הטפסים הקיימים:
 *   <DateInput value={iso} onChange={e => e.target.value} name="..." />
 */
const ISO = "yyyy-MM-dd";
const MONTHS = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];

function isoToDate(v) {
  if (!v) return null;
  try { const d = parseISO(String(v).slice(0, 10)); return isValid(d) ? d : null; } catch { return null; }
}
function isoToText(v) { const d = isoToDate(v); return d ? format(d, "dd/MM/yyyy") : ""; }
function mask(raw) {
  const digits = raw.replace(/\D/g, "").slice(0, 8);
  const parts = [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 8)].filter(Boolean);
  return parts.join("/");
}
function textToIso(text) {
  const digits = text.replace(/\D/g, "");
  if (digits.length !== 8) return null;
  const d = parse(`${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`, "dd/MM/yyyy", new Date());
  if (!isValid(d)) return null;
  const y = d.getFullYear();
  if (y < 1900 || y > 2100) return null;
  return format(d, ISO);
}

const DateInput = React.forwardRef(function DateInput(
  { value, onChange, name, id, className, disabled, required, min, max, placeholder = "dd/mm/yyyy", autoFocus, "aria-label": ariaLabel, ...rest },
  ref
) {
  const [text, setText] = React.useState(() => isoToText(value));
  const [open, setOpen] = React.useState(false);
  const [month, setMonth] = React.useState(() => isoToDate(value) || new Date());
  const focused = React.useRef(false);
  const inputRef = React.useRef(null);
  React.useImperativeHandle(ref, () => inputRef.current);

  // סנכרון כשהערך משתנה מבחוץ (איפוס טופס, טעינת רשומה)
  React.useEffect(() => {
    if (!focused.current) setText(isoToText(value));
    const d = isoToDate(value); if (d) setMonth(d);
  }, [value]);

  const emit = (iso) => {
    onChange?.({ target: { value: iso || "", name, id, type: "date" }, currentTarget: { value: iso || "", name, id } });
  };
  const inRange = (iso) => (!min || iso >= String(min).slice(0, 10)) && (!max || iso <= String(max).slice(0, 10));

  const handleText = (e) => {
    const t = mask(e.target.value);
    setText(t);
    if (t === "") { emit(""); return; }
    const iso = textToIso(t);
    if (iso && inRange(iso)) emit(iso);
  };
  const handleBlur = () => {
    focused.current = false;
    const iso = textToIso(text);
    if (!text) { if (value) emit(""); return; }
    if (!iso || !inRange(iso)) setText(isoToText(value)); // הקלדה לא תקינה — חזרה לערך האחרון
    else setText(isoToText(iso));
  };
  const pick = (d) => {
    if (!d) return;
    const iso = format(d, ISO);
    if (!inRange(iso)) return;
    setText(isoToText(iso)); emit(iso); setOpen(false);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const selected = isoToDate(value);
  const today = new Date();
  const year = month.getFullYear();
  const years = []; for (let y = Math.max(1900, year - 60); y <= Math.min(2100, year + 10); y++) years.push(y);
  const disabledDays = [];
  if (min) disabledDays.push({ before: isoToDate(min) });
  if (max) disabledDays.push({ after: isoToDate(max) });

  return (
    <div className={cn("relative flex items-center", className)} dir="rtl">
      <input
        ref={inputRef}
        type="text"
        inputMode="numeric"
        dir="ltr"
        id={id}
        name={name}
        value={text}
        placeholder={placeholder}
        disabled={disabled}
        required={required}
        aria-required={required || undefined}
        aria-label={ariaLabel}
        autoFocus={autoFocus}
        autoComplete="off"
        maxLength={10}
        onFocus={() => { focused.current = true; }}
        onChange={handleText}
        onBlur={handleBlur}
        onKeyDown={(e) => { if (e.key === "ArrowDown" && !open) { e.preventDefault(); setOpen(true); } }}
        className="flex h-10 md:h-9 w-full rounded-md border border-input bg-transparent ps-3 pe-9 py-1 text-base md:text-sm shadow-sm tabular-nums placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 text-left"
        {...rest}
      />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button type="button" disabled={disabled} aria-label="פתח לוח שנה" title="בחר תאריך"
                  className="absolute inset-y-0 left-0 flex items-center px-2.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md disabled:opacity-50">
            <CalendarDays className="h-4 w-4" aria-hidden="true" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-2" dir="rtl" onOpenAutoFocus={(e) => e.preventDefault()}>
          {/* קיצורים */}
          <div className="flex items-center gap-1 mb-2 flex-wrap">
            {[["היום", 0], ["אתמול", -1], ["מחר", 1]].map(([l, off]) => (
              <button key={l} type="button" onClick={() => pick(addDays(today, off))}
                      className="text-xs rounded-full border px-2.5 py-1 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{l}</button>
            ))}
            {value && (
              <button type="button" onClick={() => { setText(""); emit(""); setOpen(false); }}
                      className="ms-auto text-xs text-muted-foreground inline-flex items-center gap-1 px-1.5 py-1 rounded hover:text-destructive"><X className="w-3 h-3" aria-hidden="true" /> נקה</button>
            )}
          </div>
          {/* ניווט חודש / שנה */}
          <div className="flex items-center gap-1 mb-1">
            <button type="button" aria-label="חודש קודם" onClick={() => setMonth(new Date(year, month.getMonth() - 1, 1))} className={cn(buttonVariants({ variant: "outline", size: "icon" }), "h-7 w-7 md:h-7 md:w-7")}><ChevronRight className="h-4 w-4" aria-hidden="true" /></button>
            <select aria-label="חודש" value={month.getMonth()} onChange={(e) => setMonth(new Date(year, Number(e.target.value), 1))}
                    className="flex-1 h-8 rounded-md border bg-background px-2 text-sm">
              {MONTHS.map((m, i) => <option key={m} value={i}>{m}</option>)}
            </select>
            <select aria-label="שנה" value={year} onChange={(e) => setMonth(new Date(Number(e.target.value), month.getMonth(), 1))}
                    className="h-8 rounded-md border bg-background px-2 text-sm tabular-nums">
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <button type="button" aria-label="חודש הבא" onClick={() => setMonth(new Date(year, month.getMonth() + 1, 1))} className={cn(buttonVariants({ variant: "outline", size: "icon" }), "h-7 w-7 md:h-7 md:w-7")}><ChevronLeft className="h-4 w-4" aria-hidden="true" /></button>
          </div>
          <DayPicker
            mode="single"
            locale={he}
            dir="rtl"
            month={month}
            onMonthChange={setMonth}
            selected={selected || undefined}
            onSelect={pick}
            disabled={disabledDays.length ? disabledDays : undefined}
            showOutsideDays
            classNames={{
              months: "flex", month: "space-y-2", caption: "hidden", nav: "hidden",
              table: "w-full border-collapse", head_row: "flex", head_cell: "text-muted-foreground w-9 font-normal text-[0.75rem]",
              row: "flex w-full mt-1", cell: "p-0 text-center text-sm",
              day: cn(buttonVariants({ variant: "ghost" }), "h-9 w-9 md:h-9 md:w-9 p-0 font-normal aria-selected:opacity-100 tabular-nums"),
              day_selected: "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground",
              day_today: "ring-1 ring-primary/60 font-semibold",
              day_outside: "text-muted-foreground/60",
              day_disabled: "text-muted-foreground opacity-40",
              day_hidden: "invisible",
            }}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
});

export { DateInput };
export default DateInput;
