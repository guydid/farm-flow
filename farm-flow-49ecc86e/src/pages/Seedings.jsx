
import React, { useState, useEffect, useCallback } from "react";
import { Seeding, Plot, Variety, Pesticide, User, Farm, Packaging } from "@/entities/all";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { format, addDays } from "date-fns";
import { Plus, ArrowLeft, Calendar, MapPin, Leaf, Archive, RotateCcw, TrendingUp, SlidersHorizontal, ChevronDown, ChevronUp } from "lucide-react";
import CreateSeedingForm from "../components/seedings/CreateSeedingForm";
import QuickActions from "../components/seedings/QuickActions";
import { useToast } from "@/components/ui/use-toast";
import SeedingsReports from "../components/seedings/SeedingsReports";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { getCropIcon } from "../components/seedings/CropIcons";
import { getMeCached, getFarmCached, peekList, primeList } from "@/api/cachedReads";
import { batchFetch } from "@/api/localClient";

// Safe array utilities
const safeArray = (value, fallback = []) => {
  if (value === null || value === undefined) return fallback;
  if (Array.isArray(value)) return value;
  console.warn('safeArray: received non-array value:', typeof value, value);
  return fallback;
};

const safeMap = (array, callback, fallback = []) => {
  const safe = safeArray(array, fallback);
  try {
    return safe.map(callback);
  } catch (error) {
    console.error('safeMap error:', error);
    return fallback;
  }
};

const safeFilter = (array, callback, fallback = []) => {
  const safe = safeArray(array, fallback);
  try {
    return safe.filter(callback);
  } catch (error) {
    console.error('safeFilter error:', error);
    return fallback;
  };
};

export default function Seedings() {
  const [seedings, setSeedings] = useState([]);
  const [plots, setPlots] = useState([]);
  const [varieties, setVarieties] = useState([]);
  const [pesticides, setPesticides] = useState([]);
  const [packagings, setPackagings] = useState([]);
  const [products, setProducts] = useState([]);
  const [currentFarm, setCurrentFarm] = useState(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [filterStatus, setFilterStatus] = useState('active');
  const [filterCropType, setFilterCropType] = useState('all');
  const [showReports, setShowReports] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const { toast } = useToast();
  const location = useLocation();
  const navigate = useNavigate();

  // Auto-open create dialog when navigated with ?create=true (e.g. from FAB)
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('create') === 'true') {
      setIsDialogOpen(true);
      // Remove the param from URL without reload
      navigate(location.pathname, { replace: true });
    }
  }, [location.search]);

  const loadData = useCallback(async () => {
    try {
      const user = await getMeCached();
      if (!user.current_farm_id) {
        console.warn('No current farm ID found for user.');
        setSeedings([]);
        setPlots([]);
        setVarieties([]);
        setPesticides([]);
        setPackagings([]);
        setCurrentFarm(null);
        return;
      }

      const farm = await getFarmCached(user.current_farm_id);
      setCurrentFarm(farm);

      const fid = user.current_farm_id;
      const farmFilter = { farm_id: fid };

      // מזרעים תמיד טריים; קטלוגים (חלקות/זנים/חומרי הדברה/אריזות) דרך קאש משותף
      // קטלוגים מהקאש אם טריים; כל השאר בבקשת רשת אחת (batch) — ומזינים חזרה לקאש
      const cached = {
        plots: peekList(`plots_${fid}`, 2 * 60 * 1000),
        varieties: peekList('varieties'),
        pesticides: peekList('pesticides'),
        packagings: peekList(`packaging_${fid}`),
        products: peekList(`products_${fid}`),
      };
      const reqs = [{ key: 'seedings', entity: 'seedings', filter: farmFilter, sort: '-start_date' }];
      if (!cached.plots)      reqs.push({ key: 'plots',      entity: 'plots',      filter: farmFilter });
      if (!cached.varieties)  reqs.push({ key: 'varieties',  entity: 'varieties' });
      if (!cached.pesticides) reqs.push({ key: 'pesticides', entity: 'pesticides' });
      if (!cached.packagings) reqs.push({ key: 'packagings', entity: 'packaging', filter: farmFilter });
      if (!cached.products)   reqs.push({ key: 'products',   entity: 'products',  filter: farmFilter });
      const fetched = await batchFetch(reqs);
      const got = {}; reqs.forEach((r, i) => { got[r.key] = fetched[i]; });
      const seedingsData = got.seedings;
      const plotsData      = cached.plots      ?? got.plots;
      const varietiesData  = cached.varieties  ?? got.varieties;
      const pesticidesData = cached.pesticides ?? got.pesticides;
      const packagingsData = cached.packagings ?? got.packagings;
      const productsData   = cached.products   ?? got.products;
      if (got.plots)      primeList(`plots_${fid}`, got.plots);
      if (got.varieties)  primeList('varieties', got.varieties);
      if (got.pesticides) primeList('pesticides', got.pesticides);
      if (got.packagings) primeList(`packaging_${fid}`, got.packagings);
      if (got.products)   primeList(`products_${fid}`, got.products);
      
      console.log('Seedings loadData results:', { seedingsData, plotsData, varietiesData, pesticidesData, packagingsData });
      
      setSeedings(safeArray(seedingsData));
      setPlots(safeArray(plotsData));
      setVarieties(safeArray(varietiesData));
      setPesticides(safeArray(pesticidesData));
      setPackagings(safeArray(packagingsData));
      setProducts(safeArray(productsData));
    } catch (error) {
      console.error("Error loading seedings data:", error);
      setSeedings([]);
      setPlots([]);
      setVarieties([]);
      setPesticides([]);
      setPackagings([]);
      toast({
        title: "שגיאה בטעינת נתונים",
        description: "אירעה שגיאה בטעינת נתוני המזרעים. נסה שוב מאוחר יותר.",
        variant: "destructive",
      });
    }
  }, [toast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // הבר התחתון (BottomNav) מוחלף בעמוד זה בפעולות מזרעים ומשדר אירוע window
  useEffect(() => {
    const handler = (e) => {
      switch (e.detail) {
        case 'create':
          setShowReports(false);
          setIsDialogOpen(true);
          break;
        case 'filters':
          setShowReports(false);
          setFiltersOpen(o => !o);
          window.scrollTo({ top: 0, behavior: 'smooth' });
          break;
        case 'reports':
          setShowReports(p => !p);
          window.scrollTo({ top: 0, behavior: 'smooth' });
          break;
        case 'archive':
          setShowReports(false);
          setFilterStatus(prev => prev === 'archived' ? 'active' : 'archived');
          window.scrollTo({ top: 0, behavior: 'smooth' });
          break;
        default: break;
      }
    };
    window.addEventListener('seedings-action', handler);
    return () => window.removeEventListener('seedings-action', handler);
  }, []);

  const handleFormSuccess = () => {
    setIsDialogOpen(false);
    loadData();
  }

  const handleArchiveSeeding = async (seedingId) => {
    try {
      await Seeding.update(seedingId, { status: "archived" });
      toast({ title: "הצלחה", description: "המזרע הועבר לארכיון" });
      loadData();
    } catch (error) {
      toast({ title: "שגיאה", description: "העברה לארכיון נכשלה", variant: "destructive" });
    }
  };

  const handleRestoreSeeding = async (seedingId) => {
    try {
      await Seeding.update(seedingId, { status: "growing" });
      toast({ title: "הצלחה", description: "המזרע שוחזר מהארכיון" });
      loadData();
    } catch (error) {
      toast({ title: "שגיאה", description: "שחזור מהארכיון נכשל", variant: "destructive" });
    }
  };

  const translateStatus = (status) => ({
    ordered: "מוזמן",
    growing: "גידול",
    harvesting: "קטיף",
    uprooted: "עקירה",
    preparation: "הכנה",
    archived: "בארכיון"
  }[status] || status);

  const translateCropType = (type) => ({
    cucumber: "מלפפון",
    tomato: "עגבנייה",
    pepper: "פלפל"
  }[type] || type);

  const getStatusColor = (status) => ({
    ordered: "bg-blue-100 text-blue-800",
    growing: "bg-green-100 text-green-800",
    harvesting: "bg-yellow-100 text-yellow-800",
    uprooted: "bg-gray-100 text-gray-800",
    preparation: "bg-purple-100 text-purple-800",
    archived: "bg-slate-100 text-slate-800"
  }[status] || "bg-gray-100 text-gray-800");

  const getVarietiesForSeeding = (seeding) => {
    if (!seeding.varieties || !Array.isArray(seeding.varieties)) return [];
    
    const safeVarieties = safeArray(varieties);
    return safeMap(seeding.varieties, sv => {
      const variety = safeVarieties.find(v => v.id === sv.variety_id);
      return variety ? variety.name : "זן לא זמין";
    }).join(", ");
  };

  const handleFilterChange = (status) => {
    setFilterStatus(status);
    setShowReports(false);
  };

  const uniqueCropTypes = React.useMemo(() => {
    const safeSeedings = safeArray(seedings);
    const cropTypes = [...new Set(safeSeedings.map(s => s.crop_type).filter(Boolean))];
    return cropTypes.sort();
  }, [seedings]);

  const groupedSeedings = React.useMemo(() => {
    console.log('Computing groupedSeedings, seedings:', seedings);
    
    const safeSeedings = safeArray(seedings);
    
    let filtered = [];
    if (filterStatus === 'active') {
      filtered = safeFilter(safeSeedings, s => ['ordered', 'growing', 'harvesting', 'preparation'].includes(s.status));
    } else if (filterStatus === 'completed') {
      filtered = safeFilter(safeSeedings, s => s.status === 'uprooted');
    } else if (filterStatus === 'archived') {
      filtered = safeFilter(safeSeedings, s => s.status === 'archived');
    }

    // Apply crop type filter
    if (filterCropType !== 'all') {
      filtered = safeFilter(filtered, s => s.crop_type === filterCropType);
    }

    if (filterStatus === 'completed') {
      return [{ title: "מזרעים שהושלמו", seedings: filtered, priority: 0, color: "border-r-4 border-gray-500" }];
    }
    
    if (filterStatus === 'archived') {
      return [{ title: "מזרעים בארכיון", seedings: filtered, priority: 0 }];
    }

    // Default: 'active'
    const groups = [
      { 
        title: "בקטיף", 
        seedings: safeFilter(filtered, s => s.status === "harvesting"), 
        priority: 1,
        color: "border-r-4 border-yellow-500"
      },
      { 
        title: "בגידול", 
        seedings: safeFilter(filtered, s => s.status === "growing"), 
        priority: 2,
        color: "border-r-4 border-green-500"
      },
      { 
        title: "בהכנה", 
        seedings: safeFilter(filtered, s => ["ordered", "preparation"].includes(s.status)), 
        priority: 3,
        color: "border-r-4 border-blue-500"
      }
    ].filter(group => group.seedings.length > 0);

    return groups;
  }, [seedings, filterStatus, filterCropType]);

  const titleMap = {
    active: "מזרעים פעילים",
    completed: "מזרעים שהושלמו",
    archived: "ארכיון מזרעים"
  };

  const statusCardStyle = {
    ordered:     { bg: "bg-blue-50   border-blue-100",   icon: "bg-blue-100",   text: "text-blue-800"   },
    growing:     { bg: "bg-green-50  border-green-100",  icon: "bg-green-100",  text: "text-green-800"  },
    harvesting:  { bg: "bg-yellow-50 border-yellow-100", icon: "bg-yellow-100", text: "text-yellow-800" },
    uprooted:    { bg: "bg-gray-50   border-gray-100",   icon: "bg-gray-100",   text: "text-gray-700"   },
    preparation: { bg: "bg-purple-50 border-purple-100", icon: "bg-purple-100", text: "text-purple-800" },
    archived:    { bg: "bg-slate-50  border-slate-100",  icon: "bg-slate-100",  text: "text-slate-700"  },
  };

  const SeedingCard = ({ seeding }) => {
    const style = statusCardStyle[seeding.status] || statusCardStyle.uprooted;
    return (
      <div className={`rounded-2xl border p-3 hover:shadow-md transition-all active:scale-[0.99] ${style.bg}`}>
        {/* Header row */}
        <div className="flex items-start gap-3 mb-2.5">
          <div className={`w-11 h-11 rounded-xl ${style.icon} flex items-center justify-center flex-shrink-0`}>
            {getCropIcon(seeding.crop_type, "w-6 h-6")}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-1 mb-0.5">
              <Link to={createPageUrl(`SeedingDetail?id=${seeding.id}`)} className={`font-semibold text-sm truncate flex-1 ${style.text}`}>
                {seeding.name}
              </Link>
              <div className="flex items-center gap-1 flex-shrink-0">
                <Badge className={`text-xs ${getStatusColor(seeding.status)}`}>
                  {translateStatus(seeding.status)}
                </Badge>
                {filterStatus === 'completed' && (
                  <Button variant="ghost" size="sm" onClick={() => handleArchiveSeeding(seeding.id)} title="העבר לארכיון" className="h-6 w-6 p-0">
                    <Archive className="w-3 h-3" />
                  </Button>
                )}
                {filterStatus === 'archived' && (
                  <Button variant="ghost" size="sm" onClick={() => handleRestoreSeeding(seeding.id)} title="שחזר מארכיון" className="h-6 w-6 p-0">
                    <RotateCcw className="w-3 h-3" />
                  </Button>
                )}
              </div>
            </div>
            <p className="text-xs text-gray-500">{seeding.crop_type}</p>
          </div>
        </div>

        {/* Info */}
        <div className="space-y-1 mb-2.5">
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {seeding.start_date && (
              <div className="flex items-center gap-1.5 text-xs text-gray-600">
                <Calendar className="w-3.5 h-3.5 text-gray-400" />
                הוזמן: {format(new Date(seeding.start_date), 'dd/MM/yyyy')}
              </div>
            )}
            {seeding.planting_date && (
              <div className="flex items-center gap-1.5 text-xs text-gray-600">
                <Leaf className="w-3.5 h-3.5 text-green-500" />
                שתילה: {format(new Date(seeding.planting_date), 'dd/MM/yyyy')}
              </div>
            )}
            {seeding.first_harvest_date ? (
              <div className="flex items-center gap-1.5 text-xs text-gray-600">
                <Calendar className="w-3.5 h-3.5 text-orange-500" />
                קטיף ראשון: {format(new Date(seeding.first_harvest_date), 'dd/MM/yyyy')}
              </div>
            ) : (seeding.planting_date && seeding.days_from_planting_to_harvest ? (
              <div className="flex items-center gap-1.5 text-xs text-gray-600">
                <Calendar className="w-3.5 h-3.5 text-orange-500" />
                קטיף משוער: {format(addDays(new Date(seeding.planting_date), seeding.days_from_planting_to_harvest), 'dd/MM/yyyy')}
              </div>
            ) : null)}
            {seeding.end_date && (
              <div className="flex items-center gap-1.5 text-xs text-gray-600">
                <Calendar className="w-3.5 h-3.5 text-gray-500" />
                עקירה: {format(new Date(seeding.end_date), 'dd/MM/yyyy')}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1.5 text-xs text-gray-600">
            <MapPin className="w-3.5 h-3.5 text-blue-500" />
            שטח: {seeding.total_area} דונם
          </div>
          {getVarietiesForSeeding(seeding) && (
            <div className="text-xs">
              <span className="font-medium text-gray-600">זנים: </span>
              <span className="text-gray-500">{getVarietiesForSeeding(seeding)}</span>
            </div>
          )}
        </div>

        {filterStatus === 'active' && (
          <QuickActions seeding={seeding} varieties={varieties} onRefresh={loadData} pesticides={pesticides} packagings={packagings} products={products} />
        )}

        <div className="pt-2 border-t border-white/60">
          <Link to={createPageUrl(`SeedingDetail?id=${seeding.id}`)}>
            <Button variant="ghost" size="sm" className="w-full h-8 text-xs">
              <ArrowLeft className="w-3.5 h-3.5 ml-1" />
              פרטים
            </Button>
          </Link>
        </div>
      </div>
    );
  };

  return (
    <div className="p-3 lg:p-6">
      <div className="max-w-7xl mx-auto space-y-4">

        {/* ── Header ─────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-2">
          <div>
            <h1 className="text-xl lg:text-2xl font-bold text-gray-900">
              {showReports ? "דוחות מזרעים" : titleMap[filterStatus]}
            </h1>
            {currentFarm && (
              <p className="text-xs text-gray-500 mt-0.5">{currentFarm.name}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowReports(!showReports)}
              className="hidden sm:flex"
            >
              <TrendingUp className="w-4 h-4 ml-1" />
              {showReports ? "חזור" : "דוחות"}
            </Button>
            {/* בנייד ההוספה מהבר התחתון (+) — הכפתור כאן במחשב בלבד */}
            {!showReports && (
              <Button onClick={() => setIsDialogOpen(true)} size="sm" className="hidden sm:inline-flex">
                <Plus className="w-4 h-4 ml-1" />
                הוסף מזרע
              </Button>
            )}
          </div>
        </div>

        {/* ── Filters ─────────────────────────────────────────────────── */}
        {!showReports && (
          <>
            {/* Desktop filters — always visible */}
            <div className="hidden sm:flex gap-2 flex-wrap items-center">
              <div className="flex bg-gray-100 p-0.5 rounded-lg">
                <Button variant={filterStatus === 'active' ? 'secondary' : 'ghost'} size="sm" onClick={() => handleFilterChange('active')} className="rounded-md text-xs h-7 px-2">פעילים</Button>
                <Button variant={filterStatus === 'completed' ? 'secondary' : 'ghost'} size="sm" onClick={() => handleFilterChange('completed')} className="rounded-md text-xs h-7 px-2">הושלמו</Button>
                <Button variant={filterStatus === 'archived' ? 'secondary' : 'ghost'} size="sm" onClick={() => handleFilterChange('archived')} className="rounded-md text-xs h-7 px-2">ארכיון</Button>
              </div>
              {uniqueCropTypes.length > 1 && (
                <Select value={filterCropType} onValueChange={setFilterCropType}>
                  <SelectTrigger className="w-36 h-7 text-xs">
                    <SelectValue placeholder="כל הגידולים" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">כל הגידולים</SelectItem>
                    {uniqueCropTypes.map(cropType => (
                      <SelectItem key={cropType} value={cropType}>
                        <div className="flex items-center gap-2">
                          {getCropIcon(cropType, "w-4 h-4")}
                          {cropType}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Button variant="outline" size="sm" onClick={() => setShowReports(true)}>
                <TrendingUp className="w-3.5 h-3.5 ml-1" />דוחות
              </Button>
            </div>

            {/* Mobile filters — collapsible */}
            <div className="sm:hidden">
              {/* Toggle bar */}
              <button
                onClick={() => setFiltersOpen(o => !o)}
                className="w-full flex items-center justify-between px-3 py-2 rounded-xl bg-gray-100 text-sm font-medium text-gray-700 active:bg-gray-200 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <SlidersHorizontal className="w-4 h-4 text-gray-500" />
                  <span>
                    סינון
                    {filterStatus !== 'active' && (
                      <span className="mr-1 text-blue-600">· {filterStatus === 'completed' ? 'הושלמו' : 'ארכיון'}</span>
                    )}
                    {filterCropType !== 'all' && (
                      <span className="mr-1 text-blue-600">· {filterCropType}</span>
                    )}
                  </span>
                </div>
                {filtersOpen
                  ? <ChevronUp className="w-4 h-4 text-gray-400" />
                  : <ChevronDown className="w-4 h-4 text-gray-400" />
                }
              </button>

              {/* Expanded filters */}
              {filtersOpen && (
                <div className="mt-2 p-3 rounded-xl border bg-white space-y-3">
                  {/* Status filter */}
                  <div>
                    <p className="text-xs text-gray-500 mb-1.5 font-medium">סטטוס</p>
                    <div className="flex bg-gray-100 p-0.5 rounded-lg">
                      <Button variant={filterStatus === 'active' ? 'secondary' : 'ghost'} size="sm" onClick={() => { handleFilterChange('active'); setFiltersOpen(false); }} className="flex-1 rounded-md text-xs h-8">פעילים</Button>
                      <Button variant={filterStatus === 'completed' ? 'secondary' : 'ghost'} size="sm" onClick={() => { handleFilterChange('completed'); setFiltersOpen(false); }} className="flex-1 rounded-md text-xs h-8">הושלמו</Button>
                      <Button variant={filterStatus === 'archived' ? 'secondary' : 'ghost'} size="sm" onClick={() => { handleFilterChange('archived'); setFiltersOpen(false); }} className="flex-1 rounded-md text-xs h-8">ארכיון</Button>
                    </div>
                  </div>

                  {/* Crop type filter */}
                  {uniqueCropTypes.length > 1 && (
                    <div>
                      <p className="text-xs text-gray-500 mb-1.5 font-medium">גידול</p>
                      <Select value={filterCropType} onValueChange={(v) => { setFilterCropType(v); setFiltersOpen(false); }}>
                        <SelectTrigger className="w-full h-9 text-sm">
                          <SelectValue placeholder="כל הגידולים" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">כל הגידולים</SelectItem>
                          {uniqueCropTypes.map(cropType => (
                            <SelectItem key={cropType} value={cropType}>
                              <div className="flex items-center gap-2">
                                {getCropIcon(cropType, "w-4 h-4")}
                                {cropType}
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {/* Reports button */}
                  <Button variant="outline" size="sm" className="w-full" onClick={() => { setShowReports(true); setFiltersOpen(false); }}>
                    <TrendingUp className="w-3.5 h-3.5 ml-1" />דוחות
                  </Button>
                </div>
              )}
            </div>
          </>
        )}

        {showReports && <SeedingsReports />}

        {!showReports && (
          <>
            {safeMap(groupedSeedings, (group, index) => (
              <div key={index} className="space-y-3">
                <div className="flex items-center gap-2">
                  <h3 className="text-base lg:text-xl font-semibold">{group.title}</h3>
                  <Badge variant="secondary" className="text-xs">{group.seedings.length}</Badge>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {safeMap(group.seedings, seeding => (
                    <SeedingCard key={seeding.id} seeding={seeding} />
                  ))}
                </div>
              </div>
            ))}

            {groupedSeedings.length === 0 && (
              <Card>
                <CardContent className="text-center py-12">
                  <div className="text-gray-500">
                    {{
                      'active': "אין מזרעים פעילים במערכת",
                      'completed': "אין מזרעים שהושלמו",
                      'archived': "אין מזרעים בארכיון"
                    }[filterStatus]}
                  </div>
                  {filterStatus === 'active' && !showReports && (
                    <Button onClick={() => setIsDialogOpen(true)} className="mt-4">
                      <Plus className="w-4 h-4 ml-2" />
                      הוסף מזרע ראשון
                    </Button>
                  )}
                </CardContent>
              </Card>
            )}
          </>
        )}

        <CreateSeedingForm
          isOpen={isDialogOpen}
          onClose={() => setIsDialogOpen(false)}
          onSuccess={handleFormSuccess}
          availablePlots={plots}
        />
      </div>
    </div>
  );
}
