import { useCallback, useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Mail, CheckCircle2, AlertTriangle } from "lucide-react";
import { apiFetch, BASE_URL } from "@/api/localClient";

// שיוך קבצים מהמייל לתיקי העובדים: תלושי שכר (PDF חודשי → עמוד לעובד), "דף רשימה" של ביטוח רפואי
// → פוליסה, וכל קובץ אחר עם מספר דרכון של עובד בנושא/בתוכן → "אחר" בתיק.
const thisYear = new Date().getFullYear();
const YEARS = [thisYear, thisYear - 1, thisYear - 2];
const fmtMonth = (p) => `${p.slice(5, 7)}/${p.slice(0, 4)}`;

export default function PayslipImportDialog({ open, onOpenChange, farmId }) {
  const [year, setYear] = useState(thisYear);
  const [job, setJob] = useState(null);
  const [err, setErr] = useState(null);
  const timer = useRef(null);
  const q = farmId ? `?farm_id=${encodeURIComponent(farmId)}` : "";

  const poll = useCallback(async () => {
    try {
      const s = await apiFetch(`${BASE_URL}/employee-documents/import-gmail${q}`);
      setJob(s.status === "idle" ? null : s);
      if (s.status === "running") timer.current = setTimeout(poll, 1500);
    } catch (e) { setErr(e.message); }
  }, [q]);

  useEffect(() => {
    if (open) poll();
    return () => clearTimeout(timer.current);
  }, [open, poll]);

  const start = async () => {
    setErr(null);
    try {
      const s = await apiFetch(`${BASE_URL}/employee-documents/import-gmail${q}`, { method: "POST", body: JSON.stringify({ year, farm_id: farmId }) });
      setJob(s);
      clearTimeout(timer.current);
      timer.current = setTimeout(poll, 1200);
    } catch (e) { setErr(e.message); }
  };

  const running = job?.status === "running";
  const pct = job?.total ? Math.min(100, Math.round((job.scanned / job.total) * 100)) : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-lg max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Mail className="w-5 h-5 text-primary" aria-hidden="true" />שיוך קבצים מהמייל לעובדים</DialogTitle>
          <DialogDescription>
            סורק את המיילים של השנה ב-Gmail המחובר ומתייק בתיק של כל עובד: תלושי שכר (מפוצלים לעמוד לעובד), פוליסות ביטוח רפואי
            (מ"דף רשימה" — חברה, מספר פוליסה, תקופה, קופ"ח), וכל קובץ אחר שמספר הדרכון של העובד מופיע בו או בנושא המייל.
            קובץ שכבר תויק לא ייובא שוב; תלוש מתוקן מאוחר יותר מחליף את הקודם, אלא אם הקודם נחתם.
          </DialogDescription>
        </DialogHeader>

        {!running && (
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">שנה:</span>
            {YEARS.map(y => (
              <button key={y} type="button" onClick={() => setYear(y)} aria-pressed={year === y}
                className={`px-3 py-1.5 rounded-full text-sm border ${year === y ? "bg-primary text-primary-foreground border-primary" : "bg-white border-gray-200"}`}>{y}</button>
            ))}
          </div>
        )}

        {running && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm"><Loader2 className="w-4 h-4 animate-spin" />סורק מיילים… {job.scanned}/{job.total || "?"} · {job.created + job.replaced} תלושים · {job.policies_created || 0} פוליסות · {job.documents_created || 0} מסמכים</div>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden"><div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} /></div>
          </div>
        )}

        {job && job.status === "error" && (
          <p className="text-sm text-red-600 flex items-start gap-1.5"><AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />{job.error}</p>
        )}

        {job && job.status === "done" && (
          <div className="space-y-3 text-sm">
            <p className="flex items-center gap-1.5 font-semibold text-green-700"><CheckCircle2 className="w-4 h-4" />השיוך לשנת {job.year} הסתיים</p>
            <ul className="grid grid-cols-2 gap-x-4 gap-y-1">
              <li>מיילים שנסרקו: <b>{job.total}</b></li>
              <li>קבצים שנבדקו: <b>{job.files}</b></li>
              <li>תלושים חדשים: <b>{job.created}</b></li>
              <li>פוליסות ביטוח: <b>{job.policies_created}</b>{job.policies_dup ? <span className="text-gray-500"> (+{job.policies_dup} קיימות)</span> : null}</li>
              <li>מסמכים נוספים: <b>{job.documents_created}</b>{job.documents_dup ? <span className="text-gray-500"> (+{job.documents_dup} קיימים)</span> : null}</li>
              <li>עמודי תלוש: <b>{job.pages}</b></li>
              <li>הוחלפו במתוקנים: <b>{job.replaced}</b></li>
              <li>עובדים: <b>{job.employees}</b></li>
              <li>כבר היו בתיק: <b>{job.duplicates}</b></li>
              {job.kept_signed > 0 && <li className="col-span-2">מתוקנים שלא הוחלפו כי הקודם נחתם: <b>{job.kept_signed}</b></li>}
            </ul>
            {job.months.length > 0 && <p className="text-gray-600">חודשים: {job.months.map(fmtMonth).join(", ")}</p>}
            {job.unmatched.length > 0 && (
              <div className="border border-amber-200 bg-amber-50 rounded-lg p-3">
                <p className="font-semibold text-amber-800 mb-1">{job.unmatched.length} תלושים לא שויכו לעובד</p>
                <p className="text-xs text-amber-800 mb-2">בדרך כלל חסר או שגוי מספר הדרכון בכרטיס העובד. עדכן אותו והרץ שוב — מה שכבר תויק לא ייובא פעמיים.</p>
                <ul className="text-xs space-y-0.5 max-h-40 overflow-y-auto" dir="ltr">
                  {job.unmatched.map((u, i) => (
                    <li key={i}>{fmtMonth(u.period)} · {u.name || "?"}{u.passport ? ` · ${u.passport}` : ""}{u.employer ? ` · ${u.employer}` : ""}</li>
                  ))}
                </ul>
              </div>
            )}
            {job.unmatched_files?.length > 0 && (
              <div className="border border-gray-200 bg-gray-50 rounded-lg p-3">
                <p className="font-semibold text-gray-800 mb-1">{job.unmatched_files.length} קבצים לא שויכו</p>
                <ul className="text-xs space-y-0.5 max-h-32 overflow-y-auto">
                  {job.unmatched_files.map((u, i) => <li key={i}>{u.kind}: {u.subject} · {u.file}{u.passport ? ` · ${u.passport}` : ""}</li>)}
                </ul>
              </div>
            )}
            {job.errors.length > 0 && <p className="text-xs text-red-600">שגיאות: {job.errors.join(" · ")}</p>}
          </div>
        )}

        {err && <p className="text-sm text-red-600">{err}</p>}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>סגור</Button>
          {!running && <Button onClick={start}>{job?.status === "done" ? "הרץ שוב" : "התחל ייבוא"}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
