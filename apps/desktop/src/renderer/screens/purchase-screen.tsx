import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { useHIDScanner } from "@/hooks/use-hid-scanner.ts";
import type { AppStatus, LocalPurchase, PosContext, PosSupplier, PurchaseProduct } from "../../shared/kassa-api.js";
import { computeLine, fromMinor, rescale, toMinor } from "../../shared/money.js";
import { decimalInput, fmtMoney, fmtQty, fmtTime, num, trimDecimal } from "../format.ts";
import { call, errorText } from "../kassa.ts";
import PurchaseReturnDialog from "../purchase/purchase-return-dialog.tsx";
import SupplierDialog from "../purchase/supplier-dialog.tsx";
import SupplierPaymentDialog from "../purchase/supplier-payment-dialog.tsx";

type Line = {
  key: string;
  productId: string;
  name: string;
  sku: string;
  unitId: string;
  unitName: string;
  quantity: string;
  unitPrice: string;
  currency: string | null;
  salesPrice: string;
  currentSalesPrice: string;
  batchNumber: string;
  expiryDate: string;
  trackBatch: boolean;
  trackExpiry: boolean;
  stock: string;
};

const QTY = /^\d{1,14}(\.\d{1,4})?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const STATE_TEXT: Record<string, { text: string; tone: string }> = {
  pending: { text: "navbatda", tone: "text-amber-600" },
  rejected: { text: "rad etildi", tone: "text-destructive" },
  applied: { text: "serverda", tone: "text-emerald-600" },
  discarded: { text: "bekor qilingan", tone: "text-muted-foreground" },
};

/**
 * Xarid (kassada): ta'minotchi, mahsulotlar (skaner ham), miqdor va ta'minotchi narxi (valyutada ham), yangi sotuv narxi,
 * partiya/yaroqlilik; darhol to'lov — smena naqdidan yoki kartadan. Internet bo'lmasa ham — sinxronda serverga.
 */
export default function PurchaseScreen({ status, onStatus, onExit }: { status: AppStatus; onStatus: (status: AppStatus) => void; onExit: () => void }) {
  const [context, setContext] = useState<PosContext | null>(null);
  const [supplier, setSupplier] = useState<PosSupplier | null>(null);
  const [query, setQuery] = useState("");
  const [products, setProducts] = useState<PurchaseProduct[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [payNow, setPayNow] = useState(false);
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState<"cash" | "card">("cash");
  const [notes, setNotes] = useState("");
  const [purchases, setPurchases] = useState<LocalPurchase[]>([]);
  const [dialog, setDialog] = useState<"supplier" | "return" | "payment" | null>(null);
  const [notice, setNotice] = useState<{ tone: "error" | "info"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const lastSyncAt = status.sync.lastSyncAt;

  useEffect(() => {
    call("pos:context").then(setContext, (err: unknown) => setNotice({ tone: "error", text: errorText(err) }));
  }, [lastSyncAt]);

  const permissions = context?.permissions ?? status.cashier?.permissions ?? [];
  const canPurchase = permissions.includes("purchase.create") && permissions.includes("warehouse.receive");

  useEffect(() => {
    if (!canPurchase) return;
    const timer = setTimeout(
      () => {
        call("purchase:products", { query }).then(setProducts, (err: unknown) => setNotice({ tone: "error", text: errorText(err) }));
      },
      query ? 150 : 0,
    );
    return () => clearTimeout(timer);
  }, [query, version, lastSyncAt, canPurchase]);

  useEffect(() => {
    if (!canPurchase) return;
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    call("purchase:list", { from: start.toISOString(), limit: 200 }).then(setPurchases, (err: unknown) => setNotice({ tone: "error", text: errorText(err) }));
  }, [version, lastSyncAt, canPurchase]);

  const base = context?.baseCurrency ?? status.company?.currency ?? "UZS";
  const rates: Record<string, string> = {};
  for (const currency of context?.currencies ?? []) rates[currency.code] = currency.rate;

  const addProduct = (product: PurchaseProduct) => {
    const index = lines.findIndex((line) => line.productId === product.id && line.unitId === product.baseUnitId);
    if (index >= 0) {
      const line = lines[index]!;
      const current = QTY.test(line.quantity) ? toMinor(line.quantity, 4) : 0n;
      setLines(lines.map((item, i) => (i === index ? { ...item, quantity: trimDecimal(fromMinor(current + 10_000n, 4)) } : item)));
    } else {
      const currency = product.purchaseCurrency && product.purchaseCurrency !== base && rates[product.purchaseCurrency] ? product.purchaseCurrency : null;
      setLines([
        ...lines,
        {
          key: `${product.id}:${product.baseUnitId}`,
          productId: product.id,
          name: product.name,
          sku: product.sku,
          unitId: product.baseUnitId,
          unitName: product.unitName,
          quantity: "1",
          unitPrice: trimDecimal(product.purchasePrice || "0"),
          currency,
          salesPrice: "",
          currentSalesPrice: product.price ?? product.salesPrice,
          batchNumber: "",
          expiryDate: "",
          trackBatch: product.trackBatch,
          trackExpiry: product.trackExpiry,
          stock: product.stock,
        },
      ]);
    }
    setNotice(null);
  };

  const addByCode = async (code: string) => {
    try {
      const product = await call("purchase:product-by-code", { code });
      if (product) {
        actions.current.addProduct(product);
        return true;
      }
      setNotice({ tone: "error", text: `"${code}" — mahsulot topilmadi` });
    } catch (err) {
      setNotice({ tone: "error", text: errorText(err) });
    }
    return false;
  };

  const actions = useRef({ addProduct, addByCode });
  useEffect(() => {
    actions.current = { addProduct, addByCode };
  });
  const onScan = useCallback((code: string) => void actions.current.addByCode(code), []);
  useHIDScanner({ onScan, minLength: 3 });

  const setLine = (index: number, patch: Partial<Line>) => setLines((current) => current.map((line, i) => (i === index ? { ...line, ...patch } : line)));

  // Qator summasi o'z valyutasida (soliqsiz ta'minotchi narxi), asosiy valyutada — joriy kurs bilan (qurilma ham shu)
  const totals = new Map<string, bigint>();
  let baseTotal = 0n;
  let valid = lines.length > 0;
  const lineTotals: (bigint | null)[] = [];
  for (const line of lines) {
    if (!QTY.test(line.quantity) || toMinor(line.quantity, 4) <= 0n || !QTY.test(line.unitPrice)) {
      valid = false;
      lineTotals.push(null);
      continue;
    }
    if ((line.trackBatch && !line.batchNumber.trim()) || (line.trackExpiry && !DATE.test(line.expiryDate)) || (line.salesPrice && !QTY.test(line.salesPrice))) valid = false;
    const amount = computeLine({ quantity: line.quantity, unitPrice: line.unitPrice }).lineTotal;
    const code = line.currency ?? base;
    totals.set(code, (totals.get(code) ?? 0n) + amount);
    baseTotal += line.currency && rates[line.currency] ? rescale(amount * toMinor(rates[line.currency]!, 4), 6, 2) : amount;
    lineTotals.push(amount);
  }
  const baseBucket = totals.get(base) ?? 0n;

  const complete = async () => {
    if (!supplier || !valid || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const purchase = await call("purchase:complete", {
        supplierId: supplier.id,
        lines: lines.map((line) => ({
          productId: line.productId,
          unitId: line.unitId,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          currency: line.currency,
          salesPrice: line.salesPrice || null,
          batchNumber: line.batchNumber.trim() || null,
          expiryDate: line.expiryDate || null,
        })),
        notes: notes.trim() || null,
        payment: payNow ? { amount: payAmount || fromMinor(baseBucket), method: payMethod } : null,
      });
      setLines([]);
      setSupplier(null);
      setPayNow(false);
      setPayAmount("");
      setNotes("");
      setNotice({ tone: "info", text: `Xarid ${purchase.number} yozildi — ${fmtMoney(purchase.total, base)}` });
      setVersion((value) => value + 1);
      call("app:status").then(onStatus, () => undefined);
    } catch (err) {
      setNotice({ tone: "error", text: errorText(err) });
    } finally {
      setBusy(false);
    }
  };

  const header = (
    <header className="flex flex-wrap items-center gap-3 border-b border-border bg-card px-4 py-2">
      <Button size="sm" variant="secondary" onClick={onExit}>
        ← Bosh sahifa
      </Button>
      <h1 className="font-semibold">Xarid</h1>
      <span className="text-sm text-muted-foreground">
        {status.device?.code} · {status.device?.warehouseName}
      </span>
      <div className="ml-auto flex gap-2">
        <Button size="sm" variant="secondary" onClick={() => setDialog("return")}>
          Ta'minotchiga qaytarish
        </Button>
        <Button size="sm" variant="secondary" disabled={!permissions.includes("purchase.approve") || !status.shift} onClick={() => setDialog("payment")}>
          Ta'minotchiga to'lov
        </Button>
      </div>
    </header>
  );

  if (context && !canPurchase) {
    return (
      <main className="flex h-full flex-col bg-muted/40">
        {header}
        <p className="m-6 rounded-lg bg-amber-500/10 px-4 py-3 text-amber-700">Xarid uchun ruxsat kerak: purchase.create va warehouse.receive — rahbar kassir sifatida kirsin.</p>
      </main>
    );
  }

  return (
    <main className="grid h-full grid-rows-[auto_1fr] bg-muted/40">
      {header}
      <div className="grid min-h-0 grid-cols-[minmax(0,420px)_minmax(0,1fr)] gap-3 p-3">
        <section className="flex min-h-0 flex-col gap-2">
          <form
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
            <Input ref={searchRef} id="purchase-search" autoFocus className="h-10" placeholder="Mahsulot, SKU yoki shtrix-kod" value={query} onChange={(e) => setQuery(e.target.value)} />
          </form>
          <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto rounded-xl border border-border bg-card">
            {products.map((product) => (
              <li key={product.id}>
                <button type="button" className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-primary/5" onClick={() => addProduct(product)}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{product.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {product.sku} · qoldiq {fmtQty(product.stock)} {product.unitName}
                    </span>
                  </span>
                  <span className="text-right text-xs tabular-nums">
                    <span className="block">{fmtMoney(product.purchasePrice, product.purchaseCurrency ?? base)}</span>
                    <span className="block text-muted-foreground">sotuv {fmtMoney(product.price ?? product.salesPrice, base)}</span>
                  </span>
                </button>
              </li>
            ))}
            {products.length === 0 && <li className="px-3 py-8 text-center text-sm text-muted-foreground">Mahsulot topilmadi</li>}
          </ul>

          <div className="max-h-48 overflow-y-auto rounded-xl border border-border bg-card">
            <p className="border-b border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground">Bugungi xaridlar</p>
            <ul className="divide-y divide-border text-sm">
              {purchases.map((purchase) => (
                <li key={purchase.id} className="flex items-center gap-2 px-3 py-1.5">
                  <span className="font-medium">{purchase.number}</span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">
                    {fmtTime(purchase.createdAt)} · {purchase.supplier.name}
                  </span>
                  <span className="tabular-nums">{fmtMoney(purchase.total, base)}</span>
                  <span className={`text-xs ${STATE_TEXT[purchase.sync.state]?.tone ?? ""}`}>{STATE_TEXT[purchase.sync.state]?.text}</span>
                </li>
              ))}
              {purchases.length === 0 && <li className="px-3 py-3 text-center text-xs text-muted-foreground">Bugun xarid yo'q</li>}
            </ul>
          </div>
        </section>

        <section className="flex min-h-0 flex-col rounded-xl border border-border bg-card">
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            {supplier ? (
              <>
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setDialog("supplier")}>
                  <span className="block truncate font-semibold">{supplier.name}</span>
                  <span className="text-xs text-muted-foreground">qarzimiz {fmtMoney(supplier.totalDebt, base)}</span>
                </button>
                <Button size="sm" variant="ghost" onClick={() => setSupplier(null)}>
                  ✕
                </Button>
              </>
            ) : (
              <Button variant="secondary" className="flex-1 justify-start" onClick={() => setDialog("supplier")}>
                Ta'minotchi tanlash
              </Button>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/80 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-2 py-2">Mahsulot</th>
                  <th className="px-2 py-2 text-right">Miqdor</th>
                  <th className="px-2 py-2 text-right">Narx</th>
                  <th className="px-2 py-2">Valyuta</th>
                  <th className="px-2 py-2 text-right">Yangi sotuv narxi</th>
                  <th className="px-2 py-2">Partiya / muddat</th>
                  <th className="px-2 py-2 text-right">Summa</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {lines.map((line, index) => (
                  <tr key={line.key} className="border-t border-border align-top">
                    <td className="px-2 py-1.5">
                      <p className="font-medium leading-tight">{line.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {line.sku} · qoldiq {fmtQty(line.stock)}
                      </p>
                    </td>
                    <td className="px-2 py-1.5">
                      <div className="flex items-center justify-end gap-1">
                        <Input
                          id={`purchase-qty-${index}`}
                          className="h-8 w-20 text-right"
                          inputMode="decimal"
                          value={line.quantity}
                          onChange={(e) => setLine(index, { quantity: decimalInput(e.target.value, 4) })}
                        />
                        <span className="text-xs text-muted-foreground">{line.unitName}</span>
                      </div>
                    </td>
                    <td className="px-2 py-1.5">
                      <Input
                        id={`purchase-price-${index}`}
                        className="ml-auto h-8 w-28 text-right"
                        inputMode="decimal"
                        value={line.unitPrice}
                        onChange={(e) => setLine(index, { unitPrice: decimalInput(e.target.value, 4) })}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <select
                        id={`purchase-currency-${index}`}
                        className="h-8 rounded-md border border-input bg-background px-1 text-sm"
                        value={line.currency ?? base}
                        onChange={(e) => setLine(index, { currency: e.target.value === base ? null : e.target.value })}
                      >
                        {[base, ...(context?.currencies ?? []).map((currency) => currency.code)].map((code) => (
                          <option key={code} value={code}>
                            {code}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-1.5">
                      <Input
                        id={`purchase-sales-price-${index}`}
                        className="ml-auto h-8 w-28 text-right"
                        inputMode="decimal"
                        placeholder={trimDecimal(line.currentSalesPrice)}
                        value={line.salesPrice}
                        onChange={(e) => setLine(index, { salesPrice: decimalInput(e.target.value, 4) })}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      {(line.trackBatch || line.trackExpiry) && (
                        <div className="flex flex-col gap-1">
                          {line.trackBatch && (
                            <Input
                              id={`purchase-batch-${index}`}
                              className="h-8 w-32"
                              placeholder="Partiya"
                              value={line.batchNumber}
                              onChange={(e) => setLine(index, { batchNumber: e.target.value })}
                            />
                          )}
                          {line.trackExpiry && (
                            <Input
                              id={`purchase-expiry-${index}`}
                              type="date"
                              className="h-8 w-36"
                              value={line.expiryDate}
                              onChange={(e) => setLine(index, { expiryDate: e.target.value })}
                            />
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right font-semibold tabular-nums">
                      {lineTotals[index] !== null && lineTotals[index] !== undefined ? fmtMoney(fromMinor(lineTotals[index]!), line.currency ?? base) : "—"}
                    </td>
                    <td className="px-2 py-1.5">
                      <button type="button" className="text-muted-foreground hover:text-destructive" onClick={() => setLines((current) => current.filter((_, i) => i !== index))}>
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
                {lines.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-3 py-12 text-center text-muted-foreground">
                      Mahsulotni chapdan tanlang yoki skanerlang
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="space-y-2 border-t border-border p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="text-sm text-muted-foreground">
                {[...totals].map(([code, amount]) => (
                  <span key={code} className="mr-3 tabular-nums">
                    {fmtMoney(fromMinor(amount), code)}
                  </span>
                ))}
              </div>
              <p className="text-2xl font-bold tabular-nums">{fmtMoney(fromMinor(baseTotal), base)}</p>
            </div>
            <Input id="purchase-notes" placeholder="Izoh (faktura raqami va h.k.)" maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant={payNow ? "default" : "secondary"}
                disabled={!permissions.includes("purchase.approve") || !status.shift}
                onClick={() => setPayNow((value) => !value)}
              >
                {payNow ? "Hozir to'lanadi" : "Hozir to'lash"}
              </Button>
              {payNow && (
                <>
                  <Input
                    id="purchase-pay-amount"
                    className="h-9 w-40 text-right"
                    inputMode="decimal"
                    placeholder={trimDecimal(fromMinor(baseBucket))}
                    value={payAmount}
                    onChange={(e) => setPayAmount(decimalInput(e.target.value))}
                  />
                  {(["cash", "card"] as const).map((method) => (
                    <Button key={method} size="sm" variant={payMethod === method ? "default" : "secondary"} onClick={() => setPayMethod(method)}>
                      {method === "cash" ? "Naqd (smenadan)" : "Karta"}
                    </Button>
                  ))}
                </>
              )}
              {!status.shift && <span className="text-xs text-muted-foreground">Darhol to'lov uchun smena ochiq bo'lsin</span>}
            </div>
            {lines.length > 0 && !valid && <p className="text-sm text-destructive">Miqdor, narx, partiya yoki yaroqlilik muddatini tekshiring</p>}
            {notice && (
              <p className={`rounded-lg px-3 py-2 text-sm ${notice.tone === "error" ? "bg-destructive/10 text-destructive" : "bg-emerald-500/10 text-emerald-700"}`}>{notice.text}</p>
            )}
            <Button className="h-12 w-full text-base font-bold" disabled={busy || !supplier || !valid || (payNow && num(payAmount || fromMinor(baseBucket)) <= 0)} onClick={() => void complete()}>
              Xaridni yozish (tovar qabul qilindi)
            </Button>
          </div>
        </section>
      </div>

      <SupplierDialog
        open={dialog === "supplier"}
        baseCurrency={base}
        onClose={() => setDialog(null)}
        onSelect={(picked) => {
          setSupplier(picked);
          setDialog(null);
          searchRef.current?.focus();
        }}
      />
      <PurchaseReturnDialog
        open={dialog === "return"}
        baseCurrency={base}
        canReturn={permissions.includes("purchase.return")}
        hasShift={!!status.shift}
        onClose={() => setDialog(null)}
        onDone={() => {
          setVersion((value) => value + 1);
          call("app:status").then(onStatus, () => undefined);
        }}
      />
      <SupplierPaymentDialog
        open={dialog === "payment"}
        baseCurrency={base}
        onClose={() => setDialog(null)}
        onDone={(payment) => {
          setNotice({ tone: "info", text: `${payment.supplier.name}ga ${fmtMoney(payment.amount, base)} to'landi` });
          call("app:status").then(onStatus, () => undefined);
        }}
      />
    </main>
  );
}
