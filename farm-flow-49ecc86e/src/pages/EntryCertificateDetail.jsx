import React from "react";
import WeighingDetail from "./WeighingDetail";

// תעודת כניסה — קליטת תוצרת מחקלאי/ספק: אותו מסך של תעודת השקילה (משטחים, אריזות, סוגי תוצרת,
// מדבקות, הדפסה ושיתוף), במצב רכש — ספק במקום לקוח, נשמר ב-entry_certificates / entry_items.
export default function EntryCertificateDetail() {
  return <WeighingDetail mode="purchase" />;
}
