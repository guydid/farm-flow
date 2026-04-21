
import React, { useState, useEffect } from "react";
import { ManpowerCompany } from "@/entities/all";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Edit, Trash2, Loader2 } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";

export default function ManpowerCompaniesManager({ currentFarm }) {
  const [manpowerCompanies, setManpowerCompanies] = useState([]); // Renamed from 'companies'
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingCompany, setEditingCompany] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();

  const initialFormData = {
    name: "",
    contact_person: "",
    phone: "",
    email: ""
  };
  const [formData, setFormData] = useState(initialFormData);

  useEffect(() => {
    console.log('ManpowerCompaniesManager - currentFarm:', currentFarm?.id);
    loadManpowerCompanies(); // Renamed function call
  }, [currentFarm?.id]); // Updated dependency to currentFarm?.id

  const loadManpowerCompanies = async () => { // Renamed function
    if (!currentFarm?.id) { // Updated condition to check for farm ID
      console.log('ManpowerCompaniesManager - No farm ID, clearing data'); // Updated log
      setManpowerCompanies([]); // Updated state setter
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      console.log('ManpowerCompaniesManager - Loading for farm ID:', currentFarm.id);
      const data = await ManpowerCompany.list(); // Changed from filter to list
      
      // STRONG client-side filter
      const filtered = Array.isArray(data) 
        ? data.filter(item => item.farm_id === currentFarm.id)
        : [];
      
      console.log('ManpowerCompaniesManager - Loaded:', filtered?.length, 'items'); // Updated log
      setManpowerCompanies(filtered); // Updated state setter
    } catch (error) {
      console.error("Failed to load manpower companies:", error);
      toast({ title: "שגיאה", description: "טעינת חברות כ\"א נכשלה", variant: "destructive" });
      setManpowerCompanies([]); // Updated state setter
    } finally {
      setIsLoading(false);
    }
  };

  const handleEdit = (item) => {
    setEditingCompany(item);
    setFormData({
      name: item.name || "",
      contact_person: item.contact_person || "",
      phone: item.phone || "",
      email: item.email || ""
    });
    setIsDialogOpen(true);
  };

  const handleDelete = async (id) => {
    if (window.confirm("האם אתה בטוח שברצונך למחוק חברת כ\"א זו?")) {
      try {
        await ManpowerCompany.delete(id);
        toast({ title: "הצלחה", description: "חברת כ\"א נמחקה בהצלחה" });
        loadManpowerCompanies(); // Updated function call
      } catch (error) {
        console.error("Failed to delete manpower company:", error);
        toast({ title: "שגיאה", description: "מחיקת חברת כ\"א נכשלה", variant: "destructive" });
      }
    }
  };

  const resetForm = () => {
    setEditingCompany(null);
    setFormData(initialFormData);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!currentFarm) {
      toast({ title: "שגיאה", description: "לא נבחר משק פעיל", variant: "destructive" });
      return;
    }

    try {
      const dataToSave = { ...formData, farm_id: currentFarm.id };

      console.log('ManpowerCompaniesManager - Saving:', dataToSave);

      if (editingCompany) {
        await ManpowerCompany.update(editingCompany.id, dataToSave);
        toast({ title: "הצלחה", description: "חברת כ\"א עודכנה בהצלחה" });
      } else {
        await ManpowerCompany.create(dataToSave);
        toast({ title: "הצלחה", description: "חברת כ\"א נוספה בהצלחה" });
      }

      setIsDialogOpen(false);
      resetForm();
      loadManpowerCompanies(); // Updated function call
    } catch (error) {
      console.error("Failed to save manpower company:", error);
      toast({ title: "שגיאה", description: "שמירת חברת כ\"א נכשלה", variant: "destructive" });
    }
  };

  if (!currentFarm) {
    return (
      <Card>
        <CardHeader><CardTitle>ניהול חברות כ"א</CardTitle></CardHeader>
        <CardContent>
          <p className="text-center py-4 text-gray-500">
            אנא בחר משק פעיל כדי לנהל חברות כ"א.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="mt-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>ניהול חברות כ"א</CardTitle>
          <Button onClick={() => { resetForm(); setIsDialogOpen(true); }}>
            <Plus className="w-4 h-4 ml-2" /> הוסף חברת כ"א
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
                  <TableHead>טלפון</TableHead>
                  <TableHead>איש קשר</TableHead>
                  <TableHead>שם החברה</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {manpowerCompanies.length === 0 ? ( // Updated state variable
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-4">
                      אין חברות כ"א זמינות עבור משק זה.
                    </TableCell>
                  </TableRow>
                ) : (
                  manpowerCompanies.map(company => ( // Updated state variable
                    <TableRow key={company.id}>
                      <TableCell>
                        <div className="flex gap-2">
                          <Button variant="ghost" size="icon" onClick={() => handleEdit(company)}>
                            <Edit className="w-4 h-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => handleDelete(company.id)}>
                            <Trash2 className="w-4 h-4 text-red-500" />
                          </Button>
                        </div>
                      </TableCell>
                      <TableCell>{company.phone || '-'}</TableCell>
                      <TableCell>{company.contact_person || '-'}</TableCell>
                      <TableCell className="font-medium">{company.name}</TableCell>
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
            <DialogTitle>{editingCompany ? 'עריכת חברת כ"א' : 'הוספת חברת כ"א'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit}>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="name">שם החברה *</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="contact_person">איש קשר</Label>
                <Input
                  id="contact_person"
                  value={formData.contact_person}
                  onChange={(e) => setFormData({ ...formData, contact_person: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="phone">טלפון</Label>
                  <Input
                    id="phone"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="email">אימייל</Label>
                  <Input
                    id="email"
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  />
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => { setIsDialogOpen(false); resetForm(); }}>
                ביטול
              </Button>
              <Button type="submit">
                {editingCompany ? 'עדכן' : 'הוסף'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
