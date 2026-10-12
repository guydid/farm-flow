import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Check, X, Loader2, RotateCw, Crop, Trash2, Plus, Camera, ImagePlus, FileText } from 'lucide-react';
import {
  loadImageFile, warpQuad, applyFilter, rotateCanvas, canvasToJpeg, DEFAULT_QUAD, FULL_QUAD,
} from '@/lib/docScan';

// סורק מסמכים: לכל עמוד — גוררים 4 פינות על גבולות החשבונית (יישור פרספקטיבה), בוחרים
// מסנן (משופר / שחור-לבן / מקור) ומסובבים לפי הצורך. אפשר להוסיף עמודים; בסיום כל העמודים
// נשלחים לשרת ומאוחדים ל-PDF אחד.
const MAX_PAGES = 10;
const FILTERS = [
  { id: 'enhance', label: 'משופר' },
  { id: 'bw', label: 'שחור-לבן' },
  { id: 'text', label: 'טקסט' },
  { id: 'original', label: 'מקור' },
];
let nextId = 1;

export default function ScanDialog({ files, onConfirm, onCancel }) {
  const [pages, setPages] = useState([]); // { id, srcUrl, quad, filter, rotation, previewUrl, w, h }
  const [current, setCurrent] = useState(0);
  const [mode, setMode] = useState('crop'); // crop | review
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const sources = useRef(new Map());   // id → canvas מקור (מוקטן)
  const warped = useRef(new Map());    // id → { key, canvas } — מטמון יישור, כדי שהחלפת מסנן תהיה מיידית
  const urls = useRef(new Set());
  const cameraRef = useRef(null);
  const galleryRef = useRef(null);

  const trackUrl = (u) => { urls.current.add(u); return u; };
  useEffect(() => () => { for (const u of urls.current) URL.revokeObjectURL(u); }, []);

  const addFiles = useCallback(async (list) => {
    const imgs = [...(list || [])].filter(f => f.type?.startsWith('image/'));
    if (!imgs.length) return;
    setBusy(true);
    setError(null);
    try {
      const added = [];
      for (const f of imgs) {
        const canvas = await loadImageFile(f);
        const id = nextId++;
        sources.current.set(id, canvas);
        const srcUrl = trackUrl(URL.createObjectURL(await canvasToJpeg(canvas, 0.8)));
        added.push({ id, srcUrl, quad: DEFAULT_QUAD, filter: 'enhance', rotation: 0, previewUrl: null, w: canvas.width, h: canvas.height });
      }
      setPages(prev => {
        const room = MAX_PAGES - prev.length;
        if (added.length > room) setError(`אפשר עד ${MAX_PAGES} עמודים`);
        const next = [...prev, ...added.slice(0, Math.max(0, room))];
        setCurrent(prev.length < next.length ? prev.length : Math.max(0, next.length - 1));
        return next;
      });
      setMode('crop');
    } catch (e) {
      setError('לא ניתן לטעון את התמונה');
    } finally {
      setBusy(false);
    }
  }, []);

  const loadedInitial = useRef(null);
  useEffect(() => {
    if (loadedInitial.current === files) return; // StrictMode מריץ effects פעמיים
    loadedInitial.current = files;
    addFiles(files);
  }, [files, addFiles]);

  const page = pages[current];
  const updatePage = (id, patch) => setPages(prev => prev.map(p => (p.id === id ? { ...p, ...patch } : p)));

  // יישור + מסנן + סיבוב → קנבס סופי של העמוד
  const renderPage = (p) => {
    const key = JSON.stringify(p.quad);
    let w = warped.current.get(p.id);
    if (!w || w.key !== key) {
      w = { key, canvas: warpQuad(sources.current.get(p.id), p.quad) };
      warped.current.set(p.id, w);
    }
    return rotateCanvas(applyFilter(w.canvas, p.filter), p.rotation);
  };

  const refreshPreview = async (p) => {
    setBusy(true);
    // נותנים לספינר להופיע לפני העיבוד הסינכרוני
    await new Promise(r => setTimeout(r, 30));
    try {
      const blob = await canvasToJpeg(renderPage(p), 0.8);
      updatePage(p.id, { ...p, previewUrl: trackUrl(URL.createObjectURL(blob)) });
    } catch {
      setError('עיבוד העמוד נכשל — נסה לסמן את הפינות מחדש');
    } finally {
      setBusy(false);
    }
  };

  const confirmCrop = async () => { await refreshPreview(page); setMode('review'); };
  const setFilter = (filter) => refreshPreview({ ...page, filter });
  const rotate = () => refreshPreview({ ...page, rotation: (page.rotation + 90) % 360 });

  const removePage = () => {
    const id = page.id;
    sources.current.delete(id); warped.current.delete(id);
    const next = pages.filter(p => p.id !== id);
    if (!next.length) return onCancel();
    setPages(next);
    setCurrent(Math.min(current, next.length - 1));
    setMode(next[Math.min(current, next.length - 1)].previewUrl ? 'review' : 'crop');
  };

  const selectPage = (i) => { setCurrent(i); setMode(pages[i].previewUrl ? 'review' : 'crop'); };

  const finish = async () => {
    setBusy(true);
    await new Promise(r => setTimeout(r, 30));
    try {
      const out = [];
      for (let i = 0; i < pages.length; i++) {
        const blob = await canvasToJpeg(renderPage(pages[i]), 0.85);
        out.push(new File([blob], `page-${i + 1}.jpg`, { type: 'image/jpeg' }));
      }
      onConfirm(out);
    } catch {
      setError('הכנת העמודים נכשלה');
      setBusy(false);
    }
  };

  const pendingCrop = pages.some(p => !p.previewUrl);

  return (
    <div className="fixed inset-0 z-[60] bg-black/95 flex flex-col" dir="rtl">
      <div className="flex items-center justify-between px-4 py-3 text-white flex-shrink-0">
        <span className="text-sm font-semibold">
          {mode === 'crop' ? 'סמן את פינות החשבונית' : 'בדוק את הסריקה'}
          {pages.length > 1 && <span className="text-white/60 font-normal"> · עמוד {current + 1} מתוך {pages.length}</span>}
        </span>
        <button onClick={onCancel} className="p-2 -m-2 rounded-full hover:bg-white/10" aria-label="סגור">
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="flex-1 min-h-0 flex items-center justify-center p-3 relative">
        {!page ? (
          <Loader2 className="w-8 h-8 animate-spin text-white/70" />
        ) : mode === 'crop' ? (
          <QuadEditor key={page.id} src={page.srcUrl} aspect={page.w / page.h} quad={page.quad}
                      onChange={(quad) => updatePage(page.id, { quad })} />
        ) : (
          <img src={page.previewUrl} alt={`עמוד ${current + 1}`} className="max-h-full max-w-full object-contain bg-white shadow-lg" />
        )}
        {busy && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40">
            <Loader2 className="w-8 h-8 animate-spin text-white" />
          </div>
        )}
      </div>

      {error && <p className="text-center text-xs text-red-300 pb-1">{error}</p>}

      {page && mode === 'crop' && (
        <>
          <p className="text-center text-xs text-white/60 pb-2">גרור כל עיגול לפינה של החשבונית — התמונה תיושר אוטומטית</p>
          <div className="px-4 pt-1 flex gap-2 flex-shrink-0" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}>
            <Button onClick={() => updatePage(page.id, { quad: FULL_QUAD })} disabled={busy} variant="outline"
                    className="flex-1 bg-white/10 text-white border-white/30 hover:bg-white/20">
              תמונה מלאה
            </Button>
            <Button onClick={confirmCrop} disabled={busy} className="flex-1">
              <Check className="w-4 h-4 ml-1" /> המשך
            </Button>
          </div>
        </>
      )}

      {page && mode === 'review' && (
        <div className="flex-shrink-0 space-y-3 px-4 pt-1" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}>
          <div className="flex items-center justify-center gap-2 flex-wrap">
            {FILTERS.map(f => (
              <button key={f.id} onClick={() => setFilter(f.id)} disabled={busy}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium border ${page.filter === f.id ? 'bg-white text-gray-900 border-white' : 'text-white border-white/30 hover:bg-white/10'}`}>
                {f.label}
              </button>
            ))}
            <span className="w-px h-5 bg-white/20 mx-1" />
            <IconBtn onClick={rotate} disabled={busy} label="סובב"><RotateCw className="w-4 h-4" /></IconBtn>
            <IconBtn onClick={() => setMode('crop')} disabled={busy} label="חיתוך"><Crop className="w-4 h-4" /></IconBtn>
            <IconBtn onClick={removePage} disabled={busy} label="מחק עמוד"><Trash2 className="w-4 h-4" /></IconBtn>
          </div>
          {page.filter === 'text' && (
            <p className="text-center text-xs text-amber-200/90">
              מתאים לקבלות דהויות. בצילום מטושטש בדוק שהנקודות העשרוניות בסכומים נשמרו — אם לא, חזור ל"משופר".
            </p>
          )}

          <div className="flex gap-2 overflow-x-auto pb-1">
            {pages.map((p, i) => (
              <button key={p.id} onClick={() => selectPage(i)}
                      className={`relative flex-shrink-0 w-12 h-16 rounded border-2 overflow-hidden bg-white/10 ${i === current ? 'border-indigo-400' : 'border-transparent'}`}>
                <img src={p.previewUrl || p.srcUrl} alt="" className="w-full h-full object-cover" />
                <span className="absolute bottom-0 inset-x-0 text-[10px] bg-black/60 text-white">{i + 1}</span>
              </button>
            ))}
            {pages.length < MAX_PAGES && (
              <>
                <button onClick={() => cameraRef.current?.click()} disabled={busy}
                        className="flex-shrink-0 w-12 h-16 rounded border-2 border-dashed border-white/30 text-white/80 flex flex-col items-center justify-center text-[10px] gap-0.5">
                  <Camera className="w-4 h-4" /> עמוד
                </button>
                <button onClick={() => galleryRef.current?.click()} disabled={busy}
                        className="flex-shrink-0 w-12 h-16 rounded border-2 border-dashed border-white/30 text-white/80 flex flex-col items-center justify-center text-[10px] gap-0.5">
                  <ImagePlus className="w-4 h-4" /> גלריה
                </button>
              </>
            )}
          </div>

          <Button onClick={finish} disabled={busy || pendingCrop} className="w-full">
            <FileText className="w-4 h-4 ml-1" />
            {pendingCrop ? 'סמן פינות בכל העמודים' : `צור PDF וסרוק${pages.length > 1 ? ` (${pages.length} עמודים)` : ''}`}
          </Button>
        </div>
      )}

      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden"
             onChange={e => { addFiles(e.target.files); e.target.value = ''; }} />
      <input ref={galleryRef} type="file" accept="image/*" multiple className="hidden"
             onChange={e => { addFiles(e.target.files); e.target.value = ''; }} />
    </div>
  );
}

function IconBtn({ onClick, disabled, label, children }) {
  return (
    <button onClick={onClick} disabled={disabled} title={label} aria-label={label}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs text-white border border-white/30 hover:bg-white/10">
      {children}<span className="hidden sm:inline">{label}</span>
    </button>
  );
}

// עורך 4 פינות: התמונה ממלאת את השטח הפנוי, ומעליה SVG עם המרובע וידיות גרירה גדולות.
// בזמן גרירה מוצגת זכוכית מגדלת בפינה העליונה — האצבע מסתירה בדיוק את הנקודה שמסמנים.
function QuadEditor({ src, aspect, quad, onChange }) {
  const boxRef = useRef(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [drag, setDrag] = useState(null); // אינדקס הפינה הנגררת

  useEffect(() => {
    const el = boxRef.current?.parentElement;
    if (!el) return;
    const fit = () => {
      const cw = el.clientWidth - 24, ch = el.clientHeight - 24;
      const w = Math.min(cw, ch * aspect);
      setSize({ w, h: w / aspect });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [aspect]);

  const toNorm = (e) => {
    const r = boxRef.current.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
  };
  const onDown = (i) => (e) => {
    e.preventDefault();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* capture אינו קריטי — הגרירה עובדת גם בלעדיו */ }
    setDrag(i);
  };
  const onMove = (e) => {
    if (drag === null) return;
    const next = quad.slice();
    next[drag] = toNorm(e);
    onChange(next);
  };
  const onUp = () => setDrag(null);

  const pts = quad.map(p => ({ x: p.x * size.w, y: p.y * size.h }));
  const LOUPE = 110, ZOOM = 2.5;
  const lp = drag !== null ? pts[drag] : null;

  return (
    <div ref={boxRef} className="relative touch-none select-none" style={{ width: size.w, height: size.h }}>
      <img src={src} alt="חשבונית" draggable={false} className="w-full h-full block" />
      <svg className="absolute inset-0 w-full h-full overflow-visible"
           onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        <defs>
          <mask id="quad-mask">
            <rect width="100%" height="100%" fill="white" />
            <polygon points={pts.map(p => `${p.x},${p.y}`).join(' ')} fill="black" />
          </mask>
        </defs>
        <rect width="100%" height="100%" fill="rgba(0,0,0,0.45)" mask="url(#quad-mask)" />
        <polygon points={pts.map(p => `${p.x},${p.y}`).join(' ')} fill="rgba(99,102,241,0.12)" stroke="#818cf8" strokeWidth="2" />
        {pts.map((p, i) => (
          <g key={i} onPointerDown={onDown(i)} style={{ cursor: 'grab' }}>
            <circle cx={p.x} cy={p.y} r="22" fill="transparent" />
            <circle cx={p.x} cy={p.y} r="10" fill="rgba(255,255,255,0.9)" stroke="#6366f1" strokeWidth="3" />
          </g>
        ))}
      </svg>
      {lp && (
        <div className="absolute pointer-events-none rounded-full border-2 border-white shadow-xl overflow-hidden"
             style={{
               width: LOUPE, height: LOUPE,
               top: -LOUPE / 2, [lp.x < size.w / 2 ? 'right' : 'left']: 0,
               backgroundImage: `url(${src})`, backgroundRepeat: 'no-repeat',
               backgroundSize: `${size.w * ZOOM}px ${size.h * ZOOM}px`,
               backgroundPosition: `${LOUPE / 2 - lp.x * ZOOM}px ${LOUPE / 2 - lp.y * ZOOM}px`,
             }}>
          <div className="absolute left-1/2 top-1/2 w-3 h-3 -ml-1.5 -mt-1.5 rounded-full border-2 border-indigo-500" />
        </div>
      )}
    </div>
  );
}
