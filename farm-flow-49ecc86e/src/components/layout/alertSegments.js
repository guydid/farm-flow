// סגמנטים של התראות — חלוקה לתחומים: אגרונומי / עובדים / תפעולי.
// משמש גם בפאנל ההתראות (פעמון) וגם בטיקר של דשבורד הנייד.

export const ALERT_SEGMENTS = {
  agronomic:   { key: 'agronomic',   label: 'אגרונומי', dot: 'bg-green-500',  text: 'text-green-700',  chip: 'bg-green-100 text-green-700 border-green-200' },
  workers:     { key: 'workers',     label: 'עובדים',   dot: 'bg-blue-500',   text: 'text-blue-700',   chip: 'bg-blue-100 text-blue-700 border-blue-200' },
  operational: { key: 'operational', label: 'תפעולי',   dot: 'bg-slate-500',  text: 'text-slate-700',  chip: 'bg-slate-100 text-slate-700 border-slate-200' },
};

// סדר התצוגה הקבוע של הסגמנטים
export const ALERT_SEGMENT_ORDER = ['agronomic', 'workers', 'operational'];

// מיפוי סוג התראה → סגמנט. ברירת מחדל: תפעולי.
const TYPE_TO_SEGMENT = {
  employee:     'workers',
  sheet:        'agronomic',
  seeding:      'agronomic',
  vehicle:      'operational',
  subscription: 'operational',
  admin:        'operational',
};

export function segmentForType(type) {
  return TYPE_TO_SEGMENT[type] || 'operational';
}

export function segmentMeta(key) {
  return ALERT_SEGMENTS[key] || ALERT_SEGMENTS.operational;
}
