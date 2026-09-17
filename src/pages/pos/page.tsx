import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "motion/react";
import {
  ShoppingCart, Search, Trash2, Plus, Minus, CreditCard, Banknote,
  Smartphone, X, Power, Package, Calculator, ScanLine,
  UserPlus, UserRound, Wallet, HandCoins, Gift,
} from "lucide-react";
import type { CashbackSettings, PosLayout, PosPanelSide } from "@bum/shared";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { cn } from "@/lib/utils.ts";
import { ApiError, api, errorMessage } from "@/lib/api.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";
import { useCurrentUser } from "@/hooks/use-auth.ts";
import { useDebounce } from "@/hooks/use-debounce.ts";
import { formatMoney, useCurrencies } from "@/hooks/use-currencies.ts";
import ShiftOpenDialog from "./_components/shift-open-dialog.tsx";
import ShiftCloseDialog from "./_components/shift-close-dialog.tsx";
import SessionSummaryDialog from "./_components/session-summary-dialog.tsx";
import POSReceipt from "./_components/pos-receipt.tsx";
import CustomerPicker from "./_components/customer-picker.tsx";
import CustomerPaymentDialog from "./_components/customer-payment-dialog.tsx";
import PaymentAmountDialog from "./_components/payment-amount-dialog.tsx";
import { ProductCard, ProductDetailDialog, type PosCardItem } from "./_components/product-card.tsx";
import { productInitials } from "./_lib/product-display.ts";
import { ProductImage } from "@/pages/products/_lib/product-image.tsx";
import BarcodeScanner from "@/components/barcode-scanner.tsx";
import { useHIDScanner } from "@/hooks/use-hid-scanner.ts";
import {
  terminalOptionLabel,
  type PaymentBankAccountOption,
  type PaymentTerminalOption,
} from "@/components/payments/split-payment.ts";
import { addPart, paymentsBody, previewPayment, removePart, suggestAmount, type PayOption, type PayPart } from "./_lib/payment-parts.ts";
import { computeLine, fromMinor, minorToNumber } from "@/pages/sales/_lib/line-amounts.ts";
import {
  num, PAYMENT_LABELS,
  type Customer, type PaymentMethod, type PosCustomerSummary, type PosShift, type ProductOption,
  type SalesOrderDetail, type WarehouseOption,
} from "@/pages/sales/_lib/types.ts";
import { activePromoPrice } from "@bum/shared";

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
  /** Mahsulot narx valyutasi; null — asosiy. Sotuv valyutalari tanlansa chek valyutasini belgilaydi. */
  salesCurrency: string | null;
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
  /** Asosiy valyutadagi to'lov qismlari (karta — terminal bilan). */
  payments: { method: PaymentMethod; amount: string; terminalId?: string; cashAccountId?: string }[];
  /** Chet valyuta qatnashgan chekda: valyuta bo'yicha jami, to'langan va qaytim. */
  /** `covered` — shu valyuta qismidan balans va keshbek yopgan summa (valyutada). */
  currencyTotals: { currency: string; total: string; covered: string; paid: string; change: string }[];
  customer: PosCustomerSummary | null;
};
type LastReceipt = SaleResult & { payMethod: PaymentMethod; paymentLines?: { label: string; amount: number }[] };

type PaymentOptionsResponse = {
  terminals: PaymentTerminalOption[];
  bankAccounts?: PaymentBankAccountOption[];
  /** Biznes egasi tanlagan kassa tuzilishi (Sozlamalar → Kassa qurilmalari → Kassa ko'rinishi). */
  layout?: { paymentPanelSide: PosPanelSide; layout: PosLayout };
};

const PAY_METHODS: { key: PaymentMethod; label: string; icon: React.ElementType; color: string }[] = [
  { key: "cash", label: "Naqd", icon: Banknote, color: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30" },
  { key: "card", label: "Karta", icon: CreditCard, color: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30" },
  { key: "bank", label: "Bank", icon: Smartphone, color: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/30" },
];
/** Tez tugmalar: F9 — naqd, F10 — birinchi karta turi, F11 — birinchi bank (desktop kassa bilan bir xil). */
const PAY_HOTKEYS: Record<string, PaymentMethod> = { F9: "cash", F10: "card", F11: "bank" };

const fmt = (n: number) => new Intl.NumberFormat("uz-UZ").format(Math.round(n));
const fmtMinor = (minor: bigint) => `${fmt(minorToNumber(minor))} so'm`;
/** Kiritilgan summa → tiyin (faqat oldindan ko'rish; aniq hisob serverda). */
const minorOf = (value: string | number) => BigInt(Math.round(num(value) * 100));
const minBigInt = (...values: bigint[]) => values.reduce((a, b) => (b < a ? b : a));
/** Serverdagi `mulDivRound` bilan bir xil yaxlitlash. */
const mulDivRound = (a: bigint, b: bigint, c: bigint) => (a * b * 2n + c) / (2n * c);

export default function POSPage() {
  const currentUser = useCurrentUser();
  const currencies = useCurrencies();
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
  /** Tanlangan kategoriya; null — barchasi. Qidiruv shu kategoriya ichida ishlaydi. */
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [debouncedSearch] = useDebounce(search.trim(), 250);
  // Qidiruv serverda (nom, SKU, barkod); API chegarasi 200 ta
  const categories = useApiQuery<{ categories: { id: string; name: string }[] }>(
    "/api/catalog/categories",
    undefined,
    { staleTime: 300_000 },
  ).data?.categories;
  // Qidiruv va kategoriya birga: server ikkalasini ham qo'llaydi
  const products = useApiQuery<{ products: ProductOption[] }>(
    "/api/catalog/products",
    { limit: 200, isActive: true, search: debouncedSearch || undefined, categoryId: categoryId ?? undefined },
    { placeholderData: (previous) => previous },
  ).data?.products;

  const stockQuery = useApiQuery<{ stock: { productId: string; quantity: string }[] }>(
    stockWarehouseId ? "/api/inventory/stock" : null,
    { warehouseId: stockWarehouseId },
  );

  const completeSale = useApiMutation((body: object) => api.post<SaleResult>("/api/sales/pos/sales", body));

  const [cart, setCart] = useState<CartItem[]>([]);
  const [showOpenShift, setShowOpenShift] = useState(false);
  const [closingShift, setClosingShift] = useState<PosShift | null>(null);
  const [lastReceipt, setLastReceipt] = useState<LastReceipt | null>(null);
  const [showScanner, setShowScanner] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  // To'lov usullari Moliya bo'limidan: "Kassada ko'rsatish" belgilangan terminallar (UZCARD, HUMO ...) va bank hisoblari
  const paymentOptions = useApiQuery<PaymentOptionsResponse>("/api/sales/pos/payment-options", undefined, { staleTime: 60_000 }).data;
  const terminals = paymentOptions?.terminals ?? [];
  const bankAccounts = paymentOptions?.bankAccounts ?? [];
  const panelSide: PosPanelSide = paymentOptions?.layout?.paymentPanelSide ?? "right";
  const layout: PosLayout = paymentOptions?.layout?.layout ?? "classic";
  /** Saqlangan to'lov qismlari: bir nechta — aralash to'lov. */
  const [parts, setParts] = useState<PayPart[]>([]);
  /** Summa oynasi ochiq bo'lgan to'lov tugmasi. */
  const [payDialog, setPayDialog] = useState<PayOption | null>(null);
  /** Batafsil oyna ochilgan mahsulot (katta rasm va miqdor steppery). */
  const [detail, setDetail] = useState<PosCardItem | null>(null);
  /** Telefonda savat/to'lov paneli pastdan chiqadi; desktopda doim yon tomonda turadi. */
  const [cartOpen, setCartOpen] = useState(false);
  /** Faol smena tafsiloti (terminal kesimi bilan). */
  const [sessionDetail, setSessionDetail] = useState(false);
  /** So'rov kaliti: ikki marta bosish yoki tarmoq qayta urinishida server ikkinchi chek yozmaydi; muvaffaqiyatdan keyin yangilanadi. */
  const requestIdRef = useRef<string | null>(null);

  // Sotuv valyutalari: bittasi — hamma narx shu valyutada; bir nechtasi — mahsulot o'z narx valyutasida
  const [saleCurrencies, setSaleCurrencies] = useState<string[] | null>(null);
  const [foreignTendered, setForeignTendered] = useState<Record<string, string>>({});
  /** Chet valyuta qismi qanday to'lanadi: naqd (qaytim bilan) yoki karta — shu valyutadagi kassa/bankka. */
  const [foreignMethod, setForeignMethod] = useState<Record<string, "cash" | "card">>({});
  const selectedSaleCurrencies = saleCurrencies ?? [currencies.base];
  const currencyMode = selectedSaleCurrencies.length > 1 || selectedSaleCurrencies[0] !== currencies.base;
  const toggleSaleCurrency = (code: string) => {
    const next = selectedSaleCurrencies.includes(code)
      ? selectedSaleCurrencies.filter((c) => c !== code)
      : [...selectedSaleCurrencies, code];
    if (next.length === 0) return;
    setSaleCurrencies(currencies.codes.filter((c) => next.includes(c)));
    setForeignTendered({});
    setForeignMethod({});
  };

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
  const totalQty = cart.reduce((sum, item) => sum + item.qty, 0);

  // Chek valyutalari — server bilan bir xil: qator valyutasi, valyutadagi summa = asosiy / kurs
  const rateMinorOf = (code: string) => {
    const rate = currencies.rateOf(code);
    return Number.isFinite(rate) ? BigInt(Math.round(rate * 10_000)) : 0n;
  };
  const lineCurrencyOf = (item: CartItem) => {
    const own = item.salesCurrency ?? currencies.base;
    return selectedSaleCurrencies.includes(own) ? own : selectedSaleCurrencies[0] ?? currencies.base;
  };
  const buckets = new Map<string, { total: bigint; base: bigint }>();
  const lineDisplay = cart.map((item, idx) => {
    const code = lineCurrencyOf(item);
    const baseLine = amounts[idx]!.lineTotal;
    const rateMinor = rateMinorOf(code);
    const lineTotal = code === currencies.base ? baseLine : rateMinor > 0n ? mulDivRound(baseLine, 10_000n, rateMinor) : 0n;
    const bucket = buckets.get(code) ?? { total: 0n, base: 0n };
    buckets.set(code, { total: bucket.total + lineTotal, base: bucket.base + baseLine });
    return { code, total: lineTotal };
  });
  const baseBucketMinor = buckets.get(currencies.base)?.base ?? (currencyMode ? 0n : totalMinor);
  const showBasePayment = !currencyMode || cart.length === 0 || buckets.has(currencies.base);

  // Keshbekdan: mijoz keshbeki, sozlamadagi chek ulushi chegarasi va chek summasidan oshmaydi
  const cashbackEnabled = !!cashbackSettings?.enabled;
  const cashbackAvailable = customer && cashbackEnabled ? minorOf(customer.cashbackBalance) : 0n;
  const cashbackLimit = cashbackSettings
    ? (totalMinor * BigInt(Math.round(cashbackSettings.maxUsagePercent * 100))) / 10_000n
    : 0n;
  const cashbackRequested = cashbackInput.trim() !== "" ? minorOf(cashbackInput) : cashbackAvailable;
  const cashbackMinor = customer && useCashback && cashbackRequested > 0n
    ? minBigInt(cashbackRequested, cashbackAvailable, cashbackLimit, totalMinor)
    : 0n;
  // Mijoz balansidan yechiladigan qism — qolgan chek summasi va balansdan oshmaydi
  const balanceAvailable = customer ? minorOf(customer.balance) : 0n;
  const balanceRequested = balanceInput.trim() !== "" ? minorOf(balanceInput) : balanceAvailable;
  const balanceMinor = customer && useBalance && balanceRequested > 0n
    ? minBigInt(balanceRequested, balanceAvailable, totalMinor - cashbackMinor)
    : 0n;
  // Balans va keshbek asosiy valyutada — server bilan bir xil: avval asosiy valyutadagi qismga, qolgani chet valyuta qismlariga
  const baseCoveredMinor = minBigInt(cashbackMinor + balanceMinor, baseBucketMinor);
  const dueMinor = baseBucketMinor - baseCoveredMinor;
  const due = minorToNumber(dueMinor);
  // To'lov qismlari: bo'sh bo'lsa "Yakunlash" — to'liq naqd (tez sotuv); qismlar bo'lsa — qoldiq qarzga (mijoz bilan)
  const activeParts = showBasePayment ? parts : [];
  const preview = previewPayment(activeParts, dueMinor);
  const quickCash = activeParts.length === 0;
  // To'lov tugmalari: Naqd, Karta, Bank; yonida karta turlari (UZCARD, HUMO — bog'langan bank hisobiga, komissiya bilan) va
  // Moliya bo'limida kassada ko'rsatilgan bank hisoblari
  const payOptions: PayOption[] = [
    { key: "cash", method: "cash", terminalId: null, cashAccountId: null, label: "Naqd" },
    ...(terminals.length === 0 ? [{ key: "card", method: "card", terminalId: null, cashAccountId: null, label: "Karta" } satisfies PayOption] : []),
    ...terminals.map((terminal): PayOption => ({
      key: `t:${terminal.id}`,
      method: "card",
      terminalId: terminal.id,
      cashAccountId: null,
      label: terminalOptionLabel(terminal, terminals),
    })),
    ...(bankAccounts.length === 0 ? [{ key: "bank", method: "bank", terminalId: null, cashAccountId: null, label: "Bank" } satisfies PayOption] : []),
    ...bankAccounts.map((account): PayOption => ({ key: `a:${account.id}`, method: "bank", terminalId: null, cashAccountId: account.id, label: account.name })),
  ];

  // Chet valyutadagi qismlar: bo'sh maydon — aniq summa; naqdda ortig'i — o'sha valyutada qaytim
  const foreignBuckets: {
    code: string; method: "cash" | "card"; total: bigint; due: bigint; given: bigint; change: bigint; unpaidBase: bigint;
  }[] = [];
  let uncoveredMinor = cashbackMinor + balanceMinor - baseCoveredMinor;
  for (const [code, bucket] of buckets) {
    if (code === currencies.base) continue;
    const rate = rateMinorOf(code);
    const coveredBase = minBigInt(uncoveredMinor, bucket.base);
    uncoveredMinor -= coveredBase;
    const dueBase = bucket.base - coveredBase;
    const dueInCurrency =
      coveredBase === 0n ? bucket.total : dueBase === 0n || rate === 0n ? 0n : mulDivRound(dueBase, 10_000n, rate);
    const method = foreignMethod[code] ?? "cash";
    const text = foreignTendered[code] ?? "";
    const given = text.trim() !== "" ? minorOf(text) : dueInCurrency;
    const paidInCurrency = given < dueInCurrency ? given : dueInCurrency;
    const paidBase = paidInCurrency === dueInCurrency ? dueBase : mulDivRound(paidInCurrency, rate, 10_000n);
    foreignBuckets.push({
      code,
      method,
      total: bucket.total,
      due: dueInCurrency,
      given,
      change: method === "cash" ? given - paidInCurrency : 0n,
      unpaidBase: dueBase - paidBase,
    });
  }
  const foreignDebt = minorToNumber(foreignBuckets.reduce((sum, bucket) => sum + bucket.unpaidBase, 0n));
  const change = minorToNumber(preview.change);
  // Yetmagan qismi faqat mijoz tanlanganda qarzga yoziladi
  const debtAmount = (quickCash ? 0 : minorToNumber(preview.remaining)) + foreignDebt;
  const onCredit = debtAmount >= 0.01;

  // Narxi boshqa valyutada belgilangan mahsulot — joriy kurs bilan (server ham shunday hisoblaydi)
  // Aksiya narxi — server bilan bir xil sana (UTC) bo'yicha; server narxni o'zi hisoblaydi va solishtiradi
  const promoOf = (p: ProductOption) => activePromoPrice(p, new Date().toISOString().slice(0, 10));
  const basePriceOf = (p: ProductOption) => currencies.toBase(promoOf(p) ?? p.salesPrice, p.salesCurrency);

  /** Savatga qo'shish: rasmni bosish — +1, batafsil oynadan — kiritilgan miqdor. Qoldiqdan oshmaydi. */
  const addToCart = (p: ProductOption, quantity = 1) => {
    const stock = stockOf(p.id);
    if (stock <= 0) { toast.error("Omborda mavjud emas"); return; }
    if (!Number.isFinite(basePriceOf(p))) {
      toast.error(`${p.salesCurrency} valyutasi yoqilmagan — Sozlamalar → Valyutalar`);
      return;
    }
    setCart((prev) => {
      const idx = prev.findIndex((i) => i.productId === p.id);
      if (idx >= 0) {
        const next = [...prev];
        const item = next[idx];
        if (item.qty >= item.stock) { toast.error("Omborda yetarli emas"); return prev; }
        const wanted = item.qty + quantity;
        if (wanted > item.stock) toast.error("Omborda yetarli emas — qoldiq bo'yicha qo'shildi");
        next[idx] = { ...item, qty: Math.min(wanted, item.stock) };
        return next;
      }
      if (quantity > stock) toast.error("Omborda yetarli emas — qoldiq bo'yicha qo'shildi");
      return [...prev, {
        productId: p.id,
        unitId: p.baseUnitId,
        name: p.name,
        sku: p.sku,
        qty: Math.min(quantity, stock),
        unitPrice: String(basePriceOf(p)),
        taxRate: p.taxRate,
        taxIncluded: p.taxIncluded,
        stock,
        salesCurrency: p.salesCurrency,
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

  /** Jadval ko'rinishida miqdorni to'g'ridan-to'g'ri kiritish. */
  const setQty = (idx: number, qty: number) => {
    if (!Number.isFinite(qty) || qty <= 0) return;
    setCart((prev) => prev.map((item, i) => {
      if (i !== idx) return item;
      if (qty > item.stock) { toast.error("Omborda yetarli emas"); return { ...item, qty: item.stock }; }
      return { ...item, qty };
    }));
  };

  const removeFromCart = (idx: number) => setCart((p) => p.filter((_, i) => i !== idx));

  const resetSale = () => {
    setCart([]);
    setParts([]);
    setForeignTendered({});
    setForeignMethod({});
    setChangeToBalance(false);
  };

  // HID scanner — fires when USB/Bluetooth scanner sends barcode + Enter
  useHIDScanner({
    onScan: (code: string) => { void handleBarcodeScan(code); },
    minLength: 3,
  });

  const openPayment = (option: PayOption) => {
    if (!cart.length) { toast.error("Savatcha bo'sh"); return; }
    if (!showBasePayment) { toast.error(`Chekda ${currencies.base} dagi mahsulot yo'q — to'lov valyuta bo'yicha kiritiladi`); return; }
    setPayDialog(option);
  };

  const handleCheckout = async (paymentParts: PayPart[] = activeParts) => {
    if (!shift) { toast.error("Avval smena oching"); return; }
    if (!cart.length) { toast.error("Savatcha bo'sh"); return; }
    const settled = previewPayment(paymentParts, dueMinor);
    const credit = (paymentParts.length > 0 ? minorToNumber(settled.remaining) : 0) + foreignDebt >= 0.01;
    if (credit && !customer) { toast.error(`To'lov yetarli emas (qoldiq ${fmtMinor(settled.remaining)}) — qarzga sotish uchun mijoz tanlang`); return; }
    if (settled.nonCashOver) { toast.error("Karta va bank to'lovi chek summasidan oshmasligi kerak"); return; }

    const keepChange = !!customer && changeToBalance && settled.change > 0n;
    requestIdRef.current ??= crypto.randomUUID();
    try {
      // Narx, soliq va ombor yuborilmaydi — server prays-list, mahsulot soliqi va smena omboridan oladi
      const result = await completeSale.mutateAsync({
        shiftId: shift.id,
        customerId: customer?.id ?? null,
        items: cart.map((i) => ({ productId: i.productId, unitId: i.unitId, quantity: i.qty })),
        clientRequestId: requestIdRef.current,
        ...(paymentParts.length > 0 && showBasePayment
          ? { payments: paymentsBody(paymentParts) }
          : { paymentMethod: "cash", amountPaid: showBasePayment ? fromMinor(dueMinor) : "0" }),
        // Nasiya aniq belgilanadi — server kam to'lovni belgisiz rad etadi
        ...(credit && customer ? { onCredit: true } : {}),
        ...(cashbackMinor > 0n ? { cashbackAmount: fromMinor(cashbackMinor) } : {}),
        ...(balanceMinor > 0n ? { balanceAmount: fromMinor(balanceMinor) } : {}),
        ...(keepChange ? { changeToBalance: true } : {}),
        ...(currencyMode
          ? {
              saleCurrencies: selectedSaleCurrencies,
              currencyPayments: foreignBuckets.map((bucket) => ({
                currency: bucket.code,
                amount: fromMinor(bucket.given),
                method: bucket.method,
              })),
            }
          : {}),
      });
      requestIdRef.current = null;
      // Chekda usul nomi: terminal ("Karta · UZCARD") yoki bank hisobi ("Bank · Kapitalbank")
      const partLabel = (part: SaleResult["payments"][number]) => {
        const terminal = part.terminalId ? terminals.find((item) => item.id === part.terminalId) : undefined;
        if (terminal) return `Karta · ${terminalOptionLabel(terminal, terminals)}`;
        const account = part.cashAccountId ? bankAccounts.find((item) => item.id === part.cashAccountId) : undefined;
        if (account) return `Bank · ${account.name}`;
        return PAYMENT_LABELS[part.method] ?? part.method;
      };
      const detailed = result.payments.length > 1 || result.payments.some((part) => part.terminalId || part.cashAccountId);
      setLastReceipt({
        ...result,
        payMethod: result.payments[0]?.method ?? "cash",
        ...(detailed
          ? {
              paymentLines: result.payments.map((part) => ({
                label: partLabel(part),
                amount: num(part.amount),
              })),
            }
          : {}),
      });
      resetSale();
      clearCustomer();
      const details = [
        num(result.change) > 0 ? `Qaytim: ${fmt(num(result.change))} so'm` : null,
        num(result.changeToBalance) > 0 ? `Balansga: ${fmt(num(result.changeToBalance))} so'm` : null,
        num(result.debt) > 0 ? `Qarzga: ${fmt(num(result.debt))} so'm` : null,
        num(result.cashbackEarned) > 0 ? `Keshbek: +${fmt(num(result.cashbackEarned))} so'm` : null,
      ].filter(Boolean);
      toast.success(["Sotuv amalga oshirildi", ...details].join(" · "));
    } catch (err) {
      // Oldingi urinish serverda yozilgan (javob yo'qolgan) — ikkinchi chek yo'q, savat tozalanadi
      if (err instanceof ApiError && err.code === "CONFLICT" && (err.details as { duplicate?: boolean } | undefined)?.duplicate) {
        requestIdRef.current = null;
        resetSale();
        clearCustomer();
        toast.info(err.message);
        return;
      }
      toast.error(errorMessage(err));
    }
  };
  // Klaviatura tinglovchisi har renderda qayta ulanmasligi uchun — eng so'nggi funksiyalar ref'da
  const checkoutRef = useRef(handleCheckout);
  const openPaymentRef = useRef(openPayment);
  const payOptionsRef = useRef(payOptions);
  const dialogOpenRef = useRef(false);
  useEffect(() => {
    checkoutRef.current = handleCheckout;
    openPaymentRef.current = openPayment;
    payOptionsRef.current = payOptions;
    dialogOpenRef.current = payDialog !== null || showCustomerPicker || customerPayment !== null;
  });

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Oyna ochiq bo'lsa (summa, mijoz) — Escape oynani yopadi, savatni tozalamaydi
      if (dialogOpenRef.current) return;
      if (e.key === "F2") { e.preventDefault(); searchRef.current?.focus(); }
      if (e.key === "F4") { e.preventDefault(); setShowCustomerPicker(true); }
      const method = PAY_HOTKEYS[e.key];
      if (method) {
        e.preventDefault();
        const option = payOptionsRef.current.find((item) => item.method === method);
        if (option) openPaymentRef.current(option);
      }
      if (e.key === "F12" && cart.length > 0) { e.preventDefault(); void checkoutRef.current(); }
      if (e.key === "Escape") { setCart([]); setParts([]); requestIdRef.current = null; }
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
      {sessionDetail && shift && <SessionSummaryDialog shift={shift} onClose={() => setSessionDetail(false)} />}
      <ProductDetailDialog
        item={detail}
        onClose={() => setDetail(null)}
        onAdd={(product, quantity) => {
          addToCart(product, quantity);
          setDetail(null);
        }}
      />
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

  const panelLeft = panelSide === "left";
  const tableLayout = layout === "table";
  // Summa oynasi uchun taklif: qolgan summa (karta/bankda — chek summasidan oshmaydigan chegarada)
  const paySuggestion = payDialog ? suggestAmount(activeParts, payDialog, dueMinor) : { amount: 0n, max: null as bigint | null };
  const searchResults = tableLayout && search.trim() !== "" ? filtered.slice(0, 8) : [];

  /** Karta uchun ko'rsatiladigan qiymatlar (narx, aksiya, qoldiq, savatdagi miqdor) — desktop kassadagi bilan bir xil. */
  const cardItem = (p: ProductOption): PosCardItem => ({
    product: p,
    price: basePriceOf(p) || 0,
    regularPrice: promoOf(p) ? currencies.toBase(p.salesPrice, p.salesCurrency) || null : null,
    stock: stockOf(p.id),
    showStock: Boolean(stockMap),
    inCart: cart.find((c) => c.productId === p.id)?.qty ?? 0,
    currencyNote:
      p.salesCurrency && p.salesCurrency !== currencies.base ? formatMoney(p.salesPrice, p.salesCurrency) : null,
  });

  const productGrid = (
    // Telefonda pastki savat paneli oxirgi qatorni yopmasligi uchun qo'shimcha joy
    <div className="flex-1 overflow-y-auto p-4 short:p-2 pb-28 wide:pb-4">
      {!products ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {Array.from({ length: 12 }).map((_, i) => <Skeleton key={i} className="h-44 rounded-xl" />)}
        </div>
      ) : layout === "compact" ? (
        <div className="divide-y divide-border rounded-xl border border-border bg-card">
          {filtered.map((p) => {
            const stock = stockOf(p.id);
            const inCart = cart.find((c) => c.productId === p.id);
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => addToCart(p)}
                onContextMenu={(event) => { event.preventDefault(); setDetail(cardItem(p)); }}
                disabled={stock <= 0}
                className={cn(
                  "flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-40",
                  inCart ? "bg-primary/5" : "hover:bg-accent/50",
                )}
              >
                <ProductImage
                  productId={p.id}
                  imageKey={p.imageKey ?? null}
                  alt=""
                  className="size-9 shrink-0 rounded-md"
                  fallback={
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-[11px] font-semibold text-muted-foreground" aria-hidden>
                      {productInitials(p.name)}
                    </span>
                  }
                />
                <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
                <span className="w-24 truncate font-mono text-xs text-muted-foreground">{p.sku}</span>
                {stockMap && <span className="w-16 text-right text-xs text-muted-foreground tabular-nums">{fmt(stock)}</span>}
                <span className="w-28 text-right font-semibold text-primary tabular-nums">{fmt(basePriceOf(p) || 0)}</span>
                {inCart && <span className="h-5 min-w-5 rounded-full bg-primary px-1.5 text-center text-xs font-bold leading-5 text-primary-foreground">{inCart.qty}</span>}
              </button>
            );
          })}
          {filtered.length === 0 && <p className="py-12 text-center text-muted-foreground">Mahsulot topilmadi</p>}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {filtered.map((p) => (
            <ProductCard
              key={p.id}
              item={cardItem(p)}
              onAdd={(product) => addToCart(product)}
              onDetails={(product) => setDetail(cardItem(product))}
            />
          ))}
          {filtered.length === 0 && (
            <div className="col-span-full flex flex-col items-center py-12 text-center text-muted-foreground">
              <Package className="h-10 w-10 mb-2 opacity-30" />
              <p>Mahsulot topilmadi</p>
            </div>
          )}
        </div>
      )}
    </div>
  );

  /** Jadval ko'rinishi: savat katta maydonda (№, nomi, SKU, miqdor, narx, jami). */
  const cartTable = (
    <div className="flex-1 overflow-auto p-4">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th className="w-10 px-2 py-2 font-medium">№</th>
            <th className="px-2 py-2 font-medium">Nomi</th>
            <th className="px-2 py-2 font-medium">SKU</th>
            <th className="w-40 px-2 py-2 text-center font-medium">Miqdor</th>
            <th className="px-2 py-2 text-right font-medium">Narx</th>
            <th className="px-2 py-2 text-right font-medium">Jami</th>
            <th className="w-10" />
          </tr>
        </thead>
        <tbody>
          {cart.length === 0 ? (
            <tr>
              <td colSpan={7} className="py-16 text-center text-muted-foreground">
                <ShoppingCart className="mx-auto mb-2 h-10 w-10 opacity-20" />
                Mahsulotni qidiring yoki skanerlang (F2)
              </td>
            </tr>
          ) : (
            cart.map((item, idx) => (
              <tr key={item.productId} className="border-b border-border last:border-0">
                <td className="px-2 py-2 text-muted-foreground tabular-nums">{idx + 1}</td>
                <td className="px-2 py-2 font-medium">{item.name}</td>
                <td className="px-2 py-2 font-mono text-xs text-muted-foreground">{item.sku}</td>
                <td className="px-2 py-2">
                  <div className="flex items-center justify-center gap-1">
                    <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Kamaytirish" onClick={() => updateQty(idx, -1)}><Minus className="h-3.5 w-3.5" /></Button>
                    <Input
                      id={`pos-qty-${item.productId}`}
                      type="number"
                      min="1"
                      className="h-8 w-16 text-center"
                      value={item.qty}
                      onChange={(e) => setQty(idx, Number(e.target.value))}
                    />
                    <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Ko'paytirish" onClick={() => updateQty(idx, 1)}><Plus className="h-3.5 w-3.5" /></Button>
                  </div>
                </td>
                <td className="px-2 py-2 text-right tabular-nums">{fmt(num(item.unitPrice))}</td>
                <td className="px-2 py-2 text-right font-semibold tabular-nums">{formatMoney(minorToNumber(lineDisplay[idx]!.total), lineDisplay[idx]!.code)}</td>
                <td className="px-2 py-2">
                  <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Olib tashlash" onClick={() => removeFromCart(idx)}><X className="h-3.5 w-3.5 text-destructive" /></Button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );

  const cartList = (
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
                  <p className="text-[11px] text-muted-foreground">
                    {lineDisplay[idx]!.code === currencies.base
                      ? `${fmt(num(item.unitPrice))} so'm`
                      : formatMoney(num(item.unitPrice) / currencies.rateOf(lineDisplay[idx]!.code), lineDisplay[idx]!.code)}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" className="h-6 w-6" aria-label={`${item.name} — kamaytirish`} onClick={() => updateQty(idx, -1)}>
                    <Minus className="h-3 w-3" />
                  </Button>
                  <span className="w-6 text-center text-xs font-bold">{item.qty}</span>
                  <Button variant="ghost" size="icon" className="h-6 w-6" aria-label={`${item.name} — ko'paytirish`} onClick={() => updateQty(idx, 1)}>
                    <Plus className="h-3 w-3" />
                  </Button>
                </div>
                <div className="text-right w-20">
                  <p className="text-xs font-semibold">
                    {formatMoney(minorToNumber(lineDisplay[idx]!.total), lineDisplay[idx]!.code)}
                  </p>
                </div>
                <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" aria-label={`${item.name} — olib tashlash`} onClick={() => removeFromCart(idx)}>
                  <X className="h-3 w-3 text-destructive" />
                </Button>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );

  return (
    // `h-screen` emas: sahifa ilova sarlavhasi ostidagi `main` ichida — 100vh u yerda pastdan oshib ketadi
    <div className={cn("flex min-h-0 flex-1 bg-background overflow-hidden", panelLeft && "wide:flex-row-reverse")}>
      {/* Asosiy maydon — mahsulotlar (klassik, ixcham) yoki savat jadvali */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* POS topbar */}
        <div className="flex items-center gap-3 px-4 py-3 short:py-1.5 border-b border-border bg-card shrink-0">
          <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <Calculator className="h-4 w-4 text-primary" />
          </div>
          <span className="font-bold text-sm">POS Kassasi</span>
          {shift && (
            <button
              type="button"
              data-testid="session-summary"
              aria-label="Smena tafsilotlari"
              onClick={() => setSessionDetail(true)}
              className="min-w-0 truncate rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-600 hover:bg-emerald-500/20 dark:text-emerald-400 cursor-pointer"
            >
              <span className="hidden lg:inline">{shift.warehouseName} · </span>
              Naqd {fmt(num(shift.totalCash))} · Karta {fmt(num(shift.totalCard) + num(shift.totalBank))} · Jami{" "}
              {fmt(num(shift.totalSales))}
            </button>
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
        <div className="px-4 py-3 short:py-1.5 border-b border-border shrink-0">
          <div className="relative flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                ref={searchRef}
                className="pl-9 h-10"
                placeholder="Mahsulot nomi, SKU yoki barkod (F2)..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (tableLayout && e.key === "Enter" && searchResults[0]) {
                    e.preventDefault();
                    addToCart(searchResults[0]);
                    setSearch("");
                  }
                }}
              />
              {searchResults.length > 0 && (
                <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-80 overflow-y-auto rounded-xl border border-border bg-popover shadow-lg">
                  {searchResults.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      disabled={stockOf(p.id) <= 0}
                      className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-accent disabled:opacity-40"
                      onClick={() => { addToCart(p); setSearch(""); searchRef.current?.focus(); }}
                    >
                      <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
                      <span className="font-mono text-xs text-muted-foreground">{p.sku}</span>
                      {stockMap && <span className="w-14 text-right text-xs text-muted-foreground">{fmt(stockOf(p.id))}</span>}
                      <span className="w-24 text-right font-semibold text-primary">{fmt(basePriceOf(p) || 0)}</span>
                    </button>
                  ))}
                </div>
              )}
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

        {/* Kategoriya — telefonda gorizontal scroll; tanlov savatga tegmaydi */}
        {(categories?.length ?? 0) > 0 && (
          <div
            data-testid="category-bar"
            className="flex gap-2 overflow-x-auto border-b border-border px-4 py-2 short:py-1 shrink-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            <button
              type="button"
              onClick={() => setCategoryId(null)}
              className={cn(
                "shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium cursor-pointer",
                categoryId === null ? "border-primary bg-primary/10 text-primary" : "border-border bg-muted/30 text-muted-foreground hover:bg-accent",
              )}
            >
              Barchasi
            </button>
            {categories!.map((category) => (
              <button
                key={category.id}
                type="button"
                onClick={() => setCategoryId(category.id)}
                className={cn(
                  "shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium cursor-pointer",
                  categoryId === category.id
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-muted/30 text-muted-foreground hover:bg-accent",
                )}
              >
                {category.name}
              </button>
            ))}
          </div>
        )}

        {tableLayout ? cartTable : productGrid}
      </div>

      {/* To'lov paneli — biznes egasi tanlagan tomonda */}
      <div
        data-testid="pos-cart-panel"
        className={cn(
          "flex flex-col bg-card border-border shrink-0",
          // Telefon: butun ekranli panel, yopiq holatda pastga tushirilgan (mahsulot maydoni to'liq kenglikda qoladi)
          "fixed inset-0 z-50 w-full transition-transform duration-200",
          cartOpen ? "translate-y-0" : "translate-y-full",
          // Desktop: avvalgidek yon panel
          "wide:static wide:z-auto wide:translate-y-0 wide:transition-none",
          layout === "compact" ? "wide:w-[26rem] xl:w-[30rem]" : "wide:w-80 xl:w-96",
          panelLeft ? "wide:border-r" : "wide:border-l",
        )}
      >
        {/* Cart header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 wide:hidden"
              aria-label="Savatni yopish"
              data-testid="cart-close"
              onClick={() => setCartOpen(false)}
            >
              <X className="h-4 w-4" />
            </Button>
            <ShoppingCart className="h-4 w-4 text-primary" />
            <span className="font-semibold text-sm">{tableLayout ? "To'lov" : "Savatcha"}</span>
            {cart.length > 0 && (
              <span className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded-full">{cart.length}</span>
            )}
          </div>
          {cart.length > 0 && (
            <Button size="sm" variant="ghost" className="h-7 text-destructive" onClick={resetSale}>
              <Trash2 className="h-3.5 w-3.5 mr-1" /> Tozalash
            </Button>
          )}
        </div>

        {/* Sotuv valyutalari */}
        {currencies.codes.length > 1 && (
          <div className="flex flex-wrap items-center gap-1.5 px-3 py-2 border-b border-border shrink-0">
            <span className="text-[11px] text-muted-foreground mr-1">Valyuta:</span>
            {currencies.codes.map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => toggleSaleCurrency(code)}
                className={cn(
                  "h-7 rounded-md border px-2 text-[11px] font-semibold transition-colors cursor-pointer",
                  selectedSaleCurrencies.includes(code)
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-muted/30 text-muted-foreground border-border hover:bg-accent",
                )}
              >
                {code}
              </button>
            ))}
          </div>
        )}

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

        {tableLayout ? <div className="flex-1" /> : cartList}

        {/* Checkout */}
        {/* `shrink-0` bo'lsa uch qismli to'lovda blok panel balandligidan oshib, "Yakunlash" kesilardi.
            Endi blok qisqarib ichidan aylanadi, tugma esa doim pastda turadi. */}
        <div className="border-t border-border p-4 space-y-3 min-h-0 shrink overflow-y-auto">
          {/* Keshbekdan to'lash */}
          {customer && cashbackAvailable > 0n && cashbackLimit > 0n && totalMinor > 0n && (
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
                  placeholder={String(minorToNumber(minBigInt(cashbackAvailable, cashbackLimit, totalMinor)))}
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

          {/* To'lov usullari: tugma → summa oynasi → "Saqlash" (qism qo'shiladi) yoki "Yakunlash" */}
          {showBasePayment && (
            <div className="grid grid-cols-3 gap-2" aria-label="To'lov usuli">
              {payOptions.map((option) => {
                const style = PAY_METHODS.find((m) => m.key === option.method) ?? PAY_METHODS[0]!;
                const saved = activeParts.some((part) => part.key === option.key);
                const hotkey = Object.entries(PAY_HOTKEYS).find(([, method]) => method === option.method)?.[0];
                const first = payOptions.find((item) => item.method === option.method)?.key === option.key;
                return (
                  <button
                    key={option.key}
                    type="button"
                    title={option.label}
                    disabled={!cart.length}
                    onClick={() => openPayment(option)}
                    className={cn(
                      "flex flex-col items-center gap-1 py-2 px-1 rounded-xl border text-xs font-medium transition-all cursor-pointer min-w-0 disabled:cursor-not-allowed disabled:opacity-50",
                      saved ? style.color + " border-current" : "bg-muted/30 text-foreground border-border hover:bg-accent",
                    )}
                  >
                    <style.icon className="h-4 w-4" />
                    <span className="max-w-full truncate">{option.label}</span>
                    {hotkey && first && <span className="text-[10px] text-muted-foreground">{hotkey}</span>}
                  </button>
                );
              })}
            </div>
          )}

          {/* Saqlangan qismlar */}
          {activeParts.length > 0 && (
            <ul className="space-y-1 rounded-xl border border-border p-2 text-sm">
              {activeParts.map((part) => (
                <li key={part.key} className="flex items-center justify-between gap-2">
                  <span className="truncate">{part.label}</span>
                  <span className="ml-auto font-semibold tabular-nums">{fmtMinor(part.amount)}</span>
                  <Button variant="ghost" size="icon" className="h-6 w-6" aria-label={`${part.label} qismini olib tashlash`} onClick={() => setParts((current) => removePart(current, part.key))}>
                    <X className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </li>
              ))}
            </ul>
          )}

          {/* Chet valyutadagi qismlar — naqd yoki karta, shu valyutadagi kassa/bankka */}
          {foreignBuckets.map((bucket) => (
            <div key={bucket.code} className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <label className="text-xs text-muted-foreground">
                  {bucket.method === "cash" ? "Berilgan" : "Karta"} ({bucket.code})
                </label>
                <div className="flex items-center gap-1">
                  {(["cash", "card"] as const).map((method) => (
                    <button
                      key={method}
                      type="button"
                      onClick={() => setForeignMethod((prev) => ({ ...prev, [bucket.code]: method }))}
                      className={cn(
                        "h-6 rounded-md border px-1.5 text-[11px] font-medium cursor-pointer",
                        bucket.method === method
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-muted/30 text-muted-foreground border-border hover:bg-accent",
                      )}
                    >
                      {method === "cash" ? "Naqd" : "Karta"}
                    </button>
                  ))}
                  {customer && bucket.due > 0n && (
                    <button
                      type="button"
                      className="ml-1 text-xs font-medium text-amber-600 dark:text-amber-400 hover:underline cursor-pointer"
                      onClick={() => setForeignTendered((prev) => ({ ...prev, [bucket.code]: "0" }))}
                    >
                      Qarzga
                    </button>
                  )}
                </div>
              </div>
              <Input
                type="number"
                min="0"
                step="any"
                className="text-right text-lg font-bold h-11"
                placeholder={String(minorToNumber(bucket.due))}
                value={foreignTendered[bucket.code] ?? ""}
                onChange={(e) => setForeignTendered((prev) => ({ ...prev, [bucket.code]: e.target.value }))}
              />
              {bucket.change > 0n && (
                <div className="flex justify-between text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                  <span>Qaytim ({bucket.code})</span>
                  <span>{formatMoney(minorToNumber(bucket.change), bucket.code)}</span>
                </div>
              )}
            </div>
          ))}

          {/* Jami */}
          <div className="space-y-1 text-sm">
            <div className="flex justify-between text-muted-foreground">
              <span>Umumiy miqdor</span><span className="tabular-nums">{fmt(totalQty)}</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>Soliqsiz / QQS</span><span className="tabular-nums">{fmt(subtotal)} / {fmt(taxTotal)} so'm</span>
            </div>
            {cashbackMinor > 0n && (
              <div className="flex justify-between text-violet-600 dark:text-violet-400">
                <span>Keshbekdan</span><span>−{fmtMinor(cashbackMinor)}</span>
              </div>
            )}
            {balanceMinor > 0n && (
              <div className="flex justify-between text-emerald-600 dark:text-emerald-400">
                <span>Balansdan</span><span>−{fmtMinor(balanceMinor)}</span>
              </div>
            )}
            {showBasePayment && (
              <>
                <div className="flex justify-between text-muted-foreground">
                  <span>Qoldiq</span>
                  <span className="tabular-nums">{fmtMinor(quickCash ? dueMinor : preview.remaining)}</span>
                </div>
                <div className={cn("flex items-center justify-between", preview.change > 0n ? "font-semibold text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}>
                  <span>{customer && changeToBalance && preview.change > 0n ? "Qaytim balansga" : "Qaytim"}</span>
                  <span className="tabular-nums">{fmtMinor(preview.change)}</span>
                </div>
                {customer && preview.change > 0n && (
                  <button type="button" className="text-xs font-medium text-primary hover:underline cursor-pointer" onClick={() => setChangeToBalance((v) => !v)}>
                    {changeToBalance ? "Qaytimni qo'lda berish" : "Qaytimni balansga o'tkazish"}
                  </button>
                )}
              </>
            )}
            {currencyMode && buckets.size > 0 ? (
              <div className="pt-1 border-t border-border space-y-0.5">
                {[...buckets].map(([code, bucket]) => (
                  <div key={code} className="flex justify-between font-bold text-base">
                    <span>Jami ({code})</span>
                    <span className="text-primary">{formatMoney(minorToNumber(bucket.total), code)}</span>
                  </div>
                ))}
                {buckets.size > 1 && (
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>≈ {currencies.base} da</span><span>{fmt(total)} so'm</span>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex justify-between font-bold text-lg pt-1 border-t border-border">
                <span>To'lanishi kerak</span>
                <span className="text-primary tabular-nums">{fmt(due)} so'm</span>
              </div>
            )}
          </div>

          {preview.nonCashOver && (
            <div className="rounded-lg bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive">
              Karta va bank to'lovi chek summasidan oshmasligi kerak
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

          {/* Checkout button — to'lov qismlari ko'payganda ham ko'rinib tursin
              (past ekranli noutbukda pastga aylantirmasdan yakunlash uchun) */}
          <Button
            className="sticky bottom-0 w-full h-12 text-base font-bold shadow-lg"
            onClick={() => { void handleCheckout(); }}
            data-testid="finalize-sale"
            // Kam to'lov: qism kiritilgan, lekin qoldiq bor va mijoz tanlanmagan — qarzga yozib bo'lmaydi
            disabled={
              completeSale.isPending ||
              !cart.length ||
              !shift ||
              (onCredit && !customer) ||
              preview.nonCashOver ||
              (activeParts.length > 0 && preview.remaining > 0n && !customer)
            }
          >
            {completeSale.isPending ? "Qayta ishlanmoqda..." : (
              <span className="flex items-center gap-2">
                <CreditCard className="h-5 w-5" />
                {onCredit ? "Qarzga yakunlash (F12)" : quickCash && showBasePayment ? "Naqd yakunlash (F12)" : "Yakunlash (F12)"}
              </span>
            )}
          </Button>
        </div>
      </div>

      {/* Telefon: pastki savat paneli — bosilganda to'liq ekranli savat ochiladi */}
      {!cartOpen && (
        <button
          type="button"
          data-testid="cart-bar"
          aria-label="Savatni ochish"
          onClick={() => setCartOpen(true)}
          className="fixed inset-x-0 bottom-nav-safe z-30 flex items-center gap-3 border-t border-border bg-card px-4 py-3 text-left shadow-lg wide:hidden"
        >
          <ShoppingCart className="h-4 w-4 shrink-0 text-primary" />
          <span className="text-sm font-medium">Savat: {cart.length} ta</span>
          <span className="ml-auto text-sm font-bold tabular-nums">{fmtMinor(totalMinor)}</span>
          <span className="rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground">SAVAT</span>
        </button>
      )}

      {/* Modals */}
      {modals}
      {payDialog && (
        <PaymentAmountDialog
          option={payDialog}
          suggested={paySuggestion.amount}
          remaining={preview.remaining}
          max={paySuggestion.max}
          format={fmtMinor}
          busy={completeSale.isPending}
          onClose={() => setPayDialog(null)}
          onSave={(value) => {
            setParts((current) => addPart(current, payDialog, value));
            setPayDialog(null);
          }}
          onFinish={(value) => {
            const next = addPart(activeParts, payDialog, value);
            setParts(next);
            setPayDialog(null);
            void handleCheckout(next);
          }}
        />
      )}
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
          currencyTotals={lastReceipt.currencyTotals}
          customer={lastReceipt.customer}
          payMethod={lastReceipt.payMethod}
          paymentLines={lastReceipt.paymentLines}
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
