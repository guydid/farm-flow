import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, CheckCircle2, AlertTriangle, Eraser, Download, FileText } from "lucide-react";
import { BASE_URL } from "@/api/localClient";

// עמוד ציבורי (ללא התחברות): העובד מעיין במסמך וחותם באצבע. דו-לשוני — רוב העובדים אינם דוברי עברית.
const T = (he, en) => (
  <>
    <span className="block">{he}</span>
    <span className="block text-[0.85em] text-gray-500" dir="ltr">{en}</span>
  </>
);

function SignaturePad({ onChange, padRef }) {
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const last = useRef(null);
  const dirty = useRef(false);

  const setup = useCallback(() => {
    const c = canvasRef.current; if (!c) return;
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const w = c.offsetWidth, h = c.offsetHeight;
    c.width = w * ratio; c.height = h * ratio;
    const ctx = c.getContext("2d");
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.4; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#1e3a8a";
    dirty.current = false; onChange(false);
  }, [onChange]);

  useEffect(() => { setup(); }, [setup]);

  const pos = (e) => { const r = canvasRef.current.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const down = (e) => { e.preventDefault(); canvasRef.current.setPointerCapture?.(e.pointerId); drawing.current = true; last.current = pos(e); };
  const move = (e) => {
    if (!drawing.current) return;
    e.preventDefault();
    const p = pos(e), ctx = canvasRef.current.getContext("2d");
    ctx.beginPath(); ctx.moveTo(last.current.x, last.current.y); ctx.lineTo(p.x, p.y); ctx.stroke();
    last.current = p;
    if (!dirty.current) { dirty.current = true; onChange(true); }
  };
  const up = () => { drawing.current = false; };

  padRef.current = { clear: setup, canvas: () => canvasRef.current };

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-44 bg-white border-2 border-dashed border-gray-300 rounded-xl touch-none"
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up} onPointerCancel={up}
      aria-label="Signature pad"
    />
  );
}

// בלוק החתימה (חתימה + שם + תאריך) מצויר כאן — הדפדפן תומך בכל שפה, ה-PDF בשרת לא
function buildSignatureBlock(sigCanvas, name) {
  const W = 900, H = 360;
  const out = document.createElement("canvas"); out.width = W; out.height = H;
  const ctx = out.getContext("2d");
  ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, W, H);
  const sw = sigCanvas.width, sh = sigCanvas.height;
  const scale = Math.min((W - 40) / sw, 250 / sh);
  ctx.drawImage(sigCanvas, (W - sw * scale) / 2, 10, sw * scale, sh * scale);
  ctx.strokeStyle = "#9ca3af"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(30, 270); ctx.lineTo(W - 30, 270); ctx.stroke();
  ctx.fillStyle = "#111827"; ctx.font = "bold 34px Arial, sans-serif"; ctx.textAlign = "center";
  ctx.fillText(name, W / 2, 312);
  const d = new Date();
  const stamp = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  ctx.fillStyle = "#4b5563"; ctx.font = "26px Arial, sans-serif";
  ctx.fillText(stamp, W / 2, 348);
  return out.toDataURL("image/png");
}

export default function SignDocument() {
  const { token } = useParams();
  const [info, setInfo] = useState(null);
  const [error, setError] = useState(null);
  const [name, setName] = useState("");
  const [agree, setAgree] = useState(false);
  const [hasSig, setHasSig] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const padRef = useRef(null);
  const base = `${BASE_URL}/public/sign/${encodeURIComponent(token)}`;

  useEffect(() => {
    document.title = "חתימה על מסמך / Sign document";
    fetch(base, { cache: "no-store" })
      .then(async r => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || "הקישור אינו תקף"); return d; })
      .then(d => { setInfo(d); if (d.employee_name) setName(d.employee_name); if (d.state === "signed") setDone(true); })
      .catch(e => setError(e.message));
  }, [base]);

  const submit = async () => {
    setSubmitting(true); setError(null);
    try {
      const signature_png = buildSignatureBlock(padRef.current.canvas(), name.trim());
      const r = await fetch(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ signer_name: name.trim(), signature_png, agree }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "החתימה נכשלה");
      setDone(true);
    } catch (e) { setError(e.message); }
    finally { setSubmitting(false); }
  };

  const shell = (children) => (
    <div className="min-h-screen bg-gray-50 py-6 px-4" dir="rtl">
      <div className="max-w-2xl mx-auto space-y-4">{children}</div>
    </div>
  );

  if (error && !info) return shell(
    <div className="bg-white rounded-2xl p-8 text-center shadow-sm">
      <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto mb-3" aria-hidden="true" />
      <p className="font-semibold">{T(error, "This link is not valid or has expired.")}</p>
    </div>
  );
  if (!info) return shell(<div className="flex justify-center py-24"><Loader2 className="w-8 h-8 animate-spin" /></div>);

  if (info.state === "expired") return shell(
    <div className="bg-white rounded-2xl p-8 text-center shadow-sm">
      <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto mb-3" aria-hidden="true" />
      <p className="font-semibold">{T("תוקף הקישור פג. בקש מהמעסיק קישור חדש.", "This link has expired. Ask your employer for a new one.")}</p>
    </div>
  );

  const header = (
    <div className="bg-white rounded-2xl p-5 shadow-sm">
      {info.farm_name && <p className="text-sm text-gray-500">{info.farm_name}</p>}
      <h1 className="text-xl font-bold flex items-center gap-2"><FileText className="w-5 h-5 text-primary" aria-hidden="true" />{info.title}</h1>
      {info.employee_name && <p className="text-sm text-gray-600 mt-1">{info.employee_name}</p>}
    </div>
  );

  if (done) return shell(<>
    {header}
    <div className="bg-white rounded-2xl p-8 text-center shadow-sm space-y-4">
      <CheckCircle2 className="w-12 h-12 text-green-600 mx-auto" aria-hidden="true" />
      <p className="font-semibold text-lg">{T("המסמך נחתם. תודה!", "The document has been signed. Thank you!")}</p>
      <a href={`${base}/file`} target="_blank" rel="noopener noreferrer">
        <Button variant="outline"><Download className="w-4 h-4 ml-1" aria-hidden="true" />הורד עותק / Download copy</Button>
      </a>
    </div>
  </>);

  const pages = Array.from({ length: Math.max(info.pages || 1, 1) }, (_, i) => i + 1);
  const canSubmit = hasSig && agree && name.trim().length > 1 && !submitting;

  return shell(<>
    {header}

    <div className="bg-white rounded-2xl p-3 shadow-sm space-y-2">
      {info.file_kind === "missing" ? (
        <p className="text-center text-sm text-red-600 py-6">{T("קובץ המסמך חסר", "Document file is missing")}</p>
      ) : pages.map(n => (
        <img key={n} src={`${base}/page/${n}`} alt={`עמוד ${n} / Page ${n}`} className="w-full border rounded-lg bg-gray-100" loading={n > 2 ? "lazy" : "eager"} />
      ))}
      <a href={`${base}/file`} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-700 underline block text-center py-1">
        פתח את המסמך המלא / Open full document
      </a>
    </div>

    <div className="bg-white rounded-2xl p-5 shadow-sm space-y-4">
      <div>
        <label htmlFor="signer" className="text-sm font-semibold">{T("שם מלא", "Full name")}</label>
        <Input id="signer" value={name} onChange={(e) => setName(e.target.value)} className="mt-1 h-11 text-base" autoComplete="name" />
      </div>
      <div>
        <div className="flex items-end justify-between mb-1">
          <span className="text-sm font-semibold">{T("חתום כאן באצבע", "Sign here with your finger")}</span>
          <Button type="button" variant="ghost" size="sm" onClick={() => padRef.current?.clear()}><Eraser className="w-4 h-4 ml-1" aria-hidden="true" />נקה / Clear</Button>
        </div>
        <SignaturePad onChange={setHasSig} padRef={padRef} />
      </div>
      <label className="flex items-start gap-3 cursor-pointer">
        <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-1 w-5 h-5 accent-blue-600" />
        <span className="text-sm">{T("קראתי את המסמך ואני מאשר/ת אותו בחתימתי.", "I have read this document and I approve it with my signature.")}</span>
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <Button className="w-full h-12 text-base" disabled={!canSubmit} onClick={submit}>
        {submitting && <Loader2 className="w-5 h-5 ml-2 animate-spin" />}חתום ושלח / Sign &amp; send
      </Button>
    </div>
  </>);
}
