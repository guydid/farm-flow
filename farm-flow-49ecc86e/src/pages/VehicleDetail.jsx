
import React, { useState, useEffect, useMemo, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Vehicle, VehicleTreatment, User, Farm, Invoice } from "@/entities/all";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { format, parseISO } from "date-fns";
import { ArrowRight, Loader2, Edit, Trash2, Plus, Wrench, FileText, Upload, Receipt } from "lucide-react";
import { createPageUrl } from "@/utils";
import { Badge } from "@/components/ui/badge";
import { UploadPrivateFile, CreateFileSignedUrl } from "@/integrations/Core";
import { getToken } from "@/api/localClient";

// מוסיף טוקן לקבצי /uploads כדי שהשרת יאמת את הבקשה הסטטית
function withToken(url) {
  if (!url) return url;
  try {
    const u = new URL(url, window.location.origin);
    if (u.pathname.startsWith("/uploads")) { u.searchParams.set("token", getToken() || ""); return u.toString(); }
    return url;
  } catch { return url; }
}

const vehicleTypeTranslations = {
    tractor: "טרקטור", private_car: "רכב פרטי", truck: "משאית", harvester: "קומביין", sprayer: "מרסס", forklift: "מלגזה", other: "אחר"
};

const statusTranslations = {
    active: "פעיל", in_service: "בטיפול", sold: "נמכר", out_of_order: "מושבת"
};

// מד הרכב: רכב/משאית בק"מ, מכונות חקלאיות בשעות מנוע
const METER_UNITS = { km: 'ק"מ', hours: 'שעות מנוע' };
const defaultMeterUnit = (vehicleType) => (vehicleType === 'private_car' || vehicleType === 'truck') ? 'km' : 'hours';

// סטטוס תפוגה לפי תאריך סיום: פג / פג בקרוב (30 יום) / תקין
function expiryStatus(dateStr) {
    if (!dateStr) return null;
    let d;
    try { d = parseISO(dateStr); } catch { return null; }
    if (isNaN(d?.getTime?.())) return null;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const days = Math.round((d - today) / (1000 * 60 * 60 * 24));
    if (days < 0) return { kind: 'expired', label: 'פג', variant: 'destructive', days };
    if (days <= 30) return { kind: 'soon', label: `פג בעוד ${days} ימים`, className: 'bg-amber-100 text-amber-800 border-amber-300', days };
    return { kind: 'ok', label: 'בתוקף', className: 'bg-green-100 text-green-800 border-green-300', days };
}

function ExpiryBadge({ dateStr }) {
    const st = expiryStatus(dateStr);
    if (!st) return null;
    if (st.variant) return <Badge variant={st.variant} className="text-xs">{st.label}</Badge>;
    return <Badge variant="outline" className={`text-xs ${st.className}`}>{st.label}</Badge>;
}

export default function VehicleDetail() {
    const navigate = useNavigate();
    const { toast } = useToast();
    const [vehicle, setVehicle] = useState(null);
    const [treatments, setTreatments] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isTreatmentFormOpen, setIsTreatmentFormOpen] = useState(false);
    const [treatmentFormData, setTreatmentFormData] = useState({});
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [selectedFile, setSelectedFile] = useState(null);
    const [editingTreatment, setEditingTreatment] = useState(null);
    const [invoices, setInvoices] = useState([]);

    const vehicleId = useMemo(() => new URLSearchParams(window.location.search).get("id"), []);

    const loadData = useCallback(async () => {
        if (!vehicleId) {
            setIsLoading(false);
            return;
        }
        setIsLoading(true);
        try {
            const vehicleData = await Vehicle.get(vehicleId);
            const [treatmentsData, invoicesData] = await Promise.all([
                VehicleTreatment.filter({ vehicle_id: vehicleId }, "-treatment_date"),
                Invoice.filter({ farm_id: vehicleData.farm_id }).catch(() => []),
            ]);
            setVehicle(vehicleData);
            setTreatments(Array.isArray(treatmentsData) ? treatmentsData : []);
            setInvoices(Array.isArray(invoicesData) ? invoicesData : []);
        } catch (error) {
            console.error("Error loading vehicle details:", error);
            toast({ title: "שגיאה", description: "טעינת פרטי הרכב נכשלה.", variant: "destructive" });
        } finally {
            setIsLoading(false);
        }
    }, [vehicleId, toast]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const handleDeleteVehicle = async () => {
        if (window.confirm("האם אתה בטוח שברצונך למחוק רכב זה וכל הטיפולים המשויכים אליו?")) {
            try {
                await Promise.all(treatments.map(t => VehicleTreatment.delete(t.id)));
                await Vehicle.delete(vehicleId);
                toast({ title: "הצלחה", description: "הרכב נמחק." });
                navigate(createPageUrl("Vehicles"));
            } catch (error) {
                toast({ title: "שגיאה", description: "מחיקת הרכב נכשלה.", variant: "destructive" });
            }
        }
    };

    const handleOpenTreatmentForm = (treatment = null) => {
        setEditingTreatment(treatment);
        if (treatment) {
            setTreatmentFormData({
                ...treatment,
                treatment_date: treatment.treatment_date ? format(parseISO(treatment.treatment_date), 'yyyy-MM-dd') : '',
                meter_unit: treatment.meter_unit || defaultMeterUnit(vehicle?.vehicle_type),
            });
        } else {
            setTreatmentFormData({
                treatment_date: format(new Date(), 'yyyy-MM-dd'),
                description: '',
                cost: '',
                service_provider: '',
                notes: '',
                invoice_url: '',
                meter_reading: '',
                meter_unit: defaultMeterUnit(vehicle?.vehicle_type),
            });
        }
        setSelectedFile(null);
        setIsTreatmentFormOpen(true);
    };

    const handleTreatmentFormChange = (e) => {
        const { name, value } = e.target;
        setTreatmentFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleFileChange = (e) => {
        if (e.target.files.length > 0) {
            setSelectedFile(e.target.files[0]);
            setTreatmentFormData(prev => ({ ...prev, invoice_id: '' })); // ביטול חשבונית מקושרת
        }
    };

    // תווית חשבונית לרשימת הבחירה
    const invoiceLabel = (inv) => {
        const parts = [inv.supplier_name || 'ספק'];
        if (inv.invoice_number) parts.push(`מס׳ ${inv.invoice_number}`);
        if (inv.total != null) parts.push(`${inv.total}₪`);
        if (inv.date) parts.push(inv.date);
        return parts.join(' · ');
    };

    // בחירת חשבונית קיימת מהרשימה — מקשר ומאכלס שדות אם ריקים
    const handlePickInvoice = (invId) => {
        if (invId === '__none__') {
            setTreatmentFormData(prev => ({ ...prev, invoice_id: '', invoice_url: '' }));
            return;
        }
        const inv = invoices.find(i => i.id === invId);
        if (!inv) return;
        setSelectedFile(null); // מבטל העלאת קובץ אם נבחרה חשבונית
        setTreatmentFormData(prev => ({
            ...prev,
            invoice_id: invId,
            invoice_url: inv.pdf_url || inv.file_url || '',
            cost: prev.cost || (inv.total != null ? String(inv.total) : ''),
            service_provider: prev.service_provider || inv.supplier_name || '',
        }));
    };

    const handleTreatmentFormSubmit = async (e) => {
        e.preventDefault();
        setIsSubmitting(true);
        
        let finalData = { ...treatmentFormData };

        if (selectedFile) {
            setIsUploading(true);
            try {
                const up = await UploadPrivateFile({ file: selectedFile });
                finalData.invoice_url = up.file_url || up.file_uri || '';
                finalData.invoice_id = ''; // קובץ שהועלה — לא חשבונית מקושרת
            } catch (error) {
                console.error("Error uploading invoice:", error);
                toast({ title: "שגיאה בהעלאת חשבונית", description: error.message || "העלאת החשבונית נכשלה.", variant: "destructive" });
                setIsSubmitting(false);
                setIsUploading(false);
                return;
            } finally {
                setIsUploading(false);
            }
        }

        try {
            const dataToSave = {
                ...finalData,
                vehicle_id: vehicle.id,
                farm_id: vehicle.farm_id,
                cost: finalData.cost ? parseFloat(finalData.cost) : 0,
                meter_reading: (finalData.meter_reading === '' || finalData.meter_reading == null) ? null : Number(finalData.meter_reading),
            };

            if (editingTreatment) {
                await VehicleTreatment.update(editingTreatment.id, dataToSave);
            } else {
                await VehicleTreatment.create(dataToSave);
            }
            
            toast({ title: "הצלחה", description: "הטיפול נשמר." });
            setIsTreatmentFormOpen(false);
            loadData(); // Refresh data
        } catch (error) {
            console.error("Failed to save treatment:", error);
            toast({ title: "שגיאה", description: "שמירת הטיפול נכשלה", variant: "destructive" });
        } finally {
            setIsSubmitting(false);
        }
    };
    
    const handleDeleteTreatment = async (treatmentId) => {
        if (window.confirm("האם למחוק את הטיפול?")) {
            try {
                await VehicleTreatment.delete(treatmentId);
                toast({ title: "הצלחה", description: "הטיפול נמחק." });
                loadData();
            } catch(error) {
                console.error("Error deleting treatment:", error);
                toast({ title: "שגיאה", description: "מחיקת הטיפול נכשלה.", variant: "destructive" });
            }
        }
    };
    
    const handleViewInvoice = async (fileUri) => {
        if (!fileUri) {
            toast({ title: "אין קובץ", description: "לא צורפה חשבונית לטיפול זה." });
            return;
        }
        // קבצי /uploads (כולל חשבוניות מקושרות) — פתיחה ישירה עם טוקן
        if (/\/uploads\//.test(fileUri)) {
            window.open(withToken(fileUri), '_blank');
            return;
        }
        try {
            const { signed_url, url } = await CreateFileSignedUrl({ file_uri: fileUri, file_path: fileUri });
            window.open(signed_url || url || fileUri, '_blank');
        } catch (error) {
            console.error("Error generating signed URL for invoice:", error);
            toast({ title: "שגיאה", description: "לא ניתן היה לפתוח את החשבונית.", variant: "destructive" });
        }
    };


    if (isLoading) return <div className="flex justify-center items-center h-screen"><Loader2 className="h-8 w-8 animate-spin" /></div>;
    if (!vehicle) return <div className="p-6 text-center">לא נמצא רכב.</div>;

    const DetailItem = ({ label, value, children }) => (
        <div><p className="text-sm text-gray-500">{label}</p><div className="font-medium">{children || value || "-"}</div></div>
    );

    const safeVehicle = vehicle || {};
    const safeInsurance = safeVehicle.insurance_info || {};
    const safeCompulsory = safeVehicle.insurance_compulsory || {};
    const safeLicensing = safeVehicle.licensing_info || {};

    const InsuranceBlock = ({ title, data }) => (
        <div>
            <div className="flex items-center gap-2 mb-2">
                <h4 className="font-semibold">{title}</h4>
                {data.end_date && <ExpiryBadge dateStr={data.end_date} />}
                {data.policy_url && (
                    <a href={withToken(data.policy_url)} target="_blank" rel="noopener noreferrer" className="text-xs text-indigo-600 hover:underline inline-flex items-center gap-1">
                        <FileText className="w-3 h-3" /> פוליסה
                    </a>
                )}
            </div>
            <DetailItem label="חברת ביטוח" value={data.provider} />
            <DetailItem label="מס' פוליסה" value={data.policy_number} />
            <DetailItem label="תוקף" value={data.end_date ? format(parseISO(data.end_date), 'dd/MM/yyyy') : "-"} />
        </div>
    );

    return (
        <div className="p-4 sm:p-6 lg:p-8 bg-gray-50/50 min-h-screen" dir="rtl">
            <div className="max-w-6xl mx-auto space-y-6">
                <div className="mb-6">
                    <Link to={createPageUrl("Vehicles")} className="inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 mb-4"><ArrowRight className="h-4 w-4" />חזרה</Link>
                    <div className="flex justify-between items-center">
                        <div>
                            <h1 className="text-3xl font-bold text-gray-900">{vehicle.name}</h1>
                            <p className="font-mono text-lg p-1">{vehicle.license_plate}</p>
                        </div>
                        <div className="flex gap-2">
                            <Link to={createPageUrl(`EditVehicle?id=${vehicle.id}`)}><Button variant="outline"><Edit className="w-4 h-4 ml-2" />ערוך</Button></Link>
                            <Button variant="destructive-outline" onClick={handleDeleteVehicle}><Trash2 className="w-4 h-4 ml-2" />מחק</Button>
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div className="lg:col-span-2 space-y-6">
                        <Card>
                            <CardHeader><CardTitle>פרטים כלליים</CardTitle></CardHeader>
                            <CardContent className="grid grid-cols-2 md:grid-cols-3 gap-4">
                                <DetailItem label="סוג רכב"><Badge variant="secondary">{vehicleTypeTranslations[vehicle.type]}</Badge></DetailItem>
                                <DetailItem label="סטטוס">{statusTranslations[vehicle.status]}</DetailItem>
                                <DetailItem label="יצרן" value={vehicle.manufacturer} />
                                <DetailItem label="דגם" value={vehicle.model} />
                                <DetailItem label="שנת ייצור" value={vehicle.year} />
                                <DetailItem label="תאריך רכישה" value={vehicle.purchase_date ? format(parseISO(vehicle.purchase_date), 'dd/MM/yyyy') : "-"} />
                            </CardContent>
                        </Card>
                         <Card>
                            <CardHeader><CardTitle>ביטוח ורישוי</CardTitle></CardHeader>
                            <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                <InsuranceBlock title="ביטוח חובה" data={safeCompulsory} />
                                <InsuranceBlock title="ביטוח מקיף" data={safeInsurance} />
                                <div>
                                    <div className="flex items-center gap-2 mb-2">
                                        <h4 className="font-semibold">טסט</h4>
                                        {safeLicensing.next_test_date && <ExpiryBadge dateStr={safeLicensing.next_test_date} />}
                                    </div>
                                    <DetailItem label="טסט אחרון" value={safeLicensing.last_test_date ? format(parseISO(safeLicensing.last_test_date), 'dd/MM/yyyy') : "-"} />
                                    <DetailItem label="טסט הבא" value={safeLicensing.next_test_date ? format(parseISO(safeLicensing.next_test_date), 'dd/MM/yyyy') : "-"} />
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                    <div className="space-y-6">
                        <Card>
                            <CardHeader><CardTitle>הערות</CardTitle></CardHeader>
                            <CardContent><p className="whitespace-pre-wrap">{vehicle.notes || "אין הערות."}</p></CardContent>
                        </Card>
                    </div>
                </div>

                <Card>
                    <CardHeader className="flex flex-row justify-between items-center">
                        <CardTitle>היסטוריית טיפולים</CardTitle>
                        <Button onClick={() => handleOpenTreatmentForm()}><Plus className="w-4 h-4 ml-2" />הוסף טיפול</Button>
                    </CardHeader>
                    <CardContent>
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>תאריך</TableHead>
                                    <TableHead>תיאור</TableHead>
                                    <TableHead>ספק</TableHead>
                                    <TableHead>עלות</TableHead>
                                    <TableHead>מד</TableHead>
                                    <TableHead className="text-center">פעולות</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {treatments.length > 0 ? (
                                    treatments.map(treatment => (
                                        <TableRow key={treatment.id}>
                                            <TableCell>{format(parseISO(treatment.treatment_date), 'dd/MM/yyyy')}</TableCell>
                                            <TableCell className="max-w-xs truncate">{treatment.description}</TableCell>
                                            <TableCell>{treatment.service_provider || '-'}</TableCell>
                                            <TableCell>{treatment.cost ? `₪${treatment.cost.toLocaleString()}` : '-'}</TableCell>
                                            <TableCell className="whitespace-nowrap text-sm">
                                                {treatment.meter_reading != null && treatment.meter_reading !== ''
                                                    ? `${Number(treatment.meter_reading).toLocaleString()} ${METER_UNITS[treatment.meter_unit] || ''}`
                                                    : '-'}
                                            </TableCell>
                                            <TableCell className="flex justify-center gap-2">
                                                <Button variant="ghost" size="icon" title="צפה בחשבונית" onClick={() => handleViewInvoice(treatment.invoice_url)} disabled={!treatment.invoice_url}>
                                                    <FileText className="w-4 h-4" />
                                                </Button>
                                                <Button variant="ghost" size="icon" title="ערוך טיפול" onClick={() => handleOpenTreatmentForm(treatment)}>
                                                    <Edit className="w-4 h-4" />
                                                </Button>
                                                <Button variant="ghost" size="icon" title="מחק טיפול" className="text-red-500" onClick={() => handleDeleteTreatment(treatment.id)}>
                                                    <Trash2 className="w-4 h-4" />
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    ))
                                ) : (
                                    <TableRow>
                                        <TableCell colSpan={6} className="text-center text-gray-500 py-4">לא תועדו טיפולים לרכב זה.</TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>

            </div>

            <Dialog open={isTreatmentFormOpen} onOpenChange={setIsTreatmentFormOpen}>
                <DialogContent dir="rtl">
                    <DialogHeader>
                        <DialogTitle>{editingTreatment ? 'עריכת טיפול' : 'הוספת טיפול חדש'}</DialogTitle>
                    </DialogHeader>
                    <form onSubmit={handleTreatmentFormSubmit} className="space-y-4 pt-4">
                        <div>
                            <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">תאריך טיפול</label>
                            <Input type="date" name="treatment_date" value={treatmentFormData.treatment_date || ''} onChange={handleTreatmentFormChange} required />
                        </div>
                        <div>
                            <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">תיאור הטיפול</label>
                            <Textarea name="description" value={treatmentFormData.description || ''} onChange={handleTreatmentFormChange} required />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">עלות</label>
                                <Input type="number" name="cost" value={treatmentFormData.cost || ''} onChange={handleTreatmentFormChange} />
                            </div>
                            <div>
                                <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">ספק / מוסך</label>
                                <Input name="service_provider" value={treatmentFormData.service_provider || ''} onChange={handleTreatmentFormChange} />
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="text-sm font-medium leading-none">מד בזמן הטיפול</label>
                                <Input type="number" name="meter_reading" value={treatmentFormData.meter_reading ?? ''} onChange={handleTreatmentFormChange} placeholder="0" inputMode="numeric" />
                            </div>
                            <div>
                                <label className="text-sm font-medium leading-none">יחידה</label>
                                <Select value={treatmentFormData.meter_unit || 'hours'} onValueChange={(v) => setTreatmentFormData(prev => ({ ...prev, meter_unit: v }))}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="km">ק"מ</SelectItem>
                                        <SelectItem value="hours">שעות מנוע</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                        <div>
                            <label className="text-sm font-medium leading-none">חשבונית</label>
                            {/* צירוף חשבונית קיימת מרשימת החשבוניות */}
                            <div className="mt-1">
                                <Select value={treatmentFormData.invoice_id || '__none__'} onValueChange={handlePickInvoice}>
                                    <SelectTrigger className="text-sm">
                                        <SelectValue placeholder="צרף חשבונית מהרשימה" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="__none__">— ללא חשבונית מקושרת —</SelectItem>
                                        {invoices.map(inv => (
                                            <SelectItem key={inv.id} value={inv.id}>{invoiceLabel(inv)}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                {invoices.length === 0 && (
                                    <p className="text-xs text-gray-400 mt-1">אין חשבוניות במשק. סרוק חשבונית בעמוד "חשבוניות" כדי לצרף אותה כאן.</p>
                                )}
                            </div>
                            {/* או העלאת קובץ ידנית */}
                            <div className="flex items-center gap-2 mt-2">
                                <span className="text-xs text-gray-400">או</span>
                                <label
                                    htmlFor="invoice-upload"
                                    className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium border border-input bg-background hover:bg-accent hover:text-accent-foreground h-9 px-3 cursor-pointer"
                                >
                                    <Upload className="w-4 h-4 ml-2"/>
                                    <span>{selectedFile ? 'החלף קובץ' : 'העלה קובץ'}</span>
                                </label>
                                <Input id="invoice-upload" type="file" className="hidden" onChange={handleFileChange} />
                                {selectedFile && <span className="text-sm text-gray-500 truncate max-w-[160px]">{selectedFile.name}</span>}
                                {!selectedFile && !treatmentFormData.invoice_id && treatmentFormData.invoice_url && <span className="text-sm text-green-600">קובץ קיים</span>}
                            </div>
                            {treatmentFormData.invoice_id && (
                                <p className="text-xs text-green-600 mt-1 flex items-center gap-1"><Receipt className="w-3.5 h-3.5" /> חשבונית מקושרת</p>
                            )}
                        </div>
                        <div>
                            <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">הערות</label>
                            <Textarea name="notes" value={treatmentFormData.notes || ''} onChange={handleTreatmentFormChange} />
                        </div>
                        <DialogFooter className="pt-4">
                            <Button type="button" variant="outline" onClick={() => setIsTreatmentFormOpen(false)} disabled={isSubmitting}>ביטול</Button>
                            <Button type="submit" disabled={isSubmitting}>
                                {isSubmitting && <Loader2 className="w-4 h-4 ml-2 animate-spin" />}
                                {isUploading ? 'מעלה קובץ...' : (editingTreatment ? 'שמור שינויים' : 'הוסף טיפול')}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </div>
    );
}
