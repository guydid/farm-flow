// מלאי חומרי הדברה למשק.
// המלאי מחושב (לא נשמר): ספירות מלאי + קניות + תיקונים (entity: pesticide_stock) פחות
// הכמויות שנרשמו בהדברות (sprayings.applied_pesticides). כך עריכה/מחיקה של הדברה
// מתעדכנת במלאי מיד, בלי סנכרון.
//   type 'count'      — ספירת מלאי: קובעת את היתרה לערך מוחלט בתאריך
//   type 'purchase'   — קנייה: מוסיפה
//   type 'adjustment' — תיקון: מוסיף/מוריד (quantity עם סימן)
// הדברות נספרות רק מהתנועה הראשונה של התכשיר ואילך (לפני כן המלאי לא נוהל).
// באותו תאריך: ספירה → קניות/תיקונים → שימוש בהדברות.

const UNIT_MAP = [
  [/^(ליטר|ל'?|l|lt|liter|litre)$/i, 'ml', 1000],
  [/^(מ"ל|מל|סמ"ק|סמק|ml|cc)$/i, 'ml', 1],
  [/^(ק"ג|קג|קילו|kg)$/i, 'g', 1000],
  [/^(גרם|גר'?|ג'?|g|gr)$/i, 'g', 1],
];

function normUnit(unit) {
  const u = String(unit || '').trim().replace(/[״”]/g, '"').replace(/[׳’]/g, "'");
  for (const [re, base, factor] of UNIT_MAP) if (re.test(u)) return { base, factor };
  return { base: u || 'יח\'', factor: 1 };
}

function display(baseQty, base) {
  if (base === 'ml') return Math.abs(baseQty) >= 1000 ? { qty: round(baseQty / 1000), unit: 'ליטר' } : { qty: round(baseQty), unit: 'מ"ל' };
  if (base === 'g') return Math.abs(baseQty) >= 1000 ? { qty: round(baseQty / 1000), unit: 'ק"ג' } : { qty: round(baseQty), unit: 'גרם' };
  return { qty: round(baseQty), unit: base };
}
const round = (n) => Math.round(n * 100) / 100;
const productKey = (name) => String(name || '').trim().replace(/\s+/g, ' ').toLowerCase();
const ORDER = { count: 0, purchase: 1, adjustment: 1, usage: 2 };

function computePesticideStock(db, farmId, { includeHistory = false } = {}) {
  const rows = (type) => db.prepare('SELECT id, data, created_at FROM entities WHERE entity_type = ? AND farm_id = ?').all(type, farmId)
    .map(r => { let d; try { d = JSON.parse(r.data || '{}'); } catch { d = {}; } return { ...d, id: r.id, created_at: r.created_at }; });

  const products = new Map();
  const get = (name, pesticideId) => {
    const key = productKey(name);
    if (!products.has(key)) products.set(key, { key, product_name: String(name).trim(), pesticide_id: pesticideId || null, events: [] });
    const p = products.get(key);
    if (!p.pesticide_id && pesticideId) p.pesticide_id = pesticideId;
    return p;
  };

  for (const m of rows('pesticide_stock')) {
    if (!m.product_name || !['count', 'purchase', 'adjustment'].includes(m.type)) continue;
    get(m.product_name, m.pesticide_id).events.push({
      kind: m.type, id: m.id, date: String(m.date || m.created_at || '').slice(0, 10), quantity: Number(m.quantity) || 0, unit: m.unit,
      supplier: m.supplier || '', cost_per_unit: m.cost_per_unit ?? null, notes: m.notes || '', created_at: m.created_at,
    });
  }

  const seedingNames = new Map(rows('seedings').map(s => [s.id, s.name]));
  for (const s of rows('sprayings')) {
    for (const ap of (Array.isArray(s.applied_pesticides) ? s.applied_pesticides : [])) {
      if (!ap?.pesticide_name || !products.has(productKey(ap.pesticide_name))) continue; // לא מנוהל במלאי
      get(ap.pesticide_name, ap.pesticide_id).events.push({
        kind: 'usage', id: s.id, date: String(s.date || '').slice(0, 10), quantity: Number(ap.quantity) || 0, unit: ap.unit,
        seeding_id: s.seeding_id || null, seeding_name: seedingNames.get(s.seeding_id) || '', created_at: s.created_at,
      });
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  const since30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const out = [];
  for (const p of products.values()) {
    const managed = p.events.filter(e => e.kind !== 'usage');
    const base = normUnit((managed.find(e => e.kind === 'count') || managed[0])?.unit).base;
    const start = managed.reduce((min, e) => (e.date < min ? e.date : min), '9999-99-99');
    const events = p.events.filter(e => e.kind !== 'usage' || e.date >= start)
      .sort((a, b) => a.date.localeCompare(b.date) || ORDER[a.kind] - ORDER[b.kind] || String(a.created_at).localeCompare(String(b.created_at)));

    let balance = 0, used30 = 0, purchased = 0;
    const warnings = new Set();
    const history = [];
    for (const e of events) {
      const u = normUnit(e.unit);
      if (u.base !== base) { warnings.add(`יחידה "${e.unit || '—'}" לא תואמת למלאי (${display(0, base).unit}) — לא חושבה`); continue; }
      const q = e.quantity * u.factor;
      if (e.kind === 'count') balance = q;
      else if (e.kind === 'usage') { balance -= q; if (e.date >= since30) used30 += q; }
      else { balance += q; if (e.kind === 'purchase') purchased += q; }
      if (includeHistory) history.push({ ...e, balance_after: display(balance, base) });
    }
    const lastOf = (kind) => [...events].reverse().find(e => e.kind === kind) || null;
    const bal = display(balance, base);
    out.push({
      key: p.key, product_name: p.product_name, pesticide_id: p.pesticide_id,
      balance: bal.qty, unit: bal.unit, base_unit: base, balance_base: round(balance),
      used_last_30d: display(used30, base),
      purchased_total: display(purchased, base),
      status: balance <= 0 ? 'out' : (used30 > 0 && balance < used30 / 2) ? 'low' : 'ok',
      tracking_since: start,
      last_count: lastOf('count') && { date: lastOf('count').date, ...display(lastOf('count').quantity * normUnit(lastOf('count').unit).factor, base) },
      last_purchase: lastOf('purchase') && { date: lastOf('purchase').date, supplier: lastOf('purchase').supplier },
      last_usage: lastOf('usage')?.date || null,
      future_dated: events.some(e => e.date > today),
      warnings: [...warnings],
      ...(includeHistory ? { history: history.reverse() } : {}),
    });
  }
  return out.sort((a, b) => a.product_name.localeCompare(b.product_name, 'he'));
}

module.exports = { computePesticideStock, productKey, normUnit };
