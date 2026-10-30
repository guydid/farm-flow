import React from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * כותרת עמוד אחידה לכל המערכת.
 *  - title       טקסט/אלמנט הכותרת (h1 יחיד בעמוד)
 *  - subtitle    שורת משנה (ספירה, שם משק, הסבר קצר)
 *  - icon        אייקון lucide (מוצג בריבוע מיתוג, מוסתר בנייד צר)
 *  - backTo      נתיב לקישור "חזרה" + backLabel
 *  - actions     כפתורים בצד שמאל (RTL)
 *  - children    שורה נוספת מתחת (פילטרים, טאבים)
 */
export default function PageHeader({ title, subtitle, icon: Icon, backTo, backLabel = "חזרה", actions, className, children, compact = false, level = 1 }) {
  const Heading = level === 2 ? "h2" : "h1"; // level 2 — עמוד המוטמע בתוך עמוד אחר (יש כבר h1 מעליו)
  return (
    <header className={cn("mb-4 lg:mb-6", className)}>
      {backTo && (
        <Link to={backTo} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-2 rounded-md">
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
          {backLabel}
        </Link>
      )}
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex items-center gap-3 min-w-0">
          {Icon && (
            <span aria-hidden="true" className={cn("hidden sm:inline-flex shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary", compact ? "h-9 w-9" : "h-11 w-11")}>
              <Icon className={compact ? "h-5 w-5" : "h-6 w-6"} />
            </span>
          )}
          <div className="min-w-0">
            <Heading className={cn("font-bold text-foreground leading-tight truncate", compact ? "text-lg lg:text-xl" : "text-xl lg:text-2xl")}>{title}</Heading>
            {subtitle && <p className="text-sm text-muted-foreground mt-0.5 truncate">{subtitle}</p>}
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
      </div>
      {children}
    </header>
  );
}

/** מעטפת עמוד אחידה: ריפוד, רוחב מקסימלי, רקע */
export function PageShell({ children, className, width = "2xl" }) {
  const max = { xl: "max-w-screen-xl", "2xl": "max-w-screen-2xl", lg: "max-w-5xl", md: "max-w-4xl", sm: "max-w-3xl" }[width] || "max-w-screen-2xl";
  return (
    <div className={cn("p-3 sm:p-6 lg:p-8 min-h-full", className)} dir="rtl">
      <div className={cn(max, "mx-auto")}>{children}</div>
    </div>
  );
}
