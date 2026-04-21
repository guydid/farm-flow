
import React, { useState, useEffect, useCallback } from "react"; // Added useCallback
import { Plot, User, Farm, Seeding, PlasticSheet } from "@/entities/all";
import { UploadFile } from "@/integrations/Core";
import { useToast } from "@/components/ui/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Edit2, Upload, FileText, Loader2, ListChecks, SlidersHorizontal, ChevronDown, ChevronUp } from "lucide-react";
import SheetTracker from "../components/plots/SheetTracker";
import { format } from 'date-fns';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export default function Plots() {
  const [plots, setPlots] = useState([]);
  const [seedings, setSeedings] = useState([]);
  const [sheets, setSheets] = useState([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingPlot, setEditingPlot] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const { toast } = useToast();
  const [isSheetTrackerOpen, setIsSheetTrackerOpen] = useState(false);
  const [selectedPlotForSheets, setSelectedPlotForSheets] = useState(null);
  const [currentFarm, setCurrentFarm] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('all');
  const [filtersOpen, setFiltersOpen] = useState(false);

  const initialFormData = {
    name: "",
    structure_type: "",
    size: "",
    ownership_status: "owned",
    activity_status: "active",
    inactivity_reason: "",
    lease_start_date: "",
    lease_end_date: "",
    lease_agreement_url: ""
  };
  const [formData, setFormData] = useState(initialFormData);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const user = await User.me();
      if (!user.current_farm_id) {
        setPlots([]);
        setSeedings([]);
        setCurrentFarm(null);
        setIsLoading(false);
        return;
      }
      const farm = await Farm.get(user.current_farm_id);
      setCurrentFarm(farm);
      const farmFilter = { farm_id: user.current_farm_id };
      
      const [plotsData, seedingsData] = await Promise.all([
        Plot.filter(farmFilter).catch(() => []),
        Seeding.filter({ ...farmFilter, status: 'growing' }).catch(() => [])
      ]);
      
      setPlots(Array.isArray(plotsData) ? plotsData : []);
      setSeedings(Array.isArray(seedingsData) ? seedingsData : []);
      setSheets([]); // Reset sheets array as it's no longer fetched here.
    } catch (error) {
      console.error("Failed to load plots data:", error);
      setPlots([]);
      setSeedings([]);
      setCurrentFarm(null);
      setSheets([]); // Ensure sheets are also cleared on error
    }
    setIsLoading(false);
  }, []); // Empty dependency array means this function is stable

  useEffect(() => {
    loadData();
  }, [loadData]); // Depend on loadData

  const handleDelete = async (plotId) => {
    if (!window.confirm("האם אתה בטוח שברצונך למחוק חלקה זו?")) return;
    
    const safePlots = Array.isArray(plots) ? plots : [];
    const plotToDelete = safePlots.find(p => p && p.id === plotId);

    if (plotToDelete && Array.isArray(plotToDelete.current_seedings) && plotToDelete.current_seedings.length > 0) {
      toast({
        title: "לא ניתן למחוק",
        description: "לא ניתן למחוק חלקה עם זריעות פעילות. יש להפסיק את הזריעות הפעילות לפני המחיקה.",
        variant: "destructive",
      });
      return;
    }

    try {
      await Plot.delete(plotId);
      toast({ title: "הצלחה", description: "החלקה נמחקה בהצלחה." });
      loadData();
    } catch (error) {
      console.error("Failed to delete plot:", error);
      toast({ title: "שגיאה", description: "מחיקת החלקה נכשלה.", variant: "destructive" });
    }
  };

  const handleEdit = (plot) => {
    setEditingPlot(plot);
    setFormData({
      name: plot.name,
      structure_type: plot.structure_type,
      size: plot.size,
      ownership_status: plot.ownership_status,
      activity_status: plot.activity_status || "active",
      inactivity_reason: plot.inactivity_reason || "",
      lease_start_date: plot.lease_start_date || "",
      lease_end_date: plot.lease_end_date || "",
      lease_agreement_url: plot.lease_agreement_url || ""
    });
    setIsDialogOpen(true);
  };

  const handleOpenSheetTracker = (plotId) => {
    const plot = (Array.isArray(plots) ? plots : []).find(p => p && p.id === plotId);
    if (plot) {
      setSelectedPlotForSheets(plot);
      setIsSheetTrackerOpen(true);
    }
  };

  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setIsUploading(true);
    try {
      const { file_url } = await UploadFile({ file });
      setFormData({ ...formData, lease_agreement_url: file_url });
      toast({ title: "הצלחה", description: "הקובץ הועלה בהצלחה." });
    } catch (error) {
      console.error("Upload failed", error);
      toast({ title: "שגיאה", description: "העלאת הקובץ נכשלה.", variant: "destructive" });
    } finally {
      setIsUploading(false);
    }
  };

  const resetForm = () => {
    setEditingPlot(null);
    setFormData(initialFormData);
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!currentFarm) {
      toast({ title: "שגיאה", description: "לא נבחר משק פעיל.", variant: "destructive"});
      return;
    }
    const dataToSend = {
      ...formData,
      farm_id: currentFarm.id,
      size: parseFloat(formData.size),
      status_updated_date: (editingPlot && editingPlot.activity_status === formData.activity_status) ? editingPlot.status_updated_date : format(new Date(), 'yyyy-MM-dd') 
    };

    if (formData.activity_status !== 'inactive' && formData.activity_status !== 'resting') {
        dataToSend.inactivity_reason = "";
    }
    
    try {
      if (editingPlot) {
        await Plot.update(editingPlot.id, dataToSend);
        toast({ title: "הצלחה", description: "החלקה עודכנה בהצלחה." });
      } else {
        await Plot.create(dataToSend);
        toast({ title: "הצלחה", description: "החלקה נוצרה בהצלחה." });
      }
      setIsDialogOpen(false);
      resetForm();
      loadData();
    } catch (error) {
      console.error("Failed to save plot:", error);
      toast({ title: "שגיאה", description: "שמירת החלקה נכשלה.", variant: "destructive" });
    }
  };

  const handleStatusChange = async (plotId, newStatus) => {
    try {
      const plotToUpdate = (Array.isArray(plots) ? plots : []).find(p => p && p.id === plotId);
      if (!plotToUpdate) {
        console.warn(`Plot with ID ${plotId} not found for status update.`);
        return;
      }
      
      const updateData = { 
        activity_status: newStatus,
        status_updated_date: format(new Date(), 'yyyy-MM-dd'),
        inactivity_reason: plotToUpdate.inactivity_reason // Preserve existing reason by default
      };

      if (newStatus === 'inactive' && !plotToUpdate.inactivity_reason) {
        const reason = prompt("אנא הזן סיבה לאי-פעילות החלקה:");
        if (reason !== null) { // User clicked OK or entered text
          updateData.inactivity_reason = reason;
        } else { // User clicked Cancel
          return; // Abort status change if reason not provided on prompt
        }
      } else if (newStatus === 'active' || newStatus === 'resting') {
        updateData.inactivity_reason = ""; // Clear reason if becoming active or resting
      }
      
      await Plot.update(plotId, updateData);
      toast({ 
        title: "סטטוס עודכן", 
        description: `החלקה ${activityStatusTranslations[newStatus]} כעת.` 
      });
      loadData();
    } catch (error) {
      console.error("Failed to update status:", error);
      toast({ title: "שגיאה", description: "עדכון הסטטוס נכשל.", variant: "destructive" });
    }
  };

  const structureTypeTranslations = {
    greenhouse: "חממה",
    net_house: "בית רשת",
    tunnel: "מנהרות",
    open_field: "שטח פתוח",
    orchard: "מטע"
  };

  const ownershipStatusTranslations = {
    owned: "בבעלות",
    leased: "בשכירות"
  };

  const activityStatusTranslations = {
    active: "פעילה",
    inactive: "לא פעילה",
    resting: "במנוחה"
  };

  const getActivityStatusColor = (status) => ({
    active: "bg-green-100 text-green-800",
    inactive: "bg-red-100 text-red-800", 
    resting: "bg-yellow-100 text-yellow-800"
  }[status] || "bg-gray-100 text-gray-800");

  const getPlotStats = (plotId) => {
    const safeSheets = Array.isArray(sheets) ? sheets : [];
    const plotSheets = safeSheets.filter(s => s.plot_id === plotId);
    const needsReplacement = plotSheets.filter(s => s.status === 'needs_replacement').length;
    return {
      sheetCount: plotSheets.length,
      needsReplacement,
    };
  };

  const getActiveSeedings = (plotId) => {
    const safeSeedings = Array.isArray(seedings) ? seedings : [];
    const safePlots = Array.isArray(plots) ? plots : [];
    const plot = safePlots.find(p => p.id === plotId);
    if (!plot || !Array.isArray(plot.current_seedings)) {
      return [];
    }
    return plot.current_seedings
      .map(cs => safeSeedings.find(s => s.id === cs.seeding_id))
      .filter(Boolean);
  };

  const PlotCard = ({ plot }) => {
    const stats = getPlotStats(plot.id);
    const activeSeedings = getActiveSeedings(plot.id);
    const displayActivityStatus = plot.activity_status || 'active';

    return (
      <Card className="flex flex-col hover:shadow-lg transition-shadow duration-300">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>{plot.name}</CardTitle>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={() => handleEdit(plot)}>
              <Edit2 className="w-4 h-4" />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon">
                  <Plus className="w-4 h-4 rotate-45" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem 
                  onClick={() => handleDelete(plot.id)}
                  className="text-red-600 focus:text-red-600 focus:bg-red-50"
                >
                  מחק חלקה
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </CardHeader>
        <CardContent className="space-y-2 flex-grow">
          <div className="flex justify-between">
            <span className="text-sm text-gray-500">סוג מבנה:</span>
            <span className="font-medium">{structureTypeTranslations[plot.structure_type] || plot.structure_type}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-sm text-gray-500">שטח:</span>
            <span className="font-medium">{plot.size} דונם</span>
          </div>
          <div className="flex justify-between">
            <span className="text-sm text-gray-500">בעלות:</span>
            <Badge variant={plot.ownership_status === 'owned' ? 'secondary' : 'outline'}>
              {ownershipStatusTranslations[plot.ownership_status] || plot.ownership_status}
            </Badge>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-500">סטטוס:</span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Badge 
                  className={`cursor-pointer ${getActivityStatusColor(displayActivityStatus)}`}
                >
                  {activityStatusTranslations[displayActivityStatus]}
                </Badge>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onClick={() => handleStatusChange(plot.id, 'active')}>
                  פעילה
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleStatusChange(plot.id, 'inactive')}>
                  לא פעילה
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleStatusChange(plot.id, 'resting')}>
                  במנוחה
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {plot.status_updated_date && (
            <div className="flex justify-between">
              <span className="text-sm text-gray-500">עדכון אחרון:</span>
              <span className="text-sm">{format(new Date(plot.status_updated_date), 'dd/MM/yyyy')}</span>
            </div>
          )}
          {plot.inactivity_reason && (
            <div className="text-sm text-gray-600 bg-gray-50 p-2 rounded">
              <span className="font-medium">סיבה: </span>{plot.inactivity_reason}
            </div>
          )}
          {plot.ownership_status === 'leased' && plot.lease_agreement_url && (
            <div className="pt-2">
              <a href={plot.lease_agreement_url} target="_blank" rel="noopener noreferrer">
                <Button variant="link" className="p-0 h-auto">
                  <FileText className="w-4 h-4 ml-1" />
                  צפה בהסכם
                </Button>
              </a>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-sm text-gray-500">יריעות:</span>
            <span className="font-medium">{stats.sheetCount}</span>
          </div>
          {stats.needsReplacement > 0 && (
            <div className="flex justify-between">
              <span className="text-sm text-gray-500">דורשות החלפה:</span>
              <span className="font-medium text-red-500">{stats.needsReplacement}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-sm text-gray-500">זריעות פעילות:</span>
            <div className="flex flex-wrap gap-1">
              {activeSeedings.length > 0 ? (
                activeSeedings.map(s => (
                  <Badge key={s.id} variant="secondary">{s.name}</Badge>
                ))
              ) : (
                <span className="text-gray-500">אין</span>
              )}
            </div>
          </div>
        </CardContent>
        <div className="p-4 pt-0">
          <Button variant="outline" className="w-full" onClick={() => handleOpenSheetTracker(plot.id)}>
            <ListChecks className="w-4 h-4 ml-2" />
            מעקב יריעות
          </Button>
        </div>
      </Card>
    );
  };
  
  const filteredPlots = (Array.isArray(plots) ? plots : []).filter(plot => {
    if (filterStatus === 'all') return true;
    const currentActivityStatus = plot?.activity_status || 'active'; // Safely access activity_status with optional chaining
    return currentActivityStatus === filterStatus;
  });

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="max-w-screen-xl mx-auto">
        <div className="relative z-10 mb-4">
          {/* Title + Add button row */}
          <div className="flex justify-between items-center mb-3">
            <h1 className="text-2xl font-bold">
              חלקות
              {currentFarm && <span className="text-lg text-gray-500 font-normal ml-4"> - {currentFarm.name}</span>}
            </h1>
            <div className="flex gap-2 items-center">
              {/* Mobile filter toggle */}
              <button
                onClick={() => setFiltersOpen(o => !o)}
                className="sm:hidden flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-100 border border-gray-200 text-sm font-medium text-gray-700"
              >
                <SlidersHorizontal className="w-4 h-4 text-gray-500" />
                {filterStatus !== 'all' && <span className="text-blue-600 text-xs">{filterStatus === 'active' ? 'פעילות' : filterStatus === 'inactive' ? 'לא פעילות' : 'במנוחה'}</span>}
                {filtersOpen ? <ChevronUp className="w-3.5 h-3.5 text-gray-500" /> : <ChevronDown className="w-3.5 h-3.5 text-gray-500" />}
              </button>
              {/* Desktop filter buttons */}
              <div className="hidden sm:flex bg-gray-100 p-1 rounded-lg">
                <Button variant={filterStatus === 'all' ? 'secondary' : 'ghost'} size="sm" onClick={() => setFilterStatus('all')} className="rounded-md">הכל</Button>
                <Button variant={filterStatus === 'active' ? 'secondary' : 'ghost'} size="sm" onClick={() => setFilterStatus('active')} className="rounded-md">פעילות</Button>
                <Button variant={filterStatus === 'inactive' ? 'secondary' : 'ghost'} size="sm" onClick={() => setFilterStatus('inactive')} className="rounded-md">לא פעילות</Button>
                <Button variant={filterStatus === 'resting' ? 'secondary' : 'ghost'} size="sm" onClick={() => setFilterStatus('resting')} className="rounded-md">במנוחה</Button>
              </div>
              <Button onClick={() => { resetForm(); setIsDialogOpen(true); }}>
                <Plus className="w-4 h-4 ml-2" /> הוסף חלקה
              </Button>
            </div>
          </div>
          {/* Mobile expanded filter panel */}
          {filtersOpen && (
            <div className="sm:hidden p-2 rounded-xl bg-white border border-gray-200 mb-3">
              <div className="flex bg-gray-100 p-1 rounded-lg">
                <Button variant={filterStatus === 'all' ? 'secondary' : 'ghost'} size="sm" onClick={() => { setFilterStatus('all'); setFiltersOpen(false); }} className="rounded-md flex-1">הכל</Button>
                <Button variant={filterStatus === 'active' ? 'secondary' : 'ghost'} size="sm" onClick={() => { setFilterStatus('active'); setFiltersOpen(false); }} className="rounded-md flex-1">פעילות</Button>
                <Button variant={filterStatus === 'inactive' ? 'secondary' : 'ghost'} size="sm" onClick={() => { setFilterStatus('inactive'); setFiltersOpen(false); }} className="rounded-md flex-1">לא פעילות</Button>
                <Button variant={filterStatus === 'resting' ? 'secondary' : 'ghost'} size="sm" onClick={() => { setFilterStatus('resting'); setFiltersOpen(false); }} className="rounded-md flex-1">במנוחה</Button>
              </div>
            </div>
          )}
        </div>

        {isLoading ? (
          <div className="flex justify-center items-center h-64">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {filteredPlots.map((plot) => (
              <PlotCard key={plot.id} plot={plot} />
            ))}
          </div>
        )}

        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent dir="rtl">
            <DialogHeader>
              <DialogTitle>{editingPlot ? "ערוך חלקה" : "הוסף חלקה חדשה"}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit}>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label htmlFor="name">שם החלקה</Label>
                  <Input id="name" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} required />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="structure_type">סוג מבנה</Label>
                    <Select value={formData.structure_type} onValueChange={(v) => setFormData({ ...formData, structure_type: v })} required>
                      <SelectTrigger><SelectValue placeholder="בחר סוג" /></SelectTrigger>
                      <SelectContent>
                        {Object.entries(structureTypeTranslations).map(([key, value]) => (
                          <SelectItem key={key} value={key}>{value}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="size">שטח (דונם)</Label>
                    <Input id="size" type="number" value={formData.size} onChange={(e) => setFormData({ ...formData, size: e.target.value })} required />
                  </div>
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="ownership_status">סטטוס בעלות</Label>
                    <Select value={formData.ownership_status} onValueChange={(v) => setFormData({ ...formData, ownership_status: v })} required>
                      <SelectTrigger><SelectValue/></SelectTrigger>
                      <SelectContent>
                        {Object.entries(ownershipStatusTranslations).map(([key, value]) => (
                          <SelectItem key={key} value={key}>{value}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="activity_status">סטטוס פעילות</Label>
                    <Select value={formData.activity_status} onValueChange={(v) => setFormData({ ...formData, activity_status: v })} required>
                      <SelectTrigger><SelectValue/></SelectTrigger>
                      <SelectContent>
                        {Object.entries(activityStatusTranslations).map(([key, value]) => (
                          <SelectItem key={key} value={key}>{value}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                
                {(formData.activity_status === 'inactive' || formData.activity_status === 'resting') && (
                  <div className="grid gap-2">
                    <Label htmlFor="inactivity_reason">סיבת אי פעילות</Label>
                    <Input 
                      id="inactivity_reason" 
                      placeholder="למשל: טיפול באדמה, מנוחה עונתית, תיקונים..."
                      value={formData.inactivity_reason} 
                      onChange={(e) => setFormData({ ...formData, inactivity_reason: e.target.value })} 
                    />
                  </div>
                )}

                {formData.ownership_status === 'leased' && (
                  <div className="p-4 border rounded-md space-y-4">
                    <h4 className="font-medium text-center">פרטי שכירות</h4>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="grid gap-2">
                        <Label>תחילת שכירות</Label>
                        <Input type="date" value={formData.lease_start_date} onChange={e => setFormData({...formData, lease_start_date: e.target.value})}/>
                      </div>
                      <div className="grid gap-2">
                        <Label>סיום שכירות</Label>
                        <Input type="date" value={formData.lease_end_date} onChange={e => setFormData({...formData, lease_end_date: e.target.value})}/>
                      </div>
                    </div>
                    <div className="grid gap-2">
                      <Label>הסכם שכירות</Label>
                      <Input id="lease_agreement" type="file" onChange={handleFileChange} className="hidden" />
                      <Label htmlFor="lease_agreement" className="w-full">
                        <Button as="div" variant="outline" className="w-full cursor-pointer">
                          {isUploading ? <Loader2 className="w-4 h-4 ml-2 animate-spin"/> : <Upload className="w-4 h-4 ml-2" />}
                          {isUploading ? "מעלה קובץ..." : (formData.lease_agreement_url ? "החלף קובץ" : "העלה קובץ")}
                        </Button>
                      </Label>
                      {formData.lease_agreement_url &&
                        <a href={formData.lease_agreement_url} target="_blank" rel="noopener noreferrer">
                          <Button variant="link" size="sm" className="p-0 h-auto">
                            <FileText className="w-4 h-4 ml-1" />
                            הצג קובץ שהועלה
                          </Button>
                        </a>
                      }
                    </div>
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>ביטול</Button>
                <Button type="submit">{editingPlot ? "עדכן" : "צור"}</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        {selectedPlotForSheets && (
          <SheetTracker
            isOpen={isSheetTrackerOpen}
            onClose={() => setIsSheetTrackerOpen(false)}
            plot={selectedPlotForSheets}
          />
        )}
      </div>
    </div>
  );
}
