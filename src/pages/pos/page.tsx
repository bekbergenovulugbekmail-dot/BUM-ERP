import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { toast } from "sonner";
import { motion, AnimatePresence } from "motion/react";
import {
  ShoppingCart, Search, Trash2, Plus, Minus, CreditCard, Banknote,
  Smartphone, X, ChevronRight, Printer, RotateCcw, Power,
  Package, Calculator, User, BarChart3, ScanLine,
} from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { cn } from "@/lib/utils.ts";
import type { Id } from "@/convex/_generated/dataModel.d.ts";
import ShiftOpenDialog from "./_components/shift-open-dialog.tsx";
import ShiftCloseDialog from "./_components/shift-close-dialog.tsx";
import POSReceipt from "./_components/pos-receipt.tsx";
import BarcodeScanner from "@/components/barcode-scanner.tsx";
import { useHIDScanner } from "@/hooks/use-hid-scanner.ts";

type CartItem = {
  productId: Id<"products">;
  unitId: Id<"units">;
  name: string;
  sku: string;
  qty: number;
  unitPrice: number;
  taxRate: number;
  discountPercent: number;
  stock: number;
};

type PaymentMethod = "cash" | "card" | "bank" | "transfer";

const PAY_METHODS: { key: PaymentMethod; label: string; icon: React.ElementType; color: string }[] = [
  { key: "cash", label: "Naqd", icon: Banknote, color: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30" },
  { key: "card", label: "Karta", icon: CreditCard, color: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30" },
  { key: "bank", label: "Bank", icon: Smartphone, color: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/30" },
];

const fmt = (n: number) => new Intl.NumberFormat("uz-UZ").format(Math.round(n));

export default function POSPage() {
  const warehouses = useQuery(api.warehouse.warehouses.list, {});
  const defaultWh = warehouses?.find((w) => w.isDefault) ?? warehouses?.[0];
  const whId = defaultWh?._id;

  const shift = useQuery(
    api.sales.pos.getOpenShift,
    whId ? { warehouseId: whId } : "skip"
  );

  const products = useQuery(
    api.products.products.list,
    { paginationOpts: { cursor: null, numItems: 300 } }
  );

  const stockData = useQuery(
    api.warehouse.stock.getWarehouseStock,
    whId ? { warehouseId: whId } : "skip"
  );

  const completeSale = useMutation(api.sales.pos.completePOSSale);

  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [payMethod, setPayMethod] = useState<PaymentMethod>("cash");
  const [amountPaid, setAmountPaid] = useState("");
  const [showOpenShift, setShowOpenShift] = useState(false);
  const [showCloseShift, setShowCloseShift] = useState(false);
  const [lastReceipt, setLastReceipt] = useState<{ orderId: Id<"salesOrders">; change: number; total: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  // HID scanner support (USB/Bluetooth barcode scanners)
  const handleBarcodeScan = useCallback((barcode: string) => {
    const allProducts = products?.page ?? [];
    const found = allProducts.find(
      (p) => p.isActive && p.isSaleable && (p.barcode === barcode || p.sku === barcode)
    );
    if (found) {
      addToCart(found);
      toast.success(`${found.name} savatchaga qo'shildi`);
    } else {
      // Fall back to setting it as search
      setSearch(barcode);
      toast.info(`"${barcode}" qidirilmoqda...`);
    }
  }, [products]);

  const stockMap = new Map(
    (stockData ?? []).map((s: { productId: string; quantity: number }) => [s.productId, s.quantity])
  );

  const filtered = (products?.page ?? []).filter((p) =>
    p.isActive && p.isSaleable &&
    (!search ||
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.sku.toLowerCase().includes(search.toLowerCase()) ||
      p.barcode?.includes(search))
  ).slice(0, 50);

  const subtotal = cart.reduce((s, i) => s + i.qty * i.unitPrice * (1 - i.discountPercent / 100), 0);
  const taxTotal = cart.reduce((s, i) => {
    const net = i.qty * i.unitPrice * (1 - i.discountPercent / 100);
    return s + net * (i.taxRate / 100);
  }, 0);
  const total = subtotal + taxTotal;
  const paid = parseFloat(amountPaid) || 0;
  const change = Math.max(0, paid - total);

  const addToCart = (p: typeof filtered[0]) => {
    const stock = stockMap.get(p._id) ?? 0;
    if (stock <= 0) { toast.error("Omborda mavjud emas"); return; }
    setCart((prev) => {
      const idx = prev.findIndex((i) => i.productId === p._id);
      if (idx >= 0) {
        const next = [...prev];
        const item = next[idx];
        if (item.qty >= item.stock) { toast.error("Omborda yetarli emas"); return prev; }
        next[idx] = { ...item, qty: item.qty + 1 };
        return next;
      }
      return [...prev, {
        productId: p._id,
        unitId: p.baseUnitId,
        name: p.name,
        sku: p.sku,
        qty: 1,
        unitPrice: p.salesPrice,
        taxRate: p.taxRate,
        discountPercent: 0,
        stock,
      }];
    });
  };

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
    onScan: handleBarcodeScan,
    minLength: 3,
  });

  const handleCheckout = useCallback(async () => {
    if (!shift || !whId) { toast.error("Avval smena oching (F4)"); return; }
    if (!cart.length) { toast.error("Savatcha bo'sh"); return; }
    if (paid < total) { toast.error("To'lov summasi yetarli emas"); return; }

    setLoading(true);
    try {
      const result = await completeSale({
        shiftId: shift._id,
        warehouseId: whId,
        items: cart.map((i) => ({
          productId: i.productId,
          unitId: i.unitId,
          qty: i.qty,
          unitPrice: i.unitPrice,
          taxRate: i.taxRate,
          discountPercent: i.discountPercent,
        })),
        paymentMethod: payMethod,
        amountPaid: paid,
      });
      setLastReceipt({ orderId: result.orderId, change: result.change, total });
      setCart([]);
      setAmountPaid("");
      toast.success(`Sotuv amalga oshirildi! Qaytim: ${fmt(result.change)} so'm`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Xatolik");
    } finally { setLoading(false); }
  }, [shift, whId, cart, paid, total, payMethod, completeSale]);

  // Keyboard shortcuts — placed after handleCheckout so the dep reference is defined
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F2") { e.preventDefault(); searchRef.current?.focus(); }
      if (e.key === "F12" && cart.length > 0) { e.preventDefault(); handleCheckout(); }
      if (e.key === "Escape") { setCart([]); setAmountPaid(""); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cart.length, handleCheckout]);

  if (!warehouses) {
    return <div className="h-screen flex items-center justify-center"><Skeleton className="h-32 w-64 rounded-2xl" /></div>;
  }

  if (!shift && shift !== undefined) {
    return (
      <div className="h-screen flex flex-col items-center justify-center gap-6 bg-background">
        <div className="text-center space-y-2">
          <div className="h-20 w-20 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
            <Power className="h-10 w-10 text-primary" />
          </div>
          <h2 className="text-2xl font-bold">POS Kassasi</h2>
          <p className="text-muted-foreground">Smena ochilmagan. Kassaga kirish uchun smena oching.</p>
        </div>
        <Button size="lg" onClick={() => setShowOpenShift(true)}>
          Smena ochish
        </Button>
        {showOpenShift && whId && (
          <ShiftOpenDialog warehouseId={whId} onClose={() => setShowOpenShift(false)} />
        )}
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
              Smena: #{shift._id.slice(-6)} · {fmt(shift.totalSales)} so'm
            </span>
          )}
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => setShowCloseShift(true)}>
              <Power className="h-3.5 w-3.5 mr-1" /> Smena yopish
            </Button>
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
                const stock = stockMap.get(p._id) ?? 0;
                const inCart = cart.find((c) => c.productId === p._id);
                return (
                  <motion.button
                    key={p._id}
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
                    <p className="text-sm font-bold mt-1 text-primary">{fmt(p.salesPrice)} so'm</p>
                    <p className="text-[11px] text-muted-foreground">Qoldi: {fmt(stock)}</p>
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
                      <p className="text-[11px] text-muted-foreground">{fmt(item.unitPrice)} so'm</p>
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
                        {fmt(item.qty * item.unitPrice * (1 - item.discountPercent / 100))} so'm
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
              <span>Jami</span><span>{fmt(subtotal)} so'm</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>QQS</span><span>{fmt(taxTotal)} so'm</span>
            </div>
            <div className="flex justify-between font-bold text-lg pt-1 border-t border-border">
              <span>To'lov</span>
              <span className="text-primary">{fmt(total)} so'm</span>
            </div>
          </div>

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

          {/* Amount paid */}
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Berilgan summa</label>
            <Input
              type="number"
              className="text-right text-lg font-bold h-11"
              placeholder={String(Math.ceil(total))}
              value={amountPaid}
              onChange={(e) => setAmountPaid(e.target.value)}
            />
            {paid > 0 && paid >= total && (
              <div className="flex justify-between text-sm text-emerald-600 dark:text-emerald-400 font-semibold">
                <span>Qaytim</span>
                <span>{fmt(change)} so'm</span>
              </div>
            )}
          </div>

          {/* Checkout button */}
          <Button
            className="w-full h-12 text-base font-bold"
            onClick={handleCheckout}
            disabled={loading || !cart.length || paid < total}
          >
            {loading ? "Qayta ishlanmoqda..." : (
              <span className="flex items-center gap-2">
                <CreditCard className="h-5 w-5" />
                To'lash (F12)
              </span>
            )}
          </Button>
        </div>
      </div>

      {/* Modals */}
      {showCloseShift && shift && (
        <ShiftCloseDialog shift={shift} onClose={() => setShowCloseShift(false)} />
      )}
      {lastReceipt && (
        <POSReceipt
          orderId={lastReceipt.orderId}
          change={lastReceipt.change}
          total={lastReceipt.total}
          payMethod={payMethod}
          onClose={() => setLastReceipt(null)}
        />
      )}
      {showScanner && (
        <BarcodeScanner
          title="POS — Mahsulot skanerlash"
          hint="Barkod yoki QR kodni skanerlang — mahsulot savatchaga qo'shiladi"
          onScan={(code) => {
            handleBarcodeScan(code);
          }}
          onClose={() => setShowScanner(false)}
        />
      )}
    </div>
  );
}
