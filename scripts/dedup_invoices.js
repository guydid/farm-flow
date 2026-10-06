// Duplicate-invoice review for farm-flow prod DB.
//   node dupscan.js          → dry run (report only)
//   node dupscan.js --apply  → backup DB, delete duplicates, dismiss gmail ids, move files, backfill sha256
const Database = require('/home/nitur/farm-flow/backend/node_modules/better-sqlite3');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DB_PATH = '/home/nitur/farm-flow/backend/data/farmflow.db';
const UPLOADS = '/home/nitur/farm-flow/backend/uploads';
const APPLY = process.argv.includes('--apply');
const STAMP = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, ''); // YYYYMMDDHHMM — ריצה חוזרת באותו יום לא דורסת גיבוי קודם
const NOW = () => new Date().toISOString();

const db = new Database(DB_PATH);
const rows = db.prepare("SELECT id, farm_id, data, created_at FROM entities WHERE entity_type='invoices'").all();
const invs = rows.map(r => {
  let d; try { d = JSON.parse(r.data || '{}'); } catch { return null; }
  return { id: r.id, farm_id: r.farm_id, created_at: r.created_at, d };
}).filter(Boolean);

// sha256: stored on newer rows; computed from the upload file for older ones
for (const inv of invs) {
  let h = inv.d.source_meta?.file_sha256 || null;
  if (!h && inv.d.file_name) {
    const fp = path.join(UPLOADS, inv.d.file_name);
    if (fs.existsSync(fp)) { h = crypto.createHash('sha256').update(fs.readFileSync(fp)).digest('hex'); inv.hashFromFile = true; }
  }
  inv.sha = h;
}

const normNum = s => String(s || '').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
const vatOf = inv => String(inv.d.extracted_raw?.supplier_vat_id || '').replace(/\D/g, '');
const typeOf = inv => inv.d.invoice_type || null;

// union-find
const parent = new Map(invs.map(i => [i.id, i.id]));
const find = x => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent.set(a, b); };

const byKey = (fn) => {
  const m = new Map();
  for (const inv of invs) { const k = fn(inv); if (!k) continue; if (!m.has(k)) m.set(k, []); m.get(k).push(inv); }
  return m;
};
const reasons = new Map(); // id -> Set(reason)
const mark = (inv, r) => { if (!reasons.has(inv.id)) reasons.set(inv.id, new Set()); reasons.get(inv.id).add(r); };

for (const [, list] of byKey(inv => inv.sha ? `${inv.farm_id}|${inv.sha}` : null)) {
  if (list.length < 2) continue;
  for (const inv of list) { union(inv.id, list[0].id); mark(inv, 'same_file'); }
}
for (const [, list] of byKey(inv => {
  const n = normNum(inv.d.invoice_number);
  return n && inv.d.total != null ? `${inv.farm_id}|${n}|${Number(inv.d.total)}` : null;
})) {
  if (list.length < 2) continue;
  // pairwise: invoice vs receipt of the same deal are two documents; conflicting VAT ids = other supplier
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i], b = list[j];
    const ta = typeOf(a), tb = typeOf(b);
    if (ta && tb && ta !== tb) continue;
    const va = vatOf(a), vb = vatOf(b);
    if (va && vb && va !== vb) continue;
    union(a.id, b.id); mark(a, 'same_number_total'); mark(b, 'same_number_total');
  }
}

const groups = new Map();
for (const inv of invs) { const r = find(inv.id); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(inv); }
const dupGroups = [...groups.values()].filter(g => g.length > 1);

// keeper: already sent to bookkeeper > has total > not pending > earliest
const score = inv => [
  inv.d.sent_to_bookkeeper_at ? 0 : 1,
  inv.d.total != null ? 0 : 1,
  inv.d.status && inv.d.status !== 'pending' ? 0 : 1,
  inv.created_at || '',
];
const cmp = (a, b) => { const sa = score(a), sb = score(b); for (let i = 0; i < sa.length; i++) { if (sa[i] < sb[i]) return -1; if (sa[i] > sb[i]) return 1; } return 0; };

const plan = [];
for (const g of dupGroups) {
  g.sort(cmp);
  const keep = g[0];
  const remove = g.slice(1);
  plan.push({ keep, remove });
}

const fmt = inv => `${inv.id.slice(0, 8)} ${inv.d.source || '?'} ${(inv.d.supplier_name || '—').slice(0, 28)} | #${inv.d.invoice_number || '—'} | ${inv.d.total ?? '—'} ${inv.d.currency || ''} | ${inv.d.date || '—'} | ${inv.d.status || 'pending'}${inv.d.sent_to_bookkeeper_at ? ' SENT' : ''} | created ${String(inv.created_at).slice(0, 10)} | ${inv.d.file_name || 'no-file'}`;

console.log(`invoices: ${invs.length}, with hash: ${invs.filter(i => i.sha).length} (computed from file: ${invs.filter(i => i.hashFromFile).length})`);
console.log(`duplicate groups: ${plan.length}, rows to remove: ${plan.reduce((n, p) => n + p.remove.length, 0)}`);
for (const [idx, p] of plan.entries()) {
  console.log(`\n[${idx + 1}] reasons: ${[...new Set([p.keep, ...p.remove].flatMap(i => [...(reasons.get(i.id) || [])]))].join(',')}`);
  console.log(`  KEEP   ${fmt(p.keep)}`);
  for (const r of p.remove) console.log(`  REMOVE ${fmt(r)}`);
}

if (!APPLY) { console.log('\n(dry run — nothing changed)'); process.exit(0); }

// ── apply ──────────────────────────────────────────────────────────────────
const bak = `${DB_PATH}.bak-dedup-${STAMP}`;
fs.copyFileSync(DB_PATH, bak);
console.log(`\nDB backup: ${bak}`);
const fileBak = path.join(UPLOADS, `_dup_backup_${STAMP}`);
fs.mkdirSync(fileBak, { recursive: true });

const dismissed = new Set(db.prepare("SELECT farm_id, data FROM entities WHERE entity_type='gmail_dismissed'").all()
  .map(r => { try { return `${r.farm_id}|${JSON.parse(r.data).message_id}`; } catch { return null; } }).filter(Boolean));
const insDismiss = db.prepare("INSERT INTO entities (id, entity_type, farm_id, data, created_at, updated_at) VALUES (?, 'gmail_dismissed', ?, ?, ?, ?)");
const delInv = db.prepare("DELETE FROM entities WHERE entity_type='invoices' AND id=?");
const updInv = db.prepare("UPDATE entities SET data=?, updated_at=? WHERE entity_type='invoices' AND id=?");

let deleted = 0, movedFiles = 0, dismissedN = 0, backfilled = 0;
const log = [];
const MERGE_FIELDS = ['date', 'due_date', 'invoice_type', 'subtotal', 'vat_rate', 'vat_amount', 'currency', 'notes', 'items'];
db.transaction(() => {
  for (const p of plan) {
    // fill fields the keeper is missing from the copies being removed (e.g. camera scan without a date, Gmail PDF with one)
    const merged = { ...p.keep.d };
    let mergedAny = false;
    for (const r of p.remove) for (const f of MERGE_FIELDS) {
      const empty = merged[f] == null || merged[f] === '' || (Array.isArray(merged[f]) && merged[f].length === 0);
      const has = r.d[f] != null && r.d[f] !== '' && !(Array.isArray(r.d[f]) && r.d[f].length === 0);
      if (empty && has) { merged[f] = r.d[f]; mergedAny = true; }
    }
    if (mergedAny) {
      merged.source_meta = { ...(merged.source_meta || {}), merged_from: p.remove.map(r => r.id) };
      updInv.run(JSON.stringify(merged), NOW(), p.keep.id);
      p.keep.d = merged;
    }
    for (const r of p.remove) {
      const mid = r.d.source_meta?.message_id;
      if (mid && !dismissed.has(`${r.farm_id}|${mid}`)) {
        // only dismiss if the keeper is not from the same message (same message = already covered by its own message_id)
        if (p.keep.d.source_meta?.message_id !== mid) { insDismiss.run(crypto.randomUUID(), r.farm_id, JSON.stringify({ message_id: mid, reason: 'dedup' }), NOW(), NOW()); dismissed.add(`${r.farm_id}|${mid}`); dismissedN++; }
      }
      delInv.run(r.id); deleted++;
      log.push({ removed: r.id, kept: p.keep.id, data: r.d, created_at: r.created_at });
      for (const fn of [r.d.file_name, r.d.pdf_file_name].filter(Boolean)) {
        // never move a file the keeper (or any kept invoice) still references
        if (invs.some(i => !p.remove.includes(i) && (i.d.file_name === fn || i.d.pdf_file_name === fn))) continue;
        const src = path.join(UPLOADS, fn);
        if (fs.existsSync(src)) { fs.renameSync(src, path.join(fileBak, fn)); movedFiles++; }
      }
    }
  }
  // backfill sha256 on remaining rows that had none stored
  const removedIds = new Set(plan.flatMap(p => p.remove.map(r => r.id)));
  for (const inv of invs) {
    if (removedIds.has(inv.id) || !inv.hashFromFile) continue;
    const d = { ...inv.d, source_meta: { ...(inv.d.source_meta || {}), file_sha256: inv.sha } };
    updInv.run(JSON.stringify(d), NOW(), inv.id); backfilled++;
  }
})();
fs.writeFileSync(path.join(fileBak, 'removed_invoices.json'), JSON.stringify(log, null, 2));
console.log(`deleted rows: ${deleted}, gmail ids dismissed: ${dismissedN}, files moved to ${fileBak}: ${movedFiles}, sha256 backfilled: ${backfilled}`);
