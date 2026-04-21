import React, { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { format, parseISO, addDays, differenceInDays } from "date-fns";
import { he } from "date-fns/locale";
import { Calendar, Droplets, Tractor, Leaf, Sprout, Flag } from "lucide-react";
import { createPageUrl } from "@/utils";
import { Link } from "react-router-dom";

/* ─── constants ──────────────────────────────────────────────────────── */
const ROW_H        = 58;   // px total height per seeding row
const LINE_TOP     = 42;   // px from top where the line sits
const LINE_H       = 6;    // px line height
const POLE_H       = [14, 27]; // 2 stagger levels (px)
const BANNER_H     = 13;   // approximate px height of mini-banner
const SIDEBAR_W    = 160;  // px left sidebar width

const TYPE_CFG = {
  harvest:  { bg: "bg-green-500",  Icon: Leaf,     label: "קטיף"   },
  spraying: { bg: "bg-blue-500",   Icon: Droplets, label: "ריסוס"  },
  activity: { bg: "bg-orange-500", Icon: Tractor,  label: "פעילות" },
};

const STATUS_LABEL = {
  ordered:     "הוזמן",
  growing:     "גידול",
  harvesting:  "קטיף",
  preparation: "הכנה",
};
const STATUS_COLOR = {
  ordered:     "bg-indigo-100 text-indigo-800 border-indigo-200",
  growing:     "bg-green-100  text-green-800  border-green-200",
  harvesting:  "bg-yellow-100 text-yellow-800 border-yellow-200",
  preparation: "bg-purple-100 text-purple-800 border-purple-200",
};

/* ─── helpers ─────────────────────────────────────────────────────────── */
function clamp(v, lo = 0, hi = 100) { return Math.max(lo, Math.min(hi, v)); }

function pctOf(date, start, totalDays) {
  return totalDays > 0 ? (differenceInDays(date, start) / totalDays) * 100 : 0;
}

/* ─── component ───────────────────────────────────────────────────────── */
export default function SeedingsGanttChart({ activeSeedings, activities, harvests, sprayings }) {

  const gantt = useMemo(() => {
    const seedings   = Array.isArray(activeSeedings) ? activeSeedings.filter(Boolean) : [];
    const allActs    = Array.isArray(activities)     ? activities.filter(Boolean)     : [];
    const allHarvs   = Array.isArray(harvests)       ? harvests.filter(Boolean)       : [];
    const allSprays  = Array.isArray(sprayings)      ? sprayings.filter(Boolean)      : [];

    if (!seedings.length) return null;

    const today = new Date();

    /* ── date range ── */
    let minDate = today, maxDate = addDays(today, 60);

    seedings.forEach(s => {
      try {
        const pd = s.planting_date      ? parseISO(s.planting_date)      : null;
        const sd = s.start_date         ? parseISO(s.start_date)         : null;
        const ed = s.estimated_end_date ? parseISO(s.estimated_end_date) : null;
        if (pd && pd < minDate) minDate = pd;
        if (sd && sd < minDate) minDate = sd;
        if (ed && ed > maxDate) maxDate = ed;
        const evts = [
          ...allHarvs .filter(h => h.seeding_id === s.id).map(h => h.date ? parseISO(h.date) : null),
          ...allSprays.filter(p => p.seeding_id === s.id).map(p => p.date ? parseISO(p.date) : null),
          ...allActs  .filter(a => a.seeding_id === s.id).map(a => a.date ? parseISO(a.date) : null),
        ].filter(Boolean);
        evts.forEach(d => { if (d < minDate) minDate = d; if (d > maxDate) maxDate = d; });
      } catch (_) {}
    });

    const rangeStart = addDays(minDate, -7);
    const rangeEnd   = addDays(maxDate,  7);
    const totalDays  = Math.max(1, differenceInDays(rangeEnd, rangeStart));

    /* ── header ticks ── */
    const tickEvery = Math.max(7, Math.round(totalDays / 16 / 7) * 7);
    const ticks = [];
    let t = rangeStart;
    while (t <= rangeEnd) { ticks.push(new Date(t)); t = addDays(t, tickEvery); }

    const todayPct = clamp(pctOf(today, rangeStart, totalDays));

    /* ── process each seeding ── */
    const rows = seedings.map(s => {
      const plantDate  = s.planting_date      ? parseISO(s.planting_date)      : null;
      const endDate    = s.estimated_end_date ? parseISO(s.estimated_end_date) : null;

      const seedHarvs  = allHarvs .filter(h => h.seeding_id === s.id && h.date);
      const seedSprays = allSprays.filter(p => p.seeding_id === s.id && p.date);
      const seedActs   = allActs  .filter(a => a.seeding_id === s.id && a.date);

      /* raw events sorted by date */
      const raw = [
        ...seedHarvs .map(h => ({ type: "harvest",  date: parseISO(h.date),  id: h.id,
          detail: `${h.quantity ?? 0} יח' | ${h.quality ?? "-"}` })),
        ...seedSprays.map(p => ({ type: "spraying", date: parseISO(p.date),  id: p.id,
          detail: p.treatment_type || "" })),
        ...seedActs  .map(a => ({ type: "activity", date: parseISO(a.date),  id: a.id,
          detail: a.activity_type || "" })),
      ].sort((a, b) => a.date - b.date);

      const firstHarvest = raw.find(e => e.type === "harvest");

      /* stagger levels */
      const levelLast = [-999, -999];
      const events = raw.map(ev => {
        const pct = pctOf(ev.date, rangeStart, totalDays);
        let lvl = 0;
        for (let i = 0; i < 2; i++) {
          if (pct - levelLast[i] >= 4) { lvl = i; break; }
        }
        levelLast[lvl] = pct;
        return { ...ev, pct: clamp(pct, 0.5, 99.5), level: lvl };
      });

      return {
        ...s,
        plantDate,
        endDate,
        firstHarvestDate: firstHarvest?.date ?? null,
        events,
        plantPct:        plantDate        ? clamp(pctOf(plantDate,             rangeStart, totalDays)) : null,
        endPct:          endDate          ? clamp(pctOf(endDate,               rangeStart, totalDays)) : null,
        firstHarvestPct: firstHarvest     ? clamp(pctOf(firstHarvest.date,     rangeStart, totalDays)) : null,
      };
    });

    return { rows, ticks, rangeStart, rangeEnd, totalDays, today, todayPct };
  }, [activeSeedings, activities, harvests, sprayings]);

  /* ── empty state ── */
  if (!gantt) {
    return (
      <Card>
        <CardHeader><CardTitle>ציר זמן מזרעים</CardTitle></CardHeader>
        <CardContent>
          <div className="text-center text-gray-500 py-8">אין מזרעים פעילים להצגה</div>
        </CardContent>
      </Card>
    );
  }

  const { rows, ticks, rangeStart, rangeEnd, totalDays, today, todayPct } = gantt;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 flex-wrap text-sm font-semibold text-gray-700">
          <Calendar className="w-4 h-4 text-gray-400" />
          ציר זמן מזרעים
          <span className="text-xs font-normal text-gray-400">
            {format(rangeStart, "d MMM yy", { locale: he })} — {format(rangeEnd, "d MMM yy", { locale: he })}
          </span>
        </CardTitle>
      </CardHeader>

      <CardContent className="pb-4">
        <TooltipProvider delayDuration={80}>
          <div className="overflow-x-auto [&::-webkit-scrollbar]:hidden" style={{ scrollbarWidth: 'none' }}>
            <div style={{ minWidth: 700 }}>

              {/* ══ HEADER ROW (date ticks) ══════════════════════════════ */}
              <div className="flex">
                {/* sidebar spacer */}
                <div style={{ width: SIDEBAR_W, flexShrink: 0 }} />
                {/* tick area */}
                <div className="relative flex-1 border-b border-gray-200" style={{ height: 26 }}>
                  {ticks.map((tick, i) => {
                    const pct = pctOf(tick, rangeStart, totalDays);
                    if (pct < 0 || pct > 100) return null;
                    return (
                      <div
                        key={i}
                        className="absolute flex flex-col items-center"
                        style={{ left: `${pct}%`, transform: "translateX(-50%)", top: 0 }}
                      >
                        <span className="text-[10px] text-gray-400 whitespace-nowrap">
                          {format(tick, "dd/MM", { locale: he })}
                        </span>
                        <div className="w-px h-2 bg-gray-200 mt-0.5" />
                      </div>
                    );
                  })}
                  {/* today tick in header */}
                  {todayPct > 0 && todayPct < 100 && (
                    <div
                      className="absolute flex flex-col items-center"
                      style={{ left: `${todayPct}%`, transform: "translateX(-50%)", top: 0 }}
                    >
                      <span className="text-[10px] text-blue-500 font-semibold whitespace-nowrap">היום</span>
                      <div className="w-px h-2 bg-blue-400 mt-0.5" />
                    </div>
                  )}
                </div>
              </div>

              {/* ══ SEEDING ROWS ════════════════════════════════════════ */}
              {rows.map((row, ri) => (
                <div
                  key={row.id}
                  className="flex border-b border-gray-100 hover:bg-gray-50/60 transition-colors"
                  style={{ height: ROW_H }}
                >
                  {/* ── LEFT SIDEBAR ── */}
                  <div
                    className="flex flex-col justify-center px-3 gap-1 flex-shrink-0"
                    style={{ width: SIDEBAR_W }}
                  >
                    <Link
                      to={createPageUrl("SeedingDetail") + `?id=${row.id}`}
                      className="text-xs font-semibold text-gray-800 hover:text-blue-600 leading-tight line-clamp-2"
                    >
                      {row.name}
                    </Link>
                    <Badge
                      variant="outline"
                      className={`text-[10px] px-1.5 py-0 h-4 w-fit ${STATUS_COLOR[row.status] ?? "bg-gray-100 text-gray-700 border-gray-200"}`}
                    >
                      {STATUS_LABEL[row.status] ?? row.status}
                    </Badge>
                  </div>

                  {/* ── TIMELINE AREA ── */}
                  <div className="relative flex-1 overflow-visible">

                    {/* today vertical line */}
                    {todayPct > 0 && todayPct < 100 && (
                      <div
                        className="absolute top-0 bottom-0 w-px bg-blue-300 opacity-50 z-0"
                        style={{ left: `${todayPct}%` }}
                      />
                    )}

                    {/* ── FLAGS ── */}
                    {row.events.map(ev => {
                      const cfg = TYPE_CFG[ev.type] ?? TYPE_CFG.activity;
                      const Icon = cfg.Icon;
                      const poleH = POLE_H[ev.level];
                      // top of flag banner = LINE_TOP - poleH - BANNER_H
                      const topPx = LINE_TOP - poleH - BANNER_H;
                      return (
                        <Tooltip key={`${ev.type}-${ev.id}`}>
                          <TooltipTrigger asChild>
                            <div
                              className="absolute flex flex-col items-center cursor-pointer group z-20"
                              style={{
                                left:      `${ev.pct}%`,
                                top:       topPx,
                                transform: "translateX(-50%)",
                              }}
                            >
                              {/* mini banner */}
                              <div className={`${cfg.bg} rounded-[3px] px-1 py-0 flex items-center gap-0.5 shadow-sm group-hover:scale-110 group-hover:shadow transition-all duration-150 whitespace-nowrap`}
                                   style={{ height: BANNER_H }}>
                                <Icon className="w-2 h-2 text-white flex-shrink-0" />
                                <span className="text-[8px] text-white font-bold leading-none">
                                  {format(ev.date, "dd/MM", { locale: he })}
                                </span>
                              </div>
                              {/* pole */}
                              <div className="w-px bg-gray-300" style={{ height: poleH }} />
                            </div>
                          </TooltipTrigger>
                          <TooltipContent side="top" dir="rtl" className="text-xs">
                            <p className="font-semibold">{cfg.label}</p>
                            <p className="text-gray-400">{format(ev.date, "dd/MM/yyyy", { locale: he })}</p>
                            {ev.detail && <p className="text-gray-300 mt-0.5 max-w-40">{ev.detail}</p>}
                          </TooltipContent>
                        </Tooltip>
                      );
                    })}

                    {/* ── LINE ── */}
                    {row.plantPct !== null && (
                      <div
                        className="absolute z-10"
                        style={{ top: LINE_TOP, left: 0, right: 0, height: LINE_H }}
                      >
                        {/* track */}
                        <div className="absolute inset-0 rounded-full bg-gray-100" />

                        {/* growing segment */}
                        {(() => {
                          const segEnd = row.firstHarvestPct ?? row.endPct ?? clamp(todayPct);
                          if (row.plantPct >= segEnd) return null;
                          return (
                            <div
                              className="absolute top-0 h-full rounded-full bg-green-400"
                              style={{ left: `${row.plantPct}%`, width: `${segEnd - row.plantPct}%` }}
                            />
                          );
                        })()}

                        {/* harvesting segment */}
                        {row.firstHarvestPct !== null && (() => {
                          const segEnd = row.endPct ?? clamp(todayPct);
                          if (row.firstHarvestPct >= segEnd) return null;
                          return (
                            <div
                              className="absolute top-0 h-full rounded-full bg-amber-400"
                              style={{ left: `${row.firstHarvestPct}%`, width: `${segEnd - row.firstHarvestPct}%` }}
                            />
                          );
                        })()}

                        {/* planting dot */}
                        {row.plantPct !== null && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div
                                className="absolute w-3 h-3 rounded-full bg-green-600 border-2 border-white shadow z-10 cursor-pointer"
                                style={{ left: `${row.plantPct}%`, top: "50%", transform: "translate(-50%,-50%)" }}
                              />
                            </TooltipTrigger>
                            <TooltipContent dir="rtl" className="text-xs">
                              <p className="font-semibold flex items-center gap-1">
                                <Sprout className="w-3 h-3 text-green-500" /> שתילה
                              </p>
                              <p className="text-gray-400">{format(row.plantDate, "dd/MM/yyyy", { locale: he })}</p>
                            </TooltipContent>
                          </Tooltip>
                        )}

                        {/* first harvest dot */}
                        {row.firstHarvestPct !== null && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div
                                className="absolute w-3 h-3 rounded-full bg-amber-500 border-2 border-white shadow z-10 cursor-pointer"
                                style={{ left: `${row.firstHarvestPct}%`, top: "50%", transform: "translate(-50%,-50%)" }}
                              />
                            </TooltipTrigger>
                            <TooltipContent dir="rtl" className="text-xs">
                              <p className="font-semibold flex items-center gap-1">
                                <Leaf className="w-3 h-3 text-amber-500" /> קטיף ראשון
                              </p>
                              <p className="text-gray-400">{format(row.firstHarvestDate, "dd/MM/yyyy", { locale: he })}</p>
                            </TooltipContent>
                          </Tooltip>
                        )}

                        {/* end dot */}
                        {row.endPct !== null && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div
                                className="absolute w-3 h-3 rounded-full bg-gray-500 border-2 border-white shadow z-10 cursor-pointer"
                                style={{ left: `${row.endPct}%`, top: "50%", transform: "translate(-50%,-50%)" }}
                              />
                            </TooltipTrigger>
                            <TooltipContent dir="rtl" className="text-xs">
                              <p className="font-semibold flex items-center gap-1">
                                <Flag className="w-3 h-3 text-gray-500" /> עקירה משוערת
                              </p>
                              <p className="text-gray-400">{format(row.endDate, "dd/MM/yyyy", { locale: he })}</p>
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                    )}

                  </div>
                </div>
              ))}

            </div>
          </div>

          {/* ══ LEGEND ═══════════════════════════════════════════════════ */}
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
              <span className="inline-block w-2.5 h-2.5 rounded-sm bg-green-500" />
              קטיף
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-2.5 h-2.5 rounded-sm bg-blue-500" />
              ריסוס
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-2.5 h-2.5 rounded-sm bg-orange-500" />
              פעילות
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-px h-3.5 rounded bg-blue-400" />
              היום
            </span>
          </div>
        </TooltipProvider>
      </CardContent>
    </Card>
  );
}
