import React from 'react';
import { format } from 'date-fns';
import QRCode from './QRCode';

export default function PalletSticker({ item, certificate, settings, printerConfig }) {
  if (!item) return null;

  // Check if we should use Zebra direct print
  const shouldUseZebraPrint = printerConfig?.printer_type === 'zebra' && printerConfig?.enable_direct_print;

  // If using Zebra, the component returns null to indicate that ZPL should be generated externally.
  // We check for `window.BrowserPrint` to ensure the Zebra browser print app is available.
  if (shouldUseZebraPrint && typeof window !== 'undefined' && window.BrowserPrint) {
    // This component will trigger ZPL generation instead of HTML rendering.
    // The actual ZPL generation and printing will be handled by the calling component
    // using the exported generateZPL function.
    return null;
  }

  // Regular HTML sticker for browser print
  return (
    <div className="p-4 border border-black" style={{ width: '400px', height: '300px' }}>
      <div className="flex justify-between items-center mb-2">
        <h1 className="text-xl font-bold">{settings?.company_name || 'שם חברה'}</h1>
        <p className="text-lg font-semibold">
          {format(new Date(certificate.date), 'dd/MM/yyyy')}
        </p>
      </div>
      <hr className="border-black mb-2" />

      <div className="grid grid-cols-5 gap-2 text-sm mb-2">
        <div className="col-span-3">
          <p><span className="font-bold">לקוח:</span> {certificate.customer_name}</p>
          <p className="text-xl font-bold my-1">{item.product_name}</p>
          <p><span className="font-bold">אריזה:</span> {item.packaging_type} ({item.package_count} יח')</p>
        </div>
        <div className="col-span-2 flex flex-col items-center justify-center">
          {item.barcode && <QRCode data={item.barcode} size={80} />}
          <p className="text-xs font-mono mt-1">{item.barcode}</p>
        </div>
      </div>
      
      <hr className="border-black my-2" />

      <div className="grid grid-cols-3 gap-2 text-center text-sm">
        <div>
          <p className="font-bold">ברוטו</p>
          <p className="text-lg">{parseFloat(item.gross_weight || 0).toLocaleString()} ק"ג</p>
        </div>
        <div>
          <p className="font-bold">טרה</p>
          <p className="text-lg">{parseFloat(item.tare_weight || 0).toLocaleString()} ק"ג</p>
        </div>
        <div>
          <p className="font-bold text-base">נטו</p>
          <p className="text-2xl font-bold">{parseFloat(item.net_weight || 0).toLocaleString()}</p>
          <p className="text-lg font-bold -mt-1">ק"ג</p>
        </div>
      </div>

      <div className="mt-2 text-center">
        <p className="text-lg font-bold">איכות: {item.quality}</p>
      </div>
    </div>
  );
}

// Export function to generate ZPL for Zebra printers
export function generateZPL(item, certificate, settings, printerConfig) {
  // Default values for printer settings if not provided
  const width = printerConfig?.sticker_width || '100'; // in mm
  const height = printerConfig?.sticker_height || '70'; // in mm
  const darkness = printerConfig?.print_darkness || '15'; // 0-30
  const speed = printerConfig?.print_speed || '4'; // 2-12 inches per second

  // Format date once
  const formattedDate = format(new Date(certificate.date), 'dd/MM/yyyy');

  // Convert mm to dots (assuming 8 dots/mm for typical Zebra printers)
  const dotsWidth = parseInt(width) * 8;
  const dotsHeight = parseInt(height) * 8;

  // ZPL for QR code and barcode text, only if barcode exists
  const qrCodeZPL = item.barcode 
    ? `^FO350,30^BQN,2,5^FDQA,${item.barcode}^FS` + // QR code
      `^FO350,110^A0N,15,15^FD${item.barcode}^FS` // Barcode text below QR
    : '';

  return `
^XA
^CI28             
^PW${dotsWidth}
^LL${dotsHeight}
^MD${darkness}
^PR${speed}

~TA000
~JSN
^LT0
^MNW
^MTT
^PON
^PMN
^LH0,0
^JMA
^PR4,4

^FO30,30^A0N,30,30^FR^FD${settings?.company_name || 'שם חברה'}^FS
^FO30,70^A0N,25,25^FR^FD${formattedDate}^FS

^FO30,120^A0N,20,20^FR^FDלקוח: ${certificate.customer_name}^FS
^FO30,150^A0N,40,40^FR^FD${item.product_name}^FS

^FO30,200^A0N,18,18^FR^FDאריזה: ${item.packaging_type} (${item.package_count} יח')^FS

${qrCodeZPL}

^FO30,270^A0N,16,16^FR^FDברוטו^FS
^FO100,270^A0N,20,20^FR^FD${parseFloat(item.gross_weight || 0).toLocaleString()} ק"ג^FS

^FO200,270^A0N,16,16^FR^FDטרה^FS
^FO260,270^A0N,20,20^FR^FD${parseFloat(item.tare_weight || 0).toLocaleString()} ק"ג^FS

^FO30,320^A0N,18,18^FR^FDנטו^FS
^FO100,310^A0N,35,35^FR^FD${parseFloat(item.net_weight || 0).toLocaleString()}^FS
^FO280,320^A0N,25,25^FR^FDק"ג^FS

^FO30,380^A0N,25,25^FR^FDאיכות: ${item.quality}^FS

^XZ
  `;
}