import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Vehicle, User, Farm } from '@/entities/all';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectValue, SelectTrigger } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Plus, Truck, Filter, Search, X, AlertTriangle, SlidersHorizontal, ChevronDown, ChevronUp } from 'lucide-react';
import { format, parseISO, differenceInDays } from 'date-fns';
import { useToast } from "@/components/ui/use-toast";

const vehicleTypeTranslations = {
    tractor: "טרקטור",
    private_car: "רכב פרטי",
    truck: "משאית",
    harvester: "קומביין",
    sprayer: "מרסס",
    forklift: "מלגזה",
    other: "אחר"
};

const statusTranslations = {
    active: "פעיל",
    in_service: "בטיפול",
    sold: "נמכר",
    out_of_order: "מושבת"
};

export default function Vehicles() {
    const [vehicles, setVehicles] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [currentFarm, setCurrentFarm] = useState(null);
    const [filterType, setFilterType] = useState("all");
    const [searchText, setSearchText] = useState("");
    const [filtersOpen, setFiltersOpen] = useState(false);
    const { toast } = useToast();

    const loadData = useCallback(async () => {
        setIsLoading(true);
        try {
            const user = await User.me();
            if (!user.current_farm_id) {
                setIsLoading(false);
                return;
            }
            const farm = await Farm.get(user.current_farm_id);
            setCurrentFarm(farm);
            const vehiclesData = await Vehicle.filter({ farm_id: farm.id });
            setVehicles(Array.isArray(vehiclesData) ? vehiclesData : []);
        } catch (error) {
            console.error("Failed to load vehicles:", error);
            toast({ title: "שגיאה בטעינת נתונים", variant: "destructive" });
        }
        setIsLoading(false);
    }, [toast]);

    useEffect(() => {
        loadData();
    }, [loadData]);
    
    const getStatusBadge = (status) => {
        const variants = {
            active: "bg-green-100 text-green-800",
            in_service: "bg-yellow-100 text-yellow-800",
            sold: "bg-gray-100 text-gray-800",
            out_of_order: "bg-red-100 text-red-800",
        };
        return <Badge className={variants[status] || "bg-gray-100"}>{statusTranslations[status] || status}</Badge>;
    };

    const getExpiryWarning = (dateString, label) => {
        if (!dateString) return null;
        const days = differenceInDays(parseISO(dateString), new Date());
        if (days < 0) return <Badge variant="destructive" className="text-xs animate-pulse"><AlertTriangle className="w-3 h-3 ml-1" />{label} פג</Badge>;
        if (days <= 30) return <Badge variant="default" className="text-xs animate-pulse"><AlertTriangle className="w-3 h-3 ml-1" />{label} יפוג בעוד {days} ימים</Badge>;
        return null;
    };

    const filteredVehicles = useMemo(() => {
        return (vehicles || []).filter(v => {
            if (!v) return false;
            const typeMatch = filterType === "all" || v.type === filterType;
            const searchMatch = searchText === "" ||
                v.name.toLowerCase().includes(searchText.toLowerCase()) ||
                v.license_plate.toLowerCase().includes(searchText.toLowerCase()) ||
                (v.manufacturer && v.manufacturer.toLowerCase().includes(searchText.toLowerCase()));
            return typeMatch && searchMatch;
        });
    }, [vehicles, filterType, searchText]);

    if (isLoading) {
        return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div></div>;
    }

    return (
        <div className="p-4 sm:p-6 lg:p-8 bg-gray-50/50 min-h-screen" dir="rtl">
            <div className="max-w-screen-2xl mx-auto">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
                    <div>
                        <h1 className="text-3xl font-bold text-gray-900">צי רכבים</h1>
                        <p className="text-sm text-gray-500 mt-1">{filteredVehicles.length} מתוך {vehicles.length} רכבים</p>
                    </div>
                    <Link to={createPageUrl("AddVehicle")}>
                        <Button className="flex items-center gap-1.5">
                            <Plus className="w-4 h-4" />
                            <span className="hidden sm:inline">הוסף רכב</span>
                        </Button>
                    </Link>
                </div>

                {/* Mobile filters toggle */}
                <div className="sm:hidden mb-4">
                    <button
                        onClick={() => setFiltersOpen(o => !o)}
                        className="w-full flex items-center justify-between px-3 py-2 rounded-xl bg-gray-100 border border-gray-200 text-sm font-medium text-gray-700"
                    >
                        <div className="flex items-center gap-2">
                            <SlidersHorizontal className="w-4 h-4 text-gray-500" />
                            <span>
                                סינון
                                {filterType !== 'all' && <span className="mr-1 text-blue-600">· {vehicleTypeTranslations[filterType]}</span>}
                                {searchText && <span className="mr-1 text-blue-600">· "{searchText}"</span>}
                            </span>
                        </div>
                        {filtersOpen ? <ChevronUp className="w-4 h-4 text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-500" />}
                    </button>
                    {filtersOpen && (
                        <div className="mt-2 p-3 rounded-xl bg-white border border-gray-200 space-y-3">
                            <div className="relative">
                                <Search className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                                <Input placeholder="חפש לפי שם, מספר רישוי או יצרן..." value={searchText} onChange={(e) => setSearchText(e.target.value)} className="pr-10" />
                            </div>
                            <Select value={filterType} onValueChange={(v) => { setFilterType(v); setFiltersOpen(false); }}>
                                <SelectTrigger><SelectValue placeholder="סוג רכב" /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">כל הסוגים</SelectItem>
                                    {Object.entries(vehicleTypeTranslations).map(([key, value]) => <SelectItem key={key} value={key}>{value}</SelectItem>)}
                                </SelectContent>
                            </Select>
                            {(searchText || filterType !== 'all') && (
                                <Button variant="outline" onClick={() => { setSearchText(""); setFilterType("all"); setFiltersOpen(false); }} className="w-full flex items-center justify-center gap-1 text-sm">
                                    <X className="w-4 h-4" /> נקה סינון
                                </Button>
                            )}
                        </div>
                    )}
                </div>

                {/* Desktop filters */}
                <Card className="mb-6 hidden sm:block">
                    <CardContent className="p-4">
                        <div className="flex flex-row gap-4 items-end">
                            <div className="flex-1 space-y-2">
                                <label className="text-sm font-medium text-gray-700">חיפוש</label>
                                <div className="relative">
                                    <Search className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                                    <Input placeholder="חפש לפי שם, מספר רישוי או יצרן..." value={searchText} onChange={(e) => setSearchText(e.target.value)} className="pr-10" />
                                </div>
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-gray-700">סוג רכב</label>
                                <div className="flex items-center gap-2">
                                    <Filter className="w-4 h-4 text-gray-500" />
                                    <Select value={filterType} onValueChange={setFilterType}>
                                        <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="all">כל הסוגים</SelectItem>
                                            {Object.entries(vehicleTypeTranslations).map(([key, value]) => <SelectItem key={key} value={key}>{value}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                            {(searchText || filterType !== "all") && (
                                <Button variant="outline" onClick={() => { setSearchText(""); setFilterType("all"); }} className="flex items-center gap-1 text-sm"><X className="w-4 h-4" /> נקה סינון</Button>
                            )}
                        </div>
                    </CardContent>
                </Card>

                {filteredVehicles.length === 0 ? (
                    <Card><CardContent className="text-center py-12"><Truck className="w-12 h-12 text-gray-400 mx-auto mb-4" /><h3 className="text-lg font-semibold">לא נמצאו רכבים</h3></CardContent></Card>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                        {filteredVehicles.map(vehicle => vehicle && (
                            <Card key={vehicle.id} className="hover:shadow-lg transition-all h-full flex flex-col">
                                <CardHeader>
                                    <Link to={createPageUrl(`VehicleDetail?id=${vehicle.id}`)}><CardTitle className="hover:text-blue-600">{vehicle.name}</CardTitle></Link>
                                    <p className="text-sm text-muted-foreground">{vehicle.manufacturer} {vehicle.model} ({vehicle.year})</p>
                                </CardHeader>
                                <CardContent className="flex-grow space-y-3">
                                    <div className="flex justify-between items-center">
                                        <Badge variant="secondary">{vehicleTypeTranslations[vehicle.type] || vehicle.type}</Badge>
                                        {getStatusBadge(vehicle.status)}
                                    </div>
                                    <p className="font-mono text-center text-lg p-2 bg-gray-100 rounded-md border">{vehicle.license_plate}</p>
                                    <div className="space-y-1 pt-2">
                                        {getExpiryWarning(vehicle.insurance_info?.end_date, 'ביטוח')}
                                        {getExpiryWarning(vehicle.licensing_info?.next_test_date, 'טסט')}
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                )}

            </div>
        </div>
    );
}