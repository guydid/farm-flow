import React, { useState, useEffect, useCallback } from "react";
import { PlasticSheet, SheetType, User, Farm } from "@/entities/all";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/use-toast";
import { Plus, Edit, Trash2, Save, X } from "lucide-react";
import { format } from "date-fns";

export default function SheetTracker({ plot, isOpen, onClose }) {
  const [sheets, setSheets] = useState([]);
  const [sheetTypes, setSheetTypes] = useState([]);
  const [currentFarm, setCurrentFarm] = useState(null);
  const [editingSheet, setEditingSheet] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const [newSheet, setNewSheet] = useState({
    sheet_number: "",
    sub_plot: "",
    direction: "north",
    length: "",
    width: "",
    sheet_type: "",
    weight: "",
    price: "",
    installation_date: format(new Date(), 'yyyy-MM-dd'),
    replacement_cycle_months: 12,
    supplier: "",
    status: "installed",
    notes: ""
  });

  const loadData = useCallback(async () => {
    if (!plot?.id) return;
    
    try {
      const user = await User.me();
      if (!user.current_farm_id) {
        return;
      }

      const farm = await Farm.get(user.current_farm_id);
      setCurrentFarm(farm);

      const [plotSheets, allSheetTypes] = await Promise.all([
        PlasticSheet.filter({ plot_id: plot.id }),
        SheetType.list()
      ]);

      setSheets(Array.isArray(plotSheets) ? plotSheets : []);
      setSheetTypes(Array.isArray(allSheetTypes) ? allSheetTypes : []);
    } catch (error) {
      console.error("Failed to load sheet data:", error);
      toast({ title: "שגיאה", description: "טעינת נתוני יריעות נכשלה.", variant: "destructive" });
    }
  }, [plot?.id, toast]);

  useEffect(() => {
    if (isOpen) {
      loadData();
    }
  }, [isOpen, loadData]);

  const handleAddSheet = async () => {
    if (!newSheet.sheet_number || !currentFarm) {
      toast({ title: "שגיאה", description: "מספר יריעה ומשק נדרשים.", variant: "destructive" });
      return;
    }

    setIsLoading(true);
    try {
      await PlasticSheet.create({
        ...newSheet,
        farm_id: currentFarm.id,
        plot_id: plot.id,
        sheet_number: parseInt(newSheet.sheet_number),
        length: parseFloat(newSheet.length) || 0,
        width: parseFloat(newSheet.width) || 0,
        weight: parseFloat(newSheet.weight) || 0,
        price: parseFloat(newSheet.price) || 0,
        replacement_cycle_months: parseInt(newSheet.replacement_cycle_months) || 12
      });
      
      toast({ title: "הצלחה", description: "יריעה נוספה בהצלחה." });
      setNewSheet({
        sheet_number: "",
        sub_plot: "",
        direction: "north",
        length: "",
        width: "",
        sheet_type: "",
        weight: "",
        price: "",
        installation_date: format(new Date(), 'yyyy-MM-dd'),
        replacement_cycle_months: 12,
        supplier: "",
        status: "installed",
        notes: ""
      });
      loadData();
    } catch (error) {
      console.error("Failed to add sheet:", error);
      toast({ title: "שגיאה", description: "הוספת יריעה נכשלה.", variant: "destructive" });
    }
    setIsLoading(false);
  };

  const handleUpdateSheet = async (sheet, updates) => {
    if (!currentFarm) {
      toast({ title: "שגיאה", description: "משק לא נמצא.", variant: "destructive" });
      return;
    }

    setIsLoading(true);
    try {
      const updateData = {
        ...sheet,
        ...updates,
        farm_id: currentFarm.id, // Ensure farm_id is included
        sheet_number: parseInt(updates.sheet_number || sheet.sheet_number),
        length: parseFloat(updates.length || sheet.length) || 0,
        width: parseFloat(updates.width || sheet.width) || 0,
        weight: parseFloat(updates.weight || sheet.weight) || 0,
        price: parseFloat(updates.price || sheet.price) || 0,
        replacement_cycle_months: parseInt(updates.replacement_cycle_months || sheet.replacement_cycle_months) || 12
      };

      await PlasticSheet.update(sheet.id, updateData);
      toast({ title: "הצלחה", description: "יריעה עודכנה בהצלחה." });
      setEditingSheet(null);
      loadData();
    } catch (error) {
      console.error("Failed to update sheet:", error);
      toast({ title: "שגיאה", description: "עדכון יריעה נכשל.", variant: "destructive" });
    }
    setIsLoading(false);
  };

  const handleDeleteSheet = async (sheetId) => {
    if (!window.confirm("האם אתה בטוח שברצונך למחוק יריעה זו?")) return;

    setIsLoading(true);
    try {
      await PlasticSheet.delete(sheetId);
      toast({ title: "הצלחה", description: "יריעה נמחקה בהצלחה." });
      loadData();
    } catch (error) {
      console.error("Failed to delete sheet:", error);
      toast({ title: "שגיאה", description: "מחיקת יריעה נכשלה.", variant: "destructive" });
    }
    setIsLoading(false);
  };

  const getStatusVariant = (status) => {
    const variants = {
      installed: "bg-green-100 text-green-800",
      to_order: "bg-orange-100 text-orange-800",
      ordered: "bg-blue-100 text-blue-800",
      in_stock: "bg-purple-100 text-purple-800",
      needs_replacement: "bg-red-100 text-red-800",
      replaced: "bg-gray-100 text-gray-800"
    };
    return variants[status] || "bg-gray-100 text-gray-800";
  };

  const getStatusText = (status) => {
    const statusTexts = {
      installed: "מותקן",
      to_order: "להזמנה",
      ordered: "הוזמן",
      in_stock: "במלאי",
      needs_replacement: "צריך החלפה",
      replaced: "הוחלף"
    };
    return statusTexts[status] || status;
  };

  if (!isOpen) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle>ניהול יריעות - חלקה {plot?.name}</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Add new sheet form */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Plus className="w-5 h-5" />
                הוספת יריעה חדשה
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <Label>מספר יריעה *</Label>
                  <Input
                    type="number"
                    value={newSheet.sheet_number}
                    onChange={(e) => setNewSheet({...newSheet, sheet_number: e.target.value})}
                    placeholder="מספר יריעה"
                  />
                </div>
                <div>
                  <Label>תת-חלקה</Label>
                  <Input
                    value={newSheet.sub_plot}
                    onChange={(e) => setNewSheet({...newSheet, sub_plot: e.target.value})}
                    placeholder="תת-חלקה"
                  />
                </div>
                <div>
                  <Label>כיוון</Label>
                  <Select value={newSheet.direction} onValueChange={(value) => setNewSheet({...newSheet, direction: value})}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="north">צפון</SelectItem>
                      <SelectItem value="south">דרום</SelectItem>
                      <SelectItem value="east">מזרח</SelectItem>
                      <SelectItem value="west">מערב</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>אורך (מ')</Label>
                  <Input
                    type="number"
                    step="0.1"
                    value={newSheet.length}
                    onChange={(e) => setNewSheet({...newSheet, length: e.target.value})}
                  />
                </div>
                <div>
                  <Label>רוחב (מ')</Label>
                  <Input
                    type="number"
                    step="0.1"
                    value={newSheet.width}
                    onChange={(e) => setNewSheet({...newSheet, width: e.target.value})}
                  />
                </div>
                <div>
                  <Label>סוג יריעה</Label>
                  <Input
                    value={newSheet.sheet_type}
                    onChange={(e) => setNewSheet({...newSheet, sheet_type: e.target.value})}
                    placeholder="סוג יריעה"
                  />
                </div>
                <div>
                  <Label>תאריך התקנה</Label>
                  <Input
                    type="date"
                    value={newSheet.installation_date}
                    onChange={(e) => setNewSheet({...newSheet, installation_date: e.target.value})}
                  />
                </div>
                <div>
                  <Label>מחזור החלפה (חודשים)</Label>
                  <Input
                    type="number"
                    value={newSheet.replacement_cycle_months}
                    onChange={(e) => setNewSheet({...newSheet, replacement_cycle_months: e.target.value})}
                  />
                </div>
                <div>
                  <Label>סטטוס</Label>
                  <Select value={newSheet.status} onValueChange={(value) => setNewSheet({...newSheet, status: value})}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="installed">מותקן</SelectItem>
                      <SelectItem value="to_order">להזמנה</SelectItem>
                      <SelectItem value="ordered">הוזמן</SelectItem>
                      <SelectItem value="in_stock">במלאי</SelectItem>
                      <SelectItem value="needs_replacement">צריך החלפה</SelectItem>
                      <SelectItem value="replaced">הוחלף</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="mt-4">
                <Button onClick={handleAddSheet} disabled={isLoading}>
                  <Plus className="w-4 h-4 mr-2" />
                  הוסף יריעה
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Existing sheets table */}
          <Card>
            <CardHeader>
              <CardTitle>יריעות קיימות</CardTitle>
            </CardHeader>
            <CardContent>
              {sheets.length === 0 ? (
                <p className="text-center text-gray-500 py-8">אין יריעות רשומות עבור חלקה זו</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>מספר יריעה</TableHead>
                      <TableHead>תת-חלקה</TableHead>
                      <TableHead>כיוון</TableHead>
                      <TableHead>מידות (מ')</TableHead>
                      <TableHead>סוג</TableHead>
                      <TableHead>תאריך התקנה</TableHead>
                      <TableHead>סטטוס</TableHead>
                      <TableHead>פעולות</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sheets.map((sheet) => (
                      <TableRow key={sheet.id}>
                        <TableCell>{sheet.sheet_number}</TableCell>
                        <TableCell>{sheet.sub_plot || '-'}</TableCell>
                        <TableCell>
                          {sheet.direction === 'north' ? 'צפון' :
                           sheet.direction === 'south' ? 'דרום' :
                           sheet.direction === 'east' ? 'מזרח' :
                           sheet.direction === 'west' ? 'מערב' : sheet.direction}
                        </TableCell>
                        <TableCell>
                          {sheet.length && sheet.width ? `${sheet.length}×${sheet.width}` : '-'}
                        </TableCell>
                        <TableCell>{sheet.sheet_type || '-'}</TableCell>
                        <TableCell>
                          {sheet.installation_date ? format(new Date(sheet.installation_date), 'dd/MM/yyyy') : '-'}
                        </TableCell>
                        <TableCell>
                          <Badge className={getStatusVariant(sheet.status)}>
                            {getStatusText(sheet.status)}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setEditingSheet(sheet)}
                            >
                              <Edit className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDeleteSheet(sheet.id)}
                              className="text-red-600 hover:text-red-800"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            סגור
          </Button>
        </DialogFooter>

        {/* Edit sheet dialog */}
        {editingSheet && (
          <EditSheetDialog
            sheet={editingSheet}
            onSave={(updates) => handleUpdateSheet(editingSheet, updates)}
            onClose={() => setEditingSheet(null)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

// Edit sheet dialog component
function EditSheetDialog({ sheet, onSave, onClose }) {
  const [formData, setFormData] = useState({
    sheet_number: sheet.sheet_number?.toString() || "",
    sub_plot: sheet.sub_plot || "",
    direction: sheet.direction || "north",
    length: sheet.length?.toString() || "",
    width: sheet.width?.toString() || "",
    sheet_type: sheet.sheet_type || "",
    weight: sheet.weight?.toString() || "",
    price: sheet.price?.toString() || "",
    installation_date: sheet.installation_date ? format(new Date(sheet.installation_date), 'yyyy-MM-dd') : "",
    replacement_cycle_months: sheet.replacement_cycle_months?.toString() || "12",
    supplier: sheet.supplier || "",
    status: sheet.status || "installed",
    notes: sheet.notes || ""
  });

  const handleSave = () => {
    onSave(formData);
  };

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl" dir="rtl">
        <DialogHeader>
          <DialogTitle>עריכת יריעה #{sheet.sheet_number}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label>מספר יריעה</Label>
            <Input
              type="number"
              value={formData.sheet_number}
              onChange={(e) => setFormData({...formData, sheet_number: e.target.value})}
            />
          </div>
          <div>
            <Label>תת-חלקה</Label>
            <Input
              value={formData.sub_plot}
              onChange={(e) => setFormData({...formData, sub_plot: e.target.value})}
            />
          </div>
          <div>
            <Label>כיוון</Label>
            <Select value={formData.direction} onValueChange={(value) => setFormData({...formData, direction: value})}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="north">צפון</SelectItem>
                <SelectItem value="south">דרום</SelectItem>
                <SelectItem value="east">מזרח</SelectItem>
                <SelectItem value="west">מערב</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>אורך (מ')</Label>
            <Input
              type="number"
              step="0.1"
              value={formData.length}
              onChange={(e) => setFormData({...formData, length: e.target.value})}
            />
          </div>
          <div>
            <Label>רוחב (מ')</Label>
            <Input
              type="number"
              step="0.1"
              value={formData.width}
              onChange={(e) => setFormData({...formData, width: e.target.value})}
            />
          </div>
          <div>
            <Label>סוג יריעה</Label>
            <Input
              value={formData.sheet_type}
              onChange={(e) => setFormData({...formData, sheet_type: e.target.value})}
            />
          </div>
          <div>
            <Label>תאריך התקנה</Label>
            <Input
              type="date"
              value={formData.installation_date}
              onChange={(e) => setFormData({...formData, installation_date: e.target.value})}
            />
          </div>
          <div>
            <Label>מחזור החלפה (חודשים)</Label>
            <Input
              type="number"
              value={formData.replacement_cycle_months}
              onChange={(e) => setFormData({...formData, replacement_cycle_months: e.target.value})}
            />
          </div>
          <div className="md:col-span-2">
            <Label>סטטוס</Label>
            <Select value={formData.status} onValueChange={(value) => setFormData({...formData, status: value})}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="installed">מותקן</SelectItem>
                <SelectItem value="to_order">להזמנה</SelectItem>
                <SelectItem value="ordered">הוזמן</SelectItem>
                <SelectItem value="in_stock">במלאי</SelectItem>
                <SelectItem value="needs_replacement">צריך החלפה</SelectItem>
                <SelectItem value="replaced">הוחלף</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="md:col-span-2">
            <Label>הערות</Label>
            <Textarea
              value={formData.notes}
              onChange={(e) => setFormData({...formData, notes: e.target.value})}
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            ביטול
          </Button>
          <Button onClick={handleSave}>
            <Save className="w-4 h-4 mr-2" />
            שמור
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}