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

const { findDuplicateGroups, mergeRecordData, remapReferences, collectCatalogItems } = require('./maven');

test('duplicates: same Maven id / vat id / name group together; conflicting ids never merge', () => {
  const rows = [
    { id: 'a', name: 'חוות השרון', created_at: '2026-01-01' },
    { id: 'b', name: ' חוות  השרון ', maven_id: 'M1', created_at: '2026-02-01' },
    { id: 'c', name: 'Sharon Farm', vat_id: '51-234567-8', created_at: '2026-03-01' },
    { id: 'd', name: 'שם אחר', vat_id: '512345678', maven_id: 'M1', created_at: '2026-04-01' },
    { id: 'e', name: 'כהן', vat_id: '111' },
    { id: 'f', name: 'כהן', vat_id: '222' }, // אותו שם, ח.פ שונה → לא מאחדים
    { id: 'g', name: 'יחיד' },
  ];
  const groups = findDuplicateGroups('suppliers', rows, id => (id === 'a' ? 5 : 0));
  assert.equal(groups.length, 1);
  assert.equal(groups[0].keep.id, 'b'); // יש לו maven_id; d גם, אבל b עם אותו מזהה נוצר קודם
  assert.deepEqual(groups[0].merge.map(r => r.id).sort(), ['a', 'c', 'd']);
});

test('duplicates: two different Maven ids with the same name stay separate', () => {
  const rows = [{ id: 'x', name: 'לקוח', maven_id: 'M1' }, { id: 'y', name: 'לקוח', maven_id: 'M2' }, { id: 'z', name: 'לקוח' }];
  const groups = findDuplicateGroups('customers', rows);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].merge.length, 1); // z מצטרף לאחד מהם בלבד
});

test('merge fills empty fields, unions emails, keeps farmer flag', () => {
  const out = mergeRecordData({ id: 'k', name: 'A', phone: '', email_addresses: ['a@x.co'], is_farmer: false },
    [{ id: 'd', name: 'A2', phone: '050', email_addresses: ['A@x.co', 'b@x.co'], is_farmer: true, address: 'כפר' }]);
  assert.equal(out.name, 'A');
  assert.equal(out.phone, '050');
  assert.equal(out.address, 'כפר');
  assert.deepEqual(out.email_addresses, ['a@x.co', 'b@x.co']);
  assert.equal(out.is_farmer, true);
  assert.equal(out.id, 'k');
});

test('remap references: scalar, array and object-key refs', () => {
  const idMap = new Map([['p2', 'p1']]);
  const rows = [
    { id: 'i1', data: { product_id: 'p2', net_weight: 5 } },
    { id: 'k1', data: { product_ids: ['p1', 'p2', 'p3'], product_weights: { p2: 2, p3: 3 } } },
    { id: 'x', data: { product_id: 'p3' } },
  ];
  const changed = remapReferences('products', rows, idMap);
  assert.equal(changed.length, 2);
  assert.equal(changed[0].data.product_id, 'p1');
  assert.deepEqual(changed[1].data.product_ids, ['p1', 'p3']);
  assert.deepEqual(changed[1].data.product_weights, { p1: 2, p3: 3 });
});

test('catalog items from Maven documents: name before " · ", latest price, equipment flagged, free lines skipped', () => {
  const docs = [
    { items: [{ id: 'G1', item_nubmer: 'FF-1', description: 'תות שדה · איכות א · לפי ק"ג', price: 10 }, { description: 'שורה חופשית', price: 5 }] },
    { items: [{ id: 'G1', item_nubmer: 'FF-1', description: 'תות שדה · לפי יחידה', price: 12, no_vat: true }, { id: 'G2', item_nubmer: 'PK-1', description: 'אריזה · קרטון 3 ק"ג', price: 0 }] },
  ];
  const items = collectCatalogItems(docs);
  assert.equal(items.length, 2);
  assert.deepEqual(items[0], { maven_item_id: 'G1', maven_item_no: 'FF-1', name: 'תות שדה', equipment: null, price: 12, no_vat: true, uses: 2 });
  assert.equal(items[1].equipment, 'אריזה');
  assert.equal(items[1].name, 'קרטון 3 ק"ג');
});

const { buildExpenseUpload } = require('./maven');
test('supplier invoice → Maven expense upload: filename + description', () => {
  const r = buildExpenseUpload({ supplier_name: 'דשנים כימיקלים / בע"מ', invoice_number: 'INV 77', date: '2026-11-03', total: 1170.456, notes: 'דשן לחממה 4' }, '.pdf');
  assert.equal(r.filename, 'דשנים_כימיקלים_בעמ_INV_77_2026-11-03.pdf');
  assert.equal(r.description, "דשנים כימיקלים / בע\"מ · מס' INV 77 · 03/11/2026 · 1170.46 ₪ · דשן לחממה 4 · מ-FarmFlow");
});
test('expense upload without details falls back to generic names; foreign currency shown', () => {
  assert.deepEqual(buildExpenseUpload({}, '.jpg'), { filename: 'חשבונית.jpg', description: 'מ-FarmFlow' });
  assert.match(buildExpenseUpload({ total: 0, currency: 'USD' }, '.pdf').description, /^0 USD · /);
  assert.ok(buildExpenseUpload({ notes: 'x'.repeat(2000) }, '.pdf').description.length <= 1000);
});
