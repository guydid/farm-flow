// הגדרות "הוספה מהירה" — טופס מינימלי לכל סוג רשומה שניתן ליצור מתוך טופס אחר
// (לקוח חדש מתוך תעודת שקילה, חברת כ"א מתוך עובד, וכו').
// field: { key, label, type?, required?, dir?, options? }
import {
  Customer, Supplier, Product, Crop, Variety, Plot, ManpowerCompany, Packaging, PalletType, Employee,
} from "@/entities/all";
import { invalidateList } from "@/api/cachedReads";

export const QUICK_ADD = {
  customer: {
    entity: Customer, title: "לקוח חדש", labelOne: "לקוח", cacheKeys: (farmId) => [`customers_${farmId}`],
    fields: [
      { key: "name", label: "שם הלקוח", required: true, autoFocus: true },
      { key: "identification", label: "ח.פ / ת.ז", dir: "ltr" },
      { key: "contact_person", label: "איש קשר" },
      { key: "phone", label: "טלפון", type: "tel", dir: "ltr" },
      { key: "email", label: "אימייל", type: "email", dir: "ltr" },
    ],
  },
  supplier: {
    entity: Supplier, title: "ספק חדש", labelOne: "ספק", cacheKeys: (farmId) => [`suppliers_${farmId}`],
    fields: [
      { key: "name", label: "שם הספק", required: true, autoFocus: true },
      { key: "vat_id", label: "ח.פ / עוסק", dir: "ltr" },
      { key: "phone", label: "טלפון", type: "tel", dir: "ltr" },
      { key: "email", label: "אימייל", type: "email", dir: "ltr" },
    ],
  },
  product: {
    entity: Product, title: "מוצר חדש", labelOne: "מוצר", cacheKeys: (farmId) => [`products_${farmId}`],
    defaults: { default_pricing_method: "per_kg", weighable: true, vat_exempt: false },
    fields: [
      { key: "name", label: "שם המוצר", required: true, autoFocus: true },
      { key: "crop_type", label: "גידול" },
      { key: "weighable", label: "מוצר נשקל (ברוטו/טרה/נטו)", type: "switch" },
    ],
  },
  crop: {
    entity: Crop, title: "גידול חדש", labelOne: "גידול", cacheKeys: () => ["crops"],
    fields: [{ key: "name", label: "שם הגידול", required: true, autoFocus: true }],
  },
  variety: {
    entity: Variety, title: "זן חדש", labelOne: "זן", cacheKeys: () => ["varieties"],
    fields: [
      { key: "name", label: "שם הזן", required: true, autoFocus: true },
      { key: "crop_type", label: "גידול", required: true },
      { key: "marketing_company", label: "חברה משווקת" },
    ],
  },
  plot: {
    entity: Plot, title: "חלקה חדשה", labelOne: "חלקה", cacheKeys: (farmId) => [`plots_${farmId}`],
    defaults: { activity_status: "active" },
    fields: [
      { key: "name", label: "שם החלקה", required: true, autoFocus: true },
      { key: "size", label: "שטח (דונם)", type: "number", step: "0.1" },
    ],
  },
  manpower_company: {
    entity: ManpowerCompany, title: "חברת כוח אדם חדשה", labelOne: "חברת כ\"א", cacheKeys: () => ["manpower_companies"],
    fields: [
      { key: "name", label: "שם החברה", required: true, autoFocus: true },
      { key: "contact_person", label: "איש קשר" },
      { key: "phone", label: "טלפון", type: "tel", dir: "ltr" },
    ],
  },
  packaging: {
    entity: Packaging, title: "אריזה חדשה", labelOne: "אריזה", cacheKeys: (farmId) => [`packagings_${farmId}`],
    defaults: { weighable: true, product_ids: [] },
    fields: [
      { key: "name", label: "שם האריזה", required: true, autoFocus: true },
      { key: "tare_weight", label: "טרה (ק\"ג)", type: "number", step: "0.01" },
    ],
  },
  pallet_type: {
    entity: PalletType, title: "סוג משטח חדש", labelOne: "סוג משטח", cacheKeys: (farmId) => [`pallet_types_${farmId}`],
    fields: [
      { key: "name", label: "שם", required: true, autoFocus: true },
      { key: "weight", label: "משקל (ק\"ג)", type: "number", step: "0.1" },
    ],
  },
  employee: {
    entity: Employee, title: "עובד חדש", labelOne: "עובד", cacheKeys: (farmId) => [`employees_${farmId}`],
    defaults: { status: "active" },
    fields: [
      { key: "first_name", label: "שם פרטי", required: true, autoFocus: true },
      { key: "last_name", label: "שם משפחה" },
      { key: "phone", label: "טלפון", type: "tel", dir: "ltr" },
    ],
  },
};

/** יצירת הרשומה + ניקוי מטמוני הרשימות הרלוונטיים */
export async function quickCreate(kind, values, farmId) {
  const cfg = QUICK_ADD[kind];
  if (!cfg) throw new Error(`quick-add: unknown kind ${kind}`);
  const payload = { ...(cfg.defaults || {}), ...values };
  for (const f of cfg.fields) {
    if (f.type === "number" && payload[f.key] !== "" && payload[f.key] != null) payload[f.key] = Number(payload[f.key]);
    if (payload[f.key] === "") delete payload[f.key];
  }
  if (farmId) payload.farm_id = farmId;
  const created = await cfg.entity.create(payload);
  try { (cfg.cacheKeys?.(farmId) || []).forEach(k => invalidateList(k)); } catch { /* ignore */ }
  return created;
}
