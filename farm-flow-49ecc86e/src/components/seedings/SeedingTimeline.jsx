import React, { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { format, parseISO, differenceInDays, addDays, subDays } from "date-fns";
import { he } from "date-fns/locale";
import { Tractor, Droplets, Leaf, Calendar, Flag, Sprout } from "lucide-react";

/* ─── constants ─────────────────────────────────────────────────────── */
const POLE_HEIGHTS = [28, 54, 80];   // px for stagger levels 0-2
const BANNER_H     = 20;             // approximate px height of flag banner

const TYPE_CFG = {
  harvest:  { bg: "bg-green-500",  Icon: Leaf,     label: "קטיף"   },
  spraying: { bg: "bg-blue-500",   Icon: Droplets, label: "ריסוס"  },
  activity: { bg: "bg-orange-500", Icon: Tractor,  label: "פעילות" },
};

/* ─── helpers ────────────────────────────────────────────────────────── */
function pctOf(date, startDate, totalDays) {
  if (totalDays <= 0) return 0;
  return (differenceInDays(date, startDate) / totalDays) * 100;
}

function clamp(v, lo = 0, hi = 100) {
  return Math.max(lo, Math.min(hi, v));
}

/* ─── component ──────────────────────────────────────────────────────── */
export default function SeedingTimeline({ activities, harvests, sprayings, seeding }) {

  const data = useMemo(() => {
    if (!seeding?.planting_date) return null;

    const today     = new Date();
    const plantDate = parseISO(seeding.planting_date);
    const endDate   = seeding.estimated_end_date ? parseISO(seeding.estimated_end_date) : null;

    /* ── build raw events ── */
    const raw = [];

    (harvests  || []).filter(h => h?.date).forEach(h => raw.push({
      id: h.id, type: "harvest", date: parseISO(h.date),
      detail: `${h.quantity ?? 0} יח' | איכות: ${h.quality ?? "-"}`,
    }));

    (sprayings || []).filter(s => s?.date).forEach(s => {
      const pests = Array.isArray(s.applied_pesticides)
        ? s.applied_pesticides.map(p => p.pesticide_name).filter(Boolean).join(", ") || s.treatment_type
        : s.treatment_type || "";
      raw.push({ id: s.id, type: "spraying", date: parseISO(s.date), detail: pests });
    });

    (activities || []).filter(a => a?.date).forEach(a => raw.push({
      id: a.id, type: "activity", date: parseISO(a.date),
      detail: `${a.activity_type ?? "פעילות"} | ₪${(a.total_cost ?? 0).toLocaleString()}`,
    }));

    raw.sort((a, b) => a.date - b.date);

    const firstHarvestDate = raw.find(e => e.type === "harvest")?.date ?? null;

    /* ── date range ── */
    const rangeStart = subDays(plantDate, 5);
    const rangeEnd   = addDays(endDate ?? today, 14);
    const totalDays  = Math.max(1, differenceInDays(rangeEnd, rangeStart));

    /* ── assign stagger levels (left-to-right, 3 levels) ── */
    const levelLast = [-999, -999, -999];
    const events = raw.map(ev => {
      const pct = pctOf(ev.date, rangeStart, totalDays);
      let lvl = 0;
      for (let i = 0; i < 3; i++) {
        if (pct - levelLast[i] >= 5) { lvl = i; break; }
      }
      levelLast[lvl] = pct;
      return { ...ev, pct: clamp(pct, 1, 99), level: lvl };
    });

    const maxLevel = events.length > 0 ? Math.max(...events.map(e => e.level)) : 0;

    return {
      events, rangeStart, rangeEnd, totalDays,
      plantDate, endDate, today, firstHarvestDate, maxLevel,
      plantPct:        clamp(pctOf(plantDate,        rangeStart, totalDays)),
      endPct:          endDate        ? clamp(pctOf(endDate,           rangeStart, totalDays)) : null,
      todayPct:        clamp(pctOf(today,            rangeStart, totalDays)),
      firstHarvestPct: firstHarvestDate ? clamp(pctOf(firstHarvestDate, rangeStart, totalDays)) : null,
    };
  }, [activities, harvests, sprayings, seeding]);

  /* ── empty state ── */
  if (!data) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center h-24 text-gray-400 text-sm">
          אין תאריך שתילה — לא ניתן להציג ציר זמן
        </CardContent>
      </Card>
    );
  }

  const {
    events, plantDate, endDate, today, firstHarvestDate,
    plantPct, endPct, todayPct, firstHarvestPct, maxLevel,
  } = data;

  const flagsH = POLE_HEIGHTS[maxLevel] + BANNER_H; // px height of flag area above line

  /* ── render ── */
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold text-gray-700">
          <Calendar className="w-4 h-4 text-gray-400" />
          ציר זמן
          <span className="text-xs font-normal text-gray-400">({events.length} פעולות)</span>
        </CardTitle>
      </CardHeader>

      <CardContent className="pb-5">
        <TooltipProvider delayDuration={80}>
          <div className="relative px-1">

            {/* ══ FLAGS AREA ══════════════════════════════════════════════ */}
            <div className="relative" style={{ height: flagsH }}>
              {events.map(ev => {
                const cfg = TYPE_CFG[ev.type] ?? TYPE_CFG.activity;
                const Icon = cfg.Icon;
                const poleH = POLE_HEIGHTS[ev.level];
                return (
                  <Tooltip key={`${ev.type}-${ev.id}`}>
                    <TooltipTrigger asChild>
                      {/* flag = banner + pole; positioned bottom-up from the line */}
                      <div
                        className="absolute flex flex-col items-center cursor-pointer group z-10"
                        style={{ left: `${ev.pct}%`, bottom: 0, transform: "translateX(-50%)" }}
                      >
                        {/* banner */}
                        <div className={`${cfg.bg} rounded-sm px-1.5 py-0.5 flex items-center gap-0.5 shadow-sm whitespace-nowrap group-hover:scale-110 group-hover:shadow-md transition-all duration-150`}>
                          <Icon className="w-2.5 h-2.5 text-white flex-shrink-0" />
                          <span className="text-[10px] text-white font-semibold leading-none">
                            {format(ev.date, "dd/MM", { locale: he })}
                          </span>
                        </div>
                        {/* pole */}
                        <div className="w-px bg-gray-300" style={{ height: poleH }} />
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="top" dir="rtl" className="text-xs">
                      <p className="font-semibold">{cfg.label}</p>
                      <p className="text-gray-400">{format(ev.date, "EEEE, dd/MM/yyyy", { locale: he })}</p>
                      {ev.detail && <p className="text-gray-300 mt-0.5 max-w-48 break-words">{ev.detail}</p>}
                    </TooltipContent>
                  </Tooltip>
                );
              })}
            </div>

            {/* ══ TIMELINE LINE ═══════════════════════════════════════════ */}
            <div className="relative" style={{ height: 6 }}>

              {/* base track */}
              <div className="absolute inset-0 rounded-full bg-gray-100" />

              {/* growing segment — planting → first harvest (green) */}
              {(() => {
                const segEnd = firstHarvestPct ?? endPct ?? clamp(todayPct);
                if (plantPct >= segEnd) return null;
                return (
                  <div
                    className="absolute top-0 h-full rounded-full bg-green-400"
                    style={{ left: `${plantPct}%`, width: `${segEnd - plantPct}%` }}
                  />
                );
              })()}

              {/* harvesting segment — first harvest → end (amber) */}
              {firstHarvestPct !== null && (() => {
                const segEnd = endPct ?? clamp(todayPct);
                if (firstHarvestPct >= segEnd) return null;
                return (
                  <div
                    className="absolute top-0 h-full rounded-full bg-amber-400"
                    style={{ left: `${firstHarvestPct}%`, width: `${segEnd - firstHarvestPct}%` }}
                  />
                );
              })()}

              {/* milestone dots — ON the line */}
              {/* planting */}
              <div
                className="absolute w-3.5 h-3.5 rounded-full bg-green-600 border-2 border-white shadow-md z-10"
                style={{ left: `${plantPct}%`, top: "50%", transform: "translate(-50%,-50%)" }}
              />
              {/* first harvest */}
              {firstHarvestPct !== null && (
                <div
                  className="absolute w-3.5 h-3.5 rounded-full bg-amber-500 border-2 border-white shadow-md z-10"
                  style={{ left: `${firstHarvestPct}%`, top: "50%", transform: "translate(-50%,-50%)" }}
                />
              )}
              {/* end */}
              {endPct !== null && (
                <div
                  className="absolute w-3.5 h-3.5 rounded-full bg-gray-500 border-2 border-white shadow-md z-10"
                  style={{ left: `${endPct}%`, top: "50%", transform: "translate(-50%,-50%)" }}
                />
              )}
            </div>

            {/* today marker — spans above & below line */}
            {todayPct > 1 && todayPct < 99 && (
              <div
                className="absolute z-20"
                style={{
                  left: `${todayPct}%`,
                  top: flagsH - 8,    // 8px into the flags area
                  transform: "translateX(-50%)",
                }}
              >
                <div className="w-0.5 bg-blue-400 opacity-70 rounded-full" style={{ height: 22 }} />
              </div>
            )}

            {/* ══ LABELS BELOW LINE ══════════════════════════════════════ */}
            <div className="relative mt-1" style={{ height: 44 }}>

              {/* planting */}
              <div
                className="absolute flex flex-col items-center text-green-700 text-[10px] leading-tight"
                style={{ left: `${plantPct}%`, transform: "translateX(-50%)" }}
              >
                <Sprout className="w-3 h-3 mb-0.5" />
                <span className="font-medium">{format(plantDate, "dd/MM", { locale: he })}</span>
                <span className="text-gray-400">שתילה</span>
              </div>

              {/* first harvest — show only if far enough from planting */}
              {firstHarvestDate && firstHarvestPct !== null &&
               Math.abs(firstHarvestPct - plantPct) > 7 && (
                <div
                  className="absolute flex flex-col items-center text-amber-700 text-[10px] leading-tight"
                  style={{ left: `${firstHarvestPct}%`, transform: "translateX(-50%)" }}
                >
                  <Leaf className="w-3 h-3 mb-0.5" />
                  <span className="font-medium">{format(firstHarvestDate, "dd/MM", { locale: he })}</span>
                  <span className="text-gray-400">קטיף ראשון</span>
                </div>
              )}

              {/* today — show only if inside range */}
              {todayPct > 2 && todayPct < 97 && (
                <div
                  className="absolute flex flex-col items-center text-blue-600 text-[10px] leading-tight"
                  style={{ left: `${todayPct}%`, transform: "translateX(-50%)" }}
                >
                  <span className="font-semibold">היום</span>
                </div>
              )}

              {/* end — show only if far enough */}
              {endDate && endPct !== null &&
               Math.abs(endPct - (firstHarvestPct ?? plantPct)) > 7 && (
                <div
                  className="absolute flex flex-col items-center text-gray-500 text-[10px] leading-tight"
                  style={{ left: `${endPct}%`, transform: "translateX(-50%)" }}
                >
                  <Flag className="w-3 h-3 mb-0.5" />
                  <span className="font-medium">{format(endDate, "dd/MM", { locale: he })}</span>
                  <span className="text-gray-400">עקירה</span>
                </div>
              )}
            </div>

          </div>

          {/* ══ LEGEND ═════════════════════════════════════════════════════ */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-3 pt-3 border-t text-[11px] text-gray-500">
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-6 h-1.5 rounded bg-green-400" />
              גדילה
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-6 h-1.5 rounded bg-amber-400" />
              קטיף
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded-sm bg-green-500" />
              קטיף
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded-sm bg-blue-500" />
              ריסוס
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded-sm bg-orange-500" />
              פעילות
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-0.5 h-3.5 rounded bg-blue-400" />
              היום
            </span>
          </div>

        </TooltipProvider>
      </CardContent>
    </Card>
  );
}
