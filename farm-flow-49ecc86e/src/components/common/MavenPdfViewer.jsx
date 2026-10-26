import React, { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, ExternalLink, FileText } from "lucide-react";
import { getToken } from "@/api/localClient";

const BASE_URL = import.meta.env.VITE_API_URL || "/api";

/** כתובת להצגת PDF של Maven דרך השרת שלנו (אותו origin → ניתן להטמעה ב-iframe). */
export function mavenPdfUrl(url, { farmId, name, download = false } = {}) {
  if (!url) return null;
  const qs = new URLSearchParams({ url, token: getToken() || "" });
  if (farmId) qs.set("farm_id", farmId);
  if (name) qs.set("name", name);
  if (download) qs.set("download", "1");
  return `${BASE_URL}/integrations/maven/pdf?${qs.toString()}`;
}

/**
 * מציג מסמך שהופק ב-Invoice Maven בתוך המערכת: מקור / העתק, פתיחה בחלון חדש והורדה.
 * doc: { pdf_original, pdf_copy, doc_type_name, doc_no }
 */
export default function MavenPdfViewer({ doc, open, onOpenChange, farmId, title }) {
  const [variant, setVariant] = useState("original");
  const hasCopy = !!doc?.pdf_copy;
  const src = variant === "copy" && hasCopy ? doc?.pdf_copy : doc?.pdf_original;
  const baseName = useMemo(() => {
    const parts = [doc?.doc_type_name, doc?.doc_no ? String(doc.doc_no) : null, variant === "copy" ? "העתק" : null].filter(Boolean);
    return parts.join("-") || "maven-document";
  }, [doc, variant]);
  const viewUrl = mavenPdfUrl(src, { farmId, name: baseName });
  const downloadUrl = mavenPdfUrl(src, { farmId, name: baseName, download: true });
  const heading = title || [doc?.doc_type_name, doc?.doc_no ? `מס' ${doc.doc_no}` : null].filter(Boolean).join(" ");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-4xl w-[calc(100vw-1rem)] sm:w-full p-0 overflow-hidden flex flex-col max-h-[92vh]">
        <DialogHeader className="px-4 pt-4 pb-2 border-b space-y-1">
          <DialogTitle className="flex items-center gap-2 text-base"><FileText className="w-4 h-4 text-primary" aria-hidden="true" />{heading || "מסמך Maven"}</DialogTitle>
          <DialogDescription className="sr-only">תצוגת המסמך שהופק ב-Invoice Maven</DialogDescription>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {hasCopy && (
              <div className="inline-flex rounded-md border overflow-hidden" role="tablist" aria-label="גרסת מסמך">
                {[["original", "מקור"], ["copy", "העתק"]].map(([k, l]) => (
                  <button key={k} type="button" role="tab" aria-selected={variant === k} onClick={() => setVariant(k)}
                          className={`px-3 h-8 text-sm ${variant === k ? "bg-primary text-primary-foreground" : "bg-background hover:bg-accent"}`}>{l}</button>
                ))}
              </div>
            )}
            <div className="ms-auto flex items-center gap-2">
              {downloadUrl && <Button asChild size="sm" variant="outline"><a href={downloadUrl}><Download className="w-4 h-4 ml-1" aria-hidden="true" /> הורדה</a></Button>}
              {viewUrl && <Button asChild size="sm" variant="outline"><a href={viewUrl} target="_blank" rel="noreferrer"><ExternalLink className="w-4 h-4 ml-1" aria-hidden="true" /> חלון חדש</a></Button>}
            </div>
          </div>
        </DialogHeader>
        <div className="flex-1 min-h-[60vh] bg-muted/40">
          {viewUrl ? (
            <iframe key={viewUrl} src={viewUrl} title={heading || "מסמך Maven"} className="w-full h-full min-h-[60vh] border-0" />
          ) : (
            <p className="p-6 text-sm text-muted-foreground">למסמך זה אין קובץ PDF (מסמך בדיקה או שהקישור לא הוחזר מ-Maven).</p>
          )}
        </div>
        <p className="px-4 py-2 text-xs text-muted-foreground border-t">אם התצוגה ריקה בטלפון, השתמש ב"חלון חדש" או ב"הורדה".</p>
      </DialogContent>
    </Dialog>
  );
}
