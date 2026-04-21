
import React, { useState, useEffect, useMemo } from "react";
import { Activity, Harvest, Spraying, Seeding, Plot, Pesticide } from "@/entities/all";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Download, Printer, Filter } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/components/ui/use-toast";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

export default function SeedingsReports() {
  const [activities, setActivities] = useState([]);
  const [harvests, setHarvests] = useState([]);
  const [sprayings, setSprayings] = useState([]);
  const [seedings, setSeedings] = useState([]);
  const [plots, setPlots] = useState([]);
  const [pesticides, setPesticides] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showFilters, setShowFilters] = useState(false);
  const { toast } = useToast();

  const [filters, setFilters] = useState({
    seeding_id: "",
    plot_id: "",
    date_from: "",
    date_to: "",
    activity_type: "",
    quality: ""
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [
        activitiesData,
        harvestsData, 
        sprayingsData,
        seedingsData,
        plotsData,
        pesticidesData
      ] = await Promise.all([
        Activity.list("-date"),
        Harvest.list("-date"),
        Spraying.list("-date"),
        Seeding.list(),
        Plot.list(),
        Pesticide.list()
      ]);

      setActivities(Array.isArray(activitiesData) ? activitiesData : []);
      setHarvests(Array.isArray(harvestsData) ? harvestsData : []);
      setSprayings(Array.isArray(sprayingsData) ? sprayingsData : []);
      setSeedings(Array.isArray(seedingsData) ? seedingsData : []);
      setPlots(Array.isArray(plotsData) ? plotsData : []);
      setPesticides(Array.isArray(pesticidesData) ? pesticidesData : []);
    } catch (error) {
      console.error("Error loading reports data:", error);
      toast({ title: "שגיאה", description: "טעינת הנתונים נכשלה", variant: "destructive" });
      // Set empty arrays on error
      setActivities([]);
      setHarvests([]);
      setSprayings([]);
      setSeedings([]);
      setPlots([]);
      setPesticides([]);
    }
    setIsLoading(false);
  };

  const { filteredActivities, filteredHarvests, filteredSprayings } = useMemo(() => {
    const safeActivities = Array.isArray(activities) ? activities : [];
    const safeHarvests = Array.isArray(harvests) ? harvests : [];
    const safeSprayings = Array.isArray(sprayings) ? sprayings : [];

    const filterByCommon = (item) => {
      const seedingMatch = !filters.seeding_id || item.seeding_id === filters.seeding_id;
      const plotMatch = !filters.plot_id || item.plot_id === filters.plot_id;
      const dateFromMatch = !filters.date_from || item.date >= filters.date_from;
      const dateToMatch = !filters.date_to || item.date <= filters.date_to;
      return seedingMatch && plotMatch && dateFromMatch && dateToMatch;
    };

    const filteredAct = safeActivities.filter(item => {
      const activityMatch = !filters.activity_type || item.activity_type === filters.activity_type;
      return filterByCommon(item) && activityMatch;
    });

    const filteredHar = safeHarvests.filter(item => {
      const qualityMatch = !filters.quality || item.quality === filters.quality;
      return filterByCommon(item) && qualityMatch;
    });

    const filteredSpr = safeSprayings.filter(filterByCommon);

    return {
      filteredActivities: filteredAct,
      filteredHarvests: filteredHar,
      filteredSprayings: filteredSpr
    };
  }, [activities, harvests, sprayings, filters]);

  const getSeedingName = (seedingId) => {
    const safeSeedings = Array.isArray(seedings) ? seedings : [];
    const seeding = safeSeedings.find(s => s.id === seedingId);
    return seeding ? seeding.name : "לא ידוע";
  };

  const getPlotName = (plotId) => {
    const safePlots = Array.isArray(plots) ? plots : [];
    const plot = safePlots.find(p => p.id === plotId);
    return plot ? plot.name : "כללי";
  };

  const exportToExcel = (data, filename) => {
    let csvContent = "";
    let headers = [];
    
    if (filename.includes("activities")) {
      headers = ["תאריך", "מזרע", "חלקה", "פעילות", "שטח", "עלות יחידה", "עלות כוללת", "מבצע"];
      csvContent = data.map(item => [
        item.date,
        getSeedingName(item.seeding_id),
        getPlotName(item.plot_id),
        item.activity_type,
        item.area_covered,
        item.cost_per_unit,
        item.total_cost,
        item.performed_by || ""
      ].join(",")).join("\n");
    } else if (filename.includes("harvests")) {
      headers = ["תאריך", "מזרע", "חלקה", "כמות", "איכות", "משקל", "מחיר יחידה", "הכנסה"];
      csvContent = data.map(item => [
        item.date,
        getSeedingName(item.seeding_id),
        getPlotName(item.plot_id),
        item.quantity,
        item.quality,
        item.weight,
        item.price_per_unit,
        (item.quantity || 0) * (item.price_per_unit || 0)
      ].join(",")).join("\n");
    } else if (filename.includes("sprayings")) {
      headers = ["תאריך", "מזרע", "סוג טיפול", "זמן טיפול", "חומרים"];
      csvContent = data.map(item => [
        item.date,
        getSeedingName(item.seeding_id),
        item.treatment_type,
        item.treatment_time,
        item.applied_pesticides?.map(p => p.pesticide_name).join("; ") || ""
      ].join(",")).join("\n");
    }

    const fullCsv = [headers.join(","), csvContent].join("\n");
    const blob = new Blob(['\ufeff' + fullCsv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${filename}.csv`;
    link.click();
  };

  const printReport = (data, reportType) => {
    const printWindow = window.open('', '_blank');
    let tableRows = "";

    if (reportType === "activities") {
      tableRows = data.map(item => `
        <tr>
          <td>${item.date}</td>
          <td>${getSeedingName(item.seeding_id)}</td>
          <td>${getPlotName(item.plot_id)}</td>
          <td>${item.activity_type}</td>
          <td>${item.area_covered} דונם</td>
          <td>₪${(item.total_cost || 0).toLocaleString()}</td>
        </tr>
      `).join('');
    } else if (reportType === "harvests") {
      tableRows = data.map(item => `
        <tr>
          <td>${item.date}</td>
          <td>${getSeedingName(item.seeding_id)}</td>
          <td>${item.quantity}</td>
          <td>${item.quality}</td>
          <td>${(item.weight || 0).toLocaleString()} ק"ג</td>
          <td>₪${((item.quantity || 0) * (item.price_per_unit || 0)).toLocaleString()}</td>
        </tr>
      `).join('');
    } else if (reportType === "sprayings") {
      tableRows = data.map(item => `
        <tr>
          <td>${item.date}</td>
          <td>${getSeedingName(item.seeding_id)}</td>
          <td>${item.treatment_type}</td>
          <td>${item.treatment_time}</td>
          <td>${item.applied_pesticides?.map(p => p.pesticide_name).join("; ") || ""}</td>
        </tr>
      `).join('');
    }

    const printContent = `
      <html dir="rtl">
        <head>
          <title>דוח ${reportType === "activities" ? "פעילויות" : reportType === "harvests" ? "קטיפים" : "ריסוסים"}</title>
          <style>
            body { font-family: Arial; }
            table { width: 100%; border-collapse: collapse; margin-top: 20px; }
            th, td { border: 1px solid #ddd; padding: 8px; text-align: right; }
            th { background-color: #f2f2f2; }
          </style>
        </head>
        <body>
          <h1>דוח ${reportType === "activities" ? "פעילויות" : reportType === "harvests" ? "קטיפים" : "ריסוסים"}</h1>
          <table>
            ${reportType === "activities" ? `
              <tr><th>תאריך</th><th>מזרע</th><th>חלקה</th><th>פעילות</th><th>שטח</th><th>עלות</th><th>מבצע</th></tr>
            ` : reportType === "harvests" ? `
              <tr><th>תאריך</th><th>מזרע</th><th>כמות</th><th>איכות</th><th>משקל</th><th>הכנסה</th></tr>
            ` : reportType === "sprayings" ? `
              <tr><th>תאריך</th><th>מזרע</th><th>סוג טיפול</th><th>זמן טיפול</th><th>חומרים</th></tr>
            ` : ""}
            ${tableRows}
          </table>
        </body>
      </html>
    `;
    
    printWindow.document.write(printContent);
    printWindow.document.close();
    printWindow.print();
  };

  const uniqueActivityTypes = [...new Set((Array.isArray(activities) ? activities : []).map(a => a.activity_type).filter(Boolean))];

  if (isLoading) {
    return <div className="text-center p-8">טוען נתונים...</div>;
  }

  return (
    <div className="space-y-6">
      {/* מסננים */}
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <CardTitle>דוחות מזרעים</CardTitle>
            <Button variant="outline" onClick={() => setShowFilters(!showFilters)}>
              <Filter className="w-4 h-4 ml-2" />
              סינון
            </Button>
          </div>
        </CardHeader>
        <Collapsible open={showFilters}>
          <CollapsibleContent>
            <CardContent className="border-t pt-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div>
                  <Label>מזרע</Label>
                  <Select value={filters.seeding_id || '__none__'} onValueChange={value => setFilters({...filters, seeding_id: value === '__none__' ? '' : value})}>
                    <SelectTrigger><SelectValue placeholder="כל המזרעים" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">כל המזרעים</SelectItem>
                      {(Array.isArray(seedings) ? seedings : []).map(seeding => (
                        <SelectItem key={seeding.id} value={seeding.id}>{seeding.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>חלקה</Label>
                  <Select value={filters.plot_id || '__none__'} onValueChange={value => setFilters({...filters, plot_id: value === '__none__' ? '' : value})}>
                    <SelectTrigger><SelectValue placeholder="כל החלקות" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">כל החלקות</SelectItem>
                      {(Array.isArray(plots) ? plots : []).map(plot => (
                        <SelectItem key={plot.id} value={plot.id}>{plot.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>מתאריך</Label>
                  <Input type="date" value={filters.date_from} onChange={e => setFilters({...filters, date_from: e.target.value})} />
                </div>
                <div>
                  <Label>עד תאריך</Label>
                  <Input type="date" value={filters.date_to} onChange={e => setFilters({...filters, date_to: e.target.value})} />
                </div>
              </div>
              <div className="mt-4">
                <Button variant="outline" size="sm" onClick={() => setFilters({seeding_id: "", plot_id: "", date_from: "", date_to: "", activity_type: "", quality: ""})}>
                  נקה מסננים
                </Button>
              </div>
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>

      {/* טאבים לדוחות */}
      <Tabs defaultValue="activities" className="w-full">
        <TabsList>
          <TabsTrigger value="activities">פעילויות ({filteredActivities.length})</TabsTrigger>
          <TabsTrigger value="harvests">קטיפים ({filteredHarvests.length})</TabsTrigger>
          <TabsTrigger value="sprayings">ריסוסים ({filteredSprayings.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="activities">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>דוח פעילויות</CardTitle>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => exportToExcel(filteredActivities, "activities_report")}>
                  <Download className="w-4 h-4 ml-2" />יצוא
                </Button>
                <Button variant="outline" size="sm" onClick={() => printReport(filteredActivities, "activities")}>
                  <Printer className="w-4 h-4 ml-2" />הדפסה
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="mb-4">
                <Select value={filters.activity_type || '__none__'} onValueChange={value => setFilters({...filters, activity_type: value === '__none__' ? '' : value})}>
                  <SelectTrigger className="w-48">
                    <SelectValue placeholder="כל סוגי הפעילויות" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">כל סוגי הפעילויות</SelectItem>
                    {uniqueActivityTypes.map(type => (
                      <SelectItem key={type} value={type}>{type}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>תאריך</TableHead>
                    <TableHead>מזרע</TableHead>
                    <TableHead>חלקה</TableHead>
                    <TableHead>פעילות</TableHead>
                    <TableHead>שטח</TableHead>
                    <TableHead>עלות כוללת</TableHead>
                    <TableHead>מבצע</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredActivities.map(activity => (
                    <TableRow key={activity.id}>
                      <TableCell>{format(new Date(activity.date), "dd/MM/yyyy")}</TableCell>
                      <TableCell>{getSeedingName(activity.seeding_id)}</TableCell>
                      <TableCell>{getPlotName(activity.plot_id)}</TableCell>
                      <TableCell>{activity.activity_type}</TableCell>
                      <TableCell>{activity.area_covered} דונם</TableCell>
                      <TableCell>₪{(activity.total_cost || 0).toLocaleString()}</TableCell>
                      <TableCell>{activity.performed_by}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="harvests">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>דוח קטיפים</CardTitle>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => exportToExcel(filteredHarvests, "harvests_report")}>
                  <Download className="w-4 h-4 ml-2" />יצוא
                </Button>
                <Button variant="outline" size="sm" onClick={() => printReport(filteredHarvests, "harvests")}>
                  <Printer className="w-4 h-4 ml-2" />הדפסה
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="mb-4">
                <Select value={filters.quality || '__none__'} onValueChange={value => setFilters({...filters, quality: value === '__none__' ? '' : value})}>
                  <SelectTrigger className="w-48">
                    <SelectValue placeholder="כל האיכויות" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">כל האיכויות</SelectItem>
                    <SelectItem value="א'">א'</SelectItem>
                    <SelectItem value="ב'">ב'</SelectItem>
                    <SelectItem value="ג'">ג'</SelectItem>
                    <SelectItem value="תעשייתי">תעשייתי</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>תאריך</TableHead>
                    <TableHead>מזרע</TableHead>
                    <TableHead>חלקה</TableHead>
                    <TableHead>כמות</TableHead>
                    <TableHead>איכות</TableHead>
                    <TableHead>משקל (ק"ג)</TableHead>
                    <TableHead>הכנסה</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredHarvests.map(harvest => (
                    <TableRow key={harvest.id}>
                      <TableCell>{format(new Date(harvest.date), "dd/MM/yyyy")}</TableCell>
                      <TableCell>{getSeedingName(harvest.seeding_id)}</TableCell>
                      <TableCell>{getPlotName(harvest.plot_id)}</TableCell>
                      <TableCell>{harvest.quantity?.toLocaleString()}</TableCell>
                      <TableCell><Badge variant="outline">{harvest.quality}</Badge></TableCell>
                      <TableCell>{(harvest.weight || 0).toLocaleString()}</TableCell>
                      <TableCell>₪{((harvest.quantity || 0) * (harvest.price_per_unit || 0)).toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sprayings">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>דוח ריסוסים</CardTitle>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => exportToExcel(filteredSprayings, "sprayings_report")}>
                  <Download className="w-4 h-4 ml-2" />יצוא
                </Button>
                <Button variant="outline" size="sm" onClick={() => printReport(filteredSprayings, "sprayings")}>
                  <Printer className="w-4 h-4 ml-2" />הדפסה
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>תאריך</TableHead>
                    <TableHead>מזרע</TableHead>
                    <TableHead>סוג טיפול</TableHead>
                    <TableHead>זמן טיפול</TableHead>
                    <TableHead>חומרים מיושמים</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredSprayings.map(spraying => (
                    <TableRow key={spraying.id}>
                      <TableCell>{format(new Date(spraying.date), "dd/MM/yyyy")}</TableCell>
                      <TableCell>{getSeedingName(spraying.seeding_id)}</TableCell>
                      <TableCell>{spraying.treatment_type}</TableCell>
                      <TableCell>{spraying.treatment_time}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {spraying.applied_pesticides?.map((p, i) => (
                            <Badge key={i} variant="secondary" className="text-xs">
                              {p.pesticide_name}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
