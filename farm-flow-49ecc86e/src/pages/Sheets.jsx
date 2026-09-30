
import React, { useState, useEffect, useCallback } from "react";
import { PlasticSheet, Plot, User, Farm } from "@/entities/all";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
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
      // בקשת רשת אחת לכל היריעות שנבחרו
      await PlasticSheet.bulkUpdate(selectedSheets.map(id => ({ id, status: bulkAction })));

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

  // ── ייצוא והדפסה של הרשימה המסוננת ──────────────────────────────
  const DIRECTION_TEXT = { north: "צפון", south: "דרום", east: "מזרח", west: "מערב" };
  const fmtDate = (d) => { try { return d ? format(parseISO(d), "dd/MM/yyyy") : ""; } catch { return ""; } };
  const replacementDate = (sheet) => {
    if (!sheet.installation_date || !sheet.replacement_cycle_months) return "";
    try { return format(addMonths(parseISO(sheet.installation_date), sheet.replacement_cycle_months), "dd/MM/yyyy"); } catch { return ""; }
  };
  const exportColumns = [
    { key: "plot", header: "חלקה", value: s => getPlotName(s.plot_id) },
    { key: "sheet_number", header: "מספר יריעה", value: s => s.sheet_number ?? "" },
    { key: "sub_plot", header: "תת-חלקה", value: s => s.sub_plot || "" },
    { key: "direction", header: "כיוון", value: s => DIRECTION_TEXT[s.direction] || s.direction || "" },
    { key: "sheet_type", header: "סוג", value: s => s.sheet_type || "" },
    { key: "length", header: "אורך (מ')", value: s => s.length ?? "" },
    { key: "width", header: "רוחב (מ')", value: s => s.width ?? "" },
    { key: "installation_date", header: "תאריך התקנה", value: s => fmtDate(s.installation_date) },
    { key: "replacement_cycle_months", header: "מחזור החלפה (חודשים)", value: s => s.replacement_cycle_months ?? "" },
    { key: "replacement_date", header: "החלפה צפויה", value: s => replacementDate(s) },
    { key: "status", header: "סטטוס", value: s => getStatusText(s.status) },
    { key: "supplier", header: "ספק", value: s => s.supplier || "" },
    { key: "price", header: "מחיר", value: s => s.price ?? "" },
    { key: "notes", header: "הערות", value: s => s.notes || "" },
  ];
  const STATUS_OPTIONS = ["installed", "to_order", "ordered", "in_stock", "needs_replacement", "replaced"];

  // ── דיאלוג ייצוא: סינון לפי חלקות/סטטוסים, בחירת שדות ופורמט ──
  const [exportOpen, setExportOpen] = useState(false);
  const [exportPlots, setExportPlots] = useState(() => new Set());       // ריק = כל החלקות
  const [exportStatuses, setExportStatuses] = useState(() => new Set()); // ריק = כל הסטטוסים
  const [exportFields, setExportFields] = useState(() => new Set(exportColumns.map(c => c.key)));
  const [exportFormat, setExportFormat] = useState("xlsx");
  const [exportOnlySelected, setExportOnlySelected] = useState(false);

  const openExportDialog = () => {
    // ברירת מחדל: הסינון הפעיל בעמוד
    setExportPlots(filterPlot !== "all" ? new Set([filterPlot]) : new Set());
    setExportStatuses(filterStatus !== "all" ? new Set([filterStatus]) : new Set());
    setExportOnlySelected(selectedSheets.length > 0);
    setExportOpen(true);
  };
  const toggleInSet = (setter) => (value) => setter(prev => {
    const next = new Set(prev);
    if (next.has(value)) next.delete(value); else next.add(value);
    return next;
  });
  const toggleExportPlot = toggleInSet(setExportPlots);
  const toggleExportStatus = toggleInSet(setExportStatuses);
  const toggleExportField = toggleInSet(setExportFields);

  const exportRows = React.useMemo(() => sheets.filter(s => {
    if (exportOnlySelected && !selectedSheets.includes(s.id)) return false;
    if (exportPlots.size > 0 && !exportPlots.has(s.plot_id)) return false;
    if (exportStatuses.size > 0 && !exportStatuses.has(s.status)) return false;
    return true;
  }), [sheets, exportOnlySelected, selectedSheets, exportPlots, exportStatuses]);
  const exportCols = exportColumns.filter(c => exportFields.has(c.key));

  const runExport = async () => {
    if (exportRows.length === 0 || exportCols.length === 0) return;
    if (exportFormat === "xlsx") await exportExcel(exportRows, exportCols);
    else exportCsv(exportRows, exportCols);
    setExportOpen(false);
  };

  // קידוד ISO-8859-8 (עברית): ASCII כמו שהוא, אותיות עבריות U+05D0..U+05EA → 0xE0..0xFA,
  // תווים שאינם בקידוד הופכים ל-'?'. הדפדפן יודע רק לפענח קידוד זה, לכן הקידוד ידני.
  const encodeIso8859_8 = (text) => {
    const out = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      if (c < 0x80) out[i] = c;
      else if (c >= 0x05d0 && c <= 0x05ea) out[i] = c - 0x05d0 + 0xe0;
      else if (c === 0x00a0) out[i] = 0xa0;            // רווח קשיח
      else if (c === 0x00d7) out[i] = 0xaa;            // ×
      else if (c === 0x2017) out[i] = 0xdf;            // קו תחתון כפול
      else if (c === 0x200e) out[i] = 0xfd;            // LRM
      else if (c === 0x200f) out[i] = 0xfe;            // RLM
      else out[i] = 0x3f;                              // '?'
    }
    return out;
  };

  const exportCsv = (rows, cols) => {
    // CSV בקידוד ISO-8859-8, מופרד בפסיקים, שורות CRLF
    const esc = (v) => String(v ?? "").replace(/[\t\r\n]+/g, " ").replace(/"/g, '""');
    const cell = (v) => { const t = esc(v); return /[",]/.test(t) ? `"${t}"` : t; };
    const lines = [cols.map(c => cell(c.header)).join(",")];
    for (const s of rows) lines.push(cols.map(c => cell(c.value(s))).join(","));
    const blob = new Blob([encodeIso8859_8(lines.join("\r\n"))], { type: "text/csv;charset=iso-8859-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sheets_${format(new Date(), "yyyy-MM-dd")}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast({ title: "הקובץ הורד", description: `${rows.length} יריעות יוצאו ל-CSV.` });
  };

  // ייצוא לאקסל (.xlsx) — הספרייה נטענת רק בלחיצה כדי לא להכביד על טעינת העמוד
  const exportExcel = async (rows, cols) => {
    try {
      const XLSX = await import("xlsx");
      const header = cols.map(c => c.header);
      const data = rows.map(s => cols.map(c => {
        const v = c.value(s);
        return (typeof v === "number") ? v : (v === "" ? "" : (isNaN(Number(v)) || String(v).trim() === "" ? v : Number(v)));
      }));
      const ws = XLSX.utils.aoa_to_sheet([header, ...data]);
      ws["!views"] = [{ RTL: true }];
      ws["!cols"] = header.map((h, i) => ({
        wch: Math.min(40, Math.max(h.length, ...data.map(r => String(r[i] ?? "").length)) + 2)
      }));
      ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: data.length, c: header.length - 1 } }) };
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "יריעות");
      XLSX.writeFile(wb, `sheets_${format(new Date(), "yyyy-MM-dd")}.xlsx`);
      toast({ title: "הקובץ הורד", description: `${rows.length} יריעות יוצאו לאקסל.` });
    } catch (error) {
      console.error("Excel export failed:", error);
      toast({ title: "שגיאה", description: "ייצוא לאקסל נכשל.", variant: "destructive" });
    }
  };

  const handlePrint = () => {
    const escHtml = (v) => String(v ?? "").replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
    const filtersLine = [
      filterPlot !== "all" ? `חלקה: ${getPlotName(filterPlot)}` : null,
      filterStatus !== "all" ? `סטטוס: ${getStatusText(filterStatus)}` : null,
      searchText ? `חיפוש: ${searchText}` : null,
      showExpiringSoon ? "פגות תוקף בלבד" : null,
    ].filter(Boolean).join(" | ");
    const head = exportColumns.map(c => `<th>${escHtml(c.header)}</th>`).join("");
    const rows = filteredSheets.map(s => `<tr>${exportColumns.map(c => `<td>${escHtml(c.value(s))}</td>`).join("")}</tr>`).join("");
    const html = `<!DOCTYPE html><html dir="rtl" lang="he"><head><meta charset="utf-8"><title>יריעות - ${escHtml(currentFarm?.name || "")}</title>
<style>
  body { font-family: Arial, "Segoe UI", sans-serif; margin: 16px; color: #111; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .meta { font-size: 12px; color: #555; margin-bottom: 12px; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  th, td { border: 1px solid #999; padding: 4px 6px; text-align: right; vertical-align: top; }
  th { background: #eee; }
  tr:nth-child(even) td { background: #fafafa; }
  @page { size: A4 landscape; margin: 10mm; }
  @media print { .noprint { display: none; } }
</style></head><body>
<div class="noprint" style="margin-bottom:10px"><button onclick="window.print()">הדפס</button> <button onclick="window.close()">סגור</button></div>
<h1>יריעות${currentFarm?.name ? ` - ${escHtml(currentFarm.name)}` : ""}</h1>
<div class="meta">${filteredSheets.length} יריעות | הופק ${format(new Date(), "dd/MM/yyyy HH:mm")}${filtersLine ? ` | ${escHtml(filtersLine)}` : ""}</div>
<table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>
</body></html>`;
    const w = window.open("", "_blank");
    if (!w) {
      toast({ title: "שגיאה", description: "הדפדפן חסם את חלון ההדפסה. אפשר חלונות קופצים לאתר ונסה שוב.", variant: "destructive" });
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => { try { w.print(); } catch { /* המשתמש יכול ללחוץ "הדפס" בחלון */ } }, 300);
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
                    <Button variant="outline" size="sm" onClick={openExportDialog}>
                      <Download className="w-4 h-4 mr-2" />
                      ייצוא לקובץ
                    </Button>
                    <Button variant="outline" size="sm" onClick={handlePrint}>
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

      {/* דיאלוג ייצוא */}
      <Dialog open={exportOpen} onOpenChange={setExportOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle>ייצוא יריעות לקובץ</DialogTitle>
            <DialogDescription>בחר אילו יריעות ואילו שדות ייכללו בקובץ.</DialogDescription>
          </DialogHeader>

          <div className="space-y-5">
            {/* פורמט */}
            <div className="flex flex-wrap items-center gap-4">
              <Label className="font-semibold">פורמט:</Label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="export-format" value="xlsx" checked={exportFormat === "xlsx"} onChange={() => setExportFormat("xlsx")} />
                אקסל (.xlsx)
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="export-format" value="csv" checked={exportFormat === "csv"} onChange={() => setExportFormat("csv")} />
                CSV (ISO-8859-8)
              </label>
              {selectedSheets.length > 0 && (
                <label className="flex items-center gap-2 cursor-pointer mr-auto">
                  <Checkbox checked={exportOnlySelected} onCheckedChange={(v) => setExportOnlySelected(!!v)} />
                  רק {selectedSheets.length} היריעות המסומנות
                </label>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* חלקות */}
              <div className="border rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <Label className="font-semibold">חלקות</Label>
                  <div className="flex gap-2 text-xs">
                    <button type="button" className="text-blue-600 hover:underline" onClick={() => setExportPlots(new Set())}>הכל</button>
                    <button type="button" className="text-blue-600 hover:underline" onClick={() => setExportPlots(new Set(plots.map(p => p.id)))}>סמן הכל</button>
                  </div>
                </div>
                <p className="text-xs text-gray-500 mb-2">{exportPlots.size === 0 ? "כל החלקות" : `${exportPlots.size} חלקות נבחרו`}</p>
                <div className="max-h-44 overflow-y-auto space-y-1.5">
                  {plots.map(p => (
                    <label key={p.id} className="flex items-center gap-2 cursor-pointer text-sm">
                      <Checkbox checked={exportPlots.has(p.id)} onCheckedChange={() => toggleExportPlot(p.id)} />
                      {p.name}
                      <span className="text-xs text-gray-400">({sheets.filter(s => s.plot_id === p.id).length})</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* סטטוסים */}
              <div className="border rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <Label className="font-semibold">סטטוסים</Label>
                  <div className="flex gap-2 text-xs">
                    <button type="button" className="text-blue-600 hover:underline" onClick={() => setExportStatuses(new Set())}>הכל</button>
                  </div>
                </div>
                <p className="text-xs text-gray-500 mb-2">{exportStatuses.size === 0 ? "כל הסטטוסים" : `${exportStatuses.size} סטטוסים נבחרו`}</p>
                <div className="space-y-1.5">
                  {STATUS_OPTIONS.map(st => (
                    <label key={st} className="flex items-center gap-2 cursor-pointer text-sm">
                      <Checkbox checked={exportStatuses.has(st)} onCheckedChange={() => toggleExportStatus(st)} />
                      {getStatusText(st)}
                      <span className="text-xs text-gray-400">({sheets.filter(s => s.status === st).length})</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            {/* שדות */}
            <div className="border rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <Label className="font-semibold">שדות בקובץ</Label>
                <div className="flex gap-2 text-xs">
                  <button type="button" className="text-blue-600 hover:underline" onClick={() => setExportFields(new Set(exportColumns.map(c => c.key)))}>סמן הכל</button>
                  <button type="button" className="text-blue-600 hover:underline" onClick={() => setExportFields(new Set())}>נקה</button>
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-y-1.5 gap-x-4">
                {exportColumns.map(c => (
                  <label key={c.key} className="flex items-center gap-2 cursor-pointer text-sm">
                    <Checkbox checked={exportFields.has(c.key)} onCheckedChange={() => toggleExportField(c.key)} />
                    {c.header}
                  </label>
                ))}
              </div>
            </div>

            <p className="text-sm font-medium">
              ייוצאו <span className="text-blue-700">{exportRows.length}</span> יריעות עם <span className="text-blue-700">{exportCols.length}</span> שדות
              {exportRows.length === 0 && <span className="text-red-600 mr-2">אין יריעות התואמות לבחירה</span>}
              {exportCols.length === 0 && <span className="text-red-600 mr-2">יש לבחור לפחות שדה אחד</span>}
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setExportOpen(false)}>ביטול</Button>
            <Button onClick={runExport} disabled={exportRows.length === 0 || exportCols.length === 0}>
              <Download className="w-4 h-4 ml-2" />
              ייצא {exportFormat === "xlsx" ? "לאקסל" : "ל-CSV"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
