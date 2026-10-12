// עיבוד צילום מסמך בדפדפן: יישור פרספקטיבה לפי 4 פינות, ניקוי תאורה וצללים, סיבוב.
// הכל על canvas, בלי ספריות — רץ בנייד תוך שבריר שנייה לעמוד.

export const MAX_SOURCE_SIDE = 2400; // התמונה שממנה חותכים (צילום 12MP מוקטן — חוסך זיכרון בנייד)
export const MAX_OUTPUT_SIDE = 1800; // עמוד מוגמר — מספיק לקריאת AI ולהדפסה, ~300-500KB
export const DEFAULT_QUAD = [{ x: 0.04, y: 0.04 }, { x: 0.96, y: 0.04 }, { x: 0.96, y: 0.96 }, { x: 0.04, y: 0.96 }]; // TL TR BR BL
export const FULL_QUAD = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];

export async function loadImageFile(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode(); // הדפדפן מיישם אוריינטציית EXIF בציור
    const scale = Math.min(1, MAX_SOURCE_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// פותר את ההומוגרפיה שממפה את 4 נקודות from ל-4 נקודות to (מערכת 8×8, אלימינציית גאוס).
// מחזיר [a..h] כך ש-x' = (a x + b y + c)/(g x + h y + 1), y' = (d x + e y + f)/(g x + h y + 1)
export function homography(from, to) {
  const A = [], B = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i], { x: X, y: Y } = to[i];
    A.push([x, y, 1, 0, 0, 0, -x * X, -y * X]); B.push(X);
    A.push([0, 0, 0, x, y, 1, -x * Y, -y * Y]); B.push(Y);
  }
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]]; [B[c], B[p]] = [B[p], B[c]];
    if (Math.abs(A[c][c]) < 1e-12) throw new Error('degenerate quad');
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      if (!f) continue;
      for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k];
      B[r] -= f * B[c];
    }
  }
  return B.map((b, i) => b / A[i][i]);
}

const isFullQuad = (q) => q.every((p, i) => Math.abs(p.x - FULL_QUAD[i].x) < 1e-3 && Math.abs(p.y - FULL_QUAD[i].y) < 1e-3);

// חותך ומיישר את המרובע (בקואורדינטות 0..1) למלבן
export function warpQuad(src, quadNorm) {
  const q = quadNorm.map(p => ({ x: p.x * src.width, y: p.y * src.height }));
  let W = Math.max(dist(q[0], q[1]), dist(q[3], q[2]));
  let H = Math.max(dist(q[0], q[3]), dist(q[1], q[2]));
  const s = Math.min(1, MAX_OUTPUT_SIDE / Math.max(W, H));
  W = Math.max(1, Math.round(W * s)); H = Math.max(1, Math.round(H * s));

  const out = document.createElement('canvas');
  out.width = W; out.height = H;
  const octx = out.getContext('2d');
  if (isFullQuad(quadNorm)) { octx.drawImage(src, 0, 0, W, H); return out; }

  const sw = src.width, sh = src.height;
  const sd = src.getContext('2d').getImageData(0, 0, sw, sh).data;
  const od = octx.createImageData(W, H);
  const o = od.data;
  // ממפים כל פיקסל ביעד חזרה למקור (מיפוי הפוך) ודוגמים בילינארית
  const [a, b, c, d, e, f, g, h] = homography(
    [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }], q);
  let i = 0;
  for (let v = 0; v < H; v++) {
    const vy = v + 0.5;
    for (let u = 0; u < W; u++, i += 4) {
      const ux = u + 0.5;
      const den = g * ux + h * vy + 1;
      let x = (a * ux + b * vy + c) / den - 0.5;
      let y = (d * ux + e * vy + f) / den - 0.5;
      if (x < 0) x = 0; else if (x > sw - 1) x = sw - 1;
      if (y < 0) y = 0; else if (y > sh - 1) y = sh - 1;
      const x0 = x | 0, y0 = y | 0;
      const x1 = x0 < sw - 1 ? x0 + 1 : x0, y1 = y0 < sh - 1 ? y0 + 1 : y0;
      const fx = x - x0, fy = y - y0;
      const p00 = (y0 * sw + x0) * 4, p10 = (y0 * sw + x1) * 4, p01 = (y1 * sw + x0) * 4, p11 = (y1 * sw + x1) * 4;
      for (let k = 0; k < 3; k++) {
        const top = sd[p00 + k] + (sd[p10 + k] - sd[p00 + k]) * fx;
        const bot = sd[p01 + k] + (sd[p11 + k] - sd[p01 + k]) * fx;
        o[i + k] = top + (bot - top) * fy;
      }
      o[i + 3] = 255;
    }
  }
  octx.putImageData(od, 0, 0);
  return out;
}

// מעריך את צבע הנייר בכל אזור: הקטנה + פילטר מקסימום (הטקסט כהה ונעלם), ואז הגדלה חלקה.
function estimateBackground(canvas) {
  const W = canvas.width, H = canvas.height;
  const sw = Math.max(8, Math.round(W / 12)), sh = Math.max(8, Math.round(H / 12));
  const small = document.createElement('canvas');
  small.width = sw; small.height = sh;
  const sctx = small.getContext('2d');
  sctx.drawImage(canvas, 0, 0, sw, sh);
  let data = sctx.getImageData(0, 0, sw, sh);
  for (let pass = 0; pass < 3; pass++) {
    const src = data.data, next = new ImageData(sw, sh), dst = next.data;
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
      const i = (y * sw + x) * 4;
      for (let k = 0; k < 3; k++) {
        let m = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = Math.min(sh - 1, Math.max(0, y + dy));
          for (let dx = -1; dx <= 1; dx++) {
            const xx = Math.min(sw - 1, Math.max(0, x + dx));
            const val = src[(yy * sw + xx) * 4 + k];
            if (val > m) m = val;
          }
        }
        dst[i + k] = m;
      }
      dst[i + 3] = 255;
    }
    data = next;
  }
  sctx.putImageData(data, 0, 0);
  const big = document.createElement('canvas');
  big.width = W; big.height = H;
  const bctx = big.getContext('2d');
  bctx.imageSmoothingEnabled = true;
  bctx.imageSmoothingQuality = 'high';
  bctx.drawImage(small, 0, 0, W, H);
  return bctx.getImageData(0, 0, W, H).data;
}

// חידוד (unsharp mask): v + amount·(v − טשטוש 3×3). מחזיר קצוות של אותיות שהיטשטשו מרעידת יד.
function sharpen(p, W, H, amount) {
  const src = new Uint8ClampedArray(p);
  const tmp = new Float32Array(W * H);
  for (let k = 0; k < 3; k++) {
    // טשטוש תיבה נפריד: אופקי ל-tmp, אנכי תוך כדי החלת החידוד
    for (let y = 0; y < H; y++) {
      const row = y * W;
      for (let x = 0; x < W; x++) {
        const l = x > 0 ? x - 1 : x, r = x < W - 1 ? x + 1 : x;
        tmp[row + x] = (src[(row + l) * 4 + k] + src[(row + x) * 4 + k] + src[(row + r) * 4 + k]) / 3;
      }
    }
    for (let y = 0; y < H; y++) {
      const u = (y > 0 ? y - 1 : y) * W, m = y * W, d = (y < H - 1 ? y + 1 : y) * W;
      for (let x = 0; x < W; x++) {
        const blur = (tmp[u + x] + tmp[m + x] + tmp[d + x]) / 3;
        const i = (m + x) * 4 + k;
        p[i] = src[i] + amount * (src[i] - blur);
      }
    }
  }
}

// סף אדפטיבי (Bradley): פיקסל שחור אם הוא כהה ב-T% מהממוצע בחלון סביבו. כל אזור נמדד
// מול הסביבה שלו, ולכן גם קבלה תרמית דהויה יוצאת שחור על לבן נקי — כמו סורק משרדי.
function adaptiveThreshold(p, W, H) {
  // החלקה 3×3 לפני הסף: גרעיניות של צילום חשוך לא הופכת לנקודות שחורות על הנייר
  const raw = new Uint8ClampedArray(W * H);
  for (let i = 0, j = 0; j < raw.length; i += 4, j++) raw[j] = p[i]; // התמונה כבר באפור
  const lum = new Uint8ClampedArray(W * H);
  for (let y = 0; y < H; y++) {
    const u = (y > 0 ? y - 1 : y) * W, m = y * W, d = (y < H - 1 ? y + 1 : y) * W;
    for (let x = 0; x < W; x++) {
      const l = x > 0 ? x - 1 : x, r = x < W - 1 ? x + 1 : x;
      lum[m + x] = (raw[u + l] + raw[u + x] + raw[u + r] + raw[m + l] + raw[m + x] + raw[m + r] + raw[d + l] + raw[d + x] + raw[d + r]) / 9;
    }
  }
  const IW = W + 1;
  const integral = new Uint32Array(IW * (H + 1)); // סכום מקסימלי 255·4.3M — נכנס ב-32 ביט
  for (let y = 0; y < H; y++) {
    let rowSum = 0;
    for (let x = 0; x < W; x++) {
      rowSum += lum[y * W + x];
      integral[(y + 1) * IW + x + 1] = integral[y * IW + x + 1] + rowSum;
    }
  }
  const half = Math.max(7, Math.round(Math.max(W, H) / 64));
  const T = 0.1;
  const ABS_INK = 210;
  for (let y = 0; y < H; y++) {
    const y0 = Math.max(0, y - half), y1 = Math.min(H - 1, y + half);
    for (let x = 0; x < W; x++) {
      const x0 = Math.max(0, x - half), x1 = Math.min(W - 1, x + half);
      const count = (x1 - x0 + 1) * (y1 - y0 + 1);
      const sum = integral[(y1 + 1) * IW + x1 + 1] - integral[y0 * IW + x1 + 1] - integral[(y1 + 1) * IW + x0] + integral[y0 * IW + x0];
      // בנוסף לסף המקומי — כל מה שכהה בבירור מהנייר (שכבר נורמל ל-255) הוא דיו. בלי זה נקודה
      // עשרונית צמודה לספרות נבלעת: הספרות מורידות את הממוצע המקומי והסף יורד איתן.
      const l = lum[y * W + x];
      const v = l < ABS_INK || l * count < sum * (1 - T) ? 0 : 255;
      const i = (y * W + x) * 4;
      p[i] = p[i + 1] = p[i + 2] = v;
    }
  }
}

// filter: 'enhance' — נייר לבן, צללים מוסרים, צבע נשמר (חותמות/לוגו), חידוד עדין
//         'bw'      — גווני אפור בניגודיות גבוהה וחידוד חזק
//         'text'    — שחור/לבן מלא בסף אדפטיבי, הכי קריא לקבלות דהויות
//         'original'
export function applyFilter(canvas, filter) {
  const W = canvas.width, H = canvas.height;
  const out = document.createElement('canvas');
  out.width = W; out.height = H;
  const ctx = out.getContext('2d');
  ctx.drawImage(canvas, 0, 0);
  if (filter === 'original') return out;

  const img = ctx.getImageData(0, 0, W, H);
  const p = img.data;
  const bg = estimateBackground(canvas);
  const gray = filter === 'bw' || filter === 'text';
  // חלוקה ברקע: כל אזור נייר הופך ל-255, טקסט נשאר כהה ביחס לסביבתו
  for (let i = 0; i < p.length; i += 4) {
    if (gray) {
      const l = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2];
      const lb = 0.299 * bg[i] + 0.587 * bg[i + 1] + 0.114 * bg[i + 2];
      p[i] = p[i + 1] = p[i + 2] = Math.min(255, (l * 255) / Math.max(lb, 1));
    } else {
      p[i] = Math.min(255, (p[i] * 255) / Math.max(bg[i], 1));
      p[i + 1] = Math.min(255, (p[i + 1] * 255) / Math.max(bg[i + 1], 1));
      p[i + 2] = Math.min(255, (p[i + 2] * 255) / Math.max(bg[i + 2], 1));
    }
  }
  // מתיחת ניגודיות: האחוזון הכהה → שחור, נייר כמעט-לבן → לבן נקי
  const hist = new Uint32Array(256);
  for (let i = 0; i < p.length; i += 16) hist[(p[i] + p[i + 1] + p[i + 2]) / 3 | 0]++;
  const total = hist.reduce((s, n) => s + n, 0);
  let lo = 0;
  for (let acc = 0; lo < 255 && (acc += hist[lo]) < total * 0.01; lo++);
  lo = Math.min(lo, 120);
  const hi = gray ? 225 : 238;
  const gamma = gray ? 1.35 : 1.15; // >1 מכהה קווים דקים
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) {
    const t = Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
    lut[v] = 255 * Math.pow(t, gamma);
  }
  for (let i = 0; i < p.length; i += 4) {
    p[i] = lut[p[i]]; p[i + 1] = lut[p[i + 1]]; p[i + 2] = lut[p[i + 2]];
  }
  // הסף רץ אחרי מתיחת הניגודיות — קווים חלשים (נקודה עשרונית!) כבר הוכהו ולא נעלמים
  if (filter === 'text') adaptiveThreshold(p, W, H);
  else sharpen(p, W, H, gray ? 0.9 : 0.6);
  ctx.putImageData(img, 0, 0);
  return out;
}

export function rotateCanvas(canvas, deg) {
  const r = ((deg % 360) + 360) % 360;
  if (!r) return canvas;
  const out = document.createElement('canvas');
  const swap = r === 90 || r === 270;
  out.width = swap ? canvas.height : canvas.width;
  out.height = swap ? canvas.width : canvas.height;
  const ctx = out.getContext('2d');
  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate((r * Math.PI) / 180);
  ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
  return out;
}

export const canvasToJpeg = (canvas, quality = 0.85) =>
  new Promise((res, rej) => canvas.toBlob(b => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/jpeg', quality));
