import React from 'react';
import { format } from 'date-fns';
import { he } from 'date-fns/locale';
import { A4_DOC_CSS } from '../print/a4';

// דוח תעודות פתוחות ללקוח. שני מצבי תצוגה:
//   mode="product" (ברירת מחדל) — מקובץ לפי פריט: כל פריט עם שורה לכל תעודה (תאריך + מס' תעודה) וסיכום לפריט.
//   mode="day"                  — מקובץ לפי יום, עם פירוט פריטים לכל תעודה.
// מעוצב ל-A4 (186 מ"מ, מחלקות ff-* מ-print/a4) כך שתצוגה מקדימה, צילום ל-PDF
// (elementToA4Pdf, חיתוך בין שורות) והדפסה (printA4) נראים זהה.

const fmtNum = (n, digits = 1) => (parseFloat(n) || 0).toLocaleString(undefined, { maximumFractionDigits: digits });
const fmtMoney = (n) => (parseFloat(n) || 0).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (d) => {
  if (!d) return 'ללא תאריך';
  const parsed = new Date(d);
  return Number.isNaN(parsed.getTime()) ? String(d) : format(parsed, 'dd/MM/yyyy');
};
const certNumber = (cert) => cert?.reference_number || String(cert?.id || '').slice(-5);

const STATUS_HE = { draft: 'טיוטה', completed: 'הושלם', shipped: 'נשלח' };

// מקבץ שורות פריטים לפי שם מוצר. הקלט: [{ cert, items }] (כמו groups[].entries).
// הפלט ממוין לפי שם מוצר (א-ב), ובתוך כל מוצר לפי תאריך ושעה של התעודה.
export function groupEntriesByProduct(entries) {
  const map = new Map();
  for (const { cert, items } of entries || []) {
    for (const item of items || []) {
      const product = (item.product_name || '').trim() || 'ללא מוצר';
      if (!map.has(product)) map.set(product, { product, rows: [], sums: { certIds: new Set(), packages: 0, weight: 0, amount: 0 } });
      const g = map.get(product);
      g.rows.push({ item, cert });
      g.sums.certIds.add(cert.id);
      g.sums.packages += parseInt(item.package_count) || 0;
      g.sums.weight += parseFloat(item.net_weight) || 0;
      g.sums.amount += parseFloat(item.item_total) || 0;
    }
  }
  const sortKey = (r) => `${r.cert.date || ''} ${r.cert.time || ''}`;
  return [...map.values()]
    .sort((a, b) => (a.product === 'ללא מוצר') - (b.product === 'ללא מוצר') || a.product.localeCompare(b.product, 'he')) // 'ללא מוצר' תמיד אחרון
    .map(g => ({
      product: g.product,
      rows: g.rows.sort((a, b) => sortKey(a).localeCompare(sortKey(b))),
      sums: { certs: g.sums.certIds.size, packages: g.sums.packages, weight: g.sums.weight, amount: g.sums.amount },
    }));
}

// רוחבי עמודות במ"מ (סה"כ 186)
const Cols = ({ widths }) => <colgroup>{widths.map((w, i) => <col key={i} style={{ width: `${w}mm` }} />)}</colgroup>;
const priceText = (it) => (
  <>
    ₪{fmtNum(it.price_per_unit, 2)}<span className="ff-muted">{it.pricing_method === 'per_kg' ? '/ק"ג' : '/יח׳'}</span>
    {parseFloat(it.discount_percentage) > 0 ? <span className="ff-muted"> (-{it.discount_percentage}%)</span> : null}
  </>
);

function ProductGroups({ productGroups }) {
  if (!productGroups || productGroups.length === 0) {
    return <div className="ff-empty">אין פריטים בתעודות הפתוחות</div>;
  }
  return productGroups.map(({ product, rows, sums }) => (
    <section key={product} className="ff-group">
      <div className="ff-group-head">
        <span className="t">{product}</span>
        <span className="s">{sums.certs} תעודות · {fmtNum(sums.packages, 0)} אריזות · {fmtNum(sums.weight)} ק"ג · ₪{fmtMoney(sums.amount)}</span>
      </div>
      <table className="ff-table">
        <Cols widths={[26, 18, 16, 26, 16, 22, 30, 32]} />
        <thead>
          <tr>
            <th>תאריך</th><th>תעודה</th><th>איכות</th><th>אריזה</th><th>כמות</th><th>נטו ק"ג</th><th>מחיר</th><th>סה"כ</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ item, cert }, idx) => (
            <tr key={item.id || `${cert.id}-${idx}`}>
              <td>{fmtDate(cert.date)}{cert.time ? <span className="ff-muted"> {cert.time}</span> : null}</td>
              <td>#{certNumber(cert)}</td>
              <td>{item.quality || ''}</td>
              <td>{item.packaging_type || '-'}</td>
              <td>{item.package_count || 0}</td>
              <td className="b">{fmtNum(item.net_weight)}</td>
              <td>{priceText(item)}</td>
              <td className="b">₪{fmtMoney(item.item_total)}</td>
            </tr>
          ))}
          <tr className="ff-sub">
            <td className="r" colSpan={4}>סה"כ {product}</td>
            <td>{fmtNum(sums.packages, 0)}</td>
            <td>{fmtNum(sums.weight)}</td>
            <td></td>
            <td>₪{fmtMoney(sums.amount)}</td>
          </tr>
        </tbody>
      </table>
    </section>
  ));
}

function DayGroups({ groups }) {
  return groups.map(({ date, entries }) => {
    const dayWeight = entries.reduce((s, e) => s + (parseFloat(e.cert.total_weight) || 0), 0);
    const dayAmount = entries.reduce((s, e) => s + (parseFloat(e.cert.total_amount) || 0), 0);
    return (
      <section key={date} className="ff-group">
        <div className="ff-group-head">
          <span className="t">{date !== 'ללא תאריך' ? format(new Date(date), 'EEEE, dd/MM/yyyy', { locale: he }) : 'ללא תאריך'}</span>
          <span className="s">{entries.length} תעודות · {fmtNum(dayWeight)} ק"ג · ₪{fmtMoney(dayAmount)}</span>
        </div>
        {entries.map(({ cert, items }) => (
          <React.Fragment key={cert.id}>
            <div className="ff-cert-head">
              <span>
                <b>תעודה #{certNumber(cert)}</b>
                {cert.time ? ` · ${cert.time}` : ''}
                {cert.vehicle_number ? ` · רכב ${cert.vehicle_number}` : ''}
                {cert.driver_name ? ` · נהג: ${cert.driver_name}` : ''}
                {STATUS_HE[cert.status] ? ` · ${STATUS_HE[cert.status]}` : ''}
              </span>
              <b style={{ whiteSpace: 'nowrap' }}>{fmtNum(cert.total_weight)} ק"ג · ₪{fmtMoney(cert.total_amount)}</b>
            </div>
            {items.length > 0 && (
              <table className="ff-table" style={{ marginBottom: '2mm' }}>
                <Cols widths={[44, 16, 28, 16, 22, 28, 32]} />
                <thead>
                  <tr><th className="r">מוצר</th><th>איכות</th><th>אריזה</th><th>כמות</th><th>נטו ק"ג</th><th>מחיר</th><th>סה"כ</th></tr>
                </thead>
                <tbody>
                  {items.map((it, idx) => (
                    <tr key={it.id || idx}>
                      <td className="r">{it.product_name || ''}</td>
                      <td>{it.quality || ''}</td>
                      <td>{it.packaging_type || '-'}</td>
                      <td>{it.package_count || 0}</td>
                      <td className="b">{fmtNum(it.net_weight)}</td>
                      <td>{priceText(it)}</td>
                      <td className="b">₪{fmtMoney(it.item_total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </React.Fragment>
        ))}
      </section>
    );
  });
}

export default function CustomerOpenReportLayout({ customer, groups, productGroups, totals, farmName, mode = 'product' }) {
  if (!customer || !groups) return null;
  const byProduct = mode === 'product';
  const resolvedProductGroups = byProduct
    ? (productGroups || groupEntriesByProduct(groups.flatMap(g => g.entries)))
    : null;
  const dateRange = (() => {
    const dates = groups.map(g => g.date).filter(d => d && d !== 'ללא תאריך').sort();
    if (dates.length === 0) return null;
    const from = fmtDate(dates[0]);
    const to = fmtDate(dates[dates.length - 1]);
    return from === to ? from : `${from} – ${to}`;
  })();

  return (
    <div className="ff-doc" dir="rtl">
      <style dangerouslySetInnerHTML={{ __html: A4_DOC_CSS }} />
      <header className="ff-head">
        <div className="ff-brand">
          <h1>{farmName || 'FarmFlow'}</h1>
          <div className="ff-sub">הופק: {format(new Date(), 'dd/MM/yyyy HH:mm')}</div>
        </div>
        <div className="ff-title">
          <div className="ff-title-text">
            <h2>דוח תעודות פתוחות</h2>
            <div className="ff-doc-no">{customer.name}</div>
            <div className="ff-sub">{byProduct ? 'לפי פריט' : 'לפי יום'}{dateRange ? ` · ${dateRange}` : ''}</div>
          </div>
        </div>
      </header>

      <div className="ff-kpis">
        {[
          [totals.certs, 'תעודות'],
          [`${fmtNum(totals.weight)} ק"ג`, 'משקל נטו'],
          [fmtNum(totals.packages, 0), 'אריזות'],
          [`₪${fmtMoney(totals.amount)}`, 'סה"כ'],
        ].map(([v, l], i) => (
          <div key={i} className="ff-kpi"><div className="v">{v}</div><div className="l">{l}</div></div>
        ))}
      </div>

      {byProduct ? <ProductGroups productGroups={resolvedProductGroups} /> : <DayGroups groups={groups} />}

      <div className="ff-grand">
        <span>סה"כ {totals.certs} תעודות פתוחות{byProduct && resolvedProductGroups ? ` · ${resolvedProductGroups.length} פריטים` : ''}</span>
        <span>{fmtNum(totals.weight)} ק"ג · {fmtNum(totals.packages, 0)} אריזות · ₪{fmtMoney(totals.amount)}</span>
      </div>

      <footer className="ff-foot">
        <span>דוח תעודות פתוחות · {customer.name}</span>
        <span>הופק באמצעות FarmFlow</span>
      </footer>
    </div>
  );
}
