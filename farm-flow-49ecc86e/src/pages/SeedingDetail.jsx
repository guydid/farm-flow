
import React, { useState, useEffect, useMemo, useCallback } from "react";
import { Link } from "react-router-dom";
import { Seeding, Plot, Activity, Harvest, Spraying, Pesticide, PlotSeeding, Variety, Packaging } from "@/entities/all";
import { batchFetch } from "@/api/localClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useToast } from "@/components/ui/use-toast";
import { format, parseISO } from "date-fns";
import { he } from "date-fns/locale";
import { ArrowRight, Loader2, Calendar, Droplets, Tractor, MapPin, TrendingUp, Activity as ActivityIcon, Edit, Plus, ExternalLink, Archive, Trash2, MoreVertical, Leaf } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"; // NEW IMPORT

import SeedingSummary from "../components/seedings/SeedingSummary";
import EditSeedingForm from "../components/seedings/EditSeedingForm";
import MarketPricesPanel from "../components/seedings/MarketPricesPanel";
import SeedingTimeline from "../components/seedings/SeedingTimeline";
import EventItem from "../components/seedings/EventItem";
import { createPageUrl } from "@/utils";
import AddEventControl from "../components/seedings/AddEventControl";
import CumulativeHarvestChart from "../components/seedings/CumulativeHarvestChart"; // Import new component
import HarvestQuantityWeightChart from "../components/seedings/HarvestQuantityWeightChart";

const safeArray = (arr) => (Array.isArray(arr) ? arr : []);
const safeFind = (arr, predicate) => {
  const safeArr = Array.isArray(arr) ? arr : [];
  return safeArr.find(predicate);
};

export default function SeedingDetail() {
  const [seeding, setSeeding] = useState(null);
  const [plots, setPlots] = useState([]);
  const [activities, setActivities] = useState([]);
  const [harvests, setHarvests] = useState([]);
  const [sprayings, setSprayings] = useState([]);
  const [pesticides, setPesticides] = useState([]);
  const [varieties, setVarieties] = useState([]);
  const [packagings, setPackagings] = useState([]);
  const [products, setProducts] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isEditFormOpen, setIsEditFormOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState(null); // { type, data }
  const [plotSeedings, setPlotSeedings] = useState([]);
  const { toast } = useToast();
  const [activeEventsTab, setActiveEventsTab] = useState("all"); // NEW STATE

  const seedingId = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("id");
  }, []);

  const loadData = useCallback(async () => {
    if (!seedingId) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      // בקשת רשת אחת במקום תשע (כל סבב דרך Cloudflare עולה ~0.4 שנ')
      const [seedingData, plotSeedingsData, allPlots, activitiesData, harvestsData, sprayingsData, pesticidesData, varietiesData, packagingsData, productsData] = await batchFetch([
        { entity: 'seedings', id: seedingId },
        { entity: 'plot_seedings', filter: { seeding_id: seedingId } },
        { entity: 'plots' },
        { entity: 'activities', filter: { seeding_id: seedingId } },
        { entity: 'harvests', filter: { seeding_id: seedingId } },
        { entity: 'sprayings', filter: { seeding_id: seedingId } },
        { entity: 'pesticides' },
        { entity: 'varieties' },
        { entity: 'packaging' },
        { entity: 'products' },
      ]);
      
      setSeeding(seedingData || null);
      
      const safePlotSeedings = Array.isArray(plotSeedingsData) ? plotSeedingsData : [];
      setPlotSeedings(safePlotSeedings);
      
      const safeAllPlots = Array.isArray(allPlots) ? allPlots : [];
      const associatedPlots = safeAllPlots.filter(p => 
        p && safePlotSeedings.some(ps => ps && ps.plot_id === p.id)
      );
      setPlots(associatedPlots);

      setActivities(Array.isArray(activitiesData) ? activitiesData : []);
      setHarvests(Array.isArray(harvestsData) ? harvestsData : []);
      setSprayings(Array.isArray(sprayingsData) ? sprayingsData : []);
      setPesticides(Array.isArray(pesticidesData) ? pesticidesData : []);
      setVarieties(Array.isArray(varietiesData) ? varietiesData : []);
      setPackagings(Array.isArray(packagingsData) ? packagingsData : []);
      setProducts(Array.isArray(productsData) ? productsData : []);
    } catch (error) {
      console.error("Error loading seeding details:", error);
      toast({ title: "שגיאה", description: "טעינת נתוני המזרע נכשלה.", variant: "destructive" });
    }
    setIsLoading(false);
  }, [seedingId, toast]);
  
  useEffect(() => {
    loadData();
  }, [loadData]);

  // הבר התחתון (BottomNav) משדר seeding-detail-action — פותחים את טופס האירוע המתאים
  useEffect(() => {
    const handler = (e) => {
      if (['activity', 'harvest', 'spraying'].includes(e.detail)) {
        setEditingEvent({ type: e.detail, data: null });
      }
    };
    window.addEventListener('seeding-detail-action', handler);
    return () => window.removeEventListener('seeding-detail-action', handler);
  }, []);

  const { lastHarvest, lastSpraying, totalHarvests, totalSprayings, profit } = useMemo(() => {
    const safeHarvests = Array.isArray(harvests) ? harvests : [];
    const safeSprayings = Array.isArray(sprayings) ? sprayings : [];
    const safeActivities = Array.isArray(activities) ? activities : [];

    const sortedHarvests = [...safeHarvests].sort((a, b) => {
      try {
        return new Date(b.date) - new Date(a.date);
      } catch {
        return 0;
      }
    });
    
    const sortedSprayings = [...safeSprayings].sort((a, b) => {
      try {
        return new Date(b.date) - new Date(a.date);
      } catch {
        return 0;
      }
    });
    
    const revenue = safeHarvests.reduce((sum, h) => {
      const price = typeof h?.price_per_unit === 'number' ? h.price_per_unit : 0;
      const quantity = typeof h?.quantity === 'number' ? h.quantity : 0;
      return sum + (price * quantity);
    }, 0);
    
    const costs = safeActivities.reduce((sum, a) => {
      const cost = typeof a?.total_cost === 'number' ? a.total_cost : 0;
      return sum + cost;
    }, 0);

    return {
      lastHarvest: sortedHarvests[0] || null,
      lastSpraying: sortedSprayings[0] || null,
      totalHarvests: safeHarvests.length,
      totalSprayings: safeSprayings.length,
      profit: revenue - costs
    };
  }, [harvests, sprayings, activities]);

  const allEvents = useMemo(() => {
    const safeActivities = Array.isArray(activities) ? activities : [];
    const safeHarvests = Array.isArray(harvests) ? harvests : [];
    const safeSprayings = Array.isArray(sprayings) ? sprayings : [];
    
    const combined = [
      ...safeActivities.map(item => item ? ({ ...item, type: 'activity', date: item.date }) : null).filter(Boolean),
      ...safeHarvests.map(item => item ? ({ ...item, type: 'harvest', date: item.date }) : null).filter(Boolean),
      ...safeSprayings.map(item => item ? ({ ...item, type: 'spraying', date: item.date }) : null).filter(Boolean),
    ];
    
    return combined.sort((a, b) => {
      try {
        return new Date(b.date) - new Date(a.date);
      } catch {
        return 0;
      }
    });
  }, [activities, harvests, sprayings]);

  // Filter events by type for tabs
  const activitiesOnly = useMemo(() => {
    return Array.isArray(activities) 
      ? activities.map(item => item ? ({ ...item, type: 'activity' }) : null).filter(Boolean).sort((a, b) => new Date(b.date) - new Date(a.date)) 
      : [];
  }, [activities]);

  const sprayingsOnly = useMemo(() => {
    return Array.isArray(sprayings) 
      ? sprayings.map(item => item ? ({ ...item, type: 'spraying' }) : null).filter(Boolean).sort((a, b) => new Date(b.date) - new Date(a.date)) 
      : [];
  }, [sprayings]);

  const harvestsOnly = useMemo(() => {
    return Array.isArray(harvests) 
      ? harvests.map(item => item ? ({ ...item, type: 'harvest' }) : null).filter(Boolean).sort((a, b) => new Date(b.date) - new Date(a.date)) 
      : [];
  }, [harvests]);

  const handleStatusChange = async (newStatus) => {
    if (!seeding) return;
    try {
        await Seeding.update(seeding.id, { status: newStatus });
        toast({ title: "סטטוס עודכן", description: `סטטוס המזרע שונה ל: ${translateStatus(newStatus)}` });
        loadData();
    } catch (error) {
        console.error("Failed to update status:", error);
        toast({ title: "שגיאה", description: "עדכון הסטטוס נכשל.", variant: "destructive" });
    }
  };

  const handleArchiveSeeding = async () => {
    if (!seeding) return;
    
    if (!window.confirm(`האם אתה בטוח שברצונך לסיים ולהעביר לארכיון את המזרע "${seeding.name}"?`)) {
      return;
    }

    try {
      await Seeding.update(seeding.id, { status: "archived" });
      toast({ 
        title: "המזרע הועבר לארכיון", 
        description: "המזרע הועבר בהצלחה לארכיון" 
      });
      
      // Navigate back to seedings page
      window.location.href = createPageUrl("Seedings") + "?filter=archived";
    } catch (error) {
      console.error("Failed to archive seeding:", error);
      toast({ 
        title: "שגיאה", 
        description: "העברה לארכיון נכשלה.", 
        variant: "destructive" 
      });
    }
  };

  const handleDeleteSeeding = async () => {
    if (!seeding) return;
    
    const confirmMessage = `האם אתה בטוח לחלוטין שברצונך למחוק את המזרע "${seeding.name}"?\n\nמחיקה תמחק גם:\n- את כל הקטיפים (${totalHarvests})\n- את כל ההדברות (${totalSprayings})\n- את כל הפעילויות\n\nפעולה זו אינה ניתנת לביטול!`;
    
    if (!window.confirm(confirmMessage)) {
      return;
    }

    // Second confirmation
    const finalConfirm = window.prompt(
      `כדי לאשר את המחיקה, הקלד את שם המזרע: "${seeding.name}"`
    );

    if (finalConfirm !== seeding.name) {
      toast({ 
        title: "מחיקה בוטלה", 
        description: "השם שהוקלד אינו תואם." 
      });
      return;
    }

    try {
      // Delete all related records first
      const deletePromises = [];
      
      // Delete harvests
      if (Array.isArray(harvests)) {
        harvests.forEach(h => {
          deletePromises.push(Harvest.delete(h.id).catch(err => console.warn('Failed to delete harvest:', err)));
        });
      }
      
      // Delete sprayings
      if (Array.isArray(sprayings)) {
        sprayings.forEach(s => {
          deletePromises.push(Spraying.delete(s.id).catch(err => console.warn('Failed to delete spraying:', err)));
        });
      }
      
      // Delete activities
      if (Array.isArray(activities)) {
        activities.forEach(a => {
          deletePromises.push(Activity.delete(a.id).catch(err => console.warn('Failed to delete activity:', err)));
        });
      }

      // Wait for all deletions
      await Promise.all(deletePromises);

      // Finally delete the seeding itself
      await Seeding.delete(seeding.id);
      
      toast({ 
        title: "המזרע נמחק", 
        description: "המזרע ומידע קשור נמחקו בהצלחה" 
      });
      
      // Navigate back to seedings page
      window.location.href = createPageUrl("Seedings");
    } catch (error) {
      console.error("Failed to delete seeding:", error);
      toast({ 
        title: "שגיאה במחיקה", 
        description: "מחיקת המזרע נכשלה: " + (error.message || "שגיאה לא ידועה"), 
        variant: "destructive" 
      });
    }
  };

  const handleEditEvent = (event) => {
    setEditingEvent({ type: event.type, data: event });
  };
  
  const handleDeleteEvent = async (event) => {
    const { type, id } = event;
    if (!window.confirm("האם אתה בטוח שברצונך למחוק אירוע זה?")) return;

    try {
        let promise;
        if (type === 'activity') promise = Activity.delete(id);
        else if (type === 'harvest') promise = Harvest.delete(id);
        else if (type === 'spraying') promise = Spraying.delete(id);
        
        if (promise) {
            await promise;
            toast({ title: "הצלחה", description: "האירוע נמחק." });
            loadData();
        }
    } catch(error) {
        console.error(`Failed to delete ${type}:`, error);
        toast({ title: "שגיאה", description: "מחיקת האירוע נכשלה.", variant: "destructive" });
    }
  };
  
  const handleCloseDialog = () => {
    setEditingEvent(null);
    loadData();
  }

  const translateStatus = (status) => ({
    planning: "בתכנון", active: "פעיל", completed: "הסתיים", growing: "גידול", harvesting: "קטיף", uprooted: "עקירה", preparation: "הכנה", archived: "בארכיון", ordered: "הוזמן"
  }[status] || status);

  const getStatusColor = (status) => ({
    planning: "bg-blue-100 text-blue-800", active: "bg-green-100 text-green-800", completed: "bg-gray-100 text-gray-800", growing: "bg-green-100 text-green-800", harvesting: "bg-yellow-100 text-yellow-800", uprooted: "bg-gray-100 text-gray-800", preparation: "bg-purple-100 text-purple-800", archived: "bg-slate-100 text-slate-800", ordered: "bg-indigo-100 text-indigo-800"
  }[status] || "bg-gray-100 text-gray-800");

  const ALL_STATUSES = ['ordered', 'preparation', 'growing', 'harvesting', 'uprooted', 'archived'];

  const handleDuplicateEvent = (event) => {
    // Create a copy without the id and with today's date
    const duplicatedData = {
      ...event,
      id: null, // Remove ID so it creates a new record
      date: format(new Date(), 'yyyy-MM-dd'), // Set to today
    };
    
    setEditingEvent({ type: event.type, data: duplicatedData });
  };
  
  if (isLoading) return <div className="flex justify-center items-center h-screen"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  if (!seeding) return <div className="p-6 text-center">לא נמצא מזרע.</div>;

  return (
    <>
      <div className="p-3 sm:p-6 lg:p-8 bg-gray-50 min-h-screen">
        <div className="max-w-7xl mx-auto space-y-4 lg:space-y-6">
          {/* Back button */}
          <Link to={createPageUrl("Seedings")} className="inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900">
            <ArrowRight className="h-4 w-4" />
            <span className="hidden sm:inline">חזרה לכל המזרעים</span>
            <span className="sm:hidden">חזרה</span>
          </Link>

          <Card className="overflow-hidden">
            <CardHeader className="bg-gradient-to-r from-white to-gray-50 px-4 py-3 lg:px-6 lg:py-4">
              <div className="flex flex-col lg:flex-row justify-between items-start gap-4 lg:gap-6">
                <div className="flex-1 w-full">
                  {/* Mobile: compact header row */}
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="secondary" className={`${getStatusColor(seeding.status)} h-7 px-2 text-xs font-semibold hover:opacity-80 flex-shrink-0`}>
                            {translateStatus(seeding.status)}
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          {ALL_STATUSES.map(statusValue => (
                            <DropdownMenuItem key={statusValue} onSelect={() => handleStatusChange(statusValue)}>
                              {translateStatus(statusValue)}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                      <h1 className="text-xl lg:text-3xl font-bold truncate">{seeding.name}</h1>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <MarketPricesPanel cropName={seeding.crop_type} />
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setIsEditFormOpen(true)} title="ערוך מזרע">
                        <Edit className="w-4 h-4" />
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8" title="אפשרויות נוספות">
                            <MoreVertical className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {seeding.status !== 'archived' && (
                            <DropdownMenuItem onClick={handleArchiveSeeding} className="flex items-center gap-2">
                              <Archive className="w-4 h-4" />
                              סיים והעבר לארכיון
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem onClick={handleDeleteSeeding} className="flex items-center gap-2 text-red-600 focus:text-red-600 focus:bg-red-50">
                            <Trash2 className="w-4 h-4" />
                            מחק מזרע לצמיתות
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                  <div className="text-xs text-gray-500 mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3.5 h-3.5"/>
                      הזמנה: {seeding.start_date ? format(new Date(seeding.start_date), "dd/MM/yyyy") : '-'}
                    </span>
                    <span className="flex items-center gap-1 text-green-700">
                      <Leaf className="w-3.5 h-3.5"/>
                      שתילה: {seeding.planting_date ? format(new Date(seeding.planting_date), "dd/MM/yyyy") : '-'}
                    </span>
                    <span className="flex items-center gap-1 text-amber-700">
                      <Calendar className="w-3.5 h-3.5"/>
                      קטיף ראשון: {seeding.first_harvest_date ? format(new Date(seeding.first_harvest_date), "dd/MM/yyyy") : '-'}
                    </span>
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3.5 h-3.5"/>
                      {seeding.end_date
                        ? `עקירה: ${format(new Date(seeding.end_date), "dd/MM/yyyy")}`
                        : `סיום משוער: ${seeding.estimated_end_date ? format(new Date(seeding.estimated_end_date), "dd/MM/yyyy") : '-'}`}
                    </span>
                  </div>
                  <div className="mb-3">
                    <div className="flex flex-wrap gap-1.5">
                      {safeArray(plots).map(p => p && (
                        <Link key={p.id} to={createPageUrl("Plots")} className="group">
                          <Badge variant="outline" className="text-xs hover:bg-gray-100 cursor-pointer flex items-center gap-1 py-0.5">
                            <MapPin className="w-3 h-3" />
                            {p.name} ({p.size} ד')
                          </Badge>
                        </Link>
                      ))}
                      {safeArray(plots).length === 0 && <span className="text-xs text-gray-400">אין חלקות</span>}
                    </div>
                  </div>
                </div>

                <div className="w-full lg:w-[400px]">
                  <CumulativeHarvestChart harvests={harvests} seeding={seeding} />
                </div>
              </div>
            </CardHeader>
          </Card>

          <SeedingSummary activities={activities} harvests={harvests} />
          
          <Card className="hidden sm:block">
            <CardHeader>
              <CardTitle>ציר זמן פעילות</CardTitle>
            </CardHeader>
            <CardContent>
              <SeedingTimeline activities={activities} harvests={harvests} sprayings={sprayings} seeding={seeding} />
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="pb-2">
              <CardTitle>אירועים</CardTitle>
            </CardHeader>
            <CardContent>
                <Tabs value={activeEventsTab} onValueChange={setActiveEventsTab} className="w-full">
                {/* Tab triggers — styled like mobile action buttons */}
                <div className="flex justify-between items-start mb-4 gap-3">
                  <TabsList className="grid grid-cols-4 gap-2 h-auto bg-transparent p-0 flex-1">
                    {/* הכל */}
                    <TabsTrigger
                      value="all"
                      className="group flex flex-col items-center justify-center gap-1 py-2 sm:py-3 rounded-xl border-2 border-gray-200 bg-gray-50 h-auto
                                 data-[state=active]:border-gray-500 data-[state=active]:bg-gray-100 data-[state=active]:shadow-sm
                                 transition-all active:scale-95"
                    >
                      <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-gray-300 group-data-[state=active]:bg-gray-600 flex items-center justify-center transition-colors">
                        <ActivityIcon className="w-5 h-5 text-white" />
                      </div>
                      <span className="text-xs font-semibold text-gray-600 group-data-[state=active]:text-gray-900">הכל</span>
                      <span className="text-[10px] text-gray-400 group-data-[state=active]:text-gray-600">{allEvents.length}</span>
                    </TabsTrigger>

                    {/* פעילויות */}
                    <TabsTrigger
                      value="activities"
                      className="group flex flex-col items-center justify-center gap-1 py-2 sm:py-3 rounded-xl border-2 border-blue-200 bg-blue-50 h-auto
                                 data-[state=active]:border-blue-500 data-[state=active]:bg-blue-100 data-[state=active]:shadow-sm
                                 transition-all active:scale-95"
                    >
                      <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-blue-400 group-data-[state=active]:bg-blue-600 flex items-center justify-center transition-colors">
                        <Tractor className="w-5 h-5 text-white" />
                      </div>
                      <span className="text-xs font-semibold text-blue-600 group-data-[state=active]:text-blue-900">פעילויות</span>
                      <span className="text-[10px] text-blue-400 group-data-[state=active]:text-blue-600">{activitiesOnly.length}</span>
                    </TabsTrigger>

                    {/* הדברות */}
                    <TabsTrigger
                      value="sprayings"
                      className="group flex flex-col items-center justify-center gap-1 py-2 sm:py-3 rounded-xl border-2 border-orange-200 bg-orange-50 h-auto
                                 data-[state=active]:border-orange-500 data-[state=active]:bg-orange-100 data-[state=active]:shadow-sm
                                 transition-all active:scale-95"
                    >
                      <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-orange-400 group-data-[state=active]:bg-orange-600 flex items-center justify-center transition-colors">
                        <Droplets className="w-5 h-5 text-white" />
                      </div>
                      <span className="text-xs font-semibold text-orange-600 group-data-[state=active]:text-orange-900">הדברות</span>
                      <span className="text-[10px] text-orange-400 group-data-[state=active]:text-orange-600">{sprayingsOnly.length}</span>
                    </TabsTrigger>

                    {/* קטיפים */}
                    <TabsTrigger
                      value="harvests"
                      className="group flex flex-col items-center justify-center gap-1 py-2 sm:py-3 rounded-xl border-2 border-green-200 bg-green-50 h-auto
                                 data-[state=active]:border-green-500 data-[state=active]:bg-green-100 data-[state=active]:shadow-sm
                                 transition-all active:scale-95"
                    >
                      <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-green-400 group-data-[state=active]:bg-green-600 flex items-center justify-center transition-colors">
                        <Leaf className="w-5 h-5 text-white" />
                      </div>
                      <span className="text-xs font-semibold text-green-600 group-data-[state=active]:text-green-900">קטיפים</span>
                      <span className="text-[10px] text-green-400 group-data-[state=active]:text-green-600">{harvestsOnly.length}</span>
                    </TabsTrigger>
                  </TabsList>

                  {/* Add button */}
                  <div className="flex-shrink-0 pt-1">
                    {activeEventsTab === 'all' && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="sm" className="flex items-center gap-2">
                            <Plus className="w-4 h-4" />
                            <span className="hidden sm:inline">הוסף אירוע</span>
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setEditingEvent({ type: 'activity', data: null })} className="flex items-center gap-2">
                            <Tractor className="w-4 h-4" /> פעילות
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setEditingEvent({ type: 'spraying', data: null })} className="flex items-center gap-2">
                            <Droplets className="w-4 h-4" /> הדברה
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setEditingEvent({ type: 'harvest', data: null })} className="flex items-center gap-2">
                            <Leaf className="w-4 h-4" /> קטיף
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                    {activeEventsTab === 'activities' && (
                      <Button variant="outline" size="sm" onClick={() => setEditingEvent({ type: 'activity', data: null })} className="flex items-center gap-2">
                        <Plus className="w-4 h-4" /><span className="hidden sm:inline">הוסף פעילות</span>
                      </Button>
                    )}
                    {activeEventsTab === 'sprayings' && (
                      <Button variant="outline" size="sm" onClick={() => setEditingEvent({ type: 'spraying', data: null })} className="flex items-center gap-2">
                        <Plus className="w-4 h-4" /><span className="hidden sm:inline">הוסף הדברה</span>
                      </Button>
                    )}
                    {activeEventsTab === 'harvests' && (
                      <Button variant="outline" size="sm" onClick={() => setEditingEvent({ type: 'harvest', data: null })} className="flex items-center gap-2">
                        <Plus className="w-4 h-4" /><span className="hidden sm:inline">הוסף קטיף</span>
                      </Button>
                    )}
                  </div>
                </div>

                <TabsContent value="all" className="mt-3">
                  <div className="space-y-2">
                    {allEvents.map(event => (
                      <EventItem 
                        key={`${event.type}-${event.id}`} 
                        event={event} 
                        onEdit={handleEditEvent}
                        onDelete={handleDeleteEvent}
                        onDuplicate={handleDuplicateEvent}
                      />
                    ))}
                    {allEvents.length === 0 && (
                      <div className="text-center py-12 text-gray-500">
                        <p>לא תועדו אירועים עבור מזרע זה.</p>
                      </div>
                    )}
                  </div>
                </TabsContent>

                <TabsContent value="activities" className="mt-3">
                  <div className="space-y-2">
                    {activitiesOnly.map(activity => (
                      <EventItem 
                        key={`activity-${activity.id}`} 
                        event={activity} 
                        onEdit={handleEditEvent}
                        onDelete={handleDeleteEvent}
                        onDuplicate={handleDuplicateEvent}
                      />
                    ))}
                    {activitiesOnly.length === 0 && (
                      <div className="text-center py-12 text-gray-500">
                        <Tractor className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                        <p className="mb-2">לא תועדו פעילויות עבור מזרע זה.</p>
                        <Button 
                          variant="outline" 
                          onClick={() => setEditingEvent({ type: 'activity', data: null })}
                          className="flex items-center gap-2"
                        >
                          <Plus className="w-4 h-4" />
                          הוסף פעילות ראשונה
                        </Button>
                      </div>
                    )}
                  </div>
                </TabsContent>

                <TabsContent value="sprayings" className="mt-3">
                  <div className="space-y-2">
                    {sprayingsOnly.map(spraying => (
                      <EventItem 
                        key={`spraying-${spraying.id}`} 
                        event={spraying} 
                        onEdit={handleEditEvent}
                        onDelete={handleDeleteEvent}
                        onDuplicate={handleDuplicateEvent}
                      />
                    ))}
                    {sprayingsOnly.length === 0 && (
                      <div className="text-center py-12 text-gray-500">
                        <Droplets className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                        <p className="mb-2">לא תועדו הדברות עבור מזרע זה.</p>
                        <Button 
                          variant="outline" 
                          onClick={() => setEditingEvent({ type: 'spraying', data: null })}
                          className="flex items-center gap-2"
                        >
                          <Plus className="w-4 h-4" />
                          הוסף הדברה ראשון
                        </Button>
                      </div>
                    )}
                  </div>
                </TabsContent>

                <TabsContent value="harvests" className="mt-3">
                  <div className="space-y-2">
                    <HarvestQuantityWeightChart harvests={harvests} />
                    {harvestsOnly.map(harvest => (
                      <EventItem 
                        key={`harvest-${harvest.id}`} 
                        event={harvest} 
                        onEdit={handleEditEvent}
                        onDelete={handleDeleteEvent}
                        onDuplicate={handleDuplicateEvent}
                      />
                    ))}
                    {harvestsOnly.length === 0 && (
                      <div className="text-center py-12 text-gray-500">
                        <Leaf className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                        <p className="mb-2">לא תועדו קטיפים עבור מזרע זה.</p>
                        <Button 
                          variant="outline" 
                          onClick={() => setEditingEvent({ type: 'harvest', data: null })}
                          className="flex items-center gap-2"
                        >
                          <Plus className="w-4 h-4" />
                          הוסף קטיף ראשון
                        </Button>
                      </div>
                    )}
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>
      </div>
      
      <EditSeedingForm
        seeding={seeding}
        isOpen={isEditFormOpen}
        onClose={() => setIsEditFormOpen(false)}
        onSuccess={() => { setIsEditFormOpen(false); loadData(); }}
        availableVarieties={varieties}
      />
      
      {editingEvent && (
        <AddEventControl
            seeding={seeding}
            pesticides={pesticides}
            onSuccess={handleCloseDialog}
            onClose={handleCloseDialog}
            varieties={varieties}
            packagings={packagings}
            products={products}
            initialState={{ open: true, type: editingEvent.type, item: editingEvent.data }}
        />
      )}
    </>
  );
}
