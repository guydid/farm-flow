// ארכיון עובדים: דגל archived נפרד מהסטטוס (הסטטוס — לא פעיל/נטש — נשמר כמו שהוא).
// עובד בארכיון לא מוצג ברשימת העובדים, בהתראות, בדשבורד ובקישור לשעון הנוכחות.
import { Employee, EmployeeLog } from '@/entities/all';

export const isArchived = (e) => !!e?.archived;
export const withoutArchived = (list) => (Array.isArray(list) ? list : []).filter(e => e && !e.archived);
// מועמדים טבעיים לארכיון — סיימו או נטשו
export const isArchivable = (e) => e && !e.archived && (e.status === 'inactive' || e.status === 'abandoned');

export async function setArchived(employee, archived, user) {
  const by = user?.full_name || user?.email || '';
  await Employee.update(employee.id, archived
    ? { archived: true, archived_at: new Date().toISOString(), archived_by: by }
    : { archived: false, archived_at: null, archived_by: null });
  await EmployeeLog.create({
    employee_id: employee.id,
    farm_id: employee.farm_id,
    action: archived ? 'העובד הועבר לארכיון' : 'העובד הוחזר מהארכיון',
    performed_by: by,
  }).catch(() => {});
}
