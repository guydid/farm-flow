
import React, { useState, useEffect, useRef } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus, Trash2, Search, Droplets, X } from "lucide-react";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/use-toast";

export default function SprayingForm({ seeding, pesticides, plots, onSubmit, onCancel, initialData = null }) {
  const { toast } = useToast();

  const [formData, setFormData] = useState({
    id: initialData?.id || null, // Added id for update operations
    date: initialData?.date || format(new Date(), 'yyyy-MM-dd'),
    plot_id: initialData?.plot_id || '', // Added plot_id for associating with a specific plot
    treatment_type: initialData?.treatment_type || 'mechanized',
    treatment_time: initialData?.treatment_time || 'morning',
    area_covered: initialData?.area_covered?.toString() || seeding?.total_area?.toString() || '', // Ensure area_covered is stored as string initially
    performed_by: initialData?.performed_by || '',
    notes: initialData?.notes || '',
    applied_pesticides: initialData?.applied_pesticides || [],
  });

  const [searchTerm, setSearchTerm] = useState('');
  const [showPesticidesList, setShowPesticidesList] = useState(false);
  const searchInputRef = useRef(null);

  // Auto-recalculate pesticide quantities when area changes
  useEffect(() => {
    // Only recalculate if area_covered changes and there are applied pesticides
    // and if the area_covered is a valid positive number.
    if (formData.area_covered && formData.applied_pesticides.length > 0) {
      const area = parseFloat(formData.area_covered);
      if (!isNaN(area) && area > 0) {
        const updated = formData.applied_pesticides.map(ap => {
          // Use the stored recommended_dosage (which is dosagePerDunam)
          const recommendedDosage = parseFloat(ap.recommended_dosage);
          if (!isNaN(recommendedDosage) && recommendedDosage > 0) {
            // כמות כוללת = מינון לדונם × שטח
            const totalQuantity = (recommendedDosage * area).toFixed(2);
            return {
              ...ap,
              quantity: totalQuantity
            };
          }
          return ap;
        });
        setFormData(prev => ({ ...prev, applied_pesticides: updated }));
      }
    }
  }, [formData.area_covered, formData.applied_pesticides.length]); // Re-evaluate when area_covered or number of pesticides changes

  const handleAddPesticide = (pesticide) => {
    const existingIndex = formData.applied_pesticides.findIndex(p => p.pesticide_id === pesticide.id);

    if (existingIndex >= 0) {
      toast({
        title: "חומר כבר נוסף",
        description: `${pesticide.product_name} כבר נמצא ברשימה.`,
        variant: "destructive"
      });
      setSearchTerm('');
      setShowPesticidesList(false);
      return;
    }

    // **חילוץ מינון לדונם**
    let dosagePerDunam = 0;
    if (pesticide.dosage) {
      // חיפוש מספר בשדה dosage (למשל "15 מ"ל/דונם" -> 15)
      const dosageMatch = pesticide.dosage.match(/(\d+(?:\.\d+)?)/); // Regex to find floating point numbers
      if (dosageMatch) {
        dosagePerDunam = parseFloat(dosageMatch[1]);
      }
    }

    // **חישוב כמות כוללת = מינון לדונם × שטח**
    const area = parseFloat(formData.area_covered);
    let totalQuantity = '';
    if (dosagePerDunam > 0 && !isNaN(area) && area > 0) {
      totalQuantity = (dosagePerDunam * area).toFixed(2);
    }

    // **חילוץ יחידת מידה**
    let unit = pesticide.unit || 'מ"ל'; // Default unit, or use pesticide.unit if exists
    if (!pesticide.unit && pesticide.dosage) { // If pesticide.unit is not defined, try to extract from dosage string
      if (pesticide.dosage.includes('ליטר')) unit = 'ליטר';
      else if (pesticide.dosage.includes('גרם')) unit = 'גרם';
      else if (pesticide.dosage.includes('ק"ג')) unit = 'ק"ג';
      else if (pesticide.dosage.includes('מ"ל')) unit = 'מ"ל';
      else if (pesticide.dosage.includes('סמ"ק') || pesticide.dosage.includes('cc')) unit = 'סמ"ק'; // Added 'cc' for cubic centimeter
    }

    setFormData(prev => ({
      ...prev,
      applied_pesticides: [
        ...prev.applied_pesticides,
        {
          pesticide_id: pesticide.id,
          pesticide_name: pesticide.product_name,
          active_ingredient: pesticide.active_ingredients,
          quantity: totalQuantity, // Calculated total quantity
          unit: unit,
          recommended_dosage: dosagePerDunam, // Store parsed numeric dosage (per dunam) for recalculations
          cost_per_unit: pesticide.cost_per_unit || 0,
          concentration: pesticide.concentration || '',
          formulation: pesticide.formulation || ''
        }
      ]
    }));

    setSearchTerm('');
    setShowPesticidesList(false);

    // Focus back on search input for quick adding of next pesticide
    setTimeout(() => {
      searchInputRef.current?.focus();
    }, 100);

    toast({
      title: "חומר נוסף בהצלחה",
      description: dosagePerDunam > 0 && !isNaN(area) && area > 0
        ? `${pesticide.product_name} - כמות מומלצת: ${totalQuantity} ${unit} (${dosagePerDunam} ${unit}/דונם × ${area} דונם)`
        : `${pesticide.product_name} נוסף לרשימה.`,
    });
  };

  const handleRemovePesticide = (index) => {
    const removedPesticideName = formData.applied_pesticides[index]?.pesticide_name;
    setFormData(prev => ({
      ...prev,
      applied_pesticides: prev.applied_pesticides.filter((_, i) => i !== index)
    }));
    toast({
      title: "חומר הוסר",
      description: `${removedPesticideName} הוסר מהרשימה.`,
    });
  };

  const handlePesticideQuantityChange = (index, quantity) => {
    const updated = [...formData.applied_pesticides];
    updated[index].quantity = quantity;
    setFormData(prev => ({ ...prev, applied_pesticides: updated }));
  };

  const handlePesticideCostChange = (index, cost) => {
    const updated = [...formData.applied_pesticides];
    updated[index].cost_per_unit = cost;
    setFormData(prev => ({ ...prev, applied_pesticides: updated }));
  };

  const getPesticideTotalCost = (item) => {
    const quantity = parseFloat(item.quantity) || 0;
    const cost = parseFloat(item.cost_per_unit) || 0;
    return (quantity * cost).toFixed(2);
  };

  const getSprayingGrandTotal = () => {
    return formData.applied_pesticides.reduce((sum, item) => {
      return sum + parseFloat(getPesticideTotalCost(item));
    }, 0).toFixed(2);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!formData.date || !formData.treatment_type) {
      toast({ title: "שגיאה", description: "נא למלא את כל השדות המסומנים בכוכבית (*)", variant: "destructive" });
      return;
    }

    if (!formData.area_covered || parseFloat(formData.area_covered) <= 0) {
      toast({ title: "שגיאה", description: "נא להזין שטח מטופל חוקי (גדול מ-0).", variant: "destructive" });
      return;
    }

    if (formData.applied_pesticides.length === 0) {
      toast({ title: "שגיאה", description: "נא להוסיף לפחות חומר הדברה אחד.", variant: "destructive" });
      return;
    }

    const totalCalculatedCost = formData.applied_pesticides.reduce((sum, item) => {
        const quantity = parseFloat(item.quantity) || 0;
        const cost = parseFloat(item.cost_per_unit) || 0;
        return sum + (quantity * cost);
    }, 0);

    const sprayingData = {
      id: formData.id, // Include id for update operations
      date: formData.date,
      plot_id: formData.plot_id === '' ? null : formData.plot_id, // Convert empty string to null for optional plot_id
      treatment_type: formData.treatment_type,
      treatment_time: formData.treatment_time,
      area_covered: parseFloat(formData.area_covered) || 0,
      performed_by: formData.performed_by || '',
      applied_pesticides: formData.applied_pesticides.map(p => ({
        pesticide_id: p.pesticide_id,
        pesticide_name: p.pesticide_name,
        quantity: parseFloat(p.quantity) || 0,
        unit: p.unit,
        cost_per_unit: parseFloat(p.cost_per_unit) || 0,
        active_ingredient: p.active_ingredient,
        concentration: p.concentration,
        formulation: p.formulation,
        recommended_dosage: parseFloat(p.recommended_dosage) || 0 // Ensure this is numeric
      })),
      total_cost: parseFloat(totalCalculatedCost.toFixed(2)), // Ensure total cost is numeric and fixed
      notes: formData.notes
    };

    await onSubmit(sprayingData);
  };

  const safePesticides = Array.isArray(pesticides) ? pesticides : [];

  const filteredPesticides = safePesticides.filter(p =>
    p && (
      (p.product_name?.toLowerCase() || '').includes(searchTerm.toLowerCase()) ||
      (p.active_ingredients?.toLowerCase() || '').includes(searchTerm.toLowerCase()) ||
      (p.manufacturer?.toLowerCase() || '').includes(searchTerm.toLowerCase()) ||
      (p.crop?.toLowerCase() || '').includes(searchTerm.toLowerCase()) ||
      (p.pest?.toLowerCase() || '').includes(searchTerm.toLowerCase())
    )
  );

  // Translations remain the same
  const translateTreatmentType = (type) => ({
    mechanized: 'ממוכן',
    spray_gun: 'אקדח ריסוס',
    backpack: 'ריסוס גב',
    drench: 'הגמעה'
  }[type] || type);

  const translateTreatmentTime = (time) => ({
    morning: 'בוקר',
    noon: 'צהריים',
    evening: 'ערב'
  }[time] || time);

  const getCategoryColor = (category) => ({
    fungicide: "bg-green-100 text-green-800",
    insecticide: "bg-red-100 text-red-800",
    herbicide: "bg-yellow-100 text-yellow-800",
    other: "bg-gray-100 text-gray-800"
  }[category] || "bg-gray-100 text-gray-800");

  const categoryTranslations = {
    fungicide: "קוטל פטריות",
    insecticide: "קוטל חרקים",
    herbicide: "קוטל עשבים",
    other: "אחר"
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* חלק עליון - פרטי הריסוס */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">פרטי הריסוס</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <Label htmlFor="date">תאריך *</Label>
              <Input
                id="date"
                type="date"
                value={formData.date}
                onChange={(e) => setFormData(prev => ({ ...prev, date: e.target.value }))}
                required
              />
            </div>

            {/* Added Plot Selection */}
            {plots && plots.length > 0 && (
              <div>
                <Label htmlFor="plot">חלקה (אופציונלי)</Label>
                <Select
                  value={formData.plot_id || '__none__'} // Handle null/empty string for initial selection
                  onValueChange={(value) => setFormData(prev => ({ ...prev, plot_id: value === '__none__' ? '' : value }))}
                >
                  <SelectTrigger id="plot">
                    <SelectValue placeholder="בחר חלקה..."/>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">כללי למזרע</SelectItem> {/* Empty string for "General" */}
                    {plots.map(p => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div>
              <Label htmlFor="area_covered">שטח מטופל (דונם) *</Label>
              <Input
                id="area_covered"
                type="number"
                step="0.1"
                value={formData.area_covered}
                onChange={(e) => setFormData(prev => ({ ...prev, area_covered: e.target.value }))}
                placeholder="שטח"
                required
              />
              <p className="text-xs text-gray-500 mt-1">
                💡 המינונים של חומרי ההדברה יחושבו אוטומטית לפי שטח זה
              </p>
            </div>

            <div>
              <Label htmlFor="treatment_type">סוג טיפול *</Label>
              <Select
                value={formData.treatment_type}
                onValueChange={(value) => setFormData(prev => ({ ...prev, treatment_type: value }))}
              >
                <SelectTrigger id="treatment_type">
                  <SelectValue placeholder="בחר סוג טיפול" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="mechanized">ממוכן</SelectItem>
                  <SelectItem value="spray_gun">אקדח ריסוס</SelectItem>
                  <SelectItem value="backpack">ריסוס גב</SelectItem>
                  <SelectItem value="drench">הגמעה</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="treatment_time">זמן טיפול *</Label>
              <Select
                value={formData.treatment_time}
                onValueChange={(value) => setFormData(prev => ({ ...prev, treatment_time: value }))}
              >
                <SelectTrigger id="treatment_time">
                  <SelectValue placeholder="בחר זמן טיפול" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="morning">בוקר</SelectItem>
                  <SelectItem value="noon">צהריים</SelectItem>
                  <SelectItem value="evening">ערב</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="col-span-1 md:col-span-2 lg:col-span-1">
              <Label htmlFor="performed_by">מבצע</Label>
              <Input
                id="performed_by"
                value={formData.performed_by}
                onChange={(e) => setFormData(prev => ({ ...prev, performed_by: e.target.value }))}
                placeholder="שם המבצע (אופציונלי)"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* חלק תחתון - חומרי הדברה */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Droplets className="w-5 h-5 text-blue-500" />
              חומרי הדברה ({formData.applied_pesticides.length})
            </span>
            <span className="text-sm font-normal text-gray-500">
              סה"כ עלות: <span className="font-bold text-blue-600">₪{getSprayingGrandTotal()}</span>
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* חיפוש והוספת חומר */}
          <div className="relative">
            <Label>חפש והוסף חומר הדברה</Label>
            <div className="relative mt-1">
              <Search className="absolute right-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                ref={searchInputRef}
                placeholder="חפש לפי שם, חומר פעיל, יצרן, גידול או נגע..."
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setShowPesticidesList(e.target.value.length > 0);
                }}
                onFocus={() => searchTerm && setShowPesticidesList(true)}
                className="pr-10"
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchTerm('');
                    setShowPesticidesList(false);
                  }}
                  className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* רשימת תוצאות חיפוש */}
            {showPesticidesList && filteredPesticides.length > 0 && (
              <div className="absolute z-10 w-full mt-1 bg-white border rounded-lg shadow-lg max-h-60 overflow-y-auto">
                {filteredPesticides.map(pesticide => {
                  const alreadyAdded = formData.applied_pesticides.some(p => p.pesticide_id === pesticide.id);

                  return (
                    <button
                      key={pesticide.id}
                      type="button"
                      onClick={() => !alreadyAdded && handleAddPesticide(pesticide)}
                      disabled={alreadyAdded}
                      className={`w-full text-right p-3 border-b last:border-b-0 transition-colors ${
                        alreadyAdded
                          ? 'bg-gray-100 cursor-not-allowed opacity-60'
                          : 'hover:bg-blue-50 cursor-pointer'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm truncate">{pesticide.product_name}</span>
                            {alreadyAdded && (
                              <Badge variant="outline" className="text-xs bg-green-50 text-green-700 border-green-200">
                                ✓ נוסף
                              </Badge>
                            )}
                          </div>
                          {pesticide.active_ingredients && (
                            <div className="text-xs text-gray-500 mt-1 truncate">
                              {pesticide.active_ingredients}
                            </div>
                          )}
                          {pesticide.manufacturer && (
                            <div className="text-xs text-gray-400 mt-0.5 truncate">
                              {pesticide.manufacturer}
                            </div>
                          )}
                          <div className="flex gap-2 mt-1 flex-wrap">
                            {pesticide.dosage && (
                              <span className="text-xs text-blue-600 font-medium">
                                מינון: {pesticide.dosage}
                              </span>
                            )}
                            {pesticide.cost_per_unit && pesticide.unit && (
                              <span className="text-xs text-green-600 font-medium">
                                מחיר: ₪{pesticide.cost_per_unit}/{pesticide.unit}
                              </span>
                            )}
                          </div>
                          {pesticide.crop && (
                            <div className="text-xs text-green-600 mt-0.5">
                              גידול: {pesticide.crop}
                            </div>
                          )}
                        </div>
                        <div className="flex flex-col gap-1 items-end flex-shrink-0">
                          {pesticide.product_type && (
                            <Badge className={getCategoryColor(pesticide.product_type)}>
                              {categoryTranslations[pesticide.product_type]}
                            </Badge>
                          )}
                          {pesticide.concentration && (
                            <Badge variant="outline" className="text-xs">
                              {pesticide.concentration}
                            </Badge>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {showPesticidesList && searchTerm && filteredPesticides.length === 0 && (
              <div className="absolute z-10 w-full mt-1 bg-white border rounded-lg shadow-lg p-4 text-center text-gray-500">
                לא נמצאו תוצאות עבור "{searchTerm}"
              </div>
            )}
          </div>

          {/* טבלת חומרים שנוספו */}
          {formData.applied_pesticides.length > 0 ? (
            <>
              {/* Desktop Table (hidden on small screens) */}
              <div className="hidden md:block border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[25%]">חומר</TableHead>
                      <TableHead className="w-[15%]">מינון/דונם</TableHead>
                      <TableHead className="w-[15%]">כמות כוללת</TableHead>
                      <TableHead className="w-[15%]">עלות/יח'</TableHead>
                      <TableHead className="w-[15%]">סה"כ</TableHead>
                      <TableHead className="w-[15%]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {formData.applied_pesticides.map((item, index) => (
                      <TableRow key={index}>
                        <TableCell>
                          <div className="font-medium">{item.pesticide_name}</div>
                          {item.active_ingredient && (
                            <div className="text-xs text-gray-500 mt-1">{item.active_ingredient}</div>
                          )}
                          {item.concentration && (
                            <Badge variant="outline" className="text-xs mt-1">{item.concentration}</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-gray-600">
                          {item.recommended_dosage > 0 ? (
                            <span className="font-medium text-blue-600">
                              {item.recommended_dosage} {item.unit}/דונם
                            </span>
                          ) : (
                            <span className="text-gray-400">-</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Input
                              type="number"
                              step="0.01"
                              value={item.quantity}
                              onChange={(e) => handlePesticideQuantityChange(index, e.target.value)}
                              className="w-24 text-center"
                            />
                            <span className="text-sm text-gray-600">{item.unit}</span>
                          </div>
                          {item.recommended_dosage > 0 && formData.area_covered && parseFloat(formData.area_covered) > 0 && (
                            <div className="text-xs text-gray-500 mt-1">
                              ({item.recommended_dosage} × {formData.area_covered} דונם)
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            step="0.01"
                            value={item.cost_per_unit}
                            onChange={(e) => handlePesticideCostChange(index, e.target.value)}
                            className="w-24 text-center"
                            placeholder="0"
                          />
                        </TableCell>
                        <TableCell className="font-semibold text-green-600">
                          ₪{getPesticideTotalCost(item)}
                        </TableCell>
                        <TableCell>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => handleRemovePesticide(index)}
                            className="text-red-500 hover:text-red-700 hover:bg-red-50"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>

                <div className="bg-gradient-to-r from-blue-50 to-green-50 p-4 border-t-2 border-blue-200">
                  <div className="flex justify-between items-center">
                    <span className="font-semibold text-lg">סה"כ עלות כוללת:</span>
                    <span className="text-2xl font-bold text-blue-600">₪{getSprayingGrandTotal()}</span>
                  </div>
                </div>
              </div>

              {/* Mobile Cards (hidden on larger screens) */}
              <div className="md:hidden space-y-4">
                {formData.applied_pesticides.map((item, index) => (
                  <Card key={index} className="relative">
                    <CardContent className="p-4 space-y-2">
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <h4 className="font-semibold text-base">{item.pesticide_name}</h4>
                          {item.active_ingredient && (
                            <p className="text-sm text-gray-600">{item.active_ingredient}</p>
                          )}
                          {item.concentration && (
                            <Badge variant="outline" className="text-xs mt-1">{item.concentration}</Badge>
                          )}
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => handleRemovePesticide(index)}
                          className="text-red-500 hover:text-red-700 hover:bg-red-50"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-sm mt-3">
                        <div>
                          <Label>מינון/דונם:</Label>
                          <p className="font-medium text-blue-600">
                            {item.recommended_dosage > 0 ? `${item.recommended_dosage} ${item.unit}/דונם` : '-'}
                          </p>
                        </div>
                        <div>
                          <Label>כמות כוללת:</Label>
                          <div className="flex items-center gap-2">
                            <Input
                              type="number"
                              step="0.01"
                              value={item.quantity}
                              onChange={(e) => handlePesticideQuantityChange(index, e.target.value)}
                              className="w-24 text-center"
                            />
                            <span className="text-gray-600">{item.unit}</span>
                          </div>
                          {item.recommended_dosage > 0 && formData.area_covered && parseFloat(formData.area_covered) > 0 && (
                            <p className="text-xs text-gray-500 mt-1">
                              ({item.recommended_dosage} × {formData.area_covered} דונם)
                            </p>
                          )}
                        </div>
                        <div>
                          <Label>עלות/יח':</Label>
                          <Input
                            type="number"
                            step="0.01"
                            value={item.cost_per_unit}
                            onChange={(e) => handlePesticideCostChange(index, e.target.value)}
                            className="w-24 text-center"
                            placeholder="0"
                          />
                        </div>
                        <div className="flex flex-col">
                          <Label>סה"כ:</Label>
                          <span className="font-bold text-green-600 text-lg">₪{getPesticideTotalCost(item)}</span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
                <div className="bg-gradient-to-r from-blue-50 to-green-50 p-4 border rounded-lg text-center shadow-inner">
                  <span className="font-semibold text-lg">סה"כ עלות כוללת:</span>
                  <span className="text-2xl font-bold text-blue-600 block mt-1">₪{getSprayingGrandTotal()}</span>
                </div>
              </div>
            </>
          ) : (
            <div className="text-center py-12 text-gray-500 bg-gradient-to-br from-gray-50 to-blue-50 rounded-lg border-2 border-dashed border-blue-200">
              <Droplets className="w-16 h-16 mx-auto mb-3 text-blue-300" />
              <p className="text-lg font-medium text-gray-700">טרם נוספו חומרי הדברה</p>
              <p className="text-sm mt-1">השתמש בשורת החיפוש למעלה כדי להוסיף חומרים</p>
              <div className="mt-4 space-y-1">
                <p className="text-xs text-blue-600">💡 ניתן להוסיף מספר חומרים לריסוס אחד</p>
                <p className="text-xs text-green-600">✨ המינון יחושב אוטומטית לפי השטח המטופל</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* הערות */}
      <Card>
        <CardContent className="pt-6">
          <div>
            <Label htmlFor="notes">הערות</Label>
            <Textarea
              id="notes"
              value={formData.notes}
              onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
              placeholder="הערות נוספות על הריסוס..."
              className="h-24"
            />
          </div>
        </CardContent>
      </Card>

      {/* כפתורים */}
      <div className="flex gap-3 justify-end sticky bottom-0 bg-white p-4 border-t shadow-lg rounded-t-lg">
        <Button type="button" variant="outline" onClick={onCancel}>
          ביטול
        </Button>
        <Button
          type="submit"
          className="bg-blue-600 hover:bg-blue-700"
          // Disable submit if no pesticides, or if required fields are not met
          disabled={
            formData.applied_pesticides.length === 0 ||
            !formData.date ||
            !formData.area_covered ||
            parseFloat(formData.area_covered) <= 0
          }
        >
          {initialData ? 'עדכן ריסוס' : 'שמור ריסוס'}
        </Button>
      </div>
    </form>
  );
}
