
import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Check, ChevronsUpDown, Calculator, ExternalLink } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { useNavigate } from "react-router-dom";

// Helper functions outside component
const safeArray = (arr) => (Array.isArray(arr) ? arr : []);

const calculateWeights = (data, packagings, palletTypes) => {
  const gross = parseFloat(data.gross_weight) || 0;
  let tare = 0;

  if (data.packaging_type && data.package_count) {
    const packaging = packagings.find(p => p && p.name === data.packaging_type);
    if (packaging && packaging.tare_weight) {
      tare += (parseFloat(packaging.tare_weight) || 0) * (parseInt(data.package_count) || 0);
    }
  }

  // Changed to check for `data.pallet_type` directly, as it can be null/empty string for "no pallet"
  if (data.pallet_type) {
    const pallet = palletTypes.find(p => p && p.name === data.pallet_type);
    if (pallet && pallet.weight) {
      tare += parseFloat(pallet.weight) || 0;
    }
  }

  const net = gross > tare ? gross - tare : 0;
  return { tare_weight: tare, net_weight: net };
};

const calculateTotal = (data) => {
  const { net_weight, package_count, price_per_unit, discount_percentage, pricing_method } = data;
  const price = parseFloat(price_per_unit) || 0;
  const discount = parseFloat(discount_percentage) || 0;
  let subtotal = 0;

  if (pricing_method === 'per_kg') {
    subtotal = (parseFloat(net_weight) || 0) * price;
  } else { // per_unit
    subtotal = (parseInt(package_count) || 0) * price;
  }

  const total = discount > 0 && discount < 100 ? subtotal * (1 - discount / 100) : subtotal;
  return total;
};

// Main Component
export default function WeighingItemForm({ item, isCopyMode = false, onSubmit, onCancel, products, packagings, palletTypes, certificateCustomerId }) {
  const [formData, setFormData] = useState({
    product_id: "",
    product_name: "", // Added product_name to state
    quality: "א",
    packaging_type: "",
    package_count: "",
    pallet_type: "",
    gross_weight: "",
    pricing_method: "per_kg",
    price_per_unit: "",
    discount_percentage: "",
  });

  const [displayValues, setDisplayValues] = useState({
    tare_weight: "0.00",
    net_weight: "0.00",
    item_total: "0.00",
    calculated_subtotal: "0.00",
    calculated_discount_amount: "0.00",
  });

  const grossWeightRef = useRef(null);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth <= 768 || 'ontouchstart' in window);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Get selected product to check if weighable
  const selectedProduct = useMemo(() => {
    return safeArray(products).find(p => p && p.id === formData.product_id);
  }, [products, formData.product_id]);

  const isWeighable = useMemo(() => {
    // If selectedProduct is null/undefined, or its weighable property is true/undefined, it's weighable.
    // Only if weighable is explicitly false, it's not weighable.
    return selectedProduct?.weighable !== false; 
  }, [selectedProduct]);

  const performCalculations = useCallback(() => {
    const safePackagings = safeArray(packagings);
    const safePalletTypes = safeArray(palletTypes);

    let tare_weight_calc = 0;
    let net_weight_calc = 0;
    let total_calc = 0;
    let subtotal_calc = 0;
    let discountAmount_calc = 0;

    if (!isWeighable) {
      // For non-weighable items, tare and net are 0. Price is based on package count.
      total_calc = calculateTotal({ 
        net_weight: 0, 
        package_count: formData.package_count, 
        price_per_unit: formData.price_per_unit, 
        discount_percentage: formData.discount_percentage, 
        pricing_method: 'per_unit' // Force per_unit for non-weighable
      });
      
      const discount = parseFloat(formData.discount_percentage) || 0;
      subtotal_calc = (discount > 0 && discount < 100) ? (total_calc / (1 - discount / 100)) : total_calc;
      discountAmount_calc = subtotal_calc - total_calc;

    } else {
      // Original calculation for weighable items
      const { gross_weight, package_count, packaging_type, pallet_type, pricing_method, price_per_unit, discount_percentage } = formData;
      
      const { tare_weight, net_weight } = calculateWeights({ gross_weight, package_count, packaging_type, pallet_type }, safePackagings, safePalletTypes);
      tare_weight_calc = tare_weight;
      net_weight_calc = net_weight;

      total_calc = calculateTotal({ net_weight: net_weight_calc, package_count, price_per_unit, discount_percentage, pricing_method });
      
      const discount = parseFloat(discount_percentage) || 0;
      subtotal_calc = (discount > 0 && discount < 100) ? (total_calc / (1 - discount / 100)) : total_calc;
      discountAmount_calc = subtotal_calc - total_calc;
    }

    setDisplayValues({
      tare_weight: tare_weight_calc.toFixed(2),
      net_weight: net_weight_calc.toFixed(2),
      item_total: total_calc.toFixed(2),
      calculated_subtotal: subtotal_calc.toFixed(2),
      calculated_discount_amount: discountAmount_calc.toFixed(2),
    });
  }, [formData, packagings, palletTypes, isWeighable]);

  useEffect(() => {
    if (item) {
      const selectedProd = safeArray(products).find(p => p && p.id === item.product_id);
      setFormData({
        product_id: item.product_id || "",
        product_name: selectedProd ? selectedProd.name : '', // Set product_name on edit
        quality: item.quality || "א",
        packaging_type: item.packaging_type || "",
        package_count: item.package_count ? String(item.package_count) : "",
        pallet_type: item.pallet_type || "",
        gross_weight: item.gross_weight ? String(item.gross_weight) : "",
        pricing_method: item.pricing_method || "per_kg",
        price_per_unit: item.price_per_unit ? String(item.price_per_unit) : "",
        discount_percentage: item.discount_percentage ? String(item.discount_percentage) : "",
      });

      if (isCopyMode && !isMobile && selectedProd?.weighable !== false) {
        // Only focus gross weight if it's a weighable product in copy mode
        setTimeout(() => grossWeightRef.current?.focus(), 300);
      }
    }
  }, [item, isCopyMode, isMobile, products]); // Added products to dependency array for finding selectedProduct

  useEffect(() => {
    if (!isMobile) {
      performCalculations();
    }
  }, [formData, isMobile, performCalculations]);

  const handleBlur = useCallback(() => {
    if (isMobile) {
      performCalculations();
    }
  }, [isMobile, performCalculations]);

  const handleSubmit = useCallback(async (e) => { // Made async
    e.preventDefault();
    
    // Validation checks
    if (!formData.product_id) {
      alert('נא לבחור מוצר');
      return;
    }
    
    // Validate based on weighable status
    if (isWeighable && (!formData.gross_weight || parseFloat(formData.gross_weight) <= 0)) {
      alert('נא להזין משקל ברוטו תקין');
      return;
    }

    if (!isWeighable && (!formData.package_count || parseInt(formData.package_count) <= 0)) {
      alert('נא להזין כמות אריזות');
      return;
    }

    try {
      // Process form data to ensure numeric fields are properly formatted
      const processedData = {
        ...formData,
        // Convert numeric fields, ensuring empty strings become 0 or null
        package_count: formData.package_count !== "" ? parseInt(formData.package_count, 10) : 0,
        // Gross weight is 0 if not weighable, otherwise parse it
        gross_weight: isWeighable && formData.gross_weight !== "" ? parseFloat(formData.gross_weight) : 0,
        price_per_unit: formData.price_per_unit !== "" ? parseFloat(formData.price_per_unit) : 0,
        discount_percentage: formData.discount_percentage !== "" ? parseFloat(formData.discount_percentage) : 0,
        // Pricing method is forced to 'per_unit' if not weighable
        pricing_method: isWeighable ? formData.pricing_method : 'per_unit',
        
        // Calculated fields from display values, ensuring 0 for non-weighable
        tare_weight: isWeighable && displayValues.tare_weight !== "" ? parseFloat(displayValues.tare_weight) : 0,
        net_weight: isWeighable && displayValues.net_weight !== "" ? parseFloat(displayValues.net_weight) : 0,
        item_total: displayValues.item_total !== "" ? parseFloat(displayValues.item_total) : 0,
        pallet_type: isWeighable ? formData.pallet_type : '', // Clear pallet type if not weighable
        packaging_type: isWeighable ? formData.packaging_type : '', // Clear packaging type if not weighable
      };
      
      // Remove any undefined or NaN values for specific numeric keys, setting them to 0
      // This is a safety net after explicit parsing, particularly for `null` or `undefined` inputs
      Object.keys(processedData).forEach(key => {
        if (
          (typeof processedData[key] === 'number' && isNaN(processedData[key])) ||
          processedData[key] === undefined ||
          processedData[key] === null
        ) {
          // Apply 0 for keys that are expected to be numeric and nullable/undefined
          if (['package_count', 'gross_weight', 'price_per_unit', 'discount_percentage',
               'tare_weight', 'net_weight', 'item_total'].includes(key)) {
            processedData[key] = 0;
          } else if (key === 'pallet_type' || key === 'packaging_type') {
            // Ensure these are empty strings if null/undefined
            processedData[key] = '';
          }
        }
      });
      
      await onSubmit(processedData); // Await onSubmit
    } catch (error) {
      console.error('Error submitting item:', error);
      alert('שגיאה בשמירת הפריט: ' + (error.message || 'שגיאה לא ידועה'));
    }
  }, [formData, displayValues, onSubmit, isWeighable]);
  
  const navigate = useNavigate();
  const safeProducts = safeArray(products);
  const safePackagings = safeArray(packagings);
  const safePalletTypes = safeArray(palletTypes);

  // Helper: link shown next to label when list is empty
  const EmptyLink = ({ tab, label }) => (
    <button
      type="button"
      onClick={() => navigate(`/settings?tab=${tab}`)}
      className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-0.5 mr-auto"
    >
      {label} <ExternalLink className="w-3 h-3" />
    </button>
  );

  return (
    <Dialog open={true} onOpenChange={onCancel}>
      <DialogContent className="max-w-6xl max-h-screen overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-xl">
            {isCopyMode ? `העתקת פריט - ${formData.product_name || 'פריט חדש'}` : 
             item ? `עריכת פריט - ${formData.product_name || 'פריט'}` : 'הוספת פריט חדש'}
          </DialogTitle>
          {isCopyMode && (
            <DialogDescription className="text-green-600 font-medium">
              {isWeighable 
                ? 'הפריט הועתק עם כל הפרטים. עדכן את המשקל הברוטו ולחץ שמור.'
                : 'הפריט הועתק עם כל הפרטים. עדכן את הכמות ולחץ שמור.'
              }
            </DialogDescription>
          )}
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {/* Product Selection */}
            <div className="sm:col-span-2 lg:col-span-1">
              <div className="flex items-center gap-1 mb-1">
                <Label htmlFor="product_id">מוצר *</Label>
                {safeProducts.length === 0 && <EmptyLink tab="products" label="הוסף מוצרים" />}
              </div>
              {safeProducts.length === 0 ? (
                <div className="flex items-center justify-between p-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-700">
                  <span>אין מוצרים מוגדרים</span>
                  <button type="button" onClick={() => navigate('/settings?tab=products')} className="underline font-medium">הגדר כאן</button>
                </div>
              ) : (
                <Select
                  value={formData.product_id}
                  onValueChange={(value) => {
                    const selectedProd = safeArray(products).find(p => p && p.id === value);
                    setFormData(prev => ({
                      ...prev,
                      product_id: value,
                      product_name: selectedProd ? selectedProd.name : '',
                      pricing_method: selectedProd?.weighable === false ? 'per_unit' : (selectedProd?.default_pricing_method || 'per_kg'),
                      gross_weight: selectedProd?.weighable === false ? '' : prev.gross_weight,
                      pallet_type: selectedProd?.weighable === false ? '' : prev.pallet_type,
                      packaging_type: selectedProd?.weighable === false ? '' : prev.packaging_type,
                    }));
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="בחר מוצר..." />
                  </SelectTrigger>
                  <SelectContent>
                    {safeProducts.map(product => product && (
                      <SelectItem key={product.id} value={product.id}>
                        {product.name} {product.weighable === false && '(לא שקיל)'}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {/* Quality */}
            <div>
              <Label htmlFor="quality">איכות</Label>
              <Select
                value={formData.quality}
                onValueChange={(value) => setFormData(prev => ({ ...prev, quality: value }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="א">א</SelectItem>
                  <SelectItem value="ב">ב</SelectItem>
                  <SelectItem value="ג">ג</SelectItem>
                  <SelectItem value="תעשייתי">תעשייתי</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Packaging Type */}
            <div>
              <div className="flex items-center gap-1 mb-1">
                <Label htmlFor="packaging_type">סוג אריזה</Label>
                {safePackagings.length === 0 && isWeighable && <EmptyLink tab="packaging" label="הוסף אריזות" />}
              </div>
              {safePackagings.length === 0 && isWeighable ? (
                <div className="flex items-center justify-between p-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-700">
                  <span>אין אריזות מוגדרות</span>
                  <button type="button" onClick={() => navigate('/settings?tab=packaging')} className="underline font-medium">הגדר כאן</button>
                </div>
              ) : (
                <Select
                  value={formData.packaging_type}
                  onValueChange={(value) => setFormData(prev => ({ ...prev, packaging_type: value }))}
                  disabled={!isWeighable}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="בחר אריזה..." />
                  </SelectTrigger>
                  <SelectContent>
                    {safePackagings.map(pkg => pkg && (
                      <SelectItem key={pkg.id} value={pkg.name}>
                        {pkg.name} {isWeighable && `(טרה: ${pkg.tare_weight} ק"ג)`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {/* Package Count */}
            <div>
              <Label htmlFor="package_count">כמות אריזות {!isWeighable && '*'}</Label>
              <Input
                type="number"
                id="package_count"
                name="package_count"
                value={formData.package_count}
                onChange={(e) => setFormData(prev => ({ ...prev, package_count: e.target.value }))}
                onBlur={handleBlur}
                min="0"
                step="1"
                required={!isWeighable} // Required if not weighable
              />
            </div>

            {/* Gross Weight - only for weighable items */}
            {isWeighable && (
              <div>
                <Label htmlFor="gross_weight">משקל ברוטו (ק"ג) *</Label>
                <Input
                  ref={grossWeightRef}
                  type="number"
                  id="gross_weight"
                  name="gross_weight"
                  value={formData.gross_weight}
                  onChange={(e) => setFormData(prev => ({ ...prev, gross_weight: e.target.value }))}
                  onBlur={handleBlur}
                  min="0"
                  step="0.01"
                  required
                  className={isCopyMode ? "border-green-500 bg-green-50" : ""}
                  placeholder={isCopyMode ? "הכנס משקל ברוטו חדש" : "משקל ברוטו"}
                />
              </div>
            )}

            {/* Pallet Type - only for weighable items */}
            {isWeighable && (
              <div>
                <div className="flex items-center gap-1 mb-1">
                  <Label htmlFor="pallet_type">סוג משטח</Label>
                  {safePalletTypes.length === 0 && <EmptyLink tab="pallet-types" label="הוסף סוגי משטח" />}
                </div>
                <Select
                  value={formData.pallet_type || "none"}
                  onValueChange={(value) => setFormData(prev => ({ ...prev, pallet_type: value === "none" ? "" : value }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="בחר משטח..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">ללא משטח</SelectItem>
                    {safePalletTypes.map(pallet => pallet && (
                      <SelectItem key={pallet.id} value={pallet.name}>
                        {pallet.name} ({pallet.weight} ק"ג)
                      </SelectItem>
                    ))}
                    {safePalletTypes.length === 0 && (
                      <div className="px-3 py-2 text-xs text-gray-400 text-center">
                        אין סוגי משטח — הגדר בהגדרות
                      </div>
                    )}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {/* Weight Display Section - only for weighable items */}
          {isWeighable && (
            <div className="bg-gray-50 p-4 rounded-lg">
              <h3 className="font-semibold mb-3 flex items-center gap-2">
                <Calculator className="w-4 h-4" />
                חישובי משקל
              </h3>
              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <Label>טרה (ק"ג)</Label>
                  <Input
                    value={displayValues.tare_weight}
                    readOnly
                    className="bg-white font-mono"
                  />
                </div>
                <div>
                  <Label className="font-bold">נטו (ק"ג)</Label>
                  <Input
                    value={displayValues.net_weight}
                    readOnly
                    className="bg-white font-mono font-bold border-green-500"
                  />
                </div>
                <div className="sm:col-start-3 flex items-end">
                  {isMobile && (
                    <Button
                      type="button"
                      onClick={performCalculations}
                      variant="outline"
                      size="sm"
                      className="w-full"
                    >
                      <Calculator className="w-4 h-4 ml-2" />
                      חשב מחדש
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Pricing Section */}
          <div className="bg-blue-50 p-4 rounded-lg">
            <h3 className="font-semibold mb-3">תמחור</h3>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {/* Pricing Method - only for weighable items */}
              {isWeighable && (
                <div>
                  <Label htmlFor="pricing_method">שיטת תמחור</Label>
                  <Select
                    value={formData.pricing_method}
                    onValueChange={(value) => setFormData(prev => ({ ...prev, pricing_method: value }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="per_kg">לפי ק"ג</SelectItem>
                      <SelectItem value="per_unit">לפי יחידה</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              
              <div>
                <Label htmlFor="price_per_unit">
                  מחיר {isWeighable ? (formData.pricing_method === 'per_kg' ? 'לק"ג' : 'ליחידה') : 'ליחידה'} (₪)
                </Label>
                <Input
                  type="number"
                  id="price_per_unit"
                  name="price_per_unit"
                  value={formData.price_per_unit}
                  onChange={(e) => setFormData(prev => ({ ...prev, price_per_unit: e.target.value }))}
                  onBlur={handleBlur}
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                />
              </div>
              
              <div>
                <Label htmlFor="discount_percentage">הנחה (%)</Label>
                <Input
                  type="number"
                  id="discount_percentage"
                  name="discount_percentage"
                  value={formData.discount_percentage}
                  onChange={(e) => setFormData(prev => ({ ...prev, discount_percentage: e.target.value }))}
                  onBlur={handleBlur}
                  min="0"
                  max="100"
                  step="0.1"
                  placeholder="0"
                />
              </div>
              
              <div>
                <Label className="font-bold">סכום כולל (₪)</Label>
                <Input
                  value={`₪${displayValues.item_total}`}
                  readOnly
                  className="bg-white font-mono font-bold text-lg border-blue-500"
                />
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button type="button" variant="outline" onClick={onCancel}>
              ביטול
            </Button>
            <Button type="submit" className="bg-blue-600 hover:bg-blue-700">
              {item ? 'עדכן פריט' : 'הוסף פריט'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
