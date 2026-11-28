import React from "react";

// מזהה Invoice Maven של רשומה (לקוח / ספק / מוצר). מציג 8 תווים ראשונים של ה-GUID ואת המק"ט אם יש;
// המזהה המלא ב-title ולקורא מסך. לחיצה מעתיקה את המזהה המלא.
export default function MavenIdBadge({ id, code, className = "" }) {
  if (!id && !code) return null;
  const full = [id && `Maven ${id}`, code && `מק"ט ${code}`].filter(Boolean).join(" · ");
  const copy = (e) => {
    e.stopPropagation();
    try { navigator.clipboard?.writeText(String(id || code)); } catch { /* לא נתמך */ }
  };
  return (
    <button type="button" onClick={copy} title={`${full} (לחיצה מעתיקה)`} aria-label={full}
      className={`inline-flex items-center gap-1 text-[11px] leading-5 px-1.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-100 hover:bg-indigo-100 ${className}`}>
      <span className="font-semibold">Maven</span>
      {id && <span dir="ltr" className="font-mono">{String(id).slice(0, 8)}</span>}
      {code && <span dir="ltr" className="font-mono text-indigo-500">{code}</span>}
    </button>
  );
}
