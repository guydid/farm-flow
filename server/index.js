import express from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import * as cheerio from 'cheerio';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const app = express();
app.use(cors({ origin: true })); // Allow all origins in local development
app.use(express.json({ limit: '10mb' }));
app.use('/uploads', express.static(UPLOADS_DIR));

// --- Data helpers ---
function readData(name) {
  const file = path.join(DATA_DIR, `${name}.json`);
  if (!fs.existsSync(file)) return [];
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return []; }
}

function writeData(name, data) {
  fs.writeFileSync(path.join(DATA_DIR, `${name}.json`), JSON.stringify(data, null, 2));
}

// --- Seed default data ---
function seedDefaultData() {
  if (!fs.existsSync(path.join(DATA_DIR, 'users.json'))) {
    writeData('users', [{
      id: 'local-user-1',
      full_name: 'משתמש מקומי',
      email: 'admin@farmflow.local',
      farm_ids: ['local-farm-1'],
      current_farm_id: 'local-farm-1',
      role: 'admin'
    }]);
  }
  if (!fs.existsSync(path.join(DATA_DIR, 'farms.json'))) {
    writeData('farms', [{
      id: 'local-farm-1',
      name: 'משק מקומי',
      created_date: new Date().toISOString()
    }]);
  }
}
seedDefaultData();

// --- Auth routes ---
app.get('/api/auth/me', (req, res) => {
  const users = readData('users');
  res.json(users[0] || null);
});

app.put('/api/auth/me', (req, res) => {
  const users = readData('users');
  if (!users.length) return res.status(404).json({ error: 'User not found' });
  users[0] = { ...users[0], ...req.body };
  writeData('users', users);
  res.json(users[0]);
});

// --- File upload ---
const upload = multer({ dest: UPLOADS_DIR });
app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const url = `http://localhost:3001/uploads/${req.file.filename}`;
  res.json({ url, file_url: url });
});

// --- Entity CRUD ---

// GET list / filter
app.get('/api/:entity', (req, res) => {
  const data = readData(req.params.entity);
  const filters = req.query;
  if (!Object.keys(filters).length) return res.json(data);
  const filtered = data.filter(item =>
    Object.entries(filters).every(([k, v]) => String(item[k]) === String(v))
  );
  res.json(filtered);
});

// GET by id
app.get('/api/:entity/:id', (req, res) => {
  const data = readData(req.params.entity);
  const item = data.find(d => d.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  res.json(item);
});

// POST create (single or bulk array)
app.post('/api/:entity', (req, res) => {
  const data = readData(req.params.entity);
  if (Array.isArray(req.body)) {
    const newItems = req.body.map(item => ({
      ...item,
      id: item.id || uuidv4(),
      created_date: item.created_date || new Date().toISOString()
    }));
    data.push(...newItems);
    writeData(req.params.entity, data);
    return res.json(newItems);
  }
  const newItem = { ...req.body, id: req.body.id || uuidv4(), created_date: new Date().toISOString() };
  data.push(newItem);
  writeData(req.params.entity, data);
  res.json(newItem);
});

// PUT update
app.put('/api/:entity/:id', (req, res) => {
  const data = readData(req.params.entity);
  const idx = data.findIndex(d => d.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  data[idx] = { ...data[idx], ...req.body };
  writeData(req.params.entity, data);
  res.json(data[idx]);
});

// DELETE
app.delete('/api/:entity/:id', (req, res) => {
  const data = readData(req.params.entity);
  writeData(req.params.entity, data.filter(d => d.id !== req.params.id));
  res.json({ success: true });
});

// --- Functions (replaces Base44 serverless functions) ---
app.post('/api/functions/:name', async (req, res) => {
  const { name } = req.params;

  if (name === 'importPesticides') {
    try {
      const GOV_API = 'https://data.gov.il/api/3/action/datastore_search';
      const RESOURCE_ID = 'cffe0c50-6856-4187-9315-51bc113cb718';
      const pageSize = 1000;

      const activityToType = (act) => {
        if (!act) return 'other';
        if (act.includes('חרק') || act.includes('אקרי')) return 'insecticide';
        if (act.includes('פטר')) return 'fungicide';
        if (act.includes('עשב')) return 'herbicide';
        return 'other';
      };

      // cropGroups: array of Hebrew group names, or empty = all
      const cropGroups = Array.isArray(req.body?.cropGroups) && req.body.cropGroups.length > 0
        ? req.body.cropGroups : null;

      const existing = readData('pesticides');
      const existingNums = new Set(existing.map(p => p.registration_number).filter(Boolean));
      let added = 0, skipped = 0;

      const processRecords = (records) => {
        for (const r of records) {
          const regNum = String(r['מספר רשיון'] || '').trim();
          const productName = String(r['שם תכשיר'] || '').trim();
          if (!productName || existingNums.has(regNum)) { skipped++; continue; }
          existing.push({
            id: uuidv4(),
            created_date: new Date().toISOString(),
            registration_number: regNum,
            product_name: productName,
            manufacturer: String(r['בעל רשיון'] || r['יצרן פורמולציה'] || '').trim(),
            active_ingredients: String(r['חומר פעיל'] || '').trim(),
            product_type: activityToType(r['סוג פעילות']),
            concentration: String(r['ריכוז חומר פעיל'] || '').trim(),
            crop: String(r['גידול'] || '').trim(),
            pest: String(r['נגע'] || '').trim(),
            label_url: String(r['תווית'] || '').trim(),
            dosage: String(r['מינון ליישום'] || '').trim(),
            toxicity: String(r['רעילות'] || '').trim(),
            formulation: String(r['פורמולציה'] || '').trim(),
          });
          if (regNum) existingNums.add(regNum);
          added++;
        }
      };

      if (cropGroups) {
        // Fetch per group using filters - much faster and targeted
        console.log(`Importing pesticides for groups: ${cropGroups.join(', ')}`);
        for (const group of cropGroups) {
          let offset = 0, groupTotal = null;
          const filters = JSON.stringify({ 'קבוצת גידולים': group });
          do {
            const url = `${GOV_API}?resource_id=${RESOURCE_ID}&limit=${pageSize}&offset=${offset}&filters=${encodeURIComponent(filters)}`;
            const govRes = await fetch(url);
            const govData = await govRes.json();
            if (!govData.success || !govData.result?.records?.length) break;
            if (groupTotal === null) {
              groupTotal = govData.result.total;
              console.log(`Group "${group}": ${groupTotal} records`);
            }
            processRecords(govData.result.records);
            offset += pageSize;
          } while (offset < groupTotal);
        }
      } else {
        // Full import - all records
        let offset = 0, total = null;
        console.log('Starting full pesticides import...');
        do {
          const url = `${GOV_API}?resource_id=${RESOURCE_ID}&limit=${pageSize}&offset=${offset}`;
          const govRes = await fetch(url);
          const govData = await govRes.json();
          if (!govData.success || !govData.result?.records?.length) break;
          if (total === null) { total = govData.result.total; console.log(`Total: ${total}`); }
          processRecords(govData.result.records);
          offset += pageSize;
          console.log(`Processed ${Math.min(offset, total)}/${total}, ${added} unique so far`);
        } while (offset < total);
      }

      writeData('pesticides', existing);
      return res.json({ data: { success: true, stats: { new: added, skipped } } });

    } catch (err) {
      console.error('importPesticides error:', err);
      return res.json({ data: { success: false, error: err.message } });
    }
  }

  // ── Fetch market prices from Plants Council ──────────────────
  if (name === 'fetchMarketPrices') {
    try {
      const res2 = await fetch('https://plants.moonsite.co.il/', {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'he-IL,he;q=0.9,en;q=0.8'
        }
      });
      if (!res2.ok) throw new Error(`HTTP ${res2.status}`);
      const html = await res2.text();
      const $ = cheerio.load(html);

      const prices = [];
      const parsePrice = (s) => {
        const n = parseFloat((s || '').replace(/[^\d.]/g, ''));
        return isNaN(n) ? null : n;
      };

      // Find the price table: first row contains תאריך + שם ירק
      let priceTable = null;
      $('table').each((i, t) => {
        const headerCells = $(t).find('tr:first-child td, tr:first-child th').map((j,c) => $(c).text().trim()).get();
        if (headerCells.includes('תאריך') && (headerCells.includes('שם ירק') || headerCells.includes('שם פרי'))) {
          priceTable = t;
          return false; // stop
        }
      });

      if (!priceTable) throw new Error('לא נמצאה טבלת מחירים בדף');

      let fetchedDate = null;
      $(priceTable).find('tr').each((i, row) => {
        if (i === 0) return; // skip header
        const cells = $(row).find('td');
        if (cells.length < 3) return;
        const dateCell = $(cells[0]).text().trim();
        const nameCell = $(cells[1]).text().trim();
        const gradeA   = $(cells[2]).text().trim();
        const premium  = cells.length >= 4 ? $(cells[3]).text().trim() : '';
        if (!nameCell) return;
        if (!fetchedDate && dateCell) fetchedDate = dateCell;
        prices.push({
          date: dateCell || fetchedDate,
          name: nameCell,
          grade_a: parsePrice(gradeA),
          premium: parsePrice(premium)
        });
      });

      // Deduplicate by name (keep latest)
      const seen = new Map();
      for (const p of prices) {
        if (!seen.has(p.name)) seen.set(p.name, p);
      }
      const unique = [...seen.values()];

      // Cache the result
      const cacheFile = path.join(DATA_DIR, 'market_prices_cache.json');
      fs.writeFileSync(cacheFile, JSON.stringify({ fetched_at: new Date().toISOString(), prices: unique }, null, 2));

      return res.json({ data: { success: true, prices: unique, count: unique.length, fetched_at: new Date().toISOString() } });
    } catch (err) {
      console.error('fetchMarketPrices error:', err.message);
      // Try to return cached data if available
      const cacheFile = path.join(DATA_DIR, 'market_prices_cache.json');
      if (fs.existsSync(cacheFile)) {
        const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
        return res.json({ data: { success: true, prices: cached.prices, count: cached.prices.length, fetched_at: cached.fetched_at, from_cache: true } });
      }
      return res.json({ data: { success: false, error: err.message } });
    }
  }

  res.json({ data: {} });
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`Farm Flow local API running on http://localhost:${PORT}`);
});
