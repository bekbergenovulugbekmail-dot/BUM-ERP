import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Kbd } from "@/components/ui/kbd.tsx";
import { useHIDScanner } from "@/hooks/use-hid-scanner.ts";
import type { AppStatus, CartLineInput, DevicePrefs, HeldReceipt, LocalSale, PosContext, PosCustomer, PosProduct } from "../../shared/kassa-api.js";
import { fromMinor, toMinor } from "../../shared/money.js";
import { computeSale, type SaleCalc } from "../../shared/sale-calc.js";
import type { PaymentMethod, SyncState } from "../../shared/sync-types.js";
import { decimalInput, fmtMoney, fmtQty, num, trimDecimal } from "../format.ts";
import { call, errorText } from "../kassa.ts";
import CustomerDialog from "../pos/customer-dialog.tsx";
import HeldDialog from "../pos/held-dialog.tsx";
import PrefsDialog from "../pos/prefs-dialog.tsx";
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

const PAY_METHODS: { key: PaymentMethod; label: string; hotkey: string }[] = [
  { key: "cash", label: "Naqd", hotkey: "F9" },
  { key: "card", label: "Karta", hotkey: "F10" },
  { key: "bank", label: "Bank", hotkey: "F11" },
];

const SYNC_LABEL: Record<SyncState, { text: string; tone: string }> = {
  idle: { text: "Sinxron", tone: "bg-emerald-500" },
  syncing: { text: "Sinxron…", tone: "bg-sky-500 animate-pulse" },
  offline: { text: "Offline", tone: "bg-amber-500" },
  unauthorized: { text: "Qurilma o'chirilgan", tone: "bg-destructive" },
  error: { text: "Sinxron xatosi", tone: "bg-destructive" },
};

const HOTKEYS: [string, string][] = [
  ["F1", "Tugmalar ro'yxati"],
  ["F2", "Mahsulot qidirish / shtrix-kod"],
  ["F3", "Tanlangan qator miqdori"],
  ["F4", "Mijoz tanlash"],
  ["F5", "Chekni kechiktirish"],
  ["F6", "Kechiktirilgan cheklar"],
  ["F7", "Mahsulotni qaytarish"],
  ["F8", "Sinxron bo'lmagan cheklar"],
  ["F9 / F10 / F11", "Naqd / Karta / Bank"],
  ["F12", "Chekni yakunlash"],
  ["↑ ↓", "Qator tanlash"],
  ["+ / −", "Miqdorni oshirish / kamaytirish"],
  ["Delete", "Qatorni o'chirish"],
];

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
  const [cart, setCart] = useState<CartLine[]>([]);
  const [selected, setSelected] = useState(0);
  const [customer, setCustomer] = useState<PosCustomer | null>(null);
  const [saleCurrencies, setSaleCurrencies] = useState<string[]>([]);
  const [payMethod, setPayMethod] = useState<PaymentMethod>("cash");
  const [amountPaid, setAmountPaid] = useState("");
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
  const lastSyncAt = status.sync.lastSyncAt;

  useEffect(() => {
    Promise.all([call("pos:context"), call("device:prefs")]).then(
      ([loaded, devicePrefs]) => {
        setContext(loaded);
        setPrefs(devicePrefs);
      },
      (err: unknown) => setNotice({ tone: "error", text: errorText(err) }),
    );
  }, [lastSyncAt]);

  useEffect(() => {
    const timer = setTimeout(
      () => {
        call("pos:products", { query, limit: 80 }).then(setProducts, (err: unknown) => setNotice({ tone: "error", text: errorText(err) }));
      },
      query ? 150 : 0,
    );
    return () => clearTimeout(timer);
  }, [query, productsVersion, lastSyncAt]);

  const base = context?.baseCurrency ?? status.company?.currency ?? "UZS";
  const permissions = context?.permissions ?? status.cashier?.permissions ?? [];
  const canEditPrice = permissions.includes("sales.edit");
  const activeCurrencies = saleCurrencies.length > 0 ? saleCurrencies : [base];
  const foreignInput = activeCurrencies
    .filter((code) => code !== base)
    .map((code) => ({ currency: code, amount: foreignTender[code]?.trim() ? foreignTender[code]! : null, method: foreignMethod[code] ?? ("cash" as const) }));

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
        amountPaid: payMethod === "cash" && amountPaid.trim() !== "" ? amountPaid.trim() : null,
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
    setPayMethod("cash");
    setAmountPaid("");
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

  const addByCode = async (code: string) => {
    try {
      const product = await call("pos:product-by-code", { code });
      if (product) {
        setReceipt(null);
        actions.current.addProduct(product);
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
        amountPaid: payMethod === "cash" && amountPaid.trim() !== "" ? amountPaid.trim() : null,
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
      if (prefs?.openDrawerOnCash && sale.paymentMethod === "cash" && (prefs.drawer.mode === "tcp" || prefs.drawer.mode === "share")) {
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

  const handleKey = (event: KeyboardEvent) => {
    if (dialog || receipt) return;
    const keys: Record<string, () => void> = {
      F1: () => setDialog("help"),
      F2: () => searchRef.current?.focus(),
      F3: () => document.getElementById(`cart-qty-${selected}`)?.focus(),
      F4: () => setDialog("customer"),
      F5: () => void hold(),
      F6: () => setDialog("held"),
      F7: () => setDialog("return"),
      F8: () => setDialog("unsynced"),
      F9: () => setPayMethod("cash"),
      F10: () => setPayMethod("card"),
      F11: () => setPayMethod("bank"),
      F12: () => void complete(),
    };
    const action = keys[event.key];
    if (action) {
      event.preventDefault();
      action();
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
  const actions = useRef({ handleKey, addProduct, addByCode });
  useEffect(() => {
    actions.current = { handleKey, addProduct, addByCode };
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

  const header = (
    <header className="flex items-center gap-3 border-b border-border bg-card px-3 py-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" size="sm" className="gap-2">
            ☰ Menyu
            {unsyncedCount > 0 && <span className="rounded-full bg-amber-500 px-1.5 text-xs text-white">{unsyncedCount}</span>}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-80">
          <DropdownMenuLabel>
            Ombor: {status.device?.warehouseName}
            <span className="block text-xs font-normal text-muted-foreground">
              Kassa {status.device?.code} · {status.device?.name}
            </span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-xs text-muted-foreground">Sotuv valyutasi</DropdownMenuLabel>
          {[base, ...(context?.currencies ?? []).map((currency) => currency.code)].map((code) => (
            <DropdownMenuCheckboxItem
              key={code}
              checked={activeCurrencies.includes(code)}
              onSelect={(event) => event.preventDefault()}
              onCheckedChange={() => toggleCurrency(code)}
            >
              {code}
              {code !== base && (
                <span className="ml-auto text-xs text-muted-foreground">{fmtMoney(context?.currencies.find((currency) => currency.code === code)?.rate, base)}</span>
              )}
            </DropdownMenuCheckboxItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setDialog("unsynced")}>
            Sinxron bo'lmagan cheklar {unsyncedCount > 0 ? `(${unsyncedCount})` : ""}
            <DropdownMenuShortcut>F8</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setDialog("return")}>
            Mahsulotni qaytarish
            <DropdownMenuShortcut>F7</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setDialog("held")}>
            Kechiktirilgan cheklar
            <DropdownMenuShortcut>F6</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void openDrawer()}>Pul qutisini ochish</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={!status.shift} onSelect={() => setDialog("shift")}>
            Smenani yopish
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setDialog("prefs")}>Printer va pul qutisi</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setDialog("help")}>
            Tugmalar
            <DropdownMenuShortcut>F1</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => onNavigate("history")}>Sotuv tarixi</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onNavigate("kassa")}>Kassa: kirim-chiqim, X/Z-hisobot</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onNavigate("purchase")}>Xarid: ta'minotchidan tovar</DropdownMenuItem>
          <DropdownMenuItem onSelect={onExit}>Bosh sahifa</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void call("cashier:logout").then(onStatus)}>Kassirni almashtirish</DropdownMenuItem>
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
            {HOTKEYS.map(([key, label]) => (
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
              onChange={(e) => setQuery(e.target.value)}
            />
          </form>
          <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-border bg-card">
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
                {products.map((product) => {
                  const stock = num(product.stock);
                  return (
                    <tr key={product.id} className="cursor-pointer border-t border-border hover:bg-primary/5" onClick={() => addProduct(product)}>
                      <td className="px-3 py-2 font-medium">{product.name}</td>
                      <td className="px-3 py-2 text-muted-foreground">{product.sku}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {product.price === null ? <span className="text-destructive">kurs yo'q</span> : fmtMoney(product.price, base)}
                        {product.salesCurrency && product.salesCurrency !== base && (
                          <span className="block text-xs text-muted-foreground">{fmtMoney(product.salesPrice, product.salesCurrency)}</span>
                        )}
                      </td>
                      <td className={`px-3 py-2 text-right tabular-nums ${stock < 0 ? "text-destructive" : stock === 0 ? "text-amber-600" : ""}`}>
                        {fmtQty(product.stock)} {product.unitName}
                      </td>
                    </tr>
                  );
                })}
                {products.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-10 text-center text-muted-foreground">
                      Mahsulot topilmadi
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
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
              <>
                <div className="grid grid-cols-3 gap-1">
                  {PAY_METHODS.map((method) => (
                    <Button key={method.key} variant={payMethod === method.key ? "default" : "secondary"} onClick={() => setPayMethod(method.key)}>
                      {method.label} <span className="ml-1 text-xs opacity-70">{method.hotkey}</span>
                    </Button>
                  ))}
                </div>
                {payMethod === "cash" && (
                  <div className="flex items-center gap-2">
                    <Input
                      id="pay-amount"
                      className="h-11 text-right text-lg font-semibold"
                      inputMode="decimal"
                      placeholder={calc ? trimDecimal(fromMinor(calc.due)) : "Berilgan summa"}
                      value={amountPaid}
                      onChange={(e) => setAmountPaid(decimalInput(e.target.value))}
                    />
                    {customer && calc && calc.due > 0n && (
                      <Button size="sm" variant="ghost" className="text-amber-600" onClick={() => setAmountPaid("0")}>
                        Qarzga
                      </Button>
                    )}
                  </div>
                )}
              </>
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
                {customer && payMethod === "cash" && (
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
