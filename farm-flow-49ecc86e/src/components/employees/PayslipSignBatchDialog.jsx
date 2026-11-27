import { useCallback, useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, MessageCircle, MessageSquare, CheckCircle2, Clock, Send, RefreshCw, PhoneOff } from "lucide-react";
import { apiFetch, BASE_URL } from "@/api/localClient";
import { normalizePhone, signMessage, whatsappLink, smsLink } from "./signShare";

// שליחת תלושי חודש לחתימה: קישור לכל עובד שלא חתם, ומשם לחיצה על וואטסאפ / SMS לכל שורה.
// הקישורים מוחזרים רק כשהם נוצרים (בשרת נשמר רק hash) — לכן "קישור חדש" לשורה שכבר נשלחה.
const fmtMonth = (p) => (p ? `${p.slice(5, 7)}/${p.slice(0, 4)}` : "");
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit" }) : "");

export default function PayslipSignBatchDialog({ open, onOpenChange, farmId }) {
  const [periods, setPeriods] = useState([]);
  const [period, setPeriod] = useState(null);
  const [items, setItems] = useState([]);
  const [links, setLinks] = useState({}); // doc_id → url (רק בסשן הזה)
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);
  const q = farmId ? `farm_id=${encodeURIComponent(farmId)}` : "";

  const load = useCallback(async (p) => {
    setLoading(true); setErr(null);
    try {
      const r = await apiFetch(`${BASE_URL}/employee-documents/payslip-batch?${q}${p ? `&period=${p}` : ""}`);
      setPeriods(r.periods || []); setPeriod(r.period); setItems(r.items || []);
    } catch (e) { setErr(e.message); } finally { setLoading(false); }
  }, [q]);
  useEffect(() => { if (open) { setLinks({}); load(null); } }, [open, load]);

  const issue = async (docIds) => {
    setBusy(docIds ? docIds[0] : "all"); setErr(null);
    try {
      const r = await apiFetch(`${BASE_URL}/employee-documents/payslip-batch/sign-requests?${q}`, { method: "POST", body: JSON.stringify({ period, farm_id: farmId, ...(docIds ? { doc_ids: docIds } : {}) }) });
      const add = {};
      for (const it of r.items) if (it.path) add[it.doc_id] = `${window.location.origin}${it.path}`;
      setLinks(prev => ({ ...prev, ...add }));
      setItems(r.items.map(({ token: _t, path: _p, expires_at: _e, ...rest }) => rest));
    } catch (e) { setErr(e.message); } finally { setBusy(null); }
  };
  const markSent = (it, channel) => {
    apiFetch(`${BASE_URL}/employee-documents/${it.doc_id}/sign-sent`, { method: "POST", body: JSON.stringify({ channel, to: normalizePhone(it.phone) }) })
      .then(() => setItems(prev => prev.map(x => (x.doc_id === it.doc_id ? { ...x, sent_at: new Date().toISOString(), sent_via: channel } : x))))
      .catch(() => {});
  };

  const signed = items.filter(i => i.sign_status === "signed").length;
  const toIssue = items.filter(i => i.sign_status === "none" || i.sign_status === "expired").length;
  const noPhone = items.filter(i => i.sign_status !== "signed" && !normalizePhone(i.phone)).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Send className="w-5 h-5 text-primary" aria-hidden="true" />תלושים לחתימה בטלפון העובדים</DialogTitle>
          <DialogDescription>
            צור קישורי חתימה לכל התלושים של החודש ושלח לכל עובד בוואטסאפ או SMS. העובד חותם באצבע, והתלוש החתום נשמר בתיק שלו.
            תלוש שהעלית אליו דף שעות (בתיק העובד) נשלח יחד עם דף השעות, והעובד חותם על שניהם יחד.
          </DialogDescription>
        </DialogHeader>

        {periods.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {periods.slice(0, 12).map(p => (
              <button key={p} type="button" onClick={() => { setLinks({}); load(p); }} aria-pressed={p === period}
                className={`px-3 py-1 rounded-full text-sm border ${p === period ? "bg-primary text-primary-foreground border-primary" : "bg-white border-gray-200"}`}>{fmtMonth(p)}</button>
            ))}
          </div>
        )}

        {loading ? <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div>
          : !period ? <p className="text-sm text-gray-500 text-center py-6">אין עדיין תלושים במערכת. ייבא אותם מהמייל או העלה בתיק העובד.</p>
          : (<>
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span>{items.length} תלושים · <b className="text-green-700">{signed} נחתמו</b>{noPhone > 0 && <span className="text-amber-700"> · {noPhone} בלי טלפון</span>}</span>
              {toIssue > 0 && (
                <Button size="sm" onClick={() => issue(null)} disabled={busy === "all"}>
                  {busy === "all" ? <Loader2 className="w-4 h-4 ml-1 animate-spin" /> : <Send className="w-4 h-4 ml-1" />}צור קישורים ל-{toIssue}
                </Button>
              )}
            </div>
            <ul className="divide-y border rounded-lg">
              {items.map(it => {
                const url = links[it.doc_id];
                const text = url ? signMessage({ firstName: it.first_name, title: it.title, url }) : "";
                const hasPhone = !!normalizePhone(it.phone);
                return (
                  <li key={it.doc_id} className="p-2.5 flex flex-wrap items-center gap-2 justify-between">
                    <div className="min-w-0">
                      <p className="font-medium truncate">{it.employee_name || "?"}</p>
                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-gray-500">
                        {it.sign_status === "signed" && <Badge className="bg-green-100 text-green-800 gap-1"><CheckCircle2 className="w-3 h-3" />נחתם {fmtDate(it.signed_at)}</Badge>}
                        {it.sign_status === "pending" && <Badge className="bg-amber-100 text-amber-800 gap-1"><Clock className="w-3 h-3" />{it.sent_at ? `נשלח ${fmtDate(it.sent_at)}` : "קישור נוצר"}</Badge>}
                        {it.employer && <span>{it.employer}</span>}
                        {it.timesheet ? <span className="text-blue-700">+ דף שעות</span>
                          : it.sign_status !== "signed" && <span>ללא דף שעות</span>}
                        {!hasPhone && it.sign_status !== "signed" && <span className="text-amber-700 flex items-center gap-0.5"><PhoneOff className="w-3 h-3" />אין טלפון בכרטיס</span>}
                      </div>
                    </div>
                    {it.sign_status !== "signed" && (
                      <div className="flex gap-1 shrink-0">
                        {url ? (<>
                          <a href={whatsappLink(it.phone, text)} target="_blank" rel="noopener noreferrer" onClick={() => markSent(it, "whatsapp")}>
                            <Button size="sm" className="bg-green-600 hover:bg-green-700"><MessageCircle className="w-4 h-4 ml-1" />וואטסאפ</Button>
                          </a>
                          {hasPhone && <a href={smsLink(it.phone, text)} onClick={() => markSent(it, "sms")}><Button size="sm" variant="outline"><MessageSquare className="w-4 h-4 ml-1" />SMS</Button></a>}
                        </>) : (
                          <Button size="sm" variant="outline" disabled={busy === it.doc_id} onClick={() => issue([it.doc_id])}>
                            {busy === it.doc_id ? <Loader2 className="w-4 h-4 ml-1 animate-spin" /> : <RefreshCw className="w-4 h-4 ml-1" />}
                            {it.sign_status === "pending" ? "קישור חדש" : "צור קישור"}
                          </Button>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            <p className="text-xs text-gray-500">כל לחיצה פותחת את וואטסאפ / ההודעות בטלפון שלך עם ההודעה והקישור מוכנים — נשאר רק ללחוץ "שלח". "קישור חדש" מבטל את הקישור הקודם של אותו עובד.</p>
          </>)}
        {err && <p className="text-sm text-red-600">{err}</p>}
      </DialogContent>
    </Dialog>
  );
}
