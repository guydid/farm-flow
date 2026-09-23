import React, { useState, useEffect, useCallback } from "react";
import { Seeding, Crop, Plot, PlotSeeding, Variety } from "@/entities/all";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// Variety Management Component (Internal)
function SeedingVarietiesManager({ seeding, cropType, currentVarieties, onVarietiesChange }) {
  const [availableVarieties, setAvailableVarieties] = useState([]);
  const [isVarietyDialogOpen, setIsVarietyDialogOpen] = useState(false);
  const [selectedVariety, setSelectedVariety] = useState(null);
  const [quantity, setQuantity] = useState("");
  const [seedlingType, setSeedlingType] = useState("regular");
  
  useEffect(() => {
    const loadVarieties = async () => {
      if (!cropType) {
        setAvailableVarieties([]);
        return;
      }
      try {
        const varietiesData = await Variety.filter({ crop_type: cropType });
        setAvailableVarieties(Array.isArray(varietiesData) ? varietiesData : []);
      } catch (error) {
        console.error("Error loading varieties for crop type:", error);
        setAvailableVarieties([]);
      }
    };
    loadVarieties();
  }, [cropType]);

  const handleAddVariety = () => {
    if (!selectedVariety || !quantity || !seedlingType) return;
    
    const newEntry = {
      variety_id: selectedVariety.id,
      seedling_quantity: parseInt(quantity),
      seedling_type: seedlingType,
      name: selectedVariety.name,
      marketing_company: selectedVariety.marketing_company,
    };
    
    // Safe find with array check
    const safeCurrentVarieties = Array.isArray(currentVarieties) ? currentVarieties : [];
    const existing = safeCurrentVarieties.find(v => v && v.variety_id === newEntry.variety_id);
    if (existing) return;

    onVarietiesChange([...safeCurrentVarieties, newEntry]);
    setIsVarietyDialogOpen(false);
    setSelectedVariety(null);
    setQuantity("");
  };

  const handleRemoveVariety = (varietyId) => {
    const safeCurrentVarieties = Array.isArray(currentVarieties) ? currentVarieties : [];
    onVarietiesChange(safeCurrentVarieties.filter(v => v && v.variety_id !== varietyId));
  };

  // עריכה בשורה של כמות שתילים / סוג שתיל לזן שכבר משויך
  const handleUpdateVariety = (varietyId, patch) => {
    const safeCurrentVarieties = Array.isArray(currentVarieties) ? currentVarieties : [];
    onVarietiesChange(safeCurrentVarieties.map(v => (v && v.variety_id === varietyId) ? { ...v, ...patch } : v));
  };

  const SEEDLING_TYPES = [
    { value: "regular", label: "רגיל" },
    { value: "grafted", label: "מורכב" },
    { value: "bare_root", label: "חשוף שורש" },
  ];

  const safeCurrentVarieties = Array.isArray(currentVarieties) ? currentVarieties : [];
  const safeAvailableVarieties = Array.isArray(availableVarieties) ? availableVarieties : [];

  return (
    <div className="space-y-6">
       <div className="flex justify-between items-center">
          <h3 className="text-lg font-semibold">ניהול זנים</h3>
          <Button type="button" onClick={() => setIsVarietyDialogOpen(true)} disabled={!cropType}>
            <Plus className="w-4 h-4 ml-2"/>הוסף זן
          </Button>
       </div>
       
       {safeCurrentVarieties.length > 0 ? (
           <div className="border rounded-lg overflow-hidden">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>שם הזן</TableHead>
                        <TableHead>חברה משווקת</TableHead>
                        <TableHead>כמות שתילים</TableHead>
                        <TableHead>סוג שתיל</TableHead>
                        <TableHead className="w-20">פעולות</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {safeCurrentVarieties.map(v => v && (
                        <TableRow key={v.variety_id}>
                            <TableCell className="font-medium">{v.name || 'טוען...'}</TableCell>
                            <TableCell>{v.marketing_company || '-'}</TableCell>
                            <TableCell>
                                <Input
                                    type="number"
                                    min="0"
                                    className="h-8 w-28"
                                    value={v.seedling_quantity ?? ""}
                                    onChange={(e) => handleUpdateVariety(v.variety_id, {
                                        seedling_quantity: e.target.value === "" ? "" : parseInt(e.target.value, 10) || 0
                                    })}
                                    aria-label={`כמות שתילים - ${v.name || ""}`}
                                />
                            </TableCell>
                            <TableCell>
                                <Select value={v.seedling_type || "regular"} onValueChange={(val) => handleUpdateVariety(v.variety_id, { seedling_type: val })}>
                                    <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        {SEEDLING_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </TableCell>
                            <TableCell>
                                <Button type="button" variant="ghost" size="icon" onClick={() => handleRemoveVariety(v.variety_id)}>
                                    <Trash2 className="w-4 h-4 text-red-500" />
                                </Button>
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
           </div>
       ) : (
           <div className="border rounded-lg p-8 text-center text-gray-500">
               {cropType ? "לא שויכו זנים למזרע זה." : "יש לבחור סוג גידול כדי לנהל זנים."}
           </div>
       )}

       {/* Add Variety Dialog */}
       {isVarietyDialogOpen && (
           <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
               <div className="bg-white p-6 rounded-lg max-w-md w-full mx-4">
                   <h4 className="text-lg font-semibold mb-4">הוספת זן למזרע</h4>
                   <div className="space-y-4">
                       <div>
                           <Label>בחר זן</Label>
                           <Select onValueChange={(value) => {
                               const variety = safeAvailableVarieties.find(v => v && v.id === value);
                               setSelectedVariety(variety || null);
                           }}>
                               <SelectTrigger>
                                   <SelectValue placeholder="בחר זן..." />
                               </SelectTrigger>
                               <SelectContent>
                                   {safeAvailableVarieties.map(variety => variety && (
                                       <SelectItem key={variety.id} value={variety.id}>
                                           {variety.name} - {variety.marketing_company || 'לא צוין'}
                                       </SelectItem>
                                   ))}
                               </SelectContent>
                           </Select>
                       </div>
                       <div>
                           <Label>כמות שתילים</Label>
                           <Input 
                               type="number" 
                               value={quantity}
                               onChange={(e) => setQuantity(e.target.value)}
                               placeholder="הזן כמות..."
                           />
                       </div>
                       <div>
                           <Label>סוג שתיל</Label>
                           <Select value={seedlingType} onValueChange={setSeedlingType}>
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
                   </div>
                   <div className="flex justify-end gap-2 mt-6">
                       <Button type="button" variant="outline" onClick={() => setIsVarietyDialogOpen(false)}>ביטול</Button>
                       <Button type="button" onClick={handleAddVariety}>הוסף</Button>
                   </div>
               </div>
           </div>
       )}
    </div>
  );
}

export default function EditSeedingForm({ seeding, isOpen, onClose, onSuccess }) {
  const [isLoading, setIsLoading] = useState(false);
  const [crops, setCrops] = useState([]);
  const [allPlots, setAllPlots] = useState([]);
  const [associatedPlotIds, setAssociatedPlotIds] = useState([]);
  const [initialPlotIds, setInitialPlotIds] = useState([]);
  const [seedingVarieties, setSeedingVarieties] = useState([]);
  const [activeTab, setActiveTab] = useState("details");
  const { toast } = useToast();

  const [formData, setFormData] = useState({
    name: "",
    name_en: "",
    start_date: "",
    planting_date: "",
    estimated_end_date: "",
    crop_type: "",
    notes: "",
    days_from_planting_to_harvest: "",
    total_area: 0, // Initialize total_area in formData
  });

  const loadInitialData = useCallback(async () => {
    if (!seeding) return;
    setIsLoading(true);
    try {
      const [cropsData, allPlotsData, plotSeedingsData] = await Promise.all([
        Crop.list(),
        Plot.list(),
        seeding.id ? PlotSeeding.filter({ seeding_id: seeding.id }) : Promise.resolve([])
      ]);

      setCrops(Array.isArray(cropsData) ? cropsData : []);
      setAllPlots(Array.isArray(allPlotsData) ? allPlotsData : []);
      
      const safePlotSeedingsData = Array.isArray(plotSeedingsData) ? plotSeedingsData : [];
      const currentPlotIds = safePlotSeedingsData.map(ps => ps && ps.plot_id).filter(Boolean);
      setAssociatedPlotIds(currentPlotIds);
      setInitialPlotIds(currentPlotIds);

      const initialFormData = {
        name: seeding.name || "",
        name_en: seeding.name_en || "",
        start_date: seeding.start_date ? format(new Date(seeding.start_date), "yyyy-MM-dd") : "",
        planting_date: seeding.planting_date ? format(new Date(seeding.planting_date), "yyyy-MM-dd") : "",
        estimated_end_date: seeding.estimated_end_date ? format(new Date(seeding.estimated_end_date), "yyyy-MM-dd") : "",
        crop_type: seeding.crop_type || "",
        notes: seeding.notes || "",
        days_from_planting_to_harvest: seeding.days_from_planting_to_harvest || "",
        // total_area will be calculated by the useEffect below
      };
      setFormData(initialFormData);

      // Load varieties with names
      if (seeding.varieties && Array.isArray(seeding.varieties)) {
        try {
          const allVarieties = await Variety.list();
          const safeAllVarieties = Array.isArray(allVarieties) ? allVarieties : [];
          const varietiesWithNames = seeding.varieties.map(sv => {
            if (!sv || !sv.variety_id) return null;
            const variety = safeAllVarieties.find(v => v && v.id === sv.variety_id);
            return variety ? {
              ...sv,
              name: variety.name,
              marketing_company: variety.marketing_company
            } : null;
          }).filter(Boolean);
          setSeedingVarieties(varietiesWithNames);
        } catch (error) {
          console.error("Error loading variety details:", error);
          setSeedingVarieties([]);
        }
      } else {
        setSeedingVarieties([]);
      }

    } catch (error) {
      console.error("Failed to load data for edit form:", error);
      toast({ title: "שגיאה", description: "טעינת נתונים לעריכה נכשלה.", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }, [seeding, toast]);

  useEffect(() => {
    if (isOpen && seeding) {
      loadInitialData();
    }
  }, [isOpen, seeding, loadInitialData]);
  
  const calculateTotalArea = useCallback(() => {
    const safeAllPlots = Array.isArray(allPlots) ? allPlots : [];
    const safeAssociatedPlotIds = Array.isArray(associatedPlotIds) ? associatedPlotIds : [];
    return safeAssociatedPlotIds.reduce((sum, plotId) => {
      const plot = safeAllPlots.find(p => p && p.id === plotId);
      const plotSize = typeof plot?.size === 'number' ? plot.size : 0;
      return sum + plotSize;
    }, 0);
  }, [associatedPlotIds, allPlots]);

  useEffect(() => {
    // Update total_area in formData whenever associatedPlotIds or allPlots change
    const newTotalArea = calculateTotalArea();
    setFormData(prev => ({...prev, total_area: newTotalArea }));
  }, [associatedPlotIds, allPlots, calculateTotalArea]);

  const handlePlotToggle = (plotId) => {
    const safeAssociatedPlotIds = Array.isArray(associatedPlotIds) ? associatedPlotIds : [];
    setAssociatedPlotIds(prev => {
      const safePrev = Array.isArray(prev) ? prev : [];
      return safePrev.includes(plotId) 
        ? safePrev.filter(id => id !== plotId)
        : [...safePrev, plotId];
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const updateData = {
        ...formData, // formData now includes total_area updated by useEffect
        varieties: Array.isArray(seedingVarieties) ? seedingVarieties.map(sv => ({
          variety_id: sv.variety_id,
          seedling_quantity: parseInt(sv.seedling_quantity, 10) || 0,
          seedling_type: sv.seedling_type
        })) : []
      };

      await Seeding.update(seeding.id, updateData);

      // Handle plot associations
      const safeInitialPlotIds = Array.isArray(initialPlotIds) ? initialPlotIds : [];
      const safeAssociatedPlotIds = Array.isArray(associatedPlotIds) ? associatedPlotIds : [];
      
      const plotsToRemove = safeInitialPlotIds.filter(id => !safeAssociatedPlotIds.includes(id));
      const plotsToAdd = safeAssociatedPlotIds.filter(id => !safeInitialPlotIds.includes(id));

      for (const plotId of plotsToRemove) {
        try {
          const existingAssociations = await PlotSeeding.filter({ plot_id: plotId, seeding_id: seeding.id });
          const safeAssociations = Array.isArray(existingAssociations) ? existingAssociations : [];
          for (const association of safeAssociations) {
            if (association && association.id) {
              await PlotSeeding.delete(association.id);
            }
          }
        } catch (error) {
          console.error(`Error removing plot association for plot ${plotId}:`, error);
        }
      }

      for (const plotId of plotsToAdd) {
        try {
          await PlotSeeding.create({
            farm_id: seeding.farm_id,
            plot_id: plotId,
            seeding_id: seeding.id,
            assigned_date: format(new Date(), "yyyy-MM-dd")
          });
        } catch (error) {
          console.error(`Error adding plot association for plot ${plotId}:`, error);
        }
      }

      toast({ title: "הצלחה", description: "המזרע עודכן בהצלחה." });
      onSuccess();
    } catch (error) {
      console.error("Failed to update seeding:", error);
      toast({ title: "שגיאה", description: "עדכון המזרע נכשל.", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const handleVarietiesChange = (newVarieties) => {
    setSeedingVarieties(Array.isArray(newVarieties) ? newVarieties : []);
  };

  if (!isOpen) return null; // Render nothing if the dialog is not open

  const safeAllPlots = Array.isArray(allPlots) ? allPlots : [];
  const safeAssociatedPlotIds = Array.isArray(associatedPlotIds) ? associatedPlotIds : [];

  const availablePlotsForSelection = safeAllPlots.filter(
    p => p && (!p.activity_status || p.activity_status === 'active' || safeAssociatedPlotIds.includes(p.id))
  );

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-6xl max-h-[90vh]" dir="rtl">
        <DialogHeader>
          <DialogTitle>עריכת מזרע</DialogTitle>
          <DialogDescription>עדכון פרטי המזרע, החלקות המשויכות והזנים</DialogDescription>
        </DialogHeader>
        
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="details">פרטי המזרע</TabsTrigger>
            <TabsTrigger value="plots">חלקות</TabsTrigger>
            <TabsTrigger value="varieties">זנים</TabsTrigger>
          </TabsList>
          
          <form onSubmit={handleSubmit}>
            <ScrollArea className="max-h-[60vh] mt-4">
              <TabsContent value="details" className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="name">שם המזרע</Label>
                    <Input
                      id="name"
                      value={formData.name}
                      onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                      required
                    />
                  </div>
                  <div>
                    <Label htmlFor="name_en">שם לועזי</Label>
                    <Input
                      id="name_en"
                      value={formData.name_en}
                      onChange={(e) => setFormData(prev => ({ ...prev, name_en: e.target.value }))}
                      required
                      placeholder="English name"
                    />
                  </div>
                  <div>
                    <Label htmlFor="crop_type">סוג גידול</Label>
                    <Select 
                      value={formData.crop_type} 
                      onValueChange={(value) => setFormData(prev => ({ ...prev, crop_type: value }))}
                    >
                      <SelectTrigger id="crop_type">
                        <SelectValue placeholder="בחר סוג גידול..." />
                      </SelectTrigger>
                      <SelectContent>
                        {Array.isArray(crops) ? crops.map(crop => crop && (
                          <SelectItem key={crop.id} value={crop.name}>
                            {crop.name}
                          </SelectItem>
                        )) : null}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="start_date">תאריך הזמנה</Label>
                    <Input
                      id="start_date"
                      type="date"
                      value={formData.start_date}
                      onChange={(e) => setFormData(prev => ({ ...prev, start_date: e.target.value }))}
                    />
                  </div>
                  <div>
                    <Label htmlFor="planting_date">תאריך שתילה</Label>
                    <Input
                      id="planting_date"
                      type="date"
                      value={formData.planting_date}
                      onChange={(e) => setFormData(prev => ({ ...prev, planting_date: e.target.value }))}
                    />
                    <p className="text-xs text-gray-500 mt-1">מתעדכן אוטומטית מפעילות "שתילה"</p>
                  </div>
                  <div>
                    <Label>קטיף ראשון</Label>
                    <Input
                      type="date"
                      value={seeding?.first_harvest_date ? format(new Date(seeding.first_harvest_date), "yyyy-MM-dd") : ""}
                      readOnly
                      disabled
                      className="bg-gray-100"
                    />
                    <p className="text-xs text-gray-500 mt-1">מתעדכן אוטומטית מהקטיף הראשון</p>
                  </div>
                  <div>
                    <Label>סיום (עקירה)</Label>
                    <Input
                      type="date"
                      value={seeding?.end_date ? format(new Date(seeding.end_date), "yyyy-MM-dd") : ""}
                      readOnly
                      disabled
                      className="bg-gray-100"
                    />
                    <p className="text-xs text-gray-500 mt-1">מתעדכן אוטומטית מפעילות "עקירה"</p>
                  </div>
                  <div>
                    <Label htmlFor="estimated_end_date">תאריך סיום משוער</Label>
                    <Input
                      id="estimated_end_date"
                      type="date"
                      value={formData.estimated_end_date}
                      onChange={(e) => setFormData(prev => ({ ...prev, estimated_end_date: e.target.value }))}
                    />
                  </div>
                  <div>
                    <Label htmlFor="days_from_planting_to_harvest">ימים משתילה לקטיף ראשון</Label>
                    <Input
                      id="days_from_planting_to_harvest"
                      type="number"
                      value={formData.days_from_planting_to_harvest}
                      onChange={(e) => setFormData(prev => ({ ...prev, days_from_planting_to_harvest: e.target.value }))}
                    />
                  </div>
                  <div className="md:col-span-2">
                    <Label htmlFor="notes">הערות</Label>
                    <Input
                      id="notes"
                      value={formData.notes}
                      onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
                      placeholder="הערות נוספות..."
                    />
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="plots" className="space-y-4">
                <div>
                  <h4 className="font-semibold text-lg mb-4">בחירת חלקות</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {availablePlotsForSelection.map(plot => plot && (
                      <div key={plot.id} className="border rounded-lg p-4">
                        <label className="flex items-center space-x-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={safeAssociatedPlotIds.includes(plot.id)}
                            onChange={() => handlePlotToggle(plot.id)}
                            className="ml-2"
                          />
                          <div>
                            <div className="font-medium">{plot.name}</div>
                            <div className="text-sm text-gray-500">{plot.size} דונם - {plot.structure_type}</div>
                          </div>
                        </label>
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 p-4 bg-gray-50 rounded-lg">
                    <p className="font-semibold">סה״כ שטח נבחר: {(formData.total_area || 0).toFixed(1)} דונם</p>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="varieties" className="space-y-4">
                <SeedingVarietiesManager
                  seeding={seeding}
                  cropType={formData.crop_type}
                  currentVarieties={seedingVarieties}
                  onVarietiesChange={handleVarietiesChange}
                />
              </TabsContent>
            </ScrollArea>

            <DialogFooter className="pt-6 border-t mt-4 px-4">
              <Button type="button" variant="outline" onClick={onClose} disabled={isLoading}>
                ביטול
              </Button>
              <Button type="submit" disabled={isLoading}>
                {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "שמור שינויים"}
              </Button>
            </DialogFooter>
          </form>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}