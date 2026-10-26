import React, { useState } from "react";
import { Link } from "react-router-dom";
import { X, ChevronDown, ChevronUp, BellOff, CheckCircle2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { SEGMENTS, SEGMENT_ORDER, SEVERITY } from "./dashboardData";

/* ── קו מגמה זעיר ───────────────────────────────────────────────────────── */
export function Sparkline({ series = [], className }) {
  const vals = series.map(v => (Number.isFinite(v) ? v : 0));
  if (vals.length < 2 || vals.every(v => v === 0)) return null;
  const max = Math.max(...vals), min = Math.min(...vals);
  const w = 60, h = 20;
  const pts = vals.map((v, i) => {
    const x = (i / (vals.length - 1)) * w;
    const y = max === min ? h / 2 : h - ((v - min) / (max - min)) * (h - 2) - 1;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={cn("w-16 h-5", className)} aria-hidden="true" preserveAspectRatio="none">
      <polyline points={pts.join(" ")} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={pts[pts.length - 1].split(",")[0]} cy={pts[pts.length - 1].split(",")[1]} r="1.8" fill="currentColor" />
    </svg>
  );
}

/* ── אריח מדד ──────────────────────────────────────────────────────────── */
const STRIPE = { agronomic: "border-t-green-500", workers: "border-t-blue-500", operational: "border-t-amber-500", money: "border-t-indigo-500" };
export function KpiTile({ label, value, hint, delta, series, segment = "operational", to, compact = false, icon: Icon }) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs text-muted-foreground truncate">{label}</span>
        {Icon && <Icon className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden="true" />}
      </div>
      <div className={cn("font-bold tabular-nums leading-tight text-foreground", compact ? "text-xl" : "text-2xl")}>{value}</div>
      <div className="flex items-end justify-between gap-2 min-h-[1.25rem]">
        <span className={cn("text-[11px] truncate", delta == null ? "text-muted-foreground" : delta >= 0 ? "text-green-700" : "text-red-700")}>
          {delta != null ? `${delta >= 0 ? "▲" : "▼"} ${Math.abs(delta)}%` : ""}{delta != null && hint ? " · " : ""}{hint}
        </span>
        {series && <Sparkline series={series} className={cn("shrink-0", delta != null && delta < 0 ? "text-red-400" : "text-primary/60")} />}
      </div>
    </>
  );
  const cls = cn("block rounded-xl border bg-card p-3 border-t-[3px] min-w-0 space-y-1 text-start", STRIPE[segment] || STRIPE.operational, to && "hover:bg-accent/60 transition-colors");
  return to ? <Link to={to} className={cls}>{body}</Link> : <div className={cls}>{body}</div>;
}

/* ── פס תחומים (ספירת התראות לכל תחום, לחיצה = סינון) ───────────────────── */
export function SegmentBar({ items = [], active, onToggle }) {
  const counts = Object.fromEntries(SEGMENT_ORDER.map(k => [k, items.filter(i => i.segment === k).length]));
  const urgent = Object.fromEntries(SEGMENT_ORDER.map(k => [k, items.filter(i => i.segment === k && i.severity === "urgent").length]));
  return (
    <div className="grid grid-cols-4 gap-2" role="group" aria-label="התראות לפי תחום">
      {SEGMENT_ORDER.map(k => {
        const m = SEGMENTS[k];
        const on = active === k;
        return (
          <button key={k} type="button" onClick={() => onToggle?.(on ? null : k)} aria-pressed={on}
                  className={cn("rounded-xl border px-2 py-2 text-start transition-colors", m.soft, on && "ring-2 ring-primary ring-offset-1")}>
            <div className={cn("text-[11px] font-semibold", m.text)}>{m.label}</div>
            <div className="flex items-baseline gap-1">
              <span className={cn("text-lg font-bold tabular-nums", m.text)}>{counts[k]}</span>
              {urgent[k] > 0 ? <span className="text-[10px] text-red-700 font-semibold">{urgent[k]} דחוף</span>
                : counts[k] === 0 ? <CheckCircle2 className="w-3.5 h-3.5 text-green-600" aria-label="תקין" /> : null}
            </div>
          </button>
        );
      })}
    </div>
  );
}

/* ── רשימת "דורש טיפול" ────────────────────────────────────────────────── */
export function AttentionList({ items = [], limit, onDismiss, onRestore, hiddenCount = 0, segmentFilter, showSegment = true, emptyText = "אין פריטים שדורשים טיפול. יום טוב!" }) {
  const [expanded, setExpanded] = useState(false);
  const filtered = segmentFilter ? items.filter(i => i.segment === segmentFilter) : items;
  const visible = limit && !expanded ? filtered.slice(0, limit) : filtered;
  const more = filtered.length - visible.length;

  if (!filtered.length) {
    return (
      <div className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground flex flex-col items-center gap-2">
        <CheckCircle2 className="w-6 h-6 text-green-600" aria-hidden="true" />
        <span>{emptyText}</span>
        {hiddenCount > 0 && onRestore && (
          <button type="button" onClick={onRestore} className="text-xs text-primary inline-flex items-center gap-1"><BellOff className="w-3.5 h-3.5" aria-hidden="true" /> שחזר {hiddenCount} שהוסתרו להיום</button>
        )}
      </div>
    );
  }
  return (
    <ul className="space-y-1.5" aria-label="דורש טיפול">
      {visible.map(it => {
        const sev = SEVERITY[it.severity];
        const seg = SEGMENTS[it.segment] || SEGMENTS.operational;
        return (
          <li key={it.key} className={cn("flex items-center gap-2 rounded-lg border bg-card border-s-[3px] ps-2.5 pe-1 py-1.5", sev.bar)}>
            <Link to={it.link} className="flex-1 min-w-0 flex items-center gap-2">
              <span className="flex-1 min-w-0 text-sm text-foreground truncate">{it.text}</span>
              {it.when && <span className={cn("text-[11px] whitespace-nowrap tabular-nums", it.severity === "urgent" ? "text-red-700 font-semibold" : "text-muted-foreground")}>{it.when}</span>}
              {showSegment && <span className={cn("hidden sm:inline text-[10px] font-semibold rounded-full px-1.5 py-0.5 whitespace-nowrap", seg.pill)}>{seg.label}</span>}
            </Link>
            {onDismiss && (
              <button type="button" onClick={() => onDismiss(it.key)} aria-label={`הסתר להיום: ${it.text}`}
                      className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent">
                <X className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            )}
          </li>
        );
      })}
      {(more > 0 || (limit && expanded && filtered.length > limit)) && (
        <li>
          <button type="button" onClick={() => setExpanded(e => !e)} className="w-full text-xs text-primary py-1 inline-flex items-center justify-center gap-1">
            {expanded ? <><ChevronUp className="w-3.5 h-3.5" aria-hidden="true" /> הצג פחות</> : <><ChevronDown className="w-3.5 h-3.5" aria-hidden="true" /> עוד {more}</>}
          </button>
        </li>
      )}
      {hiddenCount > 0 && onRestore && (
        <li><button type="button" onClick={onRestore} className="w-full text-[11px] text-muted-foreground py-0.5 inline-flex items-center justify-center gap-1"><BellOff className="w-3 h-3" aria-hidden="true" /> {hiddenCount} הוסתרו להיום · שחזר</button></li>
      )}
    </ul>
  );
}

export function SectionTitle({ children, action, icon: Icon, className }) {
  return (
    <div className={cn("flex items-center justify-between gap-2 mb-2", className)}>
      <h2 className="text-sm font-bold text-foreground flex items-center gap-1.5">{Icon && <Icon className="w-4 h-4 text-muted-foreground" aria-hidden="true" />}{children}</h2>
      {action}
    </div>
  );
}

export function ErrorNote({ text }) {
  return (
    <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 text-destructive text-sm p-3 flex items-center gap-2">
      <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" /> {text}
    </div>
  );
}
