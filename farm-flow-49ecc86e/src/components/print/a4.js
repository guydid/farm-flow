// תשתית משותפת למסמכי A4 (תעודת שקילה, דוח תעודות פתוחות, סיכום תעודות).
// - A4_DOC_CSS: מחלקות ff-* לעיצוב המסמך עצמו. מוטמע בתוך המסמך (<style>) כך שגם
//   תצוגה מקדימה באפליקציה, גם צילום ל-PDF וגם הדפסה נראים זהה.
// - printA4(): מדפיס HTML בשכבת הדפסה נקייה בתוך הדף (בלי תפריטי האפליקציה),
//   עובד גם ב-iOS (שם הדפסת iframe מדפיסה את הדף כולו).
// - elementToA4Pdf(): צילום אלמנט ל-PDF בעמודי A4 עם שוליים, חיתוך בין שורות
//   (לא באמצע שורה) ומספור עמודים.

export const A4 = { W: 210, H: 297, MARGIN: 12, CONTENT_W: 186 };

export const escapeHtml = (v) => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export const A4_DOC_CSS = `
@font-face { font-family: 'FFHeebo'; src: url('/fonts/Heebo-Regular.ttf') format('truetype'); font-weight: 400; }
@font-face { font-family: 'FFHeebo'; src: url('/fonts/Heebo-Bold.ttf') format('truetype'); font-weight: 700; }
.ff-doc, .ff-doc * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.ff-doc { direction: rtl; width: 186mm; margin: 0 auto; background: #fff; color: #111;
  font-family: 'FFHeebo', Arial, sans-serif; font-size: 9pt; line-height: 1.35; }
.ff-doc h1, .ff-doc h2, .ff-doc h3 { margin: 0; font-weight: 700; }

/* כותרת המסמך: משק מימין, שם המסמך ופרטיו משמאל */
.ff-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 6mm;
  padding-bottom: 3.5mm; border-bottom: 0.7mm solid #111; margin-bottom: 5mm; }
.ff-brand h1 { font-size: 14pt; line-height: 1.2; }
.ff-brand .ff-sub { font-size: 8pt; color: #444; margin-top: 1.2mm; line-height: 1.5; }
.ff-title { text-align: left; display: flex; gap: 4mm; align-items: flex-start; }
.ff-title-text { text-align: left; }
.ff-title h2 { font-size: 16pt; line-height: 1.15; }
.ff-title .ff-doc-no { font-size: 11pt; font-weight: 700; margin-top: 1mm; }
.ff-title .ff-sub { font-size: 8pt; color: #444; margin-top: 0.8mm; }
.ff-qr { text-align: center; }
.ff-qr img { width: 20mm; height: 20mm; display: block; }
.ff-qr div { font-family: monospace; font-size: 6pt; color: #555; margin-top: 0.5mm; direction: ltr; }

/* תיבות מידע */
.ff-boxes { display: flex; gap: 4mm; margin-bottom: 5mm; }
.ff-box { flex: 1; border: 0.25mm solid #9ca3af; border-radius: 1.5mm; padding: 2.5mm 3mm; break-inside: avoid; }
.ff-box h3 { font-size: 7.5pt; color: #555; letter-spacing: 0.02em; margin-bottom: 1.5mm;
  padding-bottom: 1mm; border-bottom: 0.2mm solid #e5e7eb; }
.ff-kv { width: 100%; border-collapse: collapse; font-size: 8.5pt; }
.ff-kv th { width: 20mm; text-align: right; color: #555; font-weight: 400; padding: 0.4mm 0; vertical-align: top; }
.ff-kv td { text-align: right; padding: 0.4mm 0; font-weight: 700; word-break: break-word; }
.ff-notes { border: 0.25mm solid #9ca3af; border-radius: 1.5mm; padding: 2mm 3mm; margin-bottom: 5mm;
  font-size: 8.5pt; white-space: pre-wrap; break-inside: avoid; }
.ff-notes b { color: #555; font-weight: 700; }

/* כרטיסי סיכום */
.ff-kpis { display: flex; gap: 3mm; margin-bottom: 5mm; break-inside: avoid; }
.ff-kpi { flex: 1; border: 0.25mm solid #9ca3af; border-radius: 1.5mm; padding: 2mm; text-align: center; }
.ff-kpi .v { font-size: 12pt; font-weight: 700; white-space: nowrap; }
.ff-kpi .l { font-size: 7.5pt; color: #555; }

/* טבלאות */
.ff-table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 8.5pt; }
.ff-table thead { display: table-header-group; }
.ff-table tfoot { display: table-row-group; }
.ff-table tr { break-inside: avoid; page-break-inside: avoid; }
.ff-table th { background: #e5e7eb; font-weight: 700; font-size: 8pt; text-align: center;
  padding: 1.6mm 1mm; border-top: 0.3mm solid #111; border-bottom: 0.3mm solid #111; }
.ff-table td { text-align: center; padding: 1.3mm 1mm; border-bottom: 0.2mm solid #d1d5db;
  word-break: break-word; vertical-align: middle; }
.ff-table .r { text-align: right; }
.ff-table .b { font-weight: 700; }
.ff-table tbody tr:nth-child(even) td { background: #fafafa; }
.ff-table tr.ff-sub td { background: #f3f4f6; font-weight: 700; border-bottom: 0.3mm solid #9ca3af; }
.ff-table tr.ff-total td { background: #e5e7eb; font-weight: 700; font-size: 9pt;
  border-top: 0.5mm solid #111; border-bottom: 0.5mm solid #111; }
.ff-table .ff-muted { color: #666; font-weight: 400; }
/* סכומים ומספרים מודגשים לא נשברים באמצע (גם כשהטבלה מתכווצת בהדפסה) */
.ff-table td.b, .ff-table tr.ff-total td, .ff-table tr.ff-sub td { word-break: normal; overflow-wrap: normal; white-space: nowrap; }
.ff-table tr.ff-total td.r, .ff-table tr.ff-sub td.r { white-space: normal; }

/* קבוצות (פריט / יום) */
.ff-group { margin-bottom: 5mm; }
.ff-group-head { display: flex; justify-content: space-between; align-items: baseline; gap: 3mm;
  border-right: 1.2mm solid #111; background: #f3f4f6; padding: 1.6mm 3mm; margin-bottom: 0;
  break-after: avoid; page-break-after: avoid; break-inside: avoid; }
.ff-group-head .t { font-size: 10pt; font-weight: 700; }
.ff-group-head .s { font-size: 8pt; color: #333; white-space: nowrap; }
.ff-cert-head { display: flex; justify-content: space-between; gap: 3mm; font-size: 8pt;
  padding: 1.4mm 2mm; border-bottom: 0.3mm solid #9ca3af; background: #fff; break-after: avoid; break-inside: avoid; }
.ff-empty { padding: 4mm; text-align: center; color: #666; font-size: 9pt; }

/* סיכום סופי, חתימות, תחתית */
.ff-grand { display: flex; justify-content: space-between; gap: 4mm; margin-top: 2mm; padding: 2.5mm 3mm;
  border-top: 0.7mm solid #111; border-bottom: 0.7mm solid #111; font-size: 10pt; font-weight: 700; break-inside: avoid; }
.ff-sign { display: flex; gap: 10mm; margin-top: 14mm; break-inside: avoid; page-break-inside: avoid; }
.ff-sign div { flex: 1; border-top: 0.3mm solid #111; padding-top: 1.5mm; text-align: center; font-size: 8.5pt; font-weight: 700; }
.ff-foot { display: flex; justify-content: space-between; margin-top: 6mm; padding-top: 2mm;
  border-top: 0.2mm solid #d1d5db; font-size: 7pt; color: #777; break-inside: avoid; }
`;

const PRINT_ROOT_ID = 'ff-print-root';

/**
 * מדפיס מסמך A4. bodyHtml צריך להכיל אלמנט .ff-doc (עם או בלי <style> משלו).
 * מחזיר Promise שמתממש אחרי שחלון ההדפסה נסגר (או אחרי זמן קצוב).
 */
export async function printA4({ title, bodyHtml }) {
  document.getElementById(PRINT_ROOT_ID)?.remove();
  document.getElementById(`${PRINT_ROOT_ID}-style`)?.remove();

  const style = document.createElement('style');
  style.id = `${PRINT_ROOT_ID}-style`;
  style.textContent = `${A4_DOC_CSS}
@media screen { #${PRINT_ROOT_ID} { display: none !important; } }
@media print {
  @page { size: A4 portrait; margin: 12mm; }
  html, body { background: #fff !important; margin: 0 !important; padding: 0 !important; height: auto !important; overflow: visible !important; }
  body > *:not(#${PRINT_ROOT_ID}) { display: none !important; }
  #${PRINT_ROOT_ID} { display: block !important; }
  #${PRINT_ROOT_ID} .ff-doc { padding: 0 !important; width: 100% !important; max-width: 186mm; }
}`;
  const root = document.createElement('div');
  root.id = PRINT_ROOT_ID;
  root.setAttribute('dir', 'rtl');
  root.innerHTML = bodyHtml;
  // רוחב גמיש: דפדפנים/מדפסות עם שוליים רחבים מ-12 מ"מ (Firefox, Safari, דרייברים)
  // משאירים פחות מ-186 מ"מ — עמודות ברוחב קבוע במ"מ היו נחתכות בצד שמאל.
  // ממירים את רוחבי העמודות לאחוזים כך שהטבלה מתכווצת לשטח ההדפסה בפועל.
  root.querySelectorAll('colgroup').forEach((cg) => {
    const cols = [...cg.querySelectorAll('col')];
    const mm = cols.map((c) => parseFloat((c.style.width || '').replace('mm', '')) || 0);
    const sum = mm.reduce((s, v) => s + v, 0);
    if (sum > 0 && cols.every((c) => /mm$/.test(c.style.width || ''))) {
      cols.forEach((c, i) => { c.style.width = `${((mm[i] / sum) * 100).toFixed(3)}%`; });
    }
  });
  document.head.appendChild(style);
  document.body.appendChild(root);

  // ממתינים לגופן ולתמונות (QR) כדי שלא יודפס מסמך חסר
  const waitImages = [...root.querySelectorAll('img')].map((img) => (img.complete ? null
    : new Promise((r) => { img.onload = r; img.onerror = r; })));
  const waitFonts = document.fonts
    ? Promise.all([document.fonts.load("400 10px 'FFHeebo'"), document.fonts.load("700 10px 'FFHeebo'")]).catch(() => {})
    : null;
  await Promise.race([Promise.all([waitFonts, ...waitImages]), new Promise((r) => setTimeout(r, 3500))]);

  const prevTitle = document.title;
  if (title) document.title = title; // שם הקובץ בשמירה כ-PDF
  const cleanup = () => {
    document.title = prevTitle;
    root.remove();
    style.remove();
  };
  await new Promise((resolve) => {
    let done = false;
    const finish = () => { if (done) return; done = true; window.removeEventListener('afterprint', finish); setTimeout(() => { cleanup(); resolve(); }, 100); };
    window.addEventListener('afterprint', finish);
    window.print();
    // במובייל print() לא חוסם ו-afterprint לא תמיד נורה
    setTimeout(finish, 60000);
  });
}

/**
 * צילום אלמנט (ברוחב 186 מ"מ) ל-PDF בעמודי A4. החיתוך בין עמודים נעשה רק
 * בגבולות של שורות/בלוקים, כותרת קבוצה לא נשארת לבד בתחתית עמוד, וכל עמוד
 * מקבל שוליים ומספר עמוד. מחזיר Blob.
 */
export async function elementToA4Pdf(el, { footerText = '' } = {}) {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);
  const SCALE = 2;
  if (document.fonts) await document.fonts.ready.catch(() => {});
  const canvas = await html2canvas(el, { scale: SCALE, useCORS: true, backgroundColor: '#ffffff' });

  const { W, H, MARGIN } = A4;
  const contentW = W - MARGIN * 2;
  const pxPerMm = canvas.width / contentW;
  // גובה התוכן בעמוד (בפיקסלי קנבס). מספור העמוד יושב בשוליים התחתונים.
  const usableHpx = Math.floor((H - MARGIN * 2) * pxPerMm);

  // נקודות חיתוך מותרות: תחתית כל שורה/בלוק. כותרות (thead, כותרת קבוצה) — רק לפניהן.
  const box = el.getBoundingClientRect();
  const ratio = canvas.width / box.width;
  const toPx = (v) => Math.round((v - box.top) * ratio);
  const cuts = new Set();
  el.querySelectorAll('tbody tr, tfoot tr, .ff-head, .ff-boxes, .ff-kpis, .ff-notes, .ff-grand, .ff-sign, .ff-group, .ff-cert-head + table, .ff-empty')
    .forEach((n) => cuts.add(toPx(n.getBoundingClientRect().bottom)));
  el.querySelectorAll('thead tr, .ff-group-head, .ff-cert-head').forEach((n) => {
    const r = n.getBoundingClientRect();
    cuts.add(toPx(r.top));
    cuts.delete(toPx(r.bottom));
  });
  // כותרת קבוצה + כותרת טבלה צמודות: לא לחתוך ביניהן
  el.querySelectorAll('.ff-group-head + table thead tr, .ff-cert-head + table thead tr').forEach((n) => cuts.delete(toPx(n.getBoundingClientRect().top)));
  const sorted = [...cuts].filter((c) => c > 0 && c < canvas.height).sort((a, b) => a - b);

  const slices = [];
  let start = 0;
  while (start < canvas.height - 2) {
    const limit = start + usableHpx;
    if (limit >= canvas.height) { slices.push([start, canvas.height]); break; }
    let cut = 0;
    for (const c of sorted) { if (c > start + usableHpx * 0.4 && c <= limit) cut = c; }
    if (!cut) cut = limit; // שורה ענקית — חיתוך כפוי
    slices.push([start, cut]);
    start = cut;
  }

  const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4', compress: true });
  const { ensureFonts, rtl } = await import('../weighing/certificatePdf');
  let fontOk = false;
  try {
    await ensureFonts(pdf);
    fontOk = true;
  } catch { /* מספור בלבד */ }

  slices.forEach(([s, e], i) => {
    if (i > 0) pdf.addPage();
    const part = document.createElement('canvas');
    part.width = canvas.width;
    part.height = e - s;
    const ctx = part.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, part.width, part.height);
    ctx.drawImage(canvas, 0, s, canvas.width, e - s, 0, 0, canvas.width, e - s);
    pdf.addImage(part.toDataURL('image/jpeg', 0.92), 'JPEG', MARGIN, MARGIN, contentW, (e - s) / pxPerMm);

    pdf.setDrawColor(200); pdf.setLineWidth(0.2);
    pdf.line(MARGIN, H - MARGIN + 1, W - MARGIN, H - MARGIN + 1);
    pdf.setFontSize(7.5); pdf.setTextColor(110);
    if (fontOk) {
      pdf.setFont('Heebo', 'normal');
      pdf.text(rtl(`עמוד ${i + 1} מתוך ${slices.length}`), MARGIN, H - MARGIN + 5, { align: 'left', isInputVisual: false });
      if (footerText) pdf.text(rtl(footerText), W - MARGIN, H - MARGIN + 5, { align: 'right', isInputVisual: false });
    } else {
      pdf.text(`${i + 1} / ${slices.length}`, MARGIN, H - MARGIN + 5, { align: 'left' });
    }
  });
  return pdf.output('blob');
}
