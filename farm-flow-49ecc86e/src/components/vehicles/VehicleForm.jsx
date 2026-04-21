import React, { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/use-toast";
import { Loader2, Upload, FileText, Camera } from "lucide-react";
import { Vehicle } from '@/entities/all';
import { getToken } from '@/api/localClient';
import { format } from "date-fns";

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

// Append token to /uploads URLs so the server can authenticate static file requests
function withToken(url) {
    if (!url) return url;
    const token = getToken();
    if (!token || !url.startsWith('/uploads')) return url;
    return `${url}?token=${encodeURIComponent(token)}`;
}

async function uploadFile(file) {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch(`${BASE_URL}/upload`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${getToken()}` },
    body: fd
  });
  if (!res.ok) throw new Error('העלאת הקובץ נכשלה');
  return res.json();
}

const vehicleTypeTranslations = {
    tractor: "טרקטור",
    private_car: "רכב פרטי",
    truck: "משאית",
    harvester: "קומביין",
    sprayer: "מרסס",
    forklift: "מלגזה",
    other: "אחר"
};

export default function VehicleForm({ vehicle, currentFarm, onSuccess, onCancel }) {
    const { toast } = useToast();
    const [formData, setFormData] = useState({
        name: '', type: 'tractor', license_plate: '', purchase_date: '',
        year: '', manufacturer: '', model: '', status: 'active', notes: '', photo_url: '',
        insurance_info: { policy_number: '', provider: '', start_date: '', end_date: '', cost: '', policy_url: '' },
        licensing_info: { last_test_date: '', next_test_date: '' }
    });
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isProcessingLicense, setIsProcessingLicense] = useState(false);
    const [licenseImageUrl, setLicenseImageUrl] = useState(null);

    useEffect(() => {
        const initialData = {
            name: vehicle?.name || '',
            type: vehicle?.type || 'tractor',
            license_plate: vehicle?.license_plate || '',
            purchase_date: vehicle?.purchase_date ? format(new Date(vehicle.purchase_date), 'yyyy-MM-dd') : '',
            year: vehicle?.year || '',
            manufacturer: vehicle?.manufacturer || '',
            model: vehicle?.model || '',
            status: vehicle?.status || 'active',
            notes: vehicle?.notes || '',
            photo_url: vehicle?.photo_url || '',
            insurance_info: {
                policy_number: vehicle?.insurance_info?.policy_number || '',
                provider: vehicle?.insurance_info?.provider || '',
                start_date: vehicle?.insurance_info?.start_date ? format(new Date(vehicle.insurance_info.start_date), 'yyyy-MM-dd') : '',
                end_date: vehicle?.insurance_info?.end_date ? format(new Date(vehicle.insurance_info.end_date), 'yyyy-MM-dd') : '',
                cost: vehicle?.insurance_info?.cost || '',
                policy_url: vehicle?.insurance_info?.policy_url || ''
            },
            licensing_info: {
                last_test_date: vehicle?.licensing_info?.last_test_date ? format(new Date(vehicle.licensing_info.last_test_date), 'yyyy-MM-dd') : '',
                next_test_date: vehicle?.licensing_info?.next_test_date ? format(new Date(vehicle.licensing_info.next_test_date), 'yyyy-MM-dd') : '',
            }
        };
        setFormData(initialData);
        
        // If there's already a license image URL, set it
        if (vehicle?.insurance_info?.policy_url) {
            setLicenseImageUrl(vehicle.insurance_info.policy_url);
        }
    }, [vehicle]);

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
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleLicenseUpload = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const allowed = /^image\//i.test(file.type) || /\.(jpg|jpeg|png|gif|webp|pdf)$/i.test(file.name);
        if (!allowed) {
            toast({ title: "שגיאה", description: "נא להעלות קובץ תמונה או PDF", variant: "destructive" });
            return;
        }

        setIsProcessingLicense(true);
        toast({ title: "מעלה רשיון רכב...", description: file.name });

        try {
            // Step 1: Upload
            const { file_url } = await uploadFile(file);
            setLicenseImageUrl(file_url);
            setFormData(prev => ({ ...prev, insurance_info: { ...prev.insurance_info, policy_url: file_url } }));

            // Step 2: Extract data (AI or OCR fallback)
            toast({ title: "מחלץ נתוני רכב...", description: "סורק את הרשיון..." });
            const extractRes = await fetch(`${BASE_URL}/extract-document`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
                body: JSON.stringify({ file_url, document_type: 'vehicle_license' })
            });
            const extractResult = await extractRes.json();

            if (extractResult.success && extractResult.data) {
                const d = extractResult.data;
                const updates = {};
                if (d.license_plate  && !formData.license_plate)  updates.license_plate  = d.license_plate;
                if (d.manufacturer   && !formData.manufacturer)   updates.manufacturer   = d.manufacturer;
                if (d.model          && !formData.model)          updates.model          = d.model;
                if (d.year           && !formData.year)           updates.year           = String(d.year);
                const licensingUpdates = {};
                if (d.last_test_date) licensingUpdates.last_test_date = d.last_test_date;
                if (d.next_test_date) licensingUpdates.next_test_date = d.next_test_date;
                setFormData(prev => ({
                    ...prev, ...updates,
                    licensing_info: { ...prev.licensing_info, ...licensingUpdates }
                }));
                const count = Object.keys(updates).length + Object.keys(licensingUpdates).length;
                toast({
                    title: count > 0 ? `חולצו ${count} שדות!` : "הרשיון הועלה",
                    description: count > 0 ? "בדוק את הנתונים ותקן במידת הצורך" : "מלא את הפרטים ידנית"
                });
            } else {
                toast({ title: "הרשיון הועלה", description: extractResult.error || "מלא את הפרטים ידנית" });
            }
        } catch (error) {
            toast({ title: "שגיאה", description: error.message, variant: "destructive" });
        } finally {
            setIsProcessingLicense(false);
        }
    };
    
    const handleSubmit = async (e) => {
        e.preventDefault();
        setIsSubmitting(true);
        try {
            const dataToSave = {
                ...formData,
                farm_id: currentFarm.id,
                year: formData.year ? parseInt(formData.year) : null,
                insurance_info: {
                    ...formData.insurance_info,
                    cost: formData.insurance_info.cost ? parseFloat(formData.insurance_info.cost) : null,
                }
            };
            if (vehicle?.id) {
                await Vehicle.update(vehicle.id, dataToSave);
            } else {
                await Vehicle.create(dataToSave);
            }
            toast({ title: "הצלחה", description: "פרטי הרכב נשמרו" });
            onSuccess();
        } catch (error) {
            console.error("Failed to save vehicle:", error);
            toast({ title: "שגיאה", description: "שמירת הרכב נכשלה", variant: "destructive" });
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-6">
            {/* העלאת תמונת רשיון */}
            <Card className="bg-blue-50 border-blue-200">
                <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                        <Camera className="w-5 h-5 text-blue-600" />
                        העלאת רשיון רכב (אוטומטי)
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="text-sm text-gray-600">
                        העלה תמונה של רשיון הרכב, והמערכת תמלא אוטומטית את הפרטים
                    </div>
                    
                    <div className="flex items-center gap-4">
                        <Input
                            id="license-upload"
                            type="file"
                            accept="image/*"
                            capture="environment"
                            onChange={handleLicenseUpload}
                            disabled={isProcessingLicense}
                            className="hidden"
                        />
                        <Label htmlFor="license-upload" className="cursor-pointer">
                            <Button
                                type="button"
                                variant="outline"
                                disabled={isProcessingLicense}
                                className="w-full sm:w-auto"
                                onClick={() => document.getElementById('license-upload')?.click()}
                            >
                                {isProcessingLicense ? (
                                    <>
                                        <Loader2 className="w-4 h-4 ml-2 animate-spin" />
                                        מעבד תמונה...
                                    </>
                                ) : (
                                    <>
                                        <Upload className="w-4 h-4 ml-2" />
                                        העלה תמונת רשיון
                                    </>
                                )}
                            </Button>
                        </Label>

                        {licenseImageUrl && (
                            <a
                                href={withToken(licenseImageUrl)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1"
                            >
                                <FileText className="w-4 h-4" />
                                צפה ברשיון שהועלה
                            </a>
                        )}
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader><CardTitle>פרטים כלליים</CardTitle></CardHeader>
                <CardContent className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    <div><Label>שם/כינוי רכב*</Label><Input name="name" value={formData.name || ''} onChange={handleChange} required /></div>
                    <div><Label>מספר רישוי*</Label><Input name="license_plate" value={formData.license_plate || ''} onChange={handleChange} required /></div>
                    <div><Label>סוג רכב*</Label><Select name="type" value={formData.type} onValueChange={(v) => handleSelectChange('type', v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(vehicleTypeTranslations).map(([key, value]) => <SelectItem key={key} value={key}>{value}</SelectItem>)}</SelectContent></Select></div>
                    <div><Label>יצרן</Label><Input name="manufacturer" value={formData.manufacturer || ''} onChange={handleChange} /></div>
                    <div><Label>דגם</Label><Input name="model" value={formData.model || ''} onChange={handleChange} /></div>
                    <div><Label>שנת ייצור</Label><Input type="number" name="year" value={formData.year || ''} onChange={handleChange} /></div>
                    <div><Label>תאריך רכישה</Label><Input type="date" name="purchase_date" value={formData.purchase_date || ''} onChange={handleChange} /></div>
                    <div><Label>סטטוס</Label><Select name="status" value={formData.status} onValueChange={(v) => handleSelectChange('status', v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="active">פעיל</SelectItem><SelectItem value="in_service">בטיפול</SelectItem><SelectItem value="sold">נמכר</SelectItem><SelectItem value="out_of_order">מושבת</SelectItem></SelectContent></Select></div>
                </CardContent>
            </Card>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Card>
                    <CardHeader><CardTitle>פרטי ביטוח</CardTitle></CardHeader>
                    <CardContent className="space-y-4">
                        <div><Label>חברת ביטוח</Label><Input name="provider" value={formData.insurance_info?.provider || ''} onChange={(e) => handleNestedChange('insurance_info', e)} /></div>
                        <div><Label>מספר פוליסה</Label><Input name="policy_number" value={formData.insurance_info?.policy_number || ''} onChange={(e) => handleNestedChange('insurance_info', e)} /></div>
                        <div><Label>תאריך תחילת ביטוח</Label><Input type="date" name="start_date" value={formData.insurance_info?.start_date || ''} onChange={(e) => handleNestedChange('insurance_info', e)} /></div>
                        <div><Label>תאריך סיום ביטוח</Label><Input type="date" name="end_date" value={formData.insurance_info?.end_date || ''} onChange={(e) => handleNestedChange('insurance_info', e)} /></div>
                        <div><Label>עלות</Label><Input type="number" name="cost" value={formData.insurance_info?.cost || ''} onChange={(e) => handleNestedChange('insurance_info', e)} /></div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader><CardTitle>פרטי רישוי (טסט)</CardTitle></CardHeader>
                    <CardContent className="space-y-4">
                        <div><Label>תאריך טסט אחרון</Label><Input type="date" name="last_test_date" value={formData.licensing_info?.last_test_date || ''} onChange={(e) => handleNestedChange('licensing_info', e)} /></div>
                        <div><Label>תאריך טסט הבא</Label><Input type="date" name="next_test_date" value={formData.licensing_info?.next_test_date || ''} onChange={(e) => handleNestedChange('licensing_info', e)} /></div>
                    </CardContent>
                </Card>
            </div>
            
            <Card>
                <CardHeader><CardTitle>הערות</CardTitle></CardHeader>
                <CardContent><Textarea name="notes" value={formData.notes || ''} onChange={handleChange} /></CardContent>
            </Card>

            <div className="flex justify-end gap-4 pt-4">
                <Button type="button" variant="outline" onClick={onCancel}>ביטול</Button>
                <Button type="submit" disabled={isSubmitting || isProcessingLicense}>
                    {isSubmitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                    {vehicle?.id ? 'שמור שינויים' : 'צור רכב'}
                </Button>
            </div>
        </form>
    );
}