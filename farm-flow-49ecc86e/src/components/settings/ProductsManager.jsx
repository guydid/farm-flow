
import React, { useState, useEffect } from "react";
import { Product } from "@/entities/all";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Plus, Edit, Trash2, Loader2 } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { invalidateList } from "@/api/cachedReads";

export default function ProductsManager({ currentFarm }) {
  const [products, setProducts] = useState([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();

  const initialFormData = {
    name: "",
    crop_type: "",
    default_pricing_method: "per_kg",
    weighable: true
  };
  const [formData, setFormData] = useState(initialFormData);

  useEffect(() => {
    console.log('ProductsManager - currentFarm changed:', currentFarm);
    loadProducts();
  }, [currentFarm?.id]); // Changed dependency to currentFarm?.id

  const loadProducts = async () => {
    if (!currentFarm?.id) { // Changed condition to currentFarm?.id
      console.log('ProductsManager - No current farm ID');
      setProducts([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      console.log('ProductsManager - Loading all products for filtering');
      const data = await Product.list(); // Fetch all products
      
      // STRONG client-side filter
      const filtered = Array.isArray(data) 
        ? data.filter(item => item.farm_id === currentFarm.id)
        : [];
      
      console.log('ProductsManager - Filtered products:', filtered);
      setProducts(filtered);
    } catch (error) {
      console.error("Failed to load products:", error);
      toast({ title: "שגיאה", description: "טעינת המוצרים נכשלה", variant: "destructive" }); // Keep toast for errors
      setProducts([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleEdit = (product) => {
    setEditingProduct(product);
    setFormData({
      name: product.name || "",
      crop_type: product.crop_type || "",
      default_pricing_method: product.default_pricing_method || "per_kg",
      weighable: product.weighable !== false
    });
    setIsDialogOpen(true);
  };

  const handleDelete = async (productId) => {
    if (!window.confirm("האם אתה בטוח שברצונך למחוק מוצר זה?")) return;

    try {
      await Product.delete(productId);
      invalidateList(`products_${currentFarm?.id}`);
      toast({ title: "הצלחה", description: "המוצר נמחק בהצלחה" });
      loadProducts();
    } catch (error) {
      console.error("Failed to delete product:", error);
      toast({ title: "שגיאה", description: "מחיקת המוצר נכשלה", variant: "destructive" });
    }
  };

  const resetForm = () => {
    setEditingProduct(null);
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

      if (editingProduct) {
        await Product.update(editingProduct.id, dataToSave);
        toast({ title: "הצלחה", description: "המוצר עודכן בהצלחה" });
      } else {
        await Product.create(dataToSave);
        toast({ title: "הצלחה", description: "המוצר נוסף בהצלחה" });
      }
      invalidateList(`products_${currentFarm?.id}`);

      setIsDialogOpen(false);
      resetForm();
      loadProducts();
    } catch (error) {
      console.error("Failed to save product:", error);
      toast({ title: "שגיאה", description: "שמירת המוצר נכשלה", variant: "destructive" });
    }
  };

  if (!currentFarm) {
    return (
      <Card>
        <CardHeader><CardTitle>ניהול מוצרים</CardTitle></CardHeader>
        <CardContent>
          <p className="text-center py-4 text-gray-500">
            אנא בחר משק פעיל כדי לנהל מוצרים.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="mt-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>ניהול מוצרים</CardTitle>
          <Button onClick={() => { resetForm(); setIsDialogOpen(true); }}>
            <Plus className="w-4 h-4 ml-2" /> הוסף מוצר
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
                  <TableHead>ניתן לשקילה</TableHead>
                  <TableHead>שיטת תמחור</TableHead>
                  <TableHead>סוג גידול</TableHead>
                  <TableHead>שם המוצר</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {products.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-4 text-gray-500">
                      אין מוצרים להצגה. לחץ על 'הוסף מוצר' כדי ליצור חדש.
                    </TableCell>
                  </TableRow>
                ) : (
                  products.map((product) => (
                    <TableRow key={product.id}>
                      <TableCell>
                        <div className="flex gap-2">
                          <Button variant="ghost" size="icon" onClick={() => handleEdit(product)}>
                            <Edit className="w-4 h-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => handleDelete(product.id)} className="text-red-500">
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </TableCell>
                      <TableCell>{product.weighable !== false ? "כן" : "לא"}</TableCell>
                      <TableCell>{product.default_pricing_method === "per_kg" ? "לפי ק\"ג" : "לפי יחידה"}</TableCell>
                      <TableCell>{product.crop_type || "-"}</TableCell>
                      <TableCell className="font-medium">{product.name}</TableCell>
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
            <DialogTitle>{editingProduct ? "ערוך מוצר" : "הוסף מוצר חדש"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit}>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="name">שם המוצר</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="crop_type">סוג גידול</Label>
                <Input
                  id="crop_type"
                  value={formData.crop_type}
                  onChange={(e) => setFormData({ ...formData, crop_type: e.target.value })}
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label>שיטת תמחור</Label>
                <Select
                  value={formData.default_pricing_method}
                  onValueChange={(v) => setFormData({ ...formData, default_pricing_method: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="per_kg">לפי ק"ג</SelectItem>
                    <SelectItem value="per_unit">לפי יחידה</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  id="weighable"
                  checked={formData.weighable}
                  onCheckedChange={(checked) => setFormData({ ...formData, weighable: checked })}
                />
                <Label htmlFor="weighable">ניתן לשקילה</Label>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                ביטול
              </Button>
              <Button type="submit">{editingProduct ? "עדכן" : "צור"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
