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
    const step = { monthly: 1, quarterly: 3, yearly: 12, once: 0 }[lease.frequency || 'monthly'] ?? 1;
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
          description: `${KINDS.rent} ${due.slice(0, 7)}`, due_date: due, amount: round2(lease.amount),
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
