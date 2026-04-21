
import React, { useState, useEffect } from "react";
import { ActivityType } from "@/entities/all";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Edit, Trash2, Loader2 } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";

export default function ActivityTypesManager({ currentFarm }) {
  const [activityTypes, setActivityTypes] = useState([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingType, setEditingType] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();

  const [formData, setFormData] = useState({
    name: "",
    category: "cultivation",
    price_per_dunam: "",
    unit: "per_dunam",
    description: ""
  });

  useEffect(() => {
    loadActivityTypes();
  }, [currentFarm?.id]);

  const loadActivityTypes = async () => {
    if (!currentFarm?.id) {
      setActivityTypes([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const data = await ActivityType.list();
      
      // STRONG client-side filter
      const filtered = Array.isArray(data) 
        ? data.filter(item => item.farm_id === currentFarm.id)
        : [];
      
      setActivityTypes(filtered);
    } catch (error) {
      console.error("Failed to load activity types:", error);
      setActivityTypes([]);
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
        name: formData.name,
        category: formData.category,
        price_per_dunam: formData.price_per_dunam ? Number(formData.price_per_dunam) : null,
        unit: formData.unit,
        description: formData.description
      };

      if (editingType) {
        await ActivityType.update(editingType.id, data);
      } else {
        await ActivityType.create(data);
      }

      toast({ title: "הצלחה", description: "סוג הפעילות נשמר בהצלחה" });
      setIsDialogOpen(false);
      setFormData({
        name: "",
        category: "cultivation",
        price_per_dunam: "",
        unit: "per_dunam",
        description: ""
      });
      setEditingType(null);
      loadActivityTypes();
    } catch (error) {
      console.error("Save error:", error);
      toast({ title: "שגיאה", description: "שמירה נכשלה", variant: "destructive" });
    }
  };

  const handleEdit = (item) => {
    setEditingType(item);
    setFormData({
      name: item.name || "",
      category: item.category || "cultivation",
      price_per_dunam: item.price_per_dunam?.toString() || "",
      unit: item.unit || "per_dunam",
      description: item.description || ""
    });
    setIsDialogOpen(true);
  };

  const handleDelete = async (id) => {
    if (window.confirm("האם למחוק?")) {
      try {
        await ActivityType.delete(id);
        toast({ title: "הצלחה", description: "נמחק בהצלחה" });
        loadActivityTypes();
      } catch (error) {
        console.error("Delete error:", error);
        toast({ title: "שגיאה", description: "מחיקה נכשלה", variant: "destructive" });
      }
    }
  };

  if (!currentFarm?.id) {
    return (
      <Card>
        <CardHeader><CardTitle>ניהול סוגי פעילויות</CardTitle></CardHeader>
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
          <CardTitle>ניהול סוגי פעילויות</CardTitle>
          <Button onClick={() => { 
            setFormData({
              name: "",
              category: "cultivation",
              price_per_dunam: "",
              unit: "per_dunam",
              description: ""
            }); 
            setEditingType(null); 
            setIsDialogOpen(true); 
          }}>
            <Plus className="w-4 h-4 ml-2" /> הוסף
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
                  <TableHead>שם</TableHead>
                  <TableHead>קטגוריה</TableHead>
                  <TableHead>מחיר</TableHead>
                  <TableHead>פעולות</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activityTypes.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center">אין סוגי פעילויות</TableCell>
                  </TableRow>
                ) : (
                  activityTypes.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>{item.name}</TableCell>
                      <TableCell>{item.category}</TableCell>
                      <TableCell>{item.price_per_dunam ? `₪${item.price_per_dunam}` : "-"}</TableCell>
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
            <DialogTitle>{editingType ? "ערוך" : "הוסף"} סוג פעילות</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit}>
            <div className="grid gap-4 py-4">
              <div>
                <Label>שם</Label>
                <Input 
                  value={formData.name} 
                  onChange={(e) => setFormData({...formData, name: e.target.value})} 
                  required 
                />
              </div>
              <div>
                <Label>קטגוריה</Label>
                <Select value={formData.category} onValueChange={(v) => setFormData({...formData, category: v})}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="preparation">הכנה</SelectItem>
                    <SelectItem value="cultivation">טיפוח</SelectItem>
                    <SelectItem value="harvest">קטיף</SelectItem>
                    <SelectItem value="maintenance">תחזוקה</SelectItem>
                    <SelectItem value="treatment">טיפול</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>מחיר לדונם</Label>
                <Input 
                  type="number"
                  step="0.01"
                  value={formData.price_per_dunam} 
                  onChange={(e) => setFormData({...formData, price_per_dunam: e.target.value})} 
                />
              </div>
              <div>
                <Label>יחידת מדידה</Label>
                <Select value={formData.unit} onValueChange={(v) => setFormData({...formData, unit: v})}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="per_dunam">לדונם</SelectItem>
                    <SelectItem value="fixed_amount">סכום קבוע</SelectItem>
                    <SelectItem value="hourly">לשעה</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>תיאור</Label>
                <Textarea 
                  value={formData.description} 
                  onChange={(e) => setFormData({...formData, description: e.target.value})} 
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
