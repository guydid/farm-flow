import React, { useState, useRef, useEffect } from 'react';
import ReactCrop from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import { Button } from '@/components/ui/button';
import { Check, X, Loader2 } from 'lucide-react';

// מסך קרופ ידני לחשבונית שצולמה. גוררים מסגרת לחיתוך, ואז "חתוך וסרוק".
// מייצא JPEG מוקטן (≤1568px) — קטן ומהיר להעלאה ולחילוץ.
export default function CropDialog({ file, onConfirm, onCancel }) {
  const [imgSrc, setImgSrc] = useState('');
  const [crop, setCrop] = useState();
  const [completedCrop, setCompletedCrop] = useState(null);
  const [busy, setBusy] = useState(false);
  const imgRef = useRef(null);

  useEffect(() => {
    const fr = new FileReader();
    fr.onload = () => setImgSrc(fr.result);
    fr.readAsDataURL(file);
  }, [file]);

  // ברירת מחדל: מסגרת על כמעט כל התמונה (המשתמש מצמצם לפי הצורך)
  const onImageLoad = () => {
    setCrop({ unit: '%', x: 3, y: 3, width: 94, height: 94 });
  };

  const build = async (useFull) => {
    setBusy(true);
    try {
      const img = imgRef.current;
      const natW = img.naturalWidth, natH = img.naturalHeight;
      const scaleX = natW / img.width, scaleY = natH / img.height;
      let sx, sy, sw, sh;
      if (useFull || !completedCrop || !completedCrop.width || !completedCrop.height) {
        sx = 0; sy = 0; sw = natW; sh = natH;
      } else {
        sx = completedCrop.x * scaleX;
        sy = completedCrop.y * scaleY;
        sw = completedCrop.width * scaleX;
        sh = completedCrop.height * scaleY;
      }
      const maxSide = 1568;
      const scale = Math.min(1, maxSide / Math.max(sw, sh));
      const outW = Math.max(1, Math.round(sw * scale));
      const outH = Math.max(1, Math.round(sh * scale));
      const canvas = document.createElement('canvas');
      canvas.width = outW; canvas.height = outH;
      canvas.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);
      const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.85));
      const baseName = (file.name || 'invoice').replace(/\.[^.]+$/, '');
      onConfirm(blob ? new File([blob], `${baseName}.jpg`, { type: 'image/jpeg' }) : file);
    } catch {
      onConfirm(file); // נכשל — שולחים את המקור
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/95 flex flex-col" dir="rtl">
      <div className="flex items-center justify-between px-4 py-3 text-white flex-shrink-0">
        <span className="text-sm font-semibold">חתוך את החשבונית</span>
        <button onClick={onCancel} className="p-2 -m-2 rounded-full hover:bg-white/10" aria-label="סגור">
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-auto flex items-center justify-center p-2">
        {imgSrc ? (
          <ReactCrop
            crop={crop}
            onChange={c => setCrop(c)}
            onComplete={c => setCompletedCrop(c)}
            keepSelection
          >
            <img
              ref={imgRef}
              src={imgSrc}
              onLoad={onImageLoad}
              alt="חשבונית לחיתוך"
              style={{ maxHeight: '72vh', maxWidth: '100%', display: 'block' }}
            />
          </ReactCrop>
        ) : (
          <Loader2 className="w-8 h-8 animate-spin text-white/70" />
        )}
      </div>

      <p className="text-center text-xs text-white/60 pb-2">גרור את הפינות לחיתוך לפי גבולות החשבונית</p>
      <div className="px-4 pb-4 pt-2 flex gap-2 flex-shrink-0" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}>
        <Button onClick={() => build(true)} disabled={busy} variant="outline" className="flex-1 bg-white/10 text-white border-white/30 hover:bg-white/20">
          תמונה מלאה
        </Button>
        <Button onClick={() => build(false)} disabled={busy} className="flex-1">
          {busy ? <Loader2 className="w-4 h-4 animate-spin ml-1" /> : <Check className="w-4 h-4 ml-1" />}
          חתוך וסרוק
        </Button>
      </div>
    </div>
  );
}
