
import React, { useState, useEffect, useRef } from 'react';
import { Employee, ManpowerCompany, User } from '@/entities/all';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/use-toast";
import { Loader2, Upload, Camera, FileText, User as UserIcon, ImagePlus, Paperclip } from "lucide-react";
import { getToken } from '@/api/localClient';
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

// Append token to /uploads URLs so the server can authenticate static file requests
function withToken(url) {
    if (!url) return url;
    const token = getToken();
    if (!token || !url.startsWith('/uploads')) return url;
    return `${url}?token=${encodeURIComponent(token)}`;
}

async function uploadFile(file) {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(`${BASE_URL}/upload`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${getToken()}` },
    body: formData
  });
  if (!res.ok) throw new Error('העלאת הקובץ נכשלה');
  return res.json(); // { file_url, filename, size }
}

const statusTranslations = {
    active: "פעיל",
    inactive: "לא פעיל",
    on_leave: "בחופשה",
    abandoned: "נטש",
    inter_visa: "בהליך אשרה"
};

export default function EmployeeForm({ employee, currentFarm, manpowerCompanies, users, onClose, onSuccess }) {
    const { toast } = useToast();
    const [formData, setFormData] = useState({
        first_name: '', last_name: '', nickname: '', status: 'active', photo_url: '',
        start_date: '', termination_date: '', entry_date: '', country_of_origin: '',
        manpower_company_id: '', manager_id: '', passport_number: '', passport_expiry: '',
        passport_url: '', visa_type: '', visa_expiry: '', visa_url: '', contract_url: '',
        bnhc_number: '',
        insurance_details: { company: '', policy_number: '', policy_start_date: '', policy_end_date: '', policy_url: '', health_fund: '', health_fund_number: '', health_fund_url: '' },
        bank_details: { bank_name: '', branch_number: '', account_number: '' },
        notes: ''
    });
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isProcessingPassport, setIsProcessingPassport] = useState(false);
    const [passportImageUrl, setPassportImageUrl] = useState(null);
    const [extractedPhotoUrl, setExtractedPhotoUrl] = useState(null);
    const [uploadingDoc, setUploadingDoc] = useState({});

    useEffect(() => {
        const initialData = {
            first_name: employee?.first_name || '',
            last_name: employee?.last_name || '',
            nickname: employee?.nickname || '',
            status: employee?.status || 'active',
            photo_url: employee?.photo_url || '',
            start_date: employee?.start_date || '',
            termination_date: employee?.termination_date || '',
            entry_date: employee?.entry_date || '',
            country_of_origin: employee?.country_of_origin || '',
            manpower_company_id: employee?.manpower_company_id || '',
            manager_id: employee?.manager_id || '',
            passport_number: employee?.passport_number || '',
            passport_expiry: employee?.passport_expiry || '',
            passport_url: employee?.passport_url || '',
            visa_type: employee?.visa_type || '',
            visa_expiry: employee?.visa_expiry || '',
            visa_url: employee?.visa_url || '',
            contract_url: employee?.contract_url || '',
            bnhc_number: employee?.bnhc_number || '',
            insurance_details: {
                company: employee?.insurance_details?.company || '',
                policy_number: employee?.insurance_details?.policy_number || '',
                policy_start_date: employee?.insurance_details?.policy_start_date || '',
                policy_end_date: employee?.insurance_details?.policy_end_date || '',
                policy_url: employee?.insurance_details?.policy_url || '',
                health_fund: employee?.insurance_details?.health_fund || '',
                health_fund_number: employee?.insurance_details?.health_fund_number || '',
                health_fund_url: employee?.insurance_details?.health_fund_url || ''
            },
            bank_details: {
                bank_name: employee?.bank_details?.bank_name || '',
                branch_number: employee?.bank_details?.branch_number || '',
                account_number: employee?.bank_details?.account_number || ''
            },
            notes: employee?.notes || ''
        };
        setFormData(initialData);
        
        if (employee?.passport_url) {
            setPassportImageUrl(employee.passport_url);
        }
        if (employee?.photo_url) {
            setExtractedPhotoUrl(employee.photo_url);
        }
    }, [employee]);

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleNestedChange = (section, e) => {
        const { name, value } = e.target;
        setFormData(prev => ({
            ...prev,
            [section]: { ...prev[section], [name]: value }
        }));
    };

    const handleSelectChange = (name, value) => {
        setFormData(prev => ({ ...prev, [name]: value === '__none__' ? '' : value }));
    };

    const handlePassportUpload = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const allowed = /^image\//i.test(file.type) || /\.(jpg|jpeg|png|gif|webp|pdf)$/i.test(file.name);
        if (!allowed) {
            toast({ title: "שגיאה", description: "נא להעלות קובץ תמונה או PDF", variant: "destructive" });
            return;
        }

        setIsProcessingPassport(true);
        toast({ title: "מעלה דרכון...", description: file.name });

        try {
            // Step 1: Upload
            const { file_url } = await uploadFile(file);
            setPassportImageUrl(file_url);
            // Temporarily show full passport until face is cropped
            setExtractedPhotoUrl(file_url);
            setFormData(prev => ({ ...prev, passport_url: file_url, photo_url: file_url }));

            // Step 2: Extract data (AI or OCR fallback) + face crop — in parallel
            toast({ title: "מעבד דרכון...", description: "מחלץ נתונים ותמונת פנים..." });

            const [extractRes, faceRes] = await Promise.allSettled([
                fetch(`${BASE_URL}/extract-document`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
                    body: JSON.stringify({ file_url, document_type: 'passport' })
                }).then(r => r.json()),
                fetch(`${BASE_URL}/extract-face`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
                    body: JSON.stringify({ file_url })
                }).then(r => r.json())
            ]);

            // Apply OCR results
            if (extractRes.status === 'fulfilled' && extractRes.value?.success && extractRes.value?.data) {
                const d = extractRes.value.data;
                const updates = {};
                if (d.first_name       && !formData.first_name)       updates.first_name       = d.first_name;
                if (d.last_name        && !formData.last_name)        updates.last_name        = d.last_name;
                if (d.passport_number  && !formData.passport_number)  updates.passport_number  = d.passport_number;
                if (d.passport_expiry  && !formData.passport_expiry)  updates.passport_expiry  = d.passport_expiry;
                if (d.country_of_origin && !formData.country_of_origin) updates.country_of_origin = d.country_of_origin;
                if (d.birth_date       && !formData.birth_date)       updates.birth_date       = d.birth_date;
                setFormData(prev => ({ ...prev, ...updates }));
                const count = Object.keys(updates).length;
                toast({
                    title: count > 0 ? `חולצו ${count} שדות!` : "הדרכון הועלה",
                    description: count > 0 ? "בדוק את הנתונים ותקן במידת הצורך" : "מלא את הפרטים ידנית"
                });
            } else {
                const errMsg = extractRes.status === 'fulfilled' ? extractRes.value?.error : extractRes.reason?.message;
                toast({ title: "הדרכון הועלה", description: errMsg || "מלא את הפרטים ידנית" });
            }

            // Apply face crop
            if (faceRes.status === 'fulfilled' && faceRes.value?.success && faceRes.value?.face_url) {
                const faceUrl = faceRes.value.face_url;
                setExtractedPhotoUrl(faceUrl);
                setFormData(prev => ({ ...prev, photo_url: faceUrl }));
            }
        } catch (error) {
            toast({ title: "שגיאה", description: error.message, variant: "destructive" });
        } finally {
            setIsProcessingPassport(false);
        }
    };

    // Upload a document and store its URL inside insurance_details
    const handleDocUpload = async (e, fieldPath) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const allowed = /^image\//i.test(file.type) || /\.(jpg|jpeg|png|gif|webp|pdf)$/i.test(file.name);
        if (!allowed) {
            toast({ title: "שגיאה", description: "נא להעלות קובץ תמונה או PDF", variant: "destructive" });
            return;
        }
        setUploadingDoc(prev => ({ ...prev, [fieldPath]: true }));
        try {
            const { file_url } = await uploadFile(file);
            const [section, field] = fieldPath.split('.');
            if (section && field) {
                setFormData(prev => ({
                    ...prev,
                    [section]: { ...prev[section], [field]: file_url }
                }));
            } else {
                setFormData(prev => ({ ...prev, [fieldPath]: file_url }));
            }
            toast({ title: "מסמך הועלה", description: file.name });
        } catch (err) {
            toast({ title: "שגיאה", description: err.message, variant: "destructive" });
        } finally {
            setUploadingDoc(prev => ({ ...prev, [fieldPath]: false }));
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();

        if (!formData.first_name || !formData.last_name || !formData.start_date) {
            toast({
                title: "שגיאה",
                description: "נא למלא את כל השדות הנדרשים (שם פרטי, שם משפחה, תאריך התחלה)",
                variant: "destructive"
            });
            return;
        }

        setIsSubmitting(true);

        try {
            const dataToSave = {
                ...formData,
                farm_id: currentFarm.id,
                full_name: `${formData.first_name} ${formData.last_name}`.trim()
            };

            if (employee?.id) {
                await Employee.update(employee.id, dataToSave);
            } else {
                await Employee.create(dataToSave);
            }

            toast({ title: "הצלחה", description: "פרטי העובד נשמרו" });
            onSuccess();
        } catch (error) {
            console.error("Failed to save employee:", error);
            toast({
                title: "שגיאה",
                description: "שמירת העובד נכשלה",
                variant: "destructive"
            });
        } finally {
            setIsSubmitting(false);
        }
    };

    const getInitials = () => {
        const first = formData.first_name?.charAt(0) || "";
        const last = formData.last_name?.charAt(0) || "";
        return (first + last).toUpperCase() || "?";
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-6">
            {/* העלאת תמונת דרכון */}
            <Card className="bg-blue-50 border-blue-200">
                <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                        <Camera className="w-5 h-5 text-blue-600" />
                        העלאת דרכון (אוטומטי)
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="text-sm text-gray-600">
                        העלה תמונה של דרכון העובד, והמערכת תמלא אוטומטית את כל הפרטים
                    </div>

                    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                        {/* תצוגת תמונה נוכחית */}
                        {extractedPhotoUrl && (
                            <Avatar className="h-24 w-24 border-2 border-blue-300">
                                <AvatarImage src={withToken(extractedPhotoUrl)} alt="תמונת פרופיל" />
                                <AvatarFallback className="text-2xl">{getInitials()}</AvatarFallback>
                            </Avatar>
                        )}

                        <div className="flex-1 space-y-2">
                            {/* Hidden inputs — camera and gallery */}
                            <input
                                id="passport-upload-camera"
                                type="file"
                                accept="image/*"
                                capture="environment"
                                onChange={handlePassportUpload}
                                disabled={isProcessingPassport}
                                className="hidden"
                            />
                            <input
                                id="passport-upload-gallery"
                                type="file"
                                accept="image/*,application/pdf"
                                onChange={handlePassportUpload}
                                disabled={isProcessingPassport}
                                className="hidden"
                            />

                            {isProcessingPassport ? (
                                <Button type="button" variant="outline" disabled className="w-full sm:w-auto">
                                    <Loader2 className="w-4 h-4 ml-2 animate-spin" />
                                    מעבד דרכון...
                                </Button>
                            ) : (
                                <div className="flex gap-2 flex-wrap">
                                    <Button
                                        type="button"
                                        variant="outline"
                                        className="flex-1 sm:flex-none border-blue-300 text-blue-700 hover:bg-blue-50"
                                        onClick={() => document.getElementById('passport-upload-camera')?.click()}
                                    >
                                        <Camera className="w-4 h-4 ml-2" />
                                        צלם דרכון
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        className="flex-1 sm:flex-none"
                                        onClick={() => document.getElementById('passport-upload-gallery')?.click()}
                                    >
                                        <Upload className="w-4 h-4 ml-2" />
                                        בחר מהגלריה
                                    </Button>
                                </div>
                            )}

                            {passportImageUrl && (
                                <a
                                    href={withToken(passportImageUrl)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1"
                                >
                                    <FileText className="w-4 h-4" />
                                    צפה בדרכון שהועלה
                                </a>
                            )}
                        </div>
                    </div>

                    {isProcessingPassport && (
                        <div className="bg-blue-100 border border-blue-300 rounded-lg p-3 text-sm text-blue-800">
                            <div className="flex items-center gap-2">
                                <Loader2 className="w-4 h-4 animate-spin" />
                                <span>מעבד את תמונת הדרכון ומחלץ נתונים...</span>
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* פרטים אישיים */}
            <Card>
                <CardHeader><CardTitle>פרטים אישיים</CardTitle></CardHeader>
                <CardContent className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    <div>
                        <Label>שם פרטי*</Label>
                        <Input name="first_name" value={formData.first_name || ''} onChange={handleChange} required />
                    </div>
                    <div>
                        <Label>שם משפחה*</Label>
                        <Input name="last_name" value={formData.last_name || ''} onChange={handleChange} required />
                    </div>
                    <div>
                        <Label>כינוי</Label>
                        <Input name="nickname" value={formData.nickname || ''} onChange={handleChange} />
                    </div>
                    <div>
                        <Label>מדינת מוצא</Label>
                        <Input name="country_of_origin" value={formData.country_of_origin || ''} onChange={handleChange} />
                    </div>
                    <div>
                        <Label>סטטוס*</Label>
                        <Select name="status" value={formData.status} onValueChange={(v) => handleSelectChange('status', v)}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                                {Object.entries(statusTranslations).map(([key, value]) => (
                                    <SelectItem key={key} value={key}>{value}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </CardContent>
            </Card>

            {/* פרטי העסקה */}
            <Card>
                <CardHeader><CardTitle>פרטי העסקה</CardTitle></CardHeader>
                <CardContent className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    <div>
                        <Label>תאריך תחילת עבודה*</Label>
                        <Input type="date" name="start_date" value={formData.start_date || ''} onChange={handleChange} required />
                    </div>
                    <div>
                        <Label>תאריך כניסה לארץ</Label>
                        <Input type="date" name="entry_date" value={formData.entry_date || ''} onChange={handleChange} />
                    </div>
                    <div>
                        <Label>חברת כח אדם</Label>
                        <Select name="manpower_company_id" value={formData.manpower_company_id || '__none__'} onValueChange={(v) => handleSelectChange('manpower_company_id', v)}>
                            <SelectTrigger><SelectValue placeholder="בחר חברה" /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="__none__">ללא</SelectItem>
                                {manpowerCompanies.map(company => (
                                    <SelectItem key={company.id} value={company.id}>{company.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div>
                        <Label>מנהל ישיר</Label>
                        <Select name="manager_id" value={formData.manager_id || '__none__'} onValueChange={(v) => handleSelectChange('manager_id', v)}>
                            <SelectTrigger><SelectValue placeholder="בחר מנהל" /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="__none__">ללא</SelectItem>
                                {users.map(user => (
                                    <SelectItem key={user.id} value={user.id}>{user.full_name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </CardContent>
            </Card>

            {/* דרכון ואשרה */}
            <Card>
                <CardHeader><CardTitle>דרכון ואשרה</CardTitle></CardHeader>
                <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-4">
                        <h4 className="font-semibold">פרטי דרכון</h4>
                        <div>
                            <Label>מספר דרכון</Label>
                            <Input name="passport_number" value={formData.passport_number || ''} onChange={handleChange} />
                        </div>
                        <div>
                            <Label>תוקף דרכון</Label>
                            <Input type="date" name="passport_expiry" value={formData.passport_expiry || ''} onChange={handleChange} />
                        </div>
                    </div>
                    <div className="space-y-4">
                        <h4 className="font-semibold">פרטי אשרה</h4>
                        <div>
                            <Label>סוג אשרה</Label>
                            <Input name="visa_type" value={formData.visa_type || ''} onChange={handleChange} />
                        </div>
                        <div>
                            <Label>תוקף אשרה</Label>
                            <Input type="date" name="visa_expiry" value={formData.visa_expiry || ''} onChange={handleChange} />
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* ביטוח וקופ"ח */}
            <Card>
                <CardHeader><CardTitle>ביטוח וקופת חולים</CardTitle></CardHeader>
                <CardContent className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    <div>
                        <Label>חברת ביטוח</Label>
                        <Input name="company" value={formData.insurance_details?.company || ''} onChange={(e) => handleNestedChange('insurance_details', e)} />
                    </div>
                    <div>
                        <Label>מספר פוליסה</Label>
                        <Input name="policy_number" value={formData.insurance_details?.policy_number || ''} onChange={(e) => handleNestedChange('insurance_details', e)} />
                    </div>
                    <div>
                        <Label>קופת חולים</Label>
                        <Input name="health_fund" value={formData.insurance_details?.health_fund || ''} onChange={(e) => handleNestedChange('insurance_details', e)} />
                    </div>
                    <div>
                        <Label>מספר בנה"ח</Label>
                        <Input name="bnhc_number" value={formData.bnhc_number || ''} onChange={handleChange} />
                    </div>
                    <div>
                        <Label>מספר בקופ"ח</Label>
                        <Input name="health_fund_number" value={formData.insurance_details?.health_fund_number || ''} onChange={(e) => handleNestedChange('insurance_details', e)} />
                    </div>

                    {/* Document uploads — full row */}
                    <div className="md:col-span-2 lg:col-span-3 grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t">
                        {/* Insurance policy document */}
                        <div className="space-y-1">
                            <Label className="text-xs text-gray-500">מסמך פוליסת ביטוח</Label>
                            <input
                                id="policy-doc-upload"
                                type="file"
                                accept="image/*,application/pdf"
                                onChange={(e) => handleDocUpload(e, 'insurance_details.policy_url')}
                                disabled={uploadingDoc['insurance_details.policy_url']}
                                className="hidden"
                            />
                            <div className="flex items-center gap-2">
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    disabled={uploadingDoc['insurance_details.policy_url']}
                                    onClick={() => document.getElementById('policy-doc-upload')?.click()}
                                    className="flex-shrink-0"
                                >
                                    {uploadingDoc['insurance_details.policy_url']
                                        ? <Loader2 className="w-3.5 h-3.5 ml-1.5 animate-spin" />
                                        : <Paperclip className="w-3.5 h-3.5 ml-1.5" />}
                                    {formData.insurance_details?.policy_url ? 'החלף' : 'העלה מסמך'}
                                </Button>
                                {formData.insurance_details?.policy_url && (
                                    <a href={withToken(formData.insurance_details.policy_url)} target="_blank" rel="noopener noreferrer"
                                        className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1">
                                        <FileText className="w-3.5 h-3.5" />צפה
                                    </a>
                                )}
                            </div>
                        </div>

                        {/* Health fund document */}
                        <div className="space-y-1">
                            <Label className="text-xs text-gray-500">מסמך קופת חולים</Label>
                            <input
                                id="health-fund-doc-upload"
                                type="file"
                                accept="image/*,application/pdf"
                                onChange={(e) => handleDocUpload(e, 'insurance_details.health_fund_url')}
                                disabled={uploadingDoc['insurance_details.health_fund_url']}
                                className="hidden"
                            />
                            <div className="flex items-center gap-2">
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    disabled={uploadingDoc['insurance_details.health_fund_url']}
                                    onClick={() => document.getElementById('health-fund-doc-upload')?.click()}
                                    className="flex-shrink-0"
                                >
                                    {uploadingDoc['insurance_details.health_fund_url']
                                        ? <Loader2 className="w-3.5 h-3.5 ml-1.5 animate-spin" />
                                        : <Paperclip className="w-3.5 h-3.5 ml-1.5" />}
                                    {formData.insurance_details?.health_fund_url ? 'החלף' : 'העלה מסמך'}
                                </Button>
                                {formData.insurance_details?.health_fund_url && (
                                    <a href={withToken(formData.insurance_details.health_fund_url)} target="_blank" rel="noopener noreferrer"
                                        className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1">
                                        <FileText className="w-3.5 h-3.5" />צפה
                                    </a>
                                )}
                            </div>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* פרטי בנק */}
            <Card>
                <CardHeader><CardTitle>פרטי בנק</CardTitle></CardHeader>
                <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                        <Label>שם בנק</Label>
                        <Input name="bank_name" value={formData.bank_details?.bank_name || ''} onChange={(e) => handleNestedChange('bank_details', e)} />
                    </div>
                    <div>
                        <Label>מספר סניף</Label>
                        <Input name="branch_number" value={formData.bank_details?.branch_number || ''} onChange={(e) => handleNestedChange('bank_details', e)} />
                    </div>
                    <div>
                        <Label>מספר חשבון</Label>
                        <Input name="account_number" value={formData.bank_details?.account_number || ''} onChange={(e) => handleNestedChange('bank_details', e)} />
                    </div>
                </CardContent>
            </Card>

            {/* חוזה העסקה */}
            <Card>
                <CardHeader><CardTitle>חוזה העסקה</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                    <div className="text-sm text-gray-500">העלה חוזה העסקה חתום — תמונה או PDF</div>
                    <input
                        id="contract-upload-camera"
                        type="file"
                        accept="image/*"
                        capture="environment"
                        onChange={(e) => handleDocUpload(e, 'contract_url')}
                        disabled={uploadingDoc['contract_url']}
                        className="hidden"
                    />
                    <input
                        id="contract-upload-gallery"
                        type="file"
                        accept="image/*,application/pdf"
                        onChange={(e) => handleDocUpload(e, 'contract_url')}
                        disabled={uploadingDoc['contract_url']}
                        className="hidden"
                    />
                    <div className="flex gap-2 flex-wrap items-center">
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={uploadingDoc['contract_url']}
                            onClick={() => document.getElementById('contract-upload-camera')?.click()}
                            className="border-blue-200 text-blue-700 hover:bg-blue-50"
                        >
                            {uploadingDoc['contract_url']
                                ? <Loader2 className="w-4 h-4 ml-1.5 animate-spin" />
                                : <Camera className="w-4 h-4 ml-1.5" />}
                            צלם חוזה
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={uploadingDoc['contract_url']}
                            onClick={() => document.getElementById('contract-upload-gallery')?.click()}
                        >
                            {uploadingDoc['contract_url']
                                ? <Loader2 className="w-4 h-4 ml-1.5 animate-spin" />
                                : <Paperclip className="w-4 h-4 ml-1.5" />}
                            {formData.contract_url ? 'החלף' : 'בחר קובץ'}
                        </Button>
                        {formData.contract_url && (
                            <a href={withToken(formData.contract_url)} target="_blank" rel="noopener noreferrer"
                                className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1">
                                <FileText className="w-4 h-4" />
                                צפה בחוזה
                            </a>
                        )}
                    </div>
                    {formData.contract_url && (
                        <p className="text-xs text-green-600 flex items-center gap-1">
                            <ImagePlus className="w-3 h-3" />
                            חוזה הועלה
                        </p>
                    )}
                </CardContent>
            </Card>

            {/* הערות */}
            <Card>
                <CardHeader><CardTitle>הערות</CardTitle></CardHeader>
                <CardContent>
                    <Textarea name="notes" value={formData.notes || ''} onChange={handleChange} rows={4} />
                </CardContent>
            </Card>

            <div className="flex justify-end gap-4 pt-4">
                <Button type="button" variant="outline" onClick={onClose}>ביטול</Button>
                <Button type="submit" disabled={isSubmitting || isProcessingPassport}>
                    {isSubmitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                    {employee?.id ? 'שמור שינויים' : 'צור עובד'}
                </Button>
            </div>
        </form>
    );
}
