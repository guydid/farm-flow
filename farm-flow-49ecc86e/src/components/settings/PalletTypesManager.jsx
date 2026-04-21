
import React, { useState, useEffect } from "react";
import { PalletType } from "@/entities/all";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Edit, Trash2, Loader2 } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";

export default function PalletTypesManager({ currentFarm }) {
  const [palletTypes, setPalletTypes] = useState([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingType, setEditingType] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();

  const [formData, setFormData] = useState({
    name: "",
    weight: ""
  });

  useEffect(() => {
    console.log('PalletTypesManager - Farm changed:', currentFarm?.id);
    loadPalletTypes();
  }, [currentFarm?.id]);

  const loadPalletTypes = async () => {
    if (!currentFarm?.id) {
      console.log('PalletTypesManager - No farm, clearing data');
      setPalletTypes([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const data = await PalletType.list();
      
      // STRONG client-side filter
      const filtered = Array.isArray(data) 
        ? data.filter(item => item.farm_id === currentFarm.id)
        : [];
      
      setPalletTypes(filtered);
    } catch (error) {
      console.error("Failed to load pallet types:", error);
      setPalletTypes([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!currentFarm?.id) {
      toast({ title: "שגיאה", description: "לא נבחר משק פעיל", variant: "destructive" });
      return;
    }

    if (!formData.name || !formData.weight) {
      toast({ title: "שגיאה", description: "נא למלא את כל השדות", variant: "destructive" });
      return;
    }

    try {
      const dataToSave = {
        farm_id: currentFarm.id,
        name: formData.name,
        weight: parseFloat(formData.weight)
      };

      if (editingType) {
        await PalletType.update(editingType.id, dataToSave);
        toast({ title: "הצלחה", description: "המשטח עודכן בהצלחה" });
      } else {
        await PalletType.create(dataToSave);
        toast({ title: "הצלחה", description: "המשטח נוסף בהצלחה" });
      }

      setIsDialogOpen(false);
      setFormData({ name: "", weight: "" });
      setEditingType(null);
      await loadPalletTypes();
    } catch (error) {
      console.error("Save error:", error);
      toast({ 
        title: "שגיאה", 
        description: `שמירה נכשלה: ${error.message}`, 
        variant: "destructive" 
      });
    }
  };

  const handleEdit = (item) => {
    setEditingType(item);
    setFormData({
      name: item.name,
      weight: String(item.weight)
    });
    setIsDialogOpen(true);
  };

  const handleDelete = async (id) => {
    if (!window.confirm("האם אתה בטוח שברצונך למחוק משטח זה?")) {
      return;
    }
    
    try {
      await PalletType.delete(id);
      toast({ title: "הצלחה", description: "המשטח נמחק בהצלחה" });
      await loadPalletTypes();
    } catch (error) {
      console.error("Delete error:", error);
      toast({ title: "שגיאה", description: "מחיקה נכשלה", variant: "destructive" });
    }
  };

  if (!currentFarm?.id) {
    return (
      <Card>
        <CardHeader><CardTitle>ניהול סוגי משטחים</CardTitle></CardHeader>
        <CardContent>
          <p className="text-center py-4 text-gray-500">
            אנא בחר משק פעיל כדי לנהל משטחים
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="mt-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>סוגי משטחים - {currentFarm.name}</CardTitle>
          <Button onClick={() => { 
            setFormData({ name: "", weight: "" }); 
            setEditingType(null); 
            setIsDialogOpen(true); 
          }}>
            <Plus className="w-4 h-4 ml-2" /> הוסף משטח
          </Button>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>שם</TableHead>
                  <TableHead>משקל (ק"ג)</TableHead>
                  <TableHead>פעולות</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {palletTypes.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center py-8 text-gray-500">
                      אין משטחים עבור משק זה
                    </TableCell>
                  </TableRow>
                ) : (
                  palletTypes.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">{item.name}</TableCell>
                      <TableCell>{item.weight} ק"ג</TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          <Button variant="ghost" size="icon" onClick={() => handleEdit(item)}>
                            <Edit className="w-4 h-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => handleDelete(item.id)} className="text-red-500">
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>
              {editingType ? 'עריכת משטח' : 'הוספת משטח חדש'}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit}>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="name">שם המשטח *</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="לדוגמה: פלסטיק, עץ, מתכת"
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="weight">משקל (ק"ג) *</Label>
                <Input
                  id="weight"
                  type="number"
                  step="0.1"
                  value={formData.weight}
                  onChange={(e) => setFormData({ ...formData, weight: e.target.value })}
                  placeholder="לדוגמה: 15"
                  required
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                ביטול
              </Button>
              <Button type="submit">
                {editingType ? 'עדכן' : 'צור'} משטח
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
