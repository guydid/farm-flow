// ─── שיוך קבצים מהמייל לתיקי העובדים ────────────────────────────────────────────
// 1. תלושי שכר (למטה)  2. "דף רשימה" של ביטוח רפואי (הילית/איילון…) → medical_insurance_policies
// 3. כל קובץ אחר שמספר הדרכון של עובד מופיע בנושא המייל או בתוכן הקובץ → employee_documents ("אחר")
//
// ─── ייבוא תלושי שכר מהמייל לתיק העובד ───────────────────────────────────────────
// מנהלת השכר שולחת פעם בחודש, לכל חברה מעסיקה, PDF אחד עם כל העובדים — עמוד לעובד.
// כאן: חיפוש המיילים של השנה ב-Gmail המחובר, פיצול כל PDF לעמודים, זיהוי העובד בכל עמוד
// (מספר דרכון; גיבוי — שם מלא באנגלית, רק כשההתאמה חד-משמעית) והחודש ("5/2026"), ושמירה
// כישות payslips (hrDocs.js), כולל ברוטו / נטו / נטו לתשלום כשהם מזוהים בעמוד.
// הטקסט ב-PDF של תוכנת השכר מקודד בגופן מוזז: אותיות לטיניות/ספרות ב-29- ועברית ב-0x330-
// ("0$+(6+" = MAHESH). מפענחים את שתי הגרסאות ומחפשים בשתיהן.
// כפילויות: אותו עמוד (sha256) לא נשמר פעמיים. תלוש לאותו עובד+חודש ממייל מאוחר יותר
// (למשל "תלושים מתוקנים") מחליף את הקודם — אלא אם הקודם כבר נחתם.
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const normPassport = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const normName = (s) => String(s || '').toUpperCase().replace(/[^A-Z\s]/g, ' ').split(/\s+/).filter(t => t.length >= 2);

function decodeShifted(s) {
  let out = '';
  for (const ch of String(s || '')) {
    const c = ch.codePointAt(0);
    if (c >= 0x02A0 && c <= 0x02BA) out += String.fromCodePoint(c + 0x330);
    else if (c >= 0x03 && c <= 0x5D) out += String.fromCodePoint(c + 29);
    else out += ch;
  }
  return out;
}

// עמודי ה-PDF → [{ index, items: [מחרוזות], text, pos: [{ s, x, y }] }] (גם מקור וגם מפוענח)
async function readPdfPages(buf) {
  const pdfParse = require('pdf-parse');
  const pages = [];
  await pdfParse(buf, {
    pagerender: async (p) => {
      const t = await p.getTextContent();
      pages.push(t.items.map(i => ({ str: i.str, x: i.transform?.[4] || 0, y: i.transform?.[5] || 0 })));
      return '';
    },
  });
  return pages.map((its, index) => {
    const raw = its.map(i => i.str);
    // מפענחים רק מסמך בגופן המוזז (תווי U+02A0–U+02BA); מסמך רגיל נשאר כמו שהוא
    const shifted = raw.some(t => /[ʠ-ʺ]/.test(t));
    const dec = shifted ? raw.map(decodeShifted) : raw;
    const items = [...raw, ...dec].map(s => s.trim()).filter(Boolean);
    const pos = its.map((i, k) => ({ s: dec[k].trim(), x: i.x, y: i.y })).filter(i => i.s);
    return { index, items, text: items.join(' | '), pos };
  });
}

// גיבוי: pdftotext (poppler, מותקן בשרת) כש-pdf-parse נכשל על PDF חריג. בלי מיקומים — סכומי תלוש לא יחושבו.
function readPdfPagesFallback(buf) {
  const os = require('os');
  return new Promise((resolve, reject) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-txt-'));
    const f = path.join(dir, 'in.pdf');
    fs.writeFileSync(f, buf);
    require('child_process').execFile('pdftotext', ['-layout', '-enc', 'UTF-8', f, '-'], { timeout: 30000, maxBuffer: 20 * 1024 * 1024 }, (err, stdout) => {
      fs.rmSync(dir, { recursive: true, force: true });
      if (err) return reject(err);
      const pages = String(stdout).split('\f').filter((t, i, a) => t.trim() || i < a.length - 1).map((t, index) => {
        const items = t.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
        return { index, items, text: items.join(' | '), pos: items.map((s2, k) => ({ s: s2, x: 0, y: -k })) };
      });
      resolve(pages);
    });
  });
}
async function readPdfPagesSafe(buf) {
  try { return await readPdfPages(buf); }
  catch { try { return await readPdfPagesFallback(buf); } catch { return null; } }
}

// סכומים לפי מיקום: הערך באותה שורה (±6pt) משמאל לתווית, הקרוב ביותר אליה.
// התוויות בטקסט הגולמי הפוכות (RTL): "םימולשת כ"הס" = סה"כ תשלומים.
const AMOUNT_LABELS = {
  gross: [/םימולשת\s*כ"הס/, /סה"כ\s*תשלומים/, /וטורב\s*רכש/, /שכר\s*ברוטו/],
  net: [/^וטנ\s*רכש$/, /^שכר\s*נטו$/],
  net_to_pay: [/םולשתל\s*וטנ/, /נטו\s*לתשלום/],
};
function pageAmounts(page) {
  const out = { gross: null, net: null, net_to_pay: null };
  const nums = (page.pos || []).filter(i => /^-?[\d,]+\.\d{2}$/.test(i.s));
  for (const [key, res] of Object.entries(AMOUNT_LABELS)) {
    const label = (page.pos || []).find(i => res.some(r => r.test(i.s)));
    if (!label) continue;
    const cand = nums.filter(n => Math.abs(n.y - label.y) <= 6 && n.x < label.x).sort((a, b) => b.x - a.x)[0];
    if (cand) { const v = parseFloat(cand.s.replace(/,/g, '')); if (Number.isFinite(v) && v >= 0) out[key] = v; }
  }
  return out;
}

const isPayslipPage = (text) => /תלוש|שולת/.test(text) && /משכורת|תרוכשמ|שכר|רכש/.test(text);

function pagePeriod(items) {
  for (const s of items) {
    const m = s.match(/^(\d{1,2})\/(20\d{2})$/);
    if (m && +m[1] >= 1 && +m[1] <= 12) return `${m[2]}-${String(m[1]).padStart(2, '0')}`;
  }
  return null;
}
const subjectPeriod = (subject) => {
  const m = String(subject || '').match(/(?:^|\D)(\d{1,2})[./](\d{2}|20\d{2})(?!\d)/);
  if (!m || +m[1] < 1 || +m[1] > 12) return null;
  const y = m[2].length === 2 ? `20${m[2]}` : m[2];
  return `${y}-${String(m[1]).padStart(2, '0')}`;
};
const subjectEmployer = (subject) => {
  const m = String(subject || '').replace(/^(?:\s*(?:fwd?|re)\s*:\s*)+/i, '').match(/^חברה\s+([^:]{2,40}):/);
  return m ? m[1].trim() : null;
};

function matchEmployee(page, employees) {
  const flat = normPassport(page.items.join(''));
  const itemSet = new Set(page.items.map(normPassport));
  const byPassport = employees.filter(e => {
    const p = normPassport(e.passport_number);
    return p.length >= 6 && (itemSet.has(p) || flat.includes(p));
  });
  if (byPassport.length === 1) return { employee: byPassport[0], by: 'passport' };
  // שם: כל מילות השם (2 לפחות) מופיעות כפריטים בעמוד
  const tokens = new Set(page.items.flatMap(normName));
  const byName = employees.filter(e => {
    const n = normName(e.full_name || `${e.first_name || ''} ${e.last_name || ''}`);
    return n.length >= 2 && n.every(t => tokens.has(t));
  });
  if (byName.length === 1) return { employee: byName[0], by: 'name' };
  return null;
}

// מה שמוצג למשתמש על עמוד שלא שויך: שמות לטיניים ומספרים שנראים כמו דרכון
function unmatchedHint(page) {
  const names = page.items.filter(s => /^[A-Z][A-Z .'-]{2,30}$/.test(s) && !/^(PDF|TOTAL)$/.test(s));
  const passports = page.items.filter(s => /^(?=.*\d)(?=.*[A-Z])[A-Z0-9]{6,12}$/.test(s));
  return { name: [...new Set(names)].slice(0, 3).join(' '), passport: passports[0] || null };
}

// ── "דף רשימה" לביטוח הוצאות רפואיות (עובד זר) ──
const isPolicySchedule = (text) => /רשימה\s*לביטוח\s*הוצאות\s*רפואיות|ביטוח\s*רפואי\s*לעובד\s*זר/.test(text);
const dmyToIso = (s) => { const m = String(s || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null; };
const HEALTH_FUNDS = ['כללית', 'מכבי', 'מאוחדת', 'לאומית'];
function parsePolicy(pages) {
  const text = pages.map(p => p.pos.map(i => i.s).join(' | ')).join(' || ');
  const out = {};
  const ins = text.match(/([א-ת"'״]+(?:\s+[א-ת"'״]+)?)\s+חברה\s+לביטוח/);
  if (ins) out.insurance_company = `${ins[1].trim()} חברה לביטוח`;
  const pol = text.match(/פוליסה\s*:\s*([\d][\d\-\/]{4,})/);
  if (pol) out.policy_number = pol[1];
  const per = text.match(/מ-\s*(\d{1,2}\/\d{1,2}\/\d{4})[^|]*?עד[-\s]*(\d{1,2}\/\d{1,2}\/\d{4})/) || text.match(/מ-\s*(\d{1,2}\/\d{1,2}\/\d{4})[\s\S]{0,120}?עד-?\s*(\d{1,2}\/\d{1,2}\/\d{4})/);
  if (per) { out.start_date = dmyToIso(per[1]); out.end_date = dmyToIso(per[2]); }
  const pp = text.match(/([A-Z]{0,2}\d{6,9})\s*:\s*מספר\s*דרכון/) || text.match(/מספר\s*דרכון\s*:\s*([A-Z]{0,2}\d{6,9})/);
  if (pp) out.passport = pp[1];
  for (const f of HEALTH_FUNDS) {
    const m = text.match(new RegExp(`([\\d\\/]{6,})\\s*:\\s*ת\\.ז\\.\\s*${f}`)) || text.match(new RegExp(`ת\\.ז\\.\\s*${f}\\s*:\\s*([\\d\\/]{6,})`));
    if (m || new RegExp(`קופ"ח\\s*${f}`).test(text)) { out.health_fund = f; if (m) out.health_fund_number = m[1]; break; }
  }
  const agent = text.match(/שם\s+הסוכן\s*:\s*([^|]+)/);
  out.agent = agent ? agent[1].trim().replace(/\s+/g, ' ') : (/הילית/.test(text) ? "הילית סוכנות לביטוח" : null);
  return out;
}
// קבצים כלליים שזהים לכל העובדים (תנאי פוליסה) — לא משייכים
const GENERIC_FILE = /worker_policy|policy_(heb|en)|תנאי.?(ה)?פוליסה/i;

function makePayslipImporter(deps) {
  const { db, NOW, uuidv4, UPLOADS_DIR, gmail } = deps;
  const TYPE = 'payslips';
  const hr = require('./hrDocs').makeHrCore({ db, NOW, uuidv4 });

  const employeesOf = (farmId) => db.prepare("SELECT id, data FROM entities WHERE entity_type='employees' AND farm_id=?").all(farmId)
    .map(r => { try { return { id: r.id, ...JSON.parse(r.data || '{}') }; } catch { return null; } }).filter(Boolean);
  const payslipsOf = (farmId) => db.prepare('SELECT id, data FROM entities WHERE entity_type=? AND farm_id=?').all(TYPE, farmId)
    .map(r => { try { return { id: r.id, ...JSON.parse(r.data || '{}') }; } catch { return null; } }).filter(Boolean);

  const saveFile = (buf, farmId, originalName, prefix = 'payslip', ext = '.pdf') => {
    const name = `${prefix}_${uuidv4()}${ext}`;
    fs.writeFileSync(path.join(UPLOADS_DIR, name), buf);
    const now = NOW();
    db.prepare("INSERT OR REPLACE INTO entities (id, entity_type, farm_id, data, created_at, updated_at) VALUES (?, 'uploads', ?, ?, ?, ?)")
      .run(`up_${name}`, farmId, JSON.stringify({ filename: name, original_name: originalName, size: buf.length, uploader_id: null }), now, now);
    return name;
  };

  // ליבה: PDF אחד (מתוך מייל) → תלושים בתיקי העובדים. ניתן לבדיקה בלי Gmail.
  async function importPdf(farmId, buf, meta, state) {
    const { PDFDocument } = require('pdf-lib');
    let pages;
    try { pages = meta.pages || await readPdfPages(buf); } catch { return false; }
    const slips = pages.filter(p => isPayslipPage(p.text));
    if (!slips.length) return false;
    const src = await PDFDocument.load(buf, { ignoreEncryption: true });
    const employees = employeesOf(farmId);
    const fallbackPeriod = subjectPeriod(meta.subject);
    for (const page of slips) {
      state.pages++;
      const period = pagePeriod(page.items) || fallbackPeriod;
      if (!period || (state.year && !period.startsWith(`${state.year}-`))) { state.other_year++; continue; }
      const m = matchEmployee(page, employees);
      if (!m) {
        const hint = { period, employer: meta.employer, ...unmatchedHint(page) };
        if (!state.unmatched.some(u => u.period === hint.period && u.name === hint.name && u.passport === hint.passport)) state.unmatched.push(hint);
        continue;
      }

      const one = await PDFDocument.create();
      const [pg] = await one.copyPages(src, [page.index]);
      one.addPage(pg);
      const out = Buffer.from(await one.save());
      const pageSha = sha256(page.text); // תוכן העמוד — יציב גם כשה-PDF נשלח מחדש
      const existing = payslipsOf(farmId).filter(d => d.employee_id === m.employee.id && d.period === period);
      if (existing.some(d => d.source_meta?.page_sha256 === pageSha)) { state.duplicates++; continue; }
      const prev = existing.find(d => d.source === 'gmail_payslip');
      const source_meta = { message_id: meta.message_id, subject: meta.subject, date: meta.date, attachment_name: meta.attachment_name, page: page.index + 1, page_sha256: pageSha, matched_by: m.by };
      const title = `תלוש שכר ${period.slice(5, 7)}/${period.slice(0, 4)}`;
      const amounts = pageAmounts(page);
      const periodFields = { period, year: +period.slice(0, 4), month: +period.slice(5, 7), period_start: `${period}-01` };
      if (prev) {
        if ((prev.source_meta?.date || '') >= (meta.date || '')) { state.duplicates++; continue; } // הקיים חדש יותר
        if (prev.sign?.status === 'signed') { state.kept_signed++; continue; }
        const fname = saveFile(out, farmId, `${title}.pdf`);
        const { id, ...rest } = prev;
        const next = { ...rest, ...periodFields, ...amounts, file_url: `${state.urlBase}/uploads/${fname}`, file_name: `${title}.pdf`, employer: meta.employer || rest.employer || null, source_meta, sign: { status: 'none' } };
        db.prepare('UPDATE entities SET data=?, updated_at=? WHERE id=? AND entity_type=?').run(JSON.stringify(next), NOW(), id, TYPE);
        state.replaced++;
      } else {
        const fname = saveFile(out, farmId, `${title}.pdf`);
        const now = NOW();
        db.prepare('INSERT INTO entities (id, entity_type, farm_id, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(uuidv4(), TYPE, farmId, JSON.stringify({
          employee_id: m.employee.id, employee_name: m.employee.full_name || [m.employee.first_name, m.employee.last_name].filter(Boolean).join(' ') || null,
          category: 'payslip', ...periodFields, ...amounts, title,
          file_url: `${state.urlBase}/uploads/${fname}`, file_name: `${title}.pdf`,
          employer: meta.employer || null, uploaded_by: 'ייבוא מהמייל', source: 'gmail_payslip', source_meta, sign: { status: 'none' },
        }), now, now);
        state.created++;
      }
      state.employees.add(m.employee.id);
      state.months.add(period);
    }
    return true;
  }

  // עובדים שמספר הדרכון שלהם מופיע בנושא המייל / בטקסט הקובץ
  const employeesByPassport = (farmId, ...texts) => {
    const flat = texts.map(t => normPassport(t)).join('|');
    return employeesOf(farmId).filter(e => { const p = normPassport(e.passport_number); return p.length >= 6 && flat.includes(p); });
  };
  const empName = (e) => e.full_name || [e.first_name, e.last_name].filter(Boolean).join(' ') || null;
  const docsOf = (farmId, type, employeeId) => db.prepare(`SELECT id, data FROM entities WHERE entity_type=? AND farm_id=? AND json_extract(data,'$.employee_id')=?`).all(type, farmId, employeeId)
    .map(r => { try { return { id: r.id, ...JSON.parse(r.data || '{}') }; } catch { return null; } }).filter(Boolean);
  const cleanSubject = (s) => String(s || '').replace(/^(?:\s*(?:fwd?|fw|re)\s*:\s*)+/i, '').replace(/\s+/g, ' ').trim();

  // "דף רשימה" לביטוח רפואי → פוליסה (היסטוריה: רשומה לכל פוליסה/תקופה)
  async function importPolicy(farmId, buf, pages, meta, state) {
    const p = parsePolicy(pages);
    const text = pages.map(x => x.text).join(' ');
    let matches = p.passport ? employeesByPassport(farmId, p.passport) : [];
    if (!matches.length) matches = employeesByPassport(farmId, meta.subject, text);
    if (matches.length !== 1) { state.unmatched_files.push({ kind: 'ביטוח רפואי', subject: cleanSubject(meta.subject).slice(0, 100), file: meta.attachment_name, passport: p.passport || null }); return; }
    const emp = matches[0];
    const sha = sha256(buf);
    const existing = docsOf(farmId, 'medical_insurance_policies', emp.id);
    if (existing.some(d => d.source_meta?.file_sha256 === sha || (p.policy_number && d.policy_number === p.policy_number && (d.start_date || null) === (p.start_date || null)))) { state.policies_dup++; return; }
    const fname = saveFile(buf, farmId, meta.attachment_name || 'policy.pdf', 'policy');
    hr.create(farmId, 'medical_insurance_policies', {
      employee_id: emp.id, insurance_company: p.insurance_company || (/הילית/.test(text) ? 'לא צוין (הילית)' : 'לא צוין'),
      policy_number: p.policy_number || null, start_date: p.start_date || null, end_date: p.end_date || null,
      agent: p.agent || null, health_fund: p.health_fund || null, health_fund_number: p.health_fund_number || null,
      file_url: `${state.urlBase}/uploads/${fname}`, file_name: meta.attachment_name || null,
      source: 'gmail', source_meta: { message_id: meta.message_id, subject: meta.subject, date: meta.date, attachment_name: meta.attachment_name, file_sha256: sha },
    }, 'ייבוא מהמייל');
    state.policies_created++;
    state.employees.add(emp.id);
  }

  // כל קובץ אחר עם דרכון של עובד → "אחר" בתיק (עד 5 עובדים לקובץ — רשימה ארוכה יותר היא דוח כללי)
  async function importOther(farmId, buf, ext, pages, meta, state) {
    if (GENERIC_FILE.test(meta.attachment_name || '')) { state.skipped_generic++; return; }
    const text = pages ? pages.map(x => x.text).join(' ') : '';
    const matches = employeesByPassport(farmId, meta.subject, meta.attachment_name, text);
    if (!matches.length) return;
    if (matches.length > 5) { state.unmatched_files.push({ kind: 'מסמך', subject: cleanSubject(meta.subject).slice(0, 100), file: meta.attachment_name, passport: `${matches.length} עובדים` }); return; }
    const sha = sha256(buf);
    let fname = null;
    for (const emp of matches) {
      if (docsOf(farmId, 'employee_documents', emp.id).some(d => d.source_meta?.file_sha256 === sha)) { state.documents_dup++; continue; }
      fname = fname || saveFile(buf, farmId, meta.attachment_name || `document${ext}`, 'empdoc', ext);
      const title = [cleanSubject(meta.subject), meta.attachment_name].filter(Boolean).join(' — ').slice(0, 120);
      hr.create(farmId, 'employee_documents', {
        employee_id: emp.id, title, file_url: `${state.urlBase}/uploads/${fname}`, file_name: meta.attachment_name || null,
        source: 'gmail', source_meta: { message_id: meta.message_id, subject: meta.subject, date: meta.date, attachment_name: meta.attachment_name, file_sha256: sha, matched_by: 'passport' },
      }, 'ייבוא מהמייל');
      state.documents_created++;
      state.employees.add(emp.id);
    }
  }

  // קובץ מצורף אחד → המסלול המתאים
  async function routeAttachment(farmId, buf, meta, state) {
    const isPdf = /\.pdf$/i.test(meta.attachment_name || '') || /pdf/i.test(meta.mimeType || '');
    if (isPdf) {
      const pages = await readPdfPagesSafe(buf);
      if (pages && await importPdf(farmId, buf, { ...meta, pages }, state)) return;
      if (pages && isPolicySchedule(pages.map(x => x.text).join(' '))) return importPolicy(farmId, buf, pages, meta, state);
      return importOther(farmId, buf, '.pdf', pages, meta, state);
    }
    const ext = (String(meta.attachment_name || '').match(/\.(jpe?g|png|webp)$/i)?.[0] || '.jpg').toLowerCase();
    return importOther(farmId, buf, ext, null, meta, state);
  }

  // ריצה מלאה מול Gmail (ברקע; state מתעדכן להתקדמות)
  async function importFromGmail(farmId, conn, state) {
    const token = await gmail.ensureGmailAccessToken(farmId, conn);
    const y = state.year;
    // מילות מפתח + מספרי הדרכון של העובדים (בנתחים — שאילתת Gmail מוגבלת באורך)
    const words = '(תלוש OR תלושי OR תלושים OR payslip OR subject:שכר OR דרכון OR passport OR ביטוח OR פוליסה OR "דף רשימה" OR הילית OR hilit OR 106 OR אשרה OR ויזה OR visa OR חוזה)';
    const passports = [...new Set(employeesOf(farmId).map(e => normPassport(e.passport_number)).filter(x => x.length >= 6))];
    const groups = [words];
    for (let i = 0; i < passports.length; i += 25) groups.push(`(${passports.slice(i, i + 25).join(' OR ')})`);
    const seen = new Set();
    const msgs = [];
    for (const g of groups) {
      const q = `has:attachment -from:me after:${y}/01/01 before:${y + 1}/01/01 ${g}`;
      let pageToken = null;
      do {
        const list = await gmail.gmailApiGet(token, `/gmail/v1/users/me/messages?q=${encodeURIComponent(q)}&maxResults=100${pageToken ? `&pageToken=${pageToken}` : ''}`);
        for (const m of list.messages || []) if (!seen.has(m.id)) { seen.add(m.id); msgs.push(m); }
        pageToken = list.nextPageToken || null;
      } while (pageToken && msgs.length < 800);
    }
    state.total = msgs.length;
    const metas = [];
    for (const msg of msgs) {
      const full = await gmail.gmailApiGet(token, `/gmail/v1/users/me/messages/${msg.id}?format=full`);
      const headers = full.payload?.headers || [];
      const subject = gmail.getHeader(headers, 'Subject') || '';
      metas.push({ id: msg.id, full, subject, date: new Date(Number(full.internalDate) || Date.now()).toISOString() });
    }
    metas.sort((a, b) => a.date.localeCompare(b.date)); // מהישן לחדש — "מתוקנים" מאוחרים מחליפים
    for (const m of metas) {
      state.scanned++;
      const atts = gmail.collectInvoiceAttachments(m.full.payload);
      for (const att of atts) {
        try {
          const res = await gmail.gmailApiGet(token, `/gmail/v1/users/me/messages/${m.id}/attachments/${att.attachmentId}`);
          state.files++;
          await routeAttachment(farmId, gmail.b64urlToBuffer(res.data), { message_id: m.id, subject: m.subject, date: m.date, attachment_name: att.filename, mimeType: att.mimeType, employer: subjectEmployer(m.subject) }, state);
        } catch (e) {
          state.errors.push(`${m.subject.slice(0, 60)}: ${String(e.message || e).slice(0, 120)}`);
        }
      }
    }
  }

  return { importPdf, importPolicy, importOther, routeAttachment, importFromGmail };
}

// POST /api/employee-documents/import-gmail { year } — מתחיל ריצה ברקע (אחת למשק)
// GET  /api/employee-documents/import-gmail          — מצב הריצה האחרונה
function registerPayslipImportRoutes(app, deps) {
  const { db, getUser, authMiddleware, getFarmMember, gmail } = deps;
  const importer = makePayslipImporter(deps);
  const jobs = new Map(); // farmId → state

  const ctxOf = (req, res) => {
    const user = getUser(req.user.id);
    const farmId = req.query.farm_id || req.body?.farm_id || user?.current_farm_id;
    if (!user || !farmId) { res.status(400).json({ error: 'No farm selected' }); return null; }
    if (!user.is_admin && !['owner', 'manager'].includes(getFarmMember(farmId, user.id)?.role)) { res.status(403).json({ error: 'בעלים ומנהלים בלבד' }); return null; }
    return { user, farmId };
  };
  const view = (s) => s && ({
    status: s.status, year: s.year, started_at: s.started_at, finished_at: s.finished_at || null,
    total: s.total, scanned: s.scanned, pages: s.pages, created: s.created, replaced: s.replaced,
    duplicates: s.duplicates, kept_signed: s.kept_signed, other_year: s.other_year,
    employees: s.employees.size, months: [...s.months].sort(), unmatched: s.unmatched.slice(0, 200),
    files: s.files, policies_created: s.policies_created, policies_dup: s.policies_dup,
    documents_created: s.documents_created, documents_dup: s.documents_dup, skipped_generic: s.skipped_generic,
    unmatched_files: s.unmatched_files.slice(0, 100),
    errors: s.errors.slice(0, 20), error: s.error || null,
  });

  app.get('/api/employee-documents/import-gmail', authMiddleware, (req, res) => {
    const ctx = ctxOf(req, res); if (!ctx) return;
    res.json(view(jobs.get(ctx.farmId)) || { status: 'idle' });
  });

  app.post('/api/employee-documents/import-gmail', authMiddleware, (req, res) => {
    const ctx = ctxOf(req, res); if (!ctx) return;
    const year = parseInt(req.body?.year, 10);
    if (!(year >= 2015 && year <= 2100)) return res.status(400).json({ error: 'שנה לא תקינה' });
    if (jobs.get(ctx.farmId)?.status === 'running') return res.status(409).json({ error: 'ייבוא כבר רץ', ...view(jobs.get(ctx.farmId)) });
    let conn = gmail.getGmailConnectionForUser(ctx.farmId, ctx.user.id);
    if (!conn) {
      const r = db.prepare("SELECT id, data FROM entities WHERE entity_type='gmail_connections' AND farm_id=? LIMIT 1").get(ctx.farmId);
      if (r) { try { conn = { id: r.id, ...JSON.parse(r.data || '{}') }; } catch { conn = null; } }
    }
    if (!conn) return res.status(400).json({ error: 'אין חיבור Gmail למשק. חבר את Gmail בהגדרות ← Gmail.' });
    const host = (req.headers['x-forwarded-host'] || req.headers.host || 'localhost').split(':')[0];
    const state = {
      status: 'running', year, started_at: new Date().toISOString(), urlBase: `${req.headers['x-forwarded-proto'] || 'http'}://${host}`,
      total: 0, scanned: 0, pages: 0, created: 0, replaced: 0, duplicates: 0, kept_signed: 0, other_year: 0,
      employees: new Set(), months: new Set(), unmatched: [], errors: [],
      files: 0, policies_created: 0, policies_dup: 0, documents_created: 0, documents_dup: 0, skipped_generic: 0, unmatched_files: [],
    };
    jobs.set(ctx.farmId, state);
    importer.importFromGmail(ctx.farmId, conn, state)
      .then(() => { state.status = 'done'; })
      .catch((e) => {
        state.status = 'error';
        const msg = String(e.message || e);
        state.error = /invalid_grant|Refresh failed/i.test(msg) ? 'החיבור ל-Gmail פג. חבר מחדש בהגדרות ← Gmail.' : msg.slice(0, 200);
        console.error('[payslip-import]', msg.slice(0, 200));
      })
      .finally(() => { state.finished_at = new Date().toISOString(); });
    res.json(view(state));
  });
}

module.exports = { readPdfPagesSafe, parsePolicy, isPolicySchedule, registerPayslipImportRoutes, makePayslipImporter, decodeShifted, readPdfPages, pageAmounts, pagePeriod, subjectPeriod, subjectEmployer, matchEmployee, isPayslipPage };
