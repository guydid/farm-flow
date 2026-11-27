// ─── דף שעות חודשי לעובד (מתוך שעון הנוכחות) → PDF דו-לשוני ────────────────────
// נשמר על רשומת התלוש (payslips.timesheet) ונחתם ע"י העובד יחד עם התלוש באותו קישור.
// נתונים: attendance_records (עובד/יום) של מספרי השעון של העובד — employees.time_clock_id
// או clock_workers שקושרו לעובד (employee_id).
// ל-pdf-lib אין עברית: גופן Noto Sans Hebrew (fonts/) לאותיות עבריות + Helvetica לספרות/לטינית,
// וסידור חזותי מימין-לשמאל פשוט (מספיק לכותרות ולשמות — הטבלה עצמה מספרים).
const path = require('path');
const fs = require('fs');

const FONT_DIR = path.join(__dirname, 'fonts');
const HEB = /[֐-׿]/;
const HEB_RUN = /([֐-׿](?:[֐-׿\s"'׳״-]*[֐-׿])?)/;
const DAYS_HE = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const DAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// טקסט לוגי → סדר חזותי (משמאל לימין) לפסקה מימין-לשמאל
function visualOrder(text) {
  const s = String(text ?? '');
  if (!HEB.test(s)) return s;
  const segs = s.split(HEB_RUN).filter(x => x !== '');
  const out = [];
  for (const seg of segs.reverse()) {
    if (HEB.test(seg)) { out.push([...seg].reverse().join('').replace(/[()]/g, c => (c === '(' ? ')' : '('))); continue; }
    const m = seg.match(/^([^A-Za-z0-9]*)(.*?)([^A-Za-z0-9]*)$/s);
    const rev = (x) => [...x].reverse().join('').replace(/[()]/g, c => (c === '(' ? ')' : '('));
    out.push(rev(m[3]) + m[2] + rev(m[1]));
  }
  return out.join('');
}

const fmtTime = (t) => { const m = String(t || '').match(/(\d{1,2}):(\d{2})/); return m ? `${m[1].padStart(2, '0')}:${m[2]}` : ''; };
const fmtHours = (h) => (Number(h) || 0).toFixed(2);
const pad = (n) => String(n).padStart(2, '0');

// מספרי השעון של העובד
function clockIdsOf(db, farmId, employee) {
  const ids = new Set();
  if (employee.time_clock_id) ids.add(String(employee.time_clock_id).trim());
  for (const r of db.prepare("SELECT data FROM entities WHERE entity_type='clock_workers' AND farm_id=?").all(farmId)) {
    try { const d = JSON.parse(r.data || '{}'); if (d.employee_id === employee.id && d.time_clock_id) ids.add(String(d.time_clock_id).trim()); } catch { /* skip */ }
  }
  ids.delete('');
  return ids;
}

// שורות החודש: יום → כניסה ראשונה, יציאה אחרונה, שעות (כמה מספרי שעון לאותו עובד — מסוכמים)
function collectHours(db, farmId, employee, period) {
  const ids = clockIdsOf(db, farmId, employee);
  if (!ids.size) return { ids: [], rows: [] };
  const byDate = new Map();
  const recs = db.prepare("SELECT data FROM entities WHERE entity_type='attendance_records' AND farm_id=? AND json_extract(data,'$.date') LIKE ?").all(farmId, `${period}-%`);
  for (const r of recs) {
    let d; try { d = JSON.parse(r.data || '{}'); } catch { continue; }
    if (!ids.has(String(d.time_clock_id || '').trim())) continue;
    const cur = byDate.get(d.date) || { date: d.date, first_in: null, last_out: null, hours: 0, complete: true };
    const fi = fmtTime(d.first_in), lo = fmtTime(d.last_out);
    if (fi && (!cur.first_in || fi < cur.first_in)) cur.first_in = fi;
    if (lo && (!cur.last_out || lo > cur.last_out)) cur.last_out = lo;
    cur.hours += Number(d.hours) || 0;
    if (d.complete === false || (fi && !lo)) cur.complete = false;
    byDate.set(d.date, cur);
  }
  const rows = [...byDate.values()].filter(x => x.first_in || x.last_out || x.hours > 0).sort((a, b) => a.date.localeCompare(b.date));
  for (const x of rows) x.hours = Math.round(x.hours * 100) / 100;
  return { ids: [...ids], rows };
}

async function buildTimesheetPdf({ farmName, employee, period, rows, employer }) {
  const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
  const fontkit = require('@pdf-lib/fontkit');
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const heb = await pdf.embedFont(fs.readFileSync(path.join(FONT_DIR, 'NotoSansHebrew.ttf')), { subset: true });
  const hebB = await pdf.embedFont(fs.readFileSync(path.join(FONT_DIR, 'NotoSansHebrew-Bold.ttf')), { subset: true });
  const lat = await pdf.embedFont(StandardFonts.Helvetica);
  const latB = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = 595, H = 842, M = 40;
  const page = pdf.addPage([W, H]);
  const grey = rgb(0.45, 0.45, 0.45), line = rgb(0.8, 0.8, 0.8);

  // ריצות לפי גופן (עברית / השאר); תווים שאין ב-WinAnsi מוחלפים
  const runs = (vis, bold) => {
    const out = [];
    for (const ch of vis) {
      const isHeb = HEB.test(ch);
      const f = isHeb ? (bold ? hebB : heb) : (bold ? latB : lat);
      const c = isHeb ? ch : (/[\x20-\x7E -ÿ–—’‘“”•…]/.test(ch) ? ch : '?');
      const last = out[out.length - 1];
      if (last && last.f === f) last.t += c; else out.push({ f, t: c });
    }
    return out;
  };
  const width = (text, size, bold) => runs(visualOrder(text), bold).reduce((s, r) => s + r.f.widthOfTextAtSize(r.t, size), 0);
  // align: 'right' (x = קצה ימני) | 'left' | 'center'
  const text = (t, x, y, { size = 10, bold = false, color, align = 'right' } = {}) => {
    const vis = visualOrder(t);
    const w = width(t, size, bold);
    let cx = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
    // fontkit הופך בעצמו ריצה עברית (כתב RTL) — מעבירים אותה הפוכה כדי שהתוצאה תהיה בסדר החזותי שחושב
    for (const r of runs(vis, bold)) {
      const t = (r.f === heb || r.f === hebB) ? [...r.t].reverse().join('') : r.t;
      page.drawText(t, { x: cx, y, size, font: r.f, color }); cx += r.f.widthOfTextAtSize(r.t, size);
    }
  };

  const [yy, mm] = period.split('-').map(Number);
  const empName = employee.full_name || [employee.first_name, employee.last_name].filter(Boolean).join(' ');
  let y = H - M - 10;
  text('דף שעות חודשי', W - M, y, { size: 18, bold: true });
  text('Monthly hours sheet', M, y, { size: 14, bold: true, align: 'left' });
  y -= 26;
  text(`חודש: ${pad(mm)}/${yy}`, W - M, y, { size: 11 });
  text(`Month: ${pad(mm)}/${yy}`, M, y, { size: 11, align: 'left' });
  y -= 18;
  text(`עובד: ${empName}`, W - M, y, { size: 11 });
  text(`Employee: ${empName}`, M, y, { size: 11, align: 'left' });
  y -= 16;
  if (employee.passport_number) { text(`דרכון: ${employee.passport_number}`, W - M, y, { size: 10, color: grey }); text(`Passport: ${employee.passport_number}`, M, y, { size: 10, color: grey, align: 'left' }); y -= 16; }
  const org = employer || farmName;
  if (org) { text(`מעסיק: ${org}`, W - M, y, { size: 10, color: grey }); y -= 16; }

  // טבלה — עמודות מימין לשמאל
  const cols = [
    { he: 'תאריך', en: 'Date', w: 95 },
    { he: 'יום', en: 'Day', w: 75 },
    { he: 'כניסה', en: 'In', w: 95 },
    { he: 'יציאה', en: 'Out', w: 95 },
    { he: 'שעות', en: 'Hours', w: 95 },
  ];
  const tableW = cols.reduce((s, c) => s + c.w, 0);
  const right = W - (W - tableW) / 2;
  let x = right; for (const c of cols) { c.right = x; c.center = x - c.w / 2; x -= c.w; }
  const left = x;
  y -= 10;
  page.drawRectangle({ x: left, y: y - 26, width: tableW, height: 30, color: rgb(0.93, 0.95, 0.93) });
  for (const c of cols) { text(c.he, c.center, y - 8, { size: 10, bold: true, align: 'center' }); text(c.en, c.center, y - 21, { size: 8, color: grey, align: 'center' }); }
  y -= 26;
  const rowH = rows.length > 26 ? 15.5 : 17;
  let total = 0, missing = 0;
  for (const r of rows) {
    const dt = new Date(`${r.date}T12:00:00Z`);
    const dow = dt.getUTCDay();
    y -= rowH;
    if (dow === 6) page.drawRectangle({ x: left, y: y - 4, width: tableW, height: rowH, color: rgb(0.97, 0.97, 0.97) });
    const vals = [`${pad(dt.getUTCDate())}/${pad(mm)}/${yy}`, `${DAYS_HE[dow]} ${DAYS_EN[dow]}`, r.first_in || '—', r.last_out || '—', fmtHours(r.hours) + (r.complete ? '' : ' *')];
    cols.forEach((c, i) => text(vals[i], c.center, y, { size: 10, align: 'center' }));
    page.drawLine({ start: { x: left, y: y - 4 }, end: { x: right, y: y - 4 }, thickness: 0.5, color: line });
    total += Number(r.hours) || 0;
    if (!r.complete) missing++;
  }
  if (!rows.length) { y -= 22; text('אין החתמות בשעון לחודש זה', W / 2, y, { size: 11, align: 'center', color: grey }); text('No time-clock records this month', W / 2, y - 14, { size: 9, align: 'center', color: grey }); y -= 14; }
  y -= 26;
  text(`ימי עבודה: ${rows.length}`, W - M, y, { size: 12, bold: true });
  text(`Work days: ${rows.length}`, M, y, { size: 12, bold: true, align: 'left' });
  y -= 18;
  text(`סה"כ שעות: ${fmtHours(total)}`, W - M, y, { size: 12, bold: true });
  text(`Total hours: ${fmtHours(total)}`, M, y, { size: 12, bold: true, align: 'left' });
  if (missing) { y -= 16; text('* חסרה החתמת כניסה/יציאה', W - M, y, { size: 9, color: grey }); text('* missing clock-in/out punch', M, y, { size: 9, color: grey, align: 'left' }); }

  // אישור העובד — מעל אזור החתימה (החותמת נכנסת בפינה השמאלית התחתונה)
  const fy = Math.min(y - 30, 190);
  text('אני מאשר/ת שהשעות המפורטות לעיל נכונות.', W - M, fy, { size: 11 });
  text('I confirm that the hours listed above are correct.', M, fy - 16, { size: 10, align: 'left' });
  text('Employee signature', M, fy - 40, { size: 9, color: grey, align: 'left' });
  text('חתימת העובד', M + 150, fy - 40, { size: 9, color: grey, align: 'left' });
  page.drawText(`Generated by Farm Flow from the time clock · ${new Date().toISOString().slice(0, 10)}`, { x: W - M - lat.widthOfTextAtSize(`Generated by Farm Flow from the time clock · ${new Date().toISOString().slice(0, 10)}`, 7), y: 14, size: 7, font: lat, color: grey });
  pdf.setTitle(`Hours ${period} ${empName}`); pdf.setProducer('Farm Flow');
  return { bytes: Buffer.from(await pdf.save()), total_hours: Math.round(total * 100) / 100, days: rows.length, missing };
}

module.exports = { visualOrder, collectHours, clockIdsOf, buildTimesheetPdf };
