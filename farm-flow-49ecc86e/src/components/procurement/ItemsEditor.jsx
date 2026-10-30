import React from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2 } from "lucide-react";
import { UNITS, money, lineTotal } from "./procurementUtils";

export const emptyItem = (extra = {}) => ({ product_id: "", product_name: "", quantity: "", unit: "יח'", unit_price: "", notes: "", ...extra });

/**
 * עורך שורות משותף להזמנה ולתעודת משלוח.
 *  items: [{ product_id, product_name, quantity, unit, unit_price, notes, discrepancy_note?, order_item_id?, remaining? }]
 *  products: רשימת מוצרים (products) — בחירה ממלאת product_name; אפשר גם טקסט חופשי
 *  withDiscrepancy: מציג עמודת "הערת פער" (תעודת משלוח)
 */
export default function ItemsEditor({ items, onChange, products = [], withDiscrepancy = false, disabled }) {
  const set = (i, patch) => onChange(items.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  const remove = (i) => onChange(items.filter((_, idx) => idx !== i));
  const add = () => onChange([...items, emptyItem()]);
  const pickProduct = (i, id) => {
    if (id === "__free__") return set(i, { product_id: "" });
    const p = products.find((x) => x.id === id);
    set(i, { product_id: id, product_name: p?.name || items[i].product_name });
  };
  const total = items.reduce((s, it) => s + lineTotal(it), 0);

  return (
    <div className="space-y-2">
      <div className="hidden sm:grid grid-cols-[1fr_5rem_5.5rem_6rem_1fr_2rem] gap-2 text-xs text-muted-foreground px-1">
        <span>מוצר</span><span>כמות</span><span>יחידה</span><span>מחיר ליח'</span><span>{withDiscrepancy ? "הערת פער" : "הערה"}</span><span />
      </div>
      {items.map((it, i) => (
        <div key={i} className="grid grid-cols-2 sm:grid-cols-[1fr_5rem_5.5rem_6rem_1fr_2rem] gap-2 items-start rounded-lg border p-2 sm:border-0 sm:p-0">
          <div className="col-span-2 sm:col-span-1 flex gap-1 min-w-0">
            {products.length > 0 && (
              <Select value={it.product_id || "__free__"} onValueChange={(v) => pickProduct(i, v)} disabled={disabled}>
                <SelectTrigger className="h-9 w-[7.5rem] shrink-0 text-xs" aria-label="בחר מוצר"><SelectValue placeholder="מוצר" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__free__">טקסט חופשי</SelectItem>
                  {products.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            <Input className="h-9 min-w-0" value={it.product_name} onChange={(e) => set(i, { product_name: e.target.value, ...(it.product_id && products.find((p) => p.id === it.product_id)?.name !== e.target.value ? { product_id: "" } : {}) })} placeholder="שם המוצר / פריט" disabled={disabled} aria-label="שם מוצר" />
          </div>
          <div>
            <Input className="h-9" type="number" inputMode="decimal" min="0" step="any" value={it.quantity} onChange={(e) => set(i, { quantity: e.target.value })} placeholder="כמות" disabled={disabled} aria-label="כמות" />
            {it.remaining !== undefined && <div className="text-xs text-muted-foreground mt-0.5 tabular-nums">נותר: {it.remaining}</div>}
          </div>
          <Select value={UNITS.includes(it.unit) ? it.unit : "__other__"} onValueChange={(v) => set(i, { unit: v === "__other__" ? it.unit : v })} disabled={disabled}>
            <SelectTrigger className="h-9 text-xs" aria-label="יחידה"><SelectValue /></SelectTrigger>
            <SelectContent>
              {UNITS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
              {!UNITS.includes(it.unit) && it.unit && <SelectItem value="__other__">{it.unit}</SelectItem>}
            </SelectContent>
          </Select>
          <Input className="h-9" type="number" inputMode="decimal" min="0" step="any" value={it.unit_price ?? ""} onChange={(e) => set(i, { unit_price: e.target.value })} placeholder="₪" disabled={disabled} aria-label="מחיר ליחידה" />
          <Input className="h-9 col-span-2 sm:col-span-1" value={withDiscrepancy ? (it.discrepancy_note || "") : (it.notes || "")} onChange={(e) => set(i, withDiscrepancy ? { discrepancy_note: e.target.value } : { notes: e.target.value })} placeholder={withDiscrepancy ? "נזק / חוסר / מחיר שונה…" : "הערה"} disabled={disabled} aria-label="הערה" />
          <Button type="button" variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-destructive justify-self-end" onClick={() => remove(i)} disabled={disabled} aria-label="הסר שורה"><Trash2 className="w-4 h-4" aria-hidden="true" /></Button>
        </div>
      ))}
      <div className="flex items-center justify-between">
        <Button type="button" variant="outline" size="sm" onClick={add} disabled={disabled}><Plus className="w-4 h-4 ml-1" aria-hidden="true" /> שורה</Button>
        <div className="text-sm text-muted-foreground">סה"כ: <b className="text-foreground tabular-nums">{money(total)}</b></div>
      </div>
    </div>
  );
}
