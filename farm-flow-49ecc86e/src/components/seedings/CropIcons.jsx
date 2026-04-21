import React from "react";
import { Apple, Carrot, Grape, Wheat, Cherry, Flower2, Bean, TreePine } from "lucide-react";

// מיפוי אייקונים לסוגי גידולים
const cropIconMap = {
  "מלפפון": Carrot,
  "עגבנייה": Cherry, 
  "פלפל": Apple,
  "תות שדה": Grape,
  "חסה": Flower2,
  "כרוב": Flower2,
  "ברוקולי": Flower2,
  "גזר": Carrot,
  "בצל": Flower2,
  "תפוח אדמה": Apple,
  "חיטה": Wheat,
  "שעועית": Bean,
  "אבוקדו": TreePine,
  "זית": TreePine,
  "הדרים": Apple
};

// צבעים לאייקונים לפי סוג גידול
const cropColorMap = {
  "מלפפון": "text-green-600",
  "עגבנייה": "text-red-600",
  "פלפל": "text-yellow-600", 
  "תות שדה": "text-red-500",
  "חסה": "text-green-500",
  "כרוב": "text-green-600",
  "ברוקולי": "text-green-700",
  "גזר": "text-orange-500",
  "בצל": "text-purple-500",
  "תפוח אדמה": "text-yellow-700",
  "חיטה": "text-yellow-600",
  "שעועית": "text-green-600",
  "אבוקדו": "text-green-700",
  "זית": "text-green-800",
  "הדרים": "text-orange-500"
};

export function getCropIcon(cropType, size = "w-5 h-5") {
  const IconComponent = cropIconMap[cropType] || Flower2; // ברירת מחדל
  const colorClass = cropColorMap[cropType] || "text-gray-600";
  
  return <IconComponent className={`${size} ${colorClass}`} />;
}

export function getCropColor(cropType) {
  return cropColorMap[cropType] || "text-gray-600";
}