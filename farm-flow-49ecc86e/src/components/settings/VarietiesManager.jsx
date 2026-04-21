import React, { useState, useEffect } from "react";
import { Variety, Crop } from "@/entities/all";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Trash2, Edit, Loader2, Sprout } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { useNavigate } from "react-router-dom";

export default function VarietiesManager({ currentFarm, onNavigateToTab }) {
  const navigate = useNavigate();
  const [varieties, setVarieties] = useState([]);
  const [crops, setCrops] = useState([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingVariety, setEditingVariety] = useState(null);
  const [activeTab, setActiveTab] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isDeletingId, setIsDeletingId] = useState(null);
  const { toast } = useToast();
  
  const [formData, setFormData] = useState({
    name: "",
    crop_type: "",
    marketing_company: "",
    manufacturer: "",
    recommended_planting_start: "",
    recommended_planting_end: "",
    notes: ""
  });

  const resetForm = () => {
    setFormData({
      name: "",
      crop_type: activeTab,
      marketing_company: "",
      manufacturer: "",
      recommended_planting_start: "",
      recommended_planting_end: "",
      notes: ""
    });
    setEditingVariety(null);
  };

  const monthOptions = [
    "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני",
    "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"
  ];

  useEffect(() => {
    loadVarieties();
  }, [currentFarm?.id]);

  const loadVarieties = async () => {
    if (!currentFarm?.id) {
      setVarieties([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const data = await Variety.list();
      
      // STRONG client-side filter
      const filtered = Array.isArray(data) 
        ? data.filter(item => item.farm_id === currentFarm.id)
        : [];
      
      setVarieties(filtered);
    } catch (error) {
      console.error("Failed to load varieties:", error);
      setVarieties([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadCrops();
  }, [currentFarm?.id]);

  const loadCrops = async () => {
    if (!currentFarm?.id) {
      setCrops([]);
      setActiveTab("");
      return;
    }

    try {
      const cropsDataResult = await Crop.list();
      
      // STRONG client-side filter
      const safeCrops = Array.isArray(cropsDataResult) 
        ? cropsDataResult.filter(item => item.farm_id === currentFarm.id)
        : [];
      
      setCrops(safeCrops);
      
      if (safeCrops.length > 0 && (!activeTab || !safeCrops.some(c => c.name === activeTab))) {
        setActiveTab(safeCrops[0].name);
      } else if (safeCrops.length === 0) {
        setActiveTab("");
      }
    } catch (error) {
      console.error("Failed to load crops:", error);
      setCrops([]);
      setActiveTab("");
    }
  };

  const handleAdd = () => {
    resetForm();
    setIsDialogOpen(true);
  };

  const handleEdit = (variety) => {
    setEditingVariety(variety);
    setFormData({
      name: variety.name,
      crop_type: variety.crop_type,
      marketing_company: variety.marketing_company || "",
      manufacturer: variety.manufacturer || "",
      recommended_planting_start: variety.recommended_planting_start || "",
      recommended_planting_end: variety.recommended_planting_end || "",
      notes: variety.notes || ""
    });
    setIsDialogOpen(true);
  };

  const handleDelete = async (varietyId) => {
    if (!confirm("האם אתה בטוח שברצונך למחוק זן זה?")) {
      return;
    }
    
    setIsDeletingId(varietyId);
    
    try {
      await Variety.delete(varietyId);
      
      toast({ 
        title: "הצלחה", 
        description: "הזן נמחק בהצלחה" 
      });
      
      await loadVarieties();
      
    } catch (error) {
      console.error("Delete error:", error);
      
      if (error.response?.status === 404) {
        toast({
          title: "הזן כבר לא קיים",
          description: "ייתכן שהזן כבר נמחק. מרענן את הרשימה...",
          variant: "destructive"
        });
        await loadVarieties();
      } else {
        toast({
          title: "שגיאה במחיקה",
          description: error.message || "אירעה שגיאה במחיקת הזן. נסה שוב.",
          variant: "destructive"
        });
      }
    } finally {
      setIsDeletingId(null);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!currentFarm) {
      toast({ title: "שגיאה", description: "לא נבחר משק פעיל", variant: "destructive" });
      return;
    }

    if (!formData.name || !formData.crop_type) {
      toast({
        title: "שגיאה",
        description: "נא למלא את כל השדות הנדרשים",
        variant: "destructive"
      });
      return;
    }
    
    const dataToSend = { ...formData, farm_id: currentFarm.id };
    
    console.log('VarietiesManager - Saving variety:', dataToSend);
    
    try {
      if (editingVariety) {
        await Variety.update(editingVariety.id, dataToSend);
        toast({ 
          title: "הצלחה", 
          description: "הזן עודכן בהצלחה" 
        });
      } else {
        const created = await Variety.create(dataToSend);
        console.log('VarietiesManager - Created variety:', created);
        toast({ 
          title: "הצלחה", 
          description: "הזן נוסף בהצלחה" 
        });
      }
      
      setIsDialogOpen(false);
      resetForm();
      await loadVarieties();
      
    } catch (error) {
      console.error("Submit error:", error);
      toast({
        title: "שגיאה",
        description: error.message || "אירעה שגיאה בשמירת הזן. נסה שוב.",
        variant: "destructive"
      });
    }
  };

  const VarietyTable = ({ cropType }) => {
    const cropVarieties = varieties.filter(v => v && v.crop_type === cropType);
    
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>{cropType} ({cropVarieties.length})</CardTitle>
          <Button onClick={handleAdd}>
            <Plus className="w-4 h-4 ml-2"/>הוסף זן
          </Button>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center items-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>פעולות</TableHead>
                  <TableHead>תקופת זריעה</TableHead>
                  <TableHead>יצרן</TableHead>
                  <TableHead>משווק</TableHead>
                  <TableHead>שם הזן</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cropVarieties.map(variety => (
                  <TableRow key={variety.id}>
                    <TableCell>
                      <div className="flex gap-2">
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          onClick={() => handleEdit(variety)}
                          disabled={isDeletingId === variety.id}
                        >
                          <Edit className="w-4 h-4" />
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          onClick={() => handleDelete(variety.id)} 
                          className="text-red-600"
                          disabled={isDeletingId === variety.id}
                        >
                          {isDeletingId === variety.id ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Trash2 className="w-4 h-4" />
                          )}
                        </Button>
                      </div>
                    </TableCell>
                    <TableCell>
                      {variety.recommended_planting_start && variety.recommended_planting_end 
                        ? `${variety.recommended_planting_start} - ${variety.recommended_planting_end}`
                        : "-"}
                    </TableCell>
                    <TableCell>{variety.manufacturer || "-"}</TableCell>
                    <TableCell>{variety.marketing_company || "-"}</TableCell>
                    <TableCell className="font-medium">{variety.name}</TableCell>
                  </TableRow>
                ))}
                {cropVarieties.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-gray-500 py-8">
                      אין זנים רשומים עבור {cropType}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    );
  };

  if (!currentFarm) {
    return (
      <div className="flex justify-center items-center py-24 text-gray-500">
        <p>בחר משק פעיל כדי לנהל זנים.</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex justify-center items-center py-24">
        <Loader2 className="w-12 h-12 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6 mt-4">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            {crops.map(crop => (
                <TabsTrigger key={crop.id} value={crop.name}>{crop.name}</TabsTrigger>
            ))}
            {crops.length === 0 && (
              <span className="text-gray-500 px-4 py-2">אין גידולים זמינים</span>
            )}
          </TabsList>
          
          {crops.map(crop => (
             <TabsContent key={crop.id} value={crop.name}>
                <VarietyTable cropType={crop.name} />
            </TabsContent>
          ))}
          
          {crops.length === 0 && (
            <div className="text-center py-12 text-gray-500 space-y-3">
              <Sprout className="w-12 h-12 mx-auto text-gray-300" />
              <p className="text-base">כדי להוסיף זנים, תחילה הוסף גידולים למשק שלך.</p>
              <Button onClick={() => onNavigateToTab ? onNavigateToTab('crops') : navigate('/settings?tab=crops')} className="mt-2">
                <Sprout className="w-4 h-4 ml-2" />
                עבור לניהול גידולים
              </Button>
            </div>
          )}
        </Tabs>

        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent className="sm:max-w-2xl" dir="rtl">
            <DialogHeader>
              <DialogTitle>
                {editingVariety ? "עריכת זן" : "הוספת זן חדש"} - {formData.crop_type}
              </DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit}>
              <div className="grid grid-cols-2 gap-4 py-4">
                <div>
                  <Label htmlFor="varietyName">שם הזן *</Label>
                  <Input 
                    id="varietyName"
                    value={formData.name} 
                    onChange={e => setFormData({...formData, name: e.target.value})}
                    required
                  />
                </div>

                <div>
                  <Label htmlFor="cropType">סוג גידול *</Label>
                  <Select 
                    value={formData.crop_type} 
                    onValueChange={v => setFormData({...formData, crop_type: v})}
                    disabled={editingVariety}
                  >
                    <SelectTrigger id="cropType">
                      <SelectValue placeholder="בחר סוג גידול"/>
                    </SelectTrigger>
                    <SelectContent>
                      {crops.map(crop => (
                        <SelectItem key={crop.id} value={crop.name}>{crop.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor="marketingCompany">חברה משווקת</Label>
                  <Input 
                    id="marketingCompany"
                    value={formData.marketing_company} 
                    onChange={e => setFormData({...formData, marketing_company: e.target.value})}
                  />
                </div>

                <div>
                  <Label htmlFor="manufacturer">יצרן</Label>
                  <Input 
                    id="manufacturer"
                    value={formData.manufacturer} 
                    onChange={e => setFormData({...formData, manufacturer: e.target.value})}
                  />
                </div>

                <div>
                  <Label htmlFor="plantingStart">תחילת תקופת זריעה</Label>
                  <Select value={formData.recommended_planting_start} onValueChange={v => setFormData({...formData, recommended_planting_start: v})}>
                    <SelectTrigger id="plantingStart">
                      <SelectValue placeholder="בחר חודש" />
                    </SelectTrigger>
                    <SelectContent>
                      {monthOptions.map(month => (
                        <SelectItem key={month} value={month}>{month}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor="plantingEnd">סוף תקופת זריעה</Label>
                  <Select value={formData.recommended_planting_end} onValueChange={v => setFormData({...formData, recommended_planting_end: v})}>
                    <SelectTrigger id="plantingEnd">
                      <SelectValue placeholder="בחר חודש" />
                    </SelectTrigger>
                    <SelectContent>
                      {monthOptions.map(month => (
                        <SelectItem key={month} value={month}>{month}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="col-span-2">
                  <Label htmlFor="notes">הערות</Label>
                  <Input 
                    id="notes"
                    value={formData.notes} 
                    onChange={e => setFormData({...formData, notes: e.target.value})}
                    placeholder="הערות נוספות"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                  ביטול
                </Button>
                <Button type="submit">
                  {editingVariety ? "עדכן" : "הוסף"} זן
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
  );
}