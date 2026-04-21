
import React, { useState, useEffect, useCallback } from "react";
import { PlasticSheet, Plot, User, Farm } from "@/entities/all";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import { 
  Plus, Download, Printer, FileText, AlertTriangle, ChevronLeft, Send, 
  ShoppingCart, Filter, Search, X, Check, Package, Truck, Wrench, Archive
} from "lucide-react";
import SheetTracker from "../components/plots/SheetTracker";
import { format, parseISO, addMonths, differenceInDays } from "date-fns";

export default function Sheets() {
  const [sheets, setSheets] = useState([]);
  const [plots, setPlots] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSheetTrackerOpen, setIsSheetTrackerOpen] = useState(false);
  const [selectedPlotForSheets, setSelectedPlotForSheets] = useState(null);
  const [currentFarm, setCurrentFarm] = useState(null);
  const { toast } = useToast();

  // Filter states
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterPlot, setFilterPlot] = useState("all");
  const [searchText, setSearchText] = useState("");
  const [showExpiringSoon, setShowExpiringSoon] = useState(false);
  
  // Selection states
  const [selectedSheets, setSelectedSheets] = useState([]);
  const [bulkAction, setBulkAction] = useState("");

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const user = await User.me();
      if (!user.current_farm_id) {
        setIsLoading(false);
        setSheets([]);
        setPlots([]);
        return;
      }

      const farm = await Farm.get(user.current_farm_id);
      setCurrentFarm(farm);

      const farmFilter = { farm_id: user.current_farm_id };
      const [sheetsData, plotsData] = await Promise.all([
        PlasticSheet.filter(farmFilter),
        Plot.filter(farmFilter),
      ]);
      
      setSheets(Array.isArray(sheetsData) ? sheetsData : []);
      setPlots(Array.isArray(plotsData) ? plotsData : []);

    } catch (error) {
      console.error("Failed to load sheets data:", error);
      toast({ title: "שגיאה", description: "טעינת נתוני יריעות נכשלה.", variant: "destructive" });
    }
    setIsLoading(false);
  }, [toast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const getPlotName = useCallback((plotId) => {
    const plot = plots.find((p) => p.id === plotId);
    return plot ? plot.name : "לא ידוע";
  }, [plots]);

  const handleOpenSheetTracker = (plot) => {
    setSelectedPlotForSheets(plot);
    setIsSheetTrackerOpen(true);
  };

  const handleSheetTrackerClose = () => {
    setIsSheetTrackerOpen(false);
    setSelectedPlotForSheets(null);
    loadData();
  };

  const getStatusVariant = (status) => {
    const variants = {
      installed: "bg-green-100 text-green-800",
      to_order: "bg-orange-100 text-orange-800",
      ordered: "bg-blue-100 text-blue-800",
      in_stock: "bg-purple-100 text-purple-800",
      needs_replacement: "bg-red-100 text-red-800",
      replaced: "bg-gray-100 text-gray-800"
    };
    return variants[status] || "bg-gray-100 text-gray-800";
  };

  const getStatusText = (status) => {
    const statusTexts = {
      installed: "מותקן",
      to_order: "להזמין",
      ordered: "הוזמן",
      in_stock: "במלאי",
      needs_replacement: "דורש החלפה",
      replaced: "הוחלף"
    };
    return statusTexts[status] || status;
  };

  const getStatusIcon = (status) => {
    const icons = {
      installed: Check,
      to_order: ShoppingCart,
      ordered: Truck,
      in_stock: Package,
      needs_replacement: AlertTriangle,
      replaced: Archive
    };
    const IconComponent = icons[status] || FileText;
    return <IconComponent className="w-4 h-4" />;
  };

  const isSheetExpiring = (sheet) => {
    if (!sheet.installation_date || !sheet.replacement_cycle_months) return false;
    
    try {
      const replacementDate = addMonths(parseISO(sheet.installation_date), sheet.replacement_cycle_months);
      const daysUntilReplacement = differenceInDays(replacementDate, new Date());
      return daysUntilReplacement <= 30 && daysUntilReplacement >= 0;
    } catch {
      return false;
    }
  };

  // Filter logic
  const filteredSheets = React.useMemo(() => {
    return sheets.filter(sheet => {
      // Status filter
      if (filterStatus !== "all" && sheet.status !== filterStatus) return false;
      
      // Plot filter
      if (filterPlot !== "all" && sheet.plot_id !== filterPlot) return false;
      
      // Search filter
      if (searchText) {
        const searchLower = searchText.toLowerCase();
        if (
          !getPlotName(sheet.plot_id).toLowerCase().includes(searchLower) &&
          !sheet.sheet_number?.toString().includes(searchLower) &&
          !sheet.sheet_type?.toLowerCase().includes(searchLower) &&
          !sheet.supplier?.toLowerCase().includes(searchLower)
        ) return false;
      }
      
      // Expiring soon filter
      if (showExpiringSoon && !isSheetExpiring(sheet)) return false;
      
      return true;
    });
  }, [sheets, filterStatus, filterPlot, searchText, showExpiringSoon, getPlotName]);

  // Selection logic
  const handleSelectSheet = (sheetId) => {
    setSelectedSheets(prev => 
      prev.includes(sheetId) ? prev.filter(id => id !== sheetId) : [...prev, sheetId]
    );
  };

  const handleSelectAll = (checked) => {
    if (checked) {
      setSelectedSheets(filteredSheets.map(s => s.id));
    } else {
      setSelectedSheets([]);
    }
  };

  // Bulk actions
  const handleBulkStatusUpdate = async () => {
    if (!bulkAction || selectedSheets.length === 0) {
      toast({ title: "שגיאה", description: "יש לבחור פעולה ויריעות לעדכון", variant: "destructive" });
      return;
    }

    try {
      const updates = selectedSheets.map(sheetId => 
        PlasticSheet.update(sheetId, { status: bulkAction })
      );
      
      await Promise.all(updates);
      
      toast({ 
        title: "הצלחה", 
        description: `${selectedSheets.length} יריעות עודכנו לסטטוס: ${getStatusText(bulkAction)}` 
      });
      
      setSelectedSheets([]);
      setBulkAction("");
      loadData();
    } catch (error) {
      console.error("Failed to update sheets status:", error);
      toast({ title: "שגיאה", description: "עדכון הסטטוס נכשל", variant: "destructive" });
    }
  };

  const clearFilters = () => {
    setFilterStatus("all");
    setFilterPlot("all");
    setSearchText("");
    setShowExpiringSoon(false);
  };

  const hasActiveFilters = filterStatus !== "all" || filterPlot !== "all" || searchText || showExpiringSoon;

  if (isLoading) {
    return <div className="flex justify-center items-center h-64">טוען יריעות...</div>;
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8" dir="rtl">
      <div className="max-w-screen-2xl mx-auto space-y-6">
        <div className="flex justify-between items-center">
          <h1 className="text-3xl font-bold">ניהול יריעות</h1>
          <div className="text-sm text-gray-500">
            {filteredSheets.length} מתוך {sheets.length} יריעות
          </div>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="p-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {/* Search */}
              <div className="relative">
                <Search className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                <Input
                  placeholder="חפש לפי חלקה, מספר, סוג או ספק..."
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  className="pr-10"
                />
              </div>

              {/* Status Filter */}
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger>
                  <SelectValue placeholder="כל הסטטוסים" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">כל הסטטוסים</SelectItem>
                  <SelectItem value="installed">מותקן</SelectItem>
                  <SelectItem value="to_order">להזמין</SelectItem>
                  <SelectItem value="ordered">הוזמן</SelectItem>
                  <SelectItem value="in_stock">במלאי</SelectItem>
                  <SelectItem value="needs_replacement">דורש החלפה</SelectItem>
                  <SelectItem value="replaced">הוחלף</SelectItem>
                </SelectContent>
              </Select>

              {/* Plot Filter */}
              <Select value={filterPlot} onValueChange={setFilterPlot}>
                <SelectTrigger>
                  <SelectValue placeholder="כל החלקות" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">כל החלקות</SelectItem>
                  {plots.map(plot => (
                    <SelectItem key={plot.id} value={plot.id}>{plot.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Quick Filters */}
              <div className="flex gap-2">
                <Button
                  variant={showExpiringSoon ? "default" : "outline"}
                  size="sm"
                  onClick={() => setShowExpiringSoon(!showExpiringSoon)}
                  className="flex items-center gap-2"
                >
                  <AlertTriangle className="w-4 h-4" />
                  פגות תוקף
                </Button>
                
                {hasActiveFilters && (
                  <Button variant="ghost" size="sm" onClick={clearFilters}>
                    <X className="w-4 h-4" />
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Bulk Actions */}
        {selectedSheets.length > 0 && (
          <Card className="bg-blue-50 border-blue-200">
            <CardContent className="p-4">
              <div className="flex items-center gap-4">
                <span className="font-medium">נבחרו {selectedSheets.length} יריעות</span>
                
                <Select value={bulkAction} onValueChange={setBulkAction}>
                  <SelectTrigger className="w-48">
                    <SelectValue placeholder="בחר פעולה..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="to_order">סמן להזמנה</SelectItem>
                    <SelectItem value="ordered">סמן כהוזמן</SelectItem>
                    <SelectItem value="in_stock">סמן כבמלאי</SelectItem>
                    <SelectItem value="installed">סמן כמותקן</SelectItem>
                    <SelectItem value="needs_replacement">סמן כדורש החלפה</SelectItem>
                  </SelectContent>
                </Select>
                
                <Button onClick={handleBulkStatusUpdate} disabled={!bulkAction}>
                  עדכן
                </Button>
                
                <Button variant="outline" onClick={() => setSelectedSheets([])}>
                  בטל בחירה
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Sheets Table */}
        <Card>
          <CardHeader>
            <div className="flex justify-between items-center">
              <CardTitle>יריעות</CardTitle>
              <div className="flex gap-2">
                {filteredSheets.length > 0 && (
                  <>
                    <Button variant="outline" size="sm">
                      <Download className="w-4 h-4 mr-2" />
                      ייצא CSV
                    </Button>
                    <Button variant="outline" size="sm">
                      <Printer className="w-4 h-4 mr-2" />
                      הדפס
                    </Button>
                  </>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {filteredSheets.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                {hasActiveFilters ? "לא נמצאו יריעות התואמות לסינון" : "לא נמצאו יריעות במערכת"}
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">
                      <Checkbox
                        checked={selectedSheets.length === filteredSheets.length}
                        onCheckedChange={handleSelectAll}
                      />
                    </TableHead>
                    <TableHead>חלקה</TableHead>
                    <TableHead>מספר יריעה</TableHead>
                    <TableHead>סוג</TableHead>
                    <TableHead>ממדים</TableHead>
                    <TableHead>תאריך התקנה</TableHead>
                    <TableHead>סטטוס</TableHead>
                    <TableHead>ספק</TableHead>
                    <TableHead>הערות</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredSheets.map((sheet) => {
                    const isExpiring = isSheetExpiring(sheet);
                    
                    return (
                      <TableRow 
                        key={sheet.id}
                        className={`${isExpiring ? 'bg-orange-50' : ''} hover:bg-gray-50`}
                      >
                        <TableCell>
                          <Checkbox
                            checked={selectedSheets.includes(sheet.id)}
                            onCheckedChange={() => handleSelectSheet(sheet.id)}
                          />
                        </TableCell>
                        <TableCell className="font-medium">
                          {getPlotName(sheet.plot_id)}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {sheet.sheet_number}
                            {isExpiring && <AlertTriangle className="w-4 h-4 text-orange-500" />}
                          </div>
                        </TableCell>
                        <TableCell>{sheet.sheet_type || "-"}</TableCell>
                        <TableCell>
                          {sheet.length && sheet.width ? 
                            `${sheet.length}×${sheet.width} מ'` : "-"
                          }
                        </TableCell>
                        <TableCell>
                          {sheet.installation_date ? 
                            format(parseISO(sheet.installation_date), "dd/MM/yyyy") : "-"
                          }
                        </TableCell>
                        <TableCell>
                          <Badge className={getStatusVariant(sheet.status)}>
                            <span className="flex items-center gap-1">
                              {getStatusIcon(sheet.status)}
                              {getStatusText(sheet.status)}
                            </span>
                          </Badge>
                        </TableCell>
                        <TableCell>{sheet.supplier || "-"}</TableCell>
                        <TableCell className="max-w-32 truncate">
                          {sheet.notes || "-"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Plots Grid */}
        <Card>
          <CardHeader>
            <CardTitle>ניהול לפי חלקות</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {plots.map((plot) => {
                const plotSheets = sheets.filter(s => s.plot_id === plot.id);
                const needsAttention = plotSheets.some(s => 
                  s.status === 'needs_replacement' || isSheetExpiring(s)
                );

                return (
                  <Card 
                    key={plot.id} 
                    className={`cursor-pointer hover:shadow-lg transition-shadow ${
                      needsAttention ? 'border-orange-300 bg-orange-50' : ''
                    }`}
                    onClick={() => handleOpenSheetTracker(plot)}
                  >
                    <CardHeader className="pb-3">
                      <div className="flex justify-between items-start">
                        <div>
                          <CardTitle className="text-lg">{plot.name}</CardTitle>
                          <p className="text-sm text-muted-foreground">
                            {plotSheets.length} יריעות
                          </p>
                        </div>
                        {needsAttention && (
                          <AlertTriangle className="w-5 h-5 text-orange-500" />
                        )}
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="flex gap-2 flex-wrap">
                        {Object.entries(
                          plotSheets.reduce((acc, sheet) => {
                            acc[sheet.status] = (acc[sheet.status] || 0) + 1;
                            return acc;
                          }, {})
                        ).map(([status, count]) => (
                          <Badge 
                            key={status} 
                            variant="outline" 
                            className="text-xs"
                          >
                            {getStatusText(status)}: {count}
                          </Badge>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      <SheetTracker
        isOpen={isSheetTrackerOpen}
        onClose={handleSheetTrackerClose}
        plot={selectedPlotForSheets}
      />
    </div>
  );
}
