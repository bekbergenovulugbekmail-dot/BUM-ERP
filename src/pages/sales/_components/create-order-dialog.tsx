import { useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, ShoppingBag } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { Separator } from "@/components/ui/separator.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import { api, errorMessage } from "@/lib/api.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";
import { usePermissions } from "@/hooks/use-company.ts";
import { useCurrencies } from "@/hooks/use-currencies.ts";
import { computeLine, minorToNumber } from "../_lib/line-amounts.ts";
import {
  num, todayLocal,
  type Customer, type ProductOption, type WarehouseOption,
} from "../_lib/types.ts";

type LineItem = {
  productId: string;
  unitId: string;
  quantity: number;
  unitPrice: number;
  /** Prays-list narxi — o'zgarmagan bo'lsa narx yuborilmaydi (server o'zi qo'yadi). */
  listPrice: number;
  /** null — mijoz chegirmasi (server qo'yadi). */
  discountPercent: number | null;
  taxRate: string;
  taxIncluded: boolean;
};

type Props = {
  onClose: () => void;
  onCreated: (id: string) => void;
};

const ANONYMOUS = "anon";

const fmt = (n: number) => new Intl.NumberFormat("uz-UZ").format(Math.round(n));

const emptyLine = (): LineItem => ({
  productId: "", unitId: "", quantity: 1, unitPrice: 0, listPrice: 0, discountPercent: null, taxRate: "0", taxIncluded: true,
});

export default function CreateOrderDialog({ onClose, onCreated }: Props) {
  const { can } = usePermissions();
  const currencies = useCurrencies();
  // Narx va chegirmani o'zgartirish — faqat sales.edit (aks holda server rad etadi)
  const canOverride = can("sales.edit");
  const customers = useApiQuery<{ customers: Customer[] }>("/api/sales/customers").data?.customers;
  const warehouses = useApiQuery<{ warehouses: WarehouseOption[] }>("/api/inventory/warehouses").data?.warehouses;
  // API chegarasi: 200 ta faol mahsulot
  const products = useApiQuery<{ products: ProductOption[] }>("/api/catalog/products", { limit: 200, isActive: true })
    .data?.products.filter((p) => p.isSaleable);
  const createOrder = useApiMutation((body: object) => api.post<{ order: { id: string } }>("/api/sales/orders", body));

  const [customerId, setCustomerId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [orderDate, setOrderDate] = useState(todayLocal);
  const [deliveryDate, setDeliveryDate] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineItem[]>([emptyLine()]);
  const [loading, setLoading] = useState(false);

  if (!warehouseId && warehouses?.length) {
    const def = warehouses.find((w) => w.isDefault) ?? warehouses[0];
    setWarehouseId(def.id);
  }

  const customer = customers?.find((c) => c.id === customerId);
  const customerDiscount = num(customer?.discountPercent);

  const addLine = () => setLines((p) => [...p, emptyLine()]);
  const removeLine = (i: number) => setLines((p) => p.filter((_, idx) => idx !== i));

  const updateLine = (i: number, patch: Partial<LineItem>) => {
    setLines((p) => {
      const next = [...p];
      const line = { ...next[i], ...patch };
      if (patch.productId !== undefined) {
        const prod = products?.find((p) => p.id === patch.productId);
        if (prod) {
          // Narxi boshqa valyutada — joriy kurs bilan asosiy valyutada (server ham shunday)
          const price = currencies.toBase(prod.salesPrice, prod.salesCurrency) || 0;
          line.unitId = prod.baseUnitId;
          line.unitPrice = price;
          line.listPrice = price;
          line.taxRate = prod.taxRate;
          line.taxIncluded = prod.taxIncluded;
        }
      }
      next[i] = line;
      return next;
    });
  };

  // Oldindan ko'rish serverdagi hisob bilan bir xil (soliq mahsulotdan, `taxIncluded` bo'yicha)
  const amounts = lines.map((l) =>
    computeLine({
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      discountPercent: l.discountPercent ?? customerDiscount,
      taxRate: l.taxRate,
      taxIncluded: l.taxIncluded,
    }),
  );
  const subtotal = minorToNumber(amounts.reduce((s, a) => s + a.net, 0n));
  const taxTotal = minorToNumber(amounts.reduce((s, a) => s + a.tax, 0n));
  const total = minorToNumber(amounts.reduce((s, a) => s + a.lineTotal, 0n));

  const handleSubmit = async () => {
    if (!warehouseId) { toast.error("Ombor tanlang"); return; }
    const validLines = lines.filter((l) => l.productId && l.quantity > 0);
    if (!validLines.length) { toast.error("Kamida bitta mahsulot qo'shing"); return; }

    setLoading(true);
    try {
      const { order } = await createOrder.mutateAsync({
        customerId: customerId && customerId !== ANONYMOUS ? customerId : null,
        warehouseId,
        orderDate,
        deliveryDate: deliveryDate || null,
        notes: notes || null,
        // Soliq stavkasi yuborilmaydi — serverda mahsulotdan
        items: validLines.map((l) => ({
          productId: l.productId,
          unitId: l.unitId,
          quantity: l.quantity,
          ...(l.unitPrice !== l.listPrice ? { unitPrice: l.unitPrice } : {}),
          ...(l.discountPercent !== null ? { discountPercent: l.discountPercent } : {}),
        })),
      });
      toast.success("Sotuv buyurtmasi yaratildi");
      onCreated(order.id);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally { setLoading(false); }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShoppingBag className="h-5 w-5 text-emerald-500" />
            Yangi sotuv buyurtmasi
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div>
              <Label>Mijoz</Label>
              <Select value={customerId} onValueChange={setCustomerId}>
                <SelectTrigger><SelectValue placeholder="Anonim mijoz" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANONYMOUS}>Anonim</SelectItem>
                  {customers?.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {customerDiscount > 0 && (
                <p className="text-[11px] text-muted-foreground mt-1">Mijoz chegirmasi: {customerDiscount}%</p>
              )}
            </div>
            <div>
              <Label>Ombor *</Label>
              <Select value={warehouseId} onValueChange={setWarehouseId}>
                <SelectTrigger><SelectValue placeholder="Tanlang" /></SelectTrigger>
                <SelectContent>
                  {warehouses?.map((w) => (
                    <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Sana</Label>
              <Input type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
            </div>
            <div>
              <Label>Yetkazish sanasi</Label>
              <Input type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} />
            </div>
          </div>

          <Separator />

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
                    <th className="text-right px-3 py-2 text-xs text-muted-foreground w-20">Chegirma %</th>
                    <th className="text-right px-3 py-2 text-xs text-muted-foreground w-32">Jami</th>
                    <th className="w-8 px-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {lines.map((line, i) => (
                    <tr key={i}>
                      <td className="px-2 py-2">
                        <Select value={line.productId} onValueChange={(v) => updateLine(i, { productId: v })}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Mahsulot" /></SelectTrigger>
                          <SelectContent>
                            {products?.map((p) => (
                              <SelectItem key={p.id} value={p.id}>
                                <span className="font-mono text-[11px] mr-1 text-muted-foreground">{p.sku}</span>
                                {p.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="px-2 py-2">
                        <Input type="number" min="0.001" step="0.001" className="h-8 text-xs text-right"
                          value={line.quantity}
                          onChange={(e) => updateLine(i, { quantity: e.target.valueAsNumber || 0 })} />
                      </td>
                      <td className="px-2 py-2">
                        <Input type="number" min="0" className="h-8 text-xs text-right"
                          value={line.unitPrice}
                          disabled={!canOverride}
                          title={canOverride ? undefined : "Narxni o'zgartirish uchun ruxsat yo'q"}
                          onChange={(e) => updateLine(i, { unitPrice: e.target.valueAsNumber || 0 })} />
                      </td>
                      <td className="px-2 py-2">
                        <Input type="number" min="0" max="100" className="h-8 text-xs text-right"
                          value={line.discountPercent ?? ""}
                          placeholder={String(customerDiscount)}
                          disabled={!canOverride}
                          onChange={(e) => updateLine(i, {
                            discountPercent: e.target.value === "" ? null : e.target.valueAsNumber || 0,
                          })} />
                      </td>
                      <td className="px-3 py-2 text-right font-medium text-xs whitespace-nowrap">
                        {fmt(minorToNumber(amounts[i]!.lineTotal))} so'm
                      </td>
                      <td className="px-2 py-2">
                        {lines.length > 1 && (
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeLine(i)}>
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex justify-end">
            <div className="w-64 space-y-1 text-sm">
              <div className="flex justify-between text-muted-foreground">
                <span>Soliqsiz summa</span><span>{fmt(subtotal)} so'm</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>QQS</span><span>{fmt(taxTotal)} so'm</span>
              </div>
              <Separator />
              <div className="flex justify-between font-bold text-base">
                <span>Jami</span>
                <span className="text-emerald-600 dark:text-emerald-400">{fmt(total)} so'm</span>
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
          <Button onClick={handleSubmit} disabled={loading}>
            {loading ? "..." : "Buyurtma yaratish"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
