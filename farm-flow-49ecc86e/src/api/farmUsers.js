import { apiFetch, BASE_URL } from './localClient';

// רשימת המשתמשים של משק — חברי המשק בלבד (farm_members). מחליף את User.list()
// שפנה ל-/api/users, נתיב פנימי שנחסם בהקשחת 14/10/2026 (לא חושפים את כל המשתמשים).
// צורת הפלט תואמת למה שטפסי העובדים מצפים לו: { id, full_name, email, role }.
export async function listFarmUsers(farmId) {
  if (!farmId) return [];
  try {
    const rows = await apiFetch(`${BASE_URL}/farm-members?farm_id=${encodeURIComponent(farmId)}`);
    return (Array.isArray(rows) ? rows : [])
      .filter((m) => m.is_active !== 0)
      .map((m) => ({ id: m.user_id, full_name: m.full_name || m.email, email: m.email, role: m.role, field_worker: !!m.field_worker }));
  } catch {
    return [];
  }
}
