// שליחת מיילי מערכת (אימות הרשמה, איפוס סיסמה).
// עדיפות: SMTP מהסביבה (SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS/MAIL_FROM — למשל Gmail עם App Password),
// ואם אין — חיבור ה-Gmail של משק המערכת (fallback שמועבר מ-server.js). בלי אף אחד מהם: לא נשלח.
let transporter = null;
let fallbackSender = null;

function smtpConfigured() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function getTransporter() {
  if (transporter || !smtpConfigured()) return transporter;
  const nodemailer = require('nodemailer');
  const port = parseInt(process.env.SMTP_PORT || '465', 10);
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  return transporter;
}

function setFallbackSender(fn) { fallbackSender = fn; }

function mailAvailable() {
  return smtpConfigured() || !!(fallbackSender && fallbackSender.available && fallbackSender.available());
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// תבנית מייל פשוטה ב-RTL עם כפתור פעולה
function renderEmail({ title, intro, buttonText, url, outro }) {
  const html = `<!doctype html><html lang="he" dir="rtl"><body style="margin:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 12px"><tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;padding:28px;text-align:right" dir="rtl">
<tr><td style="font-size:20px;font-weight:bold;color:#111827;padding-bottom:12px">${esc(title)}</td></tr>
<tr><td style="font-size:15px;color:#374151;line-height:1.6;padding-bottom:20px">${esc(intro)}</td></tr>
<tr><td style="padding-bottom:20px"><a href="${esc(url)}" style="display:inline-block;background:#059669;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold">${esc(buttonText)}</a></td></tr>
<tr><td style="font-size:13px;color:#6b7280;line-height:1.6">${esc(outro)}<br><br>אם הכפתור לא עובד, העתק את הקישור:<br><span dir="ltr" style="word-break:break-all">${esc(url)}</span></td></tr>
</table>
<div style="font-size:12px;color:#9ca3af;padding-top:12px">Farm Flow · מערכת ניהול משק חקלאי</div>
</td></tr></table></body></html>`;
  const text = `${title}\n\n${intro}\n\n${buttonText}: ${url}\n\n${outro}\n\nFarm Flow`;
  return { html, text };
}

async function sendMail({ to, subject, html, text }) {
  const t = getTransporter();
  if (t) {
    const from = process.env.MAIL_FROM || `Farm Flow <${process.env.SMTP_USER}>`;
    await t.sendMail({ from, to, subject, html, text });
    return { via: 'smtp' };
  }
  if (fallbackSender && fallbackSender.available()) {
    await fallbackSender.send({ to, subject, html, text });
    return { via: 'gmail' };
  }
  const err = new Error('Email service not configured');
  err.code = 'email_unavailable';
  throw err;
}

module.exports = { sendMail, renderEmail, mailAvailable, setFallbackSender, smtpConfigured };
