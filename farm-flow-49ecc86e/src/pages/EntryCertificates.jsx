import React from "react";
import WeighingCertificates from "./WeighingCertificates";

// רשימת תעודות כניסה (קליטת תוצרת מחקלאי/ספק) — אותו מסך של רשימת תעודות השקילה, במצב רכש.
export default function EntryCertificates() {
  return <WeighingCertificates mode="purchase" />;
}
