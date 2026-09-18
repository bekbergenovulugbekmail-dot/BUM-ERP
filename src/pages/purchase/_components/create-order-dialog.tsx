import { useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, ShoppingCart } from "lucide-react";
import { currencySymbol } from "@bum/shared";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { Separator } from "@/components/ui/separator.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import { cn } from "@/lib/utils.ts";
import { api, errorMessage } from "@/lib/api.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";
import { useTaxEnabled } from "@/hooks/use-tax.ts";
import { usePermissions } from "@/hooks/use-company.ts";
import { formatMoney, useCurrencies } from "@/hooks/use-currencies.ts";
import {
  num, todayLocal,
  type ProductOption, type Supplier, type WarehouseOption,
} from "../_lib/types.ts";
import QuickSupplierDialog from "./quick-supplier-dialog.tsx";
import QuickProductDialog from "./quick-product-dialog.tsx";

type LineItem = {
  productId: string;
  unitId: string;
  orderedQty: number;
  unitPrice: number;
  taxRate: number;
  discountPercent: number;
  /** "" — xaridning birinchi valyutasi. Narx va sotuv narxi shu valyutada. */
  currency: string;
  /** Qabulda mahsulotning yangi sotuv narxi (bo'sh — o'zgarmaydi). */
  salesPrice: string;
};

type Props = {
  onClose: () => void;
  onCreated: (id: string) => void;
};

const emptyLine = (): LineItem => ({
  productId: "", unitId: "", orderedQty: 1, unitPrice: 0, taxRate: 12, discountPercent: 0, currency: "", salesPrice: "",
});

/**
 * Oldindan ko'rish — ta'minotchi narxi soliqsiz, soliq ustiga; aniq summa serverda.
 * `taxEnabled` false bo'lsa soliq umuman hisoblanmaydi (server ham 0 yozadi).
 */
function lineAmounts(line: LineItem, taxEnabled = true) {
  const gross = line.orderedQty * line.unitPrice;
  const net = gross - gross * (line.discountPercent / 100);
  const tax = taxEnabled ? net * (line.taxRate / 100) : 0;
  return { net, tax, total: net + tax };
}

/** Ro'yxat oxiridagi "yangi qo'shish" bandlari — tanlanganda qiymat o'zgarmaydi, oyna ochiladi. */
const NEW_SUPPLIER = "__new_supplier__";
const NEW_PRODUCT = "__new_product__";

/** Hozirgina yaratilgan yozuv ro'yxat qayta yuklanguncha ham ko'rinib tursin. */
function mergeById<T extends { id: string }>(list: T[] | undefined, extra: T[]): T[] {
  const base = list ?? [];
  return [...base, ...extra.filter((e) => !base.some((b) => b.id === e.id))];
}

export default function CreateOrderDialog({ onClose, onCreated }: Props) {
  // Soliq o'chirilgan bo'lsa maydonlar ham ko'rinmaydi (server ham 0 yozadi)
  const taxEnabled = useTaxEnabled();
  const { can } = usePermissions();
  const currencies = useCurrencies();
  const suppliers = useApiQuery<{ suppliers: Supplier[] }>("/api/purchase/suppliers").data?.suppliers;
  const warehouses = useApiQuery<{ warehouses: WarehouseOption[] }>("/api/inventory/warehouses").data?.warehouses;
  // API chegarasi: 200 ta faol mahsulot
  const products = useApiQuery<{ products: ProductOption[] }>("/api/catalog/products", { limit: 200, isActive: true })
    .data?.products.filter((p) => p.isPurchaseable);
  const createOrder = useApiMutation((body: object) => api.post<{ order: { id: string } }>("/api/purchase/orders", body));
  const confirmOrder = useApiMutation((id: string) => api.post(`/api/purchase/orders/${id}/confirm`));

  const [supplierId, setSupplierId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [orderDate, setOrderDate] = useState(todayLocal);
  const [expectedDate, setExpectedDate] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineItem[]>([emptyLine()]);
  const [loading, setLoading] = useState(false);

  // Xaridda ishlatiladigan valyutalar (yuqorida tanlanadi); qator valyutasi shulardan
  const [chosenCurrencies, setChosenCurrencies] = useState<string[] | null>(null);
  const selectedCurrencies = chosenCurrencies ?? [currencies.base];
  const lineCurrency = (line: LineItem) => line.currency || selectedCurrencies[0] || currencies.base;
  const showCurrencyColumn = selectedCurrencies.length > 1 || selectedCurrencies[0] !== currencies.base;

  // Shu oynaning o'zidan yetkazuvchi va mahsulot qo'shish
  const [supplierDialogOpen, setSupplierDialogOpen] = useState(false);
  const [productDialogLine, setProductDialogLine] = useState<number | null>(null);
  const [extraSuppliers, setExtraSuppliers] = useState<Supplier[]>([]);
  const [extraProducts, setExtraProducts] = useState<ProductOption[]>([]);
  const supplierOptions = mergeById(suppliers, extraSuppliers);
  const productOptions = mergeById(products, extraProducts);
  const canCreateProduct = can("products.create");

  // Auto-set default warehouse
  if (!warehouseId && warehouses?.length) {
    const def = warehouses.find((w) => w.isDefault) ?? warehouses[0];
    setWarehouseId(def.id);
  }

  const toggleCurrency = (code: string) => {
    const next = selectedCurrencies.includes(code)
      ? selectedCurrencies.filter((c) => c !== code)
      : [...selectedCurrencies, code];
    if (next.length === 0) return;
    const ordered = currencies.codes.filter((c) => next.includes(c));
    setChosenCurrencies(ordered);
    // Olib tashlangan valyutadagi qatorlar birinchi valyutaga o'tadi
    setLines((prev) => prev.map((line) => (line.currency && !ordered.includes(line.currency) ? { ...line, currency: "" } : line)));
  };

  const addLine = () => setLines((p) => [...p, emptyLine()]);

  const removeLine = (i: number) => setLines((p) => p.filter((_, idx) => idx !== i));

  const updateLine = (i: number, field: keyof LineItem, value: string | number) => {
    setLines((p) => {
      const next = [...p];
      const line = { ...next[i]! };
      (line as Record<string, string | number>)[field] = value;
      // Mahsulot tanlanganda birlik, soliq va narx; narx valyutasi xaridda tanlangan bo'lsa — o'zida
      if (field === "productId" && typeof value === "string") {
        const prod = productOptions.find((p) => p.id === value);
        if (prod) {
          line.unitId = prod.baseUnitId;
          line.taxRate = num(prod.taxRate);
          const productCurrency = prod.purchaseCurrency ?? currencies.base;
          if (selectedCurrencies.includes(productCurrency)) {
            line.currency = productCurrency;
            line.unitPrice = num(prod.purchasePrice);
          } else {
            const target = lineCurrency(line);
            const price = currencies.toBase(prod.purchasePrice, prod.purchaseCurrency) / currencies.rateOf(target);
            line.unitPrice = Number.isFinite(price) ? Math.round(price * 100) / 100 : 0;
          }
        }
      }
      next[i] = line;
      return next;
    });
  };

  // Jami valyuta bo'yicha; asosiy valyutada taxminiy (joriy kurs)
  const perCurrency = new Map<string, { net: number; tax: number; total: number }>();
  for (const line of lines) {
    if (!line.productId) continue;
    const code = lineCurrency(line);
    const amounts = lineAmounts(line, taxEnabled);
    const acc = perCurrency.get(code) ?? { net: 0, tax: 0, total: 0 };
    perCurrency.set(code, { net: acc.net + amounts.net, tax: acc.tax + amounts.tax, total: acc.total + amounts.total });
  }
  const baseTotal = [...perCurrency].reduce((sum, [code, amounts]) => sum + amounts.total * currencies.rateOf(code), 0);

  const handleSubmit = async (asDraft: boolean) => {
    if (!supplierId) { toast.error("Yetkazuvchi tanlang"); return; }
    if (!warehouseId) { toast.error("Ombor tanlang"); return; }
    const validLines = lines.filter((l) => l.productId && l.orderedQty > 0);
    if (!validLines.length) { toast.error("Kamida bitta mahsulot qo'shing"); return; }

    setLoading(true);
    try {
      const { order } = await createOrder.mutateAsync({
        supplierId,
        warehouseId,
        orderDate,
        expectedDate: expectedDate || null,
        notes: notes || null,
        items: validLines.map((l) => {
          const code = lineCurrency(l);
          const foreign = code !== currencies.base;
          const salesPrice = l.salesPrice.trim();
          return {
            productId: l.productId,
            unitId: l.unitId,
            orderedQty: l.orderedQty,
            unitPrice: l.unitPrice,
            taxRate: l.taxRate,
            discountPercent: l.discountPercent,
            ...(foreign ? { currency: code } : {}),
            ...(salesPrice && Number(salesPrice) >= 0 ? { salesPrice, ...(foreign ? { salesCurrency: code } : {}) } : {}),
          };
        }),
      });
      if (asDraft) {
        toast.success("Qoralama saqlandi");
      } else {
        try {
          await confirmOrder.mutateAsync(order.id);
          toast.success("Buyurtma yaratildi va tasdiqlandi");
        } catch (err) {
          toast.error(`Buyurtma qoralama sifatida saqlandi: ${errorMessage(err)}`);
        }
      }
      onCreated(order.id);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally { setLoading(false); }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto">
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
              <Select
                value={supplierId}
                onValueChange={(v) => (v === NEW_SUPPLIER ? setSupplierDialogOpen(true) : setSupplierId(v))}
              >
                <SelectTrigger><SelectValue placeholder="Tanlang" /></SelectTrigger>
                <SelectContent>
                  {supplierOptions.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                  {supplierOptions.length > 0 && <SelectSeparator />}
                  <SelectItem value={NEW_SUPPLIER}>
                    <span className="flex items-center gap-1.5 font-medium text-primary">
                      <Plus className="h-3.5 w-3.5" /> Yangi yetkazuvchi qo'shish
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
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
              <Label>Valyutalar</Label>
              {currencies.codes.length > 1 ? (
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {currencies.codes.map((code) => (
                    <button
                      key={code}
                      type="button"
                      onClick={() => toggleCurrency(code)}
                      className={cn(
                        "h-8 rounded-lg border px-2.5 text-xs font-medium transition-colors cursor-pointer",
                        selectedCurrencies.includes(code)
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-muted/30 text-muted-foreground border-border hover:bg-accent",
                      )}
                    >
                      {code}
                    </button>
                  ))}
                </div>
              ) : (
                <Input value={currencies.base} disabled />
              )}
            </div>
            <div>
              <Label>Buyurtma sanasi</Label>
              <Input type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
            </div>
            <div>
              <Label>Kutilayotgan sana</Label>
              <Input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />
            </div>
          </div>

          <Separator />

          {/* Line items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div>
                <p className="text-sm font-semibold">Mahsulotlar</p>
                <p className="text-[11px] text-muted-foreground">
                  Sotuv narxi kiritilsa — tovar qabul qilinganda mahsulotning sotuv narxi yangilanadi
                </p>
              </div>
              <Button size="sm" variant="secondary" onClick={addLine}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Qo'shish
              </Button>
            </div>

            <div className="rounded-xl border border-border overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50 border-b border-border">
                    <th className="text-left px-3 py-2 text-xs text-muted-foreground min-w-[180px]">Mahsulot</th>
                    <th className="text-right px-3 py-2 text-xs text-muted-foreground w-24">Miqdor</th>
                    {showCurrencyColumn && <th className="text-left px-3 py-2 text-xs text-muted-foreground w-24">Valyuta</th>}
                    <th className="text-right px-3 py-2 text-xs text-muted-foreground w-28">Xarid narxi</th>
                    {taxEnabled && <th className="text-right px-3 py-2 text-xs text-muted-foreground w-20">Soliq %</th>}
                    <th className="text-right px-3 py-2 text-xs text-muted-foreground w-20">Chegirma %</th>
                    <th className="text-right px-3 py-2 text-xs text-muted-foreground w-28">Sotuv narxi</th>
                    <th className="text-right px-3 py-2 text-xs text-muted-foreground w-32">Jami</th>
                    <th className="w-8 px-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {lines.map((line, i) => {
                    const code = lineCurrency(line);
                    const lineTotal = lineAmounts(line, taxEnabled).total;

                    return (
                      <tr key={i}>
                        <td className="px-2 py-2">
                          <Select
                            value={line.productId}
                            onValueChange={(v) => (v === NEW_PRODUCT ? setProductDialogLine(i) : updateLine(i, "productId", v))}
                          >
                            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Mahsulot" /></SelectTrigger>
                            <SelectContent>
                              {productOptions.map((p) => (
                                <SelectItem key={p.id} value={p.id}>
                                  <span className="font-mono text-[11px] mr-1 text-muted-foreground">{p.sku}</span>
                                  {p.name}
                                </SelectItem>
                              ))}
                              {canCreateProduct && (
                                <>
                                  {productOptions.length > 0 && <SelectSeparator />}
                                  <SelectItem value={NEW_PRODUCT}>
                                    <span className="flex items-center gap-1.5 font-medium text-primary">
                                      <Plus className="h-3.5 w-3.5" /> Yangi mahsulot qo'shish
                                    </span>
                                  </SelectItem>
                                </>
                              )}
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="px-2 py-2">
                          <Input type="number" min="0" step="0.001" className="h-8 text-xs text-right"
                            value={line.orderedQty}
                            onChange={(e) => updateLine(i, "orderedQty", e.target.valueAsNumber || 0)} />
                        </td>
                        {showCurrencyColumn && (
                          <td className="px-2 py-2">
                            <Select value={code} onValueChange={(v) => updateLine(i, "currency", v)}>
                              <SelectTrigger className="h-8 text-xs w-20"><SelectValue /></SelectTrigger>
                              <SelectContent position="popper">
                                {selectedCurrencies.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </td>
                        )}
                        <td className="px-2 py-2">
                          <Input type="number" min="0" step="any" className="h-8 text-xs text-right"
                            value={line.unitPrice}
                            onChange={(e) => updateLine(i, "unitPrice", e.target.valueAsNumber || 0)} />
                        </td>
                        {taxEnabled && (
                          <td className="px-2 py-2">
                            <Input type="number" min="0" max="100" className="h-8 text-xs text-right"
                              value={line.taxRate}
                              onChange={(e) => updateLine(i, "taxRate", e.target.valueAsNumber || 0)} />
                          </td>
                        )}
                        <td className="px-2 py-2">
                          <Input type="number" min="0" max="100" className="h-8 text-xs text-right"
                            value={line.discountPercent}
                            onChange={(e) => updateLine(i, "discountPercent", e.target.valueAsNumber || 0)} />
                        </td>
                        <td className="px-2 py-2">
                          <Input type="number" min="0" step="any" className="h-8 text-xs text-right"
                            placeholder="—"
                            title={`Qabulda mahsulotning yangi sotuv narxi, ${code} (bo'sh — o'zgarmaydi)`}
                            value={line.salesPrice}
                            onChange={(e) => updateLine(i, "salesPrice", e.target.value)} />
                        </td>
                        <td className="px-3 py-2 text-right font-medium text-xs whitespace-nowrap">
                          {formatMoney(lineTotal, code)}
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
            <div className="w-72 space-y-1 text-sm">
              {perCurrency.size === 0 ? (
                <div className="flex justify-between font-bold text-base">
                  <span>Jami</span>
                  <span className="text-primary">0 {currencySymbol(currencies.base)}</span>
                </div>
              ) : (
                [...perCurrency].map(([code, amounts]) => (
                  <div key={code} className="space-y-1">
                    {perCurrency.size === 1 && (
                      <>
                        <div className="flex justify-between text-muted-foreground">
                          <span>Mahsulotlar jami</span>
                          <span>{formatMoney(amounts.net, code)}</span>
                        </div>
                        {taxEnabled && (
                          <div className="flex justify-between text-muted-foreground">
                            <span>QQS</span>
                            <span>{formatMoney(amounts.tax, code)}</span>
                          </div>
                        )}
                        <Separator />
                      </>
                    )}
                    <div className="flex justify-between font-bold text-base">
                      <span>Jami{perCurrency.size > 1 ? ` (${code})` : ""}</span>
                      <span className="text-primary">{formatMoney(amounts.total, code)}</span>
                    </div>
                  </div>
                ))
              )}
              {showCurrencyColumn && perCurrency.size > 0 && Number.isFinite(baseTotal) && (
                <div className="flex justify-between text-xs text-muted-foreground pt-1">
                  <span>≈ {currencies.base} da (joriy kurs)</span>
                  <span>{formatMoney(baseTotal, currencies.base)}</span>
                </div>
              )}
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
          {can("purchase.approve") && (
            <Button onClick={() => handleSubmit(false)} disabled={loading}>
              {loading ? "..." : "Yaratish va tasdiqlash"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>

      {supplierDialogOpen && (
        <QuickSupplierDialog
          onClose={() => setSupplierDialogOpen(false)}
          onCreated={(supplier) => {
            setExtraSuppliers((prev) => [...prev, supplier]);
            setSupplierId(supplier.id);
            setSupplierDialogOpen(false);
          }}
        />
      )}

      {productDialogLine !== null && (
        <QuickProductDialog
          onClose={() => setProductDialogLine(null)}
          onCreated={(product) => {
            const lineIndex = productDialogLine;
            setExtraProducts((prev) => [...prev, product]);
            setLines((prev) =>
              prev.map((line, idx) =>
                idx === lineIndex
                  ? {
                      ...line,
                      productId: product.id,
                      unitId: product.baseUnitId,
                      unitPrice: num(product.purchasePrice),
                      taxRate: num(product.taxRate),
                    }
                  : line,
              ),
            );
            setProductDialogLine(null);
          }}
        />
      )}
    </Dialog>
  );
}
