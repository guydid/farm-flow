// בדיקות בסיסיות למודול הרכש — DB בזיכרון, בלי שרת.
//   node --test backend/procurement.test.js   (ללא תלויות — רץ גם ב-CI לפני הפריסה)
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID: uuidv4 } = require('node:crypto');
const { makeProcurementCore } = require('./procurement');

// בלי תלויות מותקנות: better-sqlite3 אם הוא בנוי, אחרת node:sqlite המובנה (Node 22.13+). אותו API: prepare/get/all/run/exec
let Database;
try { Database = require('better-sqlite3'); new Database(':memory:').close(); }
catch { Database = require('node:sqlite').DatabaseSync; }

const FARM = 'farm-1';
function setup() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE entities (id TEXT NOT NULL, entity_type TEXT NOT NULL, farm_id TEXT, data TEXT NOT NULL DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')), PRIMARY KEY (id, entity_type));`);
  let tick = 0;
  const NOW = () => new Date(Date.UTC(2026, 9, 28, 8, 0, tick++)).toISOString(); // 2026-10-28, זמן עולה
  const put = (type, id, data, farmId = FARM) => db.prepare('INSERT INTO entities (id, entity_type, farm_id, data) VALUES (?, ?, ?, ?)').run(id, type, farmId, JSON.stringify(data));
  put('suppliers', 'sup-1', { name: 'אגרו-כימיקלים בע"מ' });
  put('customers', 'cus-1', { name: 'שופרסל' });
  put('products', 'prod-1', { name: 'עגבנייה', weighable: true });
  put('pesticides', 'pest-1', { product_name: 'אקרובט 69', dosage: '200 גרם' }, null); // קטלוג משותף
  put('input_types', 'inp-1', { name: 'דשן 20-20-20', category: 'inputs' });
  put('pesticide_prices', 'pp-1', { product_name: 'אקרובט 69', price: 300, unit: 'ק"ג' });
  put('invoices', 'inv-1', { supplier_id: 'sup-1', supplier_name: 'אגרו-כימיקלים בע"מ', invoice_number: 'INV-77', date: '2026-10-27', total: 3540 }); // 3000 + 18% מע"מ
  put('weighing_certificates', 'cert-1', { customer_id: 'cus-1', date: '2026-10-28', certificate_number: 'WC-9' });
  const core = makeProcurementCore({ db, uuidv4, NOW });
  return { db, core, get: core.getRow };
}

test('create purchase order: number, total, lines, history', () => {
  const { core } = setup();
  const o = core.createOrder(FARM, 'בודק', {
    direction: 'purchase', supplier_id: 'sup-1', expected_delivery_date: '2026-10-29', source: 'whatsapp', source_ref: 'wa-1',
    items: [{ product_name: 'אקרובט 69', quantity: 10, unit: 'ק"ג', unit_price: 300 }, { product_name: 'דשן 20-20-20', quantity: 5, unit: 'שק', unit_price: 100 }],
  });
  assert.equal(o.order_number, 'PO-0001');
  assert.equal(o.counterparty_name, 'אגרו-כימיקלים בע"מ');
  assert.equal(o.status, 'draft');
  assert.equal(o.total_amount, 3500);
  assert.equal(o.items.length, 2);
  assert.equal(o.items[0].delivered_quantity, 0);
  assert.equal(o.history[0].action, 'created');
  // שם ספק בלי id מותאם לפי שם
  const o2 = core.createOrder(FARM, 'בודק', { direction: 'purchase', supplier_name: 'אגרו-כימיקלים בע"מ' });
  assert.equal(o2.supplier_id, 'sup-1');
  assert.equal(o2.order_number, 'PO-0002');
  assert.throws(() => core.createOrder(FARM, 'x', { direction: 'purchase' }), /supplier/);
  assert.throws(() => core.createOrder(FARM, 'x', { direction: 'sale', customer_id: 'cus-1', items: [{ product_name: 'x', quantity: 0 }] }), /quantity/);
});

test('delivery notes update delivered_quantity and order status; incoming pesticides go to stock', () => {
  const { core, db } = setup();
  const o = core.createOrder(FARM, 'בודק', {
    direction: 'purchase', supplier_id: 'sup-1', status: 'ordered', expected_delivery_date: '2026-10-28',
    items: [{ product_name: 'אקרובט 69', quantity: 10, unit: 'ק"ג', unit_price: 300 }, { product_name: 'חוט קשירה', quantity: 20, unit: 'גליל', unit_price: 15 }],
  });
  // אספקה חלקית: רק התכשיר, 6 מתוך 10, במחיר גבוה מהמחירון/ההזמנה
  const r1 = core.createDeliveryNote(FARM, 'בודק', { order_id: o.id, note_number: 'S-1001', items: [{ product_name: 'אקרובט 69', quantity: 6, unit: 'ק"ג', unit_price: 330 }] });
  assert.equal(r1.delivery_note.direction, 'in');
  assert.equal(r1.delivery_note.status, 'received');
  assert.equal(r1.delivery_note.items[0].order_item_id, o.items[0].id);
  assert.equal(r1.order.status, 'partially_delivered');
  assert.equal(r1.stock_movements.length, 1, 'התכשיר נכנס למלאי');
  const stock = db.prepare("SELECT data FROM entities WHERE entity_type = 'pesticide_stock'").all().map(r => JSON.parse(r.data));
  assert.equal(stock.length, 1);
  assert.equal(stock[0].type, 'purchase');
  assert.equal(stock[0].quantity, 6);
  assert.equal(stock[0].cost_per_unit, 330);
  assert.equal(core.fullOrder(FARM, o.id).items[0].delivered_quantity, 6);

  // פערים: מחיר מול הזמנה ומול מחירון; עדיין לא "חסר" כי ההזמנה פתוחה ולא עבר התאריך
  const d1 = core.findDiscrepancies(FARM, { days_without_invoice: 0 });
  assert.equal(d1.price.filter(p => p.reference === 'order').length, 1);
  assert.equal(d1.price.filter(p => p.reference === 'pesticide_prices').length, 1);
  assert.equal(d1.missing_invoice.length, 1, 'תעודה בלי חשבונית');
  assert.equal(d1.quantity.length, 0);

  // השלמה: שאר התכשיר + החוט → ההזמנה סופקה; לא נוצרת תנועת מלאי לחוט (לא תכשיר/תשומה)
  const r2 = core.createDeliveryNote(FARM, 'בודק', { order_id: o.id, note_number: 'S-1002', items: [{ product_name: 'אקרובט 69', quantity: 4, unit: 'ק"ג', unit_price: 300 }, { product_name: 'חוט קשירה', quantity: 20, unit: 'גליל', unit_price: 15 }] });
  assert.equal(r2.order.status, 'delivered');
  assert.equal(r2.stock_movements.length, 1);
  assert.equal(r2.stock_movements[0].product_name, 'אקרובט 69');
  const full = core.fullOrder(FARM, o.id);
  assert.deepEqual(full.items.map(i => i.delivered_quantity), [10, 20]);
  assert.equal(full.delivery_notes.length, 2);
  assert.ok(full.history.some(h => h.action === 'status' && h.to === 'delivered'));

  // כפילות מספר תעודה לאותו ספק נחסמת
  assert.throws(() => core.createDeliveryNote(FARM, 'x', { order_id: o.id, note_number: 'S-1001', items: [] }), /כבר קיימת/);
});

test('over-delivery is a quantity discrepancy; status change writes audit; expected note is not counted', () => {
  const { core } = setup();
  const o = core.createOrder(FARM, 'בודק', { direction: 'purchase', supplier_id: 'sup-1', status: 'ordered', items: [{ product_name: 'שק דשן', quantity: 10, unit: 'שק', unit_price: 50 }] });
  const future = core.createDeliveryNote(FARM, 'בודק', { order_id: o.id, delivery_date: '2026-11-05', items: [{ product_name: 'שק דשן', quantity: 10 }] });
  assert.equal(future.delivery_note.status, 'expected');
  assert.equal(future.order.status, 'ordered', 'תעודה צפויה לא נספרת כאספקה');
  const exp = core.listExpectedDeliveries(FARM, { from: '2026-11-05', to: '2026-11-05' });
  assert.equal(exp.expected_delivery_notes.length, 1);
  // התעודה הגיעה, בכמות גדולה מההזמנה
  const upd = core.updateDeliveryNote(FARM, 'בודק', future.delivery_note.id, { status: 'received', items: [{ product_name: 'שק דשן', quantity: 12 }] });
  assert.equal(upd.order.status, 'delivered');
  const disc = core.findDiscrepancies(FARM, {});
  assert.equal(disc.quantity.length, 1);
  assert.equal(disc.quantity[0].kind, 'over');
  assert.equal(disc.quantity[0].diff, 2);
  assert.equal(upd.delivery_note.history.filter(h => h.action === 'status').length, 1);
  // שינוי סטטוס ידני עם היסטוריה
  const c = core.updateOrderStatus(FARM, 'מנהל', o.id, 'cancelled', 'הספק לא עמד בזמנים');
  assert.equal(c.status, 'cancelled');
  assert.deepEqual(c.history.at(-1).note, 'הספק לא עמד בזמנים');
  assert.throws(() => core.updateOrderStatus(FARM, 'x', o.id, 'delivered'), /מבוטלת/);
});

test('match invoice to delivery notes by total (with VAT) and mark order invoiced', () => {
  const { core, get } = setup();
  const o = core.createOrder(FARM, 'בודק', { direction: 'purchase', supplier_id: 'sup-1', status: 'ordered', items: [{ product_name: 'אקרובט 69', quantity: 10, unit: 'ק"ג', unit_price: 300 }] });
  const n = core.createDeliveryNote(FARM, 'בודק', { order_id: o.id, note_number: 'S-1', delivery_date: '2026-10-20', items: [{ product_name: 'אקרובט 69', quantity: 10, unit: 'ק"ג', unit_price: 300 }] });
  // תעודה נוספת של אותו ספק שלא מתאימה לסכום
  core.createDeliveryNote(FARM, 'בודק', { supplier_id: 'sup-1', note_number: 'S-2', delivery_date: '2026-10-21', items: [{ product_name: 'חוט', quantity: 1, unit_price: 999 }] });
  const m = core.matchInvoiceToDeliveryNotes(FARM, 'בודק', { invoice_id: 'inv-1' });
  assert.equal(m.matched, true);
  assert.equal(m.matched_by, 'total');
  assert.deepEqual(m.delivery_notes.map(d => d.id), [n.delivery_note.id]);
  assert.equal(m.delivery_notes[0].status, 'invoiced');
  assert.equal(get('orders', o.id, FARM).status, 'invoiced');
  assert.deepEqual(get('invoices', 'inv-1', FARM).delivery_note_ids, [n.delivery_note.id]);
  // אין יותר פער "בלי חשבונית" לתעודה הזו
  const disc = core.findDiscrepancies(FARM, { days_without_invoice: 0 });
  assert.equal(disc.missing_invoice.filter(x => x.delivery_note_id === n.delivery_note.id).length, 0);
  // חשבונית שלא נמצאה
  assert.throws(() => core.matchInvoiceToDeliveryNotes(FARM, 'x', { invoice_id: 'nope' }), /invoice_id/);
});

test('outgoing delivery note links weighing certificates of the same customer and date', () => {
  const { core } = setup();
  const so = core.createOrder(FARM, 'בודק', { direction: 'sale', customer_id: 'cus-1', status: 'confirmed', items: [{ product_id: 'prod-1', quantity: 500, unit: 'ק"ג', unit_price: 4.5 }] });
  assert.equal(so.order_number, 'SO-0001');
  assert.equal(so.items[0].product_name, 'עגבנייה');
  const r = core.createDeliveryNote(FARM, 'בודק', { order_id: so.id, delivery_date: '2026-10-28', items: [{ product_id: 'prod-1', quantity: 500, unit_price: 4.5 }] });
  assert.equal(r.delivery_note.direction, 'out');
  assert.deepEqual(r.linked_weighing_certificates.map(c => c.id), ['cert-1']);
  assert.deepEqual(r.delivery_note.weighing_certificate_ids, ['cert-1']);
  assert.equal(r.stock_movements.length, 0, 'תעודה יוצאת לא נוגעת במלאי');
  assert.equal(r.order.status, 'delivered');
  const open = core.listOpenOrders(FARM, { direction: 'sale' });
  assert.equal(open.length, 0);
  const s = core.summary(FARM);
  assert.equal(s.open_orders.sale, 0);
});

test('farm isolation: records of another farm are invisible', () => {
  const { core } = setup();
  const o = core.createOrder(FARM, 'בודק', { direction: 'purchase', supplier_id: 'sup-1' });
  assert.equal(core.fullOrder('other-farm', o.id), null);
  assert.throws(() => core.createDeliveryNote('other-farm', 'x', { order_id: o.id }), /order_id/);
  assert.throws(() => core.createOrder('other-farm', 'x', { direction: 'purchase', supplier_id: 'sup-1' }), /supplier_id/);
});
