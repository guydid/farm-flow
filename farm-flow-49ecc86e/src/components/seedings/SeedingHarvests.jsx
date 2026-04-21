import React, { useState, useEffect, useCallback } from "react";
import { Harvest, PalletType, Packaging } from "@/entities/all";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format } from "date-fns";
import { Plus, X, Edit, Trash2, ExternalLink } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { useNavigate } from "react-router-dom";

export default function SeedingHarvests({ seeding, varieties, harvests, onUpdate }) {
  const navigate = useNavigate();
  const [palletTypes, setPalletTypes] = useState([]);
  const [packagings, setPackagings] = useState([]);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingHarvest, setEditingHarvest] = useState(null);
  const { toast } = useToast();
  
  const initialFormData = {
    date: format(new Date(), "yyyy-MM-dd"),
    quantity: "",
    weight: "",
    quality: "א",
    notes: "",
    package_count: "",
    pallet_type: "ללא משטח",
    packaging: ""
  };
  const [formData, setFormData] = useState(initialFormData);

  const loadPackagingData = useCallback(async () => {
    if (!seeding?.farm_id) return;
    
    try {
      const [palletTypesData, packagingsData] = await Promise.all([
        PalletType.list(),
        Packaging.filter({ farm_id: seeding.farm_id })
      ]);
      
      setPalletTypes(Array.isArray(palletTypesData) ? palletTypesData : []);
      const loadedPackagings = Array.isArray(packagingsData) ? packagingsData : [];
      setPackagings(loadedPackagings);
      
      // Set default packaging if available and form is empty
      if (loadedPackagings.length > 0 && !formData.packaging && !editingHarvest) {
        setFormData(prev => ({ ...prev, packaging: loadedPackagings[0].name }));
      }
    } catch (error) {
      console.error("Error loading packaging data:", error);
      setPalletTypes([]);
      setPackagings([]);
    }
  }, [seeding?.farm_id, formData.packaging, editingHarvest]);

  useEffect(() => {
    loadPackagingData();
  }, [loadPackagingData]);

  // Auto-calculate weight when packaging or quantity changes
  useEffect(() => {
    if (formData.packaging && formData.quantity && packagings.length > 0) {
      const selectedPackaging = packagings.find(p => p.name === formData.packaging);
      if (selectedPackaging && selectedPackaging.expected_weight) {
        const calculatedWeight = selectedPackaging.expected_weight * parseFloat(formData.quantity || 0);
        setFormData(prev => ({ ...prev, weight: calculatedWeight.toFixed(2).toString() }));
      }
    }
  }, [formData.packaging, formData.quantity, packagings]);

  const handleEdit = (harvest) => {
    setEditingHarvest(harvest);
    setFormData({
      date: harvest.date ? format(new Date(harvest.date), "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd"),
      quantity: harvest.quantity?.toString() || "",
      weight: harvest.weight?.toString() || "",
      quality: harvest.quality || "א",
      notes: harvest.notes || "",
      package_count: harvest.package_count?.toString() || "",
      pallet_type: harvest.pallet_type || "ללא משטח",
      packaging: harvest.packaging || ""
    });
    setIsFormOpen(true);
  };

  const handleDelete = async (harvestId) => {
    if (window.confirm("האם אתה בטוח שברצונך למחוק קטיף זה?")) {
      try {
        await Harvest.delete(harvestId);
        toast({ title: "הצלחה", description: "הקטיף נמחק." });
        if (onUpdate) onUpdate();
      } catch (error) {
        toast({ title: "שגיאה", description: "מחיקת הקטיף נכשלה.", variant: "destructive" });
      }
    }
  };

  const handlePalletTypeChange = (newPalletType) => {
    const savedCount = localStorage.getItem(`lastPackageCount_${newPalletType}`) || "";
    setFormData(prev => ({
        ...prev,
        pallet_type: newPalletType,
        package_count: savedCount
    }));
  };

  const resetForm = () => {
    const defaultPackaging = packagings.length > 0 ? packagings[0].name : "";
    setFormData({ ...initialFormData, packaging: defaultPackaging });
    setEditingHarvest(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const dataToSend = {
        ...formData,
        seeding_id: seeding?.id,
        quantity: parseFloat(formData.quantity) || null,
        weight: parseFloat(formData.weight) || null,
        package_count: formData.package_count ? parseFloat(formData.package_count) : null,
      };

      if (editingHarvest) {
        await Harvest.update(editingHarvest.id, dataToSend);
        toast({ title: "הצלחה", description: "הקטיף עודכן." });
      } else {
        await Harvest.create(dataToSend);
        toast({ title: "הצלחה", description: "קטיף חדש נוסף." });
      }
      
      // Save the package count for next time
      localStorage.setItem(`lastPackageCount_${formData.pallet_type}`, formData.package_count);
      
      setIsFormOpen(false);
      resetForm();
      if (onUpdate) onUpdate();
    } catch (error) {
      console.error("Error saving harvest:", error);
      toast({ title: "שגיאה", description: "שמירת הקטיף נכשלה.", variant: "destructive" });
    }
  };

  const safeHarvests = Array.isArray(harvests) ? harvests : [];

  return (
    <Card>
      <CardHeader>
        <div className="flex justify-between items-center">
          <CardTitle>קטיפים</CardTitle>
          <Button onClick={() => {resetForm(); setIsFormOpen(!isFormOpen);}}>
            {isFormOpen ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isFormOpen && (
          <form onSubmit={handleSubmit} className="space-y-4 mb-6 p-4 border rounded-lg">
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
                <div className="flex items-center justify-between mb-1">
                  <Label>אריזה</Label>
                  {packagings.length === 0 && (
                    <button
                      type="button"
                      onClick={() => navigate('/settings?tab=packaging')}
                      className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1"
                    >
                      הוסף אריזות <ExternalLink className="w-3 h-3" />
                    </button>
                  )}
                </div>
                {packagings.length === 0 ? (
                  <div className="flex items-center gap-2 p-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-700">
                    אין אריזות מוגדרות —{" "}
                    <button type="button" onClick={() => navigate('/settings?tab=packaging')} className="underline font-medium">
                      הגדר כאן
                    </button>
                  </div>
                ) : (
                  <Select
                    value={formData.packaging}
                    onValueChange={v => setFormData({...formData, packaging: v})}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="בחר אריזה" />
                    </SelectTrigger>
                    <SelectContent>
                      {packagings.map(p => (
                        <SelectItem key={p.id} value={p.name}>
                          {p.name}{p.expected_weight && ` (${p.expected_weight} ק"ג)`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>כמות יחידות</Label>
                <Input
                  type="number"
                  value={formData.quantity}
                  onChange={e => setFormData({...formData, quantity: e.target.value})}
                  required
                />
              </div>
              <div>
                <Label>משקל (ק"ג)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={formData.weight}
                  onChange={e => setFormData({...formData, weight: e.target.value})}
                />
                {formData.packaging && packagings.find(p => p.name === formData.packaging)?.expected_weight && (
                  <p className="text-xs text-gray-500 mt-1">
                    משקל מחושב אוטומטית לפי המשקל הצפוי
                  </p>
                )}
              </div>
            </div>

            <div>
              <Label>איכות</Label>
              <Select
                value={formData.quality}
                onValueChange={v => setFormData({...formData, quality: v})}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="א">א'</SelectItem>
                  <SelectItem value="ב">ב'</SelectItem>
                  <SelectItem value="ג">ג'</SelectItem>
                  <SelectItem value="תעשייתי">תעשייתי</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <Label>סוג משטח</Label>
                  {palletTypes.length === 0 && (
                    <button
                      type="button"
                      onClick={() => navigate('/settings?tab=pallet-types')}
                      className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1"
                    >
                      הוסף סוגים <ExternalLink className="w-3 h-3" />
                    </button>
                  )}
                </div>
                <Select
                  value={formData.pallet_type}
                  onValueChange={handlePalletTypeChange}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="בחר סוג משטח" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ללא משטח">ללא משטח</SelectItem>
                    {palletTypes.map(pt => (
                      <SelectItem key={pt.id} value={pt.name}>{pt.name}</SelectItem>
                    ))}
                    {palletTypes.length === 0 && (
                      <div className="px-3 py-2 text-xs text-gray-400">
                        אין סוגי משטח — הגדר בהגדרות
                      </div>
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>מס' אריזות במשטח</Label>
                <Input
                  type="number"
                  value={formData.package_count}
                  onChange={e => {
                    setFormData({...formData, package_count: e.target.value});
                  }}
                  placeholder="כמות אריזות..."
                />
              </div>
            </div>

            <div>
              <Label>הערות</Label>
              <Input
                value={formData.notes}
                onChange={e => setFormData({...formData, notes: e.target.value})}
              />
            </div>

            <div className="flex gap-2">
              <Button type="submit">
                {editingHarvest ? "עדכן" : "שמור"}
              </Button>
              <Button type="button" variant="outline" onClick={() => setIsFormOpen(false)}>
                ביטול
              </Button>
            </div>
          </form>
        )}

        {safeHarvests.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>תאריך</TableHead>
                <TableHead>אריזה</TableHead>
                <TableHead>כמות</TableHead>
                <TableHead>משקל</TableHead>
                <TableHead>איכות</TableHead>
                <TableHead>פעולות</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {safeHarvests.map((harvest) => (
                <TableRow key={harvest.id}>
                  <TableCell>
                    {harvest.date ? format(new Date(harvest.date), "dd/MM/yyyy") : "-"}
                  </TableCell>
                  <TableCell>{harvest.packaging || "-"}</TableCell>
                  <TableCell>{harvest.quantity || "-"}</TableCell>
                  <TableCell>{harvest.weight ? `${harvest.weight} ק"ג` : "-"}</TableCell>
                  <TableCell>{harvest.quality || "-"}</TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      <Button 
                        size="sm" 
                        variant="outline"
                        onClick={() => handleEdit(harvest)}
                      >
                        <Edit className="w-4 h-4" />
                      </Button>
                      <Button 
                        size="sm" 
                        variant="outline" 
                        onClick={() => handleDelete(harvest.id)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-center text-gray-500 py-4">אין קטיפים רשומים.</p>
        )}
      </CardContent>
    </Card>
  );
}