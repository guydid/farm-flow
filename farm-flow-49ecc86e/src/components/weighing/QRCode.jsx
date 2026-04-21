import React from 'react';

export default function QRCode({ data, size = 100 }) {
  if (!data) {
    return null;
  }

  // Using a free, public QR code generation API
  const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(data)}&size=${size}x${size}&qzone=1`;

  return (
    <img 
      src={qrApiUrl} 
      alt={`QR Code for ${data}`} 
      width={size} 
      height={size} 
      className="rounded-md"
    />
  );
}