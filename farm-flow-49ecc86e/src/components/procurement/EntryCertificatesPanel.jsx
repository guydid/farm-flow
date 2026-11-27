import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { EntryCertificate, Supplier } from "@/entities/all";
import { createPageUrl } from "@/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DateInput } from "@/components/ui/date-input";
import { useToast } from "@/components/ui/use-toast";
import { Loader2, Plus, Search, PackageOpen } from "lucide-react";
import EntitySelect from "@/components/common/EntitySelect";
import { certificateNumber } from "../weighing/CertificatePrintLayout";

// תעודות כניסה (רכש תוצרת חקלאית מספקים) — רשימה + פתיחת תעודה חדשה. השורות נערכות בעמוד EntryCertificateDetail.
const num = (v) => (parseFloat(v) || 0).toLocaleString("he-IL", { maximumFractionDigits: 1 });
const money = (v) => `₪${(parseFloat(v) || 0).toLocaleString("he-IL", { maximumFractionDigits: 0 })}`;
const fmtDate = (d) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : "");
const today = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const nowTime = () => new Date().toTimeString().slice(0, 5);

export default function EntryCertificatesPanel({ farmId, canWrite, createSignal = 0 }) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [certs, setCerts] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [supplierFilter, setSupplierFilter] = useState("all");
  const [newOpen, setNewOpen] = useState(false);
  const [draft, setDraft] = useState({ supplier_id: "", date: today() });
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [c, s] = await Promise.all([EntryCertificate.filter({ farm_id: farmId }, "-date"), Supplier.filter({ farm_id: farmId })]);
      setCerts(Array.isArray(c) ? c : []); setSuppliers(Array.isArray(s) ? s : []);
    } catch (e) { toast({ title: "לא ניתן לטעון תעודות כניסה", description: e.message, variant: "destructive" }); }
    finally { setLoading(false); }
  }, [farmId, toast]);
  useEffect(() => { if (farmId) load(); }, [farmId, load]);
  useEffect(() => { if (createSignal) { setDraft({ supplier_id: "", date: today() }); setNewOpen(true); } }, [createSignal]);

  const q = search.trim().toLowerCase();
  const visible = useMemo(() => certs
    .filter((c) => status === "all" || (status === "completed" ? c.status === "completed" : c.status !== "completed"))
    .filter((c) => supplierFilter === "all" || c.supplier_id === supplierFilter)
    .filter((c) => !q || [c.reference_number, c.supplier_name, c.driver_name, c.vehicle_number, c.notes].some((s) => String(s || "").toLowerCase().includes(q)))
    .sort((a, b) => `${b.date || ""}${b.time || ""}`.localeCompare(`${a.date || ""}${a.time || ""}`)), [certs, status, supplierFilter, q]);

  // מספור רץ לתעודות הכניסה של המשק
  const nextNumber = () => String(certs.reduce((m, c) => Math.max(m, parseInt(c.reference_number, 10) || 0), 0) + 1).padStart(4, "0");

  const create = async () => {
    if (!draft.supplier_id) { toast({ title: "בחר ספק", variant: "destructive" }); return; }
    setCreating(true);
    try {
      const sup = suppliers.find((s) => s.id === draft.supplier_id);
      const rec = await EntryCertificate.create({
        farm_id: farmId, supplier_id: draft.supplier_id, supplier_name: sup?.name || "", date: draft.date || today(), time: nowTime(),
        reference_number: nextNumber(), status: "draft", total_weight: 0, total_packages: 0, total_amount: 0, barcode: `ENTRY-${Date.now()}`,
      });
      navigate(`${createPageUrl("EntryCertificateDetail")}?id=${rec.id}`);
    } catch (e) { toast({ title: "יצירת התעודה נכשלה", description: e.message, variant: "destructive" }); }
    finally { setCreating(false); }
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
        <div className="relative col-span-2 sm:flex-1 sm:min-w-[12rem]">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
          <Input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="חיפוש תעודה, ספק, נהג או רכב" className="pr-9" aria-label="חיפוש בתעודות כניסה" />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="sm:w-36" aria-label="סינון לפי סטטוס"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">הכול</SelectItem>
            <SelectItem value="draft">טיוטות</SelectItem>
            <SelectItem value="completed">הושלמו</SelectItem>
          </SelectContent>
        </Select>
        <Select value={supplierFilter} onValueChange={setSupplierFilter}>
          <SelectTrigger className="sm:w-44" aria-label="סינון לפי ספק"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">כל הספקים</SelectItem>
            {suppliers.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-primary" aria-label="טוען" /></div>
      ) : (
        <ul className="space-y-2" aria-label="תעודות כניסה">
          {visible.length === 0 && (
            <li className="rounded-xl border border-dashed bg-card/50 px-4 py-10 text-center">
              <PackageOpen className="w-8 h-8 mx-auto text-muted-foreground/60" aria-hidden="true" />
              <p className="mt-2 font-medium">אין תעודות כניסה</p>
              <p className="text-sm text-muted-foreground mt-0.5 max-w-md mx-auto">תעודת כניסה מתעדת תוצרת חקלאית שהתקבלה מספק ונשקלה — אריזות, ברוטו/טרה/נטו ומחיר קנייה, באותו פורמט של תעודות השקילה.</p>
              {canWrite && !q && <div className="mt-4"><Button onClick={() => { setDraft({ supplier_id: "", date: today() }); setNewOpen(true); }}><Plus className="w-4 h-4 ml-1" aria-hidden="true" />תעודת כניסה חדשה</Button></div>}
            </li>
          )}
          {visible.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => navigate(`${createPageUrl("EntryCertificateDetail")}?id=${c.id}`)}
                className="w-full text-start rounded-xl border bg-card p-3 hover:bg-accent/60 active:bg-accent transition-colors focus-visible:ring-2 focus-visible:ring-ring">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <PackageOpen className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden="true" />
                  <span className="font-semibold tabular-nums">{certificateNumber(c)}</span>
                  <span className="text-sm truncate max-w-[14rem]">{c.supplier_name || "ללא ספק"}</span>
                  <Badge className={`border-0 font-medium ${c.status === "completed" ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"}`}>{c.status === "completed" ? "הושלמה" : "טיוטה"}</Badge>
                  <span className="ms-auto font-semibold tabular-nums">{money(c.total_amount)}</span>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span>{fmtDate(c.date)}{c.time ? ` · ${c.time}` : ""}</span>
                  <span className="tabular-nums">{num(c.total_weight)} ק"ג נטו</span>
                  <span className="tabular-nums">{c.total_packages || 0} אריזות</span>
                  {c.driver_name && <span>נהג {c.driver_name}</span>}
                  {c.vehicle_number && <span className="tabular-nums">{c.vehicle_number}</span>}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={newOpen} onOpenChange={(o) => !creating && setNewOpen(o)}>
        <DialogContent dir="rtl" className="max-w-md">
          <DialogHeader>
            <DialogTitle>תעודת כניסה חדשה</DialogTitle>
            <DialogDescription>בחר את הספק שממנו הגיעה התוצרת. אחר כך מוסיפים את השורות (משטחים/אריזות) ושוקלים.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>ספק</Label>
              <EntitySelect options={suppliers} value={draft.supplier_id} onValueChange={(v) => setDraft((d) => ({ ...d, supplier_id: v }))} quickAdd="supplier" farmId={farmId}
                onCreated={(r) => setSuppliers((s) => [...s, r])} placeholder="בחר ספק" />
            </div>
            <div className="space-y-1"><Label>תאריך</Label><DateInput value={draft.date} onChange={(e) => setDraft((d) => ({ ...d, date: e.target.value }))} /></div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setNewOpen(false)} disabled={creating}>ביטול</Button>
            <Button onClick={create} disabled={creating || !draft.supplier_id}>{creating && <Loader2 className="w-4 h-4 ml-1 animate-spin" />}צור והוסף שורות</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
