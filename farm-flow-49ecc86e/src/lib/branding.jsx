// לוגו החברה (הגדרות → חברה → logo_url) כמיתוג המערכת: פינה עליונה, אייקון הטאב,
// אייקון במסך הבית בנייד ומסך הכניסה. הקובץ ב-/uploads דורש טוקן, לכן מורידים אותו פעם אחת,
// מקטינים ל-PNG ושומרים כ-data URL ב-localStorage — כך הוא זמין גם לפני התחברות ובלי טוקן ב-URL.
import { useEffect, useState } from 'react';
import { CompanySettings } from '@/entities/all';
import { getToken } from '@/api/localClient';

const KEY = 'ff_brand';
const EVENT = 'ff-brand-changed';

export function getBrand() {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
}

function saveBrand(brand) {
  try {
    if (brand) localStorage.setItem(KEY, JSON.stringify(brand));
    else localStorage.removeItem(KEY);
  } catch { /* מלא/חסום — המיתוג פשוט לא יישמר */ }
  applyBrandIcons(brand);
  window.dispatchEvent(new Event(EVENT));
}

function setLink(rel, href, sizes) {
  let el = document.querySelector(`link[rel="${rel}"]`);
  if (!el) { el = document.createElement('link'); el.rel = rel; document.head.appendChild(el); }
  if (sizes) el.setAttribute('sizes', sizes);
  el.href = href;
}

let manifestBlobUrl = null;
export function applyBrandIcons(brand = getBrand()) {
  const icon192 = brand?.icon192 || '/icons/icon-192.png';
  const icon512 = brand?.icon512 || '/icons/icon-512.png';
  setLink('icon', brand?.icon192 || '/icons/favicon-32.png', brand ? '192x192' : '32x32');
  setLink('apple-touch-icon', brand?.icon192 || '/icons/apple-touch-icon.png');
  const name = brand?.name || 'Farm Flow';
  document.querySelector('meta[name="apple-mobile-web-app-title"]')?.setAttribute('content', name);
  if (!brand) { setLink('manifest', '/manifest.json'); return; }
  // manifest דינמי — "הוסף למסך הבית" באנדרואיד מקבל את הלוגו והשם של המשק
  const origin = window.location.origin;
  const manifest = {
    name, short_name: name.slice(0, 12), description: 'מערכת ניהול משק חקלאי',
    start_url: `${origin}/`, scope: `${origin}/`, display: 'standalone',
    background_color: '#ffffff', theme_color: '#4f46e5', lang: 'he', dir: 'rtl',
    icons: [
      { src: icon192, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: icon512, sizes: '512x512', type: 'image/png', purpose: 'any' },
    ],
  };
  if (manifestBlobUrl) URL.revokeObjectURL(manifestBlobUrl);
  manifestBlobUrl = URL.createObjectURL(new Blob([JSON.stringify(manifest)], { type: 'application/manifest+json' }));
  setLink('manifest', manifestBlobUrl);
}

// ריבוע עם רקע לבן והלוגו ממורכז (אייקון מסך בית לא תומך בשקיפות בכל המכשירים)
function squarePng(img, size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);
  const pad = size * 0.08;
  const scale = Math.min((size - pad * 2) / img.width, (size - pad * 2) / img.height);
  const w = img.width * scale, h = img.height * scale;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
  return c.toDataURL('image/png');
}

// הלוגו ביחס המקורי (לפס העליון) — עד 360×120, שקיפות נשמרת
function widePng(img) {
  const scale = Math.min(360 / img.width, 120 / img.height, 1);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.width * scale));
  c.height = Math.max(1, Math.round(img.height * scale));
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/png');
}

async function fetchImage(url) {
  const sep = url.includes('?') ? '&' : '?';
  const res = await fetch(url.includes('/uploads/') ? `${url}${sep}token=${encodeURIComponent(getToken() || '')}` : url);
  if (!res.ok) throw new Error(`logo HTTP ${res.status}`);
  const blobUrl = URL.createObjectURL(await res.blob());
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('logo decode failed'));
      img.src = blobUrl;
    });
  } finally { URL.revokeObjectURL(blobUrl); }
}

// טוען את הלוגו של המשק הפעיל; מעבד מחדש רק אם הקובץ השתנה
export async function refreshBrand(farm) {
  if (!farm?.id) return;
  try {
    const [settings] = await CompanySettings.filter({ farm_id: farm.id });
    const logoUrl = settings?.logo_url || '';
    const name = settings?.company_name || farm.name || 'Farm Flow';
    if (!logoUrl) { saveBrand(null); return; }
    const cur = getBrand();
    if (cur && cur.farmId === farm.id && cur.logoUrl === logoUrl && cur.wide) {
      if (cur.name !== name) saveBrand({ ...cur, name });
      else applyBrandIcons(cur);
      return;
    }
    const img = await fetchImage(logoUrl);
    saveBrand({ farmId: farm.id, logoUrl, name, icon192: squarePng(img, 192), icon512: squarePng(img, 512), wide: widePng(img) });
  } catch (e) {
    console.warn('[brand] logo load failed:', e.message);
  }
}

export function useBrand() {
  const [brand, setBrand] = useState(getBrand);
  useEffect(() => {
    const on = () => setBrand(getBrand());
    window.addEventListener(EVENT, on);
    window.addEventListener('storage', on);
    return () => { window.removeEventListener(EVENT, on); window.removeEventListener('storage', on); };
  }, []);
  return brand;
}

// סמל המערכת: לוגו החברה אם הועלה, אחרת סמל ברירת המחדל.
// wide — הלוגו ביחס המקורי (לפס העליון); אחרת ריבוע (סרגל צד צר)
export function BrandMark({ className = 'w-8 h-8', rounded = 'rounded-lg', wide = false, wideClassName = 'h-8 max-w-[140px]' }) {
  const brand = useBrand();
  if (wide && brand?.wide) {
    return <img src={brand.wide} alt={brand.name || 'לוגו'} className={`${wideClassName} w-auto object-contain flex-shrink-0`} />;
  }
  if (brand?.icon192) {
    return <img src={brand.icon192} alt={brand.name || 'לוגו'} className={`${className} ${rounded} object-contain bg-white flex-shrink-0`} />;
  }
  return <img src="/icons/icon-192.png" alt="Farm Flow" className={`${className} ${rounded} flex-shrink-0`} />;
}
