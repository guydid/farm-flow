import React from 'react';
import { format } from 'date-fns';
import { he } from 'date-fns/locale';

// דוח תעודות פתוחות ללקוח — מקובץ לפי יום, עם פירוט פריטים לכל תעודה.
// מעוצב ב-inline styles כדי שגם צילום ל-PDF (html2canvas) וגם חלון הדפסה
// יראו זהה, בלי תלות ב-Tailwind.
const cell = { border: '1px solid #ddd', padding: '5px 6px', fontSize: '11px', textAlign: 'right' };
const cellC = { ...cell, textAlign: 'center' };

const fmtNum = (n, digits = 1) => (parseFloat(n) || 0).toLocaleString(undefined, { maximumFractionDigits: digits });
const fmtMoney = (n) => (parseFloat(n) || 0).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const STATUS_HE = { draft: 'טיוטה', completed: 'הושלם', shipped: 'נשלח' };

export default function CustomerOpenReportLayout({ customer, groups, totals, farmName }) {
  if (!customer || !groups) return null;
  return (
    <div dir="rtl" style={{ fontFamily: 'Arial, sans-serif', color: '#000', backgroundColor: '#fff', padding: '20px', lineHeight: 1.4 }}>
      {/* כותרת */}
      <header style={{ borderBottom: '2px solid #000', paddingBottom: '12px', marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <h1 style={{ fontSize: '18px', fontWeight: 'bold', margin: 0 }}>דוח תעודות פתוחות</h1>
          <div style={{ fontSize: '13px', marginTop: '4px' }}>
            לקוח: <strong>{customer.name}</strong>
          </div>
        </div>
        <div style={{ textAlign: 'left', fontSize: '10px', color: '#444' }}>
          {farmName && <div style={{ fontWeight: 'bold', fontSize: '12px' }}>{farmName}</div>}
          <div>הופק: {format(new Date(), 'dd/MM/yyyy HH:mm')}</div>
        </div>
      </header>

      {/* סיכום עליון */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '16px' }}>
        {[
          [totals.certs, 'תעודות'],
          [`${fmtNum(totals.weight)} ק"ג`, 'משקל נטו'],
          [fmtNum(totals.packages, 0), 'אריזות'],
          [`₪${fmtMoney(totals.amount)}`, 'סה"כ'],
        ].map(([v, l], i) => (
          <div key={i} style={{ flex: 1, border: '1px solid #ccc', borderRadius: '6px', padding: '8px', textAlign: 'center', backgroundColor: '#fafafa' }}>
            <div style={{ fontWeight: 'bold', fontSize: '14px' }}>{v}</div>
            <div style={{ fontSize: '10px', color: '#666' }}>{l}</div>
          </div>
        ))}
      </div>

      {/* קבוצות לפי יום */}
      {groups.map(({ date, entries }) => {
        const dayWeight = entries.reduce((s, e) => s + (parseFloat(e.cert.total_weight) || 0), 0);
        const dayAmount = entries.reduce((s, e) => s + (parseFloat(e.cert.total_amount) || 0), 0);
        return (
          <section key={date} style={{ marginBottom: '18px' }}>
            <div style={{ backgroundColor: '#f0f0f0', border: '1px solid #ccc', padding: '6px 10px', fontWeight: 'bold', fontSize: '12px', display: 'flex', justifyContent: 'space-between' }}>
              <span>
                {date !== 'ללא תאריך' ? format(new Date(date), 'EEEE, dd/MM/yyyy', { locale: he }) : 'ללא תאריך'}
              </span>
              <span style={{ fontWeight: 'normal', fontSize: '11px' }}>
                {entries.length} תעודות · {fmtNum(dayWeight)} ק"ג · ₪{fmtMoney(dayAmount)}
              </span>
            </div>

            {entries.map(({ cert, items }) => (
              <div key={cert.id} style={{ border: '1px solid #ddd', borderTop: 'none' }}>
                {/* שורת תעודה */}
                <div style={{ padding: '6px 10px', backgroundColor: '#fafafa', fontSize: '11px', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '4px' }}>
                  <span>
                    <strong>תעודה #{String(cert.id || '').slice(-5)}</strong>
                    {cert.time ? ` · ${cert.time}` : ''}
                    {cert.vehicle_number ? ` · רכב ${cert.vehicle_number}` : ''}
                    {cert.driver_name ? ` · נהג: ${cert.driver_name}` : ''}
                    {` · ${STATUS_HE[cert.status] || cert.status || ''}`}
                  </span>
                  <span style={{ fontWeight: 'bold' }}>
                    {fmtNum(cert.total_weight)} ק"ג · ₪{fmtMoney(cert.total_amount)}
                  </span>
                </div>
                {/* פריטי התעודה */}
                {items.length > 0 && (
                  <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                    <thead>
                      <tr style={{ backgroundColor: '#f7f7f7' }}>
                        <th style={cell}>מוצר</th>
                        <th style={cellC}>איכות</th>
                        <th style={cellC}>אריזה</th>
                        <th style={cellC}>כמות</th>
                        <th style={cellC}>נטו (ק"ג)</th>
                        <th style={cellC}>מחיר</th>
                        <th style={cellC}>סה"כ ₪</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((it, idx) => (
                        <tr key={it.id || idx}>
                          <td style={cell}>{it.product_name || ''}</td>
                          <td style={cellC}>{it.quality || ''}</td>
                          <td style={cellC}>{it.packaging_type || '-'}</td>
                          <td style={cellC}>{it.package_count || 0}</td>
                          <td style={cellC}>{fmtNum(it.net_weight)}</td>
                          <td style={cellC}>
                            ₪{fmtNum(it.price_per_unit, 2)}{it.pricing_method === 'per_kg' ? '/ק"ג' : '/יח׳'}
                            {parseFloat(it.discount_percentage) > 0 ? ` (-${it.discount_percentage}%)` : ''}
                          </td>
                          <td style={{ ...cellC, fontWeight: 'bold' }}>₪{fmtMoney(it.item_total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            ))}
          </section>
        );
      })}

      {/* סיכום תחתון */}
      <div style={{ borderTop: '2px solid #000', paddingTop: '8px', display: 'flex', justifyContent: 'space-between', fontSize: '13px', fontWeight: 'bold' }}>
        <span>סה"כ {totals.certs} תעודות פתוחות</span>
        <span>{fmtNum(totals.weight)} ק"ג · {fmtNum(totals.packages, 0)} אריזות · ₪{fmtMoney(totals.amount)}</span>
      </div>

      <div style={{ textAlign: 'center', fontSize: '9px', color: '#666', marginTop: '14px' }}>
        הופק באמצעות מערכת FarmFlow
      </div>
    </div>
  );
}
