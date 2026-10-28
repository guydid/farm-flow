// ─── רכש ומכירות: הזמנות ותעודות משלוח ─────────────────────────────────────────
// ישויות (טבלת entities, farm_id לכל רשומה — אותה הפרדת משקים כמו בשאר המערכת):
//   orders               הזמנת רכש (direction=purchase, supplier_id) או מכירה (direction=sale, customer_id)
//   order_items          שורות הזמנה (order_id). delivered_quantity מחושב מתעודות המשלוח
//   delivery_notes       תעודת משלוח נכנסת (direction=in) / יוצאת (direction=out), order_id ו-invoice_id אופציונליים
//   delivery_note_items  שורות תעודה (delivery_note_id, order_item_id אופציונלי)
// היסטוריית סטטוסים נשמרת על הרשומה עצמה: history[] = { at, by, action, from, to, note }.
// הקוד כאן משותף ל-REST (ממשק) ול-MCP (סוכן): makeProcurementCore מחזיר פונקציות טהורות
// על ה-DB, ו-registerProcurementRoutes עוטף אותן ב-Express.

const ORDER_STATUSES = ['draft', 'ordered', 'confirmed', 'partially_delivered', 'delivered', 'invoiced', 'cancelled'];
const ORDER_OPEN = new Set(['draft', 'ordered', 'confirmed', 'partially_delivered']);
const DN_STATUSES = ['expected', 'received', 'checked', 'disputed', 'invoiced'];
const DN_RECEIVED = new Set(['received', 'checked', 'disputed', 'invoiced']); // הסחורה עברה פיזית
const DIRECTIONS = ['purchase', 'sale'];
const DN_DIRECTIONS = ['in', 'out'];
const SOURCES = ['whatsapp', 'email', 'phone', 'app', 'agent', 'other'];
const STATUS_LABELS = {
  draft: 'טיוטה', ordered: 'הוזמן', confirmed: 'אושר ע"י הספק', partially_delivered: 'סופק חלקית', delivered: 'סופק', invoiced: 'חויב', cancelled: 'בוטל',
  expected: 'צפויה', received: 'נקלטה', checked: 'נבדקה', disputed: 'במחלוקת',
};

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const normName = (s) => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();
const normUnitStr = (u) => String(u || '').trim().replace(/[״”]/g, '"').replace(/[׳’]/g, "'").toLowerCase();
const isIsoDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));

function makeProcurementCore({ db, uuidv4, NOW }) {
  const today = () => NOW().slice(0, 10);
  const addDays = (iso, n) => new Date(Date.parse(iso) + n * 86400000).toISOString().slice(0, 10);

  // ── מיגרציה: אינדקסים לשדות הקישור החמים (json_extract = ? ב-listEntities) ──
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_ent_order         ON entities(json_extract(data, '$.order_id'));
    CREATE INDEX IF NOT EXISTS idx_ent_delivery_note ON entities(json_extract(data, '$.delivery_note_id'));
    CREATE INDEX IF NOT EXISTS idx_ent_invoice       ON entities(json_extract(data, '$.invoice_id'));
  `);

  // ── גישה לרשומות ──
  const parse = (r) => { try { return { id: r.id, farm_id: r.farm_id, created_at: r.created_at, updated_at: r.updated_at, ...JSON.parse(r.data) }; } catch { return { id: r.id, farm_id: r.farm_id }; } };
  const getRow = (type, id, farmId) => { if (!id) return null; const r = db.prepare('SELECT * FROM entities WHERE entity_type = ? AND id = ? AND farm_id = ?').get(type, String(id), farmId); return r ? parse(r) : null; };
  const rowsOf = (type, farmId) => db.prepare('SELECT * FROM entities WHERE entity_type = ? AND farm_id = ?').all(type, farmId).map(parse);
  const rowsBy = (type, farmId, field, value) => db.prepare(`SELECT * FROM entities WHERE entity_type = ? AND farm_id = ? AND json_extract(data, '$.${field}') = ?`).all(type, farmId, String(value)).map(parse);
  const insertRow = (type, farmId, data) => {
    const id = uuidv4(), now = NOW();
    const clean = { ...data }; ['id', 'farm_id', 'created_at', 'updated_at'].forEach(k => delete clean[k]);
    db.prepare('INSERT INTO entities (id, entity_type, farm_id, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, type, farmId, JSON.stringify(clean), now, now);
    return id;
  };
  const updateRow = (type, id, patch) => {
    const r = db.prepare('SELECT data FROM entities WHERE entity_type = ? AND id = ?').get(type, id);
    if (!r) return null;
    let cur; try { cur = JSON.parse(r.data || '{}'); } catch { cur = {}; }
    const next = { ...cur, ...patch }; ['id', 'farm_id', 'created_at', 'updated_at'].forEach(k => delete next[k]);
    db.prepare('UPDATE entities SET data = ?, updated_at = ? WHERE entity_type = ? AND id = ?').run(JSON.stringify(next), NOW(), type, id);
    return next;
  };
  const deleteRow = (type, id) => db.prepare('DELETE FROM entities WHERE entity_type = ? AND id = ?').run(type, id);
  const fail = (msg) => { throw Object.assign(new Error(msg), { status: 400 }); };
  const audit = (by, action, extra = {}) => ({ at: NOW(), by: by || 'system', action, ...extra });

  // ── צדדים נגדיים ──
  function resolveParty(farmId, d, direction) {
    const type = direction === 'purchase' || direction === 'in' ? 'suppliers' : 'customers';
    const idField = type === 'suppliers' ? 'supplier_id' : 'customer_id';
    const nameField = type === 'suppliers' ? 'supplier_name' : 'customer_name';
    let id = d[idField] || null, name = String(d[nameField] || d.counterparty_name || '').trim();
    if (id) {
      const row = getRow(type, id, farmId);
      if (!row) fail(`${idField} לא נמצא במשק: ${id}`);
      name = row.name || name;
    } else if (name) {
      const hit = rowsOf(type, farmId).find(r => normName(r.name) === normName(name));
      if (hit) { id = hit.id; name = hit.name; }
    }
    return { type, idField, nameField, id, name };
  }

  function nextNumber(farmId, entityType, prefix) {
    const existing = new Set(rowsOf(entityType, farmId).map(r => r.order_number || r.note_number).filter(Boolean));
    let n = existing.size + 1, candidate;
    do { candidate = `${prefix}-${String(n++).padStart(4, '0')}`; } while (existing.has(candidate));
    return candidate;
  }

  // ── שורות ──
  function normalizeItems(farmId, items, { requirePrice = false } = {}) {
    if (!Array.isArray(items)) fail('items חייב להיות מערך');
    const products = rowsOf('products', farmId);
    return items.map((it, i) => {
      if (!it || typeof it !== 'object') fail(`items[${i}]: פריט לא תקין`);
      let product = it.product_id ? products.find(p => p.id === it.product_id) : null;
      if (it.product_id && !product) fail(`items[${i}]: product_id לא נמצא: ${it.product_id}`);
      const name = String(it.product_name || it.product || product?.name || '').trim();
      if (!product && name) product = products.find(p => normName(p.name) === normName(name)) || null;
      if (!name && !product) fail(`items[${i}]: נדרש product_id או product_name`);
      const quantity = Number(it.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0) fail(`items[${i}]: quantity חייב להיות מספר חיובי`);
      const unit_price = it.unit_price === undefined || it.unit_price === null || it.unit_price === '' ? null : Number(it.unit_price);
      if (unit_price !== null && !(Number.isFinite(unit_price) && unit_price >= 0)) fail(`items[${i}]: unit_price לא תקין`);
      if (requirePrice && unit_price === null) fail(`items[${i}]: unit_price נדרש`);
      return {
        product_id: product?.id || null, product_name: product?.name || name,
        quantity: round2(quantity), unit: String(it.unit || product?.unit || 'יח\'').trim(), unit_price,
        notes: String(it.notes || '').trim(),
        ...(it.order_item_id ? { order_item_id: String(it.order_item_id) } : {}),
        ...(it.discrepancy_note ? { discrepancy_note: String(it.discrepancy_note).trim() } : {}),
        ...(it.stock_category ? { stock_category: String(it.stock_category) } : {}),
      };
    });
  }
  const lineTotal = (it) => round2((Number(it.quantity) || 0) * (Number(it.unit_price) || 0));
  const itemsOfOrder = (farmId, orderId) => rowsBy('order_items', farmId, 'order_id', orderId).sort((a, b) => (a.line_no || 0) - (b.line_no || 0));
  const itemsOfNote = (farmId, noteId) => rowsBy('delivery_note_items', farmId, 'delivery_note_id', noteId).sort((a, b) => (a.line_no || 0) - (b.line_no || 0));
  const notesOfOrder = (farmId, orderId) => rowsBy('delivery_notes', farmId, 'order_id', orderId).sort((a, b) => String(a.delivery_date).localeCompare(String(b.delivery_date)));

  function fullOrder(farmId, orderId) {
    const order = getRow('orders', orderId, farmId);
    if (!order) return null;
    const items = itemsOfOrder(farmId, orderId);
    const notes = notesOfOrder(farmId, orderId).map(n => ({ ...n, items: itemsOfNote(farmId, n.id) }));
    return { ...order, items, delivery_notes: notes, status_label: STATUS_LABELS[order.status] || order.status };
  }
  function fullNote(farmId, noteId) {
    const note = getRow('delivery_notes', noteId, farmId);
    if (!note) return null;
    return { ...note, items: itemsOfNote(farmId, noteId), status_label: STATUS_LABELS[note.status] || note.status };
  }

  // ── הזמנות ──
  function createOrder(farmId, by, d) {
    const direction = d.direction || (d.supplier_id || d.supplier_name ? 'purchase' : d.customer_id || d.customer_name ? 'sale' : null);
    if (!DIRECTIONS.includes(direction)) fail(`direction חייב להיות ${DIRECTIONS.join(' / ')}`);
    const party = resolveParty(farmId, d, direction);
    if (!party.id && !party.name) fail(direction === 'purchase' ? 'נדרש supplier_id או supplier_name' : 'נדרש customer_id או customer_name');
    const status = d.status || 'draft';
    if (!ORDER_STATUSES.includes(status)) fail(`status חייב להיות אחד מ: ${ORDER_STATUSES.join(', ')}`);
    for (const f of ['order_date', 'expected_delivery_date']) if (d[f] && !isIsoDate(d[f])) fail(`${f} חייב להיות YYYY-MM-DD`);
    if (d.source && !SOURCES.includes(d.source)) fail(`source חייב להיות אחד מ: ${SOURCES.join(', ')}`);
    if (d.plot_id && !getRow('plots', d.plot_id, farmId)) fail(`plot_id לא נמצא: ${d.plot_id}`);
    const items = normalizeItems(farmId, d.items || []);
    const order_number = String(d.order_number || '').trim() || nextNumber(farmId, 'orders', direction === 'purchase' ? 'PO' : 'SO');
    if (rowsOf('orders', farmId).some(o => o.order_number === order_number)) fail(`order_number כבר קיים: ${order_number}`);
    const orderId = insertRow('orders', farmId, {
      direction, order_number, [party.idField]: party.id, counterparty_name: party.name,
      order_date: d.order_date || today(), expected_delivery_date: d.expected_delivery_date || null,
      status, plot_id: d.plot_id || null, contact_person: String(d.contact_person || '').trim(),
      source: d.source || 'app', source_ref: String(d.source_ref || '').trim(), notes: String(d.notes || '').trim(),
      total_amount: round2(items.reduce((s, it) => s + lineTotal(it), 0)), vat_included: d.vat_included === true,
      created_by: by, history: [audit(by, 'created', { to: status })], _by: by,
    });
    items.forEach((it, i) => insertRow('order_items', farmId, { ...it, order_id: orderId, line_no: i + 1, delivered_quantity: 0, _by: by }));
    return fullOrder(farmId, orderId);
  }

  function addOrderItems(farmId, by, orderId, items) {
    const order = getRow('orders', orderId, farmId);
    if (!order) fail(`הזמנה לא נמצאה: ${orderId}`);
    if (['invoiced', 'cancelled'].includes(order.status)) fail(`לא ניתן להוסיף שורות להזמנה בסטטוס ${order.status}`);
    const norm = normalizeItems(farmId, items);
    if (!norm.length) fail('אין שורות להוספה');
    const start = itemsOfOrder(farmId, orderId).length;
    const ids = norm.map((it, i) => insertRow('order_items', farmId, { ...it, order_id: orderId, line_no: start + i + 1, delivered_quantity: 0, _by: by }));
    recomputeOrder(farmId, by, orderId, { note: `נוספו ${ids.length} שורות` });
    return { order: fullOrder(farmId, orderId), added_item_ids: ids };
  }

  function updateOrderStatus(farmId, by, orderId, status, note) {
    const order = getRow('orders', orderId, farmId);
    if (!order) fail(`הזמנה לא נמצאה: ${orderId}`);
    if (!ORDER_STATUSES.includes(status)) fail(`status חייב להיות אחד מ: ${ORDER_STATUSES.join(', ')}`);
    if (order.status === status) return fullOrder(farmId, orderId);
    if (order.status === 'cancelled' && status !== 'draft') fail('הזמנה מבוטלת אפשר להחזיר רק לטיוטה');
    const history = [...(order.history || []), audit(by, 'status', { from: order.status, to: status, ...(note ? { note: String(note) } : {}) })];
    updateRow('orders', orderId, { status, history, _by: by, ...(status === 'cancelled' ? { cancelled_at: NOW() } : {}) });
    return fullOrder(farmId, orderId);
  }

  const ORDER_PATCH_FIELDS = ['order_number', 'expected_delivery_date', 'order_date', 'plot_id', 'contact_person', 'source', 'source_ref', 'notes', 'vat_included', 'supplier_id', 'customer_id', 'supplier_name', 'customer_name', 'counterparty_name'];
  function updateOrder(farmId, by, orderId, patch) {
    const order = getRow('orders', orderId, farmId);
    if (!order) fail(`הזמנה לא נמצאה: ${orderId}`);
    const p = {};
    for (const k of ORDER_PATCH_FIELDS) if (patch[k] !== undefined) p[k] = patch[k];
    for (const f of ['order_date', 'expected_delivery_date']) if (p[f] && !isIsoDate(p[f])) fail(`${f} חייב להיות YYYY-MM-DD`);
    if (p.source && !SOURCES.includes(p.source)) fail(`source חייב להיות אחד מ: ${SOURCES.join(', ')}`);
    if (p.plot_id && !getRow('plots', p.plot_id, farmId)) fail(`plot_id לא נמצא: ${p.plot_id}`);
    if (p.supplier_id || p.customer_id || p.supplier_name || p.customer_name) {
      const party = resolveParty(farmId, { ...order, ...p }, order.direction);
      p[party.idField] = party.id; p.counterparty_name = party.name;
      delete p.supplier_name; delete p.customer_name;
    }
    if (p.order_number !== undefined) {
      p.order_number = String(p.order_number).trim();
      if (rowsOf('orders', farmId).some(o => o.id !== orderId && o.order_number === p.order_number)) fail(`order_number כבר קיים: ${p.order_number}`);
    }
    if (Object.keys(p).length) updateRow('orders', orderId, { ...p, history: [...(order.history || []), audit(by, 'updated', { fields: Object.keys(p) })], _by: by });
    if (patch.status !== undefined && patch.status !== order.status) updateOrderStatus(farmId, by, orderId, patch.status, patch.status_note);
    return fullOrder(farmId, orderId);
  }

  // delivered_quantity לכל שורה + סטטוס אספקה אוטומטי + סה"כ. נקרא אחרי כל שינוי בתעודות.
  function recomputeOrder(farmId, by, orderId, { note } = {}) {
    const order = getRow('orders', orderId, farmId);
    if (!order) return null;
    const items = itemsOfOrder(farmId, orderId);
    const notes = notesOfOrder(farmId, orderId);
    const received = notes.filter(n => DN_RECEIVED.has(n.status));
    const dnItems = received.flatMap(n => itemsOfNote(farmId, n.id));
    let anyDelivered = false, allDelivered = items.length > 0;
    for (const it of items) {
      const delivered = round2(dnItems.filter(x => x.order_item_id === it.id).reduce((s, x) => s + (Number(x.quantity) || 0), 0));
      if (delivered !== Number(it.delivered_quantity || 0)) updateRow('order_items', it.id, { delivered_quantity: delivered });
      if (delivered > 0) anyDelivered = true;
      if (delivered + 1e-9 < Number(it.quantity)) allDelivered = false;
    }
    const total_amount = round2(items.reduce((s, it) => s + lineTotal(it), 0));
    const patch = { total_amount };
    let next = order.status;
    if (!['draft', 'cancelled', 'invoiced'].includes(order.status)) {
      if (allDelivered && anyDelivered) next = 'delivered';
      else if (anyDelivered) next = 'partially_delivered';
      else if (order.status === 'partially_delivered' || order.status === 'delivered') next = 'ordered';
      if (next === 'delivered' && received.length && received.every(n => n.status === 'invoiced')) next = 'invoiced';
    }
    const history = [...(order.history || [])];
    if (next !== order.status) { patch.status = next; history.push(audit(by || 'system', 'status', { from: order.status, to: next, note: note || 'עדכון אוטומטי מתעודות משלוח' })); }
    else if (note) history.push(audit(by, 'updated', { note }));
    if (history.length !== (order.history || []).length) patch.history = history;
    updateRow('orders', orderId, patch);
    return getRow('orders', orderId, farmId);
  }

  // ── תעודות משלוח ──
  const isPesticideName = (farmId, name) => !!db.prepare("SELECT 1 FROM entities WHERE entity_type = 'pesticides' AND (farm_id IS NULL OR farm_id = ?) AND lower(trim(json_extract(data, '$.product_name'))) = ? LIMIT 1").get(farmId, normName(name));
  const isInputName = (farmId, name) => rowsOf('input_types', farmId).some(t => normName(t.name) === normName(name));

  // תעודה נכנסת של חומרי הדברה / תשומות → תנועת קנייה במלאי (pesticide_stock). פעם אחת לכל שורה.
  function applyStock(farmId, by, note) {
    if (note.direction !== 'in' || !DN_RECEIVED.has(note.status)) return [];
    const created = [];
    for (const it of itemsOfNote(farmId, note.id)) {
      if (it.stock_movement_id) continue;
      const toStock = it.stock_category === 'pesticide' || it.stock_category === 'input' || note.add_to_stock === true || isPesticideName(farmId, it.product_name) || isInputName(farmId, it.product_name);
      if (!toStock) continue;
      const pesticide = db.prepare("SELECT id FROM entities WHERE entity_type = 'pesticides' AND (farm_id IS NULL OR farm_id = ?) AND lower(trim(json_extract(data, '$.product_name'))) = ? LIMIT 1").get(farmId, normName(it.product_name));
      const mid = insertRow('pesticide_stock', farmId, {
        type: 'purchase', product_name: it.product_name, pesticide_id: pesticide?.id || null, quantity: Number(it.quantity), unit: it.unit, date: note.delivery_date,
        supplier: note.counterparty_name || '', cost_per_unit: it.unit_price ?? null, notes: `תעודת משלוח ${note.note_number}`,
        delivery_note_id: note.id, delivery_note_item_id: it.id, created_by: by, _by: by,
      });
      updateRow('delivery_note_items', it.id, { stock_movement_id: mid });
      created.push({ item_id: it.id, product_name: it.product_name, quantity: it.quantity, unit: it.unit, stock_movement_id: mid });
    }
    return created;
  }

  // תעודה יוצאת → תעודות שקילה של אותו לקוח באותו יום (או מזהים שנמסרו)
  function linkCertificates(farmId, note, ids) {
    if (note.direction !== 'out') return [];
    let certs;
    if (Array.isArray(ids) && ids.length) {
      certs = ids.map(id => { const c = getRow('weighing_certificates', id, farmId); if (!c) fail(`weighing_certificate_id לא נמצא: ${id}`); return c; });
    } else if (note.customer_id) {
      certs = rowsOf('weighing_certificates', farmId).filter(c => c.customer_id === note.customer_id && String(c.date || '').slice(0, 10) === note.delivery_date);
    } else certs = [];
    return certs.map(c => ({ id: c.id, certificate_number: c.certificate_number || null, date: c.date || null }));
  }

  function matchItemsToOrder(farmId, orderItems, items) {
    const remaining = new Map(orderItems.map(oi => [oi.id, Number(oi.quantity) - Number(oi.delivered_quantity || 0)]));
    return items.map((it, i) => {
      let oi = it.order_item_id ? orderItems.find(x => x.id === it.order_item_id) : null;
      if (it.order_item_id && !oi) fail(`items[${i}]: order_item_id ${it.order_item_id} לא שייך להזמנה`);
      if (!oi) oi = orderItems.find(x => (it.product_id && x.product_id === it.product_id) || normName(x.product_name) === normName(it.product_name)) || null;
      if (!oi) return { ...it, order_item_id: null, not_in_order: true };
      remaining.set(oi.id, round2((remaining.get(oi.id) || 0) - it.quantity));
      return { ...it, order_item_id: oi.id, product_id: it.product_id || oi.product_id, ordered_quantity: oi.quantity, order_unit_price: oi.unit_price, unit: it.unit || oi.unit };
    });
  }

  function createDeliveryNote(farmId, by, d) {
    const order = d.order_id ? getRow('orders', d.order_id, farmId) : null;
    if (d.order_id && !order) fail(`order_id לא נמצא: ${d.order_id}`);
    if (order && order.status === 'cancelled') fail('ההזמנה מבוטלת');
    const direction = d.direction || (order ? (order.direction === 'purchase' ? 'in' : 'out') : (d.supplier_id || d.supplier_name ? 'in' : d.customer_id || d.customer_name ? 'out' : null));
    if (!DN_DIRECTIONS.includes(direction)) fail(`direction חייב להיות ${DN_DIRECTIONS.join(' / ')}`);
    if (order && (order.direction === 'purchase') !== (direction === 'in')) fail(`כיוון התעודה (${direction}) לא מתאים להזמנה (${order.direction})`);
    const partySrc = { ...d };
    if (order) { if (order.supplier_id && !partySrc.supplier_id) partySrc.supplier_id = order.supplier_id; if (order.customer_id && !partySrc.customer_id) partySrc.customer_id = order.customer_id; if (!partySrc.counterparty_name) partySrc.counterparty_name = order.counterparty_name; }
    const party = resolveParty(farmId, partySrc, direction);
    if (!party.id && !party.name) fail(direction === 'in' ? 'נדרש supplier_id או supplier_name' : 'נדרש customer_id או customer_name');
    const delivery_date = d.delivery_date || today();
    if (!isIsoDate(delivery_date)) fail('delivery_date חייב להיות YYYY-MM-DD');
    const status = d.status || (delivery_date > today() ? 'expected' : 'received');
    if (!DN_STATUSES.includes(status)) fail(`status חייב להיות אחד מ: ${DN_STATUSES.join(', ')}`);
    if (d.invoice_id && !getRow('invoices', d.invoice_id, farmId)) fail(`invoice_id לא נמצא: ${d.invoice_id}`);
    let items = normalizeItems(farmId, d.items || []);
    if (order) items = matchItemsToOrder(farmId, itemsOfOrder(farmId, order.id), items);
    const note_number = String(d.note_number || '').trim() || nextNumber(farmId, 'delivery_notes', direction === 'in' ? 'DN' : 'OUT');
    const dup = rowsOf('delivery_notes', farmId).find(n => n.note_number === note_number && (n[party.idField] || null) === (party.id || null));
    if (dup) fail(`תעודת משלוח ${note_number} של ${party.name || 'צד זה'} כבר קיימת (id=${dup.id})`);
    const finalStatus = d.invoice_id && status !== 'expected' ? 'invoiced' : status;
    const noteId = insertRow('delivery_notes', farmId, {
      direction, note_number, [party.idField]: party.id, counterparty_name: party.name, order_id: order?.id || null, order_number: order?.order_number || null,
      delivery_date, driver_name: String(d.driver_name || '').trim(), vehicle: String(d.vehicle || '').trim(), received_by: String(d.received_by || '').trim(),
      status: finalStatus, invoice_id: d.invoice_id || null, file_url: String(d.file_url || '').trim() || null, notes: String(d.notes || '').trim(),
      source: d.source || 'app', source_ref: String(d.source_ref || '').trim(), add_to_stock: d.add_to_stock === true,
      total_amount: round2(items.reduce((s, it) => s + lineTotal(it), 0)),
      created_by: by, history: [audit(by, 'created', { to: finalStatus })], _by: by,
    });
    items.forEach((it, i) => insertRow('delivery_note_items', farmId, { ...it, delivery_note_id: noteId, line_no: i + 1, _by: by }));
    const note = getRow('delivery_notes', noteId, farmId);
    const stock = applyStock(farmId, by, note);
    const certs = linkCertificates(farmId, note, d.weighing_certificate_ids);
    if (certs.length) updateRow('delivery_notes', noteId, { weighing_certificate_ids: certs.map(c => c.id), weighing_certificates: certs });
    if (order) recomputeOrder(farmId, by, order.id);
    return {
      delivery_note: fullNote(farmId, noteId),
      order: order ? getRow('orders', order.id, farmId) : null,
      stock_movements: stock, linked_weighing_certificates: certs,
      warnings: items.filter(it => it.not_in_order).map(it => `"${it.product_name}" לא מופיע בהזמנה — נקלט בלי קישור לשורת הזמנה`),
    };
  }

  const DN_PATCH_FIELDS = ['note_number', 'delivery_date', 'driver_name', 'vehicle', 'received_by', 'invoice_id', 'file_url', 'notes', 'order_id', 'supplier_id', 'customer_id', 'supplier_name', 'customer_name', 'counterparty_name', 'source', 'source_ref', 'add_to_stock'];
  function updateDeliveryNote(farmId, by, noteId, patch) {
    const note = getRow('delivery_notes', noteId, farmId);
    if (!note) fail(`תעודת משלוח לא נמצאה: ${noteId}`);
    const p = {};
    for (const k of DN_PATCH_FIELDS) if (patch[k] !== undefined) p[k] = patch[k];
    if (p.delivery_date && !isIsoDate(p.delivery_date)) fail('delivery_date חייב להיות YYYY-MM-DD');
    if (p.invoice_id && !getRow('invoices', p.invoice_id, farmId)) fail(`invoice_id לא נמצא: ${p.invoice_id}`);
    const prevOrderId = note.order_id;
    if (p.order_id !== undefined && p.order_id !== note.order_id) {
      if (p.order_id) {
        const o = getRow('orders', p.order_id, farmId); if (!o) fail(`order_id לא נמצא: ${p.order_id}`);
        if ((o.direction === 'purchase') !== (note.direction === 'in')) fail('כיוון התעודה לא מתאים להזמנה');
        p.order_number = o.order_number;
      } else p.order_number = null;
    }
    if (p.supplier_id || p.customer_id || p.supplier_name || p.customer_name) {
      const party = resolveParty(farmId, { ...note, ...p }, note.direction);
      p[party.idField] = party.id; p.counterparty_name = party.name; delete p.supplier_name; delete p.customer_name;
    }
    const history = [...(note.history || [])];
    let status = note.status;
    if (patch.status !== undefined && patch.status !== note.status) {
      if (!DN_STATUSES.includes(patch.status)) fail(`status חייב להיות אחד מ: ${DN_STATUSES.join(', ')}`);
      status = patch.status;
      history.push(audit(by, 'status', { from: note.status, to: status, ...(patch.status_note ? { note: String(patch.status_note) } : {}) }));
    } else if (p.invoice_id && !note.invoice_id && note.status !== 'expected' && note.status !== 'invoiced') {
      status = 'invoiced'; history.push(audit(by, 'status', { from: note.status, to: status, note: 'קושרה חשבונית' }));
    }
    if (Object.keys(p).length) history.push(audit(by, 'updated', { fields: Object.keys(p) }));
    updateRow('delivery_notes', noteId, { ...p, status, history, _by: by });
    if (Array.isArray(patch.items)) {
      const order = getRow('orders', p.order_id ?? note.order_id, farmId);
      let items = normalizeItems(farmId, patch.items);
      if (order) items = matchItemsToOrder(farmId, itemsOfOrder(farmId, order.id), items);
      for (const old of itemsOfNote(farmId, noteId)) deleteRow('delivery_note_items', old.id);
      items.forEach((it, i) => insertRow('delivery_note_items', farmId, { ...it, delivery_note_id: noteId, line_no: i + 1, _by: by }));
      updateRow('delivery_notes', noteId, { total_amount: round2(items.reduce((s, it) => s + lineTotal(it), 0)) });
    }
    const updated = getRow('delivery_notes', noteId, farmId);
    const stock = applyStock(farmId, by, updated);
    if (Array.isArray(patch.weighing_certificate_ids)) {
      const certs = linkCertificates(farmId, updated, patch.weighing_certificate_ids);
      updateRow('delivery_notes', noteId, { weighing_certificate_ids: certs.map(c => c.id), weighing_certificates: certs });
    }
    if (prevOrderId && prevOrderId !== updated.order_id) recomputeOrder(farmId, by, prevOrderId);
    if (updated.order_id) recomputeOrder(farmId, by, updated.order_id);
    return { delivery_note: fullNote(farmId, noteId), order: updated.order_id ? getRow('orders', updated.order_id, farmId) : null, stock_movements: stock };
  }

  function addDeliveryNoteItems(farmId, by, noteId, items) {
    const note = getRow('delivery_notes', noteId, farmId);
    if (!note) fail(`תעודת משלוח לא נמצאה: ${noteId}`);
    const existing = itemsOfNote(farmId, noteId).map(it => ({ ...it }));
    return updateDeliveryNote(farmId, by, noteId, { items: [...existing, ...(items || [])] });
  }

  // ── שאילתות ──
  const partyFilter = (rows, f) => rows.filter(r => (!f.supplier_id || r.supplier_id === f.supplier_id) && (!f.customer_id || r.customer_id === f.customer_id) && (!f.direction || r.direction === f.direction));
  function listOpenOrders(farmId, f = {}) {
    let orders = partyFilter(rowsOf('orders', farmId), f);
    if (f.status) { const set = new Set(String(f.status).split(',').map(s => s.trim()).filter(Boolean)); orders = orders.filter(o => set.has(o.status)); }
    else orders = orders.filter(o => ORDER_OPEN.has(o.status) && (f.include_draft !== false || o.status !== 'draft'));
    if (f.expected_from) orders = orders.filter(o => o.expected_delivery_date && o.expected_delivery_date >= f.expected_from);
    if (f.expected_to) orders = orders.filter(o => o.expected_delivery_date && o.expected_delivery_date <= f.expected_to);
    if (f.plot_id) orders = orders.filter(o => o.plot_id === f.plot_id);
    const t = today();
    return orders
      .sort((a, b) => String(a.expected_delivery_date || '9999').localeCompare(String(b.expected_delivery_date || '9999')) || String(b.order_date).localeCompare(String(a.order_date)))
      .map(o => {
        const items = itemsOfOrder(farmId, o.id);
        const ordered = items.reduce((s, it) => s + Number(it.quantity), 0), delivered = items.reduce((s, it) => s + Number(it.delivered_quantity || 0), 0);
        return {
          id: o.id, order_number: o.order_number, direction: o.direction, status: o.status, status_label: STATUS_LABELS[o.status] || o.status,
          supplier_id: o.supplier_id || null, customer_id: o.customer_id || null, counterparty_name: o.counterparty_name,
          order_date: o.order_date, expected_delivery_date: o.expected_delivery_date, overdue: !!(o.expected_delivery_date && o.expected_delivery_date < t && ORDER_OPEN.has(o.status) && o.status !== 'draft'),
          total_amount: o.total_amount, plot_id: o.plot_id || null, source: o.source, notes: o.notes,
          items_count: items.length, fulfillment_pct: ordered ? Math.round((delivered / ordered) * 100) : 0,
          items: items.map(it => ({ id: it.id, product_id: it.product_id, product_name: it.product_name, quantity: it.quantity, unit: it.unit, unit_price: it.unit_price, delivered_quantity: it.delivered_quantity || 0, remaining: round2(Number(it.quantity) - Number(it.delivered_quantity || 0)) })),
        };
      });
  }

  function listExpectedDeliveries(farmId, { from, to, direction } = {}) {
    const t = today();
    const f = from && isIsoDate(from) ? from : t, until = to && isIsoDate(to) ? to : addDays(f, 1);
    const open = listOpenOrders(farmId, { direction, include_draft: false });
    const notes = rowsOf('delivery_notes', farmId).filter(n => n.status === 'expected' && (!direction || (direction === 'purchase' ? n.direction === 'in' : n.direction === 'out')));
    return {
      from: f, to: until,
      orders: open.filter(o => o.expected_delivery_date && o.expected_delivery_date >= f && o.expected_delivery_date <= until),
      overdue_orders: open.filter(o => o.overdue),
      expected_delivery_notes: notes.filter(n => n.delivery_date >= f && n.delivery_date <= until).map(n => ({ id: n.id, note_number: n.note_number, direction: n.direction, counterparty_name: n.counterparty_name, delivery_date: n.delivery_date, order_id: n.order_id, order_number: n.order_number, total_amount: n.total_amount })),
      overdue_delivery_notes: notes.filter(n => n.delivery_date < f).map(n => ({ id: n.id, note_number: n.note_number, counterparty_name: n.counterparty_name, delivery_date: n.delivery_date, order_id: n.order_id })),
    };
  }

  // מחיר מחירון: רכש — pesticide_prices לפי שם תכשיר; מכירה — customer_product_pricing (לקוח+מוצר), ואם אין — המחיר האחרון בפריטי שקילה של הלקוח
  function listPrice(farmId, direction, item, partyId) {
    if (direction === 'in') {
      const p = rowsOf('pesticide_prices', farmId).find(x => normName(x.product_name) === normName(item.product_name) && x.price != null);
      return p ? { price: Number(p.price), unit: p.unit, source: 'pesticide_prices', comparable: !p.unit || !item.unit || normUnitStr(p.unit) === normUnitStr(item.unit) } : null;
    }
    if (partyId && item.product_id) {
      const cp = rowsOf('customer_product_pricing', farmId).find(x => x.customer_id === partyId && x.product_id === item.product_id);
      const price = cp ? Number(cp.price ?? cp.price_per_unit) : NaN;
      if (Number.isFinite(price) && price > 0) return { price, unit: cp.unit || null, source: 'customer_product_pricing', comparable: true };
      const row = db.prepare(`SELECT i.data AS item FROM entities i JOIN entities c ON c.entity_type = 'weighing_certificates' AND c.id = json_extract(i.data, '$.certificate_id')
        WHERE i.entity_type = 'weighing_items' AND i.farm_id = ? AND json_extract(c.data, '$.customer_id') = ? AND json_extract(i.data, '$.product_id') = ? AND CAST(json_extract(i.data, '$.price_per_unit') AS REAL) > 0
        ORDER BY json_extract(c.data, '$.date') DESC, i.created_at DESC LIMIT 1`).get(farmId, partyId, item.product_id);
      if (row) { try { const d = JSON.parse(row.item); return { price: Number(d.price_per_unit), unit: d.pricing_method === 'per_unit' ? 'יח\'' : 'ק"ג', source: 'last_weighing_price', comparable: true }; } catch { /* ignore */ } }
    }
    return null;
  }
  const pctDiff = (a, b) => (b ? Math.abs(a - b) / b : 1);

  function findDiscrepancies(farmId, { days_without_invoice = 14, direction, price_tolerance_pct = 1 } = {}) {
    const t = today();
    const parsedDays = parseInt(days_without_invoice, 10);
    const days = Math.min(Math.max(Number.isFinite(parsedDays) ? parsedDays : 14, 0), 365);
    const tol = Math.max(Number(price_tolerance_pct) || 0, 0) / 100;
    const dnDir = direction === 'purchase' ? 'in' : direction === 'sale' ? 'out' : null;
    const notes = rowsOf('delivery_notes', farmId).filter(n => !dnDir || n.direction === dnDir);
    const orders = new Map(rowsOf('orders', farmId).map(o => [o.id, o]));
    const orderItems = new Map(rowsOf('order_items', farmId).map(i => [i.id, i]));
    const quantity = [], price = [], missing_invoice = [], noted = [];
    const ref = (n) => ({ delivery_note_id: n.id, note_number: n.note_number, direction: n.direction, counterparty_name: n.counterparty_name, delivery_date: n.delivery_date, order_id: n.order_id, order_number: n.order_number });
    for (const n of notes) {
      if (!DN_RECEIVED.has(n.status)) continue;
      const partyId = n.supplier_id || n.customer_id || null;
      for (const it of itemsOfNote(farmId, n.id)) {
        if (it.discrepancy_note) noted.push({ ...ref(n), item_id: it.id, product_name: it.product_name, note: it.discrepancy_note });
        const oi = it.order_item_id ? orderItems.get(it.order_item_id) : null;
        if (oi && oi.unit_price != null && it.unit_price != null && pctDiff(Number(it.unit_price), Number(oi.unit_price)) > tol) {
          price.push({ ...ref(n), item_id: it.id, product_name: it.product_name, unit: it.unit, delivered_price: Number(it.unit_price), reference_price: Number(oi.unit_price), reference: 'order', diff: round2(Number(it.unit_price) - Number(oi.unit_price)) });
        }
        const lp = it.unit_price != null ? listPrice(farmId, n.direction, it, partyId) : null;
        if (lp && lp.comparable && pctDiff(Number(it.unit_price), lp.price) > tol) {
          price.push({ ...ref(n), item_id: it.id, product_name: it.product_name, unit: it.unit, delivered_price: Number(it.unit_price), reference_price: lp.price, reference: lp.source, diff: round2(Number(it.unit_price) - lp.price) });
        }
      }
      if (n.status !== 'invoiced' && !n.invoice_id && n.delivery_date <= addDays(t, -days)) {
        missing_invoice.push({ ...ref(n), days_since_delivery: Math.round((Date.parse(t) - Date.parse(n.delivery_date)) / 86400000), total_amount: n.total_amount, status: n.status });
      }
    }
    // כמות: לכל שורת הזמנה שסופקה — יותר מדי תמיד; פחות מדי כשההזמנה כבר סגורה (סופק/חויב)
    for (const oi of orderItems.values()) {
      const o = orders.get(oi.order_id); if (!o || ['draft', 'cancelled'].includes(o.status)) continue;
      if (dnDir && (o.direction === 'purchase') !== (dnDir === 'in')) continue;
      const delivered = Number(oi.delivered_quantity || 0), ordered = Number(oi.quantity);
      const over = delivered > ordered + 1e-9, under = delivered < ordered - 1e-9 && (['delivered', 'invoiced'].includes(o.status) || (delivered > 0 && o.expected_delivery_date && o.expected_delivery_date < t));
      if (over || under) quantity.push({ order_id: o.id, order_number: o.order_number, direction: o.direction, counterparty_name: o.counterparty_name, order_status: o.status, order_item_id: oi.id, product_name: oi.product_name, unit: oi.unit, ordered, delivered, diff: round2(delivered - ordered), kind: over ? 'over' : 'under' });
    }
    const overdue_orders = listOpenOrders(farmId, { direction, include_draft: false }).filter(o => o.overdue).map(o => ({ order_id: o.id, order_number: o.order_number, counterparty_name: o.counterparty_name, expected_delivery_date: o.expected_delivery_date, status: o.status, fulfillment_pct: o.fulfillment_pct }));
    return { as_of: t, days_without_invoice: days, quantity, price, missing_invoice, noted, overdue_orders, total: quantity.length + price.length + missing_invoice.length + noted.length + overdue_orders.length };
  }

  // ── התאמת חשבונית לתעודות משלוח ──
  function matchInvoiceToDeliveryNotes(farmId, by, { invoice_id, delivery_note_ids, tolerance = 1, window_days = 90 } = {}) {
    const inv = getRow('invoices', invoice_id, farmId);
    if (!inv) fail(`invoice_id לא נמצא: ${invoice_id}`);
    const link = (ids, matched_by) => {
      const linked = [];
      for (const id of ids) {
        const n = getRow('delivery_notes', id, farmId); if (!n) fail(`delivery_note_id לא נמצא: ${id}`);
        if (n.invoice_id && n.invoice_id !== inv.id) fail(`תעודה ${n.note_number} כבר מקושרת לחשבונית אחרת`);
        updateRow('delivery_notes', n.id, { invoice_id: inv.id, invoice_number: inv.invoice_number || null, status: n.status === 'expected' ? n.status : 'invoiced', matched_by, history: [...(n.history || []), audit(by, 'status', { from: n.status, to: 'invoiced', note: `חשבונית ${inv.invoice_number || inv.id} (${matched_by})` })], _by: by });
        if (n.order_id) recomputeOrder(farmId, by, n.order_id);
        linked.push(fullNote(farmId, n.id));
      }
      const prev = Array.isArray(inv.delivery_note_ids) ? inv.delivery_note_ids : [];
      updateRow('invoices', inv.id, { delivery_note_ids: [...new Set([...prev, ...ids])] });
      return linked;
    };
    if (Array.isArray(delivery_note_ids) && delivery_note_ids.length) {
      return { matched: true, matched_by: 'manual', invoice: { id: inv.id, invoice_number: inv.invoice_number || null, total: inv.total ?? null }, delivery_notes: link(delivery_note_ids, 'manual') };
    }
    const total = Number(inv.total);
    const invDate = isIsoDate(inv.date) ? inv.date : today();
    const supplierName = normName(inv.supplier_name);
    const candidates = rowsOf('delivery_notes', farmId).filter(n => n.direction === 'in' && !n.invoice_id && n.status !== 'expected'
      && (inv.supplier_id ? n.supplier_id === inv.supplier_id : true) && (!inv.supplier_id && supplierName ? normName(n.counterparty_name) === supplierName : true)
      && n.delivery_date <= invDate && n.delivery_date >= addDays(invDate, -window_days))
      .map(n => ({ id: n.id, note_number: n.note_number, delivery_date: n.delivery_date, total_amount: round2(n.total_amount || 0), order_number: n.order_number, counterparty_name: n.counterparty_name }));
    const out = { matched: false, invoice: { id: inv.id, invoice_number: inv.invoice_number || null, supplier_id: inv.supplier_id || null, supplier_name: inv.supplier_name || null, date: inv.date || null, total: Number.isFinite(total) ? total : null }, candidates };
    if (!candidates.length) return { ...out, reason: 'אין תעודות משלוח פתוחות של הספק בחלון הזמן' };
    if (!Number.isFinite(total) || total <= 0) return { ...out, reason: 'לחשבונית אין סכום — העבר delivery_note_ids ידנית' };
    // חיפוש תת-קבוצה שסכומה שווה לסכום החשבונית (כולל/לא כולל מע"מ 18%)
    const n = Math.min(candidates.length, 16), hits = [];
    const targets = [total, round2(total / 1.18), round2(total / 1.17)];
    for (let mask = 1; mask < (1 << n); mask++) {
      let sum = 0; for (let i = 0; i < n; i++) if (mask & (1 << i)) sum += candidates[i].total_amount;
      if (targets.some(tg => Math.abs(sum - tg) <= tolerance)) hits.push(mask);
    }
    if (hits.length === 1) {
      const ids = candidates.filter((_, i) => hits[0] & (1 << i)).map(c => c.id);
      return { ...out, matched: true, matched_by: 'total', delivery_notes: link(ids, 'total') };
    }
    return { ...out, reason: hits.length ? `${hits.length} שילובים מתאימים לסכום — בחר delivery_note_ids ידנית` : 'סכומי התעודות לא מסתכמים לסכום החשבונית — בחר delivery_note_ids ידנית',
      ...(hits.length && hits.length <= 5 ? { combinations: hits.map(m => candidates.filter((_, i) => m & (1 << i)).map(c => c.id)) } : {}) };
  }

  function summary(farmId) {
    const t = today();
    const open = listOpenOrders(farmId, {});
    const notes = rowsOf('delivery_notes', farmId);
    const disc = findDiscrepancies(farmId, {});
    const sumOf = (arr) => round2(arr.reduce((s, o) => s + (Number(o.total_amount) || 0), 0));
    return {
      open_orders: { purchase: open.filter(o => o.direction === 'purchase').length, sale: open.filter(o => o.direction === 'sale').length, overdue: open.filter(o => o.overdue).length, purchase_total: sumOf(open.filter(o => o.direction === 'purchase')), sale_total: sumOf(open.filter(o => o.direction === 'sale')) },
      expected_today: open.filter(o => o.expected_delivery_date === t).length + notes.filter(n => n.status === 'expected' && n.delivery_date === t).length,
      expected_tomorrow: open.filter(o => o.expected_delivery_date === addDays(t, 1)).length + notes.filter(n => n.status === 'expected' && n.delivery_date === addDays(t, 1)).length,
      delivery_notes: { total: notes.length, without_invoice: notes.filter(n => n.direction === 'in' && DN_RECEIVED.has(n.status) && !n.invoice_id).length, disputed: notes.filter(n => n.status === 'disputed').length },
      discrepancies: { total: disc.total, quantity: disc.quantity.length, price: disc.price.length, missing_invoice: disc.missing_invoice.length, overdue_orders: disc.overdue_orders.length },
    };
  }

  // סכמות קבועות ל-describe_entity (הישויות עשויות להיות ריקות במשק חדש)
  const KNOWN_FIELDS = {
    orders: [
      { field: 'direction', types: ['string'], required: true, enum: DIRECTIONS, description: 'purchase=רכש מספק, sale=מכירה ללקוח' },
      { field: 'order_number', types: ['string'], description: 'מספר הזמנה; נוצר אוטומטית (PO-0001 / SO-0001) אם לא ניתן' },
      { field: 'supplier_id', types: ['string', 'null'], description: 'רכש: id מ-suppliers (או supplier_name)' },
      { field: 'customer_id', types: ['string', 'null'], description: 'מכירה: id מ-customers (או customer_name)' },
      { field: 'counterparty_name', types: ['string'], description: 'שם הספק/הלקוח כפי שנשמר' },
      { field: 'order_date', types: ['string'], description: 'YYYY-MM-DD' }, { field: 'expected_delivery_date', types: ['string', 'null'], description: 'YYYY-MM-DD' },
      { field: 'status', types: ['string'], enum: ORDER_STATUSES, description: Object.entries(STATUS_LABELS).filter(([k]) => ORDER_STATUSES.includes(k)).map(([k, v]) => `${k}=${v}`).join(', ') + '. partially_delivered/delivered/invoiced נקבעים אוטומטית מתעודות המשלוח' },
      { field: 'plot_id', types: ['string', 'null'], description: 'חלקה (plots) — אופציונלי' }, { field: 'contact_person', types: ['string'] },
      { field: 'source', types: ['string'], enum: SOURCES }, { field: 'source_ref', types: ['string'], description: 'מזהה המקור (הודעת WhatsApp / מייל) — מניעת כפילות' },
      { field: 'notes', types: ['string'] }, { field: 'total_amount', types: ['number'], description: 'מחושב: Σ quantity×unit_price של השורות' }, { field: 'vat_included', types: ['boolean'] },
      { field: 'created_by', types: ['string'] }, { field: 'history', types: ['array'], description: 'audit: [{at, by, action, from, to, note}]' },
    ],
    order_items: [
      { field: 'order_id', types: ['string'], required: true }, { field: 'product_id', types: ['string', 'null'], description: 'מוצר מ-products (או product_name חופשי)' },
      { field: 'product_name', types: ['string'], required: true }, { field: 'quantity', types: ['number'], required: true }, { field: 'unit', types: ['string'], description: 'ק"ג / ליטר / יח\' / שתילים…' },
      { field: 'unit_price', types: ['number', 'null'] }, { field: 'delivered_quantity', types: ['number'], description: 'מחושב מתעודות המשלוח שנקלטו' }, { field: 'line_no', types: ['number'] }, { field: 'notes', types: ['string'] },
    ],
    delivery_notes: [
      { field: 'direction', types: ['string'], required: true, enum: DN_DIRECTIONS, description: 'in=נכנסת (מספק), out=יוצאת (ללקוח)' },
      { field: 'note_number', types: ['string'], description: 'מספר התעודה של הספק/שלנו; נוצר אוטומטית אם חסר' },
      { field: 'supplier_id', types: ['string', 'null'] }, { field: 'customer_id', types: ['string', 'null'] }, { field: 'counterparty_name', types: ['string'] },
      { field: 'order_id', types: ['string', 'null'], description: 'הזמנה מקושרת — מעדכנת delivered_quantity וסטטוס ההזמנה' }, { field: 'order_number', types: ['string', 'null'] },
      { field: 'delivery_date', types: ['string'], description: 'YYYY-MM-DD' }, { field: 'driver_name', types: ['string'] }, { field: 'vehicle', types: ['string'] }, { field: 'received_by', types: ['string'] },
      { field: 'status', types: ['string'], enum: DN_STATUSES, description: 'expected=צפויה, received=נקלטה, checked=נבדקה, disputed=במחלוקת, invoiced=חויבה (נקבע אוטומטית כשמקושרת חשבונית)' },
      { field: 'invoice_id', types: ['string', 'null'], description: 'חשבונית מ-invoices' }, { field: 'file_url', types: ['string', 'null'], description: 'צילום התעודה (העלאה דרך POST /api/upload)' },
      { field: 'weighing_certificate_ids', types: ['array'], description: 'תעודה יוצאת: תעודות שקילה מקושרות (אוטומטית לפי לקוח+תאריך)' },
      { field: 'total_amount', types: ['number'] }, { field: 'notes', types: ['string'] }, { field: 'source', types: ['string'], enum: SOURCES }, { field: 'source_ref', types: ['string'] },
      { field: 'add_to_stock', types: ['boolean'], description: 'נכנסת: להוסיף את כל השורות למלאי (אחרת רק תכשירים/תשומות מזוהים)' }, { field: 'history', types: ['array'], description: 'audit: [{at, by, action, from, to, note}]' },
    ],
    delivery_note_items: [
      { field: 'delivery_note_id', types: ['string'], required: true }, { field: 'order_item_id', types: ['string', 'null'], description: 'שורת ההזמנה שסופקה (מותאמת אוטומטית לפי מוצר)' },
      { field: 'product_id', types: ['string', 'null'] }, { field: 'product_name', types: ['string'], required: true }, { field: 'quantity', types: ['number'], required: true }, { field: 'unit', types: ['string'] },
      { field: 'unit_price', types: ['number', 'null'] }, { field: 'ordered_quantity', types: ['number'], description: 'צילום מהזמנה בעת הקליטה' }, { field: 'order_unit_price', types: ['number', 'null'] },
      { field: 'discrepancy_note', types: ['string'], description: 'הערת פער (נזק, חוסר, מחיר)' }, { field: 'stock_category', types: ['string'], enum: ['pesticide', 'input', 'none'], description: 'כופה הוספה למלאי (pesticide_stock) או מניעה' },
      { field: 'stock_movement_id', types: ['string', 'null'], description: 'תנועת המלאי שנוצרה' },
    ],
  };

  return {
    ORDER_STATUSES, DN_STATUSES, DIRECTIONS, DN_DIRECTIONS, SOURCES, STATUS_LABELS, KNOWN_FIELDS,
    getRow, rowsOf, fullOrder, fullNote,
    createOrder, addOrderItems, updateOrderStatus, updateOrder, recomputeOrder,
    createDeliveryNote, updateDeliveryNote, addDeliveryNoteItems,
    listOpenOrders, listExpectedDeliveries, findDiscrepancies, matchInvoiceToDeliveryNotes, summary,
  };
}

// ── REST (לממשק) ─────────────────────────────────────────────────────────────
function registerProcurementRoutes(app, deps) {
  const { getUser, authMiddleware, getFarmMember } = deps;
  const core = deps.core || makeProcurementCore(deps);
  const ctxOf = (req, res, { write = false } = {}) => {
    const user = getUser(req.user.id);
    const farmId = req.query.farm_id || req.body?.farm_id || user?.current_farm_id;
    if (!user || !farmId) { res.status(400).json({ error: 'No farm selected' }); return null; }
    if (!user.is_admin && !user.farm_ids.includes(farmId)) { res.status(403).json({ error: 'Forbidden' }); return null; }
    const role = getFarmMember(farmId, user.id)?.role || null;
    if (write && !user.is_admin && !['owner', 'manager', 'worker'].includes(role)) { res.status(403).json({ error: 'אין הרשאת כתיבה' }); return null; }
    return { user, farmId, by: user.full_name || user.email };
  };
  const wrap = (fn) => (req, res) => {
    try { const out = fn(req, res); if (out !== undefined) res.json(out); }
    catch (e) { if (e.status) return res.status(e.status).json({ error: e.message }); console.error('[procurement]', req.method, req.path, e); res.status(500).json({ error: 'Server error' }); }
  };
  const need = (req, res, w) => { const ctx = ctxOf(req, res, { write: w }); if (!ctx) throw Object.assign(new Error('handled'), { handled: true }); return ctx; };
  const guard = (fn, write = false) => wrap((req, res) => { let ctx; try { ctx = need(req, res, write); } catch (e) { if (e.handled) return undefined; throw e; } return fn(ctx, req, res); });

  app.get('/api/procurement/summary', authMiddleware, guard((ctx) => core.summary(ctx.farmId)));
  app.get('/api/procurement/orders/open', authMiddleware, guard((ctx, req) => ({ orders: core.listOpenOrders(ctx.farmId, req.query) })));
  app.get('/api/procurement/expected', authMiddleware, guard((ctx, req) => core.listExpectedDeliveries(ctx.farmId, req.query)));
  app.get('/api/procurement/discrepancies', authMiddleware, guard((ctx, req) => core.findDiscrepancies(ctx.farmId, req.query)));
  app.get('/api/procurement/orders/:id', authMiddleware, guard((ctx, req, res) => { const o = core.fullOrder(ctx.farmId, req.params.id); if (!o) { res.status(404).json({ error: 'הזמנה לא נמצאה' }); return undefined; } return o; }));
  app.post('/api/procurement/orders', authMiddleware, guard((ctx, req) => core.createOrder(ctx.farmId, ctx.by, req.body || {}), true));
  app.put('/api/procurement/orders/:id', authMiddleware, guard((ctx, req) => core.updateOrder(ctx.farmId, ctx.by, req.params.id, req.body || {}), true));
  app.post('/api/procurement/orders/:id/items', authMiddleware, guard((ctx, req) => core.addOrderItems(ctx.farmId, ctx.by, req.params.id, req.body?.items), true));
  app.post('/api/procurement/orders/:id/status', authMiddleware, guard((ctx, req) => core.updateOrderStatus(ctx.farmId, ctx.by, req.params.id, req.body?.status, req.body?.note), true));
  app.get('/api/procurement/delivery-notes/:id', authMiddleware, guard((ctx, req, res) => { const n = core.fullNote(ctx.farmId, req.params.id); if (!n) { res.status(404).json({ error: 'תעודה לא נמצאה' }); return undefined; } return n; }));
  app.post('/api/procurement/delivery-notes', authMiddleware, guard((ctx, req) => core.createDeliveryNote(ctx.farmId, ctx.by, req.body || {}), true));
  app.put('/api/procurement/delivery-notes/:id', authMiddleware, guard((ctx, req) => core.updateDeliveryNote(ctx.farmId, ctx.by, req.params.id, req.body || {}), true));
  app.post('/api/procurement/match-invoice', authMiddleware, guard((ctx, req) => core.matchInvoiceToDeliveryNotes(ctx.farmId, ctx.by, req.body || {}), true));
  return core;
}

module.exports = { makeProcurementCore, registerProcurementRoutes, ORDER_STATUSES, DN_STATUSES, STATUS_LABELS };
