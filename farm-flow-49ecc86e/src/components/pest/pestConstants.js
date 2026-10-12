// פיקוח מזיקים — ערכים משותפים לעמוד, לטופס ולביצוע.
// אותם ערכים מאומתים גם בשרת ה-MCP (backend/mcp.js) — לשנות בשני המקומות יחד.

export const ACTIVE_SEEDING_STATUSES = ['ordered', 'growing', 'harvesting', 'preparation'];

export const SEVERITIES = [
  { id: 'low', label: 'נמוכה', cls: 'bg-yellow-50 text-yellow-800 border-yellow-200' },
  { id: 'medium', label: 'בינונית', cls: 'bg-orange-50 text-orange-800 border-orange-200' },
  { id: 'high', label: 'גבוהה', cls: 'bg-red-50 text-red-700 border-red-200' },
];
export const severityOf = (id) => SEVERITIES.find(s => s.id === id) || SEVERITIES[1];

export const CONTROL_METHODS = [
  { id: 'chemical', label: 'כימית' },
  { id: 'biological', label: 'ביולוגית' },
];

// זהים ל-treatment_type ב-SprayingForm
export const TREATMENT_TYPES = [
  { id: 'mechanized', label: 'ממוכן' },
  { id: 'spray_gun', label: 'אקדח ריסוס' },
  { id: 'backpack', label: 'ריסוס גב' },
  { id: 'drench', label: 'הגמעה' },
];
export const treatmentLabel = (id) => TREATMENT_TYPES.find(t => t.id === id)?.label || id || '';

export const STATUSES = [
  { id: 'pending', label: 'ממתינות' },
  { id: 'done', label: 'בוצעו' },
  { id: 'cancelled', label: 'בוטלו' },
];

// מינון באחוזים ("1 אחוז" בקטלוג) = ריכוז בתרסיס, לא כמות לדונם
export const isPercentUnit = (u) => /^(%|אחוז)$/.test(String(u || '').trim());

// "15 מ"ל/דונם" → { dose: 15, unit: 'מ"ל' }; "1.5 אחוז" → { dose: 1.5, unit: '%' }
export function parseDosage(pesticide) {
  const d = String(pesticide?.dosage || '');
  const m = d.match(/(\d+(?:\.\d+)?)/);
  let unit = isPercentUnit(pesticide?.unit) ? '%' : (pesticide?.unit || '');
  if (!unit) {
    unit = /אחוז|%/.test(d) ? '%' : d.includes('ליטר') ? 'ליטר' : d.includes('ק"ג') ? 'ק"ג' : d.includes('גרם') ? 'גרם' : 'מ"ל';
  }
  return { dose: m ? parseFloat(m[1]) : null, unit };
}

// נפח תרסיס מהקטלוג: "100 - 40 ליטר/דונם" → 100 (ניתן לשינוי בטופס)
export function sprayVolumeFromText(text) {
  const d = String(text || '');
  if (!d.includes('ליטר')) return null;
  const nums = (d.match(/\d+(?:\.\d+)?/g) || []).map(Number).filter(n => n > 0);
  return nums.length ? Math.max(...nums) : null;
}

// כמות תכשיר בליטרים לריסוס באחוזים: % × ליטר תרסיס לדונם × דונם
export function percentToLiters(percent, sprayVolume, area) {
  const p = parseFloat(percent), v = parseFloat(sprayVolume), a = parseFloat(area);
  if (!(p > 0 && v > 0 && a > 0)) return '';
  return String(Math.round((p / 100) * v * a * 1000) / 1000);
}
