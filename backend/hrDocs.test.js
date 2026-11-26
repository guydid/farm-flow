// בדיקות למסמכי משאבי אנוש ב-MCP: payslips / employment_contracts / medical_insurance_policies.
//   node --test backend/hrDocs.test.js   (ללא תלויות — רץ גם ב-CI לפני הפריסה)
// mcp.js נטען עם app מדומה; כל קריאה עוברת דרך handler ה-JSON-RPC האמיתי (/mcp).
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { makeHrCore } = require('./hrDocs');

let Database;
try { Database = require('better-sqlite3'); new Database(':memory:').close(); }
catch { Database = require('node:sqlite').DatabaseSync; }

const FARM = 'farm-1', OTHER = 'farm-2';
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');

function setup({ today = '2026-11-26' } = {}) {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE entities (id TEXT NOT NULL, entity_type TEXT NOT NULL, farm_id TEXT, data TEXT NOT NULL DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')), PRIMARY KEY (id, entity_type));`);
  let tick = 0;
  const NOW = () => new Date(Date.parse(`${today}T08:00:00Z`) + 1000 * tick++).toISOString();
  const put = (type, id, data, farmId = FARM) => db.prepare('INSERT INTO entities (id, entity_type, farm_id, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, type, farmId, JSON.stringify(data), NOW(), NOW());
  put('farms', FARM, { name: 'משק בדיקה' });
  put('employees', 'emp-1', { full_name: 'Somchai Test', passport_number: 'AA1234567', insurance_details: { company: 'הראל', policy_number: 'OLD-1', health_fund_url: 'keep-me' } });
  put('employees', 'emp-2', { full_name: 'Niran Two', passport_number: 'BB7654321' });
  put('employees', 'emp-x', { full_name: 'Other Farm' }, OTHER);
  // רשומות "ישנות" מהגרסה הקודמת: הכול ב-employee_documents עם category
  put('employee_documents', 'legacy-slip', { employee_id: 'emp-1', category: 'payslip', period: '2026-09', title: 'תלוש 09', file_url: 'https://farm.example/uploads/a.pdf', sign: { status: 'none' } });
  put('employee_documents', 'legacy-other', { employee_id: 'emp-1', category: 'other', title: 'אישור', file_url: 'https://farm.example/uploads/b.pdf', sign: { status: 'none' } });

  const users = { owner: { id: 'u-owner', full_name: 'Owner', farm_ids: [FARM], current_farm_id: FARM }, worker: { id: 'u-worker', full_name: 'W', farm_ids: [FARM], current_farm_id: FARM } };
  const roles = { 'u-owner': 'owner', 'u-worker': 'worker' };
  const routes = {};
  const reg = (m) => (p, ...h) => { routes[`${m} ${p}`] = h[h.length - 1]; };
  const app = { post: reg('POST'), get: reg('GET'), delete: reg('DELETE'), use() {} };
  const formatEntity = (row) => row && ({ id: row.id, ...JSON.parse(row.data || '{}'), farm_id: row.farm_id, created_at: row.created_at, updated_at: row.updated_at });
  const listEntities = (user, entity) => ({ status: 200, body: db.prepare('SELECT * FROM entities WHERE entity_type = ? AND farm_id = ?').all(entity, user.current_farm_id).map(formatEntity) });
  const uploads = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-hr-'));
  fs.writeFileSync(path.join(uploads, 'policy.pdf'), '%PDF-1.4 test policy');
  require('./mcp')(app, {
    db, listEntities, formatEntity, NOW, uuidv4: crypto.randomUUID,
    getUser: (id) => Object.values(users).find(u => u.id === id) || null,
    getFarmMember: (farmId, userId) => (farmId === FARM && roles[userId] ? { role: roles[userId] } : null),
    authMiddleware: (req, res, next) => next(), syncSeedingDates() {}, computePesticideStock() {}, upsertPesticidePrice() {},
    procurement: null, UPLOADS_DIR: uploads, fileLinkSecret: 'test-secret',
  });
  // employeeDocs.js מריץ את ההגירה בעלייה — כאן ישירות דרך הליבה
  const hr = makeHrCore({ db, NOW, uuidv4: crypto.randomUUID, today: () => today });
  const migrated = hr.migrate();

  const token = (user, canWrite) => {
    const t = `ffmcp_${crypto.randomBytes(8).toString('hex')}`;
    db.prepare('INSERT INTO mcp_tokens (id, user_id, farm_id, name, token_hash, token_prefix, can_write) VALUES (?, ?, ?, ?, ?, ?, ?)').run(crypto.randomUUID(), user.id, FARM, 'test', sha(t), t.slice(0, 12), canWrite ? 1 : 0);
    return t;
  };
  const fakeRes = () => { const r = { statusCode: 200, headers: {}, body: undefined, file: null }; Object.assign(r, { status(c) { r.statusCode = c; return r; }, set(k, v) { r.headers[k] = v; return r; }, json(b) { r.body = b; return r; }, end() { return r; }, sendFile(p) { r.file = p; return r; }, redirect(c, u) { r.statusCode = c; r.location = u; return r; } }); return r; };
  let rpcId = 0;
  const call = (tok, name, args) => {
    const res = fakeRes();
    routes['POST /mcp']({ headers: { authorization: `Bearer ${tok}`, host: 'farm.example', 'x-forwarded-proto': 'https' }, params: {}, body: { jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args } } }, res);
    const out = res.body.result;
    const text = out.content[0].text;
    if (out.isError) return { error: text };
    return JSON.parse(text);
  };
  const tools = (tok) => { const res = fakeRes(); routes['POST /mcp']({ headers: { authorization: `Bearer ${tok}` }, params: {}, body: { jsonrpc: '2.0', id: 1, method: 'tools/list' } }, res); return res.body.result.tools; };
  const download = (url, auth) => { const u = new URL(url); const [, , , entity, id, kind] = u.pathname.split('/'); const res = fakeRes(); routes['GET /mcp/files/:entity/:id/:kind']({ headers: auth ? { authorization: `Bearer ${auth}` } : {}, params: { entity, id, kind }, query: Object.fromEntries(u.searchParams) }, res); return res; };
  return { db, hr, put, migrated, owner: token(users.owner, true), ownerRead: token(users.owner, false), worker: token(users.worker, true), call, tools, download, uploads };
}

const HR = ['payslips', 'employment_contracts', 'medical_insurance_policies'];

test('the three entities are in the tool enums (list/get/describe/create/update)', () => {
  const { tools, owner } = setup();
  const byName = Object.fromEntries(tools(owner).map(t => [t.name, t]));
  for (const tool of ['list_records', 'get_record', 'describe_entity', 'create_record', 'update_record']) {
    for (const e of HR) assert.ok(byName[tool].inputSchema.properties.entity.enum.includes(e), `${tool} enum lacks ${e}`);
  }
  assert.ok(byName.list_records.inputSchema.properties.employee_id, 'list_records has employee_id');
});

test('migration: legacy payslip moved, insurance_details backfilled as a policy', () => {
  const { db, migrated } = setup();
  assert.equal(migrated.payslips, 1);
  assert.equal(migrated.backfilled_policies, 1);
  assert.ok(db.prepare("SELECT 1 FROM entities WHERE entity_type='payslips' AND id='legacy-slip'").get());
  assert.ok(!db.prepare("SELECT 1 FROM entities WHERE entity_type='employee_documents' AND id='legacy-slip'").get());
  assert.ok(db.prepare("SELECT 1 FROM entities WHERE entity_type='employee_documents' AND id='legacy-other'").get(), '"other" stays');
});

test('create + list_records + get_record for every new entity', () => {
  const { call, owner } = setup();
  const slip = call(owner, 'create_record', { entity: 'payslips', data: { passport_number: 'AA1234567', period: '2026-10', employer: 'דוד גיא', gross: '7,371.00', net: 6854, file_url: 'https://farm.example/uploads/slip.pdf' } });
  assert.equal(slip.error, undefined, slip.error);
  assert.equal(slip.employee_id, 'emp-1');
  assert.equal(slip.gross, 7371);
  assert.equal(slip.period_start, '2026-10-01');
  assert.equal(slip.month, 10);
  const contract = call(owner, 'create_record', { entity: 'employment_contracts', data: { employee_id: 'emp-2', contract_type: 'foreign_worker', signed_date: '2026-01-10', start_date: '2026-02-01', end_date: '2027-01-31', employer: 'דוד מנשה' } });
  assert.equal(contract.error, undefined, contract.error);
  const policy = call(owner, 'create_record', { entity: 'medical_insurance_policies', data: { employee_id: 'emp-2', insurance_company: 'הפניקס', policy_number: 'PH-9', start_date: '2026-01-01', end_date: '2026-12-31', agent: 'סוכנות ביטוח', health_fund: 'כללית' } });
  assert.equal(policy.error, undefined, policy.error);

  for (const [entity, rec] of [['payslips', slip], ['employment_contracts', contract], ['medical_insurance_policies', policy]]) {
    const list = call(owner, 'list_records', { entity });
    assert.ok(list.total >= 1, `${entity}: list_records returned nothing`);
    assert.ok(list.records.some(r => r.id === rec.id), `${entity}: created record listed`);
    for (const r of list.records) {
      assert.equal(r.farm_id, 'farm-1');
      assert.ok(r.created_at && r.updated_at, `${entity}: timestamps`);
      assert.ok(!JSON.stringify(r).includes('token_hash'));
    }
    const got = call(owner, 'get_record', { entity, id: rec.id });
    assert.equal(got.error, undefined, got.error);
    assert.equal(got.id, rec.id);
    assert.equal(got.employee_id, rec.employee_id);
    const d = call(owner, 'describe_entity', { entity });
    assert.match(d.description, /[א-ת]/, `${entity}: Hebrew description`);
    assert.ok(d.fields.length > 5 && d.fields.every(f => f.field), `${entity}: fields`);
    assert.ok(d.fields.filter(f => f.description).every(f => /[א-ת]/.test(f.description)), `${entity}: Hebrew field descriptions`);
  }
  assert.equal(call(owner, 'get_record', { entity: 'employment_contracts', id: contract.id }).contract_type, 'foreign_worker');
  assert.equal(call(owner, 'get_record', { entity: 'medical_insurance_policies', id: policy.id }).is_active, true);
});

test('list_records filters by employee_id and date range', () => {
  const { call, owner } = setup();
  for (const [emp, period] of [['emp-1', '2026-03'], ['emp-1', '2026-06'], ['emp-2', '2026-06'], ['emp-1', '2025-12']]) {
    const r = call(owner, 'create_record', { entity: 'payslips', data: { employee_id: emp, period } });
    assert.equal(r.error, undefined, r.error);
  }
  const all1 = call(owner, 'list_records', { entity: 'payslips', employee_id: 'emp-1' });
  assert.equal(all1.total, 4); // 3 + legacy 2026-09
  assert.ok(all1.records.every(r => r.employee_id === 'emp-1'));
  const y2026 = call(owner, 'list_records', { entity: 'payslips', employee_id: 'emp-1', date_from: '2026-01-01', date_to: '2026-12-31' });
  assert.deepEqual(y2026.records.map(r => r.period).sort(), ['2026-03', '2026-06', '2026-09']);
  const q2 = call(owner, 'list_records', { entity: 'payslips', date_from: '2026-04-01', date_to: '2026-06-30' });
  assert.deepEqual(q2.records.map(r => `${r.employee_id}:${r.period}`).sort(), ['emp-1:2026-06', 'emp-2:2026-06']);
  const viaFilters = call(owner, 'list_records', { entity: 'payslips', filters: { employee_id: 'emp-2' } });
  assert.equal(viaFilters.total, 1);
});

test('insurance: every policy is its own record; active one syncs to employees.insurance_details', () => {
  const { call, owner, db } = setup();
  const emp = () => JSON.parse(db.prepare("SELECT data FROM entities WHERE entity_type='employees' AND id='emp-1'").get().data);
  // backfilled policy from the card exists; add the history
  const old = call(owner, 'create_record', { entity: 'medical_insurance_policies', data: { employee_id: 'emp-1', insurance_company: 'מגדל', policy_number: 'MG-1', start_date: '2025-01-01', end_date: '2025-12-31' } });
  assert.equal(old.is_active, false);
  const cur = call(owner, 'create_record', { entity: 'medical_insurance_policies', data: { employee_id: 'emp-1', insurance_company: 'איילון', policy_number: 'AY-2', start_date: '2026-01-01', end_date: '2026-12-31', health_fund: 'מכבי', file_url: 'https://farm.example/uploads/policy.pdf' } });
  const history = call(owner, 'list_records', { entity: 'medical_insurance_policies', employee_id: 'emp-1' });
  assert.equal(history.total, 3, 'backfilled + 2 — none overwritten');
  let ins = emp().insurance_details;
  assert.equal(ins.company, 'איילון');
  assert.equal(ins.policy_number, 'AY-2');
  assert.equal(ins.policy_end_date, '2026-12-31');
  assert.equal(ins.health_fund, 'מכבי');
  assert.equal(ins.health_fund_url, 'keep-me', 'other insurance_details keys kept');
  assert.equal(ins.policy_record_id, cur.id);
  // update the active policy → synced again
  const upd = call(owner, 'update_record', { entity: 'medical_insurance_policies', id: cur.id, data: { policy_number: 'AY-2B' } });
  assert.equal(upd.error, undefined, upd.error);
  ins = emp().insurance_details;
  assert.equal(ins.policy_number, 'AY-2B');
  assert.equal(old.employee_id, 'emp-1');
});

test('file access: get_record download_url (signed) and Bearer endpoint, both farm-scoped', () => {
  const { call, owner, worker, download, uploads, put } = setup();
  const p = call(owner, 'create_record', { entity: 'medical_insurance_policies', data: { employee_id: 'emp-2', insurance_company: 'הפניקס', start_date: '2026-01-01', file_url: 'https://farm.example/uploads/policy.pdf' } });
  const got = call(owner, 'get_record', { entity: 'medical_insurance_policies', id: p.id });
  const f = got.files.find(x => x.kind === 'original');
  assert.ok(f.download_url && f.download_endpoint && f.download_url_expires_at);
  let res = download(f.download_url);
  assert.equal(res.statusCode, 200);
  assert.equal(res.file, path.join(uploads, 'policy.pdf'));
  res = download(f.download_url.replace(/sig=[^&]+/, 'sig=forged'));
  assert.equal(res.statusCode, 401);
  res = download(f.download_endpoint, owner);
  assert.equal(res.statusCode, 200, 'Bearer MCP token works');
  res = download(f.download_endpoint, worker);
  assert.equal(res.statusCode, 401, 'worker-role token cannot download HR files');
  // another farm's record is not reachable through this farm's token
  put('payslips', 'slip-other', { employee_id: 'emp-x', period: '2026-10', file_url: 'https://farm.example/uploads/policy.pdf' }, OTHER);
  res = download('https://farm.example/mcp/files/payslips/slip-other/original', owner);
  assert.equal(res.statusCode, 401);
});

test('farm separation and HR role restriction', () => {
  const { call, owner, ownerRead, worker, put } = setup();
  put('payslips', 'slip-other', { employee_id: 'emp-x', period: '2026-10' }, OTHER);
  put('employment_contracts', 'c-other', { employee_id: 'emp-x', contract_type: 'other' }, OTHER);
  assert.ok(!call(owner, 'list_records', { entity: 'payslips' }).records.some(r => r.id === 'slip-other'));
  assert.match(call(owner, 'get_record', { entity: 'payslips', id: 'slip-other' }).error, /Not found/);
  assert.match(call(owner, 'get_record', { entity: 'employment_contracts', id: 'c-other' }).error, /Not found/);
  assert.match(call(owner, 'create_record', { entity: 'payslips', data: { employee_id: 'emp-x', period: '2026-10' } }).error, /Unknown employee_id/);
  assert.match(call(worker, 'list_records', { entity: 'payslips' }).error, /owners\/managers/);
  assert.match(call(worker, 'get_record', { entity: 'medical_insurance_policies', id: 'x' }).error, /owners\/managers/);
  assert.match(call(ownerRead, 'create_record', { entity: 'payslips', data: { employee_id: 'emp-1', period: '2026-10' } }).error, /read-only/);
  // worker still reads ordinary entities
  assert.equal(call(worker, 'list_records', { entity: 'employees' }).error, undefined);
});

test('validation: bad period / dates / contract type / foreign upload; signed file cannot be replaced', () => {
  const { call, owner, db, put } = setup();
  assert.match(call(owner, 'create_record', { entity: 'payslips', data: { employee_id: 'emp-1', period: '2026-13' } }).error, /period/);
  assert.match(call(owner, 'create_record', { entity: 'employment_contracts', data: { employee_id: 'emp-1', contract_type: 'forever' } }).error, /contract_type/);
  assert.match(call(owner, 'create_record', { entity: 'employment_contracts', data: { employee_id: 'emp-1', start_date: '2026-05-01', end_date: '2026-01-01' } }).error, /before/);
  assert.match(call(owner, 'create_record', { entity: 'medical_insurance_policies', data: { employee_id: 'emp-1' } }).error, /insurance_company/);
  db.prepare("INSERT INTO entities (id, entity_type, farm_id, data) VALUES ('up_foreign.pdf','uploads',?,'{}')").run(OTHER);
  assert.match(call(owner, 'create_record', { entity: 'payslips', data: { employee_id: 'emp-1', period: '2026-10', file_url: 'https://farm.example/uploads/foreign.pdf' } }).error, /another farm/);
  put('payslips', 'signed-1', { employee_id: 'emp-1', period: '2026-08', file_url: 'https://farm.example/uploads/s.pdf', sign: { status: 'signed', token_hash: 'h', signed_file_url: 'https://farm.example/uploads/signed.pdf' } });
  assert.match(call(owner, 'update_record', { entity: 'payslips', id: 'signed-1', data: { file_url: 'https://farm.example/uploads/new.pdf' } }).error, /signed/);
  const ok = call(owner, 'update_record', { entity: 'payslips', id: 'signed-1', data: { gross: 5000, sign: { status: 'none' } } });
  assert.equal(ok.sign_status, 'signed', 'sign cannot be changed via MCP');
  assert.equal(ok.gross, 5000);
  assert.deepEqual(ok.files.map(f => f.kind), ['original', 'signed']);
});
