// ─── Invoice Maven integration ────────────────────────────────────────────────
// אינטגרציה עם Invoice Maven (app.invoice-maven.co.il) לכל משק בנפרד:
//   • הגדרות: מפתח API (מוצפן), פרטי קשר של המפתח (חובה ב-API שלהם), מצב בדיקה.
//   • משיכת לקוחות וספקים מ-Maven לרשומות המשק (התאמה לפי maven_id / ח.פ / שם).
//   • סנכרון מוצרים ל-Maven כפריטים עם מק"ט משותף (FF-xxxxxxxx) — "קודים משותפים".
//   • הפקת תעודת משלוח / חשבונית / חשבונית מס-קבלה מתוך תעודת שקילה.
// ה-API של Maven: כל הקריאות POST+JSON, api_key בכותרת, test=1 לא שומר כלום.
const MAVEN_HOST = 'app.invoice-maven.co.il';
const DOC_TYPES = { 200: 'תעודת משלוח', 305: 'חשבונית מס', 320: 'חשבונית מס/קבלה', 10: 'הצעת מחיר', 100: 'הזמנה' };
const ALLOWED_DOC_TYPES = new Set([200, 305, 320, 10, 100]);

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
      if (e.code === '63') e.message = 'המנוי ב-Invoice Maven אינו פעיל (קוד 63)';
      throw e;
    }
    return data;
  }

  return { loadConfig, saveConfig, publicConfig, mavenCall };
}

function registerMavenRoutes(app, deps) {
  const { db, getUser, authMiddleware, getFarmMember, encryptSecret, decryptSecret, httpsRequest, NOW, uuidv4 } = deps;

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
  const normName = (s) => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();
  const ddmmyyyy = (iso) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    if (!m) { const d = new Date(); return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`; }
    return `${m[3]}/${m[2]}/${m[1]}`;
  };
  const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
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

  // ── document from weighing certificate ──
  function buildDocument(cfg, farmId, cert, items, opts) {
    const customer = cert.customer_id ? rowsOf('customers', farmId).find(c => c.id === cert.customer_id) : null;
    const products = rowsOf('products', farmId);
    const lines = items.map(it => {
      const perKg = it.pricing_method === 'per_kg';
      const qty = perKg ? Number(it.net_weight) || 0 : Number(it.package_count) || 0;
      const disc = Number(it.discount_percentage) || 0;
      const price = round2((Number(it.price_per_unit) || 0) * (1 - disc / 100));
      const product = products.find(p => p.id === it.product_id);
      const desc = [it.product_name || product?.name || 'פריט', it.quality ? `איכות ${it.quality}` : null, perKg ? 'לפי ק"ג' : 'לפי יחידה'].filter(Boolean).join(' · ');
      const line = { description: desc, price, quantity: qty > 0 ? qty : 1 };
      if (product?.maven_item_no) line.item_number = product.maven_item_no;
      // פירות וירקות פטורים ממע"מ — לפי דגל המוצר, או מסמך שלם ללא מע"מ
      if (product?.vat_exempt || opts.no_vat) line.no_vat = true;
      return line;
    });
    // תעודת משלוח: גם האריזות והמשטחים מופיעים כשורות כמות בלי מחיר (לצורך החזרת ציוד / ספירה אצל הלקוח)
    if (Number(opts.doc_type) === 200) {
      const packagings = rowsOf('packagings', farmId);
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
      body.remarks = [body.remarks, cert.vehicle_number ? `רכב ${cert.vehicle_number}` : null, cert.driver_name ? `נהג ${cert.driver_name}` : null].filter(Boolean).join(' · ');
    }
    return body;
  }

  // ── routes ──
  app.get('/api/integrations/maven/config', authMiddleware, (req, res) => {
    const ctx = farmOf(req, res); if (!ctx) return;
    res.json({ farm_id: ctx.farmId, doc_types: DOC_TYPES, ...publicConfig(loadConfig(ctx.farmId)) });
  });

  app.post('/api/integrations/maven/config', authMiddleware, (req, res) => {
    const ctx = farmOf(req, res, { manage: true }); if (!ctx) return;
    const cfg = loadConfig(ctx.farmId);
    const b = req.body || {};
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
    res.json({ farm_id: ctx.farmId, doc_types: DOC_TYPES, ...publicConfig(cfg) });
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
    try {
      let result;
      if (what === 'customers') result = await syncCustomers(cfg, ctx.farmId, by);
      else if (what === 'suppliers') result = await syncSuppliers(cfg, ctx.farmId, by);
      else if (what === 'items') result = await syncItems(cfg, ctx.farmId);
      else return res.status(400).json({ error: 'what must be customers | suppliers | items' });
      cfg.last_sync = { ...(cfg.last_sync || {}), [what]: { at: NOW(), by, ...result } };
      saveConfig(ctx.farmId, cfg);
      console.log(`[maven] farm=${ctx.farmId} sync ${what}:`, JSON.stringify(result));
      res.json({ ok: true, what, ...result, test_mode: cfg.test_mode !== false });
    } catch (e) {
      console.error(`[maven] sync ${what} failed:`, e.message);
      res.status(422).json({ ok: false, error: e.message, code: e.code || null });
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

  app.post('/api/integrations/maven/document', authMiddleware, async (req, res) => {
    const ctx = farmOf(req, res, { write: true }); if (!ctx) return;
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
      const patch = { maven_documents: [...(cert.maven_documents || []), entry] };
      if (docType === 200 && !entry.test) { patch.delivery_note_issued = true; patch.delivery_note_date = NOW().slice(0, 10); }
      updateRow(cert.id, patch);
      console.log(`[maven] farm=${ctx.farmId} cert=${cert.id} issued ${docType} doc_no=${entry.doc_no} test=${entry.test}`);
      res.json({ ok: true, document: entry, warnings: [r.allocation_warning, r.payment_link_warning].filter(Boolean) });
    } catch (e) {
      console.error('[maven] addDocument failed:', e.message);
      res.status(422).json({ ok: false, error: e.message, code: e.code || null });
    }
  });
}

module.exports = { registerMavenRoutes, makeMavenCore, DOC_TYPES };
