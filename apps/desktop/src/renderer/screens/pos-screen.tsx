import { useCallback, useEffect, useRef, useState, type ComponentType } from "react";
import { Banknote, Calculator, Clock, History, House, Keyboard, LockKeyhole, LogOut, Menu, Printer, RefreshCw, Store, Truck, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Kbd } from "@/components/ui/kbd.tsx";
import { useHIDScanner } from "@/hooks/use-hid-scanner.ts";
import type {
  AppStatus,
  CartLineInput,
  DevicePrefs,
  HeldReceipt,
  LocalSale,
  PosCategory,
  PosContext,
  PosCustomer,
  PosProduct,
  QuickSaleView,
} from "../../shared/kassa-api.js";
import { fromMinor, toMinor } from "../../shared/money.js";
import { computeSale, type SaleCalc } from "../../shared/sale-calc.js";
import type { PaymentMethod, SyncState } from "../../shared/sync-types.js";
import { decimalInput, fmtMoney, fmtQty, num, trimDecimal } from "../format.ts";
import { call, errorText } from "../kassa.ts";
import CustomerDialog from "../pos/customer-dialog.tsx";
import HeldDialog from "../pos/held-dialog.tsx";
import PrefsDialog from "../pos/prefs-dialog.tsx";
import { CategoryChips, ProductCard, ProductDetailDialog, ProductImage, PromoBadges } from "../pos/product-grid.tsx";
import { DEFAULT_HOTKEYS, HOTKEY_ACTIONS, HOTKEY_LABELS, keyName } from "../../shared/hotkeys.js";
import ReceiptDialog from "../pos/receipt-dialog.tsx";
import { printSale } from "../pos/receipt.ts";
import ReturnDialog from "../pos/return-dialog.tsx";
import ShiftCloseDialog from "../pos/shift-close-dialog.tsx";
import UnsyncedDialog from "../pos/unsynced-dialog.tsx";

type CartLine = {
  productId: string;
  unitId: string;
  unitName: string;
  name: string;
  sku: string;
  quantity: string;
  listPrice: string;
  /** `sales.edit` ruxsatli kassir kiritgan narx. */
  priceOverride: string | null;
  taxRate: string;
  taxIncluded: boolean;
  salesCurrency: string | null;
  stock: string;
};

type DialogName = "customer" | "return" | "unsynced" | "held" | "shift" | "prefs" | "help";

const QTY = /^\d{1,14}(\.\d{1,4})?$/;
/** Barcha mahsulotlar ro'yxati sahifasi va chegarasi (100 minglab mahsulotda ham ekranga shuncha). */
const PAGE = 120;
const MAX_LIST = 960;

type PayKey = "cash" | "card" | "bank";
const EMPTY_TENDER: Record<PayKey, string> = { cash: "", card: "", bank: "" };

const PAY_METHODS: { key: PayKey; label: string; action: "payCash" | "payCard" | "payBank" }[] = [
  { key: "cash", label: "Naqd", action: "payCash" },
  { key: "card", label: "Karta", action: "payCard" },
  { key: "bank", label: "Bank", action: "payBank" },
];

const SYNC_LABEL: Record<SyncState, { text: string; tone: string }> = {
  idle: { text: "Sinxron", tone: "bg-emerald-500" },
  syncing: { text: "Sinxron…", tone: "bg-sky-500 animate-pulse" },
  offline: { text: "Offline", tone: "bg-amber-500" },
  unauthorized: { text: "Qurilma o'chirilgan", tone: "bg-destructive" },
  error: { text: "Sinxron xatosi", tone: "bg-destructive" },
};

/** O'zgarmas tugmalar (qolganlari — Sozlamalar → Qaynoq tugmalar). */
const FIXED_HOTKEYS: [string, string][] = [
  ["↑ ↓", "Qator tanlash"],
  ["+ / −", "Miqdorni oshirish / kamaytirish"],
  ["Delete", "Qatorni o'chirish"],
];

type MenuTone = "primary" | "amber" | "sky" | "emerald" | "rose" | "slate";

/** Menyu qatori ikonkasi: fon va rang (mavzu tokenlari bilan; qorong'i mavzularda ham o'qiladi). */
const MENU_TONES: Record<MenuTone, { box: string; icon: string }> = {
  primary: { box: "bg-primary/10", icon: "text-primary" },
  amber: { box: "bg-amber-500/15", icon: "text-amber-600 dark:text-amber-400" },
  sky: { box: "bg-sky-500/15", icon: "text-sky-600 dark:text-sky-400" },
  emerald: { box: "bg-emerald-500/15", icon: "text-emerald-600 dark:text-emerald-400" },
  rose: { box: "bg-destructive/10", icon: "text-destructive" },
  slate: { box: "bg-muted", icon: "text-foreground" },
};

function MenuRow({
  icon: Icon,
  label,
  tone = "slate",
  shortcut,
  badge,
  disabled,
  onSelect,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  tone?: MenuTone;
  shortcut?: string;
  badge?: number;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <DropdownMenuItem disabled={disabled} onSelect={onSelect} className="gap-3 rounded-lg px-2 py-1.5">
      <span className={`flex size-8 shrink-0 items-center justify-center rounded-md ${MENU_TONES[tone].box}`}>
        <Icon className={`size-4 ${MENU_TONES[tone].icon}`} />
      </span>
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{label}</span>
      {badge ? <span className="rounded-full bg-amber-500 px-1.5 text-xs font-semibold tabular-nums text-white">{badge}</span> : null}
      {shortcut && <Kbd className="h-6 min-w-8 rounded-md border border-border bg-background px-1.5">{shortcut}</Kbd>}
    </DropdownMenuItem>
  );
}

function MenuGroupLabel({ children }: { children: string }) {
  return <DropdownMenuLabel className="px-2 pt-2.5 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{children}</DropdownMenuLabel>;
}

const cartInput = (cart: CartLine[]): CartLineInput[] =>
  cart.map((line) => ({ productId: line.productId, unitId: line.unitId, quantity: line.quantity, ...(line.priceOverride ? { unitPrice: line.priceOverride } : {}) }));

/**
 * Kassa (POS): chap — mahsulot qidiruvi va ro'yxati (skaner ham), o'ng — savat, mijoz, to'lov. Yuqoridagi menyu:
 * ombor, sotuv valyutasi, sinxron bo'lmagan cheklar, qaytarish, kechiktirilgan cheklar, pul qutisi, smena, printer.
 * Hisob main jarayondagi bilan bir xil (`computeSale`) — ekranda ko'rilgan summa aynan chekka yoziladi.
 */
export default function PosScreen({
  status,
  onStatus,
  onExit,
  onNavigate,
}: {
  status: AppStatus;
  onStatus: (status: AppStatus) => void;
  onExit: () => void;
  onNavigate: (view: "history" | "kassa" | "purchase") => void;
}) {
  const [context, setContext] = useState<PosContext | null>(null);
  const [prefs, setPrefs] = useState<DevicePrefs | null>(null);
  const [query, setQuery] = useState("");
  const [products, setProducts] = useState<PosProduct[]>([]);
  const [productsVersion, setProductsVersion] = useState(0);
  /** Tezkor sotuv (kompaniya assortimenti) yoki barcha mahsulotlar; qidiruv doim barcha mahsulotlar bo'yicha. */
  const [tab, setTab] = useState<"quick" | "all">("quick");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [categories, setCategories] = useState<PosCategory[]>([]);
  const [quick, setQuick] = useState<QuickSaleView | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const [detail, setDetail] = useState<PosProduct | null>(null);
  const [weighing, setWeighing] = useState(false);
  const quickReady = useRef(false);
  const productsRequest = useRef(0);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [selected, setSelected] = useState(0);
  const [customer, setCustomer] = useState<PosCustomer | null>(null);
  const [saleCurrencies, setSaleCurrencies] = useState<string[]>([]);
  const [payMethod, setPayMethod] = useState<PaymentMethod>("cash");
  /** Aralash to'lov: usul bo'yicha kiritilgan summa; hammasi bo'sh — tanlangan usulda aniq summa (tez yakunlash). */
  const [tender, setTender] = useState<Record<PayKey, string>>(EMPTY_TENDER);
  const [useBalance, setUseBalance] = useState(false);
  const [balanceInput, setBalanceInput] = useState("");
  const [useCashback, setUseCashback] = useState(false);
  const [cashbackInput, setCashbackInput] = useState("");
  const [changeToBalance, setChangeToBalance] = useState(false);
  const [foreignTender, setForeignTender] = useState<Record<string, string>>({});
  const [foreignMethod, setForeignMethod] = useState<Record<string, "cash" | "card">>({});
  const [dialog, setDialog] = useState<DialogName | null>(null);
  const [receipt, setReceipt] = useState<LocalSale | null>(null);
  const [notice, setNotice] = useState<{ tone: "error" | "info"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [openingCash, setOpeningCash] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const methodReady = useRef(false);
  const lastSyncAt = status.sync.lastSyncAt;
  const hotkeys = prefs?.hotkeys ?? DEFAULT_HOTKEYS;
  const enabledMethods = PAY_METHODS.filter((method) => !prefs || prefs.enabledPaymentMethods.includes(method.key));
  const hotkeyList: [string, string][] = [
    ...HOTKEY_ACTIONS.filter((action) => !PAY_METHODS.some((method) => method.action === action) || enabledMethods.some((method) => method.action === action)).map(
      (action): [string, string] => [hotkeys[action], HOTKEY_LABELS[action]],
    ),
    ...FIXED_HOTKEYS,
  ];

  useEffect(() => {
    Promise.all([call("pos:context"), call("device:prefs")]).then(
      ([loaded, devicePrefs]) => {
        setContext(loaded);
        setPrefs(devicePrefs);
        // Birinchi yuklanishda — standart usul; keyin faqat joriy usul o'chirilgan bo'lsa
        const first = !methodReady.current;
        methodReady.current = true;
        setPayMethod((current) => (first || !devicePrefs.enabledPaymentMethods.includes(current) ? devicePrefs.defaultPaymentMethod : current));
      },
      (err: unknown) => setNotice({ tone: "error", text: errorText(err) }),
    );
  }, [lastSyncAt]);

  const showQuick = tab === "quick" && query.trim() === "";
  const quickCategory = tab === "quick" ? categoryId : null;

  useEffect(() => {
    call("pos:quick-sale", { categoryId: quickCategory }).then(
      (view) => {
        setQuick(view);
        // Birinchi ochilishda assortiment tanlanmagan bo'lsa — barcha mahsulotlar
        if (!quickReady.current) {
          quickReady.current = true;
          if (!view.configured) setTab("all");
        }
      },
      (err: unknown) => setNotice({ tone: "error", text: errorText(err) }),
    );
  }, [quickCategory, productsVersion, lastSyncAt]);

  useEffect(() => {
    call("pos:categories").then(setCategories, () => undefined);
  }, [lastSyncAt]);

  useEffect(() => {
    if (showQuick) return;
    // Eng oxirgi so'rov javobi ko'rsatiladi (tez yozilganda eski javob ustiga yozmasin)
    const request = ++productsRequest.current;
    const timer = setTimeout(
      () => {
        call("pos:products", { query, limit, categoryId }).then(
          (list) => {
            if (request === productsRequest.current) setProducts(list);
          },
          (err: unknown) => setNotice({ tone: "error", text: errorText(err) }),
        );
      },
      query ? 150 : 0,
    );
    return () => clearTimeout(timer);
  }, [query, limit, categoryId, showQuick, productsVersion, lastSyncAt]);

  const base = context?.baseCurrency ?? status.company?.currency ?? "UZS";
  const permissions = context?.permissions ?? status.cashier?.permissions ?? [];
  const canEditPrice = permissions.includes("sales.edit");
  const activeCurrencies = saleCurrencies.length > 0 ? saleCurrencies : [base];
  const foreignInput = activeCurrencies
    .filter((code) => code !== base)
    .map((code) => ({ currency: code, amount: foreignTender[code]?.trim() ? foreignTender[code]! : null, method: foreignMethod[code] ?? ("cash" as const) }));
  const typedMethods = PAY_METHODS.map((method) => method.key).filter((key) => tender[key].trim() !== "");
  const paymentsInput: { method: PayKey; amount: string | null }[] =
    typedMethods.length === 0
      ? [{ method: payMethod === "transfer" ? "bank" : payMethod, amount: null }]
      : typedMethods.map((key) => ({ method: key, amount: tender[key].trim() }));

  const linesValid = cart.every((line) => QTY.test(line.quantity) && toMinor(line.quantity, 4) > 0n && (line.priceOverride === null || QTY.test(line.priceOverride)));
  let calc: SaleCalc | null = null;
  if (context && cart.length > 0 && linesValid) {
    const rates: Record<string, string> = {};
    for (const currency of context.currencies) rates[currency.code] = currency.rate;
    try {
      calc = computeSale({
        lines: cart.map((line) => ({
          productId: line.productId,
          quantity: line.quantity,
          unitPrice: line.priceOverride ?? line.listPrice,
          discountPercent: customer?.discountPercent ?? "0",
          taxRate: line.taxRate,
          taxIncluded: line.taxIncluded,
          salesCurrency: line.salesCurrency,
        })),
        baseCurrency: base,
        rates,
        saleCurrencies: activeCurrencies,
        customer: customer ? { balance: customer.balance, cashbackBalance: customer.cashbackBalance } : null,
        cashback: context.cashback,
        paymentMethod: payMethod,
        amountPaid: null,
        payments: paymentsInput,
        cashbackAmount: useCashback ? cashbackInput.trim() : null,
        balanceAmount: useBalance ? balanceInput.trim() : null,
        changeToBalance,
        currencyPayments: foreignInput,
      });
    } catch {
      calc = null;
    }
  }
  const currencyMode = !!calc && (calc.buckets.length > 1 || !calc.hasBaseBucket);

  const resetCart = () => {
    setCart([]);
    setSelected(0);
    setCustomer(null);
    setPayMethod(prefs?.defaultPaymentMethod ?? "cash");
    setTender(EMPTY_TENDER);
    setUseBalance(false);
    setBalanceInput("");
    setUseCashback(false);
    setCashbackInput("");
    setChangeToBalance(false);
    setForeignTender({});
    setForeignMethod({});
  };

  const addProduct = (product: PosProduct, quantity = "1") => {
    if (product.price === null) {
      setNotice({ tone: "error", text: `${product.name}: ${product.salesCurrency} valyutasi yoqilmagan — narx yo'q` });
      return;
    }
    const index = cart.findIndex((line) => line.productId === product.id && line.unitId === product.baseUnitId);
    if (index >= 0) {
      const line = cart[index]!;
      const current = QTY.test(line.quantity) ? toMinor(line.quantity, 4) : 0n;
      setCart(cart.map((item, i) => (i === index ? { ...item, quantity: trimDecimal(fromMinor(current + toMinor(quantity, 4), 4)), stock: product.stock } : item)));
      setSelected(index);
    } else {
      setCart([
        ...cart,
        {
          productId: product.id,
          unitId: product.baseUnitId,
          unitName: product.unitName,
          name: product.name,
          sku: product.sku,
          quantity,
          listPrice: product.price,
          priceOverride: null,
          taxRate: product.taxRate,
          taxIncluded: product.taxIncluded,
          salesCurrency: product.salesCurrency,
          stock: product.stock,
        },
      ]);
      setSelected(cart.length);
    }
    setNotice(null);
  };

  /** Tortiladigan mahsulot: og'irlik tarozidan (barqaror bo'lsa); tarozi sozlanmagan — 1 qo'shiladi, miqdorni kassir kiritadi. */
  const addFromList = async (product: PosProduct) => {
    if (!product.isWeighted) {
      addProduct(product);
      return;
    }
    if (weighing) return;
    setWeighing(true);
    try {
      const reading = await call("scale:read-weight", {});
      const grams = Math.round(Number(reading.weight) * 1000);
      if (!reading.stable) setNotice({ tone: "error", text: `${reading.scaleName}: og'irlik barqaror emas (${reading.weight} kg) — kutib qayta bosing` });
      else if (grams <= 0) setNotice({ tone: "error", text: `${reading.scaleName}: tarozi bo'sh` });
      else {
        addProduct(product, trimDecimal(fromMinor(BigInt(grams) * 10n, 4)));
        setNotice({ tone: "info", text: `${product.name}: ${reading.weight} kg (${reading.scaleName})` });
      }
    } catch (err) {
      if ((err as { code?: string } | null)?.code === "NOT_CONFIGURED") {
        addProduct(product);
        setNotice({ tone: "info", text: "Tarozi sozlanmagan — og'irlikni miqdor maydoniga kiriting" });
      } else setNotice({ tone: "error", text: errorText(err) });
    } finally {
      setWeighing(false);
    }
  };

  /** Skaner: tarozi etiketkasi — etiketkadagi og'irlik; tortiladigan mahsulotning oddiy kodi — tarozidan; boshqasi — 1. */
  const addScanned = (product: PosProduct) => {
    if (product.scannedQuantity) addProduct(product, product.scannedQuantity);
    else void addFromList(product);
  };

  const addByCode = async (code: string) => {
    try {
      const product = await call("pos:product-by-code", { code });
      if (product) {
        setReceipt(null);
        actions.current.addScanned(product);
        return true;
      }
      setNotice({ tone: "error", text: `"${code}" — mahsulot topilmadi` });
    } catch (err) {
      setNotice({ tone: "error", text: errorText(err) });
    }
    return false;
  };

  const setLine = (index: number, patch: Partial<CartLine>) => setCart((current) => current.map((line, i) => (i === index ? { ...line, ...patch } : line)));

  const removeLine = (index: number) => {
    setCart((current) => current.filter((_, i) => i !== index));
    setSelected((current) => Math.max(0, Math.min(current, cart.length - 2)));
  };

  const changeQty = (index: number, delta: bigint) => {
    const line = cart[index];
    if (!line || !QTY.test(line.quantity)) return;
    const next = toMinor(line.quantity, 4) + delta * 10_000n;
    if (next <= 0n) removeLine(index);
    else setLine(index, { quantity: trimDecimal(fromMinor(next, 4)) });
  };

  const toggleCurrency = (code: string) => {
    const next = activeCurrencies.includes(code) ? activeCurrencies.filter((item) => item !== code) : [...activeCurrencies, code];
    if (next.length === 0) return;
    const order = [base, ...(context?.currencies ?? []).map((currency) => currency.code)];
    setSaleCurrencies(order.filter((item) => next.includes(item)));
    setForeignTender({});
    setForeignMethod({});
  };

  /** Qolgan summani shu usulga yozish (boshqa usullarda kiritilgani ayiriladi) — aralash to'lov. */
  const fillRest = (method: PayKey) => {
    setPayMethod(method);
    const due = calc?.due ?? 0n;
    const others = typedMethods.filter((key) => key !== method).reduce((sum, key) => sum + (QTY.test(tender[key]) ? toMinor(tender[key]) : 0n), 0n);
    setTender((current) => ({ ...current, [method]: trimDecimal(fromMinor(due > others ? due - others : 0n)) }));
  };

  const complete = async () => {
    if (busy || cart.length === 0) return;
    if (!calc) {
      setNotice({ tone: "error", text: "Miqdor yoki narxni tekshiring" });
      return;
    }
    if (calc.errors.length > 0) {
      setNotice({ tone: "error", text: calc.errors[0]! });
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const sale = await call("pos:complete-sale", {
        customerId: customer?.id ?? null,
        lines: cartInput(cart),
        saleCurrencies: activeCurrencies,
        paymentMethod: payMethod,
        amountPaid: null,
        payments: paymentsInput,
        cashbackAmount: useCashback ? cashbackInput.trim() : null,
        balanceAmount: useBalance ? balanceInput.trim() : null,
        changeToBalance,
        currencyPayments: foreignInput,
      });
      resetCart();
      setReceipt(sale);
      setProductsVersion((value) => value + 1);
      call("app:status").then(onStatus, () => undefined);
      if (prefs?.autoPrint) {
        printSale(sale, context, prefs).catch((err: unknown) => setNotice({ tone: "error", text: `Chek chop etilmadi: ${errorText(err)}` }));
      }
      const cashTaken = sale.payments?.some((part) => part.method === "cash" && num(part.paid) > 0) ?? sale.paymentMethod === "cash";
      if (prefs?.openDrawerOnCash && cashTaken && (prefs.drawer.mode === "tcp" || prefs.drawer.mode === "share")) {
        call("device:open-drawer").catch((err: unknown) => setNotice({ tone: "error", text: errorText(err) }));
      }
    } catch (err) {
      setNotice({ tone: "error", text: errorText(err) });
    } finally {
      setBusy(false);
    }
  };

  const hold = async () => {
    if (cart.length === 0) return;
    try {
      await call("pos:hold", {
        label: customer?.name,
        cart: { customerId: customer?.id ?? null, lines: cartInput(cart), saleCurrencies: activeCurrencies, display: { customer, lines: cart } },
      });
      resetCart();
      setNotice({ tone: "info", text: "Chek kechiktirildi — F6 bilan qaytarasiz" });
    } catch (err) {
      setNotice({ tone: "error", text: errorText(err) });
    }
  };

  const takeHeld = async (held: HeldReceipt) => {
    setDialog(null);
    const saved = (held.cart.display?.lines ?? []) as CartLine[];
    // Narx va qoldiq yangilanadi — kechiktirilgandan keyin sinxron bo'lgan bo'lishi mumkin
    const fresh = await Promise.all(
      saved.map((line) =>
        call("pos:products", { query: line.sku, limit: 20 }).then(
          (list) => list.find((product) => product.id === line.productId) ?? null,
          () => null,
        ),
      ),
    );
    const lines = saved.flatMap((line, index) => {
      const product = fresh[index];
      return product && product.price !== null ? [{ ...line, listPrice: product.price, stock: product.stock }] : [];
    });
    if (lines.length < saved.length) setNotice({ tone: "error", text: "Ba'zi mahsulotlar endi sotilmaydi — savatdan olib tashlandi" });
    setCart(lines);
    setSelected(0);
    setCustomer(held.cart.display?.customer ?? null);
    setSaleCurrencies(held.cart.saleCurrencies);
  };

  const openDrawer = async () => {
    try {
      await call("device:open-drawer");
    } catch (err) {
      setNotice({ tone: "error", text: errorText(err) });
    }
  };

  const openShift = async () => {
    setBusy(true);
    try {
      onStatus(await call("shift:open", { openingCash: openingCash || "0" }));
      setOpeningCash("");
    } catch (err) {
      setNotice({ tone: "error", text: errorText(err) });
    } finally {
      setBusy(false);
    }
  };

  const switchTab = (next: "quick" | "all") => {
    setTab(next);
    setCategoryId(null);
    setLimit(PAGE);
  };

  const pickCategory = (id: string | null) => {
    setCategoryId(id);
    setLimit(PAGE);
  };

  const setProductView = (productView: DevicePrefs["productView"]) => {
    if (!prefs || prefs.productView === productView) return;
    call("device:save-prefs", { ...prefs, productView }).then(setPrefs, (err: unknown) => setNotice({ tone: "error", text: errorText(err) }));
  };

  const handleKey = (event: KeyboardEvent) => {
    if (dialog || receipt || detail) return;
    const pickMethod = (method: PayKey) => {
      if (!enabledMethods.some((item) => item.key === method)) return;
      // Summa kiritilgan bo'lsa — qolgan summa shu usulga (aralash to'lov); aks holda usul tanlanadi (aniq summa)
      if (typedMethods.length > 0) fillRest(method);
      else setPayMethod(method);
    };
    const handlers: Record<(typeof HOTKEY_ACTIONS)[number], () => void> = {
      help: () => setDialog("help"),
      search: () => searchRef.current?.focus(),
      quantity: () => document.getElementById(`cart-qty-${selected}`)?.focus(),
      customer: () => setDialog("customer"),
      hold: () => void hold(),
      held: () => setDialog("held"),
      return: () => setDialog("return"),
      unsynced: () => setDialog("unsynced"),
      payCash: () => pickMethod("cash"),
      payCard: () => pickMethod("card"),
      payBank: () => pickMethod("bank"),
      complete: () => void complete(),
    };
    const pressed = keyName(event);
    const action = pressed ? HOTKEY_ACTIONS.find((item) => hotkeys[item] === pressed) : undefined;
    if (action) {
      event.preventDefault();
      handlers[action]();
      return;
    }
    const tag = (event.target as HTMLElement | null)?.tagName ?? "";
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if (event.key === "Delete") removeLine(selected);
    else if (event.key === "ArrowDown") setSelected((current) => Math.min(current + 1, cart.length - 1));
    else if (event.key === "ArrowUp") setSelected((current) => Math.max(current - 1, 0));
    else if (event.key === "+") changeQty(selected, 1n);
    else if (event.key === "-") changeQty(selected, -1n);
    else return;
    event.preventDefault();
  };

  // Global tinglovchilar bir marta ulanadi — eng so'nggi funksiyalar ref orqali
  const actions = useRef({ handleKey, addProduct, addScanned, addByCode });
  useEffect(() => {
    actions.current = { handleKey, addProduct, addScanned, addByCode };
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => actions.current.handleKey(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);
  const onScan = useCallback((code: string) => void actions.current.addByCode(code), []);
  useHIDScanner({ onScan, minLength: 3 });

  const sync = SYNC_LABEL[status.sync.state];
  const unsyncedCount = status.sync.pending + status.sync.rejected;
  const shiftTotals = status.shift?.totals;
  const errors = calc?.errors.filter((error) => error !== "Savatcha bo'sh") ?? [];
  const productView = prefs?.productView ?? "cards";
  const shownProducts = showQuick ? (quick?.products ?? []) : products;
  const discountPercent = num(customer?.discountPercent ?? "0");
  const cartQty = new Map<string, number>();
  for (const line of cart) cartQty.set(line.productId, (cartQty.get(line.productId) ?? 0) + num(line.quantity));

  const header = (
    <header className="flex items-center gap-3 border-b border-border bg-card px-3 py-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" size="sm" className="gap-2">
            <Menu className="size-4" />
            Menyu
            {unsyncedCount > 0 && <span className="rounded-full bg-amber-500 px-1.5 text-xs font-semibold text-white">{unsyncedCount}</span>}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" sideOffset={6} className="w-[22rem] rounded-xl p-2 shadow-xl">
          <div className="flex items-center gap-3 rounded-lg bg-muted/70 px-3 py-2.5">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Store className="size-5" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{status.device?.warehouseName}</p>
              <p className="truncate text-xs text-muted-foreground">
                Kassa {status.device?.code} · {status.device?.name}
              </p>
            </div>
          </div>

          <MenuGroupLabel>Sotuv valyutasi</MenuGroupLabel>
          {[base, ...(context?.currencies ?? []).map((currency) => currency.code)].map((code) => (
            <DropdownMenuCheckboxItem
              key={code}
              className="rounded-lg py-2 pr-2.5 pl-9"
              checked={activeCurrencies.includes(code)}
              onSelect={(event) => event.preventDefault()}
              onCheckedChange={() => toggleCurrency(code)}
            >
              <span className="font-semibold">{code}</span>
              {code !== base && (
                <span className="ml-auto text-xs tabular-nums text-muted-foreground">{fmtMoney(context?.currencies.find((currency) => currency.code === code)?.rate, base)}</span>
              )}
            </DropdownMenuCheckboxItem>
          ))}

          <DropdownMenuSeparator className="my-1.5" />
          <MenuGroupLabel>Cheklar</MenuGroupLabel>
          <MenuRow
            icon={RefreshCw}
            tone={unsyncedCount > 0 ? "amber" : "sky"}
            label="Sinxron bo'lmagan cheklar"
            badge={unsyncedCount}
            shortcut={hotkeys.unsynced}
            onSelect={() => setDialog("unsynced")}
          />
          <MenuRow icon={Undo2} tone="rose" label="Mahsulotni qaytarish" shortcut={hotkeys.return} onSelect={() => setDialog("return")} />
          <MenuRow icon={Clock} tone="primary" label="Kechiktirilgan cheklar" shortcut={hotkeys.held} onSelect={() => setDialog("held")} />

          <DropdownMenuSeparator className="my-1.5" />
          <MenuGroupLabel>Kassa</MenuGroupLabel>
          <MenuRow icon={Banknote} tone="emerald" label="Pul qutisini ochish" onSelect={() => void openDrawer()} />
          <MenuRow icon={LockKeyhole} tone="amber" label="Smenani yopish" disabled={!status.shift} onSelect={() => setDialog("shift")} />
          <MenuRow icon={Printer} label="Printer va pul qutisi" onSelect={() => setDialog("prefs")} />
          <MenuRow icon={Keyboard} label="Tugmalar" shortcut={hotkeys.help} onSelect={() => setDialog("help")} />

          <DropdownMenuSeparator className="my-1.5" />
          <MenuGroupLabel>Bo'limlar</MenuGroupLabel>
          <MenuRow icon={History} tone="primary" label="Sotuv tarixi" onSelect={() => onNavigate("history")} />
          <MenuRow icon={Calculator} tone="emerald" label="Kassa: kirim-chiqim, X/Z-hisobot" onSelect={() => onNavigate("kassa")} />
          <MenuRow icon={Truck} tone="sky" label="Xarid: ta'minotchidan tovar" onSelect={() => onNavigate("purchase")} />
          <MenuRow icon={House} label="Bosh sahifa" onSelect={onExit} />

          <DropdownMenuSeparator className="my-1.5" />
          <DropdownMenuItem className="gap-3 rounded-lg px-2 py-2" onSelect={() => void call("cashier:logout").then(onStatus)}>
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
              {(status.cashier?.name ?? status.cashier?.phone ?? "?").trim().charAt(0).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{status.cashier?.name ?? status.cashier?.phone}</span>
              <span className="block text-xs text-muted-foreground">Kassirni almashtirish</span>
            </span>
            <LogOut className="size-4 text-muted-foreground" />
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <div className="min-w-0 text-sm">
        <span className="font-semibold">{status.company?.name}</span>
        <span className="ml-2 text-muted-foreground">
          {status.device?.code} · {status.device?.warehouseName}
        </span>
      </div>
      {shiftTotals && (
        <div className="hidden text-xs text-muted-foreground lg:block">
          Smena: {shiftTotals.receipts} chek · {fmtMoney(shiftTotals.sales, base)}
        </div>
      )}
      <div className="ml-auto flex items-center gap-3 text-sm">
        <button type="button" className="flex items-center gap-2" onClick={() => setDialog("unsynced")}>
          <span className={`h-2.5 w-2.5 rounded-full ${sync.tone}`} />
          {sync.text}
          {unsyncedCount > 0 && <span className="text-muted-foreground">· {unsyncedCount} navbatda</span>}
        </button>
        <span className="font-medium">{status.cashier?.name ?? status.cashier?.phone}</span>
      </div>
    </header>
  );

  const dialogs = (
    <>
      <CustomerDialog
        open={dialog === "customer"}
        baseCurrency={base}
        onClose={() => setDialog(null)}
        onSelect={(picked) => {
          setCustomer(picked);
          setUseBalance(false);
          setUseCashback(false);
          setChangeToBalance(false);
          setDialog(null);
        }}
      />
      <ReturnDialog
        open={dialog === "return"}
        baseCurrency={base}
        canRefund={permissions.includes("sales.refund")}
        onClose={() => setDialog(null)}
        onDone={() => {
          setProductsVersion((value) => value + 1);
          call("app:status").then(onStatus, () => undefined);
        }}
      />
      <UnsyncedDialog open={dialog === "unsynced"} baseCurrency={base} canDiscard={permissions.includes("sales.approve")} onClose={() => setDialog(null)} onStatus={onStatus} />
      <HeldDialog open={dialog === "held"} baseCurrency={base} cartEmpty={cart.length === 0} onClose={() => setDialog(null)} onTake={(held) => void takeHeld(held)} />
      <ShiftCloseDialog
        open={dialog === "shift"}
        shift={status.shift}
        baseCurrency={base}
        onClose={() => setDialog(null)}
        onClosed={(next) => {
          setDialog(null);
          onStatus(next);
        }}
      />
      <PrefsDialog open={dialog === "prefs"} context={context} cashierName={status.cashier?.name ?? null} onClose={() => setDialog(null)} onSaved={setPrefs} />
      <Dialog open={dialog === "help"} onOpenChange={(value) => !value && setDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Tugmalar</DialogTitle>
            <DialogDescription>Kassani sichqonchasiz boshqarish.</DialogDescription>
          </DialogHeader>
          <dl className="space-y-1.5 text-sm">
            {hotkeyList.map(([key, label]) => (
              <div key={key} className="flex items-center justify-between gap-3">
                <dt>{label}</dt>
                <dd>
                  <Kbd>{key}</Kbd>
                </dd>
              </div>
            ))}
          </dl>
        </DialogContent>
      </Dialog>
      <ReceiptDialog sale={receipt} context={context} prefs={prefs} onClose={() => setReceipt(null)} />
      <ProductDetailDialog
        product={detail}
        base={base}
        discountPercent={num(customer?.discountPercent ?? "0")}
        onClose={() => setDetail(null)}
        onAdd={(product, quantity) => {
          addProduct(product, quantity);
          setDetail(null);
        }}
      />
    </>
  );

  if (!status.shift) {
    return (
      <main className="flex h-full flex-col bg-muted/40">
        {header}
        <div className="flex flex-1 items-center justify-center p-6">
          <form
            className="w-full max-w-sm space-y-3 rounded-2xl border border-border bg-card p-6"
            onSubmit={(event) => {
              event.preventDefault();
              void openShift();
            }}
          >
            <h1 className="text-lg font-semibold">Smena yopiq</h1>
            <p className="text-sm text-muted-foreground">Sotuvni boshlash uchun kassadagi boshlang'ich naqdni kiriting.</p>
            <Input id="opening-cash" autoFocus inputMode="decimal" placeholder="0" value={openingCash} onChange={(e) => setOpeningCash(decimalInput(e.target.value))} />
            <Button type="submit" className="h-11 w-full" disabled={busy}>
              Smenani ochish
            </Button>
            {notice && <p className="text-sm text-destructive">{notice.text}</p>}
          </form>
        </div>
        {dialogs}
      </main>
    );
  }

  return (
    <main className="grid h-full grid-rows-[auto_1fr] bg-muted/40">
      {header}
      <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_440px]">
        {/* Mahsulotlar */}
        <section className="flex min-h-0 flex-col gap-2 p-3">
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const code = query.trim();
              if (!code) return;
              void addByCode(code).then((found) => {
                if (found) setQuery("");
                else if (products.length === 1) {
                  addProduct(products[0]!);
                  setQuery("");
                }
              });
            }}
          >
            <Input
              ref={searchRef}
              id="pos-search"
              autoFocus
              className="h-11 text-base"
              placeholder="Mahsulot nomi, SKU yoki shtrix-kod (F2)"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setLimit(PAGE);
              }}
            />
          </form>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg border border-border bg-card p-0.5" role="tablist" aria-label="Mahsulotlar">
              {(["quick", "all"] as const).map((key) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={tab === key}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium ${tab === key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                  onClick={() => switchTab(key)}
                >
                  {key === "quick" ? `Tezkor sotuv${quick?.configured ? ` · ${quick.products.length}` : ""}` : "Barcha mahsulotlar"}
                </button>
              ))}
            </div>
            {query.trim() !== "" && tab === "quick" && <span className="text-xs text-muted-foreground">qidiruv — barcha mahsulotlar bo'yicha</span>}
            <div className="ml-auto flex rounded-lg border border-border bg-card p-0.5" aria-label="Ko'rinish">
              {(["cards", "table"] as const).map((key) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={productView === key}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium ${productView === key ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                  onClick={() => setProductView(key)}
                >
                  {key === "cards" ? "Kartalar" : "Jadval"}
                </button>
              ))}
            </div>
          </div>
          <CategoryChips categories={showQuick ? (quick?.categories ?? []) : categories} active={categoryId} onPick={pickCategory} />
          <div className={`min-h-0 flex-1 overflow-y-auto ${productView === "table" ? "rounded-xl border border-border bg-card" : ""}`}>
            {showQuick && quick && !quick.configured ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
                <p className="max-w-md text-sm text-muted-foreground">
                  Tezkor sotuv assortimenti hali tanlanmagan. Rahbar web'da tanlaydi: Sozlamalar → Kassa qurilmalari → Tezkor sotuv (eng ko'p sotilganlar
                  tavsiyasi bilan).
                </p>
                <Button variant="secondary" onClick={() => switchTab("all")}>
                  Barcha mahsulotlar
                </Button>
              </div>
            ) : productView === "cards" ? (
              <div className={`grid gap-2 ${showQuick ? "grid-cols-[repeat(auto-fill,minmax(12.5rem,1fr))]" : "grid-cols-[repeat(auto-fill,minmax(10rem,1fr))]"}`}>
                {shownProducts.map((product) => (
                  <ProductCard
                    key={product.id}
                    product={product}
                    base={base}
                    discountPercent={discountPercent}
                    inCart={cartQty.get(product.id) ?? 0}
                    onAdd={(picked) => void addFromList(picked)}
                    onDetails={setDetail}
                  />
                ))}
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted/80 text-left text-xs text-muted-foreground backdrop-blur">
                  <tr>
                    <th className="px-3 py-2">Mahsulot</th>
                    <th className="px-3 py-2">SKU</th>
                    <th className="px-3 py-2 text-right">Narx</th>
                    <th className="px-3 py-2 text-right">Qoldiq</th>
                  </tr>
                </thead>
                <tbody>
                  {shownProducts.map((product) => {
                    const stock = num(product.stock);
                    return (
                      <tr key={product.id} className="cursor-pointer border-t border-border hover:bg-primary/5" onClick={() => void addFromList(product)}>
                        <td className="px-3 py-1.5 font-medium">
                          <span className="flex items-center gap-2">
                            <ProductImage product={product} className="h-9 w-9 shrink-0 rounded-md text-xs" />
                            <span className="min-w-0">
                              {product.name}
                              <span className="ml-2 inline-flex gap-1 align-middle">
                                <PromoBadges product={product} discountPercent={0} />
                              </span>
                            </span>
                          </span>
                        </td>
                        <td className="px-3 py-1.5 text-muted-foreground">{product.sku}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">
                          {product.price === null ? (
                            <span className="text-destructive">kurs yo'q</span>
                          ) : (
                            <span className={product.promo ? "font-semibold text-destructive" : ""}>{fmtMoney(product.price, base)}</span>
                          )}
                          {product.promo && product.regularPrice && product.regularPrice !== product.price && (
                            <s className="block text-xs text-muted-foreground">{fmtMoney(product.regularPrice, base)}</s>
                          )}
                          {product.salesCurrency && product.salesCurrency !== base && (
                            <span className="block text-xs text-muted-foreground">{fmtMoney(product.salesPrice, product.salesCurrency)}</span>
                          )}
                        </td>
                        <td className={`px-3 py-1.5 text-right tabular-nums ${stock < 0 ? "text-destructive" : stock === 0 ? "text-amber-600" : ""}`}>
                          {fmtQty(product.stock)} {product.unitName}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            {shownProducts.length === 0 && !(showQuick && quick && !quick.configured) && (
              <p className="px-3 py-10 text-center text-sm text-muted-foreground">Mahsulot topilmadi</p>
            )}
            {!showQuick && products.length >= limit && limit < MAX_LIST && (
              <div className="p-2 text-center">
                <Button variant="secondary" size="sm" onClick={() => setLimit(limit + PAGE)}>
                  Yana ko'rsatish
                </Button>
              </div>
            )}
          </div>
          {notice && (
            <p className={`rounded-lg px-3 py-2 text-sm ${notice.tone === "error" ? "bg-destructive/10 text-destructive" : "bg-sky-500/10 text-sky-700"}`}>{notice.text}</p>
          )}
        </section>

        {/* Savat va to'lov */}
        <aside className="flex min-h-0 flex-col border-l border-border bg-card">
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            {customer ? (
              <div className="min-w-0 flex-1">
                <button type="button" className="block max-w-full truncate text-left font-medium" onClick={() => setDialog("customer")}>
                  {customer.name}
                </button>
                <p className="text-xs text-muted-foreground">
                  {num(customer.totalDebt) > 0 && <span className="text-amber-600">qarz {fmtMoney(customer.totalDebt, base)} · </span>}
                  balans {fmtMoney(customer.balance, base)}
                  {context?.cashback?.enabled && <> · keshbek {fmtMoney(customer.cashbackBalance, base)}</>}
                </p>
              </div>
            ) : (
              <Button variant="secondary" size="sm" className="flex-1 justify-start" onClick={() => setDialog("customer")}>
                Mijoz tanlash (F4)
              </Button>
            )}
            {customer && (
              <Button size="sm" variant="ghost" onClick={() => setCustomer(null)}>
                ✕
              </Button>
            )}
            <Button size="sm" variant="ghost" disabled={cart.length === 0} onClick={() => void hold()}>
              Kechiktirish F5
            </Button>
          </div>

          <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto">
            {cart.map((line, index) => {
              const lineCalc = calc?.lines[index];
              const short = QTY.test(line.quantity) && toMinor(line.stock, 4) < toMinor(line.quantity, 4);
              return (
                <li
                  key={`${line.productId}:${line.unitId}`}
                  className={`px-3 py-2 ${index === selected ? "bg-primary/5" : ""}`}
                  onClick={() => setSelected(index)}
                >
                  <div className="flex items-start gap-2">
                    <p className="min-w-0 flex-1 text-sm font-medium leading-tight">{line.name}</p>
                    <button type="button" className="text-xs text-muted-foreground hover:text-destructive" onClick={() => removeLine(index)}>
                      ✕
                    </button>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <Button size="sm" variant="secondary" className="h-7 w-7 p-0" onClick={() => changeQty(index, -1n)}>
                      −
                    </Button>
                    <Input
                      id={`cart-qty-${index}`}
                      className="h-7 w-20 text-right"
                      inputMode="decimal"
                      value={line.quantity}
                      onChange={(e) => setLine(index, { quantity: decimalInput(e.target.value, 4) })}
                    />
                    <Button size="sm" variant="secondary" className="h-7 w-7 p-0" onClick={() => changeQty(index, 1n)}>
                      +
                    </Button>
                    <span className="text-xs text-muted-foreground">{line.unitName} ×</span>
                    {canEditPrice ? (
                      <Input
                        id={`cart-price-${index}`}
                        className="h-7 w-28 text-right"
                        inputMode="decimal"
                        value={line.priceOverride ?? trimDecimal(line.listPrice)}
                        onChange={(e) => {
                          const value = decimalInput(e.target.value, 4);
                          setLine(index, { priceOverride: value === trimDecimal(line.listPrice) ? null : value });
                        }}
                      />
                    ) : (
                      <span className="text-xs tabular-nums">{fmtMoney(line.listPrice, base)}</span>
                    )}
                    <span className="ml-auto text-sm font-semibold tabular-nums">
                      {lineCalc ? fmtMoney(fromMinor(lineCalc.currencyTotal), lineCalc.currency) : "—"}
                    </span>
                  </div>
                  {short && <p className="mt-1 text-xs text-amber-600">Qoldiq {fmtQty(line.stock)} — sotuv yoziladi, rahbar ko'radi</p>}
                </li>
              );
            })}
            {cart.length === 0 && <li className="px-3 py-12 text-center text-sm text-muted-foreground">Savat bo'sh — mahsulotni skanerlang yoki tanlang</li>}
          </ul>

          <div className="space-y-2 border-t border-border p-3">
            {calc && (
              <dl className="space-y-0.5 text-sm">
                {calc.tax > 0n && (
                  <div className="flex justify-between text-muted-foreground">
                    <dt>shu jumladan QQS</dt>
                    <dd className="tabular-nums">{fmtMoney(fromMinor(calc.tax), base)}</dd>
                  </div>
                )}
                {currencyMode ? (
                  calc.buckets.map((bucket) => (
                    <div key={bucket.currency} className="flex justify-between text-lg font-bold">
                      <dt>Jami ({bucket.currency})</dt>
                      <dd className="tabular-nums">{fmtMoney(fromMinor(bucket.total), bucket.currency)}</dd>
                    </div>
                  ))
                ) : (
                  <div className="flex justify-between text-2xl font-bold">
                    <dt>Jami</dt>
                    <dd className="tabular-nums">{fmtMoney(fromMinor(calc.total), base)}</dd>
                  </div>
                )}
                {calc.cashbackUsed > 0n && (
                  <div className="flex justify-between text-violet-600">
                    <dt>Keshbekdan</dt>
                    <dd className="tabular-nums">−{fmtMoney(fromMinor(calc.cashbackUsed), base)}</dd>
                  </div>
                )}
                {calc.balanceUsed > 0n && (
                  <div className="flex justify-between text-emerald-600">
                    <dt>Balansdan</dt>
                    <dd className="tabular-nums">−{fmtMoney(fromMinor(calc.balanceUsed), base)}</dd>
                  </div>
                )}
                {calc.hasBaseBucket && calc.cashbackUsed + calc.balanceUsed > 0n && (
                  <div className="flex justify-between font-semibold">
                    <dt>To'lanadi</dt>
                    <dd className="tabular-nums">{fmtMoney(fromMinor(calc.due), base)}</dd>
                  </div>
                )}
              </dl>
            )}

            {customer && calc && (
              <div className="flex flex-wrap gap-1">
                {num(customer.balance) > 0 && (
                  <Button size="sm" variant={useBalance ? "default" : "secondary"} onClick={() => setUseBalance((value) => !value)}>
                    Balansdan
                  </Button>
                )}
                {useBalance && (
                  <Input
                    id="pay-balance"
                    className="h-8 w-28 text-right"
                    inputMode="decimal"
                    placeholder="hammasi"
                    value={balanceInput}
                    onChange={(e) => setBalanceInput(decimalInput(e.target.value))}
                  />
                )}
                {context?.cashback?.enabled && num(customer.cashbackBalance) > 0 && (
                  <Button size="sm" variant={useCashback ? "default" : "secondary"} onClick={() => setUseCashback((value) => !value)}>
                    Keshbekdan
                  </Button>
                )}
                {useCashback && (
                  <Input
                    id="pay-cashback"
                    className="h-8 w-28 text-right"
                    inputMode="decimal"
                    placeholder={fmtQty(fromMinor(calc.cashbackLimit))}
                    value={cashbackInput}
                    onChange={(e) => setCashbackInput(decimalInput(e.target.value))}
                  />
                )}
              </div>
            )}

            {(!calc || calc.hasBaseBucket) && (
              <div className="space-y-1.5 rounded-lg border border-border p-2">
                {enabledMethods.map((method) => (
                  <div key={method.key} className="flex items-center gap-2">
                    <Button
                      size="sm"
                      className="w-28 justify-between"
                      variant={payMethod === method.key ? "default" : "secondary"}
                      onClick={() => (typedMethods.length > 0 ? fillRest(method.key) : setPayMethod(method.key))}
                    >
                      {method.label} <span className="text-[10px] opacity-70">{hotkeys[method.action]}</span>
                    </Button>
                    <Input
                      id={`pay-${method.key}`}
                      className="h-9 text-right font-semibold"
                      inputMode="decimal"
                      placeholder={typedMethods.length === 0 && payMethod === method.key && calc ? trimDecimal(fromMinor(calc.due)) : "0"}
                      value={tender[method.key]}
                      onChange={(e) => setTender((current) => ({ ...current, [method.key]: decimalInput(e.target.value) }))}
                    />
                    {calc && calc.due > 0n && (
                      <Button size="sm" variant="ghost" className="h-9 px-2 text-xs" title="Qolgan summani shu usulga" onClick={() => fillRest(method.key)}>
                        qoldiq
                      </Button>
                    )}
                  </div>
                ))}
                {calc && (
                  <dl className="grid grid-cols-3 gap-1 pt-1 text-center text-xs">
                    <div>
                      <dt className="text-muted-foreground">To'lanadi</dt>
                      <dd className="font-semibold tabular-nums">{fmtMoney(fromMinor(calc.due), base)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">To'langan</dt>
                      <dd className="font-semibold tabular-nums">{fmtMoney(fromMinor(calc.paid), base)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Qoldiq</dt>
                      <dd className={`font-semibold tabular-nums ${calc.due > calc.paid ? "text-destructive" : "text-emerald-600"}`}>
                        {fmtMoney(fromMinor(calc.due > calc.paid ? calc.due - calc.paid : 0n), base)}
                      </dd>
                    </div>
                  </dl>
                )}
                {customer && calc && calc.due > 0n && (
                  <Button size="sm" variant="ghost" className="w-full text-amber-600" onClick={() => setTender({ ...EMPTY_TENDER, cash: "0" })}>
                    Qarzga (mijoz hisobiga)
                  </Button>
                )}
              </div>
            )}

            {calc?.foreign.map((part) => (
              <div key={part.currency} className="flex items-center gap-2">
                <span className="w-12 text-sm font-medium">{part.currency}</span>
                {(["cash", "card"] as const).map((method) => (
                  <Button
                    key={method}
                    size="sm"
                    variant={part.method === method ? "default" : "secondary"}
                    onClick={() => setForeignMethod((current) => ({ ...current, [part.currency]: method }))}
                  >
                    {method === "cash" ? "Naqd" : "Karta"}
                  </Button>
                ))}
                <Input
                  id={`pay-${part.currency}`}
                  className="h-9 text-right"
                  inputMode="decimal"
                  placeholder={trimDecimal(fromMinor(part.due))}
                  value={foreignTender[part.currency] ?? ""}
                  onChange={(e) => setForeignTender((current) => ({ ...current, [part.currency]: decimalInput(e.target.value) }))}
                />
                {part.change > 0n && <span className="whitespace-nowrap text-xs text-emerald-600">qaytim {fmtMoney(fromMinor(part.change), part.currency)}</span>}
              </div>
            ))}

            {calc && calc.change > 0n && (
              <div className="flex items-center justify-between rounded-lg bg-emerald-500/10 px-3 py-2 font-semibold text-emerald-700">
                <span>{calc.changeKept > 0n ? "Qaytim balansga" : "Qaytim"}</span>
                <span className="tabular-nums">{fmtMoney(fromMinor(calc.change), base)}</span>
                {customer && (
                  <Button size="sm" variant="ghost" className="h-7" onClick={() => setChangeToBalance((value) => !value)}>
                    {changeToBalance ? "Qaytimni berish" : "Balansga"}
                  </Button>
                )}
              </div>
            )}
            {calc && calc.debt > 0n && customer && (
              <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-sm font-medium text-amber-700">Qarzga yoziladi: {fmtMoney(fromMinor(calc.debt), base)}</p>
            )}
            {errors.map((error) => (
              <p key={error} className="text-sm text-destructive">
                {error}
              </p>
            ))}
            {!linesValid && cart.length > 0 && <p className="text-sm text-destructive">Miqdor yoki narxni tekshiring</p>}

            <Button className="h-14 w-full text-lg font-bold" disabled={busy || cart.length === 0 || !calc || errors.length > 0} onClick={() => void complete()}>
              {calc && calc.debt > 0n ? "Qarzga yakunlash" : "Yakunlash"} <span className="ml-2 text-sm opacity-70">F12</span>
            </Button>
          </div>
        </aside>
      </div>
      {dialogs}
    </main>
  );
}
