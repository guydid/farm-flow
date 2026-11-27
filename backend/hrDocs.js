// ─── מסמכי משאבי אנוש: תלושי שכר, חוזי העסקה, פוליסות ביטוח רפואי ───────────────
// ליבה משותפת ל-REST (employeeDocs.js / payslipImport.js) ול-MCP (mcp.js). בלי תלויות npm —
// נבדקת ב-CI עם node:sqlite.
//
// כל סוג נשמר כ-entity_type משלו בטבלת entities (farm_id, created_at, updated_at — כמו כל ישות):
//   payslips                    — תלוש לעובד לחודש
//   employment_contracts        — חוזה העסקה
//   medical_insurance_policies  — פוליסת ביטוח רפואי; כל פוליסה רשומה נפרדת (היסטוריה).
//                                 הפוליסה הפעילה מסונכרנת ל-employees.insurance_details (תאימות לאחור).
// מסמכים אחרים נשארים ב-employee_documents. כל הסוגים פנימיים לראוטים הגנריים (תלושים רגישים):
// גישה רק לבעלים/מנהלים, דרך הראוטים הייעודיים וה-MCP.
const crypto = require('crypto');

const CONTRACT_TYPES = {
  permanent: 'קבוע', fixed_term: 'לתקופה קצובה', seasonal: 'עונתי', foreign_worker: 'עובד זר (חוזה לפי רשות האוכלוסין)',
  manpower: 'דרך חברת כוח אדם', temporary: 'זמני', other: 'אחר',
};

const F = (field, types, description, extra = {}) => ({ field, types: Array.isArray(types) ? types : [types], description, ...extra });
const COMMON_FIELDS = [
  F('id', 'string', 'מזהה הרשומה'),
  F('farm_id', 'string', 'המשק (נקבע אוטומטית לפי הטוקן)'),
  F('employee_id', 'string', 'id של העובד (employees). ביצירה אפשר במקום זה passport_number או employee_name', { required: true }),
  F('employee_name', 'string', 'שם העובד (נשמר אוטומטית לנוחות)'),
  F('title', 'string', 'כותרת המסמך'),
  F('file_url', ['string', 'null'], 'קישור לקובץ המקורי (PDF/תמונה). ב-get_record מוחזר גם files[].download_url לקריאה'),
  F('file_name', ['string', 'null'], 'שם הקובץ המקורי'),
  F('sign_status', 'string', 'סטטוס חתימת העובד: none / pending / signed / expired (קריאה בלבד)'),
  F('signed_at', ['string', 'null'], 'מועד החתימה (UTC, קריאה בלבד)'),
  F('notes', 'string', 'הערות'),
  F('source', 'string', 'מקור הרשומה: manual / gmail_payslip / agent / employee_card'),
  F('created_at', 'string', 'נוצר (UTC)'),
  F('updated_at', 'string', 'עודכן לאחרונה (UTC)'),
];

const HR_ENTITIES = {
  payslips: {
    category: 'payslip',
    label: 'תלושי שכר',
    description: 'תלושי שכר — רשומה לכל עובד לכל חודש: employee_id, period (YYYY-MM), employer (חברה מעסיקה), gross, net, file_url. מיובאים מהמייל (מנהלת השכר) או מועלים ידנית',
    dateField: 'period_start',
    fields: [
      F('period', 'string', 'חודש התלוש YYYY-MM', { required: true }),
      F('month', 'number', 'חודש (1-12), נגזר מ-period'),
      F('year', 'number', 'שנה, נגזר מ-period'),
      F('period_start', 'string', 'היום הראשון בחודש YYYY-MM-01 — שדה ברירת המחדל לסינון לפי טווח תאריכים'),
      F('employer', ['string', 'null'], 'הישות המעסיקה (החברה שבשמה הונפק התלוש)'),
      F('gross', ['number', 'null'], 'שכר ברוטו (סה"כ תשלומים) ב-₪'),
      F('net', ['number', 'null'], 'שכר נטו ב-₪'),
      F('net_to_pay', ['number', 'null'], 'נטו לתשלום ב-₪ (אחרי ניכויי רשות)'),
      F('timesheet', ['object', 'null'], 'דף השעות של החודש (נוצר משעון הנוכחות או הועלה): file_url, days, total_hours, generated_at, source. נשלח לחתימת העובד יחד עם התלוש (קריאה בלבד; הורדה דרך files[] kind=timesheet)'),
    ],
  },
  employment_contracts: {
    category: 'contract',
    label: 'חוזי העסקה',
    description: 'חוזי העסקה: employee_id, contract_type, signed_date, start_date, end_date, employer, file_url',
    dateField: 'start_date',
    fields: [
      F('contract_type', 'string', `סוג החוזה: ${Object.entries(CONTRACT_TYPES).map(([k, v]) => `${k}=${v}`).join(', ')}`, { enum: Object.keys(CONTRACT_TYPES) }),
      F('signed_date', ['string', 'null'], 'תאריך חתימת החוזה YYYY-MM-DD'),
      F('start_date', ['string', 'null'], 'תחילת תוקף החוזה YYYY-MM-DD — שדה ברירת המחדל לסינון'),
      F('end_date', ['string', 'null'], 'סיום תוקף החוזה YYYY-MM-DD (ריק = ללא הגבלה)'),
      F('employer', ['string', 'null'], 'הישות המעסיקה'),
    ],
  },
  medical_insurance_policies: {
    category: 'medical_insurance',
    label: 'פוליסות ביטוח רפואי',
    description: 'פוליסות ביטוח רפואי — כל פוליסה רשומה נפרדת (היסטוריה מלאה): employee_id, insurance_company, policy_number, start_date, end_date, agent, health_fund, file_url. הפוליסה הפעילה מסונכרנת ל-employees.insurance_details',
    dateField: 'start_date',
    fields: [
      F('insurance_company', 'string', 'חברת הביטוח', { required: true }),
      F('policy_number', ['string', 'null'], 'מספר פוליסה'),
      F('start_date', ['string', 'null'], 'תחילת הכיסוי YYYY-MM-DD — שדה ברירת המחדל לסינון'),
      F('end_date', ['string', 'null'], 'סיום הכיסוי YYYY-MM-DD'),
      F('agent', ['string', 'null'], 'סוכן הביטוח או מקור הפוליסה (למשל חברת כוח האדם)'),
      F('health_fund', ['string', 'null'], 'קופת חולים'),
      F('health_fund_number', ['string', 'null'], 'מספר חבר בקופת החולים'),
      F('is_active', 'boolean', 'האם הפוליסה בתוקף היום (מחושב, קריאה בלבד)'),
    ],
  },
};
const HR_TYPES = Object.keys(HR_ENTITIES);
const OTHER_TYPE = 'employee_documents';
const DOC_TYPES = [...HR_TYPES, OTHER_TYPE];
const TYPE_OF_CATEGORY = { payslip: 'payslips', contract: 'employment_contracts', medical_insurance: 'medical_insurance_policies', other: OTHER_TYPE };
const CATEGORY_LABELS = { payslip: 'תלוש שכר', contract: 'חוזה העסקה', medical_insurance: 'ביטוח רפואי', other: 'אחר' };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
// שדות שלא נכתבים מבחוץ (מחושבים / חתימה / מערכת)
const PROTECTED = ['id', 'farm_id', 'created_at', 'updated_at', 'sign', 'sign_status', 'signed_at', 'signer_name', 'signed_file_url', 'is_active', 'files', 'category', '_by', 'timesheet'];

function makeHrCore({ db, NOW, uuidv4, today: todayFn }) {
  const today = () => (todayFn ? todayFn() : NOW().slice(0, 10));
  const parse = (r) => { try { return { id: r.id, ...JSON.parse(r.data || '{}'), farm_id: r.farm_id, created_at: r.created_at, updated_at: r.updated_at }; } catch { return { id: r.id, farm_id: r.farm_id, created_at: r.created_at, updated_at: r.updated_at }; } };
  const rowOf = (type, id) => db.prepare('SELECT * FROM entities WHERE entity_type = ? AND id = ?').get(type, String(id));
  const employeesOf = (farmId) => db.prepare("SELECT * FROM entities WHERE entity_type = 'employees' AND farm_id = ?").all(farmId).map(parse);
  const nameOf = (e) => e.full_name || [e.first_name, e.last_name].filter(Boolean).join(' ');
  const normPassport = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

  function resolveEmployee(farmId, { employee_id, passport_number, employee_name }) {
    const all = employeesOf(farmId);
    if (employee_id) {
      const e = all.find(x => x.id === employee_id);
      if (!e) throw new Error(`Unknown employee_id: ${employee_id}`);
      return e;
    }
    if (passport_number) {
      const p = normPassport(passport_number);
      const e = p.length >= 5 && all.find(x => normPassport(x.passport_number) === p);
      if (e) return e;
    }
    if (employee_name) {
      const n = String(employee_name).trim().toLowerCase().replace(/\s+/g, ' ');
      const rev = n.split(' ').reverse().join(' ');
      const hits = all.filter(x => { const m = nameOf(x).trim().toLowerCase().replace(/\s+/g, ' '); return m === n || m === rev; });
      if (hits.length === 1) return hits[0];
      if (hits.length > 1) throw new Error(`Name "${employee_name}" matches several employees — pass employee_id`);
    }
    throw new Error('employee_id (or passport_number / employee_name of an existing employee) is required');
  }

  // קובץ מקומי (/uploads/<name>) — חייב להיות של המשק הזה
  const uploadName = (url) => { const m = String(url || '').match(/\/uploads\/([A-Za-z0-9._-]+)(?:[?#].*)?$/); return m ? m[1] : null; };
  function checkFileUrl(farmId, url, field) {
    if (url === undefined || url === null || url === '') return url ?? null;
    const s = String(url).trim();
    const name = uploadName(s);
    if (name) {
      const reg = db.prepare("SELECT farm_id FROM entities WHERE entity_type = 'uploads' AND id = ?").get(`up_${name}`);
      if (reg && reg.farm_id && reg.farm_id !== farmId) throw new Error(`${field}: file belongs to another farm`);
      return s;
    }
    if (!/^https?:\/\//i.test(s)) throw new Error(`${field} must be an http(s) URL`);
    return s;
  }
  const checkDate = (name, v) => {
    if (v === undefined || v === null || v === '') return null;
    const s = String(v).slice(0, 10);
    if (!ISO_DATE.test(s) || Number.isNaN(Date.parse(s))) throw new Error(`${name} must be YYYY-MM-DD`);
    return s;
  };
  const checkMoney = (name, v) => {
    if (v === undefined || v === null || v === '') return null;
    const n = Number(String(v).replace(/[,₪\s]/g, ''));
    if (!Number.isFinite(n) || n < 0) throw new Error(`${name} must be a non-negative number`);
    return Math.round(n * 100) / 100;
  };
  const str = (v, max = 200) => (v === undefined || v === null ? null : String(v).trim().slice(0, max) || null);

  // אימות + נרמול שדות לפי הסוג. merged = הרשומה הקיימת + השינויים (בעדכון)
  function normalize(farmId, type, merged) {
    if (!DOC_TYPES.includes(type)) throw new Error(`Unknown document entity: ${type}`);
    const d = { ...merged };
    for (const k of PROTECTED) if (k !== 'sign' && k !== 'category' && k !== 'timesheet') delete d[k];
    const emp = resolveEmployee(farmId, d);
    d.employee_id = emp.id;
    d.employee_name = nameOf(emp) || null;
    delete d.passport_number;
    d.file_url = checkFileUrl(farmId, d.file_url, 'file_url');
    d.title = str(d.title, 120);
    d.notes = str(d.notes, 2000);

    if (type === 'payslips') {
      let period = d.period ? String(d.period).trim() : null;
      if (!period && d.year && d.month) period = `${parseInt(d.year, 10)}-${String(parseInt(d.month, 10)).padStart(2, '0')}`;
      if (!period || !PERIOD.test(period)) throw new Error('period is required as YYYY-MM (or year + month)');
      d.period = period;
      d.year = parseInt(period.slice(0, 4), 10);
      d.month = parseInt(period.slice(5, 7), 10);
      d.period_start = `${period}-01`;
      d.employer = str(d.employer, 120);
      d.gross = checkMoney('gross', d.gross);
      d.net = checkMoney('net', d.net);
      d.net_to_pay = checkMoney('net_to_pay', d.net_to_pay);
      d.title = d.title || `תלוש שכר ${period.slice(5, 7)}/${period.slice(0, 4)}`;
    } else if (type === 'employment_contracts') {
      d.contract_type = d.contract_type ? String(d.contract_type).trim() : 'other';
      if (!CONTRACT_TYPES[d.contract_type]) throw new Error(`contract_type must be one of: ${Object.keys(CONTRACT_TYPES).join(', ')}`);
      d.signed_date = checkDate('signed_date', d.signed_date);
      d.start_date = checkDate('start_date', d.start_date);
      d.end_date = checkDate('end_date', d.end_date);
      if (d.start_date && d.end_date && d.end_date < d.start_date) throw new Error('end_date is before start_date');
      d.employer = str(d.employer, 120);
      d.title = d.title || `חוזה העסקה — ${CONTRACT_TYPES[d.contract_type]}`;
    } else if (type === 'medical_insurance_policies') {
      d.insurance_company = str(d.insurance_company ?? d.company, 120);
      delete d.company;
      if (!d.insurance_company) throw new Error('insurance_company is required');
      d.policy_number = str(d.policy_number, 60);
      d.start_date = checkDate('start_date', d.start_date);
      d.end_date = checkDate('end_date', d.end_date);
      if (d.start_date && d.end_date && d.end_date < d.start_date) throw new Error('end_date is before start_date');
      d.agent = str(d.agent ?? d.source_agent, 120);
      d.health_fund = str(d.health_fund, 60);
      d.health_fund_number = str(d.health_fund_number, 40);
      d.title = d.title || `ביטוח רפואי — ${d.insurance_company}${d.policy_number ? ` ${d.policy_number}` : ''}`;
    } else {
      d.title = d.title || CATEGORY_LABELS.other;
    }
    d.category = type === OTHER_TYPE ? 'other' : HR_ENTITIES[type].category;
    if (!d.sign) d.sign = { status: 'none' };
    return d;
  }

  const isActivePolicy = (p, day = today()) => (!p.start_date || p.start_date <= day) && (!p.end_date || p.end_date >= day);

  // רשומה החוצה (REST/MCP): בלי hash של טוקן החתימה, עם סטטוס חתימה ושדות מחושבים
  function view(type, rec) {
    if (!rec) return null;
    const { sign, ...rest } = rec;
    const s = sign || {};
    const expired = s.status === 'pending' && s.expires_at && s.expires_at < NOW();
    const out = {
      ...rest,
      entity: type,
      sign_status: expired ? 'expired' : (s.status || 'none'),
      sign_requested_at: s.requested_at || null,
      sign_expires_at: s.expires_at || null,
      signed_at: s.signed_at || null,
      signer_name: s.signer_name || null,
      signed_file_url: s.signed_file_url || null,
      sent_at: s.sent_at || null,
      sent_via: s.sent_via || null,
    };
    if (type === 'medical_insurance_policies') out.is_active = isActivePolicy(rec);
    return out;
  }

  function get(farmId, type, id) {
    const r = rowOf(type, id);
    if (!r || r.farm_id !== farmId) return null;
    return parse(r);
  }

  function list(farmId, type, opts = {}) {
    if (!DOC_TYPES.includes(type)) throw new Error(`Unknown document entity: ${type}`);
    let rows = db.prepare('SELECT * FROM entities WHERE entity_type = ? AND farm_id = ?').all(type, farmId).map(parse);
    const filters = { ...(opts.filters || {}) };
    if (opts.employee_id) filters.employee_id = opts.employee_id;
    for (const [k, v] of Object.entries(filters)) {
      if (!/^[A-Za-z0-9_]+$/.test(k)) throw new Error(`Bad filter field: ${k}`);
      if (['farm_id', 'sort', 'limit', 'offset'].includes(k) || v === null || v === undefined) continue;
      rows = rows.filter(x => String(k === 'sign_status' ? view(type, x).sign_status : x[k]) === String(v));
    }
    if (opts.date_from || opts.date_to) {
      const field = opts.date_field || (HR_ENTITIES[type]?.dateField) || 'created_at';
      const from = opts.date_from ? String(opts.date_from) : null;
      const to = opts.date_to ? String(opts.date_to) + '￿' : null;
      rows = rows.filter(x => {
        let v = x[field];
        if (!v && field === 'period_start' && x.period) v = `${x.period}-01`;
        if (!v) return false;
        const s = String(v);
        return (!from || s >= from) && (!to || s <= to);
      });
    }
    if (opts.search) {
      const needle = String(opts.search).toLowerCase();
      rows = rows.filter(x => JSON.stringify(x).toLowerCase().includes(needle));
    }
    const sort = opts.sort || (HR_ENTITIES[type] ? `-${HR_ENTITIES[type].dateField}` : '-created_at');
    const desc = sort.startsWith('-'); const sf = sort.replace(/^-/, '');
    rows.sort((a, b) => { const A = a[sf] ?? '', B = b[sf] ?? ''; const c = A < B ? -1 : A > B ? 1 : 0; return desc ? -c : c; });
    return rows;
  }

  function insert(farmId, type, data, id) {
    const rid = id || uuidv4(); const now = NOW();
    db.prepare('INSERT INTO entities (id, entity_type, farm_id, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(rid, type, farmId, JSON.stringify(data), now, now);
    return rid;
  }
  function writeData(type, id, data) {
    db.prepare('UPDATE entities SET data = ?, updated_at = ? WHERE entity_type = ? AND id = ?').run(JSON.stringify(data), NOW(), type, id);
  }

  function create(farmId, type, input, by) {
    const d = normalize(farmId, type, { ...input, sign: undefined, timesheet: undefined });
    d.sign = { status: 'none' };
    d.source = str(input.source, 40) || 'manual';
    if (by) d._by = by;
    const id = insert(farmId, type, d);
    if (type === 'medical_insurance_policies') syncInsurance(farmId, d.employee_id);
    return get(farmId, type, id);
  }

  function update(farmId, type, id, patch, by) {
    const cur = get(farmId, type, id);
    if (!cur) throw new Error(`Not found: ${type}/${id}`);
    const clean = { ...patch };
    for (const k of PROTECTED) delete clean[k];
    if (cur.sign?.status === 'signed' && ('file_url' in clean)) throw new Error('A signed document\'s file cannot be replaced');
    const { id: _i, farm_id: _f, created_at: _c, updated_at: _u, ...stored } = cur;
    const d = normalize(farmId, type, { ...stored, ...clean });
    d.sign = cur.sign || { status: 'none' };
    if (cur.timesheet) d.timesheet = cur.timesheet; else delete d.timesheet;
    if (by) d._by = by;
    writeData(type, id, d);
    if (type === 'medical_insurance_policies') {
      syncInsurance(farmId, d.employee_id);
      if (cur.employee_id !== d.employee_id) syncInsurance(farmId, cur.employee_id);
    }
    return get(farmId, type, id);
  }

  function remove(farmId, type, id) {
    const cur = get(farmId, type, id);
    if (!cur) return false;
    db.prepare('DELETE FROM entities WHERE entity_type = ? AND id = ?').run(type, id);
    if (type === 'medical_insurance_policies') syncInsurance(farmId, cur.employee_id);
    return true;
  }

  // הפוליסה הפעילה (בתוקף היום; כמה — האחרונה שהתחילה) → employees.insurance_details.
  // אין פוליסה פעילה → השדה נשאר כמו שהוא (לא מוחקים מידע שהוזן בכרטיס).
  function syncInsurance(farmId, employeeId) {
    if (!employeeId) return null;
    const er = rowOf('employees', employeeId);
    if (!er || er.farm_id !== farmId) return null;
    const active = list(farmId, 'medical_insurance_policies', { employee_id: employeeId })
      .filter(p => isActivePolicy(p))
      .sort((a, b) => String(b.start_date || '').localeCompare(String(a.start_date || '')) || String(b.created_at).localeCompare(String(a.created_at)))[0];
    if (!active) return null;
    let emp; try { emp = JSON.parse(er.data || '{}'); } catch { return null; }
    const cur = emp.insurance_details && typeof emp.insurance_details === 'object' ? emp.insurance_details : {};
    const next = {
      ...cur,
      company: active.insurance_company || '',
      policy_number: active.policy_number || '',
      policy_start_date: active.start_date || '',
      policy_end_date: active.end_date || '',
      ...(active.file_url ? { policy_url: active.file_url } : {}),
      ...(active.health_fund ? { health_fund: active.health_fund } : {}),
      ...(active.health_fund_number ? { health_fund_number: active.health_fund_number } : {}),
      policy_record_id: active.id,
    };
    if (JSON.stringify(next) === JSON.stringify(cur)) return active.id;
    emp.insurance_details = next;
    db.prepare("UPDATE entities SET data = ?, updated_at = ? WHERE entity_type = 'employees' AND id = ?").run(JSON.stringify(emp), NOW(), employeeId);
    return active.id;
  }

  // הגירה חד-פעמית (אידמפוטנטית, רצה בכל עלייה):
  //  1. employee_documents עם category payslip/contract/medical_insurance → הישות הייעודית (אותו id)
  //  2. employees.insurance_details קיים (חברה/פוליסה) בלי שום פוליסה לעובד → רשומת פוליסה ראשונה
  function migrate() {
    const moved = { payslips: 0, employment_contracts: 0, medical_insurance_policies: 0, backfilled_policies: 0 };
    const rows = db.prepare(`SELECT * FROM entities WHERE entity_type = ? AND json_extract(data, '$.category') IN ('payslip','contract','medical_insurance')`).all(OTHER_TYPE);
    for (const r of rows) {
      let d; try { d = JSON.parse(r.data || '{}'); } catch { continue; }
      const type = TYPE_OF_CATEGORY[d.category];
      if (rowOf(type, r.id)) { db.prepare('DELETE FROM entities WHERE entity_type = ? AND id = ?').run(OTHER_TYPE, r.id); continue; }
      if (type === 'payslips' && d.period && PERIOD.test(d.period)) Object.assign(d, { year: +d.period.slice(0, 4), month: +d.period.slice(5, 7), period_start: `${d.period}-01` });
      if (type === 'employment_contracts') d.contract_type = d.contract_type || 'other';
      if (type === 'medical_insurance_policies') d.insurance_company = d.insurance_company || null;
      db.prepare('INSERT INTO entities (id, entity_type, farm_id, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(r.id, type, r.farm_id, JSON.stringify(d), r.created_at, r.updated_at);
      db.prepare('DELETE FROM entities WHERE entity_type = ? AND id = ?').run(OTHER_TYPE, r.id);
      moved[type]++;
    }
    const withPolicy = new Set(db.prepare("SELECT json_extract(data, '$.employee_id') AS e FROM entities WHERE entity_type = 'medical_insurance_policies'").all().map(x => x.e));
    for (const r of db.prepare("SELECT * FROM entities WHERE entity_type = 'employees' AND farm_id IS NOT NULL").all()) {
      if (withPolicy.has(r.id)) continue;
      let e; try { e = JSON.parse(r.data || '{}'); } catch { continue; }
      const ins = e.insurance_details || {};
      if (!String(ins.company || '').trim() && !String(ins.policy_number || '').trim()) continue;
      const okDate = (v) => (ISO_DATE.test(String(v || '').slice(0, 10)) ? String(v).slice(0, 10) : null);
      insert(r.farm_id, 'medical_insurance_policies', {
        employee_id: r.id, employee_name: nameOf(e) || null, category: 'medical_insurance',
        insurance_company: String(ins.company || '').trim() || 'לא צוין', policy_number: String(ins.policy_number || '').trim() || null,
        start_date: okDate(ins.policy_start_date), end_date: okDate(ins.policy_end_date), agent: null,
        health_fund: String(ins.health_fund || '').trim() || null, health_fund_number: String(ins.health_fund_number || '').trim() || null,
        file_url: ins.policy_url || null, title: `ביטוח רפואי — ${String(ins.company || '').trim() || 'לא צוין'}`,
        source: 'employee_card', notes: 'נוצר אוטומטית מפרטי הביטוח שבכרטיס העובד', sign: { status: 'none' },
      }, `mip_${r.id}`);
      moved.backfilled_policies++;
    }
    return moved;
  }

  // קבצי הרשומה (מקור + עותק חתום) — לקישורי הורדה
  function filesOf(rec) {
    const out = [];
    if (rec.file_url) out.push({ kind: 'original', file_url: rec.file_url, file_name: rec.file_name || null });
    if (rec.timesheet?.file_url) out.push({ kind: 'timesheet', file_url: rec.timesheet.file_url, file_name: rec.timesheet.file_name || 'timesheet.pdf' });
    if (rec.sign?.signed_file_url) out.push({ kind: 'signed', file_url: rec.sign.signed_file_url, file_name: `${rec.title || 'document'} - signed.pdf` });
    return out;
  }

  return { HR_ENTITIES, HR_TYPES, DOC_TYPES, OTHER_TYPE, TYPE_OF_CATEGORY, resolveEmployee, normalize, view, get, list, create, update, remove, syncInsurance, migrate, filesOf, isActivePolicy, uploadName };
}

// קישור הורדה חתום (HMAC, תוקף קצר) — לסוכן שלא יכול לשלוח כותרת Authorization
function signFileLink(secret, { farmId, type, id, kind, exp }) {
  return crypto.createHmac('sha256', secret).update(`${farmId}|${type}|${id}|${kind}|${exp}`).digest('base64url');
}
function verifyFileLink(secret, { farmId, type, id, kind, exp, sig }) {
  if (!sig || !exp || Number(exp) < Math.floor(Date.now() / 1000)) return false;
  const want = signFileLink(secret, { farmId, type, id, kind, exp });
  const a = Buffer.from(String(sig)), b = Buffer.from(want);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { makeHrCore, HR_ENTITIES, HR_TYPES, DOC_TYPES, OTHER_TYPE, TYPE_OF_CATEGORY, CATEGORY_LABELS, CONTRACT_TYPES, COMMON_FIELDS, signFileLink, verifyFileLink };
