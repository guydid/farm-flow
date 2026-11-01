import { useState, useCallback } from 'react';
import { format } from 'date-fns';
import { WeighingItem, CompanySettings, Customer } from '@/entities/all';
import { buildCertificatePdf } from './certificatePdf';

// שיתוף תעודות שקילה כ-PDF וקטורי (טקסט אמיתי, גופן Heebo מוטמע — לא צילום מסך).
// בנייד פותח את חלונית השיתוף של המכשיר (וואטסאפ/מייל). בדפדפן ללא Web Share
// עם קבצים — הקבצים יורדים והמשתמש מצרף אותם ידנית.
// שימוש: const { share, shareMany, isSharing, shareLayoutElement } = useCertificateShare(toast);
// shareLayoutElement נשמר לתאימות (תמיד null — אין יותר צורך בפריסה נסתרת).
export default function useCertificateShare(toast) {
  const [isSharing, setIsSharing] = useState(false);

  const buildPdfFile = useCallback(async (certificate, preloaded = {}) => {
    const items = preloaded.items ?? await WeighingItem.filter({ certificate_id: certificate.id }).catch(() => []);
    if (!Array.isArray(items) || items.length === 0) return null;

    let companySettings = preloaded.companySettings;
    if (!companySettings && certificate.farm_id) {
      const arr = await CompanySettings.filter({ farm_id: certificate.farm_id }).catch(() => []);
      companySettings = (Array.isArray(arr) && arr[0]) || {};
    }
    let customer = preloaded.customer;
    if (!customer && certificate.customer_id) {
      customer = await Customer.get(certificate.customer_id).catch(() => null);
    }
    const { blob } = await buildCertificatePdf({ certificate, items, companySettings: companySettings || {}, customer: customer || {} });

    const certNum = certificate.reference_number || String(certificate.id).slice(-5);
    const fileName = `תעודת_שקילה_${certNum}.pdf`;
    const file = new File([blob], fileName, { type: 'application/pdf' });
    return { file, blob, fileName, certNum, certificate };
  }, []);

  const downloadAll = useCallback((results) => {
    for (const r of results) {
      const url = URL.createObjectURL(r.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = r.fileName;
      a.click();
      URL.revokeObjectURL(url);
    }
    toast({
      title: results.length > 1 ? 'הקבצים ירדו למחשב' : 'הקובץ ירד למחשב',
      description: 'צרף את קובצי ה-PDF להודעת וואטסאפ או למייל.',
    });
  }, [toast]);

  const deliver = useCallback(async (results, title, text) => {
    const files = results.map(r => r.file);
    if (navigator.canShare && navigator.canShare({ files })) {
      try {
        await navigator.share({ files, title, text });
        return;
      } catch (error) {
        if (error?.name === 'AbortError') return; // המשתמש סגר את חלונית השיתוף
        // NotAllowedError וכד' (למשל פג חלון הפעולה בזמן יצירת קבצים רבים) — נופלים להורדה
        console.warn('navigator.share failed, falling back to download:', error);
      }
    }
    downloadAll(results);
  }, [downloadAll]);

  // שיתוף תעודה בודדת
  const share = useCallback(async (certificate, preloaded = {}) => {
    if (!certificate) return;
    setIsSharing(true);
    try {
      const result = await buildPdfFile(certificate, preloaded);
      if (!result) {
        toast({ title: 'שגיאה', description: 'לא ניתן לשתף תעודה ריקה.', variant: 'destructive' });
        return;
      }
      const c = result.certificate;
      const text = [
        `תעודת שקילה מס' ${result.certNum}`,
        c.customer_name ? `לקוח: ${c.customer_name}` : null,
        c.date ? `תאריך: ${format(new Date(c.date), 'dd/MM/yyyy')}` : null,
        `סה"כ משקל נטו: ${parseFloat(c.total_weight || 0).toLocaleString()} ק"ג`,
      ].filter(Boolean).join('\n');
      await deliver([result], `תעודת שקילה ${result.certNum}`, text);
    } catch (error) {
      console.error('Share failed:', error);
      toast({ title: 'שגיאה', description: 'שיתוף התעודה נכשל.', variant: 'destructive' });
    } finally {
      setIsSharing(false);
    }
  }, [buildPdfFile, deliver, toast]);

  // שיתוף כמה תעודות יחד (מסימון ברשימה) — כל קובצי ה-PDF בחלונית שיתוף אחת
  const shareMany = useCallback(async (certs) => {
    const list = (Array.isArray(certs) ? certs : []).filter(Boolean).slice(0, 20);
    if (list.length === 0) return;
    if (list.length === 1) return share(list[0]);
    setIsSharing(true);
    try {
      const results = [];
      for (const c of list) {
        try {
          const r = await buildPdfFile(c);
          if (r) results.push(r);
        } catch (e) {
          console.error('build pdf failed for', c.id, e);
        }
      }
      if (results.length === 0) {
        toast({ title: 'שגיאה', description: 'אין תעודות עם פריטים לשיתוף.', variant: 'destructive' });
        return;
      }
      const totalWeight = results.reduce((s, r) => s + parseFloat(r.certificate.total_weight || 0), 0);
      const text = `${results.length} תעודות שקילה • סה"כ ${totalWeight.toLocaleString()} ק"ג נטו`;
      await deliver(results, `${results.length} תעודות שקילה`, text);
    } catch (error) {
      console.error('Share many failed:', error);
      toast({ title: 'שגיאה', description: 'שיתוף התעודות נכשל.', variant: 'destructive' });
    } finally {
      setIsSharing(false);
    }
  }, [buildPdfFile, deliver, share, toast]);

  const shareLayoutElement = null; // תאימות לאחור: הקוראים עדיין מרנדרים אותו

  return { share, shareMany, isSharing, shareLayoutElement };
}
