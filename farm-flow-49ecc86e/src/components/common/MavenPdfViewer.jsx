import React, { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, ExternalLink, FileText, Share2, Loader2, MessageCircle, Mail, Link2, Check } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useToast } from "@/components/ui/use-toast";
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

  // ── שיתוף ──
  // בטלפון: שיתוף הקובץ עצמו (WhatsApp, מייל, Drive...) דרך Web Share API.
  // במחשב / דפדפן ללא תמיכה: שיתוף הקישור הציבורי שהחזיר Maven (לא הקישור הפנימי שלנו, שמכיל טוקן).
  const { toast } = useToast();
  const [sharing, setSharing] = useState(false);
  const [copied, setCopied] = useState(false);
  const shareText = `${heading || "מסמך"} מ-Farm Flow`;
  const canShareFiles = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const shareFile = async () => {
    if (!viewUrl) return;
    setSharing(true);
    try {
      const res = await fetch(viewUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const file = new File([blob], `${baseName}.pdf`, { type: "application/pdf" });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: shareText });
      } else {
        await navigator.share({ title: shareText, text: shareText, url: src });
      }
    } catch (e) {
      if (e?.name !== "AbortError") toast({ title: "השיתוף לא הושלם", description: e.message, variant: "destructive" });
    } finally { setSharing(false); }
  };
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(src); setCopied(true); setTimeout(() => setCopied(false), 2000); toast({ title: "הקישור הועתק" }); }
    catch { toast({ title: "לא ניתן להעתיק", description: src, variant: "destructive" }); }
  };
  const waHref = src ? `https://wa.me/?text=${encodeURIComponent(`${shareText}\n${src}`)}` : null;
  const mailHref = src ? `mailto:?subject=${encodeURIComponent(shareText)}&body=${encodeURIComponent(`${shareText}\n${src}`)}` : null;

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
              {src && (canShareFiles ? (
                <Button size="sm" onClick={shareFile} disabled={sharing}>
                  {sharing ? <Loader2 className="w-4 h-4 ml-1 animate-spin" aria-hidden="true" /> : <Share2 className="w-4 h-4 ml-1" aria-hidden="true" />} שתף
                </Button>
              ) : (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm"><Share2 className="w-4 h-4 ml-1" aria-hidden="true" /> שתף</Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" dir="rtl">
                    <DropdownMenuItem asChild><a href={waHref} target="_blank" rel="noreferrer" className="flex items-center gap-2 cursor-pointer"><MessageCircle className="w-4 h-4 text-green-600" aria-hidden="true" /> WhatsApp</a></DropdownMenuItem>
                    <DropdownMenuItem asChild><a href={mailHref} className="flex items-center gap-2 cursor-pointer"><Mail className="w-4 h-4" aria-hidden="true" /> מייל</a></DropdownMenuItem>
                    <DropdownMenuItem onSelect={copyLink} className="flex items-center gap-2 cursor-pointer">{copied ? <Check className="w-4 h-4 text-green-600" aria-hidden="true" /> : <Link2 className="w-4 h-4" aria-hidden="true" />} העתק קישור</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ))}
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
