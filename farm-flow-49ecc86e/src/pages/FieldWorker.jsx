import React, { useState, useEffect } from "react";
import { User, Farm, Seeding, Harvest, Activity, ActivityType, Variety, Crop, Packaging, Product } from "@/entities/all";
import { varietiesForSeeding, packagingsForSeeding } from "@/lib/seedingFilters";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/use-toast";
import { Globe, CheckCircle, Sprout, ClipboardList, LogOut } from "lucide-react";
import { format } from "date-fns";

const translations = {
  en: {
    title: "Field Work Entry",
    selectLanguage: "Select Language",
    logout: "Log out",
    harvest: "Harvest",
    activity: "Activity",
    seeding: "Plot",
    selectPlot: "Select a plot",
    date: "Date",
    quantity: "Quantity (kg)",
    quality: "Quality (optional)",
    variety: "Variety",
    varieties: "Varieties",
    packageCount: "Package Count",
    packaging: "Packaging",
    selectPackaging: "Select packaging",
    expectedWeight: "Expected weight (kg)",
    pricePerUnit: "Price per unit (₪)",
    notes: "Notes",
    notesPlaceholder: "Additional notes...",
    activityType: "Activity Type",
    description: "Description",
    submit: "Submit",
    success: "Success",
    error: "Error",
    harvestRecorded: "Harvest recorded successfully",
    activityRecorded: "Activity recorded successfully",
    fillAllFields: "Please fill all required fields",
    selectSeeding: "Select plot",
    selectQuality: "Select quality",
    selectVariety: "Select variety",
    selectActivity: "Select activity type",
    qualityA: "A",
    qualityB: "B",
    qualityC: "C",
    qualityIndustrial: "Industrial",
    noSeedings: "No active plots",
    noVarieties: "No varieties available",
    addVarietyQuantity: "Enter quantity for each variety",
  },
  th: {
    title: "บันทึกการทำงานในไร่",
    selectLanguage: "เลือกภาษา",
    logout: "ออกจากระบบ",
    harvest: "เก็บเกี่ยว",
    activity: "กิจกรรม",
    seeding: "แปลง",
    selectPlot: "เลือกแปลง",
    date: "วันที่",
    quantity: "ปริมาณ (กก.)",
    quality: "คุณภาพ (ไม่บังคับ)",
    variety: "พันธุ์",
    varieties: "พันธุ์",
    packageCount: "จำนวนกล่อง",
    packaging: "บรรจุภัณฑ์",
    selectPackaging: "เลือกบรรจุภัณฑ์",
    expectedWeight: "น้ำหนักโดยประมาณ (กก.)",
    pricePerUnit: "ราคาต่อหน่วย (₪)",
    notes: "หมายเหตุ",
    notesPlaceholder: "หมายเหตุเพิ่มเติม...",
    activityType: "ประเภทกิจกรรม",
    description: "รายละเอียด",
    submit: "บันทึก",
    success: "สำเร็จ",
    error: "ผิดพลาด",
    harvestRecorded: "บันทึกการเก็บเกี่ยวเรียบร้อยแล้ว",
    activityRecorded: "บันทึกกิจกรรมเรียบร้อยแล้ว",
    fillAllFields: "กรุณากรอกข้อมูลที่จำเป็นให้ครบถ้วน",
    selectSeeding: "เลือกแปลง",
    selectQuality: "เลือกคุณภาพ",
    selectVariety: "เลือกพันธุ์",
    selectActivity: "เลือกประเภทกิจกรรม",
    qualityA: "A",
    qualityB: "B",
    qualityC: "C",
    qualityIndustrial: "แปรรูป",
    noSeedings: "ไม่มีแปลงที่ใช้งาน",
    noVarieties: "ไม่มีพันธุ์",
    addVarietyQuantity: "ระบุปริมาณสำหรับแต่ละพันธุ์",
  }
};

// Seeding statuses considered "active" (mirrors the Seedings page "פעילים" filter).
const ACTIVE_SEEDING_STATUSES = ['ordered', 'growing', 'harvesting', 'preparation'];

export default function FieldWorker() {
  const [language, setLanguage] = useState("th");
  const [me, setMe] = useState(null);
  const [currentFarm, setCurrentFarm] = useState(null);
  const [seedings, setSeedings] = useState([]);
  const [varieties, setVarieties] = useState([]);
  const [activityTypes, setActivityTypes] = useState([]);
  const [crops, setCrops] = useState([]);
  const [packagings, setPackagings] = useState([]);
  const [products, setProducts] = useState([]);
  const { toast } = useToast();
  const t = translations[language];

  const [translatedNames, setTranslatedNames] = useState({});

  const EMPTY_HARVEST = {
    seeding_id: "",
    date: format(new Date(), 'yyyy-MM-dd'),
    variety: "",          // variety id
    packaging: "",        // packaging name
    package_count: "",
    weight: "",           // expected weight (kg), auto-calculated but editable
    quality: "",
    price_per_unit: "",
    notes: "",
  };
  const [harvestForm, setHarvestForm] = useState(EMPTY_HARVEST);

  const [activityForm, setActivityForm] = useState({
    seeding_id: "",
    date: format(new Date(), 'yyyy-MM-dd'),
    activity_type: "",
    description: ""
  });

  useEffect(() => {
    loadData();
  }, []);

  // Auto-calculate expected weight = package_count × packaging.expected_weight (editable).
  useEffect(() => {
    if (harvestForm.package_count && harvestForm.packaging) {
      const p = packagings.find(x => x.name === harvestForm.packaging);
      if (p && typeof p.expected_weight === 'number') {
        const w = (parseFloat(harvestForm.package_count) * p.expected_weight);
        if (!isNaN(w)) setHarvestForm(prev => ({ ...prev, weight: w.toFixed(2) }));
      }
    }
  }, [harvestForm.package_count, harvestForm.packaging, packagings]);

  const getSeedingDisplayName = (seeding) => {
    if (language === 'en' || language === 'th') {
      return seeding.name_en || seeding.name;
    }
    return seeding.name;
  };

  const getVarietyDisplayName = (variety) => {
    if (language === 'en' || language === 'th') {
      return variety.name_en || variety.name;
    }
    return variety.name;
  };

  // Activity type / crop names also prefer English in the field-worker UI.
  const getActivityTypeName = (at) => ((language === 'en' || language === 'th') ? (at.name_en || at.name) : at.name);
  const getCropName = (cropName) => {
    if (language !== 'en' && language !== 'th') return cropName;
    const c = crops.find(x => x.name === cropName);
    return c?.name_en || cropName;
  };

  const loadData = async () => {
    try {
      const user = await User.me();
      setMe(user);
      if (user.language === 'en' || user.language === 'th') setLanguage(user.language);
      if (!user.current_farm_id) return;

      const farm = await Farm.get(user.current_farm_id);
      setCurrentFarm(farm);

      const [seedingsData, activityTypesData, varietiesData, cropsData, packagingsData, productsData] = await Promise.all([
        Seeding.filter({
          farm_id: user.current_farm_id
        }).catch(() => []),
        ActivityType.filter({ farm_id: user.current_farm_id }).catch(() => []),
        Variety.filter({ farm_id: user.current_farm_id }).catch(() => []),
        Crop.filter({ farm_id: user.current_farm_id }).catch(() => []),
        Packaging.filter({ farm_id: user.current_farm_id }).catch(() => []),
        Product.filter({ farm_id: user.current_farm_id }).catch(() => [])
      ]);

      // Only active seedings are pickable for harvest/activity entry.
      const activeSeedings = (Array.isArray(seedingsData) ? seedingsData : [])
        .filter(s => ACTIVE_SEEDING_STATUSES.includes(s.status));

      setSeedings(activeSeedings);
      setActivityTypes(Array.isArray(activityTypesData) ? activityTypesData : []);
      setVarieties(Array.isArray(varietiesData) ? varietiesData : []);
      setCrops(Array.isArray(cropsData) ? cropsData : []);
      setPackagings(Array.isArray(packagingsData) ? packagingsData : []);
      setProducts(Array.isArray(productsData) ? productsData : []);
    } catch (error) {
      console.error("Error loading data:", error);
    }
  };

  // Persist the language choice so it sticks across logins.
  const changeLanguage = (lang) => {
    setLanguage(lang);
    User.updateMyUserData({ language: lang }).catch(() => {});
  };

  const handleLogout = () => {
    try { User.logout(); } catch { window.location.href = '/login'; }
  };

  const handleHarvestSubmit = async (e) => {
    e.preventDefault();

    // Same required fields as the main harvest form: plot, variety, and a quantity.
    if (!harvestForm.seeding_id || !harvestForm.variety || (!harvestForm.weight && !harvestForm.package_count)) {
      toast({ title: t.error, description: t.fillAllFields, variant: "destructive" });
      return;
    }

    try {
      const selectedVariety = varieties.find(v => v.id === harvestForm.variety);
      const weight = parseFloat(harvestForm.weight) || 0;
      await Harvest.create({
        farm_id: currentFarm.id,
        seeding_id: harvestForm.seeding_id,
        date: harvestForm.date,
        variety: selectedVariety?.name || '',
        packaging: harvestForm.packaging || '',
        package_count: harvestForm.package_count ? parseInt(harvestForm.package_count) : 0,
        weight,
        quantity: weight,
        quality: harvestForm.quality || '',
        price_per_unit: parseFloat(harvestForm.price_per_unit) || 0,
        notes: harvestForm.notes || '',
      });

      toast({ title: t.success, description: t.harvestRecorded, duration: 3000 });
      setHarvestForm({ ...EMPTY_HARVEST, date: harvestForm.date });
    } catch (error) {
      console.error("Error recording harvest:", error);
      toast({ title: t.error, description: error.message, variant: "destructive" });
    }
  };

  const handleActivitySubmit = async (e) => {
    e.preventDefault();
    
    if (!activityForm.seeding_id || !activityForm.activity_type) {
      toast({
        title: t.error,
        description: t.fillAllFields,
        variant: "destructive"
      });
      return;
    }

    try {
      await Activity.create({
        farm_id: currentFarm.id,
        seeding_id: activityForm.seeding_id,
        date: activityForm.date,
        activity_type: activityForm.activity_type,
        description: activityForm.description
      });

      toast({
        title: t.success,
        description: t.activityRecorded,
        duration: 3000,
      });

      setActivityForm({
        seeding_id: "",
        date: format(new Date(), 'yyyy-MM-dd'),
        activity_type: "",
        description: ""
      });
    } catch (error) {
      console.error("Error recording activity:", error);
      toast({
        title: t.error,
        description: error.message,
        variant: "destructive"
      });
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-blue-50 p-4">
      <div className="max-w-2xl mx-auto">
        {/* Language Selector + logout */}
        <Card className="mb-6">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Globe className="w-5 h-5 text-blue-600" />
                <span className="font-medium">{t.selectLanguage}</span>
              </div>
              <div className="flex gap-2">
                <Button
                  variant={language === "en" ? "default" : "outline"}
                  onClick={() => changeLanguage("en")}
                  size="sm"
                >
                  English
                </Button>
                <Button
                  variant={language === "th" ? "default" : "outline"}
                  onClick={() => changeLanguage("th")}
                  size="sm"
                >
                  ไทย
                </Button>
              </div>
            </div>
            <div className="flex items-center justify-between gap-2 border-t pt-3">
              <span className="text-sm text-gray-600 truncate">
                {me?.full_name || me?.email || ""}{currentFarm?.name ? ` · ${currentFarm.name}` : ""}
              </span>
              <Button variant="ghost" size="sm" onClick={handleLogout} className="text-gray-500 hover:text-red-600">
                <LogOut className="w-4 h-4 mr-1" />
                {t.logout}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Main Title */}
        <h1 className="text-3xl font-bold text-center mb-6 text-gray-800">
          {t.title}
        </h1>

        {/* Forms */}
        <Tabs defaultValue="harvest" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="harvest" className="flex items-center gap-2">
              <Sprout className="w-4 h-4" />
              {t.harvest}
            </TabsTrigger>
            <TabsTrigger value="activity" className="flex items-center gap-2">
              <ClipboardList className="w-4 h-4" />
              {t.activity}
            </TabsTrigger>
          </TabsList>

          {/* Harvest Form */}
          <TabsContent value="harvest">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Sprout className="w-5 h-5 text-green-600" />
                  {t.harvest}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleHarvestSubmit} className="space-y-6">
                  {/* Date */}
                  <div>
                    <Label>{t.date} *</Label>
                    <Input
                      type="date"
                      value={harvestForm.date}
                      onChange={(e) => setHarvestForm({...harvestForm, date: e.target.value})}
                      required
                      className="text-lg"
                    />
                  </div>

                  {/* Seeding Selection as Cards */}
                  <div>
                    <Label className="block mb-3">{t.selectPlot} *</Label>
                    {seedings.length === 0 ? (
                      <p className="text-gray-500 text-center py-4">{t.noSeedings}</p>
                    ) : (
                      <div className="grid grid-cols-1 gap-3">
                        {seedings.map(s => (
                          <Card
                            key={s.id}
                            className={`cursor-pointer transition-all ${
                              harvestForm.seeding_id === s.id
                                ? 'ring-2 ring-green-500 bg-green-50'
                                : 'hover:bg-gray-50'
                            }`}
                            onClick={() => {
                              setHarvestForm({...harvestForm, seeding_id: s.id, variety: ''});
                            }}
                          >
                            <CardContent className="p-4">
                              <div className="flex items-center justify-between">
                                <div>
                                  <h3 className="font-semibold text-lg">{getSeedingDisplayName(s)}</h3>
                                  {s.crop_type && (
                                    <p className="text-sm text-gray-600">{getCropName(s.crop_type)}</p>
                                  )}
                                </div>
                                {harvestForm.seeding_id === s.id && (
                                  <CheckCircle className="w-6 h-6 text-green-600" />
                                )}
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Harvest details — shown only after a plot is selected */}
                  {harvestForm.seeding_id && (() => {
                    const selectedSeeding = seedings.find(s => s.id === harvestForm.seeding_id);
                    const relevantVarieties = varietiesForSeeding(selectedSeeding, varieties);
                    const relevantPackagings = packagingsForSeeding(selectedSeeding, packagings, products);

                    return (
                      <div className="space-y-6">
                        {/* Variety */}
                        <div>
                          <Label>{t.variety} *</Label>
                          {relevantVarieties.length === 0 ? (
                            <p className="text-gray-500 text-center py-4">{t.noVarieties}</p>
                          ) : (
                            <Select value={harvestForm.variety} onValueChange={(v) => setHarvestForm({...harvestForm, variety: v})}>
                              <SelectTrigger className="text-lg"><SelectValue placeholder={t.selectVariety} /></SelectTrigger>
                              <SelectContent>
                                {relevantVarieties.map(v => (
                                  <SelectItem key={v.id} value={v.id}>{getVarietyDisplayName(v)}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        </div>

                        {/* Packaging */}
                        <div>
                          <Label>{t.packaging}</Label>
                          <Select value={harvestForm.packaging} onValueChange={(v) => setHarvestForm({...harvestForm, packaging: v})}>
                            <SelectTrigger className="text-lg"><SelectValue placeholder={t.selectPackaging} /></SelectTrigger>
                            <SelectContent>
                              {relevantPackagings.map(p => (
                                <SelectItem key={p.id} value={p.name}>
                                  {(language === 'en' || language === 'th') ? (p.name_en || p.name) : p.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        {/* Package count */}
                        <div>
                          <Label>{t.packageCount}</Label>
                          <Input type="number" inputMode="numeric" placeholder="100"
                            value={harvestForm.package_count}
                            onChange={(e) => setHarvestForm({...harvestForm, package_count: e.target.value})}
                            className="text-lg" />
                        </div>

                        {/* Expected weight (auto from packaging × count, editable) */}
                        <div>
                          <Label>{t.expectedWeight}</Label>
                          <Input type="number" step="0.1"
                            value={harvestForm.weight}
                            onChange={(e) => setHarvestForm({...harvestForm, weight: e.target.value})}
                            className="text-lg" />
                        </div>

                        {/* Quality */}
                        <div>
                          <Label>{t.quality}</Label>
                          <Select value={harvestForm.quality} onValueChange={(value) => setHarvestForm({...harvestForm, quality: value})}>
                            <SelectTrigger><SelectValue placeholder={t.selectQuality} /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="א">{t.qualityA}</SelectItem>
                              <SelectItem value="ב">{t.qualityB}</SelectItem>
                              <SelectItem value="ג">{t.qualityC}</SelectItem>
                              <SelectItem value="תעשייתי">{t.qualityIndustrial}</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        {/* Price per unit */}
                        <div>
                          <Label>{t.pricePerUnit}</Label>
                          <Input type="number" step="0.01"
                            value={harvestForm.price_per_unit}
                            onChange={(e) => setHarvestForm({...harvestForm, price_per_unit: e.target.value})}
                            className="text-lg" />
                        </div>

                        {/* Notes */}
                        <div>
                          <Label>{t.notes}</Label>
                          <Textarea placeholder={t.notesPlaceholder}
                            value={harvestForm.notes}
                            onChange={(e) => setHarvestForm({...harvestForm, notes: e.target.value})} />
                        </div>
                      </div>
                    );
                  })()}

                  <Button
                    type="submit"
                    className="w-full bg-green-600 hover:bg-green-700 text-lg py-6"
                    disabled={!harvestForm.seeding_id || !harvestForm.variety || (!harvestForm.weight && !harvestForm.package_count)}
                  >
                    <CheckCircle className="w-5 h-5 mr-2" />
                    {t.submit}
                  </Button>
                </form>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Activity Form */}
          <TabsContent value="activity">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ClipboardList className="w-5 h-5 text-blue-600" />
                  {t.activity}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleActivitySubmit} className="space-y-6">
                  <div>
                    <Label>{t.date} *</Label>
                    <Input
                      type="date"
                      value={activityForm.date}
                      onChange={(e) => setActivityForm({...activityForm, date: e.target.value})}
                      required
                      className="text-lg"
                    />
                  </div>

                  {/* Seeding Selection as Cards */}
                  <div>
                    <Label className="block mb-3">{t.selectPlot} *</Label>
                    {seedings.length === 0 ? (
                      <p className="text-gray-500 text-center py-4">{t.noSeedings}</p>
                    ) : (
                      <div className="grid grid-cols-1 gap-3">
                        {seedings.map(s => (
                          <Card
                            key={s.id}
                            className={`cursor-pointer transition-all ${
                              activityForm.seeding_id === s.id
                                ? 'ring-2 ring-blue-500 bg-blue-50'
                                : 'hover:bg-gray-50'
                            }`}
                            onClick={() => setActivityForm({...activityForm, seeding_id: s.id})}
                          >
                            <CardContent className="p-4">
                              <div className="flex items-center justify-between">
                                <div>
                                  <h3 className="font-semibold text-lg">{getSeedingDisplayName(s)}</h3>
                                  {s.crop_type && (
                                    <p className="text-sm text-gray-600">{getCropName(s.crop_type)}</p>
                                  )}
                                </div>
                                {activityForm.seeding_id === s.id && (
                                  <CheckCircle className="w-6 h-6 text-blue-600" />
                                )}
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    )}
                  </div>

                  <div>
                    <Label>{t.activityType} *</Label>
                    <Select
                      value={activityForm.activity_type}
                      onValueChange={(value) => setActivityForm({...activityForm, activity_type: value})}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={t.selectActivity} />
                      </SelectTrigger>
                      <SelectContent>
                        {activityTypes.map(at => (
                          <SelectItem key={at.id} value={at.name}>{getActivityTypeName(at)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label>{t.description}</Label>
                    <Input
                      value={activityForm.description}
                      onChange={(e) => setActivityForm({...activityForm, description: e.target.value})}
                      className="text-lg"
                    />
                  </div>

                  <Button 
                    type="submit" 
                    className="w-full bg-blue-600 hover:bg-blue-700 text-lg py-6"
                    disabled={!activityForm.seeding_id || !activityForm.activity_type}
                  >
                    <CheckCircle className="w-5 h-5 mr-2" />
                    {t.submit}
                  </Button>
                </form>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}