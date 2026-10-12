// ─── MCP SERVER (Model Context Protocol) ──────────────────────────────────────
// Lets an external AI agent (Claude Code / claude.ai connector / n8n / any MCP client)
// read — and optionally write — one farm's data.
//
// Transport: Streamable HTTP, stateless, JSON responses only (no SSE stream).
//   POST /mcp            — token in "Authorization: Bearer ffmcp_…"
//   POST /mcp/:token     — token in the path, for clients that can't set headers
//
// Each token is bound to (user, farm). Every call re-checks that the user is still
// active and still a member of that farm, and runs with the user's farm scope narrowed
// to that single farm. Write tools need a token created with can_write and a non-viewer role.

const crypto = require('crypto');
const rateLimit = require('express-rate-limit');

const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const SERVER_INFO = { name: 'farm-flow', title: 'Farm Flow', version: '1.0.0' };

// Only these entity types are exposed. Secrets/config (gmail_connections with OAuth
// tokens, telegram_config, bookkeeper_settings, …) are intentionally absent.
const ENTITIES = {
  farms:                   'משקים (קריאה בלבד)',
  plots:                   'חלקות',
  seedings:                'מזרעים / שתילות (status, plot_id, variety_id, תאריכים)',
  plot_seedings:           'קישור חלקה↔מזרע',
  varieties:               'זנים',
  crops:                   'גידולים',
  activities:              'פעילויות בשטח (seeding_id, activity_type_id, date)',
  activity_types:          'סוגי פעילות',
  harvests:                'קטיפים (seeding_id, date, כמות)',
  sprayings:               'הדברות (seeding_id, pesticide, control_method)',
  pesticides:              'קטלוג חומרי הדברה (קריאה בלבד)',
  input_types:             'סוגי תשומות',
  plastic_sheets:          'יריעות פלסטיק',
  sheet_types:             'סוגי יריעות',
  products:                'מוצרים',
  packaging:               'אריזות',
  pallet_types:            'סוגי משטחים',
  customers:               'לקוחות',
  customer_product_pricing:'מחירון לקוח-מוצר',
  weighing_certificates:   'תעודות שקילה / משלוח',
  weighing_items:          'שורות בתעודות שקילה (certificate_id)',
  suppliers:               'ספקים',
  invoices:                'חשבוניות ספקים',
  expenses:                'הוצאות',
  payments:                'תשלומים',
  employees:               'עובדים',
  employee_events:         'אירועי עובד (ציר הזמן בכרטיס העובד): employee_id, event_type, event_date, notes, document_url. לרישום — הכלי record_employee_event',
  employee_logs:           'יומני עבודה של עובדים',
  manpower_companies:      'חברות כוח אדם',
  temp_worker_groups:      'קבוצות עובדים זמניים',
  attendance_records:      'רשומות נוכחות משעון (worker per day)',
  clock_workers:           'עובדים רשומים בשעון הנוכחות',
  vehicles:                'כלי רכב',
  vehicle_treatments:      'טיפולי רכב',
  company_settings:        'פרטי חברה',
  pesticide_prices:        'מחירון קנייה של המשק לחומרי הדברה — רשומה אחת לתכשיר: product_name, price (₪ ליחידה), unit (ליטר/מ"ל/ק"ג/גרם/יח\'), supplier, date',
  pesticide_stock:         'תנועות מלאי חומרי הדברה: type count (ספירה — קובעת יתרה) / purchase (קנייה) / adjustment (תיקון ±), product_name, quantity, unit, date, supplier, cost_per_unit, notes. היתרה מחושבת — בכלי pesticide_stock',
  pest_recommendations:    'המלצות הדברה מפיקוח מזיקים (status: pending/done/cancelled) — כתיבה רק דרך propose_pest_action / update_pest_action',
};
// המלצות הדברה נכתבות רק דרך הכלים הייעודיים, שמאמתים חלקה/מזרע/תכשירים
const READ_ONLY = new Set(['farms', 'pesticides', 'pest_recommendations']);
// טבלאות המלאי/מחירון — נכתבות גם בטוקן "פיקוח מזיקים" (create_record/update_record מוגבלים אליהן), עם אימות
const PEST_WRITABLE = ['pesticide_stock', 'pesticide_prices'];
const STOCK_TYPES = ['count', 'purchase', 'adjustment'];
// ערכים זהים ל-src/components/pest/pestConstants.js
const PEST_SEVERITIES = ['low', 'medium', 'high'];
const PEST_METHODS = ['chemical', 'biological'];
const PEST_TREATMENTS = ['mechanized', 'spray_gun', 'backpack', 'drench'];
const ACTIVE_SEEDING_STATUSES = ['ordered', 'growing', 'harvesting', 'preparation'];
// סוגי אירועי עובד — זהים ל-EVENT_TYPES ב-src/components/employees/EmployeeTimeline.jsx
const EMPLOYEE_EVENT_TYPES = {
  start_employment: 'תחילת העסקה', entry_to_country: 'כניסה לארץ', inter_visa_exit: 'יציאה לאינטרוויזה',
  inter_visa_return: 'חזרה מאינטרוויזה', transfer: 'נייוד', contract_signed: 'חוזה נחתם', visa_renewal: 'חידוש אשרה',
  passport_renewal: 'חידוש דרכון', medical_exam: 'בדיקה רפואית', health_insurance: 'ביטוח רפואי',
  documents_received: 'קבלת מסמכים', bank_account: 'חשבון בנק / טלפון', authority_notice: 'הודעת רשות האוכלוסין',
  fee_payment: 'אגרה / תשלום', end_employment: 'סיום העסקה', other: 'אחר',
};
// סכמה קבועה לישויות שעשויות להיות ריקות (describe_entity מסיק שדות מרשומות קיימות)
const KNOWN_FIELDS = {
  employee_events: [
    { field: 'employee_id', types: ['string'], required: true, description: 'id של העובד (employees)' },
    { field: 'event_type', types: ['string'], required: true, enum: Object.keys(EMPLOYEE_EVENT_TYPES), description: Object.entries(EMPLOYEE_EVENT_TYPES).map(([k, v]) => `${k}=${v}`).join(', ') },
    { field: 'event_date', types: ['string'], required: true, description: 'YYYY-MM-DD — תאריך האירוע עצמו (לא תאריך המייל אם ידוע אחר)' },
    { field: 'notes', types: ['string'], description: 'תיאור / פירוט: מספר פוליסה, תוקף, מה התקבל וכו׳ (אפשר גם description)' },
    { field: 'document_url', types: ['string'], description: 'קישור למסמך (אופציונלי)' },
    { field: 'source', types: ['string'], description: 'מקור, למשל email' },
    { field: 'source_ref', types: ['string'], description: 'מזהה המקור (למשל Gmail message id) — מונע רישום כפול' },
  ],
  employees: [
    { field: 'full_name', types: ['string'] }, { field: 'first_name', types: ['string'] }, { field: 'last_name', types: ['string'] },
    { field: 'passport_number', types: ['string'], description: 'מספר דרכון — מזהה עיקרי לעובדים זרים' },
    { field: 'passport_expiry', types: ['string'] }, { field: 'visa_type', types: ['string'] }, { field: 'visa_expiry', types: ['string'] },
    { field: 'start_date', types: ['string'] }, { field: 'status', types: ['string'] }, { field: 'manpower_company_id', types: ['string'] },
  ],
};
const MAX_STRING = 2000; // long strings (base64 images, OCR text) are truncated in output

module.exports = function mountMcp(app, { db, listEntities, formatEntity, getUser, getFarmMember, authMiddleware, uuidv4, NOW, syncSeedingDates, computePesticideStock, upsertPesticidePrice }) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS mcp_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      farm_id TEXT NOT NULL,
      name TEXT DEFAULT '',
      token_hash TEXT UNIQUE NOT NULL,
      token_prefix TEXT DEFAULT '',
      can_write INTEGER DEFAULT 0,
      revoked INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      last_used_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_mcp_tokens_farm ON mcp_tokens(farm_id);
  `);
  // הרשאת כתיבה מוגבלת לפיקוח מזיקים (בלי כתיבה כללית)
  try { db.exec('ALTER TABLE mcp_tokens ADD COLUMN pest_write INTEGER DEFAULT 0'); } catch { /* העמודה כבר קיימת */ }

  const hashToken = t => crypto.createHash('sha256').update(String(t)).digest('hex');

  // ── Token management (from the Settings page, regular JWT auth) ──────────────
  function requireFarmManager(req, res) {
    const user = getUser(req.user.id);
    if (!user?.current_farm_id) { res.status(400).json({ error: 'משתמש ללא חוות ברירת מחדל' }); return null; }
    const member = getFarmMember(user.current_farm_id, user.id);
    if (!user.is_admin && !['owner', 'manager'].includes(member?.role)) { res.status(403).json({ error: 'רק בעלים/מנהל משק' }); return null; }
    return user;
  }

  app.get('/api/mcp/tokens', authMiddleware, (req, res) => {
    const user = requireFarmManager(req, res); if (!user) return;
    const rows = db.prepare(`
      SELECT t.id, t.name, t.token_prefix, t.can_write, t.pest_write, t.revoked, t.created_at, t.last_used_at, u.email AS user_email
      FROM mcp_tokens t LEFT JOIN users u ON u.id = t.user_id
      WHERE t.farm_id = ? ORDER BY t.created_at DESC`).all(user.current_farm_id);
    res.json(rows.map(r => ({ ...r, can_write: !!r.can_write, pest_write: !!r.pest_write, revoked: !!r.revoked })));
  });

  app.post('/api/mcp/tokens', authMiddleware, (req, res) => {
    const user = requireFarmManager(req, res); if (!user) return;
    const name = String(req.body?.name || '').trim().slice(0, 80) || 'סוכן חיצוני';
    // access: read | pest (כתיבה בפיקוח מזיקים בלבד) | write (כתיבה מלאה). can_write נשמר לתאימות.
    const access = ['read', 'pest', 'write'].includes(req.body?.access) ? req.body.access : (req.body?.can_write ? 'write' : 'read');
    const canWrite = access === 'write', pestWrite = access !== 'read';
    const token = 'ffmcp_' + crypto.randomBytes(32).toString('hex');
    const id = uuidv4();
    db.prepare(`INSERT INTO mcp_tokens (id, user_id, farm_id, name, token_hash, token_prefix, can_write, pest_write, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, user.id, user.current_farm_id, name, hashToken(token), token.slice(0, 12), canWrite ? 1 : 0, pestWrite ? 1 : 0, NOW());
    // The plain token is returned exactly once — only its hash is stored.
    res.status(201).json({ id, name, token, access, can_write: canWrite, pest_write: pestWrite });
  });

  app.delete('/api/mcp/tokens/:id', authMiddleware, (req, res) => {
    const user = requireFarmManager(req, res); if (!user) return;
    const r = db.prepare('UPDATE mcp_tokens SET revoked = 1 WHERE id = ? AND farm_id = ?').run(req.params.id, user.current_farm_id);
    if (!r.changes) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  });

  // ── MCP endpoint ──────────────────────────────────────────────────────────────
  const mcpLimiter = rateLimit({ windowMs: 60 * 1000, max: 120, message: { error: 'Too many requests' } });

  // Resolves the token to a farm-scoped user context, or null.
  function resolveContext(req) {
    const auth = req.headers.authorization || '';
    const token = req.params.token || (auth.startsWith('Bearer ') ? auth.slice(7).trim() : '');
    if (!token.startsWith('ffmcp_')) return null;
    const row = db.prepare('SELECT * FROM mcp_tokens WHERE token_hash = ? AND revoked = 0').get(hashToken(token));
    if (!row) return null;
    const user = getUser(row.user_id);
    if (!user || user.is_active === 0 || !user.farm_ids.includes(row.farm_id)) return null;
    const member = getFarmMember(row.farm_id, user.id);
    if (!member && !user.is_admin) return null;
    db.prepare('UPDATE mcp_tokens SET last_used_at = ? WHERE id = ?').run(NOW(), row.id);
    return {
      tokenId: row.id,
      tokenName: row.name || 'סוכן',
      farmId: row.farm_id,
      canWrite: !!row.can_write && member?.role !== 'viewer',
      canWritePest: (!!row.can_write || !!row.pest_write) && member?.role !== 'viewer',
      // Same user object the REST routes use, narrowed to this single farm.
      user: { ...user, farm_ids: [row.farm_id], current_farm_id: row.farm_id },
    };
  }

  function handleMcp(req, res) {
    const ctx = resolveContext(req);
    if (!ctx) {
      res.set('WWW-Authenticate', 'Bearer realm="farm-flow-mcp"');
      return res.status(401).json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Invalid or missing MCP token' } });
    }
    const body = req.body;
    const messages = Array.isArray(body) ? body : [body];
    const responses = [];
    for (const msg of messages) {
      if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
        // Client responses / malformed input — nothing to answer for notifications-only.
        if (msg && msg.id !== undefined && msg.method === undefined) continue;
        responses.push({ jsonrpc: '2.0', id: msg?.id ?? null, error: { code: -32600, message: 'Invalid Request' } });
        continue;
      }
      const isNotification = msg.id === undefined || msg.id === null;
      let out;
      try {
        out = { jsonrpc: '2.0', id: msg.id, result: dispatch(ctx, msg.method, msg.params || {}) };
      } catch (e) {
        out = { jsonrpc: '2.0', id: msg.id ?? null, error: { code: e.rpcCode || -32603, message: e.message } };
      }
      if (!isNotification) responses.push(out);
    }
    if (responses.length === 0) return res.status(202).end();
    res.json(Array.isArray(body) ? responses : responses[0]);
  }

  app.post('/mcp', mcpLimiter, handleMcp);
  app.post('/mcp/:token', mcpLimiter, handleMcp);
  // No server-initiated stream and no sessions in stateless mode.
  for (const p of ['/mcp', '/mcp/:token']) {
    app.get(p, (req, res) => res.set('Allow', 'POST').status(405).json({ error: 'Method Not Allowed — use POST (MCP Streamable HTTP)' }));
    app.delete(p, (req, res) => res.set('Allow', 'POST').status(405).end());
  }

  function rpcError(code, message) { return Object.assign(new Error(message), { rpcCode: code }); }

  function dispatch(ctx, method, params) {
    switch (method) {
      case 'initialize': {
        const requested = params.protocolVersion;
        return {
          protocolVersion: PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions: instructions(ctx),
        };
      }
      case 'ping': return {};
      case 'notifications/initialized':
      case 'notifications/cancelled': return {};
      case 'tools/list': return { tools: toolDefs(ctx) };
      case 'tools/call': return callTool(ctx, params.name, params.arguments || {});
      default: throw rpcError(-32601, `Method not found: ${method}`);
    }
  }

  function instructions(ctx) {
    const farm = db.prepare("SELECT data FROM entities WHERE entity_type = 'farms' AND id = ?").get(ctx.farmId);
    let farmName = ctx.farmId;
    try { farmName = JSON.parse(farm?.data || '{}').name || farmName; } catch {}
    return [
      `Farm Flow — farm management system for the farm "${farmName}". All data is scoped to this farm.`,
      'Records are generic JSON documents grouped by entity type; field names are English, values are often Hebrew.',
      'Start with farm_overview, use describe_entity to learn a type\'s fields, then list_records / get_record.',
      'Relations use *_id fields (e.g. harvests.seeding_id → seedings.id, seedings.plot_id → plots.id).',
      ctx.canWrite ? 'This token may create and update records (no delete).' : 'This token is read-only.',
      'Pest control: inspect a plot with pest_plot_context, then propose treatments with propose_pest_action. '
        + 'Proposals appear in the app as pending until a worker executes them in the field (only the app marks them done).',
      ctx.canWritePest ? 'This token may create and update pest control recommendations, pesticide prices (pesticide_prices) and stock movements (pesticide_stock). Use pesticide_stock (tool) for current balances.' : 'This token cannot write pest control recommendations.',
    ].join('\n');
  }

  // ── Tools ─────────────────────────────────────────────────────────────────────
  const entityEnum = Object.keys(ENTITIES);
  const writableEnum = entityEnum.filter(e => !READ_ONLY.has(e));

  function toolDefs(ctx) {
    const tools = [
      {
        name: 'farm_overview',
        title: 'Farm overview',
        description: 'Farm details plus the record count of every available entity type, with a short Hebrew description of each.',
        inputSchema: { type: 'object', properties: {} },
        annotations: { readOnlyHint: true },
      },
      {
        name: 'describe_entity',
        title: 'Describe entity fields',
        description: 'Lists the fields seen on recent records of an entity type, with example values. Use before filtering.',
        inputSchema: {
          type: 'object',
          properties: { entity: { type: 'string', enum: entityEnum } },
          required: ['entity'],
        },
        annotations: { readOnlyHint: true },
      },
      {
        name: 'list_records',
        title: 'List records',
        description: 'Lists records of an entity type. Supports exact-match field filters, a date range on any date field, free-text search, sorting and paging.',
        inputSchema: {
          type: 'object',
          properties: {
            entity: { type: 'string', enum: entityEnum },
            filters: { type: 'object', description: 'Exact-match filters, e.g. {"status":"growing","plot_id":"…"}', additionalProperties: { type: ['string', 'number', 'boolean'] } },
            date_field: { type: 'string', description: 'Field for date_from/date_to (default "date" if present, else created_at)' },
            date_from: { type: 'string', description: 'Inclusive, ISO date e.g. 2026-01-01' },
            date_to: { type: 'string', description: 'Inclusive, ISO date e.g. 2026-12-31' },
            search: { type: 'string', description: 'Case-insensitive substring match over all field values' },
            sort: { type: 'string', description: 'Field name, prefix with "-" for descending. Default "-created_at"' },
            limit: { type: 'integer', minimum: 1, maximum: 500, default: 50 },
            offset: { type: 'integer', minimum: 0, default: 0 },
          },
          required: ['entity'],
        },
        annotations: { readOnlyHint: true },
      },
      {
        name: 'get_record',
        title: 'Get record',
        description: 'Fetches a single record by entity type and id.',
        inputSchema: {
          type: 'object',
          properties: { entity: { type: 'string', enum: entityEnum }, id: { type: 'string' } },
          required: ['entity', 'id'],
        },
        annotations: { readOnlyHint: true },
      },
      {
        name: 'pest_plot_context',
        title: 'Pest control context for a plot',
        description: 'Everything needed before recommending a treatment on a plot: plot details, its active seedings (crop, variety, area), sprayings from the last N days, and pending pest recommendations. Call with no plot_id to get a summary of all active plots.',
        inputSchema: {
          type: 'object',
          properties: {
            plot_id: { type: 'string', description: 'Omit for a summary of every active plot' },
            days: { type: 'integer', minimum: 1, maximum: 365, default: 60, description: 'How far back to include sprayings' },
          },
        },
        annotations: { readOnlyHint: true },
      },
      {
        name: 'pesticide_stock',
        title: 'Pesticide stock on the farm',
        description: 'Current stock of pest control products with the farm purchase price and stock value: balance (stock counts + purchases minus quantities used in recorded sprayings), usage in the last 30 days and status ok/low/out. Check before recommending a product. Products never counted or purchased are not tracked.',
        inputSchema: {
          type: 'object',
          properties: {
            product: { type: 'string', description: 'Optional: filter by product name (substring)' },
            history: { type: 'boolean', default: false, description: 'Include the movement history per product' },
          },
        },
        annotations: { readOnlyHint: true },
      },
    ];
    if (ctx.canWritePest) {
      const pesticideItem = {
        type: 'object',
        properties: {
          pesticide_id: { type: 'string', description: 'Id from the pesticides catalog (preferred)' },
          name: { type: 'string', description: 'Product name, used when pesticide_id is not known; matched against the catalog' },
          dosage_per_dunam: { type: 'number', description: 'Dose per dunam, or the concentration in percent when unit is "%". Defaults to the catalog dosage' },
          unit: { type: 'string', description: 'מ"ל, גרם, ליטר, ק"ג per dunam — or "%" for a concentration in the spray mix (catalog doses written as "1 אחוז"). Defaults from the catalog' },
        },
      };
      tools.push(
        {
          name: 'propose_pest_action',
          title: 'Propose pest control action',
          description: 'Creates a pest control recommendation for a plot. It appears in the app under פיקוח מזיקים as pending until a worker executes it in the field. The farm is notified.',
          inputSchema: {
            type: 'object',
            properties: {
              plot_id: { type: 'string' },
              seeding_id: { type: 'string', description: 'Optional: a specific active seeding on the plot. Omit for the whole plot.' },
              pest: { type: 'string', description: 'Pest or disease, in Hebrew where possible (e.g. כנימת עש, קמחון)' },
              severity: { type: 'string', enum: PEST_SEVERITIES, default: 'medium' },
              control_method: { type: 'string', enum: PEST_METHODS, default: 'chemical' },
              treatment_type: { type: 'string', enum: PEST_TREATMENTS, default: 'mechanized' },
              pesticides: { type: 'array', minItems: 1, items: pesticideItem },
              due_date: { type: 'string', description: 'YYYY-MM-DD, default tomorrow' },
              notes: { type: 'string', description: 'Observation and reasoning, shown to the field team' },
              spray_volume_per_dunam: { type: 'number', description: 'Liters of spray mix per dunam. Needed for "%" products: the field quantity in liters = % × volume × area. Defaults from the catalog volume' },
            },
            required: ['plot_id', 'pest', 'pesticides'],
          },
          annotations: { readOnlyHint: false, destructiveHint: false },
        },
        {
          name: 'update_pest_action',
          title: 'Update pending pest control action',
          description: 'Edits a pending recommendation, or cancels it with status "cancelled". Executed (done) recommendations cannot be changed; only the app marks a recommendation done, when the spraying is recorded.',
          inputSchema: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              pest: { type: 'string' },
              severity: { type: 'string', enum: PEST_SEVERITIES },
              control_method: { type: 'string', enum: PEST_METHODS },
              treatment_type: { type: 'string', enum: PEST_TREATMENTS },
              pesticides: { type: 'array', minItems: 1, items: pesticideItem },
              due_date: { type: 'string' },
              notes: { type: 'string' },
              spray_volume_per_dunam: { type: 'number' },
              status: { type: 'string', enum: ['cancelled'], description: 'Set to cancel the recommendation' },
              cancel_reason: { type: 'string' },
            },
            required: ['id'],
          },
          annotations: { readOnlyHint: false, destructiveHint: true },
        },
        {
          name: 'update_pesticide_prices',
          title: 'Update pesticide purchase prices',
          description: 'Sets the farm purchase price of one or more pest control products (₪ per unit). Prices are per farm, not on the shared catalog; the previous price is kept in history. Used for spraying cost and stock value. Pass price null to clear.',
          inputSchema: {
            type: 'object',
            properties: {
              prices: {
                type: 'array', minItems: 1, maxItems: 100,
                items: {
                  type: 'object',
                  properties: {
                    product: { type: 'string', description: 'Product name as in the catalog / stock (e.g. אקרובט 69)' },
                    pesticide_id: { type: 'string', description: 'Optional catalog id; its product name is used' },
                    price: { type: ['number', 'null'], minimum: 0, description: 'Price in ₪ per unit' },
                    unit: { type: 'string', description: 'ליטר, מ"ל, ק"ג, גרם or יח\' — default ליטר' },
                    supplier: { type: 'string' },
                    date: { type: 'string', description: 'YYYY-MM-DD of the quote/invoice, default today' },
                  },
                  required: ['price'],
                },
              },
            },
            required: ['prices'],
          },
          annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
        },
      );
    }
    if (ctx.canWrite) {
      tools.push({
        name: 'record_employee_event',
        title: 'Record employee event',
        description: 'Adds an event to a specific employee\'s timeline (e.g. health insurance, start of employment, contract signed, documents received, bank account, visa/authority notice). Identify the employee by employee_id, or by passport_number (normalized match), or by name. Idempotent per source_ref: the same source_ref + event_type + employee is not recorded twice.',
        inputSchema: {
          type: 'object',
          properties: {
            employee_id: { type: 'string' },
            passport_number: { type: 'string', description: 'Used to find the employee when employee_id is not known' },
            employee_name: { type: 'string', description: 'Fallback when neither id nor passport is known; must match exactly one employee' },
            event_type: { type: 'string', enum: Object.keys(EMPLOYEE_EVENT_TYPES), description: Object.entries(EMPLOYEE_EVENT_TYPES).map(([k, v]) => `${k}=${v}`).join(', ') },
            event_date: { type: 'string', description: 'YYYY-MM-DD' },
            notes: { type: 'string', description: 'Details: policy number, validity, what was received, sender' },
            description: { type: 'string', description: 'Alias of notes' },
            document_url: { type: 'string' },
            source: { type: 'string', description: 'e.g. email', default: 'email' },
            source_ref: { type: 'string', description: 'e.g. the Gmail message id; prevents duplicates' },
          },
          required: ['event_type', 'event_date'],
        },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      });
    }
    if (ctx.canWrite || ctx.canWritePest) {
      const writable = ctx.canWrite ? writableEnum : PEST_WRITABLE;
      tools.push(
        {
          name: 'create_record',
          title: 'Create record',
          description: 'Creates a record in this farm. Call describe_entity first so the field names match existing records. pesticide_stock: {type: count|purchase|adjustment, product_name, quantity, unit, date, supplier?, cost_per_unit?, notes?} — a purchase with cost_per_unit also updates the price list. pesticide_prices: {product_name, price, unit, supplier?, date?} — one record per product (an existing one is updated).',
          inputSchema: {
            type: 'object',
            properties: { entity: { type: 'string', enum: writable }, data: { type: 'object' } },
            required: ['entity', 'data'],
          },
          annotations: { readOnlyHint: false, destructiveHint: false },
        },
        {
          name: 'update_record',
          title: 'Update record',
          description: 'Merges the given fields into an existing record (fields not given are kept).',
          inputSchema: {
            type: 'object',
            properties: { entity: { type: 'string', enum: writable }, id: { type: 'string' }, data: { type: 'object' } },
            required: ['entity', 'id', 'data'],
          },
          annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
        },
      );
    }
    return tools;
  }

  function callTool(ctx, name, args) {
    try {
      const result = runTool(ctx, name, args);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 1) }] };
    } catch (e) {
      if (e.rpcCode) throw e;
      // Tool-level failures are returned to the model, not as protocol errors.
      return { isError: true, content: [{ type: 'text', text: e.message }] };
    }
  }

  const normPassport = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

  function resolveEmployee(ctx, { employee_id, passport_number, employee_name }) {
    const all = entityRows('employees', ctx.farmId);
    const label = (e) => `${e.full_name || [e.first_name, e.last_name].filter(Boolean).join(' ')}${e.passport_number ? ` (${e.passport_number})` : ''} id=${e.id}`;
    if (employee_id) {
      const e = all.find(x => x.id === employee_id);
      if (!e) throw new Error(`Unknown employee_id: ${employee_id}`);
      return e;
    }
    if (passport_number) {
      const p = normPassport(passport_number);
      const e = all.find(x => normPassport(x.passport_number) === p);
      if (e) return e;
      if (!employee_name) throw new Error(`No employee with passport ${passport_number}. Look the employee up with list_records (entity employees) or pass employee_id.`);
    }
    if (employee_name) {
      const n = String(employee_name).trim().toLowerCase().replace(/\s+/g, ' ');
      const nameOf = (x) => String(x.full_name || [x.first_name, x.last_name].filter(Boolean).join(' ')).trim().toLowerCase().replace(/\s+/g, ' ');
      const reversed = n.split(' ').reverse().join(' ');
      const hits = all.filter(x => nameOf(x) === n || nameOf(x) === reversed);
      if (hits.length === 1) return hits[0];
      if (hits.length > 1) throw new Error(`Name "${employee_name}" matches several employees: ${hits.map(label).join('; ')}. Pass employee_id.`);
      throw new Error(`No employee named "${employee_name}". Pass employee_id or passport_number.`);
    }
    throw new Error('employee_id, passport_number or employee_name is required');
  }

  function validateEmployeeEvent(ctx, d) {
    const emp = resolveEmployee(ctx, d);
    if (!EMPLOYEE_EVENT_TYPES[d.event_type]) throw new Error(`event_type must be one of: ${Object.keys(EMPLOYEE_EVENT_TYPES).join(', ')}`);
    if (!d.event_date) throw new Error('event_date is required');
    checkDate('event_date', d.event_date);
    return {
      employee_id: emp.id,
      employee_name: emp.full_name || [emp.first_name, emp.last_name].filter(Boolean).join(' '),
      event_type: d.event_type, event_date: d.event_date,
      notes: String(d.notes ?? d.description ?? '').trim(), document_url: String(d.document_url || '').trim(),
      source: String(d.source || 'email').trim(), ...(d.source_ref ? { source_ref: String(d.source_ref).trim() } : {}),
      created_by: `סוכן: ${ctx.tokenName}`, _by: `סוכן: ${ctx.tokenName}`,
    };
  }

  function checkWriteAccess(ctx, entity) {
    if (ctx.canWrite) return;
    if (ctx.canWritePest && PEST_WRITABLE.includes(entity)) return;
    throw new Error(ctx.canWritePest ? `This token may write only: ${PEST_WRITABLE.join(', ')}` : 'This token is read-only');
  }

  // תנועת מלאי — אותם כללים כמו בטופס באפליקציה
  function validateStockMovement(ctx, d) {
    let name = String(d.product_name || '').trim().replace(/\s+/g, ' ');
    let pesticideId = d.pesticide_id || null;
    if (pesticideId) {
      const row = db.prepare("SELECT data FROM entities WHERE entity_type = 'pesticides' AND id = ? AND (farm_id IS NULL OR farm_id = ?)").get(pesticideId, ctx.farmId);
      if (!row) throw new Error(`unknown pesticide_id ${pesticideId}`);
      if (!name) name = JSON.parse(row.data || '{}').product_name || '';
    }
    if (!name) throw new Error('product_name (or pesticide_id) is required');
    if (!STOCK_TYPES.includes(d.type)) throw new Error(`type must be one of: ${STOCK_TYPES.join(', ')}`);
    const qty = Number(d.quantity);
    if (!Number.isFinite(qty)) throw new Error('quantity must be a number');
    if (d.type !== 'adjustment' && qty < 0) throw new Error(`quantity cannot be negative for ${d.type} (use type adjustment)`);
    if (d.type === 'purchase' && qty === 0) throw new Error('purchase quantity must be positive');
    const unit = String(d.unit || '').trim() || 'ליטר';
    if (/^(%|אחוז)$/.test(unit)) throw new Error('stock is kept in liters/kg/units, not percent');
    const date = d.date === undefined ? NOW().slice(0, 10) : d.date;
    checkDate('date', date);
    const cost = d.cost_per_unit === undefined || d.cost_per_unit === null || d.cost_per_unit === '' ? null : Number(d.cost_per_unit);
    if (cost !== null && !(Number.isFinite(cost) && cost >= 0)) throw new Error('cost_per_unit must be a non-negative number');
    return {
      type: d.type, product_name: name, pesticide_id: pesticideId, quantity: qty, unit, date,
      ...(d.type === 'purchase' ? { supplier: String(d.supplier || '').trim(), cost_per_unit: cost } : {}),
      notes: String(d.notes || '').trim(), created_by: d.created_by || `סוכן: ${ctx.tokenName}`,
    };
  }

  // קנייה עם מחיר מעדכנת את המחירון, כמו בטופס הקנייה באפליקציה
  function syncPurchasePrice(ctx, m) {
    if (m.type !== 'purchase' || m.cost_per_unit == null) return;
    upsertPesticidePrice(db, ctx.farmId, {
      product_name: m.product_name, price: m.cost_per_unit, unit: m.unit, pesticide_id: m.pesticide_id,
      supplier: m.supplier, source: 'purchase', date: m.date, updated_by: `סוכן: ${ctx.tokenName}`,
    }, { uuidv4, NOW });
  }

  function savePriceRecord(ctx, d) {
    const price = d.price === null || d.price === '' ? null : Number(d.price);
    if (d.price === undefined) throw new Error('price is required (number, or null to clear)');
    if (price !== null && !(Number.isFinite(price) && price >= 0)) throw new Error('price must be a non-negative number or null');
    if (/^(%|אחוז)$/.test(String(d.unit || '').trim())) throw new Error('price unit must be a quantity unit (ליטר, מ"ל, ק"ג, גרם, יח\'), not percent');
    if (d.date !== undefined) checkDate('date', d.date);
    const saved = upsertPesticidePrice(db, ctx.farmId, {
      product_name: d.product_name, price, unit: d.unit, pesticide_id: d.pesticide_id, supplier: d.supplier,
      source: 'agent', date: d.date, updated_by: `סוכן: ${ctx.tokenName}`,
    }, { uuidv4, NOW });
    console.log(`[MCP] token ${ctx.tokenId} saved pesticide_prices/${saved.id}`);
    return formatEntity(db.prepare("SELECT * FROM entities WHERE entity_type = 'pesticide_prices' AND id = ?").get(saved.id));
  }

  function checkEntity(entity, { write = false } = {}) {
    if (!Object.prototype.hasOwnProperty.call(ENTITIES, entity)) throw new Error(`Unknown or unavailable entity: ${entity}`);
    if (write && READ_ONLY.has(entity)) throw new Error(`${entity} is read-only via MCP`);
  }

  function clip(value) {
    if (typeof value === 'string') return value.length > MAX_STRING ? `${value.slice(0, 200)}… [truncated ${value.length} chars]` : value;
    if (Array.isArray(value)) return value.map(clip);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clip(v)]));
    return value;
  }

  function fetchRow(ctx, entity, id) {
    const row = db.prepare('SELECT * FROM entities WHERE entity_type = ? AND id = ?').get(entity, String(id));
    if (!row) throw new Error(`Not found: ${entity}/${id}`);
    const allowed = entity === 'farms' ? row.id === ctx.farmId
      : entity === 'pesticides' ? (row.farm_id === null || row.farm_id === ctx.farmId)
      : row.farm_id === ctx.farmId;
    if (!allowed) throw new Error(`Not found: ${entity}/${id}`);
    return row;
  }

  // ── Pest control helpers ──────────────────────────────────────────────────────
  const entityRows = (type, farmId) =>
    db.prepare('SELECT * FROM entities WHERE entity_type = ? AND farm_id = ?').all(type, farmId).map(formatEntity);

  function plotSeedingsOf(farmId, plotId) {
    const links = new Set(entityRows('plot_seedings', farmId).filter(l => l.plot_id === plotId).map(l => l.seeding_id));
    return entityRows('seedings', farmId)
      .filter(s => (links.has(s.id) || s.plot_id === plotId) && ACTIVE_SEEDING_STATUSES.includes(s.status));
  }

  function defaultSprayVolume(ctx, pesticides) {
    for (const p of pesticides) {
      if (p.unit !== '%' || !p.pesticide_id) continue;
      const row = db.prepare("SELECT data FROM entities WHERE entity_type = 'pesticides' AND id = ?").get(p.pesticide_id);
      const v = row && sprayVolumeFromText(JSON.parse(row.data || '{}').volume);
      if (v) return v;
    }
    return null;
  }

  function resolvePesticides(ctx, items) {
    if (!Array.isArray(items) || !items.length) throw new Error('pesticides: at least one item is required');
    const catalog = db.prepare("SELECT * FROM entities WHERE entity_type = 'pesticides' AND (farm_id IS NULL OR farm_id = ?)")
      .all(ctx.farmId).map(formatEntity);
    return items.map((it, i) => {
      let p = it.pesticide_id ? catalog.find(c => c.id === it.pesticide_id) : null;
      if (it.pesticide_id && !p) throw new Error(`pesticides[${i}]: unknown pesticide_id ${it.pesticide_id}`);
      if (!p && it.name) {
        const n = String(it.name).trim().toLowerCase();
        p = catalog.find(c => String(c.product_name || '').trim().toLowerCase() === n) || null;
      }
      if (!p && !it.name) throw new Error(`pesticides[${i}]: pesticide_id or name is required`);
      const m = String(p?.dosage || '').match(/(\d+(?:\.\d+)?)/);
      const dose = it.dosage_per_dunam != null ? Number(it.dosage_per_dunam) : (m ? parseFloat(m[1]) : null);
      if (dose != null && !(dose > 0)) throw new Error(`pesticides[${i}]: dosage_per_dunam must be positive`);
      // "1 אחוז" בקטלוג = ריכוז בתרסיס, לא מינון לדונם. נשמר עם unit '%' — בביצוע הכמות מחושבת בליטרים
      const unit = normDoseUnit(it.unit) || normDoseUnit(p?.unit) || doseUnitFromText(p?.dosage) || 'מ"ל';
      if (unit === '%' && dose != null && dose > 20) throw new Error(`pesticides[${i}]: a concentration of ${dose}% is not plausible`);
      return {
        pesticide_id: p?.id || null,
        pesticide_name: p?.product_name || String(it.name).trim(),
        active_ingredient: p?.active_ingredients || '',
        dosage_per_dunam: dose,
        unit,
        ...(p ? {} : { not_in_catalog: true }),
      };
    });
  }

  function normDoseUnit(u) {
    const s = String(u || '').trim();
    if (!s) return '';
    return /^(%|אחוז|percent)$/i.test(s) ? '%' : s;
  }
  function doseUnitFromText(t) {
    const d = String(t || '');
    if (!d) return '';
    return /אחוז|%/.test(d) ? '%' : d.includes('ליטר') ? 'ליטר' : d.includes('ק"ג') ? 'ק"ג' : d.includes('גרם') ? 'גרם' : '';
  }
  // נפח תרסיס מהקטלוג: "100 - 40 ליטר/דונם" → 100
  function sprayVolumeFromText(t) {
    const d = String(t || '');
    if (!d.includes('ליטר')) return null;
    const nums = (d.match(/\d+(?:\.\d+)?/g) || []).map(Number).filter(n => n > 0);
    return nums.length ? Math.max(...nums) : null;
  }
  function checkSprayVolume(v) {
    if (v !== undefined && v !== null && !(typeof v === 'number' && v > 0 && v <= 1000)) throw new Error('spray_volume_per_dunam must be a number of liters between 0 and 1000');
  }

  function checkEnum(name, value, allowed) {
    if (value !== undefined && !allowed.includes(value)) throw new Error(`${name} must be one of: ${allowed.join(', ')}`);
  }
  function checkDate(name, value) {
    if (value !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(value))) throw new Error(`${name} must be YYYY-MM-DD`);
  }

  function notifyFarm(farmId, title, body, type) {
    db.prepare('INSERT INTO notifications (id, recipient_id, farm_id, title, body, type, sent_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(uuidv4(), null, farmId, title, body, type, null, NOW());
  }

  function runTool(ctx, name, args) {
    switch (name) {
      case 'farm_overview': {
        const farmRow = db.prepare("SELECT * FROM entities WHERE entity_type = 'farms' AND id = ?").get(ctx.farmId);
        const counts = Object.fromEntries(
          db.prepare('SELECT entity_type, COUNT(*) AS n FROM entities WHERE farm_id = ? GROUP BY entity_type').all(ctx.farmId)
            .map(r => [r.entity_type, r.n]));
        return {
          farm: clip(formatEntity(farmRow)),
          access: ctx.canWrite ? 'read-write' : ctx.canWritePest ? 'read-only + pest-control write' : 'read-only',
          entities: entityEnum.map(e => ({ entity: e, description: ENTITIES[e], count: e === 'farms' ? 1 : (counts[e] || 0) })),
        };
      }

      case 'describe_entity': {
        checkEntity(args.entity);
        const r = listEntities(ctx.user, args.entity, { sort: '-updated_at', limit: '30' });
        if (r.status !== 200) throw new Error(r.body?.error || 'Error');
        const fields = {};
        for (const rec of r.body) {
          for (const [k, v] of Object.entries(rec)) {
            const f = fields[k] || (fields[k] = { types: new Set(), seen: 0, example: undefined });
            f.seen++;
            f.types.add(Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v);
            if (f.example === undefined && v !== null && v !== '') f.example = clip(typeof v === 'string' ? v.slice(0, 80) : v);
          }
        }
        const inferred = Object.entries(fields).map(([k, f]) => ({ field: k, types: [...f.types], present_in: f.seen, example: f.example }));
        const known = (KNOWN_FIELDS[args.entity] || []).filter(k => !fields[k.field]);
        return {
          entity: args.entity,
          description: ENTITIES[args.entity],
          sampled_records: r.body.length,
          fields: [...inferred.map(f => ({ ...f, ...((KNOWN_FIELDS[args.entity] || []).find(k => k.field === f.field) || {}), types: f.types })), ...known],
        };
      }

      case 'list_records': {
        checkEntity(args.entity);
        const query = {};
        for (const [k, v] of Object.entries(args.filters || {})) {
          if (!/^[A-Za-z0-9_]+$/.test(k)) throw new Error(`Bad filter field: ${k}`);
          // farm_id is fixed by the token; sort/limit/offset have their own arguments
          if (['sort', 'limit', 'offset', 'farm_id'].includes(k)) continue;
          if (v !== null && v !== undefined) query[k] = String(v);
        }
        query.sort = args.sort || '-created_at';
        const r = listEntities(ctx.user, args.entity, query);
        if (r.status !== 200) throw new Error(r.body?.error || 'Error');
        let rows = r.body;

        if (args.date_from || args.date_to) {
          const field = args.date_field || (rows.some(x => x.date) ? 'date' : 'created_at');
          const from = args.date_from ? String(args.date_from) : null;
          const to = args.date_to ? String(args.date_to) + '￿' : null; // inclusive of the whole day
          rows = rows.filter(x => {
            const v = x[field]; if (!v) return false;
            const s = String(v);
            return (!from || s >= from) && (!to || s <= to);
          });
        }
        if (args.search) {
          const needle = String(args.search).toLowerCase();
          rows = rows.filter(x => JSON.stringify(x).toLowerCase().includes(needle));
        }

        const limit = Math.min(Math.max(parseInt(args.limit, 10) || 50, 1), 500);
        const offset = Math.max(parseInt(args.offset, 10) || 0, 0);
        const page = rows.slice(offset, offset + limit);
        return { entity: args.entity, total: rows.length, offset, returned: page.length, records: clip(page) };
      }

      case 'get_record': {
        checkEntity(args.entity);
        return clip(formatEntity(fetchRow(ctx, args.entity, args.id)));
      }

      case 'create_record': {
        checkWriteAccess(ctx, args.entity);
        checkEntity(args.entity, { write: true });
        if (!args.data || typeof args.data !== 'object' || Array.isArray(args.data)) throw new Error('data must be an object');
        if (args.entity === 'pesticide_prices') return savePriceRecord(ctx, args.data);
        const id = uuidv4();
        const data = { ...(args.entity === 'pesticide_stock' ? validateStockMovement(ctx, args.data)
          : args.entity === 'employee_events' ? validateEmployeeEvent(ctx, args.data) : args.data), _by: `סוכן: ${ctx.tokenName}` };
        ['id', 'farm_id', 'created_at', 'updated_at'].forEach(k => delete data[k]);
        const now = NOW();
        db.prepare('INSERT INTO entities (id, entity_type, farm_id, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
          .run(id, args.entity, ctx.farmId, JSON.stringify(data), now, now);
        if (args.entity === 'activities' || args.entity === 'harvests') syncSeedingDates(data.seeding_id);
        if (args.entity === 'pesticide_stock') syncPurchasePrice(ctx, data);
        console.log(`[MCP] token ${ctx.tokenId} created ${args.entity}/${id}`);
        return formatEntity(db.prepare('SELECT * FROM entities WHERE entity_type = ? AND id = ?').get(args.entity, id));
      }

      case 'update_record': {
        checkWriteAccess(ctx, args.entity);
        checkEntity(args.entity, { write: true });
        if (!args.data || typeof args.data !== 'object' || Array.isArray(args.data)) throw new Error('data must be an object');
        const row = fetchRow(ctx, args.entity, args.id);
        let existing; try { existing = JSON.parse(row.data || '{}'); } catch { existing = {}; }
        if (args.entity === 'pesticide_prices') {
          if (args.data.product_name !== undefined && String(args.data.product_name).trim() !== existing.product_name) throw new Error('product_name of a price record cannot be changed; create a record for the other product');
          return savePriceRecord(ctx, { ...existing, ...args.data, product_name: existing.product_name });
        }
        let updated = { ...existing, ...args.data, _by: `סוכן: ${ctx.tokenName}` };
        ['id', 'farm_id', 'created_at', 'updated_at'].forEach(k => delete updated[k]);
        if (args.entity === 'employee_events') updated = { ...validateEmployeeEvent(ctx, updated), created_by: existing.created_by || '' };
        if (args.entity === 'pesticide_stock') updated = { ...validateStockMovement(ctx, updated), created_by: existing.created_by || '', updated_by: `סוכן: ${ctx.tokenName}`, _by: `סוכן: ${ctx.tokenName}` };
        db.prepare('UPDATE entities SET data = ?, updated_at = ? WHERE entity_type = ? AND id = ?')
          .run(JSON.stringify(updated), NOW(), args.entity, row.id);
        if (args.entity === 'activities' || args.entity === 'harvests') {
          syncSeedingDates(updated.seeding_id);
          if (existing.seeding_id && existing.seeding_id !== updated.seeding_id) syncSeedingDates(existing.seeding_id);
        }
        if (args.entity === 'pesticide_stock') syncPurchasePrice(ctx, updated);
        console.log(`[MCP] token ${ctx.tokenId} updated ${args.entity}/${row.id}`);
        return formatEntity(db.prepare('SELECT * FROM entities WHERE entity_type = ? AND id = ?').get(args.entity, row.id));
      }

      case 'pest_plot_context': {
        const days = Math.min(Math.max(parseInt(args.days, 10) || 60, 1), 365);
        const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
        const allPlots = entityRows('plots', ctx.farmId);
        const sprayings = entityRows('sprayings', ctx.farmId).filter(s => String(s.date || '') >= since);
        const recs = entityRows('pest_recommendations', ctx.farmId);
        const summarize = (plot) => {
          const seedings = plotSeedingsOf(ctx.farmId, plot.id);
          const seedingIds = new Set(seedings.map(s => s.id));
          return {
            plot: { id: plot.id, name: plot.name, size_dunam: plot.size ?? null, activity_status: plot.activity_status || 'active' },
            active_seedings: seedings.map(s => ({
              id: s.id, name: s.name, crop_type: s.crop_type || null, variety: s.variety_name || s.variety || null,
              status: s.status, total_area: s.total_area ?? null, seeding_date: s.seeding_date || s.date || null,
            })),
            recent_sprayings: sprayings.filter(s => s.plot_id === plot.id || seedingIds.has(s.seeding_id))
              .sort((a, b) => String(b.date).localeCompare(String(a.date)))
              .map(s => ({
                id: s.id, date: s.date, seeding_id: s.seeding_id || null, control_method: s.control_method || null,
                treatment_type: s.treatment_type || null,
                pesticides: (s.applied_pesticides || []).map(p => ({ name: p.pesticide_name, active_ingredient: p.active_ingredient || null, quantity: p.quantity, unit: p.unit })),
                notes: clip(s.notes || ''),
              })),
            pending_recommendations: recs.filter(r => r.plot_id === plot.id && (r.status || 'pending') === 'pending')
              .map(r => ({ id: r.id, pest: r.pest, severity: r.severity, due_date: r.due_date, source: r.source, pesticides: r.recommended_pesticides })),
          };
        };
        if (args.plot_id) {
          const plot = allPlots.find(p => p.id === args.plot_id);
          if (!plot) throw new Error(`Unknown plot_id: ${args.plot_id}`);
          return { since, ...summarize(plot) };
        }
        return {
          since,
          plots: allPlots.filter(p => p.activity_status !== 'inactive').map(summarize).map(x => ({
            plot: x.plot,
            active_seedings: x.active_seedings.map(s => `${s.name}${s.crop_type ? ` (${s.crop_type})` : ''}`),
            sprayings_in_period: x.recent_sprayings.length,
            last_spraying: x.recent_sprayings[0]?.date || null,
            pending_recommendations: x.pending_recommendations.length,
          })),
        };
      }

      case 'pesticide_stock': {
        const q = String(args.product || '').trim().toLowerCase();
        const products = computePesticideStock(db, ctx.farmId, { includeHistory: !!args.history })
          .filter(p => !q || p.product_name.toLowerCase().includes(q));
        return { products, note: products.length ? undefined : 'No tracked stock (nothing counted or purchased yet)' };
      }

      case 'update_pesticide_prices': {
        if (!ctx.canWritePest) throw new Error('This token cannot update pesticide prices');
        if (!Array.isArray(args.prices) || !args.prices.length) throw new Error('prices must be a non-empty array');
        if (args.prices.length > 100) throw new Error('At most 100 prices per call');
        // אימות הכול לפני כתיבה — כדי שלא יישמר חצי מהרשימה
        const items = args.prices.map((it, i) => {
          let name = String(it.product || '').trim();
          let catalog = null;
          if (it.pesticide_id) {
            catalog = db.prepare("SELECT data FROM entities WHERE entity_type = 'pesticides' AND id = ? AND (farm_id IS NULL OR farm_id = ?)").get(it.pesticide_id, ctx.farmId);
            if (!catalog) throw new Error(`prices[${i}]: unknown pesticide_id ${it.pesticide_id}`);
            name = JSON.parse(catalog.data || '{}').product_name || name;
          }
          if (!name) throw new Error(`prices[${i}]: product or pesticide_id is required`);
          if (it.price !== null && (typeof it.price !== 'number' || !Number.isFinite(it.price) || it.price < 0)) throw new Error(`prices[${i}]: price must be a non-negative number or null`);
          checkDate(`prices[${i}].date`, it.date);
          if (!catalog) catalog = db.prepare("SELECT id FROM entities WHERE entity_type = 'pesticides' AND (farm_id IS NULL OR farm_id = ?) AND json_extract(data, '$.product_name') = ? LIMIT 1").get(ctx.farmId, name);
          return { name, pesticide_id: it.pesticide_id || catalog?.id || null, in_catalog: !!catalog, it };
        });
        const results = db.transaction(() => items.map(({ name, pesticide_id, in_catalog, it }) => {
          const saved = upsertPesticidePrice(db, ctx.farmId, {
            product_name: name, price: it.price, unit: it.unit || 'ליטר', pesticide_id, supplier: it.supplier,
            source: 'agent', date: it.date, updated_by: `סוכן: ${ctx.tokenName}`,
          }, { uuidv4, NOW });
          const prev = (saved.history || []).slice(-1)[0];
          return { product: saved.product_name, price: saved.price, unit: saved.unit, previous: prev ? { price: prev.price, unit: prev.unit } : null, ...(in_catalog ? {} : { warning: 'not in catalog (saved by name)' }) };
        }))();
        console.log(`[MCP] token ${ctx.tokenId} updated ${results.length} pesticide prices`);
        return { updated: results };
      }

      case 'record_employee_event': {
        if (!ctx.canWrite) throw new Error('This token cannot write employee events (requires full write access)');
        const data = validateEmployeeEvent(ctx, args);
        const dup = data.source_ref && entityRows('employee_events', ctx.farmId).find(e =>
          e.employee_id === data.employee_id && e.event_type === data.event_type && e.source_ref === data.source_ref);
        if (dup) return { ...dup, already_recorded: true };
        const id = uuidv4(), now = NOW();
        db.prepare('INSERT INTO entities (id, entity_type, farm_id, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
          .run(id, 'employee_events', ctx.farmId, JSON.stringify(data), now, now);
        console.log(`[MCP] token ${ctx.tokenId} recorded employee_events/${id}`);
        return { ...formatEntity(db.prepare("SELECT * FROM entities WHERE entity_type = 'employee_events' AND id = ?").get(id)), event_label: EMPLOYEE_EVENT_TYPES[data.event_type] };
      }

      case 'propose_pest_action': {
        if (!ctx.canWritePest) throw new Error('This token cannot write pest control recommendations');
        const plot = entityRows('plots', ctx.farmId).find(p => p.id === args.plot_id);
        if (!plot) throw new Error(`Unknown plot_id: ${args.plot_id}`);
        let seeding = null;
        if (args.seeding_id) {
          seeding = plotSeedingsOf(ctx.farmId, plot.id).find(s => s.id === args.seeding_id);
          if (!seeding) throw new Error(`seeding_id ${args.seeding_id} is not an active seeding on plot ${plot.name}`);
        }
        const pest = String(args.pest || '').trim();
        if (!pest) throw new Error('pest is required');
        checkEnum('severity', args.severity, PEST_SEVERITIES);
        checkEnum('control_method', args.control_method, PEST_METHODS);
        checkEnum('treatment_type', args.treatment_type, PEST_TREATMENTS);
        checkDate('due_date', args.due_date);
        const pesticides = resolvePesticides(ctx, args.pesticides);
        checkSprayVolume(args.spray_volume_per_dunam);
        const sprayVolume = args.spray_volume_per_dunam ?? (pesticides.some(p => p.unit === '%') ? defaultSprayVolume(ctx, pesticides) : null);
        const today = new Date().toISOString().slice(0, 10);
        const data = {
          plot_id: plot.id, plot_name: plot.name || '',
          seeding_id: seeding?.id || null, seeding_name: seeding?.name || '',
          pest, severity: args.severity || 'medium',
          control_method: args.control_method || 'chemical',
          treatment_type: args.treatment_type || 'mechanized',
          recommended_pesticides: pesticides,
          due_date: args.due_date || new Date(Date.now() + 86400000).toISOString().slice(0, 10),
          notes: String(args.notes || '').trim(),
          ...(sprayVolume ? { spray_volume: sprayVolume } : {}),
          status: 'pending', source: 'agent',
          inspection_date: today, inspector_name: `סוכן: ${ctx.tokenName}`, mcp_token_id: ctx.tokenId,
        };
        const id = uuidv4(), now = NOW();
        db.prepare('INSERT INTO entities (id, entity_type, farm_id, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
          .run(id, 'pest_recommendations', ctx.farmId, JSON.stringify(data), now, now);
        notifyFarm(ctx.farmId, 'המלצת הדברה חדשה מהסוכן',
          `${pest} · ${plot.name}${seeding ? ` · ${seeding.name}` : ''} · ${pesticides.map(p => p.pesticide_name).join(', ')}`,
          data.severity === 'high' ? 'warning' : 'info');
        console.log(`[MCP] token ${ctx.tokenId} proposed pest_recommendations/${id}`);
        const unmatched = pesticides.filter(p => p.not_in_catalog).map(p => p.pesticide_name);
        const stock = computePesticideStock(db, ctx.farmId);
        const stock_check = pesticides.map(p => {
          const s = stock.find(x => x.product_name.trim().toLowerCase() === String(p.pesticide_name).trim().toLowerCase());
          return { product: p.pesticide_name, ...(s ? { balance: s.balance, unit: s.unit, status: s.status } : { status: 'not_tracked' }) };
        });
        return {
          ...formatEntity(db.prepare("SELECT * FROM entities WHERE entity_type = 'pest_recommendations' AND id = ?").get(id)),
          stock_check,
          ...(unmatched.length ? { warning: `Not found in the pesticides catalog (saved by name only): ${unmatched.join(', ')}` } : {}),
        };
      }

      case 'update_pest_action': {
        if (!ctx.canWritePest) throw new Error('This token cannot write pest control recommendations');
        const row = fetchRow(ctx, 'pest_recommendations', args.id);
        let existing; try { existing = JSON.parse(row.data || '{}'); } catch { existing = {}; }
        if ((existing.status || 'pending') !== 'pending') throw new Error(`Recommendation is ${existing.status}; only pending recommendations can be changed`);
        checkEnum('severity', args.severity, PEST_SEVERITIES);
        checkEnum('control_method', args.control_method, PEST_METHODS);
        checkEnum('treatment_type', args.treatment_type, PEST_TREATMENTS);
        checkDate('due_date', args.due_date);
        if (args.status !== undefined && args.status !== 'cancelled') throw new Error('status can only be set to "cancelled"');
        const patch = {};
        for (const k of ['severity', 'control_method', 'treatment_type', 'due_date']) if (args[k] !== undefined) patch[k] = args[k];
        if (args.pest !== undefined) { patch.pest = String(args.pest).trim(); if (!patch.pest) throw new Error('pest cannot be empty'); }
        if (args.notes !== undefined) patch.notes = String(args.notes).trim();
        if (args.pesticides !== undefined) patch.recommended_pesticides = resolvePesticides(ctx, args.pesticides);
        checkSprayVolume(args.spray_volume_per_dunam);
        if (args.spray_volume_per_dunam !== undefined) patch.spray_volume = args.spray_volume_per_dunam;
        if (args.status === 'cancelled') {
          Object.assign(patch, { status: 'cancelled', cancel_reason: String(args.cancel_reason || '').trim(), cancelled_at: NOW(), cancelled_by: `סוכן: ${ctx.tokenName}` });
        }
        if (!Object.keys(patch).length) throw new Error('Nothing to update');
        db.prepare('UPDATE entities SET data = ?, updated_at = ? WHERE entity_type = ? AND id = ?')
          .run(JSON.stringify({ ...existing, ...patch, updated_by: `סוכן: ${ctx.tokenName}` }), NOW(), 'pest_recommendations', row.id);
        console.log(`[MCP] token ${ctx.tokenId} updated pest_recommendations/${row.id}`);
        return formatEntity(db.prepare("SELECT * FROM entities WHERE entity_type = 'pest_recommendations' AND id = ?").get(row.id));
      }

      default:
        throw rpcError(-32602, `Unknown tool: ${name}`);
    }
  }
};
