import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Seeding, Plot, PlotSeeding, Crop, Variety, User, Farm } from "@/entities/all";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/components/ui/use-toast";
import { Loader2, Plus, Trash2, ExternalLink, Sprout, Leaf } from "lucide-react";
import { format } from "date-fns";
import { useNavigate } from "react-router-dom";

export default function CreateSeedingForm({ isOpen, onClose, onSuccess, availablePlots = [] }) {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    name: "",
    crop_type: "",
    start_date: "",
    planting_date: "",
    estimated_end_date: "",
    status: "ordered",
    notes: "",
    varieties: [],
    days_from_planting_to_harvest: ""
  });

  // Auto-calculate estimated_end_date when planting_date + days change
  const handlePlantingOrDaysChange = (field, value) => {
    setFormData(prev => {
      const updated = { ...prev, [field]: value };
      const pd = field === 'planting_date' ? value : prev.planting_date;
      const days = parseInt(field === 'days_from_planting_to_harvest' ? value : prev.days_from_planting_to_harvest);
      if (pd && days > 0) {
        const end = new Date(pd);
        end.setDate(end.getDate() + days);
        updated.estimated_end_date = format(end, 'yyyy-MM-dd');
      }
      return updated;
    });
  };

  const [allPlots, setAllPlots] = useState([]);
  const [varieties, setVarieties] = useState([]);
  const [crops, setCrops] = useState([]);
  const [selectedPlots, setSelectedPlots] = useState({});
  const [totalAreaSelected, setTotalAreaSelected] = useState(0);
  const [currentFarm, setCurrentFarm] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  // Variety selection states
  const [isVarietyDialogOpen, setIsVarietyDialogOpen] = useState(false);
  const [selectedVariety, setSelectedVariety] = useState(null);
  const [varietySeedlingQuantity, setVarietySeedlingQuantity] = useState("");
  const [varietySeedlingType, setVarietySeedlingType] = useState("regular");

  // Inline crop creation
  const [isAddingCrop, setIsAddingCrop] = useState(false);
  const [newCropName, setNewCropName] = useState("");
  const [isSavingCrop, setIsSavingCrop] = useState(false);

  // Inline variety creation
  const [isAddingVariety, setIsAddingVariety] = useState(false);
  const [newVarietyData, setNewVarietyData] = useState({
    name: "", marketing_company: "", manufacturer: ""
  });
  const [isSavingVariety, setIsSavingVariety] = useState(false);

  const { toast } = useToast();

  // Load initial data
  useEffect(() => {
    if (!isOpen) return;

    const loadInitialData = async () => {
      try {
        const user = await User.me();
        if (!user.current_farm_id) return;

        const farm = await Farm.get(user.current_farm_id);
        setCurrentFarm(farm);

        const [plotsData, cropsData, varietiesData] = await Promise.all([
          Plot.filter({ farm_id: user.current_farm_id }).catch(() => []),
          Crop.list().catch(() => []),
          Variety.list().catch(() => [])
        ]);

        setAllPlots(Array.isArray(plotsData) ? plotsData : []);
        setCrops(Array.isArray(cropsData) ? cropsData.filter(c => c.farm_id === user.current_farm_id) : []);
        setVarieties(Array.isArray(varietiesData) ? varietiesData : []);
      } catch (error) {
        console.error("Error loading initial data:", error);
        toast({ title: "שגיאה", description: "טעינת הנתונים נכשלה.", variant: "destructive" });
      }
    };

    loadInitialData();
  }, [isOpen]);

  // Filter varieties by crop type
  const availableVarietiesByCrop = useMemo(() => {
    if (!formData.crop_type) return [];
    return (Array.isArray(varieties) ? varieties : []).filter(v => v && v.crop_type === formData.crop_type);
  }, [varieties, formData.crop_type]);

  // Calculate total area when plots selection changes
  useEffect(() => {
    const selectedPlotIds = Object.keys(selectedPlots).filter(id => selectedPlots[id]);
    const safeAllPlots = Array.isArray(allPlots) ? allPlots : [];
    const total = selectedPlotIds.reduce((sum, plotId) => {
      const plot = safeAllPlots.find(p => p && p.id === plotId);
      return sum + (plot ? plot.size : 0);
    }, 0);
    setTotalAreaSelected(total);
    setFormData(prev => ({ ...prev, total_area: total }));
  }, [selectedPlots, allPlots]);

  // Generate seeding name automatically
  const generateSeedingName = useCallback(() => {
    const cropName = formData.crop_type;
    const safeAllPlots = Array.isArray(allPlots) ? allPlots : [];
    const safeVarieties = Array.isArray(varieties) ? varieties : [];
    const selectedPlotIds = Object.keys(selectedPlots).filter(id => selectedPlots[id]);
    const plotNames = selectedPlotIds.map(id => {
      const plot = safeAllPlots.find(p => p && p.id === id);
      return plot ? plot.name : "";
    }).filter(Boolean);
    const firstVarietyName = formData.varieties.length > 0
      ? (safeVarieties.find(v => v && v.id === formData.varieties[0].variety_id)?.name || "")
      : "";
    return [cropName, plotNames.join("+"), firstVarietyName].filter(Boolean).join(" ");
  }, [formData.crop_type, selectedPlots, formData.varieties, allPlots, varieties]);

  useEffect(() => {
    if (formData.crop_type || Object.keys(selectedPlots).length || formData.varieties.length) {
      const generatedName = generateSeedingName();
      if (generatedName !== formData.name) {
        setFormData(prev => ({ ...prev, name: generatedName }));
      }
    }
  }, [formData.crop_type, selectedPlots, formData.varieties, generateSeedingName, formData.name]);

  const handlePlotSelectionChange = (plotId) => {
    setSelectedPlots(prev => ({ ...prev, [plotId]: !prev[plotId] }));
  };

  // ── Inline crop creation ──────────────────────────────────────
  const handleSaveCrop = async () => {
    if (!newCropName.trim()) return;
    setIsSavingCrop(true);
    try {
      const created = await Crop.create({ name: newCropName.trim(), farm_id: currentFarm.id });
      setCrops(prev => [...prev, created]);
      setFormData(prev => ({ ...prev, crop_type: created.name, varieties: [] }));
      setNewCropName("");
      setIsAddingCrop(false);
      toast({ title: `גידול "${created.name}" נוסף` });
    } catch (e) {
      toast({ title: "שגיאה", description: "לא ניתן להוסיף גידול", variant: "destructive" });
    } finally {
      setIsSavingCrop(false);
    }
  };

  // ── Inline variety creation ───────────────────────────────────
  const handleSaveVariety = async () => {
    if (!newVarietyData.name.trim() || !formData.crop_type) return;
    setIsSavingVariety(true);
    try {
      const created = await Variety.create({
        ...newVarietyData,
        crop_type: formData.crop_type,
        farm_id: currentFarm.id
      });
      setVarieties(prev => [...prev, created]);
      // Auto-select the new variety
      setSelectedVariety(created);
      setNewVarietyData({ name: "", marketing_company: "", manufacturer: "" });
      setIsAddingVariety(false);
      toast({ title: `זן "${created.name}" נוסף` });
    } catch (e) {
      toast({ title: "שגיאה", description: "לא ניתן להוסיף זן", variant: "destructive" });
    } finally {
      setIsSavingVariety(false);
    }
  };

  // ── Add variety to seeding ────────────────────────────────────
  const handleAddVariety = () => {
    if (!selectedVariety || !varietySeedlingQuantity || !varietySeedlingType) {
      toast({ title: "שגיאה", description: "יש למלא את כל השדות הנדרשים.", variant: "destructive" });
      return;
    }
    const quantity = parseInt(varietySeedlingQuantity);
    if (isNaN(quantity) || quantity <= 0) {
      toast({ title: "שגיאה", description: "כמות השתילים חייבת להיות מספר חיובי.", variant: "destructive" });
      return;
    }
    if (formData.varieties.find(v => v && v.variety_id === selectedVariety.id)) {
      toast({ title: "שגיאה", description: "הזן כבר נוסף למזרע.", variant: "destructive" });
      return;
    }
    setFormData(prev => ({
      ...prev,
      varieties: [...prev.varieties, {
        variety_id: selectedVariety.id,
        seedling_quantity: quantity,
        seedling_type: varietySeedlingType,
        name: selectedVariety.name,
        marketing_company: selectedVariety.marketing_company
      }]
    }));
    setIsVarietyDialogOpen(false);
    setSelectedVariety(null);
    setVarietySeedlingQuantity("");
    setVarietySeedlingType("regular");
    setIsAddingVariety(false);
  };

  const handleRemoveVariety = (varietyId) => {
    setFormData(prev => ({
      ...prev,
      varieties: prev.varieties.filter(v => v && v.variety_id !== varietyId)
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!currentFarm) {
      toast({ title: "שגיאה", description: "לא נמצא משק פעיל.", variant: "destructive" });
      return;
    }
    const selectedPlotIds = Object.keys(selectedPlots).filter(id => selectedPlots[id]);
    if (selectedPlotIds.length === 0) {
      toast({ title: "שגיאה", description: "יש לבחור לפחות חלקה אחת.", variant: "destructive" });
      return;
    }
    if (formData.varieties.length === 0) {
      toast({ title: "שגיאה", description: "יש להוסיף לפחות זן אחד למזרע.", variant: "destructive" });
      return;
    }
    setIsLoading(true);
    try {
      const newSeeding = await Seeding.create({
        ...formData,
        farm_id: currentFarm.id,
        total_area: totalAreaSelected
      });
      await Promise.all(selectedPlotIds.map(plotId =>
        PlotSeeding.create({
          farm_id: currentFarm.id,
          plot_id: plotId,
          seeding_id: newSeeding.id,
          assigned_date: format(new Date(), 'yyyy-MM-dd')
        })
      ));
      toast({ title: "המזרע נוצר בהצלחה" });
      setFormData({ name: "", crop_type: "", start_date: "", planting_date: "", estimated_end_date: "", status: "ordered", notes: "", varieties: [], days_from_planting_to_harvest: "" });
      setSelectedPlots({});
      onSuccess();
      onClose();
    } catch (error) {
      toast({ title: "שגיאה", description: "יצירת המזרע נכשלה.", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  const safeAllPlots = Array.isArray(allPlots) ? allPlots : [];
  const availablePlotsForSelection = safeAllPlots.filter(p => p && (!p.activity_status || p.activity_status === 'active'));
  const translateSeedlingType = (type) => ({ regular: "רגיל", grafted: "מורכב", bare_root: "חשוף שורש" }[type] || type);

  return (
    <>
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-4xl w-full max-h-[90vh] sm:max-h-[90vh] h-[100dvh] sm:h-auto overflow-y-auto rounded-none sm:rounded-lg mx-0 sm:mx-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle>יצירת מזרע חדש</DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Basic Information */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

              {/* ── Crop selector + inline add ── */}
              <div className="space-y-1">
                <Label>סוג גידול *</Label>
                {crops.length === 0 ? (
                  <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
                    <Sprout className="w-4 h-4 shrink-0" />
                    <span>אין גידולים במשק.</span>
                    <button
                      type="button"
                      onClick={() => { onClose(); navigate('/settings?tab=crops'); }}
                      className="underline font-medium flex items-center gap-1 hover:text-amber-900"
                    >
                      נהל גידולים <ExternalLink className="w-3 h-3" />
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <Select
                      value={formData.crop_type}
                      onValueChange={(value) => setFormData(prev => ({ ...prev, crop_type: value, varieties: [] }))}
                    >
                      <SelectTrigger className="flex-1">
                        <SelectValue placeholder="בחר סוג גידול..." />
                      </SelectTrigger>
                      <SelectContent>
                        {crops.map(crop => crop && (
                          <SelectItem key={crop.name} value={crop.name}>{crop.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      title="הוסף גידול חדש"
                      onClick={() => setIsAddingCrop(true)}
                    >
                      <Plus className="w-4 h-4" />
                    </Button>
                  </div>
                )}

                {/* Inline add crop */}
                {isAddingCrop && (
                  <div className="flex gap-2 mt-2 items-center">
                    <Input
                      autoFocus
                      placeholder="שם הגידול החדש..."
                      value={newCropName}
                      onChange={e => setNewCropName(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleSaveCrop(); } if (e.key === 'Escape') setIsAddingCrop(false); }}
                      className="flex-1"
                    />
                    <Button type="button" size="sm" onClick={handleSaveCrop} disabled={isSavingCrop || !newCropName.trim()}>
                      {isSavingCrop ? <Loader2 className="w-3 h-3 animate-spin" /> : "שמור"}
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setIsAddingCrop(false)}>ביטול</Button>
                  </div>
                )}
              </div>

              <div>
                <Label htmlFor="name">שם המזרע</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="שם המזרע יוכן אוטומטית..."
                />
              </div>

              <div>
                <Label htmlFor="start_date">תאריך הזמנה *</Label>
                <Input
                  id="start_date"
                  type="date"
                  value={formData.start_date}
                  onChange={(e) => setFormData(prev => ({ ...prev, start_date: e.target.value }))}
                  required
                />
              </div>

              <div>
                <Label htmlFor="planting_date">תאריך שתילה משוער *</Label>
                <Input
                  id="planting_date"
                  type="date"
                  value={formData.planting_date}
                  onChange={(e) => handlePlantingOrDaysChange('planting_date', e.target.value)}
                  required
                />
              </div>

              <div>
                <Label htmlFor="days_from_planting_to_harvest">ימים משתילה לקטיף ראשון</Label>
                <Input
                  id="days_from_planting_to_harvest"
                  type="number"
                  value={formData.days_from_planting_to_harvest}
                  onChange={(e) => handlePlantingOrDaysChange('days_from_planting_to_harvest', e.target.value)}
                  placeholder="למשל: 60"
                />
              </div>

              <div>
                <Label htmlFor="estimated_end_date">
                  תאריך סיום משוער
                  {formData.days_from_planting_to_harvest && formData.planting_date && (
                    <span className="text-xs text-green-600 mr-2">(חושב אוטומטית)</span>
                  )}
                </Label>
                <Input
                  id="estimated_end_date"
                  type="date"
                  value={formData.estimated_end_date}
                  onChange={(e) => setFormData(prev => ({ ...prev, estimated_end_date: e.target.value }))}
                  placeholder="יחושב אוטומטית מתאריך שתילה + ימים"
                />
              </div>
            </div>

            {/* Plot Selection */}
            <Card>
              <CardHeader>
                <CardTitle className="flex justify-between items-center">
                  <span>בחירת חלקות ({Object.values(selectedPlots).filter(Boolean).length})</span>
                  <Badge variant="secondary">סה"כ שטח: {totalAreaSelected.toFixed(1)} דונם</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {availablePlotsForSelection.length === 0 ? (
                  <div className="flex items-center gap-2 text-center text-gray-500 py-4 text-sm">
                    <span>אין חלקות זמינות.</span>
                    <button type="button" onClick={() => { onClose(); navigate('/plots'); }} className="underline flex items-center gap-1 text-blue-600 hover:text-blue-800">
                      נהל חלקות <ExternalLink className="w-3 h-3" />
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {availablePlotsForSelection.map(plot => plot && (
                      <div key={plot.id} className="flex items-center gap-2 p-3 border rounded-lg hover:bg-gray-50">
                        <Checkbox
                          id={`plot-${plot.id}`}
                          checked={selectedPlots[plot.id] || false}
                          onCheckedChange={() => handlePlotSelectionChange(plot.id)}
                        />
                        <Label htmlFor={`plot-${plot.id}`} className="flex-1 cursor-pointer">
                          <span className="font-medium">{plot.name}</span>
                          <span className="text-sm text-gray-500 block">{plot.size} דונם</span>
                        </Label>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Varieties Management */}
            <Card>
              <CardHeader>
                <CardTitle className="flex justify-between items-center">
                  <span>זנים ({formData.varieties.length})</span>
                  <div className="flex gap-2">
                    {formData.crop_type && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => { onClose(); navigate('/settings?tab=varieties'); }}
                        title="נהל זנים בהגדרות"
                      >
                        <Leaf className="w-4 h-4 ml-1" />
                        נהל זנים
                        <ExternalLink className="w-3 h-3 mr-1" />
                      </Button>
                    )}
                    <Button
                      type="button"
                      onClick={() => { setIsAddingVariety(false); setIsVarietyDialogOpen(true); }}
                      disabled={!formData.crop_type}
                      size="sm"
                    >
                      <Plus className="w-4 h-4 ml-1" />
                      הוסף זן
                    </Button>
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {formData.varieties.length === 0 ? (
                  <p className="text-center text-gray-500 py-4 text-sm">
                    {!formData.crop_type ? "בחר סוג גידול כדי להוסיף זנים" : "לא נוספו זנים עדיין"}
                  </p>
                ) : (
                  <div className="space-y-2">
                    {formData.varieties.map((variety) => variety && (
                      <div key={variety.variety_id} className="flex items-center justify-between p-3 border rounded-lg">
                        <div>
                          <span className="font-medium">{variety.name}</span>
                          {variety.marketing_company && (
                            <span className="text-sm text-gray-500 block">{variety.marketing_company}</span>
                          )}
                          <div className="text-sm text-gray-600 mt-1">
                            {variety.seedling_quantity?.toLocaleString()} שתילים • {translateSeedlingType(variety.seedling_type)}
                          </div>
                        </div>
                        <Button type="button" variant="ghost" size="sm" onClick={() => handleRemoveVariety(variety.variety_id)}>
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Notes */}
            <div>
              <Label htmlFor="notes">הערות</Label>
              <Textarea
                id="notes"
                value={formData.notes}
                onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
                placeholder="הערות כלליות על המזרע..."
                rows={3}
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>ביטול</Button>
              <Button type="submit" disabled={isLoading}>
                {isLoading ? <><Loader2 className="w-4 h-4 ml-2 animate-spin" />יוצר...</> : "צור מזרע"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Variety Dialog ───────────────────────────────────── */}
      <Dialog open={isVarietyDialogOpen} onOpenChange={(o) => { setIsVarietyDialogOpen(o); if (!o) { setIsAddingVariety(false); setSelectedVariety(null); } }}>
        <DialogContent dir="rtl" className="max-w-md">
          <DialogHeader>
            <DialogTitle>הוספת זן למזרע — {formData.crop_type}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Select existing variety OR show inline add */}
            {!isAddingVariety ? (
              <>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <Label>בחר זן</Label>
                    <Button type="button" variant="link" size="sm" className="text-xs p-0 h-auto" onClick={() => setIsAddingVariety(true)}>
                      <Plus className="w-3 h-3 ml-1" /> זן חדש
                    </Button>
                  </div>

                  {availableVarietiesByCrop.length === 0 ? (
                    <div className="p-3 bg-gray-50 border rounded-lg text-sm text-gray-600 text-center space-y-2">
                      <p>אין זנים רשומים עבור {formData.crop_type}.</p>
                      <Button type="button" size="sm" variant="outline" onClick={() => setIsAddingVariety(true)}>
                        <Plus className="w-4 h-4 ml-1" /> הוסף זן חדש
                      </Button>
                    </div>
                  ) : (
                    <Select
                      value={selectedVariety?.id || ""}
                      onValueChange={(value) => setSelectedVariety(availableVarietiesByCrop.find(v => v && v.id === value) || null)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="בחר זן..." />
                      </SelectTrigger>
                      <SelectContent>
                        {availableVarietiesByCrop.map(variety => variety && (
                          <SelectItem key={variety.id} value={variety.id}>
                            {variety.name}{variety.marketing_company && ` (${variety.marketing_company})`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>

                <div>
                  <Label htmlFor="seedling_quantity">כמות שתילים</Label>
                  <Input
                    id="seedling_quantity"
                    type="number"
                    value={varietySeedlingQuantity}
                    onChange={(e) => setVarietySeedlingQuantity(e.target.value)}
                    placeholder="הזן כמות שתילים..."
                  />
                </div>

                <div>
                  <Label>סוג שתיל</Label>
                  <Select value={varietySeedlingType} onValueChange={setVarietySeedlingType}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="regular">רגיל</SelectItem>
                      <SelectItem value="grafted">מורכב</SelectItem>
                      <SelectItem value="bare_root">חשוף שורש</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </>
            ) : (
              /* ── Inline new variety form ── */
              <div className="space-y-3 p-3 bg-green-50 border border-green-200 rounded-lg">
                <p className="text-sm font-medium text-green-800 flex items-center gap-1">
                  <Leaf className="w-4 h-4" /> זן חדש עבור {formData.crop_type}
                </p>
                <div>
                  <Label>שם הזן *</Label>
                  <Input
                    autoFocus
                    placeholder="שם הזן..."
                    value={newVarietyData.name}
                    onChange={e => setNewVarietyData(prev => ({ ...prev, name: e.target.value }))}
                  />
                </div>
                <div>
                  <Label>חברה משווקת</Label>
                  <Input
                    placeholder="שם החברה המשווקת..."
                    value={newVarietyData.marketing_company}
                    onChange={e => setNewVarietyData(prev => ({ ...prev, marketing_company: e.target.value }))}
                  />
                </div>
                <div>
                  <Label>יצרן</Label>
                  <Input
                    placeholder="שם היצרן..."
                    value={newVarietyData.manufacturer}
                    onChange={e => setNewVarietyData(prev => ({ ...prev, manufacturer: e.target.value }))}
                  />
                </div>
                <div className="flex gap-2">
                  <Button type="button" size="sm" onClick={handleSaveVariety} disabled={isSavingVariety || !newVarietyData.name.trim()}>
                    {isSavingVariety ? <Loader2 className="w-3 h-3 animate-spin" /> : "שמור זן"}
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setIsAddingVariety(false)}>חזור</Button>
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setIsVarietyDialogOpen(false)}>ביטול</Button>
            {!isAddingVariety && (
              <Button onClick={handleAddVariety} disabled={!selectedVariety || !varietySeedlingQuantity}>
                הוסף זן למזרע
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
