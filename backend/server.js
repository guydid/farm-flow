const express = require('express');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
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
  return new Promise((resolve, reject) => {
    const req = https.request({ family: 4, ...options }, res => {
      let raw = '';
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: raw }));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(new Error('HTTPS request timeout')); });
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
db.pragma('foreign_keys = ON');

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
  return {
    id: user.id,
    email: user.email,
    full_name: user.full_name,
    avatar_url: user.avatar_url,
    farm_ids,
    current_farm_id: user.current_farm_id,
    is_admin: !!user.is_admin,
    is_active: user.is_active !== 0,
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

// ─── DOCUMENT EXTRACTION (Claude → Groq Vision → HuggingFace → Tesseract) ──────
app.post('/api/extract-document', authMiddleware, aiLimiter, async (req, res) => {
  const apiKey  = getAiApiKey();
  const groqKey = getGroqApiKey();

  const { file_url, document_type } = req.body;
  if (!file_url) return res.status(400).json({ error: 'file_url required' });

  try {
    const filename = path.basename(file_url.split('?')[0]);
    const filePath = path.join(UPLOADS_DIR, filename);
    console.log('[extract] file_url:', file_url, '→ filePath:', filePath, 'exists:', fs.existsSync(filePath));
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });

    // ── No Anthropic key → try Groq Vision → HuggingFace → Tesseract ──
    if (!apiKey) {
      console.log('[extract] no Anthropic key. Groq:', !!groqKey, 'HF:', !!process.env.HF_TOKEN, 'doc_type:', document_type);

      // 1) Groq Vision (free, high quality)
      if (groqKey) {
        try {
          const extracted = await groqVisionExtract(filePath, document_type);
          const count = Object.keys(extracted).length;
          console.log('[Groq Vision] extracted', count, 'fields:', JSON.stringify(extracted));
          return res.json({ success: count > 0, data: extracted, method: 'groq_vision' });
        } catch (gErr) {
          console.error('[Groq Vision] error, trying next:', String(gErr?.message || gErr));
        }
      }

      // 2) HuggingFace Vision (free token)
      if (process.env.HF_TOKEN) {
        try {
          const extracted = await hfVisionExtract(filePath, document_type);
          const count = Object.keys(extracted).length;
          console.log('[HF] extracted', count, 'fields');
          return res.json({ success: count > 0, data: extracted, method: 'hf' });
        } catch (hfErr) {
          console.error('[HF] error, falling back to Tesseract:', String(hfErr?.message || hfErr));
        }
      }

      // 3) Tesseract.js fallback
      console.log('[extract] starting Tesseract OCR...');
      try {
        const extracted = await ocrExtractDocument(filePath, document_type);
        const count = Object.keys(extracted).length;
        console.log('[extract] OCR done, fields:', count);
        return res.json({ success: count > 0, data: extracted, method: 'ocr' });
      } catch (ocrErr) {
        console.error('[OCR fallback error]', String(ocrErr?.message || ocrErr));
        return res.json({ success: false, error: 'OCR נכשל — מלא ידנית', data: {} });
      }
    }

    // ── API key available → use Claude Vision ──────────────────────────
    const fileBuffer = fs.readFileSync(filePath);
    const base64Data = fileBuffer.toString('base64');
    const ext = path.extname(filename).toLowerCase();
    const mediaType = ext === '.png' ? 'image/png'
                    : ext === '.gif' ? 'image/gif'
                    : ext === '.webp' ? 'image/webp'
                    : 'image/jpeg';

    // Build prompt per document type
    const prompt = document_type === 'vehicle_license'
      ? `Analyze this Israeli vehicle license image and extract: license_plate (string), manufacturer (string), model (string), year (number), last_test_date (YYYY-MM-DD string), next_test_date (YYYY-MM-DD string). Return ONLY a JSON object, no other text.`
      : `Analyze this passport image and extract: first_name (English, as on passport), last_name (English, as on passport), passport_number (string), passport_expiry (YYYY-MM-DD), country_of_origin (in Hebrew, e.g. תאילנד), birth_date (YYYY-MM-DD). Return ONLY a JSON object, no other text. Do NOT translate names.`;

    // Call Anthropic API — use httpsRequest helper (IPv4 + 30s timeout)
    const body = JSON.stringify({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 512,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64Data } },
          { type: 'text', text: prompt }
        ]
      }]
    });

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
    const result = JSON.parse(rawResult.body);

    if (result.error) {
      return res.json({ success: false, error: result.error.message, data: {} });
    }

    const text = result.content?.[0]?.text || '{}';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const extracted = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
    // Remove null values
    for (const k of Object.keys(extracted)) { if (!extracted[k]) delete extracted[k]; }

    res.json({ success: true, data: extracted });
  } catch (err) {
    console.error('extract-document error:', String(err), err?.stack?.split('\n')[1] || '');
    res.json({ success: false, error: String(err?.message || err), data: {} });
  }
});

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
  res.json(formatUser(user));
});

app.put('/api/auth/me', authMiddleware, (req, res) => {
  const user = getUser(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const { full_name, avatar_url, current_farm_id, farm_ids } = req.body;
  const updated = {
    full_name: full_name !== undefined ? full_name : user.full_name,
    avatar_url: avatar_url !== undefined ? avatar_url : user.avatar_url,
    current_farm_id: current_farm_id !== undefined ? current_farm_id : user.current_farm_id,
    farm_ids_str: farm_ids !== undefined ? JSON.stringify(farm_ids) : JSON.stringify(user.farm_ids),
  };

  db.prepare('UPDATE users SET full_name=?, avatar_url=?, current_farm_id=?, farm_ids=?, updated_at=? WHERE id=?').run(
    updated.full_name, updated.avatar_url, updated.current_farm_id, updated.farm_ids_str, NOW(), user.id
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
           u.email, u.full_name, u.avatar_url, u.is_active
    FROM farm_members fm
    JOIN users u ON fm.user_id = u.id
    WHERE fm.farm_id = ?
    ORDER BY CASE fm.role WHEN 'owner' THEN 1 WHEN 'manager' THEN 2 WHEN 'worker' THEN 3 ELSE 4 END, fm.created_at ASC
  `).all(farm_id);
  res.json(members);
});

// Invite (or add existing) user to farm
app.post('/api/farm-members/invite', authMiddleware, async (req, res) => {
  const { farm_id, email, full_name, role, password } = req.body;
  const user = getUser(req.user.id);

  if (!farm_id || !email) return res.status(400).json({ error: 'farm_id and email are required' });

  if (!user.is_admin) {
    if (!user.farm_ids.includes(farm_id)) return res.status(403).json({ error: 'Forbidden' });
    const member = getFarmMember(farm_id, req.user.id);
    if (!member || !['owner', 'manager'].includes(member.role)) {
      return res.status(403).json({ error: 'Only farm owners/managers can invite members' });
    }
  }

  const validRoles = ['owner', 'manager', 'worker', 'viewer'];
  const assignedRole = validRoles.includes(role) ? role : 'worker';

  // Find or create target user
  let targetUser = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
  let isNewUser = false;

  if (!targetUser) {
    if (!password || password.length < 6) return res.status(400).json({ error: 'Password (min 6 chars) required to create new user' });
    const hash = await bcrypt.hash(password, 10);
    const newId = uuidv4();
    const now = NOW();
    db.prepare('INSERT INTO users (id, email, password_hash, full_name, farm_ids, current_farm_id, is_admin, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, 1, ?, ?)').run(
      newId, email.toLowerCase(), hash, full_name || '', JSON.stringify([farm_id]), farm_id, now, now
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
  }

  // Check if already a member
  const existing = getFarmMember(farm_id, targetUser.id);
  if (existing) return res.status(400).json({ error: 'User is already a member of this farm' });

  const memberId = uuidv4();
  db.prepare('INSERT INTO farm_members (id, farm_id, user_id, role, invited_by, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    memberId, farm_id, targetUser.id, assignedRole, req.user.id, NOW()
  );

  res.json({
    id: memberId,
    farm_id,
    user_id: targetUser.id,
    email: targetUser.email,
    full_name: targetUser.full_name,
    role: assignedRole,
    is_new_user: isNewUser,
    is_active: targetUser.is_active !== 0,
  });
});

// Update member role
app.put('/api/farm-members/:id', authMiddleware, (req, res) => {
  const { id } = req.params;
  const { role } = req.body;
  const user = getUser(req.user.id);

  const membership = db.prepare('SELECT * FROM farm_members WHERE id = ?').get(id);
  if (!membership) return res.status(404).json({ error: 'Membership not found' });

  if (!user.is_admin) {
    const myMembership = getFarmMember(membership.farm_id, req.user.id);
    if (!myMembership || myMembership.role !== 'owner') return res.status(403).json({ error: 'Only farm owners can change roles' });
  }

  const validRoles = ['owner', 'manager', 'worker', 'viewer'];
  if (!validRoles.includes(role)) return res.status(400).json({ error: 'Invalid role' });

  db.prepare('UPDATE farm_members SET role = ? WHERE id = ?').run(role, id);
  res.json({ ...membership, role });
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
      `  שתילה: ${s.planting_date || '?'} | סיום משוער: ${s.estimated_end_date || '?'}\n` +
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

// ─── ENTITIES ─────────────────────────────────────────────────────────────────

app.get('/api/:entity', authMiddleware, (req, res) => {
  const { entity } = req.params;
  if (['admin', 'farm-members', 'notifications', 'sensors', 'telegram'].includes(entity)) return res.status(404).json({ error: 'Not found' });
  const user = getUser(req.user.id);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  let rows;
  if (entity === 'farms') {
    if (user.farm_ids.length === 0) return res.json([]);
    const ph = user.farm_ids.map(() => '?').join(',');
    rows = db.prepare(`SELECT * FROM entities WHERE entity_type = ? AND id IN (${ph})`).all(entity, ...user.farm_ids);
  } else if (entity === 'users') {
    rows = [];
  } else if (entity === 'pesticides') {
    // Pesticides: shared catalog (farm_id IS NULL) + farm-specific custom entries
    if (user.farm_ids.length > 0) {
      const ph = user.farm_ids.map(() => '?').join(',');
      rows = db.prepare(`SELECT * FROM entities WHERE entity_type = ? AND (farm_id IS NULL OR farm_id IN (${ph}))`).all(entity, ...user.farm_ids);
    } else {
      rows = db.prepare(`SELECT * FROM entities WHERE entity_type = ? AND farm_id IS NULL`).all(entity);
    }
  } else {
    if (user.farm_ids.length === 0) return res.json([]);
    const ph = user.farm_ids.map(() => '?').join(',');
    rows = db.prepare(`SELECT * FROM entities WHERE entity_type = ? AND farm_id IN (${ph})`).all(entity, ...user.farm_ids);
  }

  let result = rows.map(formatEntity);

  for (const [key, val] of Object.entries(req.query)) {
    if (key === 'farm_id') {
      if (user.farm_ids.includes(val)) result = result.filter(item => item.farm_id === val);
    } else {
      result = result.filter(item => String(item[key]) === String(val));
    }
  }

  res.json(result);
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

  const row = db.prepare('SELECT * FROM entities WHERE id = ? AND entity_type = ?').get(id, entity);
  res.status(201).json(formatEntity(row));
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

  db.prepare('DELETE FROM entities WHERE entity_type = ? AND id = ?').run(entity, id);
  res.json({ success: true });
});

// ─── SERVE FRONTEND (SPA) ─────────────────────────────────────────────────────
const FRONTEND_DIR = path.join(__dirname, '../frontend');
if (fs.existsSync(FRONTEND_DIR)) {
  app.use(express.static(FRONTEND_DIR));
  // SPA fallback — all non-API routes serve index.html
  app.get('*', (req, res) => {
    res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
  });
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Farm Flow Backend running on port ${PORT}`);
  console.log(`Database: ${DB_PATH}`);
  console.log(`Frontend: ${fs.existsSync(FRONTEND_DIR) ? FRONTEND_DIR : 'not found'}`);
});
