
import React, { useState, useEffect } from "react";
import { Packaging } from "@/entities/all";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Edit, Trash2, Loader2 } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";

export default function PackagingManager({ currentFarm }) {
  const [packaging, setPackaging] = useState([]); // Renamed from packagings
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingPackage, setEditingPackage] = useState(null); // Renamed from editingPackaging
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();

  const initialFormData = {
    name: "",
    tare_weight: "",
    expected_weight: ""
  };
  const [formData, setFormData] = useState(initialFormData);

  useEffect(() => {
    loadPackaging(); // Renamed function call
  }, [currentFarm?.id]); // Dependency updated to currentFarm?.id

  const loadPackaging = async () => { // Renamed function
    if (!currentFarm?.id) { // Added .id check
      console.log('PackagingManager - No farm, clearing data');
      setPackaging([]); // Renamed state setter
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      console.log('PackagingManager - Loading for farm:', currentFarm.id);
      // Fetch all packaging items
      const data = await Packaging.list();
      
      // STRONG client-side filter
      const filtered = Array.isArray(data) 
        ? data.filter(item => item.farm_id === currentFarm.id)
        : [];
      
      console.log('PackagingManager - Loaded:', filtered?.length, 'items after filter');
      setPackaging(filtered); // Renamed state setter
    } catch (error) {
      console.error("Failed to load packaging:", error);
      toast({ title: "שגיאה", description: "טעינת סוגi האריזות נכשלה", variant: "destructive" });
      setPackaging([]); // Renamed state setter
    } finally {
      setIsLoading(false);
    }
  };

  const handleEdit = (item) => {
    setEditingPackage(item); // Renamed state setter
    setFormData({
      name: item.name || "",
      tare_weight: item.tare_weight?.toString() || "",
      expected_weight: item.expected_weight?.toString() || ""
    });
    setIsDialogOpen(true);
  };

  const handleDelete = async (id) => {
    if (window.confirm("האם אתה בטוח שברצונך למחוק אריזה זו?")) {
      try {
        await Packaging.delete(id);
        toast({ title: "הצלחה", description: "האריזה נמחקה בהצלחה" });
        loadPackaging(); // Renamed function call
      } catch (error) {
        console.error("Failed to delete packaging:", error);
        toast({ title: "שגיאה", description: "מחיקת האריזה נכשלה", variant: "destructive" });
      }
    }
  };

  const resetForm = () => {
    setEditingPackage(null); // Renamed state setter
    setFormData(initialFormData);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!currentFarm?.id) { // Added .id check
      toast({ title: "שגיאה", description: "לא נבחר משק פעיל", variant: "destructive" });
      return;
    }

    try {
      // Explicitly pick and parse data fields as per outline
      const dataToSave = {
        name: formData.name,
        tare_weight: parseFloat(formData.tare_weight) || 0,
        expected_weight: formData.expected_weight ? parseFloat(formData.expected_weight) : null,
        farm_id: currentFarm.id
      };

      console.log('PackagingManager - Saving:', dataToSave);

      if (editingPackage) { // Renamed state
        await Packaging.update(editingPackage.id, dataToSave); // Renamed state
        toast({ title: "הצלחה", description: "האריזה עודכנה בהצלחה" });
      } else {
        await Packaging.create(dataToSave);
        toast({ title: "הצלחה", description: "האריזה נוספה בהצלחה" });
      }

      setIsDialogOpen(false);
      resetForm();
      await loadPackaging(); // Ensure reload after async operation
    } catch (error) {
      console.error("Failed to save packaging:", error);
      toast({ title: "שגיאה", description: `שמירת האריזה נכשלה: ${error.message}`, variant: "destructive" }); // Added error.message
    }
  };

  if (!currentFarm) {
    return (
      <Card>
        <CardHeader><CardTitle>ניהול אריזות</CardTitle></CardHeader>
        <CardContent>
          <p className="text-center py-4 text-gray-500">
            אנא בחר משק פעיל כדי לנהל אריזות.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="mt-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>ניהול אריזות</CardTitle>
          <Button onClick={() => { resetForm(); setIsDialogOpen(true); }}>
            <Plus className="w-4 h-4 ml-2" /> הוסף אריזה
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
                  <TableHead>משקל צפוי</TableHead>
                  <TableHead>משקל טרה (ק"ג)</TableHead>
                  <TableHead>שם האריזה</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {packaging.length === 0 ? ( // Renamed state
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-4">
                      אין אריזות זמינות עבור משק זה.
                    </TableCell>
                  </TableRow>
                ) : (
                  packaging.map(pack => ( // Renamed state
                    <TableRow key={pack.id}>
                      <TableCell>
                        <div className="flex gap-2">
                          <Button variant="ghost" size="icon" onClick={() => handleEdit(pack)}>
                            <Edit className="w-4 h-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => handleDelete(pack.id)}>
                            <Trash2 className="w-4 h-4 text-red-500" />
                          </Button>
                        </div>
                      </TableCell>
                      <TableCell>{pack.expected_weight ? `${pack.expected_weight} ק"ג` : '-'}</TableCell>
                      <TableCell>{pack.tare_weight} ק"ג</TableCell>
                      <TableCell className="font-medium">{pack.name}</TableCell>
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
            <DialogTitle>{editingPackage ? 'עריכת אריזה' : 'הוספת אריזה'}</DialogTitle> {/* Renamed state */}
          </DialogHeader>
          <form onSubmit={handleSubmit}>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="name">שם האריזה *</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="tare_weight">משקל טרה (ק"ג) *</Label>
                <Input
                  id="tare_weight"
                  type="number"
                  step="0.01"
                  value={formData.tare_weight}
                  onChange={(e) => setFormData({ ...formData, tare_weight: e.target.value })}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="expected_weight">משקל נטו צפוי (ק"ג)</Label>
                <Input
                  id="expected_weight"
                  type="number"
                  step="0.01"
                  value={formData.expected_weight}
                  onChange={(e) => setFormData({ ...formData, expected_weight: e.target.value })}
                />
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => { setIsDialogOpen(false); resetForm(); }}>
                ביטול
              </Button>
              <Button type="submit">
                {editingPackage ? 'עדכן' : 'הוסף'} {/* Renamed state */}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
