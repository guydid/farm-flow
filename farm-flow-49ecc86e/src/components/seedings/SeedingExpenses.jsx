import React, { useState } from "react";
import { Expense } from "@/entities/all";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format } from "date-fns";
import { Plus } from "lucide-react";

export default function SeedingExpenses({ seedingId, expenses, onUpdate }) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [formData, setFormData] = useState({ date: "", category: "", type: "", description: "", amount: "" });
  
  const handleAddExpense = async () => {
    await Expense.create({ ...formData, seeding_id: seedingId, amount: parseFloat(formData.amount) });
    onUpdate();
    setIsDialogOpen(false);
    setFormData({ date: "", category: "", type: "", description: "", amount: "" });
  };
  
  const translateCategory = (cat) => ({ labor: "עבודה", inputs: "תשומות" }[cat] || cat);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>ניהול הוצאות</CardTitle>
        <Button onClick={() => setIsDialogOpen(true)}><Plus className="w-4 h-4 ml-2"/>הוסף הוצאה</Button>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>תאריך</TableHead>
              <TableHead>קטגוריה</TableHead>
              <TableHead>סוג</TableHead>
              <TableHead>סכום</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {expenses.map(expense => (
              <TableRow key={expense.id}>
                <TableCell>{format(new Date(expense.date), "dd/MM/yyyy")}</TableCell>
                <TableCell>{translateCategory(expense.category)}</TableCell>
                <TableCell>{expense.type}</TableCell>
                <TableCell>₪{expense.amount.toLocaleString()}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>הוספת הוצאה חדשה</DialogTitle></DialogHeader>
            <div className="space-y-4 py-4">
              <div><Label>תאריך</Label><Input type="date" value={formData.date} onChange={e => setFormData({...formData, date: e.target.value})} /></div>
              <div><Label>קטגוריה</Label>
                <Select onValueChange={value => setFormData({...formData, category: value})}><SelectTrigger><SelectValue/></SelectTrigger>
                  <SelectContent><SelectItem value="labor">עבודה</SelectItem><SelectItem value="inputs">תשומות</SelectItem></SelectContent>
                </Select>
              </div>
              <div><Label>סוג</Label><Input value={formData.type} onChange={e => setFormData({...formData, type: e.target.value})} /></div>
              <div><Label>תיאור</Label><Input value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} /></div>
              <div><Label>סכום</Label><Input type="number" value={formData.amount} onChange={e => setFormData({...formData, amount: e.target.value})} /></div>
            </div>
            <DialogFooter><Button onClick={handleAddExpense}>הוסף</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}