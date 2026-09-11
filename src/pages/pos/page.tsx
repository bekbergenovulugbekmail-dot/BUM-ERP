import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "motion/react";
import {
  ShoppingCart, Search, Trash2, Plus, Minus, CreditCard, Banknote,
  Smartphone, X, Power, Package, Calculator, ScanLine,
  UserPlus, UserRound, Wallet, HandCoins, Gift,
} from "lucide-react";
import type { CashbackSettings } from "@bum/shared";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { cn } from "@/lib/utils.ts";
import { api, errorMessage } from "@/lib/api.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";
import { useCurrentUser } from "@/hooks/use-auth.ts";
import { useDebounce } from "@/hooks/use-debounce.ts";
import ShiftOpenDialog from "./_components/shift-open-dialog.tsx";
import ShiftCloseDialog from "./_components/shift-close-dialog.tsx";
import POSReceipt from "./_components/pos-receipt.tsx";
import CustomerPicker from "./_components/customer-picker.tsx";
import CustomerPaymentDialog from "./_components/customer-payment-dialog.tsx";
import BarcodeScanner from "@/components/barcode-scanner.tsx";
import { useHIDScanner } from "@/hooks/use-hid-scanner.ts";
import { computeLine, fromMinor, minorToNumber } from "@/pages/sales/_lib/line-amounts.ts";
import {
  num,
  type Customer, type PaymentMethod, type PosCustomerSummary, type PosShift, type ProductOption,
  type SalesOrderDetail, type WarehouseOption,
} from "@/pages/sales/_lib/types.ts";

type CartItem = {
  productId: string;
  unitId: string;
  name: string;
  sku: string;
  qty: number;
  /** Prays-list narxi — serverga yuborilmaydi, faqat oldindan ko'rish uchun. */
  unitPrice: string;
  taxRate: string;
  taxIncluded: boolean;
  stock: number;
};

type SaleResult = {
  order: SalesOrderDetail;
  paid: string;
  /** Mijozga qo'lda beriladigan qaytim (balansga o'tgani ayirilgan). */
  change: string;
  balanceUsed: string;
  changeToBalance: string;
  cashbackUsed: string;
  /** Shu chekdan hisoblangan keshbek. */
  cashbackEarned: string;
  /** Shu chekdan qarzga yozilgan summa. */
  debt: string;
  customer: PosCustomerSummary | null;
};
type LastReceipt = SaleResult & { payMethod: PaymentMethod };

const PAY_METHODS: { key: PaymentMethod; label: string; icon: React.ElementType; color: string }[] = [
  { key: "cash", label: "Naqd", icon: Banknote, color: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30" },
  { key: "card", label: "Karta", icon: CreditCard, color: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30" },
  { key: "bank", label: "Bank", icon: Smartphone, color: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/30" },
];

const fmt = (n: number) => new Intl.NumberFormat("uz-UZ").format(Math.round(n));
/** Kiritilgan summa → tiyin (faqat oldindan ko'rish; aniq hisob serverda). */
const minorOf = (value: string | number) => BigInt(Math.round(num(value) * 100));
const minBigInt = (...values: bigint[]) => values.reduce((a, b) => (b < a ? b : a));

export default function POSPage() {
  const currentUser = useCurrentUser();
  const warehouses = useApiQuery<{ warehouses: WarehouseOption[] }>("/api/inventory/warehouses").data?.warehouses;
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string | null>(null);
  const defaultWh = warehouses?.find((w) => w.isDefault) ?? warehouses?.[0];
  const whId = selectedWarehouseId ?? defaultWh?.id;

  const shiftQuery = useApiQuery<{ shift: PosShift | null }>(
    whId ? "/api/sales/pos/shifts/open" : null,
    { warehouseId: whId },
  );
  const shift = shiftQuery.data?.shift;
  // Chek smena omboridan chiqadi — qoldiq ham shu ombordan
  const stockWarehouseId = shift?.warehouseId ?? whId;

  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebounce(search.trim(), 250);
  // Qidiruv serverda (nom, SKU, barkod); API chegarasi 200 ta
  const products = useApiQuery<{ products: ProductOption[] }>(
    "/api/catalog/products",
    { limit: 200, isActive: true, search: debouncedSearch || undefined },
    { placeholderData: (previous) => previous },
  ).data?.products;

  const stockQuery = useApiQuery<{ stock: { productId: string; quantity: string }[] }>(
    stockWarehouseId ? "/api/inventory/stock" : null,
    { warehouseId: stockWarehouseId },
  );

  const completeSale = useApiMutation((body: object) => api.post<SaleResult>("/api/sales/pos/sales", body));

  const [cart, setCart] = useState<CartItem[]>([]);
  const [payMethod, setPayMethod] = useState<PaymentMethod>("cash");
  const [amountPaid, setAmountPaid] = useState("");
  const [showOpenShift, setShowOpenShift] = useState(false);
  const [closingShift, setClosingShift] = useState<PosShift | null>(null);
  const [lastReceipt, setLastReceipt] = useState<LastReceipt | null>(null);
  const [showScanner, setShowScanner] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  // Mijoz: qarzi va balansi ko'rinib turadi; sotuv yoki to'lovdan keyin so'rov yangilanadi
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [showCustomerPicker, setShowCustomerPicker] = useState(false);
  const [customerPayment, setCustomerPayment] = useState<"deposit" | "debt" | null>(null);
  const [useBalance, setUseBalance] = useState(false);
  const [balanceInput, setBalanceInput] = useState("");
  const [changeToBalance, setChangeToBalance] = useState(false);
  const [useCashback, setUseCashback] = useState(false);
  const [cashbackInput, setCashbackInput] = useState("");
  const cashbackSettings = useApiQuery<{ settings: CashbackSettings }>(
    "/api/sales/cashback/settings",
    undefined,
    { staleTime: 60_000 },
  ).data?.settings;
  const customer = useApiQuery<{ customer: Customer }>(
    customerId ? `/api/sales/customers/${customerId}` : null,
  ).data?.customer;
  const customerDebt = customer ? Math.max(0, num(customer.totalDebt)) : 0;
  const customerBalance = customer ? num(customer.balance) : 0;
  const customerCashback = customer ? num(customer.cashbackBalance) : 0;

  const clearCustomer = () => {
    setCustomerId(null);
    setUseBalance(false);
    setBalanceInput("");
    setChangeToBalance(false);
    setUseCashback(false);
    setCashbackInput("");
  };

  // `warehouse.view` ruxsati bo'lmasa (kassir) qoldiq noma'lum — cheklov serverda tekshiriladi
  const stockMap = stockQuery.data
    ? new Map(stockQuery.data.stock.map((s) => [s.productId, num(s.quantity)]))
    : null;
  const stockOf = (productId: string) => (stockMap ? stockMap.get(productId) ?? 0 : Number.POSITIVE_INFINITY);

  const filtered = (products ?? []).filter((p) => p.isActive && p.isSaleable);

  // Oldindan ko'rish — serverdagi hisob bilan bir xil (soliq `taxIncluded` bo'yicha ichida yoki ustiga)
  const amounts = cart.map((i) =>
    computeLine({ quantity: i.qty, unitPrice: i.unitPrice, taxRate: i.taxRate, taxIncluded: i.taxIncluded }),
  );
  const totalMinor = amounts.reduce((s, a) => s + a.lineTotal, 0n);
  const subtotal = minorToNumber(amounts.reduce((s, a) => s + a.net, 0n));
  const taxTotal = minorToNumber(amounts.reduce((s, a) => s + a.tax, 0n));
  const total = minorToNumber(totalMinor);
  // Keshbekdan: mijoz keshbeki, sozlamadagi chek ulushi chegarasi va chek summasidan oshmaydi
  const cashbackEnabled = !!cashbackSettings?.enabled;
  const cashbackAvailable = customer && cashbackEnabled ? minorOf(customer.cashbackBalance) : 0n;
  const cashbackLimit = cashbackSettings
    ? (totalMinor * BigInt(Math.round(cashbackSettings.maxUsagePercent * 100))) / 10_000n
    : 0n;
  const cashbackRequested = cashbackInput.trim() !== "" ? minorOf(cashbackInput) : cashbackAvailable;
  const cashbackMinor = customer && useCashback && cashbackRequested > 0n
    ? minBigInt(cashbackRequested, cashbackAvailable, cashbackLimit)
    : 0n;
  // Mijoz balansidan yechiladigan qism — qolgan chek summasi va balansdan oshmaydi
  const balanceAvailable = customer ? minorOf(customer.balance) : 0n;
  const balanceRequested = balanceInput.trim() !== "" ? minorOf(balanceInput) : balanceAvailable;
  const balanceMinor = customer && useBalance && balanceRequested > 0n
    ? minBigInt(balanceRequested, balanceAvailable, totalMinor - cashbackMinor)
    : 0n;
  const dueMinor = totalMinor - cashbackMinor - balanceMinor;
  const due = minorToNumber(dueMinor);
  // Naqdda bo'sh maydon — aniq summa; karta/bankda to'lov doim to'lanadigan summaga teng
  const paid = payMethod === "cash" && amountPaid.trim() !== "" ? num(amountPaid) : due;
  const change = Math.max(0, paid - due);
  // Yetmagan qismi faqat mijoz tanlanganda qarzga yoziladi
  const debtAmount = Math.max(0, due - paid);
  const onCredit = debtAmount >= 0.01;

  const addToCart = (p: ProductOption) => {
    const stock = stockOf(p.id);
    if (stock <= 0) { toast.error("Omborda mavjud emas"); return; }
    setCart((prev) => {
      const idx = prev.findIndex((i) => i.productId === p.id);
      if (idx >= 0) {
        const next = [...prev];
        const item = next[idx];
        if (item.qty >= item.stock) { toast.error("Omborda yetarli emas"); return prev; }
        next[idx] = { ...item, qty: item.qty + 1 };
        return next;
      }
      return [...prev, {
        productId: p.id,
        unitId: p.baseUnitId,
        name: p.name,
        sku: p.sku,
        qty: 1,
        unitPrice: p.salesPrice,
        taxRate: p.taxRate,
        taxIncluded: p.taxIncluded,
        stock,
      }];
    });
  };
  const addToCartRef = useRef(addToCart);
  useEffect(() => {
    addToCartRef.current = addToCart;
  });

  // HID scanner support (USB/Bluetooth barcode scanners)
  const handleBarcodeScan = useCallback(async (barcode: string) => {
    const matches = (p: ProductOption) => p.isActive && p.isSaleable && (p.barcode === barcode || p.sku === barcode);
    let found = products?.find(matches);
    if (!found) {
      // Yuklangan ro'yxatda yo'q — serverdan aniq barkod bo'yicha
      try {
        const result = await api.get<{ products: ProductOption[] }>("/api/catalog/products", {
          search: barcode, isActive: true, limit: 10,
        });
        found = result.products.find(matches);
      } catch {
        // pastda qidiruvga o'tiladi
      }
    }
    if (found) {
      addToCartRef.current(found);
      toast.success(`${found.name} savatchaga qo'shildi`);
    } else {
      setSearch(barcode);
      toast.info(`"${barcode}" qidirilmoqda...`);
    }
  }, [products]);

  const updateQty = (idx: number, delta: number) => {
    setCart((prev) => {
      const next = [...prev];
      const item = next[idx];
      const newQty = item.qty + delta;
      if (newQty <= 0) return prev.filter((_, i) => i !== idx);
      if (newQty > item.stock) { toast.error("Omborda yetarli emas"); return prev; }
      next[idx] = { ...item, qty: newQty };
      return next;
    });
  };

  const removeFromCart = (idx: number) => setCart((p) => p.filter((_, i) => i !== idx));

  // HID scanner — fires when USB/Bluetooth scanner sends barcode + Enter
  useHIDScanner({
    onScan: (code: string) => { void handleBarcodeScan(code); },
    minLength: 3,
  });

  const handleCheckout = async () => {
    if (!shift) { toast.error("Avval smena oching"); return; }
    if (!cart.length) { toast.error("Savatcha bo'sh"); return; }
    if (onCredit && !customer) { toast.error("To'lov yetarli emas — qarzga sotish uchun mijoz tanlang"); return; }

    const keepChange = !!customer && payMethod === "cash" && changeToBalance && change > 0;
    try {
      // Narx, soliq va ombor yuborilmaydi — server prays-list, mahsulot soliqi va smena omboridan oladi
      const result = await completeSale.mutateAsync({
        shiftId: shift.id,
        customerId: customer?.id ?? null,
        items: cart.map((i) => ({ productId: i.productId, unitId: i.unitId, quantity: i.qty })),
        paymentMethod: payMethod,
        amountPaid: payMethod === "cash" && amountPaid.trim() !== "" ? amountPaid.trim() : fromMinor(dueMinor),
        ...(cashbackMinor > 0n ? { cashbackAmount: fromMinor(cashbackMinor) } : {}),
        ...(balanceMinor > 0n ? { balanceAmount: fromMinor(balanceMinor) } : {}),
        ...(keepChange ? { changeToBalance: true } : {}),
      });
      setLastReceipt({ ...result, payMethod });
      setCart([]);
      setAmountPaid("");
      clearCustomer();
      const details = [
        num(result.change) > 0 ? `Qaytim: ${fmt(num(result.change))} so'm` : null,
        num(result.changeToBalance) > 0 ? `Balansga: ${fmt(num(result.changeToBalance))} so'm` : null,
        num(result.debt) > 0 ? `Qarzga: ${fmt(num(result.debt))} so'm` : null,
        num(result.cashbackEarned) > 0 ? `Keshbek: +${fmt(num(result.cashbackEarned))} so'm` : null,
      ].filter(Boolean);
      toast.success(["Sotuv amalga oshirildi", ...details].join(" · "));
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  // Klaviatura tinglovchisi har renderda qayta ulanmasligi uchun — eng so'nggi funksiya ref'da
  const checkoutRef = useRef(handleCheckout);
  useEffect(() => {
    checkoutRef.current = handleCheckout;
  });

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F2") { e.preventDefault(); searchRef.current?.focus(); }
      if (e.key === "F4") { e.preventDefault(); setShowCustomerPicker(true); }
      if (e.key === "F12" && cart.length > 0) { e.preventDefault(); void checkoutRef.current(); }
      if (e.key === "Escape") { setCart([]); setAmountPaid(""); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cart.length]);

  const modals = (
    <>
      {showOpenShift && whId && (
        <ShiftOpenDialog
          warehouseId={whId}
          warehouseName={warehouses?.find((w) => w.id === whId)?.name}
          onClose={() => setShowOpenShift(false)}
        />
      )}
      {/* Yopilgach natija (kassa farqi) ko'rinib turishi uchun smena nusxasi saqlanadi */}
      {closingShift && (
        <ShiftCloseDialog shift={closingShift} onClose={() => setClosingShift(null)} />
      )}
    </>
  );

  if (!warehouses) {
    return <div className="h-screen flex items-center justify-center"><Skeleton className="h-32 w-64 rounded-2xl" /></div>;
  }

  if (warehouses.length === 0) {
    return (
      <div className="h-screen flex flex-col items-center justify-center gap-2 text-center">
        <Package className="h-10 w-10 text-muted-foreground/40" />
        <p className="text-muted-foreground">Sizga ruxsat berilgan faol ombor yo'q</p>
      </div>
    );
  }

  if (shiftQuery.isError) {
    return (
      <div className="h-screen flex flex-col items-center justify-center gap-2 text-center">
        <Power className="h-10 w-10 text-muted-foreground/40" />
        <p className="text-destructive">{errorMessage(shiftQuery.error)}</p>
      </div>
    );
  }

  if (shift === null) {
    return (
      <div className="h-screen flex flex-col items-center justify-center gap-6 bg-background">
        <div className="text-center space-y-2">
          <div className="h-20 w-20 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
            <Power className="h-10 w-10 text-primary" />
          </div>
          <h2 className="text-2xl font-bold">POS Kassasi</h2>
          <p className="text-muted-foreground">Smena ochilmagan. Kassaga kirish uchun smena oching.</p>
        </div>
        {warehouses.length > 1 && (
          <Select value={whId} onValueChange={(v) => { setSelectedWarehouseId(v); setCart([]); }}>
            <SelectTrigger className="w-64"><SelectValue placeholder="Ombor" /></SelectTrigger>
            <SelectContent>
              {warehouses.map((w) => (
                <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Button size="lg" onClick={() => setShowOpenShift(true)}>
          Smena ochish
        </Button>
        {modals}
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Left — product grid */}
      <div className="flex-1 flex flex-col border-r border-border">
        {/* POS topbar */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-card shrink-0">
          <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <Calculator className="h-4 w-4 text-primary" />
          </div>
          <span className="font-bold text-sm">POS Kassasi</span>
          {shift && (
            <span className="text-xs bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 px-2 py-0.5 rounded-full">
              {shift.warehouseName} · {shift.receiptCount} chek · {fmt(num(shift.totalSales))} so'm
            </span>
          )}
          <div className="ml-auto flex gap-2">
            {shift && (
              <Button size="sm" variant="secondary" onClick={() => setClosingShift(shift)}>
                <Power className="h-3.5 w-3.5 mr-1" /> Smena yopish
              </Button>
            )}
          </div>
        </div>

        {/* Search */}
        <div className="px-4 py-3 border-b border-border shrink-0">
          <div className="relative flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                ref={searchRef}
                className="pl-9 h-10"
                placeholder="Mahsulot, SKU, barkod (F2)..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Button
              variant="secondary"
              size="icon"
              className="h-10 w-10 shrink-0"
              title="Kamera bilan skanerlash"
              onClick={() => setShowScanner(true)}
            >
              <ScanLine className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Products */}
        <div className="flex-1 overflow-y-auto p-4">
          {!products ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
              {Array.from({ length: 12 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
              {filtered.map((p) => {
                const stock = stockOf(p.id);
                const inCart = cart.find((c) => c.productId === p.id);
                return (
                  <motion.button
                    key={p.id}
                    whileTap={{ scale: 0.96 }}
                    onClick={() => addToCart(p)}
                    disabled={stock <= 0}
                    className={cn(
                      "rounded-xl border text-left p-3 transition-all cursor-pointer relative",
                      stock <= 0
                        ? "opacity-40 cursor-not-allowed bg-muted border-border"
                        : inCart
                          ? "bg-primary/5 border-primary/40 shadow-sm"
                          : "bg-card border-border hover:border-primary/30 hover:bg-accent/50"
                    )}
                  >
                    {inCart && (
                      <span className="absolute top-2 right-2 h-5 w-5 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-bold">
                        {inCart.qty}
                      </span>
                    )}
                    <Package className="h-5 w-5 text-muted-foreground mb-2" />
                    <p className="text-xs font-medium leading-tight line-clamp-2">{p.name}</p>
                    <p className="text-[11px] text-muted-foreground font-mono mt-0.5">{p.sku}</p>
                    <p className="text-sm font-bold mt-1 text-primary">{fmt(num(p.salesPrice))} so'm</p>
                    {stockMap && <p className="text-[11px] text-muted-foreground">Qoldi: {fmt(stock)}</p>}
                  </motion.button>
                );
              })}
              {filtered.length === 0 && (
                <div className="col-span-full flex flex-col items-center py-12 text-center text-muted-foreground">
                  <Package className="h-10 w-10 mb-2 opacity-30" />
                  <p>Mahsulot topilmadi</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Right — cart & checkout */}
      <div className="w-80 xl:w-96 flex flex-col bg-card border-l border-border">
        {/* Cart header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <ShoppingCart className="h-4 w-4 text-primary" />
            <span className="font-semibold text-sm">Savatcha</span>
            {cart.length > 0 && (
              <span className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded-full">{cart.length}</span>
            )}
          </div>
          {cart.length > 0 && (
            <Button size="sm" variant="ghost" className="h-7 text-destructive" onClick={() => setCart([])}>
              <Trash2 className="h-3.5 w-3.5 mr-1" /> Tozalash
            </Button>
          )}
        </div>

        {/* Mijoz */}
        <div className="px-3 py-2 border-b border-border shrink-0">
          {customer ? (
            <div className="rounded-xl border border-border bg-muted/30 p-2.5 space-y-2">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <UserRound className="h-4 w-4 text-primary" />
                </div>
                <button
                  type="button"
                  className="flex-1 min-w-0 text-left cursor-pointer"
                  title="Mijozni almashtirish (F4)"
                  onClick={() => setShowCustomerPicker(true)}
                >
                  <p className="text-sm font-semibold truncate">{customer.name}</p>
                  <p className="text-[11px] text-muted-foreground truncate">{customer.phone ?? customer.code}</p>
                </button>
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" title="Mijozni olib tashlash" onClick={clearCustomer}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
              <div className={cn("grid gap-1.5 text-[11px]", cashbackEnabled ? "grid-cols-3" : "grid-cols-2")}>
                {[
                  { label: "Qarz", value: customerDebt, tone: "bg-amber-500/10 text-amber-700 dark:text-amber-400" },
                  { label: "Balans", value: customerBalance, tone: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
                  ...(cashbackEnabled
                    ? [{ label: "Keshbek", value: customerCashback, tone: "bg-violet-500/10 text-violet-700 dark:text-violet-400" }]
                    : []),
                ].map((cell) => (
                  <div
                    key={cell.label}
                    className={cn("rounded-lg px-2 py-1.5 min-w-0", cell.value > 0 ? cell.tone : "bg-background text-muted-foreground")}
                  >
                    <p>{cell.label}</p>
                    <p className="text-[13px] font-bold truncate" title={`${fmt(cell.value)} so'm`}>{fmt(cell.value)}</p>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <Button size="sm" variant="secondary" className="h-7 text-xs" onClick={() => setCustomerPayment("deposit")}>
                  <Wallet className="h-3.5 w-3.5 mr-1" /> Balansga kirim
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-7 text-xs"
                  disabled={customerDebt <= 0}
                  onClick={() => setCustomerPayment("debt")}
                >
                  <HandCoins className="h-3.5 w-3.5 mr-1" /> Qarzni to'lash
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="secondary"
              className="w-full h-9 justify-start text-muted-foreground"
              onClick={() => setShowCustomerPicker(true)}
            >
              <UserPlus className="h-4 w-4 mr-2" /> Mijoz tanlash (F4)
            </Button>
          )}
        </div>

        {/* Cart items */}
        <div className="flex-1 overflow-y-auto px-3 py-2">
          {cart.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center py-8">
              <ShoppingCart className="h-12 w-12 text-muted-foreground/20 mb-3" />
              <p className="text-sm text-muted-foreground">Savatcha bo'sh</p>
              <p className="text-xs text-muted-foreground/60 mt-1">Mahsulotni bosib qo'shing</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              <AnimatePresence>
                {cart.map((item, idx) => (
                  <motion.div
                    key={item.productId}
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    className="flex items-center gap-2 bg-muted/30 rounded-xl p-2.5"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">{item.name}</p>
                      <p className="text-[11px] text-muted-foreground">{fmt(num(item.unitPrice))} so'm</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => updateQty(idx, -1)}>
                        <Minus className="h-3 w-3" />
                      </Button>
                      <span className="w-6 text-center text-xs font-bold">{item.qty}</span>
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => updateQty(idx, 1)}>
                        <Plus className="h-3 w-3" />
                      </Button>
                    </div>
                    <div className="text-right w-20">
                      <p className="text-xs font-semibold">
                        {fmt(minorToNumber(amounts[idx]!.lineTotal))} so'm
                      </p>
                    </div>
                    <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => removeFromCart(idx)}>
                      <X className="h-3 w-3 text-destructive" />
                    </Button>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>

        {/* Checkout */}
        <div className="border-t border-border p-4 space-y-3 shrink-0">
          {/* Totals */}
          <div className="space-y-1 text-sm">
            <div className="flex justify-between text-muted-foreground">
              <span>Soliqsiz</span><span>{fmt(subtotal)} so'm</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>QQS</span><span>{fmt(taxTotal)} so'm</span>
            </div>
            <div className="flex justify-between font-bold text-lg pt-1 border-t border-border">
              <span>Jami</span>
              <span className="text-primary">{fmt(total)} so'm</span>
            </div>
            {cashbackMinor > 0n && (
              <div className="flex justify-between text-violet-600 dark:text-violet-400">
                <span>Keshbekdan</span><span>−{fmt(minorToNumber(cashbackMinor))} so'm</span>
              </div>
            )}
            {balanceMinor > 0n && (
              <div className="flex justify-between text-emerald-600 dark:text-emerald-400">
                <span>Balansdan</span><span>−{fmt(minorToNumber(balanceMinor))} so'm</span>
              </div>
            )}
            {cashbackMinor + balanceMinor > 0n && (
              <div className="flex justify-between font-semibold">
                <span>To'lanadi</span><span>{fmt(due)} so'm</span>
              </div>
            )}
          </div>

          {/* Keshbekdan to'lash */}
          {customer && cashbackAvailable > 0n && cashbackLimit > 0n && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => { setUseCashback((v) => !v); setCashbackInput(""); }}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg border px-2.5 h-9 text-xs font-medium cursor-pointer shrink-0 transition-all",
                  useCashback
                    ? "bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/40"
                    : "bg-muted/30 text-muted-foreground border-border hover:bg-accent",
                )}
              >
                <Gift className="h-3.5 w-3.5" /> Keshbekdan
              </button>
              {useCashback && (
                <Input
                  type="number"
                  min="0"
                  className="h-9 text-right"
                  placeholder={String(minorToNumber(minBigInt(cashbackAvailable, cashbackLimit)))}
                  value={cashbackInput}
                  onChange={(e) => setCashbackInput(e.target.value)}
                />
              )}
            </div>
          )}

          {/* Mijoz balansidan to'lash */}
          {customer && balanceAvailable > 0n && totalMinor > 0n && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => { setUseBalance((v) => !v); setBalanceInput(""); }}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg border px-2.5 h-9 text-xs font-medium cursor-pointer shrink-0 transition-all",
                  useBalance
                    ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/40"
                    : "bg-muted/30 text-muted-foreground border-border hover:bg-accent",
                )}
              >
                <Wallet className="h-3.5 w-3.5" /> Balansdan
              </button>
              {useBalance && (
                <Input
                  type="number"
                  min="0"
                  className="h-9 text-right"
                  placeholder={String(minorToNumber(minBigInt(balanceAvailable, totalMinor)))}
                  value={balanceInput}
                  onChange={(e) => setBalanceInput(e.target.value)}
                />
              )}
            </div>
          )}

          {/* Payment method */}
          <div className="grid grid-cols-3 gap-2">
            {PAY_METHODS.map((m) => (
              <button
                key={m.key}
                onClick={() => setPayMethod(m.key)}
                className={cn(
                  "flex flex-col items-center gap-1 py-2 px-1 rounded-xl border text-xs font-medium transition-all cursor-pointer",
                  payMethod === m.key
                    ? m.color + " border-current"
                    : "bg-muted/30 text-muted-foreground border-border hover:bg-accent"
                )}
              >
                <m.icon className="h-4 w-4" />
                {m.label}
              </button>
            ))}
          </div>

          {/* Amount paid — faqat naqdda (karta/bank to'lovi chek summasidan oshmaydi) */}
          {payMethod === "cash" && (
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-xs text-muted-foreground">Berilgan summa</label>
                {customer && dueMinor > 0n && (
                  <button
                    type="button"
                    className="text-xs font-medium text-amber-600 dark:text-amber-400 hover:underline cursor-pointer"
                    onClick={() => setAmountPaid("0")}
                  >
                    Hammasi qarzga
                  </button>
                )}
              </div>
              <Input
                type="number"
                className="text-right text-lg font-bold h-11"
                placeholder={String(due)}
                value={amountPaid}
                onChange={(e) => setAmountPaid(e.target.value)}
              />
              {change > 0 && (
                <div className="flex items-center justify-between gap-2 text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                  <span>
                    {customer && changeToBalance ? `Qaytim balansga: +${fmt(change)} so'm` : `Qaytim: ${fmt(change)} so'm`}
                  </span>
                  {customer && (
                    <button
                      type="button"
                      className="text-xs font-medium text-primary hover:underline cursor-pointer"
                      onClick={() => setChangeToBalance((v) => !v)}
                    >
                      {changeToBalance ? "Qaytimni berish" : "Balansga o'tkazish"}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {onCredit && (
            <div className={cn(
              "rounded-lg px-3 py-2 text-xs font-medium",
              customer ? "bg-amber-500/10 text-amber-700 dark:text-amber-400" : "bg-destructive/10 text-destructive",
            )}>
              {customer
                ? `Qarzga yoziladi: ${fmt(debtAmount)} so'm`
                : "To'lov yetarli emas — qarzga sotish uchun mijoz tanlang"}
            </div>
          )}

          {/* Checkout button */}
          <Button
            className="w-full h-12 text-base font-bold"
            onClick={() => { void handleCheckout(); }}
            disabled={completeSale.isPending || !cart.length || !shift || (onCredit && !customer)}
          >
            {completeSale.isPending ? "Qayta ishlanmoqda..." : (
              <span className="flex items-center gap-2">
                <CreditCard className="h-5 w-5" />
                {onCredit ? "Qarzga yakunlash (F12)" : "Yakunlash (F12)"}
              </span>
            )}
          </Button>
        </div>
      </div>

      {/* Modals */}
      {modals}
      {showCustomerPicker && (
        <CustomerPicker
          onClose={() => setShowCustomerPicker(false)}
          onSelect={(picked) => {
            setCustomerId(picked.id);
            setUseBalance(false);
            setBalanceInput("");
            setUseCashback(false);
            setCashbackInput("");
            setShowCustomerPicker(false);
          }}
        />
      )}
      {customer && customerPayment && shift && (
        <CustomerPaymentDialog
          shiftId={shift.id}
          customer={customer}
          purpose={customerPayment}
          onClose={() => setCustomerPayment(null)}
        />
      )}
      {lastReceipt && (
        <POSReceipt
          order={lastReceipt.order}
          paid={lastReceipt.paid}
          change={lastReceipt.change}
          balanceUsed={lastReceipt.balanceUsed}
          changeToBalance={lastReceipt.changeToBalance}
          debt={lastReceipt.debt}
          cashbackUsed={lastReceipt.cashbackUsed}
          cashbackEarned={lastReceipt.cashbackEarned}
          customer={lastReceipt.customer}
          payMethod={lastReceipt.payMethod}
          cashierName={currentUser?.name ?? undefined}
          onClose={() => setLastReceipt(null)}
        />
      )}
      {showScanner && (
        <BarcodeScanner
          title="POS — Mahsulot skanerlash"
          hint="Barkod yoki QR kodni skanerlang — mahsulot savatchaga qo'shiladi"
          onScan={(code) => {
            void handleBarcodeScan(code);
          }}
          onClose={() => setShowScanner(false)}
        />
      )}
    </div>
  );
}
