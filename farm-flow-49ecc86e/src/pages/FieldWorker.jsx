import React, { useState, useEffect } from "react";
import { User, Farm, Seeding, Harvest, Activity, ActivityType, Variety } from "@/entities/all";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/use-toast";
import { Globe, CheckCircle, Sprout, ClipboardList } from "lucide-react";
import { format } from "date-fns";

const translations = {
  en: {
    title: "Field Work Entry",
    selectLanguage: "Select Language",
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

export default function FieldWorker() {
  const [language, setLanguage] = useState("en");
  const [currentFarm, setCurrentFarm] = useState(null);
  const [seedings, setSeedings] = useState([]);
  const [varieties, setVarieties] = useState([]);
  const [activityTypes, setActivityTypes] = useState([]);
  const { toast } = useToast();
  const t = translations[language];

  const [translatedNames, setTranslatedNames] = useState({});

  const [harvestForm, setHarvestForm] = useState({
    seeding_id: "",
    date: format(new Date(), 'yyyy-MM-dd'),
    quality: "",
    package_count: "",
    varieties: [] // Array of { variety_id, variety_name, quantity }
  });

  const [activityForm, setActivityForm] = useState({
    seeding_id: "",
    date: format(new Date(), 'yyyy-MM-dd'),
    activity_type: "",
    description: ""
  });

  useEffect(() => {
    loadData();
  }, []);

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

  const loadData = async () => {
    try {
      const user = await User.me();
      if (!user.current_farm_id) return;

      const farm = await Farm.get(user.current_farm_id);
      setCurrentFarm(farm);

      const [seedingsData, activityTypesData, varietiesData] = await Promise.all([
        Seeding.filter({ 
          farm_id: user.current_farm_id
        }).catch(() => []),
        ActivityType.filter({ farm_id: user.current_farm_id }).catch(() => []),
        Variety.filter({ farm_id: user.current_farm_id }).catch(() => [])
      ]);

      console.log('Loaded seedings:', seedingsData);
      console.log('Loaded activity types:', activityTypesData);
      console.log('Loaded varieties:', varietiesData);

      setSeedings(Array.isArray(seedingsData) ? seedingsData : []);
      setActivityTypes(Array.isArray(activityTypesData) ? activityTypesData : []);
      setVarieties(Array.isArray(varietiesData) ? varietiesData : []);
    } catch (error) {
      console.error("Error loading data:", error);
    }
  };

  const handleHarvestSubmit = async (e) => {
    e.preventDefault();
    
    if (!harvestForm.seeding_id || harvestForm.varieties.length === 0) {
      toast({
        title: t.error,
        description: t.fillAllFields,
        variant: "destructive"
      });
      return;
    }

    // Check that at least one variety has quantity
    const hasQuantity = harvestForm.varieties.some(v => v.quantity && parseFloat(v.quantity) > 0);
    if (!hasQuantity) {
      toast({
        title: t.error,
        description: t.fillAllFields,
        variant: "destructive"
      });
      return;
    }

    try {
      // Create a harvest record for each variety with quantity
      const harvestPromises = harvestForm.varieties
        .filter(v => v.quantity && parseFloat(v.quantity) > 0)
        .map(v => 
          Harvest.create({
            farm_id: currentFarm.id,
            seeding_id: harvestForm.seeding_id,
            date: harvestForm.date,
            quantity: parseFloat(v.quantity),
            quality: harvestForm.quality || '',
            variety: v.variety_name,
            package_count: harvestForm.package_count ? parseInt(harvestForm.package_count) : null
          })
        );
      
      await Promise.all(harvestPromises);

      toast({
        title: t.success,
        description: t.harvestRecorded,
        duration: 3000,
      });

      setHarvestForm({
        seeding_id: "",
        date: format(new Date(), 'yyyy-MM-dd'),
        quality: "",
        package_count: "",
        varieties: []
      });
    } catch (error) {
      console.error("Error recording harvest:", error);
      toast({
        title: t.error,
        description: error.message,
        variant: "destructive"
      });
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
        {/* Language Selector */}
        <Card className="mb-6">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Globe className="w-5 h-5 text-blue-600" />
                <span className="font-medium">{t.selectLanguage}</span>
              </div>
              <div className="flex gap-2">
                <Button
                  variant={language === "en" ? "default" : "outline"}
                  onClick={() => setLanguage("en")}
                  size="sm"
                >
                  English
                </Button>
                <Button
                  variant={language === "th" ? "default" : "outline"}
                  onClick={() => setLanguage("th")}
                  size="sm"
                >
                  ไทย
                </Button>
              </div>
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
                              setHarvestForm({...harvestForm, seeding_id: s.id, varieties: []});
                            }}
                          >
                            <CardContent className="p-4">
                              <div className="flex items-center justify-between">
                                <div>
                                  <h3 className="font-semibold text-lg">{getSeedingDisplayName(s)}</h3>
                                  {s.crop_type && (
                                    <p className="text-sm text-gray-600">{s.crop_type}</p>
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

                  {/* Varieties - shown only after seeding is selected */}
                  {harvestForm.seeding_id && (() => {
                    const selectedSeeding = seedings.find(s => s.id === harvestForm.seeding_id);
                    const seedingVarietyIds = (selectedSeeding?.varieties || []).map(v => v.variety_id);
                    const relevantVarieties = varieties.filter(v => seedingVarietyIds.includes(v.id));
                    
                    return (
                      <div>
                        <Label className="block mb-3">{t.varieties} *</Label>
                        {relevantVarieties.length === 0 ? (
                          <p className="text-gray-500 text-center py-4">{t.noVarieties}</p>
                        ) : (
                          <div className="space-y-3">
                            <p className="text-sm text-gray-600 mb-2">{t.addVarietyQuantity}</p>
                            {relevantVarieties.map(v => {
                            const varietyData = harvestForm.varieties.find(vf => vf.variety_id === v.id);
                            const isSelected = !!varietyData;
                            
                            return (
                              <Card
                                key={v.id}
                                className={`transition-all ${
                                  isSelected ? 'ring-2 ring-green-500 bg-green-50' : ''
                                }`}
                              >
                                <CardContent className="p-4">
                                  <div className="flex items-center justify-between gap-3">
                                    <div className="flex-1">
                                      <h4 className="font-medium">{getVarietyDisplayName(v)}</h4>
                                      {v.crop_type && (
                                        <p className="text-sm text-gray-600">{v.crop_type}</p>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <Input
                                        type="number"
                                        step="0.1"
                                        placeholder="0"
                                        value={varietyData?.quantity || ''}
                                        onChange={(e) => {
                                          const quantity = e.target.value;
                                          const newVarieties = harvestForm.varieties.filter(vf => vf.variety_id !== v.id);
                                          if (quantity) {
                                            newVarieties.push({
                                              variety_id: v.id,
                                              variety_name: v.name,
                                              quantity: quantity
                                            });
                                          }
                                          setHarvestForm({...harvestForm, varieties: newVarieties});
                                        }}
                                        className="w-24 text-lg text-center"
                                      />
                                      <span className="text-sm text-gray-600 w-8">kg</span>
                                    </div>
                                  </div>
                                </CardContent>
                              </Card>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    );
                  })()}

                  {/* Quality - optional */}
                  <div>
                    <Label>{t.quality}</Label>
                    <Select
                      value={harvestForm.quality}
                      onValueChange={(value) => setHarvestForm({...harvestForm, quality: value})}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={t.selectQuality} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="א">{t.qualityA}</SelectItem>
                        <SelectItem value="ב">{t.qualityB}</SelectItem>
                        <SelectItem value="ג">{t.qualityC}</SelectItem>
                        <SelectItem value="תעשייתי">{t.qualityIndustrial}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Package Count */}
                  <div>
                    <Label>{t.packageCount}</Label>
                    <Input
                      type="number"
                      value={harvestForm.package_count}
                      onChange={(e) => setHarvestForm({...harvestForm, package_count: e.target.value})}
                      className="text-lg"
                    />
                  </div>

                  <Button 
                    type="submit" 
                    className="w-full bg-green-600 hover:bg-green-700 text-lg py-6"
                    disabled={!harvestForm.seeding_id || harvestForm.varieties.length === 0}
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
                                    <p className="text-sm text-gray-600">{s.crop_type}</p>
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
                          <SelectItem key={at.id} value={at.name}>{at.name}</SelectItem>
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