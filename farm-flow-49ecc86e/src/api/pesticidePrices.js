// מחירון קנייה של המשק לחומרי הדברה (backend: /api/pesticide-prices, pesticideStock.js).
// הקטלוג משותף לכל המשקים, ולכן המחיר נשמר למשק ולא על התכשיר.
import { apiFetch, BASE_URL } from '@/api/localClient';
import { getListCached, invalidateList } from '@/api/cachedReads';

const UNIT_MAP = [
  [/^(ליטר|ל'?|l|lt|liter|litre)$/i, 'ml', 1000],
  [/^(מ"ל|מל|סמ"ק|סמק|ml|cc)$/i, 'ml', 1],
  [/^(ק"ג|קג|קילו|kg)$/i, 'g', 1000],
  [/^(גרם|גר'?|ג'?|g|gr)$/i, 'g', 1],
];
function normUnit(unit) {
  const u = String(unit || '').trim().replace(/[״”]/g, '"').replace(/[׳’]/g, "'");
  for (const [re, base, factor] of UNIT_MAP) if (re.test(u)) return { base, factor };
  return { base: u || "יח'", factor: 1 };
}
export const productKey = (name) => String(name || '').trim().replace(/\s+/g, ' ').toLowerCase();

// ₪ ליחידה אחת → ₪ ליחידה אחרת; null אם היחידות לא תואמות (נפח מול משקל)
export function convertPrice(price, fromUnit, toUnit) {
  if (price == null || !Number.isFinite(Number(price))) return null;
  const a = normUnit(fromUnit), b = normUnit(toUnit);
  if (a.base !== b.base) return null;
  return Math.round((Number(price) / a.factor) * b.factor * 10000) / 10000;
}

export function fetchPesticidePrices({ fresh = false } = {}) {
  if (fresh) invalidateList('pesticide_prices');
  return getListCached('pesticide_prices', () => apiFetch(`${BASE_URL}/pesticide-prices`), 60 * 1000);
}

export async function savePesticidePrice(body) {
  const saved = await apiFetch(`${BASE_URL}/pesticide-prices`, { method: 'PUT', body: JSON.stringify(body) });
  invalidateList('pesticide_prices');
  return saved;
}

// מחיר המשק לתכשיר ביחידה המבוקשת (למשל מחיר לליטר → לכל מ"ל בטופס ההדברה)
export function farmPriceFor(prices, productName, unit) {
  const p = (prices || []).find(x => x.key === productKey(productName));
  if (!p || p.price == null) return null;
  return convertPrice(p.price, p.unit, unit);
}
