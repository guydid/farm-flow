// "היום במשק" — דשבורד למסך קטן: ברכה, פס תחומים, "דורש טיפול", מספרי היום, מזרעים, עדכונים.
// הוספה מהירה נשארת בבר התחתון (FAB) ולא משוכפלת כאן.
import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Scale, ChevronRight, Sprout, Loader2, Wheat, Users, Bell } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { createPageUrl } from "@/utils";
import { cn } from "@/lib/utils";
import { getCropIcon } from "../seedings/CropIcons";
import RecentUpdates from "./RecentUpdates";
import { KpiTile, AttentionList, SegmentBar, SectionTitle, ErrorNote } from "./widgets";
import { computeKpis, fmtKg, dateLabel, greeting } from "./dashboardData";

export default function TodayDashboard({ user, farm, data, loading, error, attention, dismiss, restore, hiddenCount }) {
  const [segment, setSegment] = useState(null);
  const k = useMemo(() => computeKpis(data, 7, attention), [data, attention]);
  const activeSeedings = useMemo(() => (data?.seedings || []).filter(s => s?.status && ["growing", "harvesting"].includes(s.status)).slice(0, 4), [data]);
  const urgent = attention.filter(a => a.severity === "urgent").length;

  return (
    <div className="p-3 pb-6 space-y-4" dir="rtl">
      {/* ── ברכה ────────────────────────────────────────────────────── */}
      <header className="flex items-start justify-between gap-2 pt-1">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-foreground truncate">{greeting(user?.full_name)}</h1>
          <p className="text-sm text-muted-foreground mt-0.5 truncate">{dateLabel()}{farm?.name ? ` · ${farm.name}` : ""}</p>
        </div>
        <div className="flex gap-1.5 items-center shrink-0">
          {loading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" aria-label="טוען" />}
          {k?.weighing.count > 0 && (
            <Link to={createPageUrl("WeighingCertificates")} className="flex items-center gap-1 bg-indigo-50 border border-indigo-200 text-indigo-700 rounded-lg px-2 py-1 text-xs font-semibold">
              <Scale className="w-3.5 h-3.5" aria-hidden="true" /> {k.weighing.count} שקילות
            </Link>
          )}
          {urgent > 0 && (
            <span className="flex items-center gap-1 bg-red-50 border border-red-200 text-red-700 rounded-lg px-2 py-1 text-xs font-bold" aria-label={`${urgent} פריטים דחופים`}>
              <Bell className="w-3.5 h-3.5" aria-hidden="true" /> {urgent}
            </span>
          )}
        </div>
      </header>

      {error && <ErrorNote text={error} />}

      {/* ── תחומים + דורש טיפול ─────────────────────────────────────── */}
      {!data && loading ? (
        <div className="space-y-2"><Skeleton className="h-16 rounded-xl" /><Skeleton className="h-40 rounded-xl" /></div>
      ) : (
        <section aria-labelledby="attn-title" className="space-y-2">
          <SegmentBar items={attention} active={segment} onToggle={setSegment} />
          <div className="rounded-2xl border bg-card p-2.5 space-y-2">
            <SectionTitle className="mb-0 px-0.5" icon={Bell}>
              <span id="attn-title">דורש טיפול</span>
              <span className="text-xs font-normal text-muted-foreground">{segment ? `${attention.filter(a => a.segment === segment).length}` : attention.length}</span>
            </SectionTitle>
            <AttentionList items={attention} segmentFilter={segment} onDismiss={dismiss} onRestore={restore} hiddenCount={hiddenCount} limit={5} showSegment={false} />
          </div>
        </section>
      )}

      {/* ── מספרי היום ─────────────────────────────────────────────── */}
      {k && (
        <section aria-label="מספרי היום" className="grid grid-cols-2 gap-2">
          <KpiTile compact segment="agronomic" icon={Wheat} label="קטיף היום" value={k.harvest.kgToday ? fmtKg(k.harvest.kgToday) : "—"} hint={k.harvest.todayLabel || (k.harvest.kg ? `${fmtKg(k.harvest.kg)} השבוע` : "עדיין לא נרשם")} to={createPageUrl("Seedings")} />
          <KpiTile compact segment="money" icon={Scale} label="שקילות היום" value={k.weighing.count} hint={k.weighing.count ? fmtKg(k.weighing.kg) : "עדיין אין"} to={createPageUrl("WeighingCertificates")} />
          <KpiTile compact segment="workers" icon={Users} label="נוכחות" value={k.attendance ? `${k.attendance.present} / ${k.attendance.total}` : "—"} hint={k.attendance ? (k.attendance.absent ? `${k.attendance.absent} חסרים` : "כולם נוכחים") : "אין שעון"} to={createPageUrl("Attendance")} />
          <KpiTile compact segment="agronomic" icon={Sprout} label="מזרעים פעילים" value={k.seedings.active} hint={k.seedings.harvesting ? `${k.seedings.harvesting} בקטיף` : `מתוך ${k.seedings.total}`} to={createPageUrl("Seedings")} />
        </section>
      )}

      {/* ── מזרעים (עד 4) ───────────────────────────────────────────── */}
      {activeSeedings.length > 0 && (
        <section aria-labelledby="seed-title">
          <SectionTitle icon={Sprout} action={<Link to={createPageUrl("Seedings")} className="text-xs text-primary inline-flex items-center gap-0.5">הכל <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" /></Link>}>
            <span id="seed-title">בשטח עכשיו</span>
          </SectionTitle>
          <div className="grid grid-cols-2 gap-2">
            {activeSeedings.map(s => (
              <Link key={s.id} to={createPageUrl("SeedingDetail") + `?id=${s.id}`} className="flex items-center gap-2 rounded-xl border bg-card px-2.5 py-2 min-w-0 active:bg-accent">
                <span className="shrink-0">{getCropIcon(s.crop_type, "w-5 h-5")}</span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium truncate">{s.name}</span>
                  <span className={cn("block text-[11px] truncate", s.status === "harvesting" ? "text-amber-700" : "text-muted-foreground")}>{s.status === "harvesting" ? "בקטיף" : s.crop_type}</span>
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* ── עדכונים אחרונים ─────────────────────────────────────────── */}
      <RecentUpdates compact />
    </div>
  );
}
