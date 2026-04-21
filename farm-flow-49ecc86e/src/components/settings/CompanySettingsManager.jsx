
import React, { useState, useEffect, useCallback } from "react";
import { CompanySettings } from "@/entities/all"; // Removed User and Farm
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useToast } from "@/components/ui/use-toast";
import { Loader2, Upload, Trash2, Plus } from "lucide-react";
import { UploadFile } from "@/integrations/Core";

export default function CompanySettingsManager({ currentFarm }) { // currentFarm is now a prop
  const [settings, setSettings] = useState(null);
  const [formData, setFormData] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  // const [currentFarm, setCurrentFarm] = useState(null); // Removed this state
  const { toast } = useToast();

  const loadSettings = useCallback(async (farmId) => {
    setIsLoading(true);
    // Filter settings by the current farm's ID
    const settingsList = await CompanySettings.filter({ farm_id: farmId });
    if (settingsList.length > 0) {
      const existingSettings = settingsList[0];
      setSettings(existingSettings);
      setFormData({
        ...existingSettings,
        certifications: existingSettings.certifications || [],
        main_crops: existingSettings.main_crops || []
      });
    } else {
      setSettings(null);
      setFormData({ certifications: [], main_crops: [] });
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    // React to currentFarm prop changes
    if (currentFarm) {
      loadSettings(currentFarm.id);
    } else {
      setIsLoading(false);
      setSettings(null); // Clear settings if no farm is selected
      setFormData({ certifications: [], main_crops: [] }); // Clear form data
    }
  }, [currentFarm, loadSettings]); // Dependency on currentFarm and loadSettings

  const handleInputChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };
  
  const handleCertificationChange = (index, field, value) => {
    const updated = [...formData.certifications];
    updated[index][field] = value;
    setFormData(prev => ({ ...prev, certifications: updated }));
  };

  const addCertification = () => {
    setFormData(prev => ({ ...prev, certifications: [...prev.certifications, { name: "", number: "", expiry_date: "" }] }));
  };

  const removeCertification = (index) => {
    const updated = [...formData.certifications];
    updated.splice(index, 1);
    setFormData(prev => ({ ...prev, certifications: updated }));
  };

  const handleCropsChange = (cropsString) => {
    const cropsArray = cropsString.split(',').map(crop => crop.trim()).filter(crop => crop.length > 0);
    setFormData(prev => ({ ...prev, main_crops: cropsArray }));
  };

  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setIsUploading(true);
    try {
      const { file_url } = await UploadFile({ file });
      handleInputChange('logo_url', file_url);
      toast({ title: "הצלחה", description: "הלוגו הועלה בהצלחה." });
    } catch (error) {
      toast({ title: "שגיאה", description: "העלאת הלוגו נכשלה.", variant: "destructive" });
    } finally {
      setIsUploading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!currentFarm) {
        toast({ title: "שגיאה", description: "לא נבחר משק פעיל. לא ניתן לשמור הגדרות.", variant: "destructive"});
        return;
    }
    setIsLoading(true);
    try {
      if (settings) {
        await CompanySettings.update(settings.id, formData);
      } else {
        // When creating new settings, associate them with the current farm
        await CompanySettings.create({ ...formData, farm_id: currentFarm.id });
      }
      toast({ title: "הצלחה", description: "הגדרות החברה עודכנו." });
      // Reload settings for the current farm after submission
      loadSettings(currentFarm.id);
    } catch (error) {
      toast({ title: "שגיאה", description: "עדכון ההגדרות נכשל.", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return <div className="flex justify-center items-center h-40"><Loader2 className="w-8 h-8 animate-spin" /></div>;
  }
  
  // If no current farm is selected/found after loading
  if (!currentFarm) {
      return (
          <Card>
              <CardHeader>
                  <CardTitle>הגדרות חברה/משק</CardTitle>
              </CardHeader>
              <CardContent>
                  <p className="py-4 text-center text-gray-500">יש לבחור משק פעיל על מנת לנהל את הגדרותיו.</p>
              </CardContent>
          </Card>
      );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>הגדרות חברה/משק - {currentFarm.name}</CardTitle>
        <CardDescription>ניהול הפרטים הכלליים של העסק, המשמשים להדפסות ודוחות.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-8">
          {/* Company Details */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="md:col-span-1 space-y-4">
               <div>
                  <Label>לוגו</Label>
                  <Input id="logo_upload" type="file" accept="image/*" onChange={handleFileChange} className="hidden" />
                  <div className="mt-2 flex items-center gap-4">
                    {formData.logo_url && <img src={formData.logo_url} alt="לוגו" className="h-16 w-16 rounded-md border object-cover" />}
                    <Label htmlFor="logo_upload" className="w-full">
                      <Button type="button" variant="outline" className="w-full cursor-pointer" disabled={isUploading}>
                        {isUploading ? <Loader2 className="w-4 h-4 ml-2 animate-spin" /> : <Upload className="w-4 h-4 ml-2" />}
                        {isUploading ? "מעלה..." : (formData.logo_url ? "החלף לוגו" : "העלה לוגו")}
                      </Button>
                    </Label>
                  </div>
                </div>
            </div>
            
            <div className="md:col-span-2 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label>שם החברה/המשק</Label>
                  <Input value={formData.company_name || ""} onChange={e => handleInputChange('company_name', e.target.value)} required />
                </div>
                <div>
                  <Label>סוג הישות</Label>
                  <Select value={formData.company_type || ""} onValueChange={v => handleInputChange('company_type', v)}>
                    <SelectTrigger><SelectValue placeholder="בחר סוג..." /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="farm">משק</SelectItem>
                      <SelectItem value="cooperative">קואופרטיב</SelectItem>
                      <SelectItem value="company">חברה</SelectItem>
                      <SelectItem value="moshav">מושב</SelectItem>
                      <SelectItem value="kibbutz">קיבוץ</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label>מספר עוסק מורשה</Label>
                  <Input value={formData.business_number || ""} onChange={e => handleInputChange('business_number', e.target.value)} />
                </div>
                <div>
                  <Label>מספר מזהה/ח.פ</Label>
                  <Input value={formData.tax_number || ""} onChange={e => handleInputChange('tax_number', e.target.value)} />
                </div>
              </div>
            </div>
          </div>

          {/* Contact Information */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">פרטי קשר</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>כתובת</Label>
                <Input value={formData.address || ""} onChange={e => handleInputChange('address', e.target.value)} />
              </div>
              <div>
                <Label>עיר</Label>
                <Input value={formData.city || ""} onChange={e => handleInputChange('city', e.target.value)} />
              </div>
              <div>
                <Label>מיקוד</Label>
                <Input value={formData.postal_code || ""} onChange={e => handleInputChange('postal_code', e.target.value)} />
              </div>
              <div>
                <Label>טלפון</Label>
                <Input value={formData.phone || ""} onChange={e => handleInputChange('phone', e.target.value)} />
              </div>
              <div>
                <Label>פקס</Label>
                <Input value={formData.fax || ""} onChange={e => handleInputChange('fax', e.target.value)} />
              </div>
              <div>
                <Label>אימייל</Label>
                <Input type="email" value={formData.email || ""} onChange={e => handleInputChange('email', e.target.value)} />
              </div>
            </div>
          </div>

          {/* Additional Details */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">פרטים נוספים</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <Label>איש קשר ראשי</Label>
                <Input value={formData.contact_person || ""} onChange={e => handleInputChange('contact_person', e.target.value)} />
              </div>
              <div>
                <Label>תאריך הקמה</Label>
                <Input type="date" value={formData.established_date || ""} onChange={e => handleInputChange('established_date', e.target.value)} />
              </div>
              <div>
                <Label>שטח כולל (דונם)</Label>
                <Input type="number" value={formData.total_farm_area || ""} onChange={e => handleInputChange('total_farm_area', parseFloat(e.target.value) || 0)} />
              </div>
            </div>
            
            <div>
              <Label>גידולים עיקריים</Label>
              <Input 
                placeholder="הזן גידולים מופרדים בפסיקים" 
                value={formData.main_crops ? formData.main_crops.join(', ') : ""} 
                onChange={e => handleCropsChange(e.target.value)} 
              />
            </div>
          </div>

          {/* Bank Details */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">פרטי בנק</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <Label>שם הבנק</Label>
                <Input value={formData.bank_name || ""} onChange={e => handleInputChange('bank_name', e.target.value)} />
              </div>
              <div>
                <Label>מספר סניף</Label>
                <Input value={formData.bank_branch || ""} onChange={e => handleInputChange('bank_branch', e.target.value)} />
              </div>
              <div>
                <Label>מספר חשבון</Label>
                <Input value={formData.bank_account || ""} onChange={e => handleInputChange('bank_account', e.target.value)} />
              </div>
            </div>
          </div>

          {/* Certifications */}
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-semibold">תעודות הסמכה</h3>
              <Button type="button" variant="outline" size="sm" onClick={addCertification}>
                <Plus className="w-4 h-4 ml-2" />
                הוסף תעודה
              </Button>
            </div>
            {formData.certifications && formData.certifications.map((cert, index) => (
              <div key={index} className="grid grid-cols-1 md:grid-cols-4 gap-4 p-4 border rounded-lg">
                <div>
                  <Label>שם התעודה</Label>
                  <Input value={cert.name || ""} onChange={e => handleCertificationChange(index, 'name', e.target.value)} />
                </div>
                <div>
                  <Label>מספר תעודה</Label>
                  <Input value={cert.number || ""} onChange={e => handleCertificationChange(index, 'number', e.target.value)} />
                </div>
                <div>
                  <Label>תאריך תוקף</Label>
                  <Input type="date" value={cert.expiry_date || ""} onChange={e => handleCertificationChange(index, 'expiry_date', e.target.value)} />
                </div>
                <div className="flex items-end">
                  <Button type="button" variant="outline" size="sm" onClick={() => removeCertification(index)}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>

          {/* Notes */}
          <div>
            <Label>הערות כלליות</Label>
            <Input value={formData.notes || ""} onChange={e => handleInputChange('notes', e.target.value)} />
          </div>

          <Button type="submit" disabled={isLoading}>
            {isLoading && <Loader2 className="w-4 h-4 ml-2 animate-spin" />}
            {settings ? "עדכן הגדרות" : "צור הגדרות"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
