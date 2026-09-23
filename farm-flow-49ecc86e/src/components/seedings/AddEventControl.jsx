
import React, { useState, useEffect, useCallback } from 'react';
import { Button } from "@/components/ui/button";
import { Plus, Tractor, Droplets, Leaf, X, Loader2, ExternalLink } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import { Activity, Harvest, Spraying, ActivityType, PlotSeeding, Plot } from "@/entities/all";
import PesticideSelector from "./PesticideSelector";
import { format } from "date-fns";
import SprayingForm from "./SprayingForm";
import { packagingsForSeeding } from "@/lib/seedingFilters";
import { useNavigate } from "react-router-dom";

export default function AddEventControl({ seeding, pesticides, onSuccess, onClose, varieties, packagings, products, initialState }) {
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [eventType, setEventType] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();
  const [activityTypes, setActivityTypes] = useState([]);
  const [plots, setPlots] = useState([]);
  const [selectedPlot, setSelectedPlot] = useState('');

  const [formData, setFormData] = useState({
    id: null,
    date: format(new Date(), 'yyyy-MM-dd'),
    // activity
    activity_type: '',
    area_covered: '',
    cost_per_unit: '',
    total_cost: '',
    performed_by: '',
    // harvest
    quantity: '',
    quality: 'א',
    variety: '',
    price_per_unit: '',
    packaging: '',
    package_count: '',
    // spraying
    treatment_type: 'mechanized',
    treatment_time: 'morning',
    applied_pesticides: [],
    // common
    notes: '',
  });

  const loadDependencies = useCallback(async () => {
    try {
      const [types, plotSeedingsData] = await Promise.all([
        ActivityType.list(),
        PlotSeeding.filter({ seeding_id: seeding.id })
      ]);
      setActivityTypes(Array.isArray(types) ? types : []);

      if (Array.isArray(plotSeedingsData) && plotSeedingsData.length > 0) {
        const plotIds = plotSeedingsData.map(ps => ps.plot_id);
        const associatedPlots = await Plot.filter({ id: { $in: plotIds } });
        setPlots(Array.isArray(associatedPlots) ? associatedPlots : []);
      }
    } catch (error) {
      console.error("Error loading dependencies", error);
      toast({ title: "שגיאה", description: "כשל בטעינת נתונים.", variant: "destructive" });
    }
  }, [seeding.id, toast]);

  useEffect(() => {
    loadDependencies();
  }, [loadDependencies]);

  // Filter varieties to only show those associated with the seeding
  const seedingVarieties = React.useMemo(() => {
    if (!seeding?.varieties || !Array.isArray(seeding.varieties)) return [];
    
    const safeVarieties = Array.isArray(varieties) ? varieties : [];
    
    return seeding.varieties
      .map(sv => {
        const variety = safeVarieties.find(v => v && v.id === sv.variety_id);
        return variety ? { ...variety, seedling_quantity: sv.seedling_quantity } : null;
      })
      .filter(Boolean); // Remove nulls
  }, [seeding, varieties]);

  // אריזות רלוונטיות למזרע (לפי מוצרים של סוג הגידול); בעריכה שומרים את הערך הנוכחי
  const relevantPackagings = React.useMemo(
    () => packagingsForSeeding(seeding, packagings, products, { keepName: formData.packaging }),
    [seeding, packagings, products, formData.packaging]
  );

  // Set default variety to the one with most seedlings
  useEffect(() => {
    // Only set default for new harvest forms (not editing)
    if (eventType === 'harvest' && !formData.id && seedingVarieties.length > 0 && !formData.variety) {
      const defaultVariety = seedingVarieties.reduce((max, current) => {
        const maxQuantity = max.seedling_quantity || 0;
        const currentQuantity = current.seedling_quantity || 0;
        return currentQuantity > maxQuantity ? current : max;
      });
      
      if (defaultVariety) {
        setFormData(prev => ({ ...prev, variety: defaultVariety.id }));
      }
    }
  }, [eventType, seedingVarieties, formData.id, formData.variety]);

  // Auto-calculate total cost for activity
  useEffect(() => {
    if (eventType === 'activity' && formData.activity_type) {
      const selectedType = activityTypes.find(t => t.name === formData.activity_type);
      if (selectedType) {
        if (selectedType.unit === 'per_dunam' && formData.area_covered) {
          const area = parseFloat(formData.area_covered);
          if (!isNaN(area) && selectedType.price_per_dunam) {
            const total = area * selectedType.price_per_dunam;
            setFormData(prev => ({ ...prev, total_cost: total.toFixed(2), cost_per_unit: selectedType.price_per_dunam }));
          } else {
             setFormData(prev => ({ ...prev, total_cost: '', cost_per_unit: '' }));
          }
        } else if (selectedType.unit === 'fixed_amount') {
          setFormData(prev => ({ ...prev, total_cost: selectedType.price_per_dunam ? selectedType.price_per_dunam.toFixed(2) : '0', cost_per_unit: '' }));
        } else {
            setFormData(prev => ({ ...prev, total_cost: '', cost_per_unit: '' }));
        }
      } else {
         setFormData(prev => ({ ...prev, total_cost: '', cost_per_unit: '' }));
      }
    }
  }, [formData.activity_type, formData.area_covered, eventType, activityTypes]);
  
  useEffect(() => {
    // Auto-calculate weight for harvest
    if (eventType === 'harvest' && formData.package_count && formData.packaging) {
      const selectedPackaging = (Array.isArray(packagings) ? packagings : []).find(p => p.name === formData.packaging);
      if (selectedPackaging && typeof selectedPackaging.expected_weight === 'number') {
        const calculatedWeight = parseFloat(formData.package_count) * selectedPackaging.expected_weight;
        setFormData(prev => ({ ...prev, quantity: calculatedWeight.toFixed(2), weight: calculatedWeight.toFixed(2) }));
      } else {
        setFormData(prev => ({ ...prev, quantity: '', weight: '' }));
      }
    } else if (eventType === 'harvest' && (!formData.package_count || !formData.packaging)) {
        setFormData(prev => ({ ...prev, quantity: '', weight: '' }));
    }
  }, [formData.package_count, formData.packaging, packagings, eventType]);


  const resetForm = useCallback(() => {
    setFormData({
      id: null,
      date: format(new Date(), 'yyyy-MM-dd'),
      activity_type: '',
      area_covered: '',
      cost_per_unit: '',
      total_cost: '',
      performed_by: '',
      quantity: '',
      quality: 'א',
      variety: '',
      price_per_unit: '',
      packaging: '',
      package_count: '',
      treatment_type: 'mechanized',
      treatment_time: 'morning',
      applied_pesticides: [],
      notes: '',
    });
    setSelectedPlot('');
  }, []);

  const handleOpen = useCallback((type) => {
    resetForm();
    setEventType(type);
    setIsOpen(true);
  }, [resetForm]);

  const isEditing = !!formData.id;

  useEffect(() => {
    if (initialState?.open && activityTypes.length > 0) {
      setEventType(initialState.type);
      setFormData({
        id: initialState.item?.id || null,
        date: initialState.item?.date ? format(new Date(initialState.item.date), 'yyyy-MM-dd') : format(new Date(), 'yyyy-MM-dd'),
        activity_type: initialState.item?.activity_type || '',
        area_covered: initialState.item?.area_covered || '',
        cost_per_unit: initialState.item?.cost_per_unit || '',
        total_cost: initialState.item?.total_cost || '',
        performed_by: initialState.item?.performed_by || '',
        quantity: initialState.item?.quantity || '',
        weight: initialState.item?.weight || '',
        quality: initialState.item?.quality || 'א',
        variety: initialState.item?.variety ? varieties.find(v => v.name === initialState.item.variety)?.id || '' : '',
        price_per_unit: initialState.item?.price_per_unit || '',
        packaging: initialState.item?.packaging || '',
        package_count: initialState.item?.package_count || '',
        treatment_type: initialState.item?.treatment_type || 'mechanized',
        treatment_time: initialState.item?.treatment_time || 'morning',
        applied_pesticides: initialState.item?.applied_pesticides || [],
        notes: initialState.item?.notes || '',
      });
      setSelectedPlot(initialState.item?.plot_id || '');
      setIsOpen(true);
    }
  }, [initialState, activityTypes, varieties]);
  
  const handleClose = () => {
    setIsOpen(false);
    setEventType(null);
    if (onClose) onClose();
  }

  const handleSubmit = async (e) => {
    // Only handle activity and harvest here
    // Spraying is handled by SprayingForm
    if (eventType === 'spraying') return;
    
    e.preventDefault();
    setIsLoading(true);
    
    let promise;

    try {
      switch (eventType) {
        case 'activity': {
          const selectedType = activityTypes.find(t => t.name === formData.activity_type);
          const data = {
            seeding_id: seeding.id,
            plot_id: selectedPlot || null,
            date: formData.date,
            activity_type: formData.activity_type,
            area_covered: parseFloat(formData.area_covered) || 0,
            cost_per_unit: selectedType?.unit === 'per_dunam' && parseFloat(formData.area_covered) > 0
                          ? (parseFloat(formData.total_cost) / parseFloat(formData.area_covered)) || 0
                          : 0,
            total_cost: parseFloat(formData.total_cost) || 0,
            performed_by: formData.performed_by || '',
            notes: formData.notes
          };
          promise = isEditing ? Activity.update(formData.id, data) : Activity.create(data);
          break;
        }
        case 'harvest': {
          const selectedVariety = varieties.find(v => v.id === formData.variety);
          const data = {
            seeding_id: seeding.id,
            plot_id: selectedPlot || null,
            date: formData.date,
            quantity: parseFloat(formData.quantity) || 0,
            weight: parseFloat(formData.weight) || parseFloat(formData.quantity) || 0,
            quality: formData.quality,
            variety: selectedVariety?.name || '',
            price_per_unit: parseFloat(formData.price_per_unit) || 0,
            packaging: formData.packaging,
            package_count: parseInt(formData.package_count) || 0,
            notes: formData.notes
          };
          promise = isEditing ? Harvest.update(formData.id, data) : Harvest.create(data);
          break;
        }
        // spraying case is removed from here, handled by handleSprayingSubmit
        default:
          throw new Error("Invalid event type");
      }

      await promise;
      toast({ title: "הצלחה", description: `הפעולה ${isEditing ? 'עודכנה' : 'נוספה'} בהצלחה.` });
      handleClose();
      if (onSuccess) onSuccess();
    } catch (error) {
      console.error("Failed to save event:", error);
      toast({ title: "שגיאה", description: "שמירת הפעולה נכשלה.", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSprayingSubmit = async (sprayingData) => {
    setIsLoading(true);
    try {
      const data = {
        farm_id: seeding.farm_id,
        seeding_id: seeding.id,
        // plot_id, date, treatment_type, etc. are expected to be in sprayingData
        ...sprayingData
      };
      
      const promise = sprayingData.id ? Spraying.update(sprayingData.id, data) : Spraying.create(data);
      await promise;
      
      toast({ title: "הצלחה", description: `ההדברה ${sprayingData.id ? 'עודכן' : 'נוסף'} בהצלחה.` });
      handleClose();
      if (onSuccess) onSuccess();
    } catch (error) {
      console.error("Failed to save spraying:", error);
      toast({ title: "שגיאה", description: "שמירת ההדברה נכשלה.", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const renderFormFields = () => {
    switch(eventType) {
      case 'activity':
        return (
          <>
            <div>
              <Label htmlFor="activity_type">סוג פעילות</Label>
              <Select
                value={formData.activity_type}
                onValueChange={value => {
                  const selectedType = activityTypes.find(t => t.name === value);
                  setFormData(prev => ({
                    ...prev,
                    activity_type: value,
                    total_cost: selectedType?.unit === 'fixed_amount' && selectedType.price_per_dunam
                      ? selectedType.price_per_dunam.toFixed(2)
                      : (selectedType?.unit === 'per_dunam' && prev.area_covered && selectedType.price_per_dunam
                         ? (parseFloat(prev.area_covered) * selectedType.price_per_dunam).toFixed(2)
                         : prev.total_cost)
                  }));
                }}
              >
                <SelectTrigger id="activity_type"><SelectValue placeholder="בחר סוג פעילות..." /></SelectTrigger>
                <SelectContent>
                  {activityTypes.map(type => (
                    <SelectItem key={type.id} value={type.name}>
                      {type.name}
                      {type.unit === 'per_dunam' && type.price_per_dunam > 0 && ` (₪${type.price_per_dunam}/דונם)`}
                      {type.unit === 'fixed_amount' && type.price_per_dunam > 0 && ` (₪${type.price_per_dunam} קבוע)`}
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
                  onChange={e => setFormData(prev => ({...prev, area_covered: e.target.value}))}
                  placeholder="שטח"
                />
              </div>
              <div>
                <Label htmlFor="total_cost">עלות כוללת (₪)</Label>
                <Input
                  id="total_cost"
                  type="number"
                  step="0.01"
                  value={formData.total_cost}
                  onChange={e => setFormData(prev => ({...prev, total_cost: e.target.value}))}
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
        );
      case 'harvest':
        return (
          <>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="package_count">כמות אריזות</Label>
                <Input id="package_count" type="number" value={formData.package_count} onChange={e => setFormData(prev => ({...prev, package_count: e.target.value}))} />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <Label htmlFor="packaging">אריזה</Label>
                  {relevantPackagings.length === 0 && (
                    <button type="button" onClick={() => navigate('/settings?tab=packaging')} className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1">
                      הגדר אריזות <ExternalLink className="w-3 h-3" />
                    </button>
                  )}
                </div>
                {relevantPackagings.length === 0 ? (
                  <div className="p-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-700 flex items-center justify-between">
                    <span>אין אריזות מתאימות לגידול {seeding?.crop_type || ''}</span>
                    <button type="button" onClick={() => navigate('/settings?tab=packaging')} className="underline font-medium">הגדר כאן</button>
                  </div>
                ) : (
                  <Select value={formData.packaging} onValueChange={value => setFormData(prev => ({...prev, packaging: value}))}>
                    <SelectTrigger id="packaging"><SelectValue placeholder="בחר אריזה..."/></SelectTrigger>
                    <SelectContent>
                      {relevantPackagings.map(p => p && (
                        <SelectItem key={p.id} value={p.name}>
                          {p.name}{p.expected_weight && ` (${p.expected_weight} ק"ג)`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
               <div>
                <Label htmlFor="weight">משקל נטו (ק"ג)</Label>
                <Input id="weight" type="number" step="0.01" value={formData.weight} onChange={e => setFormData(prev => ({...prev, weight: e.target.value, quantity: e.target.value}))} required className={formData.packaging ? "bg-gray-100" : ""} readOnly={!!formData.packaging} />
              </div>
              <div>
                <Label htmlFor="quality">איכות</Label>
                <Select value={formData.quality} onValueChange={value => setFormData(prev => ({...prev, quality: value}))}>
                  <SelectTrigger id="quality"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="א">א'</SelectItem>
                    <SelectItem value="ב">ב'</SelectItem>
                    <SelectItem value="ג">ג'</SelectItem>
                    <SelectItem value="תעשייתי">תעשייתי</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
                <Label htmlFor="variety">זן</Label>
                <Select value={formData.variety} onValueChange={v => setFormData(prev => ({...prev, variety: v}))}>
                    <SelectTrigger id="variety"><SelectValue placeholder="בחר זן..." /></SelectTrigger>
                    <SelectContent>
                        {seedingVarieties.length === 0 ? (
                          <div className="px-2 py-4 text-center text-sm text-gray-500">
                            לא שויכו זנים למזרע זה
                          </div>
                        ) : (
                          seedingVarieties.map(v => v && (
                            <SelectItem key={v.id} value={v.id}>
                              {v.name}
                              {v.marketing_company && ` (${v.marketing_company})`}
                            </SelectItem>
                          ))
                        )}
                    </SelectContent>
                </Select>
                {seedingVarieties.length === 0 && (
                  <p className="text-xs text-gray-500 mt-1">
                    💡 ניתן להוסיף זנים למזרע בעריכת המזרע
                  </p>
                )}
            </div>
            <div>
              <Label htmlFor="price_per_unit">מחיר ליחידה (₪)</Label>
              <Input id="price_per_unit" type="number" step="0.01" value={formData.price_per_unit} onChange={e => setFormData(prev => ({...prev, price_per_unit: e.target.value}))} />
            </div>
          </>
        );
      case 'spraying':
        return (
          <SprayingForm
            seeding={seeding}
            pesticides={pesticides}
            plots={plots}
            initialData={isEditing ? {
              id: formData.id,
              date: formData.date,
              plot_id: selectedPlot,
              treatment_type: formData.treatment_type,
              treatment_time: formData.treatment_time,
              applied_pesticides: formData.applied_pesticides,
              notes: formData.notes
            } : null}
            onSubmit={handleSprayingSubmit}
            onCancel={handleClose}
          />
        );
        
      default:
        return null;
    }
  }

  const dialogTitle = {
    activity: "פעילות", harvest: "קטיף", spraying: "הדברה"
  }[eventType];

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button><Plus className="w-4 h-4 ml-2" />הוסף אירוע</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={() => handleOpen('activity')}><Tractor className="w-4 h-4 ml-2" />פעילות</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => handleOpen('harvest')}><Leaf className="w-4 h-4 ml-2" />קטיף</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => handleOpen('spraying')}><Droplets className="w-4 h-4 ml-2" />הדברה</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={isOpen} onOpenChange={(open) => { if (!open) handleClose(); }}>
        <DialogContent dir="rtl" className={eventType === 'spraying' ? "sm:max-w-4xl max-h-[90vh] overflow-y-auto" : "sm:max-w-md"}>
          <DialogHeader>
            <DialogTitle>{isEditing ? 'עריכת' : 'הוספת'} {dialogTitle}</DialogTitle>
          </DialogHeader>
          
          {eventType === 'spraying' ? (
            renderFormFields()
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                  <div>
                      <Label htmlFor="event-date">תאריך</Label>
                      <Input id="event-date" type="date" value={formData.date} onChange={e => setFormData(prev => ({...prev, date: e.target.value}))} required />
                  </div>
                  {plots.length > 0 && (
                    <div>
                      <Label htmlFor="plot">חלקה (אופציונלי)</Label>
                      <Select value={selectedPlot || '__none__'} onValueChange={value => setSelectedPlot(value === '__none__' ? '' : value)}>
                        <SelectTrigger id="plot"><SelectValue placeholder="בחר חלקה..."/></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">כללי</SelectItem>
                          {plots.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
              </div>
              
              {renderFormFields()}
              
              <div>
                <Label htmlFor="event-notes">הערות</Label>
                <Textarea
                  id="event-notes"
                  value={formData.notes}
                  onChange={e => setFormData(prev => ({...prev, notes: e.target.value}))}
                  placeholder="הערות נוספות..."
                  className="h-20"
                />
              </div>
              
              <DialogFooter>
                <DialogClose asChild>
                  <Button type="button" variant="outline" onClick={handleClose}>ביטול</Button>
                </DialogClose>
                <Button type="submit" disabled={isLoading}>
                  {isLoading ? <Loader2 className="w-4 h-4 animate-spin ml-2" /> : null}
                  {isEditing ? 'עדכן' : 'שמור'}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
