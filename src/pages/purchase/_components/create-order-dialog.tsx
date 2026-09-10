import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { toast } from "sonner";
import { Plus, Trash2, ShoppingCart } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { Separator } from "@/components/ui/separator.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import type { Id } from "@/convex/_generated/dataModel.d.ts";

type LineItem = {
  productId: string;
  unitId: string;
  orderedQty: number;
  unitPrice: number;
  taxRate: number;
  discountPercent: number;
};

type Props = {
  onClose: () => void;
  onCreated: (id: Id<"purchaseOrders">) => void;
};

const fmt = (n: number) => new Intl.NumberFormat("uz-UZ").format(Math.round(n));

export default function CreateOrderDialog({ onClose, onCreated }: Props) {
  const suppliers = useQuery(api.purchase.suppliers.list, {});
  const warehouses = useQuery(api.warehouse.warehouses.list, {});
  const products = useQuery(api.products.products.list, { paginationOpts: { cursor: null, numItems: 300 } });
  const units = useQuery(api.products.units.list, {});
  const createOrder = useMutation(api.purchase.orders.create);

  const today = new Date().toISOString().slice(0, 10);
  const [supplierId, setSupplierId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [orderDate, setOrderDate] = useState(today);
  const [expectedDate, setExpectedDate] = useState("");
  const [currency, setCurrency] = useState("UZS");
  const [exchangeRate, setExchangeRate] = useState(1);
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineItem[]>([
    { productId: "", unitId: "", orderedQty: 1, unitPrice: 0, taxRate: 12, discountPercent: 0 },
  ]);
  const [loading, setLoading] = useState(false);

  // Auto-set default warehouse
  if (!warehouseId && warehouses?.length) {
    const def = warehouses.find((w) => w.isDefault) ?? warehouses[0];
    setWarehouseId(def._id);
  }

  const addLine = () =>
    setLines((p) => [...p, { productId: "", unitId: "", orderedQty: 1, unitPrice: 0, taxRate: 12, discountPercent: 0 }]);

  const removeLine = (i: number) => setLines((p) => p.filter((_, idx) => idx !== i));

  const updateLine = (i: number, field: keyof LineItem, value: string | number) => {
    setLines((p) => {
      const next = [...p];
      const line = { ...next[i] } as Record<string, string | number>;
      line[field] = value;
      // Auto-fill unit and price when product selected
      if (field === "productId" && typeof value === "string") {
        const prod = products?.page.find((p) => p._id === value);
        if (prod) {
          line.unitId = prod.baseUnitId;
          line.unitPrice = prod.purchasePrice;
          line.taxRate = prod.taxRate;
        }
      }
      next[i] = line as unknown as LineItem;
      return next;
    });
  };

  // Totals
  const subtotal = lines.reduce((s, l) => {
    const gross = l.orderedQty * l.unitPrice;
    const disc = gross * (l.discountPercent / 100);
    return s + (gross - disc);
  }, 0);
  const taxTotal = lines.reduce((s, l) => {
    const gross = l.orderedQty * l.unitPrice;
    const disc = gross * (l.discountPercent / 100);
    return s + (gross - disc) * (l.taxRate / 100);
  }, 0);
  const total = subtotal + taxTotal;

  const handleSubmit = async (asDraft: boolean) => {
    if (!supplierId) { toast.error("Yetkazuvchi tanlang"); return; }
    if (!warehouseId) { toast.error("Ombor tanlang"); return; }
    const validLines = lines.filter((l) => l.productId && l.orderedQty > 0);
    if (!validLines.length) { toast.error("Kamida bitta mahsulot qo'shing"); return; }

    setLoading(true);
    try {
      const id = await createOrder({
        supplierId: supplierId as Id<"suppliers">,
        warehouseId: warehouseId as Id<"warehouses">,
        orderDate,
        expectedDate: expectedDate || undefined,
        currency,
        exchangeRate,
        notes: notes || undefined,
        items: validLines.map((l) => ({
          productId: l.productId as Id<"products">,
          unitId: l.unitId as Id<"units">,
          orderedQty: l.orderedQty,
          unitPrice: l.unitPrice,
          taxRate: l.taxRate,
          discountPercent: l.discountPercent,
        })),
      });
      toast.success("Buyurtma yaratildi");
      onCreated(id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Xatolik");
    } finally { setLoading(false); }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShoppingCart className="h-5 w-5 text-primary" />
            Yangi xarid buyurtmasi
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          {/* Header fields */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div>
              <Label>Yetkazuvchi *</Label>
              <Select value={supplierId} onValueChange={setSupplierId}>
                <SelectTrigger><SelectValue placeholder="Tanlang" /></SelectTrigger>
                <SelectContent>
                  {suppliers?.map((s) => (
                    <SelectItem key={s._id} value={s._id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Ombor *</Label>
              <Select value={warehouseId} onValueChange={setWarehouseId}>
                <SelectTrigger><SelectValue placeholder="Tanlang" /></SelectTrigger>
                <SelectContent>
                  {warehouses?.map((w) => (
                    <SelectItem key={w._id} value={w._id}>{w.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Valyuta</Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="UZS">UZS</SelectItem>
                  <SelectItem value="USD">USD</SelectItem>
                  <SelectItem value="EUR">EUR</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Buyurtma sanasi</Label>
              <Input type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
            </div>
            <div>
              <Label>Kutilayotgan sana</Label>
              <Input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />
            </div>
            {currency !== "UZS" && (
              <div>
                <Label>Kurs (UZS)</Label>
                <Input type="number" value={exchangeRate}
                  onChange={(e) => setExchangeRate(e.target.valueAsNumber || 1)} />
              </div>
            )}
          </div>

          <Separator />

          {/* Line items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-semibold">Mahsulotlar</p>
              <Button size="sm" variant="secondary" onClick={addLine}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Qo'shish
              </Button>
            </div>

            <div className="rounded-xl border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50 border-b border-border">
                    <th className="text-left px-3 py-2 text-xs text-muted-foreground">Mahsulot</th>
                    <th className="text-right px-3 py-2 text-xs text-muted-foreground w-24">Miqdor</th>
                    <th className="text-right px-3 py-2 text-xs text-muted-foreground w-28">Narx</th>
                    <th className="text-right px-3 py-2 text-xs text-muted-foreground w-20">Soliq %</th>
                    <th className="text-right px-3 py-2 text-xs text-muted-foreground w-20">Chegirma %</th>
                    <th className="text-right px-3 py-2 text-xs text-muted-foreground w-32">Jami</th>
                    <th className="w-8 px-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {lines.map((line, i) => {
                    const gross = line.orderedQty * line.unitPrice;
                    const disc = gross * (line.discountPercent / 100);
                    const net = gross - disc;
                    const tax = net * (line.taxRate / 100);
                    const lineTotal = net + tax;

                    return (
                      <tr key={i}>
                        <td className="px-2 py-2">
                          <Select value={line.productId} onValueChange={(v) => updateLine(i, "productId", v)}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Mahsulot" /></SelectTrigger>
                            <SelectContent>
                              {products?.page.map((p) => (
                                <SelectItem key={p._id} value={p._id}>
                                  <span className="font-mono text-[11px] mr-1 text-muted-foreground">{p.sku}</span>
                                  {p.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="px-2 py-2">
                          <Input type="number" min="0" step="0.001" className="h-8 text-xs text-right"
                            value={line.orderedQty}
                            onChange={(e) => updateLine(i, "orderedQty", e.target.valueAsNumber || 0)} />
                        </td>
                        <td className="px-2 py-2">
                          <Input type="number" min="0" className="h-8 text-xs text-right"
                            value={line.unitPrice}
                            onChange={(e) => updateLine(i, "unitPrice", e.target.valueAsNumber || 0)} />
                        </td>
                        <td className="px-2 py-2">
                          <Input type="number" min="0" max="100" className="h-8 text-xs text-right"
                            value={line.taxRate}
                            onChange={(e) => updateLine(i, "taxRate", e.target.valueAsNumber || 0)} />
                        </td>
                        <td className="px-2 py-2">
                          <Input type="number" min="0" max="100" className="h-8 text-xs text-right"
                            value={line.discountPercent}
                            onChange={(e) => updateLine(i, "discountPercent", e.target.valueAsNumber || 0)} />
                        </td>
                        <td className="px-3 py-2 text-right font-medium text-xs whitespace-nowrap">
                          {fmt(lineTotal)} so'm
                        </td>
                        <td className="px-2 py-2">
                          {lines.length > 1 && (
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeLine(i)}>
                              <Trash2 className="h-3.5 w-3.5 text-destructive" />
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Totals */}
          <div className="flex justify-end">
            <div className="w-64 space-y-1 text-sm">
              <div className="flex justify-between text-muted-foreground">
                <span>Mahsulotlar jami</span>
                <span>{fmt(subtotal)} so'm</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>QQS ({currency})</span>
                <span>{fmt(taxTotal)} so'm</span>
              </div>
              <Separator />
              <div className="flex justify-between font-bold text-base">
                <span>Jami</span>
                <span className="text-primary">{fmt(total)} so'm</span>
              </div>
            </div>
          </div>

          <div>
            <Label>Izoh</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ixtiyoriy..." />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="secondary" onClick={onClose}>Bekor</Button>
          <Button variant="secondary" onClick={() => handleSubmit(true)} disabled={loading}>
            Qoralama saqlash
          </Button>
          <Button onClick={() => handleSubmit(false)} disabled={loading}>
            {loading ? "..." : "Yaratish va tasdiqlash"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
