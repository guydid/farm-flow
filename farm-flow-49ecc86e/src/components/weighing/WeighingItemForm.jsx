
import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Calculator, ExternalLink } from "lucide-react";
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

// העדפות אחרונות לכל מוצר (אריזה/איכות/משטח) — כדי שהבחירה הבאה תהיה בלחיצה אחת
const loadProductPrefs = (productId) => {
  try { return JSON.parse(localStorage.getItem(`weigh_prefs_${productId}`) || 'null'); } catch { return null; }
};
const saveProductPrefs = (productId, prefs) => {
  try { localStorage.setItem(`weigh_prefs_${productId}`, JSON.stringify(prefs)); } catch { /* אחסון חסום */ }
};

const QUALITIES = ["א", "ב", "ג", "תעשייתי"];

// כפתור בחירה (chip) — אבן הבניין של הזרימה המהירה
const Chip = ({ selected, onClick, children, className }) => (
  <button
    type="button"
    onClick={onClick}
    className={cn(
      "px-3 py-2.5 rounded-xl border text-sm font-medium transition-all text-center leading-tight",
      selected
        ? "bg-indigo-600 text-white border-indigo-600 shadow-sm"
        : "bg-white text-gray-700 border-gray-200 hover:border-gray-300 active:bg-gray-100",
      className
    )}
  >
    {children}
  </button>
);

const SectionLabel = ({ children }) => (
  <div className="text-sm font-semibold text-gray-800 mb-2">{children}</div>
);

// Main Component
export default function WeighingItemForm({ item, isCopyMode = false, onSubmit, onCancel, products, packagings, palletTypes, certificateCustomerId }) {
  const [formData, setFormData] = useState({
    product_id: "",
    product_name: "",
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

  const selectedProduct = useMemo(() => {
    return safeArray(products).find(p => p && p.id === formData.product_id);
  }, [products, formData.product_id]);

  // אריזות רלוונטיות למוצר הנבחר: אריזה עם שיוך מוצרים מוצגת רק להם; ללא שיוך — לכולם
  const relevantPackagings = useMemo(() => {
    return safeArray(packagings).filter(pkg => pkg && (
      !Array.isArray(pkg.product_ids) || pkg.product_ids.length === 0 || pkg.product_ids.includes(formData.product_id)
    ));
  }, [packagings, formData.product_id]);

  const selectedPackaging = useMemo(() => {
    return safeArray(packagings).find(p => p && p.name === formData.packaging_type);
  }, [packagings, formData.packaging_type]);

  // מוצר "לא שקיל" (דגל ישן) — ללא שקילה כלל; אחרת השקילות נקבעת לפי האריזה שנבחרה
  const productWeighable = selectedProduct?.weighable !== false;
  const isWeighable = useMemo(() => {
    if (!productWeighable) return false;
    if (selectedPackaging && selectedPackaging.weighable === false) return false;
    return true;
  }, [productWeighable, selectedPackaging]);

  const performCalculations = useCallback(() => {
    const safePackagings = safeArray(packagings);
    const safePalletTypes = safeArray(palletTypes);

    let tare_weight_calc = 0;
    let net_weight_calc = 0;
    let total_calc = 0;
    let subtotal_calc = 0;
    let discountAmount_calc = 0;

    if (!isWeighable) {
      total_calc = calculateTotal({
        net_weight: 0,
        package_count: formData.package_count,
        price_per_unit: formData.price_per_unit,
        discount_percentage: formData.discount_percentage,
        pricing_method: 'per_unit'
      });

      const discount = parseFloat(formData.discount_percentage) || 0;
      subtotal_calc = (discount > 0 && discount < 100) ? (total_calc / (1 - discount / 100)) : total_calc;
      discountAmount_calc = subtotal_calc - total_calc;

    } else {
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
        product_name: selectedProd ? selectedProd.name : '',
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
        setTimeout(() => grossWeightRef.current?.focus(), 300);
      }
    }
  }, [item, isCopyMode, isMobile, products]);

  useEffect(() => {
    performCalculations();
  }, [formData, performCalculations]);

  const handleBlur = useCallback(() => {
    performCalculations();
  }, [performCalculations]);

  // בחירת מוצר: מוחלת גם ההעדפה האחרונה שלו (אריזה/איכות/משטח) לבחירה בלחיצה אחת.
  // אריזה זכורה/קודמת שאינה רלוונטית למוצר החדש — מאופסת.
  const handleProductSelect = useCallback((product) => {
    if (!product) return;
    const notWeighable = product.weighable === false;
    const prefs = loadProductPrefs(product.id);
    const isRelevant = (pkgName) => {
      if (!pkgName) return false;
      const pkg = safeArray(packagings).find(p => p && p.name === pkgName);
      if (!pkg) return false;
      return !Array.isArray(pkg.product_ids) || pkg.product_ids.length === 0 || pkg.product_ids.includes(product.id);
    };
    setFormData(prev => {
      const candidate = prefs?.packaging_type ?? prev.packaging_type ?? '';
      return {
        ...prev,
        product_id: product.id,
        product_name: product.name,
        pricing_method: notWeighable ? 'per_unit' : (product.default_pricing_method || 'per_kg'),
        quality: prefs?.quality || prev.quality || 'א',
        packaging_type: notWeighable ? '' : (isRelevant(candidate) ? candidate : ''),
        pallet_type: notWeighable ? '' : (prefs?.pallet_type ?? prev.pallet_type ?? ''),
        gross_weight: notWeighable ? '' : prev.gross_weight,
      };
    });
  }, [packagings]);

  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();

    if (!formData.product_id) {
      alert('נא לבחור מוצר');
      return;
    }

    if (isWeighable && (!formData.gross_weight || parseFloat(formData.gross_weight) <= 0)) {
      alert('נא להזין משקל ברוטו תקין');
      return;
    }

    if (!isWeighable && (!formData.package_count || parseInt(formData.package_count) <= 0)) {
      alert('נא להזין כמות אריזות');
      return;
    }

    try {
      const processedData = {
        ...formData,
        package_count: formData.package_count !== "" ? parseInt(formData.package_count, 10) : 0,
        gross_weight: isWeighable && formData.gross_weight !== "" ? parseFloat(formData.gross_weight) : 0,
        price_per_unit: formData.price_per_unit !== "" ? parseFloat(formData.price_per_unit) : 0,
        discount_percentage: formData.discount_percentage !== "" ? parseFloat(formData.discount_percentage) : 0,
        pricing_method: isWeighable ? formData.pricing_method : 'per_unit',

        tare_weight: isWeighable && displayValues.tare_weight !== "" ? parseFloat(displayValues.tare_weight) : 0,
        net_weight: isWeighable && displayValues.net_weight !== "" ? parseFloat(displayValues.net_weight) : 0,
        item_total: displayValues.item_total !== "" ? parseFloat(displayValues.item_total) : 0,
        pallet_type: isWeighable ? formData.pallet_type : '',
        // גם אריזה "לא שקילה" נשמרת על הפריט — רק המשטח לא רלוונטי בלי שקילה
        packaging_type: productWeighable ? formData.packaging_type : '',
      };

      Object.keys(processedData).forEach(key => {
        if (
          (typeof processedData[key] === 'number' && isNaN(processedData[key])) ||
          processedData[key] === undefined ||
          processedData[key] === null
        ) {
          if (['package_count', 'gross_weight', 'price_per_unit', 'discount_percentage',
               'tare_weight', 'net_weight', 'item_total'].includes(key)) {
            processedData[key] = 0;
          } else if (key === 'pallet_type' || key === 'packaging_type') {
            processedData[key] = '';
          }
        }
      });

      // זכירת הבחירה למוצר — הפעם הבאה תסומן אוטומטית
      saveProductPrefs(formData.product_id, {
        packaging_type: processedData.packaging_type,
        quality: formData.quality,
        pallet_type: processedData.pallet_type,
      });

      await onSubmit(processedData);
    } catch (error) {
      console.error('Error submitting item:', error);
      alert('שגיאה בשמירת הפריט: ' + (error.message || 'שגיאה לא ידועה'));
    }
  }, [formData, displayValues, onSubmit, isWeighable, productWeighable]);

  const navigate = useNavigate();
  const safeProducts = safeArray(products);
  const safePackagings = safeArray(packagings);
  const safePalletTypes = safeArray(palletTypes);

  const EmptyState = ({ tab, text }) => (
    <div className="flex items-center justify-between p-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-700">
      <span>{text}</span>
      <button type="button" onClick={() => navigate(`/settings?tab=${tab}`)} className="underline font-medium flex items-center gap-0.5">
        הגדר כאן <ExternalLink className="w-3 h-3" />
      </button>
    </div>
  );

  const productChosen = !!formData.product_id;

  return (
    <Dialog open={true} onOpenChange={onCancel}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-xl">
            {isCopyMode ? `העתקת פריט - ${formData.product_name || 'פריט חדש'}` :
             item ? `עריכת פריט - ${formData.product_name || 'פריט'}` : 'הוספת פריט'}
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

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* ── 1. מוצר — כפתורים ─────────────────────────────────────────── */}
          <div>
            <SectionLabel>מוצר</SectionLabel>
            {safeProducts.length === 0 ? (
              <EmptyState tab="products" text="אין מוצרים מוגדרים" />
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {safeProducts.map(product => product && (
                  <Chip
                    key={product.id}
                    selected={formData.product_id === product.id}
                    onClick={() => handleProductSelect(product)}
                  >
                    {product.name}
                    {product.weighable === false && (
                      <div className={cn("text-[10px] mt-0.5", formData.product_id === product.id ? "text-indigo-200" : "text-gray-400")}>יחידות</div>
                    )}
                  </Chip>
                ))}
              </div>
            )}
          </div>

          {productChosen && (
            <>
              {/* ── 2. אריזה — כפתורים; רק האריזות המשויכות למוצר (ללא שיוך = לכולם) ── */}
              {productWeighable && (
                <div>
                  <SectionLabel>אריזה</SectionLabel>
                  {safePackagings.length === 0 ? (
                    <EmptyState tab="packaging" text="אין אריזות מוגדרות" />
                  ) : relevantPackagings.length === 0 ? (
                    <EmptyState tab="packaging" text={`אין אריזות משויכות ל${formData.product_name}`} />
                  ) : (
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                      {relevantPackagings.map(pkg => pkg && (
                        <Chip
                          key={pkg.id}
                          selected={formData.packaging_type === pkg.name}
                          onClick={() => setFormData(prev => ({ ...prev, packaging_type: prev.packaging_type === pkg.name ? "" : pkg.name }))}
                        >
                          {pkg.name}
                          <div className={cn("text-[10px] mt-0.5", formData.packaging_type === pkg.name ? "text-indigo-200" : "text-gray-400")}>
                            {pkg.weighable === false ? 'יחידות' : `טרה ${pkg.tare_weight} ק"ג`}
                          </div>
                        </Chip>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* ── 3. איכות — כפתורים ─────────────────────────────────────── */}
              <div>
                <SectionLabel>איכות</SectionLabel>
                <div className="grid grid-cols-4 gap-2">
                  {QUALITIES.map(q => (
                    <Chip
                      key={q}
                      selected={formData.quality === q}
                      onClick={() => setFormData(prev => ({ ...prev, quality: q }))}
                    >
                      {q}
                    </Chip>
                  ))}
                </div>
              </div>

              {/* ── 4. משטח — כפתורים (שקיל בלבד) ─────────────────────────── */}
              {isWeighable && safePalletTypes.length > 0 && (
                <div>
                  <SectionLabel>משטח</SectionLabel>
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                    <Chip
                      selected={!formData.pallet_type}
                      onClick={() => setFormData(prev => ({ ...prev, pallet_type: "" }))}
                    >
                      ללא
                    </Chip>
                    {safePalletTypes.map(pallet => pallet && (
                      <Chip
                        key={pallet.id}
                        selected={formData.pallet_type === pallet.name}
                        onClick={() => setFormData(prev => ({ ...prev, pallet_type: pallet.name }))}
                      >
                        {pallet.name}
                        <div className={cn("text-[10px] mt-0.5", formData.pallet_type === pallet.name ? "text-indigo-200" : "text-gray-400")}>
                          {pallet.weight} ק"ג
                        </div>
                      </Chip>
                    ))}
                  </div>
                </div>
              )}

              {/* ── 5. כמויות ומשקלים ─────────────────────────────────────── */}
              <div className={cn("grid gap-3", isWeighable ? "grid-cols-2" : "grid-cols-1")}>
                <div>
                  <Label htmlFor="package_count" className="text-sm font-semibold text-gray-800">
                    כמות אריזות {!isWeighable && '*'}
                  </Label>
                  <Input
                    type="number"
                    inputMode="numeric"
                    id="package_count"
                    name="package_count"
                    value={formData.package_count}
                    onChange={(e) => setFormData(prev => ({ ...prev, package_count: e.target.value }))}
                    onBlur={handleBlur}
                    min="0"
                    step="1"
                    required={!isWeighable}
                    className="h-12 text-lg mt-1"
                    placeholder="0"
                  />
                </div>

                {isWeighable && (
                  <div>
                    <Label htmlFor="gross_weight" className="text-sm font-semibold text-gray-800">ברוטו (ק"ג) *</Label>
                    <Input
                      ref={grossWeightRef}
                      type="number"
                      inputMode="decimal"
                      id="gross_weight"
                      name="gross_weight"
                      value={formData.gross_weight}
                      onChange={(e) => setFormData(prev => ({ ...prev, gross_weight: e.target.value }))}
                      onBlur={handleBlur}
                      min="0"
                      step="0.01"
                      required
                      className={cn("h-12 text-lg mt-1", isCopyMode && "border-green-500 bg-green-50")}
                      placeholder="0.00"
                    />
                  </div>
                )}
              </div>

              {/* חישוב טרה/נטו — שקיל בלבד */}
              {isWeighable && (
                <div className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-3">
                  <div className="flex items-center gap-4 text-sm">
                    <span className="text-gray-500">טרה <span className="font-mono font-medium text-gray-700">{displayValues.tare_weight}</span></span>
                    <span className="text-gray-300">|</span>
                    <span className="text-gray-700 font-semibold">נטו <span className="font-mono font-bold text-green-700 text-base">{displayValues.net_weight}</span> ק"ג</span>
                  </div>
                  {isMobile && (
                    <Button type="button" onClick={performCalculations} variant="ghost" size="sm" className="text-blue-600 h-8">
                      <Calculator className="w-4 h-4 ml-1" /> חשב
                    </Button>
                  )}
                </div>
              )}

              {/* ── 6. תמחור ──────────────────────────────────────────────── */}
              <div className="bg-blue-50 p-4 rounded-xl">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-sm">תמחור</h3>
                  {isWeighable && (
                    <div className="flex rounded-lg overflow-hidden border border-blue-200 text-xs">
                      <button
                        type="button"
                        onClick={() => setFormData(prev => ({ ...prev, pricing_method: 'per_kg' }))}
                        className={cn("px-3 py-1.5 font-medium", formData.pricing_method === 'per_kg' ? "bg-blue-600 text-white" : "bg-white text-gray-600")}
                      >
                        לפי ק"ג
                      </button>
                      <button
                        type="button"
                        onClick={() => setFormData(prev => ({ ...prev, pricing_method: 'per_unit' }))}
                        className={cn("px-3 py-1.5 font-medium", formData.pricing_method === 'per_unit' ? "bg-blue-600 text-white" : "bg-white text-gray-600")}
                      >
                        לפי יחידה
                      </button>
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="price_per_unit" className="text-xs">
                      מחיר {(isWeighable && formData.pricing_method === 'per_kg') ? 'לק"ג' : 'ליחידה'} (₪)
                    </Label>
                    <Input
                      type="number"
                      inputMode="decimal"
                      id="price_per_unit"
                      name="price_per_unit"
                      value={formData.price_per_unit}
                      onChange={(e) => setFormData(prev => ({ ...prev, price_per_unit: e.target.value }))}
                      onBlur={handleBlur}
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                      className="h-10 mt-1"
                    />
                  </div>
                  <div>
                    <Label htmlFor="discount_percentage" className="text-xs">הנחה (%)</Label>
                    <Input
                      type="number"
                      inputMode="decimal"
                      id="discount_percentage"
                      name="discount_percentage"
                      value={formData.discount_percentage}
                      onChange={(e) => setFormData(prev => ({ ...prev, discount_percentage: e.target.value }))}
                      onBlur={handleBlur}
                      min="0"
                      max="100"
                      step="0.1"
                      placeholder="0"
                      className="h-10 mt-1"
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between mt-3 pt-3 border-t border-blue-100">
                  <span className="text-sm font-semibold text-gray-700">סכום כולל</span>
                  <span className="font-mono font-bold text-xl text-blue-700">₪{displayValues.item_total}</span>
                </div>
              </div>
            </>
          )}

          {/* Action Buttons */}
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="outline" onClick={onCancel} className="flex-1 sm:flex-initial h-11">
              ביטול
            </Button>
            <Button type="submit" className="flex-1 sm:flex-initial bg-blue-600 hover:bg-blue-700 h-11" disabled={!productChosen}>
              {item ? 'עדכן פריט' : 'הוסף פריט'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
