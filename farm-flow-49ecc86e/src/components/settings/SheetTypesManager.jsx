
import React, { useState, useEffect } from "react";
import { SheetType } from "@/entities/all";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Edit, Trash2, Loader2 } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";

export default function SheetTypesManager({ currentFarm }) {
  const [sheetTypes, setSheetTypes] = useState([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingType, setEditingType] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();

  const initialFormData = {
    name: "",
    default_weight_per_meter: "",
    price_per_meter: "",
    supplier: "",
    notes: ""
  };
  const [formData, setFormData] = useState(initialFormData);

  useEffect(() => {
    console.log('SheetTypesManager - currentFarm:', currentFarm?.id);
    loadSheetTypes();
  }, [currentFarm?.id]); // Changed dependency to currentFarm?.id

  const loadSheetTypes = async () => {
    if (!currentFarm?.id) { // Changed condition to currentFarm?.id
      console.log('SheetTypesManager - No farm ID, clearing data');
      setSheetTypes([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      console.log('SheetTypesManager - Loading for farm:', currentFarm.id);
      const data = await SheetType.list(); // Changed from filter to list
      
      // STRONG client-side filter
      const filtered = Array.isArray(data) 
        ? data.filter(item => item.farm_id === currentFarm.id)
        : [];
      
      console.log('SheetTypesManager - Loaded:', filtered?.length, 'items after client-side filter');
      setSheetTypes(filtered);
    } catch (error) {
      console.error("Failed to load sheet types:", error);
      toast({ title: "שגיאה", description: "טעינת סוגי היריעות נכשלה", variant: "destructive" });
      setSheetTypes([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleEdit = (item) => {
    setEditingType(item);
    setFormData({
      name: item.name || "",
      default_weight_per_meter: item.default_weight_per_meter?.toString() || "",
      price_per_meter: item.price_per_meter?.toString() || "",
      supplier: item.supplier || "",
      notes: item.notes || ""
    });
    setIsDialogOpen(true);
  };

  const handleDelete = async (id) => {
    if (window.confirm("האם אתה בטוח שברצונך למחוק סוג יריעה זה?")) {
      try {
        await SheetType.delete(id);
        toast({ title: "הצלחה", description: "סוג היריעה נמחק בהצלחה" });
        loadSheetTypes();
      } catch (error) {
        console.error("Failed to delete sheet type:", error);
        toast({ title: "שגיאה", description: "מחיקת סוג היריעה נכשלה", variant: "destructive" });
      }
    }
  };

  const resetForm = () => {
    setEditingType(null);
    setFormData(initialFormData);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!currentFarm) {
      toast({ title: "שגיאה", description: "לא נבחר משק פעיל", variant: "destructive" });
      return;
    }

    try {
      const dataToSave = {
        ...formData,
        farm_id: currentFarm.id,
        default_weight_per_meter: formData.default_weight_per_meter ? parseFloat(formData.default_weight_per_meter) : null,
        price_per_meter: formData.price_per_meter ? parseFloat(formData.price_per_meter) : null
      };

      console.log('SheetTypesManager - Saving:', dataToSave);

      if (editingType) {
        await SheetType.update(editingType.id, dataToSave);
        toast({ title: "הצלחה", description: "סוג היריעה עודכן בהצלחה" });
      } else {
        await SheetType.create(dataToSave);
        toast({ title: "הצלחה", description: "סוג היריעה נוסף בהצלחה" });
      }

      setIsDialogOpen(false);
      resetForm();
      loadSheetTypes();
    } catch (error) {
      console.error("Failed to save sheet type:", error);
      toast({ title: "שגיאה", description: "שמירת סוג היריעה נכשלה", variant: "destructive" });
    }
  };

  if (!currentFarm) {
    return (
      <Card>
        <CardHeader><CardTitle>ניהול סוגי יריעות</CardTitle></CardHeader>
        <CardContent>
          <p className="text-center py-4 text-gray-500">
            אנא בחר משק פעיל כדי לנהל סוגי יריעות.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="mt-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>ניהול סוגי יריעות</CardTitle>
          <Button onClick={() => { resetForm(); setIsDialogOpen(true); }}>
            <Plus className="w-4 h-4 ml-2" /> הוסף סוג יריעה
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
                  <TableHead>פעולות</TableHead>
                  <TableHead>מחיר למ"ר</TableHead>
                  <TableHead>משקל למ"ר</TableHead>
                  <TableHead>שם</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sheetTypes.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-4">
                      אין סוגי יריעות זמינים עבור משק זה.
                    </TableCell>
                  </TableRow>
                ) : (
                  sheetTypes.map(type => (
                    <TableRow key={type.id}>
                      <TableCell>
                        <div className="flex gap-2">
                          <Button variant="ghost" size="icon" onClick={() => handleEdit(type)}>
                            <Edit className="w-4 h-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => handleDelete(type.id)}>
                            <Trash2 className="w-4 h-4 text-red-500" />
                          </Button>
                        </div>
                      </TableCell>
                      <TableCell>{type.price_per_meter ? `₪${type.price_per_meter}` : '-'}</TableCell>
                      <TableCell>{type.default_weight_per_meter ? `${type.default_weight_per_meter} ק"ג` : '-'}</TableCell>
                      <TableCell className="font-medium">{type.name}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={isDialogOpen} onOpenChange={(open) => { if (!open) { setIsDialogOpen(false); resetForm(); } }}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>{editingType ? 'עריכת סוג יריעה' : 'הוספת סוג יריעה'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit}>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="name">שם סוג היריעה *</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="weight">משקל למ"ר (ק"ג)</Label>
                  <Input
                    id="weight"
                    type="number"
                    step="0.01"
                    value={formData.default_weight_per_meter}
                    onChange={(e) => setFormData({ ...formData, default_weight_per_meter: e.target.value })}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="price">מחיר למ"ר</Label>
                  <Input
                    id="price"
                    type="number"
                    step="0.01"
                    value={formData.price_per_meter}
                    onChange={(e) => setFormData({ ...formData, price_per_meter: e.target.value })}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="supplier">ספק</Label>
                <Input
                  id="supplier"
                  value={formData.supplier}
                  onChange={(e) => setFormData({ ...formData, supplier: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="notes">הערות</Label>
                <Textarea
                  id="notes"
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  rows={3}
                />
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => { setIsDialogOpen(false); resetForm(); }}>
                ביטול
              </Button>
              <Button type="submit">
                {editingType ? 'עדכן' : 'הוסף'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
