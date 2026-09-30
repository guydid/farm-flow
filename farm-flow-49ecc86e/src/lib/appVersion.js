// גרסת האפליקציה — מוזרקת בזמן build מ-vite.config.js (define)
// version: מ-package.json | build: git short hash | builtAt: ISO time של ה-build
import { useEffect, useState, useCallback } from "react";

/* global __APP_VERSION__, __APP_BUILD__, __APP_BUILT_AT__ */
export const APP_VERSION = {
  version: typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev",
  build: typeof __APP_BUILD__ !== "undefined" ? __APP_BUILD__ : "dev",
  builtAt: typeof __APP_BUILT_AT__ !== "undefined" ? __APP_BUILT_AT__ : "",
};

const pad = (n) => String(n).padStart(2, "0");
export function formatBuiltAt(iso = APP_VERSION.builtAt) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// למשל: "v1.0.0 · cf4d4f0 · 30/09/2026 14:05"
export function formatVersion() {
  return [`v${APP_VERSION.version}`, APP_VERSION.build, formatBuiltAt()].filter(Boolean).join(" · ");
}

// בודק מול /version.json (נכתב בכל build) האם עלתה גרסה חדשה לשרת.
// בדיקה: בטעינה, בכל חזרה לטאב, בכל ניווט, וכל 5 דקות.
export function useVersionCheck(routeKey) {
  const [latest, setLatest] = useState(null);

  const check = useCallback(async () => {
    try {
      const res = await fetch(`/version.json?t=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) return;
      const info = await res.json();
      if (info && info.build) setLatest(info);
      // מבקשים מה-Service Worker לבדוק עדכון (sw.js משתנה בכל build)
      if (info?.build && info.build !== APP_VERSION.build && "serviceWorker" in navigator) {
        navigator.serviceWorker.getRegistration().then(r => r && r.update()).catch(() => {});
      }
    } catch { /* אין רשת — נבדוק בפעם הבאה */ }
  }, []);

  useEffect(() => { check(); }, [check, routeKey]);
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") check(); };
    document.addEventListener("visibilitychange", onVisible);
    const id = setInterval(check, 5 * 60 * 1000);
    return () => { document.removeEventListener("visibilitychange", onVisible); clearInterval(id); };
  }, [check]);

  const updateAvailable = !!(latest?.build && APP_VERSION.build !== "dev" && latest.build !== APP_VERSION.build);
  return { updateAvailable, latest, current: APP_VERSION };
}
