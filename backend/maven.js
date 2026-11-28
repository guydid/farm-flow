// ─── Invoice Maven integration ────────────────────────────────────────────────
// אינטגרציה עם Invoice Maven (app.invoice-maven.co.il) לכל משק בנפרד:
//   • הגדרות: מפתח API (מוצפן), פרטי קשר של המפתח (חובה ב-API שלהם), מצב בדיקה.
//   • משיכת לקוחות וספקים מ-Maven לרשומות המשק (התאמה לפי maven_id / ח.פ / שם).
//   • סנכרון מוצרים ל-Maven כפריטים עם מק"ט משותף (FF-xxxxxxxx) — "קודים משותפים".
//   • הפקת תעודת משלוח / חשבונית / חשבונית מס-קבלה מתוך תעודת שקילה.
//   • העלאת חשבוניות ספק (מסך חשבוניות) כהוצאה ב-Maven (addExpense: נוצרת טיוטה, Maven קורא את המסמך).
// ה-API של Maven: כל הקריאות POST+JSON, api_key בכותרת, test=1 לא שומר כלום.
const { Readable } = require('stream');
const path = require('path');
const fs = require('fs');
const MAVEN_HOST = 'app.invoice-maven.co.il';
const DOC_TYPES = { 200: 'תעודת משלוח', 305: 'חשבונית מס', 320: 'חשבונית מס/קבלה', 10: 'הצעת מחיר', 100: 'הזמנה' };
const ALLOWED_DOC_TYPES = new Set([200, 305, 320, 10, 100]);
// מסמכים שאפשר להפיק מתעודת משלוח יוצאת של מודול הרכש
const NOTE_DOC_TYPES = new Set([200, 305, 320]);

// ── helpers (ברמת המודול, כדי שגם בוני המסמכים הטהורים ישתמשו בהם) ──
const normName = (s) => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();
const ddmmyyyy = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) { const d = new Date(); return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`; }
  return `${m[3]}/${m[2]}/${m[1]}`;
};
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// ── הוצאה ב-Maven מתוך חשבונית ספק ──
// סוגי קבצים ש-addExpense מקבל כמו שהם; כל השאר (heic, webp…) מומר ל-PDF לפני ההעלאה.
const EXPENSE_EXTS = new Set(['.pdf', '.jpg', '.jpeg', '.png', '.gif', '.tif', '.bmp']);
const EXPENSE_MAX_BYTES = 10 * 1024 * 1024;
const EXPENSE_ERRORS = {
  107: 'הקובץ גדול מ-10 מגה, Maven לא מקבל אותו',
  108: 'סוג הקובץ אינו נתמך ב-Maven (PDF או תמונה בלבד)',
  109: 'הגעתם למכסת ההעלאות היומית של Maven. נסו שוב מחר',
};
// פונקציה טהורה: שם הקובץ והתיאור שיופיעו במסך ההוצאות של Maven
function buildExpenseUpload(inv, ext) {
  const supplier = String(inv.supplier_name || '').trim();
  const nameParts = [supplier || 'חשבונית', inv.invoice_number ? String(inv.invoice_number) : null, inv.date ? String(inv.date).slice(0, 10) : null].filter(Boolean);
  const base = nameParts.join('_').replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, '_').replace(/^_+|_+$/g, '').slice(0, 120) || 'invoice';
  const total = Number(inv.total);
  const hasTotal = inv.total !== null && inv.total !== undefined && inv.total !== '' && Number.isFinite(total);
  const desc = [
    supplier || null,
    inv.invoice_number ? `מס' ${inv.invoice_number}` : null,
    inv.date ? ddmmyyyy(inv.date) : null,
    hasTotal ? `${round2(total)} ${inv.currency && inv.currency !== 'ILS' ? inv.currency : '₪'}` : null,
    inv.notes ? String(inv.notes).trim() : null,
  ].filter(Boolean).join(' · ');
  return { filename: `${base}${ext}`, description: (desc ? `${desc} · מ-FarmFlow` : 'מ-FarmFlow').slice(0, 1000) };
}

// ── מסמך ב-Maven מתוך תעודת משלוח יוצאת (מודול הרכש) ──
// פונקציה טהורה (בלי DB) כדי שאפשר לבדוק אותה: note + items כפי שהם ב-procurement,
// customer / products של המשק. Maven הוא מערכת הפקה ללקוחות — תעודה נכנסת מספק אין לאן לשלוח.
function buildNoteDocument(cfg, { note, items, customer, products = [] }, opts = {}) {
  const docType = Number(opts.doc_type) || 200;
  const lines = items.map(it => {
    const product = (it.product_id && products.find(p => p.id === it.product_id))
      || products.find(p => p.name && normName(p.name) === normName(it.product_name)) || null;
    const unit = String(it.unit || '').trim();
    const desc = [it.product_name || product?.name || 'פריט', unit && unit !== "יח'" ? `(${unit})` : null, it.notes ? String(it.notes).trim() : null].filter(Boolean).join(' ');
    const qty = Number(it.quantity);
    const line = { description: desc.slice(0, 250), price: round2(it.unit_price), quantity: qty > 0 ? qty : 1 };
    if (product?.maven_item_no) line.item_number = product.maven_item_no;
    if (product?.vat_exempt || opts.no_vat) line.no_vat = true;
    return line;
  });
  const body = {
    doc_type: docType,
    customer: {
      name: (customer?.name || note.counterparty_name || 'לקוח').trim(),
      ...(customer?.identification ? { identification: String(customer.identification) } : {}),
      ...(customer?.email ? { email: customer.email } : {}),
      ...(customer?.phone ? { cell_phone: customer.phone } : {}),
      ...(customer?.address ? { address: customer.address } : {}),
    },
    items: lines,
    // Maven דורש רצף כרונולוגי לכל סוג מסמך → תאריך המסמך = היום; תאריך האספקה בתיאור
    document_date: ddmmyyyy(opts.document_date || new Date().toISOString().slice(0, 10)),
    description: [`תעודת משלוח ${note.note_number} מתאריך ${ddmmyyyy(note.delivery_date)}`, note.order_number ? `הזמנה ${note.order_number}` : null].filter(Boolean).join(' · '),
    vat_included: opts.vat_included !== undefined ? !!opts.vat_included : !!cfg.vat_included,
    ...(opts.no_vat ? { no_vat: true } : {}),
    send_to_customer: !!opts.send_to_customer,
    doc_id: `ff-dn-${note.id}-${docType}${opts.force ? '-' + Date.now() : ''}`,
  };
  const remarks = [
    opts.remarks ? String(opts.remarks).slice(0, 1000) : null,
    note.vehicle ? `רכב ${note.vehicle}` : null,
    note.driver_name ? `נהג ${note.driver_name}` : null,
    note.received_by ? `נמסר ע"י ${note.received_by}` : null,
  ].filter(Boolean).join(' · ');
  if (remarks) body.remarks = remarks;
  return body;
}

// ── כפילויות: לקוחות / ספקים / מוצרים ──
// מזהים לכל סוג: maven = המזהה ב-Maven, ids = מזהים חזקים נוספים (ח.פ / מק"ט), name = שם מנורמל.
// שתי רשומות מאוחדות כשהן חולקות אחד מהם — אלא אם בקבוצה יהיו שני ערכי Maven שונים או שני ח.פ/מק"ט שונים.
const digitsOnly = (v) => String(v || '').replace(/\D/g, '');
const DEDUPE_KINDS = {
  customers: { entity: 'customers', refs: ['customer_id'], maven: r => r.maven_id || '', strong: r => digitsOnly(r.identification) },
  suppliers: { entity: 'suppliers', refs: ['supplier_id', 'source_supplier_id'], maven: r => r.maven_id || '', strong: r => digitsOnly(r.vat_id) },
  products: { entity: 'products', refs: ['product_id'], arrayRefs: ['product_ids'], keyRefs: ['product_weights'], maven: r => r.maven_item_id || '', strong: r => String(r.maven_item_no || '').trim().toUpperCase() },
};

// rows: הרשומות מסוג אחד; refCount(id) → מספר ההפניות (לבחירת הרשומה שנשמרת)
function findDuplicateGroups(kind, rows, refCount = () => 0) {
  const K = DEDUPE_KINDS[kind];
  if (!K) throw new Error('unknown kind');
  const list = rows.filter(r => r && r.id);
  const parent = new Map(list.map(r => [r.id, r.id]));
  const meta = new Map(list.map(r => [r.id, { maven: new Set(K.maven(r) ? [K.maven(r)] : []), strong: new Set(K.strong(r) ? [K.strong(r)] : []) }]));
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const conflict = (a, b) => (a.size && b.size && ![...a].some(v => b.has(v)));
  const union = (a, b) => {
    const ra = find(a), rb = find(b);
    if (ra === rb) return;
    const ma = meta.get(ra), mb = meta.get(rb);
    if (conflict(ma.maven, mb.maven) || conflict(ma.strong, mb.strong)) return;
    parent.set(rb, ra);
    mb.maven.forEach(v => ma.maven.add(v)); mb.strong.forEach(v => ma.strong.add(v));
  };
  // קודם התאמות חזקות (Maven, ח.פ / מק"ט), אחר כך לפי שם
  for (const keyFn of [K.maven, K.strong, r => normName(r.name)]) {
    const seen = new Map();
    for (const r of list) {
      const k = keyFn(r);
      if (!k) continue;
      if (seen.has(k)) union(seen.get(k), r.id); else seen.set(k, r.id);
    }
  }
  const groups = new Map();
  for (const r of list) {
    const root = find(r.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(r);
  }
  return [...groups.values()].filter(g => g.length > 1).map(g => {
    const sorted = [...g].sort((a, b) =>
      (K.maven(b) ? 1 : 0) - (K.maven(a) ? 1 : 0)
      || refCount(b.id) - refCount(a.id)
      || String(a.created_at || '').localeCompare(String(b.created_at || '')));
    return { keep: sorted[0], merge: sorted.slice(1) };
  });
}

// איחוד שדות: הרשומה שנשמרת מקבלת שדות ריקים מהכפילויות; אימיילים מתאחדים; חקלאי = אם אחד מהם
function mergeRecordData(keep, dups) {
  const out = { ...keep };
  for (const d of dups) {
    for (const [k, v] of Object.entries(d)) {
      if (['id', 'created_at', 'updated_at', 'farm_id', '_by'].includes(k)) continue;
      const cur = out[k];
      if (Array.isArray(cur) && Array.isArray(v)) {
        const seen = new Set(cur.map(x => typeof x === 'string' ? x.toLowerCase() : JSON.stringify(x)));
        out[k] = [...cur, ...v.filter(x => !seen.has(typeof x === 'string' ? x.toLowerCase() : JSON.stringify(x)))];
      } else if (k === 'is_farmer') out[k] = !!cur || !!v;
      else if ((cur === undefined || cur === null || cur === '') && v !== undefined && v !== null && v !== '') out[k] = v;
    }
  }
  if (typeof out.name === 'string') out.name = out.name.trim().replace(/\s+/g, ' ');
  return out;
}

// מעבר על כל הרשומות של המשק והחלפת הפניות לכפילויות במזהה שנשמר. מחזיר את הרשומות שהשתנו.
function remapReferences(kind, rows, idMap) {
  const K = DEDUPE_KINDS[kind];
  const changed = [];
  for (const row of rows) {
    let touched = false;
    const d = { ...row.data };
    for (const f of K.refs) if (d[f] && idMap.has(d[f])) { d[f] = idMap.get(d[f]); touched = true; }
    for (const f of K.arrayRefs || []) if (Array.isArray(d[f]) && d[f].some(x => idMap.has(x))) { d[f] = [...new Set(d[f].map(x => idMap.get(x) || x))]; touched = true; }
    for (const f of K.keyRefs || []) {
      if (d[f] && typeof d[f] === 'object' && !Array.isArray(d[f]) && Object.keys(d[f]).some(x => idMap.has(x))) {
        const o = {};
        for (const [k, v] of Object.entries(d[f])) { const nk = idMap.get(k) || k; if (!(nk in o) || nk === k) o[nk] = v; }
        d[f] = o; touched = true;
      }
    }
    if (touched) changed.push({ id: row.id, data: d });
  }
  return changed;
}

// ── ייבוא פריטים מ-Maven ──
// אין ב-API חיפוש פריטים, אבל שורות המסמכים כוללות את ה-GUID של הפריט בקטלוג ואת המק"ט (item_nubmer — כך במקור).
// השורות של FarmFlow נראות כמו "תות שדה · איכות א · לפי ק"ג" — השם הוא החלק הראשון. אריזה/משטח מסומנים כציוד.
function collectCatalogItems(documents) {
  const byKey = new Map();
  for (const doc of documents || []) {
    for (const line of doc?.items || []) {
      const id = line?.id ? String(line.id) : '';
      const itemNo = String(line?.item_nubmer || line?.item_number || '').trim();
      if (!id && !itemNo) continue;
      const desc = String(line.description || '').trim();
      const parts = desc.split(' · ').map(s => s.trim()).filter(Boolean);
      const equipment = parts.length > 1 && (parts[0] === 'אריזה' || parts[0] === 'משטח') ? parts[0] : null;
      const name = (equipment ? parts[1] : parts[0]) || desc || itemNo;
      const key = id || `no:${itemNo}`;
      const prev = byKey.get(key);
      // המסמכים ממוינים לפי סדר ההפקה — האחרון קובע מחיר
      byKey.set(key, {
        maven_item_id: id || prev?.maven_item_id || '',
        maven_item_no: itemNo || prev?.maven_item_no || '',
        name: prev?.name || name,
        equipment,
        price: Number(line.price) > 0 ? round2(line.price) : (prev?.price || 0),
        no_vat: !!line.no_vat,
        uses: (prev?.uses || 0) + 1,
      });
    }
  }
  return [...byKey.values()];
}

// Config + API call, shared with other modules (leases invoicing)
function makeMavenCore(deps) {
  const { db, encryptSecret, decryptSecret, httpsRequest, NOW, uuidv4 } = deps;
  // ── config storage (internal entity maven_config, one per farm) ──
  function loadConfig(farmId) {
    const row = db.prepare("SELECT data FROM entities WHERE entity_type = 'maven_config' AND farm_id = ?").get(farmId);
    if (!row) return { enabled: false, api_key_enc: null, contact_email: '', contact_phone: '', test_mode: true, vat_included: false, last_sync: {} };
    try { return { test_mode: true, vat_included: false, last_sync: {}, ...JSON.parse(row.data) }; } catch { return { enabled: false, last_sync: {} }; }
  }
  function saveConfig(farmId, cfg) {
    const now = NOW();
    const existing = db.prepare("SELECT id FROM entities WHERE entity_type = 'maven_config' AND farm_id = ?").get(farmId);
    if (existing) db.prepare("UPDATE entities SET data = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(cfg), now, existing.id);
    else db.prepare("INSERT INTO entities (id, entity_type, farm_id, data, created_at, updated_at) VALUES (?, 'maven_config', ?, ?, ?, ?)").run(uuidv4(), farmId, JSON.stringify(cfg), now, now);
  }
  function publicConfig(cfg) {
    const key = cfg.api_key_enc ? decryptSecret(cfg.api_key_enc) : null;
    return {
      enabled: !!cfg.enabled && !!key,
      configured: !!key,
      api_key_last4: key ? key.slice(-4) : null,
      contact_email: cfg.contact_email || '',
      contact_phone: cfg.contact_phone || '',
      test_mode: cfg.test_mode !== false,
      vat_included: !!cfg.vat_included,
      last_sync: cfg.last_sync || {},
      auto_sync: cfg.auto_sync !== false,
      auto_sync_at: cfg.auto_sync_at || null,
    };
  }

  // ── Maven API call ──
  async function mavenCall(cfg, path, body, { requireKey = true } = {}) {
    const key = cfg.api_key_enc ? decryptSecret(cfg.api_key_enc) : null;
    if (requireKey && !key) { const e = new Error('לא הוגדר מפתח API של Maven'); e.code = 'not_configured'; throw e; }
    // המפתח גם בגוף: חלק מה-endpoints (addDocument) מתעלמים מהכותרת ודורשים אותו ב-JSON
    const payload = JSON.stringify({
      api_key: key,
      test: cfg.test_mode !== false ? 1 : 0,
      contact_email: cfg.contact_email || 'support@farm-flow.local',
      contact_phone: cfg.contact_phone || '000',
      ...body,
    });
    const buf = Buffer.from(payload, 'utf8');
    const res = await httpsRequest({
      hostname: MAVEN_HOST, path, method: 'POST', timeoutMs: 45000,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': buf.length, 'api_key': key, 'Accept': 'application/json' },
    }, buf);
    let data;
    try { data = JSON.parse(res.body); } catch { const e = new Error(`Maven החזיר תשובה לא תקינה (HTTP ${res.status})`); e.code = 'bad_response'; throw e; }
    if (String(data.status_code) !== '0') {
      const e = new Error(data.status_description || `Maven error ${data.status_code}`);
      e.code = String(data.status_code);
      e.data = data;
      if (e.code === '63') e.message = 'המנוי ב-Invoice Maven אינו פעיל (קוד 63)';
      if (e.code === '27') e.message = 'Maven מאפשר חיפוש אחד בדקה — נסה שוב בעוד דקה (קוד 27)';
      throw e;
    }
    return data;
  }

  return { loadConfig, saveConfig, publicConfig, mavenCall };
}

function registerMavenRoutes(app, deps) {
  const { db, getUser, authMiddleware, getFarmMember, encryptSecret, decryptSecret, httpsRequest, NOW, uuidv4, UPLOADS_DIR, invoiceFileToPdf } = deps;

  const canManage = (user, farmId) => {
    if (!user) return false;
    if (user.is_admin) return true;
    const m = getFarmMember(farmId, user.id);
    return !!(m && ['owner', 'manager'].includes(m.role));
  };
  const canWrite = (user, farmId) => {
    if (!user) return false;
    if (user.is_admin) return true;
    const m = getFarmMember(farmId, user.id);
    return !!(m && ['owner', 'manager', 'worker'].includes(m.role));
  };
  const farmOf = (req, res, { manage = false, write = false } = {}) => {
    const user = getUser(req.user.id);
    const farmId = req.query.farm_id || req.body?.farm_id || user?.current_farm_id;
    if (!user || !farmId) { res.status(400).json({ error: 'No farm selected' }); return null; }
    if (!user.is_admin && !user.farm_ids.includes(farmId)) { res.status(403).json({ error: 'Forbidden' }); return null; }
    if (manage && !canManage(user, farmId)) { res.status(403).json({ error: 'בעלים / מנהל משק בלבד' }); return null; }
    if (write && !canWrite(user, farmId)) { res.status(403).json({ error: 'אין הרשאת כתיבה במשק' }); return null; }
    return { user, farmId };
  };

  const { loadConfig, saveConfig, publicConfig, mavenCall } = makeMavenCore(deps);

  // ── helpers ──
  const rowsOf = (type, farmId) => db.prepare('SELECT id, data FROM entities WHERE entity_type = ? AND farm_id = ?').all(type, farmId)
    .map(r => { try { return { id: r.id, ...JSON.parse(r.data) }; } catch { return { id: r.id }; } });
  const updateRow = (id, patch) => {
    const row = db.prepare('SELECT data FROM entities WHERE id = ?').get(id);
    if (!row) return;
    let data = {}; try { data = JSON.parse(row.data); } catch { /* ignore */ }
    db.prepare('UPDATE entities SET data = ?, updated_at = ? WHERE id = ?').run(JSON.stringify({ ...data, ...patch }), NOW(), id);
  };
  const insertRow = (type, farmId, data) => {
    const id = uuidv4(); const now = NOW();
    db.prepare('INSERT INTO entities (id, entity_type, farm_id, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, type, farmId, JSON.stringify(data), now, now);
    return id;
  };

  async function fetchAll(cfg, path, listKey) {
    const out = [];
    for (let page = 1; page <= 50; page++) {
      const res = await mavenCall(cfg, path, { page, page_size: 100, sort_by: 'customer_id', sort_dir: 'asc' });
      const list = res[listKey] || res.customers || res.suppliers || [];
      out.push(...list);
      if (!res.pages || page >= Number(res.pages) || list.length === 0) break;
    }
    return out;
  }

  // ── sync: customers ──
  async function syncCustomers(cfg, farmId, by) {
    const remote = await fetchAll(cfg, '/api/customers/searchCustomers', 'customers');
    const local = rowsOf('customers', farmId);
    let linked = 0, created = 0, updated = 0;
    for (const c of remote) {
      if (!c || !c.name) continue;
      const match = local.find(l => l.maven_id && l.maven_id === c.id)
        || (c.identification && local.find(l => l.identification && String(l.identification) === String(c.identification)))
        || local.find(l => normName(l.name) === normName(c.name));
      const phone = c.cell_phone || c.phone_number || '';
      const address = [c.address, c.city].filter(Boolean).join(', ');
      if (match) {
        const patch = {};
        if (match.maven_id !== c.id) { patch.maven_id = c.id; linked++; }
        if (!match.identification && c.identification) patch.identification = c.identification;
        if (!match.phone && phone) patch.phone = phone;
        if (!match.email && c.email) patch.email = c.email;
        if (!match.address && address) patch.address = address;
        if (Object.keys(patch).length) { updateRow(match.id, patch); Object.assign(match, patch); if (!patch.maven_id) updated++; }
      } else {
        const data = { name: String(c.name).trim(), contact_person: '', phone, email: c.email || '', address, identification: c.identification || '', maven_id: c.id, _by: by };
        local.push({ id: insertRow('customers', farmId, data), ...data }); created++;
      }
    }
    return { remote: remote.length, linked, created, updated };
  }

  // ── sync: suppliers ──
  async function syncSuppliers(cfg, farmId, by) {
    const remote = await fetchAll(cfg, '/api/suppliers/searchSuppliers', 'suppliers');
    const local = rowsOf('suppliers', farmId);
    let linked = 0, created = 0, updated = 0;
    for (const s of remote) {
      if (!s || !s.name) continue;
      const match = local.find(l => l.maven_id && l.maven_id === s.id)
        || (s.identification && local.find(l => l.vat_id && String(l.vat_id) === String(s.identification)))
        || local.find(l => normName(l.name) === normName(s.name));
      const phone = s.cell_phone || s.phone_number || '';
      const address = [s.address, s.city].filter(Boolean).join(', ');
      if (match) {
        const patch = {};
        if (match.maven_id !== s.id) { patch.maven_id = s.id; linked++; }
        if (!match.vat_id && s.identification) patch.vat_id = s.identification;
        if (!match.phone && phone) patch.phone = phone;
        if (!match.address && address) patch.address = address;
        const emails = Array.isArray(match.email_addresses) ? match.email_addresses : [];
        const remoteEmails = [s.email, ...(Array.isArray(s.emails) ? s.emails : [])].filter(Boolean).map(e => String(e).toLowerCase());
        const addEmails = remoteEmails.filter(e => !emails.map(x => String(x).toLowerCase()).includes(e));
        if (addEmails.length) patch.email_addresses = [...emails, ...addEmails];
        if (Object.keys(patch).length) { updateRow(match.id, patch); Object.assign(match, patch); if (!patch.maven_id) updated++; }
      } else {
        const data = { name: String(s.name).trim(), vat_id: s.identification || '', phone, address, email_addresses: [s.email, ...(Array.isArray(s.emails) ? s.emails : [])].filter(Boolean), notes: '', maven_id: s.id, _by: by };
        local.push({ id: insertRow('suppliers', farmId, data), ...data }); created++;
      }
    }
    return { remote: remote.length, linked, created, updated };
  }

  // ── sync: items (push farm products to Maven with a shared item code) ──
  const itemCodeFor = (p) => p.maven_item_no || `FF-${String(p.id).slice(0, 8).toUpperCase()}`;
  async function syncItems(cfg, farmId) {
    const products = rowsOf('products', farmId);
    let pushed = 0; const errors = [];
    for (const p of products) {
      if (!p.name) continue;
      const item_no = itemCodeFor(p);
      try {
        const res = await mavenCall(cfg, '/api/items/addOrUpdateItem', {
          name: String(p.name).trim(), amount: Number(p.maven_price) || 0, item_no, external_item_id: p.id,
          description: String(p.name).trim(), currency_id: 1, vat_included_yn: !!cfg.vat_included, no_vat_yn: !!p.vat_exempt, archive_yn: false,
        });
        updateRow(p.id, { maven_item_no: item_no, maven_item_id: res.id || p.maven_item_id || null });
        pushed++;
      } catch (e) { errors.push(`${p.name}: ${e.message}`); }
    }
    return { products: products.length, pushed, errors: errors.slice(0, 10) };
  }

  // ── import: items (catalog items found on Maven documents → local products / packaging) ──
  // fromIso: סריקה מתאריך מסמך (סנכרון אוטומטי — מאז הסנכרון הקודם); בלי — שנתיים אחורה
  async function importItems(cfg, farmId, by, { fromIso } = {}) {
    const from = fromIso ? new Date(fromIso) : (() => { const d = new Date(); d.setFullYear(d.getFullYear() - 2); return d; })();
    const docs = [];
    for (let page = 1; page <= 50; page++) {
      const res = await mavenCall(cfg, '/api/documents/searchDocuments', { page, page_size: 100, from_document_date: ddmmyyyy(from.toISOString().slice(0, 10)), sort_by: 'create_date', sort_dir: 'asc' });
      const list = res.documents || [];
      docs.push(...list);
      if (!res.pages || page >= Number(res.pages) || !list.length) break;
    }
    const catalog = collectCatalogItems(docs);
    const products = rowsOf('products', farmId);
    const packagings = rowsOf('packaging', farmId);
    let linked = 0, created = 0, equipment = 0;
    const matchIn = (rows, it) => rows.find(p => it.maven_item_id && p.maven_item_id === it.maven_item_id)
      || rows.find(p => it.maven_item_no && String(p.maven_item_no || '').toUpperCase() === it.maven_item_no.toUpperCase())
      || rows.find(p => normName(p.name) === normName(it.name));
    for (const it of catalog) {
      if (it.equipment) {
        const pkg = it.equipment === 'אריזה' ? matchIn(packagings, it) : null;
        if (pkg && (pkg.maven_item_no !== it.maven_item_no || (it.maven_item_id && pkg.maven_item_id !== it.maven_item_id))) {
          const patch = { ...(it.maven_item_no ? { maven_item_no: it.maven_item_no } : {}), ...(it.maven_item_id ? { maven_item_id: it.maven_item_id } : {}) };
          updateRow(pkg.id, patch); Object.assign(pkg, patch); equipment++;
        }
        continue;
      }
      const match = matchIn(products, it);
      if (match) {
        const patch = {};
        if (it.maven_item_id && match.maven_item_id !== it.maven_item_id) patch.maven_item_id = it.maven_item_id;
        if (it.maven_item_no && !match.maven_item_no) patch.maven_item_no = it.maven_item_no;
        if (!match.maven_price && it.price) patch.maven_price = it.price;
        if (Object.keys(patch).length) { updateRow(match.id, patch); Object.assign(match, patch); linked++; }
      } else {
        const data = { name: it.name, maven_item_id: it.maven_item_id || null, maven_item_no: it.maven_item_no || null, maven_price: it.price || 0, vat_exempt: it.no_vat, _by: by };
        products.push({ id: insertRow('products', farmId, data), ...data }); created++;
      }
    }
    return { documents: docs.length, remote: catalog.filter(i => !i.equipment).length, created, linked, updated: equipment };
  }

  // ── סנכרון אוטומטי מ-Maven ──
  // אין ב-Maven webhook ללקוח/ספק/פריט חדש (רק למסמכים), לכן מושכים: מיד כשהאינטגרציה מופעלת, ואחר כך כל 15 דקות.
  // שירותי החיפוש של Maven מוגבלים לחיפוש אחד בדקה לעסק → השלבים רצים בהפרש של ~65 שניות.
  const AUTO_STEPS = ['customers', 'suppliers', 'items_import'];
  const AUTO_EVERY_MS = 15 * 60 * 1000;
  const AUTO_GAP_MS = Number(process.env.MAVEN_AUTO_GAP_MS) || 65 * 1000;
  const AUTO_BY = 'סנכרון אוטומטי';
  const autoRunning = new Set();
  const sleep = (ms) => new Promise(r => { const t = setTimeout(r, ms); t.unref?.(); });
  async function runSyncStep(farmId, what, by, { auto = false } = {}) {
    const cfg = loadConfig(farmId);
    if (!cfg.enabled || !cfg.api_key_enc) return null;
    let result;
    if (what === 'customers') result = await syncCustomers(cfg, farmId, by);
    else if (what === 'suppliers') result = await syncSuppliers(cfg, farmId, by);
    else if (what === 'items_import') result = await importItems(cfg, farmId, by, { fromIso: auto ? cfg.items_import_from : null });
    else if (what === 'items') result = await syncItems(cfg, farmId);
    const fresh = loadConfig(farmId); // טעינה מחדש — לא לדרוס שינויים שנשמרו בזמן הקריאה ל-Maven
    fresh.last_sync = { ...(fresh.last_sync || {}), [what]: { at: NOW(), by, ...(auto ? { auto: true } : {}), ...result } };
    // הסריקה הבאה של המסמכים מתחילה כמה ימים לפני היום (מסמכים שתאריכם הוקדם / הופקו באיחור)
    if (what === 'items_import') { const d = new Date(); d.setDate(d.getDate() - 3); fresh.items_import_from = d.toISOString().slice(0, 10); }
    saveConfig(farmId, fresh);
    return result;
  }
  async function autoSyncFarm(farmId) {
    if (autoRunning.has(farmId)) return;
    autoRunning.add(farmId);
    try {
      for (let i = 0; i < AUTO_STEPS.length; i++) {
        if (i) await sleep(AUTO_GAP_MS);
        const what = AUTO_STEPS[i];
        try {
          const r = await runSyncStep(farmId, what, AUTO_BY, { auto: true });
          if (r === null) return; // הכבו בינתיים
          if (r.created) console.log(`[maven] auto-sync farm=${farmId} ${what}: +${r.created}`);
        } catch (e) {
          console.error(`[maven] auto-sync farm=${farmId} ${what} failed:`, e.message);
          const cfg = loadConfig(farmId);
          cfg.last_sync = { ...(cfg.last_sync || {}), [what]: { ...((cfg.last_sync || {})[what] || {}), error: e.message, error_at: NOW() } };
          saveConfig(farmId, cfg);
        }
      }
    } finally {
      const cfg = loadConfig(farmId);
      cfg.auto_sync_at = NOW();
      saveConfig(farmId, cfg);
      autoRunning.delete(farmId);
    }
  }
  function autoSyncTick() {
    let rows = [];
    try { rows = db.prepare("SELECT farm_id, data FROM entities WHERE entity_type = 'maven_config'").all(); } catch { return; }
    for (const r of rows) {
      let cfg; try { cfg = JSON.parse(r.data); } catch { continue; }
      if (!cfg.enabled || !cfg.api_key_enc || cfg.auto_sync === false) continue;
      const last = Date.parse(cfg.auto_sync_at || '') || 0;
      if (Date.now() - last >= AUTO_EVERY_MS) autoSyncFarm(r.farm_id).catch(e => console.error('[maven] auto-sync', e.message));
    }
  }
  if (!deps.disableMavenScheduler && process.env.NODE_ENV !== 'test') {
    const first = setTimeout(autoSyncTick, 90 * 1000); first.unref?.();
    const every = setInterval(autoSyncTick, 5 * 60 * 1000); every.unref?.();
  }

  // ── duplicates (customers / suppliers / products) ──
  function duplicatesOf(kind, farmId) {
    const K = DEDUPE_KINDS[kind];
    const all = db.prepare('SELECT id, entity_type, data, created_at FROM entities WHERE farm_id = ?').all(farmId)
      .map(r => { let d = {}; try { d = JSON.parse(r.data); } catch { /* skip */ } return { id: r.id, type: r.entity_type, created_at: r.created_at, data: d }; });
    const counts = new Map();
    const bump = (id) => counts.set(id, (counts.get(id) || 0) + 1);
    for (const r of all) {
      for (const f of K.refs) if (r.data[f]) bump(r.data[f]);
      for (const f of K.arrayRefs || []) if (Array.isArray(r.data[f])) r.data[f].forEach(bump);
    }
    const rows = all.filter(r => r.type === K.entity).map(r => ({ ...r.data, id: r.id, created_at: r.created_at }));
    const groups = findDuplicateGroups(kind, rows, id => counts.get(id) || 0);
    return { all, groups, counts };
  }
  const summarize = (kind, r, counts) => ({
    id: r.id, name: r.name || '',
    maven_id: kind === 'products' ? (r.maven_item_id || '') : (r.maven_id || ''),
    code: kind === 'products' ? (r.maven_item_no || '') : kind === 'customers' ? (r.identification || '') : (r.vat_id || ''),
    refs: counts.get(r.id) || 0,
  });

  // ── document from weighing certificate ──
  function buildDocument(cfg, farmId, cert, items, opts) {
    const customer = cert.customer_id ? rowsOf('customers', farmId).find(c => c.id === cert.customer_id) : null;
    const products = rowsOf('products', farmId);
    // שורה אחת לכל מוצר+איכות+שיטת תמחור+מחיר — משטחים שנשקלו ומשטחים שהגיעו מתעודות כניסה מתאחדים
    const merged = new Map();
    for (const it of items) {
      const perKg = it.pricing_method === 'per_kg';
      const qty = perKg ? Number(it.net_weight) || 0 : Number(it.package_count) || 0;
      const disc = Number(it.discount_percentage) || 0;
      const price = round2((Number(it.price_per_unit) || 0) * (1 - disc / 100));
      const product = products.find(p => p.id === it.product_id);
      const desc = [it.product_name || product?.name || 'פריט', it.quality ? `איכות ${it.quality}` : null, perKg ? 'לפי ק"ג' : 'לפי יחידה'].filter(Boolean).join(' · ');
      const key = [it.product_id || desc, it.quality || '', perKg ? 'kg' : 'unit', price].join('|');
      const prev = merged.get(key);
      if (prev) { prev.quantity = round2(prev.quantity + (qty > 0 ? qty : 0)); continue; }
      const line = { description: desc, price, quantity: qty > 0 ? qty : 0 };
      if (product?.maven_item_no) line.item_number = product.maven_item_no;
      // פירות וירקות פטורים ממע"מ — לפי דגל המוצר, או מסמך שלם ללא מע"מ
      if (product?.vat_exempt || opts.no_vat) line.no_vat = true;
      merged.set(key, line);
    }
    const lines = [...merged.values()].map(l => ({ ...l, quantity: l.quantity > 0 ? round2(l.quantity) : 1 }));
    // בכל סוגי המסמכים: האריזות והמשטחים מופיעים כשורות כמות בלי מחיר (לצורך החזרת ציוד / ספירה אצל הלקוח)
    {
      const packagings = rowsOf('packaging', farmId);
      const palletTypes = rowsOf('pallet_types', farmId);
      const byPackaging = new Map(), byPallet = new Map();
      for (const it of items) {
        const pkg = String(it.packaging_type || '').trim();
        const cnt = Number(it.package_count) || 0;
        if (pkg && cnt > 0) byPackaging.set(pkg, (byPackaging.get(pkg) || 0) + cnt);
        const pal = String(it.pallet_type || '').trim();
        if (pal) byPallet.set(pal, (byPallet.get(pal) || 0) + 1); // משטח אחד לכל שורת שקילה
      }
      for (const [name, qty] of byPackaging) {
        const def = packagings.find(x => x && x.name === name);
        const line = { description: `אריזה · ${name}`, price: 0, quantity: qty, equipment: true };
        if (def?.maven_item_no) line.item_number = def.maven_item_no;
        lines.push(line);
      }
      for (const [name, qty] of byPallet) {
        const def = palletTypes.find(x => x && x.name === name);
        const line = { description: `משטח · ${name}`, price: 0, quantity: qty, equipment: true };
        if (def?.maven_item_no) line.item_number = def.maven_item_no;
        lines.push(line);
      }
    }
    const certNo = cert.certificate_number || cert.barcode || String(cert.id).slice(0, 8);
    const body = {
      doc_type: opts.doc_type,
      customer: {
        name: (customer?.name || cert.customer_name || 'לקוח').trim(),
        ...(customer?.identification ? { identification: String(customer.identification) } : {}),
        ...(customer?.email ? { email: customer.email } : {}),
        ...(customer?.phone ? { cell_phone: customer.phone } : {}),
        ...(customer?.address ? { address: customer.address } : {}),
      },
      items: lines.map(({ equipment, ...l }) => l),
      _equipment_lines: lines.filter(l => l.equipment).length,
      // Maven דורש רצף כרונולוגי של תאריכים לכל סוג מסמך → תאריך המסמך = היום; תאריך השקילה בתיאור
      document_date: ddmmyyyy(opts.document_date || new Date().toISOString().slice(0, 10)),
      description: `תעודת שקילה ${certNo} מתאריך ${ddmmyyyy(cert.date)}`,
      vat_included: opts.vat_included !== undefined ? !!opts.vat_included : !!cfg.vat_included,
      ...(opts.no_vat ? { no_vat: true } : {}),
      send_to_customer: !!opts.send_to_customer,
      doc_id: `ff-${cert.id}-${opts.doc_type}${opts.force ? '-' + Date.now() : ''}`,
    };
    if (opts.remarks) body.remarks = String(opts.remarks).slice(0, 1000);
    if (cert.vehicle_number || cert.driver_name) {
      body.remarks = [body.remarks, cert.notes ? String(cert.notes).trim().slice(0, 600) : null, cert.vehicle_number ? `רכב ${cert.vehicle_number}` : null, cert.driver_name ? `נהג ${cert.driver_name}` : null].filter(Boolean).join(' · ');
    }
    return body;
  }

  // ── routes ──
  app.get('/api/integrations/maven/config', authMiddleware, (req, res) => {
    const ctx = farmOf(req, res); if (!ctx) return;
    res.json({ farm_id: ctx.farmId, doc_types: DOC_TYPES, ...publicConfig(loadConfig(ctx.farmId)), auto_syncing: autoRunning.has(ctx.farmId) });
  });

  app.post('/api/integrations/maven/config', authMiddleware, (req, res) => {
    const ctx = farmOf(req, res, { manage: true }); if (!ctx) return;
    const cfg = loadConfig(ctx.farmId);
    const wasEnabled = !!cfg.enabled && !!cfg.api_key_enc && cfg.auto_sync !== false;
    const b = req.body || {};
    if (b.auto_sync !== undefined) cfg.auto_sync = !!b.auto_sync;
    if (b.api_key !== undefined) {
      const k = String(b.api_key || '').trim();
      if (k) cfg.api_key_enc = encryptSecret(k);
      else if (b.clear_key) cfg.api_key_enc = null;
    }
    if (b.enabled !== undefined) cfg.enabled = !!b.enabled;
    if (b.contact_email !== undefined) cfg.contact_email = String(b.contact_email || '').trim().slice(0, 120);
    if (b.contact_phone !== undefined) cfg.contact_phone = String(b.contact_phone || '').trim().slice(0, 40);
    if (b.test_mode !== undefined) cfg.test_mode = !!b.test_mode;
    if (b.vat_included !== undefined) cfg.vat_included = !!b.vat_included;
    if (cfg.enabled && !cfg.api_key_enc) return res.status(400).json({ error: 'יש להזין מפתח API לפני ההפעלה' });
    cfg.updated_by = ctx.user.full_name || ctx.user.email;
    saveConfig(ctx.farmId, cfg);
    // הופעל עכשיו → סנכרון מלא מיד ברקע (לקוחות, ספקים, פריטים)
    const startNow = !wasEnabled && cfg.enabled && cfg.api_key_enc && cfg.auto_sync !== false;
    if (startNow) setImmediate(() => autoSyncFarm(ctx.farmId).catch(e => console.error('[maven] auto-sync', e.message)));
    res.json({ farm_id: ctx.farmId, doc_types: DOC_TYPES, ...publicConfig(cfg), auto_syncing: startNow || autoRunning.has(ctx.farmId) });
  });

  app.post('/api/integrations/maven/test', authMiddleware, async (req, res) => {
    const ctx = farmOf(req, res, { manage: true }); if (!ctx) return;
    const cfg = loadConfig(ctx.farmId);
    try {
      const r = await mavenCall(cfg, '/api/customers/searchCustomers', { page: 1, page_size: 1 });
      res.json({ ok: true, customers_total: r.total ?? null, test_mode: cfg.test_mode !== false });
    } catch (e) { res.status(422).json({ ok: false, error: e.message, code: e.code || null }); }
  });

  app.post('/api/integrations/maven/sync', authMiddleware, async (req, res) => {
    const ctx = farmOf(req, res, { manage: true }); if (!ctx) return;
    const cfg = loadConfig(ctx.farmId);
    if (!cfg.enabled) return res.status(400).json({ error: 'האינטגרציה אינה מופעלת' });
    const what = String(req.body?.what || '');
    const by = ctx.user.full_name || ctx.user.email;
    if (!['customers', 'suppliers', 'items', 'items_import'].includes(what)) return res.status(400).json({ error: 'what must be customers | suppliers | items | items_import' });
    if (autoRunning.has(ctx.farmId) && what !== 'items') return res.status(409).json({ error: 'סנכרון אוטומטי רץ כרגע — הנתונים יתעדכנו בעוד כמה דקות' });
    try {
      const result = await runSyncStep(ctx.farmId, what, by);
      console.log(`[maven] farm=${ctx.farmId} sync ${what}:`, JSON.stringify(result));
      res.json({ ok: true, what, ...result, test_mode: cfg.test_mode !== false });
    } catch (e) {
      console.error(`[maven] sync ${what} failed:`, e.message);
      res.status(422).json({ ok: false, error: e.message, code: e.code || null });
    }
  });

  // כפילויות: תצוגה מקדימה (GET) ואיחוד (POST). עובד גם בלי Maven מופעל — רק על נתוני המשק.
  app.get('/api/integrations/maven/duplicates', authMiddleware, (req, res) => {
    const ctx = farmOf(req, res, { manage: true }); if (!ctx) return;
    const kind = String(req.query.what || '');
    if (!DEDUPE_KINDS[kind]) return res.status(400).json({ error: 'what must be customers | suppliers | products' });
    const { groups, counts } = duplicatesOf(kind, ctx.farmId);
    res.json({ what: kind, groups: groups.map(g => ({ keep: summarize(kind, g.keep, counts), merge: g.merge.map(m => summarize(kind, m, counts)) })) });
  });

  app.post('/api/integrations/maven/merge-duplicates', authMiddleware, (req, res) => {
    const ctx = farmOf(req, res, { manage: true }); if (!ctx) return;
    const kind = String(req.body?.what || '');
    if (!DEDUPE_KINDS[kind]) return res.status(400).json({ error: 'what must be customers | suppliers | products' });
    // רק הקבוצות שהמשתמש ראה ואישר (לפי מזהה הרשומה שנשמרת); בלי רשימה — כולן
    const only = Array.isArray(req.body?.keep_ids) ? new Set(req.body.keep_ids.map(String)) : null;
    const { all, groups } = duplicatesOf(kind, ctx.farmId);
    const chosen = groups.filter(g => !only || only.has(g.keep.id));
    if (!chosen.length) return res.json({ ok: true, groups: 0, merged: 0, references: 0 });
    const idMap = new Map();
    chosen.forEach(g => g.merge.forEach(m => idMap.set(m.id, g.keep.id)));
    const changed = remapReferences(kind, all.filter(r => !idMap.has(r.id)), idMap);
    const now = NOW();
    const by = ctx.user.full_name || ctx.user.email;
    db.transaction(() => {
      for (const c of changed) db.prepare('UPDATE entities SET data = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(c.data), now, c.id);
      for (const g of chosen) {
        const keepRow = changed.find(c => c.id === g.keep.id)?.data || all.find(r => r.id === g.keep.id).data;
        const merged = mergeRecordData(keepRow, g.merge.map(m => all.find(r => r.id === m.id).data));
        merged.merged_from = [...(Array.isArray(keepRow.merged_from) ? keepRow.merged_from : []), ...g.merge.map(m => ({ id: m.id, name: m.name || '', at: now, by }))];
        db.prepare('UPDATE entities SET data = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(merged), now, g.keep.id);
        for (const m of g.merge) db.prepare('DELETE FROM entities WHERE id = ?').run(m.id);
      }
    })();
    console.log(`[maven] farm=${ctx.farmId} merged ${kind}: ${idMap.size} records into ${chosen.length}, ${changed.length} references`);
    res.json({ ok: true, groups: chosen.length, merged: idMap.size, references: changed.length });
  });

  // PDF של מסמך שהופק ב-Maven, מוגש דרך השרת שלנו: מאפשר הצגה בתוך המערכת (iframe באותו origin),
  // הורדה בשם קריא, ובלי לחשוף את הקישור המקורי. מותר רק לקישורים של Maven (לא proxy כללי).
  const tokenFromQuery = (req, _res, next) => { if (!req.headers.authorization && req.query.token) req.headers.authorization = `Bearer ${req.query.token}`; next(); };
  app.get('/api/integrations/maven/pdf', tokenFromQuery, authMiddleware, async (req, res) => {
    const ctx = farmOf(req, res); if (!ctx) return;
    let u; try { u = new URL(String(req.query.url || '')); } catch { return res.status(400).json({ error: 'קישור לא תקין' }); }
    const hostOk = u.hostname === MAVEN_HOST || u.hostname.endsWith('.invoice-maven.co.il');
    if (u.protocol !== 'https:' || !hostOk) return res.status(400).json({ error: 'מותר להציג רק קבצים של Maven' });
    try {
      const r = await fetch(u, { redirect: 'follow', signal: AbortSignal.timeout(30000) });
      if (!r.ok || !r.body) return res.status(422).json({ error: `Maven החזיר ${r.status} עבור הקובץ` });
      const name = String(req.query.name || 'maven-document').replace(/[^\w֐-׿.-]+/g, '_').slice(0, 80);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `${req.query.download === '1' ? 'attachment' : 'inline'}; filename="document.pdf"; filename*=UTF-8''${encodeURIComponent(name)}.pdf`);
      res.setHeader('Cache-Control', 'private, max-age=600');
      Readable.fromWeb(r.body).pipe(res);
    } catch (e) {
      res.status(422).json({ error: `לא ניתן להוריד את הקובץ מ-Maven: ${e.message}` });
    }
  });

  // Preview (no call to Maven) — what the document would contain
  app.get('/api/integrations/maven/document-preview', authMiddleware, (req, res) => {
    const ctx = farmOf(req, res, { write: true }); if (!ctx) return;
    const cfg = loadConfig(ctx.farmId);
    const certId = String(req.query.certificate_id || '');
    const cert = rowsOf('weighing_certificates', ctx.farmId).find(c => c.id === certId);
    if (!cert) return res.status(404).json({ error: 'תעודה לא נמצאה' });
    const items = rowsOf('weighing_items', ctx.farmId).filter(i => i.certificate_id === certId);
    const docType = Number(req.query.doc_type) || 200;
    const body = buildDocument(cfg, ctx.farmId, cert, items, { doc_type: docType, no_vat: req.query.no_vat === '1' });
    const total = body.items.reduce((s, l) => s + l.price * l.quantity, 0);
    res.json({ customer: body.customer, items: body.items, total: round2(total), document_date: body.document_date, description: body.description, vat_included: body.vat_included, no_vat: !!body.no_vat, exempt_lines: body.items.filter(l => l.no_vat && l.price > 0).length, equipment_lines: body._equipment_lines || 0, test_mode: cfg.test_mode !== false, issued: cert.maven_documents || [] });
  });

  // Per-record lock: one Maven document request per certificate / delivery note at a time,
  // so a double-click can't issue two real documents before the first one is recorded.
  const mavenInflight = new Set();
  const lockMaven = (key, res) => {
    if (mavenInflight.has(key)) { res.status(409).json({ error: 'מסמך כבר מופק לרשומה זו — המתן לסיום', code: 'in_progress' }); return false; }
    mavenInflight.add(key); res.on('finish', () => mavenInflight.delete(key)); res.on('close', () => mavenInflight.delete(key));
    return true;
  };

  app.post('/api/integrations/maven/document', authMiddleware, async (req, res) => {
    const ctx = farmOf(req, res, { write: true }); if (!ctx) return;
    if (!lockMaven(`cert:${String(req.body?.certificate_id || '')}`, res)) return;
    const cfg = loadConfig(ctx.farmId);
    if (!cfg.enabled) return res.status(400).json({ error: 'האינטגרציה עם Maven אינה מופעלת במשק זה' });
    const { certificate_id, doc_type, send_to_customer, remarks, vat_included, force, no_vat } = req.body || {};
    const docType = Number(doc_type);
    if (!ALLOWED_DOC_TYPES.has(docType)) return res.status(400).json({ error: 'סוג מסמך לא נתמך' });
    const cert = rowsOf('weighing_certificates', ctx.farmId).find(c => c.id === String(certificate_id || ''));
    if (!cert) return res.status(404).json({ error: 'תעודה לא נמצאה' });
    const items = rowsOf('weighing_items', ctx.farmId).filter(i => i.certificate_id === cert.id);
    if (!items.length) return res.status(400).json({ error: 'אין פריטים בתעודה' });
    const already = (cert.maven_documents || []).find(d => Number(d.doc_type) === docType && !d.test);
    if (already && !force) return res.status(409).json({ error: `כבר הופק ${DOC_TYPES[docType]} מס' ${already.doc_no} לתעודה זו`, code: 'already_issued', existing: already });
    const body = buildDocument(cfg, ctx.farmId, cert, items, { doc_type: docType, send_to_customer, remarks, vat_included, no_vat: !!no_vat, force: !!force || !!already });
    try {
      const { _equipment_lines, ...payload } = body;
      const r = await mavenCall(cfg, '/api/documents/addDocument', payload);
      const entry = {
        id: r.id || null, doc_no: r.doc_no ?? null, doc_type: docType, doc_type_name: DOC_TYPES[docType],
        pdf_original: r.pdf_original || null, pdf_copy: r.pdf_copy || null, allocation_number: r.allocation_number || null,
        test: cfg.test_mode !== false, issued_at: NOW(), by: ctx.user.full_name || ctx.user.email, total: round2(body.items.reduce((s, l) => s + l.price * l.quantity, 0)),
      };
      const fresh = rowsOf('weighing_certificates', ctx.farmId).find(c => c.id === cert.id) || cert;
      const patch = { maven_documents: [...(fresh.maven_documents || []), entry] };
      if (docType === 200 && !entry.test) { patch.delivery_note_issued = true; patch.delivery_note_date = NOW().slice(0, 10); }
      updateRow(cert.id, patch);
      console.log(`[maven] farm=${ctx.farmId} cert=${cert.id} issued ${docType} doc_no=${entry.doc_no} test=${entry.test}`);
      res.json({ ok: true, document: entry, warnings: [r.allocation_warning, r.payment_link_warning].filter(Boolean) });
    } catch (e) {
      console.error('[maven] addDocument failed:', e.message);
      res.status(422).json({ ok: false, error: e.message, code: e.code || null });
    }
  });
  // ── מסמכים מתוך תעודת משלוח יוצאת (מודול הרכש) ──
  // Maven הוא מערכת הפקה ללקוחות: ה-API מקבל רק מסמכים שאנחנו מפיקים (תעודת משלוח / חשבונית ללקוח).
  // תעודה נכנסת מספק נרשמת ב-Maven רק כהוצאה — דרך המייל או האפליקציה שלהם, אין לזה API.
  function loadNoteForMaven(ctx, res, noteId) {
    const note = rowsOf('delivery_notes', ctx.farmId).find(n => n.id === String(noteId || ''));
    if (!note) { res.status(404).json({ error: 'תעודת משלוח לא נמצאה' }); return null; }
    if (note.direction !== 'out') { res.status(400).json({ error: 'ל-Maven אפשר להפיק רק תעודות משלוח יוצאות (ללקוח). תעודה נכנסת מספק נרשמת ב-Maven כהוצאה, דרך המייל או האפליקציה של Maven.', code: 'incoming_note' }); return null; }
    const items = rowsOf('delivery_note_items', ctx.farmId).filter(i => i.delivery_note_id === note.id).sort((a, b) => (a.line_no || 0) - (b.line_no || 0));
    const customer = note.customer_id ? rowsOf('customers', ctx.farmId).find(c => c.id === note.customer_id) : null;
    return { note, items, customer, products: rowsOf('products', ctx.farmId) };
  }
  // תעודות שקילה מקושרות שכבר הופק להן מסמך אמיתי ב-Maven — כדי לא להפיק תעודת משלוח כפולה
  function certificateDocsOf(farmId, note) {
    const ids = Array.isArray(note.weighing_certificate_ids) ? note.weighing_certificate_ids : [];
    if (!ids.length) return [];
    return rowsOf('weighing_certificates', farmId).filter(c => ids.includes(c.id))
      .flatMap(c => (c.maven_documents || []).filter(d => !d.test).map(d => ({ certificate_id: c.id, certificate_number: c.certificate_number || null, doc_type: d.doc_type, doc_type_name: d.doc_type_name || DOC_TYPES[d.doc_type], doc_no: d.doc_no })));
  }

  app.get('/api/integrations/maven/note-preview', authMiddleware, (req, res) => {
    const ctx = farmOf(req, res, { write: true }); if (!ctx) return;
    const cfg = loadConfig(ctx.farmId);
    const src = loadNoteForMaven(ctx, res, req.query.delivery_note_id); if (!src) return;
    const docType = Number(req.query.doc_type) || 200;
    const body = buildNoteDocument(cfg, src, { doc_type: docType, no_vat: req.query.no_vat === '1' });
    const total = body.items.reduce((s, l) => s + l.price * l.quantity, 0);
    res.json({
      customer: body.customer, items: body.items, total: round2(total), document_date: body.document_date, description: body.description, remarks: body.remarks || null,
      vat_included: body.vat_included, no_vat: !!body.no_vat, exempt_lines: body.items.filter(l => l.no_vat && l.price > 0).length, equipment_lines: 0,
      unpriced_lines: body.items.filter(l => !(l.price > 0)).length, test_mode: cfg.test_mode !== false,
      issued: src.note.maven_documents || [], certificate_documents: certificateDocsOf(ctx.farmId, src.note),
    });
  });

  app.post('/api/integrations/maven/note-document', authMiddleware, async (req, res) => {
    const ctx = farmOf(req, res, { write: true }); if (!ctx) return;
    if (!lockMaven(`note:${String(req.body?.delivery_note_id || '')}`, res)) return;
    const cfg = loadConfig(ctx.farmId);
    if (!cfg.enabled) return res.status(400).json({ error: 'האינטגרציה עם Maven אינה מופעלת במשק זה' });
    const { delivery_note_id, doc_type, send_to_customer, remarks, vat_included, force, no_vat } = req.body || {};
    const docType = Number(doc_type);
    if (!NOTE_DOC_TYPES.has(docType)) return res.status(400).json({ error: 'סוג מסמך לא נתמך לתעודת משלוח (תעודת משלוח / חשבונית מס / חשבונית מס-קבלה)' });
    const src = loadNoteForMaven(ctx, res, delivery_note_id); if (!src) return;
    const { note, items } = src;
    if (!items.length) return res.status(400).json({ error: 'אין שורות בתעודה' });
    if (docType !== 200 && items.some(it => !(Number(it.unit_price) > 0))) return res.status(400).json({ error: 'לחשבונית נדרש מחיר בכל שורה. השלם מחירים בתעודה או הפק תעודת משלוח.', code: 'missing_prices' });
    const already = (note.maven_documents || []).find(d => Number(d.doc_type) === docType && !d.test);
    if (already && !force) return res.status(409).json({ error: `כבר הופק ${DOC_TYPES[docType]} מס' ${already.doc_no} לתעודה זו`, code: 'already_issued', existing: already });
    const body = buildNoteDocument(cfg, src, { doc_type: docType, send_to_customer, remarks, vat_included, no_vat: !!no_vat, force: !!force || !!already });
    try {
      const r = await mavenCall(cfg, '/api/documents/addDocument', body);
      const by = ctx.user.full_name || ctx.user.email;
      const entry = {
        id: r.id || null, doc_no: r.doc_no ?? null, doc_type: docType, doc_type_name: DOC_TYPES[docType],
        pdf_original: r.pdf_original || null, pdf_copy: r.pdf_copy || null, allocation_number: r.allocation_number || null,
        test: cfg.test_mode !== false, issued_at: NOW(), by, total: round2(body.items.reduce((s, l) => s + l.price * l.quantity, 0)),
      };
      const cur = rowsOf('delivery_notes', ctx.farmId).find(n => n.id === note.id) || note;
      const patch = { maven_documents: [...(cur.maven_documents || []), entry], _by: by };
      const history = [...(cur.history || []), { at: NOW(), by, action: 'maven', doc_type: docType, doc_no: entry.doc_no, test: entry.test, note: `${entry.test ? 'בדיקה: ' : ''}${DOC_TYPES[docType]}${entry.doc_no ? ` מס' ${entry.doc_no}` : ''} ב-Invoice Maven` }];
      // חשבונית אמיתית ללקוח = התעודה חויבה
      if (docType !== 200 && !entry.test && cur.status !== 'invoiced') {
        patch.status = 'invoiced';
        history.push({ at: NOW(), by, action: 'status', from: cur.status, to: 'invoiced', note: `חשבונית מס' ${entry.doc_no} ב-Maven` });
      }
      patch.history = history;
      updateRow(note.id, patch);
      console.log(`[maven] farm=${ctx.farmId} delivery_note=${note.id} issued ${docType} doc_no=${entry.doc_no} test=${entry.test}`);
      res.json({ ok: true, document: entry, status: patch.status || cur.status, warnings: [r.allocation_warning, r.payment_link_warning].filter(Boolean) });
    } catch (e) {
      console.error('[maven] addDocument (delivery note) failed:', e.message);
      res.status(422).json({ ok: false, error: e.message, code: e.code || null });
    }
  });

  // ── חשבונית ספק → הוצאה ב-Maven (addExpense) ──
  // Maven יוצר טיוטת הוצאה ומשלים ספק/תאריך/סכומים בקריאה אוטומטית. קובץ שכבר נקלט נדחה שם (110),
  // ואז רק נרשם הקישור להוצאה הקיימת. במצב בדיקה לא נשמר כלום ב-Maven, ואפשר להעלות שוב.
  app.post('/api/integrations/maven/expense', authMiddleware, async (req, res) => {
    const ctx = farmOf(req, res, { write: true }); if (!ctx) return;
    const invoiceId = String(req.body?.invoice_id || '');
    if (!lockMaven(`expense:${invoiceId}`, res)) return;
    const cfg = loadConfig(ctx.farmId);
    if (!cfg.enabled) return res.status(400).json({ error: 'האינטגרציה עם Maven אינה מופעלת במשק זה', code: 'not_enabled' });
    const row = db.prepare("SELECT farm_id, data FROM entities WHERE entity_type = 'invoices' AND id = ?").get(invoiceId);
    if (!row || row.farm_id !== ctx.farmId) return res.status(404).json({ error: 'חשבונית לא נמצאה' });
    let inv = {}; try { inv = JSON.parse(row.data || '{}'); } catch { /* ignore */ }
    const prev = inv.maven_expense;
    if (prev && !prev.test && !req.body?.force) return res.status(409).json({ error: `החשבונית כבר הועלתה ל-Maven${prev.expense_id ? ` (הוצאה ${prev.expense_id})` : ''}`, code: 'already_uploaded', maven_expense: prev });

    if (!inv.file_name && !inv.file_url) return res.status(400).json({ error: 'לחשבונית אין קובץ מצורף', code: 'no_file' });
    const stored = path.basename(String(inv.file_name || String(inv.file_url).split('?')[0]));
    const filePath = path.join(UPLOADS_DIR, stored);
    if (!/^[A-Za-z0-9._-]+$/.test(stored) || path.dirname(filePath) !== UPLOADS_DIR) return res.status(400).json({ error: 'שם קובץ לא תקין' });
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'קובץ החשבונית לא נמצא בשרת', code: 'no_file' });

    try {
      let ext = path.extname(stored).toLowerCase();
      let buf = EXPENSE_EXTS.has(ext) ? fs.readFileSync(filePath) : null;
      // תמונה לא נתמכת או גדולה מדי → PDF דחוס
      if (!buf || (buf.length > EXPENSE_MAX_BYTES && ext !== '.pdf')) { buf = await invoiceFileToPdf(filePath); ext = '.pdf'; }
      if (buf.length > EXPENSE_MAX_BYTES) return res.status(422).json({ ok: false, error: EXPENSE_ERRORS[107], code: '107' });
      const { filename, description } = buildExpenseUpload(inv, ext === '.jpeg' ? '.jpg' : ext);
      const test = cfg.test_mode !== false;
      const by = ctx.user.full_name || ctx.user.email;
      let r, duplicate = false;
      try {
        r = await mavenCall(cfg, '/api/expenses/addExpense', { filename, description, content_base64: buf.toString('base64') });
      } catch (e) {
        if (e.code !== '110') throw e;
        r = e.data || {}; duplicate = true; // הקובץ כבר קיים כהוצאה ב-Maven
      }
      const entry = {
        expense_id: r.expense_id ?? r.existing_expense_id ?? null, filename: r.filename || filename,
        ocr: r.ocr ?? null, test, duplicate, uploaded_at: NOW(), by,
        daily_remaining: r.daily_remaining ?? null,
      };
      updateRow(invoiceId, { maven_expense: entry }); // updateRow קורא את הרשומה מחדש, לא דורס עריכות שנעשו בינתיים
      console.log(`[maven] farm=${ctx.farmId} invoice=${invoiceId} expense=${entry.expense_id} test=${test} dup=${duplicate}`);
      res.json({ ok: true, maven_expense: entry });
    } catch (e) {
      console.error('[maven] addExpense failed:', e.message);
      res.status(422).json({ ok: false, error: EXPENSE_ERRORS[e.code] || e.message, code: e.code || null });
    }
  });
}

module.exports = { registerMavenRoutes, makeMavenCore, buildNoteDocument, buildExpenseUpload, DOC_TYPES, findDuplicateGroups, mergeRecordData, remapReferences, collectCatalogItems };
