// דשבורד: מסך גדול (lg ומעלה) = "חדר בקרה", מסך קטן = "היום במשק".
// שתי התצוגות ניזונות מאותה טעינה ומאותה רשימת "דורש טיפול".
import React, { useCallback, useEffect, useMemo, useState, lazy, Suspense } from "react";
import ErrorBoundary from "../components/ErrorBoundary";
import { Skeleton } from "@/components/ui/skeleton";
import { useDashboardData, buildAttention, loadDismissed, saveDismissed } from "../components/dashboard/dashboardData";

const ControlRoomDashboard = lazy(() => import("../components/dashboard/ControlRoomDashboard"));
const TodayDashboard = lazy(() => import("../components/dashboard/TodayDashboard"));

const LG = 1024; // תואם ל-lg של Tailwind: סרגל צד במקום בר תחתון

function useIsLarge() {
  const [large, setLarge] = useState(() => typeof window !== "undefined" && window.innerWidth >= LG);
  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${LG}px)`);
    const on = (e) => setLarge(e.matches);
    setLarge(mq.matches);
    mq.addEventListener ? mq.addEventListener("change", on) : mq.addListener(on);
    return () => (mq.removeEventListener ? mq.removeEventListener("change", on) : mq.removeListener(on));
  }, []);
  return large;
}

const Fallback = () => (
  <div className="p-4 sm:p-6 lg:p-8 space-y-4" dir="rtl">
    <Skeleton className="h-10 w-64" />
    <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
    <Skeleton className="h-72 rounded-xl" />
  </div>
);

export default function Dashboard() {
  const large = useIsLarge();
  const { loading, error, user, farm, data, loadedAt, reload } = useDashboardData();

  // "דורש טיפול" + הסתרה להיום
  const [dismissed, setDismissed] = useState(loadDismissed);
  const allAttention = useMemo(() => buildAttention(data), [data]);
  const attention = useMemo(() => allAttention.filter(a => !dismissed.has(a.key)), [allAttention, dismissed]);
  const hiddenCount = allAttention.length - attention.length;
  const dismiss = useCallback((key) => setDismissed(prev => { const n = new Set(prev); n.add(key); saveDismissed(n); return n; }), []);
  const restore = useCallback(() => { const n = new Set(); saveDismissed(n); setDismissed(n); }, []);

  const props = { user, farm, data, loading, error, loadedAt, reload, attention, dismiss, restore, hiddenCount };

  return (
    <ErrorBoundary>
      <Suspense fallback={<Fallback />}>
        {large ? <ControlRoomDashboard {...props} /> : <TodayDashboard {...props} />}
      </Suspense>
    </ErrorBoundary>
  );
}
