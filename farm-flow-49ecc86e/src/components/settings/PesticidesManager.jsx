
import React, { useState, useEffect, useMemo, useCallback } from "react";
import { Pesticide, Crop } from "@/entities/all";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Edit, Trash2, Loader2, Download, Search, Upload, FileText, ChevronDown, ChevronRight } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { getToken } from "@/api/localClient";

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

const CROP_GROUPS = [
  { id: "ירקות",        label: "ירקות",          emoji: "🥦" },
  { id: "הדרים",        label: "הדרים",          emoji: "🍊" },
  { id: "נשירים",       label: "נשירים (תפוח, אגס...)", emoji: "🍎" },
  { id: "גידולי שדה",   label: "גידולי שדה",      emoji: "🌾" },
  { id: "גידולי תעשיה", label: "גידולי תעשייה",   emoji: "🏭" },
  { id: "פרחים",        label: "פרחים",           emoji: "🌸" },
  { id: "סובטרופים",    label: "סובטרופים (אבוקדו, מנגו...)", emoji: "🥭" },
  { id: "מספוא",        label: "מספוא",           emoji: "🌿" },
  { id: "צמחי מרפא",    label: "צמחי מרפא",       emoji: "🌱" },
  { id: "צמחי תבלין",   label: "צמחי תבלין",      emoji: "🌿" },
  { id: "זרעים/גרעינים", label: "זרעים / גרעינים", emoji: "🌰" },
  { id: "עצי יער",      label: "עצי יער",          emoji: "🌲" },
  { id: "שונים",        label: "שונים",            emoji: "📦" },
];

export default function PesticidesManager() {
  const [items, setItems] = useState([]);
  const [crops, setCrops] = useState([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const { toast } = useToast();
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState("");
  const [isGovDialogOpen, setIsGovDialogOpen] = useState(false);
  const [selectedGroups, setSelectedGroups] = useState(["ירקות"]);
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [expandedProducts, setExpandedProducts] = useState(new Set());
  const itemsPerPage = 20;

  const initialFormData = {
    registration_number: "", product_name: "", manufacturer: "",
    active_ingredients: "", product_type: "fungicide", concentration: "",
    crop: "", pest: "", label_url: "", cost_per_unit: "", unit: "ליטר",
    dosage: "", volume: ""
  };
  const [formData, setFormData] = useState(initialFormData);

  const loadData = useCallback(async () => {
    try {
      const [pesticidesData, cropsData] = await Promise.all([
        Pesticide.list().catch(() => []),
        Crop.list().catch(() => [])
      ]);
      setItems(Array.isArray(pesticidesData) ? pesticidesData : []);
      setCrops(Array.isArray(cropsData) ? cropsData : []);
    } catch (error) {
      toast({ title: "שגיאה בטעינת נתונים", variant: "destructive" });
      setItems([]); setCrops([]);
    }
  }, [toast]);

  useEffect(() => { loadData(); }, [loadData]);

  const toggleGroup = (groupId) => {
    setSelectedGroups(prev =>
      prev.includes(groupId) ? prev.filter(g => g !== groupId) : [...prev, groupId]
    );
  };

  const handleImportFromGov = async () => {
    if (selectedGroups.length === 0) {
      toast({ title: "יש לבחור לפחות קבוצה אחת", variant: "destructive" });
      return;
    }

    setIsGovDialogOpen(false);
    setIsImporting(true);

    try {
      // Fetch directly from browser (avoids server-side network restrictions)
      const GOV_API = 'https://data.gov.il/api/3/action/datastore_search';
      const RESOURCE_ID = 'cffe0c50-6856-4187-9315-51bc113cb718';
      const allRecords = [];
      const seenKeys = new Set();

      for (let gi = 0; gi < selectedGroups.length; gi++) {
        const group = selectedGroups[gi];
        setImportProgress(`טוען קבוצה ${gi + 1}/${selectedGroups.length}: ${group}...`);
        let offset = 0;
        const limit = 500;

        while (true) {
          let url = `${GOV_API}?resource_id=${RESOURCE_ID}&limit=${limit}&offset=${offset}`;
          url += `&filters=${encodeURIComponent(JSON.stringify({ 'קבוצת גידולים': group }))}`;

          const govRes = await fetch(url, { headers: { 'Accept': 'application/json' } });
          if (!govRes.ok) break;
          const govData = await govRes.json();
          if (!govData.success || !Array.isArray(govData.result?.records)) break;

          for (const record of govData.result.records) {
            const regNum = record['מספר רשיון']?.toString().trim();
            const crop   = (record['גידול'] || '').trim();
            const pest   = (record['נגע']   || '').trim();
            const key    = `${regNum}|${crop}|${pest}`;
            if (regNum && !seenKeys.has(key)) { seenKeys.add(key); allRecords.push(record); }
          }

          if (govData.result.records.length < limit) break;
          offset += limit;
          if (offset >= 1500) break;
        }
      }

      if (allRecords.length === 0) {
        toast({ title: "לא נמצאו רשומות", description: "המאגר הממשלתי לא החזיר נתונים עבור הקבוצות שנבחרו", variant: "destructive" });
        return;
      }

      setImportProgress(`שולח ${allRecords.length} רשומות לשמירה...`);

      // Send records to backend in chunks (200 per request ≈ ~400KB each)
      const CHUNK_SIZE = 200;
      let totalNew = 0, totalUpdated = 0, totalSkipped = 0;

      for (let i = 0; i < allRecords.length; i += CHUNK_SIZE) {
        const chunk = allRecords.slice(i, i + CHUNK_SIZE);
        setImportProgress(`שומר רשומות ${i + 1}–${Math.min(i + CHUNK_SIZE, allRecords.length)} מתוך ${allRecords.length}...`);

        const response = await fetch(`${BASE_URL}/functions/importPesticides`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${getToken()}` },
          body: JSON.stringify({ records: chunk })
        });
        const result = await response.json();
        if (result.data?.stats) {
          totalNew     += result.data.stats.new     || 0;
          totalUpdated += result.data.stats.updated || 0;
          totalSkipped += result.data.stats.skipped || 0;
        }
      }

      toast({
        title: "הייבוא הושלם!",
        description: `✨ ${totalNew} חדשים | 🔄 ${totalUpdated} עודכנו | ⏭️ ${totalSkipped} דולגו`,
        duration: 8000
      });
      loadData();
    } catch (error) {
      toast({ title: "שגיאה בייבוא", description: error.message, variant: "destructive" });
    } finally {
      setIsImporting(false);
      setImportProgress("");
    }
  };

  const handleEdit = (item) => {
    setEditingItem(item);
    setFormData({
      registration_number: item.registration_number || "",
      product_name: item.product_name || "",
      manufacturer: item.manufacturer || "",
      active_ingredients: item.active_ingredients || "",
      product_type: item.product_type || "fungicide",
      concentration: item.concentration || "",
      crop: item.crop || "",
      pest: item.pest || "",
      label_url: item.label_url || "",
      cost_per_unit: item.cost_per_unit?.toString() || "",
      unit: item.unit || "ליטר",
      dosage: item.dosage || "",
      volume: item.volume || ""
    });
    setIsDialogOpen(true);
  };

  const handleDelete = async (id) => {
    if (window.confirm("האם אתה בטוח?")) {
      await Pesticide.delete(id);
      toast({ title: "התכשיר נמחק" });
      loadData();
    }
  };

  const resetForm = () => { setEditingItem(null); setFormData(initialFormData); };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const dataToSend = { ...formData, cost_per_unit: formData.cost_per_unit ? parseFloat(formData.cost_per_unit) : null };
      if (editingItem) await Pesticide.update(editingItem.id, dataToSend);
      else await Pesticide.create(dataToSend);
      toast({ title: "התכשיר נשמר" });
      setIsDialogOpen(false);
      resetForm();
      loadData();
    } catch (error) {
      toast({ title: "שגיאה", description: error.message, variant: "destructive" });
    }
  };

  const categoryTranslations = { fungicide: "קוטל פטריות", insecticide: "קוטל חרקים", herbicide: "קוטל עשבים", other: "אחר" };
  const categoryColors = { fungicide: "bg-purple-100 text-purple-700", insecticide: "bg-orange-100 text-orange-700", herbicide: "bg-green-100 text-green-700", other: "bg-gray-100 text-gray-600" };

  // Group items by registration_number → one product card per license number
  const groupedProducts = useMemo(() => {
    const q = searchTerm.toLowerCase();
    const filtered = (items || []).filter(item =>
      (item.product_name?.toLowerCase() || '').includes(q) ||
      (item.active_ingredients?.toLowerCase() || '').includes(q) ||
      (item.manufacturer?.toLowerCase() || '').includes(q) ||
      (item.crop?.toLowerCase() || '').includes(q) ||
      (item.pest?.toLowerCase() || '').includes(q)
    );
    // Group by registration_number (fallback to id)
    const map = new Map();
    for (const item of filtered) {
      const key = item.registration_number || item.id;
      if (!map.has(key)) {
        map.set(key, { ...item, _variants: [] });
      }
      const group = map.get(key);
      if (item.crop || item.pest || item.dosage || item.volume) {
        group._variants.push({ id: item.id, crop: item.crop, pest: item.pest, dosage: item.dosage, volume: item.volume, label_url: item.label_url });
      }
      // Keep the most complete record as primary
      if ((item.manufacturer && !group.manufacturer) || (item.active_ingredients && !group.active_ingredients)) {
        Object.assign(group, item, { _variants: group._variants });
      }
    }
    return Array.from(map.values());
  }, [items, searchTerm]);

  const paginatedProducts = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return groupedProducts.slice(start, start + itemsPerPage);
  }, [groupedProducts, currentPage]);

  const totalPages = Math.ceil(groupedProducts.length / itemsPerPage);

  const toggleExpand = (regNum) => {
    setExpandedProducts(prev => {
      const next = new Set(prev);
      next.has(regNum) ? next.delete(regNum) : next.add(regNum);
      return next;
    });
  };

  return (
    <div className="mt-4">
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <CardTitle>ניהול חומרי הדברה ({groupedProducts.length} מוצרים · {items.length} שילובים)</CardTitle>
            <div className="w-full sm:w-auto flex flex-col sm:flex-row gap-2">
              <div className="relative w-full sm:w-64">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="חיפוש תכשיר או חומר פעיל..."
                  value={searchTerm}
                  onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
                  className="pr-10"
                />
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={() => setIsGovDialogOpen(true)}
                  disabled={isImporting}
                  variant="outline"
                  className="bg-blue-50 hover:bg-blue-100 text-blue-700 border-blue-200 flex-1"
                >
                  {isImporting ? (
                    <><Loader2 className="w-4 h-4 ml-2 animate-spin" />{importProgress || "מייבא..."}</>
                  ) : (
                    <><Download className="w-4 h-4 ml-2" />ייבוא ממשרד החקלאות</>
                  )}
                </Button>
                <Button onClick={() => { resetForm(); setIsDialogOpen(true); }} className="flex-1">
                  <Plus className="w-4 h-4 ml-2" /> הוסף
                </Button>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8"></TableHead>
                  <TableHead>שם תכשיר</TableHead>
                  <TableHead>מס' רשיון</TableHead>
                  <TableHead>קטגוריה</TableHead>
                  <TableHead>חומר פעיל</TableHead>
                  <TableHead>יצרן</TableHead>
                  <TableHead>ריכוז</TableHead>
                  <TableHead>גידולים/נגעים</TableHead>
                  <TableHead>מחיר/יח'</TableHead>
                  <TableHead>פעולות</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedProducts.map((product) => {
                  const regKey = product.registration_number || product.id;
                  const isExpanded = expandedProducts.has(regKey);
                  const variantCount = product._variants?.length || 0;
                  return (
                    <>
                      {/* Main product row */}
                      <TableRow key={product.id} className="hover:bg-gray-50">
                        <TableCell className="p-1">
                          {variantCount > 0 && (
                            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => toggleExpand(regKey)}>
                              {isExpanded ? <ChevronDown className="w-4 h-4 text-blue-600" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
                            </Button>
                          )}
                        </TableCell>
                        <TableCell className="font-semibold">
                          <div className="flex items-center gap-2">
                            {product.product_name}
                            {product.label_url && (
                              <a href={product.label_url} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:text-blue-700" title="תווית">
                                <FileText className="w-3.5 h-3.5" />
                              </a>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs text-gray-500">{product.registration_number}</TableCell>
                        <TableCell>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${categoryColors[product.product_type] || categoryColors.other}`}>
                            {categoryTranslations[product.product_type] || 'אחר'}
                          </span>
                        </TableCell>
                        <TableCell className="text-sm max-w-[160px] truncate" title={product.active_ingredients}>{product.active_ingredients}</TableCell>
                        <TableCell className="text-sm">{product.manufacturer}</TableCell>
                        <TableCell className="text-xs text-gray-600">{product.concentration}</TableCell>
                        <TableCell>
                          {variantCount > 0 ? (
                            <button onClick={() => toggleExpand(regKey)} className="text-xs text-blue-600 hover:underline font-medium">
                              {variantCount} גידול/נגע {isExpanded ? '▲' : '▼'}
                            </button>
                          ) : (
                            <span className="text-xs text-gray-400">-</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">
                          {product.cost_per_unit ? <span className="text-blue-600 font-medium">₪{product.cost_per_unit}/{product.unit || 'יח׳'}</span> : <span className="text-gray-400">-</span>}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleEdit(product)}><Edit className="w-3.5 h-3.5" /></Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-red-400 hover:text-red-600" onClick={() => handleDelete(product.id)}><Trash2 className="w-3.5 h-3.5" /></Button>
                          </div>
                        </TableCell>
                      </TableRow>
                      {/* Expanded variants — crop/pest combinations */}
                      {isExpanded && product._variants.map((v, vi) => (
                        <TableRow key={v.id || vi} className="bg-blue-50/40 border-r-2 border-blue-200">
                          <TableCell></TableCell>
                          <TableCell colSpan={6} className="py-1.5 pr-6">
                            <div className="flex items-center gap-3 text-xs">
                              {v.crop && <span className="text-green-700 font-medium">🌿 {v.crop}</span>}
                              {v.pest && <span className="text-orange-700">🐛 {v.pest}</span>}
                              {v.dosage && <span className="text-blue-700">💧 {v.dosage}</span>}
                              {v.volume && <span className="text-gray-600">📊 {v.volume}</span>}
                            </div>
                          </TableCell>
                          <TableCell className="py-1.5"></TableCell>
                          <TableCell className="py-1.5">
                            {v.label_url && (
                              <a href={v.label_url} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:text-blue-700">
                                <FileText className="w-3.5 h-3.5" />
                              </a>
                            )}
                          </TableCell>
                          <TableCell className="py-1.5">
                            <Button variant="ghost" size="icon" className="h-6 w-6 text-red-400 hover:text-red-600" onClick={() => handleDelete(v.id)}><Trash2 className="w-3 h-3" /></Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          {groupedProducts.length === 0 && (
            <div className="text-center py-8 text-gray-500">
              {searchTerm ? `לא נמצאו תכשירים התואמים לחיפוש "${searchTerm}"` : "אין תכשירים להצגה. ייבא ממשרד החקלאות או הוסף ידנית."}
            </div>
          )}
        </CardContent>
        {totalPages > 1 && (
          <div className="p-4 border-t flex items-center justify-between">
            <span className="text-sm text-muted-foreground">עמוד {currentPage} מתוך {totalPages} · {groupedProducts.length} מוצרים</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setCurrentPage(p => Math.max(p - 1, 1))} disabled={currentPage === 1}>הקודם</Button>
              <Button variant="outline" size="sm" onClick={() => setCurrentPage(p => Math.min(p + 1, totalPages))} disabled={currentPage === totalPages}>הבא</Button>
            </div>
          </div>
        )}
      </Card>

      {/* Gov Import Dialog */}
      <Dialog open={isGovDialogOpen} onOpenChange={setIsGovDialogOpen}>
        <DialogContent dir="rtl" className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>ייבוא ממשרד החקלאות</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              בחר קבוצות גידולים רלוונטיות למשק שלך. הייבוא יכלול רק תכשירים המאושרים לגידולים אלו.
            </p>
            <div className="grid grid-cols-2 gap-2 max-h-72 overflow-y-auto pl-1">
              {CROP_GROUPS.map(group => (
                <label
                  key={group.id}
                  className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition-colors ${
                    selectedGroups.includes(group.id)
                      ? "bg-blue-50 border-blue-300"
                      : "bg-gray-50 border-gray-200 hover:bg-gray-100"
                  }`}
                >
                  <Checkbox
                    checked={selectedGroups.includes(group.id)}
                    onCheckedChange={() => toggleGroup(group.id)}
                  />
                  <span className="text-sm">{group.emoji} {group.label}</span>
                </label>
              ))}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setSelectedGroups(CROP_GROUPS.map(g => g.id))} className="flex-1 text-xs">בחר הכל</Button>
              <Button variant="outline" size="sm" onClick={() => setSelectedGroups([])} className="flex-1 text-xs">נקה הכל</Button>
            </div>
            {selectedGroups.length > 0 && (
              <div className="bg-blue-50 rounded p-2 text-xs text-blue-700">
                נבחרו {selectedGroups.length} קבוצות · הייבוא יתבצע לפי קבוצה, מהיר יותר ורלוונטי יותר
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsGovDialogOpen(false)}>ביטול</Button>
            <Button onClick={handleImportFromGov} disabled={selectedGroups.length === 0}>
              <Download className="w-4 h-4 ml-2" />
              ייבא ({selectedGroups.length} קבוצות)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit/Add Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent dir="rtl" className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingItem ? "ערוך תכשיר" : "הוסף תכשיר חדש"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit}>
            <div className="grid grid-cols-2 gap-4 py-4 max-h-[70vh] overflow-y-auto px-1">
              <div className="col-span-2 grid gap-2">
                <Label>שם תכשיר</Label>
                <Input value={formData.product_name} onChange={(e) => setFormData({ ...formData, product_name: e.target.value })} required />
              </div>
              <div className="grid gap-2">
                <Label>מס' רישיון</Label>
                <Input value={formData.registration_number} onChange={(e) => setFormData({ ...formData, registration_number: e.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label>יצרן</Label>
                <Input value={formData.manufacturer} onChange={(e) => setFormData({ ...formData, manufacturer: e.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label>חומר פעיל</Label>
                <Input value={formData.active_ingredients} onChange={(e) => setFormData({ ...formData, active_ingredients: e.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label>קטגוריה</Label>
                <Select value={formData.product_type} onValueChange={v => setFormData({ ...formData, product_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fungicide">קוטל פטריות</SelectItem>
                    <SelectItem value="insecticide">קוטל חרקים</SelectItem>
                    <SelectItem value="herbicide">קוטל עשבים</SelectItem>
                    <SelectItem value="other">אחר</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>ריכוז חומר פעיל</Label>
                <Input value={formData.concentration} onChange={(e) => setFormData({ ...formData, concentration: e.target.value })} placeholder='לדוגמה: 20% w/v' />
              </div>
              <div className="grid gap-2">
                <Label>מינון ליישום</Label>
                <Input value={formData.dosage} onChange={(e) => setFormData({ ...formData, dosage: e.target.value })} placeholder='לדוגמה: 50 סמ"ק/דונם' />
              </div>
              <div className="grid gap-2">
                <Label>נפח ליישום</Label>
                <Input value={formData.volume} onChange={(e) => setFormData({ ...formData, volume: e.target.value })} placeholder='לדוגמה: 300-600 ליטר/דונם' />
              </div>
              <div className="grid gap-2">
                <Label>יחידת מידה</Label>
                <Select value={formData.unit} onValueChange={v => setFormData({ ...formData, unit: v })}>
                  <SelectTrigger><SelectValue placeholder="בחר יחידה" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value='מ"ל'>מ"ל</SelectItem>
                    <SelectItem value='סמ"ק'>סמ"ק</SelectItem>
                    <SelectItem value="ליטר">ליטר</SelectItem>
                    <SelectItem value="גרם">גרם</SelectItem>
                    <SelectItem value='ק"ג'>ק"ג</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>מחיר ליחידה (₪)</Label>
                <Input type="number" step="0.01" value={formData.cost_per_unit} onChange={(e) => setFormData({ ...formData, cost_per_unit: e.target.value })} placeholder="לדוגמה: 15.50" />
              </div>
              <div className="grid gap-2">
                <Label>גידול</Label>
                <Select value={formData.crop} onValueChange={v => setFormData({ ...formData, crop: v })}>
                  <SelectTrigger><SelectValue placeholder="בחר גידול" /></SelectTrigger>
                  <SelectContent>{crops.map(c => <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>נגע מטרה</Label>
                <Input value={formData.pest} onChange={(e) => setFormData({ ...formData, pest: e.target.value })} />
              </div>
              <div className="col-span-2 grid gap-2">
                <Label>כתובת URL לתווית מוצר</Label>
                <Input type="url" value={formData.label_url} onChange={(e) => setFormData({ ...formData, label_url: e.target.value })} placeholder="https://example.com/label.pdf" />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>ביטול</Button>
              <Button type="submit">{editingItem ? "עדכן" : "צור"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
