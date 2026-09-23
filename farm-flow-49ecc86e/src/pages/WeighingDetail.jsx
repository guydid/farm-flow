
import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { WeighingCertificate, WeighingItem, Product, Customer, CustomerProductPricing, CompanySettings, User, Farm, PalletType, Packaging } from "@/entities/all";
import { createPageUrl } from "@/utils";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { format } from "date-fns";
import { Plus, Printer, Edit, Trash2, Copy, Save, ArrowRight, Loader2, EllipsisVertical, Package, ExternalLink, Share2, ChevronUp } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import QRCode from "../components/weighing/QRCode";
import WeighingItemForm from '../components/weighing/WeighingItemForm';
import PalletSticker, { generateZPL } from "../components/weighing/PalletSticker"; // Added generateZPL import
import CertificatePrintLayout from "../components/weighing/CertificatePrintLayout";
import useCertificateShare from "../components/weighing/useCertificateShare";
import { getMeCached, getFarmCached, getListCached } from "@/api/cachedReads";

// Helper functions
const safeArray = (arr) => (Array.isArray(arr) ? arr : []);
const safeFind = (arr, predicate) => safeArray(arr).find(predicate);
const safeObject = (obj) => {
  if (obj === null || typeof obj !== 'object') {
    return {};
  }
  if (Object.prototype.hasOwnProperty.call(obj, 'hasOwnProperty') === false || typeof obj.hasOwnProperty !== 'function') {
    return { ...obj };
  }
  return obj;
};


export default function WeighingDetail() {
  // All state hooks
  const [certificate, setCertificate] = useState(null);
  const [weighingItems, setWeigingItems] = useState([]);
  const [products, setProducts] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [customerPricings, setCustomerPricings] = useState([]);
  const [companySettings, setCompanySettings] = useState(null);
  const [packagings, setPackagings] = useState([]);
  const [palletTypes, setPalletTypes] = useState([]);
  const [currentFarm, setCurrentFarm] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [editingItem, setEditingItem] = useState(null);
  const [copyingItem, setCopyingItem] = useState(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [lastAddedItem, setLastAddedItem] = useState(null);
  const [showStickerDialog, setShowStickerDialog] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [isPrinting, setIsPrinting] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false); // עריכת פרטי תעודה בנייד (מכווץ כברירת מחדל)
  const [printerConfig, setPrinterConfig] = useState(null); // New state for printer configuration
  const [certificateFormData, setCertificateFormData] = useState({
    date: format(new Date(), "yyyy-MM-dd"),
    time: "",
    customer_id: "",
    customer_name: "",
    vehicle_type: "truck",
    vehicle_number: "",
    driver_name: ""
  });

  // Refs
  const stickerPrintRef = useRef();
  const stickerPrintIframeRef = useRef();

  // Toast hook
  const { toast } = useToast();

  // שיתוף התעודה כ-PDF (וואטסאפ/מייל בנייד, הורדה במחשב)
  const { share: shareCertificatePdf, isSharing, shareLayoutElement } = useCertificateShare(toast);

  // Memoized values
  const certificateId = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("id");
  }, []);

  // Effect for mobile detection
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Callback functions
  const handleFormClose = useCallback(() => {
    setIsFormOpen(false);
    setEditingItem(null);
    setCopyingItem(null);
  }, []);

  const handleEditItem = useCallback((item) => {
    setEditingItem(safeObject(item));
    setCopyingItem(null);
    setIsFormOpen(true);
  }, []);

  const handleCopyItem = useCallback((item) => {
    setCopyingItem({
      ...safeObject(item),
      id: undefined,
      gross_weight: '',
      tare_weight: 0,
      net_weight: 0,
      item_total: 0,
      barcode: undefined
    });
    setEditingItem(null);
    setIsFormOpen(true);
  }, []);

  const handleFieldChange = useCallback((field) => (e) => {
    const value = e.target.value;
    setCertificateFormData((prev) => ({ ...safeObject(prev), [field]: value }));
  }, []);

  const handleSelectChange = useCallback((field, value) => {
    setCertificateFormData(prev => ({ ...safeObject(prev), [field]: value }));
  }, []);

  const handleCustomerChange = useCallback((customerId) => {
    const selectedCustomer = safeFind(customers, c => safeObject(c).id === customerId);
    if (selectedCustomer) {
      const safeSelectedCustomer = safeObject(selectedCustomer);
      setCertificateFormData(prev => ({
        ...safeObject(prev),
        customer_id: safeSelectedCustomer.id,
        customer_name: safeSelectedCustomer.name,
      }));
    } else {
      setCertificateFormData(prev => ({
        ...safeObject(prev),
        customer_id: "",
        customer_name: "",
      }));
    }
  }, [customers]);

  const handlePrintSticker = useCallback((item) => {
    if (!item) {
      toast({ title: "שגיאה", description: "לא ניתן להדפיס מדבקה - פרטי הפריט חסרים", variant: "destructive" });
      return;
    }
    setLastAddedItem(safeObject(item));
    setShowStickerDialog(true);
  }, [toast]);

  const updateCertificateTotals = useCallback(async (items) => {
    if (!certificate) return;
    const safeItems = safeArray(items);
    const totalWeight = safeItems.reduce((sum, item) => sum + (parseFloat(safeObject(item)?.net_weight) || 0), 0);
    const totalPackages = safeItems.reduce((sum, item) => sum + (parseInt(safeObject(item)?.package_count) || 0), 0);
    const totalAmount = safeItems.reduce((sum, item) => sum + (parseFloat(safeObject(item)?.item_total) || 0), 0);

    try {
      await WeighingCertificate.update(certificate.id, {
        total_weight: totalWeight,
        total_packages: totalPackages,
        total_amount: totalAmount,
      });
      setCertificate(prevCert => ({
        ...safeObject(prevCert),
        total_weight: totalWeight,
        total_packages: totalPackages,
        total_amount: totalAmount,
      }));
    } catch (error) {
      console.error("Failed to update certificate totals:", error);
    }
  }, [certificate]);

  const loadData = useCallback(async () => {
    if (!certificateId) return;

    setIsLoading(true);
    try {
      const user = await getMeCached();
      if (!user.current_farm_id) {
        toast({ title: "שגיאה", description: "לא נמצא משק פעיל", variant: "destructive" });
        return;
      }

      const farm = await getFarmCached(user.current_farm_id);
      setCurrentFarm(safeObject(farm));

      const fid = user.current_farm_id;
      const farmFilter = { farm_id: fid };

      // תעודה ופריטים — תמיד טריים; קטלוגים (מוצרים/לקוחות/אריזות/משטחים/תמחור/הגדרות)
      // דרך קאש משותף — ניווט חוזר לא יורה שוב את כל הבקשות דרך ה-tunnel.
      const [
        certificateData,
        itemsData,
        productsData,
        customersData,
        pricingsData,
        settingsData,
        packagingsData,
        palletTypesData
      ] = await Promise.all([
        WeighingCertificate.get(certificateId),
        WeighingItem.filter({ certificate_id: certificateId }),
        getListCached(`products_${fid}`, () => Product.filter(farmFilter)),
        getListCached(`customers_${fid}`, () => Customer.filter(farmFilter)),
        getListCached(`customer_pricing_${fid}`, () => CustomerProductPricing.filter(farmFilter)),
        getListCached(`company_settings_${fid}`, () => CompanySettings.filter(farmFilter)),
        getListCached(`packaging_${fid}`, () => Packaging.filter(farmFilter)),
        getListCached('pallet_types', () => PalletType.list())
      ]);

      setCertificate(safeObject(certificateData || null));
      setWeigingItems(safeArray(itemsData));
      setProducts(safeArray(productsData));
      setCustomers(safeArray(customersData));
      setCustomerPricings(safeArray(pricingsData));
      
      const compSettings = safeObject(safeArray(settingsData)[0] || null);
      setCompanySettings(compSettings);
      
      // Load printer configuration
      if (compSettings?.printer_settings) {
        setPrinterConfig(compSettings.printer_settings);
      }

      setPackagings(safeArray(packagingsData));
      setPalletTypes(safeArray(palletTypesData));

      if (certificateData) {
        const safeCertData = safeObject(certificateData);
        setCertificateFormData({
          date: safeCertData.date || format(new Date(), "yyyy-MM-dd"),
          time: safeCertData.time || "",
          customer_id: safeCertData.customer_id || "",
          customer_name: safeCertData.customer_name || "",
          vehicle_type: safeCertData.vehicle_type || "truck",
          vehicle_number: safeCertData.vehicle_number || "",
          driver_name: safeCertData.driver_name || ""
        });
      }
    } catch (error) {
      console.error("Error loading weighing certificate data:", error);
      toast({ title: "שגיאה בטעינת נתונים", description: error.message, variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }, [certificateId, toast]);

  const handleCreateNewCertificate = useCallback(async () => {
    if (!currentFarm) {
      toast({ title: "שגיאה", description: "יש לבחור משק תחילה.", variant: "destructive" });
      return;
    }
    setIsLoading(true);
    try {
      const barcode = `CERT-${Date.now()}`;
      const newCert = await WeighingCertificate.create({
        farm_id: safeObject(currentFarm).id,
        date: format(new Date(), "yyyy-MM-dd"),
        status: 'draft',
        barcode: barcode,
        total_weight: 0,
        total_packages: 0,
        total_amount: 0
      });
      window.location.search = `?id=${newCert.id}`;
    } catch (error) {
      console.error("Failed to create new certificate:", error);
      toast({ title: "שגיאה", description: "יצירת תעודה חדשה נכשלה", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }, [currentFarm, toast]);

  const printZebraSticker = useCallback(() => {
    if (!window.BrowserPrint) {
      toast({
        title: "שגיאה",
        description: "Zebra Browser Print לא זמין. נא להתקין את התוכנה.",
        variant: "destructive"
      });
      return;
    }
    if (!lastAddedItem || !certificate || !companySettings || !printerConfig) {
      toast({
        title: "שגיאה",
        description: "נתונים חסרים להדפסת מדבקה.",
        variant: "destructive"
      });
      return;
    }

    window.BrowserPrint.getDefaultDevice(
      'printer',
      (device) => {
        if (!device) {
          toast({
            title: "שגיאה",
            description: "לא נמצאה מדפסת Zebra מחוברת",
            variant: "destructive"
          });
          return;
        }

        // Generate ZPL code
        const zpl = generateZPL(lastAddedItem, certificate, companySettings, printerConfig);

        // Send to printer
        device.send(zpl,
          () => {
            toast({
              title: "הצלחה!",
              description: "המדבקה נשלחה להדפסה"
            });
            setShowStickerDialog(false);
          },
          (error) => {
            console.error('Print error:', error);
            toast({
              title: "שגיאת הדפסה",
              description: error.message || "ההדפסה נכשלה. נסה שוב.",
              variant: "destructive"
            });
          }
        );
      },
      (error) => {
        console.error('Device error:', error);
        toast({
          title: "שגיאת חיבור",
          description: "לא הצלחנו להתחבר למדפסת. ודא שהמדפסת מחוברת.",
          variant: "destructive"
        });
      }
    );
  }, [lastAddedItem, certificate, companySettings, printerConfig, toast]);

  const printSticker = useCallback(() => {
    try {
      // Check if we should use Zebra direct print
      if (printerConfig?.printer_type === 'zebra' && printerConfig?.enable_direct_print && window.BrowserPrint) {
        printZebraSticker();
        return;
      }

      // Fall back to regular browser print
      const stickerContent = stickerPrintRef.current?.innerHTML || '';
      if (!stickerContent) {
        toast({ title: "שגיאה", description: "תוכן המ מדבקה ריק.", variant: "destructive" });
        return;
      }

      const iframe = stickerPrintIframeRef.current;
      if (!iframe) {
        toast({ title: "שגיאה", description: "רכיב ההדפסה לא מוכן.", variant: "destructive" });
        return;
      }

      const printContent = `
        <html dir="rtl">
          <head>
            <title>מדבקת משטח</title>
            <style>
              body {
                font-family: Arial, sans-serif;
                margin: 0;
                padding: 0;
                direction: rtl;
                -webkit-print-color-adjust: exact;
              }
              .sticker-container {
                width: 100mm;
                height: 70mm;
                border: 2px solid #000;
                padding: 10px;
                box-sizing: border-box;
                display: block;
              }
              @page {
                size: 100mm 70mm;
                margin: 0;
              }
              @media print {
                body { margin: 0; }
                .sticker-container { border: none; }
              }
            </style>
          </head>
          <body>
            <div class="sticker-container">${stickerContent}</div>
          </body>
        </html>
      `;

      const iframeDoc = iframe.contentWindow.document;
      iframeDoc.open();
      iframeDoc.write(printContent);
      iframeDoc.close();

      setTimeout(() => {
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
        setShowStickerDialog(false);
      }, 500);

    } catch (error) {
      console.error("Printing failed:", error);
      toast({ title: "שגיאה", description: "ההדפסה נכשלה.", variant: "destructive" });
    }
  }, [toast, printerConfig, printZebraSticker]);

  const handlePrintCertificate = useCallback(() => {
    if (!certificate || weighingItems.length === 0) {
      toast({ title: "שגיאה", description: "לא ניתן להדפיס תעודה ריקה.", variant: "destructive" });
      return;
    }
    setIsPrinting(true);
    setTimeout(() => {
      window.print();
      setIsPrinting(false);
    }, 500);
  }, [certificate, weighingItems, toast]);

  const handleShareCertificate = useCallback(() => {
    if (!certificate || weighingItems.length === 0) {
      toast({ title: "שגיאה", description: "לא ניתן לשתף תעודה ריקה.", variant: "destructive" });
      return;
    }
    shareCertificatePdf(certificate, {
      items: safeArray(weighingItems),
      companySettings: safeObject(companySettings),
      customer: safeFind(customers, c => safeObject(c).id === safeObject(certificate).customer_id),
    });
  }, [certificate, weighingItems, companySettings, customers, shareCertificatePdf, toast]);

  const handleFormSuccess = useCallback(async (itemData) => {
    if (!certificate || !currentFarm) {
      toast({ title: "שגיאה", description: "נתונים חסרים - תעודה או משק לא נמצאו", variant: "destructive" });
      return;
    }

    try {
      let savedItem;
      
      if (editingItem) {
        const updateData = {
          ...itemData,
          farm_id: currentFarm.id,
          certificate_id: certificate.id
        };
        
        await WeighingItem.update(editingItem.id, updateData);
        savedItem = { ...editingItem, ...updateData };
      } else {
        const createData = {
          ...itemData,
          farm_id: currentFarm.id,
          certificate_id: certificate.id,
          barcode: `ITEM-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`
        };
        
        savedItem = await WeighingItem.create(createData);
      }

      toast({ 
        title: "הצלחה", 
        description: editingItem ? "הפריט עודכן בהצלחה" : "הפריט נוסף בהצלחה" 
      });

      handleFormClose();
      
      const updatedItems = await WeighingItem.filter({ certificate_id: certificate.id });
      setWeigingItems(updatedItems);
      
      await updateCertificateTotals(updatedItems);
      
      if (!editingItem && savedItem) {
        handlePrintSticker(savedItem);
      }
      
    } catch (error) {
      console.error("Failed to save weighing item:", error);
      const errorMessage = error.response?.data?.message || error.message || "שמירת הפריט נכשלה";
      toast({ 
        title: "שגיאה", 
        description: `שמירת הפריט נכשלה: ${errorMessage}`,
        variant: "destructive" 
      });
    }
  }, [certificate, currentFarm, editingItem, handleFormClose, updateCertificateTotals, handlePrintSticker, toast]);

  const handleDeleteItem = useCallback(async (itemId) => {
    if (!window.confirm("האם אתה בטוח שברצונך למחוק פריט זה?")) return;

    try {
      await WeighingItem.delete(itemId);
      toast({ title: "הצלחה", description: "הפריט נמחק." });
      const newItems = await WeighingItem.filter({ certificate_id: certificate.id });
      setWeigingItems(newItems);
      await updateCertificateTotals(newItems);
    } catch (error) {
      console.error("Failed to delete item:", error);
      toast({ title: "שגיאה", description: "מחיקת הפריט נכשלה", variant: "destructive" });
    }
  }, [toast, certificate, updateCertificateTotals]);

  const handleSaveCertificate = useCallback(async () => {
    if (!certificate) return;

    try {
      await WeighingCertificate.update(certificate.id, safeObject(certificateFormData));
      toast({ title: "הצלחה", description: "פרטי התעודה נשמרו בהצלחה." });
      loadData();
    } catch (error) {
      console.error("Failed to save certificate details:", error);
      toast({ title: "שגיאה", description: "שמירת פרטי התעודה נכשלה.", variant: "destructive" });
    }
  }, [certificate, certificateFormData, toast, loadData]);

  useEffect(() => {
    if (certificateId) {
      loadData();
    }
  }, [certificateId, loadData]);

  // הבר התחתון (BottomNav) מוחלף בעמוד זה בפעולות תעודה ומשדר אירוע window
  useEffect(() => {
    const handler = (e) => {
      switch (e.detail) {
        case 'add': setIsFormOpen(true); break;
        case 'share': handleShareCertificate(); break;
        case 'print': handlePrintCertificate(); break;
        case 'details':
          setDetailsOpen(o => !o);
          window.scrollTo({ top: 0, behavior: 'smooth' });
          break;
        default: break;
      }
    };
    window.addEventListener('weighing-detail-action', handler);
    return () => window.removeEventListener('weighing-detail-action', handler);
  }, [handleShareCertificate, handlePrintCertificate]);

  const safeItems = safeArray(weighingItems);
  const safeCertificate = safeObject(certificate);
  const safeCompanySettings = safeObject(companySettings);

  if (isPrinting) {
    return (
      <CertificatePrintLayout
        certificate={safeCertificate}
        items={safeItems}
        companySettings={safeCompanySettings}
        customer={safeFind(customers, c => safeObject(c).id === safeCertificate.customer_id)}
      />
    );
  }

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-screen">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!certificate && !certificateId) {
    return (
      <div className="flex flex-col justify-center items-center h-screen text-center">
        <p className="text-lg text-gray-600 mb-4">יש ליצור תעודה חדשה כדי להתחיל.</p>
        <Button onClick={handleCreateNewCertificate}>
          <Plus className="w-4 h-4 ml-2" />
          צור תעודה חדשה
        </Button>
      </div>
    );
  }

  if (!certificate && certificateId) {
    return <div className="p-6 text-center">טוען תעודה...</div>;
  }

  const certFormFields = (
    <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-4 text-sm flex-grow">
      <div>
        <Label>תאריך:</Label>
        <Input type="date" value={safeObject(certificateFormData).date} onChange={handleFieldChange('date')} />
      </div>
      <div>
        <Label>שעה:</Label>
        <Input type="time" value={safeObject(certificateFormData).time} onChange={handleFieldChange('time')} />
      </div>
      <div>
        <Label>לקוח:</Label>
        <Select value={safeObject(certificateFormData).customer_id || ""} onValueChange={handleCustomerChange}>
          <SelectTrigger>
            <SelectValue placeholder="בחר לקוח..."/>
          </SelectTrigger>
          <SelectContent>
            {safeArray(customers).map(customer => {
              const safeCust = safeObject(customer);
              return safeCust.id && (
                <SelectItem key={safeCust.id} value={safeCust.id}>{safeCust.name}</SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label>נהג:</Label>
        <Input value={safeObject(certificateFormData).driver_name} onChange={handleFieldChange('driver_name')} />
      </div>
      <div>
        <Label>סוג רכב:</Label>
        <Select value={safeObject(certificateFormData).vehicle_type} onValueChange={(value) => handleSelectChange('vehicle_type', value)}>
          <SelectTrigger>
            <SelectValue placeholder="בחר סוג רכב..."/>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="truck">משאית</SelectItem>
            <SelectItem value="van">מסחרית</SelectItem>
            <SelectItem value="pickup">טנדר</SelectItem>
            <SelectItem value="trailer">נגרר</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label>מספר רכב:</Label>
        <Input value={safeObject(certificateFormData).vehicle_number} onChange={handleFieldChange('vehicle_number')} />
      </div>
      <div className="sm:col-span-2 md:col-span-3">
        <Button size="sm" onClick={handleSaveCertificate}>
          <Save className="w-4 h-4 ml-2" /> שמור שינויים
        </Button>
      </div>
    </div>
  );

  return (
    <>
      <div className="p-4 sm:p-6 lg:p-8 bg-gray-50 min-h-screen" dir="rtl">
        <div className="max-w-7xl mx-auto space-y-4 sm:space-y-6">
          {/* Certificate Details — בנייד: כרטיס קומפקטי שנפתח לעריכה; במחשב: הטופס המלא */}
          {isMobile ? (
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1" onClick={() => setDetailsOpen(o => !o)}>
                    <div className="font-bold text-gray-900 truncate">
                      {safeObject(certificateFormData).customer_name || safeCertificate.customer_name || 'ללא לקוח'}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {safeObject(certificateFormData).date ? format(new Date(safeObject(certificateFormData).date), 'dd/MM/yyyy') : ''}
                      {safeObject(certificateFormData).time ? ` · ${safeObject(certificateFormData).time}` : ''}
                      {safeCertificate.id ? ` · #${String(safeCertificate.id).slice(-5)}` : ''}
                      {safeObject(certificateFormData).vehicle_number ? ` · ${safeObject(certificateFormData).vehicle_number}` : ''}
                    </div>
                  </div>
                  <Button variant="ghost" size="sm" className="shrink-0 text-blue-600 h-8" onClick={() => setDetailsOpen(o => !o)}>
                    {detailsOpen
                      ? <><ChevronUp className="w-4 h-4 ml-1" />סגור</>
                      : <><Edit className="w-4 h-4 ml-1" />ערוך</>}
                  </Button>
                </div>
                {detailsOpen && (
                  <div className="mt-4 pt-4 border-t">
                    {certFormFields}
                  </div>
                )}
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>פרטי תעודה</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
                  {certFormFields}
                  {safeCertificate.barcode && (
                    <div className="text-center p-2 bg-gray-50 rounded-lg">
                      <QRCode data={safeCertificate.barcode} size={80} />
                      <p className="text-xs text-muted-foreground mt-1 font-mono">{safeCertificate.barcode}</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Totals Summary — בנייד: פס קומפקטי אחד; במחשב: 4 כרטיסים */}
          {isMobile ? (
            <div className="grid grid-cols-3 divide-x divide-x-reverse divide-gray-100 rounded-2xl border border-gray-200 bg-white shadow-sm py-3 text-center">
              <div>
                <div className="text-lg font-bold text-gray-900 tabular-nums">{parseFloat(safeCertificate.total_weight || 0).toLocaleString(undefined, { maximumFractionDigits: 1 })}</div>
                <div className="text-[11px] text-gray-500">ק"ג נטו</div>
              </div>
              <div>
                <div className="text-lg font-bold text-gray-900 tabular-nums">{parseInt(safeCertificate.total_packages || 0).toLocaleString()}</div>
                <div className="text-[11px] text-gray-500">אריזות</div>
              </div>
              <div>
                <div className="text-lg font-bold text-gray-900 tabular-nums">₪{parseFloat(safeCertificate.total_amount || 0).toLocaleString('he-IL', { maximumFractionDigits: 0 })}</div>
                <div className="text-[11px] text-gray-500">לתשלום</div>
              </div>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium">סה"כ משקל (נטו)</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{parseFloat(safeCertificate.total_weight || 0).toLocaleString()} ק"ג</div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium">סה"כ אריזות</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{parseInt(safeCertificate.total_packages || 0).toLocaleString()}</div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium">סה"כ לתשלום</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">₪{parseFloat(safeCertificate.total_amount || 0).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium">מספר משטחים</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{safeItems.length}</div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* פרטי משטחים */}
          <Card>
            <CardHeader>
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <CardTitle className="flex items-center gap-2">
                  <Package className="w-5 h-5" />
                  משטחים ({safeItems.length})
                  <Link
                    to={createPageUrl("Settings?tab=products")}
                    className="hidden sm:inline-block text-blue-600 hover:text-blue-800 text-sm"
                    title="נהל מוצרים"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </Link>
                </CardTitle>
                {/* בנייד הפעולות עברו לבר התחתון — הכפתורים כאן מוצגים במחשב בלבד */}
                <div className="hidden sm:flex flex-wrap gap-2">
                  <Button variant="outline" onClick={handleShareCertificate} disabled={isSharing}>
                    {isSharing
                      ? <Loader2 className="w-4 h-4 ml-2 animate-spin" />
                      : <Share2 className="w-4 h-4 ml-2" />}
                    שתף
                  </Button>
                  <Button variant="outline" onClick={handlePrintCertificate}>
                    <Printer className="w-4 h-4 ml-2" /> הדפס תעודה
                  </Button>
                  <Button onClick={() => setIsFormOpen(true)}>
                    <Plus className="w-4 h-4 ml-2" />
                    הוסף פריט
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {safeItems.length === 0 ? (
                <div className="text-center py-12">
                  <p className="text-gray-500 mb-4">לא נוספו פריטים לתעודה זו.</p>
                  <Button onClick={() => setIsFormOpen(true)}>
                    <Plus className="w-4 h-4 ml-2" />
                    הוסף פריט ראשון
                  </Button>
                </div>
              ) : isMobile ? (
                /* פריטים ככרטיסיות בנייד — לחיצה עורכת, ⋮ לפעולות נוספות */
                <div className="-mx-3 divide-y divide-gray-100">
                  {safeItems.map(item => {
                    const si = safeObject(item);
                    return (
                      <div
                        key={si.id}
                        onClick={() => handleEditItem(si)}
                        className="flex items-center gap-3 px-3 py-3 active:bg-gray-50 cursor-pointer"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-gray-900 truncate">
                            {si.product_name || 'ללא שם'}
                            {si.quality && <span className="font-normal text-xs text-gray-500"> · {si.quality}</span>}
                          </div>
                          <div className="text-xs text-gray-500 mt-1">
                            {si.package_count || 0} × {si.packaging_type || 'אריזה'}
                            {si.pallet_type ? ` · ${si.pallet_type}` : ''}
                          </div>
                        </div>
                        <div className="text-left shrink-0">
                          <div className="font-bold text-gray-900 tabular-nums">
                            {parseFloat(si.net_weight || 0).toLocaleString()}
                            <span className="text-xs font-normal text-gray-400"> ק"ג</span>
                          </div>
                          {parseFloat(si.item_total || 0) > 0 && (
                            <div className="text-xs text-gray-500 tabular-nums">
                              ₪{parseFloat(si.item_total || 0).toLocaleString('he-IL', { maximumFractionDigits: 0 })}
                            </div>
                          )}
                        </div>
                        <div onClick={(e) => e.stopPropagation()} className="shrink-0">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-9 w-9 text-gray-400">
                                <EllipsisVertical className="h-5 w-5" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => handlePrintSticker(si)}>
                                <Printer className="ml-2 h-4 w-4" />
                                הדפס מדבקה
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleCopyItem(si)}>
                                <Copy className="ml-2 h-4 w-4" />
                                שכפל
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem className="text-red-600" onClick={() => handleDeleteItem(si.id)}>
                                <Trash2 className="ml-2 h-4 w-4" />
                                מחק
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>פעולות</TableHead>
                        <TableHead className="text-right">בר-קוד</TableHead>
                        <TableHead className="text-right">
                          <div className="flex items-center gap-2">
                            פריט
                            <Link
                              to={createPageUrl("Settings?tab=products")}
                              className="text-blue-600 hover:text-blue-800"
                              title="נהל מוצרים"
                            >
                              <ExternalLink className="h-3 w-3" />
                            </Link>
                          </div>
                        </TableHead>
                        <TableHead className="text-right">איכות</TableHead>
                        <TableHead className="text-right">
                          <div className="flex items-center gap-2">
                            אריזה
                            <Link
                              to={createPageUrl("Settings?tab=packaging")}
                              className="text-blue-600 hover:text-blue-800"
                              title="נהל אריזות"
                            >
                              <ExternalLink className="h-3 w-3" />
                            </Link>
                          </div>
                        </TableHead>
                        <TableHead className="text-right">מס׳ אריזות</TableHead>
                        <TableHead className="text-right">
                          <div className="flex items-center gap-2">
                            משטח
                            <Link
                              to={createPageUrl("Settings?tab=pallet_types")}
                              className="text-blue-600 hover:text-blue-800"
                              title="נהל משטחים"
                            >
                              <ExternalLink className="h-3 w-3" />
                            </Link>
                          </div>
                        </TableHead>
                        <TableHead className="text-right">משקל ברוטו</TableHead>
                        <TableHead className="text-right">טרה</TableHead>
                        <TableHead className="text-right">נטו</TableHead>
                        <TableHead className="text-right">מחיר/יח׳</TableHead>
                        <TableHead className="text-right">הנחה %</TableHead>
                        <TableHead className="text-right">סה״כ</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {safeItems.map(item => {
                        const safeItem = safeObject(item);
                        return (
                          <TableRow key={safeItem.id}>
                            <TableCell>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                                    <span className="sr-only">פתח תפריט</span>
                                    <EllipsisVertical className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="start">
                                  <DropdownMenuItem onClick={() => handleEditItem(safeItem)}>
                                    <Edit className="ml-2 h-4 w-4" />
                                    ערוך
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => handleCopyItem(safeItem)}>
                                    <Copy className="ml-2 h-4 w-4" />
                                    שכפל
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => handlePrintSticker(safeItem)}>
                                    <Printer className="ml-2 h-4 w-4" />
                                    הדפס מדבקה
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem className="text-red-600" onClick={() => handleDeleteItem(safeItem.id)}>
                                    <Trash2 className="ml-2 h-4 w-4" />
                                    מחק
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </TableCell>
                            <TableCell>
                              {safeItem.barcode && <QRCode data={safeItem.barcode} size={25} />}
                            </TableCell>
                            <TableCell>{safeItem.product_name}</TableCell>
                            <TableCell>{safeItem.quality}</TableCell>
                            <TableCell>{safeItem.packaging_type}</TableCell>
                            <TableCell className="text-center">{safeItem.package_count}</TableCell>
                            <TableCell>{safeItem.pallet_type}</TableCell>
                            <TableCell className="text-center">{parseFloat(safeItem.gross_weight || 0).toLocaleString()}</TableCell>
                            <TableCell className="text-center">{parseFloat(safeItem.tare_weight || 0).toLocaleString()}</TableCell>
                            <TableCell className="font-semibold text-center">{parseFloat(safeItem.net_weight || 0).toLocaleString()}</TableCell>
                            <TableCell className="text-center">
                              ₪{parseFloat(safeItem.price_per_unit || 0).toLocaleString()} / {safeItem.pricing_method === 'per_kg' ? 'ק"ג' : 'יח'}
                            </TableCell>
                            <TableCell className="text-center">{parseFloat(safeItem.discount_percentage || 0)}%</TableCell>
                            <TableCell className="font-semibold text-center">
                              ₪{parseFloat(safeItem.item_total || 0).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

        </div>
      </div>

      {/* Item Form Dialog */}
      <Dialog open={isFormOpen} onOpenChange={handleFormClose}>
        <DialogContent className="max-w-2xl" dir="rtl">
          <DialogHeader>
            <DialogTitle>{editingItem ? "עריכת פריט" : "הוספת פריט"}</DialogTitle>
          </DialogHeader>
          <WeighingItemForm
            item={editingItem || copyingItem}
            isCopyMode={!!copyingItem}
            products={products}
            customers={customers}
            customerPricings={customerPricings}
            packagings={packagings}
            palletTypes={palletTypes}
            certificateCustomerId={safeCertificate.customer_id}
            onSubmit={handleFormSuccess}
            onCancel={handleFormClose}
          />
        </DialogContent>
      </Dialog>

      {/* Sticker Print Dialog */}
      <Dialog open={showStickerDialog} onOpenChange={setShowStickerDialog}>
        <DialogContent className="max-w-fit" onPointerDownOutside={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>הדפסת מדבקה</DialogTitle>
            <DialogDescription>
              תצוגה מקדימה של המדבקה. לחץ על &quot;הדפס&quot; כדי להדפיס.
            </DialogDescription>
          </DialogHeader>
          <div ref={stickerPrintRef} className="mx-auto my-4">
            {lastAddedItem && (
              <PalletSticker
                item={safeObject(lastAddedItem)}
                certificate={safeObject(certificate)}
                companySettings={safeObject(companySettings)}
              />
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowStickerDialog(false)}>
              סגור
            </Button>
            <Button onClick={printSticker}>
              <Printer className="w-4 h-4 ml-2" />
              הדפס
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Hidden iframe for sticker printing */}
      <iframe ref={stickerPrintIframeRef} title="Print Sticker Iframe" style={{ height: '0', width: '0', position: 'absolute', border: 'none' }}></iframe>

      {/* פריסת התעודה מרונדרת מחוץ למסך לצילום ה-PDF בעת שיתוף */}
      {shareLayoutElement}
    </>
  );
}
