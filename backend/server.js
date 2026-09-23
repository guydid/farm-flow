const express = require('express');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const compression = require('compression');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const https  = require('https');
const net    = require('net');

/* helper: make an HTTPS request and return { status, body } — forces IPv4 to avoid IPv6 timeout */
function httpsRequest(options, postBody) {
  // ברירת מחדל 60ש' — מספיק להורדת קבצים מצורפים גדולים ולקריאות חילוץ AI (vision).
  // ניתן לדריסה ע"י options.timeoutMs. (https.request מתעלם ממאפיין לא מוכר.)
  const timeoutMs = options.timeoutMs || 60000;
  return new Promise((resolve, reject) => {
    const req = https.request({ family: 4, ...options }, res => {
      // חובה לצבור Buffers ולפענח פעם אחת בסוף. `raw += chunk` מפענח כל chunk בנפרד,
      // ותו עברי (2 בתים ב-UTF-8) שנחתך על גבול chunk הופך ל-"��" — מה שהשחית שמות
      // ספקים, כתובות ושמות קבצים מצורפים בכל תשובה גדולה מ-Claude ומ-Gmail API.
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => { req.destroy(new Error('HTTPS request timeout')); });
    if (postBody) req.write(postBody);
    req.end();
  });
}

const app = express();
const PORT = process.env.PORT || 3001;

// JWT_SECRET must be set explicitly — no weak fallback in production
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('FATAL: JWT_SECRET environment variable is not set. Refusing to start.');
  process.exit(1);
}

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'farmflow.db');
const ALLOW_REGISTRATION = process.env.ALLOW_REGISTRATION === 'true';
const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID     || null;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || null;
const APP_BASE_URL         = process.env.APP_BASE_URL         || 'https://farm.nitur-ai.com';

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL'); // safe with WAL, avoids an fsync on every commit
db.pragma('foreign_keys = ON');
db.pragma('cache_size = -16000');  // ~16MB page cache (negative = KiB)
db.pragma('mmap_size = 268435456'); // 256MB memory-mapped I/O

const NOW = () => new Date().toISOString();

// ─── SCHEMA ───────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    full_name TEXT DEFAULT '',
    avatar_url TEXT DEFAULT '',
    farm_ids TEXT DEFAULT '[]',
    current_farm_id TEXT DEFAULT NULL,
    is_admin INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS entities (
    id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    farm_id TEXT,
    data TEXT NOT NULL DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (id, entity_type)
  );
  CREATE TABLE IF NOT EXISTS farm_members (
    id TEXT PRIMARY KEY,
    farm_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT DEFAULT 'viewer',
    invited_by TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(farm_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    recipient_id TEXT,
    farm_id TEXT,
    title TEXT NOT NULL,
    body TEXT DEFAULT '',
    type TEXT DEFAULT 'info',
    sent_by TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS notification_reads (
    notification_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    dismissed INTEGER DEFAULT 0,
    read_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (notification_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS idx_entity_type ON entities(entity_type);
  CREATE INDEX IF NOT EXISTS idx_entity_type_farm ON entities(entity_type, farm_id);
  -- Expression indexes for the hot detail-page filters (json_extract = ? in GET /api/:entity)
  CREATE INDEX IF NOT EXISTS idx_ent_seeding      ON entities(json_extract(data, '$.seeding_id'));
  CREATE INDEX IF NOT EXISTS idx_ent_employee     ON entities(json_extract(data, '$.employee_id'));
  CREATE INDEX IF NOT EXISTS idx_ent_vehicle      ON entities(json_extract(data, '$.vehicle_id'));
  CREATE INDEX IF NOT EXISTS idx_ent_certificate  ON entities(json_extract(data, '$.certificate_id'));
  CREATE INDEX IF NOT EXISTS idx_ent_plot         ON entities(json_extract(data, '$.plot_id'));
  CREATE INDEX IF NOT EXISTS idx_ent_subscription ON entities(json_extract(data, '$.subscription_id'));
  CREATE INDEX IF NOT EXISTS idx_farm_members_farm ON farm_members(farm_id);
  CREATE INDEX IF NOT EXISTS idx_farm_members_user ON farm_members(user_id);
  CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications(recipient_id);
  CREATE INDEX IF NOT EXISTS idx_notifications_farm ON notifications(farm_id);
  CREATE TABLE IF NOT EXISTS system_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT '',
    updated_at TEXT DEFAULT (datetime('now'))
  );
`);

// ─── MIGRATIONS ───────────────────────────────────────────────────────────────
const migrateColumns = [
  "ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0",
  "ALTER TABLE users ADD COLUMN is_active INTEGER DEFAULT 1",
  "ALTER TABLE users ADD COLUMN google_id TEXT",
  "ALTER TABLE users ADD COLUMN telegram_chat_id TEXT",
  "ALTER TABLE users ADD COLUMN telegram_username TEXT",
  // Field-worker accounts are locked to the reduced (Thai) data-entry UI.
  "ALTER TABLE users ADD COLUMN field_worker INTEGER DEFAULT 0",
  "ALTER TABLE users ADD COLUMN language TEXT",
];
for (const sql of migrateColumns) {
  try { db.exec(sql); } catch (_) {}
}

// Migrate existing farm ownerships → farm_members table
try {
  const existingUsers = db.prepare('SELECT id, farm_ids FROM users').all();
  for (const u of existingUsers) {
    const farmIds = JSON.parse(u.farm_ids || '[]');
    for (const fid of farmIds) {
      try {
        db.prepare('INSERT OR IGNORE INTO farm_members (id, farm_id, user_id, role, created_at) VALUES (?, ?, ?, ?, ?)').run(uuidv4(), fid, u.id, 'owner', NOW());
      } catch (_) {}
    }
  }
} catch (_) {}

// דחיסת תשובות: ה-JSON עובר במנהרת Cloudflare עד הקצה, דחיסה מקצרת את הדרך
app.use(compression({ threshold: 1024 }));
app.use(express.json({ limit: '5mb' }));

// CORS — whitelist only the allowed origins
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://farm.nitur-ai.com,http://192.168.1.231,http://192.168.1.231:3002')
  .split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin: (origin, cb) => {
    // allow same-origin (no Origin header) and whitelisted origins
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
}));

// Security headers
app.use(helmet({
  contentSecurityPolicy: false, // managed by Cloudflare
  crossOriginEmbedderPolicy: false,
}));

// Trust Cloudflare proxy for accurate IP-based rate limiting
app.set('trust proxy', 1);

// Rate limiters
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: { error: 'Too many login attempts, try again later' } });
const registerLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 5, message: { error: 'Too many registration attempts' } });
const aiLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 20, message: { error: 'AI extraction rate limit exceeded' } });
const apiLimiter = rateLimit({ windowMs: 60 * 1000, max: 300, message: { error: 'Too many requests' } });
app.use('/api/', apiLimiter);

// ─── FILE UPLOADS ──────────────────────────────────────────────────────────────
const UPLOADS_DIR = path.join(__dirname, 'uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Serve uploaded files — require valid JWT
app.use('/uploads', (req, res, next) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '') ||
    (req.query.token || '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try { jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Invalid token' }); }
}, express.static(UPLOADS_DIR));

// ─── תמונות ממוזערות למסמכים (גלריה) ─────────────────────────────────────────
// PDF מרונדר לעמוד 1 ע"י pdftoppm (poppler-utils), תמונות מוקטנות ע"י jimp. התוצאה
// נשמרת במטמון בדיסק, כך שכל קובץ מעובד פעם אחת בלבד. הנייד מוריד ~20KB במקום PDF
// של מגה-בייטים — זו כל הנקודה.
const THUMBS_DIR = path.join(UPLOADS_DIR, '.thumbs');
fs.mkdirSync(THUMBS_DIR, { recursive: true });
const THUMB_SIZES = [400, 1200]; // רשימת היתר — מונעת ייצור אינסופי של גדלים

async function generateThumbnail(srcPath, outPath, width) {
  const ext = path.extname(srcPath).toLowerCase();
  if (ext === '.pdf') {
    // -singlefile גורם ל-pdftoppm לכתוב בדיוק <prefix>.jpg ולא <prefix>-1.jpg
    const prefix = outPath.replace(/\.jpg$/, '');
    await new Promise((resolve, reject) => {
      require('child_process').execFile(
        'pdftoppm',
        ['-jpeg', '-singlefile', '-f', '1', '-l', '1', '-scale-to', String(width), srcPath, prefix],
        { timeout: 30_000 },
        (err) => (err ? reject(err) : resolve()),
      );
    });
    return;
  }
  const Jimp = require('jimp');
  const img = await Jimp.read(srcPath);
  if (Math.max(img.bitmap.width, img.bitmap.height) > width) img.scaleToFit(width, width);
  img.quality(78);
  await img.writeAsync(outPath);
}

app.get('/api/files/thumb/:filename', async (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '') || (req.query.token || '');
  try { jwt.verify(token, JWT_SECRET); } catch { return res.status(401).json({ error: 'Unauthorized' }); }

  const name = String(req.params.filename || '');
  if (!/^[A-Za-z0-9._-]+$/.test(name) || name.includes('..')) return res.status(400).json({ error: 'Bad filename' });
  const width = THUMB_SIZES.includes(parseInt(req.query.w, 10)) ? parseInt(req.query.w, 10) : 400;

  const srcPath = path.join(UPLOADS_DIR, name);
  if (!fs.existsSync(srcPath)) return res.status(404).json({ error: 'Not found' });
  const outPath = path.join(THUMBS_DIR, `${name}.${width}.jpg`);

  try {
    if (!fs.existsSync(outPath)) await generateThumbnail(srcPath, outPath, width);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.type('image/jpeg');
    fs.createReadStream(outPath).pipe(res);
  } catch (err) {
    // PDF פגום / פורמט לא נתמך — הממשק נופל חזרה לאייקון גנרי
    console.warn('[thumb] failed for', name, String(err?.message || err).slice(0, 120));
    res.status(415).json({ error: 'Cannot render preview' });
  }
});

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname) || '.jpg';
      cb(null, `${uuidv4()}${ext}`);
    }
  }),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB max
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp|pdf/i;
    cb(null, allowed.test(file.mimetype) || allowed.test(path.extname(file.originalname)));
  }
});

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Unauthorized', type: 'auth_required' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token', type: 'auth_required' });
  }
}

function adminMiddleware(req, res, next) {
  const user = getUser(req.user.id);
  if (!user || !user.is_admin) return res.status(403).json({ error: 'Admin access required' });
  next();
}

function getUser(id) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) return null;
  return { ...user, farm_ids: JSON.parse(user.farm_ids || '[]') };
}

function formatUser(user) {
  const farm_ids = Array.isArray(user.farm_ids)
    ? user.farm_ids
    : JSON.parse(user.farm_ids || '[]');
  // Role within the currently-selected farm (used for client-side gating).
  let role = null;
  if (user.current_farm_id) {
    const m = db.prepare('SELECT role FROM farm_members WHERE farm_id = ? AND user_id = ?').get(user.current_farm_id, user.id);
    role = m?.role || null;
  }
  return {
    id: user.id,
    email: user.email,
    full_name: user.full_name,
    avatar_url: user.avatar_url,
    farm_ids,
    current_farm_id: user.current_farm_id,
    is_admin: !!user.is_admin,
    is_active: user.is_active !== 0,
    field_worker: !!user.field_worker,
    language: user.language || null,
    role,
    created_at: user.created_at,
    updated_at: user.updated_at,
  };
}

function formatEntity(row) {
  if (!row) return null;
  const data = JSON.parse(row.data || '{}');
  // Compute full_name for any entity that has first_name / last_name but no full_name
  if (!data.full_name && (data.first_name || data.last_name)) {
    data.full_name = [data.first_name, data.last_name].filter(Boolean).join(' ');
  }
  return { id: row.id, ...data, farm_id: row.farm_id, created_at: row.created_at, updated_at: row.updated_at };
}

// ─── SEEDING DATE SYNC ────────────────────────────────────────────────────────
// תאריכי המזרע נגזרים מהאירועים שלו:
//   פעילות "שתילה"  → planting_date      (התאריך המוקדם ביותר)
//   קטיף            → first_harvest_date (הקטיף המוקדם ביותר)
//   פעילות "עקירה"  → end_date           (התאריך המאוחר ביותר)
// נקרא אחרי כל יצירה/עדכון/מחיקה של activities או harvests.
const PLANTING_TYPE_RE  = /שתיל|planting/i;
const UPROOTING_TYPE_RE = /עקיר|uproot/i;

function syncSeedingDates(seedingId) {
  if (!seedingId) return;
  const seedRow = db.prepare("SELECT * FROM entities WHERE entity_type='seedings' AND id=?").get(seedingId);
  if (!seedRow) return;

  const acts = db.prepare("SELECT data FROM entities WHERE entity_type='activities' AND json_extract(data,'$.seeding_id')=?")
    .all(seedingId).map(r => { try { return JSON.parse(r.data || '{}'); } catch { return null; } }).filter(Boolean);
  const harvs = db.prepare("SELECT data FROM entities WHERE entity_type='harvests' AND json_extract(data,'$.seeding_id')=?")
    .all(seedingId).map(r => { try { return JSON.parse(r.data || '{}'); } catch { return null; } }).filter(Boolean);

  const dateOf = e => (e && typeof e.date === 'string' && e.date.trim()) ? e.date.slice(0, 10) : null;
  const minDate = list => list.map(dateOf).filter(Boolean).sort()[0] || null;
  const maxDate = list => list.map(dateOf).filter(Boolean).sort().slice(-1)[0] || null;

  const planting  = minDate(acts.filter(a => PLANTING_TYPE_RE.test(String(a.activity_type || ''))));
  const uprooting = maxDate(acts.filter(a => UPROOTING_TYPE_RE.test(String(a.activity_type || ''))));
  const firstHarv = minDate(harvs);

  let seed; try { seed = JSON.parse(seedRow.data || '{}'); } catch { return; }
  const next = { ...seed };
  // שתילה: פעילות שתילה תמיד גוברת; בלי פעילות — משאירים ערך ידני קיים
  if (planting) {
    next.planting_date = planting;
    // אותה נוסחה כמו בטופס המזרע: שתילה + ימים לקטיף ראשון → סיום משוער (רק אם עדיין ריק)
    const days = parseInt(seed.days_from_planting_to_harvest, 10);
    if (!seed.estimated_end_date && days > 0) {
      const d = new Date(planting + 'T00:00:00Z');
      d.setUTCDate(d.getUTCDate() + days);
      next.estimated_end_date = d.toISOString().slice(0, 10);
    }
  }
  next.first_harvest_date = firstHarv;
  next.end_date = uprooting;

  if (JSON.stringify(next) === JSON.stringify(seed)) return;
  db.prepare("UPDATE entities SET data=?, updated_at=? WHERE entity_type='seedings' AND id=?")
    .run(JSON.stringify(next), NOW(), seedingId);
}

// סוגי פעילות ברירת מחדל שנדרשים לסנכרון התאריכים — נוצרים לכל משק אם חסרים
function ensureDefaultActivityTypes() {
  const DEFAULTS = [
    { name: 'שתילה', name_en: 'Planting',  unit: 'fixed_amount', price_per_dunam: null, re: PLANTING_TYPE_RE },
    { name: 'עקירה', name_en: 'Uprooting', unit: 'fixed_amount', price_per_dunam: null, re: UPROOTING_TYPE_RE },
  ];
  try {
    const farms = db.prepare("SELECT id FROM entities WHERE entity_type='farms'").all();
    const existing = db.prepare("SELECT farm_id, data FROM entities WHERE entity_type='activity_types'").all();
    const has = (farmId, re) => existing.some(r => {
      if (r.farm_id !== farmId) return false;
      try { return re.test(String(JSON.parse(r.data || '{}').name || '')); } catch { return false; }
    });
    const ins = db.prepare('INSERT INTO entities (id, entity_type, farm_id, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)');
    for (const f of farms) {
      for (const { re, ...d } of DEFAULTS) {
        if (has(f.id, re)) continue;
        const now = NOW();
        ins.run(uuidv4(), 'activity_types', f.id, JSON.stringify(d), now, now);
      }
    }
  } catch (e) { console.error('ensureDefaultActivityTypes failed:', e.message); }
}
ensureDefaultActivityTypes();

// מילוי חד-פעמי בעלייה: מזרעים קיימים מקבלים תאריכים מהאירועים שכבר תועדו (אידמפוטנטי)
try {
  for (const r of db.prepare("SELECT id FROM entities WHERE entity_type='seedings'").all()) syncSeedingDates(r.id);
} catch (e) { console.error('seeding date backfill failed:', e.message); }

function getFarmMember(farmId, userId) {
  return db.prepare('SELECT * FROM farm_members WHERE farm_id = ? AND user_id = ?').get(farmId, userId);
}

// ─── HEALTH ───────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({ status: 'ok', time: NOW() }));

// ─── AI SETTINGS ──────────────────────────────────────────────────────────────
function getAiApiKey() {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  try {
    const row = db.prepare('SELECT value FROM system_settings WHERE key = ?').get('anthropic_api_key');
    return row?.value || null;
  } catch (_) { return null; }
}

function getGroqApiKey() {
  if (process.env.GROQ_API_KEY) return process.env.GROQ_API_KEY;
  try {
    const row = db.prepare('SELECT value FROM system_settings WHERE key = ?').get('groq_api_key');
    return row?.value || null;
  } catch (_) { return null; }
}

// Attendance (time-clock) machine-to-machine API key. Auto-generates on first read
// so an admin always has a key to hand to the Python sync bridge.
function getAttendanceApiKey({ create = true } = {}) {
  const row = db.prepare('SELECT value FROM system_settings WHERE key = ?').get('attendance_api_key');
  if (row?.value) return row.value;
  if (!create) return null;
  const key = 'attn_' + crypto.randomBytes(24).toString('hex');
  db.prepare('INSERT OR REPLACE INTO system_settings (key, value, updated_at) VALUES (?, ?, ?)').run('attendance_api_key', key, NOW());
  return key;
}

// Anthropic AI settings
app.get('/api/settings/ai', authMiddleware, (req, res) => {
  const key = getAiApiKey();
  res.json({
    has_api_key: !!key,
    source: process.env.ANTHROPIC_API_KEY ? 'env' : (key ? 'db' : 'none'),
    key_preview: key ? `sk-ant-...${key.slice(-6)}` : null
  });
});
app.post('/api/settings/ai', authMiddleware, (req, res) => {
  const user = getUser(req.user.id);
  if (!user || !user.is_admin) return res.status(403).json({ error: 'אדמין בלבד' });
  const { api_key } = req.body;
  if (!api_key || !api_key.startsWith('sk-ant-'))
    return res.status(400).json({ error: 'מפתח לא תקין — חייב להתחיל ב-sk-ant-' });
  db.prepare('INSERT OR REPLACE INTO system_settings (key, value, updated_at) VALUES (?, ?, ?)').run('anthropic_api_key', api_key, NOW());
  res.json({ success: true, key_preview: `sk-ant-...${api_key.slice(-6)}` });
});
app.delete('/api/settings/ai', authMiddleware, (req, res) => {
  const user = getUser(req.user.id);
  if (!user || !user.is_admin) return res.status(403).json({ error: 'אדמין בלבד' });
  db.prepare('DELETE FROM system_settings WHERE key = ?').run('anthropic_api_key');
  res.json({ success: true });
});

// Groq settings
app.get('/api/settings/groq', authMiddleware, (req, res) => {
  const key = getGroqApiKey();
  res.json({
    has_api_key: !!key,
    source: process.env.GROQ_API_KEY ? 'env' : (key ? 'db' : 'none'),
    key_preview: key ? `gsk_...${key.slice(-6)}` : null
  });
});
app.post('/api/settings/groq', authMiddleware, (req, res) => {
  const user = getUser(req.user.id);
  if (!user || !user.is_admin) return res.status(403).json({ error: 'אדמין בלבד' });
  const { api_key } = req.body;
  if (!api_key || !api_key.startsWith('gsk_'))
    return res.status(400).json({ error: 'מפתח לא תקין — חייב להתחיל ב-gsk_' });
  db.prepare('INSERT OR REPLACE INTO system_settings (key, value, updated_at) VALUES (?, ?, ?)').run('groq_api_key', api_key, NOW());
  res.json({ success: true, key_preview: `gsk_...${api_key.slice(-6)}` });
});
app.delete('/api/settings/groq', authMiddleware, (req, res) => {
  const user = getUser(req.user.id);
  if (!user || !user.is_admin) return res.status(403).json({ error: 'אדמין בלבד' });
  db.prepare('DELETE FROM system_settings WHERE key = ?').run('groq_api_key');
  res.json({ success: true });
});

// ─── BOOKKEEPER — יעד שליחת חשבוניות (פר-farm) ────────────────────────────────
const BOOKKEEPER_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function getBookkeeperSettings(farmId) {
  const row = db.prepare("SELECT data FROM entities WHERE entity_type='bookkeeper_settings' AND farm_id=?").get(farmId);
  const d = row ? JSON.parse(row.data || '{}') : {};
  return {
    recipient_email: d.recipient_email || null,
    cc_email: d.cc_email || null,
    auto_send: d.auto_send !== false, // ברירת מחדל: שליחה אוטומטית פעילה
  };
}

function setBookkeeperSettings(farmId, data) {
  const payload = {
    recipient_email: data.recipient_email || null,
    cc_email: data.cc_email || null,
    auto_send: data.auto_send !== false,
  };
  const existing = db.prepare("SELECT id FROM entities WHERE entity_type='bookkeeper_settings' AND farm_id=?").get(farmId);
  if (existing) {
    db.prepare("UPDATE entities SET data=?, updated_at=? WHERE entity_type='bookkeeper_settings' AND id=?")
      .run(JSON.stringify(payload), NOW(), existing.id);
  } else {
    db.prepare("INSERT INTO entities (id, entity_type, farm_id, data, created_at, updated_at) VALUES (?, 'bookkeeper_settings', ?, ?, ?, ?)")
      .run(uuidv4(), farmId, JSON.stringify(payload), NOW(), NOW());
  }
  return payload;
}

app.get('/api/settings/bookkeeper', authMiddleware, (req, res) => {
  const user = getUser(req.user.id);
  if (!user?.current_farm_id) return res.status(400).json({ error: 'משתמש ללא חוות ברירת מחדל' });
  res.json(getBookkeeperSettings(user.current_farm_id));
});

app.put('/api/settings/bookkeeper', authMiddleware, (req, res) => {
  const user = getUser(req.user.id);
  if (!user?.current_farm_id) return res.status(400).json({ error: 'משתמש ללא חוות ברירת מחדל' });
  const { recipient_email, cc_email, auto_send } = req.body || {};
  const r = recipient_email ? String(recipient_email).trim() : null;
  const c = cc_email ? String(cc_email).trim() : null;
  if (r && !BOOKKEEPER_EMAIL_RE.test(r)) return res.status(400).json({ error: 'כתובת אימייל לא תקינה' });
  if (c && !BOOKKEEPER_EMAIL_RE.test(c)) return res.status(400).json({ error: 'כתובת CC לא תקינה' });
  const saved = setBookkeeperSettings(user.current_farm_id, { recipient_email: r, cc_email: c, auto_send });
  res.json({ success: true, ...saved });
});

// ─── INVOICE EXTRACTION PROMPT (Hebrew/English supplier invoices) ─────────────
const INVOICE_EXTRACTION_PROMPT = `This is a Hebrew or English supplier invoice (חשבונית מס / חשבונית עסקה).
Extract ONLY these fields as a JSON object — do not invent values, use null when absent:
- supplier_name: string (the issuer's business name, in its original language)
- supplier_vat_id: string (Israeli ח.פ./עוסק מורשה — 9 digits, or null)
- supplier_phone: string or null
- supplier_address: string or null
- invoice_number: string ("מספר חשבונית", "Invoice #", "מס' חשבונית")
- invoice_type: one of "tax_invoice" (חשבונית מס), "deal_invoice" (חשבונית עסקה), "receipt" (קבלה), "credit" (זיכוי), "other"
- date: YYYY-MM-DD (the invoice date, "תאריך")
- due_date: YYYY-MM-DD or null (תאריך פירעון)
- subtotal: number or null (סכום לפני מע"מ)
- vat_rate: number or null (e.g. 17, 18)
- vat_amount: number or null (סכום המע"מ)
- total: number (סה"כ לתשלום — the most important field)
- currency: "ILS" | "USD" | "EUR" (default "ILS" if shekel sign ₪ or "ש"ח" appears)
- items: array of { description: string, qty: number, unit_price: number, total: number }. May be empty if line items aren't clear.
- notes: string or null (any other notable text — e.g. "תשלום במזומן")
Return ONLY valid JSON. No markdown, no explanation.`;

// ─── ENCRYPTION HELPER (for Gmail refresh tokens) ─────────────────────────────
const crypto = require('crypto');
const TOKEN_ENC_KEY = (() => {
  const raw = process.env.TOKEN_ENC_KEY || JWT_SECRET;
  // Derive a stable 32-byte key from whatever's provided
  return crypto.createHash('sha256').update(raw).digest();
})();
function encryptSecret(plain) {
  if (!plain) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', TOKEN_ENC_KEY, iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}
function decryptSecret(b64) {
  if (!b64) return null;
  try {
    const buf = Buffer.from(b64, 'base64');
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const enc = buf.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', TOKEN_ENC_KEY, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
  } catch (_) { return null; }
}

// ─── OCR HELPERS (Tesseract.js fallback when no Anthropic key) ────────────────

const COUNTRY_MAP = {
  THA: 'תאילנד', PHL: 'פיליפינים', IND: 'הודו', CHN: 'סין',
  VNM: 'וייטנאם', ISR: 'ישראל', JOR: 'ירדן', EGY: 'מצרים',
  UKR: 'אוקראינה', RUS: 'רוסיה', MDA: 'מולדובה', GEO: 'גאורגיה',
  MNG: 'מונגוליה', NPL: 'נפאל', BGD: 'בנגלדש', LKA: 'סרי לנקה',
  IDN: 'אינדונזיה', KHM: 'קמבודיה', MMR: 'מיאנמר',
};

function parseMRZ(text) {
  const toDate = (yymmdd) => {
    if (!/^\d{6}$/.test(yymmdd)) return null;
    const yy = parseInt(yymmdd.slice(0, 2));
    const year = yy <= 40 ? 2000 + yy : 1900 + yy;
    return `${year}-${yymmdd.slice(2, 4)}-${yymmdd.slice(4, 6)}`;
  };

  // ── Pass 1: strict MRZ lines (40+ chars, only valid MRZ chars) ──────────
  const strictLines = text.split('\n')
    .map(l => l.replace(/[^A-Z0-9<]/g, '').toUpperCase())
    .filter(l => l.length >= 40);

  let line1 = strictLines.find(l => /^P[<A-Z]/.test(l));
  let line2 = strictLines.find(l => /^[A-Z0-9]{9}[0-9]/.test(l) && l !== line1);

  // ── Pass 2: lenient — OCR often inserts spaces/noise, so join all text ──
  if (!line1 || !line2) {
    // Remove everything except A-Z, 0-9, <, newline — then look for MRZ patterns
    const cleaned = text.toUpperCase().replace(/[^A-Z0-9<\n]/g, '');
    const allOneLine = cleaned.replace(/\n/g, '');

    if (!line1) {
      // Look for P< anywhere followed by country code + long name field
      const m = allOneLine.match(/P[<A-Z][A-Z]{3}([A-Z<]{30,})/);
      if (m) line1 = 'P' + allOneLine.slice(allOneLine.indexOf('P'), allOneLine.indexOf('P') + 44);
    }
    if (!line2) {
      // Look for 9 alphanum chars + check digit + 3-letter nationality + 6 digits
      const m = allOneLine.match(/([A-Z0-9]{9}[0-9][A-Z]{3}\d{6}[0-9]\d{6}[0-9])/);
      if (m) line2 = m[1];
    }
  }

  const result = {};

  if (line1) {
    const countryCode = line1.slice(2, 5).replace(/</g, '');
    const namePart    = line1.slice(5);
    const dblChevron  = namePart.indexOf('<<');
    if (dblChevron >= 0) {
      const rawLast  = namePart.slice(0, dblChevron);
      const rawFirst = namePart.slice(dblChevron + 2);
      const lastName  = rawLast.replace(/<+/g, ' ').trim();
      // Split BEFORE replacing < with spaces — avoids trailing noise characters
      const firstName = rawFirst.split('<')[0].trim();
      if (lastName)  result.last_name  = lastName;
      if (firstName) result.first_name = firstName;
    }
    const country = COUNTRY_MAP[countryCode];
    if (country) result.country_of_origin = country;
  }

  if (line2) {
    const passNum   = line2.slice(0, 9).replace(/</g, '');
    const natCode   = line2.slice(10, 13).replace(/</g, '');
    const birthRaw  = line2.slice(13, 19);  // positions 13-18: YYMMDD
    const expiryRaw = line2.slice(21, 27);  // positions 21-26: YYMMDD (pos 20 = sex indicator M/F)
    if (passNum && passNum.length >= 5) result.passport_number = passNum;
    const expiry = toDate(expiryRaw);
    if (expiry) result.passport_expiry = expiry;
    const birth  = toDate(birthRaw);
    if (birth)  result.birth_date = birth;
    if (!result.country_of_origin && COUNTRY_MAP[natCode]) result.country_of_origin = COUNTRY_MAP[natCode];
  }

  // ── Pass 3: fallback — extract from VIZ (visible inspection zone) ────────
  // OCR reads the human-readable top section even when MRZ lines are garbled
  const upper = text.toUpperCase();

  // Helper: parse DDMMMYYYY or DMMMYYYY (e.g. 08JUL1989, NSEP2032 where N=1 OCR error)
  const MONTH_MAP = { JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',
                      JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12' };
  const parseDMMMYYYY = (s) => {
    // Allow first char to be digit or OCR noise like N/I (misread 1), O (misread 0)
    const m = s.match(/^([0-9NIOno]{1,2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d{4})$/i);
    if (!m) return null;
    const dayRaw = m[1].replace(/[NI]/gi,'1').replace(/[Oo]/g,'0');
    const day = dayRaw.padStart(2,'0');
    const mon = MONTH_MAP[m[2].toUpperCase()];
    const yr  = m[3];
    if (!mon || isNaN(parseInt(day))) return null;
    return `${yr}-${mon}-${day}`;
  };

  // Nationality abbreviation map (passport VIZ zone uses 4-5 letter codes, not ISO 3166-1 alpha-3)
  const NATWORD_MAP = {
    THAI: 'תאילנד', PHILIPPINE: 'פיליפינים', FILIPINO: 'פיליפינים',
    INDIAN: 'הודו', CHINESE: 'סין', ISRAELI: 'ישראל',
    JORDANIAN: 'ירדן', MYANMAR: 'מיאנמר', BURMESE: 'מיאנמר',
    VIETNAMESE: 'וייטנאם', INDONESIAN: 'אינדונזיה', CAMBODIAN: 'קמבודיה',
    NEPALI: 'נפאל', NEPALESE: 'נפאל', BANGLADESHI: 'בנגלדש',
    ETHIOPIAN: 'אתיופיה', NIGERIAN: 'ניגריה', GHANAIAN: 'גאנה',
    UKRAINIAN: 'אוקראינה', RUSSIAN: 'רוסיה', AMERICAN: 'ארצות הברית',
    BRITISH: 'בריטניה',
  };

  if (!result.last_name) {
    // Surname line: ALL-CAPS word(s) on the line following "Surname"
    const sm = text.match(/[Ss]urname[^A-Z\n]{0,20}\n?\s*([A-Z]{2,}(?:\s+[A-Z]{2,})*)/);
    if (sm) result.last_name = sm[1].trim();
  }

  if (!result.first_name) {
    // Given name: line after "Name" / "Given" label, optionally prefixed by MR./MRS.
    const nm = text.match(/(?:Given Names?|[Tt]itle[^A-Z\n]{0,15}[Nn]ame)[^A-Z\n]{0,30}\n?\s*(?:(?:MR|MRS|MS|DR)\.?\s+)?([A-Z]{2,}(?:\s+[A-Z]{2,})*)/);
    if (nm) result.first_name = nm[1].replace(/^(?:MR|MRS|MS|DR)\.?\s+/i, '').trim();
  }

  if (!result.first_name) {
    // Fallback: name preceded immediately by MR/MRS/MS title (e.g. "MRWORASIN" → "WORASIN")
    const titleM = upper.match(/\bMRS?([A-Z]{3,})\b/);
    if (titleM) result.first_name = titleM[1];
  }

  if (!result.country_of_origin) {
    // Full English name: "KINGDOM OF THAILAND", "REPUBLIC OF …" etc.
    const engHebFull = {
      THAILAND: 'תאילנד', PHILIPPINES: 'פיליפינים', INDIA: 'הודו',
      CHINA: 'סין', ISRAEL: 'ישראל', JORDAN: 'ירדן', MYANMAR: 'מיאנמר',
      VIETNAM: 'וייטנאם', INDONESIA: 'אינדונזיה', CAMBODIA: 'קמבודיה',
      NEPAL: 'נפאל', SRILANKA: 'סרי לנקה', BANGLADESH: 'בנגלדש',
      ETHIOPIA: 'אתיופיה', NIGERIA: 'ניגריה', GHANA: 'גאנה',
      UKRAINE: 'אוקראינה', RUSSIA: 'רוסיה', UNITEDSTATES: 'ארצות הברית',
      AMERICA: 'ארצות הברית', BRITAIN: 'בריטניה', UK: 'בריטניה',
    };
    const kingdomMatch = upper.match(/(?:KINGDOM|REPUBLIC|PEOPLES?|DEMOCRATIC)\s+OF\s+([A-Z]+(?:\s+[A-Z]+)?)/);
    if (kingdomMatch) {
      const key = kingdomMatch[1].replace(/\s+/g, '');
      result.country_of_origin = engHebFull[key] || null;
    }
    if (!result.country_of_origin) {
      for (const [eng, heb] of Object.entries(engHebFull)) {
        if (upper.includes(eng)) { result.country_of_origin = heb; break; }
      }
    }
    if (!result.country_of_origin) {
      // Nationality adjective words (e.g. "THAI", "INDIAN") used in VIZ zone
      for (const [word, heb] of Object.entries(NATWORD_MAP)) {
        if (upper.includes(word)) { result.country_of_origin = heb; break; }
      }
    }
  }

  if (!result.passport_number) {
    // Passport number: 1-2 letters + 6-9 digits (or letter+digit mix for some countries)
    const pnMatch = text.match(/\b([A-Z]{1,2}\d{6,9})\b/)
                 || text.match(/\b([A-Z]\d[A-Z0-9]{6,8})\b/);
    if (pnMatch) result.passport_number = pnMatch[1];
  }

  // Collect all DDMMMYYYY dates from the text
  const dmmm = [...upper.matchAll(/\b([0-9NIOno]{1,2}(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\d{4})\b/g)]
    .map(m => parseDMMMYYYY(m[1])).filter(Boolean);

  // Also collect DD/MM/YYYY style dates
  const dslash = [...upper.matchAll(/\b(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.]((?:19|20)\d{2})\b/g)]
    .map(m => `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`);

  const allDates = [...dmmm, ...dslash];

  // Assign dates by year heuristic:
  //   birth_date   → year well in the past (born at least 10 years ago)
  //   passport_expiry → future date (or at most 1 year expired as fallback)
  const nowYear = new Date().getFullYear();
  if (!result.birth_date || !result.passport_expiry) {
    for (const d of allDates) {
      const yr = parseInt(d.slice(0, 4));
      if (!result.birth_date && yr <= nowYear - 10) { result.birth_date = d; }
    }
    // Prefer strictly future expiry first
    for (const d of allDates) {
      const yr = parseInt(d.slice(0, 4));
      if (!result.passport_expiry && yr >= nowYear) { result.passport_expiry = d; }
    }
    // Fallback: most recent past date (could be recent expiry or issue date)
    if (!result.passport_expiry) {
      const recent = allDates.filter(d => parseInt(d.slice(0,4)) >= nowYear - 2 && parseInt(d.slice(0,4)) < nowYear);
      if (recent.length) result.passport_expiry = recent[recent.length - 1];
    }
  }

  // Expiry date: look near "Expiry" / "Date of Expiry" label (overrides heuristic)
  if (!result.passport_expiry) {
    const expiryNear = text.match(/[Ee]xpir[^\d]{0,20}(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.](?:20\d{2}|\d{2}))/);
    if (expiryNear) {
      const parts = expiryNear[1].split(/[\/\-\.]/);
      if (parts.length === 3) {
        const y = parts[2].length === 2 ? '20' + parts[2] : parts[2];
        result.passport_expiry = `${y}-${parts[1].padStart(2,'0')}-${parts[0].padStart(2,'0')}`;
      }
    }
  }

  // Birth date: near "Date of Birth" / "Birth" label (overrides heuristic)
  if (!result.birth_date) {
    const bm = text.match(/[Bb]irth[^0-9]{0,25}(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.](?:19|20)\d{2})/);
    if (bm) {
      const parts = bm[1].split(/[\/\-\.]/);
      if (parts.length === 3) {
        result.birth_date = `${parts[2]}-${parts[1].padStart(2,'0')}-${parts[0].padStart(2,'0')}`;
      }
    }
  }

  return result;
}

function parseVehicleLicense(text) {
  const result = {};

  // ── License plate ─────────────────────────────────────────────────────────
  // New Israeli format: 12-345-67 or 123-45-678 (pure digits with dashes/spaces)
  // Old format: 12-345 or 12-34-567
  const plateMatch = text.match(/\b(\d{2,3}[-\s]\d{2,3}[-\s]\d{2,3})\b/)
                  || text.match(/\b(\d{2,3}[-\s]\d{2,3})\b/)
                  || text.match(/([א-ת]{1,3}[-\s]\d{2,4}[-\s][א-ת]{0,3})/);
  if (plateMatch) result.license_plate = plateMatch[1].replace(/\s+/g, '-').replace(/-+/g, '-');

  // ── Year ──────────────────────────────────────────────────────────────────
  // Look near שנת / year label first, then anywhere
  const yearNear = text.match(/(?:שנת|שנה)[^\d]{0,10}(\d{4})/);
  const yearAny  = text.match(/\b(19[7-9]\d|20[0-2]\d)\b/);
  const yearSrc  = yearNear || yearAny;
  if (yearSrc) result.year = parseInt(yearSrc[1]);

  // ── Manufacturer ──────────────────────────────────────────────────────────
  const MAKES = [
    ['טויוטה','Toyota','TOYOTA'], ['מזדה','Mazda','MAZDA'], ['הונדה','Honda','HONDA'],
    ['מיצובישי','Mitsubishi','MITSUBISHI'], ['ניסאן','Nissan','NISSAN'],
    ['יונדאי','Hyundai','HYUNDAI'], ['קיה','Kia','KIA'], ['סוזוקי','Suzuki','SUZUKI'],
    ['פורד','Ford','FORD'], ['פולקסוואגן','Volkswagen','VW','VOLKSWAGEN'],
    ['BMW'], ['אאודי','Audi','AUDI'], ['מרצדס','Mercedes','MERCEDES','BENZ'],
    ['וולוו','Volvo','VOLVO'], ['סובארו','Subaru','SUBARU'],
    ["פיג'ו",'Peugeot','PEUGEOT'], ['רנו','Renault','RENAULT'],
    ['סיטרואן','Citroen','CITROEN'], ['איסוזו','Isuzu','ISUZU'],
    ['MAN'], ['שברולט','Chevrolet','CHEVROLET'], ['אופל','Opel','OPEL'],
    ['פיאט','Fiat','FIAT'], ['סקודה','Skoda','SKODA'], ['סיאט','Seat','SEAT'],
    ['לקסוס','Lexus','LEXUS'], ['דאיהטסו','Daihatsu','DAIHATSU'],
    ['DODGE'], ['JEEP'], ['CHRYSLER'], ['TESLA'],
    ['מאזדה','Mazda','MAZDA'], // alternate spelling
  ];
  // Also check text after יצרן label
  const makeLabel = text.match(/(?:יצרן|סוג|מותג)[:\s]+([^\n\r]{2,30})/);
  if (makeLabel) {
    const labelText = makeLabel[1].trim();
    for (const variants of MAKES) {
      if (variants.some(v => new RegExp(v, 'i').test(labelText))) {
        result.manufacturer = variants[0]; break;
      }
    }
  }
  if (!result.manufacturer) {
    for (const variants of MAKES) {
      if (variants.some(v => new RegExp(v, 'i').test(text))) {
        result.manufacturer = variants[0]; break;
      }
    }
  }

  // ── Test dates ────────────────────────────────────────────────────────────
  const toIsoDate = (raw) => {
    if (!raw) return null;
    const parts = raw.split(/[./\-]/);
    if (parts.length !== 3) return null;
    const y = parts[2].length === 2 ? '20' + parts[2] : parts[2];
    return `${y}-${parts[1].padStart(2,'0')}-${parts[0].padStart(2,'0')}`;
  };

  // Look for dates near "טסט" / "בדיקה" / "תוקף"
  const allDates = [...text.matchAll(/(\d{1,2}[./\-]\d{1,2}[./\-]\d{2,4})/g)].map(m => m[1]);
  const nextTestMatch = text.match(/(?:טסט|בדיקה|תוקף)[^\d]{0,30}(\d{1,2}[./\-]\d{1,2}[./\-]\d{2,4})/);
  const lastTestMatch = text.match(/(?:עבר|אחרון)[^\d]{0,30}(\d{1,2}[./\-]\d{1,2}[./\-]\d{2,4})/);

  if (nextTestMatch) result.next_test_date = toIsoDate(nextTestMatch[1]);
  if (lastTestMatch) result.last_test_date  = toIsoDate(lastTestMatch[1]);

  // If we have 2+ date values and no labeled match, assume first=last_test, second=next_test
  if (!result.next_test_date && !result.last_test_date && allDates.length >= 2) {
    result.last_test_date  = toIsoDate(allDates[0]);
    result.next_test_date  = toIsoDate(allDates[1]);
  } else if (!result.next_test_date && allDates.length >= 1) {
    result.next_test_date = toIsoDate(allDates[0]);
  }

  // Remove null values
  for (const k of Object.keys(result)) { if (!result[k]) delete result[k]; }
  return result;
}

async function ocrExtractDocument(filePath, documentType) {
  const { createWorker } = require('tesseract.js');
  const isPassport = documentType !== 'vehicle_license';
  // Passport MRZ is always Latin; vehicle license has Hebrew
  const langs = isPassport ? 'eng' : 'heb+eng';
  console.log(`[OCR] starting ${documentType}, langs=${langs}`);
  const tessDataPath = path.join(__dirname, 'tessdata');
  fs.mkdirSync(tessDataPath, { recursive: true });

  // Check if language files exist locally; if not, log a clear error
  const requiredFiles = isPassport ? ['eng.traineddata'] : ['heb.traineddata', 'eng.traineddata'];
  const missing = requiredFiles.filter(f => !fs.existsSync(path.join(tessDataPath, f)));
  if (missing.length > 0) {
    console.error(`[OCR] Missing tessdata files: ${missing.join(', ')}. Run the download script on the server.`);
    throw new Error(`חסרים קבצי OCR: ${missing.join(', ')}. הורד אותם לתיקיית tessdata.`);
  }

  const worker = await createWorker(langs, 1, {
    langPath: tessDataPath,   // use local files — no internet download needed
    cachePath: tessDataPath,
    logger: m => { if (m.status !== 'recognizing text') console.log('[OCR]', m.status, Math.round((m.progress||0)*100)+'%'); },
  });
  try {
    if (isPassport) {
      // For passports restrict chars to MRZ alphabet + let Tesseract focus on clean lines
      await worker.setParameters({
        tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<',
        tessedit_pageseg_mode: '6',   // uniform block of text
      });
    }
    const { data: { text } } = await worker.recognize(filePath);
    console.log('[OCR raw]', text.replace(/\s+/g, ' ').slice(0, 500));
    const extracted = isPassport ? parseMRZ(text) : parseVehicleLicense(text);
    console.log('[OCR extracted]', JSON.stringify(extracted));
    return extracted;
  } finally {
    await worker.terminate();
  }
}

// ─── Groq Vision OCR ──────────────────────────────────────────────────────────
// Uses llama-3.2-11b-vision (free tier) — better than Tesseract for documents
async function groqVisionExtract(filePath, documentType) {
  const GROQ_KEY = getGroqApiKey();
  if (!GROQ_KEY) throw new Error('GROQ_API_KEY not configured');

  const fileBuffer = fs.readFileSync(filePath);
  const base64Data = fileBuffer.toString('base64');
  const ext = path.extname(filePath).toLowerCase();
  const mediaType = ext === '.png' ? 'image/png' : 'image/jpeg';

  const prompt = documentType === 'vehicle_license'
    ? 'This is an Israeli vehicle license (רישיון רכב). Extract ONLY these fields as a JSON object: license_plate (string), manufacturer (string), model (string), year (number), last_test_date (YYYY-MM-DD), next_test_date (YYYY-MM-DD). Return ONLY valid JSON, nothing else.'
    : documentType === 'invoice'
    ? INVOICE_EXTRACTION_PROMPT
    : 'This is a passport photo page. Extract ONLY these fields as a JSON object: first_name (Latin letters as printed), last_name (Latin letters as printed), passport_number (string), passport_expiry (YYYY-MM-DD), country_of_origin (in Hebrew, e.g. תאילנד פיליפינים הודו), birth_date (YYYY-MM-DD). Return ONLY valid JSON, nothing else.';

  const body = JSON.stringify({
    model: 'meta-llama/llama-4-scout-17b-16e-instruct',
    messages: [{
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: `data:${mediaType};base64,${base64Data}` } },
        { type: 'text', text: prompt }
      ]
    }],
    max_tokens: 300,
    temperature: 0.1
  });

  console.log('[Groq Vision] calling API, model: llama-4-scout-17b');
  const result = await httpsRequest({
    hostname: 'api.groq.com',
    path: '/openai/v1/chat/completions',
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${GROQ_KEY}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body)
    }
  }, body);

  if (result.status !== 200) {
    console.error('[Groq Vision] API error:', result.status, result.body.slice(0, 200));
    throw new Error(`Groq Vision API error: ${result.status}`);
  }

  const data = JSON.parse(result.body);
  const text = data.choices?.[0]?.message?.content || '{}';
  console.log('[Groq Vision] raw response:', text.slice(0, 300));
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON in Groq Vision response');
  const extracted = JSON.parse(jsonMatch[0]);
  for (const k of Object.keys(extracted)) { if (!extracted[k]) delete extracted[k]; }
  return extracted;
}

// ─── HuggingFace Vision OCR ────────────────────────────────────────────────────
async function hfVisionExtract(filePath, documentType) {
  const HF_TOKEN = process.env.HF_TOKEN;
  if (!HF_TOKEN) throw new Error('HF_TOKEN not configured');

  const fileBuffer = fs.readFileSync(filePath);
  const base64Data = fileBuffer.toString('base64');
  const ext = path.extname(filePath).toLowerCase();
  const mediaType = ext === '.png' ? 'image/png' : 'image/jpeg';

  const prompt = documentType === 'vehicle_license'
    ? 'This is an Israeli vehicle license (רישיון רכב). Extract ONLY these fields as a JSON object: license_plate (string), manufacturer (string), model (string), year (number), last_test_date (YYYY-MM-DD format), next_test_date (YYYY-MM-DD format). Return ONLY valid JSON, no explanation.'
    : documentType === 'invoice'
    ? INVOICE_EXTRACTION_PROMPT
    : 'This is a passport. Extract ONLY these fields as a JSON object: first_name (Latin, as printed), last_name (Latin, as printed), passport_number (string), passport_expiry (YYYY-MM-DD), country_of_origin (in Hebrew, e.g. תאילנד), birth_date (YYYY-MM-DD). Return ONLY valid JSON, no explanation.';

  const body = JSON.stringify({
    model: process.env.HF_MODEL || 'Qwen/Qwen2.5-VL-3B-Instruct',
    messages: [{
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: `data:${mediaType};base64,${base64Data}` } },
        { type: 'text', text: prompt }
      ]
    }],
    max_tokens: 300
  });

  console.log('[HF] calling inference API, model:', process.env.HF_MODEL || 'Qwen/Qwen2.5-VL-3B-Instruct');
  const result = await httpsRequest({
    hostname: 'router.huggingface.co',
    path: '/v1/chat/completions',
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${HF_TOKEN}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body)
    }
  }, body);

  if (result.status !== 200) {
    console.error('[HF] API error status:', result.status, result.body.slice(0, 200));
    throw new Error(`HuggingFace API error: ${result.status}`);
  }

  const data = JSON.parse(result.body);
  const text = data.choices?.[0]?.message?.content || '{}';
  console.log('[HF] raw response:', text.slice(0, 300));
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON in HF response');
  const extracted = JSON.parse(jsonMatch[0]);
  // Remove null/empty values
  for (const k of Object.keys(extracted)) { if (!extracted[k]) delete extracted[k]; }
  return extracted;
}

// ─── CLAUDE VISION EXTRACT (callable from any handler) ────────────────────────
async function claudeVisionExtract(filePath, documentType) {
  const apiKey = getAiApiKey();
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');

  const ext = path.extname(filePath).toLowerCase();
  const isPdf = ext === '.pdf';

  let fileBuffer, mediaType;
  if (isPdf) {
    fileBuffer = fs.readFileSync(filePath);
    mediaType = 'application/pdf';
  } else {
    // צילומים מהנייד יכולים להיות 2-5MB — מקטינים ודוחסים לפני השליחה ל-Claude
    // (מהיר וזול הרבה יותר; jimp גם מתקן אוריינטציית EXIF). דרכון מכיל טקסט קטן
    // (מספר דרכון/MRZ) ולכן נשמר ברזולוציה גבוהה יותר; שאר המסמכים ב-1568px.
    const maxSide = (documentType === 'passport' || documentType === 'vehicle_license') ? 2000 : 1568;
    try {
      const Jimp = require('jimp');
      const img = await Jimp.read(filePath);
      if (Math.max(img.bitmap.width, img.bitmap.height) > maxSide) img.scaleToFit(maxSide, maxSide);
      img.quality(documentType === 'passport' ? 85 : 80);
      fileBuffer = await img.getBufferAsync(Jimp.MIME_JPEG);
      mediaType = 'image/jpeg';
    } catch (e) {
      console.warn('[Claude Vision] jimp resize failed, sending original:', String(e?.message || e));
      fileBuffer = fs.readFileSync(filePath);
      mediaType = ext === '.png' ? 'image/png' : ext === '.gif' ? 'image/gif' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    }
  }
  const base64Data = fileBuffer.toString('base64');

  const prompt = documentType === 'vehicle_license'
    ? `Analyze this Israeli vehicle license image and extract: license_plate (string), manufacturer (string), model (string), year (number), last_test_date (YYYY-MM-DD string), next_test_date (YYYY-MM-DD string). Return ONLY a JSON object, no other text.`
    : documentType === 'invoice'
    ? INVOICE_EXTRACTION_PROMPT
    : documentType === 'insurance_policy'
    ? `This is an Israeli vehicle insurance policy (פוליסת ביטוח רכב). Extract as a JSON object — use null for any field not present:
- provider: string (the insurance company name, in Hebrew — e.g. הראל, כלל, מנורה, איילון, AIG)
- policy_number: string (מספר פוליסה)
- start_date: string (coverage start date / תחילת תקופת הביטוח, YYYY-MM-DD)
- end_date: string (coverage end date / תום תקופת הביטוח, YYYY-MM-DD)
- cost: number (total premium / סך הפרמיה לתשלום, digits only, no currency symbol)
- license_plate: string (the insured vehicle plate / מספר רכב, if shown)
Return ONLY the JSON object, no other text.`
    : documentType === 'employee_document'
    ? `This document was received by email and is NOT an invoice. It may relate to a foreign worker (insurance policy, ministry permit, visa, contract, medical form). Extract as a JSON object — use null or [] when absent:
- passport_numbers: array of strings (every passport number appearing in the document; typically 1-2 letters followed by 6-9 digits)
- person_names: array of strings (names of the people the document is about, as printed)
- document_kind: string in Hebrew describing the document (e.g. "פוליסת ביטוח עובד", "אישור משרד הפנים", "ויזה", "חוזה העסקה")
- is_employee_document: boolean (true only if the document is clearly about a specific person, not a company)
Return ONLY the JSON object, no other text.`
    : `Analyze this passport image and extract: first_name (English, as on passport), last_name (English, as on passport), passport_number (string), passport_expiry (YYYY-MM-DD), country_of_origin (in Hebrew, e.g. תאילנד), birth_date (YYYY-MM-DD). Return ONLY a JSON object, no other text. Do NOT translate names.`;

  // Claude content blocks: 'document' for PDFs, 'image' for everything else
  const source = { type: 'base64', media_type: mediaType, data: base64Data };
  const contentBlock = isPdf ? { type: 'document', source } : { type: 'image', source };

  // Invoices need more tokens (line items can be long); PDFs can have multiple pages
  const maxTokens = documentType === 'invoice' ? (isPdf ? 3000 : 2000) : 512;

  const body = JSON.stringify({
    model: 'claude-haiku-4-5',
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: [contentBlock, { type: 'text', text: prompt }] }]
  });

  console.log(`[Claude Vision] file=${path.basename(filePath)} type=${documentType} mediaType=${mediaType} size=${fileBuffer.length}B`);

  const rawResult = await httpsRequest({
    hostname: 'api.anthropic.com',
    path: '/v1/messages',
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body)
    }
  }, body);

  if (rawResult.status >= 400) {
    console.error(`[Claude Vision] HTTP ${rawResult.status} body=${rawResult.body.slice(0, 500)}`);
  }
  let result;
  try { result = JSON.parse(rawResult.body); }
  catch { throw new Error(`Claude API non-JSON response (HTTP ${rawResult.status})`); }
  if (result.error) throw new Error(result.error.message || 'Claude API error');

  const text = result.content?.[0]?.text || '{}';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  let extracted = {};
  if (jsonMatch) {
    try {
      extracted = JSON.parse(jsonMatch[0]);
    } catch {
      // ניקוי שגיאות JSON נפוצות של LLM: פסיקים עוקבים ותווי בקרה
      try {
        const cleaned = jsonMatch[0].replace(/,\s*([}\]])/g, '$1').replace(/[\u0000-\u001F]+/g, ' ');
        extracted = JSON.parse(cleaned);
      } catch { extracted = {}; }
    }
  }
  for (const k of Object.keys(extracted)) {
    if (extracted[k] === null || extracted[k] === '' || extracted[k] === undefined) delete extracted[k];
  }
  return extracted;
}

// ─── DOCUMENT EXTRACTION (Claude → Groq Vision → HuggingFace → Tesseract) ──────
// PDFs go ONLY through Claude (Groq/HF/Tesseract can't process PDFs).
// Invoice extraction skips Tesseract (no working parser for free-form invoices).
// ─── PDF TEXT EXTRACTION (free, no AI) ────────────────────────────────────────
// מחלץ את שכבת הטקסט מ-PDF (pdf-parse) ומריץ פרסר חשבוניות עברי היוריסטי.
// עובד על PDF שהופק ממחשב (שכבת טקסט). PDF סרוק/תמונה יחזיר טקסט ריק.
async function pdfTextExtractInvoice(filePath) {
  // require של הקובץ הפנימי עוקף באג idx ב-pdf-parse@1.1.1 (קריאת test pdf)
  const pdfParse = require('pdf-parse/lib/pdf-parse.js');
  const buf = fs.readFileSync(filePath);
  const parsed = await pdfParse(buf);
  const text = (parsed && parsed.text) ? parsed.text : '';
  if (!text.trim()) return {};
  return parseInvoiceText(text);
}

// פרסר חשבונית עברית מתוך טקסט גולמי. מחזיר שדות בשמות שהמערכת מצפה להם.
function parseInvoiceText(rawText) {
  const text = String(rawText || '')
    .replace(/[״”“]/g, '"').replace(/[׳’]/g, "'");

  // אם אין מילת-מפתח עברית בסדר לוגי — כנראה PDF עם טקסט הפוך (RTL), קידוד legacy או סרוק.
  // במקרים אלה חילוץ היוריסטי מייצר נתונים שגויים — עדיף לא לנחש ולהשאיר למילוי ידני.
  const HEB_KW = ['חשבונית', 'מע"מ', 'לתשלום', 'סה"כ', 'סהכ', 'חשבון', 'קבלה'];
  if (!HEB_KW.some(k => text.includes(k))) return {};

  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  const MONEY = /(\d{1,3}(?:[,.\s]\d{3})*(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)/g;
  const toNum = (s) => {
    s = String(s).replace(/\s/g, '');
    if (s.includes(',') && s.includes('.')) s = s.replace(/,/g, '');
    else if ((s.match(/,/g) || []).length === 1 && s.split(',')[1]?.length === 2) s = s.replace(',', '.');
    else s = s.replace(/,/g, '');
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : null;
  };
  // סכום סביר לחשבונית — מסנן מספרים ענקיים כמו ח.פ/ת.ז/מס' חשבון (לא ייבחרו כסכום)
  const plausible = (v) => v != null && v > 0 && v < 10000000;
  const amountsOn = (line) => (line.match(MONEY) || []).map(m => [m, toNum(m)]).filter(([, v]) => plausible(v));
  const largest = (str) => {
    let best = null, bv = -1;
    for (const m of (str.match(MONEY) || [])) { const v = toNum(m); if (plausible(v) && v > bv) { bv = v; best = m; } }
    return best;
  };

  const TOTAL_KW = ['סה"כ לתשלום', 'סהכ לתשלום', 'סך הכל לתשלום', 'לתשלום', 'סה"כ כולל מע"מ', 'total', 'סה"כ', 'סהכ', 'סך הכל', 'סך הכול'];
  const VAT_KW = ['מע"מ', 'מעמ', 'מס ערך מוסף', 'vat'];
  const INV_KW = ['חשבונית מס\'', 'חשבונית מספר', 'מס\' חשבונית', 'מספר חשבונית', 'חשבונית מס', 'מסמך מס', 'invoice'];
  const ID_KW = ['עוסק מורשה', 'עוסק פטור', 'ח.פ', 'חפ', 'ע.מ', 'עוסק', 'ת.ז'];

  const lower = lines.map(l => l.toLowerCase());

  // total
  let total = null;
  for (const kw of TOTAL_KW) {
    for (let i = 0; i < lower.length; i++) {
      if (lower[i].includes(kw.toLowerCase())) {
        let a = amountsOn(lines[i]);
        if (!a.length && i + 1 < lines.length) a = amountsOn(lines[i + 1]);
        if (a.length) { a.sort((x, y) => y[1] - x[1]); total = a[0][0]; break; }
      }
    }
    if (total) break;
  }
  if (!total) total = largest(text);

  // vat
  let vat = null;
  for (const kw of VAT_KW) {
    for (let i = 0; i < lower.length; i++) {
      if (lower[i].includes(kw.toLowerCase())) {
        const a = amountsOn(lines[i]);
        const cand = a.find(([, v]) => ![17, 18, 0.17, 0.18].includes(v));
        if (cand) { vat = cand[0]; break; }
      }
    }
    if (vat) break;
  }

  // invoice number
  let invoiceNumber = null;
  for (const kw of INV_KW) {
    const rx = new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "[^\\d]{0,8}(\\d{2,}(?:[-/]\\d{2,})?)", 'i');
    const m = text.match(rx);
    if (m) { invoiceNumber = m[1]; break; }
  }
  if (!invoiceNumber) { const m = text.match(/#\s*(\d{3,})/); if (m) invoiceNumber = m[1]; }

  // date -> normalize to YYYY-MM-DD when possible
  let date = null;
  let dm = text.match(/תאריך\D{0,10}(\d{1,2}[./-]\d{1,2}[./-]\d{2,4})/) || text.match(/\b(\d{1,2}[./-]\d{1,2}[./-]\d{2,4})\b/);
  if (dm) {
    const parts = dm[1].split(/[./-]/);
    let [d, mo, y] = parts;
    if (y && y.length === 2) y = '20' + y;
    if (y && mo && d) date = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    else date = dm[1];
  }

  // business id (ח.פ / עוסק)
  let businessId = null;
  for (const kw of ID_KW) {
    const rx = new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "[^\\d]{0,6}(\\d{8,9})");
    const m = text.match(rx);
    if (m) { businessId = m[1]; break; }
  }
  if (!businessId) { const m = text.match(/\b(\d{9})\b/); if (m) businessId = m[1]; }

  // supplier = first meaningful line near the top
  let supplier = null;
  const skip = ['חשבונית', 'קבלה', 'מקור', 'עותק', 'tax', 'invoice', 'מסמך'];
  for (const l of lines.slice(0, 8)) {
    if (l.length < 3) continue;
    const digits = (l.match(/\d/g) || []).length;
    if (digits > l.length * 0.4) continue;
    if (skip.some(t => l.toLowerCase().includes(t))) continue;
    supplier = l; break;
  }
  if (!supplier && lines.length) supplier = lines[0];

  return {
    supplier_name: supplier || null,
    supplier_vat_id: businessId || null,
    invoice_number: invoiceNumber || null,
    date: date || null,
    total: total != null ? toNum(total) : null,
    vat_amount: vat != null ? toNum(vat) : null,
    currency: 'ILS',
  };
}

async function runDocumentExtraction(filePath, documentType) {
  const apiKey  = getAiApiKey();
  const groqKey = getGroqApiKey();
  const isInvoice = documentType === 'invoice';
  const isPdf = path.extname(filePath).toLowerCase() === '.pdf';

  if (isPdf) {
    // 1) Claude vision (הכי מדויק) — אם מוגדר מפתח
    if (apiKey) {
      try {
        const data = await claudeVisionExtract(filePath, documentType);
        return { method: 'claude', data };
      } catch (err) {
        console.error('[Claude PDF] error, trying text extraction:', String(err?.message || err));
      }
    }
    // 2) חילוץ שכבת טקסט מה-PDF + פרסר עברי (חינמי, ללא מפתח) — לחשבוניות בלבד
    if (isInvoice) {
      try {
        const data = await pdfTextExtractInvoice(filePath);
        if (data && (data.total != null || data.invoice_number || data.supplier_name)) {
          return { method: 'pdf-text', data };
        }
        console.log('[pdf-text] לא נמצאה שכבת טקסט מספקת (כנראה PDF סרוק)');
      } catch (err) {
        console.error('[pdf-text] error:', String(err?.message || err));
      }
    }
    throw new Error('עיבוד PDF נכשל: אין שכבת טקסט לחילוץ ואין מפתח Claude. החשבונית תישמר למילוי ידני.');
  }

  if (apiKey) {
    try {
      const data = await claudeVisionExtract(filePath, documentType);
      return { method: 'claude', data };
    } catch (err) {
      console.error('[Claude Vision] error, trying next:', String(err?.message || err));
    }
  }
  if (groqKey) {
    try {
      const data = await groqVisionExtract(filePath, documentType);
      return { method: 'groq_vision', data };
    } catch (err) {
      console.error('[Groq Vision] error, trying next:', String(err?.message || err));
    }
  }
  if (process.env.HF_TOKEN) {
    try {
      const data = await hfVisionExtract(filePath, documentType);
      return { method: 'hf', data };
    } catch (err) {
      console.error('[HF] error:', String(err?.message || err));
    }
  }
  if (isInvoice) {
    throw new Error('חילוץ חשבונית דורש מפתח AI (Anthropic / Groq / HuggingFace). אין חזרה ל-OCR מקומי.');
  }
  // Tesseract fallback only for passport/vehicle docs that have hand-coded parsers
  const data = await ocrExtractDocument(filePath, documentType);
  return { method: 'ocr', data };
}

app.post('/api/extract-document', authMiddleware, aiLimiter, async (req, res) => {
  const { file_url, document_type } = req.body;
  if (!file_url) return res.status(400).json({ error: 'file_url required' });
  try {
    const filename = path.basename(file_url.split('?')[0]);
    const filePath = path.join(UPLOADS_DIR, filename);
    console.log('[extract] file_url:', file_url, '→ filePath:', filePath, 'exists:', fs.existsSync(filePath), 'doc_type:', document_type);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
    const { method, data } = await runDocumentExtraction(filePath, document_type);
    const count = Object.keys(data || {}).length;
    res.json({ success: count > 0, data, method });
  } catch (err) {
    console.error('extract-document error:', String(err), err?.stack?.split('\n')[1] || '');
    res.json({ success: false, error: String(err?.message || err), data: {} });
  }
});

// ─── INVOICES & SUPPLIERS ─────────────────────────────────────────────────────

// Normalize a name for fuzzy matching: lower-case, strip punctuation and bidi marks
function normName(s) {
  return String(s || '')
    .normalize('NFKC')
    .replace(/["'`׳״]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// כתובות מספקי דואר צרכניים אינן מזהות עסק — הן שייכות לאדם ששלח/העביר את המייל.
// שימוש בהן לזיהוי ספק מקשר חשבוניות של ספקים שונים לאותה רשומה.
const CONSUMER_EMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'hotmail.com', 'hotmail.co.il', 'outlook.com', 'live.com',
  'yahoo.com', 'yahoo.co.il', 'walla.com', 'walla.co.il', 'icloud.com', 'me.com', '013.net', 'bezeqint.net',
]);

function isIdentifyingEmail(email) {
  const e = String(email || '').toLowerCase().trim();
  if (!e.includes('@')) return false;
  return !CONSUMER_EMAIL_DOMAINS.has(e.split('@').pop());
}

// Find or create a supplier in the given farm, by vat_id first, then by fuzzy name match
function findOrCreateSupplier(farmId, { name, vat_id, phone, address, email } = {}) {
  const farmRows = db.prepare("SELECT id, data FROM entities WHERE entity_type='suppliers' AND farm_id=?").all(farmId);
  const suppliers = farmRows.map(r => ({ id: r.id, ...JSON.parse(r.data || '{}') }));

  // כתובת השולח היא רמז חלש: חשבונית שהמשתמש מעביר לעצמו נשלחת מהכתובת הפרטית שלו,
  // וגם ספקים רבים שולחים מ-gmail. התאמה לפיה קישרה 39 חשבוניות לספק שגוי — כל חשבונית
  // שהועברה מ-guydid@gmail.com "נדבקה" לספק הראשון שקיבל את הכתובת הזו.
  // לכן: אימייל צרכני לעולם לא משמש לזיהוי, והוא נבדק רק *אחרי* השם.
  const usableEmail = isIdentifyingEmail(email) ? String(email).toLowerCase().trim() : null;

  let match = null;
  if (vat_id) {
    const cleanVat = String(vat_id).replace(/\D/g, '');
    match = suppliers.find(s => String(s.vat_id || '').replace(/\D/g, '') === cleanVat && cleanVat.length >= 7);
  }
  if (!match && name) {
    const target = normName(name);
    match = suppliers.find(s => normName(s.name) === target);
  }
  if (!match && usableEmail) {
    match = suppliers.find(s => Array.isArray(s.email_addresses) && s.email_addresses.some(x => String(x).toLowerCase() === usableEmail));
  }

  if (match) {
    // Augment supplier with new info we learned (email/phone/address) if absent
    const update = { ...match };
    let changed = false;
    // רק כתובות מזהות נשמרות על הספק — אחרת כתובת פרטית מזהמת רשומות ומקשרת ספקים זרים
    if (usableEmail) {
      const list = Array.isArray(update.email_addresses) ? update.email_addresses : [];
      if (!list.some(e => String(e).toLowerCase() === usableEmail)) {
        update.email_addresses = [...list, usableEmail];
        changed = true;
      }
    }
    if (phone && !update.phone) { update.phone = phone; changed = true; }
    if (address && !update.address) { update.address = address; changed = true; }
    if (vat_id && !update.vat_id) { update.vat_id = vat_id; changed = true; }
    if (changed) {
      const data = { ...update };
      delete data.id;
      db.prepare('UPDATE entities SET data=?, updated_at=? WHERE entity_type=? AND id=?').run(
        JSON.stringify(data), NOW(), 'suppliers', match.id
      );
    }
    return { ...update, id: match.id };
  }

  // Create new supplier
  const id = uuidv4();
  const data = {
    name: name || 'ספק לא ידוע',
    vat_id: vat_id || null,
    phone: phone || null,
    address: address || null,
    email_addresses: usableEmail ? [usableEmail] : [],
    notes: '',
  };
  db.prepare('INSERT INTO entities (id, entity_type, farm_id, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    id, 'suppliers', farmId, JSON.stringify(data), NOW(), NOW()
  );
  return { id, ...data };
}

// אותה חשבונית מגיעה לעיתים בשני מיילים נפרדים (מקור + תזכורת/העברה), ואז דילוג לפי
// message_id לא תופס אותה. שם הספק ושם הקובץ אינם דטרמיניסטיים — אותה חשבונית הופקה
// עם שם ספק שונה במקצת בכל חילוץ, וספקים מצרפים לעיתים שם קובץ שונה בכל שליחה.
// לכן שלוש שכבות זיהוי, מהחזקה לחלשה:
//   1. שם קובץ + סכום (המפתח המקורי — תופס העברות של אותו קובץ בדיוק).
//   2. כתובת השולח + מספר חשבונית + סכום — יציב גם כששם הקובץ/הספק משתנה.
//   3. כתובת השולח + תאריך + סכום, רק כשלשני הצדדים אין מספר חשבונית.
// ל-Invoice.pdf ול-Receipt.pdf של אותה עסקה יש אותו ספק, מספר וסכום — שני מסמכים
// שונים שאסור לקפל לאחד, ולכן שכבות 2-3 דורשות שסוג המסמך לא יסתור.
function findExistingInvoice(farmId, extracted, attachmentName, fromEmail) {
  if (extracted?.total == null) return null;
  const norm = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const normNum = s => String(s || '').replace(/\s/g, '').toLowerCase();
  const fileKey = attachmentName ? `${norm(attachmentName)}|${extracted.total}` : null;
  const senderEmail = norm(fromEmail);
  const extractedNum = normNum(extracted.invoice_number);
  const rows = db.prepare("SELECT id, data FROM entities WHERE entity_type='invoices' AND farm_id=?").all(farmId);
  for (const r of rows) {
    let d;
    try { d = JSON.parse(r.data || '{}'); } catch { continue; }
    if (d.total == null) continue;

    // שכבה 1: אותו שם קובץ + אותו סכום
    if (fileKey && d.source_meta?.attachment_name &&
        `${norm(d.source_meta.attachment_name)}|${d.total}` === fileKey) {
      return { id: r.id, ...d };
    }

    if (!senderEmail || norm(d.source_meta?.from) !== senderEmail) continue;
    if (Number(d.total) !== Number(extracted.total)) continue;
    const typeA = extracted.invoice_type || null;
    const typeB = d.invoice_type || null;
    const typesCompatible = !typeA || !typeB || typeA === typeB;
    if (!typesCompatible) continue;

    // שכבה 2: אותו שולח + אותו מספר חשבונית + אותו סכום
    const existingNum = normNum(d.invoice_number);
    if (extractedNum && existingNum && extractedNum === existingNum) return { id: r.id, ...d };

    // שכבה 3: אין מספר חשבונית בשני הצדדים — אותו שולח + תאריך + סכום
    if (!extractedNum && !existingNum && extracted.date && d.date === extracted.date) return { id: r.id, ...d };
  }
  return null;
}

function saveInvoiceFromExtraction(farmId, supplierId, extracted, fileInfo, source, sourceMeta = {}) {
  const id = uuidv4();
  const data = {
    supplier_id: supplierId,
    supplier_name: extracted.supplier_name || null,
    invoice_number: extracted.invoice_number || null,
    invoice_type: extracted.invoice_type || null,
    date: extracted.date || null,
    due_date: extracted.due_date || null,
    subtotal: extracted.subtotal ?? null,
    vat_rate: extracted.vat_rate ?? null,
    vat_amount: extracted.vat_amount ?? null,
    total: extracted.total ?? null,
    currency: extracted.currency || 'ILS',
    items: Array.isArray(extracted.items) ? extracted.items : [],
    notes: extracted.notes || null,
    file_url: fileInfo?.file_url || null,
    file_name: fileInfo?.filename || null,
    source, // 'upload' | 'gmail' | 'manual'
    source_meta: sourceMeta,
    status: 'pending', // pending | reviewed | approved
    extracted_raw: extracted,
  };
  db.prepare('INSERT INTO entities (id, entity_type, farm_id, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    id, 'invoices', farmId, JSON.stringify(data), NOW(), NOW()
  );
  return { id, farm_id: farmId, ...data };
}

// POST /api/invoices/scan  (multipart: file=<image|pdf>)
app.post('/api/invoices/scan', authMiddleware, aiLimiter, upload.single('file'), async (req, res) => {
  const user = getUser(req.user.id);
  if (!user || !user.current_farm_id) return res.status(400).json({ error: 'משתמש ללא חוות ברירת מחדל' });
  if (!req.file) return res.status(400).json({ error: 'לא הועלה קובץ' });

  const member = getFarmMember(user.current_farm_id, req.user.id);
  if (member && member.role === 'viewer') {
    fs.unlinkSync(path.join(UPLOADS_DIR, req.file.filename));
    return res.status(403).json({ error: 'משתמש בתפקיד צופה — אין הרשאת יצירה' });
  }

  const filePath = path.join(UPLOADS_DIR, req.file.filename);
  try {
    const { method, data: extracted } = await runDocumentExtraction(filePath, 'invoice');

    const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
    const hostWithoutPort = host.split(':')[0];
    const protocol = req.headers['x-forwarded-proto'] || 'http';
    const file_url = `${protocol}://${hostWithoutPort}/uploads/${req.file.filename}`;

    const supplier = findOrCreateSupplier(user.current_farm_id, {
      name: extracted.supplier_name,
      vat_id: extracted.supplier_vat_id,
      phone: extracted.supplier_phone,
      address: extracted.supplier_address,
    });
    const invoice = saveInvoiceFromExtraction(
      user.current_farm_id, supplier.id, extracted,
      { file_url, filename: req.file.filename },
      'upload'
    );
    res.json({ success: true, method, invoice, supplier, extracted });
  } catch (err) {
    console.error('[invoices/scan] error:', String(err?.message || err));
    res.status(500).json({ success: false, error: String(err?.message || err) });
  }
});

// POST /api/invoices/:id/send — שליחת החשבונית כ-PDF למנהלת החשבונות (אוטומטי/ידני)
app.post('/api/invoices/:id/send', authMiddleware, aiLimiter, async (req, res) => {
  const user = getUser(req.user.id);
  if (!user?.current_farm_id) return res.status(400).json({ error: 'משתמש ללא חוות ברירת מחדל' });
  const farmId = user.current_farm_id;

  const member = getFarmMember(farmId, req.user.id);
  if (member && member.role === 'viewer') return res.status(403).json({ error: 'משתמש בתפקיד צופה — אין הרשאת שליחה' });

  // טען חשבונית ובדוק שייכות ל-farm
  const row = db.prepare("SELECT * FROM entities WHERE entity_type='invoices' AND id=?").get(req.params.id);
  if (!row || row.farm_id !== farmId) return res.status(404).json({ error: 'חשבונית לא נמצאה' });
  const inv = JSON.parse(row.data || '{}');

  // נמען: מהבקשה אם נשלח, אחרת ברירת המחדל של ה-farm
  const settings = getBookkeeperSettings(farmId);
  const to = (req.body?.to !== undefined ? String(req.body.to) : (settings.recipient_email || '')).trim();
  const cc = (req.body?.cc !== undefined ? String(req.body.cc) : (settings.cc_email || '')).trim();
  if (!to) return res.status(400).json({ error: 'לא הוגדרה כתובת מנהלת החשבונות. הגדר אותה בהגדרות.' });
  if (!BOOKKEEPER_EMAIL_RE.test(to)) return res.status(400).json({ error: 'כתובת יעד לא תקינה' });
  if (cc && !BOOKKEEPER_EMAIL_RE.test(cc)) return res.status(400).json({ error: 'כתובת CC לא תקינה' });

  // חיבור Gmail של המשתמש (השולח)
  const conn = getGmailConnectionForUser(farmId, req.user.id);
  if (!conn) return res.status(400).json({ error: 'אין חיבור Gmail. חבר את חשבון ה-Gmail בהגדרות.' });

  // אתר את קובץ החשבונית
  if (!inv.file_name && !inv.file_url) return res.status(400).json({ error: 'לחשבונית אין קובץ מצורף' });
  const filename = inv.file_name || path.basename(String(inv.file_url).split('?')[0]);
  const filePath = path.join(UPLOADS_DIR, filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'קובץ החשבונית לא נמצא בשרת' });

  try {
    const pdf = await invoiceFileToPdf(filePath);
    const subject = buildBookkeeperSubject(inv);
    const text = buildBookkeeperBody(inv, '');
    const attachmentName = buildInvoiceFilename(inv);
    const raw = buildRawEmail({
      to, cc: cc || null, subject, text,
      attachment: { filename: attachmentName, mime: 'application/pdf', buffer: pdf },
    });

    await sendGmailMessage(farmId, conn, raw);

    // שמירת עותק PDF על השרת (נגיש דרך /uploads עם טוקן)
    const pdfName = `${req.params.id}.pdf`;
    fs.writeFileSync(path.join(UPLOADS_DIR, pdfName), pdf);
    const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
    const hostNoPort = host.split(':')[0];
    const proto = req.headers['x-forwarded-proto'] || 'http';
    const pdfUrl = `${proto}://${hostNoPort}/uploads/${pdfName}`;

    // קרא מחדש את החשבונית טרי לפני הכתיבה — השליחה איטית (PDF+Gmail), וייתכן שהמשתמש
    // ערך שדות (שם ספק וכו') בזמן הזה. מיזוג על צילום ישן היה דורס את העריכה.
    const freshRow = db.prepare("SELECT data FROM entities WHERE entity_type='invoices' AND id=?").get(req.params.id);
    const freshInv = freshRow ? JSON.parse(freshRow.data || '{}') : inv;
    const updated = {
      ...freshInv, sent_to_bookkeeper_at: NOW(), sent_to: to, status: 'sent',
      pdf_file_name: pdfName, pdf_url: pdfUrl,
    };
    db.prepare("UPDATE entities SET data=?, updated_at=? WHERE entity_type='invoices' AND id=?")
      .run(JSON.stringify(updated), NOW(), req.params.id);

    res.json({ success: true, to, cc: cc || null, subject, pdf_url: pdfUrl, sent_to_bookkeeper_at: updated.sent_to_bookkeeper_at });
  } catch (err) {
    const b = String(err?.body || err?.message || err);
    if (err?.status === 403 || /insufficient|scope|ACCESS_TOKEN_SCOPE/i.test(b)) {
      return res.status(403).json({ error: 'חיבור ה-Gmail ללא הרשאת שליחה. חבר מחדש את Gmail בהגדרות.' });
    }
    // Refresh token expired/revoked — e.g. Google "Testing" apps expire refresh tokens after 7 days.
    if (/expired or revoked|invalid_grant|Refresh failed/i.test(b)) {
      // מסמנים גם את החיבור עצמו — כדי שהפולר יפסיק לנסות והמשתמש יראה התראה בהגדרות
      recordGmailSyncFailure(farmId, conn, err);
      return res.status(401).json({ needs_reauth: true, error: 'חיבור ה-Gmail פג תוקף. חבר מחדש את Gmail בהגדרות כדי להמשיך לשלוח.' });
    }
    console.error('[invoices/send] error:', b.slice(0, 300));
    res.status(500).json({ error: `שליחת המייל נכשלה: ${String(err?.message || err).slice(0, 200)}` });
  }
});

// ─── GMAIL INTEGRATION ────────────────────────────────────────────────────────
// readonly = inbound sync (קריאת חשבוניות מהמייל); send = שליחה יוצאת למנהלת החשבונות.
// שינוי ה-scope מחייב משתמשים שכבר חיברו Gmail "לחבר מחדש" פעם אחת כדי לקבל הרשאת שליחה.
const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send';
const INVOICE_SUBJECT_REGEX = /חשבונית|חשבון|invoice|fakturah?|receipt|קבלה|זיכוי/i;
const ALLOWED_SYNC_INTERVALS = [5, 10, 15, 30, 60, 120, 240, 360, 720, 1440]; // minutes
const DEFAULT_SYNC_INTERVAL_MIN = 15;

// One Gmail connection per (farm, user). user_id is stored in the entity data.
function getGmailConnectionForUser(farmId, userId) {
  const rows = db.prepare("SELECT id, data FROM entities WHERE entity_type='gmail_connections' AND farm_id=?").all(farmId);
  for (const r of rows) {
    const d = JSON.parse(r.data || '{}');
    if (d.user_id === userId) return { id: r.id, ...d };
  }
  return null;
}

function setGmailConnectionForUser(farmId, userId, data) {
  const existing = getGmailConnectionForUser(farmId, userId);
  const payload = { ...data, user_id: userId };
  if (existing) {
    db.prepare("UPDATE entities SET data=?, updated_at=? WHERE entity_type='gmail_connections' AND id=?")
      .run(JSON.stringify(payload), NOW(), existing.id);
    return { id: existing.id, ...payload };
  }
  const id = uuidv4();
  db.prepare("INSERT INTO entities (id, entity_type, farm_id, data, created_at, updated_at) VALUES (?, 'gmail_connections', ?, ?, ?, ?)")
    .run(id, farmId, JSON.stringify(payload), NOW(), NOW());
  return { id, ...payload };
}

function normalizeSyncInterval(n) {
  const v = parseInt(n, 10);
  if (!ALLOWED_SYNC_INTERVALS.includes(v)) return DEFAULT_SYNC_INTERVAL_MIN;
  return v;
}

// שגיאות OAuth שניסיון חוזר לא יפתור — הטוקן מת וצריך חיבור מחדש של המשתמש.
// invalid_grant הוא המקרה השכיח: מסך הסכמה ב-Google Cloud במצב "Testing" מנפיק
// refresh token שפג אחרי 7 ימים (Google מחזירה אותו עם error_description="Bad Request").
const FATAL_OAUTH_ERRORS = ['invalid_grant', 'invalid_client', 'unauthorized_client'];
const GMAIL_MAX_BACKOFF_MIN = 240;

function isFatalOAuthError(err) {
  if (FATAL_OAUTH_ERRORS.includes(err?.oauthError)) return true;
  // גם גוף התשובה של Gmail API — 401 מגיע כ-"Token has been expired or revoked"
  const text = `${err?.message || ''} ${err?.body || ''}`;
  return /invalid_grant|invalid_client|unauthorized_client|expired or revoked/i.test(text);
}

// כישלון סנכרון: שגיאת OAuth סופית מסמנת needs_reauth (הפולר מפסיק לנסות והמשתמש רואה
// התראה ב-UI); שגיאה חולפת (רשת/429) מקבלת backoff מעריכי, כדי שחיבור שבור לא יכה
// ב-Google כל דקה עד אינסוף.
function recordGmailSyncFailure(farmId, conn, err) {
  const fresh = getGmailConnectionForUser(farmId, conn.user_id);
  if (!fresh) return false;
  const fatal = isFatalOAuthError(err);
  const failCount = (fresh.fail_count || 0) + 1;
  const backoffMin = Math.min(GMAIL_MAX_BACKOFF_MIN, 5 * Math.pow(2, Math.min(failCount - 1, 6)));
  const updated = {
    ...fresh,
    fail_count: failCount,
    last_error: String(err?.message || err).slice(0, 300),
    last_error_at: NOW(),
    needs_reauth: fatal,
    next_retry_at: fatal ? null : Date.now() + backoffMin * 60 * 1000,
  };
  delete updated.id;
  setGmailConnectionForUser(farmId, conn.user_id, updated);
  return fatal;
}

// ─── למידה מ"לא חשבונית" ──────────────────────────────────────────────────────
// כשמשתמש מסמן שקובץ אינו חשבונית, נשמר כלל: שולח + תבנית שם הקובץ. רצפי ספרות
// מנורמלים ל-# כדי שכלל אחד יכסה גם את הקבצים הבאים באותה סדרה
// (01-08-2026_6928738.pdf ו-02-09-2026_7014522.pdf → #-#-#_#.pdf).
function normalizeFilenamePattern(filename) {
  return String(filename || '').toLowerCase().trim().replace(/\d+/g, '#');
}

function getGmailIgnoreRules(farmId) {
  return db.prepare("SELECT id, data FROM entities WHERE entity_type='gmail_ignore_rules' AND farm_id=?").all(farmId)
    .map(r => { try { return { id: r.id, ...JSON.parse(r.data || '{}') }; } catch { return null; } })
    .filter(Boolean);
}

function matchesIgnoreRule(rules, fromEmail, filename) {
  const pattern = normalizeFilenamePattern(filename);
  const from = String(fromEmail || '').toLowerCase();
  return rules.some(r => r.filename_pattern === pattern && (!r.from_email || r.from_email === from));
}

function addGmailIgnoreRule(farmId, { from_email, filename, subject, created_by }) {
  const filename_pattern = normalizeFilenamePattern(filename);
  if (!filename_pattern) return null;
  const from = String(from_email || '').toLowerCase() || null;
  const existing = getGmailIgnoreRules(farmId)
    .find(r => r.filename_pattern === filename_pattern && (r.from_email || null) === from);
  if (existing) return existing;
  const id = uuidv4();
  const data = { from_email: from, filename_pattern, sample_filename: filename, sample_subject: subject || null, created_by: created_by || null };
  db.prepare("INSERT INTO entities (id, entity_type, farm_id, data, created_at, updated_at) VALUES (?, 'gmail_ignore_rules', ?, ?, ?, ?)")
    .run(id, farmId, JSON.stringify(data), NOW(), NOW());
  return { id, ...data };
}

// message_id של חשבוניות שנמחקו ידנית — כדי שסנכרון עם חלון אחורה קבוע לא יחזיר אותן.
function getDismissedGmailMessageIds(farmId) {
  const rows = db.prepare("SELECT data FROM entities WHERE entity_type='gmail_dismissed' AND farm_id=?").all(farmId);
  return rows.map(r => { try { return JSON.parse(r.data || '{}').message_id; } catch { return null; } }).filter(Boolean);
}

function dismissGmailMessageId(farmId, messageId) {
  if (!farmId || !messageId) return;
  const exists = getDismissedGmailMessageIds(farmId).includes(messageId);
  if (exists) return;
  db.prepare("INSERT INTO entities (id, entity_type, farm_id, data, created_at, updated_at) VALUES (?, 'gmail_dismissed', ?, ?, ?, ?)")
    .run(uuidv4(), farmId, JSON.stringify({ message_id: messageId }), NOW(), NOW());
}

// GET /api/gmail/status — current user's Gmail connection in their farm
app.get('/api/gmail/status', authMiddleware, (req, res) => {
  const user = getUser(req.user.id);
  if (!user?.current_farm_id) return res.json({ connected: false });
  const conn = getGmailConnectionForUser(user.current_farm_id, req.user.id);
  if (!conn) return res.json({ connected: false, oauth_configured: !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) });
  res.json({
    connected: true,
    oauth_configured: !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET),
    email: conn.email,
    last_sync_at: conn.last_sync_at || null,
    label: conn.label || null,
    auto_sync: conn.auto_sync !== false,
    subject_filter: conn.subject_filter || null,
    sync_interval_min: conn.sync_interval_min || DEFAULT_SYNC_INTERVAL_MIN,
    allowed_intervals: ALLOWED_SYNC_INTERVALS,
    needs_reauth: !!conn.needs_reauth,
    last_error: conn.last_error || null,
    last_error_at: conn.last_error_at || null,
    syncing: isGmailSyncRunning(user.current_farm_id, req.user.id),
    progress: getGmailSyncProgress(user.current_farm_id, req.user.id),
    last_sync_result: conn.last_sync_result || null,
  });
});

// GET /api/gmail/connect — start OAuth (token in query because callback can't be authenticated)
app.get('/api/gmail/connect', authMiddleware, (req, res) => {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) return res.status(400).json({ error: 'Google OAuth לא הוגדר בשרת' });
  const user = getUser(req.user.id);
  if (!user?.current_farm_id) return res.status(400).json({ error: 'משתמש ללא חוות ברירת מחדל' });
  // Signed state — survives the redirect to Google and back
  const state = jwt.sign({ user_id: user.id, farm_id: user.current_farm_id, kind: 'gmail' }, JWT_SECRET, { expiresIn: '15m' });
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: `${APP_BASE_URL}/api/gmail/callback`,
    response_type: 'code',
    scope: `openid email ${GMAIL_SCOPE}`,
    access_type: 'offline',
    prompt: 'consent', // force consent screen so we always get a refresh_token
    state,
  });
  res.json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` });
});

// GET /api/gmail/callback — Google redirects here with code+state
app.get('/api/gmail/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error || !code || !state) return res.redirect(`${APP_BASE_URL}/Settings?tab=gmail&error=cancelled`);
  let payload;
  try { payload = jwt.verify(state, JWT_SECRET); }
  catch { return res.redirect(`${APP_BASE_URL}/Settings?tab=gmail&error=state_expired`); }
  if (payload.kind !== 'gmail') return res.redirect(`${APP_BASE_URL}/Settings?tab=gmail&error=bad_state`);
  try {
    const tokenBody = new URLSearchParams({
      code, client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: `${APP_BASE_URL}/api/gmail/callback`,
      grant_type: 'authorization_code',
    }).toString();
    const tokenResult = await httpsRequest({
      hostname: 'oauth2.googleapis.com',
      path: '/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(tokenBody),
      },
    }, tokenBody);
    const tokens = JSON.parse(tokenResult.body);
    if (!tokens.access_token || !tokens.refresh_token) {
      console.error('[gmail/callback] missing tokens:', tokens);
      return res.redirect(`${APP_BASE_URL}/Settings?tab=gmail&error=no_refresh_token`);
    }
    // Get user email
    const infoResult = await httpsRequest({
      hostname: 'www.googleapis.com',
      path: '/oauth2/v2/userinfo',
      method: 'GET',
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const gu = JSON.parse(infoResult.body);

    // Preserve existing preferences (interval, label) if the user is re-authorizing
    const existing = getGmailConnectionForUser(payload.farm_id, payload.user_id) || {};
    setGmailConnectionForUser(payload.farm_id, payload.user_id, {
      email: gu.email,
      refresh_token_enc: encryptSecret(tokens.refresh_token),
      access_token_enc: encryptSecret(tokens.access_token),
      access_token_expires_at: Date.now() + (tokens.expires_in || 3600) * 1000,
      connected_at: existing.connected_at || NOW(),
      last_sync_at: existing.last_sync_at || null,
      label: existing.label !== undefined ? existing.label : '', // ברירת מחדל: ללא סינון תווית — זיהוי לפי נושא (חשבונית/invoice/קבלה...)
      auto_sync: existing.auto_sync !== false,
      subject_filter: existing.subject_filter || null,
      sync_interval_min: normalizeSyncInterval(existing.sync_interval_min),
      // חיבור מחדש מנקה מצב כשל — טוקן חדש, מתחילים מאפס
      needs_reauth: false,
      last_error: null,
      last_error_at: null,
      fail_count: 0,
      next_retry_at: null,
    });
    res.redirect(`${APP_BASE_URL}/Settings?tab=gmail&connected=1`);
  } catch (err) {
    console.error('[gmail/callback] error:', String(err?.message || err));
    res.redirect(`${APP_BASE_URL}/Settings?tab=gmail&error=oauth_failed`);
  }
});

// PUT /api/gmail/settings — update label, auto_sync, subject_filter, sync_interval_min
app.put('/api/gmail/settings', authMiddleware, (req, res) => {
  const user = getUser(req.user.id);
  if (!user?.current_farm_id) return res.status(400).json({ error: 'משתמש ללא חוות ברירת מחדל' });
  const conn = getGmailConnectionForUser(user.current_farm_id, req.user.id);
  if (!conn) return res.status(404).json({ error: 'אין חיבור Gmail' });
  const { label, auto_sync, subject_filter, sync_interval_min } = req.body || {};
  const updated = { ...conn };
  delete updated.id;
  if (label !== undefined) updated.label = label || null;
  if (auto_sync !== undefined) updated.auto_sync = !!auto_sync;
  if (subject_filter !== undefined) updated.subject_filter = subject_filter || null;
  if (sync_interval_min !== undefined) updated.sync_interval_min = normalizeSyncInterval(sync_interval_min);
  setGmailConnectionForUser(user.current_farm_id, req.user.id, updated);
  res.json({ success: true, sync_interval_min: updated.sync_interval_min });
});

// DELETE /api/gmail/disconnect — only disconnects the calling user
app.delete('/api/gmail/disconnect', authMiddleware, (req, res) => {
  const user = getUser(req.user.id);
  if (!user?.current_farm_id) return res.status(400).json({ error: 'משתמש ללא חוות ברירת מחדל' });
  const conn = getGmailConnectionForUser(user.current_farm_id, req.user.id);
  if (!conn) return res.json({ success: true });
  db.prepare("DELETE FROM entities WHERE entity_type='gmail_connections' AND id=?").run(conn.id);
  res.json({ success: true });
});

// POST /api/gmail/sync — manual sync of the calling user's connection
app.post('/api/gmail/sync', authMiddleware, async (req, res) => {
  const user = getUser(req.user.id);
  if (!user?.current_farm_id) return res.status(400).json({ error: 'משתמש ללא חוות ברירת מחדל' });
  const conn = getGmailConnectionForUser(user.current_farm_id, req.user.id);
  if (!conn) return res.status(404).json({ error: 'אין חיבור Gmail' });
  if (conn.needs_reauth) {
    return res.status(401).json({
      success: false,
      needs_reauth: true,
      error: 'חיבור ה-Gmail פג תוקף. נתק וחבר מחדש את Gmail בהגדרות.',
    });
  }
  const farmId = user.current_farm_id;
  if (isGmailSyncRunning(farmId, req.user.id)) {
    return res.status(409).json({ success: false, running: true, error: 'סנכרון כבר רץ — המתן לסיומו' });
  }

  // סנכרון ידני סורק חלון אחורה קבוע (ברירת מחדל 30 יום) ולא מ-last_sync_at — אחרת כל
  // סנכרון ידני מצטמצם ל"מעכשיו" (הפולר מעדכן last_sync_at ברקע) ותמיד מחזיר 0.
  // חשבוניות שכבר יובאו מסוננות לפי message_id, ומחיקה ידנית רושמת tombstone.
  const days = Math.min(365, Math.max(1, parseInt(req.body?.days, 10) || 30));

  // רץ ברקע ולא מחזיק את בקשת ה-HTTP: סריקה של 30 יום אורכת דקות (כל PDF עובר חילוץ AI),
  // ו-Cloudflare חותך את החיבור אחרי ~100 שניות — מה שגרם ל"סנכרון נכשל" בממשק בזמן
  // שהשרת דווקא המשיך לעבוד. הממשק מתשאל את /api/gmail/status עד לסיום.
  syncGmailConnection(farmId, conn, { sinceMs: Date.now() - days * 24 * 60 * 60 * 1000 })
    .then(result => {
      console.log(`[gmail/sync] manual done scanned=${result.scanned} saved=${result.saved} skipped=${result.skipped}`);
    })
    .catch(err => {
      if (err?.alreadyRunning) return;
      console.error('[gmail/sync] error:', String(err?.message || err));
      recordGmailSyncFailure(farmId, conn, err);
    });

  res.status(202).json({ success: true, started: true, days });
});

// POST /api/invoices/:id/not-invoice — הקובץ אינו חשבונית: מוחק, רושם tombstone ולומד כלל
app.post('/api/invoices/:id/not-invoice', authMiddleware, (req, res) => {
  const user = getUser(req.user.id);
  if (!user?.current_farm_id) return res.status(400).json({ error: 'משתמש ללא חוות ברירת מחדל' });
  const farmId = user.current_farm_id;

  const row = db.prepare("SELECT * FROM entities WHERE entity_type='invoices' AND id=?").get(req.params.id);
  if (!row) return res.status(404).json({ error: 'החשבונית לא נמצאה' });
  if (row.farm_id !== farmId) return res.status(403).json({ error: 'Forbidden' });
  const member = getFarmMember(farmId, req.user.id);
  if (member && ['viewer', 'worker'].includes(member.role)) return res.status(403).json({ error: 'אין הרשאה' });

  let inv = {};
  try { inv = JSON.parse(row.data || '{}'); } catch { /* פגום — עדיין מוחקים */ }
  const meta = inv.source_meta || {};

  let rule = null;
  if (meta.attachment_name) {
    rule = addGmailIgnoreRule(farmId, {
      from_email: meta.from,
      filename: meta.attachment_name,
      subject: meta.subject,
      created_by: req.user.id,
    });
  }
  if (meta.message_id) dismissGmailMessageId(farmId, meta.message_id);
  db.prepare("DELETE FROM entities WHERE entity_type='invoices' AND id=?").run(req.params.id);

  res.json({ success: true, rule });
});

// GET /api/gmail/ignore-rules — הכללים שנלמדו מ"לא חשבונית"
app.get('/api/gmail/ignore-rules', authMiddleware, (req, res) => {
  const user = getUser(req.user.id);
  if (!user?.current_farm_id) return res.json({ rules: [] });
  res.json({ rules: getGmailIgnoreRules(user.current_farm_id) });
});

// DELETE /api/gmail/ignore-rules/:id — ביטול כלל שנלמד בטעות
app.delete('/api/gmail/ignore-rules/:id', authMiddleware, (req, res) => {
  const user = getUser(req.user.id);
  if (!user?.current_farm_id) return res.status(400).json({ error: 'משתמש ללא חוות ברירת מחדל' });
  const row = db.prepare("SELECT farm_id FROM entities WHERE entity_type='gmail_ignore_rules' AND id=?").get(req.params.id);
  if (!row) return res.json({ success: true });
  if (row.farm_id !== user.current_farm_id) return res.status(403).json({ error: 'Forbidden' });
  db.prepare("DELETE FROM entities WHERE entity_type='gmail_ignore_rules' AND id=?").run(req.params.id);
  res.json({ success: true });
});

// ─── GMAIL CLIENT HELPERS ─────────────────────────────────────────────────────
async function refreshGmailAccessToken(farmId, conn) {
  const refresh_token = decryptSecret(conn.refresh_token_enc);
  if (!refresh_token) throw new Error('Gmail refresh_token unavailable');
  const body = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    client_secret: GOOGLE_CLIENT_SECRET,
    refresh_token,
    grant_type: 'refresh_token',
  }).toString();
  const result = await httpsRequest({
    hostname: 'oauth2.googleapis.com',
    path: '/token',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(body),
    },
  }, body);
  const tokens = JSON.parse(result.body);
  if (!tokens.access_token) {
    // חשוב לכלול את tokens.error עצמו: Google מחזירה invalid_grant עם
    // error_description="Bad Request" בלבד, וההודעה יוצאת חסרת משמעות בלעדיו.
    const detail = [tokens.error, tokens.error_description].filter(Boolean).join(' — ') || 'unknown';
    const err = new Error('Refresh failed: ' + detail);
    err.oauthError = tokens.error || null;
    throw err;
  }
  const updated = {
    ...conn,
    access_token_enc: encryptSecret(tokens.access_token),
    access_token_expires_at: Date.now() + (tokens.expires_in || 3600) * 1000,
  };
  delete updated.id;
  setGmailConnectionForUser(farmId, conn.user_id, updated);
  return tokens.access_token;
}

async function ensureGmailAccessToken(farmId, conn) {
  const now = Date.now();
  if (conn.access_token_enc && conn.access_token_expires_at && conn.access_token_expires_at > now + 60_000) {
    const t = decryptSecret(conn.access_token_enc);
    if (t) return t;
  }
  return refreshGmailAccessToken(farmId, conn);
}

async function gmailApiGet(accessToken, pathAndQuery) {
  const result = await httpsRequest({
    hostname: 'gmail.googleapis.com',
    path: pathAndQuery,
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (result.status !== 200) {
    throw new Error(`Gmail API ${result.status}: ${result.body.slice(0, 200)}`);
  }
  return JSON.parse(result.body);
}

// Decode base64url payload returned by Gmail API
function b64urlToBuffer(s) {
  return Buffer.from(String(s || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

// ─── OUTBOUND: שליחת חשבונית כ-PDF למנהלת החשבונות ─────────────────────────────

// POST ל-Gmail API (מקביל ל-gmailApiGet). זורק שגיאה עם .status על תשובה שאינה 200.
async function gmailApiPost(accessToken, pathAndQuery, jsonBody) {
  const body = JSON.stringify(jsonBody);
  const result = await httpsRequest({
    hostname: 'gmail.googleapis.com',
    path: pathAndQuery,
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    },
  }, body);
  if (result.status !== 200) {
    const err = new Error(`Gmail API ${result.status}: ${result.body.slice(0, 300)}`);
    err.status = result.status;
    err.body = result.body;
    throw err;
  }
  return JSON.parse(result.body);
}

// קידוד base64 עם שבירת שורות ל-76 תווים (תקן MIME)
function b64Lines(buf) {
  return Buffer.from(buf).toString('base64').replace(/(.{76})/g, '$1\r\n');
}

// קידוד כותרת לא-ASCII (נושא) כ-RFC 2047, בחלקים בטוחים מבחינת UTF-8
function encodeHeaderWord(str) {
  const s = String(str || '');
  if (/^[\x00-\x7F]*$/.test(s)) return s; // ASCII בלבד — אין צורך בקידוד
  const chars = Array.from(s);
  const chunks = [];
  let cur = '';
  for (const ch of chars) {
    if (Buffer.byteLength(cur + ch) > 39) { chunks.push(cur); cur = ch; }
    else cur += ch;
  }
  if (cur) chunks.push(cur);
  return chunks
    .map(c => `=?UTF-8?B?${Buffer.from(c, 'utf8').toString('base64')}?=`)
    .join('\r\n ');
}

// בניית הודעת MIME (multipart/mixed) עם קובץ מצורף, מקודדת base64url ל-Gmail API
function buildRawEmail({ to, cc, subject, text, attachment }) {
  const boundary = 'ff_' + uuidv4().replace(/-/g, '');
  const enc = encodeURIComponent(attachment.filename);
  const headers = [
    `To: ${to}`,
    cc ? `Cc: ${cc}` : null,
    `Subject: ${encodeHeaderWord(subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
  ].filter(Boolean);

  const body = [
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    b64Lines(Buffer.from(text, 'utf8')),
    `--${boundary}`,
    `Content-Type: ${attachment.mime}; name="invoice.pdf"`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: attachment; filename*=UTF-8''${enc}`,
    '',
    b64Lines(attachment.buffer),
    `--${boundary}--`,
    '',
  ];

  const mime = headers.join('\r\n') + '\r\n\r\n' + body.join('\r\n');
  return Buffer.from(mime, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// שליחה בפועל דרך חיבור ה-Gmail של המשתמש
async function sendGmailMessage(farmId, conn, rawEmail) {
  const token = await ensureGmailAccessToken(farmId, conn);
  return gmailApiPost(token, '/gmail/v1/users/me/messages/send', { raw: rawEmail });
}

// בניית הודעת text/plain פשוטה (ללא קובץ מצורף) — לשימוש במייל הזמנה
function buildPlainRawEmail({ to, subject, text }) {
  const headers = [
    `To: ${to}`,
    `Subject: ${encodeHeaderWord(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
  ];
  const mime = headers.join('\r\n') + '\r\n\r\n' + b64Lines(Buffer.from(text, 'utf8'));
  return Buffer.from(mime, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// המרת קובץ החשבונית ל-PDF. PDF מקורי מצורף כמו שהוא; תמונה מומרת (jimp→pdf-lib).
async function invoiceFileToPdf(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.pdf') return fs.readFileSync(filePath);

  const { PDFDocument } = require('pdf-lib');
  const Jimp = require('jimp');
  const img = await Jimp.read(filePath); // jimp מתקן אוריינטציית EXIF בקריאה
  if (Math.max(img.bitmap.width, img.bitmap.height) > 2200) img.scaleToFit(2200, 2200);
  img.quality(82);
  const jpg = await img.getBufferAsync(Jimp.MIME_JPEG);

  const pdf = await PDFDocument.create();
  const image = await pdf.embedJpg(jpg);
  const page = pdf.addPage([image.width, image.height]);
  page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
  return Buffer.from(await pdf.save());
}

function fmtInvoiceMoney(v) {
  if (v === null || v === undefined || v === '') return '';
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return n.toLocaleString('he-IL', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

// נושא קל לזיהוי:  חשבונית • <ספק> • מס׳ <מספר> • <סכום>₪ • <תאריך>
function buildBookkeeperSubject(inv) {
  const parts = ['חשבונית'];
  if (inv.supplier_name) parts.push(String(inv.supplier_name).trim());
  if (inv.invoice_number) parts.push(`מס׳ ${inv.invoice_number}`);
  const total = fmtInvoiceMoney(inv.total);
  if (total) parts.push(`${total}₪`);
  if (inv.date) parts.push(inv.date);
  return parts.join(' • ');
}

// גוף מייל מובנה בעברית עם הפרטים שחולצו
function buildBookkeeperBody(inv, businessName) {
  const rows = [
    ['ספק', inv.supplier_name],
    ['ח.פ / עוסק', inv.supplier_vat_id],
    ['מספר חשבונית', inv.invoice_number],
    ['תאריך', inv.date],
    ['סכום כולל', fmtInvoiceMoney(inv.total) && `${fmtInvoiceMoney(inv.total)} ${inv.currency || 'ILS'}`],
    ['מתוכו מע"מ', fmtInvoiceMoney(inv.vat_amount) && `${fmtInvoiceMoney(inv.vat_amount)} ${inv.currency || 'ILS'}`],
  ];
  const lines = ['שלום,', '', 'מצורפת חשבונית לטיפול. להלן הפרטים:', ''];
  for (const [label, val] of rows) {
    if (val) lines.push(`• ${label}: ${String(val).trim()}`);
  }
  lines.push('', businessName ? `בברכה,\n${businessName}` : 'בברכה,');
  lines.push('', '— נשלח ממערכת farm-flow —');
  return lines.join('\n');
}

// שם קובץ PDF קריא ובטוח
function buildInvoiceFilename(inv) {
  const supplier = (inv.supplier_name || 'חשבונית').trim();
  const date = String(inv.date || '').replace(/[./]/g, '-');
  const parts = ['חשבונית', supplier];
  if (inv.invoice_number) parts.push(String(inv.invoice_number));
  if (date) parts.push(date);
  const name = parts.join('_').replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, '_').replace(/^_+|_+$/g, '');
  return `${name}.pdf`;
}

// Walk message parts and collect attachments matching invoice MIME types
function collectInvoiceAttachments(payload) {
  const out = [];
  const visit = (part) => {
    if (!part) return;
    const mime = (part.mimeType || '').toLowerCase();
    const filename = part.filename || '';
    const isAttachment = filename && part.body && part.body.attachmentId;
    const isInvoiceLike = /pdf|jpeg|jpg|png|webp/i.test(mime) || /\.(pdf|jpe?g|png|webp)$/i.test(filename);
    // תמונות זעירות הן כמעט תמיד לוגו בחתימת המייל (image001.png וחבריו) ולא חשבונית —
    // בלי הסינון הן נשמרות כחשבוניות "ממתינות" ריקות ומזהמות את הרשימה.
    const isSignatureImage = !/pdf/i.test(mime) && (part.body.size || 0) < 30 * 1024;
    if (isAttachment && isInvoiceLike && !isSignatureImage) {
      out.push({ filename, mimeType: mime, attachmentId: part.body.attachmentId, size: part.body.size || 0 });
    }
    if (Array.isArray(part.parts)) part.parts.forEach(visit);
  };
  visit(payload);
  return out;
}

function getHeader(headers, name) {
  if (!Array.isArray(headers)) return null;
  const h = headers.find(x => x.name?.toLowerCase() === name.toLowerCase());
  return h?.value || null;
}

function parseEmailAddress(raw) {
  if (!raw) return { name: null, email: null };
  const m = raw.match(/^(.*?)<([^>]+)>\s*$/);
  if (m) return { name: m[1].replace(/"/g, '').trim() || null, email: m[2].trim().toLowerCase() };
  return { name: null, email: raw.trim().toLowerCase() };
}

// נעילה לכל חיבור. בלעדיה פולר + לחיצות "סנכרן עכשיו" רצים במקביל, וכל ריצה מחזיקה
// snapshot משלה של seenInvoiceKeys — כך שכולן מייבאות שוב את אותן חשבוניות (ראינו 48
// קבצים ייחודיים שהפכו ל-110 רשומות).
const gmailSyncLocks = new Set();
// התקדמות חיה של סריקה שרצה, לתצוגה בממשק (בזיכרון בלבד — נמחקת בסיום ובאתחול השרת)
const gmailSyncProgress = new Map();
const gmailLockKey = (farmId, userId) => `${farmId}:${userId}`;

function isGmailSyncRunning(farmId, userId) {
  return gmailSyncLocks.has(gmailLockKey(farmId, userId));
}

function getGmailSyncProgress(farmId, userId) {
  return gmailSyncProgress.get(gmailLockKey(farmId, userId)) || null;
}

async function syncGmailConnection(farmId, conn, opts = {}) {
  if (!conn) throw new Error('No Gmail connection');
  const lockKey = gmailLockKey(farmId, conn.user_id);
  if (gmailSyncLocks.has(lockKey)) {
    const err = new Error('סנכרון Gmail כבר רץ עבור חיבור זה');
    err.alreadyRunning = true;
    throw err;
  }
  gmailSyncLocks.add(lockKey);
  gmailSyncProgress.set(lockKey, { scanned: 0, saved: 0, skipped: 0, total: 0, phase: 'starting', started_at: Date.now() });
  try {
    return await runGmailSync(farmId, conn, opts);
  } finally {
    gmailSyncLocks.delete(lockKey);
    gmailSyncProgress.delete(lockKey);
  }
}

// ─── ניתוב מסמכי עובדים ───────────────────────────────────────────────────────
// מסמך שהגיע במייל ואינו חשבונית מכיל לרוב את מספר הדרכון של העובד, ולכן אפשר לשייך
// אותו אוטומטית ל-general_documents שלו במקום ליצור חשבונית מיותרת.
const normPassport = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

async function tryFileAsEmployeeDocument(farmId, localPath, ctx) {
  let data;
  try {
    ctx.reportProgress?.(`extracting:${ctx.attachment_name}`);
    const r = await runDocumentExtraction(localPath, 'employee_document');
    data = r.data || {};
  } catch (err) {
    console.log(`[gmail-sync] employee-doc check failed for ${ctx.attachment_name}: ${String(err?.message || err).slice(0, 80)}`);
    return null;
  }
  if (data.is_employee_document === false) return null;

  // דורשים 6 תווים לפחות — מספר קצר מדי מזמין התאמות שגויות
  const found = (Array.isArray(data.passport_numbers) ? data.passport_numbers : [])
    .map(normPassport).filter(p => p.length >= 6);
  if (!found.length) return null;

  const employees = db.prepare("SELECT id, data FROM entities WHERE entity_type='employees' AND farm_id=?").all(farmId)
    .map(r => { try { return { id: r.id, ...JSON.parse(r.data || '{}') }; } catch { return null; } })
    .filter(Boolean);

  const match = employees.find(e => e.passport_number && found.includes(normPassport(e.passport_number)));
  if (!match) return null;

  const docName = [data.document_kind || 'מסמך מהמייל', ctx.attachment_name].filter(Boolean).join(' — ');
  const general_documents = [
    ...(Array.isArray(match.general_documents) ? match.general_documents : []),
    {
      document_name: docName,
      document_url: ctx.file_url,
      upload_date: NOW(),
      source: 'gmail',
      source_meta: { message_id: ctx.message_id, subject: ctx.subject, from: ctx.from, attachment_name: ctx.attachment_name },
    },
  ];
  const updated = { ...match, general_documents };
  delete updated.id;
  db.prepare("UPDATE entities SET data=?, updated_at=? WHERE entity_type='employees' AND id=?")
    .run(JSON.stringify(updated), NOW(), match.id);

  return {
    employee_id: match.id,
    employee_name: match.full_name || `${match.first_name || ''} ${match.last_name || ''}`.trim(),
    passport_number: match.passport_number,
    document_kind: data.document_kind || null,
  };
}

async function runGmailSync(farmId, conn, opts = {}) {
  const accessToken = await ensureGmailAccessToken(farmId, conn);

  // Build search query: messages with attachments since last sync (or 30 days back on first run).
  // opts.sinceMs overrides — manual sync uses a fixed lookback so it can catch already-arrived emails
  // that predate last_sync_at (otherwise repeated manual syncs keep narrowing the window to "now").
  const sinceMs = opts.sinceMs != null
    ? opts.sinceMs
    : (conn.last_sync_at ? new Date(conn.last_sync_at).getTime() : Date.now() - 30 * 24 * 60 * 60 * 1000);
  const sinceSec = Math.floor(sinceMs / 1000);
  const labelPart = conn.label ? `label:"${conn.label}"` : '';
  const q = `has:attachment after:${sinceSec} ${labelPart}`.trim();

  const subjectRegex = conn.subject_filter ? new RegExp(conn.subject_filter, 'i') : INVOICE_SUBJECT_REGEX;

  let pageToken = null;
  let scanned = 0, saved = 0, skipped = 0, total = 0, filedToEmployees = 0;

  // דיווח התקדמות לממשק. total הוא resultSizeEstimate של Gmail — הערכה בלבד, ולכן
  // הממשק מציג "~" ומגביל את האחוז ל-100.
  const progressKey = gmailLockKey(farmId, conn.user_id);
  const reportProgress = (phase) => {
    if (!gmailSyncProgress.has(progressKey)) return;
    gmailSyncProgress.set(progressKey, {
      ...gmailSyncProgress.get(progressKey),
      scanned, saved, skipped, total, filedToEmployees, phase,
    });
  };

  // דילוג על מיילים שכבר יובאו — וגם על כאלה שהחשבונית שלהם נמחקה ידנית, אחרת חלון
  // אחורה קבוע היה מחזיר אותן בכל סנכרון.
  const invoiceMetas = db.prepare("SELECT data FROM entities WHERE entity_type='invoices' AND farm_id=?").all(farmId)
    .map(r => { try { return JSON.parse(r.data || '{}'); } catch { return null; } })
    .filter(Boolean);
  const seenInvoiceKeys = new Set([
    ...invoiceMetas.map(d => d.source_meta?.message_id).filter(Boolean),
    ...getDismissedGmailMessageIds(farmId),
  ]);
  // אותו קובץ בייט-בייט שהגיע שוב (העברה/תזכורת ממייל אחר) — message_id שונה, ו-findExistingInvoice
  // מנוטרל כשהחילוץ לא החזיר סכום. sha256 של תוכן הקובץ תופס את זה בלי תלות בחילוץ.
  const seenFileHashes = new Set(invoiceMetas.map(d => d.source_meta?.file_sha256).filter(Boolean));
  const ignoreRules = getGmailIgnoreRules(farmId);

  do {
    const listPath = `/gmail/v1/users/me/messages?q=${encodeURIComponent(q)}&maxResults=25${pageToken ? `&pageToken=${pageToken}` : ''}`;
    const list = await gmailApiGet(accessToken, listPath);
    const messages = list.messages || [];
    pageToken = list.nextPageToken || null;
    if (list.resultSizeEstimate) total = Math.max(total, list.resultSizeEstimate);
    reportProgress('scanning');

    for (const msg of messages) {
      scanned++;
      if (seenInvoiceKeys.has(msg.id)) { skipped++; reportProgress('scanning'); continue; }
      const full = await gmailApiGet(accessToken, `/gmail/v1/users/me/messages/${msg.id}?format=full`);
      const headers = full.payload?.headers || [];
      const subject = getHeader(headers, 'Subject') || '';
      const from = parseEmailAddress(getHeader(headers, 'From'));
      const dateHeader = getHeader(headers, 'Date');
      const attachments = collectInvoiceAttachments(full.payload);

      // Apply subject filter (or accept when a configured label is matching the messages)
      const subjectOk = conn.label ? true : subjectRegex.test(subject);
      if (!subjectOk || attachments.length === 0) { skipped++; reportProgress('scanning'); continue; }

      // קבצים שהמשתמש כבר סימן כ"לא חשבונית" — מדלגים לפני החילוץ, כדי לא לבזבז קריאת AI
      const keptAttachments = attachments.filter(att => !matchesIgnoreRule(ignoreRules, from.email, att.filename));
      if (keptAttachments.length === 0) { skipped++; reportProgress('scanning'); seenInvoiceKeys.add(msg.id); continue; }

      for (const att of keptAttachments) {
        try {
          const attRes = await gmailApiGet(accessToken, `/gmail/v1/users/me/messages/${msg.id}/attachments/${att.attachmentId}`);
          const buf = b64urlToBuffer(attRes.data);
          const fileSha256 = crypto.createHash('sha256').update(buf).digest('hex');
          if (seenFileHashes.has(fileSha256)) {
            console.log(`[gmail-sync] identical file already imported (${att.filename}) — skipped`);
            skipped++;
            reportProgress('scanning');
            continue;
          }
          const safeExt = (path.extname(att.filename) || (att.mimeType.includes('pdf') ? '.pdf' : '.jpg')).toLowerCase();
          const localName = `gmail_${uuidv4()}${safeExt}`;
          const localPath = path.join(UPLOADS_DIR, localName);
          fs.writeFileSync(localPath, buf);

          // חילוץ AI — אם נכשל (למשל אין מפתח Claude ל-PDF), עדיין שומרים את החשבונית
          // כ"ממתינה" עם הקובץ המצורף, כדי שהמשתמש ימלא ידנית. כך הייבוא מהמייל עובד תמיד.
          let method = 'none', extracted = {};
          try {
            reportProgress(`extracting:${att.filename}`);
            const r = await runDocumentExtraction(localPath, 'invoice');
            method = r.method; extracted = r.data || {};
            if (!extracted || Object.keys(extracted).length === 0 || !extracted.total) {
              console.log(`[gmail-sync] no fields extracted from ${att.filename}, keeping file as pending`);
            }
          } catch (exErr) {
            console.log(`[gmail-sync] extraction failed for ${att.filename} (${String(exErr?.message || exErr).slice(0, 80)}) — saving as pending for manual entry`);
          }

          // לא חשבונית? ייתכן שזה מסמך של עובד (פוליסה, אישור משרד הפנים, ויזה).
          // הקריאה הנוספת ל-AI רצה רק כאן — כלומר רק על מסמכים שכבר נכשלו כחשבונית.
          if (!extracted?.total) {
            const fileUrlBase0 = process.env.PUBLIC_FILE_URL_BASE || APP_BASE_URL;
            const filed = await tryFileAsEmployeeDocument(farmId, localPath, {
              file_url: `${fileUrlBase0}/uploads/${localName}`,
              attachment_name: att.filename,
              subject,
              from: from.email,
              message_id: msg.id,
              reportProgress,
            });
            if (filed) {
              console.log(`[gmail-sync] ${att.filename} → תיק העובד ${filed.employee_name} (דרכון ${filed.passport_number})`);
              filedToEmployees++;
              seenInvoiceKeys.add(msg.id);
              dismissGmailMessageId(farmId, msg.id); // לא יחזור כחשבונית בסריקה הבאה
              reportProgress('scanning');
              continue;
            }
          }

          // אותה חשבונית שהגיעה גם בתזכורת/העברה — מדלגים לפי תוכן, לא לפי message_id
          const dup = findExistingInvoice(farmId, extracted, att.filename, from.email);
          if (dup) {
            console.log(`[gmail-sync] duplicate of invoice ${dup.id} (${att.filename}) — skipped`);
            fs.unlinkSync(localPath);
            skipped++;
            reportProgress('scanning');
            continue;
          }

          // Use From email as a hint when supplier_name missing
          const supplier = findOrCreateSupplier(farmId, {
            name: extracted.supplier_name || from.name,
            vat_id: extracted.supplier_vat_id,
            phone: extracted.supplier_phone,
            address: extracted.supplier_address,
            email: from.email,
          });

          const fileUrlBase = process.env.PUBLIC_FILE_URL_BASE || APP_BASE_URL;
          saveInvoiceFromExtraction(
            farmId, supplier.id, extracted,
            { file_url: `${fileUrlBase}/uploads/${localName}`, filename: localName },
            'gmail',
            { message_id: msg.id, subject, from: from.email, date: dateHeader, attachment_name: att.filename, method, file_sha256: fileSha256 }
          );
          seenFileHashes.add(fileSha256);
          saved++;
          reportProgress('scanning');
        } catch (attErr) {
          console.error('[gmail-sync] attachment failed:', att.filename, String(attErr?.message || attErr));
        }
      }
      seenInvoiceKeys.add(msg.id);
    }
  } while (pageToken);

  // קוראים מחדש מה-DB ולא כותבים את conn המקורי: ensureGmailAccessToken אולי רענן טוקן
  // באמצע הריצה, וכתיבת העותק הישן הייתה דורסת אותו בטוקן שכבר פג.
  const fresh = getGmailConnectionForUser(farmId, conn.user_id) || conn;
  const updated = {
    ...fresh,
    last_sync_at: NOW(),
    last_sync_result: { scanned, saved, skipped, filedToEmployees },
    needs_reauth: false,
    last_error: null,
    last_error_at: null,
    fail_count: 0,
    next_retry_at: null,
  };
  delete updated.id;
  setGmailConnectionForUser(farmId, conn.user_id, updated);
  console.log(`[gmail-sync] done scanned=${scanned} saved=${saved} skipped=${skipped} filedToEmployees=${filedToEmployees}`);
  return { scanned, saved, skipped, filedToEmployees };
}

// ─── BACKGROUND GMAIL POLLER ───────────────────────────────────────────────────
// Tick runs every TICK_INTERVAL_MIN minutes (default 1). For each connection,
// we check whether the user-configured sync_interval_min has elapsed since
// last_sync_at, and only sync those that are due.
const GMAIL_TICK_INTERVAL_MIN = Math.max(1, parseInt(process.env.GMAIL_TICK_INTERVAL_MIN || '1', 10));
let gmailSyncRunning = false;
async function gmailPollerTick() {
  if (gmailSyncRunning) return;
  gmailSyncRunning = true;
  try {
    const rows = db.prepare("SELECT id, farm_id, data FROM entities WHERE entity_type='gmail_connections'").all();
    const now = Date.now();
    for (const r of rows) {
      let conn;
      try { conn = { id: r.id, ...JSON.parse(r.data || '{}') }; } catch { continue; }
      if (conn.auto_sync === false) continue;
      // חיבור מת (invalid_grant) לא ינסה שוב לבד — רק חיבור מחדש של המשתמש מנקה את הדגל.
      // בלי זה הפולר מכה ב-Google כל דקה עד אינסוף (~1,400 בקשות כושלות ביום).
      if (conn.needs_reauth) continue;
      if (conn.next_retry_at && now < conn.next_retry_at) continue; // backoff אחרי כשל חולף
      const intervalMs = normalizeSyncInterval(conn.sync_interval_min) * 60 * 1000;
      const lastMs = conn.last_sync_at ? new Date(conn.last_sync_at).getTime() : 0;
      if (lastMs && (now - lastMs) < intervalMs) continue; // not due yet
      try {
        const result = await syncGmailConnection(r.farm_id, conn);
        if (result.saved > 0 || result.scanned > 0) {
          console.log(`[gmail-poller] farm=${r.farm_id} user=${conn.user_id} email=${conn.email} scanned=${result.scanned} saved=${result.saved}`);
        }
      } catch (err) {
        const fatal = recordGmailSyncFailure(r.farm_id, conn, err);
        console.error(`[gmail-poller] farm=${r.farm_id} user=${conn.user_id} failed:`, String(err?.message || err), fatal ? '— needs re-auth, poller stopped for this connection' : '— will retry with backoff');
      }
    }
  } finally {
    gmailSyncRunning = false;
  }
}
if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) {
  setInterval(gmailPollerTick, GMAIL_TICK_INTERVAL_MIN * 60 * 1000);
  console.log(`[gmail-poller] enabled, tick=${GMAIL_TICK_INTERVAL_MIN}min, allowed intervals=${ALLOWED_SYNC_INTERVALS.join(',')}min`);
}

// ─── FACE EXTRACTION FROM PASSPORT ──────────────────────────────────────────
// Crops the photo region from a passport bio-data page using jimp (pure JS).
// Passport photo is typically on the LEFT side: ~38% width × ~50% height,
// starting at ~8% from top.
app.post('/api/extract-face', authMiddleware, async (req, res) => {
  const { file_url } = req.body;
  if (!file_url) return res.status(400).json({ error: 'file_url required' });

  try {
    const filename = path.basename(file_url.split('?')[0]);
    const filePath = path.join(UPLOADS_DIR, filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });

    // Try jimp — graceful fallback: return original if not installed
    let Jimp;
    try { Jimp = require('jimp'); } catch (_) {
      console.warn('[extract-face] jimp not available, returning original');
      return res.json({ success: true, face_url: file_url, method: 'original' });
    }

    const image = await Jimp.read(filePath);
    const w = image.bitmap.width;
    const h = image.bitmap.height;

    // Portrait vs landscape: passport photo is always on the shorter left edge
    const isPortrait = h >= w;
    let cropX, cropY, cropW, cropH;
    if (isPortrait) {
      // Upright passport scan — photo in lower-left quadrant
      cropX = 0;
      cropY = Math.floor(h * 0.08);
      cropW = Math.floor(w * 0.40);
      cropH = Math.floor(h * 0.52);
    } else {
      // Landscape scan — photo in upper-left area
      cropX = Math.floor(w * 0.02);
      cropY = Math.floor(h * 0.05);
      cropW = Math.floor(w * 0.28);
      cropH = Math.floor(h * 0.75);
    }

    // Ensure crop dimensions are valid
    cropW = Math.min(cropW, w - cropX);
    cropH = Math.min(cropH, h - cropY);
    if (cropW < 20 || cropH < 20) {
      return res.json({ success: true, face_url: file_url, method: 'original' });
    }

    image.crop(cropX, cropY, cropW, cropH);

    const outName = `face_${uuidv4()}.jpg`;
    const outPath = path.join(UPLOADS_DIR, outName);
    await image.quality(88).writeAsync(outPath);

    // Build URL same way as /upload
    const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
    const hostWithoutPort = host.split(':')[0];
    const protocol = req.headers['x-forwarded-proto'] || 'http';
    const face_url = `${protocol}://${hostWithoutPort}/uploads/${outName}`;

    console.log(`[extract-face] cropped ${cropW}×${cropH} from ${w}×${h} → ${outName}`);
    res.json({ success: true, face_url, method: 'jimp' });
  } catch (err) {
    console.error('[extract-face] error:', String(err?.message || err));
    // Don't fail — return original passport URL as fallback
    res.json({ success: true, face_url: file_url, method: 'original', warn: String(err?.message || err) });
  }
});

// Upload file — returns { file_url } pointing to /uploads/<uuid>.<ext>
app.post('/api/upload', authMiddleware, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  // Build URL that goes through nginx (port 80), not direct to backend
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
  const hostWithoutPort = host.split(':')[0];
  const protocol = req.headers['x-forwarded-proto'] || 'http';
  const file_url = `${protocol}://${hostWithoutPort}/uploads/${req.file.filename}`;
  res.json({ file_url, filename: req.file.filename, size: req.file.size });
});

// ─── FIRST-TIME ADMIN SETUP ───────────────────────────────────────────────────
// Disabled unless SETUP_SECRET env var is explicitly set
app.post('/api/admin/setup', async (req, res) => {
  const SETUP_SECRET = process.env.SETUP_SECRET;
  if (!SETUP_SECRET) return res.status(403).json({ error: 'Setup endpoint is disabled' });

  const adminCount = db.prepare('SELECT COUNT(*) as cnt FROM users WHERE is_admin = 1').get();
  if (adminCount.cnt > 0) {
    return res.status(403).json({ error: 'Admin already exists. Use login instead.' });
  }
  const { email, secret } = req.body;
  if (secret !== SETUP_SECRET) return res.status(403).json({ error: 'Invalid setup secret' });
  if (!email) return res.status(400).json({ error: 'Email required' });

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
  if (!user) return res.status(404).json({ error: 'User not found' });

  db.prepare('UPDATE users SET is_admin = 1, updated_at = ? WHERE id = ?').run(NOW(), user.id);
  res.json({ success: true, message: `${email} is now an admin` });
});

// ─── AUTH ─────────────────────────────────────────────────────────────────────
app.post('/api/auth/register', registerLimiter, async (req, res) => {
  if (!ALLOW_REGISTRATION) {
    // Still allow first-ever user (system bootstrap)
    const userCount = db.prepare('SELECT COUNT(*) as cnt FROM users').get();
    if (userCount.cnt > 0) {
      return res.status(403).json({ error: 'Registration is disabled. Contact the administrator.' });
    }
  }
  const { email, password, full_name } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
  if (existing) return res.status(400).json({ error: 'User with this email already exists' });

  const password_hash = await bcrypt.hash(password, 10);
  const userId = uuidv4();
  const farmId = uuidv4();
  const farmName = full_name ? `${full_name}'s Farm` : 'My Farm';
  const now = NOW();

  const userCount = db.prepare('SELECT COUNT(*) as cnt FROM users').get();
  const isFirstUser = userCount.cnt === 0 ? 1 : 0;

  db.prepare('INSERT INTO entities (id, entity_type, farm_id, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    farmId, 'farms', null, JSON.stringify({ name: farmName, owner_id: userId }), now, now
  );
  ensureDefaultActivityTypes();

  db.prepare('INSERT INTO users (id, email, password_hash, full_name, farm_ids, current_farm_id, is_admin, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)').run(
    userId, email.toLowerCase(), password_hash, full_name || '', JSON.stringify([farmId]), farmId, isFirstUser, now, now
  );

  // Add as owner in farm_members
  db.prepare('INSERT OR IGNORE INTO farm_members (id, farm_id, user_id, role, created_at) VALUES (?, ?, ?, ?, ?)').run(
    uuidv4(), farmId, userId, 'owner', now
  );

  const token = jwt.sign({ id: userId, email: email.toLowerCase() }, JWT_SECRET, { expiresIn: '30d' });
  res.json({
    token,
    user: {
      id: userId, email: email.toLowerCase(), full_name: full_name || '',
      farm_ids: [farmId], current_farm_id: farmId,
      is_admin: !!isFirstUser, is_active: true
    }
  });
});

app.post('/api/auth/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
  if (!user) return res.status(401).json({ error: 'Invalid email or password' });

  if (user.is_active === 0) return res.status(403).json({ error: 'Account is disabled. Contact administrator.' });

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Invalid email or password' });

  const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
  res.json({
    token,
    user: {
      id: user.id, email: user.email, full_name: user.full_name,
      avatar_url: user.avatar_url, farm_ids: JSON.parse(user.farm_ids || '[]'),
      current_farm_id: user.current_farm_id,
      is_admin: !!user.is_admin, is_active: user.is_active !== 0
    }
  });
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
  const user = getUser(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const out = formatUser(user);
  // המשק הנוכחי מצורף לתשובה כדי לחסוך סבב רשת נוסף (me → farm) בכל טעינת עמוד
  if (user.current_farm_id && out.farm_ids.includes(user.current_farm_id)) {
    const farmRow = db.prepare("SELECT * FROM entities WHERE entity_type='farms' AND id=?").get(user.current_farm_id);
    out.current_farm = farmRow ? formatEntity(farmRow) : null;
  }
  res.json(out);
});

app.put('/api/auth/me', authMiddleware, (req, res) => {
  const user = getUser(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const { full_name, avatar_url, current_farm_id, farm_ids, language } = req.body;
  const updated = {
    full_name: full_name !== undefined ? full_name : user.full_name,
    avatar_url: avatar_url !== undefined ? avatar_url : user.avatar_url,
    current_farm_id: current_farm_id !== undefined ? current_farm_id : user.current_farm_id,
    farm_ids_str: farm_ids !== undefined ? JSON.stringify(farm_ids) : JSON.stringify(user.farm_ids),
    language: language !== undefined ? language : user.language,
  };

  db.prepare('UPDATE users SET full_name=?, avatar_url=?, current_farm_id=?, farm_ids=?, language=?, updated_at=? WHERE id=?').run(
    updated.full_name, updated.avatar_url, updated.current_farm_id, updated.farm_ids_str, updated.language, NOW(), user.id
  );

  res.json(formatUser(getUser(user.id)));
});

app.post('/api/auth/change-password', authMiddleware, async (req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password) return res.status(400).json({ error: 'Both passwords required' });
  if (new_password.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const valid = await bcrypt.compare(current_password, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });

  const hash = await bcrypt.hash(new_password, 10);
  db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(hash, NOW(), user.id);
  res.json({ success: true });
});

// ─── GOOGLE OAUTH ─────────────────────────────────────────────────────────────

app.get('/api/auth/google/config', (_req, res) => {
  res.json({ enabled: !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) });
});

app.get('/api/auth/google', (_req, res) => {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET)
    return res.redirect(`${APP_BASE_URL}/login?error=google_not_configured`);
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: `${APP_BASE_URL}/api/auth/google/callback`,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'offline',
    prompt: 'select_account',
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

app.get('/api/auth/google/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error || !code) return res.redirect(`${APP_BASE_URL}/login?error=google_cancelled`);
  try {
    // Exchange code for tokens using native https (avoids fetch/undici timeout issues)
    const tokenBody = new URLSearchParams({
      code, client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: `${APP_BASE_URL}/api/auth/google/callback`,
      grant_type: 'authorization_code',
    }).toString();
    const tokenResult = await httpsRequest({
      hostname: 'oauth2.googleapis.com',
      path: '/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(tokenBody),
      },
    }, tokenBody);
    const tokens = JSON.parse(tokenResult.body);
    if (!tokens.access_token) return res.redirect(`${APP_BASE_URL}/login?error=google_token_failed`);

    // Get user info using native https
    const infoResult = await httpsRequest({
      hostname: 'www.googleapis.com',
      path: '/oauth2/v2/userinfo',
      method: 'GET',
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const gu = JSON.parse(infoResult.body);
    if (!gu.email) return res.redirect(`${APP_BASE_URL}/login?error=google_no_email`);

    // Find by google_id → then by email → else create
    let user = db.prepare('SELECT * FROM users WHERE google_id = ?').get(gu.id);
    if (!user) {
      user = db.prepare('SELECT * FROM users WHERE LOWER(email) = LOWER(?)').get(gu.email);
      if (user) {
        db.prepare("UPDATE users SET google_id = ?, avatar_url = COALESCE(NULLIF(avatar_url,''),?), updated_at = ? WHERE id = ?")
          .run(gu.id, gu.picture || '', NOW(), user.id);
        user = getUser(user.id);
      } else {
        const cnt = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
        if (!ALLOW_REGISTRATION && cnt > 0)
          return res.redirect(`${APP_BASE_URL}/login?error=registration_disabled`);
        const newId = uuidv4();
        const isFirst = cnt === 0 ? 1 : 0;
        db.prepare('INSERT INTO users (id,email,password_hash,full_name,avatar_url,google_id,is_admin,is_active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,1,?,?)')
          .run(newId, gu.email, '', gu.name || '', gu.picture || '', gu.id, isFirst, NOW(), NOW());
        user = getUser(newId);
      }
    }
    if (!user || !user.is_active) return res.redirect(`${APP_BASE_URL}/login?error=account_disabled`);
    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
    res.redirect(`${APP_BASE_URL}/auth/google/success?token=${encodeURIComponent(token)}`);
  } catch (err) {
    console.error('Google OAuth error:', err);
    res.redirect(`${APP_BASE_URL}/login?error=google_error`);
  }
});

// ─── ADMIN ROUTES ─────────────────────────────────────────────────────────────

app.get('/api/admin/stats', authMiddleware, adminMiddleware, (req, res) => {
  const totalUsers = db.prepare('SELECT COUNT(*) as cnt FROM users').get().cnt;
  const activeUsers = db.prepare('SELECT COUNT(*) as cnt FROM users WHERE is_active = 1').get().cnt;
  const adminUsers = db.prepare('SELECT COUNT(*) as cnt FROM users WHERE is_admin = 1').get().cnt;
  const totalFarms = db.prepare("SELECT COUNT(*) as cnt FROM entities WHERE entity_type = 'farms'").get().cnt;
  const totalEntities = db.prepare("SELECT COUNT(*) as cnt FROM entities WHERE entity_type != 'farms'").get().cnt;
  const entityBreakdown = db.prepare(
    "SELECT entity_type, COUNT(*) as cnt FROM entities WHERE entity_type != 'farms' GROUP BY entity_type ORDER BY cnt DESC LIMIT 10"
  ).all();
  const recentUsers = db.prepare(
    "SELECT COUNT(*) as cnt FROM users WHERE created_at > datetime('now', '-30 days')"
  ).get().cnt;
  const totalNotifications = db.prepare('SELECT COUNT(*) as cnt FROM notifications').get().cnt;
  let dbSize = 0;
  try { dbSize = fs.statSync(DB_PATH).size; } catch (_) {}

  res.json({
    users: { total: totalUsers, active: activeUsers, admins: adminUsers, recent_30d: recentUsers },
    farms: { total: totalFarms },
    entities: { total: totalEntities, breakdown: entityBreakdown },
    notifications: { total: totalNotifications },
    system: { db_size_bytes: dbSize, uptime_seconds: Math.floor(process.uptime()), node_version: process.version }
  });
});

// מצב שרת לבקרה (דיסק/זיכרון/uptime/uploads) — אחרי האירוע של דיסק מלא.
app.get('/api/admin/server-status', authMiddleware, adminMiddleware, async (req, res) => {
  const os = require('os');
  const out = {
    server_time: NOW(),
    uptime_seconds: Math.floor(process.uptime()),
    node_version: process.version,
    load_avg: os.loadavg().map(x => Math.round(x * 100) / 100),
  };
  // דיסק (שורש /) — מחשב כמו df
  try {
    const s = await fs.promises.statfs('/');
    const total = s.blocks * s.bsize;
    const free = s.bavail * s.bsize;
    const used = (s.blocks - s.bfree) * s.bsize;
    out.disk = { total, free, used, use_percent: Math.round((used / (used + free)) * 100) };
  } catch { out.disk = null; }
  // זיכרון
  const totalMem = os.totalmem(), freeMem = os.freemem();
  out.memory = {
    total: totalMem, free: freeMem, used: totalMem - freeMem,
    use_percent: Math.round(((totalMem - freeMem) / totalMem) * 100),
    process_rss: process.memoryUsage().rss,
  };
  // DB + uploads
  try { out.db_size_bytes = fs.statSync(DB_PATH).size; } catch { out.db_size_bytes = 0; }
  try {
    const files = fs.readdirSync(UPLOADS_DIR);
    let sz = 0;
    for (const f of files) { try { sz += fs.statSync(path.join(UPLOADS_DIR, f)).size; } catch { /* skip */ } }
    out.uploads = { count: files.length, size_bytes: sz };
  } catch { out.uploads = { count: 0, size_bytes: 0 }; }
  res.json(out);
});

app.get('/api/admin/users', authMiddleware, adminMiddleware, (req, res) => {
  const users = db.prepare('SELECT * FROM users ORDER BY created_at DESC').all();
  const result = users.map(u => {
    const farmIds = JSON.parse(u.farm_ids || '[]');
    const farms = farmIds.length > 0
      ? db.prepare(`SELECT id, data FROM entities WHERE entity_type = 'farms' AND id IN (${farmIds.map(() => '?').join(',')})`).all(...farmIds)
        .map(f => ({ id: f.id, name: JSON.parse(f.data || '{}').name || 'Unnamed' }))
      : [];
    const entityCount = farmIds.length > 0
      ? db.prepare(`SELECT COUNT(*) as cnt FROM entities WHERE entity_type != 'farms' AND farm_id IN (${farmIds.map(() => '?').join(',')})`).get(...farmIds).cnt
      : 0;
    return {
      id: u.id, email: u.email, full_name: u.full_name,
      is_admin: !!u.is_admin, is_active: u.is_active !== 0,
      farm_ids: farmIds, farms, entity_count: entityCount,
      created_at: u.created_at, updated_at: u.updated_at,
    };
  });
  res.json(result);
});

app.put('/api/admin/users/:id', authMiddleware, adminMiddleware, async (req, res) => {
  const { id } = req.params;
  if (id === req.user.id) return res.status(400).json({ error: 'Cannot modify your own admin account' });

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const { is_admin, is_active, full_name, new_password } = req.body;
  const updates = [];
  const params = [];

  if (is_admin !== undefined) { updates.push('is_admin = ?'); params.push(is_admin ? 1 : 0); }
  if (is_active !== undefined) { updates.push('is_active = ?'); params.push(is_active ? 1 : 0); }
  if (full_name !== undefined) { updates.push('full_name = ?'); params.push(full_name); }
  if (new_password) {
    if (new_password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    const hash = await bcrypt.hash(new_password, 10);
    updates.push('password_hash = ?');
    params.push(hash);
  }

  if (updates.length === 0) return res.status(400).json({ error: 'No changes provided' });

  updates.push('updated_at = ?');
  params.push(NOW());
  params.push(id);

  db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  res.json(formatUser(updated));
});

app.delete('/api/admin/users/:id', authMiddleware, adminMiddleware, (req, res) => {
  const { id } = req.params;
  if (id === req.user.id) return res.status(400).json({ error: 'Cannot delete your own account' });

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const farmIds = JSON.parse(user.farm_ids || '[]');
  if (farmIds.length > 0) {
    const ph = farmIds.map(() => '?').join(',');
    db.prepare(`DELETE FROM entities WHERE farm_id IN (${ph})`).run(...farmIds);
    db.prepare(`DELETE FROM entities WHERE entity_type = 'farms' AND id IN (${ph})`).run(...farmIds);
    db.prepare(`DELETE FROM farm_members WHERE farm_id IN (${ph})`).run(...farmIds);
  }

  db.prepare('DELETE FROM farm_members WHERE user_id = ?').run(id);
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  res.json({ success: true, deleted_farms: farmIds.length });
});

app.get('/api/admin/farms', authMiddleware, adminMiddleware, (req, res) => {
  const farms = db.prepare("SELECT * FROM entities WHERE entity_type = 'farms' ORDER BY created_at DESC").all();
  const result = farms.map(f => {
    const data = JSON.parse(f.data || '{}');
    const entityCount = db.prepare("SELECT COUNT(*) as cnt FROM entities WHERE entity_type != 'farms' AND farm_id = ?").get(f.id).cnt;
    const owner = data.owner_id ? db.prepare('SELECT id, email, full_name FROM users WHERE id = ?').get(data.owner_id) : null;
    const memberCount = db.prepare('SELECT COUNT(*) as cnt FROM farm_members WHERE farm_id = ?').get(f.id).cnt;
    return { id: f.id, name: data.name, owner, entity_count: entityCount, member_count: memberCount, created_at: f.created_at };
  });
  res.json(result);
});

// Admin: get all sent notifications
app.get('/api/admin/notifications', authMiddleware, adminMiddleware, (req, res) => {
  const rows = db.prepare(`
    SELECT n.*, u.full_name as sender_name, u.email as sender_email
    FROM notifications n
    LEFT JOIN users u ON n.sent_by = u.id
    ORDER BY n.created_at DESC
    LIMIT 100
  `).all();
  res.json(rows);
});

// ─── IMPORT PESTICIDES FROM MINISTRY OF AGRICULTURE ──────────────────────────
// Shared catalog: pesticides are stored with farm_id = NULL so all users see them.
// Only admins (or any authenticated user) can trigger the import.
app.post('/api/functions/importPesticides', authMiddleware, async (req, res) => {
  const user = getUser(req.user.id);
  if (!user) return res.json({ data: { success: false, error: 'נדרשת הזדהות' } });

  const { cropGroups, records: clientRecords } = req.body;

  let allRecords = [];
  const seenKeys = new Set();

  // If the frontend already fetched the records (browser-side fetch), use them directly.
  // Otherwise fall back to server-side fetch from data.gov.il.
  if (Array.isArray(clientRecords) && clientRecords.length > 0) {
    for (const record of clientRecords) {
      const regNum = record['מספר רשיון']?.toString().trim();
      const crop   = (record['גידול'] || '').trim();
      const pest   = (record['נגע']   || '').trim();
      const key    = `${regNum}|${crop}|${pest}`;
      if (regNum && !seenKeys.has(key)) { seenKeys.add(key); allRecords.push(record); }
    }
  } else {
    // Server-side fetch (works if the VM can reach data.gov.il)
    const GOV_API     = 'https://data.gov.il/api/3/action/datastore_search';
    const RESOURCE_ID = 'cffe0c50-6856-4187-9315-51bc113cb718';
    try {
      const groups = (Array.isArray(cropGroups) && cropGroups.length > 0) ? cropGroups : [null];
      for (const group of groups) {
        let offset = 0;
        const limit = 500;
        while (true) {
          let url = `${GOV_API}?resource_id=${RESOURCE_ID}&limit=${limit}&offset=${offset}`;
          if (group) url += `&filters=${encodeURIComponent(JSON.stringify({ 'קבוצת גידולים': group }))}`;
          const govRes = await fetch(url, { headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36' } });
          if (!govRes.ok) break;
          const govData = await govRes.json();
          if (!govData.success || !Array.isArray(govData.result?.records)) break;
          for (const record of govData.result.records) {
            const regNum = record['מספר רשיון']?.toString().trim();
            const crop   = (record['גידול'] || '').trim();
            const pest   = (record['נגע']   || '').trim();
            const key    = `${regNum}|${crop}|${pest}`;
            if (regNum && !seenKeys.has(key)) { seenKeys.add(key); allRecords.push(record); }
          }
          if (govData.result.records.length < limit) break;
          offset += limit;
          if (offset >= 1500) break;
        }
      }
    } catch (fetchErr) {
      return res.json({ data: { success: false, error: `שגיאה בגישה למאגר הממשלתי: ${fetchErr.message}` } });
    }
  }

  if (allRecords.length === 0) {
    return res.json({ data: { success: false, error: 'לא נמצאו רשומות במאגר הממשלתי. ייתכן שהקבוצה שנבחרה אינה קיימת.' } });
  }

  // Load existing shared catalog (farm_id IS NULL) for dedup
  const existingRows = db.prepare("SELECT id, data FROM entities WHERE entity_type = 'pesticides' AND farm_id IS NULL").all();
  const existingMap = new Map(); // key = regNum|crop|pest
  for (const row of existingRows) {
    const d = JSON.parse(row.data || '{}');
    if (d.registration_number) {
      const k = `${d.registration_number}|${d.crop || ''}|${d.pest || ''}`;
      existingMap.set(k, { id: row.id, data: d });
    }
  }

  let newCount = 0, updatedCount = 0, skippedCount = 0;

  for (const record of allRecords) {
    try {
      // Note: field is 'מספר רשיון' (not 'מספר רישיון') in this dataset
      const regNum = record['מספר רשיון']?.toString().trim();
      const name   = record['שם תכשיר']?.trim();
      if (!regNum || !name) { skippedCount++; continue; }

      // Classify type from activity field
      let type = 'other';
      const act = (record['סוג פעילות'] || '').toLowerCase();
      if (act.includes('פטרי'))                             type = 'fungicide';
      else if (act.includes('חרק') || act.includes('אקרי')) type = 'insecticide';
      else if (act.includes('עשב') || act.includes('צמח'))  type = 'herbicide';

      const crop = (record['גידול'] || '').trim();
      const pest = (record['נגע']   || '').trim();

      const pesticideData = {
        registration_number: regNum,
        product_name:        name,
        product_type:        type,
        manufacturer:        record['בעל רשיון']         || '',  // note: 'רשיון' not 'רישיון'
        active_ingredients:  record['חומר פעיל']         || '',
        concentration:       record['ריכוז חומר פעיל']   || '',
        crop,
        pest,
        dosage:              record['מינון ליישום']       || '',
        volume:              record['נפח ליישום']         || '',
        label_url:           record['תווית']              || '',
        waiting_period:      record['תקופת המתנה']        || '',
        crop_group:          record['קבוצת גידולים']      || '',
      };

      const mapKey = `${regNum}|${crop}|${pest}`;
      const existing = existingMap.get(mapKey);
      if (existing) {
        // Only fill in empty fields — never overwrite user data
        const updates = {};
        for (const [k, v] of Object.entries(pesticideData)) {
          if (k !== 'registration_number' && v && !existing.data[k]?.toString().trim()) updates[k] = v;
        }
        if (Object.keys(updates).length > 0) {
          const merged = { ...existing.data, ...updates };
          db.prepare('UPDATE entities SET data = ?, updated_at = ? WHERE entity_type = ? AND id = ?').run(
            JSON.stringify(merged), NOW(), 'pesticides', existing.id
          );
          updatedCount++;
        } else {
          skippedCount++;
        }
      } else {
        const id = uuidv4();
        const now = NOW();
        // farm_id = NULL → shared catalog, visible to all farms
        db.prepare('INSERT INTO entities (id, entity_type, farm_id, data, created_at, updated_at) VALUES (?, ?, NULL, ?, ?, ?)').run(
          id, 'pesticides', JSON.stringify(pesticideData), now, now
        );
        existingMap.set(mapKey, { id, data: pesticideData });
        newCount++;
      }
    } catch (_) {
      skippedCount++;
    }
  }

  return res.json({
    data: {
      success: true,
      message: `הושלם! ${newCount} חדשים, ${updatedCount} עודכנו, ${skippedCount} דולגו`,
      stats: { new: newCount, updated: updatedCount, skipped: skippedCount }
    }
  });
});

// ─── FARM MEMBERS ─────────────────────────────────────────────────────────────

// List members of a farm
app.get('/api/farm-members', authMiddleware, (req, res) => {
  const { farm_id } = req.query;
  const user = getUser(req.user.id);
  if (!farm_id) return res.status(400).json({ error: 'farm_id required' });
  if (!user.farm_ids.includes(farm_id) && !user.is_admin) return res.status(403).json({ error: 'Forbidden' });

  const members = db.prepare(`
    SELECT fm.id, fm.farm_id, fm.user_id, fm.role, fm.invited_by, fm.created_at,
           u.email, u.full_name, u.avatar_url, u.is_active, u.field_worker
    FROM farm_members fm
    JOIN users u ON fm.user_id = u.id
    WHERE fm.farm_id = ?
    ORDER BY CASE fm.role WHEN 'owner' THEN 1 WHEN 'manager' THEN 2 WHEN 'worker' THEN 3 ELSE 4 END, fm.created_at ASC
  `).all(farm_id);
  res.json(members);
});

// Invite (or add existing) user to farm
app.post('/api/farm-members/invite', authMiddleware, async (req, res) => {
  const { farm_id, email, full_name, role, password, field_worker, send_email } = req.body;
  const user = getUser(req.user.id);

  if (!farm_id || !email) return res.status(400).json({ error: 'farm_id and email are required' });

  if (!user.is_admin) {
    if (!user.farm_ids.includes(farm_id)) return res.status(403).json({ error: 'Forbidden' });
    const member = getFarmMember(farm_id, req.user.id);
    if (!member || !['owner', 'manager'].includes(member.role)) {
      return res.status(403).json({ error: 'Only farm owners/managers can invite members' });
    }
  }

  // Field workers are always role 'worker' and default to the Thai reduced UI.
  const isFieldWorker = !!field_worker;
  const validRoles = ['owner', 'manager', 'worker', 'viewer'];
  const assignedRole = isFieldWorker ? 'worker' : (validRoles.includes(role) ? role : 'worker');

  // Find or create target user
  let targetUser = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
  let isNewUser = false;

  if (!targetUser) {
    if (!password || password.length < 6) return res.status(400).json({ error: 'Password (min 6 chars) required to create new user' });
    const hash = await bcrypt.hash(password, 10);
    const newId = uuidv4();
    const now = NOW();
    db.prepare('INSERT INTO users (id, email, password_hash, full_name, farm_ids, current_farm_id, is_admin, is_active, field_worker, language, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, 1, ?, ?, ?, ?)').run(
      newId, email.toLowerCase(), hash, full_name || '', JSON.stringify([farm_id]), farm_id, isFieldWorker ? 1 : 0, isFieldWorker ? 'th' : null, now, now
    );
    targetUser = db.prepare('SELECT * FROM users WHERE id = ?').get(newId);
    isNewUser = true;
  } else {
    // Add farm to existing user's farm_ids if not already there
    const existingFarmIds = JSON.parse(targetUser.farm_ids || '[]');
    if (!existingFarmIds.includes(farm_id)) {
      existingFarmIds.push(farm_id);
      db.prepare('UPDATE users SET farm_ids = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(existingFarmIds), NOW(), targetUser.id);
    }
    if (isFieldWorker) {
      db.prepare('UPDATE users SET field_worker = 1, language = COALESCE(language, ?), updated_at = ? WHERE id = ?').run('th', NOW(), targetUser.id);
    }
  }

  const inviteLink = `${APP_BASE_URL}/login`;

  // שליחת מייל הזמנה אמיתי דרך ה-Gmail המחובר של המזמין (אם התבקש).
  // כולל לינק כניסה, האימייל, והסיסמה (אם הוזנה כעת). מחזיר סטטוס שליחה.
  const maybeSendInviteEmail = async () => {
    if (!send_email) return { email_sent: false, email_error: null };
    try {
      const conn = getGmailConnectionForUser(farm_id, req.user.id);
      if (!conn) return { email_sent: false, email_error: 'אין חיבור Gmail — חבר את Gmail בהגדרות' };
      const farmRow = db.prepare("SELECT data FROM entities WHERE entity_type='farms' AND id=?").get(farm_id);
      const farmName = farmRow ? (JSON.parse(farmRow.data || '{}').name || '') : '';
      const body = [
        `שלום ${targetUser.full_name || ''}`.trim() + ',',
        '',
        `הוזמנת להצטרף למערכת ניהול המשק${farmName ? ` "${farmName}"` : ''}.`,
        '',
        `כתובת המערכת: ${APP_BASE_URL}`,
        `האימייל שלך לכניסה: ${targetUser.email}`,
        (password && password.length >= 6) ? `סיסמה: ${password}` : null,
        '',
        `להתחברות: ${inviteLink}`,
        '',
        'בברכה,',
        farmName || 'farm-flow',
      ].filter(l => l !== null).join('\n');
      const subject = `הוזמנת למערכת farm-flow${farmName ? ` — ${farmName}` : ''}`;
      const raw = buildPlainRawEmail({ to: targetUser.email, subject, text: body });
      await sendGmailMessage(farm_id, conn, raw);
      return { email_sent: true, email_error: null };
    } catch (e) {
      const b = String(e?.body || e?.message || e);
      if (e?.status === 403 || /insufficient|scope|ACCESS_TOKEN_SCOPE/i.test(b)) {
        return { email_sent: false, email_error: 'חיבור Gmail ללא הרשאת שליחה — חבר מחדש בהגדרות' };
      }
      return { email_sent: false, email_error: String(e?.message || e).slice(0, 200) };
    }
  };

  // Check if already a member — אם כן, "הזמנה חוזרת": מנפיק מחדש פרטי כניסה
  // (איפוס סיסמה אם נמסרה). התפקיד לא משתנה כאן — לכך יש את תפריט התפקיד הייעודי.
  const existing = getFarmMember(farm_id, targetUser.id);
  if (existing) {
    let passwordReset = false;
    if (password && password.length >= 6) {
      const hash = await bcrypt.hash(password, 10);
      db.prepare('UPDATE users SET password_hash=?, updated_at=? WHERE id=?').run(hash, NOW(), targetUser.id);
      passwordReset = true;
    }
    const mail = await maybeSendInviteEmail();
    return res.json({
      id: existing.id, farm_id, user_id: targetUser.id,
      email: targetUser.email, full_name: targetUser.full_name,
      role: existing.role, is_new_user: false, reinvited: true,
      password_reset: passwordReset, is_active: targetUser.is_active !== 0,
      invite_link: inviteLink, ...mail,
    });
  }

  const memberId = uuidv4();
  db.prepare('INSERT INTO farm_members (id, farm_id, user_id, role, invited_by, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    memberId, farm_id, targetUser.id, assignedRole, req.user.id, NOW()
  );

  const mail = await maybeSendInviteEmail();
  res.json({
    id: memberId,
    farm_id,
    user_id: targetUser.id,
    email: targetUser.email,
    full_name: targetUser.full_name,
    role: assignedRole,
    is_new_user: isNewUser,
    is_active: targetUser.is_active !== 0,
    invite_link: inviteLink, ...mail,
  });
});

// Update a member: role (owner/admin only) and/or the field_worker flag (owner/manager/admin).
app.put('/api/farm-members/:id', authMiddleware, (req, res) => {
  const { id } = req.params;
  const { role, field_worker } = req.body;
  const user = getUser(req.user.id);

  const membership = db.prepare('SELECT * FROM farm_members WHERE id = ?').get(id);
  if (!membership) return res.status(404).json({ error: 'Membership not found' });

  const myMembership = getFarmMember(membership.farm_id, req.user.id);
  const isOwnerOrAdmin = user.is_admin || myMembership?.role === 'owner';
  const isManagerPlus = user.is_admin || ['owner', 'manager'].includes(myMembership?.role);

  if (role !== undefined) {
    if (!isOwnerOrAdmin) return res.status(403).json({ error: 'Only farm owners can change roles' });
    const validRoles = ['owner', 'manager', 'worker', 'viewer'];
    if (!validRoles.includes(role)) return res.status(400).json({ error: 'Invalid role' });
    db.prepare('UPDATE farm_members SET role = ? WHERE id = ?').run(role, id);
    membership.role = role;
  }

  if (field_worker !== undefined) {
    if (!isManagerPlus) return res.status(403).json({ error: 'Forbidden' });
    if (field_worker) {
      // Enabling field-worker mode also forces the worker role and defaults language to Thai.
      db.prepare('UPDATE users SET field_worker = 1, language = COALESCE(language, ?), updated_at = ? WHERE id = ?').run('th', NOW(), membership.user_id);
      db.prepare("UPDATE farm_members SET role = 'worker' WHERE id = ?").run(id);
      membership.role = 'worker';
    } else {
      db.prepare('UPDATE users SET field_worker = 0, updated_at = ? WHERE id = ?').run(NOW(), membership.user_id);
    }
  }

  const u = db.prepare('SELECT field_worker FROM users WHERE id = ?').get(membership.user_id);
  res.json({ ...membership, field_worker: !!u?.field_worker });
});

// Remove member from farm
app.delete('/api/farm-members/:id', authMiddleware, (req, res) => {
  const { id } = req.params;
  const user = getUser(req.user.id);

  const membership = db.prepare('SELECT * FROM farm_members WHERE id = ?').get(id);
  if (!membership) return res.status(404).json({ error: 'Membership not found' });

  const isSelf = membership.user_id === req.user.id;
  if (!user.is_admin && !isSelf) {
    const myMembership = getFarmMember(membership.farm_id, req.user.id);
    if (!myMembership || myMembership.role !== 'owner') return res.status(403).json({ error: 'Only farm owners can remove members' });
  }

  // Remove farm from user's farm_ids
  const targetUser = db.prepare('SELECT * FROM users WHERE id = ?').get(membership.user_id);
  if (targetUser) {
    const updatedFarmIds = JSON.parse(targetUser.farm_ids || '[]').filter(fid => fid !== membership.farm_id);
    const newCurrentFarm = targetUser.current_farm_id === membership.farm_id
      ? (updatedFarmIds[0] || null)
      : targetUser.current_farm_id;
    db.prepare('UPDATE users SET farm_ids = ?, current_farm_id = ?, updated_at = ? WHERE id = ?').run(
      JSON.stringify(updatedFarmIds), newCurrentFarm, NOW(), membership.user_id
    );
  }

  db.prepare('DELETE FROM farm_members WHERE id = ?').run(id);
  res.json({ success: true });
});

// ─── NOTIFICATIONS ────────────────────────────────────────────────────────────

// Get my notifications (direct + farm-wide + system-wide), excluding dismissed
app.get('/api/notifications', authMiddleware, (req, res) => {
  const user = getUser(req.user.id);
  const farmIds = user.farm_ids;

  let rows;
  if (farmIds.length > 0) {
    const ph = farmIds.map(() => '?').join(',');
    rows = db.prepare(`
      SELECT n.*, nr.dismissed, nr.read_at,
             u.full_name as sender_name, u.email as sender_email
      FROM notifications n
      LEFT JOIN notification_reads nr ON n.id = nr.notification_id AND nr.user_id = ?
      LEFT JOIN users u ON n.sent_by = u.id
      WHERE (n.recipient_id = ?
             OR (n.recipient_id IS NULL AND n.farm_id IN (${ph}))
             OR (n.recipient_id IS NULL AND n.farm_id IS NULL))
        AND (nr.dismissed IS NULL OR nr.dismissed = 0)
      ORDER BY n.created_at DESC
      LIMIT 50
    `).all(req.user.id, req.user.id, ...farmIds);
  } else {
    rows = db.prepare(`
      SELECT n.*, nr.dismissed, nr.read_at,
             u.full_name as sender_name, u.email as sender_email
      FROM notifications n
      LEFT JOIN notification_reads nr ON n.id = nr.notification_id AND nr.user_id = ?
      LEFT JOIN users u ON n.sent_by = u.id
      WHERE (n.recipient_id = ? OR (n.recipient_id IS NULL AND n.farm_id IS NULL))
        AND (nr.dismissed IS NULL OR nr.dismissed = 0)
      ORDER BY n.created_at DESC
      LIMIT 50
    `).all(req.user.id, req.user.id);
  }

  res.json(rows.map(n => ({
    id: n.id,
    title: n.title,
    body: n.body,
    type: n.type,
    farm_id: n.farm_id,
    recipient_id: n.recipient_id,
    sent_by: n.sent_by,
    sender_name: n.sender_name,
    is_read: !!n.read_at,
    created_at: n.created_at,
  })));
});

// Send a notification
app.post('/api/notifications', authMiddleware, async (req, res) => {
  const { title, body, type, farm_id, recipient_id } = req.body;
  const user = getUser(req.user.id);

  if (!title) return res.status(400).json({ error: 'Title required' });

  if (!user.is_admin) {
    if (!farm_id) return res.status(403).json({ error: 'Only admins can send system-wide notifications' });
    const member = getFarmMember(farm_id, req.user.id);
    if (!member || !['owner', 'manager'].includes(member.role)) {
      return res.status(403).json({ error: 'Only farm owners/managers can send notifications' });
    }
  }

  const id = uuidv4();
  const validTypes = ['info', 'success', 'warning', 'error'];
  const notifType = validTypes.includes(type) ? type : 'info';

  db.prepare('INSERT INTO notifications (id, recipient_id, farm_id, title, body, type, sent_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    id, recipient_id || null, farm_id || null, title, body || '', notifType, req.user.id, NOW()
  );

  res.json({ id, title, body: body || '', type: notifType, farm_id: farm_id || null, recipient_id: recipient_id || null, sent_by: req.user.id, created_at: NOW() });
});

// Mark notification as read
app.put('/api/notifications/:id/read', authMiddleware, (req, res) => {
  db.prepare('INSERT OR REPLACE INTO notification_reads (notification_id, user_id, dismissed, read_at) VALUES (?, ?, 0, ?)').run(req.params.id, req.user.id, NOW());
  res.json({ success: true });
});

// Dismiss notification (won't show again)
app.delete('/api/notifications/:id', authMiddleware, (req, res) => {
  db.prepare('INSERT OR REPLACE INTO notification_reads (notification_id, user_id, dismissed, read_at) VALUES (?, ?, 1, ?)').run(req.params.id, req.user.id, NOW());
  res.json({ success: true });
});

// ─── TELEGRAM BOT ─────────────────────────────────────────────────────────────

// in-memory link codes: code → { user_id, expires }
const _tgLinkCodes = new Map();

function tgGetConfig(farmId) {
  const row = db.prepare("SELECT data FROM entities WHERE entity_type='telegram_config' AND farm_id=? LIMIT 1").get(farmId);
  return row ? JSON.parse(row.data) : null;
}
function tgSaveConfig(farmId, cfg) {
  const ex = db.prepare("SELECT id FROM entities WHERE entity_type='telegram_config' AND farm_id=? LIMIT 1").get(farmId);
  if (ex) {
    db.prepare("UPDATE entities SET data=?,updated_at=? WHERE entity_type='telegram_config' AND id=?").run(JSON.stringify(cfg), NOW(), ex.id);
  } else {
    db.prepare("INSERT INTO entities (id,entity_type,farm_id,data,created_at,updated_at) VALUES (?,?,?,?,?,?)").run(uuidv4(), 'telegram_config', farmId, JSON.stringify(cfg), NOW(), NOW());
  }
}
async function tgApi(token, method, body = {}) {
  const bodyStr = JSON.stringify(body);
  return httpsRequest({
    hostname: 'api.telegram.org',
    path: `/bot${token}/${method}`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) }
  }, bodyStr);
}
async function tgSend(token, chatId, text) {
  return tgApi(token, 'sendMessage', { chat_id: chatId, text, parse_mode: 'HTML' });
}

// GET /api/telegram/config
app.get('/api/telegram/config', authMiddleware, (req, res) => {
  const user = getUser(req.user.id);
  if (!user?.current_farm_id) return res.status(400).json({ error: 'אין משק פעיל' });
  const cfg = tgGetConfig(user.current_farm_id);
  if (!cfg) return res.json({ enabled: false });
  res.json({ enabled: true, bot_username: cfg.bot_username, bot_name: cfg.bot_name, webhook_set: cfg.webhook_set });
});

// POST /api/telegram/config — validate token, register webhook
app.post('/api/telegram/config', authMiddleware, async (req, res) => {
  const { token } = req.body;
  if (!token?.trim()) return res.status(400).json({ error: 'token חסר' });
  const user = getUser(req.user.id);
  if (!user?.current_farm_id) return res.status(400).json({ error: 'אין משק פעיל' });

  // Validate token
  const meRes = await tgApi(token, 'getMe');
  if (meRes.status !== 200) return res.status(400).json({ error: 'Token לא תקין' });
  const me = JSON.parse(meRes.body);
  if (!me.ok) return res.status(400).json({ error: 'Token שגוי: ' + me.description });

  const webhookSecret = uuidv4().replace(/-/g, '');
  const webhookUrl   = 'https://farm.nitur-ai.com/api/telegram/webhook';

  const whRes  = await tgApi(token, 'setWebhook', { url: webhookUrl, secret_token: webhookSecret, allowed_updates: ['message'] });
  const whData = JSON.parse(whRes.body);

  const cfg = {
    token,
    webhook_secret: webhookSecret,
    bot_username: me.result.username,
    bot_name: me.result.first_name,
    webhook_set: whData.ok,
  };
  tgSaveConfig(user.current_farm_id, cfg);
  console.log(`[TG] @${me.result.username} configured for farm ${user.current_farm_id}`);
  res.json({ success: true, bot_username: cfg.bot_username, webhook_set: cfg.webhook_set });
});

// DELETE /api/telegram/config — remove bot
app.delete('/api/telegram/config', authMiddleware, async (req, res) => {
  const user = getUser(req.user.id);
  if (!user?.current_farm_id) return res.status(400).json({ error: 'אין משק פעיל' });
  const cfg = tgGetConfig(user.current_farm_id);
  if (cfg) {
    await tgApi(cfg.token, 'deleteWebhook').catch(() => {});
    db.prepare("DELETE FROM entities WHERE entity_type='telegram_config' AND farm_id=?").run(user.current_farm_id);
  }
  res.json({ success: true });
});

// POST /api/telegram/generate-link-code — user generates a code to link their TG
app.post('/api/telegram/generate-link-code', authMiddleware, (req, res) => {
  const code = Math.random().toString(36).slice(2, 8).toUpperCase();
  _tgLinkCodes.set(code, { user_id: req.user.id, expires: Date.now() + 10 * 60 * 1000 });
  for (const [k, v] of _tgLinkCodes) if (v.expires < Date.now()) _tgLinkCodes.delete(k);
  res.json({ code, expires_in: 600 });
});

// POST /api/telegram/webhook — Telegram pushes updates here (no auth, verified by secret header)
app.post('/api/telegram/webhook', (req, res) => {
  res.sendStatus(200); // ack immediately
  const secret = req.headers['x-telegram-bot-api-secret-token'];
  if (!secret) return;

  const allCfgs = db.prepare("SELECT data, farm_id FROM entities WHERE entity_type='telegram_config'").all();
  const match   = allCfgs.find(r => { try { return JSON.parse(r.data).webhook_secret === secret; } catch { return false; } });
  if (!match) return;

  const cfg    = JSON.parse(match.data);
  const farmId = match.farm_id;
  const msg    = req.body?.message;
  if (!msg?.text) return;

  setImmediate(() => tgHandleMessage(cfg, farmId, msg));
});

async function tgHandleMessage(cfg, farmId, msg) {
  const chatId = msg.chat.id;
  const text   = msg.text.trim();
  const tgFrom = msg.from;
  console.log(`[TG] from ${tgFrom.first_name}(${tgFrom.id}) farm=${farmId}: ${text}`);

  // Find linked Farm Flow user
  const linked = db.prepare('SELECT * FROM users WHERE telegram_chat_id=?').get(String(chatId));

  // /start
  if (text === '/start' || text === '/התחל') {
    const name = tgFrom.first_name || 'שם';
    await tgSend(cfg.token, chatId,
      `שלום ${name}! 🌱 אני הבוט של המשק.\n\n` +
      `כדי להתחבר למערכת:\n` +
      `1. היכנס ל-Farm Flow → הגדרות → טלגרם\n` +
      `2. לחץ "צור קוד חיבור"\n` +
      `3. שלח לי: /link XXXXXX`
    );
    return;
  }

  // /link CODE
  if (text.startsWith('/link ') || text.startsWith('/חבר ')) {
    const code = text.split(' ')[1]?.toUpperCase();
    const entry = code ? _tgLinkCodes.get(code) : null;
    if (!entry || entry.expires < Date.now()) {
      await tgSend(cfg.token, chatId, '❌ קוד לא תקין או פג תוקף. צור קוד חדש ב-Farm Flow.');
      return;
    }
    _tgLinkCodes.delete(code);
    db.prepare('UPDATE users SET telegram_chat_id=?, telegram_username=? WHERE id=?')
      .run(String(chatId), tgFrom.username || '', entry.user_id);
    const u = db.prepare('SELECT full_name FROM users WHERE id=?').get(entry.user_id);
    await tgSend(cfg.token, chatId, `✅ חשבון מחובר בהצלחה!\nשלום ${u?.full_name || tgFrom.first_name}! 👋\nכעת תוכל לשאול שאלות על המשק.`);
    return;
  }

  if (!linked) {
    await tgSend(cfg.token, chatId, '⚠️ חשבון לא מחובר. שלח /start להוראות.');
    return;
  }

  // Natural language query via Groq
  await tgGroqQuery(cfg, farmId, chatId, linked, text);
}

async function tgGroqQuery(cfg, farmId, chatId, user, text) {
  const GROQ_KEY = getGroqApiKey();
  if (!GROQ_KEY) {
    await tgSend(cfg.token, chatId, '⚠️ GROQ_API_KEY לא מוגדר בשרת.');
    return;
  }

  const today = new Date().toISOString().slice(0, 10);

  // Helper: load all entities of a type for this farm, parse JSON data
  function fetchAll(type) {
    return db.prepare("SELECT id, data FROM entities WHERE entity_type=? AND farm_id=?").all(type, farmId)
      .map(r => { try { return { id: r.id, ...JSON.parse(r.data) }; } catch { return null; } })
      .filter(Boolean);
  }

  // ── Load farm data ──────────────────────────────────────────────────────────
  const varieties    = fetchAll('varieties');    // זנים
  const plots        = fetchAll('plots');        // חלקות
  const plotSeedings = fetchAll('plot_seedings');// קשר חלקה↔מזרע
  const seedings     = fetchAll('seedings');     // מזרעים
  const employees    = fetchAll('employees');    // עובדים
  const vehicles     = fetchAll('vehicles');     // כלי רכב
  const customers    = fetchAll('customers');    // לקוחות
  const crops        = fetchAll('crops');        // גידולים

  // Lookup maps
  const varietyMap = Object.fromEntries(varieties.map(v => [v.id, v.name]));
  const plotMap    = Object.fromEntries(plots.map(p => [p.id, p.name]));

  // seeding → plot names
  const seeding2plots = {};
  for (const ps of plotSeedings) {
    if (!seeding2plots[ps.seeding_id]) seeding2plots[ps.seeding_id] = [];
    const pname = plotMap[ps.plot_id];
    if (pname) seeding2plots[ps.seeding_id].push(pname);
  }

  // ── Recent harvests (60 days) ───────────────────────────────────────────────
  const cutoff60 = new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10);
  const recentHarvests = db.prepare(
    "SELECT data FROM entities WHERE entity_type='harvests' AND farm_id=? ORDER BY json_extract(data,'$.date') DESC LIMIT 100"
  ).all(farmId)
    .map(r => { try { return JSON.parse(r.data); } catch { return null; } })
    .filter(r => r && r.date >= cutoff60);

  // Aggregate by variety
  const hvByVariety = {};
  for (const h of recentHarvests) {
    const key = h.variety || 'לא ידוע';
    if (!hvByVariety[key]) hvByVariety[key] = { weight: 0, packages: 0, count: 0 };
    hvByVariety[key].weight   += (h.weight || 0);
    hvByVariety[key].packages += (h.package_count || 0);
    hvByVariety[key].count++;
  }
  const harvestsText = Object.entries(hvByVariety).length
    ? Object.entries(hvByVariety).map(([v, s]) =>
        `  • ${v}: ${s.weight.toLocaleString()}ק"ג | ${s.count} קטיפות | ${s.packages} קרטונות`
      ).join('\n')
    : '  אין קטיפות ב-60 הימים האחרונים';

  // ── Recent sprayings (30 days) ──────────────────────────────────────────────
  const cutoff30 = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const recentSprayings = db.prepare(
    "SELECT data FROM entities WHERE entity_type='sprayings' AND farm_id=? ORDER BY json_extract(data,'$.date') DESC LIMIT 50"
  ).all(farmId)
    .map(r => { try { return JSON.parse(r.data); } catch { return null; } })
    .filter(r => r && r.date >= cutoff30);

  const sprayingsText = recentSprayings.length
    ? recentSprayings.map(s => {
        const pests = (s.applied_pesticides || []).map(p => p.pesticide_name).join(', ');
        const seed  = seedings.find(sd => sd.id === s.seeding_id);
        return `  • ${s.date} | ${seed?.name || '?'} | ${pests}`;
      }).join('\n')
    : '  אין ריסוסים ב-30 הימים האחרונים';

  // ── Format seedings ─────────────────────────────────────────────────────────
  const seedingsText = seedings.map(s => {
    const varNames = (s.varieties || []).map(v => varietyMap[v.variety_id] || '?').join(', ');
    const plotNames = (seeding2plots[s.id] || []).join(', ');
    const totalQty  = (s.varieties || []).reduce((sum, v) => sum + (v.seedling_quantity || 0), 0);
    return (
      `• ${s.name}\n` +
      `  גידול: ${s.crop_type} | זנים: ${varNames}\n` +
      `  חלקה: ${plotNames || 'לא שויך'} | שטח: ${s.total_area || '?'} דונם\n` +
      `  שתילה: ${s.planting_date || '?'} | קטיף ראשון: ${s.first_harvest_date || '?'} | סיום: ${s.end_date || s.estimated_end_date || '?'}\n` +
      `  כמות שתילים: ${totalQty.toLocaleString()} | סטטוס: ${s.status || '?'}`
    );
  }).join('\n\n') || 'אין מזרעים';

  // ── Build system prompt ─────────────────────────────────────────────────────
  const systemPrompt = [
    `אתה עוזר חכם של משק חקלאי. ענה תמיד בעברית, קצר, ברור וידידותי.`,
    `תאריך היום: ${today} | שם המשתמש: ${user.full_name}`,
    ``,
    `══ מזרעים פעילים (${seedings.length}) ══`,
    seedingsText,
    ``,
    `══ זנים רשומים (${varieties.length}) ══`,
    varieties.map(v => `• ${v.name} — ${v.crop_type}${v.marketing_company ? ' | ' + v.marketing_company : ''}`).join('\n') || 'אין',
    ``,
    `══ חלקות (${plots.length}) ══`,
    plots.map(p => `• ${p.name} | ${p.size} דונם | ${p.structure_type === 'greenhouse' ? 'חממה' : p.structure_type} | ${p.activity_status === 'active' ? 'פעיל' : 'לא פעיל'}`).join('\n') || 'אין',
    ``,
    `══ גידולים (${crops.length}) ══`,
    crops.map(c => c.name).join(', ') || 'אין',
    ``,
    `══ קטיפות — 60 ימים אחרונים ══`,
    harvestsText,
    ``,
    `══ ריסוסים — 30 ימים אחרונים ══`,
    sprayingsText,
    ``,
    `══ עובדים (${employees.length}) ══`,
    employees.length
      ? employees.map(e => `• ${e.first_name} ${e.last_name}${e.role ? ' | ' + e.role : ''}${e.nationality ? ' | ' + e.nationality : ''}`).join('\n')
      : 'אין עובדים רשומים',
    ``,
    `══ כלי רכב (${vehicles.length}) ══`,
    vehicles.length
      ? vehicles.map(v => `• ${v.make} ${v.model} ${v.license_plate || ''}`.trim()).join('\n')
      : 'אין',
    ``,
    `══ לקוחות ══`,
    customers.map(c => c.name).join(', ') || 'אין',
    ``,
    `ענה על שאלות על המשק, חשב כמויות וסיכומים, עזור לתכנן.`,
    `אם חסר מידע ענה מה ידוע ואמור שאינך יודע את השאר.`,
  ].join('\n');

  const body = JSON.stringify({
    model: 'llama-3.3-70b-versatile',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: text }
    ],
    max_tokens: 500,
    temperature: 0.3
  });

  try {
    const r = await httpsRequest({
      hostname: 'api.groq.com',
      path: '/openai/v1/chat/completions',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, body);

    if (r.status === 200) {
      const reply = JSON.parse(r.body)?.choices?.[0]?.message?.content || 'אין תשובה';
      await tgSend(cfg.token, chatId, reply);
    } else {
      console.error('[TG/Groq]', r.status, r.body.slice(0, 200));
      await tgSend(cfg.token, chatId, '❌ שגיאה זמנית. נסה שוב.');
    }
  } catch (err) {
    console.error('[TG/Groq]', String(err));
    await tgSend(cfg.token, chatId, '❌ שגיאת חיבור לשרת.');
  }
}

// ─── PUSR / MODBUS SENSOR SCANNER ─────────────────────────────────────────────
// (defined here — BEFORE generic /api/:entity routes to avoid route collision)

/** Modbus CRC-16 (polynomial 0xA001) */
function modbusCRC(buf) {
  let crc = 0xFFFF;
  for (const b of buf) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = (crc & 1) ? ((crc >>> 1) ^ 0xA001) : (crc >>> 1);
  }
  return crc;
}

/** Build Modbus RTU FC03 Read Holding Registers frame */
function modbusFC03(addr, regStart, count) {
  const pdu = Buffer.from([addr, 0x03, regStart >> 8, regStart & 0xFF, count >> 8, count & 0xFF]);
  const crc = modbusCRC(pdu);
  return Buffer.concat([pdu, Buffer.from([crc & 0xFF, crc >> 8])]);
}

/**
 * Open ONE TCP connection to PUSR gateway and probe Modbus addresses sequentially.
 * Each address gets up to timeoutMs ms before we move on (marks as not connected).
 */
function scanModbus(host, port, startAddr, endAddr, timeoutMs = 400) {
  return new Promise((resolve) => {
    const total = endAddr - startAddr + 1;
    const results = Array.from({ length: total }, (_, i) => ({ address: startAddr + i, connected: false, registers: [] }));

    const socket = new net.Socket();
    let idx = 0;
    let rxBuf = Buffer.alloc(0);
    let timer = null;
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(results);
    };

    const sendNext = () => {
      if (idx >= total) { finish(); return; }
      rxBuf = Buffer.alloc(0);
      const addr = startAddr + idx;
      try { socket.write(modbusFC03(addr, 0, 5)); } catch { finish(); return; }
      timer = setTimeout(() => { idx++; sendNext(); }, timeoutMs);
    };

    socket.setTimeout(timeoutMs * total + 3000);
    socket.on('connect', sendNext);

    socket.on('data', (chunk) => {
      rxBuf = Buffer.concat([rxBuf, chunk]);
      const addr = startAddr + idx;
      if (rxBuf.length < 2 || rxBuf[0] !== addr) return;

      if (rxBuf[1] === 0x03 && rxBuf.length >= 3) {
        const need = 3 + rxBuf[2] + 2;
        if (rxBuf.length < need) return;
        clearTimeout(timer);
        const regs = [];
        for (let r = 0; r < rxBuf[2] / 2; r++) regs.push(rxBuf.readUInt16BE(3 + r * 2));
        results[idx] = { address: addr, connected: true, registers: regs };
        idx++;
        setTimeout(sendNext, 30);
      } else if (rxBuf[1] & 0x80) {
        clearTimeout(timer);
        results[idx] = { address: addr, connected: true, registers: [], exception: rxBuf[2] };
        idx++;
        setTimeout(sendNext, 30);
      }
    });

    socket.on('timeout', finish);
    socket.on('error', (err) => { console.error('[PUSR] TCP error:', err.message); finish(); });
    socket.on('close', finish);
    socket.connect(parseInt(port), host);
  });
}

// POST /api/sensors/scan
app.post('/api/sensors/scan', authMiddleware, async (req, res) => {
  const { host, port = 8899, start_addr = 1, end_addr = 16 } = req.body;
  if (!host) return res.status(400).json({ error: 'host חסר' });
  const p = parseInt(port), sa = parseInt(start_addr), ea = parseInt(end_addr);
  if (isNaN(p) || p < 1 || p > 65535) return res.status(400).json({ error: 'port לא תקין' });
  if (isNaN(sa) || isNaN(ea) || sa < 1 || ea > 247 || ea < sa) return res.status(400).json({ error: 'טווח כתובות לא תקין' });
  if (ea - sa > 50) return res.status(400).json({ error: 'טווח כתובות גדול מדי (מקסימום 50)' });
  console.log(`[PUSR] scan ${host}:${p} addrs ${sa}-${ea}`);
  try {
    const results = await scanModbus(host, p, sa, ea);
    const connected = results.filter(r => r.connected);
    console.log(`[PUSR] done: ${connected.length}/${results.length} connected`);
    res.json({ success: true, results, connected_count: connected.length });
  } catch (err) {
    console.error('[PUSR] scan error:', String(err));
    res.status(500).json({ error: 'שגיאת סריקה: ' + String(err.message || err) });
  }
});

// GET /api/sensors/config
app.get('/api/sensors/config', authMiddleware, (req, res) => {
  const row = db.prepare("SELECT data FROM entities WHERE entity_type = 'pusr_config' LIMIT 1").get();
  res.json(row ? JSON.parse(row.data) : { host: '', port: 8899, start_addr: 1, end_addr: 16, sensors: [] });
});

// POST /api/sensors/config
app.post('/api/sensors/config', authMiddleware, (req, res) => {
  const { host = '', port = 8899, start_addr = 1, end_addr = 16, sensors = [] } = req.body;
  const cfg = { host, port: parseInt(port) || 8899, start_addr: parseInt(start_addr) || 1, end_addr: parseInt(end_addr) || 16, sensors };
  const existing = db.prepare("SELECT id FROM entities WHERE entity_type = 'pusr_config' LIMIT 1").get();
  if (existing) {
    db.prepare("UPDATE entities SET data=?, updated_at=? WHERE entity_type='pusr_config' AND id=?")
      .run(JSON.stringify(cfg), NOW(), existing.id);
  } else {
    db.prepare("INSERT INTO entities (id, entity_type, data, created_at, updated_at) VALUES (?, 'pusr_config', ?, ?, ?)")
      .run(uuidv4(), JSON.stringify(cfg), NOW(), NOW());
  }
  res.json({ success: true, config: cfg });
});

// ─── ATTENDANCE / TIME-CLOCK ──────────────────────────────────────────────────
// Machine-to-machine sync from the JB-Clock Python bridge (see farmflow_sync.py).
// Data is stored as generic entities: `attendance_records` (per worker per day) and
// `clock_workers` (active-worker registry, mirrors the old active_workers.json).
function attendanceApiAuth(req, res, next) {
  const key = req.headers['x-api-key'];
  const expected = getAttendanceApiKey({ create: false });
  if (!expected || !key || key !== expected) {
    return res.status(401).json({ error: 'Invalid or missing x-api-key' });
  }
  next();
}

app.post('/api/attendance/sync', attendanceApiAuth, (req, res) => {
  const { farm_id, as_of, workers = {}, records = [] } = req.body || {};
  if (!farm_id) return res.status(400).json({ error: 'farm_id required' });
  const farm = db.prepare("SELECT id FROM entities WHERE entity_type = 'farms' AND id = ?").get(farm_id);
  if (!farm) return res.status(400).json({ error: 'Unknown farm_id' });

  const asOfDate = (as_of && String(as_of).slice(0, 10)) || NOW().slice(0, 10);
  const now = NOW();
  const upsert = db.prepare('INSERT OR REPLACE INTO entities (id, entity_type, farm_id, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)');

  const nameByWorker = {};
  for (const [k, v] of Object.entries(workers)) nameByWorker[String(k)] = v;
  const lastSeenByWorker = {};
  let recCount = 0;

  const tx = db.transaction(() => {
    // 1. Per-worker-per-day records — deterministic id makes re-sync idempotent.
    for (const r of records) {
      const wid = String(r.time_clock_id || '').trim();
      const date = String(r.date || '').slice(0, 10);
      if (!wid || !date) continue;
      const name = r.name || nameByWorker[wid] || '';
      if (name) nameByWorker[wid] = name;
      const data = {
        time_clock_id: wid,
        name,
        date,
        first_in: r.first_in || null,
        last_out: r.last_out || null,
        hours: typeof r.hours === 'number' ? r.hours : (parseFloat(r.hours) || 0),
        punches: Array.isArray(r.punches) ? r.punches : [],
        complete: r.complete !== false,
      };
      upsert.run(`att_${farm_id}_${wid}_${date}`, 'attendance_records', farm_id, JSON.stringify(data), now, now);
      recCount++;
      if (!lastSeenByWorker[wid] || date > lastSeenByWorker[wid]) lastSeenByWorker[wid] = date;
    }

    // 2. Active-worker registry = the monitored base roster. Only workers who have
    //    actually clocked in belong here — names-only entries from the device list are
    //    ignored. A worker who clocks in for the first time is auto-added; previously
    //    tracked workers are refreshed. The manual employee link and an admin removal
    //    (monitored=false) are preserved across syncs.
    const existingWorkerRows = db.prepare("SELECT id, data, created_at FROM entities WHERE entity_type='clock_workers' AND farm_id=?").all(farm_id);
    const existingByWid = {};
    for (const r of existingWorkerRows) {
      try { const d = JSON.parse(r.data || '{}'); if (d.time_clock_id) existingByWid[String(d.time_clock_id)] = { ...d, _created: r.created_at }; } catch { /* skip */ }
    }
    const registryIds = new Set([...Object.keys(lastSeenByWorker), ...Object.keys(existingByWid)]);
    for (const wid of registryIds) {
      const cwId = `cw_${farm_id}_${wid}`;
      const existing = existingByWid[wid] || {};
      const lastSeen = [existing.last_seen, lastSeenByWorker[wid]].filter(Boolean).sort().pop() || null;
      const absentDays = lastSeen ? Math.round((Date.parse(asOfDate) - Date.parse(lastSeen)) / 86400000) : null;
      const data = {
        time_clock_id: wid,
        name: nameByWorker[wid] || existing.name || '',
        last_seen: lastSeen,
        absent_days: absentDays,
        status: absentDays === 0 ? 'present' : 'absent',
        employee_id: existing.employee_id || null,
        // Everyone in the registry has clocked in at least once → in the base roster,
        // unless an admin explicitly removed them.
        monitored: existing.monitored !== false,
      };
      upsert.run(cwId, 'clock_workers', farm_id, JSON.stringify(data), existing._created || now, now);
    }
  });
  tx();

  res.json({ success: true, synced_records: recCount, workers: Object.keys(nameByWorker).length, as_of: asOfDate });
});

// Admin: view / rotate the attendance sync API key (shown in Settings).
app.get('/api/attendance/apikey', authMiddleware, adminMiddleware, (req, res) => {
  res.json({ api_key: getAttendanceApiKey(), sync_path: '/api/attendance/sync' });
});
app.post('/api/attendance/apikey', authMiddleware, adminMiddleware, (req, res) => {
  const key = 'attn_' + crypto.randomBytes(24).toString('hex');
  db.prepare('INSERT OR REPLACE INTO system_settings (key, value, updated_at) VALUES (?, ?, ?)').run('attendance_api_key', key, NOW());
  res.json({ api_key: key });
});

// ─── ATTENDANCE ABSENCE ALERTS ────────────────────────────────────────────────
// A per-farm scheduled check that flags monitored clock workers with no punch-in
// today and pushes an in-app notification and/or Telegram message to managers.
const ATTN_ALERT_TZ = 'Asia/Jerusalem';
const ATTN_ALERT_DEFAULTS = {
  enabled: false,
  check_time: '09:00',          // HH:MM local (ATTN_ALERT_TZ)
  work_days: [0, 1, 2, 3, 4],   // 0=Sun … 6=Sat (Israel work week Sun–Thu)
  channel_in_app: true,
  channel_telegram: false,
  last_run_date: null,          // YYYY-MM-DD guard so it fires once per day
  last_run_at: null,
  last_absentees: [],
};

// Current wall-clock in the alert timezone → { date:'YYYY-MM-DD', time:'HH:MM', dow:0-6 }
function attnNow() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: ATTN_ALERT_TZ, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date()).reduce((a, p) => (a[p.type] = p.value, a), {});
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const hour = parts.hour === '24' ? '00' : parts.hour; // some engines emit 24 at midnight
  const time = `${hour}:${parts.minute}`;
  const dow = new Date(`${date}T12:00:00Z`).getUTCDay(); // noon-UTC avoids DST edges
  return { date, time, dow };
}

function getAttnAlertConfig(farmId) {
  const row = db.prepare("SELECT id, data FROM entities WHERE entity_type='attendance_alert_config' AND farm_id=? LIMIT 1").get(farmId);
  let stored = {};
  if (row) { try { stored = JSON.parse(row.data || '{}'); } catch { stored = {}; } }
  return { id: row?.id || null, ...ATTN_ALERT_DEFAULTS, ...stored };
}

function saveAttnAlertConfig(farmId, cfg) {
  const { id, ...data } = cfg;
  const now = NOW();
  const row = db.prepare("SELECT id FROM entities WHERE entity_type='attendance_alert_config' AND farm_id=? LIMIT 1").get(farmId);
  if (row) {
    db.prepare("UPDATE entities SET data=?, updated_at=? WHERE id=?").run(JSON.stringify(data), now, row.id);
  } else {
    db.prepare("INSERT INTO entities (id, entity_type, farm_id, data, created_at, updated_at) VALUES (?,?,?,?,?,?)")
      .run(`attn_alert_${farmId}`, 'attendance_alert_config', farmId, JSON.stringify(data), now, now);
  }
}

// Compute who is monitored but has no punch-in for today (in ATTN_ALERT_TZ).
function runAttendanceAbsenceCheck(farmId) {
  const { date: today } = attnNow();
  const workerRows = db.prepare("SELECT data FROM entities WHERE entity_type='clock_workers' AND farm_id=?").all(farmId);
  const monitored = [];
  for (const r of workerRows) {
    let w; try { w = JSON.parse(r.data || '{}'); } catch { continue; }
    if (w.monitored === false || !w.time_clock_id) continue;
    monitored.push(w);
  }
  const absentees = [];
  for (const w of monitored) {
    const rid = `att_${farmId}_${String(w.time_clock_id)}_${today}`;
    const rec = db.prepare("SELECT data FROM entities WHERE entity_type='attendance_records' AND id=?").get(rid);
    let present = false;
    if (rec) { try { present = !!JSON.parse(rec.data || '{}').first_in; } catch { present = false; } }
    if (!present) absentees.push({ time_clock_id: w.time_clock_id, name: w.name || `#${w.time_clock_id}`, employee_id: w.employee_id || null });
  }
  return { today, absentees, monitored: monitored.length, present: monitored.length - absentees.length };
}

// Push the absence alert over the configured channels. Returns a delivery summary.
async function dispatchAbsenceAlert(farmId, cfg, absentees, today) {
  if (!absentees.length) return { in_app: false, telegram: 0 };
  const names = absentees.map(a => a.name).join(', ');
  const title = absentees.length === 1 ? 'עובד לא הגיע היום' : `${absentees.length} עובדים לא הגיעו היום`;
  const body = `נכון ל-${today}: ${names}`;
  let inApp = false, tg = 0;

  if (cfg.channel_in_app) {
    db.prepare('INSERT INTO notifications (id, recipient_id, farm_id, title, body, type, sent_by, created_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(uuidv4(), null, farmId, title, body, 'warning', null, NOW());
    inApp = true;
  }

  if (cfg.channel_telegram) {
    const tgCfg = tgGetConfig(farmId);
    if (tgCfg?.token) {
      const chats = db.prepare(
        "SELECT DISTINCT u.telegram_chat_id AS cid FROM farm_members fm JOIN users u ON u.id=fm.user_id " +
        "WHERE fm.farm_id=? AND fm.role IN ('owner','manager') AND u.telegram_chat_id IS NOT NULL AND u.telegram_chat_id != ''"
      ).all(farmId);
      for (const c of chats) {
        try { await tgSend(tgCfg.token, c.cid, `⚠️ <b>${title}</b>\n${body}`); tg++; }
        catch (err) { console.error('[attn-alert] telegram send failed:', String(err?.message || err)); }
      }
    }
  }
  return { in_app: inApp, telegram: tg };
}

// Scheduler: once a minute, fire each enabled farm's check when its time arrives.
let attnAlertRunning = false;
async function attendanceAlertTick() {
  if (attnAlertRunning) return;
  attnAlertRunning = true;
  try {
    const { date: today, time, dow } = attnNow();
    const rows = db.prepare("SELECT farm_id, data FROM entities WHERE entity_type='attendance_alert_config'").all();
    for (const row of rows) {
      let cfg; try { cfg = JSON.parse(row.data || '{}'); } catch { continue; }
      if (!cfg.enabled) continue;
      if (!Array.isArray(cfg.work_days) || !cfg.work_days.includes(dow)) continue;
      if (cfg.last_run_date === today) continue;                 // already ran today
      if ((cfg.check_time || '09:00') > time) continue;          // not yet (HH:MM lexicographic)
      try {
        const { absentees } = runAttendanceAbsenceCheck(row.farm_id);
        const res = await dispatchAbsenceAlert(row.farm_id, cfg, absentees, today);
        const full = { ...getAttnAlertConfig(row.farm_id), ...cfg, last_run_date: today, last_run_at: NOW(), last_absentees: absentees.map(a => a.name) };
        saveAttnAlertConfig(row.farm_id, full);
        console.log(`[attn-alert] farm=${row.farm_id} absentees=${absentees.length} inApp=${res.in_app} tg=${res.telegram}`);
      } catch (err) {
        console.error(`[attn-alert] farm=${row.farm_id} failed:`, String(err?.message || err));
      }
    }
  } finally {
    attnAlertRunning = false;
  }
}
setInterval(attendanceAlertTick, 60 * 1000);
console.log(`[attn-alert] scheduler enabled (tick=60s, tz=${ATTN_ALERT_TZ})`);

// ─── UPLOADS CLEANUP ──────────────────────────────────────────────────────────
// מוחק קבצים ב-uploads שאינם מקושרים לאף רשומה (file_url/pdf_url/photo_url/...)
// ומבוגרים מ-maxAgeDays — כדי שהדיסק לא יתמלא מעותקי PDF/קבצים מהמייל לאורך זמן.
// קבצים מקושרים נשמרים תמיד, ללא תלות בגיל.
function cleanupOldUploads({ maxAgeDays = 14, dryRun = false } = {}) {
  const referenced = new Set();
  try {
    const rows = db.prepare('SELECT data FROM entities').all();
    const re = /\/uploads\/([A-Za-z0-9._-]+)/g;
    for (const r of rows) {
      const s = r.data || '';
      let m;
      while ((m = re.exec(s)) !== null) referenced.add(m[1]);
    }
  } catch (e) {
    console.error('[uploads-cleanup] reference scan failed:', e.message);
    return { error: e.message };
  }
  const cutoff = Date.now() - maxAgeDays * 86400000;
  let deleted = 0, freed = 0, keptReferenced = 0, skippedYoung = 0;
  let files = [];
  try { files = fs.readdirSync(UPLOADS_DIR); } catch { return { deleted: 0, freed_bytes: 0 }; }
  for (const f of files) {
    if (referenced.has(f)) { keptReferenced++; continue; }
    const fp = path.join(UPLOADS_DIR, f);
    let st;
    try { st = fs.statSync(fp); } catch { continue; }
    if (!st.isFile()) continue;
    if (st.mtimeMs > cutoff) { skippedYoung++; continue; } // טרי מדי — אולי בתהליך העלאה
    if (!dryRun) { try { fs.unlinkSync(fp); } catch { continue; } }
    deleted++; freed += st.size;
  }
  console.log(`[uploads-cleanup]${dryRun ? ' (dry-run)' : ''} deleted=${deleted} freed=${(freed / 1048576).toFixed(1)}MB kept(referenced)=${keptReferenced} skipped(young)=${skippedYoung}`);
  return { deleted, freed_bytes: freed, kept_referenced: keptReferenced, skipped_young: skippedYoung };
}
// ניקוי אוטומטי: דקה אחרי עלייה, ואז כל 24 שעות.
setTimeout(() => cleanupOldUploads(), 60 * 1000);
setInterval(() => cleanupOldUploads(), 24 * 60 * 60 * 1000);
console.log('[uploads-cleanup] scheduler enabled (daily, keeps referenced + files newer than 14d)');

// אדמין: הרצת ניקוי ידנית (כפתור בפאנל). dry_run=true למניין בלבד.
app.post('/api/admin/cleanup-uploads', authMiddleware, adminMiddleware, (req, res) => {
  const result = cleanupOldUploads({
    maxAgeDays: Number(req.body?.max_age_days) || 14,
    dryRun: !!req.body?.dry_run,
  });
  if (result.error) return res.status(500).json({ success: false, error: result.error });
  res.json({ success: true, ...result });
});

// Admin / farm owner-manager may configure and trigger absence alerts.
function canManageFarmAlerts(req, farmId) {
  const user = getUser(req.user.id);
  if (!user) return false;
  if (user.is_admin) return true;
  const m = getFarmMember(farmId, req.user.id);
  return !!(m && ['owner', 'manager'].includes(m.role));
}

app.get('/api/attendance/alert-config', authMiddleware, (req, res) => {
  const farmId = req.query.farm_id || getUser(req.user.id)?.current_farm_id;
  if (!farmId) return res.status(400).json({ error: 'No farm selected' });
  if (!canManageFarmAlerts(req, farmId)) return res.status(403).json({ error: 'Forbidden' });
  res.json(getAttnAlertConfig(farmId));
});

app.post('/api/attendance/alert-config', authMiddleware, (req, res) => {
  const b = req.body || {};
  const farmId = b.farm_id || getUser(req.user.id)?.current_farm_id;
  if (!farmId) return res.status(400).json({ error: 'No farm selected' });
  if (!canManageFarmAlerts(req, farmId)) return res.status(403).json({ error: 'Forbidden' });
  const cur = getAttnAlertConfig(farmId);
  const cfg = {
    enabled: !!b.enabled,
    check_time: /^([01]\d|2[0-3]):[0-5]\d$/.test(b.check_time) ? b.check_time : cur.check_time,
    work_days: Array.isArray(b.work_days) ? [...new Set(b.work_days.map(Number).filter(d => d >= 0 && d <= 6))].sort() : cur.work_days,
    channel_in_app: b.channel_in_app !== false,
    channel_telegram: !!b.channel_telegram,
    last_run_date: cur.last_run_date,
    last_run_at: cur.last_run_at,
    last_absentees: cur.last_absentees,
  };
  saveAttnAlertConfig(farmId, cfg);
  res.json(getAttnAlertConfig(farmId));
});

// Run the check on demand (UI "בדוק עכשיו"). notify=true also dispatches the alert.
app.post('/api/attendance/check-absences', authMiddleware, async (req, res) => {
  const farmId = req.body?.farm_id || getUser(req.user.id)?.current_farm_id;
  if (!farmId) return res.status(400).json({ error: 'No farm selected' });
  if (!canManageFarmAlerts(req, farmId)) return res.status(403).json({ error: 'Forbidden' });
  const cfg = getAttnAlertConfig(farmId);
  const result = runAttendanceAbsenceCheck(farmId);
  let dispatched = { in_app: false, telegram: 0 };
  if (req.body?.notify) dispatched = await dispatchAbsenceAlert(farmId, cfg, result.absentees, result.today);
  res.json({ ...result, dispatched });
});

// Reset the monitored base roster: drop all clock_workers for the farm and rebuild
// it from the workers that actually appear in attendance_records (i.e. clocked in).
// Existing employee links and admin removals are preserved by time_clock_id.
app.post('/api/attendance/rebuild-roster', authMiddleware, (req, res) => {
  const farmId = req.body?.farm_id || getUser(req.user.id)?.current_farm_id;
  if (!farmId) return res.status(400).json({ error: 'No farm selected' });
  if (!canManageFarmAlerts(req, farmId)) return res.status(403).json({ error: 'Forbidden' });

  // Carry over per-worker manual settings before we delete the rows.
  const prev = {};
  for (const r of db.prepare("SELECT data FROM entities WHERE entity_type='clock_workers' AND farm_id=?").all(farmId)) {
    try { const d = JSON.parse(r.data || '{}'); if (d.time_clock_id) prev[String(d.time_clock_id)] = d; } catch { /* skip */ }
  }

  // Aggregate clock-ins per worker from the attendance records already in the DB.
  const agg = {}; // wid → { name, last_seen }
  for (const r of db.prepare("SELECT data FROM entities WHERE entity_type='attendance_records' AND farm_id=?").all(farmId)) {
    let d; try { d = JSON.parse(r.data || '{}'); } catch { continue; }
    const wid = String(d.time_clock_id || '').trim();
    const date = String(d.date || '').slice(0, 10);
    if (!wid || !date || !d.first_in) continue; // only real clock-ins
    if (!agg[wid]) agg[wid] = { name: d.name || '', last_seen: date };
    if (d.name) agg[wid].name = d.name;
    if (date > agg[wid].last_seen) agg[wid].last_seen = date;
  }

  const today = attnNow().date;
  const now = NOW();
  const upsert = db.prepare('INSERT OR REPLACE INTO entities (id, entity_type, farm_id, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)');
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM entities WHERE entity_type='clock_workers' AND farm_id=?").run(farmId);
    for (const [wid, info] of Object.entries(agg)) {
      const p = prev[wid] || {};
      const absentDays = Math.round((Date.parse(today) - Date.parse(info.last_seen)) / 86400000);
      const data = {
        time_clock_id: wid,
        name: info.name || p.name || '',
        last_seen: info.last_seen,
        absent_days: absentDays,
        status: absentDays === 0 ? 'present' : 'absent',
        employee_id: p.employee_id || null,
        monitored: p.monitored !== false,
      };
      upsert.run(`cw_${farmId}_${wid}`, 'clock_workers', farmId, JSON.stringify(data), now, now);
    }
  });
  tx();

  res.json({ success: true, roster: Object.keys(agg).length });
});

// Normalized name key: ASCII letters only, upper-cased, words sorted — so word order
// ("LAST FIRST" vs "First Last") and stray non-latin chars don't block a match.
function normNameKey(s) {
  return String(s || '')
    .toUpperCase()
    .replace(/[^A-Z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(' ');
}

// Auto-link clock workers to employees by matching normalized names. Only a unique
// exact match is linked (precision over recall); the matched clock id is written back
// onto the employee so the link becomes deterministic. dry_run previews without writing.
app.post('/api/attendance/auto-link', authMiddleware, (req, res) => {
  const farmId = req.body?.farm_id || getUser(req.user.id)?.current_farm_id;
  if (!farmId) return res.status(400).json({ error: 'No farm selected' });
  if (!canManageFarmAlerts(req, farmId)) return res.status(403).json({ error: 'Forbidden' });
  const dryRun = !!req.body?.dry_run;

  const employees = db.prepare("SELECT id, data FROM entities WHERE entity_type='employees' AND farm_id=?").all(farmId)
    .map(r => { try { return { id: r.id, ...JSON.parse(r.data || '{}') }; } catch { return null; } })
    .filter(Boolean);
  const byKey = {};   // normalized name → employees
  const byTcid = {};  // employee time_clock_id → employees (deterministic key)
  for (const e of employees) {
    const key = normNameKey(e.full_name || `${e.first_name || ''} ${e.last_name || ''}`);
    if (key) (byKey[key] = byKey[key] || []).push(e);
    const t = String(e.time_clock_id || '').trim();
    if (t) (byTcid[t] = byTcid[t] || []).push(e);
  }
  const empLabel = (e) => (e.full_name || `${e.first_name || ''} ${e.last_name || ''}`).trim();

  const cwRows = db.prepare("SELECT id, data FROM entities WHERE entity_type='clock_workers' AND farm_id=?").all(farmId);
  const linked = [], ambiguous = [], unmatched = [], alreadyLinked = [];
  const now = NOW();
  const linkWorker = (rowId, w, emp) => {
    db.prepare("UPDATE entities SET data=?, updated_at=? WHERE entity_type='clock_workers' AND id=?")
      .run(JSON.stringify({ ...w, employee_id: emp.id }), now, rowId);
  };
  const backfillEmpTcid = (emp, tcid) => {
    if (String(emp.time_clock_id || '').trim()) return;
    const eRow = db.prepare("SELECT data FROM entities WHERE entity_type='employees' AND id=?").get(emp.id);
    if (!eRow) return;
    const eData = { ...JSON.parse(eRow.data || '{}'), time_clock_id: String(tcid) };
    db.prepare("UPDATE entities SET data=?, updated_at=? WHERE entity_type='employees' AND id=?").run(JSON.stringify(eData), now, emp.id);
  };
  const tx = db.transaction(() => {
    for (const r of cwRows) {
      let w; try { w = JSON.parse(r.data || '{}'); } catch { continue; }
      if (w.employee_id) { alreadyLinked.push({ time_clock_id: w.time_clock_id, name: w.name }); continue; }

      // 1) Deterministic: an employee already carries this clock number.
      const tcid = String(w.time_clock_id || '').trim();
      const byId = tcid ? (byTcid[tcid] || []) : [];
      if (byId.length === 1) {
        const emp = byId[0];
        linked.push({ time_clock_id: w.time_clock_id, name: w.name, employee_id: emp.id, employee_name: empLabel(emp), matched_by: 'clock_id' });
        if (!dryRun) linkWorker(r.id, w, emp);
        continue;
      }

      // 2) Fall back to a unique normalized-name match, then write the clock number
      //    onto that employee so it becomes deterministic next time.
      const key = normNameKey(w.name);
      const cands = key ? (byKey[key] || []) : [];
      if (cands.length === 1) {
        const emp = cands[0];
        linked.push({ time_clock_id: w.time_clock_id, name: w.name, employee_id: emp.id, employee_name: empLabel(emp), matched_by: 'name' });
        if (!dryRun) { linkWorker(r.id, w, emp); backfillEmpTcid(emp, w.time_clock_id); }
      } else if (cands.length > 1) {
        ambiguous.push({ time_clock_id: w.time_clock_id, name: w.name, candidates: cands.length });
      } else {
        unmatched.push({ time_clock_id: w.time_clock_id, name: w.name });
      }
    }
  });
  tx();

  res.json({
    dry_run: dryRun,
    linked, ambiguous, unmatched,
    counts: { linked: linked.length, ambiguous: ambiguous.length, unmatched: unmatched.length, already_linked: alreadyLinked.length },
  });
});

// One-time backfill of English entity names (name_en) for the field-worker UI.
// Translations are matched by the current Hebrew name; existing values are overwritten.
const NAME_EN_MAP = {
  seedings: {
    'עגבניה צרי שרביט לובלו': 'Cherry Tomato Sharbit Lovlo',
    'תות שדה גבי לביא': 'Strawberry Gabi Lavi',
    'תות שדה דני דרומית אודם': 'Strawberry Dani South Odem',
    'מלפפון לגלי מליון': 'Cucumber Legli Million',
    'עגבניה זינגר רם': 'Tomato Zinger Ram',
    'מלפפון שרביט ריף': 'Cucumber Sharbit Reef',
  },
  varieties: {
    'לובלו': 'Lovlo', 'מתן': 'Matan', 'תמוז': 'Tamuz', 'לביא': 'Lavi', 'אודם': 'Odem',
    'דורינה': 'Dorina', 'פלרמו': 'Palermo', 'סיקסטו': 'Sixto', 'רם': 'Ram', 'מליון': 'Million', 'ריף': 'Reef',
  },
  activity_types: {
    'הכנה': 'Preparation', 'חוטים': 'Wires', 'ליפוף': 'Wrapping', 'גיזום': 'Pruning',
  },
  crops: {
    'מלפפון': 'Cucumber', 'עגבניה': 'Tomato', 'פלפל': 'Pepper', 'תות שדה': 'Strawberry', 'עגבניה צרי': 'Cherry Tomato',
  },
};

app.post('/api/i18n/backfill-names', authMiddleware, (req, res) => {
  const farmId = req.body?.farm_id || getUser(req.user.id)?.current_farm_id;
  if (!farmId) return res.status(400).json({ error: 'No farm selected' });
  if (!canManageFarmAlerts(req, farmId)) return res.status(403).json({ error: 'Forbidden' });

  const now = NOW();
  let updated = 0;
  const byType = {};
  const tx = db.transaction(() => {
    for (const [type, map] of Object.entries(NAME_EN_MAP)) {
      byType[type] = 0;
      for (const r of db.prepare("SELECT id, data FROM entities WHERE entity_type=? AND farm_id=?").all(type, farmId)) {
        let d; try { d = JSON.parse(r.data || '{}'); } catch { continue; }
        const en = map[String(d.name || '').trim()];
        if (!en || d.name_en === en) continue;
        d.name_en = en;
        db.prepare("UPDATE entities SET data=?, updated_at=? WHERE entity_type=? AND id=?").run(JSON.stringify(d), now, type, r.id);
        updated++; byType[type]++;
      }
    }
  });
  tx();
  res.json({ success: true, updated, by_type: byType });
});

// ─── ENTITIES ─────────────────────────────────────────────────────────────────

// רשימת ישויות עם סינון/מיון/עימוד — משותף ל-GET /api/:entity ול-POST /api/batch
function listEntities(user, entity, query) {
  if (['admin', 'farm-members', 'notifications', 'sensors', 'telegram'].includes(entity)) return { status: 404, body: { error: 'Not found' } };
  if (!/^[a-z_]+$/.test(String(entity))) return { status: 400, body: { error: 'Bad entity' } };
  // Reserved query params are handled after loading, not as field filters
  const RESERVED = new Set(['sort', 'limit', 'offset']);
  const REAL_COLUMNS = new Set(['id', 'farm_id', 'created_at', 'updated_at']);
  const fieldFilters = Object.entries(query).filter(([k]) => !RESERVED.has(k));

  let rows;
  // Filters we couldn't push into SQL (exotic field names / non-string values) — applied in JS below
  let jsLeftover = [];

  if (entity === 'farms') {
    if (user.farm_ids.length === 0) return { status: 200, body: [] };
    const ph = user.farm_ids.map(() => '?').join(',');
    rows = db.prepare(`SELECT * FROM entities WHERE entity_type = ? AND id IN (${ph})`).all(entity, ...user.farm_ids);
    jsLeftover = fieldFilters; // tiny table — keep simple JS filtering as before
  } else if (entity === 'users') {
    rows = [];
  } else {
    // Build one SQL WHERE: farm scoping + field filters pushed down (was: load whole
    // table then filter every row in JS). All real-world filters are string-valued
    // (farm_id, status, *_id, date…), so json_extract(...) = ? matches the previous
    // String(x) === String(y) semantics exactly while staying index-friendly.
    const where = ['entity_type = ?'];
    const params = [entity];

    if (entity === 'pesticides') {
      // Shared catalog (farm_id IS NULL) + farm-specific custom entries
      if (user.farm_ids.length > 0) {
        const ph = user.farm_ids.map(() => '?').join(',');
        where.push(`(farm_id IS NULL OR farm_id IN (${ph}))`);
        params.push(...user.farm_ids);
      } else {
        where.push('farm_id IS NULL');
      }
    } else {
      if (user.farm_ids.length === 0) return { status: 200, body: [] };
      const ph = user.farm_ids.map(() => '?').join(',');
      where.push(`farm_id IN (${ph})`);
      params.push(...user.farm_ids);
    }

    for (const [key, val] of fieldFilters) {
      if (key === 'farm_id') {
        // Preserve prior quirk: only narrow when it's a farm the user can access
        if (user.farm_ids.includes(val)) { where.push('farm_id = ?'); params.push(val); }
      } else if (REAL_COLUMNS.has(key)) {
        where.push(`${key} = ?`);
        params.push(String(val));
      } else if (typeof val === 'string' && /^[a-zA-Z0-9_]+$/.test(key)) {
        where.push(`json_extract(data, '$.${key}') = ?`);
        params.push(val);
      } else {
        jsLeftover.push([key, val]); // e.g. {$in:...} objects or array params
      }
    }

    rows = db.prepare(`SELECT * FROM entities WHERE ${where.join(' AND ')}`).all(...params);
  }

  let result = rows.map(formatEntity);

  // Apply any filters that couldn't be pushed to SQL (same semantics as before)
  for (const [key, val] of jsLeftover) {
    if (key === 'farm_id') {
      if (user.farm_ids.includes(val)) result = result.filter(item => item.farm_id === val);
    } else {
      result = result.filter(item => String(item[key]) === String(val));
    }
  }

  // Optional sort: "field" (asc) or "-field" (desc). ISO date strings sort chronologically.
  const sort = query.sort;
  if (sort) {
    const desc = String(sort).startsWith('-');
    const field = desc ? String(sort).slice(1) : String(sort);
    result.sort((a, b) => {
      const av = a[field], bv = b[field];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;   // nulls last
      if (bv == null) return -1;
      if (av < bv) return desc ? 1 : -1;
      if (av > bv) return desc ? -1 : 1;
      return 0;
    });
  }

  // Optional pagination
  const limit = parseInt(query.limit, 10);
  if (Number.isFinite(limit) && limit > 0) {
    const offset = parseInt(query.offset, 10) || 0;
    result = result.slice(offset, offset + limit);
  }

  return { status: 200, body: result };
}

app.get('/api/:entity', authMiddleware, (req, res) => {
  const user = getUser(req.user.id);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const r = listEntities(user, req.params.entity, req.query);
  res.status(r.status).json(r.body);
});

// טעינה מרוכזת: כמה רשימות/רשומות בבקשת רשת אחת (כל סבב דרך Cloudflare עולה ~0.4 שנ')
// body: { requests: [{ entity, params? , id? }] } → { results: [ {ok:true,data} | {ok:false,error} ] }
app.post('/api/batch', authMiddleware, (req, res) => {
  const user = getUser(req.user.id);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const reqs = Array.isArray(req.body?.requests) ? req.body.requests : null;
  if (!reqs) return res.status(400).json({ error: 'requests[] required' });
  if (reqs.length > 25) return res.status(400).json({ error: 'Too many requests in batch (max 25)' });
  const results = reqs.map(q => {
    try {
      const entity = String(q?.entity || '');
      if (q?.id) {
        if (!/^[a-z_]+$/.test(entity)) return { ok: false, error: 'Bad entity' };
        const row = db.prepare('SELECT * FROM entities WHERE entity_type = ? AND id = ?').get(entity, String(q.id));
        if (!row) return { ok: false, error: 'Not found', status: 404 };
        if (entity === 'farms' && !user.farm_ids.includes(row.id)) return { ok: false, error: 'Forbidden', status: 403 };
        if (entity !== 'farms' && row.farm_id && !user.farm_ids.includes(row.farm_id)) return { ok: false, error: 'Forbidden', status: 403 };
        return { ok: true, data: formatEntity(row) };
      }
      const params = {};
      for (const [k, v] of Object.entries(q?.params || {})) if (v != null) params[k] = typeof v === 'object' ? v : String(v);
      const r = listEntities(user, entity, params);
      return r.status === 200 ? { ok: true, data: r.body } : { ok: false, error: r.body?.error || 'Error', status: r.status };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  res.json({ results });
});

app.get('/api/:entity/:id', authMiddleware, (req, res) => {
  const { entity, id } = req.params;
  const user = getUser(req.user.id);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const row = db.prepare('SELECT * FROM entities WHERE entity_type = ? AND id = ?').get(entity, id);
  if (!row) return res.status(404).json({ error: 'Not found' });

  if (entity === 'farms' && !user.farm_ids.includes(id)) return res.status(403).json({ error: 'Forbidden' });
  if (entity !== 'farms' && row.farm_id && !user.farm_ids.includes(row.farm_id)) return res.status(403).json({ error: 'Forbidden' });

  res.json(formatEntity(row));
});

app.post('/api/:entity', authMiddleware, (req, res) => {
  const { entity } = req.params;
  if (['admin', 'farm-members', 'notifications'].includes(entity)) return res.status(404).json({ error: 'Not found' });
  const user = getUser(req.user.id);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  // יצירה מרוכזת: גוף הבקשה הוא מערך → כל הרשומות נוצרות בטרנזקציה אחת (סבב רשת אחד)
  if (Array.isArray(req.body)) {
    if (entity === 'farms' || entity === 'pesticides') return res.status(400).json({ error: 'Bulk create not supported for this entity' });
    if (req.body.length === 0) return res.json([]);
    if (req.body.length > 200) return res.status(400).json({ error: 'Too many records (max 200)' });
    const farmIds = new Set(req.body.map(it => (it && it.farm_id) || user.current_farm_id));
    for (const fid of farmIds) {
      if (!fid || !user.farm_ids.includes(fid)) return res.status(403).json({ error: 'Forbidden' });
      const member = getFarmMember(fid, req.user.id);
      if (member && member.role === 'viewer') return res.status(403).json({ error: 'Viewers cannot create records' });
    }
    const now = NOW();
    const ins = db.prepare('INSERT OR REPLACE INTO entities (id, entity_type, farm_id, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)');
    const ids = [];
    db.transaction(() => {
      for (const item of req.body) {
        if (!item || typeof item !== 'object') continue;
        const id = item.id || uuidv4();
        const farm_id = item.farm_id || user.current_farm_id;
        const data = { ...item };
        ['id', 'farm_id', 'created_at', 'updated_at'].forEach(k => delete data[k]);
        ins.run(id, entity, farm_id, JSON.stringify(data), now, now);
        ids.push(id);
        if (entity === 'activities' || entity === 'harvests') syncSeedingDates(data.seeding_id);
      }
    })();
    const ph = ids.map(() => '?').join(',');
    const rows = ids.length ? db.prepare(`SELECT * FROM entities WHERE entity_type = ? AND id IN (${ph})`).all(entity, ...ids) : [];
    const byId = new Map(rows.map(r => [r.id, formatEntity(r)]));
    return res.status(201).json(ids.map(id => byId.get(id)).filter(Boolean));
  }

  // Role-based write check for non-farm entities
  if (entity !== 'farms') {
    // Pesticides are always shared catalog — any authenticated user may add
    if (entity !== 'pesticides') {
      const farmId = req.body.farm_id || user.current_farm_id;
      const member = getFarmMember(farmId, req.user.id);
      if (member && member.role === 'viewer') return res.status(403).json({ error: 'Viewers cannot create records' });
    }
  }

  const id = req.body.id || uuidv4();
  // Pesticides always go to the shared catalog (farm_id = NULL)
  let farm_id = entity === 'pesticides' ? null : (req.body.farm_id || user.current_farm_id);
  const now = NOW();

  if (entity === 'farms') {
    farm_id = null;
    const newFarmIds = [...user.farm_ids, id];
    db.prepare('UPDATE users SET farm_ids=?, current_farm_id=?, updated_at=? WHERE id=?').run(
      JSON.stringify(newFarmIds), id, now, user.id
    );
    // Add creator as owner
    db.prepare('INSERT OR IGNORE INTO farm_members (id, farm_id, user_id, role, created_at) VALUES (?, ?, ?, ?, ?)').run(
      uuidv4(), id, user.id, 'owner', now
    );
  }

  const data = { ...req.body };
  ['id', 'farm_id', 'created_at', 'updated_at'].forEach(k => delete data[k]);

  db.prepare('INSERT OR REPLACE INTO entities (id, entity_type, farm_id, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    id, entity, farm_id, JSON.stringify(data), now, now
  );
  if (entity === 'activities' || entity === 'harvests') syncSeedingDates(data.seeding_id);
  if (entity === 'farms') ensureDefaultActivityTypes();

  const row = db.prepare('SELECT * FROM entities WHERE id = ? AND entity_type = ?').get(id, entity);
  res.status(201).json(formatEntity(row));
});

// עדכון מרוכז: גוף הבקשה הוא מערך [{ id, ...שדות }] — כל רשומה ממוזגת עם הקיים, בטרנזקציה אחת
app.patch('/api/:entity', authMiddleware, (req, res) => {
  const { entity } = req.params;
  if (['admin', 'farm-members', 'notifications', 'farms', 'pesticides'].includes(entity)) return res.status(404).json({ error: 'Not found' });
  const user = getUser(req.user.id);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const items = Array.isArray(req.body) ? req.body : null;
  if (!items) return res.status(400).json({ error: 'Array body required' });
  if (items.length === 0) return res.json([]);
  if (items.length > 200) return res.status(400).json({ error: 'Too many records (max 200)' });

  const ids = items.map(it => it && it.id).filter(Boolean);
  if (ids.length !== items.length) return res.status(400).json({ error: 'Every item needs an id' });
  const ph = ids.map(() => '?').join(',');
  const rows = db.prepare(`SELECT * FROM entities WHERE entity_type = ? AND id IN (${ph})`).all(entity, ...ids);
  const byId = new Map(rows.map(r => [r.id, r]));
  for (const id of ids) {
    const row = byId.get(id);
    if (!row) return res.status(404).json({ error: `Not found: ${id}` });
    if (row.farm_id && !user.farm_ids.includes(row.farm_id)) return res.status(403).json({ error: 'Forbidden' });
    const member = getFarmMember(row.farm_id, req.user.id);
    if (member && member.role === 'viewer') return res.status(403).json({ error: 'Viewers cannot edit records' });
  }

  const now = NOW();
  const upd = db.prepare('UPDATE entities SET data=?, updated_at=? WHERE entity_type=? AND id=?');
  db.transaction(() => {
    for (const item of items) {
      const row = byId.get(item.id);
      let existing; try { existing = JSON.parse(row.data || '{}'); } catch { existing = {}; }
      const updated = { ...existing, ...item };
      ['id', 'farm_id', 'created_at', 'updated_at'].forEach(k => delete updated[k]);
      upd.run(JSON.stringify(updated), now, entity, item.id);
      if (entity === 'activities' || entity === 'harvests') syncSeedingDates(updated.seeding_id);
    }
  })();
  const out = db.prepare(`SELECT * FROM entities WHERE entity_type = ? AND id IN (${ph})`).all(entity, ...ids).map(formatEntity);
  res.json(out);
});

app.put('/api/:entity/:id', authMiddleware, (req, res) => {
  const { entity, id } = req.params;
  const user = getUser(req.user.id);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const row = db.prepare('SELECT * FROM entities WHERE entity_type = ? AND id = ?').get(entity, id);
  if (!row) return res.status(404).json({ error: 'Not found' });

  // Pesticides are shared catalog — any authenticated user may edit
  if (entity !== 'pesticides') {
    if (entity !== 'farms' && row.farm_id && !user.farm_ids.includes(row.farm_id)) return res.status(403).json({ error: 'Forbidden' });
    // Role check for viewers
    const member = getFarmMember(row.farm_id || id, req.user.id);
    if (member && member.role === 'viewer') return res.status(403).json({ error: 'Viewers cannot edit records' });
  }

  const existing = JSON.parse(row.data || '{}');
  const updated = { ...existing, ...req.body };
  ['id', 'farm_id', 'created_at', 'updated_at'].forEach(k => delete updated[k]);

  // Pesticides always remain in shared catalog (farm_id = NULL)
  const farm_id = entity === 'pesticides' ? null : (req.body.farm_id || row.farm_id);
  db.prepare('UPDATE entities SET data=?, farm_id=?, updated_at=? WHERE entity_type=? AND id=?').run(
    JSON.stringify(updated), farm_id, NOW(), entity, id
  );
  if (entity === 'activities' || entity === 'harvests') {
    syncSeedingDates(updated.seeding_id);
    if (existing.seeding_id && existing.seeding_id !== updated.seeding_id) syncSeedingDates(existing.seeding_id);
  }

  const updatedRow = db.prepare('SELECT * FROM entities WHERE entity_type = ? AND id = ?').get(entity, id);
  res.json(formatEntity(updatedRow));
});

app.delete('/api/:entity/:id', authMiddleware, (req, res) => {
  const { entity, id } = req.params;
  const user = getUser(req.user.id);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const row = db.prepare('SELECT * FROM entities WHERE entity_type = ? AND id = ?').get(entity, id);
  if (!row) return res.status(404).json({ error: 'Not found' });

  // Pesticides are shared catalog — any authenticated user (not viewer) may delete
  if (entity !== 'pesticides') {
    if (entity !== 'farms' && row.farm_id && !user.farm_ids.includes(row.farm_id)) return res.status(403).json({ error: 'Forbidden' });
    // Only owner/manager can delete farm-specific records
    const member = getFarmMember(row.farm_id || id, req.user.id);
    if (member && ['viewer', 'worker'].includes(member.role)) return res.status(403).json({ error: 'Insufficient permissions to delete' });
  }

  // מחיקת חשבונית שיובאה מ-Gmail רושמת tombstone, כדי שסנכרון עתידי לא יחזיר אותה
  if (entity === 'invoices') {
    try {
      const inv = JSON.parse(row.data || '{}');
      if (inv.source === 'gmail' && inv.source_meta?.message_id) {
        dismissGmailMessageId(row.farm_id, inv.source_meta.message_id);
      }
    } catch { /* חשבונית פגומה — המחיקה עצמה חשובה יותר */ }
  }

  db.prepare('DELETE FROM entities WHERE entity_type = ? AND id = ?').run(entity, id);
  if (entity === 'activities' || entity === 'harvests') {
    try { syncSeedingDates(JSON.parse(row.data || '{}').seeding_id); } catch { /* רשומה פגומה */ }
  }
  res.json({ success: true });
});

// ─── SERVE FRONTEND (SPA) ─────────────────────────────────────────────────────
const FRONTEND_DIR = path.join(__dirname, '../frontend');
if (fs.existsSync(FRONTEND_DIR)) {
  // קבצי assets נושאים hash בשם (משתנה בכל build) — בטוחים לקאש קבוע בדפדפן
  // וב-Cloudflare edge. index.html לעולם לא נשמר — כדי שפריסה חדשה תיתפס מיד.
  app.use(express.static(FRONTEND_DIR, {
    setHeaders: (res, filePath) => {
      if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      } else {
        res.setHeader('Cache-Control', 'no-cache');
      }
    },
  }));
  // SPA fallback — all non-API routes serve index.html
  app.get('*', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
  });
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Farm Flow Backend running on port ${PORT}`);
  console.log(`Database: ${DB_PATH}`);
  console.log(`Frontend: ${fs.existsSync(FRONTEND_DIR) ? FRONTEND_DIR : 'not found'}`);
});
