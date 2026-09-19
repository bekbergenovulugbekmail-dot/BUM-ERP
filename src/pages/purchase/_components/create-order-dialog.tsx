import { useState } from "react";
import { toast } from "sonner";
import { Maximize2, Minimize2, Plus, ScanLine, Trash2, ShoppingCart } from "lucide-react";
import { currencySymbol } from "@bum/shared";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Checkbox } from "@/components/ui/checkbox.tsx";
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
import PriceSuggestions from "./price-suggestions.tsx";
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
  /** Oyna butun ekranga yoyilganmi — ko'p qatorli buyurtmalarni qulay ko'rish uchun. */
  const [full, setFull] = useState(false);

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
  /** Qaysi qatorda narx takliflari ochiq (bittada — bittasi). */
  const [suggestFor, setSuggestFor] = useState<number | null>(null);
  const supplierOptions = mergeById(suppliers, extraSuppliers);
  const productOptions = mergeById(products, extraProducts);
  const canCreateProduct = can("products.create");
  // Narx takliflari tannarxni ochadi — ruxsatsiz rolda tugma umuman ko'rinmaydi (server ham 403 beradi)
  const canSuggestPrices = can("products.view_cost");

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

  // ── Mahsulot qidirish: nomi/SKU bo'yicha ko'p tanlash yoki barkod bilan darhol qo'shish ──
  const [productSearch, setProductSearch] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [scanBusy, setScanBusy] = useState(false);

  const searchTerm = productSearch.trim().toLowerCase();
  const matches = searchTerm.length < 2
    ? []
    : productOptions.filter((product) =>
        [product.name, product.sku].some((field) => field?.toLowerCase().includes(searchTerm)),
      ).slice(0, 50);

  /** Tanlangan mahsulotlarni qatorlarga qo'shadi (allaqachon bor bo'lsa takrorlamaydi). */
  const addPicked = (ids: string[]) => {
    if (ids.length === 0) return;
    setLines((current) => {
      const existing = new Set(current.map((line) => line.productId).filter(Boolean));
      const fresh = ids.filter((id) => !existing.has(id));
      if (fresh.length === 0) return current;
      const created = fresh.map((id) => {
        const line = emptyLine();
        const product = productOptions.find((option) => option.id === id);
        if (product) {
          line.productId = id;
          line.unitId = product.baseUnitId;
          line.taxRate = num(product.taxRate);
          const productCurrency = product.purchaseCurrency ?? currencies.base;
          if (selectedCurrencies.includes(productCurrency)) {
            line.currency = productCurrency;
            line.unitPrice = num(product.purchasePrice);
          }
        }
        return line;
      });
      // Bo'sh (mahsulotsiz) qatorlar o'rniga yoziladi
      const kept = current.filter((line) => line.productId);
      return [...kept, ...created];
    });
    setPicked([]);
    setProductSearch("");
  };

  /** Barkod: aniq mos kelgan mahsulot darhol qo'shiladi (skaner ham shu maydonga yozadi). */
  const handleBarcode = async (code: string) => {
    const value = code.trim();
    if (!value) return;
    setScanBusy(true);
    try {
      const { product } = await api.get<{ product: { id: string; name: string } | null }>(
        `/api/catalog/products/by-barcode/${encodeURIComponent(value)}`,
      );
      if (!product) {
        toast.error("Bu barkod bo'yicha mahsulot topilmadi");
        return;
      }
      if (!productOptions.some((option) => option.id === product.id)) {
        toast.error(`${product.name} — xarid uchun ochiq emas`);
        return;
      }
      addPicked([product.id]);
      toast.success(`${product.name} qo'shildi`);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setScanBusy(false);
    }
  };

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
      <DialogContent className={cn("max-h-[92vh] overflow-y-auto", full ? "sm:max-w-[98vw]" : "sm:max-w-5xl")}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShoppingCart className="h-5 w-5 text-primary" />
            Yangi xarid buyurtmasi
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0"
              data-testid="order-fullscreen"
              aria-label={full ? "Oynani kichraytirish" : "Butun ekranga yoyish"}
              title={full ? "Kichraytirish" : "Butun ekranga yoyish"}
              onClick={() => setFull((current) => !current)}
            >
              {full ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </Button>
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

            {/* Qidirish: nomi bo'yicha ro'yxatdan belgilab qo'shish yoki barkod bilan darhol */}
            <div className="mb-3 rounded-xl border border-border p-3 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  className="h-9 flex-1 min-w-48"
                  placeholder="Mahsulot nomi, SKU yoki barkod (skaner ham shu yerga)"
                  value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter") return;
                    e.preventDefault();
                    // Barkod odatda raqamlardan iborat — aniq mos kelsa darhol qo'shamiz
                    if (/^[0-9]{6,}$/.test(productSearch.trim())) void handleBarcode(productSearch);
                    else if (matches.length === 1) addPicked([matches[0]!.id]);
                  }}
                />
                <Button size="sm" variant="secondary" disabled={scanBusy || !productSearch.trim()} onClick={() => void handleBarcode(productSearch)}>
                  <ScanLine className="h-3.5 w-3.5 mr-1" /> Barkod
                </Button>
                {picked.length > 0 && (
                  <Button size="sm" onClick={() => addPicked(picked)}>
                    Tanlanganlarni qo'shish ({picked.length})
                  </Button>
                )}
              </div>
              {searchTerm.length >= 2 && (
                matches.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Mahsulot topilmadi</p>
                ) : (
                  <div className="max-h-44 overflow-y-auto rounded-lg border border-border">
                    {matches.map((product) => (
                      <label
                        key={product.id}
                        className="flex cursor-pointer items-center gap-2 border-b border-border px-2 py-1.5 text-sm last:border-0 hover:bg-accent/40"
                      >
                        <Checkbox
                          checked={picked.includes(product.id)}
                          onCheckedChange={(checked) =>
                            setPicked((current) =>
                              checked === true ? [...current, product.id] : current.filter((id) => id !== product.id),
                            )
                          }
                        />
                        <span className="font-mono text-[11px] text-muted-foreground">{product.sku}</span>
                        <span className="min-w-0 flex-1 truncate">{product.name}</span>
                        <span className="text-xs text-muted-foreground">{num(product.purchasePrice).toLocaleString("uz-UZ")}</span>
                      </label>
                    ))}
                  </div>
                )
              )}
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
                          <div className="flex items-center gap-1">
                            <Input type="number" min="0" step="any" className="h-8 text-xs text-right"
                              value={line.unitPrice}
                              onChange={(e) => updateLine(i, "unitPrice", e.target.valueAsNumber || 0)} />
                            {canSuggestPrices && (
                              <PriceSuggestions
                                productId={line.productId}
                                unitId={line.unitId}
                                currency={code}
                                rate={currencies.rateOf(code)}
                                open={suggestFor === i}
                                onOpenChange={(next) => setSuggestFor(next ? i : null)}
                                onPickPurchase={(value) => updateLine(i, "unitPrice", value)}
                                onPickSales={(value) => updateLine(i, "salesPrice", String(value))}
                              />
                            )}
                          </div>
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
