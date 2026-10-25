// ─── Leases (שכירויות) ─────────────────────────────────────────────────────────
// הסכמי שכירות של המשק בשני כיוונים: direction='pay' (המשק שוכר ומשלם) / 'receive'
// (המשק משכיר ומקבל). ה-CRUD עצמו עובר דרך הראוטים הגנריים (entities: leases,
// lease_payments, meter_readings). כאן: יצירת לוח תשלומים, קריאת מונים → חיוב,
// סימון תשלום, סיכום, ותזכורות יומיות (התראה באפליקציה + טלגרם לבעלים/מנהלים).
const KINDS = { rent: 'שכירות', housing: 'מגורי עובדים', electricity: 'חשמל', water: 'מים', gas: 'גז', other: 'חיוב', credit: 'זיכוי' };

function registerLeaseRoutes(app, deps) {
  const { db, getUser, authMiddleware, getFarmMember, NOW, uuidv4, tgGetConfig, tgSend, attnNow } = deps;

  const roleOf = (farmId, userId) => getFarmMember(farmId, userId)?.role || null;
  const ctxOf = (req, res, { write = false } = {}) => {
    const user = getUser(req.user.id);
    const farmId = req.query.farm_id || req.body?.farm_id || user?.current_farm_id;
    if (!user || !farmId) { res.status(400).json({ error: 'No farm selected' }); return null; }
    if (!user.is_admin && !user.farm_ids.includes(farmId)) { res.status(403).json({ error: 'Forbidden' }); return null; }
    if (write && !user.is_admin && !['owner', 'manager', 'worker'].includes(roleOf(farmId, user.id))) { res.status(403).json({ error: 'אין הרשאת כתיבה' }); return null; }
    return { user, farmId, by: user.full_name || user.email };
  };
  const parse = (r) => { try { return { id: r.id, farm_id: r.farm_id, created_at: r.created_at, updated_at: r.updated_at, ...JSON.parse(r.data) }; } catch { return { id: r.id, farm_id: r.farm_id }; } };
  const getRow = (type, id, farmId) => { const r = db.prepare('SELECT * FROM entities WHERE entity_type = ? AND id = ? AND farm_id = ?').get(type, id, farmId); return r ? parse(r) : null; };
  const rowsOf = (type, farmId) => db.prepare('SELECT * FROM entities WHERE entity_type = ? AND farm_id = ?').all(type, farmId).map(parse);
  const insertRow = (type, farmId, data, id) => {
    const rid = id || uuidv4(); const now = NOW();
    db.prepare('INSERT INTO entities (id, entity_type, farm_id, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(rid, type, farmId, JSON.stringify(data), now, now);
    return rid;
  };
  const updateRow = (id, patch) => {
    const r = db.prepare('SELECT data FROM entities WHERE id = ?').get(id); if (!r) return null;
    let d = {}; try { d = JSON.parse(r.data); } catch { /* ignore */ }
    const next = { ...d, ...patch };
    db.prepare('UPDATE entities SET data = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(next), NOW(), id);
    return next;
  };
  const today = () => (attnNow ? attnNow().date : NOW().slice(0, 10));
  const addMonths = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); const dt = new Date(Date.UTC(y, m - 1 + n, 1)); const last = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate(); dt.setUTCDate(Math.min(d, last)); return dt.toISOString().slice(0, 10); };
  const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

  // ── schedule: create the rent payments of a lease (idempotent, deterministic ids) ──
  function generateSchedule(lease, farmId, by, monthsAhead = 12) {
    if (!lease.start_date || !(Number(lease.amount) > 0)) return { created: 0, skipped: 0 };
    const step = { monthly: 1, quarterly: 3, half_yearly: 6, yearly: 12, once: 0 }[lease.frequency || 'monthly'] ?? 1;
    const horizon = addMonths(today(), monthsAhead);
    const end = lease.end_date && lease.end_date < horizon ? lease.end_date : horizon;
    const dueDay = Math.min(Math.max(parseInt(lease.due_day, 10) || parseInt(lease.start_date.slice(8, 10), 10) || 1, 1), 31);
    let created = 0, skipped = 0;
    let cursor = `${lease.start_date.slice(0, 7)}-01`;
    for (let i = 0; i < 120; i++) {
      const monthStart = addMonths(cursor, i * step);
      if (monthStart > end) break;
      const last = new Date(Date.UTC(+monthStart.slice(0, 4), +monthStart.slice(5, 7), 0)).getUTCDate();
      const due = `${monthStart.slice(0, 7)}-${String(Math.min(dueDay, last)).padStart(2, '0')}`;
      if (due < lease.start_date) { if (step === 0) break; continue; }
      if (due > end) break;
      const id = `lp_${lease.id}_${due.slice(0, 7)}`;
      if (db.prepare('SELECT 1 FROM entities WHERE id = ?').get(id)) { skipped++; }
      else {
        insertRow('lease_payments', farmId, {
          lease_id: lease.id, lease_title: lease.title, direction: lease.direction, kind: 'rent',
          description: `${KINDS.rent} ${due.slice(0, 7)}${step > 1 ? ` (${step} חודשים)` : ''}`, due_date: due, amount: round2(lease.amount),
          status: due < today() ? 'overdue' : 'due', paid_date: null, paid_amount: null, method: null, reference: null, reminders_sent: [], _by: by,
        }, id);
        created++;
      }
      if (step === 0) break;
    }
    return { created, skipped };
  }

  app.post('/api/leases/:id/schedule', authMiddleware, (req, res) => {
    const ctx = ctxOf(req, res, { write: true }); if (!ctx) return;
    const lease = getRow('leases', req.params.id, ctx.farmId);
    if (!lease) return res.status(404).json({ error: 'הסכם לא נמצא' });
    const months = Math.min(Math.max(parseInt(req.body?.months_ahead, 10) || 12, 1), 36);
    res.json({ ok: true, ...generateSchedule(lease, ctx.farmId, ctx.by, months) });
  });

  // ── meter reading → consumption → charge ──
  app.post('/api/leases/:id/meter-reading', authMiddleware, (req, res) => {
    const ctx = ctxOf(req, res, { write: true }); if (!ctx) return;
    const lease = getRow('leases', req.params.id, ctx.farmId);
    if (!lease) return res.status(404).json({ error: 'הסכם לא נמצא' });
    const { meter_type, reading, reading_date, rate_per_unit, note, create_charge = true, due_date } = req.body || {};
    const meters = Array.isArray(lease.meters) ? lease.meters : [];
    const mi = meters.findIndex(m => m.type === meter_type);
    if (mi < 0) return res.status(400).json({ error: 'מונה מסוג זה לא מוגדר בהסכם' });
    const meter = meters[mi];
    const value = Number(reading);
    if (!Number.isFinite(value) || value < 0) return res.status(400).json({ error: 'קריאה לא תקינה' });
    const prev = Number(meter.last_reading);
    const hasPrev = Number.isFinite(prev) && meter.last_reading !== null && meter.last_reading !== undefined && meter.last_reading !== '';
    if (hasPrev && value < prev) return res.status(400).json({ error: `הקריאה (${value}) נמוכה מהקריאה הקודמת (${prev})` });
    const consumption = hasPrev ? round2(value - prev) : 0;
    const rate = rate_per_unit !== undefined && rate_per_unit !== '' ? Number(rate_per_unit) : Number(meter.rate_per_unit) || 0;
    const amount = round2(consumption * rate);
    const date = (reading_date || today()).slice(0, 10);
    const readingId = insertRow('meter_readings', ctx.farmId, {
      lease_id: lease.id, lease_title: lease.title, meter_type, meter_number: meter.meter_number || '', unit: meter.unit || '',
      reading_date: date, previous_reading: hasPrev ? prev : null, reading: value, consumption, rate_per_unit: rate, amount, note: note || '', payment_id: null, _by: ctx.by,
    });
    let payment = null;
    if (create_charge && hasPrev && amount > 0) {
      const due = (due_date || date).slice(0, 10);
      const pid = insertRow('lease_payments', ctx.farmId, {
        lease_id: lease.id, lease_title: lease.title, direction: lease.direction, kind: meter_type in KINDS ? meter_type : 'other',
        description: `${KINDS[meter_type] || KINDS.other} ${date} · ${consumption} ${meter.unit || ''} × ₪${rate}`,
        due_date: due, amount, status: due < today() ? 'overdue' : 'due', paid_date: null, paid_amount: null, method: null, reference: null,
        reminders_sent: [], meter_reading_id: readingId, _by: ctx.by,
      });
      updateRow(readingId, { payment_id: pid });
      payment = getRow('lease_payments', pid, ctx.farmId);
    }
    meters[mi] = { ...meter, last_reading: value, last_reading_date: date, rate_per_unit: rate };
    updateRow(lease.id, { meters });
    res.json({ ok: true, reading: getRow('meter_readings', readingId, ctx.farmId), payment, consumption, amount });
  });

  // ── mark a payment paid / unpaid ──
  app.post('/api/lease-payments/:id/pay', authMiddleware, (req, res) => {
    const ctx = ctxOf(req, res, { write: true }); if (!ctx) return;
    const p = getRow('lease_payments', req.params.id, ctx.farmId);
    if (!p) return res.status(404).json({ error: 'תשלום לא נמצא' });
    const { paid = true, paid_date, paid_amount, method, reference, notes } = req.body || {};
    const patch = paid
      ? { status: 'paid', paid_date: (paid_date || today()).slice(0, 10), paid_amount: round2(paid_amount ?? p.amount), method: method || p.method || null, reference: reference || p.reference || null, notes: notes ?? p.notes ?? '', paid_by: ctx.by }
      : { status: p.due_date < today() ? 'overdue' : 'due', paid_date: null, paid_amount: null, paid_by: null };
    res.json({ ok: true, payment: { ...updateRow(p.id, patch), id: p.id } });
  });

  // ── summary for the page header ──
  app.get('/api/leases/summary', authMiddleware, (req, res) => {
    const ctx = ctxOf(req, res); if (!ctx) return;
    const t = today(); const month = t.slice(0, 7);
    const leases = rowsOf('leases', ctx.farmId);
    const payments = rowsOf('lease_payments', ctx.farmId);
    // refresh overdue flags on the fly
    for (const p of payments) if (p.status === 'due' && p.due_date < t && Number(p.amount) > 0) { p.status = 'overdue'; updateRow(p.id, { status: 'overdue' }); }
    const sum = (arr) => round2(arr.reduce((s, p) => s + (Number(p.amount) || 0), 0));
    const open = payments.filter(p => ['due', 'overdue'].includes(p.status));
    const out = {
      active_leases: leases.filter(l => l.status === 'active').length,
      pay: { due_this_month: sum(open.filter(p => p.direction === 'pay' && p.due_date.startsWith(month))), overdue: sum(open.filter(p => p.direction === 'pay' && p.status === 'overdue')), paid_this_month: sum(payments.filter(p => p.direction === 'pay' && p.status === 'paid' && (p.paid_date || '').startsWith(month))) },
      receive: { due_this_month: sum(open.filter(p => p.direction === 'receive' && p.due_date.startsWith(month))), overdue: sum(open.filter(p => p.direction === 'receive' && p.status === 'overdue')), paid_this_month: sum(payments.filter(p => p.direction === 'receive' && p.status === 'paid' && (p.paid_date || '').startsWith(month))) },
      overdue_count: open.filter(p => p.status === 'overdue').length,
      upcoming: open.filter(p => p.due_date >= t).sort((a, b) => a.due_date.localeCompare(b.due_date)).slice(0, 8),
      ending_soon: leases.filter(l => l.status === 'active' && l.end_date && l.end_date >= t && l.end_date <= addMonths(t, 2)).map(l => ({ id: l.id, title: l.title, end_date: l.end_date })),
    };
    res.json(out);
  });


  // ── invoicing (direction = receive): group open charges into one invoice, optionally via Invoice Maven ──
  // billing_mode: 'monthly_all' = one monthly invoice (rent + meters + charges);
  //               'split'       = rent invoiced per its own frequency (yearly / half-yearly…), meters+charges monthly.
  const maven = deps.makeMavenCore ? deps.makeMavenCore(deps) : null;
  const ddmmyyyy = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? `${m[3]}/${m[2]}/${m[1]}` : ddmmyyyy(today()); };
  const PAY_TYPE = { transfer: 1, standing_order: 1, cash: 2, cheque: 3, credit: 4, other: 9 };
  const billingMode = (lease) => lease.billing_mode || (lease.frequency === 'monthly' || !lease.frequency ? 'monthly_all' : 'split');
  function invoiceCandidates(lease, farmId, { period, payment_ids, include_rent }) {
    const open = rowsOf('lease_payments', farmId).filter(p => p.lease_id === lease.id && !p.invoice_id && p.status !== 'cancelled');
    if (Array.isArray(payment_ids) && payment_ids.length) return open.filter(p => payment_ids.includes(p.id));
    const mode = billingMode(lease);
    return open.filter(p => String(p.due_date || '').startsWith(period) && (mode === 'monthly_all' || include_rent || p.kind !== 'rent'))
      .sort((a, b) => (a.kind === 'rent' ? 0 : 1) - (b.kind === 'rent' ? 0 : 1) || a.due_date.localeCompare(b.due_date));
  }
  function invoiceTotals(rows) {
    const charges = rows.filter(p => Number(p.amount) > 0), credits = rows.filter(p => Number(p.amount) < 0);
    const gross = round2(charges.reduce((s, p) => s + Number(p.amount), 0));
    const discount = round2(credits.reduce((s, p) => s + Math.abs(Number(p.amount)), 0));
    return { gross, discount, total: round2(gross - discount), charges, credits };
  }
  function mavenState(farmId) {
    if (!maven) return { enabled: false };
    const cfg = maven.loadConfig(farmId);
    return { enabled: !!cfg.enabled && !!cfg.api_key_enc, test_mode: cfg.test_mode !== false, cfg };
  }

  app.get('/api/leases/:id/invoice-preview', authMiddleware, (req, res) => {
    const ctx = ctxOf(req, res); if (!ctx) return;
    const lease = getRow('leases', req.params.id, ctx.farmId);
    if (!lease) return res.status(404).json({ error: 'הסכם לא נמצא' });
    const period = String(req.query.period || today().slice(0, 7)).slice(0, 7);
    const ids = req.query.payment_ids ? String(req.query.payment_ids).split(',').filter(Boolean) : null;
    const rows = invoiceCandidates(lease, ctx.farmId, { period, payment_ids: ids, include_rent: req.query.include_rent === '1' });
    const t = invoiceTotals(rows);
    const ms = mavenState(ctx.farmId);
    res.json({ period, mode: billingMode(lease), payments: rows, gross: t.gross, discount: t.discount, total: t.total, maven_enabled: ms.enabled, test_mode: !!ms.test_mode, vat_exempt: !!lease.vat_exempt,
      customer: { name: lease.counterparty_name || '', identification: lease.counterparty_id_number || '', email: lease.counterparty_email || '', phone: lease.counterparty_phone || '' } });
  });

  async function issueMavenDoc(farmId, cfg, body) {
    const r = await maven.mavenCall(cfg, '/api/documents/addDocument', body);
    return { id: r.id || null, doc_no: r.doc_no ?? null, pdf_original: r.pdf_original || null, pdf_copy: r.pdf_copy || null, allocation_number: r.allocation_number || null, test: cfg.test_mode !== false };
  }

  app.post('/api/leases/:id/invoice', authMiddleware, async (req, res) => {
    const ctx = ctxOf(req, res, { write: true }); if (!ctx) return;
    const lease = getRow('leases', req.params.id, ctx.farmId);
    if (!lease) return res.status(404).json({ error: 'הסכם לא נמצא' });
    if (lease.direction !== 'receive') return res.status(400).json({ error: 'חשבוניות מופקות רק להסכמים שבהם המשק משכיר' });
    const { period: rawPeriod, payment_ids, include_rent, doc_type, send_to_customer, paid, remarks } = req.body || {};
    const period = String(rawPeriod || today().slice(0, 7)).slice(0, 7);
    const docType = Number(doc_type) === 320 ? 320 : 305;
    const rows = invoiceCandidates(lease, ctx.farmId, { period, payment_ids, include_rent: !!include_rent });
    if (!rows.length) return res.status(400).json({ error: 'אין חיובים פתוחים לחשבונית בתקופה זו' });
    const t = invoiceTotals(rows);
    if (t.total <= 0) return res.status(400).json({ error: 'סכום החשבונית חייב להיות חיובי (הזיכויים גדולים מהחיובים)' });
    const number_seq = rowsOf('lease_invoices', ctx.farmId).length + 1;
    const ms = mavenState(ctx.farmId);
    let mavenDoc = null;
    if (ms.enabled) {
      const paidInfo = docType === 320 ? { paid_date: (paid?.paid_date || today()).slice(0, 10), method: paid?.method || lease.payment_method || 'transfer', reference: paid?.reference || '' } : null;
      const body = {
        doc_type: docType,
        customer: { name: lease.counterparty_name || 'שוכר', ...(lease.counterparty_id_number ? { identification: String(lease.counterparty_id_number) } : {}), ...(lease.counterparty_email ? { email: lease.counterparty_email } : {}), ...(lease.counterparty_phone ? { cell_phone: lease.counterparty_phone } : {}) },
        items: t.charges.map(p => ({ description: `${p.description || KINDS[p.kind] || 'חיוב'} · ${lease.title}`, price: round2(Number(p.amount)), quantity: 1, ...(lease.vat_exempt ? { no_vat: true } : {}) })),
        ...(t.discount > 0 ? { discount: t.discount } : {}),
        document_date: ddmmyyyy(today()),
        description: `שכירות ${lease.title} · ${period}${rows.some(p => p.kind === 'rent') ? '' : ' (מונים וחיובים)'}`,
        ...(remarks ? { remarks: String(remarks).slice(0, 1000) } : {}),
        ...(t.credits.length ? { remarks: [remarks, ...t.credits.map(c => `זיכוי: ${c.description || ''} ₪${Math.abs(Number(c.amount))}`)].filter(Boolean).join(' · ').slice(0, 1000) } : {}),
        send_to_customer: !!send_to_customer,
        // סכומי השכירות הם מה שהשוכר משלם בפועל → המחירים כוללים מע"מ (וכך סה"כ המסמך = סכום התשלום ב-320)
        vat_included: true,
        doc_id: `ff-lease-${lease.id}-${docType}-${rows.map(p => p.id).sort().join('|').length}-${period}-${number_seq}`,
        ...(docType === 320 ? { payments: [{ payment_type: PAY_TYPE[paidInfo.method] || 9, amount: t.total, payment_date: ddmmyyyy(paidInfo.paid_date), ...(paidInfo.reference && paidInfo.method === 'cheque' ? { cheque_number: paidInfo.reference } : {}) }] } : {}),
      };
      try { mavenDoc = await issueMavenDoc(ctx.farmId, ms.cfg, body); }
      catch (e) { console.error('[leases] maven invoice failed:', e.message); return res.status(422).json({ error: `Maven: ${e.message}` }); }
    }
    const number = mavenDoc?.doc_no ? String(mavenDoc.doc_no) : `L-${String(number_seq).padStart(4, '0')}`;
    const now = NOW();
    const invId = insertRow('lease_invoices', ctx.farmId, {
      lease_id: lease.id, lease_title: lease.title, direction: lease.direction, period, payment_ids: rows.map(p => p.id),
      gross: t.gross, discount: t.discount, total: t.total, doc_type: docType, number, maven: mavenDoc,
      status: docType === 320 ? 'paid' : 'issued', issued_at: now, paid_at: docType === 320 ? now : null, send_to_customer: !!send_to_customer, _by: ctx.by,
    });
    for (const p of rows) {
      const patch = { invoice_id: invId, invoice_no: number };
      if (docType === 320) Object.assign(patch, { status: 'paid', paid_date: (paid?.paid_date || today()).slice(0, 10), paid_amount: round2(Number(p.amount)), method: paid?.method || lease.payment_method || null, reference: paid?.reference || null, paid_by: ctx.by });
      updateRow(p.id, patch);
    }
    console.log(`[leases] farm=${ctx.farmId} invoice ${number} lease=${lease.id} rows=${rows.length} total=${t.total} maven=${!!mavenDoc}`);
    res.json({ ok: true, invoice: getRow('lease_invoices', invId, ctx.farmId) });
  });

  app.post('/api/lease-invoices/:id/pay', authMiddleware, async (req, res) => {
    const ctx = ctxOf(req, res, { write: true }); if (!ctx) return;
    const inv = getRow('lease_invoices', req.params.id, ctx.farmId);
    if (!inv) return res.status(404).json({ error: 'חשבונית לא נמצאה' });
    if (inv.status === 'paid') return res.status(400).json({ error: 'החשבונית כבר שולמה' });
    const { paid_date, method, reference, issue_receipt } = req.body || {};
    const date = (paid_date || today()).slice(0, 10);
    // Maven דוחה תאריכים עתידיים → תאריך המסמך/התשלום בקבלה לא יעבור את היום
    const docDate = date > today() ? today() : date;
    let receipt = null;
    const ms = mavenState(ctx.farmId);
    if (issue_receipt && ms.enabled && inv.doc_type === 305) {
      try {
        const lease = getRow('leases', inv.lease_id, ctx.farmId) || {};
        receipt = await issueMavenDoc(ctx.farmId, ms.cfg, {
          doc_type: 400,
          customer: { name: lease.counterparty_name || 'שוכר', ...(lease.counterparty_id_number ? { identification: String(lease.counterparty_id_number) } : {}), ...(lease.counterparty_email ? { email: lease.counterparty_email } : {}) },
          payments: [{ payment_type: PAY_TYPE[method] || 9, amount: inv.total, payment_date: ddmmyyyy(docDate), ...(reference && method === 'cheque' ? { cheque_number: reference } : {}) }],
          document_date: ddmmyyyy(docDate), description: `קבלה על חשבונית ${inv.number} · ${inv.lease_title || ''} ${inv.period || ''}`.trim(), doc_id: `ff-lease-receipt-${inv.id}`,
        });
      } catch (e) { console.error('[leases] maven receipt failed:', e.message); return res.status(422).json({ error: `Maven: ${e.message}` }); }
    }
    for (const pid of inv.payment_ids || []) {
      const p = getRow('lease_payments', pid, ctx.farmId); if (!p || p.status === 'paid') continue;
      updateRow(pid, { status: 'paid', paid_date: date, paid_amount: round2(Number(p.amount)), method: method || p.method || null, reference: reference || null, paid_by: ctx.by });
    }
    const updated = updateRow(inv.id, { status: 'paid', paid_at: NOW(), paid_date: date, method: method || null, reference: reference || null, receipt });
    res.json({ ok: true, invoice: { ...updated, id: inv.id } });
  });

  // cancel an internal (non-Maven) invoice: releases its payments
  app.post('/api/lease-invoices/:id/cancel', authMiddleware, (req, res) => {
    const ctx = ctxOf(req, res, { write: true }); if (!ctx) return;
    const inv = getRow('lease_invoices', req.params.id, ctx.farmId);
    if (!inv) return res.status(404).json({ error: 'חשבונית לא נמצאה' });
    if (inv.maven && !inv.maven.test) return res.status(400).json({ error: 'חשבונית שהופקה ב-Maven מבוטלת רק דרך Maven (חשבונית זיכוי)' });
    for (const pid of inv.payment_ids || []) { const p = getRow('lease_payments', pid, ctx.farmId); if (p) updateRow(pid, { invoice_id: null, invoice_no: null, ...(inv.status === 'paid' ? { status: p.due_date < today() ? 'overdue' : 'due', paid_date: null, paid_amount: null } : {}) }); }
    updateRow(inv.id, { status: 'cancelled', cancelled_at: NOW() });
    res.json({ ok: true });
  });

  // ── daily reminders: X days before due, on the due date, and weekly while overdue ──
  async function notify(farmId, title, body, telegram) {
    db.prepare('INSERT INTO notifications (id, recipient_id, farm_id, title, body, type, sent_by, created_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(uuidv4(), null, farmId, title, body, 'warning', null, NOW());
    if (!telegram || !tgGetConfig || !tgSend) return;
    const tgCfg = tgGetConfig(farmId);
    if (!tgCfg?.token) return;
    const chats = db.prepare("SELECT DISTINCT u.telegram_chat_id AS cid FROM farm_members fm JOIN users u ON u.id=fm.user_id WHERE fm.farm_id=? AND fm.role IN ('owner','manager') AND u.telegram_chat_id IS NOT NULL AND u.telegram_chat_id != ''").all(farmId);
    for (const c of chats) { try { await tgSend(tgCfg.token, c.cid, `🏠 <b>${title}</b>\n${body}`); } catch (e) { console.error('[leases] telegram failed:', String(e?.message || e)); } }
  }
  let running = false, lastRunDate = null;
  async function reminderTick() {
    if (running) return; running = true;
    try {
      const { date: t, time } = attnNow ? attnNow() : { date: NOW().slice(0, 10), time: '09:00' };
      if (lastRunDate === t || time < '08:30') return;
      lastRunDate = t;
      const farms = db.prepare("SELECT DISTINCT farm_id FROM entities WHERE entity_type = 'lease_payments' AND farm_id IS NOT NULL").all().map(r => r.farm_id);
      for (const farmId of farms) {
        const leases = Object.fromEntries(rowsOf('leases', farmId).map(l => [l.id, l]));
        const payments = rowsOf('lease_payments', farmId).filter(p => ['due', 'overdue'].includes(p.status));
        const lines = { soon: [], today: [], overdue: [] }; let telegram = false;
        for (const p of payments) {
          if (p.kind === 'credit' || Number(p.amount) < 0) continue; // זיכויים לא מזכירים
          const lease = leases[p.lease_id]; if (!lease || lease.reminders_enabled === false) continue;
          const days = Math.round((Date.parse(p.due_date) - Date.parse(t)) / 86400000);
          const before = Number(lease.reminder_days_before ?? 7);
          const sent = Array.isArray(p.reminders_sent) ? p.reminders_sent : [];
          let bucket = null;
          if (days === before && before > 0) bucket = 'soon';
          else if (days === 0) bucket = 'today';
          // באיחור: תזכורת ראשונה מיד (אם טרם נשלחה), ואחר כך אחת לשבוע
          else if (days < 0 && ((-days) % 7 === 0 || !sent.some(x => x.startsWith('overdue:')))) bucket = 'overdue';
          if (days < 0 && p.status !== 'overdue') updateRow(p.id, { status: 'overdue' });
          if (!bucket || sent.includes(`${bucket}:${t}`)) continue;
          const who = lease.counterparty_name ? ` (${lease.counterparty_name})` : '';
          lines[bucket].push(`${p.direction === 'receive' ? 'לקבל' : 'לשלם'} ₪${Number(p.amount).toLocaleString('he-IL')} · ${p.description || KINDS[p.kind] || ''} · ${lease.title}${who}${days < 0 ? ` · באיחור ${-days} ימים` : ''}`);
          if (lease.reminder_telegram) telegram = true;
          updateRow(p.id, { reminders_sent: [...sent, `${bucket}:${t}`].slice(-30) });
        }
        if (lines.soon.length) await notify(farmId, `תשלומי שכירות בקרוב (${lines.soon.length})`, lines.soon.join('\n'), telegram);
        if (lines.today.length) await notify(farmId, `תשלומי שכירות להיום (${lines.today.length})`, lines.today.join('\n'), telegram);
        if (lines.overdue.length) await notify(farmId, `תשלומי שכירות באיחור (${lines.overdue.length})`, lines.overdue.join('\n'), telegram);
        if (lines.soon.length || lines.today.length || lines.overdue.length) console.log(`[leases] farm=${farmId} reminders soon=${lines.soon.length} today=${lines.today.length} overdue=${lines.overdue.length}`);
      }
    } catch (e) { console.error('[leases] reminder tick failed:', e.message); }
    finally { running = false; }
  }
  setInterval(reminderTick, 5 * 60 * 1000);
  setTimeout(reminderTick, 90 * 1000);
  console.log('[leases] reminder scheduler enabled (daily after 08:30, every 5min check)');

  // manual trigger for testing (owner/manager/admin)
  app.post('/api/leases/run-reminders', authMiddleware, async (req, res) => {
    const ctx = ctxOf(req, res, { write: true }); if (!ctx) return;
    lastRunDate = null; await reminderTick(); res.json({ ok: true });
  });
}

module.exports = { registerLeaseRoutes, KINDS };
