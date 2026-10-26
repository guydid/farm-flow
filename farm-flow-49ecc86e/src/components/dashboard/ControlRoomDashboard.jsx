// "חדר בקרה" — דשבורד למסך גדול: שורת מדדים עם מגמה, מסילת התראות, גאנט, גרפים ועדכונים.
import React, { lazy, Suspense, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { LayoutDashboard, Sprout, Wheat, Scale, Wallet, Users, Bell, RefreshCw, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import PageHeader from "@/components/common/PageHeader";
import ErrorBoundary from "@/components/ErrorBoundary";
import { createPageUrl } from "@/utils";
import { cn } from "@/lib/utils";
import RecentUpdates from "./RecentUpdates";
import { KpiTile, AttentionList, SegmentBar, ErrorNote } from "./widgets";
import { computeKpis, fmtKg, fmtMoney, dateLabel } from "./dashboardData";

const SeedingsGanttChart = lazy(() => import("./SeedingsGanttChart"));
const HarvestChart = lazy(() => import("./HarvestChart"));
const IncomeDistributionChart = lazy(() => import("./IncomeDistributionChart"));
const EventsTimelineChart = lazy(() => import("./EventsTimelineChart"));

const ChartFallback = ({ h = "h-64" }) => <Card><CardContent className="pt-6"><Skeleton className={cn("w-full", h)} /></CardContent></Card>;

export default function ControlRoomDashboard({ farm, data, loading, error, loadedAt, reload, attention, dismiss, restore, hiddenCount }) {
  const [range, setRange] = useState(() => { try { return Number(localStorage.getItem("ff_dash_range")) || 7; } catch { return 7; } });
  const [segment, setSegment] = useState(null);
  const setRangePersist = (v) => { setRange(v); try { localStorage.setItem("ff_dash_range", String(v)); } catch { /* ignore */ } };
  const k = useMemo(() => computeKpis(data, range, attention), [data, range, attention]);

  const activeSeedings = useMemo(() => (data?.seedings || []).filter(s => s?.status && !["uprooted", "archived"].includes(s.status)), [data]);
  const rangeLabel = { 7: "7 הימים האחרונים", 30: "30 הימים האחרונים", 90: "90 הימים האחרונים" }[range];

  return (
    <div className="p-4 sm:p-6 lg:p-8 min-h-full" dir="rtl">
      <div className="max-w-screen-2xl mx-auto space-y-5">
        <PageHeader
          icon={LayoutDashboard}
          title="סקירה"
          subtitle={<>{farm?.name}{farm?.name ? " · " : ""}{dateLabel()}{loadedAt ? ` · עודכן ${loadedAt.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })}` : ""}</>}
          className="mb-0"
          actions={
            <>
              <Select value={String(range)} onValueChange={(v) => setRangePersist(Number(v))}>
                <SelectTrigger className="w-44 h-9" aria-label="טווח זמן למדדים"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="7">7 הימים האחרונים</SelectItem>
                  <SelectItem value="30">30 הימים האחרונים</SelectItem>
                  <SelectItem value="90">90 הימים האחרונים</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline" size="icon" onClick={() => reload()} disabled={loading} aria-label="רענן">
                {loading ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="w-4 h-4" aria-hidden="true" />}
              </Button>
            </>
          }
        />

        {error && <ErrorNote text={error} />}

        {/* ── מדדים ─────────────────────────────────────────────────── */}
        {!k ? (
          <div className="grid gap-3 grid-cols-3 xl:grid-cols-6">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
        ) : (
          <div className="grid gap-3 grid-cols-3 xl:grid-cols-6">
            <KpiTile segment="agronomic" icon={Sprout} label="מזרעים פעילים" value={k.seedings.active} hint={k.seedings.harvesting ? `${k.seedings.harvesting} בקטיף · מתוך ${k.seedings.total}` : `מתוך ${k.seedings.total}`} to={createPageUrl("Seedings")} />
            <KpiTile segment="agronomic" icon={Wheat} label={`קטיף · ${rangeLabel}`} value={fmtKg(k.harvest.kg)} delta={k.harvest.delta} hint="מול התקופה הקודמת" series={k.harvest.series} to={createPageUrl("Seedings")} />
            <KpiTile segment="money" icon={Scale} label="שקילות היום" value={k.weighing.count} hint={k.weighing.count ? `${fmtKg(k.weighing.kg)} · ${k.weighing.customers} לקוחות` : "עדיין אין היום"} to={createPageUrl("WeighingCertificates")} />
            <KpiTile segment="money" icon={Wallet} label={`הכנסות קטיף · ${rangeLabel}`} value={fmtMoney(k.revenue.amount)} delta={k.revenue.delta} hint="מול התקופה הקודמת" series={k.revenue.series} />
            <KpiTile segment="workers" icon={Users} label="נוכחים היום" value={k.attendance ? `${k.attendance.present} / ${k.attendance.total}` : "—"} hint={k.attendance ? (k.attendance.absent ? `${k.attendance.absent} חסרים` : "כולם נוכחים") : "אין שעון נוכחות"} to={createPageUrl("Attendance")} />
            <KpiTile segment="operational" icon={Bell} label="דורש טיפול" value={k.alerts.total} hint={k.alerts.urgent ? `${k.alerts.urgent} דחופים` : k.alerts.total ? "אין דחופים" : "הכל תקין"} delta={null} />
          </div>
        )}

        {/* ── התראות + גאנט ──────────────────────────────────────────── */}
        <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
          <Card className="min-w-0">
            <CardHeader className="pb-2 px-4 pt-4">
              <CardTitle className="text-sm font-bold flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5"><Bell className="w-4 h-4 text-muted-foreground" aria-hidden="true" /> דורש טיפול</span>
                <span className="text-xs font-normal text-muted-foreground">{attention.length} פריטים</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="px-3 pb-3 space-y-3">
              <SegmentBar items={attention} active={segment} onToggle={setSegment} />
              <AttentionList items={attention} segmentFilter={segment} onDismiss={dismiss} onRestore={restore} hiddenCount={hiddenCount} limit={8} showSegment={false} />
            </CardContent>
          </Card>

          <ErrorBoundary>
            <Suspense fallback={<ChartFallback h="h-80" />}>
              <SeedingsGanttChart activeSeedings={activeSeedings} activities={data?.activities || []} harvests={data?.harvests || []} sprayings={data?.sprayings || []} />
            </Suspense>
          </ErrorBoundary>
        </div>

        {/* ── גרפים + עדכונים ────────────────────────────────────────── */}
        <div className="grid gap-4 lg:grid-cols-3">
          <ErrorBoundary><Suspense fallback={<ChartFallback />}><HarvestChart harvests={data?.harvests || []} seedings={data?.seedings || []} /></Suspense></ErrorBoundary>
          <ErrorBoundary><Suspense fallback={<ChartFallback />}><IncomeDistributionChart harvests={data?.harvests || []} seedings={data?.seedings || []} /></Suspense></ErrorBoundary>
          <ErrorBoundary><RecentUpdates pageSize={8} /></ErrorBoundary>
        </div>

        <ErrorBoundary>
          <Suspense fallback={<ChartFallback />}>
            <EventsTimelineChart seedings={data?.seedings || []} harvests={data?.harvests || []} sprayings={data?.sprayings || []} activities={data?.activities || []} />
          </Suspense>
        </ErrorBoundary>

        <p className="text-[11px] text-muted-foreground text-center">
          <Link to={createPageUrl("Settings")} className="hover:underline">הגדרות</Link> · הנתונים מתרעננים אוטומטית כל 5 דקות
        </p>
      </div>
    </div>
  );
}
