import React, { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { FileText, Loader2, FlaskConical, AlertTriangle, Eye } from "lucide-react";
import MavenPdfViewer from "@/components/common/MavenPdfViewer";
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
const NOTE_DOC_TYPES = { 200: "תעודת משלוח", 305: "חשבונית מס", 320: "חשבונית מס/קבלה" };

/**
 * מסמכים ב-Invoice Maven — מתוך תעודת שקילה (certificate) או תעודת משלוח יוצאת של מודול הרכש (deliveryNote).
 * מציג את המסמכים שהופקו ומאפשר להפיק תעודת משלוח / חשבונית / חשבונית מס-קבלה. מוצג רק כשהאינטגרציה מופעלת במשק.
 *   compact  — כפתור בלבד (בלי רשימה)
 *   embedded — קטע בתוך דיאלוג (מסגרת קלה במקום Card)
 *   canIssue — false: רק רשימת המסמכים, בלי כפתור הפקה (צופים)
 */
export default function MavenDocumentsCard({ certificate, deliveryNote, farmId, itemCount, onIssued, compact = false, embedded = false, canIssue = true }) {
  const subject = deliveryNote || certificate;
  const isNote = !!deliveryNote;
  const api = isNote
    ? { preview: "/integrations/maven/note-preview", issue: "/integrations/maven/note-document", param: "delivery_note_id", about: "המסמך ייבנה משורות תעודת המשלוח והלקוח שלה." }
    : { preview: "/integrations/maven/document-preview", issue: "/integrations/maven/document", param: "certificate_id", about: "המסמך ייבנה מפריטי תעודת השקילה והלקוח שלה." };

  const [cfg, setCfg] = useState(null);
  const [open, setOpen] = useState(false);
  const [docType, setDocType] = useState("200");
  const [sendEmail, setSendEmail] = useState(false);
  const [noVat, setNoVat] = useState(false);
  const [remarks, setRemarks] = useState("");
  const [preview, setPreview] = useState(null);
  const [viewDoc, setViewDoc] = useState(null);
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
    if (!open || !subject?.id) return;
    setLoadingPreview(true); setError(null); setExisting(null);
    apiFetch(`${api.preview}${farmQs}&${api.param}=${encodeURIComponent(subject.id)}&doc_type=${docType}&no_vat=${noVat ? 1 : 0}`)
      .then(setPreview)
      .catch((e) => setError(e.data?.error || e.message))
      .finally(() => setLoadingPreview(false));
  }, [open, docType, noVat, subject?.id]);

  if (!cfg?.enabled) return null;

  const issued = Array.isArray(subject?.maven_documents) ? subject.maven_documents : [];
  const docTypes = isNote ? NOTE_DOC_TYPES : (cfg.doc_types || NOTE_DOC_TYPES);
  const invoiceWithoutPrices = isNote && docType !== "200" && (preview?.unpriced_lines || 0) > 0;

  const issue = async (force = false) => {
    setIssuing(true); setError(null);
    try {
      const d = await apiFetch(`${api.issue}${farmQs}`, {
        method: "POST",
        body: JSON.stringify({ [api.param]: subject.id, doc_type: Number(docType), send_to_customer: sendEmail, remarks, no_vat: noVat, force }),
      });
      setOpen(false); setRemarks(""); setExisting(null);
      onIssued?.(d.document, d.warnings || [], d.status);
      if (d.document?.pdf_original) setViewDoc(d.document); // הצגת המסמך מיד לאחר ההפקה
    } catch (e) {
      if (e.status === 409 && e.data?.existing) setExisting(e.data.existing);
      setError(e.data?.error || e.message);
    } finally { setIssuing(false); }
  };

  const trigger = canIssue ? (
    <Button variant={compact || embedded ? "outline" : "default"} size={compact || embedded ? "sm" : "default"} onClick={() => setOpen(true)} disabled={!itemCount}>
      <FileText className="w-4 h-4 ml-2" aria-hidden="true" /> הפק מסמך ב-Maven
    </Button>
  ) : null;
  const testBadge = cfg.test_mode ? <span className="text-xs font-normal px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 inline-flex items-center gap-1"><FlaskConical className="w-3 h-3" aria-hidden="true" /> מצב בדיקה</span> : null;
  const list = issued.length === 0 ? (
    <p className="text-sm text-muted-foreground">{itemCount ? "טרם הופק מסמך לתעודה זו." : "הוסף שורות לתעודה כדי להפיק מסמך."}</p>
  ) : (
    <ul className="divide-y">
      {issued.map((d, i) => (
        <li key={i} className="py-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <span className="font-medium">{d.doc_type_name || docTypes[d.doc_type]}</span>
          <span>{d.doc_no ? `מס' ${d.doc_no}` : "ללא מספר"}</span>
          {d.test && <span className="text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">בדיקה · לא נשמר</span>}
          <span className="text-muted-foreground text-xs">{fmtTime(d.issued_at)} · {d.by}</span>
          <span className="tabular-nums">{money(d.total)}</span>
          {d.pdf_original ? (
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setViewDoc(d)} aria-label={`הצג ${d.doc_type_name || ""} ${d.doc_no || ""}`}><Eye className="w-3.5 h-3.5 ml-1" aria-hidden="true" /> הצג</Button>
          ) : (
            <span className="text-xs text-muted-foreground">אין PDF</span>
          )}
        </li>
      ))}
    </ul>
  );

  let body;
  if (compact) body = trigger;
  else if (embedded) body = (
    <section aria-labelledby="maven-docs-h" className="rounded-lg border p-3 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="maven-docs-h" className="text-sm font-semibold inline-flex items-center gap-2"><FileText className="w-4 h-4 text-primary" aria-hidden="true" /> מסמכים ב-Invoice Maven {testBadge}</h3>
        {trigger}
      </div>
      {list}
    </section>
  );
  else body = (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base"><FileText className="w-5 h-5 text-primary" aria-hidden="true" /> מסמכים ב-Invoice Maven {testBadge}</CardTitle>
          {trigger}
        </div>
      </CardHeader>
      <CardContent>{list}</CardContent>
    </Card>
  );

  return (
    <>
      {body}

      <MavenPdfViewer doc={viewDoc} open={!!viewDoc} onOpenChange={(v) => { if (!v) setViewDoc(null); }} farmId={farmId} />

      <Dialog open={open} onOpenChange={(v) => { if (!issuing) setOpen(v); }}>
        <DialogContent className="max-w-lg max-h-[92vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle>הפקת מסמך ב-Invoice Maven</DialogTitle>
            <DialogDescription>{api.about}{cfg.test_mode ? " מצב בדיקה פעיל: Maven לא ישמור את המסמך." : ""}</DialogDescription>
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
              <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> בונה תצוגה מקדימה…</div>
            ) : preview && (
              <div className="rounded-lg border bg-muted/40 p-3 text-sm space-y-2">
                <div className="flex justify-between gap-2"><span className="text-muted-foreground">לקוח</span><span className="font-medium text-end">{preview.customer?.name}{preview.customer?.identification ? ` · ${preview.customer.identification}` : ""}</span></div>
                <div className="flex justify-between gap-2"><span className="text-muted-foreground">תאריך</span><span className="tabular-nums">{preview.document_date}</span></div>
                {preview.description && <div className="flex justify-between gap-2"><span className="text-muted-foreground">תיאור</span><span className="text-end">{preview.description}</span></div>}
                <table className="w-full text-xs">
                  <thead><tr className="text-muted-foreground"><th className="text-start font-normal py-1">שורה</th><th className="text-end font-normal">כמות</th><th className="text-end font-normal">מחיר</th><th className="text-end font-normal">סה"כ</th></tr></thead>
                  <tbody>
                    {preview.items.map((l, i) => (
                      <tr key={i} className="border-t">
                        <td className="py-1">{l.description}{l.item_number ? <span className="text-muted-foreground"> ({l.item_number})</span> : null}{l.no_vat ? <span className="text-green-800 text-xs ms-1">פטור ממע"מ</span> : null}</td>
                        <td className="text-end tabular-nums">{l.quantity}</td>
                        <td className="text-end tabular-nums">{l.price > 0 ? money(l.price) : <span className="text-muted-foreground">—</span>}</td>
                        <td className="text-end tabular-nums">{l.price > 0 ? money(l.price * l.quantity) : <span className="text-muted-foreground">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="flex justify-between font-semibold border-t pt-2"><span>סה"כ{preview.vat_included ? " (כולל מע\"מ)" : " (לפני מע\"מ)"}</span><span className="tabular-nums">{money(preview.total)}</span></div>
                {preview.equipment_lines > 0 && <div className="text-xs text-muted-foreground">כולל {preview.equipment_lines} שורות אריזה/משטח בכמות בלבד, ללא מחיר.</div>}
                {preview.total === 0 && !invoiceWithoutPrices && <div className="flex items-start gap-1 text-amber-800 text-xs"><AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" /> אין מחירים בשורות. המסמך יופק בסכום 0 (מתאים לתעודת משלוח).</div>}
                {invoiceWithoutPrices && <div className="flex items-start gap-1 text-destructive text-xs" role="alert"><AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" /> ב-{preview.unpriced_lines} שורות אין מחיר, ולכן לא תופק חשבונית. השלם מחירים בתעודה או הפק תעודת משלוח.</div>}
                {(preview.certificate_documents || []).length > 0 && (
                  <div className="flex items-start gap-1 text-amber-800 text-xs"><AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
                    <span>לתעודות השקילה המקושרות כבר הופק ב-Maven: {preview.certificate_documents.map((d) => `${d.doc_type_name} מס' ${d.doc_no}${d.certificate_number ? ` (שקילה ${d.certificate_number})` : ""}`).join(", ")}. בדוק שאינך מפיק מסמך כפול.</span>
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center gap-2">
              <Checkbox id="mv-novat" checked={noVat} onCheckedChange={(v) => setNoVat(!!v)} />
              <Label htmlFor="mv-novat" className="text-sm font-normal cursor-pointer">מסמך ללא מע"מ (כל השורות פטורות){preview?.exempt_lines ? ` · ${preview.exempt_lines} שורות כבר פטורות לפי הגדרת המוצר` : ""}</Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="mv-send" checked={sendEmail} onCheckedChange={(v) => setSendEmail(!!v)} />
              <Label htmlFor="mv-send" className="text-sm font-normal cursor-pointer">שלח את המסמך ללקוח במייל דרך Maven{preview?.customer?.email ? ` (${preview.customer.email})` : " (אין מייל ללקוח)"}</Label>
            </div>
            <div className="space-y-1">
              <Label htmlFor="mv-remarks">הערות על המסמך</Label>
              <Textarea id="mv-remarks" rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="יודפסו על המסמך (אופציונלי)" />
              {isNote && preview?.remarks && <p className="text-xs text-muted-foreground">יתווסף אוטומטית: {preview.remarks}</p>}
            </div>

            {error && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm space-y-2" role="alert">
                <div>{error}</div>
                {existing && <Button size="sm" variant="outline" onClick={() => issue(true)} disabled={issuing}>הפק בכל זאת מסמך נוסף</Button>}
              </div>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={issuing}>ביטול</Button>
            <Button onClick={() => issue(false)} disabled={issuing || loadingPreview || !preview || invoiceWithoutPrices}>
              {issuing ? <Loader2 className="w-4 h-4 animate-spin ml-2" aria-hidden="true" /> : <FileText className="w-4 h-4 ml-2" aria-hidden="true" />}
              {cfg.test_mode ? "הפק (בדיקה)" : "הפק מסמך"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
