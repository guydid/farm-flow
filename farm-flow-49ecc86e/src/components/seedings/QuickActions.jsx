
import React, { useState, useEffect } from "react";
import { varietiesForSeeding, packagingsForSeeding } from "@/lib/seedingFilters";
import { Activity, Harvest, Spraying, ActivityType } from "@/entities/all";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import { Calendar, Droplets, Package, Zap, Loader2, Trash2, Search } from "lucide-react";
import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

export default function QuickActions({ seeding, varieties, onRefresh, pesticides, packagings, products }) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [actionType, setActionType] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const [activityTypes, setActivityTypes] = useState([]);

  // Mobile spraying wizard step: 1 = details, 2 = pesticides
  const [sprayingStep, setSprayingStep] = useState(1);

  const [formData, setFormData] = useState({
    date: format(new Date(), 'yyyy-MM-dd'),
    activity_type: '',
    total_cost: '',
    notes: '',
    quantity: '',
    quality: 'א',
    variety: '',
    price_per_unit: '',
    packaging: '',
    package_count: '',
    treatment_type: 'mechanized',
    treatment_time: 'morning',
    applied_pesticides: [],
    area_covered: '',
    performed_by: ''
  });

  // Spraying specific state
  const [searchTerm, setSearchTerm] = useState('');
  const [showPesticidesList, setShowPesticidesList] = useState(false);
  
  // Auto-calculate weight based on package count and type
  useEffect(() => {
    if (actionType === 'harvest' && formData.package_count && formData.packaging) {
      const selectedPackaging = (Array.isArray(packagings) ? packagings : []).find(p => p && p.name === formData.packaging);
      if (selectedPackaging && typeof selectedPackaging.expected_weight === 'number') {
        const calculatedWeight = parseFloat(formData.package_count) * selectedPackaging.expected_weight;
        setFormData(prev => ({ ...prev, quantity: calculatedWeight.toFixed(2) }));
      } else {
        setFormData(prev => ({ ...prev, quantity: '' }));
      }
    } else if (actionType === 'harvest' && (!formData.package_count || !formData.packaging)) {
        setFormData(prev => ({ ...prev, quantity: '' }));
    }
  }, [formData.package_count, formData.packaging, packagings, actionType]);

  // Auto-recalculate pesticide quantities when area changes
  useEffect(() => {
    if (actionType === 'spraying' && formData.area_covered && formData.applied_pesticides.length > 0) {
      const updated = formData.applied_pesticides.map(ap => {
        // Ensure ap.recommended_dosage is a number before calculation
        const recommendedDosage = parseFloat(ap.recommended_dosage);
        if (recommendedDosage > 0) {
          return {
            ...ap,
            quantity: (recommendedDosage * parseFloat(formData.area_covered)).toFixed(2)
          };
        }
        return ap;
      });
      setFormData(prev => ({ ...prev, applied_pesticides: updated }));
    }
  }, [formData.area_covered, actionType]);

  useEffect(() => {
    const loadActivityTypes = async () => {
      try {
        const types = await ActivityType.list();
        setActivityTypes(Array.isArray(types) ? types : []);
      } catch (error) {
        console.error("Error loading activity types:", error);
        setActivityTypes([]);
      }
    };
    loadActivityTypes();
  }, []);

  const resetForm = () => {
    setFormData({
      date: format(new Date(), 'yyyy-MM-dd'),
      activity_type: '',
      total_cost: '',
      notes: '',
      quantity: '',
      quality: 'א',
      variety: '',
      price_per_unit: '',
      packaging: '',
      package_count: '',
      treatment_type: 'mechanized',
      treatment_time: 'morning',
      applied_pesticides: [],
      area_covered: '',
      performed_by: ''
    });
    setSearchTerm('');
    setShowPesticidesList(false);
  };

  const openDialog = (type) => {
    setActionType(type);
    resetForm();
    setSprayingStep(1);
    // Set default area for spraying
    if (type === 'spraying' && seeding?.total_area) {
      setFormData(prev => ({ ...prev, area_covered: seeding.total_area.toString() }));
    }
    setIsDialogOpen(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!seeding || !seeding.farm_id) {
      toast({ title: "שגיאה", description: "מזהה המשק חסר", variant: "destructive" });
      return;
    }

    setIsLoading(true);
    try {
      const baseData = {
        seeding_id: seeding.id,
        farm_id: seeding.farm_id,
        date: formData.date,
        notes: formData.notes
      };

      switch (actionType) {
        case 'activity':
          const safeActivityTypes = Array.isArray(activityTypes) ? activityTypes : [];
          const selectedActivityType = safeActivityTypes.find(at => at.name === formData.activity_type);
          
          await Activity.create({
            ...baseData,
            activity_type: formData.activity_type,
            area_covered: parseFloat(formData.area_covered) || 0,
            cost_per_unit: selectedActivityType?.price_per_dunam || 0,
            total_cost: parseFloat(formData.total_cost) || 0,
            performed_by: formData.performed_by || ""
          });
          break;
          
        case 'harvest':
          const safeVarieties = Array.isArray(varieties) ? varieties : [];
          const selectedVariety = safeVarieties.find(v => v && v.id === formData.variety);
          
          await Harvest.create({
            ...baseData,
            quantity: parseFloat(formData.quantity) || 0,
            quality: formData.quality,
            variety: selectedVariety ? selectedVariety.name : formData.variety,
            price_per_unit: parseFloat(formData.price_per_unit) || 0,
            weight: parseFloat(formData.quantity) || 0,
            packaging: formData.packaging,
            package_count: parseInt(formData.package_count) || 0
          });
          break;
          
        case 'spraying':
          const totalCost = formData.applied_pesticides.reduce((sum, item) => {
            const quantity = parseFloat(item.quantity) || 0;
            const cost = parseFloat(item.cost_per_unit) || 0;
            return sum + (quantity * cost);
          }, 0);

          await Spraying.create({
            ...baseData,
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
            })),
            total_cost: totalCost
          });
          break;
      }

      toast({ title: "הצלחה", description: "הפעולה נוספה בהצלחה" });
      setIsDialogOpen(false);
      onRefresh();
    } catch (error) {
      console.error("Error adding quick action:", error);
      toast({ title: "שגיאה", description: "הוספת הפעולה נכשלה", variant: "destructive" });
    }
    setIsLoading(false);
  };

  // Pesticide handling functions
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

  const handleAddPesticide = (pesticide) => {
    const existingIndex = formData.applied_pesticides.findIndex(p => p.pesticide_id === pesticide.id);
    
    // Calculate recommended quantity based on area and dosage
    let recommendedQuantity = '';
    let dosagePerDunam = 0;
    let unit = 'מ"ל'; // Default unit
    
    // Try to extract numeric dosage and unit from the dosage field string
    if (pesticide.dosage) {
      const dosageMatch = pesticide.dosage.match(/(\d+(?:\.\d+)?)/);
      if (dosageMatch) {
        dosagePerDunam = parseFloat(dosageMatch[1]);
      }
      
      if (pesticide.dosage.includes('ליטר')) unit = 'ליטר';
      else if (pesticide.dosage.includes('גרם')) unit = 'גרם';
      else if (pesticide.dosage.includes('ק"ג')) unit = 'ק"ג';
      else if (pesticide.dosage.includes('מ"ל')) unit = 'מ"ל';
      else if (pesticide.dosage.includes('סמ"ק')) unit = 'סמ"ק';
      // Add other units as needed
    }
    
    if (dosagePerDunam > 0 && formData.area_covered) {
      recommendedQuantity = (dosagePerDunam * parseFloat(formData.area_covered)).toFixed(2);
    }
    
    if (existingIndex >= 0) {
      const updated = [...formData.applied_pesticides];
      updated[existingIndex].quantity = recommendedQuantity || updated[existingIndex].quantity;
      updated[existingIndex].recommended_dosage = dosagePerDunam;
      updated[existingIndex].unit = unit;
      setFormData(prev => ({ ...prev, applied_pesticides: updated }));
    } else {
      setFormData(prev => ({
        ...prev,
        applied_pesticides: [
          ...prev.applied_pesticides,
          {
            pesticide_id: pesticide.id,
            pesticide_name: pesticide.product_name, // Updated field name
            active_ingredient: pesticide.active_ingredients, // Add active ingredient
            quantity: recommendedQuantity,
            unit: unit,
            recommended_dosage: dosagePerDunam,
            cost_per_unit: 0, // Default cost to 0
            concentration: pesticide.concentration || '', // Add concentration
            formulation: pesticide.formulation || '' // Add formulation
          }
        ]
      }));
    }
    
    setSearchTerm('');
    setShowPesticidesList(false);
  };

  const handleRemovePesticide = (index) => {
    setFormData(prev => ({
      ...prev,
      applied_pesticides: prev.applied_pesticides.filter((_, i) => i !== index)
    }));
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

  const getCategoryColor = (product_type) => ({
    fungicide: "bg-green-100 text-green-800",
    insecticide: "bg-red-100 text-red-800",
    herbicide: "bg-yellow-100 text-yellow-800",
    miticide: "bg-purple-100 text-purple-800", 
    nematicide: "bg-pink-100 text-pink-800",
    growth_regulator: "bg-blue-100 text-blue-800",
    other: "bg-gray-100 text-gray-800"
  }[product_type] || "bg-gray-100 text-gray-800");

  // זנים ואריזות לפי המזרע (זנים משויכים; אריזות לפי מוצרי סוג הגידול)
  const safeVarieties = Array.isArray(varieties) ? varieties : [];
  const relevantVarieties = varietiesForSeeding(seeding, safeVarieties);
  const safePackagings = packagingsForSeeding(seeding, packagings, products);

  return (
    <div>
      {/* Mobile — 3 large tap-friendly buttons */}
      <div className="grid grid-cols-3 gap-2 sm:hidden">
        <button
          type="button"
          onClick={() => openDialog('activity')}
          className="flex flex-col items-center gap-1 py-3 rounded-xl bg-blue-50 border border-blue-200 active:scale-95 transition-transform"
        >
          <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center">
            <Zap className="w-4 h-4 text-white" />
          </div>
          <span className="text-xs font-medium text-blue-700">פעילות</span>
        </button>
        <button
          type="button"
          onClick={() => openDialog('harvest')}
          className="flex flex-col items-center gap-1 py-3 rounded-xl bg-green-50 border border-green-200 active:scale-95 transition-transform"
        >
          <div className="w-8 h-8 rounded-full bg-green-500 flex items-center justify-center">
            <Package className="w-4 h-4 text-white" />
          </div>
          <span className="text-xs font-medium text-green-700">קטיף</span>
        </button>
        <button
          type="button"
          onClick={() => openDialog('spraying')}
          className="flex flex-col items-center gap-1 py-3 rounded-xl bg-orange-50 border border-orange-200 active:scale-95 transition-transform"
        >
          <div className="w-8 h-8 rounded-full bg-orange-500 flex items-center justify-center">
            <Droplets className="w-4 h-4 text-white" />
          </div>
          <span className="text-xs font-medium text-orange-700">הדברה</span>
        </button>
      </div>

      {/* Desktop — same style as mobile */}
      <div className="hidden sm:grid grid-cols-3 gap-2">
        <button
          type="button"
          onClick={() => openDialog('activity')}
          className="flex flex-col items-center gap-1 py-3 rounded-xl bg-blue-50 border border-blue-200 hover:bg-blue-100 active:scale-95 transition-all"
        >
          <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center">
            <Zap className="w-4 h-4 text-white" />
          </div>
          <span className="text-xs font-medium text-blue-700">פעילות</span>
        </button>
        <button
          type="button"
          onClick={() => openDialog('harvest')}
          className="flex flex-col items-center gap-1 py-3 rounded-xl bg-green-50 border border-green-200 hover:bg-green-100 active:scale-95 transition-all"
        >
          <div className="w-8 h-8 rounded-full bg-green-500 flex items-center justify-center">
            <Package className="w-4 h-4 text-white" />
          </div>
          <span className="text-xs font-medium text-green-700">קטיף</span>
        </button>
        <button
          type="button"
          onClick={() => openDialog('spraying')}
          className="flex flex-col items-center gap-1 py-3 rounded-xl bg-orange-50 border border-orange-200 hover:bg-orange-100 active:scale-95 transition-all"
        >
          <div className="w-8 h-8 rounded-full bg-orange-500 flex items-center justify-center">
            <Droplets className="w-4 h-4 text-white" />
          </div>
          <span className="text-xs font-medium text-orange-700">הדברה</span>
        </button>
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent 
          className={actionType === 'spraying' ? "sm:max-w-4xl max-h-[90vh] overflow-y-auto" : "sm:max-w-md"} 
          dir="rtl"
        >
          <DialogHeader>
            <DialogTitle>
              הוספת {actionType === 'activity' ? 'פעילות' : actionType === 'harvest' ? 'קטיף' : 'הדברה'}
            </DialogTitle>
          </DialogHeader>
          
          <form onSubmit={handleSubmit} className="space-y-4">
            {actionType !== 'spraying' && (
              <div>
                <Label htmlFor="date">תאריך</Label>
                <Input
                  id="date"
                  type="date"
                  value={formData.date}
                  onChange={(e) => setFormData(prev => ({ ...prev, date: e.target.value }))}
                  required
                />
              </div>
            )}

            {actionType === 'activity' && (
              <>
                <div>
                  <Label htmlFor="activity_type">סוג פעילות</Label>
                  <Select
                    value={formData.activity_type}
                    onValueChange={(value) => {
                      const selectedType = activityTypes.find(at => at.name === value);
                      setFormData(prev => ({ 
                        ...prev, 
                        activity_type: value,
                        total_cost: (selectedType?.price_per_dunam && parseFloat(prev.area_covered)) 
                          ? (selectedType.price_per_dunam * parseFloat(prev.area_covered)).toFixed(2)
                          : prev.total_cost
                      }));
                    }}
                  >
                    <SelectTrigger id="activity_type">
                      <SelectValue placeholder="בחר סוג פעילות..." />
                    </SelectTrigger>
                    <SelectContent>
                      {activityTypes.map(type => (
                        <SelectItem key={type.id} value={type.name}>
                          {type.name}
                          {type.price_per_dunam > 0 && ` (₪${type.price_per_dunam}/דונם)`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {activityTypes.length === 0 && (
                    <p className="text-xs text-gray-500 mt-1">
                      💡 ניתן להוסיף סוגי פעילויות בהגדרות
                    </p>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="area_covered">שטח (דונם)</Label>
                    <Input
                      id="area_covered"
                      type="number"
                      step="0.1"
                      value={formData.area_covered}
                      onChange={(e) => {
                        const area = e.target.value;
                        const selectedType = activityTypes.find(at => at.name === formData.activity_type);
                        setFormData(prev => ({
                          ...prev,
                          area_covered: area,
                          total_cost: (selectedType?.price_per_dunam && parseFloat(area))
                            ? (selectedType.price_per_dunam * parseFloat(area)).toFixed(2)
                            : prev.total_cost
                        }));
                      }}
                      placeholder="שטח"
                    />
                  </div>
                  <div>
                    <Label htmlFor="total_cost">עלות (₪)</Label>
                    <Input
                      id="total_cost"
                      type="number"
                      step="0.01"
                      value={formData.total_cost}
                      onChange={(e) => setFormData(prev => ({ ...prev, total_cost: e.target.value }))}
                      placeholder="0"
                    />
                  </div>
                </div>
                <div>
                  <Label htmlFor="performed_by">מבצע</Label>
                  <Input
                    id="performed_by"
                    value={formData.performed_by}
                    onChange={(e) => setFormData(prev => ({ ...prev, performed_by: e.target.value }))}
                    placeholder="שם המבצע (אופציונלי)"
                  />
                </div>
              </>
            )}

            {actionType === 'harvest' && (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="package_count">כמות אריזות</Label>
                    <Input
                      id="package_count"
                      type="number"
                      value={formData.package_count}
                      onChange={(e) => setFormData(prev => ({ ...prev, package_count: e.target.value }))}
                      placeholder="למשל: 100"
                      required
                    />
                  </div>
                  <div>
                    <Label htmlFor="packaging">אריזה</Label>
                    <Select
                      value={formData.packaging}
                      onValueChange={(value) => setFormData(prev => ({ ...prev, packaging: value }))}
                    >
                      <SelectTrigger id="packaging">
                          <SelectValue placeholder="בחר סוג אריזה..."/>
                      </SelectTrigger>
                      <SelectContent>
                          {safePackagings.map((p) => p && (
                              <SelectItem key={p.id} value={p.name}>
                                  {p.name}
                              </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="quantity">משקל צפוי (ק"ג)</Label>
                    <Input
                      id="quantity"
                      type="number"
                      step="0.01"
                      value={formData.quantity}
                      onChange={(e) => setFormData(prev => ({ ...prev, quantity: e.target.value }))}
                      required
                      className="bg-gray-100"
                      readOnly
                    />
                  </div>
                  <div>
                    <Label htmlFor="quality">איכות</Label>
                    <Select value={formData.quality} onValueChange={(value) => setFormData(prev => ({ ...prev, quality: value }))}>
                      <SelectTrigger id="quality">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="א">א</SelectItem>
                        <SelectItem value="ב">ב</SelectItem>
                        <SelectItem value="ג">ג</SelectItem>
                        <SelectItem value="תעשייתי">תעשייתי</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {relevantVarieties.length > 0 && (
                  <div>
                    <Label htmlFor="variety">זן</Label>
                    <Select value={formData.variety} onValueChange={(value) => setFormData(prev => ({ ...prev, variety: value }))}>
                      <SelectTrigger id="variety">
                        <SelectValue placeholder="בחר זן..." />
                      </SelectTrigger>
                      <SelectContent>
                        {relevantVarieties.map(variety => (
                          <SelectItem key={variety.id} value={variety.id}>
                            {variety.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div>
                  <Label htmlFor="price_per_unit">מחיר ליחידה (₪)</Label>
                  <Input
                    id="price_per_unit"
                    type="number"
                    step="0.01"
                    value={formData.price_per_unit}
                    onChange={(e) => setFormData(prev => ({ ...prev, price_per_unit: e.target.value }))}
                  />
                </div>
              </>
            )}

            {actionType === 'spraying' && (
              <div className="space-y-6">

                {/* ── Mobile step indicator ── */}
                <div className="flex sm:hidden items-center gap-2 mb-1">
                  <div className={`flex-1 h-1.5 rounded-full ${sprayingStep >= 1 ? 'bg-blue-500' : 'bg-gray-200'}`} />
                  <div className={`flex-1 h-1.5 rounded-full ${sprayingStep >= 2 ? 'bg-blue-500' : 'bg-gray-200'}`} />
                </div>
                <div className="flex sm:hidden justify-between text-xs text-gray-500 -mt-3 mb-1">
                  <span className={sprayingStep === 1 ? 'text-blue-600 font-semibold' : ''}>שלב 1: פרטי הדברה</span>
                  <span className={sprayingStep === 2 ? 'text-blue-600 font-semibold' : ''}>שלב 2: חומרי הדברה</span>
                </div>

                {/* פרטי ההדברה — always visible on desktop, step 1 on mobile */}
                <Card className={sprayingStep === 2 ? 'hidden sm:block' : ''}>
                  <CardHeader>
                    <CardTitle className="text-lg">פרטי ההדברה</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                      </div>

                      <div>
                        <Label htmlFor="treatment_type">סוג טיפול *</Label>
                        <Select
                          value={formData.treatment_type}
                          onValueChange={(value) => setFormData(prev => ({ ...prev, treatment_type: value }))}
                        >
                          <SelectTrigger id="treatment_type">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="mechanized">מכני</SelectItem>
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
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="morning">בוקר</SelectItem>
                            <SelectItem value="noon">צהריים</SelectItem>
                            <SelectItem value="evening">ערב</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="md:col-span-2">
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

                {/* Mobile: Next button after step 1 */}
                <div className="sm:hidden">
                  {sprayingStep === 1 && (
                    <Button
                      type="button"
                      className="w-full"
                      onClick={() => setSprayingStep(2)}
                    >
                      הבא: בחירת חומרי הדברה ←
                    </Button>
                  )}
                </div>

                {/* חומרי הדברה — always on desktop, step 2 on mobile */}
                <Card className={sprayingStep === 1 ? 'hidden sm:block' : ''}>
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center justify-between">
                      <span>חומרי הדברה</span>
                      <span className="text-sm font-normal text-gray-500">
                        סה"כ עלות: ₪{getSprayingGrandTotal()}
                      </span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* חיפוש והוספת חומר */}
                    <div className="relative">
                      <Label>הוסף חומר הדברה</Label>
                      <div className="relative mt-1">
                        <Search className="absolute right-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <Input
                          placeholder="חפש חומר לפי שם, חומר פעיל, יצרן או יבול..."
                          value={searchTerm}
                          onChange={(e) => {
                            setSearchTerm(e.target.value);
                            setShowPesticidesList(e.target.value.length > 0);
                          }}
                          onFocus={() => searchTerm && setShowPesticidesList(true)}
                          className="pr-10"
                        />
                      </div>

                      {/* רשימת תוצאות חיפוש */}
                      {showPesticidesList && filteredPesticides.length > 0 && (
                        <div className="absolute z-10 w-full mt-1 bg-white border rounded-lg shadow-lg max-h-60 overflow-y-auto">
                          {filteredPesticides.map(pesticide => (
                            <button
                              key={pesticide.id}
                              type="button"
                              onClick={() => handleAddPesticide(pesticide)}
                              className="w-full text-right p-3 hover:bg-gray-50 border-b last:border-b-0 transition-colors"
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="flex-1 min-w-0">
                                  <div className="font-medium text-sm truncate">{pesticide.product_name}</div>
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
                                  {pesticide.dosage && (
                                    <div className="text-xs text-blue-600 mt-1 font-medium">
                                      מינון: {pesticide.dosage}
                                    </div>
                                  )}
                                  {pesticide.crop && (
                                    <div className="text-xs text-green-600 mt-0.5">
                                      גידול: {pesticide.crop}
                                    </div>
                                  )}
                                </div>
                                <div className="flex flex-col gap-1 items-end flex-shrink-0">
                                  <Badge className={getCategoryColor(pesticide.product_type)}>
                                    {pesticide.product_type}
                                  </Badge>
                                  {pesticide.concentration && (
                                    <Badge variant="outline" className="text-xs">
                                      {pesticide.concentration}
                                    </Badge>
                                  )}
                                </div>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* טבלת חומרים - Desktop */}
                    {formData.applied_pesticides.length > 0 ? (
                      <>
                        <div className="hidden md:block border rounded-lg overflow-hidden">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead className="w-[30%]">חומר</TableHead>
                                <TableHead className="w-[15%]">מינון/דונם</TableHead>
                                <TableHead className="w-[15%]">כמות</TableHead>
                                <TableHead className="w-[15%]">עלות/יח'</TableHead>
                                <TableHead className="w-[15%]">סה"כ</TableHead>
                                <TableHead className="w-[10%]"></TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {formData.applied_pesticides.map((item, index) => (
                                <TableRow key={index}>
                                  <TableCell className="font-medium">{item.pesticide_name}</TableCell>
                                  <TableCell className="text-sm text-gray-600">
                                    {item.recommended_dosage || '-'} {item.unit}
                                  </TableCell>
                                  <TableCell>
                                    <Input
                                      type="number"
                                      step="0.01"
                                      value={item.quantity}
                                      onChange={(e) => handlePesticideQuantityChange(index, e.target.value)}
                                      className="w-20"
                                    />
                                    <span className="text-xs text-gray-500 mr-1">{item.unit}</span>
                                  </TableCell>
                                  <TableCell>
                                    <Input
                                      type="number"
                                      step="0.01"
                                      value={item.cost_per_unit}
                                      onChange={(e) => handlePesticideCostChange(index, e.target.value)}
                                      className="w-20"
                                      placeholder="0"
                                    />
                                  </TableCell>
                                  <TableCell className="font-semibold">
                                    ₪{getPesticideTotalCost(item)}
                                  </TableCell>
                                  <TableCell>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon"
                                      onClick={() => handleRemovePesticide(index)}
                                      className="text-red-500 hover:text-red-700"
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </Button>
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>

                          <div className="bg-gray-50 p-3 border-t">
                            <div className="flex justify-between items-center font-semibold">
                              <span>סה"כ עלות כוללת:</span>
                              <span className="text-lg text-blue-600">₪{getSprayingGrandTotal()}</span>
                            </div>
                          </div>
                        </div>

                        {/* כרטיסיות חומרים - Mobile */}
                        <div className="md:hidden space-y-3">
                          {formData.applied_pesticides.map((item, index) => (
                            <Card key={index} className="border-2">
                              <CardContent className="p-4 space-y-3">
                                <div className="flex items-center justify-between">
                                  <span className="font-medium">{item.pesticide_name}</span>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => handleRemovePesticide(index)}
                                    className="text-red-500 hover:text-red-700 h-8 w-8"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </Button>
                                </div>
                                
                                <div className="text-sm text-gray-600">
                                  מינון: {item.recommended_dosage || '-'} {item.unit}/דונם
                                </div>

                                <div className="grid grid-cols-2 gap-2">
                                  <div>
                                    <Label className="text-xs">כמות</Label>
                                    <div className="flex items-center gap-1">
                                      <Input
                                        type="number"
                                        step="0.01"
                                        value={item.quantity}
                                        onChange={(e) => handlePesticideQuantityChange(index, e.target.value)}
                                        className="text-sm"
                                      />
                                      <span className="text-xs text-gray-500">{item.unit}</span>
                                    </div>
                                  </div>
                                  
                                  <div>
                                    <Label className="text-xs">עלות/יח'</Label>
                                    <Input
                                      type="number"
                                      step="0.01"
                                      value={item.cost_per_unit}
                                      onChange={(e) => handlePesticideCostChange(index, e.target.value)}
                                      placeholder="0"
                                      className="text-sm"
                                    />
                                  </div>
                                </div>

                                <div className="flex justify-between items-center pt-2 border-t">
                                  <span className="text-sm font-medium">סה"כ:</span>
                                  <span className="font-semibold text-blue-600">₪{getPesticideTotalCost(item)}</span>
                                </div>
                              </CardContent>
                            </Card>
                          ))}

                          <Card className="bg-blue-50 border-blue-200">
                            <CardContent className="p-4">
                              <div className="flex justify-between items-center">
                                <span className="font-semibold">סה"כ עלות כוללת:</span>
                                <span className="text-lg font-bold text-blue-600">₪{getSprayingGrandTotal()}</span>
                              </div>
                            </CardContent>
                          </Card>
                        </div>
                      </>
                    ) : (
                      <div className="text-center py-8 text-gray-500 bg-gray-50 rounded-lg border-2 border-dashed">
                        <Droplets className="w-12 h-12 mx-auto mb-3 text-gray-400" />
                        <p>לא נבחרו חומרי הדברה</p>
                        <p className="text-sm mt-1">השתמש בשורת החיפוש למעלה כדי להוסיף חומרים</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            )}

            {actionType !== 'spraying' && (
              <div>
                <Label htmlFor="notes">הערות</Label>
                <Textarea
                  id="notes"
                  value={formData.notes}
                  onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
                  placeholder="הערות נוספות..."
                  className="h-20"
                />
              </div>
            )}

            {actionType === 'spraying' && (
              <div className={sprayingStep === 1 ? 'hidden sm:block' : ''}>
                <Label htmlFor="notes">הערות</Label>
                <Textarea
                  id="notes"
                  value={formData.notes}
                  onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
                  placeholder="הערות נוספות..."
                  className="h-20"
                />
              </div>
            )}

            <DialogFooter className="gap-2">
              {/* Mobile spraying step 2: show Back button */}
              {actionType === 'spraying' && sprayingStep === 2 && (
                <Button
                  type="button"
                  variant="outline"
                  className="sm:hidden"
                  onClick={() => setSprayingStep(1)}
                >
                  → חזור לפרטים
                </Button>
              )}
              <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                ביטול
              </Button>
              {/* Mobile spraying step 1: hide submit, show Next instead */}
              {actionType === 'spraying' && sprayingStep === 1 ? (
                <Button
                  type="button"
                  className="sm:hidden"
                  onClick={() => setSprayingStep(2)}
                >
                  הבא ←
                </Button>
              ) : null}
              <Button
                type="submit"
                disabled={isLoading}
                className={actionType === 'spraying' && sprayingStep === 1 ? 'hidden sm:inline-flex' : ''}
              >
                {isLoading ? <Loader2 className="w-4 h-4 animate-spin ml-2" /> : null}
                הוסף
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
