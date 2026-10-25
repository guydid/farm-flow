import React, { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { FileText, Loader2, ExternalLink, FlaskConical, AlertTriangle } from "lucide-react";
import { getToken } from "@/api/localClient";

const BASE_URL = import.meta.env.VITE_API_URL || "/api";
async function apiFetch(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}`, ...(options.headers || {}) } });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = { error: text.slice(0, 200) }; }
  if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { status: res.status, data });
  return data;
}
const fmtTime = (iso) => { try { return new Date(iso).toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" }); } catch { return iso; } };
const money = (n) => `₪${(Number(n) || 0).toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * כרטיס "מסמכים ב-Invoice Maven" בעמוד תעודת שקילה: מציג מסמכים שהופקו ומאפשר להפיק
 * תעודת משלוח / חשבונית / חשבונית מס-קבלה. מוצג רק כשהאינטגרציה מופעלת במשק.
 */
export default function MavenDocumentsCard({ certificate, farmId, itemCount, onIssued, compact = false }) {
  const [cfg, setCfg] = useState(null);
  const [open, setOpen] = useState(false);
  const [docType, setDocType] = useState("200");
  const [sendEmail, setSendEmail] = useState(false);
  const [remarks, setRemarks] = useState("");
  const [preview, setPreview] = useState(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [error, setError] = useState(null);
  const [existing, setExisting] = useState(null);

  const farmQs = farmId ? `?farm_id=${encodeURIComponent(farmId)}` : "";

  useEffect(() => {
    if (!farmId) return;
    apiFetch(`/integrations/maven/config${farmQs}`).then(setCfg).catch(() => setCfg(null));
  }, [farmId]);

  useEffect(() => {
    if (!open || !certificate?.id) return;
    setLoadingPreview(true); setError(null); setExisting(null);
    apiFetch(`/integrations/maven/document-preview${farmQs}&certificate_id=${encodeURIComponent(certificate.id)}&doc_type=${docType}`)
      .then(setPreview)
      .catch((e) => setError(e.data?.error || e.message))
      .finally(() => setLoadingPreview(false));
  }, [open, docType, certificate?.id]);

  if (!cfg?.enabled) return null;

  const issued = Array.isArray(certificate?.maven_documents) ? certificate.maven_documents : [];
  const docTypes = cfg.doc_types || { 200: "תעודת משלוח", 305: "חשבונית מס", 320: "חשבונית מס/קבלה" };

  const issue = async (force = false) => {
    setIssuing(true); setError(null);
    try {
      const d = await apiFetch(`/integrations/maven/document${farmQs}`, {
        method: "POST",
        body: JSON.stringify({ certificate_id: certificate.id, doc_type: Number(docType), send_to_customer: sendEmail, remarks, force }),
      });
      setOpen(false); setRemarks(""); setExisting(null);
      onIssued?.(d.document, d.warnings || []);
    } catch (e) {
      if (e.status === 409 && e.data?.existing) setExisting(e.data.existing);
      setError(e.data?.error || e.message);
    } finally { setIssuing(false); }
  };

  const trigger = (
    <Button variant={compact ? "outline" : "default"} size={compact ? "sm" : "default"} onClick={() => setOpen(true)} disabled={!itemCount} className={compact ? "" : "bg-indigo-600 hover:bg-indigo-700 text-white"}>
      <FileText className="w-4 h-4 ml-2" /> הפק מסמך ב-Maven
    </Button>
  );

  return (
    <>
      {compact ? trigger : (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText className="w-5 h-5 text-indigo-500" /> מסמכים ב-Invoice Maven
                {cfg.test_mode && <span className="text-[11px] font-normal px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 inline-flex items-center gap-1"><FlaskConical className="w-3 h-3" /> מצב בדיקה</span>}
              </CardTitle>
              {trigger}
            </div>
          </CardHeader>
          <CardContent>
            {issued.length === 0 ? (
              <p className="text-sm text-gray-500">{itemCount ? "טרם הופק מסמך לתעודה זו." : "הוסף פריטים לתעודה כדי להפיק מסמך."}</p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {issued.map((d, i) => (
                  <li key={i} className="py-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                    <span className="font-medium">{d.doc_type_name || docTypes[d.doc_type]}</span>
                    <span className="text-gray-700">{d.doc_no ? `מס' ${d.doc_no}` : "ללא מספר"}</span>
                    {d.test && <span className="text-[11px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">בדיקה — לא נשמר</span>}
                    <span className="text-gray-400 text-xs">{fmtTime(d.issued_at)} · {d.by}</span>
                    <span className="text-gray-600">{money(d.total)}</span>
                    {d.pdf_original && <a href={d.pdf_original} target="_blank" rel="noreferrer" className="text-blue-600 inline-flex items-center gap-1 text-xs">מקור <ExternalLink className="w-3 h-3" /></a>}
                    {d.pdf_copy && <a href={d.pdf_copy} target="_blank" rel="noreferrer" className="text-blue-600 inline-flex items-center gap-1 text-xs">העתק <ExternalLink className="w-3 h-3" /></a>}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      <Dialog open={open} onOpenChange={(v) => { if (!issuing) setOpen(v); }}>
        <DialogContent className="max-w-lg" dir="rtl">
          <DialogHeader>
            <DialogTitle>הפקת מסמך ב-Invoice Maven</DialogTitle>
            <DialogDescription>
              המסמך ייבנה מפריטי תעודת השקילה והלקוח שלה.{cfg.test_mode ? " מצב בדיקה פעיל: Maven לא ישמור את המסמך." : ""}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>סוג מסמך</Label>
              <Select value={docType} onValueChange={setDocType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(docTypes).map(([code, name]) => <SelectItem key={code} value={String(code)}>{name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {loadingPreview ? (
              <div className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="w-4 h-4 animate-spin" /> בונה תצוגה מקדימה…</div>
            ) : preview && (
              <div className="rounded-lg border bg-gray-50 p-3 text-sm space-y-2">
                <div className="flex justify-between"><span className="text-gray-500">לקוח</span><span className="font-medium">{preview.customer?.name}{preview.customer?.identification ? ` · ${preview.customer.identification}` : ""}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">תאריך</span><span>{preview.document_date}</span></div>
                <table className="w-full text-xs">
                  <thead><tr className="text-gray-500"><th className="text-right font-normal py-1">שורה</th><th className="text-left font-normal">כמות</th><th className="text-left font-normal">מחיר</th><th className="text-left font-normal">סה"כ</th></tr></thead>
                  <tbody>
                    {preview.items.map((l, i) => (
                      <tr key={i} className="border-t border-gray-200">
                        <td className="py-1">{l.description}{l.item_number ? <span className="text-gray-400"> ({l.item_number})</span> : null}</td>
                        <td className="text-left tabular-nums">{l.quantity}</td>
                        <td className="text-left tabular-nums">{money(l.price)}</td>
                        <td className="text-left tabular-nums">{money(l.price * l.quantity)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="flex justify-between font-semibold border-t pt-2"><span>סה"כ{preview.vat_included ? " (כולל מע\"מ)" : " (לפני מע\"מ)"}</span><span>{money(preview.total)}</span></div>
                {preview.total === 0 && <div className="flex items-start gap-1 text-amber-700 text-xs"><AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> אין מחירים בפריטי התעודה. המסמך יופק בסכום 0 (מתאים לתעודת משלוח).</div>}
              </div>
            )}

            <div className="flex items-center gap-2">
              <Checkbox id="mv-send" checked={sendEmail} onCheckedChange={(v) => setSendEmail(!!v)} />
              <Label htmlFor="mv-send" className="text-sm font-normal cursor-pointer">שלח את המסמך ללקוח במייל דרך Maven{preview?.customer?.email ? ` (${preview.customer.email})` : " (אין מייל ללקוח)"}</Label>
            </div>
            <div className="space-y-1">
              <Label>הערות על המסמך</Label>
              <Textarea rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="יודפסו על המסמך (אופציונלי)" />
            </div>

            {error && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm space-y-2">
                <div>{error}</div>
                {existing && (
                  <Button size="sm" variant="outline" onClick={() => issue(true)} disabled={issuing}>הפק בכל זאת מסמך נוסף</Button>
                )}
              </div>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={issuing}>ביטול</Button>
            <Button onClick={() => issue(false)} disabled={issuing || loadingPreview || !preview} className="bg-indigo-600 hover:bg-indigo-700 text-white">
              {issuing ? <Loader2 className="w-4 h-4 animate-spin ml-2" /> : <FileText className="w-4 h-4 ml-2" />}
              {cfg.test_mode ? "הפק (בדיקה)" : "הפק מסמך"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
