// העדפות נגישות של המשתמש (תפריט נגישות) — נשמרות במכשיר ומוחלות כמחלקות על <html>
// עוד לפני טעינת React, כדי שלא יהיה "קפיצה" בטעינה.
const KEY = "ff_a11y";
export const A11Y_DEFAULTS = { font: 0, contrast: false, links: false, motion: false, spacing: false };
const EVENT = "ff-a11y-changed";

export function getA11y() {
  try { return { ...A11Y_DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) || "{}")) }; } catch { return { ...A11Y_DEFAULTS }; }
}

export function applyA11y(p = getA11y()) {
  const root = document.documentElement;
  root.classList.remove("a11y-font-1", "a11y-font-2", "a11y-font-3");
  if (p.font > 0) root.classList.add(`a11y-font-${Math.min(3, p.font)}`);
  root.classList.toggle("a11y-contrast", !!p.contrast);
  root.classList.toggle("a11y-links", !!p.links);
  root.classList.toggle("a11y-no-motion", !!p.motion);
  root.classList.toggle("a11y-spacing", !!p.spacing);
}

export function setA11y(patch) {
  const next = { ...getA11y(), ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ }
  applyA11y(next);
  window.dispatchEvent(new Event(EVENT));
  return next;
}

export function resetA11y() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  applyA11y({ ...A11Y_DEFAULTS });
  window.dispatchEvent(new Event(EVENT));
}

export function onA11yChange(fn) {
  window.addEventListener(EVENT, fn);
  return () => window.removeEventListener(EVENT, fn);
}
