import React from 'react';
import { format } from 'date-fns';
import { A4_DOC_CSS } from '../print/a4';

// פריסת תעודת שקילה להדפסה ב-A4 (186 מ"מ רוחב תוכן, שוליים 12 מ"מ).
// WeighingDetail מרנדר אותה ל-HTML ומדפיס דרך printA4 — בלי תפריטי האפליקציה.
// ה-PDF לשיתוף נבנה בנפרד (certificatePdf.js) באותו מבנה.

const VEHICLE_TYPES = { truck: 'משאית', van: 'מסחרית', pickup: 'טנדר', trailer: 'נגרר' };
const STATUSES = { draft: 'טיוטה', completed: 'הושלם', shipped: 'נשלח' };

const obj = (o) => (o && typeof o === 'object' ? o : {});
const num = (v, d = 1) => (parseFloat(v) || 0).toLocaleString('he-IL', { maximumFractionDigits: d });
const money = (v) => `₪${(parseFloat(v) || 0).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (d) => {
  if (!d) return 'לא צוין';
  const p = new Date(d);
  return Number.isNaN(p.getTime()) ? String(d) : format(p, 'dd/MM/yyyy');
};

// רוחב עמודות במ"מ (סה"כ 186)
const COLS = [
  ['מוצר', 34, 'r'], ['איכות', 14], ['אריזה', 22], ['אריזות', 14], ['ברוטו ק"ג', 18],
  ['טרה ק"ג', 16], ['נטו ק"ג', 18], ['מחיר', 18], ['הנחה', 12], ['סה"כ', 20],
];

export function certificateNumber(cert) {
  return cert?.reference_number || String(cert?.id || '').slice(-5) || 'לא זמין';
}

function groupItems(items) {
  const map = new Map();
  for (const raw of items) {
    const it = obj(raw);
    if (!Object.keys(it).length) continue;
    const key = `${it.product_name || 'ללא שם'}_${it.quality || 'לא צוין'}`;
    if (!map.has(key)) map.set(key, { product: it.product_name || 'ללא שם מוצר', quality: it.quality || 'לא צוין', items: [], w: 0, p: 0, a: 0 });
    const g = map.get(key);
    g.items.push(it);
    g.w += parseFloat(it.net_weight) || 0;
    g.p += parseInt(it.package_count, 10) || 0;
    g.a += parseFloat(it.item_total) || 0;
  }
  return [...map.values()];
}

export default function CertificatePrintLayout({ certificate, items, companySettings, customer }) {
  const cert = obj(certificate), co = obj(companySettings), cu = obj(customer);
  const list = Array.isArray(items) ? items : [];
  const groups = groupItems(list);
  const multiGroup = groups.length > 1 || groups.some(g => g.items.length > 1);
  const qr = cert.barcode
    ? `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(cert.barcode)}&size=240x240&qzone=1`
    : null;
  const address = [co.address, co.city].filter(Boolean).join(', ');

  return (
    <div className="ff-doc" dir="rtl">
      <style dangerouslySetInnerHTML={{ __html: A4_DOC_CSS }} />

      <header className="ff-head">
        <div className="ff-brand">
          <h1>{co.company_name || 'שם המשק'}</h1>
          <div className="ff-sub">
            {co.business_number && <div>ע.מ/ח.פ {co.business_number}</div>}
            {address && <div>{address}</div>}
            {(co.phone || co.email) && <div>{[co.phone && `טלפון ${co.phone}`, co.email].filter(Boolean).join(' · ')}</div>}
          </div>
        </div>
        <div className="ff-title">
          <div className="ff-title-text">
            <h2>תעודת שקילה</h2>
            <div className="ff-doc-no">מס' {certificateNumber(cert)}</div>
            <div className="ff-sub">{fmtDate(cert.date)}{cert.time ? ` · ${cert.time}` : ''}</div>
            {cert.status && <div className="ff-sub">סטטוס: {STATUSES[cert.status] || cert.status}</div>}
          </div>
          {qr && (
            <div className="ff-qr">
              <img src={qr} alt="" />
              <div>{cert.barcode}</div>
            </div>
          )}
        </div>
      </header>

      <section className="ff-boxes">
        <div className="ff-box">
          <h3>לקוח</h3>
          <table className="ff-kv"><tbody>
            <tr><th>שם</th><td>{cu.name || cert.customer_name || 'לא צוין'}</td></tr>
            {cu.address && <tr><th>כתובת</th><td>{cu.address}</td></tr>}
            {cu.phone && <tr><th>טלפון</th><td>{cu.phone}</td></tr>}
            {cu.contact_person && <tr><th>איש קשר</th><td>{cu.contact_person}</td></tr>}
          </tbody></table>
        </div>
        <div className="ff-box">
          <h3>הובלה</h3>
          <table className="ff-kv"><tbody>
            <tr><th>נהג</th><td>{cert.driver_name || 'לא צוין'}</td></tr>
            <tr><th>רכב</th><td>{[VEHICLE_TYPES[cert.vehicle_type] || cert.vehicle_type, cert.vehicle_number].filter(Boolean).join(' · ') || 'לא צוין'}</td></tr>
          </tbody></table>
        </div>
      </section>

      {cert.notes && String(cert.notes).trim() && (
        <div className="ff-notes"><b>הערות: </b>{String(cert.notes).trim()}</div>
      )}

      <table className="ff-table">
        <colgroup>{COLS.map(([l, w]) => <col key={l} style={{ width: `${w}mm` }} />)}</colgroup>
        <thead>
          <tr>{COLS.map(([l, , a]) => <th key={l} className={a || undefined}>{l}</th>)}</tr>
        </thead>
        <tbody>
          {groups.length === 0 && (
            <tr><td colSpan={COLS.length} className="ff-muted">אין פריטים בתעודה זו</td></tr>
          )}
          {groups.map((g, gi) => (
            <React.Fragment key={gi}>
              {g.items.map((it, i) => (
                <tr key={it.id || `${gi}-${i}`}>
                  <td className="r">{it.product_name || ''}</td>
                  <td>{it.quality || ''}</td>
                  <td>{it.packaging_type || '-'}</td>
                  <td>{it.package_count || 0}</td>
                  <td>{num(it.gross_weight)}</td>
                  <td>{num(it.tare_weight)}</td>
                  <td className="b">{num(it.net_weight)}</td>
                  <td>{money(it.price_per_unit)}{it.pricing_method === 'per_kg' ? <span className="ff-muted">/ק"ג</span> : null}</td>
                  <td>{parseFloat(it.discount_percentage) > 0 ? `${parseFloat(it.discount_percentage)}%` : '-'}</td>
                  <td className="b">{money(it.item_total)}</td>
                </tr>
              ))}
              {multiGroup && (
                <tr className="ff-sub">
                  <td className="r" colSpan={3}>סה"כ {g.product} · {g.quality}</td>
                  <td>{g.p}</td>
                  <td colSpan={2}></td>
                  <td>{num(g.w)}</td>
                  <td colSpan={2}></td>
                  <td>{money(g.a)}</td>
                </tr>
              )}
            </React.Fragment>
          ))}
          <tr className="ff-total">
            <td className="r" colSpan={3}>סה"כ תעודה</td>
            <td>{cert.total_packages || 0}</td>
            <td colSpan={2}></td>
            <td>{num(cert.total_weight)}</td>
            <td colSpan={2}></td>
            <td>{money(cert.total_amount)}</td>
          </tr>
        </tbody>
      </table>

      <div className="ff-sign">
        <div>חתימת השוקל</div>
        <div>חתימת הנהג</div>
        <div>חתימת הלקוח</div>
      </div>

      <footer className="ff-foot">
        <span>תעודת שקילה {certificateNumber(cert)}</span>
        <span>הופק באמצעות FarmFlow · {format(new Date(), 'dd/MM/yyyy HH:mm')}</span>
      </footer>
    </div>
  );
}
