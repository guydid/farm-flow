// יצירת PDF וקטורי לתעודת שקילה (טקסט אמיתי, לא צילום מסך).
// משתמש ב-jsPDF עם גופן Heebo מוטמע ובסידור ויזואלי ידני של טקסט עברי (RTL).
import { format } from 'date-fns';

const PAGE_W = 210, PAGE_H = 297, MARGIN = 12;
const CONTENT_W = PAGE_W - MARGIN * 2;
const RIGHT = PAGE_W - MARGIN, LEFT = MARGIN;

const VEHICLE_TYPES = { truck: 'משאית', van: 'מסחרית', pickup: 'טנדר', trailer: 'נגרר' };
const STATUSES = { draft: 'טיוטה', completed: 'הושלם', shipped: 'נשלח' };

// ---------- RTL: סידור ויזואלי לטקסט עברי עם מספרים/לטינית ----------
// jsPDF מפעיל מנוע bidi משלו על כל טקסט: במצב ברירת המחדל (isInputVisual:true) הוא
// הופך רצפי מספרים/לטינית ומשאיר עברית כמו שהיא, ובמצב isInputVisual:false הוא לא נוגע
// בטקסט כלל (נבדק מול jspdf 2.5.2). לכן אנחנו מסדרים את הטקסט ויזואלית בעצמנו (rtl)
// ומעבירים isInputVisual:false כדי שהמנוע לא יקלקל.
const MIRROR = { '(': ')', ')': '(', '[': ']', ']': '[', '{': '}', '}': '{', '<': '>', '>': '<' };
const LTR_RUN = /[A-Za-z0-9₪][A-Za-z0-9₪%@_.,:/\-]*/g;
const hasHebrew = (s) => /[֐-׿]/.test(s);
const BIDI_OFF = { isInputVisual: false };

/** מחזיר את המחרוזת בסדר ויזואלי לציור משמאל לימין. */
export function rtl(input) {
  const s = String(input ?? '');
  if (!hasHebrew(s)) return s; // טקסט לטיני/מספרי בלבד נשאר כפי שהוא
  // רצפים LTR (מספרים, לטינית) נשמרים בסדרם הפנימי: הופכים אותם מראש כדי שההיפוך הכללי יחזיר אותם
  const prepared = s.replace(LTR_RUN, (run) => {
    const m = run.match(/^(.*?)([.,:/\-]*)$/); // פיסוק בסוף הרצף שייך למשפט, לא למספר
    const core = m[1], tail = m[2];
    return [...core].reverse().join('') + [...tail].reverse().join('');
  });
  return [...prepared].reverse().map((ch) => MIRROR[ch] || ch).join('');
}

// ---------- גופנים ----------
let fontCache = null;
async function fetchBase64(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`font ${url}: ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
export async function ensureFonts(doc) {
  if (!fontCache) {
    fontCache = Promise.all([fetchBase64('/fonts/Heebo-Regular.ttf'), fetchBase64('/fonts/Heebo-Bold.ttf')])
      .catch((e) => { fontCache = null; throw e; });
  }
  const [regular, bold] = await fontCache;
  doc.addFileToVFS('Heebo-Regular.ttf', regular);
  doc.addFont('Heebo-Regular.ttf', 'Heebo', 'normal');
  doc.addFileToVFS('Heebo-Bold.ttf', bold);
  doc.addFont('Heebo-Bold.ttf', 'Heebo', 'bold');
  doc.setFont('Heebo', 'normal');
}

// ---------- QR (אותו שירות שמשמש את תצוגת ההדפסה) ----------
async function fetchQrDataUrl(data) {
  if (!data) return null;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(`https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(data)}&size=240x240&qzone=1`, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => resolve(null);
      r.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

// ---------- עזרי ציור ----------
const num = (v, digits = 1) => (Number(v) || 0).toLocaleString('he-IL', { maximumFractionDigits: digits });
const money = (v) => `₪${(Number(v) || 0).toLocaleString('he-IL', { maximumFractionDigits: 2 })}`;

function makeWriter(doc) {
  const text = (str, x, y, { align = 'right', size = 9, bold = false, color = 0 } = {}) => {
    const s = String(str ?? '');
    doc.setFont('Heebo', bold ? 'bold' : 'normal'); doc.setFontSize(size); doc.setTextColor(color);
    doc.text(rtl(s), x, y, { align, ...BIDI_OFF });
  };
  /** טקסט שנחתך עם "…" אם רחב מהעמודה */
  const fit = (str, maxW, size) => {
    doc.setFontSize(size);
    let s = String(str ?? '');
    if (doc.getTextWidth(s) <= maxW) return s;
    while (s.length > 1 && doc.getTextWidth(s + '…') > maxW) s = s.slice(0, -1);
    return s + '…';
  };
  /** שורות גלושות (בסדר לוגי), לפי רוחב */
  const wrap = (str, maxW, size, bold = false) => {
    doc.setFont('Heebo', bold ? 'bold' : 'normal'); doc.setFontSize(size);
    return doc.splitTextToSize(String(str ?? ''), maxW);
  };
  return { text, fit, wrap };
}

function groupItems(items) {
  const groups = new Map();
  for (const it of items) {
    if (!it || typeof it !== 'object') continue;
    const key = `${it.product_name || 'ללא שם'}_${it.quality || 'לא צוין'}`;
    if (!groups.has(key)) groups.set(key, { product_name: it.product_name || 'ללא שם מוצר', quality: it.quality || 'לא צוין', items: [], w: 0, p: 0, a: 0 });
    const g = groups.get(key);
    g.items.push(it);
    g.w += parseFloat(it.net_weight || 0);
    g.p += parseInt(it.package_count || 0, 10) || 0;
    g.a += parseFloat(it.item_total || 0);
  }
  return [...groups.values()];
}

// עמודות הטבלה מימין לשמאל (רוחב במ"מ, סה"כ = CONTENT_W)
const COLUMNS = [
  { key: 'product', label: 'מוצר', w: 34, align: 'right' },
  { key: 'quality', label: 'איכות', w: 14, align: 'center' },
  { key: 'packaging', label: 'אריזה', w: 22, align: 'center' },
  { key: 'count', label: 'אריזות', w: 14, align: 'center' },
  { key: 'gross', label: 'ברוטו ק"ג', w: 18, align: 'center' },
  { key: 'tare', label: 'טרה ק"ג', w: 16, align: 'center' },
  { key: 'net', label: 'נטו ק"ג', w: 18, align: 'center' },
  { key: 'price', label: 'מחיר', w: 18, align: 'center' },
  { key: 'discount', label: 'הנחה', w: 12, align: 'center' },
  { key: 'total', label: 'סה"כ', w: 20, align: 'center' },
];
// מיקומי x: העמודה הראשונה צמודה לימין
(function layoutColumns() {
  let x = RIGHT;
  for (const c of COLUMNS) { c.x2 = x; c.x1 = x - c.w; x = c.x1; }
})();

/**
 * בונה PDF של תעודת שקילה. מחזיר { blob, doc }.
 * @param {{certificate:object, items:object[], companySettings?:object, customer?:object}} data
 */
export async function buildCertificatePdf({ certificate, items, companySettings = {}, customer = {} }) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4', compress: true });
  await ensureFonts(doc);
  const { text, fit, wrap } = makeWriter(doc);
  const cert = certificate || {}, co = companySettings || {}, cu = customer || {};
  const qr = await fetchQrDataUrl(cert.barcode);
  const certNum = cert.reference_number || String(cert.id || '').slice(-5) || 'לא זמין';
  // תעודת כניסה (קליטת תוצרת מספק) — אותו PDF עם כותרת/צד/חתימה של ספק
  const isEntry = cert._doc_kind === 'entry';
  const DOC_TITLE = isEntry ? 'תעודת כניסה' : 'תעודת שקילה';

  let y = MARGIN;
  const ensureSpace = (h) => {
    if (y + h <= PAGE_H - MARGIN - 8) return false;
    doc.addPage(); y = MARGIN; return true;
  };

  // ---- כותרת: משק מימין, שם המסמך + QR משמאל (כמו תצוגת ההדפסה) ----
  const headerTop = y;
  text(co.company_name || 'שם המשק', RIGHT, y + 6, { size: 14, bold: true });
  const coLines = [
    co.business_number ? `ע.מ/ח.פ ${co.business_number}` : null,
    [co.address, co.city].filter(Boolean).join(', ') || null,
    [co.phone && `טלפון ${co.phone}`, co.email].filter(Boolean).join(' · ') || null,
  ].filter(Boolean);
  coLines.forEach((l, i) => text(l, RIGHT, y + 11.5 + i * 4, { size: 8, color: 70 }));
  let titleX = LEFT;
  if (qr) {
    try {
      doc.addImage(qr, 'PNG', LEFT, y, 20, 20);
      text(String(cert.barcode), LEFT + 10, y + 23, { align: 'center', size: 6, color: 90 });
      titleX = LEFT + 24;
    } catch {
      /* ללא QR */
    }
  }
  const titleLines = [
    [`מס' ${certNum}`, 11, true, 0],
    [`${cert.date ? format(new Date(cert.date), 'dd/MM/yyyy') : 'לא צוין'}${cert.time ? ` · ${cert.time}` : ''}`, 8, false, 70],
    cert.status ? [`סטטוס: ${STATUSES[cert.status] || cert.status}`, 8, false, 70] : null,
  ].filter(Boolean);
  text(DOC_TITLE, titleX, y + 6.5, { align: 'left', size: 16, bold: true });
  titleLines.forEach(([l, size, bold, color], i) => text(l, titleX, y + 12 + i * 4.3, { align: 'left', size, bold, color }));
  y = headerTop + 27;
  doc.setDrawColor(17); doc.setLineWidth(0.7); doc.line(LEFT, y, RIGHT, y);
  y += 5;

  // ---- לקוח / הובלה ----
  const boxGap = 4, boxW = (CONTENT_W - boxGap) / 2;
  const custLines = [
    ['שם', cu.name || cert.customer_name || 'לא צוין'],
    cu.address ? ['כתובת', cu.address] : null,
    cu.phone ? ['טלפון', cu.phone] : null,
    cu.contact_person ? ['איש קשר', cu.contact_person] : null,
  ].filter(Boolean);
  const transLines = [
    ['נהג', cert.driver_name || 'לא צוין'],
    ['רכב', [VEHICLE_TYPES[cert.vehicle_type] || cert.vehicle_type, cert.vehicle_number].filter(Boolean).join(' · ') || 'לא צוין'],
  ];
  const boxH = 11 + Math.max(custLines.length, transLines.length) * 4.4;
  const drawBox = (x1, title, lines) => {
    doc.setDrawColor(156, 163, 175); doc.setLineWidth(0.25); doc.roundedRect(x1, y, boxW, boxH, 1.5, 1.5, 'S');
    text(title, x1 + boxW - 3, y + 4.5, { size: 7.5, bold: true, color: 85 });
    doc.setDrawColor(229, 231, 235); doc.setLineWidth(0.2); doc.line(x1 + 3, y + 6.2, x1 + boxW - 3, y + 6.2);
    lines.forEach(([k, v], i) => {
      const ly = y + 10.5 + i * 4.4;
      text(k, x1 + boxW - 3, ly, { size: 8.5, color: 85 });
      text(fit(v, boxW - 26, 8.5), x1 + boxW - 23, ly, { size: 8.5, bold: true });
    });
  };
  drawBox(RIGHT - boxW, isEntry ? 'ספק' : 'לקוח', custLines);
  drawBox(LEFT, 'הובלה', transLines);
  y += boxH + 5;

  // ---- הערות ----
  if (cert.notes && String(cert.notes).trim()) {
    const lines = wrap(String(cert.notes).trim(), CONTENT_W - 22, 8.5);
    const h = 4.5 + lines.length * 4.4;
    ensureSpace(h);
    doc.setDrawColor(156, 163, 175); doc.setLineWidth(0.25); doc.roundedRect(LEFT, y, CONTENT_W, h, 1.5, 1.5, 'S');
    text('הערות:', RIGHT - 3, y + 5, { size: 8.5, bold: true, color: 85 });
    lines.forEach((l, i) => text(l, RIGHT - 17, y + 5 + i * 4.4, { size: 8.5 }));
    y += h + 5;
  }

  // ---- טבלת פריטים ----
  const ROW_H = 6.2, HEAD_H = 7.5;
  // הערה: כתיבת טקסט ב-jsPDF משנה את צבע המילוי (אותו אופרטור ב-PDF), לכן מגדירים
  // צבע מילוי לפני כל מלבן, ומציירים קודם את כל המלבנים ורק אחר כך את הטקסטים
  // (אחרת תא שצויר אחרי טקסט רחב מכסה אותו).
  // סגנון: כותרת אפורה עם קווים שחורים מעל ומתחת, שורות מופרדות בקו דק, בלי קווים אנכיים
  const drawHeadRow = () => {
    doc.setFillColor(229, 231, 235); doc.rect(LEFT, y, CONTENT_W, HEAD_H, 'F');
    doc.setDrawColor(17); doc.setLineWidth(0.3);
    doc.line(LEFT, y, RIGHT, y); doc.line(LEFT, y + HEAD_H, RIGHT, y + HEAD_H);
    for (const c of COLUMNS) {
      const x = c.align === 'right' ? c.x2 - 1.5 : c.x1 + c.w / 2;
      text(fit(c.label, c.w - 2, 7.5), x, y + 5, { align: c.align === 'right' ? 'right' : 'center', size: 7.5, bold: true });
    }
    y += HEAD_H;
  };
  let rowIndex = 0;
  const drawRow = (cells, { fill = null, bold = false, size = 8, strong = false } = {}) => {
    if (ensureSpace(ROW_H)) drawHeadRow();
    const bg = fill || (rowIndex++ % 2 === 1 ? [250, 250, 250] : null);
    if (bg) { doc.setFillColor(...bg); doc.rect(LEFT, y, CONTENT_W, ROW_H, 'F'); }
    if (strong) {
      doc.setDrawColor(17); doc.setLineWidth(0.5);
      doc.line(LEFT, y, RIGHT, y); doc.line(LEFT, y + ROW_H, RIGHT, y + ROW_H);
    } else {
      if (fill) doc.setDrawColor(156, 163, 175); else doc.setDrawColor(209, 213, 219);
      doc.setLineWidth(fill ? 0.3 : 0.2);
      doc.line(LEFT, y + ROW_H, RIGHT, y + ROW_H);
    }
    for (const c of COLUMNS) {
      const cell = cells[c.key];
      if (cell == null || cell === '') continue;
      const span = (typeof cell === 'object' && cell.span) || 1;
      const idx = COLUMNS.indexOf(c);
      const w = span === 1 ? c.w : COLUMNS.slice(idx, idx + span).reduce((s, k) => s + k.w, 0);
      const value = typeof cell === 'object' ? cell.v : cell;
      const align = (typeof cell === 'object' && cell.align) || c.align;
      const x = align === 'center' ? c.x2 - w / 2 : align === 'left' ? c.x2 - w + 1.5 : c.x2 - 1.5;
      text(fit(value, w - 3, size), x, y + 4.3, { align, size, bold });
    }
    y += ROW_H;
  };

  drawHeadRow();
  const groups = groupItems(Array.isArray(items) ? items : []);
  if (groups.length === 0) {
    drawRow({ product: { v: 'אין פריטים בתעודה זו', span: 10, align: 'center' } });
  }
  const multiGroup = groups.length > 1 || groups.some((g) => g.items.length > 1);
  for (const g of groups) {
    for (const it of g.items) {
      const disc = parseFloat(it.discount_percentage || 0);
      drawRow({
        product: it.product_name || '',
        quality: it.quality || '',
        packaging: it.packaging_type || '-',
        count: String(it.package_count || 0),
        gross: num(it.gross_weight),
        tare: num(it.tare_weight),
        net: num(it.net_weight),
        price: `${money(it.price_per_unit)}${it.pricing_method === 'per_kg' ? '/ק"ג' : ''}`,
        discount: disc > 0 ? `${disc}%` : '-',
        total: money(it.item_total),
      });
    }
    if (multiGroup) {
      drawRow({
        product: { v: `סה"כ ${g.product_name} · ${g.quality}`, span: 3 },
        count: String(g.p),
        net: num(g.w),
        total: money(g.a),
      }, { fill: [243, 244, 246], bold: true });
    }
  }
  drawRow({
    product: { v: 'סה"כ תעודה', span: 3 },
    count: String(cert.total_packages || 0),
    net: num(cert.total_weight),
    total: money(cert.total_amount),
  }, { fill: [229, 231, 235], bold: true, size: 9, strong: true });

  // ---- חתימות ----
  ensureSpace(30);
  y += 14;
  const sigGap = 10, sigW = (CONTENT_W - 2 * sigGap) / 3;
  ['חתימת השוקל', 'חתימת הנהג', isEntry ? 'חתימת הספק' : 'חתימת הלקוח'].forEach((label, i) => {
    const x1 = RIGHT - i * (sigW + sigGap) - sigW;
    doc.setDrawColor(17); doc.setLineWidth(0.3); doc.line(x1, y, x1 + sigW, y);
    text(label, x1 + sigW / 2, y + 4.5, { align: 'center', size: 8.5, bold: true });
  });

  // ---- תחתית בכל עמוד ----
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setDrawColor(200); doc.setLineWidth(0.2); doc.line(LEFT, PAGE_H - 11, RIGHT, PAGE_H - 11);
    text('הופק באמצעות FarmFlow', PAGE_W / 2, PAGE_H - 7, { align: 'center', size: 7.5, color: 110 });
    text(`${DOC_TITLE} ${certNum}`, RIGHT, PAGE_H - 7, { size: 7.5, color: 110 });
    text(`עמוד ${p} מתוך ${pages}`, LEFT, PAGE_H - 7, { align: 'left', size: 7.5, color: 110 });
  }

  return { blob: doc.output('blob'), doc };
}
