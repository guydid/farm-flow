
import React, { useState, useEffect } from "react";
import { Customer } from "@/entities/all";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Edit, Trash2, Loader2 } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";

export default function CustomersManager({ currentFarm }) {
  const [customers, setCustomers] = useState([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();

  const initialFormData = {
    name: "",
    contact_person: "",
    phone: "",
    email: "",
    address: ""
  };
  const [formData, setFormData] = useState(initialFormData);

  useEffect(() => {
    loadCustomers();
  }, [currentFarm?.id]);

  const loadCustomers = async () => {
    if (!currentFarm?.id) {
      setCustomers([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const data = await Customer.list();
      
      // STRONG client-side filter
      const filtered = Array.isArray(data) 
        ? data.filter(item => item.farm_id === currentFarm.id)
        : [];
      
      setCustomers(filtered);
    } catch (error) {
      console.error("Failed to load customers:", error);
      toast({ title: "שגיאה", description: "טעינת הלקוחות נכשלה", variant: "destructive" });
      setCustomers([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleEdit = (item) => {
    setEditingCustomer(item);
    setFormData({
      name: item.name || "",
      contact_person: item.contact_person || "",
      phone: item.phone || "",
      email: item.email || "",
      address: item.address || ""
    });
    setIsDialogOpen(true);
  };

  const handleDelete = async (id) => {
    if (window.confirm("האם אתה בטוח שברצונך למחוק לקוח זה?")) {
      try {
        await Customer.delete(id);
        toast({ title: "הצלחה", description: "הלקוח נמחק בהצלחה" });
        loadCustomers();
      } catch (error) {
        console.error("Failed to delete customer:", error);
        toast({ title: "שגיאה", description: "מחיקת הלקוח נכשלה", variant: "destructive" });
      }
    }
  };

  const resetForm = () => {
    setEditingCustomer(null);
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

      console.log('CustomersManager - Saving:', dataToSave);

      if (editingCustomer) {
        await Customer.update(editingCustomer.id, dataToSave);
        toast({ title: "הצלחה", description: "הלקוח עודכן בהצלחה" });
      } else {
        await Customer.create(dataToSave);
        toast({ title: "הצלחה", description: "הלקוח נוסף בהצלחה" });
      }

      setIsDialogOpen(false);
      resetForm();
      loadCustomers();
    } catch (error) {
      console.error("Failed to save customer:", error);
      toast({ title: "שגיאה", description: "שמירת הלקוח נכשלה", variant: "destructive" });
    }
  };

  if (!currentFarm) {
    return (
      <Card>
        <CardHeader><CardTitle>ניהול לקוחות</CardTitle></CardHeader>
        <CardContent>
          <p className="text-center py-4 text-gray-500">
            אנא בחר משק פעיל כדי לנהל לקוחות.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="mt-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>ניהול לקוחות</CardTitle>
          <Button onClick={() => { resetForm(); setIsDialogOpen(true); }}>
            <Plus className="w-4 h-4 ml-2" /> הוסף לקוח
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
                  <TableHead>שם הלקוח</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {customers.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-4">
                      אין לקוחות זמינים עבור משק זה.
                    </TableCell>
                  </TableRow>
                ) : (
                  customers.map(customer => (
                    <TableRow key={customer.id}>
                      <TableCell>
                        <div className="flex gap-2">
                          <Button variant="ghost" size="icon" onClick={() => handleEdit(customer)}>
                            <Edit className="w-4 h-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => handleDelete(customer.id)}>
                            <Trash2 className="w-4 h-4 text-red-500" />
                          </Button>
                        </div>
                      </TableCell>
                      <TableCell>{customer.phone || '-'}</TableCell>
                      <TableCell>{customer.contact_person || '-'}</TableCell>
                      <TableCell className="font-medium">{customer.name}</TableCell>
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
            <DialogTitle>{editingCustomer ? 'עריכת לקוח' : 'הוספת לקוח'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit}>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="name">שם הלקוח *</Label>
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

              <div className="space-y-2">
                <Label htmlFor="address">כתובת</Label>
                <Input
                  id="address"
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                />
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => { setIsDialogOpen(false); resetForm(); }}>
                ביטול
              </Button>
              <Button type="submit">
                {editingCustomer ? 'עדכן' : 'הוסף'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
