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
  const crop = seeding?.crop_type;
  const cropProductIds = new Set(
    (Array.isArray(products) ? products : [])
      .filter(p => p && crop && p.crop_type === crop)
      .map(p => p.id)
  );
  let out = all.filter(p =>
    !Array.isArray(p.product_ids) || p.product_ids.length === 0 || p.product_ids.some(id => cropProductIds.has(id))
  );
  if (keepName && !out.some(p => p.name === keepName)) {
    const cur = all.find(p => p.name === keepName);
    if (cur) out = [...out, cur];
  }
  return out;
}
