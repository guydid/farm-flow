// "עדכונים אחרונים" לדשבורד: הרשומות שנוצרו/עודכנו לאחרונה במשק, עם תיאור קריא בעברית.
// נבנה מטבלת entities (updated_at) — בלי טבלת לוג נפרדת. מי עדכן: השדה _by שהשרת מחתים
// בכל יצירה/עדכון (ובסוכן MCP: "סוכן: …"); ברשומות ישנות — שדות קיימים כמו inspector_name.

const TYPES = {
  seedings:              { label: 'מזרע', icon: 'sprout' },
  harvests:              { label: 'קטיף', icon: 'harvest' },
  sprayings:             { label: 'הדברה', icon: 'spray' },
  activities:            { label: 'פעילות', icon: 'activity' },
  pest_recommendations:  { label: 'המלצת הדברה', icon: 'bug' },
  pesticide_stock:       { label: 'מלאי חומרים', icon: 'stock' },
  pesticide_prices:      { label: 'מחיר חומר', icon: 'price' },
  invoices:              { label: 'חשבונית', icon: 'invoice' },
  weighing_certificates: { label: 'תעודת שקילה', icon: 'scale' },
  plots:                 { label: 'חלקה', icon: 'plot' },
  expenses:              { label: 'הוצאה', icon: 'invoice' },
  vehicle_treatments:    { label: 'טיפול רכב', icon: 'vehicle' },
  employees:             { label: 'עובד', icon: 'employee' },
  employee_events:       { label: 'אירוע עובד', icon: 'employee' },
};
const EMP_EVENT = {
  start_employment: 'תחילת העסקה', entry_to_country: 'כניסה לארץ', inter_visa_exit: 'יציאה לאינטרוויזה', inter_visa_return: 'חזרה מאינטרוויזה',
  transfer: 'נייוד', contract_signed: 'חוזה נחתם', visa_renewal: 'חידוש אשרה', passport_renewal: 'חידוש דרכון', medical_exam: 'בדיקה רפואית',
  health_insurance: 'ביטוח רפואי', documents_received: 'קבלת מסמכים', bank_account: 'חשבון בנק / טלפון', authority_notice: 'הודעת רשות האוכלוסין',
  fee_payment: 'אגרה / תשלום', end_employment: 'סיום העסקה', other: 'אירוע',
};

const SEEDING_STATUS = { ordered: 'הוזמן', preparation: 'בהכנה', growing: 'בגידול', harvesting: 'בקטיף', uprooted: 'נעקר', archived: 'בארכיון' };
const REC_STATUS = { pending: 'ממתינה', done: 'בוצעה', cancelled: 'בוטלה' };
const STOCK_TYPE = { count: 'ספירת מלאי', purchase: 'קנייה', adjustment: 'תיקון מלאי' };

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n.toLocaleString('he-IL', { maximumFractionDigits: 2 }) : null; };
const join = (...parts) => parts.filter(Boolean).join(' · ');

function describe(type, d, ctx) {
  const seedingName = d.seeding_name || ctx.seedings.get(d.seeding_id) || '';
  const page = (p) => ({ page: p });
  switch (type) {
    case 'seedings':
      return { title: d.name || 'מזרע', detail: join(SEEDING_STATUS[d.status], d.total_area ? `${num(d.total_area)} דונם` : ''), ...page(`SeedingDetail?id=${ctx.id}`) };
    case 'harvests':
      return { title: join('קטיף', seedingName), detail: join(d.quantity ? `${num(d.quantity)} יח'` : '', d.weight ? `${num(d.weight)} ק"ג` : '', d.packaging), ...page(d.seeding_id ? `SeedingDetail?id=${d.seeding_id}` : 'Seedings') };
    case 'sprayings': {
      const names = (Array.isArray(d.applied_pesticides) ? d.applied_pesticides : []).map(p => p.pesticide_name).filter(Boolean);
      return { title: join(d.control_method === 'biological' ? 'הדברה ביולוגית' : 'הדברה', seedingName), detail: join(names.join(', '), d.area_covered ? `${num(d.area_covered)} דונם` : ''), ...page(d.seeding_id ? `SeedingDetail?id=${d.seeding_id}` : 'Seedings') };
    }
    case 'activities':
      return { title: join(ctx.activityTypes.get(d.activity_type_id) || d.activity_type_name || 'פעילות', seedingName), detail: d.notes ? String(d.notes).slice(0, 80) : '', ...page(d.seeding_id ? `SeedingDetail?id=${d.seeding_id}` : 'Seedings') };
    case 'pest_recommendations':
      return { title: join('המלצת הדברה', d.pest), detail: join(d.plot_name || ctx.plots.get(d.plot_id), REC_STATUS[d.status || 'pending']), status: d.status || 'pending', ...page('PestControl') };
    case 'pesticide_stock':
      return { title: join(STOCK_TYPE[d.type] || 'מלאי', d.product_name), detail: join(d.quantity != null ? `${num(d.quantity)} ${d.unit || ''}` : '', d.supplier), ...page('PestControl?tab=stock') };
    case 'pesticide_prices':
      return { title: join('מחיר', d.product_name), detail: d.price != null ? `₪${num(d.price)} ל${d.unit || "יח'"}` : 'מחיר נמחק', ...page('PestControl?tab=stock') };
    case 'invoices':
      return { title: join('חשבונית', d.supplier_name), detail: join(d.invoice_number ? `מס' ${d.invoice_number}` : '', d.total != null ? `₪${num(d.total)}` : '', d.doc_type === 'delivery_note' ? 'תעודת משלוח' : ''), ...page(`InvoiceDetail?id=${ctx.id}`) };
    case 'weighing_certificates':
      return { title: join('תעודת שקילה', d.customer_name), detail: join(d.certificate_number ? `מס' ${d.certificate_number}` : '', d.total_weight ? `${num(d.total_weight)} ק"ג` : ''), ...page(`WeighingDetail?id=${ctx.id}`) };
    case 'plots':
      return { title: join('חלקה', d.name), detail: d.size ? `${num(d.size)} דונם` : '', ...page('Plots') };
    case 'expenses':
      return { title: join('הוצאה', d.description || d.category), detail: d.amount != null ? `₪${num(d.amount)}` : '', ...page('Seedings') };
    case 'vehicle_treatments':
      return { title: join('טיפול רכב', d.treatment_type || d.description), detail: d.cost != null ? `₪${num(d.cost)}` : '', ...page(d.vehicle_id ? `VehicleDetail?id=${d.vehicle_id}` : 'Vehicles') };
    case 'employee_events':
      return { title: join(EMP_EVENT[d.event_type] || 'אירוע עובד', d.employee_name || ctx.employees.get(d.employee_id)), detail: join(d.event_date, d.notes ? String(d.notes).slice(0, 80) : ''), ...page(d.employee_id ? `EmployeeDetail?id=${d.employee_id}` : 'Employees') };
    case 'employees':
      return { title: join('עובד', d.full_name || d.name), detail: '', ...page(`EmployeeDetail?id=${ctx.id}`) };
    default:
      return { title: TYPES[type]?.label || type, detail: '' };
  }
}

const authorOf = (d) => d._by || d.updated_by || d.created_by || d.inspector_name || d.executed_by || d.performed_by || '';

function getRecentUpdates(db, farmId, { limit = 20, before = null, types = null } = {}) {
  const wanted = (types && types.length ? types : Object.keys(TYPES)).filter(t => TYPES[t]);
  if (!wanted.length) return { items: [], next: null };
  const lim = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  const ph = wanted.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT id, entity_type, data, created_at, updated_at FROM entities
    WHERE farm_id = ? AND entity_type IN (${ph}) ${before ? 'AND updated_at < ?' : ''}
    ORDER BY updated_at DESC LIMIT ?`).all(farmId, ...wanted, ...(before ? [before] : []), lim + 1);

  const nameMap = (type, field = 'name') => new Map(
    db.prepare('SELECT id, data FROM entities WHERE entity_type = ? AND farm_id = ?').all(type, farmId)
      .map(r => { try { return [r.id, JSON.parse(r.data || '{}')[field] || '']; } catch { return [r.id, '']; } }));
  const lookups = { seedings: nameMap('seedings'), plots: nameMap('plots'), activityTypes: nameMap('activity_types'), employees: nameMap('employees', 'full_name') };

  const items = rows.slice(0, lim).map(r => {
    let d; try { d = JSON.parse(r.data || '{}'); } catch { d = {}; }
    // נוצר ועודכן באותה שנייה → יצירה
    const created = String(r.created_at).slice(0, 19) === String(r.updated_at).slice(0, 19);
    const by = authorOf(d);
    return {
      id: r.id, entity: r.entity_type, kind: TYPES[r.entity_type].label, icon: TYPES[r.entity_type].icon,
      action: created ? 'created' : 'updated', at: r.updated_at, by, by_agent: /^סוכן/.test(by),
      ...describe(r.entity_type, d, { ...lookups, id: r.id }),
    };
  });
  return { items, next: rows.length > lim ? rows[lim - 1].updated_at : null };
}

module.exports = { getRecentUpdates, RECENT_TYPES: Object.keys(TYPES) };
