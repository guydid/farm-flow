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
  employee_events:         'אירועי עובד',
  employee_logs:           'יומני עבודה של עובדים',
  manpower_companies:      'חברות כוח אדם',
  temp_worker_groups:      'קבוצות עובדים זמניים',
  attendance_records:      'רשומות נוכחות משעון (worker per day)',
  clock_workers:           'עובדים רשומים בשעון הנוכחות',
  vehicles:                'כלי רכב',
  vehicle_treatments:      'טיפולי רכב',
  company_settings:        'פרטי חברה',
};
const READ_ONLY = new Set(['farms', 'pesticides']);
const MAX_STRING = 2000; // long strings (base64 images, OCR text) are truncated in output

module.exports = function mountMcp(app, { db, listEntities, formatEntity, getUser, getFarmMember, authMiddleware, uuidv4, NOW, syncSeedingDates }) {
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
      SELECT t.id, t.name, t.token_prefix, t.can_write, t.revoked, t.created_at, t.last_used_at, u.email AS user_email
      FROM mcp_tokens t LEFT JOIN users u ON u.id = t.user_id
      WHERE t.farm_id = ? ORDER BY t.created_at DESC`).all(user.current_farm_id);
    res.json(rows.map(r => ({ ...r, can_write: !!r.can_write, revoked: !!r.revoked })));
  });

  app.post('/api/mcp/tokens', authMiddleware, (req, res) => {
    const user = requireFarmManager(req, res); if (!user) return;
    const name = String(req.body?.name || '').trim().slice(0, 80) || 'סוכן חיצוני';
    const token = 'ffmcp_' + crypto.randomBytes(32).toString('hex');
    const id = uuidv4();
    db.prepare(`INSERT INTO mcp_tokens (id, user_id, farm_id, name, token_hash, token_prefix, can_write, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, user.id, user.current_farm_id, name, hashToken(token), token.slice(0, 12), req.body?.can_write ? 1 : 0, NOW());
    // The plain token is returned exactly once — only its hash is stored.
    res.status(201).json({ id, name, token, can_write: !!req.body?.can_write });
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
      farmId: row.farm_id,
      canWrite: !!row.can_write && member?.role !== 'viewer',
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
    ];
    if (ctx.canWrite) {
      tools.push(
        {
          name: 'create_record',
          title: 'Create record',
          description: 'Creates a record in this farm. Call describe_entity first so the field names match existing records.',
          inputSchema: {
            type: 'object',
            properties: { entity: { type: 'string', enum: writableEnum }, data: { type: 'object' } },
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
            properties: { entity: { type: 'string', enum: writableEnum }, id: { type: 'string' }, data: { type: 'object' } },
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

  function runTool(ctx, name, args) {
    switch (name) {
      case 'farm_overview': {
        const farmRow = db.prepare("SELECT * FROM entities WHERE entity_type = 'farms' AND id = ?").get(ctx.farmId);
        const counts = Object.fromEntries(
          db.prepare('SELECT entity_type, COUNT(*) AS n FROM entities WHERE farm_id = ? GROUP BY entity_type').all(ctx.farmId)
            .map(r => [r.entity_type, r.n]));
        return {
          farm: clip(formatEntity(farmRow)),
          access: ctx.canWrite ? 'read-write' : 'read-only',
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
        return {
          entity: args.entity,
          description: ENTITIES[args.entity],
          sampled_records: r.body.length,
          fields: Object.entries(fields).map(([k, f]) => ({ field: k, types: [...f.types], present_in: f.seen, example: f.example })),
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
        if (!ctx.canWrite) throw new Error('This token is read-only');
        checkEntity(args.entity, { write: true });
        if (!args.data || typeof args.data !== 'object' || Array.isArray(args.data)) throw new Error('data must be an object');
        const id = uuidv4();
        const data = { ...args.data };
        ['id', 'farm_id', 'created_at', 'updated_at'].forEach(k => delete data[k]);
        const now = NOW();
        db.prepare('INSERT INTO entities (id, entity_type, farm_id, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
          .run(id, args.entity, ctx.farmId, JSON.stringify(data), now, now);
        if (args.entity === 'activities' || args.entity === 'harvests') syncSeedingDates(data.seeding_id);
        console.log(`[MCP] token ${ctx.tokenId} created ${args.entity}/${id}`);
        return formatEntity(db.prepare('SELECT * FROM entities WHERE entity_type = ? AND id = ?').get(args.entity, id));
      }

      case 'update_record': {
        if (!ctx.canWrite) throw new Error('This token is read-only');
        checkEntity(args.entity, { write: true });
        if (!args.data || typeof args.data !== 'object' || Array.isArray(args.data)) throw new Error('data must be an object');
        const row = fetchRow(ctx, args.entity, args.id);
        let existing; try { existing = JSON.parse(row.data || '{}'); } catch { existing = {}; }
        const updated = { ...existing, ...args.data };
        ['id', 'farm_id', 'created_at', 'updated_at'].forEach(k => delete updated[k]);
        db.prepare('UPDATE entities SET data = ?, updated_at = ? WHERE entity_type = ? AND id = ?')
          .run(JSON.stringify(updated), NOW(), args.entity, row.id);
        if (args.entity === 'activities' || args.entity === 'harvests') {
          syncSeedingDates(updated.seeding_id);
          if (existing.seeding_id && existing.seeding_id !== updated.seeding_id) syncSeedingDates(existing.seeding_id);
        }
        console.log(`[MCP] token ${ctx.tokenId} updated ${args.entity}/${row.id}`);
        return formatEntity(db.prepare('SELECT * FROM entities WHERE entity_type = ? AND id = ?').get(args.entity, row.id));
      }

      default:
        throw rpcError(-32602, `Unknown tool: ${name}`);
    }
  }
};
