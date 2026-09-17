import { useCallback, useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import {
  Banknote,
  Clock,
  Keyboard,
  LayoutGrid,
  LockKeyhole,
  LogOut,
  Menu,
  Minus,
  Palette,
  Plus,
  Printer,
  RefreshCw,
  Rows3,
  Search,
  ShoppingCart,
  SlidersHorizontal,
  Store,
  Trash2,
  Undo2,
  UserRound,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
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
import type { PaymentMethod } from "../../shared/sync-types.js";
import { CUSTOM_POS_THEME, POS_THEMES, THEME_ICONS, THEME_LABELS, type PosThemeChoice } from "../../shared/themes.js";
import type { View } from "../app.tsx";
import { decimalInput, fmtMoney, fmtQty, num, trimDecimal } from "../format.ts";
import { call, errorText } from "../kassa.ts";
import CustomerDialog from "../pos/customer-dialog.tsx";
import HeldDialog from "../pos/held-dialog.tsx";
import PaymentAmountDialog from "../pos/payment-amount-dialog.tsx";
import { PaymentProgress } from "../pos/payment-progress.tsx";
import { PosSidebar } from "../pos/pos-sidebar.tsx";
import { PosStatusBar } from "../pos/pos-status.tsx";
import PrefsDialog from "../pos/prefs-dialog.tsx";
import { CategoryChips, ProductCard, ProductDetailDialog, ProductImage, PromoBadges } from "../pos/product-grid.tsx";
import { terminalLabel } from "../pos/terminals.ts";
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
  /** Savat qatoridagi rasm (eski kechiktirilgan cheklarda yo'q — bosh harflar ko'rsatiladi). */
  imageVersion?: string | null;
};

type DialogName = "customer" | "return" | "unsynced" | "held" | "shift" | "prefs" | "help";
type Notice = { tone: "error" | "info" | "success"; text: string };

const QTY = /^\d{1,14}(\.\d{1,4})?$/;
/** Barcha mahsulotlar ro'yxati sahifasi va chegarasi (100 minglab mahsulotda ham ekranga shuncha). */
const PAGE = 120;
const MAX_LIST = 960;

type PayKey = "cash" | "card" | "bank";
/** To'lov qismi: naqd, bank, karta — terminallar sinxronlangan bo'lsa har terminal alohida (`card:<id>`). */
type PayPart = { key: string; method: PayKey; terminalId: string | null; cashAccountId: string | null; label: string };
/** Saqlangan to'lov qismi: tugma (usul + terminal yoki hisob) va kiritilgan summa. */
type SavedPart = PayPart & { amount: string };

const PAY_METHODS: { key: PayKey; label: string; action: "payCash" | "payCard" | "payBank"; dot: string }[] = [
  { key: "cash", label: "Naqd", action: "payCash", dot: "bg-pos-success" },
  { key: "card", label: "Karta", action: "payCard", dot: "bg-pos-info" },
  { key: "bank", label: "Bank", action: "payBank", dot: "bg-primary" },
];

const NOTICE_TONES: Record<Notice["tone"], string> = {
  error: "border-pos-danger/30 bg-pos-danger/10 text-pos-danger",
  info: "border-pos-info/30 bg-pos-info/10 text-pos-info",
  success: "border-pos-success/30 bg-pos-success/10 text-pos-success",
};

/** O'zgarmas tugmalar (qolganlari — Sozlamalar → Qaynoq tugmalar). */
const FIXED_HOTKEYS: [string, string][] = [
  ["↑ ↓", "Qator tanlash"],
  ["← →", "Kategoriya tanlash (tablar ustida)"],
  ["+ / −", "Miqdorni oshirish / kamaytirish"],
  ["Delete", "Qatorni o'chirish"],
];

type MenuTone = "primary" | "warning" | "info" | "success" | "danger" | "neutral";

/** Menyu qatori ikonkasi: fon va rang — semantik tokenlar (har mavzuda o'qiladi). */
const MENU_TONES: Record<MenuTone, { box: string; icon: string }> = {
  primary: { box: "bg-primary/10", icon: "text-primary" },
  warning: { box: "bg-pos-warning/15", icon: "text-pos-warning" },
  info: { box: "bg-pos-info/15", icon: "text-pos-info" },
  success: { box: "bg-pos-success/15", icon: "text-pos-success" },
  danger: { box: "bg-pos-danger/10", icon: "text-pos-danger" },
  neutral: { box: "bg-muted", icon: "text-foreground" },
};

/** Savat qatoridagi −/+ tugmalari: zichlikka qarab kattalashadi (sensorli ekranda ≥ 44 px). */
const STEP_BUTTON = "flex size-[calc(var(--pos-tap-size)-0.5rem)] shrink-0 items-center justify-center text-foreground hover:bg-muted disabled:opacity-40";

function MenuRow({
  icon: Icon,
  label,
  tone = "neutral",
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
      {badge ? <span className="rounded-full bg-pos-warning px-1.5 text-xs font-semibold tabular-nums text-pos-warning-foreground">{badge}</span> : null}
      {shortcut && <Kbd className="h-6 min-w-8 rounded-md border border-border bg-background px-1.5">{shortcut}</Kbd>}
    </DropdownMenuItem>
  );
}

function MenuGroupLabel({ children }: { children: string }) {
  return <DropdownMenuLabel className="px-2 pt-2.5 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{children}</DropdownMenuLabel>;
}

function SummaryCell({ label, value, tone = "" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="@container min-w-0 rounded-(--radius) border border-border bg-background/60 px-2 py-1 text-center">
      <dt className="text-[10.5px] font-semibold tracking-wide text-muted-foreground uppercase">{label}</dt>
      <dd className={`truncate text-sm font-extrabold tabular-nums @[8rem]:text-base ${tone}`}>{value}</dd>
    </div>
  );
}

const cartInput = (cart: CartLine[]): CartLineInput[] =>
  cart.map((line) => ({ productId: line.productId, unitId: line.unitId, quantity: line.quantity, ...(line.priceOverride ? { unitPrice: line.priceOverride } : {}) }));

/**
 * Kassa (POS): chapda — bo'limlar paneli, o'rtada — mahsulot qidiruvi, kategoriyalar va kartalar (skaner ham), o'ngda — savat,
 * doim ko'rinadigan jami va to'lov. Yuqori panel: kompaniya/kassa, smena, sinxron, printer, tarozi, kassir, soat. Hisob main
 * jarayondagi bilan bir xil (`computeSale`) — ekranda ko'rilgan summa aynan chekka yoziladi. Ekran boshqa bo'limga o'tganda
 * yashiriladi (o'chirilmaydi): savat, joriy sotuv va to'lov holati saqlanadi; yashirin paytda tugma va skaner tinglanmaydi.
 */
export default function PosScreen({
  active,
  status,
  appPrefs,
  onPrefs,
  onStatus,
  onExit,
  onNavigate,
}: {
  active: boolean;
  status: AppStatus;
  appPrefs: DevicePrefs | null;
  onPrefs: (prefs: DevicePrefs) => void;
  onStatus: (status: AppStatus) => void;
  onExit: () => void;
  onNavigate: (view: View) => void;
}) {
  const [context, setContext] = useState<PosContext | null>(null);
  const [prefs, setPrefs] = useState<DevicePrefs | null>(appPrefs);
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
  /** Saqlangan to'lov qismlari ("Saqlash" bosilganda qo'shiladi); bir nechtasi — aralash to'lov. Bo'sh — tez yakunlash. */
  const [parts, setParts] = useState<SavedPart[]>([]);
  /** Summa oynasi ochiq bo'lgan to'lov tugmasi. */
  const [payPart, setPayPart] = useState<PayPart | null>(null);
  /** "Qarzga": pul olinmaydi, chek summasi mijoz qarziga yoziladi. */
  const [creditOnly, setCreditOnly] = useState(false);
  /** Tanlangan karta terminali (summa kiritilmagan tez yakunlashda karta shu terminalga). */
  const [cardTerminal, setCardTerminal] = useState<string | null>(null);
  /** Tanlangan bank hisobi (Moliya bo'limida "Kassada ko'rsatish" belgilanganlardan). */
  const [bankChoice, setBankChoice] = useState<string | null>(null);
  const [useBalance, setUseBalance] = useState(false);
  const [balanceInput, setBalanceInput] = useState("");
  const [useCashback, setUseCashback] = useState(false);
  const [cashbackInput, setCashbackInput] = useState("");
  const [changeToBalance, setChangeToBalance] = useState(false);
  const [foreignTender, setForeignTender] = useState<Record<string, string>>({});
  const [foreignMethod, setForeignMethod] = useState<Record<string, "cash" | "card">>({});
  const [dialog, setDialog] = useState<DialogName | null>(null);
  const [receipt, setReceipt] = useState<LocalSale | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const [openingCash, setOpeningCash] = useState("");
  /** Oxirgi qo'shilgan qator — qisqa yoritiladi (qo'shildi signali). */
  const [flash, setFlash] = useState<{ key: string; at: number } | null>(null);
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

  // Sozlamalar boshqa bo'limda o'zgartirilgan (mavzu, printer, to'lov usullari) — kassa ekrani ham yangisini ishlatadi
  const [prefsSource, setPrefsSource] = useState(appPrefs);
  if (appPrefs !== prefsSource) {
    setPrefsSource(appPrefs);
    if (appPrefs) setPrefs(appPrefs);
  }

  // Kassaga qaytganda qidiruvga fokus (skaner va klaviatura darhol ishlaydi)
  useEffect(() => {
    if (active && !dialog) searchRef.current?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- faqat ko'rinish o'zgarganda
  }, [active]);

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
  // Karta — serverdan sinxronlangan terminallar bo'lsa har terminal alohida qism (pul terminal bog'langan bank hisobiga)
  const terminals = context?.terminals ?? [];
  const bankAccounts = context?.bankAccounts ?? [];
  // Tanlanmagan bo'lsa — umumiy Karta/Bank (asosiy bank hisobi); karta turi yoki bank hisobi faqat aniq tanlanganda
  const activeTerminalId = terminals.find((terminal) => terminal.id === cardTerminal)?.id ?? null;
  const activeBankId = bankAccounts.find((account) => account.id === bankChoice)?.id ?? null;
  const payParts = (method: PayKey): PayPart[] => {
    const generic: PayPart = { key: method, method, terminalId: null, cashAccountId: null, label: PAY_METHODS.find((item) => item.key === method)!.label };
    if (method === "card") {
      return [
        generic,
        ...terminals.map((terminal) => ({ key: `card:${terminal.id}`, method, terminalId: terminal.id, cashAccountId: null, label: terminalLabel(terminal, terminals) })),
      ];
    }
    if (method === "bank") {
      return [generic, ...bankAccounts.map((account) => ({ key: `bank:${account.id}`, method, terminalId: null, cashAccountId: account.id, label: account.name }))];
    }
    return [generic];
  };
  const partKey = (method: PayKey) =>
    method === "card" && activeTerminalId ? `card:${activeTerminalId}` : method === "bank" && activeBankId ? `bank:${activeBankId}` : method;
  const quickMethod: PayKey = payMethod === "transfer" ? "bank" : payMethod;
  /** Kassadagi to'lov tugmalari: aniq karta turlari (UZCARD, HUMO) yoki bank hisoblari bo'lsa umumiy tugma ko'rsatilmaydi. */
  const payButtons: PayPart[] = enabledMethods.flatMap((method) => {
    const list = payParts(method.key);
    return list.length > 1 ? list.slice(1) : list;
  });
  const paymentsFrom = (list: SavedPart[]): { method: PayKey; amount: string | null; terminalId?: string; cashAccountId?: string }[] => {
    if (creditOnly) return [{ method: "cash", amount: "0" }];
    if (list.length === 0) {
      return [
        {
          method: quickMethod,
          amount: null,
          ...(quickMethod === "card" && activeTerminalId ? { terminalId: activeTerminalId } : {}),
          ...(quickMethod === "bank" && activeBankId ? { cashAccountId: activeBankId } : {}),
        },
      ];
    }
    return list.map((part) => ({
      method: part.method,
      amount: part.amount,
      ...(part.terminalId ? { terminalId: part.terminalId } : {}),
      ...(part.cashAccountId ? { cashAccountId: part.cashAccountId } : {}),
    }));
  };
  const paymentsInput = paymentsFrom(parts);

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

  /** Sozlamani saqlash va butun ilovaga qo'llash (mavzu darhol almashadi — qayta yuklash va savat yo'qolishisiz). */
  const savePrefs = (patch: Partial<DevicePrefs>) => {
    if (!prefs) return;
    call("device:save-prefs", { ...prefs, ...patch }).then(
      (saved) => {
        setPrefs(saved);
        onPrefs(saved);
      },
      (err: unknown) => setNotice({ tone: "error", text: errorText(err) }),
    );
  };

  const resetCart = () => {
    setCart([]);
    setSelected(0);
    setCustomer(null);
    setPayMethod(prefs?.defaultPaymentMethod ?? "cash");
    setParts([]);
    setCreditOnly(false);
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
          imageVersion: product.imageVersion,
        },
      ]);
      setSelected(cart.length);
    }
    // Ketma-ket hisoblagich (vaqt emas): har qo'shilganda yangi kalit — animatsiya qayta ishga tushadi
    setFlash((current) => ({ key: `${product.id}:${product.baseUnitId}`, at: (current?.at ?? 0) + 1 }));
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

  const dueMinor = calc?.due ?? 0n;
  const paidMinor = parts.reduce((sum, part) => sum + toMinor(part.amount), 0n);
  const remainingMinor = dueMinor > paidMinor ? dueMinor - paidMinor : 0n;

  /** Karta/bank qismi chek summasidan oshmasin (server ham shunday tekshiradi); naqdda chegara yo'q — ortig'i qaytim. */
  const maxForPart = (part: PayPart): bigint | null => {
    if (part.method === "cash") return null;
    const others = parts.reduce((sum, item) => sum + (item.method !== "cash" && item.key !== part.key ? toMinor(item.amount) : 0n), 0n);
    const max = dueMinor - others;
    return max > 0n ? max : 0n;
  };

  /** Usul tugmasi bosildi — summa oynasi ochiladi (taklif: qolgan summa). */
  const openPayPart = (part: PayPart) => {
    if (cart.length === 0) {
      setNotice({ tone: "error", text: "Savatcha bo'sh" });
      return;
    }
    setCreditOnly(false);
    setPayMethod(part.method);
    if (part.method === "card") setCardTerminal(part.terminalId);
    if (part.method === "bank") setBankChoice(part.cashAccountId);
    setPayPart(part);
  };

  /** "Saqlash": qism qo'shiladi; bir xil tugma qayta saqlansa summasi qo'shiladi (server takror qismni qabul qilmaydi). */
  const withPart = (list: SavedPart[], part: PayPart, amount: string): SavedPart[] => {
    const existing = list.find((item) => item.key === part.key);
    if (existing) return list.map((item) => (item.key === part.key ? { ...item, amount: trimDecimal(fromMinor(toMinor(item.amount) + toMinor(amount))) } : item));
    return [...list, { ...part, amount }];
  };

  const complete = async (list: SavedPart[] = parts) => {
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
        payments: paymentsFrom(list),
        cashbackAmount: useCashback ? cashbackInput.trim() : null,
        balanceAmount: useBalance ? balanceInput.trim() : null,
        changeToBalance,
        currencyPayments: foreignInput,
      });
      resetCart();
      setReceipt(sale);
      setNotice({ tone: "success", text: `Sotuv yakunlandi: chek ${sale.number} · ${fmtMoney(sale.total, base)}` });
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
      setNotice({ tone: "info", text: `Chek kechiktirildi — ${hotkeys.held} bilan qaytarasiz` });
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
      return product && product.price !== null ? [{ ...line, listPrice: product.price, stock: product.stock, imageVersion: product.imageVersion }] : [];
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
    savePrefs({ productView });
  };

  const handleKey = (event: KeyboardEvent) => {
    if (!active || dialog || receipt || detail) return;
    const pickMethod = (method: PayKey) => {
      if (!enabledMethods.some((item) => item.key === method)) return;
      const list = payParts(method);
      openPayPart(list.find((item) => item.key === partKey(method)) ?? list[0]!);
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
  const actions = useRef({ active, handleKey, addProduct, addScanned, addByCode });
  useEffect(() => {
    actions.current = { active, handleKey, addProduct, addScanned, addByCode };
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => actions.current.handleKey(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);
  // Kassa yashirin (boshqa bo'lim yoki blok) — skaner kodi savatga tushmaydi
  const onScan = useCallback((code: string) => {
    if (actions.current.active) void actions.current.addByCode(code);
  }, []);
  useHIDScanner({ onScan, minLength: 3 });

  const unsyncedCount = status.sync.pending + status.sync.rejected;
  const shiftTotals = status.shift?.totals;
  const errors = calc?.errors.filter((error) => error !== "Savatcha bo'sh") ?? [];
  const productView = prefs?.productView ?? "cards";
  /** To'lov paneli tomoni — biznes egasi web'da tanlaydi (Sozlamalar → Kassa qurilmalari → Kassa ko'rinishi). */
  const panelLeft = prefs?.paymentPanelSide === "left";
  const shownProducts = showQuick ? (quick?.products ?? []) : products;
  const discountPercent = num(customer?.discountPercent ?? "0");
  const cartQty = new Map<string, number>();
  for (const line of cart) cartQty.set(line.productId, (cartQty.get(line.productId) ?? 0) + num(line.quantity));
  const cashierName = status.cashier?.name ?? status.cashier?.phone ?? "";
  const themeChoices: PosThemeChoice[] = prefs?.customTheme ? [...POS_THEMES, CUSTOM_POS_THEME] : [...POS_THEMES];
  const themeLocked = !prefs || prefs.themeLock !== null;
  const itemsCount = cart.length;
  const paymentEntered = parts.length > 0 || (!!calc && calc.cashbackUsed + calc.balanceUsed > 0n);

  const menu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" className="h-(--pos-tap-size) gap-2 px-3">
          <Menu className="size-4" />
          Menyu
          {unsyncedCount > 0 && <span className="rounded-full bg-pos-warning px-1.5 text-xs font-semibold text-pos-warning-foreground">{unsyncedCount}</span>}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={6} className="max-h-[calc(100vh-5rem)] w-[22rem] overflow-y-auto rounded-xl p-2 shadow-xl">
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
          tone={unsyncedCount > 0 ? "warning" : "info"}
          label="Sinxron bo'lmagan cheklar"
          badge={unsyncedCount}
          shortcut={hotkeys.unsynced}
          onSelect={() => setDialog("unsynced")}
        />
        <MenuRow icon={Undo2} tone="danger" label="Mahsulotni qaytarish" shortcut={hotkeys.return} onSelect={() => setDialog("return")} />
        <MenuRow icon={Clock} tone="primary" label="Kechiktirilgan cheklar" shortcut={hotkeys.held} onSelect={() => setDialog("held")} />

        <DropdownMenuSeparator className="my-1.5" />
        <MenuGroupLabel>Kassa</MenuGroupLabel>
        <MenuRow icon={Banknote} tone="success" label="Pul qutisini ochish" onSelect={() => void openDrawer()} />
        <MenuRow icon={LockKeyhole} tone="warning" label="Smenani yopish" disabled={!status.shift} onSelect={() => setDialog("shift")} />
        <MenuRow icon={Printer} label="Printer va pul qutisi" onSelect={() => setDialog("prefs")} />
        <MenuRow icon={Keyboard} label="Tugmalar" shortcut={hotkeys.help} onSelect={() => setDialog("help")} />

        <DropdownMenuSeparator className="my-1.5" />
        <MenuGroupLabel>Ko'rinish</MenuGroupLabel>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger disabled={themeLocked} className="gap-3 rounded-lg px-2 py-1.5">
            <span className={`flex size-8 shrink-0 items-center justify-center rounded-md ${MENU_TONES.primary.box}`}>
              <Palette className={`size-4 ${MENU_TONES.primary.icon}`} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">Mavzu</span>
              <span className="block truncate text-xs text-muted-foreground">
                {prefs ? `${THEME_ICONS[prefs.theme]} ${THEME_LABELS[prefs.theme]}${prefs.themeLock !== null ? " · kompaniya qulflagan" : ""}` : "…"}
              </span>
            </span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-h-[70vh] w-60 overflow-y-auto rounded-xl p-1.5">
            <DropdownMenuRadioGroup value={prefs?.theme ?? ""} onValueChange={(value) => savePrefs({ theme: value as PosThemeChoice })}>
              {themeChoices.map((theme) => (
                <DropdownMenuRadioItem key={theme} value={theme} className="rounded-lg py-2" onSelect={(event) => event.preventDefault()}>
                  <span aria-hidden className="w-5 text-center">
                    {THEME_ICONS[theme]}
                  </span>
                  {THEME_LABELS[theme]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <MenuRow icon={SlidersHorizontal} label="Ko'rinish sozlamalari" onSelect={() => onNavigate("settings")} />

        <DropdownMenuSeparator className="my-1.5" />
        <DropdownMenuItem className="gap-3 rounded-lg px-2 py-2" onSelect={() => void call("cashier:logout").then(onStatus)}>
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
            {cashierName.trim().charAt(0).toUpperCase() || "?"}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{cashierName}</span>
            <span className="block text-xs text-muted-foreground">Kassirni almashtirish</span>
          </span>
          <LogOut className="size-4 text-muted-foreground" />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const header = (
    <header className="pos-glass flex min-w-0 items-center gap-3 border-b border-border bg-pos-topbar px-3 py-2 text-pos-topbar-foreground">
      {menu}
      <div className="min-w-0 leading-tight">
        <p className="truncate text-sm font-bold">{status.company?.name}</p>
        <p className="truncate text-xs opacity-75">
          Kassa {status.device?.code} · {status.device?.warehouseName}
        </p>
      </div>
      <div className="hidden min-w-0 items-center gap-1.5 border-l border-current/15 pl-3 text-xs lg:flex">
        {status.shift ? (
          <span className="truncate">
            <span className="font-semibold">Smena ochiq</span>
            {shiftTotals && (
              <span className="opacity-75">
                {" "}
                · {shiftTotals.receipts} chek · {fmtMoney(shiftTotals.sales, base)}
              </span>
            )}
          </span>
        ) : (
          <span className="font-semibold text-pos-warning">Smena yopiq</span>
        )}
      </div>
      <div className="ml-auto flex min-w-0 items-center gap-2">
        <PosStatusBar
          sync={status.sync}
          unsynced={unsyncedCount}
          printerName={prefs?.printerName ?? null}
          canViewScales={permissions.includes("scale.view")}
          onSyncClick={() => setDialog("unsynced")}
        />
        <span className="hidden items-center gap-2 border-l border-current/15 pl-2 text-sm font-medium 2xl:flex" title="Kassir">
          <UserRound className="size-4 opacity-75" />
          <span className="max-w-40 truncate">{cashierName}</span>
        </span>
      </div>
    </header>
  );

  const dialogs = (
    <>
      {payPart && (
        <PaymentAmountDialog
          title={payPart.label}
          isCash={payPart.method === "cash"}
          suggested={(() => {
            const max = maxForPart(payPart);
            return max === null || remainingMinor < max ? remainingMinor : max;
          })()}
          remaining={remainingMinor}
          max={maxForPart(payPart)}
          currency={base}
          busy={busy}
          onClose={() => setPayPart(null)}
          onSave={(amount) => {
            setParts((current) => withPart(current, payPart, amount));
            setPayPart(null);
          }}
          onFinish={(amount) => {
            const next = withPart(parts, payPart, amount);
            setParts(next);
            setPayPart(null);
            void complete(next);
          }}
        />
      )}
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
      <PrefsDialog
        open={dialog === "prefs"}
        context={context}
        cashierName={status.cashier?.name ?? null}
        onClose={() => setDialog(null)}
        onSaved={(saved) => {
          setPrefs(saved);
          onPrefs(saved);
        }}
      />
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

  const noticeBar = notice && (
    <p role={notice.tone === "error" ? "alert" : "status"} className={`pos-rise flex items-start gap-2 rounded-(--radius) border px-3 py-2 text-sm font-medium ${NOTICE_TONES[notice.tone]}`}>
      <span className="min-w-0 flex-1">{notice.text}</span>
      <button type="button" aria-label="Yopish" className="-m-1 rounded p-1 opacity-70 hover:opacity-100" onClick={() => setNotice(null)}>
        <X className="size-4" />
      </button>
    </p>
  );

  const shell = (content: ReactNode) => (
    <main className="flex h-full min-h-0 text-foreground">
      <PosSidebar
        permissions={permissions}
        activeTab={tab}
        onTab={(next) => {
          if (next !== tab) switchTab(next);
          setQuery("");
          searchRef.current?.focus();
        }}
        onNavigate={(view) => (view === "home" ? onExit() : onNavigate(view))}
      />
      <div className="grid min-w-0 flex-1 grid-rows-[auto_minmax(0,1fr)]">
        {header}
        {content}
      </div>
      {dialogs}
    </main>
  );

  if (!status.shift) {
    return shell(
      <div className="flex items-center justify-center overflow-y-auto p-6">
        <form
          className="w-full max-w-sm space-y-3 rounded-2xl border border-border bg-card p-6 shadow-pos"
          onSubmit={(event) => {
            event.preventDefault();
            void openShift();
          }}
        >
          <h1 className="text-xl font-bold">Smena yopiq</h1>
          <p className="text-sm text-muted-foreground">Sotuvni boshlash uchun kassadagi boshlang'ich naqdni kiriting.</p>
          <Input
            id="opening-cash"
            autoFocus
            inputMode="decimal"
            className="h-(--pos-tap-size) text-lg"
            placeholder="0"
            value={openingCash}
            onChange={(e) => setOpeningCash(decimalInput(e.target.value))}
          />
          <Button type="submit" className="h-(--pos-tap-size) w-full bg-pos-action text-base font-bold text-pos-action-foreground hover:bg-pos-action-hover" disabled={busy}>
            Smenani ochish
          </Button>
          {notice && <p className="text-sm text-pos-danger">{notice.text}</p>}
        </form>
      </div>,
    );
  }

  const productGridColumns = showQuick
    ? "grid-cols-[repeat(auto-fill,minmax(min(100%,var(--pos-quick-card-size)),1fr))]"
    : "grid-cols-[repeat(auto-fill,minmax(min(100%,var(--pos-card-size)),1fr))]";

  return shell(
    <div className={`grid min-h-0 ${panelLeft ? "grid-cols-[clamp(21.5rem,33vw,30rem)_minmax(0,1fr)]" : "grid-cols-[minmax(0,1fr)_clamp(21.5rem,33vw,30rem)]"}`}>
      {/* Mahsulotlar */}
      <section className={`flex min-h-0 flex-col gap-(--pos-gap) p-3 ${panelLeft ? "order-2" : ""}`}>
        <div className="flex flex-wrap items-center gap-2">
          <form
            className="relative min-w-60 flex-1"
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
            <Search className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={searchRef}
              id="pos-search"
              autoFocus
              className="h-(--pos-tap-size) bg-card pl-10 text-base shadow-pos"
              placeholder={`Nomi, SKU yoki shtrix-kod (${hotkeys.search})`}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setLimit(PAGE);
              }}
            />
          </form>
          {/* Chekni avtomatik chop etish — kassir shu yerdan yoqadi/o'chiradi (Sozlamalarga kirmasdan) */}
          <button
            type="button"
            data-testid="auto-print-toggle"
            aria-pressed={prefs?.autoPrint ?? false}
            title={prefs?.autoPrint ? "Chek avtomatik chiqadi" : "Chek avtomatik chiqmaydi"}
            disabled={!prefs}
            onClick={() => {
              if (!prefs) return;
              const next = { ...prefs, autoPrint: !prefs.autoPrint };
              setPrefs(next);
              void call("device:save-prefs", next).then(onPrefs, () => setPrefs(prefs));
            }}
            className={`pos-motion flex h-(--pos-tap-size) items-center gap-1.5 rounded-(--radius) border px-3 text-sm font-semibold whitespace-nowrap shadow-pos ${
              prefs?.autoPrint
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-card text-muted-foreground hover:bg-muted"
            }`}
          >
            <Printer className="h-4 w-4" />
            Avto chek: {prefs?.autoPrint ? "yoqiq" : "o'chiq"}
          </button>
          <div className="flex h-(--pos-tap-size) rounded-(--radius) border border-border bg-card p-1 shadow-pos" role="tablist" aria-label="Mahsulotlar">
            {(["quick", "all"] as const).map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                className={`pos-motion rounded-[calc(var(--radius)-0.25rem)] px-3 text-sm font-semibold whitespace-nowrap transition-colors ${
                  tab === key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
                onClick={() => switchTab(key)}
              >
                {key === "quick" ? `Tezkor sotuv${quick?.configured ? ` · ${quick.products.length}` : ""}` : "Barcha mahsulotlar"}
              </button>
            ))}
          </div>
          <div className="flex h-(--pos-tap-size) rounded-(--radius) border border-border bg-card p-1 shadow-pos" aria-label="Ko'rinish">
            {(
              [
                ["cards", LayoutGrid, "Kartalar"],
                ["table", Rows3, "Jadval"],
              ] as const
            ).map(([key, Icon, label]) => (
              <button
                key={key}
                type="button"
                aria-pressed={productView === key}
                title={label}
                aria-label={label}
                className={`flex aspect-square items-center justify-center rounded-[calc(var(--radius)-0.25rem)] ${productView === key ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                onClick={() => setProductView(key)}
              >
                <Icon className="size-4" />
              </button>
            ))}
          </div>
        </div>
        {query.trim() !== "" && tab === "quick" && <p className="-mt-1 text-xs text-muted-foreground">Qidiruv — barcha mahsulotlar bo'yicha</p>}
        <CategoryChips categories={showQuick ? (quick?.categories ?? []) : categories} active={categoryId} onPick={pickCategory} />
        <div className={`min-h-0 flex-1 overflow-y-auto ${productView === "table" ? "rounded-(--radius) border border-border bg-card" : "-mx-1 px-1 pt-1"}`}>
          {showQuick && quick && !quick.configured ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
              <p className="max-w-md text-sm text-muted-foreground">
                Tezkor sotuv assortimenti hali tanlanmagan. Rahbar web'da tanlaydi: Sozlamalar → Kassa qurilmalari → Tezkor sotuv (eng ko'p sotilganlar tavsiyasi
                bilan).
              </p>
              <Button variant="secondary" onClick={() => switchTab("all")}>
                Barcha mahsulotlar
              </Button>
            </div>
          ) : productView === "cards" ? (
            <div className={`grid gap-(--pos-gap) pb-2 ${productGridColumns}`}>
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
              <thead className="sticky top-0 z-10 bg-muted text-left text-xs text-muted-foreground">
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
                  const min = num(product.minStock);
                  return (
                    <tr
                      key={product.id}
                      tabIndex={0}
                      className="cursor-pointer border-t border-border hover:bg-pos-selected focus-visible:bg-pos-selected"
                      onClick={() => void addFromList(product)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          void addFromList(product);
                        }
                      }}
                    >
                      <td className="px-3 py-1.5 font-medium">
                        <span className="flex items-center gap-2">
                          <ProductImage product={product} className="h-10 w-10 shrink-0 rounded-md text-xs" />
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
                          <span className="text-pos-danger">kurs yo'q</span>
                        ) : (
                          <span className={`font-bold ${product.promo ? "text-pos-promotion" : "text-pos-price"}`}>{fmtMoney(product.price, base)}</span>
                        )}
                        {product.promo && product.regularPrice && product.regularPrice !== product.price && (
                          <s className="block text-xs text-muted-foreground">{fmtMoney(product.regularPrice, base)}</s>
                        )}
                        {product.salesCurrency && product.salesCurrency !== base && (
                          <span className="block text-xs text-muted-foreground">{fmtMoney(product.salesPrice, product.salesCurrency)}</span>
                        )}
                      </td>
                      <td
                        className={`px-3 py-1.5 text-right font-medium tabular-nums ${stock <= 0 ? "text-pos-stock-out" : min > 0 && stock <= min ? "text-pos-stock-low" : "text-pos-stock-ok"}`}
                      >
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
        {noticeBar}
      </section>

      {/* Savat va to'lov */}
      <aside className={`pos-glass flex min-h-0 flex-col border-border bg-pos-cart ${panelLeft ? "order-1 border-r" : "border-l"}`} aria-label="Savat">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          {customer ? (
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/12 text-primary">
                <UserRound className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <button type="button" className="block max-w-full truncate text-left text-sm font-semibold" onClick={() => setDialog("customer")}>
                  {customer.name}
                </button>
                <p className="truncate text-xs text-muted-foreground">
                  {num(customer.totalDebt) > 0 && <span className="font-medium text-pos-warning">qarz {fmtMoney(customer.totalDebt, base)} · </span>}
                  balans {fmtMoney(customer.balance, base)}
                  {context?.cashback?.enabled && <> · keshbek {fmtMoney(customer.cashbackBalance, base)}</>}
                  {discountPercent > 0 && <span className="font-medium text-pos-success"> · chegirma {discountPercent}%</span>}
                </p>
              </div>
              <Button size="icon" variant="ghost" aria-label="Mijozni olib tashlash" onClick={() => setCustomer(null)}>
                <X className="size-4" />
              </Button>
            </div>
          ) : (
            <Button variant="secondary" className="h-(--pos-tap-size) min-w-0 flex-1 justify-start gap-2" onClick={() => setDialog("customer")}>
              <UserRound className="size-4" />
              Mijoz tanlash
              <Kbd className="ml-auto">{hotkeys.customer}</Kbd>
            </Button>
          )}
          <Button variant="ghost" className="h-(--pos-tap-size) gap-1.5 px-2.5" disabled={cart.length === 0} onClick={() => void hold()} title="Chekni kechiktirish">
            <Clock className="size-4" />
            <span className="hidden xl:inline">Kechiktirish</span>
            <Kbd>{hotkeys.hold}</Kbd>
          </Button>
        </div>

        <div className="flex items-center justify-between px-3 pt-2 pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          <span>Savat</span>
          <span className="tabular-nums">{itemsCount > 0 ? `${itemsCount} ta mahsulot` : ""}</span>
        </div>
        <ul className="min-h-[5.5rem] flex-1 divide-y divide-border overflow-y-auto">
          {cart.map((line, index) => {
            const lineCalc = calc?.lines[index];
            const short = QTY.test(line.quantity) && toMinor(line.stock, 4) < toMinor(line.quantity, 4);
            const key = `${line.productId}:${line.unitId}`;
            return (
              <li
                key={flash?.key === key ? `${key}:${flash.at}` : key}
                aria-selected={index === selected}
                className={`px-3 py-2 ${index === selected ? "bg-pos-selected" : ""} ${flash?.key === key && index !== selected ? "pos-flash" : ""}`}
                onClick={() => setSelected(index)}
              >
                {/* 1-qator: rasm, nom, qator summasi; 2-qator (to'liq kenglik — katta shrift va sensorli rejimda ham sig'adi): miqdor, narx, o'chirish */}
                <div className="flex items-start gap-2.5">
                  <ProductImage product={{ id: line.productId, name: line.name, imageVersion: line.imageVersion }} className="size-10 shrink-0 rounded-md text-xs" />
                  <p className="line-clamp-2 min-w-0 flex-1 text-sm font-semibold leading-snug">{line.name}</p>
                  <span className="shrink-0 text-base font-extrabold tabular-nums">
                    {lineCalc ? fmtMoney(fromMinor(lineCalc.currencyTotal), lineCalc.currency) : "—"}
                  </span>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                  <div className="flex items-center overflow-hidden rounded-(--radius) border border-border bg-background">
                    <button type="button" aria-label="Kamaytirish" className={STEP_BUTTON} onClick={() => changeQty(index, -1n)}>
                      <Minus className="size-4" />
                    </button>
                    <Input
                      id={`cart-qty-${index}`}
                      aria-label="Miqdor"
                      className="h-[calc(var(--pos-tap-size)-0.5rem)] w-14 rounded-none border-0 border-x border-border bg-transparent px-1 text-center text-base font-bold shadow-none"
                      inputMode="decimal"
                      value={line.quantity}
                      onChange={(e) => setLine(index, { quantity: decimalInput(e.target.value, 4) })}
                    />
                    <button type="button" aria-label="Ko'paytirish" className={STEP_BUTTON} onClick={() => changeQty(index, 1n)}>
                      <Plus className="size-4" />
                    </button>
                  </div>
                  <span className="text-xs text-muted-foreground">{line.unitName} ×</span>
                  {canEditPrice ? (
                    <Input
                      id={`cart-price-${index}`}
                      aria-label="Narx"
                      className="h-[calc(var(--pos-tap-size)-0.5rem)] w-24 text-right tabular-nums"
                      inputMode="decimal"
                      value={line.priceOverride ?? trimDecimal(line.listPrice)}
                      onChange={(e) => {
                        const value = decimalInput(e.target.value, 4);
                        setLine(index, { priceOverride: value === trimDecimal(line.listPrice) ? null : value });
                      }}
                    />
                  ) : (
                    <span className="text-sm tabular-nums">{fmtMoney(line.listPrice, base)}</span>
                  )}
                  <button
                    type="button"
                    aria-label={`${line.name} — savatdan o'chirish`}
                    className="ml-auto flex size-[calc(var(--pos-tap-size)-0.5rem)] items-center justify-center rounded-(--radius) text-muted-foreground hover:bg-pos-danger/10 hover:text-pos-danger"
                    onClick={(event) => {
                      event.stopPropagation();
                      removeLine(index);
                    }}
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
                {lineCalc && lineCalc.discount > 0n && <p className="mt-0.5 text-xs font-medium text-pos-success">Chegirma −{fmtMoney(fromMinor(lineCalc.discount), base)}</p>}
                {short && <p className="mt-0.5 text-xs font-medium text-pos-warning">Qoldiq {fmtQty(line.stock)} — sotuv yoziladi, rahbar ko'radi</p>}
              </li>
            );
          })}
          {cart.length === 0 && (
            <li className="flex flex-col items-center gap-2 px-3 py-10 text-center text-sm text-muted-foreground">
              <ShoppingCart className="size-8 opacity-50" />
              Savat bo'sh — mahsulotni skanerlang yoki tanlang
            </li>
          )}
        </ul>

        {/* Jami — doim ko'rinadi (savat qatorlari o'z joyida aylantiriladi) */}
        <div className="border-t border-border bg-pos-total px-3 py-2 text-pos-total-foreground">
          {calc && !currencyMode && (
            <dl className="space-y-0.5 text-sm">
              {calc.discount > 0n && (
                <>
                  <div className="flex justify-between opacity-80">
                    <dt>Mahsulotlar</dt>
                    <dd className="tabular-nums">{fmtMoney(fromMinor(calc.total + calc.discount), base)}</dd>
                  </div>
                  <div className="flex justify-between font-medium">
                    <dt>Chegirma</dt>
                    <dd className="tabular-nums">−{fmtMoney(fromMinor(calc.discount), base)}</dd>
                  </div>
                </>
              )}
              {calc.tax > 0n && (
                <div className="flex justify-between opacity-80">
                  <dt>shu jumladan QQS</dt>
                  <dd className="tabular-nums">{fmtMoney(fromMinor(calc.tax), base)}</dd>
                </div>
              )}
            </dl>
          )}
          {calc && currencyMode ? (
            calc.buckets.map((bucket) => (
              <div key={bucket.currency} className="flex items-baseline justify-between gap-2 text-xl font-extrabold">
                <span className="text-sm font-bold tracking-wide uppercase">Jami ({bucket.currency})</span>
                <span className="tabular-nums">{fmtMoney(fromMinor(bucket.total), bucket.currency)}</span>
              </div>
            ))
          ) : (
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-base font-bold tracking-wide uppercase">Jami</span>
              <span className="text-[1.75rem] leading-tight font-extrabold tabular-nums [@media(max-height:820px)]:text-2xl" data-testid="pos-total">
                {fmtMoney(calc ? fromMinor(calc.total) : "0", base)}
              </span>
            </div>
          )}
        </div>

        {/* To'lov — kichik ekranda (768 px) o'z joyida aylantiriladi, yakunlash tugmasi doim ko'rinadi */}
        <div className="max-h-[38vh] min-h-0 shrink space-y-2 overflow-y-auto px-3 pt-2">
          {customer && calc && (
            <div className="flex flex-wrap items-center gap-1.5">
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
          {calc && (calc.cashbackUsed > 0n || calc.balanceUsed > 0n) && (
            <dl className="space-y-0.5 text-sm">
              {calc.cashbackUsed > 0n && (
                <div className="flex justify-between font-medium text-pos-promotion">
                  <dt>Keshbekdan</dt>
                  <dd className="tabular-nums">−{fmtMoney(fromMinor(calc.cashbackUsed), base)}</dd>
                </div>
              )}
              {calc.balanceUsed > 0n && (
                <div className="flex justify-between font-medium text-pos-success">
                  <dt>Balansdan</dt>
                  <dd className="tabular-nums">−{fmtMoney(fromMinor(calc.balanceUsed), base)}</dd>
                </div>
              )}
            </dl>
          )}

          {(!calc || calc.hasBaseBucket) && (
            <div className="space-y-1.5">
              {/* Usul tugmasi → summa oynasi → "Saqlash" (qism qo'shiladi) yoki "Yakunlash" (chek yopiladi) */}
              <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${Math.min(Math.max(payButtons.length, 1), 3)}, minmax(0, 1fr))` }}>
                {payButtons.map((part) => {
                  const saved = parts.find((item) => item.key === part.key);
                  const method = PAY_METHODS.find((item) => item.key === part.method)!;
                  return (
                    <button
                      key={part.key}
                      type="button"
                      disabled={cart.length === 0}
                      title={part.label}
                      aria-label={`${part.label} to'lovi`}
                      className={`pos-motion @container flex h-(--pos-tap-size) min-w-0 items-center justify-center gap-1.5 rounded-(--radius) border px-2 text-sm font-semibold disabled:opacity-50 ${
                        saved ? "border-primary bg-pos-selected ring-1 ring-primary" : "border-border bg-background/60 hover:bg-muted"
                      }`}
                      onClick={() => openPayPart(part)}
                    >
                      <span className={`size-2 shrink-0 rounded-full ${method.dot}`} aria-hidden />
                      <span className="truncate">{part.label}</span>
                      {saved ? (
                        <span className="shrink-0 text-xs font-bold tabular-nums">{fmtMoney(saved.amount, base)}</span>
                      ) : (
                        <span className="hidden text-[10px] font-medium text-muted-foreground @[9rem]:inline">{hotkeys[method.action]}</span>
                      )}
                    </button>
                  );
                })}
              </div>

              {parts.length > 0 && (
                <ul className="space-y-1 rounded-(--radius) border border-border bg-background/60 p-1.5 text-sm">
                  {parts.map((part) => (
                    <li key={part.key} className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate">{part.label}</span>
                      <span className="font-bold tabular-nums">{fmtMoney(part.amount, base)}</span>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7"
                        aria-label={`${part.label} qismini olib tashlash`}
                        onClick={() => setParts((current) => current.filter((item) => item.key !== part.key))}
                      >
                        <X className="size-4 text-pos-danger" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}

              {/* Taqsimot va TO'LANADI / TO'LANGAN / QOLDIQ */}
              {calc && paymentEntered && <PaymentProgress calc={calc} base={base} terminals={terminals} bankAccounts={bankAccounts} />}
              {calc && (
                <dl className="grid grid-cols-3 gap-1.5">
                  <SummaryCell label="To'lanadi" value={fmtMoney(fromMinor(calc.due), base)} />
                  <SummaryCell label="To'langan" value={fmtMoney(fromMinor(calc.paid), base)} />
                  <SummaryCell
                    label="Qoldiq"
                    value={fmtMoney(fromMinor(calc.due > calc.paid ? calc.due - calc.paid : 0n), base)}
                    tone={calc.due > calc.paid ? "text-pos-danger" : "text-pos-success"}
                  />
                </dl>
              )}
              {customer && calc && calc.due > 0n && (
                <Button
                  size="sm"
                  variant={creditOnly ? "default" : "ghost"}
                  className={creditOnly ? "w-full" : "w-full text-pos-warning"}
                  onClick={() => {
                    setParts([]);
                    setCreditOnly((value) => !value);
                  }}
                >
                  Qarzga (mijoz hisobiga)
                </Button>
              )}
            </div>
          )}

          {calc?.foreign.map((part) => (
            <div key={part.currency} className="flex items-center gap-1.5">
              <span className="w-12 text-sm font-semibold">{part.currency}</span>
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
                className="h-9 min-w-0 text-right"
                inputMode="decimal"
                placeholder={trimDecimal(fromMinor(part.due))}
                value={foreignTender[part.currency] ?? ""}
                onChange={(e) => setForeignTender((current) => ({ ...current, [part.currency]: decimalInput(e.target.value) }))}
              />
              {part.change > 0n && <span className="whitespace-nowrap text-xs font-medium text-pos-success">qaytim {fmtMoney(fromMinor(part.change), part.currency)}</span>}
            </div>
          ))}

          {calc && calc.change > 0n && (
            <div className="flex items-center justify-between gap-2 rounded-(--radius) border border-pos-success/30 bg-pos-success/10 px-3 py-2 font-bold text-pos-success">
              <span>{calc.changeKept > 0n ? "Qaytim balansga" : "Qaytim"}</span>
              <span className="text-lg tabular-nums">{fmtMoney(fromMinor(calc.change), base)}</span>
              {customer && (
                <Button size="sm" variant="ghost" className="h-7" onClick={() => setChangeToBalance((value) => !value)}>
                  {changeToBalance ? "Qaytimni berish" : "Balansga"}
                </Button>
              )}
            </div>
          )}
          {calc && calc.debt > 0n && customer && (
            <p className="rounded-(--radius) border border-pos-warning/30 bg-pos-warning/10 px-3 py-2 text-sm font-semibold text-pos-warning">
              Qarzga yoziladi: {fmtMoney(fromMinor(calc.debt), base)}
            </p>
          )}
        </div>

        <div className="space-y-1.5 border-t border-border p-3">
          {errors.map((error) => (
            <p key={error} role="alert" className="text-sm font-medium text-pos-danger">
              {error}
            </p>
          ))}
          {!linesValid && cart.length > 0 && (
            <p role="alert" className="text-sm font-medium text-pos-danger">
              Miqdor yoki narxni tekshiring
            </p>
          )}
          <Button
            className="pos-motion h-[calc(var(--pos-tap-size)+1.25rem)] w-full [@media(max-height:820px)]:h-[calc(var(--pos-tap-size)+0.5rem)] gap-3 bg-pos-action text-lg font-extrabold tracking-wide text-pos-action-foreground uppercase shadow-pos hover:bg-pos-action-hover"
            disabled={busy || cart.length === 0 || !calc || errors.length > 0}
            onClick={() => void complete()}
          >
            {calc && calc.debt > 0n ? "Qarzga yakunlash" : "Savdoni yakunlash"}
            <Kbd className="bg-pos-action-foreground/15 text-pos-action-foreground">{hotkeys.complete}</Kbd>
          </Button>
        </div>
      </aside>
    </div>,
  );
}
