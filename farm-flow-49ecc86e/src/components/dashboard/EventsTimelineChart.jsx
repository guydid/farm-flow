
import React, { useMemo, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { format, startOfWeek, startOfMonth, addDays, addWeeks, addMonths,
         parseISO, isWithinInterval, eachWeekOfInterval, eachMonthOfInterval,
         endOfWeek, endOfMonth, subDays, subMonths } from "date-fns";
import { he } from "date-fns/locale";
import { Droplets, Leaf, Activity, ChevronDown, ChevronUp } from "lucide-react";

const RANGE_OPTIONS = [
  { label: "30 יום", days: 30 },
  { label: "90 יום", days: 90 },
  { label: "6 חודשים", days: 180 },
  { label: "שנה", days: 365 },
];

const EVENT_COLORS = {
  sprayings:  { color: "#f97316", label: "ריסוסים",  icon: Droplets },
  harvests:   { color: "#10b981", label: "קטיפים",   icon: Leaf     },
  activities: { color: "#6366f1", label: "פעילויות", icon: Activity },
};

const STATUS_LABEL = {
  ordered:     "הוזמן",
  growing:     "גדל",
  harvesting:  "בקטיף",
  preparation: "הכנה",
};

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-right" dir="rtl">
      <p className="font-bold text-sm text-gray-700 mb-2">{label}</p>
      {payload.map((p) => (
        p.value > 0 && (
          <div key={p.dataKey} className="flex items-center gap-2 text-sm">
            <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: p.color }} />
            <span className="text-gray-600">{EVENT_COLORS[p.dataKey]?.label}:</span>
            <span className="font-semibold">{p.value}</span>
          </div>
        )
      ))}
      {payload.every(p => p.value === 0) && (
        <p className="text-xs text-gray-400">אין אירועים</p>
      )}
    </div>
  );
};

export default function EventsTimelineChart({ seedings = [], harvests = [], sprayings = [], activities = [] }) {
  const [rangeDays, setRangeDays]           = useState(90);
  const [groupBy, setGroupBy]               = useState("week"); // "week" | "month"
  const [selectedSeedings, setSelectedSeedings] = useState(null); // null = all
  const [showSeedingFilter, setShowSeedingFilter] = useState(false);

  // Active seedings only (not uprooted/archived)
  const activeSeedings = useMemo(() =>
    seedings.filter(s => s?.status && !["uprooted", "archived"].includes(s.status)),
  [seedings]);

  const toggleSeeding = (id) => {
    setSelectedSeedings(prev => {
      if (prev === null) {
        // Switch from "all" → deselect this one
        return activeSeedings.map(s => s.id).filter(sid => sid !== id);
      }
      if (prev.includes(id)) {
        const next = prev.filter(sid => sid !== id);
        return next.length === activeSeedings.length ? null : next;
      } else {
        const next = [...prev, id];
        return next.length === activeSeedings.length ? null : next;
      }
    });
  };

  const isSelected = (id) => selectedSeedings === null || selectedSeedings.includes(id);

  const selectedIds = useMemo(() =>
    selectedSeedings === null ? activeSeedings.map(s => s.id) : selectedSeedings,
  [selectedSeedings, activeSeedings]);

  // Date range
  const rangeEnd   = useMemo(() => new Date(), []);
  const rangeStart = useMemo(() => subDays(rangeEnd, rangeDays), [rangeEnd, rangeDays]);

  // Filter events to selected seedings + date range
  const inRange = (dateStr) => {
    if (!dateStr) return false;
    try {
      const d = typeof dateStr === "string" ? parseISO(dateStr) : dateStr;
      return isWithinInterval(d, { start: rangeStart, end: rangeEnd });
    } catch { return false; }
  };

  const filteredHarvests   = useMemo(() => harvests.filter(e   => selectedIds.includes(e.seeding_id)   && inRange(e.date)),   [harvests,   selectedIds, rangeStart, rangeEnd]);
  const filteredSprayings  = useMemo(() => sprayings.filter(e  => selectedIds.includes(e.seeding_id)  && inRange(e.date)),  [sprayings,  selectedIds, rangeStart, rangeEnd]);
  const filteredActivities = useMemo(() => activities.filter(e => selectedIds.includes(e.seeding_id) && inRange(e.date)), [activities, selectedIds, rangeStart, rangeEnd]);

  // Build time buckets (weeks or months)
  const chartData = useMemo(() => {
    const buckets = groupBy === "week"
      ? eachWeekOfInterval({ start: rangeStart, end: rangeEnd }, { weekStartsOn: 0 })
      : eachMonthOfInterval({ start: rangeStart, end: rangeEnd });

    return buckets.map((bucketStart) => {
      const bucketEnd = groupBy === "week"
        ? endOfWeek(bucketStart, { weekStartsOn: 0 })
        : endOfMonth(bucketStart);

      const inBucket = (dateStr) => {
        if (!dateStr) return false;
        try {
          const d = typeof dateStr === "string" ? parseISO(dateStr) : dateStr;
          return isWithinInterval(d, { start: bucketStart, end: bucketEnd });
        } catch { return false; }
      };

      const label = groupBy === "week"
        ? format(bucketStart, "d/M", { locale: he })
        : format(bucketStart, "MMM yy", { locale: he });

      return {
        label,
        sprayings:  filteredSprayings.filter(e  => inBucket(e.date)).length,
        harvests:   filteredHarvests.filter(e   => inBucket(e.date)).length,
        activities: filteredActivities.filter(e => inBucket(e.date)).length,
      };
    });
  }, [groupBy, rangeStart, rangeEnd, filteredHarvests, filteredSprayings, filteredActivities]);

  const totalEvents = filteredHarvests.length + filteredSprayings.length + filteredActivities.length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-3">
          {/* Title row */}
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-base font-bold">
              ציר זמן אירועים
              <span className="text-sm text-gray-400 font-normal mr-2">({totalEvents} אירועים)</span>
            </CardTitle>

            {/* Group by toggle */}
            <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
              {[{ v: "week", l: "שבועי" }, { v: "month", l: "חודשי" }].map(({ v, l }) => (
                <button
                  key={v}
                  onClick={() => setGroupBy(v)}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                    groupBy === v ? "bg-white shadow text-blue-700" : "text-gray-500 hover:text-gray-700"
                  }`}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>

          {/* Controls row */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Date range */}
            <div className="flex gap-1">
              {RANGE_OPTIONS.map(({ label, days }) => (
                <button
                  key={days}
                  onClick={() => setRangeDays(days)}
                  className={`px-2.5 py-1 rounded text-xs font-medium border transition-all ${
                    rangeDays === days
                      ? "bg-blue-600 text-white border-blue-600"
                      : "bg-white text-gray-600 border-gray-200 hover:border-blue-300"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Seeding filter */}
            {activeSeedings.length > 0 && (
              <div className="relative">
                <button
                  onClick={() => setShowSeedingFilter(f => !f)}
                  className="flex items-center gap-1.5 px-3 py-1 rounded border border-gray-200 bg-white text-xs font-medium text-gray-600 hover:border-blue-300 transition-all"
                >
                  <Leaf className="w-3.5 h-3.5 text-green-600" />
                  {selectedSeedings === null ? "כל המזרעים" : `${selectedIds.length} מזרעים`}
                  {showSeedingFilter ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </button>

                {showSeedingFilter && (
                  <div className="absolute top-full right-0 mt-1 z-20 bg-white border border-gray-200 rounded-lg shadow-xl p-2 min-w-[220px] max-h-60 overflow-y-auto" dir="rtl">
                    <div className="flex justify-between items-center mb-1.5 pb-1.5 border-b">
                      <button onClick={() => setSelectedSeedings(null)} className="text-xs text-blue-600 hover:underline">בחר הכל</button>
                      <button onClick={() => setSelectedSeedings([])} className="text-xs text-gray-400 hover:underline">נקה הכל</button>
                    </div>
                    {activeSeedings.map(s => (
                      <label key={s.id} className="flex items-center gap-2 p-1.5 rounded hover:bg-gray-50 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={isSelected(s.id)}
                          onChange={() => toggleSeeding(s.id)}
                          className="accent-blue-600"
                        />
                        <span className="text-xs text-gray-700 flex-1 truncate">{s.name || s.crop_type}</span>
                        {s.status && (
                          <span className={`text-[10px] px-1.5 rounded-full ${
                            s.status === "growing"    ? "bg-green-100 text-green-700"  :
                            s.status === "harvesting" ? "bg-yellow-100 text-yellow-700" :
                            s.status === "ordered"    ? "bg-blue-100 text-blue-700"    :
                            "bg-gray-100 text-gray-600"
                          }`}>
                            {STATUS_LABEL[s.status] || s.status}
                          </span>
                        )}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Legend badges */}
            <div className="flex gap-2 mr-auto">
              {Object.entries(EVENT_COLORS).map(([key, { color, label }]) => (
                <span key={key} className="flex items-center gap-1 text-xs text-gray-500">
                  <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: color }} />
                  {label}
                </span>
              ))}
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        {totalEvents === 0 ? (
          <div className="flex flex-col items-center justify-center h-52 text-gray-400 gap-2">
            <Activity className="w-10 h-10 opacity-30" />
            <p className="text-sm">אין אירועים בטווח הזמן שנבחר</p>
            <p className="text-xs">נסה להרחיב את טווח התאריכים או לשנות את המזרעים</p>
          </div>
        ) : (
          <div className="h-64" onClick={() => setShowSeedingFilter(false)}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 5 }} barSize={groupBy === "week" ? 12 : 24}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: "#6b7280" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 11, fill: "#6b7280" }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(99,102,241,0.05)" }} />
                <Bar dataKey="sprayings"  stackId="events" fill={EVENT_COLORS.sprayings.color}  radius={[0,0,0,0]} />
                <Bar dataKey="activities" stackId="events" fill={EVENT_COLORS.activities.color} radius={[0,0,0,0]} />
                <Bar dataKey="harvests"   stackId="events" fill={EVENT_COLORS.harvests.color}   radius={[3,3,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Summary pills */}
        <div className="flex gap-3 mt-3 pt-3 border-t flex-wrap">
          {Object.entries(EVENT_COLORS).map(([key, { color, label, icon: Icon }]) => {
            const count = key === "harvests" ? filteredHarvests.length
                        : key === "sprayings" ? filteredSprayings.length
                        : filteredActivities.length;
            return (
              <div key={key} className="flex items-center gap-1.5 text-sm">
                <Icon className="w-3.5 h-3.5" style={{ color }} />
                <span className="text-gray-500">{label}:</span>
                <span className="font-bold" style={{ color }}>{count}</span>
              </div>
            );
          })}
          {selectedSeedings !== null && selectedSeedings.length < activeSeedings.length && (
            <span className="text-xs text-gray-400 mr-auto">
              מוצגים {selectedIds.length} מתוך {activeSeedings.length} מזרעים פעילים
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
