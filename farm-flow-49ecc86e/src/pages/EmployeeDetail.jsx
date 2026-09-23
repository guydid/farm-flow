
import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Employee, ManpowerCompany, User, EmployeeLog, Farm } from "@/entities/all";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useToast } from "@/components/ui/use-toast";
import { UploadFile } from "@/integrations/Core";
import { format, differenceInDays, parseISO } from "date-fns";
import { ArrowRight, Loader2, Camera, User as UserIcon, FileText, Trash2, Download, AlertTriangle, BookOpen, Edit, FileUp, ExternalLink, Upload } from "lucide-react";
import { createPageUrl } from "@/utils";
import { Badge } from "@/components/ui/badge";
import EmployeeTimeline from "@/components/employees/EmployeeTimeline";

const getInitials = (firstName, lastName) => {
    let initials = '';
    if (firstName) initials += firstName.charAt(0);
    if (lastName) initials += lastName.charAt(0);
    return initials.toUpperCase();
};

export default function EmployeeDetail() {
    const { toast } = useToast();
    const navigate = useNavigate();

    const [employee, setEmployee] = useState(null);
    const [manpowerCompanies, setManpowerCompanies] = useState([]);
    const [users, setUsers] = useState([]);
    const [logs, setLogs] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [uploadingField, setUploadingField] = useState(null);
    const [currentFarm, setCurrentFarm] = useState(null);
    const [currentUser, setCurrentUser] = useState(null);
    const [previewUrl, setPreviewUrl] = useState(null);

    const fileUploadRefs = {
        photo_url: useRef(null),
        passport_url: useRef(null),
        passport_url_cam: useRef(null),
        visa_url: useRef(null),
        visa_url_cam: useRef(null),
        contract_url: useRef(null),
        contract_url_cam: useRef(null),
        general_document: useRef(null),
        general_document_cam: useRef(null),
    };

    const employeeId = useMemo(() => {
        const params = new URLSearchParams(window.location.search);
        return params.get("id");
    }, []);

    const loadData = useCallback(async () => {
        if (!employeeId) {
            setIsLoading(false);
            return;
        }

        setIsLoading(true);
        try {
            const user = await User.me();
            setCurrentUser(user);
            if (!user.current_farm_id) {
                toast({ title: "שגיאה", description: "יש לבחור משק פעיל.", variant: "destructive" });
                setIsLoading(false);
                return;
            }
            const farm = await Farm.get(user.current_farm_id);
            setCurrentFarm(farm);

            const [mcData, userData, empData, logData] = await Promise.all([
                ManpowerCompany.filter({ farm_id: farm.id }),
                User.list(),
                Employee.get(employeeId),
                EmployeeLog.filter({ employee_id: employeeId }, "-created_date")
            ]);

            setManpowerCompanies(Array.isArray(mcData) ? mcData : []);
            setUsers(Array.isArray(userData) ? userData : []);
            setEmployee(empData);
            setLogs(Array.isArray(logData) ? logData : []);

        } catch (error) {
            console.error("Error loading employee data:", error);
            toast({ title: "שגיאה", description: "טעינת נתוני העובד נכשלה.", variant: "destructive" });
            setEmployee(null); // Ensure employee is null on error
        } finally {
            setIsLoading(false);
        }
    }, [employeeId, toast]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const handleStatusChange = async (newStatus) => {
        if (!currentUser) {
            toast({ title: "שגיאה", description: "לא ניתן לזהות את המשתמש.", variant: "destructive" });
            return;
        }

        const statusLabels = {
            active: "פעיל",
            inactive: "לא פעיל (סיים)",
            on_leave: "בחופשה",
            abandoned: "נטש",
            inter_visa: "בהליך אשרה",
        };

        const updateData = { status: newStatus };
        if (newStatus === 'inactive' || newStatus === 'abandoned') {
            updateData.termination_date = new Date().toISOString().split('T')[0];
        } else {
            updateData.termination_date = null; // Clear termination date if not applicable
        }

        try {
            await Employee.update(employee.id, updateData);
            await EmployeeLog.create({
                employee_id: employee.id,
                action: `סטטוס העובד שונה ל: ${statusLabels[newStatus]}`,
                performed_by: currentUser.full_name
            });
            toast({ title: "הצלחה", description: "סטטוס העובד עודכן." });
            loadData(); // Reload to show changes
        } catch (error) {
            console.error("Failed to update status:", error);
            toast({ title: "שגיאה", description: "עדכון הסטטוס נכשל.", variant: "destructive" });
        }
    };

    const handleFileUpload = async (e, fieldName) => {
        const file = e.target.files[0];
        if (!file) return;

        setUploadingField(fieldName);

        try {
            const { file_url } = await UploadFile({ file });

            if (fieldName === 'general_document') {
                const documentName = prompt("נא להזין שם למסמך:", file.name.split('.').slice(0, -1).join('.'));
                if (!documentName) {
                    toast({ title: "בוטל", description: "העלאת המסמך בוטלה.", variant: "destructive" });
                    setUploadingField(null);
                    return;
                }
                const newDocument = { document_name: documentName, document_url: file_url, upload_date: new Date().toISOString() };
                const updatedDocs = [...(employee.general_documents || []), newDocument];
                await Employee.update(employee.id, { general_documents: updatedDocs });
            } else {
                await Employee.update(employee.id, { [fieldName]: file_url });
            }

            toast({ title: "הצלחה", description: "הקובץ הועלה ונתוני העובד עודכנו." });
            await loadData();
        } catch (error) {
            console.error("File upload failed:", error);
            toast({ title: "שגיאה", description: "העלאת הקובץ נכשלה.", variant: "destructive" });
        } finally {
            setUploadingField(null);
            e.target.value = null;
        }
    };

    const handleDeleteGeneralDoc = async (docIndex) => {
        if (!window.confirm("האם למחוק מסמך זה?")) return;

        const updatedDocs = [...employee.general_documents];
        updatedDocs.splice(docIndex, 1);

        try {
            await Employee.update(employee.id, { general_documents: updatedDocs });
            toast({ title: "הצלחה", description: "המסמך נמחק." });
            await loadData();
        } catch (error) {
            toast({ title: "שגיאה", description: "מחיקת המסמך נכשלה.", variant: "destructive" });
        }
    };

    // Upload button with optional camera + gallery split
    const FileUploadButton = ({ field, children, withCamera = false }) => {
        const camField = `${field}_cam`;
        return (
            <>
                {/* Gallery / file input */}
                <input
                    type="file"
                    ref={fileUploadRefs[field]}
                    className="hidden"
                    accept="image/*,application/pdf"
                    onChange={(e) => handleFileUpload(e, field)}
                />
                {/* Camera input */}
                {withCamera && fileUploadRefs[camField] && (
                    <input
                        type="file"
                        ref={fileUploadRefs[camField]}
                        className="hidden"
                        accept="image/*"
                        capture="environment"
                        onChange={(e) => handleFileUpload(e, field)}
                    />
                )}
                {withCamera ? (
                    <div className="flex gap-1">
                        <Button variant="outline" size="sm"
                            onClick={() => fileUploadRefs[camField]?.current?.click()}
                            disabled={!!uploadingField}
                            className="border-blue-200 text-blue-700 hover:bg-blue-50 px-2">
                            {uploadingField === field
                                ? <Loader2 className="w-4 h-4 animate-spin" />
                                : <Camera className="w-4 h-4" />}
                        </Button>
                        <Button variant="outline" size="sm"
                            onClick={() => fileUploadRefs[field].current?.click()}
                            disabled={!!uploadingField}>
                            {uploadingField === field
                                ? <Loader2 className="w-4 h-4 ml-1 animate-spin" />
                                : <Upload className="w-4 h-4 ml-1" />}
                            {children}
                        </Button>
                    </div>
                ) : (
                    <Button variant="outline" size="sm"
                        onClick={() => fileUploadRefs[field].current?.click()}
                        disabled={!!uploadingField}>
                        {uploadingField === field
                            ? <Loader2 className="w-4 h-4 ml-2 animate-spin" />
                            : <FileUp className="w-4 h-4 ml-2" />}
                        {children}
                    </Button>
                )}
            </>
        );
    };

    const DocumentLink = ({ url, children }) => {
        if (!url) return <span className="text-sm text-gray-500">לא הועלה מסמך</span>;

        const isImage = /\.(jpeg|jpg|gif|png|webp|avif)$/i.test(url);

        if (isImage) {
            return (
                <button type="button" onClick={() => setPreviewUrl(url)} className="text-blue-600 hover:underline flex items-center gap-2 text-sm">
                    {children} <Download className="w-4 h-4" />
                </button>
            );
        }

        return (
            <a href={url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline flex items-center gap-2 text-sm">
                {children} <Download className="w-4 h-4" />
            </a>
        );
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-screen">
                <Loader2 className="w-8 h-8 animate-spin" />
            </div>
        );
    }

    if (!employee) {
        return <div className="text-center p-8">העובד לא נמצא.</div>;
    }

    const getStatusBadge = (status) => {
        const variants = {
            active: "bg-green-100 text-green-800",
            inactive: "bg-red-100 text-red-800",
            on_leave: "bg-yellow-100 text-yellow-800",
            abandoned: "bg-purple-100 text-purple-800",
            inter_visa: "bg-blue-100 text-blue-800",
        };
        const labels = {
            active: "פעיל",
            inactive: "לא פעיל (סיים)",
            on_leave: "בחופשה",
            abandoned: "נטש",
            inter_visa: "בהליך אשרה",
        };
        return <Badge className={variants[status] || "bg-gray-100 text-gray-800"}>{labels[status] || status}</Badge>;
    };

    const getDaysDifferenceBadge = (dateString) => {
        if (!dateString) return null;
        const days = differenceInDays(parseISO(dateString), new Date());
        let variant, text;
        if (days < 0) {
            variant = "destructive";
            text = `פג לפני ${Math.abs(days)} ימים`;
        } else if (days <= 30) {
            variant = "default";
            text = `יפוג בעוד ${days} ימים`;
        } else {
            return null;
        }
        return <Badge variant={variant} className="mr-2 animate-pulse"><AlertTriangle className="w-3 h-3 ml-1" />{text}</Badge>;
    };

    const renderDetail = (label, value) => (
        <div>
            <p className="text-sm text-gray-500">{label}</p>
            <p className="font-medium">{value || "-"}</p>
        </div>
    );

    return (
        <div className="p-4 sm:p-6 lg:p-8 bg-gray-50/50 min-h-screen" dir="rtl">
            <div className="max-w-6xl mx-auto">
                {/* Header */}
                <div className="mb-6">
                    <Link to={createPageUrl("Employees")} className="inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 mb-4">
                        <ArrowRight className="h-4 w-4" />
                        חזרה לרשימת העובדים
                    </Link>
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
                        <div className="flex items-center gap-4">
                            <div className="relative">
                                <Avatar className="h-20 w-20 border-2 border-primary">
                                    <AvatarImage src={employee.photo_url} alt={employee.full_name} />
                                    <AvatarFallback className="text-2xl">{getInitials(employee.first_name, employee.last_name)}</AvatarFallback>
                                </Avatar>
                                <input
                                    type="file"
                                    ref={fileUploadRefs.photo_url}
                                    className="hidden"
                                    accept="image/*"
                                    onChange={(e) => handleFileUpload(e, 'photo_url')}
                                />
                                <Button
                                    size="icon"
                                    variant="outline"
                                    className="absolute -bottom-1 -left-1 bg-white rounded-full h-8 w-8"
                                    onClick={() => fileUploadRefs.photo_url.current.click()}
                                    disabled={!!uploadingField}
                                >
                                    {uploadingField === 'photo_url' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
                                </Button>
                            </div>
                            <div>
                                <h1 className="text-3xl font-bold text-gray-900">{employee.full_name}</h1>
                                {employee.nickname && <p className="text-lg text-muted-foreground">{employee.nickname}</p>}
                                <div className="mt-2">
                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                            <Button variant="ghost" className="p-0 h-auto cursor-pointer">
                                                {getStatusBadge(employee.status)}
                                            </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent>
                                            <DropdownMenuLabel>שנה סטטוס</DropdownMenuLabel>
                                            <DropdownMenuSeparator />
                                            <DropdownMenuItem onClick={() => handleStatusChange('active')}>פעיל</DropdownMenuItem>
                                            <DropdownMenuItem onClick={() => handleStatusChange('inactive')}>לא פעיל (סיים)</DropdownMenuItem>
                                            <DropdownMenuItem onClick={() => handleStatusChange('on_leave')}>בחופשה</DropdownMenuItem>
                                            <DropdownMenuItem onClick={() => handleStatusChange('abandoned')}>נטש</DropdownMenuItem>
                                            <DropdownMenuItem onClick={() => handleStatusChange('inter_visa')}>בהליך אשרה</DropdownMenuItem>
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                </div>
                            </div>
                        </div>
                        <Link to={createPageUrl(`EditEmployee?id=${employee.id}`)}>
                            <Button variant="outline">
                                <Edit className="w-4 h-4 ml-2" />
                                ערוך
                            </Button>
                        </Link>
                    </div>
                </div>

                {/* Main content grid */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Left Column - Main Details */}
                    <div className="lg:col-span-2 space-y-6">

                        {/* Passport & Visa */}
                        <Card>
                            <CardHeader><CardTitle className="text-lg">דרכון ואשרה</CardTitle></CardHeader>
                            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="space-y-4 p-4 border rounded-lg">
                                    <div className="flex justify-between items-center">
                                        <h4 className="font-semibold">פרטי דרכון</h4>
                                        <FileUploadButton field="passport_url" withCamera>סרוק</FileUploadButton>
                                    </div>
                                    {renderDetail("מספר דרכון", employee.passport_number)}
                                    <div>
                                        <p className="text-sm text-gray-500">תוקף דרכון</p>
                                        <div className="flex items-center">
                                            {getDaysDifferenceBadge(employee.passport_expiry)}
                                            <p className="font-medium">{employee.passport_expiry ? format(parseISO(employee.passport_expiry), 'dd/MM/yyyy') : "-"}</p>
                                        </div>
                                    </div>
                                    {renderDetail("מסמך", <DocumentLink url={employee.passport_url}>צפה בצילום הדרכון</DocumentLink>)}
                                </div>
                                <div className="space-y-4 p-4 border rounded-lg">
                                    <div className="flex justify-between items-center">
                                        <h4 className="font-semibold">פרטי אשרה</h4>
                                        <FileUploadButton field="visa_url" withCamera>סרוק</FileUploadButton>
                                    </div>
                                    {renderDetail("סוג אשרה", employee.visa_type)}
                                    <div>
                                        <p className="text-sm text-gray-500">תוקף אשרה</p>
                                        <div className="flex items-center">
                                            {getDaysDifferenceBadge(employee.visa_expiry)}
                                            <p className="font-medium">{employee.visa_expiry ? format(parseISO(employee.visa_expiry), 'dd/MM/yyyy') : "-"}</p>
                                        </div>
                                    </div>
                                    {renderDetail("מסמך", <DocumentLink url={employee.visa_url}>צפה בצילום האשרה</DocumentLink>)}
                                </div>
                            </CardContent>
                        </Card>

                        {/* Employment Details */}
                        <Card>
                            <CardHeader><CardTitle className="text-lg">פרטי העסקה וביטוח</CardTitle></CardHeader>
                            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="space-y-4 p-4 border rounded-lg">
                                    <h4 className="font-semibold">העסקה</h4>
                                    {renderDetail("תאריך תחילת עבודה", employee.start_date ? format(parseISO(employee.start_date), 'dd/MM/yyyy') : "-")}
                                    {employee.termination_date && renderDetail("תאריך סיום העסקה", format(parseISO(employee.termination_date), 'dd/MM/yyyy'))}
                                    {renderDetail("תאריך כניסה לארץ", employee.entry_date ? format(parseISO(employee.entry_date), 'dd/MM/yyyy') : "-")}
                                    <div>
                                        <p className="text-sm text-gray-500 flex items-center gap-2">
                                            חברת כח אדם
                                            <Link 
                                                to={createPageUrl("Settings?tab=manpower")}
                                                className="text-blue-600 hover:text-blue-800"
                                                title="נהל חברות כח אדם"
                                            >
                                                <ExternalLink className="h-3 w-3" />
                                            </Link>
                                        </p>
                                        <p className="font-medium">
                                            {manpowerCompanies.find(mc => mc.id === employee.manpower_company_id)?.name || "-"}
                                        </p>
                                    </div>
                                    {renderDetail("מנהל ישיר", users.find(u => u.id === employee.manager_id)?.full_name)}
                                    <div className="pt-2 space-y-2">
                                        <div className="flex items-center justify-between">
                                            <p className="text-sm text-gray-500">חוזה העסקה</p>
                                            <FileUploadButton field="contract_url" withCamera>סרוק חוזה</FileUploadButton>
                                        </div>
                                        <DocumentLink url={employee.contract_url}>צפה בחוזה</DocumentLink>
                                    </div>
                                </div>
                                <div className="space-y-4 p-4 border rounded-lg">
                                    <h4 className="font-semibold">ביטוח וקופ"ח</h4>
                                    {renderDetail("חברת ביטוח", employee.insurance_details?.company)}
                                    {renderDetail("מספר פוליסה", employee.insurance_details?.policy_number)}
                                    {employee.insurance_details?.policy_url && (
                                        <div>
                                            <p className="text-sm text-gray-500">מסמך פוליסה</p>
                                            <DocumentLink url={employee.insurance_details.policy_url}>צפה בפוליסה</DocumentLink>
                                        </div>
                                    )}
                                    {renderDetail("קופת חולים", employee.insurance_details?.health_fund)}
                                    {renderDetail("מספר בנה\"ח", employee.bnhc_number)}
                                    {renderDetail("מספר בקופ\"ח", employee.insurance_details?.health_fund_number)}
                                    {employee.insurance_details?.health_fund_url && (
                                        <div>
                                            <p className="text-sm text-gray-500">מסמך קופ"ח</p>
                                            <DocumentLink url={employee.insurance_details.health_fund_url}>צפה במסמך</DocumentLink>
                                        </div>
                                    )}
                                </div>
                            </CardContent>
                        </Card>

                        {/* General Docs */}
                        <Card>
                            <CardHeader>
                                <CardTitle className="flex justify-between items-center text-lg">
                                    <span>מסמכים כלליים</span>
                                    <FileUploadButton field="general_document" withCamera>הוסף מסמך</FileUploadButton>
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                {employee.general_documents && employee.general_documents.length > 0 ? (
                                    <ul className="space-y-2">
                                        {employee.general_documents.map((doc, index) => (
                                            <li key={index} className="flex items-center justify-between p-2 border rounded-md hover:bg-gray-50">
                                                <div className="flex items-center gap-3">
                                                    <FileText className="w-5 h-5 text-gray-500" />
                                                    <div>
                                                        <DocumentLink url={doc.document_url}>{doc.document_name}</DocumentLink>
                                                        <p className="text-xs text-gray-500">הועלה בתאריך: {format(parseISO(doc.upload_date), 'dd/MM/yyyy')}</p>
                                                    </div>
                                                </div>
                                                <Button variant="ghost" size="icon" onClick={() => handleDeleteGeneralDoc(index)}><Trash2 className="w-4 h-4 text-red-500" /></Button>
                                            </li>
                                        ))}
                                    </ul>
                                ) : (
                                    <p className="text-sm text-center text-gray-500 py-4">לא הועלו מסמכים כלליים.</p>
                                )}
                            </CardContent>
                        </Card>

                    </div>

                    {/* Right Column - Info and Logs */}
                    <div className="space-y-6">
                        <Card>
                            <CardHeader><CardTitle className="text-lg">פרטים אישיים</CardTitle></CardHeader>
                            <CardContent className="space-y-3">
                                {renderDetail("שם מלא", employee.full_name)}
                                {renderDetail("מדינת מוצא", employee.country_of_origin)}
                                {renderDetail("מספר עובד בשעון נוכחות", employee.time_clock_id)}
                                {renderDetail("פרטי בנק", `${employee.bank_details?.bank_name || ''} סניף ${employee.bank_details?.branch_number || ''} חשבון ${employee.bank_details?.account_number || ''}`)}
                                <div>
                                    <p className="text-sm text-gray-500">הערות</p>
                                    <p className="font-medium whitespace-pre-wrap">{employee.notes || "אין הערות"}</p>
                                </div>
                            </CardContent>
                        </Card>

                        {/* Employee Events Timeline */}
                        <EmployeeTimeline
                            employee={employee}
                            currentUser={currentUser}
                            farmId={currentFarm?.id}
                        />

                        {/* System log (collapsed) */}
                        {logs.length > 0 && (
                            <Card>
                                <CardHeader>
                                    <CardTitle className="text-sm text-gray-500 flex items-center gap-2">
                                        <BookOpen className="w-4 h-4" />
                                        יומן מערכת ({logs.length})
                                    </CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <ul className="space-y-3 max-h-48 overflow-y-auto">
                                        {logs.map(log => (
                                            <li key={log.id} className="flex items-start gap-3">
                                                <div className="bg-gray-100 rounded-full p-1.5 flex-shrink-0">
                                                    <BookOpen className="w-3 h-3 text-gray-500" />
                                                </div>
                                                <div>
                                                    <p className="text-xs font-medium">{log.action}</p>
                                                    <p className="text-xs text-gray-400">
                                                        {format(parseISO(log.created_date), 'dd/MM/yy HH:mm')}
                                                        {log.performed_by ? ` · ${log.performed_by}` : ''}
                                                    </p>
                                                </div>
                                            </li>
                                        ))}
                                    </ul>
                                </CardContent>
                            </Card>
                        )}
                    </div>
                </div>
            </div>

            <Dialog open={!!previewUrl} onOpenChange={(open) => !open && setPreviewUrl(null)}>
                <DialogContent className="max-w-4xl h-[90vh]">
                    <DialogHeader>
                        <DialogTitle>תצוגת מסמך</DialogTitle>
                    </DialogHeader>
                    <div className="p-4 h-full flex justify-center items-center">
                        <img src={previewUrl} alt="תצוגת מסמך" className="max-w-full max-h-full object-contain rounded-md" />
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}
