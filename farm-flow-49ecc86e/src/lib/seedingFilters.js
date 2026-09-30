// זנים ואריזות רלוונטיים למזרע — משותף לכל טופסי הקטיף (פרטי מזרע, פעולות מהירות, עובד שטח)
//
// זנים:   הזנים שמשויכים למזרע (seeding.varieties). אם לא שויכו זנים — כל הזנים של סוג הגידול.
// אריזות: אריזה בלי שיוך למוצרים מתאימה לכל המזרעים; אריזה משויכת מוצגת רק אם אחד
//         ממוצריה הוא מסוג הגידול של המזרע. אריזות של משק אחר לא מוצגות.
// keepId / keepName: בעריכה של קטיף קיים — משאירים את הערך הנוכחי ברשימה גם אם אינו תואם.

export function varietiesForSeeding(seeding, varieties, { keepId } = {}) {
  const all = (Array.isArray(varieties) ? varieties : []).filter(Boolean);
  const assigned = (Array.isArray(seeding?.varieties) ? seeding.varieties : [])
    .map(v => v?.variety_id).filter(Boolean);
  let out = assigned.length > 0
    ? all.filter(v => assigned.includes(v.id))
    : all.filter(v => seeding?.crop_type && v.crop_type === seeding.crop_type);
  if (keepId && !out.some(v => v.id === keepId)) {
    const cur = all.find(v => v.id === keepId);
    if (cur) out = [...out, cur];
  }
  return out;
}

export function packagingsForSeeding(seeding, packagings, products, { keepName } = {}) {
  const all = (Array.isArray(packagings) ? packagings : [])
    .filter(p => p && (!seeding?.farm_id || !p.farm_id || p.farm_id === seeding.farm_id));
  const norm = (v) => String(v || "").trim().toLowerCase();
  const crop = norm(seeding?.crop_type);
  // התאמת גידול "רכה": שווה, או שאחד מכיל את השני (למשל "עגבניה" ↔ "עגבניה צרי")
  const cropMatches = (pc) => { const c = norm(pc); return !!crop && !!c && (c === crop || c.includes(crop) || crop.includes(c)); };
  const cropProductIds = new Set(
    (Array.isArray(products) ? products : [])
      .filter(p => p && cropMatches(p.crop_type))
      .map(p => p.id)
  );
  const isGeneral = (p) => !Array.isArray(p.product_ids) || p.product_ids.length === 0;
  const byCrop = all.filter(p => !isGeneral(p) && p.product_ids.some(id => cropProductIds.has(id)));
  const general = all.filter(isGeneral);
  // מתאימות לגידול קודם, אחריהן הכלליות. אם שום דבר לא תואם — מציגים את כל אריזות המשק
  // (עדיף רשימה מלאה מרשימה ריקה שחוסמת הזנת קטיף).
  let out = [...byCrop, ...general];
  if (out.length === 0) out = all;
  if (keepName && !out.some(p => p.name === keepName)) {
    const cur = all.find(p => p.name === keepName);
    if (cur) out = [...out, cur];
  }
  return out;
}
