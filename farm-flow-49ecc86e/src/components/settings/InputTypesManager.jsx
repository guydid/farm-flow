
import React, { useState, useEffect } from "react";
import { InputType } from "@/entities/all";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Edit, Trash2, Loader2 } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";

export default function InputTypesManager({ currentFarm }) {
  const [inputTypes, setInputTypes] = useState([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingType, setEditingType] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();

  const [formData, setFormData] = useState({
    name: "",
    category: "inputs"
  });

  useEffect(() => {
    loadInputTypes();
  }, [currentFarm?.id]); // Changed dependency from currentFarm to currentFarm?.id

  const loadInputTypes = async () => {
    if (!currentFarm?.id) {
      setInputTypes([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const data = await InputType.list(); // Changed to fetch all items
      
      // STRONG client-side filter
      const filtered = Array.isArray(data) 
        ? data.filter(item => item.farm_id === currentFarm.id)
        : [];
      
      setInputTypes(filtered); // Set the filtered data
    } catch (error) {
      console.error("Failed to load input types:", error);
      setInputTypes([]);
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
        category: formData.category
      };

      if (editingType) {
        await InputType.update(editingType.id, data);
      } else {
        await InputType.create(data);
      }

      toast({ title: "הצלחה", description: "סוג התשומה נשמר בהצלחה" });
      setIsDialogOpen(false);
      setFormData({ name: "", category: "inputs" });
      setEditingType(null);
      loadInputTypes();
    } catch (error) {
      console.error("Save error:", error);
      toast({ title: "שגיאה", description: "שמירה נכשלה", variant: "destructive" });
    }
  };

  const handleEdit = (item) => {
    setEditingType(item);
    setFormData({
      name: item.name || "",
      category: item.category || "inputs"
    });
    setIsDialogOpen(true);
  };

  const handleDelete = async (id) => {
    if (window.confirm("האם למחוק?")) {
      try {
        await InputType.delete(id);
        toast({ title: "הצלחה", description: "נמחק בהצלחה" });
        loadInputTypes();
      } catch (error) {
        console.error("Delete error:", error);
        toast({ title: "שגיאה", description: "מחיקה נכשלה", variant: "destructive" });
      }
    }
  };

  if (!currentFarm?.id) {
    return (
      <Card>
        <CardHeader><CardTitle>ניהול סוגי תשומות</CardTitle></CardHeader>
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
          <CardTitle>ניהול סוגי תשומות</CardTitle>
          <Button onClick={() => { setFormData({ name: "", category: "inputs" }); setEditingType(null); setIsDialogOpen(true); }}>
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
                  <TableHead>פעולות</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {inputTypes.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center">אין סוגי תשומות</TableCell>
                  </TableRow>
                ) : (
                  inputTypes.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>{item.name}</TableCell>
                      <TableCell>{item.category}</TableCell>
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
            <DialogTitle>{editingType ? "ערוך" : "הוסף"} סוג תשומה</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit}>
            <div className="grid gap-4 py-4">
              <div>
                <Label>שם</Label>
                <Input 
                  value={formData.name} 
                  onChange={(e) => setFormData({...formData, name: e.target.value})} 
                  required 
                  placeholder="לדוגמה: דשן, זרעים"
                />
              </div>
              <div>
                <Label>קטגוריה</Label>
                <Select value={formData.category} onValueChange={(v) => setFormData({...formData, category: v})}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="labor">עבודה</SelectItem>
                    <SelectItem value="inputs">תשומות</SelectItem>
                    <SelectItem value="general">כללי</SelectItem>
                  </SelectContent>
                </Select>
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
