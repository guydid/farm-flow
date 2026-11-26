// שליחת קישור חתימה לטלפון העובד: וואטסאפ ישיר למספר / SMS — נפתח באפליקציה בטלפון של המנהל
// עם ההודעה מוכנה. בלי ספק SMS חיצוני (אין עלות ואין צורך בחשבון).

// מספר בינלאומי בספרות בלבד: 050-1234567 → 972501234567 ; +66 81 234 5678 → 66812345678
export function normalizePhone(raw, defaultCountry = "972") {
  let s = String(raw || "").trim();
  if (!s) return "";
  const plus = s.startsWith("+") || s.startsWith("00");
  s = s.replace(/\D/g, "");
  if (s.startsWith("00")) s = s.slice(2);
  if (!plus && s.startsWith("0")) s = defaultCountry + s.slice(1);
  return s.length >= 8 && s.length <= 15 ? s : "";
}

export const displayPhone = (raw) => {
  const n = normalizePhone(raw);
  if (!n) return raw || "";
  return n.startsWith("972") ? `0${n.slice(3, 5)}-${n.slice(5)}` : `+${n}`;
};

// עברית + אנגלית + תאית — רוב העובדים מתאילנד
export function signMessage({ firstName, title, url }) {
  return [
    `שלום${firstName ? ` ${firstName}` : ""}, נא לעיין ולחתום: ${title}`,
    `Hello${firstName ? ` ${firstName}` : ""}, please review and sign: ${title}`,
    "กรุณาตรวจสอบและลงชื่อในเอกสาร",
    url,
  ].join("\n");
}

export const whatsappLink = (phone, text) => {
  const n = normalizePhone(phone);
  return n ? `https://wa.me/${n}?text=${encodeURIComponent(text)}` : `https://wa.me/?text=${encodeURIComponent(text)}`;
};
// "?&body=" עובד גם באנדרואיד וגם ב-iOS
export const smsLink = (phone, text) => `sms:${normalizePhone(phone) ? `+${normalizePhone(phone)}` : ""}?&body=${encodeURIComponent(text)}`;
