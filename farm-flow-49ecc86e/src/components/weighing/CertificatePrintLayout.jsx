import React from 'react';
import { format } from 'date-fns';
import QRCode from './QRCode';

const safeArray = (arr) => (Array.isArray(arr) ? arr : []);
const safeObject = (obj) => {
  if (obj === null || typeof obj !== 'object') {
    return {};
  }
  if (Object.prototype.hasOwnProperty.call(obj, 'hasOwnProperty') === false || typeof obj.hasOwnProperty !== 'function') {
    return { ...obj };
  }
  return obj;
};

// פריסת תעודת שקילה להדפסה ולשיתוף כ-PDF. משמשת גם את WeighingDetail (הדפסה)
// וגם את useCertificateShare (צילום לפריסה נסתרת ושיתוף).
export default function CertificatePrintLayout({ certificate, items, companySettings, customer }) {
  const safeCertificate = safeObject(certificate);
  const safeCompanySettings = safeObject(companySettings);
  const safeCustomer = safeObject(customer);
  const safeItems = safeArray(items);

  if (!safeCertificate || safeItems.length === 0) {
    return (
      <div className="p-8 text-center">
        <h2>טוען נתונים להדפסה...</h2>
      </div>
    );
  }

  const groupedItems = safeItems.reduce((acc, item) => {
    const currentItem = safeObject(item);
    if (Object.keys(currentItem).length === 0) return acc;

    const key = `${currentItem.product_name || 'ללא שם'}_${currentItem.quality || 'לא צוין'}`;

    if (!(key in acc)) {
      acc[key] = {
        product_name: currentItem.product_name || 'ללא שם מוצר',
        quality: currentItem.quality || 'לא צוין',
        items: [],
        subtotal_weight: 0,
        subtotal_packages: 0,
        subtotal_amount: 0
      };
    }

    acc[key].items.push(currentItem);
    acc[key].subtotal_weight += parseFloat(currentItem.net_weight || 0);
    acc[key].subtotal_packages += parseInt(currentItem.package_count || 0);
    acc[key].subtotal_amount += parseFloat(currentItem.item_total || 0);

    return acc;
  }, {});

  const groups = Object.values(groupedItems);

  return (
    <div dir="rtl" style={{
      fontFamily: 'Arial, sans-serif',
      fontSize: '12px',
      lineHeight: '1.4',
      color: '#000',
      backgroundColor: '#fff',
      padding: '20px'
    }}>
      <style>{`
        @media print {
          @page {
            size: A4;
            margin: 1cm;
          }
          body {
            margin: 0;
            padding: 0;
            -webkit-print-color-adjust: exact !important;
            color-adjust: exact !important;
            background-color: #fff !important;
          }
          * {
            -webkit-print-color-adjust: exact !important;
            color-adjust: exact !important;
          }
        }
        .print-table {
          border-collapse: collapse;
          width: 100%;
          margin: 10px 0;
        }
        .print-table th, .print-table td {
          border: 1px solid #000;
          padding: 6px 4px;
          font-size: 10px;
          text-align: right;
        }
        .print-table th {
          background-color: #f0f0f0 !important;
          font-weight: bold;
          text-align: center;
          -webkit-print-color-adjust: exact !important;
          color-adjust: exact !important;
        }
        .subtotal-row {
          background-color: #f5f5f5 !important;
          font-weight: bold;
          -webkit-print-color-adjust: exact !important;
          color-adjust: exact !important;
        }
        .total-row {
          background-color: #e0e0e0 !important;
          font-weight: bold;
          font-size: 11px;
          -webkit-print-color-adjust: exact !important;
          color-adjust: exact !important;
        }
      `}</style>

      {/* Header */}
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '2px solid #000', paddingBottom: '15px', marginBottom: '20px' }}>
        <div style={{ flex: '1', textAlign: 'right' }}>
          <h1 style={{ fontSize: '18px', fontWeight: 'bold', margin: '0 0 10px 0' }}>
            {safeCompanySettings.company_name || 'שם המשק'}
          </h1>
          <div style={{ fontSize: '10px', lineHeight: '1.5' }}>
            <div>ע.מ/ח.פ: {safeCompanySettings.business_number || 'לא צוין'}</div>
            <div>{safeCompanySettings.address || ''}{safeCompanySettings.city ? `, ${safeCompanySettings.city}` : ''}</div>
            <div>טלפון: {safeCompanySettings.phone || 'לא צוין'}</div>
            {safeCompanySettings.email && <div>אימייל: {safeCompanySettings.email}</div>}
          </div>
        </div>

        <div style={{ flex: '1', textAlign: 'center' }}>
          <h2 style={{ fontSize: '20px', fontWeight: 'bold', margin: '0 0 15px 0' }}>תעודת שקילה</h2>
          <div style={{ backgroundColor: '#f5f5f5', padding: '10px', border: '1px solid #ccc' }}>
            <div style={{ fontWeight: 'bold' }}>מס' תעודה: {safeCertificate.reference_number || safeCertificate.id?.toString().slice(-5) || 'לא זמין'}</div>
            <div>תאריך: {safeCertificate.date ? format(new Date(safeCertificate.date), 'dd/MM/yyyy') : 'לא צוין'}</div>
            <div>שעה: {safeCertificate.time || 'לא צוין'}</div>
          </div>
        </div>

        <div style={{ flex: '1', textAlign: 'left', display: 'flex', justifyContent: 'flex-end' }}>
          {safeCertificate.barcode && (
            <div style={{ textAlign: 'center' }}>
              <QRCode data={safeCertificate.barcode} size={60} />
              <div style={{ fontSize: '8px', marginTop: '5px', fontFamily: 'monospace' }}>{safeCertificate.barcode}</div>
            </div>
          )}
        </div>
      </header>

      {/* Customer and Transport Details */}
      <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '20px' }}>
        <div style={{ border: '1px solid #000', padding: '10px' }}>
          <h3 style={{ fontWeight: 'bold', margin: '0 0 10px 0', backgroundColor: '#f0f0f0', padding: '5px', textAlign: 'center' }}>פרטי לקוח</h3>
          <div style={{ fontSize: '10px', lineHeight: '1.6' }}>
            <div><strong>שם:</strong> {safeCustomer.name || safeCertificate.customer_name || 'לא צוין'}</div>
            <div><strong>כתובת:</strong> {safeCustomer.address || 'לא צוין'}</div>
            <div><strong>טלפון:</strong> {safeCustomer.phone || 'לא צוין'}</div>
            <div><strong>איש קשר:</strong> {safeCustomer.contact_person || 'לא צוין'}</div>
          </div>
        </div>

        <div style={{ border: '1px solid #000', padding: '10px' }}>
          <h3 style={{ fontWeight: 'bold', margin: '0 0 10px 0', backgroundColor: '#f0f0f0', padding: '5px', textAlign: 'center' }}>פרטי הובלה</h3>
          <div style={{ fontSize: '10px', lineHeight: '1.6' }}>
            <div><strong>נהג:</strong> {safeCertificate.driver_name || 'לא צוין'}</div>
            <div><strong>סוג רכב:</strong> {{
              truck: 'משאית',
              van: 'מסחרית',
              pickup: 'טנדר',
              trailer: 'נגרר'
            }[safeCertificate.vehicle_type] || safeCertificate.vehicle_type || 'לא צוין'}</div>
            <div><strong>מספר רכב:</strong> {safeCertificate.vehicle_number || 'לא צוין'}</div>
            <div><strong>סטטוס:</strong> {{
              draft: 'טיוטה',
              completed: 'הושלם',
              shipped: 'נשלח'
            }[safeCertificate.status] || safeCertificate.status}</div>
          </div>
        </div>
      </section>

      {/* Items Details */}
      <div>
        <table className="print-table">
          <thead>
            <tr>
              <th>מוצר</th>
              <th>איכות</th>
              <th>סוג אריזה</th>
              <th>כמות אריזות</th>
              <th>משקל ברוטו (ק"ג)</th>
              <th>משקל טרה (ק"ג)</th>
              <th>משקל נטו (ק"ג)</th>
              <th>מחיר</th>
              <th>הנחה %</th>
              <th>סה"כ ₪</th>
            </tr>
          </thead>
          <tbody>
            {groups.length === 0 ? (
              <tr>
                <td colSpan="10" style={{ textAlign: 'center', fontStyle: 'italic' }}>
                  אין פריטים בתעודה זו
                </td>
              </tr>
            ) : (
              groups.map((group, groupIndex) => {
                const safeGroup = safeObject(group);
                return (
                  <React.Fragment key={`group-${groupIndex}`}>
                    {safeArray(safeGroup.items).map((item, itemIndex) => {
                      const safeItem = safeObject(item);
                      return (
                        <tr key={safeItem.id || `item-${itemIndex}`}>
                          <td>{safeItem.product_name || ''}</td>
                          <td>{safeItem.quality || ''}</td>
                          <td>{safeItem.packaging_type || 'לא צוין'}</td>
                          <td style={{ textAlign: 'center' }}>{safeItem.package_count || 0}</td>
                          <td style={{ textAlign: 'center' }}>{parseFloat(safeItem.gross_weight || 0).toLocaleString()}</td>
                          <td style={{ textAlign: 'center' }}>{parseFloat(safeItem.tare_weight || 0).toLocaleString()}</td>
                          <td style={{ textAlign: 'center' }}>{parseFloat(safeItem.net_weight || 0).toLocaleString()}</td>
                          <td style={{ textAlign: 'center' }}>₪{parseFloat(safeItem.price_per_unit || 0).toLocaleString()}</td>
                          <td style={{ textAlign: 'center' }}>{parseFloat(safeItem.discount_percentage || 0)}%</td>
                          <td style={{ textAlign: 'center' }}>₪{parseFloat(safeItem.item_total || 0).toLocaleString()}</td>
                        </tr>
                      );
                    })}
                    <tr className="subtotal-row">
                      <td colSpan="3" style={{ textAlign: 'right' }}>
                        סיכום ביניים - {safeGroup.product_name} איכות {safeGroup.quality}
                      </td>
                      <td style={{ textAlign: 'center' }}>{safeGroup.subtotal_packages}</td>
                      <td colSpan="2"></td>
                      <td style={{ textAlign: 'center' }}>{safeGroup.subtotal_weight.toLocaleString()}</td>
                      <td colSpan="2"></td>
                      <td style={{ textAlign: 'center' }}>₪{safeGroup.subtotal_amount.toLocaleString()}</td>
                    </tr>
                  </React.Fragment>
                );
              })
            )}
            <tr className="total-row">
              <td colSpan="3" style={{ textAlign: 'right' }}><strong>סיכום כללי</strong></td>
              <td style={{ textAlign: 'center' }}><strong>{safeCertificate.total_packages || 0}</strong></td>
              <td colSpan="2"></td>
              <td style={{ textAlign: 'center' }}><strong>{parseFloat(safeCertificate.total_weight || 0).toLocaleString()}</strong></td>
              <td colSpan="2"></td>
              <td style={{ textAlign: 'center' }}><strong>₪{parseFloat(safeCertificate.total_amount || 0).toLocaleString()}</strong></td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Signatures */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '20px', marginTop: '30px' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ height: '40px', borderBottom: '1px solid #000', marginBottom: '10px' }}></div>
          <div style={{ fontSize: '10px', fontWeight: 'bold' }}>חתימת השוקל</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ height: '40px', borderBottom: '1px solid #000', marginBottom: '10px' }}></div>
          <div style={{ fontSize: '10px', fontWeight: 'bold' }}>חתימת הנהג</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ height: '40px', borderBottom: '1px solid #000', marginBottom: '10px' }}></div>
          <div style={{ fontSize: '10px', fontWeight: 'bold' }}>חתימת הלקוח</div>
        </div>
      </div>

      {/* Footer */}
      <div style={{ textAlign: 'center', fontSize: '9px', color: '#666', marginTop: '20px', paddingTop: '15px', borderTop: '1px solid #ccc' }}>
        <div>תעודה זו נוצרה באמצעות מערכת FarmFlow</div>
      </div>
    </div>
  );
}
