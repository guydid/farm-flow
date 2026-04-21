
import React, { useState, useEffect } from "react";
import { Crop } from "@/entities/all";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Edit, Trash2, Loader2 } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";

export default function CropsManager({ currentFarm }) {
  const [crops, setCrops] = useState([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingCrop, setEditingCrop] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();

  const [formData, setFormData] = useState({ name: "" });

  useEffect(() => {
    loadCrops();
  }, [currentFarm?.id]); // Changed dependency to currentFarm?.id

  const loadCrops = async () => {
    if (!currentFarm?.id) {
      setCrops([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const data = await Crop.list(); // Fetch all crops
      
      // STRONG client-side filter
      const filtered = Array.isArray(data) 
        ? data.filter(item => item.farm_id === currentFarm.id)
        : [];
      
      setCrops(filtered); // Set filtered crops
    } catch (error) {
      console.error("Failed to load crops:", error);
      setCrops([]);
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

    try {
      const data = {
        farm_id: currentFarm.id,
        name: formData.name
      };

      if (editingCrop) {
        await Crop.update(editingCrop.id, data);
      } else {
        await Crop.create(data);
      }

      toast({ title: "הצלחה", description: "הגידול נשמר בהצלחה" });
      setIsDialogOpen(false);
      setFormData({ name: "" });
      setEditingCrop(null);
      loadCrops();
    } catch (error) {
      console.error("Save error:", error);
      toast({ title: "שגיאה", description: "שמירה נכשלה", variant: "destructive" });
    }
  };

  const handleEdit = (item) => {
    setEditingCrop(item);
    setFormData({ name: item.name });
    setIsDialogOpen(true);
  };

  const handleDelete = async (id) => {
    if (window.confirm("האם למחוק?")) {
      try {
        await Crop.delete(id);
        toast({ title: "הצלחה", description: "נמחק בהצלחה" });
        loadCrops();
      } catch (error) {
        console.error("Delete error:", error);
        toast({ title: "שגיאה", description: "מחיקה נכשלה", variant: "destructive" });
      }
    }
  };

  if (!currentFarm?.id) {
    return (
      <Card>
        <CardHeader><CardTitle>ניהול גידולים</CardTitle></CardHeader>
        <CardContent>
          <p className="text-center py-4">אנא בחר משק</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="mt-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>ניהול גידולים</CardTitle>
          <Button onClick={() => { setFormData({ name: "" }); setEditingCrop(null); setIsDialogOpen(true); }}>
            <Plus className="w-4 h-4 ml-2" /> הוסף גידול
          </Button>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-8 h-8 animate-spin" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>שם הגידול</TableHead>
                  <TableHead>פעולות</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {crops.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={2} className="text-center">אין גידולים</TableCell>
                  </TableRow>
                ) : (
                  crops.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>{item.name}</TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          <Button variant="ghost" size="icon" onClick={() => handleEdit(item)}>
                            <Edit className="w-4 h-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => handleDelete(item.id)}>
                            <Trash2 className="w-4 h-4 text-red-500" />
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
            <DialogTitle>{editingCrop ? "ערוך" : "הוסף"} גידול</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit}>
            <div className="grid gap-4 py-4">
              <div>
                <Label>שם הגידול</Label>
                <Input 
                  value={formData.name} 
                  onChange={(e) => setFormData({...formData, name: e.target.value})} 
                  required 
                  placeholder="לדוגמה: מלפפון, עגבנייה"
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                ביטול
              </Button>
              <Button type="submit">שמור</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
