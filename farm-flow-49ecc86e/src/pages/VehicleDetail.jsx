
import React, { useState, useEffect, useMemo, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Vehicle, VehicleTreatment, User, Farm } from "@/entities/all";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import { format, parseISO } from "date-fns";
import { ArrowRight, Loader2, Edit, Trash2, Plus, Wrench, FileText, Upload } from "lucide-react";
import { createPageUrl } from "@/utils";
import { Badge } from "@/components/ui/badge";
import { UploadPrivateFile, CreateFileSignedUrl } from "@/integrations/Core";

const vehicleTypeTranslations = {
    tractor: "טרקטור", private_car: "רכב פרטי", truck: "משאית", harvester: "קומביין", sprayer: "מרסס", forklift: "מלגזה", other: "אחר"
};

const statusTranslations = {
    active: "פעיל", in_service: "בטיפול", sold: "נמכר", out_of_order: "מושבת"
};

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

    const vehicleId = useMemo(() => new URLSearchParams(window.location.search).get("id"), []);

    const loadData = useCallback(async () => {
        if (!vehicleId) {
            setIsLoading(false);
            return;
        }
        setIsLoading(true);
        try {
            const [vehicleData, treatmentsData] = await Promise.all([
                Vehicle.get(vehicleId),
                VehicleTreatment.filter({ vehicle_id: vehicleId }, "-treatment_date")
            ]);
            setVehicle(vehicleData);
            setTreatments(Array.isArray(treatmentsData) ? treatmentsData : []);
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
            });
        } else {
            setTreatmentFormData({
                treatment_date: format(new Date(), 'yyyy-MM-dd'),
                description: '',
                cost: '',
                service_provider: '',
                notes: '',
                invoice_url: ''
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
        }
    };

    const handleTreatmentFormSubmit = async (e) => {
        e.preventDefault();
        setIsSubmitting(true);
        
        let finalData = { ...treatmentFormData };

        if (selectedFile) {
            setIsUploading(true);
            try {
                const { file_uri } = await UploadPrivateFile({ file: selectedFile });
                finalData.invoice_url = file_uri;
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
        try {
            toast({ title: "פותח חשבונית...", description: "אנא המתן." });
            const { signed_url } = await CreateFileSignedUrl({ file_uri: fileUri });
            window.open(signed_url, '_blank');
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
    const safeLicensing = safeVehicle.licensing_info || {};

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
                            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div>
                                    <h4 className="font-semibold mb-2">ביטוח</h4>
                                    <DetailItem label="ספק" value={safeInsurance.provider} />
                                    <DetailItem label="מס' פוליסה" value={safeInsurance.policy_number} />
                                    <DetailItem label="תוקף" value={safeInsurance.end_date ? format(parseISO(safeInsurance.end_date), 'dd/MM/yyyy') : "-"} />
                                </div>
                                 <div>
                                    <h4 className="font-semibold mb-2">טסט</h4>
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
                                        <TableCell colSpan={5} className="text-center text-gray-500 py-4">לא תועדו טיפולים לרכב זה.</TableCell>
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
                        <div>
                            <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">חשבונית</label>
                            <div className="flex items-center gap-2 mt-1">
                                <label
                                    htmlFor="invoice-upload"
                                    className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 border border-input bg-background hover:bg-accent hover:text-accent-foreground h-10 px-4 py-2 cursor-pointer"
                                >
                                    <Upload className="w-4 h-4 ml-2"/>
                                    <span>{selectedFile ? 'החלף קובץ' : 'בחר קובץ'}</span>
                                </label>
                                <Input id="invoice-upload" type="file" className="hidden" onChange={handleFileChange} />
                                {selectedFile && <span className="text-sm text-gray-500 truncate max-w-xs">{selectedFile.name}</span>}
                                {!selectedFile && treatmentFormData.invoice_url && <span className="text-sm text-green-600">קובץ קיים</span>}
                            </div>
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
