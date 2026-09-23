
import React, { useState, useEffect } from "react";
import { Packaging, Product } from "@/entities/all";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Edit, Trash2, Loader2 } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { invalidateList } from "@/api/cachedReads";

export default function PackagingManager({ currentFarm }) {
  const [packaging, setPackaging] = useState([]); // Renamed from packagings
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingPackage, setEditingPackage] = useState(null); // Renamed from editingPackaging
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();

  const initialFormData = {
    name: "",
    tare_weight: "",
    expected_weight: "",
    weighable: true,      // אריזה שקילה: נשקלת (ברוטו/טרה/נטו). לא שקילה: נספרת ביחידות בלבד
    product_ids: []       // שיוך למוצרים; ריק = מתאימה לכל המוצרים
  };
  const [formData, setFormData] = useState(initialFormData);
  const [products, setProducts] = useState([]);

  useEffect(() => {
    if (!currentFarm?.id) { setProducts([]); return; }
    Product.filter({ farm_id: currentFarm.id })
      .then(data => setProducts(Array.isArray(data) ? data : []))
      .catch(() => setProducts([]));
  }, [currentFarm?.id]);

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
      expected_weight: item.expected_weight?.toString() || "",
      weighable: item.weighable !== false,
      product_ids: Array.isArray(item.product_ids) ? item.product_ids : []
    });
    setIsDialogOpen(true);
  };

  const handleDelete = async (id) => {
    if (window.confirm("האם אתה בטוח שברצונך למחוק אריזה זו?")) {
      try {
        await Packaging.delete(id);
        invalidateList(`packaging_${currentFarm?.id}`);
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
        weighable: formData.weighable !== false,
        product_ids: Array.isArray(formData.product_ids) ? formData.product_ids : [],
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

      invalidateList(`packaging_${currentFarm?.id}`);
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
                  <TableHead>מוצרים</TableHead>
                  <TableHead>שקילה</TableHead>
                  <TableHead>משקל צפוי</TableHead>
                  <TableHead>משקל טרה (ק"ג)</TableHead>
                  <TableHead>שם האריזה</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {packaging.length === 0 ? ( // Renamed state
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-4">
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
                      <TableCell className="text-xs text-gray-600 max-w-[200px]">
                        {Array.isArray(pack.product_ids) && pack.product_ids.length > 0
                          ? pack.product_ids.map(id => products.find(p => p.id === id)?.name).filter(Boolean).join(', ')
                          : 'כל המוצרים'}
                      </TableCell>
                      <TableCell>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${pack.weighable !== false ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                          {pack.weighable !== false ? 'שקילה' : 'יחידות'}
                        </span>
                      </TableCell>
                      <TableCell>{pack.expected_weight ? `${pack.expected_weight} ק"ג` : '-'}</TableCell>
                      <TableCell>{pack.weighable !== false ? `${pack.tare_weight} ק"ג` : '-'}</TableCell>
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
                <Label>סוג האריזה</Label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, weighable: true })}
                    className={`px-3 py-2.5 rounded-xl border text-sm font-medium transition-colors ${formData.weighable ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-700 border-gray-200'}`}
                  >
                    שקילה
                    <div className={`text-[10px] mt-0.5 ${formData.weighable ? 'text-indigo-200' : 'text-gray-400'}`}>נשקלת — ברוטו/טרה/נטו</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, weighable: false })}
                    className={`px-3 py-2.5 rounded-xl border text-sm font-medium transition-colors ${!formData.weighable ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-700 border-gray-200'}`}
                  >
                    לא שקילה
                    <div className={`text-[10px] mt-0.5 ${!formData.weighable ? 'text-indigo-200' : 'text-gray-400'}`}>נספרת ביחידות בלבד</div>
                  </button>
                </div>
              </div>

              {formData.weighable && (
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
              )}

              <div className="space-y-2">
                <Label>מוצרים מתאימים</Label>
                <p className="text-xs text-gray-500 -mt-1">ללא בחירה — האריזה תוצג לכל המוצרים</p>
                <div className="flex flex-wrap gap-2">
                  {products.map(p => {
                    const selected = formData.product_ids.includes(p.id);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setFormData({
                          ...formData,
                          product_ids: selected
                            ? formData.product_ids.filter(id => id !== p.id)
                            : [...formData.product_ids, p.id]
                        })}
                        className={`px-3 py-1.5 rounded-full border text-sm transition-colors ${selected ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-200'}`}
                      >
                        {p.name}
                      </button>
                    );
                  })}
                  {products.length === 0 && <span className="text-xs text-gray-400">אין מוצרים מוגדרים</span>}
                </div>
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
