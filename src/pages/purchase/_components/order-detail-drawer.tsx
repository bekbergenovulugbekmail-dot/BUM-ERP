import { useState } from "react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "motion/react";
import {
  X, CheckCircle, Truck, CreditCard,
  Ban, ChevronDown, ChevronUp, FileDown, Tag, Zap,
} from "lucide-react";
import LabelPrintDialog from "@/components/label-print-dialog.tsx";
import { toLabelProduct, type LabelItem } from "@/lib/print/label-html.ts";
import type { ProductListItem } from "@/pages/products/_lib/types.ts";
import { formatMoney, useCurrencies } from "@/hooks/use-currencies.ts";
import { BankCommissionHint } from "@/components/payments/bank-commission-hint.tsx";
import { generatePurchaseOrderPDF } from "@/lib/pdf/purchase-order-pdf.ts";
import { Button } from "@/components/ui/button.tsx";
import { Separator } from "@/components/ui/separator.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { cn } from "@/lib/utils.ts";
import { api, errorMessage } from "@/lib/api.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";
import { useActiveCompany, usePermissions } from "@/hooks/use-company.ts";
import {
  PAYMENT_LABELS, newReference, num, todayLocal,
  type PaymentMethod, type PurchaseOrderDetail,
} from "../_lib/types.ts";

type Props = {
  orderId: string;
  onClose: () => void;
};

type ReceiveLine = { qty: number; batchNumber: string; expiryDate: string };

type PayAccountOption = {
  id: string;
  name: string;
  type: "cash" | "bank";
  currency: string;
  balance: string;
  isDefault: boolean;
  outgoingCommissionPercent: string;
};

const AUTO_ACCOUNT = "auto";

/** To'lov usuli va valyutasiga mos hisoblar — server tartibida (asosiy birinchi, keyin nomi bo'yicha). */
function payAccountChoices(accounts: PayAccountOption[] | undefined, currency: string, method: PaymentMethod) {
  const type = method === "cash" ? "cash" : "bank";
  return (accounts ?? [])
    .filter((account) => account.currency === currency && account.type === type)
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name));
}

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  confirmed: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400",
  partial: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400",
  received: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400",
  paid: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400",
  cancelled: "bg-destructive/10 text-destructive",
};
const STATUS_LABELS: Record<string, string> = {
  draft: "Qoralama", confirmed: "Tasdiqlangan", partial: "Qisman qabul",
  received: "Qabul qilindi", invoiced: "Hisob-faktura", paid: "To'langan", cancelled: "Bekor",
};

const fmt = (n: number) => new Intl.NumberFormat("uz-UZ").format(Math.round(n)) + " so'm";

export default function OrderDetailDrawer({ orderId, onClose }: Props) {
  const { can } = usePermissions();
  const orderQuery = useApiQuery<{ order: PurchaseOrderDetail }>(`/api/purchase/orders/${orderId}`);
  const order = orderQuery.data?.order;
  const company = useActiveCompany().data?.company;
  const currencies = useCurrencies();

  const confirmOrder = useApiMutation(() => api.post(`/api/purchase/orders/${orderId}/confirm`));
  const cancelOrder = useApiMutation(() => api.post(`/api/purchase/orders/${orderId}/cancel`));
  const receiveGoods = useApiMutation((body: object) =>
    api.post<{ total: string; status: string }>(`/api/purchase/orders/${orderId}/receipts`, body),
  );
  const recordPayment = useApiMutation((body: object) =>
    api.post<{ created: boolean }>("/api/purchase/payments", body),
  );
  // To'g'ridan-to'g'ri yakunlash: tasdiq + qolgan tovarni to'liq qabul + ixtiyoriy to'lov (bitta so'rov)
  const completeOrder = useApiMutation((body: object) =>
    api.post<{ order: PurchaseOrderDetail }>(`/api/purchase/orders/${orderId}/complete`, body),
  );

  const [showReceive, setShowReceive] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const [showComplete, setShowComplete] = useState(false);
  const [completeMethod, setCompleteMethod] = useState<PaymentMethod>("cash");
  const [completeAmount, setCompleteAmount] = useState("");
  const [completeAccount, setCompleteAccount] = useState(AUTO_ACCOUNT);
  /** "Qarzga" — to'lov yozilmaydi, summa ta'minotchi qarziga qoladi. */
  const [completeOnCredit, setCompleteOnCredit] = useState(false);
  const [receiveLines, setReceiveLines] = useState<Record<string, ReceiveLine>>({});
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState<PaymentMethod>("cash");
  const [payCurrency, setPayCurrency] = useState<string | null>(null);
  const [payNote, setPayNote] = useState("");
  const [payAccount, setPayAccount] = useState(AUTO_ACCOUNT);
  // Hisoblar ro'yxati moliya ruxsati bilan; bo'lmasa server usul bo'yicha tanlaydi (naqd — asosiy kassa, boshqasi — bank)
  const payAccounts = useApiQuery<{ cashAccounts: PayAccountOption[] }>(showPayment && can("finance.view") ? "/api/finance/cash-accounts" : null).data
    ?.cashAccounts;
  // Bitta to'lov formasi — bitta reference (ikki marta bosilsa server takrorlamaydi)
  const [payReference, setPayReference] = useState(() => newReference("SP"));
  const [loading, setLoading] = useState(false);
  const [labelItems, setLabelItems] = useState<LabelItem[] | null>(null);
  const [labelsLoading, setLabelsLoading] = useState(false);

  const updateReceive = (itemId: string, patch: Partial<ReceiveLine>) =>
    setReceiveLines((p) => {
      const current: ReceiveLine = p[itemId] ?? { qty: 0, batchNumber: "", expiryDate: "" };
      return { ...p, [itemId]: { ...current, ...patch } };
    });

  // Etiketka: shtrix-kod va sotuv narxi katalogdan; soni — qabul qilingan (bo'lmasa buyurtma qilingan) miqdor
  const handleLabels = async () => {
    if (!order) return;
    setLabelsLoading(true);
    try {
      const quantities = new Map<string, number>();
      for (const item of order.items) {
        const qty = num(item.receivedQty) || num(item.orderedQty);
        quantities.set(item.productId, (quantities.get(item.productId) ?? 0) + qty);
      }
      const products = await Promise.all(
        [...quantities.keys()].map((id) => api.get<{ product: ProductListItem }>(`/api/catalog/products/${id}`)),
      );
      setLabelItems(
        products.map(({ product }) => ({
          product: toLabelProduct(product, currencies.toBase),
          quantity: Math.max(1, Math.ceil(quantities.get(product.id) ?? 1)),
        })),
      );
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setLabelsLoading(false);
    }
  };

  const handleConfirm = async () => {
    try { await confirmOrder.mutateAsync(); toast.success("Tasdiqlandi"); }
    catch (err) { toast.error(errorMessage(err)); }
  };

  const handleCancel = async () => {
    try { await cancelOrder.mutateAsync(); toast.success("Bekor qilindi"); }
    catch (err) { toast.error(errorMessage(err)); }
  };

  const handleReceive = async () => {
    if (!order) return;
    // Faqat qator, miqdor va partiya — mahsulot, birlik va narx serverda buyurtma qatoridan olinadi
    const items = order.items
      .filter((item) => (receiveLines[item.id]?.qty ?? 0) > 0)
      .map((item) => {
        const line = receiveLines[item.id]!;
        return {
          orderItemId: item.id,
          receivedQty: line.qty,
          batchNumber: line.batchNumber.trim() || null,
          expiryDate: line.expiryDate || null,
        };
      });
    if (!items.length) { toast.error("Kamida bitta miqdor kiriting"); return; }
    setLoading(true);
    try {
      await receiveGoods.mutateAsync({ receiptDate: todayLocal(), items });
      toast.success("Tovar qabul qilindi va ombor yangilandi");
      setShowReceive(false);
      setReceiveLines({});
    } catch (err) { toast.error(errorMessage(err)); }
    finally { setLoading(false); }
  };

  const handlePayment = async () => {
    if (!order || !payAmount) return;
    setLoading(true);
    try {
      const result = await recordPayment.mutateAsync({
        supplierId: order.supplierId,
        orderId,
        amount: payAmount.trim(),
        // Valyutada to'lov shu valyutadagi kassadan; kurs farqi serverda
        ...(activePayCurrency !== currencies.base ? { currency: activePayCurrency } : {}),
        paymentDate: todayLocal(),
        method: payMethod,
        reference: payReference,
        notes: payNote.trim() || null,
        // Tanlangan hisob (bank hisobi — komissiyasi bilan); "Avtomatik" — server usul bo'yicha
        ...(payAccount !== AUTO_ACCOUNT ? { cashAccountId: payAccount } : {}),
        // cashAccountId yuborilmaydi → naqdda asosiy kassa, karta/bank/o'tkazmada bank hisobi
      });
      if (result.created) toast.success("To'lov qayd etildi va kassadan chiqim amalga oshdi");
      else toast.info("Bu to'lov allaqachon qayd etilgan");
      setShowPayment(false);
      setPayAmount("");
      setPayNote("");
      setPayReference(newReference("SP"));
    } catch (err) { toast.error(errorMessage(err)); }
    finally { setLoading(false); }
  };

  /**
   * Bitta tugma: qoralama bo'lsa tasdiqlanadi, QOLGAN tovar to'liq qabul qilinadi va tanlangan
   * usulda to'lov yoziladi. Serverda hammasi bitta tranzaksiyada — to'lov xato bo'lsa qabul ham bekor.
   */
  const handleComplete = async () => {
    if (!order) return;
    setLoading(true);
    try {
      const amount = (completeAmount.trim() || String(completeRemaining)).trim();
      const result = await completeOrder.mutateAsync({
        ...(completeOnCredit
          ? {}
          : {
              payment: {
                amount,
                method: completeMethod,
                ...(completeAccount !== AUTO_ACCOUNT ? { cashAccountId: completeAccount } : {}),
              },
            }),
      });
      toast.success(
        completeOnCredit
          ? "Tovar qabul qilindi — summa ta'minotchi qarzida"
          : `Xarid yakunlandi: tovar qabul qilindi va ${formatMoney(amount, currencies.base)} to'lov yozildi`,
      );
      setShowComplete(false);
      setCompleteAmount("");
      void result;
    } catch (err) { toast.error(errorMessage(err)); }
    finally { setLoading(false); }
  };

  const handlePrintPO = () => {
    if (!order) return;
    generatePurchaseOrderPDF({
      company: {
        name: company?.name ?? "BUM ERP",
        legalName: company?.legalName ?? undefined,
        taxId: company?.taxId ?? undefined,
        address: company?.address ?? undefined,
        phone: company?.phone ?? undefined,
        email: company?.email ?? undefined,
        website: company?.website ?? undefined,
      },
      number: order.number,
      orderDate: order.orderDate,
      expectedDate: order.expectedDate ?? undefined,
      supplierName: order.supplierName,
      supplierPhone: order.supplierPhone ?? undefined,
      warehouseName: order.warehouseName,
      items: order.items.map((item) => ({
        productName: item.productName,
        productSku: item.productSku,
        orderedQty: num(item.orderedQty),
        receivedQty: num(item.receivedQty),
        unitName: item.unitName,
        unitPrice: num(item.unitPrice),
        lineTotal: num(item.lineTotal),
      })),
      totalAmount: num(order.totalAmount),
      paidAmount: num(order.paidAmount),
      balance: num(order.balance),
      currency: order.currency,
      notes: order.notes ?? undefined,
      status: order.status,
      paymentTerms: undefined,
    });
  };

  const balance = order ? num(order.balance) : 0;
  // Valyuta bo'yicha qoldiq — to'lov qoldig'i bor valyutada qilinadi
  const buckets = order?.currencyTotals ?? [];
  const openBuckets = buckets.filter((b) => num(b.totalAmount) > num(b.paidAmount));
  const activePayCurrency =
    payCurrency && openBuckets.some((b) => b.currency === payCurrency)
      ? payCurrency
      : openBuckets[0]?.currency ?? currencies.base;
  const activeBucket = buckets.find((b) => b.currency === activePayCurrency);
  const payRemaining = activeBucket ? num(activeBucket.totalAmount) - num(activeBucket.paidAmount) : balance;
  const multiCurrency = buckets.length > 1 || buckets.some((b) => b.currency !== currencies.base);
  const hasOpenBalance = buckets.length > 0 ? openBuckets.length > 0 : balance > 0;
  // Yakunlash faqat qabul qilinmagan qoldiq bo'lsa; to'lov summasi — to'lanmagan qismi
  const pendingLines = order?.items.filter((item) => num(item.pendingQty) > 0) ?? [];
  const completeRemaining = order ? Math.max(0, num(order.totalAmount) - num(order.paidAmount)) : 0;
  const canComplete =
    order !== undefined &&
    pendingLines.length > 0 &&
    !["cancelled"].includes(order.status) &&
    !multiCurrency &&
    can("purchase.approve") &&
    can("warehouse.receive");

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex justify-end">
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 0.4 }} exit={{ opacity: 0 }}
          className="absolute inset-0 bg-black" onClick={onClose} />
        <motion.div
          initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }}
          transition={{ type: "spring", damping: 25, stiffness: 300 }}
          className="relative w-full max-w-xl bg-card border-l border-border flex flex-col h-full overflow-hidden z-10"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
            <div>
              <p className="font-bold text-base">{order?.number ?? "..."}</p>
              <p className="text-xs text-muted-foreground">{order?.supplierName}</p>
            </div>
            <div className="flex items-center gap-2">
              {order && (
                <span className={cn("text-xs px-2 py-0.5 rounded-full font-medium", STATUS_COLORS[order.status] ?? "")}>
                  {STATUS_LABELS[order.status] ?? order.status}
                </span>
              )}
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-5 space-y-5">
            {orderQuery.isError ? (
              <p className="text-sm text-destructive">{errorMessage(orderQuery.error)}</p>
            ) : !order ? (
              <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
            ) : (
              <>
                {/* Info grid */}
                <div className="grid grid-cols-2 gap-3 text-sm">
                  {[
                    { label: "Ombor", value: order.warehouseName },
                    { label: "Sana", value: order.orderDate },
                    { label: multiCurrency ? "Jami (so'mda, buyurtma kursi)" : "Jami", value: fmt(num(order.totalAmount)) },
                    { label: multiCurrency ? "To'langan (so'mda)" : "To'langan", value: fmt(num(order.paidAmount)) },
                    ...(multiCurrency
                      ? []
                      : [{ label: "Qoldi", value: fmt(balance) }, { label: "Valyuta", value: order.currency }]),
                  ].map(({ label, value }) => (
                    <div key={label} className="bg-muted/40 rounded-lg px-3 py-2">
                      <p className="text-xs text-muted-foreground">{label}</p>
                      <p className="font-semibold mt-0.5">{value}</p>
                    </div>
                  ))}
                </div>

                {multiCurrency && (
                  <div className="rounded-lg border border-border overflow-hidden text-sm">
                    <div className="grid grid-cols-4 bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
                      <span>Valyuta</span>
                      <span className="text-right">Jami</span>
                      <span className="text-right">To'langan</span>
                      <span className="text-right">Qoldi</span>
                    </div>
                    {buckets.map((b) => (
                      <div key={b.currency} className="grid grid-cols-4 px-3 py-1.5 border-t border-border/60">
                        <span className="font-medium">{b.currency}</span>
                        <span className="text-right">{formatMoney(b.totalAmount, b.currency)}</span>
                        <span className="text-right">{formatMoney(b.paidAmount, b.currency)}</span>
                        <span className="text-right font-semibold">
                          {formatMoney(Math.max(0, num(b.totalAmount) - num(b.paidAmount)), b.currency)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Action buttons */}
                <div className="flex flex-wrap gap-2">
                  {/* Bitta odam xaridni kiritib, o'zi qabul qiladi: tasdiq + to'liq qabul + to'lov */}
                  {canComplete && (
                    <Button size="sm" onClick={() => setShowComplete((p) => !p)}>
                      <Zap className="h-4 w-4 mr-1" /> To'g'ridan-to'g'ri qabul qilish
                      {showComplete ? <ChevronUp className="h-3.5 w-3.5 ml-1" /> : <ChevronDown className="h-3.5 w-3.5 ml-1" />}
                    </Button>
                  )}
                  {order.status === "draft" && can("purchase.approve") && (
                    <Button size="sm" variant="secondary" onClick={handleConfirm} disabled={confirmOrder.isPending}>
                      <CheckCircle className="h-4 w-4 mr-1" /> Tasdiqlash
                    </Button>
                  )}
                  {["confirmed", "partial"].includes(order.status) && can("warehouse.receive") && (
                    <Button size="sm" variant="secondary" onClick={() => setShowReceive((p) => !p)}>
                      <Truck className="h-4 w-4 mr-1" /> Tovar qabul qilish
                      {showReceive ? <ChevronUp className="h-3.5 w-3.5 ml-1" /> : <ChevronDown className="h-3.5 w-3.5 ml-1" />}
                    </Button>
                  )}
                  {["confirmed", "partial", "received", "invoiced"].includes(order.status) && hasOpenBalance && can("purchase.approve") && (
                    <Button size="sm" variant="secondary" onClick={() => setShowPayment((p) => !p)}>
                      <CreditCard className="h-4 w-4 mr-1" /> To'lov qilish
                      {showPayment ? <ChevronUp className="h-3.5 w-3.5 ml-1" /> : <ChevronDown className="h-3.5 w-3.5 ml-1" />}
                    </Button>
                  )}
                  {["draft", "confirmed"].includes(order.status) && num(order.paidAmount) === 0 && can("purchase.cancel") && (
                    <Button size="sm" variant="ghost" className="text-destructive" onClick={handleCancel} disabled={cancelOrder.isPending}>
                      <Ban className="h-4 w-4 mr-1" /> Bekor qilish
                    </Button>
                  )}
                  <Button size="sm" variant="secondary" onClick={handlePrintPO}>
                    <FileDown className="h-4 w-4 mr-1" /> PDF
                  </Button>
                  {order.items.length > 0 && (
                    <Button size="sm" variant="secondary" onClick={() => { void handleLabels(); }} disabled={labelsLoading}>
                      <Tag className="h-4 w-4 mr-1" /> {labelsLoading ? "Yuklanmoqda..." : "Etiketka"}
                    </Button>
                  )}
                </div>
                {labelItems && (
                  <LabelPrintDialog initialItems={labelItems} onClose={() => setLabelItems(null)} />
                )}

                {/* Receive form */}
                {showComplete && (
                  <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-3">
                    <div>
                      <p className="text-sm font-semibold">Xaridni yakunlash</p>
                      <p className="text-xs text-muted-foreground">
                        {pendingLines.length} ta qator to'liq qabul qilinadi
                        {order.status === "draft" ? " (hujjat avval tasdiqlanadi)" : ""}
                        {completeOnCredit ? " va summa ta'minotchi qarziga yoziladi" : " va to'lov qayd etiladi"}
                      </p>
                    </div>

                    <label className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        className="h-3.5 w-3.5"
                        checked={completeOnCredit}
                        onChange={(e) => setCompleteOnCredit(e.target.checked)}
                      />
                      Qarzga olish — hozir to'lov qilinmaydi
                    </label>

                    {!completeOnCredit && (
                      <>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <Label className="text-xs">Summa ({currencies.base})</Label>
                            <Input
                              type="number"
                              min="0"
                              value={completeAmount}
                              onChange={(e) => setCompleteAmount(e.target.value)}
                              placeholder={String(completeRemaining)}
                            />
                          </div>
                          <div>
                            <Label className="text-xs">To'lov usuli</Label>
                            <Select
                              value={completeMethod}
                              onValueChange={(v) => { setCompleteMethod(v as PaymentMethod); setCompleteAccount(AUTO_ACCOUNT); }}
                            >
                              <SelectTrigger><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="cash">Naqd</SelectItem>
                                <SelectItem value="bank">Bank</SelectItem>
                                <SelectItem value="card">Karta</SelectItem>
                                <SelectItem value="transfer">O'tkazma</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                        {payAccounts && (() => {
                          const choices = payAccountChoices(payAccounts, currencies.base, completeMethod);
                          const autoAccount = completeMethod === "cash" ? null : (choices[0] ?? null);
                          return (
                            <div>
                              <Label htmlFor="complete-pay-account" className="text-xs">Qaysi hisobdan</Label>
                              <Select value={completeAccount} onValueChange={setCompleteAccount}>
                                <SelectTrigger id="complete-pay-account"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value={AUTO_ACCOUNT}>
                                    Avtomatik — {autoAccount ? autoAccount.name : "asosiy kassa"}
                                  </SelectItem>
                                  {choices.map((account) => (
                                    <SelectItem key={account.id} value={account.id}>
                                      {account.name} ({formatMoney(account.balance, account.currency)})
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          );
                        })()}
                      </>
                    )}

                    <Button size="sm" className="w-full" onClick={handleComplete} disabled={loading}>
                      {loading ? "..." : completeOnCredit ? "Qabul qilish (qarzga)" : "Qabul qilish va to'lash"}
                    </Button>
                  </div>
                )}

                {showReceive && (
                  <div className="border border-border rounded-xl p-4 space-y-3 bg-muted/20">
                    <p className="text-sm font-semibold">Tovar qabul qilish</p>
                    {order.items.filter((item) => num(item.pendingQty) > 0).map((item) => {
                      const line = receiveLines[item.id];
                      return (
                        <div key={item.id} className="space-y-1.5">
                          <div className="flex items-center gap-3">
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium truncate">{item.productName}</p>
                              <p className="text-[11px] text-muted-foreground">
                                Buyurtma: {num(item.orderedQty)} | Qabul: {num(item.receivedQty)} | Qoldi: {num(item.pendingQty)} {item.unitName}
                              </p>
                            </div>
                            <Input
                              type="number" min="0" step="0.001" max={num(item.pendingQty)}
                              className="h-8 w-24 text-xs text-right"
                              placeholder="0"
                              value={line?.qty || ""}
                              onChange={(e) => updateReceive(item.id, { qty: e.target.valueAsNumber || 0 })}
                            />
                            <span className="text-xs text-muted-foreground w-8">{item.unitName}</span>
                          </div>
                          {(line?.qty ?? 0) > 0 && (
                            <div className="flex gap-2 pl-1">
                              <Input
                                className="h-7 text-xs"
                                placeholder="Partiya raqami"
                                value={line?.batchNumber ?? ""}
                                onChange={(e) => updateReceive(item.id, { batchNumber: e.target.value })}
                              />
                              <Input
                                type="date"
                                className="h-7 text-xs w-36"
                                title="Yaroqlilik muddati"
                                value={line?.expiryDate ?? ""}
                                onChange={(e) => updateReceive(item.id, { expiryDate: e.target.value })}
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                    <Button size="sm" onClick={handleReceive} disabled={loading} className="w-full">
                      {loading ? "..." : "Qabul qilish va omborni yangilash"}
                    </Button>
                  </div>
                )}

                {/* Payment form */}
                {showPayment && (
                  <div className="border border-border rounded-xl p-4 space-y-3 bg-muted/20">
                    <p className="text-sm font-semibold">To'lov qayd etish</p>
                    {openBuckets.length > 1 && (
                      <div>
                        <Label className="text-xs">Valyuta</Label>
                        <Select value={activePayCurrency} onValueChange={(v) => { setPayCurrency(v); setPayAmount(""); }}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {openBuckets.map((b) => (
                              <SelectItem key={b.currency} value={b.currency}>
                                {b.currency} — qoldi {formatMoney(num(b.totalAmount) - num(b.paidAmount), b.currency)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    {activePayCurrency !== currencies.base && (
                      <p className="text-[11px] text-muted-foreground">
                        Pul {activePayCurrency} valyutasidagi kassa yoki bank hisobidan chiqadi; kurs farqi avtomatik hisoblanadi
                      </p>
                    )}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs">Summa ({activePayCurrency})</Label>
                        <Input type="number" min="0" value={payAmount}
                          onChange={(e) => setPayAmount(e.target.value)}
                          placeholder={String(payRemaining)} />
                      </div>
                      <div>
                        <Label className="text-xs">Usul</Label>
                        <Select value={payMethod} onValueChange={(v) => { setPayMethod(v as PaymentMethod); setPayAccount(AUTO_ACCOUNT); }}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="cash">Naqd</SelectItem>
                            <SelectItem value="bank">Bank</SelectItem>
                            <SelectItem value="card">Karta</SelectItem>
                            <SelectItem value="transfer">O'tkazma</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    {payAccounts && (() => {
                      const choices = payAccountChoices(payAccounts, activePayCurrency, payMethod);
                      // "Avtomatik": asosiy valyutada naqd — asosiy kassa; boshqasi — server tanlaydigan birinchi hisob
                      const autoAccount = payMethod === "cash" && activePayCurrency === currencies.base ? null : (choices[0] ?? null);
                      const selected = payAccount === AUTO_ACCOUNT ? autoAccount : (choices.find((account) => account.id === payAccount) ?? null);
                      return (
                        <>
                          <div>
                            <Label htmlFor="supplier-pay-account" className="text-xs">Qaysi hisobdan</Label>
                            <Select value={payAccount} onValueChange={setPayAccount}>
                              <SelectTrigger id="supplier-pay-account"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value={AUTO_ACCOUNT}>
                                  Avtomatik — {autoAccount ? autoAccount.name : "asosiy kassa"}
                                </SelectItem>
                                {choices.map((account) => (
                                  <SelectItem key={account.id} value={account.id}>
                                    {account.name} ({formatMoney(account.balance, account.currency)})
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <BankCommissionHint account={selected} amount={payAmount || payRemaining} />
                        </>
                      );
                    })()}
                    <div>
                      <Label className="text-xs">Izoh</Label>
                      <Input value={payNote} onChange={(e) => setPayNote(e.target.value)} placeholder="Chek raqami..." />
                    </div>
                    <Button size="sm" onClick={handlePayment} disabled={loading} className="w-full">
                      {loading ? "..." : "To'lovni qayd etish"}
                    </Button>
                  </div>
                )}

                <Separator />

                {/* Order items */}
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Mahsulotlar</p>
                  <div className="space-y-2">
                    {order.items.map((item) => (
                      <div key={item.id} className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{item.productName}</p>
                          <p className="text-xs text-muted-foreground font-mono">{item.productSku}</p>
                        </div>
                        <div className="text-right ml-4 shrink-0">
                          <p className="text-xs text-muted-foreground">
                            {num(item.receivedQty)}/{num(item.orderedQty)} {item.unitName}
                          </p>
                          <p className="text-sm font-semibold">{formatMoney(item.lineTotal, item.currency ?? currencies.base)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Receipts history */}
                {order.receipts.length > 0 && (
                  <>
                    <Separator />
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                        Qabul qilishlar ({order.receipts.length})
                      </p>
                      {order.receipts.map((r) => (
                        <div key={r.id} className="flex justify-between py-1.5 text-sm border-b border-border/40 last:border-0">
                          <span className="text-muted-foreground">{r.receiptDate}</span>
                          <span className="text-xs text-muted-foreground">{r.notes ?? "—"}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {/* Payments history */}
                {order.payments.length > 0 && (
                  <>
                    <Separator />
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                        To'lovlar ({order.payments.length})
                      </p>
                      {order.payments.map((p) => (
                        <div key={p.id} className="flex justify-between py-1.5 text-sm border-b border-border/40 last:border-0">
                          <div>
                            <span className="font-medium">{formatMoney(p.amount, p.currency)}</span>
                            <span className="text-xs text-muted-foreground ml-2">{PAYMENT_LABELS[p.method] ?? p.method}</span>
                            {num(p.fxAmount) !== 0 && (
                              <span className={cn("text-[11px] ml-2", num(p.fxAmount) > 0 ? "text-emerald-600" : "text-rose-600")}>
                                kurs farqi {num(p.fxAmount) > 0 ? "+" : ""}{fmt(num(p.fxAmount))}
                              </span>
                            )}
                          </div>
                          <span className="text-muted-foreground text-xs">{p.paymentDate}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {order.notes && (
                  <>
                    <Separator />
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Izoh</p>
                      <p className="text-sm text-muted-foreground">{order.notes}</p>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
