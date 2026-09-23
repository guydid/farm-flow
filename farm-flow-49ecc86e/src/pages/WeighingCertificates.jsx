
import React, { useState, useEffect, useMemo, useRef } from "react";
import { WeighingCertificate, Customer, User, Farm, WeighingItem } from "@/entities/all";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { format, parseISO, isToday, isYesterday } from "date-fns";
import { he } from 'date-fns/locale'; // Import Hebrew locale
import { Plus, Edit, Eye, Printer, Truck, Trash2, UserPlus, Clock, User as UserIcon, Scale, X, Archive, Filter, Copy, CheckSquare, PieChart, Loader2, FileText, CheckCircle2, SlidersHorizontal, ChevronDown, ChevronUp, Share2, Check, MoreVertical } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { useToast } from "@/components/ui/use-toast";
import {
  Collapsible,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from "@/components/ui/table";
import useCertificateShare from "../components/weighing/useCertificateShare";
import { getMeCached, getFarmCached, getListCached, invalidateList } from "@/api/cachedReads";
import CustomerOpenReportLayout from "../components/weighing/CustomerOpenReport";


export default function WeighingCertificates() {
  const location = useLocation();
  const navigate = useNavigate();
  const [certificates, setCertificates] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isCustomerDialogOpen, setIsCustomerDialogOpen] = useState(false);
  const [editingCertificate, setEditingCertificate] = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  // const [showFilters, setShowFilters] = useState(false); // Filters are now always visible, no need for state
  const [currentFarm, setCurrentFarm] = useState(null);
  const [selectedCertificates, setSelectedCertificates] = useState(new Set());
  const [isBulkActionsOpen, setIsBulkActionsOpen] = useState(false);
  const [selectMode, setSelectMode] = useState(false); // מצב בחירה מרובה בנייד
  // דוח תעודות פתוחות ללקוח
  const [reportOpen, setReportOpen] = useState(false);
  const [reportData, setReportData] = useState(null);
  const [reportBusy, setReportBusy] = useState(false);
  const [reportSharing, setReportSharing] = useState(false);
  const reportRef = useRef(null);
  const [salesSummary, setSalesSummary] = useState(null);
  const [isSummaryLoading, setIsSummaryLoading] = useState(false);
  const [showSalesSummary, setShowSalesSummary] = useState(false);
  const { toast } = useToast();

  // שיתוף תעודה כ-PDF ישירות מהרשימה (וואטסאפ/מייל בנייד, הורדה במחשב)
  const { share: shareCertificatePdf, shareMany: shareManyCertificates, isSharing, shareLayoutElement } = useCertificateShare(toast);

  const handleBulkShare = () => {
    const selected = (Array.isArray(certificates) ? certificates : []).filter(c => selectedCertificates.has(c.id));
    if (selected.length === 0) {
      toast({ title: "שגיאה", description: "לא נבחרו תעודות לשיתוף.", variant: "destructive" });
      return;
    }
    setIsBulkActionsOpen(false);
    shareManyCertificates(selected);
  };

  // Auto-open create dialog when navigated with ?create=true (e.g. from FAB)
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('create') === 'true') {
      setIsDialogOpen(true);
      navigate(location.pathname, { replace: true });
    }
  }, [location.search]);

  const [isMobile, setIsMobile] = useState(false);

  const [filters, setFilters] = useState({
    status: "all",
    customer: "",
    date_from: "",
    date_to: "",
    delivery_note: "all" // New filter
  });
  const [filtersOpen, setFiltersOpen] = useState(false);

  const [formData, setFormData] = useState({
    date: format(new Date(), "yyyy-MM-dd"), // Keep ISO format for input type="date"
    time: format(new Date(), "HH:mm"),
    customer_id: "",
    customer_name: "",
    vehicle_type: "truck",
    vehicle_number: "",
    driver_name: ""
  });

  const [newCustomerData, setNewCustomerData] = useState({
    name: "",
    contact_person: "",
    phone: "",
    email: "",
    address: ""
  });

  useEffect(() => {
    loadData();
  }, []);

  // הבר התחתון (BottomNav) מוחלף בעמוד זה בפעולות תעודות ומשדר אירוע window
  useEffect(() => {
    const handler = (e) => {
      switch (e.detail) {
        case 'select':
          setSelectMode(prev => {
            if (prev) setSelectedCertificates(new Set());
            return !prev;
          });
          break;
        case 'create':
          resetForm();
          setIsDialogOpen(true);
          break;
        case 'archive':
          setShowArchived(p => !p);
          window.scrollTo({ top: 0, behavior: 'smooth' });
          break;
        case 'summary':
          setShowSalesSummary(p => !p);
          window.scrollTo({ top: 0, behavior: 'smooth' });
          break;
        default: break;
      }
    };
    window.addEventListener('weighing-list-action', handler);
    return () => window.removeEventListener('weighing-list-action', handler);
  }, []);

  // Detect mobile
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const loadData = async () => {
    try {
        const user = await getMeCached();

        if (!user?.current_farm_id) {
          setCertificates([]);
          setCustomers([]);
          setCurrentFarm(null);
          return;
        }

        const farm = await getFarmCached(user.current_farm_id);
        setCurrentFarm(farm);

        const farmFilter = { farm_id: user.current_farm_id };

        const [certsResult, custsResult] = await Promise.all([
            WeighingCertificate.filter(farmFilter, "-date").catch(() => []),
            getListCached(`customers_${user.current_farm_id}`, () => Customer.filter(farmFilter, "name")).catch(() => [])
        ]);
        
        setCertificates(Array.isArray(certsResult) ? certsResult : []);
        setCustomers(Array.isArray(custsResult) ? custsResult : []);
    } catch(e) {
        console.error("Failed to load weighing data:", e);
        setCertificates([]);
        setCustomers([]);
        setCurrentFarm(null);
    }
  };
  
  const handleDelete = async (certId) => {
      if (window.confirm("פעולה זו תמחק את התעודה וכל הנתונים המשוייכים אליה. האם אתה בטוח?")) {
          try {
              await WeighingCertificate.delete(certId);
              toast({ title: "הצלחה", description: "התעודה נמחקה" });
              loadData();
          } catch(e) {
              toast({ title: "שגיאה", description: "מחיקת התעודה נכשלה", variant: "destructive" });
          }
      }
  };
  
  const handleBulkPrint = (certificateIdsToPrint = Array.from(selectedCertificates)) => {
    if (certificateIdsToPrint.length === 0) {
      toast({ title: "שגיאה", description: "לא נבחרו תעודות להדפסה.", variant: "destructive" });
      return;
    }

    const selected = certificates.filter(cert => certificateIdsToPrint.includes(cert.id));

    const totalWeight = selected.reduce((sum, cert) => sum + (cert.total_weight || 0), 0);
    const totalPackages = selected.reduce((sum, cert) => sum + (cert.total_packages || 0), 0);

    try {
      const printWindow = window.open('', '_blank');
      
      if (!printWindow) {
        toast({ 
          title: "שגיאה בהדפסה", 
          description: "לא ניתן לפתוח חלון הדפסה. יתכן שחוסם pop-ups חוסם את הפעולה. אנא אפשר pop-ups לאתר זה.", 
          variant: "destructive" 
        });
        return;
      }
    
      const tableRows = selected.map(cert => `
        <tr>
          <td>${cert.id.slice(-5)}</td>
          <td>${cert.date ? format(new Date(cert.date), 'dd/MM/yyyy') : ''}</td>
          <td>${cert.customer_name || ''}</td>
          <td>${cert.vehicle_number || ''}</td>
          <td>${(cert.total_weight || 0).toLocaleString()}</td>
          <td>${cert.total_packages || 0}</td>
          <td>${translateStatus(cert.status)}</td>
        </tr>
      `).join('');

      const printContent = `
        <html dir="rtl">
          <head>
            <title>סיכום תעודות שקילה</title>
            <style>
              body { font-family: Arial, sans-serif; margin: 20px; }
              h1, h2 { text-align: center; }
              table { width: 100%; border-collapse: collapse; margin-top: 20px; }
              th, td { border: 1px solid #ddd; padding: 8px; text-align: right; }
              th { background-color: #f2f2f2; }
              .summary { display: flex; justify-content: space-around; padding: 10px; border: 1px solid #ccc; margin-bottom: 20px; background-color: #fafafa; }
              @media print {
                body { -webkit-print-color-adjust: exact; }
                .no-print { display: none; }
              }
            </style>
          </head>
          <body>
            <h1>סיכום תעודות שקילה</h1>
            ${currentFarm ? `<h2>${currentFarm.name}</h2>` : ''}
            <div class="summary">
              <div><strong>סה"כ תעודות:</strong> ${selected.length}</div>
              <div><strong>סה"כ משקל (ק"ג):</strong> ${totalWeight.toLocaleString()}</div>
              <div><strong>סה"כ אריזות:</strong> ${totalPackages.toLocaleString()}</div>
            </div>
            <table>
              <thead>
                <tr>
                  <th>אסמכתא</th>
                  <th>תאריך</th>
                  <th>לקוח</th>
                  <th>מס' רכב</th>
                  <th>משקל (ק"ג)</th>
                  <th>אריזות</th>
                  <th>סטטוס</th>
                </tr>
              </thead>
              <tbody>
                ${tableRows}
              </tbody>
            </table>
            <div style="text-align: center; margin-top: 20px;" class="no-print">
              <button onclick="window.print()">הדפס</button>
            </div>
          </body>
        </html>
      `;

      printWindow.document.write(printContent);
      printWindow.document.close();
    } catch (error) {
      console.error("Error in bulk print:", error);
      toast({ 
        title: "שגיאה בהדפסה", 
        description: "אירעה שגיאה במהלך הכנת הדוח להדפסה. נסה שוב מאוחר יותר.", 
        variant: "destructive" 
      });
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!formData.customer_id) {
        toast({ title: "שגיאה", description: "יש לבחור לקוח.", variant: "destructive" });
        return;
    }
    if (!currentFarm) {
        toast({ title: "שגיאה", description: "לא נבחר משק פעיל. לא ניתן ליצור תעודה.", variant: "destructive" });
        return;
    }
    
    const selectedCustomer = (customers || []).find(c => c.id === formData.customer_id);

    try {
        const newCertificate = await WeighingCertificate.create({
            ...formData,
            farm_id: currentFarm.id,
            customer_name: selectedCustomer?.name || '', // Ensure customer_name is set
            status: "draft",
            total_weight: 0,
            total_packages: 0,
            total_amount: 0,
            // New fields for delivery note tracking
            delivery_note_issued: false,
            delivery_note_date: null,
        });
        
        toast({ title: "הצלחה!", description: "התעודה נוצרה. כעת תועבר להוספת משטחים." });

        setIsDialogOpen(false);
        resetForm();

        window.location.href = createPageUrl(`WeighingDetail?id=${newCertificate.id}`);
    } catch(error) {
        console.error("Failed to save certificate:", error);
        toast({ title: "שגיאה", description: "שמירת התעודה נכשלה", variant: "destructive" });
    }
  };

  const handleCreateCustomer = async (e) => {
    e.preventDefault();
    
    if (!newCustomerData.name.trim()) {
      toast({ title: "שגיאה", description: "שם לקוח הוא שדה חובה.", variant: "destructive" });
      return;
    }
    if (!currentFarm) {
      toast({ title: "שגיאה", description: "לא ניתן ליצור לקוח ללא משק פעיל.", variant: "destructive" });
      return;
    }

    try {
      const newCustomer = await Customer.create({
        ...newCustomerData,
        farm_id: currentFarm.id
      });
      invalidateList(`customers_${currentFarm.id}`);
      
      const updatedCustomers = [...(Array.isArray(customers) ? customers : []), newCustomer].sort((a,b) => a.name.localeCompare(b.name));
      setCustomers(updatedCustomers);
      setFormData(prev => ({
        ...prev, 
        customer_id: newCustomer.id,
      }));
      
      setNewCustomerData({ name: "", contact_person: "", phone: "", email: "", address: "" });
      setIsCustomerDialogOpen(false);
      
      toast({ title: "הצלחה", description: "לקוח חדש נוצר ונבחר" });
    } catch(err) {
      console.error("Error creating customer:", err);
      toast({ title: "שגיאה", description: "יצירת לקוח נכשלה", variant: "destructive" });
    }
  };

  const resetForm = () => {
    setEditingCertificate(null);
    setFormData({
      date: format(new Date(), "yyyy-MM-dd"), // Keep ISO format for input type="date"
      time: format(new Date(), "HH:mm"),
      customer_id: "",
      customer_name: "",
      vehicle_type: "truck",
      vehicle_number: "",
      driver_name: ""
    });
  };

  const handleCreateNewCertificate = () => {
    resetForm();
    setIsDialogOpen(true);
  };

  const handleEdit = (certificate) => {
    window.location.href = createPageUrl(`WeighingDetail?id=${certificate.id}`);
  };

  const handleDuplicate = (certificate) => {
    setEditingCertificate(null); // Make sure we are in 'create' mode
    setFormData({
      date: format(new Date(), "yyyy-MM-dd"),
      time: format(new Date(), "HH:mm"),
      customer_id: certificate.customer_id,
      vehicle_type: certificate.vehicle_type || "truck",
      vehicle_number: certificate.vehicle_number || "",
      driver_name: certificate.driver_name || ""
    });
    setIsDialogOpen(true);
  };
  
  const handleToggleDeliveryNote = async (certificateId, currentValue) => {
    try {
      await WeighingCertificate.update(certificateId, { 
        delivery_note_issued: !currentValue,
        delivery_note_date: !currentValue ? new Date().toISOString() : null
      });
      toast({ 
        title: "הצלחה", 
        description: !currentValue ? "תעודת משלוח סומנה כהונפקה" : "הסימון בוטל"
      });
      loadData();
    } catch (error) {
      console.error("Error toggling delivery note status:", error);
      toast({ title: "שגיאה", description: "עדכון הסטטוס נכשל", variant: "destructive" });
    }
  };

  // דוח תעודות פתוחות ללקוח: כל התעודות שאינן בארכיון (לא הושלם/נשלח), מקובצות לפי יום עם פריטים
  const buildCustomerReport = async (customerId) => {
    const customer = (customers || []).find(c => c.id === customerId);
    if (!customer || !currentFarm?.id) return;
    setReportBusy(true);
    setReportData(null);
    try {
      const openCerts = (certificates || []).filter(c =>
        c && c.customer_id === customerId && c.status !== 'completed' && c.status !== 'shipped'
      );
      if (openCerts.length === 0) {
        toast({ title: "אין תעודות", description: `אין תעודות פתוחות ללקוח ${customer.name}` });
        return;
      }
      const allItems = await WeighingItem.filter({ farm_id: currentFarm.id });
      const byCert = {};
      (Array.isArray(allItems) ? allItems : []).forEach(it => {
        if (it?.certificate_id) (byCert[it.certificate_id] = byCert[it.certificate_id] || []).push(it);
      });
      const groupsMap = {};
      openCerts
        .slice()
        .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
        .forEach(c => {
          const key = c.date || 'ללא תאריך';
          (groupsMap[key] = groupsMap[key] || []).push({ cert: c, items: byCert[c.id] || [] });
        });
      const groups = Object.entries(groupsMap).map(([date, entries]) => ({ date, entries }));
      const totals = {
        certs: openCerts.length,
        weight: openCerts.reduce((s, c) => s + (parseFloat(c.total_weight) || 0), 0),
        packages: openCerts.reduce((s, c) => s + (parseInt(c.total_packages) || 0), 0),
        amount: openCerts.reduce((s, c) => s + (parseFloat(c.total_amount) || 0), 0),
      };
      setReportData({ customer, groups, totals });
    } catch (error) {
      console.error("Failed to build customer report:", error);
      toast({ title: "שגיאה", description: "הפקת הדוח נכשלה", variant: "destructive" });
    } finally {
      setReportBusy(false);
    }
  };

  const shareReportPdf = async () => {
    const el = reportRef.current;
    if (!el || !reportData) return;
    setReportSharing(true);
    try {
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);
      const canvas = await html2canvas(el, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
      const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
      const pageW = 210, pageH = 297;
      const imgH = canvas.height * pageW / canvas.width;
      const imgData = canvas.toDataURL('image/jpeg', 0.92);
      let offset = 0, page = 0;
      while (offset < imgH) {
        if (page > 0) pdf.addPage();
        pdf.addImage(imgData, 'JPEG', 0, -offset, pageW, imgH);
        offset += pageH;
        page++;
      }
      const fileName = `דוח_תעודות_פתוחות_${reportData.customer.name}.pdf`;
      const blob = pdf.output('blob');
      const file = new File([blob], fileName, { type: 'application/pdf' });
      const text = `דוח תעודות פתוחות — ${reportData.customer.name}\n${reportData.totals.certs} תעודות · ${reportData.totals.weight.toLocaleString()} ק"ג · ₪${reportData.totals.amount.toLocaleString()}`;
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: fileName, text });
          return;
        } catch (err) {
          if (err?.name === 'AbortError') return;
        }
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "הקובץ ירד", description: "צרף את ה-PDF לוואטסאפ או למייל." });
    } catch (error) {
      console.error("Report share failed:", error);
      toast({ title: "שגיאה", description: "שיתוף הדוח נכשל", variant: "destructive" });
    } finally {
      setReportSharing(false);
    }
  };

  const printReport = () => {
    const el = reportRef.current;
    if (!el) return;
    const w = window.open('', '_blank');
    if (!w) {
      toast({ title: "שגיאה", description: "יש לאפשר חלונות קופצים להדפסה", variant: "destructive" });
      return;
    }
    w.document.write(`<html dir="rtl"><head><title>דוח תעודות פתוחות</title></head><body style="margin:0">${el.outerHTML}</body></html>`);
    w.document.close();
    setTimeout(() => { w.focus(); w.print(); }, 300);
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedCertificates(new Set());
  };

  const statusDot = (status) => ({
    draft: "bg-yellow-400",
    completed: "bg-green-500",
    shipped: "bg-blue-500"
  }[status] || "bg-gray-300");

  const formatDayLabel = (dateKey) => {
    const d = parseISO(dateKey);
    if (isToday(d)) return "היום";
    if (isYesterday(d)) return "אתמול";
    return format(d, "EEEE, d בMMMM", { locale: he });
  };

  const translateVehicleType = (type) => ({
    truck: "משאית",
    van: "טנדר",
    pickup: "רכב פתוח",
    trailer: "קרוואן"
  }[type] || type);

  const translateStatus = (status) => ({
    draft: "טיוטה",
    completed: "הושלם",
    shipped: "נשלח"
  }[status] || status);

  const getStatusColor = (status) => ({
    draft: "bg-yellow-100 text-yellow-800",
    completed: "bg-green-100 text-green-800",
    shipped: "bg-blue-100 text-blue-800"
  }[status] || "bg-gray-100 text-gray-800");

  const { filteredCerts, totalCount, timelineData } = useMemo(() => {
    const certsArray = Array.isArray(certificates) ? certificates : [];
    
    const activeCerts = certsArray.filter(cert => {
      if (!cert) return false;
      const isArchived = cert.status === 'completed' || cert.status === 'shipped';
      return showArchived ? isArchived : !isArchived;
    });

    const filtered = activeCerts.filter(cert => {
      if (!cert) return false;
      const statusMatch = filters.status === "all" || cert.status === filters.status;
      const customerMatch = !filters.customer || (cert.customer_name && cert.customer_name.toLowerCase().includes(filters.customer.toLowerCase()));
      const dateFromMatch = !filters.date_from || (cert.date && cert.date >= filters.date_from);
      const dateToMatch = !filters.date_to || (cert.date && cert.date <= filters.date_to);
      
      // New delivery note filter
      const deliveryNoteMatch = filters.delivery_note === "all" ||
        (filters.delivery_note === "issued" && cert.delivery_note_issued) ||
        (filters.delivery_note === "not_issued" && !cert.delivery_note_issued);
      
      return statusMatch && customerMatch && dateFromMatch && dateToMatch && deliveryNoteMatch;
    });
    
    const newTimelineData = {}; 
    filtered.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()) // Sort by date descending
            .forEach(cert => {
      if (!cert?.date) return;
      const dateKey = cert.date; // Use date as key for grouping
      if (!newTimelineData[dateKey]) {
        newTimelineData[dateKey] = [];
      }
      newTimelineData[dateKey].push(cert);
    });

    return { filteredCerts: filtered, totalCount: filtered.length, timelineData: newTimelineData };
  }, [certificates, filters, showArchived]);

  useEffect(() => {
    const fetchSummary = async () => {
        if (!showSalesSummary || !filteredCerts || filteredCerts.length === 0 || !currentFarm?.id) {
            setSalesSummary(null);
            return;
        }
        
        setIsSummaryLoading(true);
        try {
            const certIds = filteredCerts.map(c => c.id);
            
            // Single API call to get all items from the current farm
            const allItems = await WeighingItem.filter({ farm_id: currentFarm.id });
            
            // Filter only items that belong to our filtered certificates
            const relevantItems = allItems.filter(item => 
                item && certIds.includes(item.certificate_id)
            );

            const summaryMap = new Map();

            for (const item of relevantItems) {
                if (!item.product_id) continue;
                
                let entry = summaryMap.get(item.product_id);
                if (!entry) {
                    entry = {
                        product_id: item.product_id,
                        product_name: item.product_name,
                        total_weight: 0,
                        total_packages: 0,
                        total_amount: 0
                    };
                }

                entry.total_weight += item.net_weight || 0;
                entry.total_packages += item.package_count || 0;
                entry.total_amount += item.item_total || 0;
                
                summaryMap.set(item.product_id, entry);
            }
            
            const summaryArray = Array.from(summaryMap.values()).sort((a,b) => b.total_amount - a.total_amount);
            setSalesSummary(summaryArray);

        } catch (error) {
            console.error("Error fetching sales summary:", error);
            toast({ title: "שגיאה", description: "טעינת סיכום מכירות נכשלה", variant: "destructive" });
        } finally {
            setIsSummaryLoading(false);
        }
    };

    // Add a small delay to avoid loading immediately
    const timer = setTimeout(() => {
        fetchSummary();
    }, 300);

    return () => clearTimeout(timer);
  }, [filteredCerts, showSalesSummary, toast, currentFarm]);

  const handleSelectCertificate = (certificateId, isSelected) => {
    const newSelected = new Set(selectedCertificates);
    if (isSelected) {
      newSelected.add(certificateId);
    } else {
      newSelected.delete(certificateId);
    }
    setSelectedCertificates(newSelected);
  };

  const handleSelectAll = (certsInGroup, isSelected) => {
    const newSelected = new Set(selectedCertificates);
    if (isSelected) {
      certsInGroup.forEach(cert => newSelected.add(cert.id));
    } else {
      certsInGroup.forEach(cert => newSelected.delete(cert.id));
    }
    setSelectedCertificates(newSelected);
  };

  const handleBulkStatusChange = async (newStatus) => {
    if (selectedCertificates.size === 0) {
      toast({ title: "שגיאה", description: "לא נבחרו תעודות", variant: "destructive" });
      return;
    }

    try {
      const promises = Array.from(selectedCertificates).map(certId => 
        WeighingCertificate.update(certId, { status: newStatus })
      );
      
      await Promise.all(promises);
      
      toast({ 
        title: "הצלחה", 
        description: `${selectedCertificates.size} תעודות עודכנו לסטטוס: ${translateStatus(newStatus)}` 
      });
      
      setSelectedCertificates(new Set());
      setIsBulkActionsOpen(false);
      loadData();
    } catch (error) {
      console.error("Error updating certificates status:", error);
      toast({ title: "שגיאה", description: "עדכון הסטטוס נכשל", variant: "destructive" });
    }
  };

  const handleBulkDelete = async () => {
    if (selectedCertificates.size === 0) {
      toast({ title: "שגיאה", description: "לא נבחרו תעודות", variant: "destructive" });
      return;
    }

    if (window.confirm(`האם אתה בטוח שברצונך למחוק ${selectedCertificates.size} תעודות? פעולה זו בלתי הפיכה.`)) {
      try {
        const promises = Array.from(selectedCertificates).map(certId => 
          WeighingCertificate.delete(certId)
        );
        
        await Promise.all(promises);
        
        toast({ 
          title: "הצלחה", 
          description: `${selectedCertificates.size} תעודות נמחקו` 
        });
        
        setSelectedCertificates(new Set());
        setIsBulkActionsOpen(false);
        loadData();
      } catch (error) {
        console.error("Error deleting certificates:", error);
        toast({ title: "שגיאה", description: "מחיקת התעודות נכשלה", variant: "destructive" });
      }
    }
  };

  return (
    <div className={`p-4 lg:p-6 ${isMobile && selectMode ? 'pb-32' : ''}`}>
      <div className="max-w-7xl mx-auto space-y-4 sm:space-y-6">
        
        {/* Header and filters */}
        <Card>
          <CardHeader className="pb-3 sm:pb-6 space-y-4">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 sm:gap-4">
              <CardTitle className="text-xl sm:text-2xl">
                  {showArchived ? "ארכיון" : "תעודות שקילה"} ({totalCount})
                  {currentFarm && <span className="hidden sm:inline text-base font-normal text-gray-500 mr-2"> - {currentFarm.name}</span>}
                  {selectedCertificates.size > 0 && (
                    <span className="text-sm font-normal text-blue-600 mr-2">
                      ({selectedCertificates.size} נבחרו)
                    </span>
                  )}
              </CardTitle>

              {/* Desktop actions */}
              <div className="hidden sm:flex gap-2">
                 {selectedCertificates.size > 0 && (
                   <DropdownMenu open={isBulkActionsOpen} onOpenChange={setIsBulkActionsOpen}>
                     <DropdownMenuTrigger asChild>
                       <Button variant="outline">
                         <CheckSquare className="w-4 h-4 ml-2" />
                         פעולות ({selectedCertificates.size})
                       </Button>
                     </DropdownMenuTrigger>
                     <DropdownMenuContent align="end" className="w-48">
                       <DropdownMenuItem onClick={() => handleBulkStatusChange("draft")}>
                         עדכן לטיוטה
                       </DropdownMenuItem>
                       <DropdownMenuItem onClick={() => handleBulkStatusChange("completed")}>
                         עדכן להושלם
                       </DropdownMenuItem>
                       <DropdownMenuItem onClick={() => handleBulkStatusChange("shipped")}>
                         עדכן לנשלח
                       </DropdownMenuItem>
                       <DropdownMenuItem onClick={() => handleBulkPrint()}> {/* Call with default selectedCertificates */}
                         <Printer className="w-4 h-4 ml-2" />
                         הדפס סיכום
                       </DropdownMenuItem>
                       <DropdownMenuItem onClick={handleBulkShare} disabled={isSharing}>
                         {isSharing
                           ? <Loader2 className="w-4 h-4 ml-2 animate-spin" />
                           : <Share2 className="w-4 h-4 ml-2" />}
                         שתף תעודות
                       </DropdownMenuItem>
                       <DropdownMenuItem onClick={handleBulkDelete} className="text-red-600">
                         מחק תעודות
                       </DropdownMenuItem>
                     </DropdownMenuContent>
                   </DropdownMenu>
                 )}
                 <Button variant="outline" onClick={() => { setReportOpen(true); setReportData(null); }}>
                    <FileText className="w-4 h-4 ml-2" />
                    דוח לקוח
                 </Button>
                 <Button variant="outline" onClick={() => setShowSalesSummary(prev => !prev)}>
                    <PieChart className="w-4 h-4 ml-2" />
                    סיכום מכירות
                 </Button>
                 <Button variant="outline" onClick={() => setShowArchived(prev => !prev)}>
                    <Archive className="w-4 h-4 ml-2" />
                    {showArchived ? "תעודות פתוחות" : "ארכיון"}
                 </Button>
                 <Button onClick={handleCreateNewCertificate}>
                    <Plus className="w-4 h-4 ml-2" />
                    תעודה חדשה
                 </Button>
              </div>

              {/* בנייד: כפתור דוח לקוח קומפקטי */}
              <Button
                variant="outline"
                size="sm"
                className="sm:hidden w-full h-9"
                onClick={() => { setReportOpen(true); setReportData(null); }}
              >
                <FileText className="w-4 h-4 ml-2" />
                דוח תעודות פתוחות ללקוח
              </Button>

              {/* בנייד הפעולות עברו לבר התחתון; נשאר רק חיווי מצב בחירה */}
              {selectMode && (
                <div className="flex sm:hidden items-center justify-between w-full text-sm text-blue-700 bg-blue-50 border border-blue-200 rounded-xl px-3 py-2">
                  <span className="font-medium">מצב בחירה — הקש על תעודות לסימון</span>
                  <button onClick={exitSelectMode} className="font-semibold">סיום</button>
                </div>
              )}
            </div>
            
            {/* Mobile filters toggle */}
            <div className="sm:hidden pt-3 border-t">
              <button
                onClick={() => setFiltersOpen(o => !o)}
                className="w-full flex items-center justify-between px-3 py-2 rounded-xl bg-gray-100 border border-gray-200 text-sm font-medium text-gray-700"
              >
                <div className="flex items-center gap-2">
                  <SlidersHorizontal className="w-4 h-4 text-gray-500" />
                  <span>
                    סינון
                    {filters.status !== 'all' && <span className="mr-1 text-blue-600">· {filters.status === 'draft' ? 'טיוטה' : filters.status === 'completed' ? 'הושלם' : 'נשלח'}</span>}
                    {filters.customer && <span className="mr-1 text-blue-600">· {filters.customer}</span>}
                    {filters.date_from && <span className="mr-1 text-blue-600">· {filters.date_from}</span>}
                  </span>
                </div>
                {filtersOpen ? <ChevronUp className="w-4 h-4 text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-500" />}
              </button>
              {filtersOpen && (
                <div className="mt-2 p-3 rounded-xl bg-white border border-gray-200 space-y-3">
                  <div>
                    <Label className="text-sm">לקוח</Label>
                    <Input value={filters.customer} onChange={e => setFilters({...filters, customer: e.target.value})} placeholder="חיפוש לקוח..." className="h-9 mt-1" />
                  </div>
                  <div>
                    <Label className="text-sm">סטטוס</Label>
                    <Select value={filters.status} onValueChange={value => { setFilters({...filters, status: value}); setFiltersOpen(false); }}>
                      <SelectTrigger className="h-9 mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">כל הסטטוסים</SelectItem>
                        <SelectItem value="draft">טיוטה</SelectItem>
                        <SelectItem value="completed">הושלם</SelectItem>
                        <SelectItem value="shipped">נשלח</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-sm">תעודת משלוח</Label>
                    <Select value={filters.delivery_note} onValueChange={value => { setFilters({...filters, delivery_note: value}); setFiltersOpen(false); }}>
                      <SelectTrigger className="h-9 mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">הכל</SelectItem>
                        <SelectItem value="not_issued">טרם הונפקה</SelectItem>
                        <SelectItem value="issued">הונפקה</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-sm">מתאריך</Label>
                      <Input type="date" value={filters.date_from} onChange={e => setFilters({...filters, date_from: e.target.value})} className="h-9 mt-1" />
                    </div>
                    <div>
                      <Label className="text-sm">עד תאריך</Label>
                      <Input type="date" value={filters.date_to} onChange={e => setFilters({...filters, date_to: e.target.value})} className="h-9 mt-1" />
                    </div>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => { setFilters({status: "all", customer: "", date_from: "", date_to: "", delivery_note: "all"}); setFiltersOpen(false); }} className="w-full h-9">
                    <X className="w-4 h-4 ml-2" /> נקה מסננים
                  </Button>
                </div>
              )}
            </div>

            {/* Desktop filters - always visible */}
            <div className="hidden sm:grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3 pt-4 border-t">
              <div>
                <Label className="text-sm">לקוח</Label>
                <Input
                  value={filters.customer}
                  onChange={e => setFilters({...filters, customer: e.target.value})}
                  placeholder="חיפוש לקוח..."
                  className="h-9"
                />
              </div>
              <div>
                <Label className="text-sm">סטטוס</Label>
                <Select value={filters.status} onValueChange={value => setFilters({...filters, status: value})}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">כל הסטטוסים</SelectItem>
                    <SelectItem value="draft">טיוטה</SelectItem>
                    <SelectItem value="completed">הושלם</SelectItem>
                    <SelectItem value="shipped">נשלח</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-sm">תעודת משלוח</Label>
                <Select value={filters.delivery_note} onValueChange={value => setFilters({...filters, delivery_note: value})}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">הכל</SelectItem>
                    <SelectItem value="not_issued">טרם הונפקה</SelectItem>
                    <SelectItem value="issued">הונפקה</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-sm">מתאריך</Label>
                <Input
                  type="date"
                  value={filters.date_from}
                  onChange={e => setFilters({...filters, date_from: e.target.value})}
                  className="h-9"
                />
              </div>
              <div>
                <Label className="text-sm">עד תאריך</Label>
                <Input
                  type="date"
                  value={filters.date_to}
                  onChange={e => setFilters({...filters, date_to: e.target.value})}
                  className="h-9"
                />
              </div>
              <div className="flex items-end">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setFilters({status: "all", customer: "", date_from: "", date_to: "", delivery_note: "all"})}
                  className="w-full h-9"
                >
                  <X className="w-4 h-4 ml-2" />
                  נקה מסננים
                </Button>
              </div>
            </div>
          </CardHeader>
        </Card>
        
        {/* Summary cards - DESKTOP ONLY */}
        {!isMobile && (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">תעודות פעילות</CardTitle>
                <FileText className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{totalCount}</div>
                <p className="text-xs text-muted-foreground">תעודות בטיפול</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">משקל כולל</CardTitle>
                <Scale className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {filteredCerts.reduce((sum, cert) => sum + (cert.total_weight || 0), 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} ק"ג
                </div>
                <p className="text-xs text-muted-foreground">נטו</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">סה"כ לתשלום</CardTitle>
                <PieChart className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  ₪{filteredCerts.reduce((sum, cert) => sum + (cert.total_amount || 0), 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
                <p className="text-xs text-muted-foreground">סכום כולל</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">ללא ת. משלוח</CardTitle>
                <Truck className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {filteredCerts.filter(c => !c.delivery_note_issued).length}
                </div>
                <p className="text-xs text-muted-foreground">ממתינות</p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Sales summary section */}
        <Collapsible open={showSalesSummary}>
          <CollapsibleContent>
            <Card>
              <CardHeader>
                <div className="flex justify-between items-center">
                  <CardTitle className="text-lg">סיכום מכירות</CardTitle>
                  <Button variant="ghost" size="sm" onClick={() => setShowSalesSummary(false)}>
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {isSummaryLoading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin" />
                  </div>
                ) : salesSummary && salesSummary.length > 0 ? (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>מוצר</TableHead>
                          <TableHead className="text-center">משקל (ק"ג)</TableHead>
                          <TableHead className="text-center">אריזות</TableHead>
                          <TableHead className="text-center">סכום (₪)</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {salesSummary.map((item, idx) => (
                          <TableRow key={idx}>
                            <TableCell className="font-medium">{item.product_name}</TableCell>
                            <TableCell className="text-center">{item.total_weight.toLocaleString(undefined, { maximumFractionDigits: 2 })}</TableCell>
                            <TableCell className="text-center">{item.total_packages || 0}</TableCell>
                            <TableCell className="text-center">₪{item.total_amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                      <TableFooter>
                          <TableRow className="bg-gray-50 font-bold">
                              <TableCell>סה"כ</TableCell>
                              <TableCell className="text-center">{salesSummary.reduce((sum, item) => sum + item.total_weight, 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</TableCell>
                              <TableCell className="text-center">{salesSummary.reduce((sum, item) => sum + item.total_packages, 0).toLocaleString()}</TableCell>
                              <TableCell className="text-center">₪{salesSummary.reduce((sum, item) => sum + item.total_amount, 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                          </TableRow>
                      </TableFooter>
                    </Table>
                  </div>
                ) : (
                  <p className="text-center text-gray-500 py-4">אין נתונים להצגה</p>
                )}
              </CardContent>
            </Card>
          </CollapsibleContent>
        </Collapsible>

        {/* Timeline view */}
        {!showSalesSummary && totalCount > 0 && (
          <div className="space-y-4">
            {Object.entries(timelineData).map(([dateKey, certs]) => (
              isMobile ? (
                <div key={dateKey}>
                  {/* כותרת יום קומפקטית */}
                  <div className="flex items-baseline justify-between px-1 mb-2">
                    <h3 className="text-sm font-bold text-gray-800">{formatDayLabel(dateKey)}</h3>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-500 tabular-nums">
                        {certs.length} · {certs.reduce((sum, c) => sum + (c.total_weight || 0), 0).toLocaleString(undefined, { maximumFractionDigits: 0 })} ק"ג
                      </span>
                      {selectMode && (
                        <button
                          onClick={() => handleSelectAll(certs, !certs.every(c => selectedCertificates.has(c.id)))}
                          className="text-xs font-medium text-blue-600"
                        >
                          {certs.every(c => selectedCertificates.has(c.id)) ? "בטל הכל" : "בחר הכל"}
                        </button>
                      )}
                    </div>
                  </div>
                  {/* כרטיסי תעודות */}
                  <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden divide-y divide-gray-100 shadow-sm">
                    {certs.map((cert) => {
                      const isSelected = selectedCertificates.has(cert.id);
                      return (
                        <div
                          key={cert.id}
                          onClick={() => {
                            if (selectMode) {
                              handleSelectCertificate(cert.id, !isSelected);
                            } else {
                              window.location.href = createPageUrl(`WeighingDetail?id=${cert.id}`);
                            }
                          }}
                          className={`flex items-center gap-3 px-4 py-3.5 cursor-pointer transition-colors active:bg-gray-100 ${isSelected ? 'bg-blue-50' : ''}`}
                        >
                          {selectMode && (
                            <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${isSelected ? 'bg-blue-600 border-blue-600' : 'border-gray-300 bg-white'}`}>
                              {isSelected && <Check className="w-4 h-4 text-white" />}
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="font-semibold text-gray-900 truncate">{cert.customer_name || 'ללא שם'}</span>
                              {cert.delivery_note_issued && <CheckCircle2 className="w-3.5 h-3.5 text-green-600 shrink-0" />}
                            </div>
                            <div className="flex items-center gap-1.5 text-xs text-gray-500 mt-1">
                              <span className={`w-2 h-2 rounded-full shrink-0 ${statusDot(cert.status)}`} />
                              <span>{translateStatus(cert.status)}</span>
                              <span className="text-gray-300">·</span>
                              <span className="font-mono">#{cert.id?.slice(-5)}</span>
                            </div>
                          </div>
                          <div className="text-left shrink-0">
                            <div className="font-bold text-gray-900 tabular-nums">
                              {(cert.total_weight || 0).toLocaleString(undefined, { maximumFractionDigits: 1 })}
                              <span className="text-xs font-normal text-gray-400"> ק"ג</span>
                            </div>
                            {(cert.total_amount || 0) > 0 && (
                              <div className="text-xs text-gray-500 tabular-nums">₪{(cert.total_amount || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
                            )}
                          </div>
                          {!selectMode && (
                            <div onClick={(e) => e.stopPropagation()} className="shrink-0">
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-9 w-9 text-gray-400">
                                    <MoreVertical className="w-5 h-5" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem onClick={() => shareCertificatePdf(cert)} disabled={isSharing}>
                                    {isSharing
                                      ? <Loader2 className="w-4 h-4 ml-2 animate-spin" />
                                      : <Share2 className="w-4 h-4 ml-2" />}
                                    שתף
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => handleToggleDeliveryNote(cert.id, cert.delivery_note_issued)}>
                                    {cert.delivery_note_issued ? (
                                      <><X className="w-4 h-4 ml-2" />בטל תעודת משלוח</>
                                    ) : (
                                      <><CheckCircle2 className="w-4 h-4 ml-2" />סמן כהונפקה</>
                                    )}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => handleDuplicate(cert)}>
                                    <Copy className="w-4 h-4 ml-2" />
                                    שכפל
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem onClick={() => handleDelete(cert.id)} className="text-red-600">
                                    <Trash2 className="w-4 h-4 ml-2" />
                                    מחק
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <Card key={dateKey}>
                  <CardHeader className="pb-3 bg-gray-50">
                    <div className="flex justify-between items-center">
                      <div>
                        <CardTitle className="text-base sm:text-lg">
                          {format(parseISO(dateKey), 'EEEE, d בMMMM yyyy', { locale: he })}
                        </CardTitle>
                        <p className="text-xs sm:text-sm text-muted-foreground mt-1">
                          {certs.length} תעודות • 
                          {' '}{certs.reduce((sum, c) => sum + (c.total_weight || 0), 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} ק"ג נטו
                        </p>
                      </div>
                      {!isMobile && certs.length > 0 && (
                        <Button 
                          variant="outline" 
                          size="sm"
                          onClick={() => handleBulkPrint(certs.map(c => c.id))}
                        >
                          <Printer className="w-4 h-4 ml-2" />
                          הדפס הכל ({certs.length})
                        </Button>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-6 px-2 text-right">
                            <input
                              type="checkbox"
                              checked={certs.length > 0 && certs.every(cert => selectedCertificates.has(cert.id))}
                              onChange={(e) => handleSelectAll(certs, e.target.checked)}
                              className="w-4 h-4"
                            />
                          </TableHead>
                          <TableHead className="w-[100px] hidden sm:table-cell">מספר</TableHead>
                          <TableHead>לקוח</TableHead>
                          <TableHead className="text-center hidden sm:table-cell">משקל</TableHead>
                          <TableHead className="text-center hidden md:table-cell">אריזות</TableHead>
                          <TableHead className="text-center hidden lg:table-cell">סכום</TableHead>
                          <TableHead className="text-center hidden sm:table-cell">סטטוס</TableHead>
                          <TableHead className="text-center w-[100px]">פעולות</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {certs.map((cert) => (
                          <TableRow key={cert.id} className="hover:bg-gray-50">
                            <TableCell className="w-6 px-2 text-right">
                              <input
                                type="checkbox"
                                checked={selectedCertificates.has(cert.id)}
                                onChange={(e) => handleSelectCertificate(cert.id, e.target.checked)}
                                className="w-4 h-4"
                              />
                            </TableCell>
                            <TableCell className="font-medium hidden sm:table-cell">
                              #{cert.id?.slice(-5)}
                            </TableCell>
                            <TableCell>
                              <div>
                                <div className="font-medium">{cert.customer_name || 'ללא שם'}</div>
                                <div className="sm:hidden text-xs text-muted-foreground mt-1">
                                  {cert.total_weight?.toLocaleString(undefined, { maximumFractionDigits: 2 }) || 0} ק"ג
                                  {cert.delivery_note_issued && (
                                    <CheckCircle2 className="inline w-3 h-3 text-green-600 mr-1" title="הונפקה תעודת משלוח" />
                                  )}
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="text-center hidden sm:table-cell">
                              {cert.total_weight?.toLocaleString(undefined, { maximumFractionDigits: 2 }) || 0} ק"ג
                            </TableCell>
                            <TableCell className="text-center hidden md:table-cell">
                              {cert.total_packages || 0}
                            </TableCell>
                            <TableCell className="text-center hidden lg:table-cell">
                              ₪{cert.total_amount?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || 0}
                            </TableCell>
                            <TableCell className="text-center hidden sm:table-cell">
                              <div className="flex items-center justify-center gap-2">
                                <Badge className={getStatusColor(cert.status)}>
                                  {translateStatus(cert.status)}
                                </Badge>
                                {cert.delivery_note_issued && (
                                  <CheckCircle2 className="w-4 h-4 text-green-600" title="הונפקה תעודת משלוח" />
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="sm">
                                    ⋮
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem asChild>
                                    <Link to={createPageUrl("WeighingDetail") + `?id=${cert.id}`}>
                                      <Eye className="w-4 h-4 ml-2" />
                                      צפייה/עריכה
                                    </Link>
                                  </DropdownMenuItem>
                                  <DropdownMenuItem 
                                    onClick={() => handleToggleDeliveryNote(cert.id, cert.delivery_note_issued)}
                                  >
                                    {cert.delivery_note_issued ? (
                                      <>
                                        <X className="w-4 h-4 ml-2" />
                                        בטל תעודת משלוח
                                      </>
                                    ) : (
                                      <>
                                        <CheckCircle2 className="w-4 h-4 ml-2" />
                                        סמן כהונפקה
                                      </>
                                    )}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => handleDuplicate(cert)}>
                                    <Copy className="w-4 h-4 ml-2" />
                                    שכפל
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => shareCertificatePdf(cert)} disabled={isSharing}>
                                    {isSharing
                                      ? <Loader2 className="w-4 h-4 ml-2 animate-spin" />
                                      : <Share2 className="w-4 h-4 ml-2" />}
                                    שתף
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem 
                                    onClick={() => handleDelete(cert.id)}
                                    className="text-red-600"
                                  >
                                    <Trash2 className="w-4 h-4 ml-2" />
                                    מחק
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              )
            ))}
          </div>
        )}

        {!showSalesSummary && totalCount === 0 && (
          <Card>
            <CardContent className="text-center py-12">
              <FileText className="w-12 h-12 mx-auto text-gray-400 mb-4" />
              <h3 className="text-lg font-semibold mb-2">אין תעודות</h3>
              <p className="text-muted-foreground">לא נמצאו תעודות התואמות את הסינון</p>
              {!showArchived && (
                <div className="text-center p-6">
                    <p className="text-gray-500 mb-4">צור תעודת שקילה ראשונה כדי להתחיל</p>
                    <Button onClick={handleCreateNewCertificate}>
                      <Plus className="w-4 h-4 ml-2" />
                      צור תעודת שקילה חדשה
                    </Button>
                  </div>
              )}
            </CardContent>
          </Card>
        )}

      </div>

      {/* סרגל פעולות תחתון במצב בחירה (נייד) — מעל ה-BottomNav */}
      {isMobile && selectMode && (
        <div className="fixed bottom-16 inset-x-0 z-40 bg-white/95 backdrop-blur border-t px-3 py-2.5 flex items-center gap-2 shadow-[0_-4px_12px_rgba(0,0,0,0.08)]">
          <span className="text-sm font-semibold text-gray-800 whitespace-nowrap">{selectedCertificates.size} נבחרו</span>
          <div className="flex gap-1.5 mr-auto">
            <Button size="sm" variant="outline" className="h-10 px-3.5" title="שתף"
              disabled={selectedCertificates.size === 0 || isSharing} onClick={handleBulkShare}>
              {isSharing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Share2 className="w-4 h-4" />}
            </Button>
            <Button size="sm" variant="outline" className="h-10 px-3.5" title="הדפס סיכום"
              disabled={selectedCertificates.size === 0} onClick={() => handleBulkPrint()}>
              <Printer className="w-4 h-4" />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" className="h-10 px-3.5" title="שנה סטטוס"
                  disabled={selectedCertificates.size === 0}>
                  <CheckCircle2 className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" side="top">
                <DropdownMenuItem onClick={() => handleBulkStatusChange("completed")}>סמן הושלם</DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleBulkStatusChange("shipped")}>סמן נשלח</DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleBulkStatusChange("draft")}>החזר לטיוטה</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button size="sm" variant="outline" className="h-10 px-3.5 text-red-600" title="מחק"
              disabled={selectedCertificates.size === 0} onClick={handleBulkDelete}>
              <Trash2 className="w-4 h-4" />
            </Button>
            <Button size="sm" variant="ghost" className="h-10 px-3" onClick={exitSelectMode} title="סגור">
              <X className="w-5 h-5" />
            </Button>
          </div>
        </div>
      )}

      {/* Simplified New certificate dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className={isMobile ? "w-[95vw] max-w-[95vw]" : "sm:max-w-lg"} dir="rtl">
          <DialogHeader>
            <DialogTitle>תעודת שקילה חדשה</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 pt-4">
              {isMobile ? (
                // Mobile - simplified version with only essentials
                <>
                  <div>
                    <Label className="text-base font-semibold">לקוח *</Label>
                    <div className="flex gap-2 mt-1">
                      <Select
                        value={formData.customer_id}
                        onValueChange={(value) => setFormData(prev => ({...prev, customer_id: value}))}
                        required
                      >
                        <SelectTrigger className="flex-1">
                          <SelectValue placeholder="בחר לקוח..." />
                        </SelectTrigger>
                        <SelectContent>
                          {(customers || []).map(customer => (
                            <SelectItem key={customer.id} value={customer.id}>
                              {customer.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button 
                        type="button" 
                        variant="outline"
                        size="icon"
                        onClick={() => setIsCustomerDialogOpen(true)}
                        title="לקוח חדש"
                      >
                        <UserPlus className="w-4 h-4"/>
                      </Button>
                    </div>
                  </div>

                  <div className="text-xs text-gray-500 bg-blue-50 p-3 rounded">
                    💡 פרטים נוספים (תאריך, רכב, נהג) ניתן להוסיף מאוחר יותר בעמוד התעודה
                  </div>
                </>
              ) : (
                // Desktop - full version with all fields
                <>
                  <div className="grid grid-cols-2 gap-4">
                      <div>
                          <Label>תאריך</Label>
                          <Input 
                            type="date" 
                            value={formData.date} 
                            onChange={e => setFormData({...formData, date: e.target.value})} 
                            required 
                          />
                      </div>
                      <div>
                          <Label>שעת הפקה</Label>
                          <Input 
                            type="time" 
                            value={formData.time} 
                            onChange={e => setFormData({...formData, time: e.target.value})}
                          />
                      </div>
                  </div>

                  <div>
                      <div className="flex justify-between items-center mb-1">
                          <Label>שם הלקוח</Label>
                          <Button 
                            type="button" 
                            variant="link" 
                            className="p-0 h-auto"
                            onClick={() => setIsCustomerDialogOpen(true)}
                          >
                            <UserPlus className="w-3 h-3 ml-1"/>
                            לקוח חדש
                          </Button>
                      </div>
                      <Select
                        value={formData.customer_id}
                        onValueChange={(value) => setFormData(prev => ({...prev, customer_id: value}))}
                        required
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="בחר לקוח..." />
                        </SelectTrigger>
                        <SelectContent>
                          {(customers || []).map(customer => (
                              <SelectItem key={customer.id} value={customer.id}>
                               {customer.name}
                             </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                      <div>
                          <Label>סוג רכב</Label>
                          <Select value={formData.vehicle_type} onValueChange={v => setFormData({...formData, vehicle_type: v})}>
                              <SelectTrigger><SelectValue /></SelectTrigger>
                              <SelectContent>
                                  <SelectItem value="truck">משאית</SelectItem>
                                  <SelectItem value="van">טנדר</SelectItem>
                                  <SelectItem value="pickup">רכב פתוח</SelectItem>
                                  <SelectItem value="trailer">קרוואן</SelectItem>
                              </SelectContent>
                          </Select>
                      </div>
                      <div>
                          <Label>מספר רכב</Label>
                          <Input 
                            value={formData.vehicle_number} 
                            onChange={e => setFormData({...formData, vehicle_number: e.target.value})}
                          />
                      </div>
                  </div>

                  <div>
                    <Label>שם הנהג</Label>
                    <Input 
                      value={formData.driver_name} 
                      onChange={e => setFormData({...formData, driver_name: e.target.value})}
                    />
                  </div>
                </>
              )}
            
            <DialogFooter className="pt-4">
              <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                ביטול
              </Button>
              <Button type="submit" className="bg-blue-600 hover:bg-blue-700">
                {isMobile ? "המשך" : "צור והמשך"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* פריסת תעודה נסתרת לצילום PDF בעת שיתוף */}
      {shareLayoutElement}

      {/* דוח תעודות פתוחות ללקוח */}
      <Dialog open={reportOpen} onOpenChange={(open) => { if (!open) { setReportOpen(false); setReportData(null); } }}>
        <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle>דוח תעודות פתוחות ללקוח</DialogTitle>
          </DialogHeader>

          {/* בחירת לקוח */}
          <div>
            <Label className="text-sm font-semibold">בחר לקוח</Label>
            <div className="flex flex-wrap gap-2 mt-2">
              {(customers || []).map(c => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => buildCustomerReport(c.id)}
                  className={`px-3 py-2 rounded-xl border text-sm font-medium transition-colors ${reportData?.customer?.id === c.id ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-700 border-gray-200 hover:border-gray-300'}`}
                >
                  {c.name}
                </button>
              ))}
              {(customers || []).length === 0 && <span className="text-sm text-gray-400">אין לקוחות מוגדרים</span>}
            </div>
          </div>

          {reportBusy && (
            <div className="flex justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
            </div>
          )}

          {reportData && !reportBusy && (
            <>
              <div className="flex gap-2">
                <Button onClick={shareReportPdf} disabled={reportSharing} className="flex-1 sm:flex-initial">
                  {reportSharing ? <Loader2 className="w-4 h-4 ml-2 animate-spin" /> : <Share2 className="w-4 h-4 ml-2" />}
                  שתף PDF
                </Button>
                <Button variant="outline" onClick={printReport} className="flex-1 sm:flex-initial">
                  <Printer className="w-4 h-4 ml-2" />
                  הדפס
                </Button>
              </div>

              {/* תצוגה מקדימה — היא גם מה שמצולם ל-PDF ומודפס */}
              <div className="border rounded-xl overflow-x-auto bg-white">
                <div style={{ minWidth: '640px' }} ref={reportRef}>
                  <CustomerOpenReportLayout
                    customer={reportData.customer}
                    groups={reportData.groups}
                    totals={reportData.totals}
                    farmName={currentFarm?.name}
                  />
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* New customer dialog */}
      <Dialog open={isCustomerDialogOpen} onOpenChange={setIsCustomerDialogOpen}>
        <DialogContent className="sm:max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle>לקוח חדש</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateCustomer} className="space-y-4 pt-4">
            <div>
              <Label>שם הלקוח *</Label>
              <Input 
                value={newCustomerData.name}
                onChange={e => setNewCustomerData({...newCustomerData, name: e.target.value})}
                placeholder="שם הלקוח"
                required
              />
            </div>
            <div>
              <Label>איש קשר</Label>
              <Input 
                value={newCustomerData.contact_person}
                onChange={e => setNewCustomerData({...newCustomerData, contact_person: e.target.value})}
              />
            </div>
            <div>
              <Label>טלפון</Label>
              <Input 
                value={newCustomerData.phone}
                onChange={e => setNewCustomerData({...newCustomerData, phone: e.target.value})}
              />
            </div>
            <div>
              <Label>אימייל</Label>
              <Input 
                type="email"
                value={newCustomerData.email}
                onChange={e => setNewCustomerData({...newCustomerData, email: e.target.value})}
              />
            </div>
            <div>
              <Label>כתובת</Label>
              <Input 
                value={newCustomerData.address}
                onChange={e => setNewCustomerData({...newCustomerData, address: e.target.value})}
              />
            </div>
            <DialogFooter className="pt-4">
              <Button type="button" variant="outline" onClick={() => setIsCustomerDialogOpen(false)}>
                ביטול
              </Button>
              <Button type="submit">
                צור לקוח
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
