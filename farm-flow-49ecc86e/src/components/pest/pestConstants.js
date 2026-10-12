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

// "15 מ"ל/דונם" → { dose: 15, unit: 'מ"ל' } — כמו החילוץ ב-SprayingForm
export function parseDosage(pesticide) {
  const m = String(pesticide?.dosage || '').match(/(\d+(?:\.\d+)?)/);
  let unit = pesticide?.unit || '';
  if (!unit) {
    const d = String(pesticide?.dosage || '');
    unit = d.includes('ליטר') ? 'ליטר' : d.includes('ק"ג') ? 'ק"ג' : d.includes('גרם') ? 'גרם' : 'מ"ל';
  }
  return { dose: m ? parseFloat(m[1]) : null, unit };
}
