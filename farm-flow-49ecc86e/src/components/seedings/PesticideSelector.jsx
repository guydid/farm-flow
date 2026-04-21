
import React, { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Search, Check, X, ArrowLeft, RefreshCw, ChevronLeft } from "lucide-react";

export default function PesticideSelector({
  pesticides,
  selectedPesticides,
  onSelectionChange,
  onClose,
  seedingArea,
}) {
  const [searchTerm, setSearchTerm] = useState("");
  const [activeCategory, setActiveCategory] = useState("all");
  const [treatedArea, setTreatedArea] = useState(seedingArea || "");
  const [showSelected, setShowSelected] = useState(false);

  // Group pesticides by category
  const categorizedPesticides = useMemo(() => {
    const categories = {
      all: pesticides || [],
      fungicide: (pesticides || []).filter(p => p.category === "fungicide"),
      insecticide: (pesticides || []).filter(p => p.category === "insecticide"), 
      herbicide: (pesticides || []).filter(p => p.category === "herbicide"),
      other: (pesticides || []).filter(p => !["fungicide", "insecticide", "herbicide"].includes(p.category))
    };

    // Apply search filter
    if (searchTerm) {
      Object.keys(categories).forEach(key => {
        categories[key] = categories[key].filter(p =>
          (p.name?.toLowerCase() || '').includes(searchTerm.toLowerCase()) ||
          (p.active_ingredient?.toLowerCase() || '').includes(searchTerm.toLowerCase())
        );
      });
    }

    return categories;
  }, [pesticides, searchTerm]);

  const isSelected = (pesticideId) => {
    return selectedPesticides.some((p) => p.pesticide_id === pesticideId);
  };

  const handleTogglePesticide = (pesticide) => {
    if (isSelected(pesticide.id)) {
      const newSelection = selectedPesticides.filter((p) => p.pesticide_id !== pesticide.id);
      onSelectionChange(newSelection);
    } else {
      const calculatedQty =
        pesticide.recommended_dosage_per_dunam && treatedArea
          ? (pesticide.recommended_dosage_per_dunam * parseFloat(treatedArea)).toFixed(2)
          : "";
      const newPesticide = {
        pesticide_id: pesticide.id,
        pesticide_name: pesticide.name,
        quantity: calculatedQty,
        unit: pesticide.unit || 'מ"ל',
      };
      onSelectionChange([...selectedPesticides, newPesticide]);
    }
  };

  const updateQuantity = (pesticideId, quantity) => {
    const newSelection = selectedPesticides.map((p) =>
      p.pesticide_id === pesticideId ? { ...p, quantity } : p
    );
    onSelectionChange(newSelection);
  };

  const handleRecalculateQuantities = () => {
    if (!treatedArea) return;
    const newSelection = selectedPesticides.map((sp) => {
      const pesticideData = pesticides.find((p) => p.id === sp.pesticide_id);
      if (pesticideData && pesticideData.recommended_dosage_per_dunam) {
        const calculatedQty = (
          pesticideData.recommended_dosage_per_dunam * parseFloat(treatedArea)
        ).toFixed(2);
        return { ...sp, quantity: calculatedQty };
      }
      return sp;
    });
    onSelectionChange(newSelection);
  };

  const categoryLabels = {
    all: "הכל",
    fungicide: "קוטלי פטריות",
    insecticide: "קוטלי חרקים",
    herbicide: "קוטלי עשבים",
    other: "אחר",
  };

  const getCategoryColor = (category) => {
    const colors = {
      fungicide: "bg-green-100 text-green-800",
      insecticide: "bg-red-100 text-red-800",
      herbicide: "bg-yellow-100 text-yellow-800",
      other: "bg-gray-100 text-gray-800",
    };
    return colors[category] || colors.other;
  };

  const PesticideCard = ({ pesticide }) => {
    const selected = isSelected(pesticide.id);
    return (
      <Card
        className={`cursor-pointer transition-all hover:shadow-md ${
          selected ? "ring-2 ring-blue-500 bg-blue-50" : "hover:bg-gray-50"
        }`}
        onClick={() => handleTogglePesticide(pesticide)}
      >
        <CardContent className="p-4">
          <div className="flex items-start justify-between mb-3">
            <div className="flex-1 ml-2">
              <div className="flex items-center gap-2 mb-2">
                <h3 className="font-semibold text-gray-900 text-sm leading-tight">
                  {pesticide.name || "ללא שם"}
                </h3>
                {selected && <Check className="w-4 h-4 text-blue-600 flex-shrink-0" />}
              </div>
              {pesticide.active_ingredient && (
                <p className="text-xs text-gray-600 mb-1">
                  <strong>חומר פעיל:</strong> {pesticide.active_ingredient}
                </p>
              )}
            </div>
            <Badge className={`${getCategoryColor(pesticide.category)} text-xs flex-shrink-0`}>
              {categoryLabels[pesticide.category] || categoryLabels.other}
            </Badge>
          </div>
          {(pesticide.crop || pesticide.pest) && (
            <div className="space-y-1 mb-3">
              {pesticide.crop && (
                <p className="text-xs text-gray-500 truncate" title={pesticide.crop}>
                  <strong>גידולים:</strong> {pesticide.crop}
                </p>
              )}
              {pesticide.pest && (
                <p className="text-xs text-gray-500 truncate" title={pesticide.pest}>
                  <strong>נגעים:</strong> {pesticide.pest}
                </p>
              )}
            </div>
          )}
          {pesticide.recommended_dosage_per_dunam && (
            <div className="bg-blue-50 p-2 rounded text-xs">
              <strong>מינון מומלץ:</strong> {pesticide.recommended_dosage_per_dunam} {pesticide.unit || 'מ"ל'} לדונם
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  // Mobile view - show selected pesticides
  if (showSelected) {
    return (
      <div className="fixed inset-0 bg-white z-50 flex flex-col md:hidden">
        <div className="bg-white border-b p-4 flex items-center">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowSelected(false)}
            className="mr-3"
          >
            <ChevronLeft className="w-5 h-5" />
          </Button>
          <h2 className="text-lg font-semibold">תכשירים נבחרים ({selectedPesticides.length})</h2>
        </div>

        <div className="flex-1 p-4">
          {/* Area calculator */}
          <div className="bg-gray-50 p-4 rounded-lg mb-4">
            <div className="flex items-center gap-2 mb-2">
              <Label>שטח מטופל (דונם):</Label>
              <div className="flex items-center gap-2 flex-1">
                <Input
                  type="number"
                  placeholder="0"
                  value={treatedArea}
                  onChange={(e) => setTreatedArea(e.target.value)}
                  className="flex-1"
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleRecalculateQuantities}
                  disabled={!treatedArea || selectedPesticides.length === 0}
                  className="gap-1"
                >
                  <RefreshCw className="w-3 h-3" />
                  חשב מחדש
                </Button>
              </div>
            </div>
            <p className="text-xs text-gray-600">
              הזן שטח וקליק "חשב מחדש" לחישוב אוטומטי של כמויות
            </p>
          </div>

          <div className="space-y-3">
            {selectedPesticides.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                לא נבחרו תכשירים עדיין
              </div>
            ) : (
              selectedPesticides.map((pesticide, index) => (
                <Card key={index} className="border-l-4 border-blue-500">
                  <CardContent className="p-4">
                    <div className="flex justify-between items-start mb-2">
                      <h3 className="font-medium text-sm">{pesticide.pesticide_name}</h3>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          const newSelection = selectedPesticides.filter((_, i) => i !== index);
                          onSelectionChange(newSelection);
                        }}
                        className="h-6 w-6"
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        placeholder="כמות"
                        value={pesticide.quantity}
                        onChange={(e) => updateQuantity(pesticide.pesticide_id, e.target.value)}
                        className="flex-1"
                      />
                      <span className="text-sm text-gray-600 w-12">{pesticide.unit}</span>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </div>

        <div className="p-4 border-t bg-white">
          <div className="flex gap-3">
            <Button variant="outline" onClick={onClose} className="flex-1">
              ביטול
            </Button>
            <Button onClick={onClose} className="flex-1">
              אישור ({selectedPesticides.length})
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Main view
  return (
    <div className="fixed inset-0 bg-white z-50 flex flex-col">
      {/* Header */}
      <div className="bg-white border-b p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={onClose}>
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <h1 className="text-xl font-semibold">בחירת חומרי הדברה</h1>
          </div>
          
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowSelected(true)}
              className="md:hidden"
            >
              נבחרו ({selectedPesticides.length})
            </Button>
            <Button size="sm" onClick={onClose}>
              אישור
            </Button>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="w-4 h-4 absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
          <Input
            placeholder="חיפוש לפי שם תכשיר או חומר פעיל..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pr-10"
          />
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left Panel - Pesticides List */}
        <div className="flex-1 md:flex-none md:w-2/3 flex flex-col">
          <Tabs value={activeCategory} onValueChange={setActiveCategory} className="flex-1 flex flex-col">
            <TabsList className="w-full justify-start p-4 bg-gray-50">
              {Object.entries(categoryLabels).map(([key, label]) => (
                <TabsTrigger key={key} value={key} className="text-sm">
                  {label} ({categorizedPesticides[key]?.length || 0})
                </TabsTrigger>
              ))}
            </TabsList>

            <div className="flex-1 overflow-hidden">
              {Object.entries(categoryLabels).map(([key]) => (
                <TabsContent key={key} value={key} className="h-full mt-0">
                  <div className="h-full overflow-y-auto p-4 space-y-3">
                    {categorizedPesticides[key]?.length > 0 ? (
                      categorizedPesticides[key].map((pesticide) => (
                        <PesticideCard key={pesticide.id} pesticide={pesticide} />
                      ))
                    ) : (
                      <div className="text-center py-8 text-gray-500">
                        לא נמצאו תכשירים בקטגוריה זו
                      </div>
                    )}
                  </div>
                </TabsContent>
              ))}
            </div>
          </Tabs>
        </div>

        {/* Right Panel - Desktop Only */}
        <div className="hidden md:flex md:w-1/3 border-r flex-col">
          <div className="p-4 border-b bg-gray-50">
            <h2 className="font-semibold mb-4">תכשירים נבחרים ({selectedPesticides.length})</h2>
            
            {/* Area calculator */}
            <div className="bg-white p-3 rounded-lg mb-4">
              <Label className="text-sm font-medium block mb-2">שטח מטופל (דונם):</Label>
              <div className="flex gap-2">
                <Input
                  type="number"
                  placeholder="0"
                  value={treatedArea}
                  onChange={(e) => setTreatedArea(e.target.value)}
                  className="flex-1"
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleRecalculateQuantities}
                  disabled={!treatedArea || selectedPesticides.length === 0}
                >
                  <RefreshCw className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>

          <div className="flex-1 p-4 overflow-y-auto space-y-3">
            {selectedPesticides.length === 0 ? (
              <div className="text-center py-8 text-gray-500 text-sm">
                לא נבחרו תכשירים עדיין
              </div>
            ) : (
              selectedPesticides.map((pesticide, index) => (
                <Card key={index} className="border-l-4 border-blue-500">
                  <CardContent className="p-3">
                    <div className="flex justify-between items-start mb-2">
                      <h3 className="font-medium text-sm">{pesticide.pesticide_name}</h3>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          const newSelection = selectedPesticides.filter((_, i) => i !== index);
                          onSelectionChange(newSelection);
                        }}
                        className="h-6 w-6"
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        placeholder="כמות"
                        value={pesticide.quantity}
                        onChange={(e) => updateQuantity(pesticide.pesticide_id, e.target.value)}
                        className="flex-1 text-sm"
                      />
                      <span className="text-xs text-gray-600 w-10">{pesticide.unit}</span>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
