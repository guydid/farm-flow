// ─── תיק עובד: תלושי שכר, חוזה העסקה, ביטוח רפואי + חתימה מרחוק ─────────────────
// כל סוג נשמר כישות משלו (hrDocs.js): payslips / employment_contracts / medical_insurance_policies,
// ומסמך "אחר" ב-employee_documents. כולם פנימיים לראוטים הגנריים (תלושים רגישים): בעלים/מנהל בלבד.
// חתימה: המנהל מפיק קישור חד-פעמי (טוקן אקראי; נשמר רק ה-hash) ושולח לעובד (וואטסאפ/העתקה).
// העובד פותח בלי התחברות, רואה את המסמך, מקליד שם וחותם באצבע. השרת מייצר PDF חתום:
// המקור + חותמת החתימה בעמוד האחרון + עמוד תיעוד (תאריך, IP, SHA-256 של המקור).
// את בלוק החתימה (חתימה + שם + תאריך, בכל שפה) מצייר הדפדפן — ל-pdf-lib אין גופן עברי/תאילנדי.
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

const { makeHrCore, DOC_TYPES, TYPE_OF_CATEGORY, CATEGORY_LABELS: CATEGORIES } = require('./hrDocs');
const SIGN_TTL_DAYS = 14;
const MAX_SIG_BYTES = 1.5 * 1024 * 1024;
const MAX_PAGES_PREVIEW = 30;

const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const ascii = (s, n = 200) => String(s || '').replace(/[^\x20-\x7E]/g, '?').slice(0, n);

function registerEmployeeDocRoutes(app, deps) {
  const { db, getUser, authMiddleware, getFarmMember, NOW, uuidv4, UPLOADS_DIR, imagesToPdf, execFile } = deps;
  const hr = makeHrCore({ db, NOW, uuidv4 });
  try { const m = hr.migrate(); if (Object.values(m).some(Boolean)) console.log('[hr-docs] migrated', JSON.stringify(m)); }
  catch (e) { console.error('[hr-docs] migration failed:', e.message); }
  const IN_TYPES = DOC_TYPES.map(() => '?').join(',');

  const parse = (r) => { try { return { id: r.id, farm_id: r.farm_id, created_at: r.created_at, updated_at: r.updated_at, entity_type: r.entity_type, ...JSON.parse(r.data) }; } catch { return { id: r.id, farm_id: r.farm_id, entity_type: r.entity_type }; } };
  const publicDoc = (d) => { const { entity_type, ...rest } = d; return hr.view(entity_type || TYPE_OF_CATEGORY[d.category] || 'employee_documents', rest); };
  const updateData = (row, fn) => {
    const r = db.prepare('SELECT data FROM entities WHERE id = ? AND entity_type = ?').get(row.id, row.entity_type);
    if (!r) return null;
    let d = {}; try { d = JSON.parse(r.data); } catch { /* ignore */ }
    const next = fn(d) || d;
    db.prepare('UPDATE entities SET data = ?, updated_at = ? WHERE id = ? AND entity_type = ?').run(JSON.stringify(next), NOW(), row.id, row.entity_type);
    return next;
  };

  // בעלים/מנהל של המשק (או אדמין)
  const managerCtx = (req, res, farmId) => {
    const user = getUser(req.user.id);
    if (!user) { res.status(401).json({ error: 'Unauthorized' }); return null; }
    if (!farmId) { res.status(404).json({ error: 'Not found' }); return null; }
    if (user.is_admin) return { user };
    const role = getFarmMember(farmId, user.id)?.role;
    if (!['owner', 'manager'].includes(role)) { res.status(403).json({ error: 'תיק העובד זמין לבעלים ולמנהלים בלבד' }); return null; }
    return { user };
  };
  const employeeRow = (id) => db.prepare("SELECT * FROM entities WHERE entity_type = 'employees' AND id = ?").get(id);
  const docRow = (id) => db.prepare(`SELECT * FROM entities WHERE entity_type IN (${IN_TYPES}) AND id = ?`).get(...DOC_TYPES, id);

  const uploadName = (url) => {
    const m = String(url || '').match(/\/uploads\/([A-Za-z0-9._-]+)(?:[?#].*)?$/);
    return m ? m[1] : null;
  };
  const uploadPath = (url) => {
    const n = uploadName(url);
    if (!n) return null;
    const p = path.join(UPLOADS_DIR, n);
    return fs.existsSync(p) ? p : null;
  };
  const fileUrlFor = (req, name) => {
    const host = (req.headers['x-forwarded-host'] || req.headers.host || 'localhost').split(':')[0];
    const proto = req.headers['x-forwarded-proto'] || 'http';
    return `${proto}://${host}/uploads/${name}`;
  };
  const registerFile = (name, farmId, size, originalName) => {
    const now = NOW();
    db.prepare("INSERT OR REPLACE INTO entities (id, entity_type, farm_id, data, created_at, updated_at) VALUES (?, 'uploads', ?, ?, ?, ?)")
      .run(`up_${name}`, farmId, JSON.stringify({ filename: name, original_name: originalName, size, uploader_id: null }), now, now);
  };

  // ── דף שעות לתלוש — מועלה ע"י המנהל ונחתם ע"י העובד יחד עם התלוש ──────────
  // המסמך שהעובד רואה וחותם: התלוש, ואם יש דף שעות — התלוש + דף השעות כ-PDF אחד (נבנה לפי דרישה, במטמון)
  const BUNDLE_DIR = path.join(os.tmpdir(), 'ff-sign-bundles');
  const bundleParts = new Map();
  async function signSource(d) {
    const main = uploadPath(d.file_url);
    if (!main) return null;
    const ts = d.entity_type === 'payslips' ? uploadPath(d.timesheet?.file_url) : null;
    if (!ts) return { path: main, parts: null };
    const key = sha256(`${main}|${ts}|${fs.statSync(main).mtimeMs}|${fs.statSync(ts).mtimeMs}`).slice(0, 32);
    const out = path.join(BUNDLE_DIR, `${key}.pdf`);
    if (!bundleParts.has(key) || !fs.existsSync(out)) {
      const { PDFDocument } = require('pdf-lib');
      const toPdf = async (p) => (path.extname(p).toLowerCase() === '.pdf' ? fs.readFileSync(p) : imagesToPdf([p]));
      const a = await PDFDocument.load(await toPdf(main), { ignoreEncryption: true });
      const b = await PDFDocument.load(await toPdf(ts), { ignoreEncryption: true });
      const merged = await PDFDocument.create();
      for (const doc of [a, b]) for (const pg of await merged.copyPages(doc, doc.getPageIndices())) merged.addPage(pg);
      fs.mkdirSync(BUNDLE_DIR, { recursive: true });
      fs.writeFileSync(out, Buffer.from(await merged.save()));
      bundleParts.set(key, [a.getPageCount(), b.getPageCount()]);
    }
    return { path: out, parts: bundleParts.get(key) };
  }
  const signSourceSafe = async (d) => {
    try { return await signSource(d); }
    catch (e) { console.error('[employee-docs] bundle failed:', e.message); const p = uploadPath(d.file_url); return p ? { path: p, parts: null } : null; }
  };

  const payslipRowOr404 = (req, res) => {
    const row = docRow(req.params.docId);
    if (!row || row.entity_type !== 'payslips') { res.status(404).json({ error: 'Not found' }); return null; }
    return row;
  };
  const timesheetFrom = (fileUrl, fileName, period, by) => ({
    file_url: fileUrl, file_name: String(fileName || '').slice(0, 200) || `דף שעות ${period || ''}`.trim(),
    uploaded_at: NOW(), uploaded_by: by || null, source: 'upload',
  });
  // צירוף / החלפה של דף שעות שהועלה ({ file_url, file_name })
  app.post('/api/employee-documents/:docId/timesheet', authMiddleware, (req, res) => {
    const row = payslipRowOr404(req, res); if (!row) return;
    const ctx = managerCtx(req, res, row.farm_id); if (!ctx) return;
    const d = parse(row);
    if (d.sign?.status === 'signed') return res.status(409).json({ error: 'התלוש כבר נחתם — אי אפשר להחליף את דף השעות' });
    if (!uploadPath(req.body?.file_url)) return res.status(400).json({ error: 'קובץ דף השעות חסר' });
    updateData(row, (x) => ({ ...x, timesheet: timesheetFrom(req.body.file_url, req.body.file_name, d.period, ctx.user.full_name) }));
    res.json(publicDoc(parse(docRow(row.id))));
  });
  app.delete('/api/employee-documents/:docId/timesheet', authMiddleware, (req, res) => {
    const row = payslipRowOr404(req, res); if (!row) return;
    if (!managerCtx(req, res, row.farm_id)) return;
    if (parse(row).sign?.status === 'signed') return res.status(409).json({ error: 'התלוש כבר נחתם' });
    updateData(row, (x) => { const { timesheet, ...rest } = x; return rest; });
    res.json({ success: true });
  });

  // ── רשימה ─────────────────────────────────────────────────────────────────
  app.get('/api/employees/:id/documents', authMiddleware, (req, res) => {
    const emp = employeeRow(req.params.id);
    if (!emp) return res.status(404).json({ error: 'Not found' });
    if (!managerCtx(req, res, emp.farm_id)) return;
    const rows = db.prepare(`SELECT * FROM entities WHERE entity_type IN (${IN_TYPES}) AND farm_id = ? AND json_extract(data, '$.employee_id') = ?`)
      .all(...DOC_TYPES, emp.farm_id, emp.id).map(parse).map(publicDoc);
    rows.sort((a, b) => String(b.period || b.created_at).localeCompare(String(a.period || a.created_at)));
    res.json(rows);
  });

  // ── הוספה (הקובץ כבר הועלה דרך /api/upload) ────────────────────────────────
  app.post('/api/employees/:id/documents', authMiddleware, (req, res) => {
    const emp = employeeRow(req.params.id);
    if (!emp) return res.status(404).json({ error: 'Not found' });
    const ctx = managerCtx(req, res, emp.farm_id); if (!ctx) return;
    const { category, file_url, file_name, timesheet_file_url, timesheet_file_name, ...fields } = req.body || {};
    const type = TYPE_OF_CATEGORY[category];
    if (!type) return res.status(400).json({ error: 'סוג מסמך לא תקין' });
    // פוליסת ביטוח אפשר לרשום גם בלי קובץ; לשאר — חובה קובץ שהועלה
    if (category !== 'medical_insurance' && !uploadName(file_url)) return res.status(400).json({ error: 'קובץ חסר' });
    if (category === 'payslip' && !fields.period) return res.status(400).json({ error: 'יש לבחור חודש לתלוש' });
    if (category === 'payslip' && timesheet_file_url && !uploadPath(timesheet_file_url)) return res.status(400).json({ error: 'קובץ דף השעות חסר' });
    try {
      const rec = hr.create(emp.farm_id, type, {
        ...fields, employee_id: emp.id, file_url: file_url || null, file_name: String(file_name || '').slice(0, 200) || null,
        uploaded_by: ctx.user.full_name || null, source: 'manual',
      }, ctx.user.full_name || null);
      // דף שעות שהועלה יחד עם התלוש
      if (category === 'payslip' && timesheet_file_url) {
        const ts = timesheetFrom(timesheet_file_url, timesheet_file_name, rec.period, ctx.user.full_name);
        updateData({ id: rec.id, entity_type: type }, (x) => ({ ...x, timesheet: ts }));
        rec.timesheet = ts;
      }
      res.json(publicDoc({ ...rec, entity_type: type }));
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  // עדכון פרטים (תאריכים, סכומים, חברה…) — לא הקובץ של מסמך חתום
  app.put('/api/employee-documents/:docId', authMiddleware, (req, res) => {
    const row = docRow(req.params.docId);
    if (!row) return res.status(404).json({ error: 'Not found' });
    const ctx = managerCtx(req, res, row.farm_id); if (!ctx) return;
    try {
      const rec = hr.update(row.farm_id, row.entity_type, row.id, req.body || {}, ctx.user.full_name || null);
      res.json(publicDoc({ ...rec, entity_type: row.entity_type }));
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  app.delete('/api/employee-documents/:docId', authMiddleware, (req, res) => {
    const row = docRow(req.params.docId);
    if (!row) return res.status(404).json({ error: 'Not found' });
    if (!managerCtx(req, res, row.farm_id)) return;
    hr.remove(row.farm_id, row.entity_type, row.id);
    res.json({ success: true });
  });

  // ── בקשת חתימה: קישור חדש (מבטל קישור קודם) ──────────────────────────────
  // נשמר רק ה-hash; הקישור עצמו מוחזר פעם אחת — לשליחה לטלפון העובד (וואטסאפ / SMS)
  const issueSignLink = (row, by) => {
    const token = crypto.randomBytes(24).toString('base64url');
    const now = new Date();
    const expires_at = new Date(now.getTime() + SIGN_TTL_DAYS * 864e5).toISOString();
    updateData(row, (x) => ({
      ...x,
      sign: { status: 'pending', token_hash: sha256(token), requested_at: now.toISOString(), requested_by: by || null, expires_at },
    }));
    return { token, path: `/sign/${token}`, expires_at };
  };
  const employeeInfo = (id) => {
    const r = employeeRow(id); if (!r) return { name: '', first_name: '', phone: '' };
    try { const e = JSON.parse(r.data || '{}'); return { name: e.full_name || [e.first_name, e.last_name].filter(Boolean).join(' '), first_name: e.first_name || '', phone: e.phone || '' }; }
    catch { return { name: '', first_name: '', phone: '' }; }
  };

  app.post('/api/employee-documents/:docId/sign-request', authMiddleware, async (req, res) => {
    const row = docRow(req.params.docId);
    if (!row) return res.status(404).json({ error: 'Not found' });
    const ctx = managerCtx(req, res, row.farm_id); if (!ctx) return;
    const d = parse(row);
    if (d.sign?.status === 'signed') return res.status(409).json({ error: 'המסמך כבר נחתם' });
    const timesheet = (row.entity_type === 'payslips' && d.timesheet?.file_url) ? d.timesheet : null;
    res.json({ ...issueSignLink(row, ctx.user.full_name), employee: employeeInfo(d.employee_id), timesheet });
  });

  // תיעוד שליחה (וואטסאפ / SMS / העתקה) — לסטטוס "נשלח" ברשימות
  app.post('/api/employee-documents/:docId/sign-sent', authMiddleware, (req, res) => {
    const row = docRow(req.params.docId);
    if (!row) return res.status(404).json({ error: 'Not found' });
    if (!managerCtx(req, res, row.farm_id)) return;
    const channel = ['whatsapp', 'sms', 'copy', 'share'].includes(req.body?.channel) ? req.body.channel : 'other';
    const d = parse(row);
    if (d.sign?.status !== 'pending') return res.status(409).json({ error: 'אין בקשת חתימה פתוחה' });
    const to = String(req.body?.to || '').replace(/[^\d+]/g, '').slice(0, 20) || null;
    updateData(row, (x) => ({ ...x, sign: { ...x.sign, sent_at: new Date().toISOString(), sent_via: channel, sent_to: to } }));
    res.json({ success: true });
  });

  // ── שליחה מרוכזת: תלושי חודש לחתימה ─────────────────────────────────────
  // GET  ?period=YYYY-MM  → התלושים של החודש עם שם/טלפון העובד וסטטוס
  // POST { period, doc_ids?, renew? } → קישורים חדשים למי שלא חתם (ממתינים — רק עם renew)
  const batchRows = (farmId, period) => db.prepare(`SELECT * FROM entities WHERE entity_type = 'payslips' AND farm_id = ? AND json_extract(data, '$.period') = ?`)
    .all(farmId, period).map(parse).map(d => {
      const e = employeeInfo(d.employee_id); const v = publicDoc(d);
      return { doc_id: d.id, employee_id: d.employee_id, employee_name: e.name || d.employee_name || '', first_name: e.first_name, phone: e.phone, title: d.title, employer: d.employer || null, sign_status: v.sign_status, signed_at: v.signed_at, sent_at: d.sign?.sent_at || null, sent_via: d.sign?.sent_via || null, timesheet: !!d.timesheet?.file_url };
    }).sort((a, b) => a.employee_name.localeCompare(b.employee_name, 'he'));
  const farmOf = (req) => { const u = getUser(req.user.id); return req.query.farm_id || req.body?.farm_id || u?.current_farm_id; };

  app.get('/api/employee-documents/payslip-batch', authMiddleware, (req, res) => {
    const farmId = farmOf(req);
    if (!managerCtx(req, res, farmId)) return;
    const periods = db.prepare(`SELECT DISTINCT json_extract(data, '$.period') AS p FROM entities WHERE entity_type = 'payslips' AND farm_id = ? ORDER BY p DESC`).all(farmId).map(r => r.p).filter(Boolean);
    const period = /^\d{4}-\d{2}$/.test(String(req.query.period || '')) ? req.query.period : periods[0];
    res.json({ periods, period: period || null, items: period ? batchRows(farmId, period) : [] });
  });

  app.post('/api/employee-documents/payslip-batch/sign-requests', authMiddleware, async (req, res) => {
    const farmId = farmOf(req);
    const ctx = managerCtx(req, res, farmId); if (!ctx) return;
    const period = String(req.body?.period || '');
    if (!/^\d{4}-\d{2}$/.test(period)) return res.status(400).json({ error: 'חודש לא תקין' });
    const only = Array.isArray(req.body?.doc_ids) ? new Set(req.body.doc_ids.map(String)) : null;
    const links = {};
    for (const it of batchRows(farmId, period)) {
      if (only && !only.has(it.doc_id)) continue;
      if (it.sign_status === 'signed') continue;
      if (it.sign_status === 'pending' && !req.body?.renew && !only) continue; // כבר נשלח — לא שוברים קישור קיים
      const row = docRow(it.doc_id);
      links[it.doc_id] = issueSignLink(row, ctx.user.full_name);
    }
    const items = batchRows(farmId, period).map(it => (links[it.doc_id] ? { ...it, ...links[it.doc_id] } : it));
    res.json({ period, issued: Object.keys(links).length, items });
  });

  app.post('/api/employee-documents/:docId/sign-cancel', authMiddleware, (req, res) => {
    const row = docRow(req.params.docId);
    if (!row) return res.status(404).json({ error: 'Not found' });
    if (!managerCtx(req, res, row.farm_id)) return;
    const d = parse(row);
    if (d.sign?.status === 'signed') return res.status(409).json({ error: 'המסמך כבר נחתם' });
    updateData(row, (x) => ({ ...x, sign: { status: 'none' } }));
    res.json({ success: true });
  });

  // ── ציבורי: לפי טוקן, ללא התחברות ────────────────────────────────────────
  const byToken = (token) => {
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(String(token || ''))) return null;
    const row = db.prepare(`SELECT * FROM entities WHERE entity_type IN (${IN_TYPES}) AND json_extract(data, '$.sign.token_hash') = ?`).get(...DOC_TYPES, sha256(token));
    return row ? parse(row) : null;
  };
  const tokenState = (d) => {
    if (!d) return 'invalid';
    if (d.sign?.status === 'signed') return 'signed';
    if (d.sign?.status !== 'pending') return 'invalid';
    if (d.sign.expires_at && d.sign.expires_at < NOW()) return 'expired';
    return 'pending';
  };
  const pageCountCache = new Map();
  async function pageCount(p) {
    if (pageCountCache.has(p)) return pageCountCache.get(p);
    let n = 1;
    if (path.extname(p).toLowerCase() === '.pdf') {
      try { const { PDFDocument } = require('pdf-lib'); n = (await PDFDocument.load(fs.readFileSync(p), { ignoreEncryption: true })).getPageCount(); } catch { n = 1; }
    }
    pageCountCache.set(p, n);
    return n;
  }

  app.get('/api/public/sign/:token', async (req, res) => {
    const d = byToken(req.params.token);
    const state = tokenState(d);
    if (state === 'invalid') return res.status(404).json({ error: 'הקישור אינו תקף', state });
    const emp = employeeRow(d.employee_id); const farm = db.prepare("SELECT data FROM entities WHERE entity_type = 'farms' AND id = ?").get(d.farm_id);
    let empName = '', farmName = '';
    try { empName = JSON.parse(emp.data).full_name || ''; } catch { /* ignore */ }
    try { farmName = JSON.parse(farm.data).name || ''; } catch { /* ignore */ }
    const srcInfo = await signSourceSafe(d);
    const src = srcInfo?.path || null;
    const isPdf = src && path.extname(src).toLowerCase() === '.pdf';
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      state, title: d.title, category: d.category, category_label: CATEGORIES[d.category], period: d.period,
      employee_name: empName, farm_name: farmName, expires_at: d.sign?.expires_at || null,
      signed_at: d.sign?.signed_at || null,
      file_kind: !src ? 'missing' : (isPdf ? 'pdf' : 'image'),
      pages: src ? Math.min(await pageCount(src), MAX_PAGES_PREVIEW) : 0,
      timesheet: srcInfo?.parts ? { first_page: srcInfo.parts[0] + 1, pages: srcInfo.parts[1], total_hours: d.timesheet?.total_hours ?? null, days: d.timesheet?.days ?? null } : null,
    });
  });

  // הקובץ המקורי (להורדה/פתיחה)
  app.get('/api/public/sign/:token/file', async (req, res) => {
    const d = byToken(req.params.token);
    if (tokenState(d) === 'invalid') return res.status(404).end();
    const src = (d.sign?.status === 'signed' && uploadPath(d.sign.signed_file_url)) || (await signSourceSafe(d))?.path;
    if (!src) return res.status(404).end();
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.sendFile(src);
  });

  // עמוד n כתמונה — PDF בתוך iframe לא מוצג בדפדפני אנדרואיד
  app.get('/api/public/sign/:token/page/:n', async (req, res) => {
    const d = byToken(req.params.token);
    if (tokenState(d) === 'invalid') return res.status(404).end();
    const src = (await signSourceSafe(d))?.path;
    if (!src) return res.status(404).end();
    const n = parseInt(req.params.n, 10);
    res.setHeader('Cache-Control', 'no-store');
    if (path.extname(src).toLowerCase() !== '.pdf') return n === 1 ? res.sendFile(src) : res.status(404).end();
    if (!(n >= 1 && n <= Math.min(await pageCount(src), MAX_PAGES_PREVIEW))) return res.status(404).end();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-sign-'));
    const prefix = path.join(dir, 'p');
    execFile('pdftoppm', ['-jpeg', '-r', '110', '-f', String(n), '-l', String(n), '-singlefile', src, prefix], { timeout: 30000 }, (err) => {
      const out = `${prefix}.jpg`;
      if (err || !fs.existsSync(out)) { fs.rmSync(dir, { recursive: true, force: true }); return res.status(500).end(); }
      res.type('image/jpeg');
      res.sendFile(out, () => fs.rmSync(dir, { recursive: true, force: true }));
    });
  });

  app.post('/api/public/sign/:token', async (req, res) => {
    const d = byToken(req.params.token);
    const state = tokenState(d);
    if (state !== 'pending') return res.status(state === 'signed' ? 409 : 410).json({ error: state === 'signed' ? 'המסמך כבר נחתם' : 'הקישור אינו תקף או שפג תוקפו', state });
    const { signer_name, signature_png, agree } = req.body || {};
    const name = String(signer_name || '').trim().slice(0, 80);
    if (!name) return res.status(400).json({ error: 'נא להקליד שם מלא' });
    if (agree !== true) return res.status(400).json({ error: 'יש לאשר את קריאת המסמך' });
    const m = String(signature_png || '').match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
    const png = m ? Buffer.from(m[1], 'base64') : null;
    if (!png || png.length < 100 || png.length > MAX_SIG_BYTES || png.readUInt32BE(0) !== 0x89504e47) return res.status(400).json({ error: 'חתימה חסרה' });
    const srcInfo = await signSourceSafe(d);
    const src = srcInfo?.path;
    if (!src) return res.status(500).json({ error: 'קובץ המסמך חסר בשרת' });

    try {
      const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
      const original = fs.readFileSync(src);
      const isPdf = path.extname(src).toLowerCase() === '.pdf';
      const baseBytes = isPdf ? original : await imagesToPdf([src]);
      const pdf = await PDFDocument.load(baseBytes, { ignoreEncryption: true });
      const sig = await pdf.embedPng(png);
      const signedAt = new Date().toISOString();
      const ip = req.ip || '';

      // חותמת בפינה השמאלית התחתונה של העמוד האחרון — ובתלוש + דף שעות: על העמוד האחרון של כל אחד
      const stampPages = srcInfo.parts ? [srcInfo.parts[0] - 1, pdf.getPageCount() - 1] : [pdf.getPageCount() - 1];
      for (const idx of stampPages) {
        const last = pdf.getPage(idx);
        const { width: pw } = last.getSize();
        const sw = Math.min(200, pw * 0.38);
        const sh = sw * (sig.height / sig.width);
        last.drawRectangle({ x: 24, y: 24, width: sw + 8, height: sh + 8, color: rgb(1, 1, 1), opacity: 0.85 });
        last.drawImage(sig, { x: 28, y: 28, width: sw, height: sh });
      }

      // עמוד תיעוד
      const font = await pdf.embedFont(StandardFonts.Helvetica);
      const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
      const page = pdf.addPage([595, 842]);
      let y = 790;
      page.drawText('Electronic signature record', { x: 50, y, size: 18, font: bold }); y -= 34;
      const line = (k, v) => { page.drawText(k, { x: 50, y, size: 10, font: bold }); page.drawText(ascii(v, 90), { x: 170, y, size: 10, font }); y -= 18; };
      line('Document ID', d.id);
      line('Document type', d.category + (d.period ? ` (${d.period})` : '') + (srcInfo.parts ? ` + monthly hours sheet (pages ${srcInfo.parts[0] + 1}-${srcInfo.parts[0] + srcInfo.parts[1]})` : ''));
      if (srcInfo.parts && d.timesheet?.total_hours != null) line('Hours sheet total', `${d.timesheet.total_hours} hours, ${d.timesheet.days} days`);
      line('Original SHA-256', sha256(original));
      line('Signed at (UTC)', signedAt);
      line('Signer IP', ip);
      line('Device', req.headers['user-agent'] || '');
      line('Link sent at (UTC)', d.sign.requested_at || '');
      y -= 10;
      page.drawText('Signature, name and date as entered by the signer:', { x: 50, y, size: 10, font }); y -= 12;
      const bw = 360, bh = bw * (sig.height / sig.width);
      page.drawRectangle({ x: 50, y: y - bh - 8, width: bw + 8, height: bh + 8, borderColor: rgb(0.7, 0.7, 0.7), borderWidth: 1 });
      page.drawImage(sig, { x: 54, y: y - bh - 4, width: bw, height: bh });
      pdf.setTitle(`signed ${d.id}`); pdf.setProducer('Farm Flow');

      const out = Buffer.from(await pdf.save());
      const outName = `signed_${uuidv4()}.pdf`;
      fs.writeFileSync(path.join(UPLOADS_DIR, outName), out);
      registerFile(outName, d.farm_id, out.length, `${d.title || 'document'} - signed.pdf`);
      const signedUrl = fileUrlFor(req, outName);
      updateData({ id: d.id, entity_type: d.entity_type }, (x) => ({
        ...x,
        sign: {
          ...x.sign, status: 'signed', token_hash: x.sign.token_hash, signed_at: signedAt, signer_name: name,
          signer_ip: ip, signer_agent: ascii(req.headers['user-agent'], 300), original_sha256: sha256(original),
          signed_sha256: sha256(out), signed_file_url: signedUrl, includes_timesheet: !!srcInfo.parts,
        },
        ...(srcInfo.parts && x.timesheet ? { timesheet: { ...x.timesheet, signed_at: signedAt } } : {}),
      }));
      try {
        const e = employeeInfo(d.employee_id);
        db.prepare('INSERT INTO notifications (id, recipient_id, farm_id, title, body, type, sent_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .run(uuidv4(), null, d.farm_id, `${CATEGORIES[d.category] || 'מסמך'} נחתם — ${e.name || name}`, `${d.title || ''} נחתם ע"י ${name}. העותק החתום נשמר בתיק העובד.`, 'success', null, NOW());
      } catch (err) { console.error('[employee-docs] notify failed:', err.message); }
      res.json({ success: true, signed_at: signedAt });
    } catch (e) {
      console.error('[employee-docs] sign failed:', e.message);
      res.status(500).json({ error: 'יצירת המסמך החתום נכשלה' });
    }
  });
}

module.exports = { registerEmployeeDocRoutes };
