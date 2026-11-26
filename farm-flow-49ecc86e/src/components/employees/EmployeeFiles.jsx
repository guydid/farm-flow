import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import { UploadFile } from "@/integrations/Core";
import { apiFetch, BASE_URL, getToken } from "@/api/localClient";
import { Loader2, Upload, Camera, FileText, Trash2, PenLine, CheckCircle2, Clock, Copy, Share2, Download, XCircle, FolderOpen } from "lucide-react";
import { cn } from "@/lib/utils";

// תיק עובד: תלושי שכר, חוזה העסקה, ביטוח רפואי ומסמכים נוספים — כל אחד אפשר לשלוח לעובד לחתימה בקישור.
const CATS = [
  { key: "payslip", label: "תלושי שכר", one: "תלוש שכר" },
  { key: "contract", label: "חוזה העסקה", one: "חוזה העסקה" },
  { key: "medical_insurance", label: "ביטוח רפואי", one: "ביטוח רפואי" },
  { key: "other", label: "אחר", one: "מסמך" },
];
const catOf = (k) => CATS.find(c => c.key === k) || CATS[3];
const MONTHS = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];
const fmtPeriod = (p) => (p ? `${MONTHS[parseInt(p.slice(5, 7), 10) - 1] || ""} ${p.slice(0, 4)}` : "");
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "numeric" }) : "");
const withToken = (url) => (url ? `${url}${url.includes("?") ? "&" : "?"}token=${encodeURIComponent(getToken() || "")}` : null);
const prevMonth = () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7); };
const fmtDay = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "");
const money = (n) => (n == null ? "" : `₪${Number(n).toLocaleString("he-IL")}`);
// זהה ל-CONTRACT_TYPES ב-backend/hrDocs.js
const CONTRACT_TYPES = { permanent: "קבוע", fixed_term: "לתקופה קצובה", seasonal: "עונתי", foreign_worker: "עובד זר", manpower: "דרך חברת כוח אדם", temporary: "זמני", other: "אחר" };
const emptyMeta = () => ({
  period: prevMonth(), title: "", employer: "", gross: "", net: "",
  contract_type: "foreign_worker", signed_date: "", start_date: "", end_date: "",
  insurance_company: "", policy_number: "", agent: "", health_fund: "",
});
// שורת פרטים מתחת לשם המסמך
function docDetails(doc) {
  if (doc.category === "payslip") return [doc.gross != null && `ברוטו ${money(doc.gross)}`, doc.net != null && `נטו ${money(doc.net)}`].filter(Boolean).join(" · ");
  if (doc.category === "contract") return [CONTRACT_TYPES[doc.contract_type], doc.start_date && `מ-${fmtDay(doc.start_date)}`, doc.end_date && `עד ${fmtDay(doc.end_date)}`, doc.signed_date && `נחתם ${fmtDay(doc.signed_date)}`].filter(Boolean).join(" · ");
  if (doc.category === "medical_insurance") return [doc.policy_number && `פוליסה ${doc.policy_number}`, (doc.start_date || doc.end_date) && `${fmtDay(doc.start_date) || "?"} – ${fmtDay(doc.end_date) || "ללא סיום"}`, doc.agent, doc.health_fund && `קופ"ח ${doc.health_fund}`].filter(Boolean).join(" · ");
  return "";
}

function SignBadge({ doc }) {
  if (doc.sign_status === "signed") return <Badge className="bg-green-100 text-green-800 gap-1"><CheckCircle2 className="w-3 h-3" aria-hidden="true" />נחתם {fmtDate(doc.signed_at)}</Badge>;
  if (doc.sign_status === "pending") return <Badge className="bg-amber-100 text-amber-800 gap-1"><Clock className="w-3 h-3" aria-hidden="true" />ממתין לחתימה</Badge>;
  if (doc.sign_status === "expired") return <Badge className="bg-gray-100 text-gray-700 gap-1"><XCircle className="w-3 h-3" aria-hidden="true" />פג תוקף הקישור</Badge>;
  return null;
}

export default function EmployeeFiles({ employee }) {
  const { toast } = useToast();
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [tab, setTab] = useState("payslip");
  const [pending, setPending] = useState(null); // { file } — לפני שמירה: חודש/שם
  const [meta, setMeta] = useState(emptyMeta);
  const [saving, setSaving] = useState(false);
  const [share, setShare] = useState(null); // { doc, url, expires_at }
  const [busyId, setBusyId] = useState(null);
  const fileRef = useRef(null);
  const camRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const rows = await apiFetch(`${BASE_URL}/employees/${employee.id}/documents`);
      setDocs(Array.isArray(rows) ? rows : []);
    } catch (e) {
      if (e.status === 403) setDenied(true);
      else toast({ title: "שגיאה", description: e.message, variant: "destructive" });
    } finally { setLoading(false); }
  }, [employee.id, toast]);
  useEffect(() => { load(); }, [load]);

  const counts = useMemo(() => Object.fromEntries(CATS.map(c => [c.key, docs.filter(d => d.category === c.key).length])), [docs]);
  const list = docs.filter(d => d.category === tab);

  const pickFile = (e) => {
    const file = e.target.files?.[0];
    e.target.value = null;
    if (!file) return;
    setMeta({ ...emptyMeta(), title: tab === "other" ? file.name.replace(/\.[^.]+$/, "") : "" });
    setPending({ file });
  };
  // פוליסת ביטוח אפשר לרשום גם בלי קובץ
  const addWithoutFile = () => { setMeta(emptyMeta()); setPending({ file: null }); };
  const set = (k) => (e) => setMeta(m => ({ ...m, [k]: e.target.value }));
  const metaPayload = () => {
    const m = meta;
    if (tab === "payslip") return { period: m.period, employer: m.employer || null, gross: m.gross || null, net: m.net || null };
    if (tab === "contract") return { title: m.title, contract_type: m.contract_type, signed_date: m.signed_date || null, start_date: m.start_date || null, end_date: m.end_date || null, employer: m.employer || null };
    if (tab === "medical_insurance") return { title: m.title, insurance_company: m.insurance_company, policy_number: m.policy_number || null, start_date: m.start_date || null, end_date: m.end_date || null, agent: m.agent || null, health_fund: m.health_fund || null };
    return { title: m.title };
  };
  const canSave = tab === "payslip" ? !!meta.period : tab === "medical_insurance" ? !!meta.insurance_company.trim() : true;

  const save = async () => {
    if (!pending) return;
    setSaving(true);
    try {
      const file_url = pending.file ? (await UploadFile({ file: pending.file })).file_url : null;
      const doc = await apiFetch(`${BASE_URL}/employees/${employee.id}/documents`, {
        method: "POST",
        body: JSON.stringify({ category: tab, ...metaPayload(), file_url, file_name: pending.file?.name || null }),
      });
      setDocs(prev => [doc, ...prev]);
      setPending(null);
      toast({ title: "המסמך נשמר בתיק העובד" });
    } catch (e) {
      toast({ title: "שגיאה", description: e.message, variant: "destructive" });
    } finally { setSaving(false); }
  };

  const requestSign = async (doc) => {
    setBusyId(doc.id);
    try {
      const r = await apiFetch(`${BASE_URL}/employee-documents/${doc.id}/sign-request`, { method: "POST", body: "{}" });
      setShare({ doc, url: `${window.location.origin}${r.path}`, expires_at: r.expires_at });
      await load();
    } catch (e) {
      toast({ title: "שגיאה", description: e.message, variant: "destructive" });
    } finally { setBusyId(null); }
  };

  const cancelSign = async (doc) => {
    setBusyId(doc.id);
    try {
      await apiFetch(`${BASE_URL}/employee-documents/${doc.id}/sign-cancel`, { method: "POST", body: "{}" });
      await load();
    } catch (e) {
      toast({ title: "שגיאה", description: e.message, variant: "destructive" });
    } finally { setBusyId(null); }
  };

  const remove = async (doc) => {
    if (!window.confirm(`למחוק את "${doc.title}"${doc.sign_status === "signed" ? " (כולל העותק החתום)" : ""}?`)) return;
    try {
      await apiFetch(`${BASE_URL}/employee-documents/${doc.id}`, { method: "DELETE" });
      setDocs(prev => prev.filter(d => d.id !== doc.id));
    } catch (e) {
      toast({ title: "שגיאה", description: e.message, variant: "destructive" });
    }
  };

  const shareText = share ? `שלום ${employee.first_name || employee.full_name || ""}, נא לעיין במסמך "${share.doc.title}" ולחתום כאן / Please review and sign: ${share.url}` : "";
  const copy = async () => {
    try { await navigator.clipboard.writeText(share.url); toast({ title: "הקישור הועתק" }); }
    catch { toast({ title: "לא ניתן להעתיק — סמן את הקישור והעתק ידנית", variant: "destructive" }); }
  };
  const nativeShare = async () => {
    try { await navigator.share({ title: share.doc.title, text: shareText }); } catch { /* בוטל */ }
  };

  if (denied) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap justify-between items-center gap-2 text-lg">
          <span className="flex items-center gap-2"><FolderOpen className="w-5 h-5 text-primary" aria-hidden="true" />תיק עובד</span>
          <div className="flex gap-1">
            <input ref={fileRef} type="file" className="hidden" accept="image/*,application/pdf" onChange={pickFile} />
            <input ref={camRef} type="file" className="hidden" accept="image/*" capture="environment" onChange={pickFile} />
            <Button variant="outline" size="sm" className="px-2" aria-label="צלם מסמך" onClick={() => camRef.current?.click()}><Camera className="w-4 h-4" aria-hidden="true" /></Button>
            <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}><Upload className="w-4 h-4 ml-1" aria-hidden="true" />הוסף {catOf(tab).one}</Button>
            {tab === "medical_insurance" && <Button variant="ghost" size="sm" onClick={addWithoutFile}>בלי קובץ</Button>}
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-1.5" role="tablist">
          {CATS.map(c => (
            <button key={c.key} type="button" role="tab" aria-selected={tab === c.key} onClick={() => setTab(c.key)}
              className={cn("px-3 py-1.5 rounded-full text-sm border transition-colors", tab === c.key ? "bg-primary text-primary-foreground border-primary" : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50")}>
              {c.label}{counts[c.key] ? <span className="opacity-70"> ({counts[c.key]})</span> : null}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin" /></div>
        ) : list.length === 0 ? (
          <p className="text-sm text-center text-gray-500 py-6">אין עדיין {catOf(tab).label === "אחר" ? "מסמכים נוספים" : catOf(tab).label} בתיק.</p>
        ) : (
          <ul className="space-y-2">
            {list.map(doc => (
              <li key={doc.id} className="p-2.5 border rounded-lg flex flex-col sm:flex-row sm:items-center gap-2 justify-between">
                <div className="flex items-start gap-3 min-w-0">
                  <FileText className="w-5 h-5 text-gray-500 shrink-0 mt-0.5" aria-hidden="true" />
                  <div className="min-w-0">
                    {doc.file_url ? (
                      <a href={withToken(doc.file_url)} target="_blank" rel="noopener noreferrer" className="font-medium text-blue-700 hover:underline break-words">
                        {doc.category === "payslip" ? `תלוש ${fmtPeriod(doc.period)}` : doc.title}
                      </a>
                    ) : <span className="font-medium break-words">{doc.title}</span>}
                    {doc.category === "medical_insurance" && doc.is_active && <Badge className="bg-blue-100 text-blue-800 mr-2">פעילה</Badge>}
                    {docDetails(doc) && <div className="text-xs text-gray-600 mt-0.5">{docDetails(doc)}</div>}
                    <div className="flex flex-wrap items-center gap-2 mt-0.5 text-xs text-gray-500">
                      {doc.employer && <span>{doc.employer}</span>}
                      <span>{doc.source === "gmail_payslip" ? "מהמייל" : "הועלה"} {fmtDate(doc.created_at)}</span>
                      <SignBadge doc={doc} />
                      {doc.sign_status === "signed" && doc.signer_name && <span>ע"י {doc.signer_name}</span>}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1 shrink-0">
                  {!doc.file_url ? null : doc.sign_status === "signed" ? (
                    <a href={withToken(doc.signed_file_url)} target="_blank" rel="noopener noreferrer">
                      <Button variant="outline" size="sm" className="text-green-700 border-green-200"><Download className="w-4 h-4 ml-1" aria-hidden="true" />עותק חתום</Button>
                    </a>
                  ) : (
                    <>
                      <Button variant="outline" size="sm" disabled={busyId === doc.id} onClick={() => requestSign(doc)}>
                        {busyId === doc.id ? <Loader2 className="w-4 h-4 ml-1 animate-spin" /> : <PenLine className="w-4 h-4 ml-1" aria-hidden="true" />}
                        {doc.sign_status === "pending" ? "קישור חדש" : "שלח לחתימה"}
                      </Button>
                      {doc.sign_status === "pending" && (
                        <Button variant="ghost" size="sm" disabled={busyId === doc.id} onClick={() => cancelSign(doc)}>בטל בקשה</Button>
                      )}
                    </>
                  )}
                  <Button variant="ghost" size="icon" aria-label="מחק" onClick={() => remove(doc)}><Trash2 className="w-4 h-4 text-red-500" /></Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      {/* פרטי מסמך לפני שמירה */}
      <Dialog open={!!pending} onOpenChange={(o) => !o && !saving && setPending(null)}>
        <DialogContent dir="rtl" className="max-w-md">
          <DialogHeader>
            <DialogTitle>הוספת {catOf(tab).one}</DialogTitle>
            <DialogDescription className="break-words">{pending?.file?.name || "ללא קובץ"}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {tab === "payslip" && (<>
              <div>
                <Label htmlFor="doc-period">חודש התלוש</Label>
                <Input id="doc-period" type="month" value={meta.period} onChange={set("period")} className="mt-1" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label htmlFor="doc-gross">ברוטו (₪)</Label><Input id="doc-gross" type="number" inputMode="decimal" value={meta.gross} onChange={set("gross")} className="mt-1" /></div>
                <div><Label htmlFor="doc-net">נטו (₪)</Label><Input id="doc-net" type="number" inputMode="decimal" value={meta.net} onChange={set("net")} className="mt-1" /></div>
              </div>
            </>)}
            {tab !== "payslip" && tab !== "medical_insurance" && (
              <div>
                <Label htmlFor="doc-title">שם המסמך</Label>
                <Input id="doc-title" value={meta.title} placeholder={catOf(tab).one} onChange={set("title")} className="mt-1" />
              </div>
            )}
            {tab === "contract" && (<>
              <div>
                <Label htmlFor="doc-ctype">סוג החוזה</Label>
                <select id="doc-ctype" value={meta.contract_type} onChange={set("contract_type")} className="mt-1 w-full h-10 rounded-md border border-input bg-background px-3 text-sm">
                  {Object.entries(CONTRACT_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div><Label htmlFor="doc-signed">נחתם</Label><Input id="doc-signed" type="date" value={meta.signed_date} onChange={set("signed_date")} className="mt-1" /></div>
                <div><Label htmlFor="doc-start">התחלה</Label><Input id="doc-start" type="date" value={meta.start_date} onChange={set("start_date")} className="mt-1" /></div>
                <div><Label htmlFor="doc-end">סיום</Label><Input id="doc-end" type="date" value={meta.end_date} onChange={set("end_date")} className="mt-1" /></div>
              </div>
            </>)}
            {tab === "medical_insurance" && (<>
              <div className="grid grid-cols-2 gap-2">
                <div><Label htmlFor="doc-company">חברת ביטוח *</Label><Input id="doc-company" value={meta.insurance_company} onChange={set("insurance_company")} className="mt-1" /></div>
                <div><Label htmlFor="doc-policy">מספר פוליסה</Label><Input id="doc-policy" value={meta.policy_number} onChange={set("policy_number")} className="mt-1" dir="ltr" /></div>
                <div><Label htmlFor="doc-istart">תחילת כיסוי</Label><Input id="doc-istart" type="date" value={meta.start_date} onChange={set("start_date")} className="mt-1" /></div>
                <div><Label htmlFor="doc-iend">סיום כיסוי</Label><Input id="doc-iend" type="date" value={meta.end_date} onChange={set("end_date")} className="mt-1" /></div>
                <div><Label htmlFor="doc-agent">סוכן / מקור</Label><Input id="doc-agent" value={meta.agent} onChange={set("agent")} className="mt-1" /></div>
                <div><Label htmlFor="doc-fund">קופת חולים</Label><Input id="doc-fund" value={meta.health_fund} onChange={set("health_fund")} className="mt-1" /></div>
              </div>
              <p className="text-xs text-gray-500">הפוליסה שבתוקף היום מתעדכנת אוטומטית גם בפרטי הביטוח שבכרטיס העובד.</p>
            </>)}
            {(tab === "payslip" || tab === "contract") && (
              <div>
                <Label htmlFor="doc-employer">ישות מעסיקה</Label>
                <Input id="doc-employer" value={meta.employer} onChange={set("employer")} className="mt-1" placeholder="לא חובה" />
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setPending(null)} disabled={saving}>ביטול</Button>
            <Button onClick={save} disabled={saving || !canSave}>
              {saving && <Loader2 className="w-4 h-4 ml-1 animate-spin" />}שמור
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* קישור חתימה */}
      <Dialog open={!!share} onOpenChange={(o) => !o && setShare(null)}>
        <DialogContent dir="rtl" className="max-w-md">
          <DialogHeader>
            <DialogTitle>שליחה לחתימה</DialogTitle>
            <DialogDescription>
              שלח לעובד את הקישור. הוא יוכל לעיין במסמך ולחתום באצבע מהטלפון, בלי התחברות.
              הקישור בתוקף עד {fmtDate(share?.expires_at)}. כשייחתם, העותק החתום יופיע כאן.
            </DialogDescription>
          </DialogHeader>
          <Input readOnly value={share?.url || ""} dir="ltr" onFocus={(e) => e.target.select()} className="text-xs" />
          <div className="grid grid-cols-2 gap-2">
            <a href={`https://wa.me/?text=${encodeURIComponent(shareText)}`} target="_blank" rel="noopener noreferrer">
              <Button className="w-full bg-green-600 hover:bg-green-700"><Share2 className="w-4 h-4 ml-1" aria-hidden="true" />וואטסאפ</Button>
            </a>
            <Button variant="outline" onClick={copy}><Copy className="w-4 h-4 ml-1" aria-hidden="true" />העתק קישור</Button>
            {typeof navigator !== "undefined" && navigator.share && (
              <Button variant="outline" className="col-span-2" onClick={nativeShare}><Share2 className="w-4 h-4 ml-1" aria-hidden="true" />שיתוף…</Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
