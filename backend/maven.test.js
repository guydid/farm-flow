// בדיקות לבונה המסמכים של Maven מתוך תעודת משלוח יוצאת — טהור, בלי DB ובלי רשת.
//   node --test backend/maven.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildNoteDocument } = require('./maven');

const cfg = { vat_included: false, test_mode: true };
const note = { id: 'dn-1', direction: 'out', note_number: 'OUT-0007', delivery_date: '2026-10-29', order_number: 'SO-0003', counterparty_name: 'שופרסל', customer_id: 'cus-1', driver_name: 'יוסי', vehicle: '12-345-67', received_by: 'דנה' };
const customer = { id: 'cus-1', name: 'שופרסל בע"מ', identification: '510000000', email: 'ap@shufersal.co.il', phone: '03-0000000', address: 'ראשון לציון' };
const products = [{ id: 'prod-1', name: 'עגבנייה', maven_item_no: 'FF-PROD0001', vat_exempt: true }, { id: 'prod-2', name: 'קרטון 5 ק"ג' }];
const items = [
  { product_id: 'prod-1', product_name: 'עגבנייה', quantity: 120, unit: 'ק"ג', unit_price: 4.5, notes: 'סוג א' },
  { product_id: null, product_name: 'קרטון 5 ק"ג', quantity: 24, unit: "יח'", unit_price: null },
];

test('outgoing delivery note → Maven delivery note (200): customer, lines, codes, idempotent doc_id', () => {
  const body = buildNoteDocument(cfg, { note, items, customer, products }, { doc_type: 200, document_date: '2026-10-30' });
  assert.equal(body.doc_type, 200);
  assert.deepEqual(body.customer, { name: 'שופרסל בע"מ', identification: '510000000', email: 'ap@shufersal.co.il', cell_phone: '03-0000000', address: 'ראשון לציון' });
  assert.equal(body.items.length, 2);
  assert.deepEqual(body.items[0], { description: 'עגבנייה (ק"ג) סוג א', price: 4.5, quantity: 120, item_number: 'FF-PROD0001', no_vat: true });
  assert.deepEqual(body.items[1], { description: 'קרטון 5 ק"ג', price: 0, quantity: 24 }); // מוצר הותאם לפי שם, בלי מק"ט ובלי מחיר
  assert.equal(body.document_date, '30/10/2026');
  assert.equal(body.description, 'תעודת משלוח OUT-0007 מתאריך 29/10/2026 · הזמנה SO-0003');
  assert.equal(body.remarks, 'רכב 12-345-67 · נהג יוסי · נמסר ע"י דנה');
  assert.equal(body.doc_id, 'ff-dn-dn-1-200');
  assert.equal(body.vat_included, false);
  assert.equal(body.send_to_customer, false);
  assert.equal(body.no_vat, undefined);
});

test('invoice from the note: no_vat on the whole document, remarks, vat_included from config, force → unique doc_id', () => {
  const body = buildNoteDocument({ ...cfg, vat_included: true }, { note, items, customer, products }, { doc_type: 305, no_vat: true, remarks: 'תשלום שוטף+30', send_to_customer: true, force: true });
  assert.equal(body.doc_type, 305);
  assert.equal(body.no_vat, true);
  assert.ok(body.items.every(l => l.no_vat));
  assert.equal(body.vat_included, true);
  assert.equal(body.send_to_customer, true);
  assert.match(body.remarks, /^תשלום שוטף\+30 · רכב/);
  assert.match(body.doc_id, /^ff-dn-dn-1-305-\d+$/);
});

test('note without a linked customer record falls back to counterparty_name; free-text lines get quantity 1 when invalid', () => {
  const body = buildNoteDocument(cfg, { note: { ...note, customer_id: null, order_number: null, vehicle: '', driver_name: '', received_by: '' }, items: [{ product_name: 'משטח', quantity: 0 }], customer: null, products: [] }, { doc_type: 200 });
  assert.deepEqual(body.customer, { name: 'שופרסל' });
  assert.deepEqual(body.items, [{ description: 'משטח', price: 0, quantity: 1 }]);
  assert.equal(body.description, 'תעודת משלוח OUT-0007 מתאריך 29/10/2026');
  assert.equal(body.remarks, undefined);
});
