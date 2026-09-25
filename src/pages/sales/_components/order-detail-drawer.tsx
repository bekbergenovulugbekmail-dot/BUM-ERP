import { useState } from "react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "motion/react";
import {
  X, CheckCircle, Truck, CreditCard, Ban, ChevronDown, ChevronUp, FileDown, Undo2,
} from "lucide-react";
import { generateSalesInvoicePDF } from "@/lib/pdf/invoice-pdf.ts";
import PaymentReversalDialog from "./payment-reversal-dialog.tsx";
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
import { useCurrentUser } from "@/hooks/use-auth.ts";
import { formatMoney, useCurrencies } from "@/hooks/use-currencies.ts";
import {
  DISPOSITION_LABELS, PAYMENT_LABELS, companyInfo, newReference, num, todayLocal,
  type PaymentMethod, type ReturnDisposition, type SalesOrderDetail, type SalesOrderItem,
} from "../_lib/types.ts";
import { Badge } from "@/components/ui/badge.tsx";

type Props = {
  orderId: string;
  onClose: () => void;
};

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  confirmed: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400",
  completed: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400",
  shipped: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400",
  delivered: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400",
  returned: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400",
  cancelled: "bg-destructive/10 text-destructive",
};
/** Sotuv holati — yetkazish holati emas; eski `shipped`/`delivered` ham yakunlangan sotuvni bildirgan. */
const STATUS_LABELS: Record<string, string> = {
  draft: "Qoralama", confirmed: "Tasdiqlangan", completed: "Yakunlangan",
  shipped: "Yakunlangan", delivered: "Yakunlangan", returned: "Qaytarilgan", cancelled: "Bekor",
};

/** To'lov holati — sotuv holatidan alohida ustun (nomi `PAYMENT_LABELS` bilan chalkashmasin: u to'lov USULI). */
const PAY_STATUS_LABELS: Record<string, string> = { paid: "To'langan", partial: "Qisman", unpaid: "To'lanmagan" };
const PAY_STATUS_COLORS: Record<string, string> = {
  paid: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400",
  partial: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400",
  unpaid: "bg-muted text-muted-foreground",
};
/** Yetkazma holati — yetkazma ochilgan bo'lsagina ko'rsatiladi. */
const DELIVERY_LABELS: Record<string, string> = {
  ready: "Tayyor", assigned: "Biriktirilgan", accepted: "Qabul qilingan",
  out_for_delivery: "Yo'lda", arrived: "Mijozda", delivering: "Topshirilmoqda",
  delivered: "Yetkazildi", partially_delivered: "Qisman yetkazildi",
  failed: "Yetkazilmadi", returned: "Qaytarildi", cancelled: "Bekor qilingan",
};

const fmt = (n: number) => new Intl.NumberFormat("uz-UZ").format(Math.round(n)) + " so'm";

export default function OrderDetailDrawer({ orderId, onClose }: Props) {
  const { can } = usePermissions();
  /** Bekor qilinayotgan to'lov (ko'rib chiqish oynasi ochiq). */
  const [reversingPayment, setReversingPayment] = useState<string | null>(null);
  const orderQuery = useApiQuery<{ order: SalesOrderDetail }>(`/api/sales/orders/${orderId}`);
  const order = orderQuery.data?.order;
  const company = useActiveCompany().data?.company;
  const me = useCurrentUser();

  const confirmOrder = useApiMutation(() => api.post(`/api/sales/orders/${orderId}/confirm`));
  const shipOrder = useApiMutation(() => api.post(`/api/sales/orders/${orderId}/ship`));
  const cancelOrder = useApiMutation(() => api.post(`/api/sales/orders/${orderId}/cancel`));
  /** Qatorlar bo'yicha qaytarish — nakladnoydan aynan kerakli mahsulot va miqdor. */
  const returnItems = useApiMutation((body: object) =>
    api.post<{ return: { number: string; refundAmount: string } }>(`/api/sales/orders/${orderId}/return-items`, body),
  );
  const recordPayment = useApiMutation((body: object) =>
    api.post<{ created: boolean }>("/api/sales/payments", body),
  );

  const [showPayment, setShowPayment] = useState(false);
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState<PaymentMethod>("cash");
  // To'lov valyutasi; null — asosiy. Balans va keshbek faqat asosiy valyutada
  const [payCurrency, setPayCurrency] = useState<string | null>(null);
  const currencies = useCurrencies();
  const payCurrencyCode = payCurrency ?? currencies.base;
  const [payNote, setPayNote] = useState("");
  // Bitta to'lov formasi — bitta reference (ikki marta bosilsa server takrorlamaydi)
  const [payReference, setPayReference] = useState(() => newReference("CP"));
  const [showReturn, setShowReturn] = useState(false);
  const [returnReason, setReturnReason] = useState("");
  const [refund, setRefund] = useState(true);
  const [refundMethod, setRefundMethod] = useState<PaymentMethod>("cash");
  /** Qator id → qaytariladigan miqdor (matn): nakladnoydan aynan kerakli mahsulotni qaytarish. */
  const [returnQty, setReturnQty] = useState<Record<string, string>>({});
  /** Qator id → qaytgan tovar holati (standart — sotuvga). */
  const [returnDisposition, setReturnDisposition] = useState<Record<string, ReturnDisposition>>({});
  /** Karantin / ta'minotchiga qaytarish uchun ombor. */
  const [dispositionWarehouseId, setDispositionWarehouseId] = useState<string | null>(null);
  const warehouseOptions = useApiQuery<{ warehouses: { id: string; name: string }[] }>(showReturn ? "/api/inventory/warehouses" : null).data?.warehouses ?? [];
  const [loading, setLoading] = useState(false);

  const handleConfirm = async () => {
    try { await confirmOrder.mutateAsync(); toast.success("Tasdiqlandi"); }
    catch (err) { toast.error(errorMessage(err)); }
  };
  const handleShip = async () => {
    setLoading(true);
    try { await shipOrder.mutateAsync(); toast.success("Jo'natildi, ombor yangilandi"); }
    catch (err) { toast.error(errorMessage(err)); }
    finally { setLoading(false); }
  };
  const handleCancel = async () => {
    try { await cancelOrder.mutateAsync(); toast.success("Bekor qilindi"); }
    catch (err) { toast.error(errorMessage(err)); }
  };

  const handlePayment = async () => {
    if (!order || !payAmount) return;
    setLoading(true);
    try {
      const result = await recordPayment.mutateAsync({
        orderId,
        amount: payAmount.trim(),
        ...(payCurrencyCode !== currencies.base ? { currency: payCurrencyCode } : {}),
        paymentDate: todayLocal(),
        method: payMethod,
        reference: payReference,
        notes: payNote.trim() || null,
      });
      if (result.created) toast.success("To'lov qayd etildi");
      else toast.info("Bu to'lov allaqachon qayd etilgan");
      setShowPayment(false);
      setPayAmount("");
      setPayNote("");
      setPayReference(newReference("CP"));
    } catch (err) { toast.error(errorMessage(err)); }
    finally { setLoading(false); }
  };

  /** Qator bo'yicha yana qancha qaytarish mumkin (qator birligida). */
  const remainingOf = (item: SalesOrderItem) => num(item.quantity) - num(item.returnedQty);

  /** Foydalanuvchi belgilagan qatorlar — bo'sh yoki 0 bo'lganlari hisobga olinmaydi. */
  const returnLines = (order?.items ?? [])
    .map((item) => ({ item, quantity: Number(returnQty[item.id] ?? "") }))
    .filter((line) => Number.isFinite(line.quantity) && line.quantity > 0);
  /** Chegaradan oshgan qatorlar — tugma o'chiriladi va qator qizil bo'ladi. */
  const overLimit = returnLines.filter((line) => line.quantity > remainingOf(line.item) + 1e-9);
  const returnValue = returnLines.reduce(
    (sum, line) => sum + (num(line.item.lineTotal) * line.quantity) / (num(line.item.quantity) || 1),
    0,
  );

  const handleReturn = async () => {
    if (!order || returnLines.length === 0 || overLimit.length > 0) return;
    setLoading(true);
    try {
      // Qatorlar bo'yicha qaytarish — mavjud `return-items` oqimi (zaxira, qarz va jurnal shu yerda)
      const dispositions = returnLines
        .map((line) => ({ orderItemId: line.item.id, disposition: returnDisposition[line.item.id] ?? "sellable" }))
        .filter((row) => row.disposition !== "sellable")
        .map((row) => ({
          ...row,
          warehouseId: row.disposition === "quarantine" || row.disposition === "supplier_return" ? dispositionWarehouseId : null,
        }));
      const result = await returnItems.mutateAsync({
        items: returnLines.map((line) => ({ orderItemId: line.item.id, quantity: String(line.quantity) })),
        refundMethod: refund ? refundMethod : "balance",
        reason: returnReason.trim() || null,
        ...(dispositions.length > 0 ? { dispositions } : {}),
      });
      const refunded = num(result.return?.refundAmount ?? "0");
      toast.success(refunded > 0
        ? `${result.return?.number ?? "Qaytarish"}: ${fmt(refunded)} mijozga qaytarildi`
        : `${result.return?.number ?? "Qaytarish"}: tovar omborga qaytdi`);
      setShowReturn(false);
      setReturnReason("");
      setReturnQty({});
      setReturnDisposition({});
    } catch (err) { toast.error(errorMessage(err)); }
    finally { setLoading(false); }
  };

  const handlePrintInvoice = async () => {
    if (!order) return;
    const invoice = {
      company: companyInfo(company),
      number: order.number,
      date: order.orderDate,
      deliveryDate: order.deliveryDate ?? undefined,
      customerName: order.customerName ?? "Anonim mijoz",
      customerPhone: order.customerPhone ?? undefined,
      warehouseName: order.warehouseName,
      items: order.items.map((item) => ({
        name: item.productName,
        sku: item.productSku ?? "",
        qty: num(item.quantity),
        unit: item.unitName ?? "dona",
        unitPrice: num(item.unitPrice),
        discount: num(item.discountPercent),
        taxRate: num(item.taxRate),
        lineTotal: num(item.lineTotal),
      })),
      subtotal: num(order.subtotal),
      taxTotal: num(order.taxAmount),
      discountTotal: num(order.discountAmount),
      totalAmount: num(order.totalAmount),
      paidAmount: num(order.paidAmount),
      balance: num(order.balance),
      currency: order.currency,
      notes: order.notes ?? undefined,
      status: order.status,
    };

    /**
     * Kompaniya O'Z shablonini tuzgan bo'lsa — hisob-faktura o'sha bo'yicha chiqadi.
     * Aks holda avvalgi qat'iy ko'rinish: shablon yaratilmaguncha hech narsa o'zgarmaydi.
     */
    const { activeTemplate, invoiceDocumentData, saveWithTemplate } = await import("@/lib/pdf/document-template-bridge.ts");
    const schema = await activeTemplate("sales_invoice");
    if (schema) {
      await saveWithTemplate(schema, invoiceDocumentData(invoice, me?.name ?? "—"), `hisob-faktura-${order.number}.pdf`);
      return;
    }
    await generateSalesInvoicePDF(invoice);
  };

  const balance = order ? num(order.balance) : 0;
  const paid = order ? num(order.paidAmount) : 0;
  // To'lov valyutasidagi qoldiq: asosiy — butun qoldiq; buyurtmadagi valyuta qismi — undan; boshqasi — joriy kurs bilan
  const payBucket = order?.currencyTotals.find((c) => c.currency === payCurrencyCode);
  const payRemaining =
    payCurrencyCode === currencies.base
      ? balance
      : payBucket
        ? Math.max(0, num(payBucket.totalAmount) - num(payBucket.paidAmount))
        : balance / currencies.rateOf(payCurrencyCode);
  const payCurrencyOptions = [...new Set([...currencies.codes, ...(order?.currencyTotals.map((c) => c.currency) ?? [])])];

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
          <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
            <div>
              <p className="font-bold text-base">{order?.number ?? "..."}</p>
              <p className="text-xs text-muted-foreground">{order ? (order.customerName ?? "Anonim mijoz") : ""}</p>
            </div>
            <div className="flex items-center gap-2">
              {order && (
                <>
                  <span className={cn("text-xs px-2 py-0.5 rounded-full font-medium", STATUS_COLORS[order.status] ?? "")}>
                    {STATUS_LABELS[order.status] ?? order.status}
                  </span>
                  {order.status !== "draft" && order.status !== "cancelled" && (
                    <span className={cn("text-xs px-2 py-0.5 rounded-full font-medium", PAY_STATUS_COLORS[order.paymentStatus] ?? "")}>
                      {PAY_STATUS_LABELS[order.paymentStatus] ?? order.paymentStatus}
                    </span>
                  )}
                  {order.deliveryStatus && (
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400">
                      {DELIVERY_LABELS[order.deliveryStatus] ?? order.deliveryStatus}
                    </span>
                  )}
                </>
              )}
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-5">
            {orderQuery.isError ? (
              <p className="text-sm text-destructive">{errorMessage(orderQuery.error)}</p>
            ) : !order ? (
              <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  {[
                    { label: "Ombor", value: order.warehouseName },
                    { label: "Sana", value: order.orderDate },
                    { label: "Jami", value: fmt(num(order.totalAmount)) },
                    { label: "To'langan", value: fmt(paid) },
                    { label: "Qoldi", value: fmt(balance) },
                    { label: "Mahsulotlar", value: String(order.items.length) + " ta" },
                    ...order.currencyTotals.map((c) => ({
                      label: `Jami (${c.currency})`,
                      value: `${formatMoney(c.totalAmount, c.currency)} · to'langan ${formatMoney(c.paidAmount, c.currency)}`,
                    })),
                    ...(num(order.cashbackEarned) > 0 ? [{ label: "Keshbek berildi", value: fmt(num(order.cashbackEarned)) }] : []),
                  ].map(({ label, value }) => (
                    <div key={label} className="bg-muted/40 rounded-lg px-3 py-2">
                      <p className="text-xs text-muted-foreground">{label}</p>
                      <p className="font-semibold mt-0.5">{value}</p>
                    </div>
                  ))}
                </div>

                {/* Actions */}
                <div className="flex flex-wrap gap-2">
                  {order.status === "draft" && can("sales.approve") && (
                    <Button size="sm" onClick={handleConfirm} disabled={confirmOrder.isPending}>
                      <CheckCircle className="h-4 w-4 mr-1" /> Tasdiqlash
                    </Button>
                  )}
                  {order.status === "confirmed" && !order.isPos && can("sales.approve") && (
                    <Button size="sm" variant="secondary" onClick={handleShip} disabled={loading}>
                      <Truck className="h-4 w-4 mr-1" /> Jo'natish
                    </Button>
                  )}
                  {["confirmed", "completed", "shipped", "delivered"].includes(order.status) && balance > 0 && can("finance.manage") && (
                    <Button size="sm" variant="secondary" onClick={() => setShowPayment((p) => !p)}>
                      <CreditCard className="h-4 w-4 mr-1" /> To'lov
                      {showPayment ? <ChevronUp className="h-3.5 w-3.5 ml-1" /> : <ChevronDown className="h-3.5 w-3.5 ml-1" />}
                    </Button>
                  )}
                  {["completed", "shipped", "delivered"].includes(order.status) && can("sales.refund") && (
                    <Button size="sm" variant="secondary" onClick={() => setShowReturn((p) => !p)}>
                      <Undo2 className="h-4 w-4 mr-1" /> Qaytarish
                      {showReturn ? <ChevronUp className="h-3.5 w-3.5 ml-1" /> : <ChevronDown className="h-3.5 w-3.5 ml-1" />}
                    </Button>
                  )}
                  {["draft", "confirmed"].includes(order.status) && paid === 0 && can("sales.cancel") && (
                    <Button size="sm" variant="ghost" className="text-destructive" onClick={handleCancel} disabled={cancelOrder.isPending}>
                      <Ban className="h-4 w-4 mr-1" /> Bekor
                    </Button>
                  )}
                  <Button size="sm" variant="secondary" onClick={() => void handlePrintInvoice()}>
                    <FileDown className="h-4 w-4 mr-1" /> PDF
                  </Button>
                </div>

                {/* Payment form */}
                {showPayment && (
                  <div className="border border-border rounded-xl p-4 space-y-3 bg-muted/20">
                    <p className="text-sm font-semibold">To'lov qayd etish</p>
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <Label className="text-xs">Valyuta</Label>
                        <Select
                          value={payCurrencyCode}
                          onValueChange={(v) => {
                            setPayCurrency(v);
                            setPayAmount("");
                            if (v !== currencies.base && (payMethod === "balance" || payMethod === "cashback")) setPayMethod("cash");
                          }}
                        >
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {payCurrencyOptions.map((code) => <SelectItem key={code} value={code}>{code}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label className="text-xs">Summa ({payCurrencyCode})</Label>
                        <Input type="number" min="0" step="any" value={payAmount}
                          onChange={(e) => setPayAmount(e.target.value)}
                          placeholder={String(Math.round(payRemaining * 100) / 100)} />
                      </div>
                      <div>
                        <Label className="text-xs">Usul</Label>
                        <Select value={payMethod} onValueChange={(v) => setPayMethod(v as PaymentMethod)}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="cash">Naqd</SelectItem>
                            <SelectItem value="card">Karta</SelectItem>
                            <SelectItem value="bank">Bank</SelectItem>
                            <SelectItem value="transfer">O'tkazma</SelectItem>
                            {order.customerId && payCurrencyCode === currencies.base && (
                              <>
                                <SelectItem value="balance">Balansdan</SelectItem>
                                <SelectItem value="cashback">Keshbekdan</SelectItem>
                              </>
                            )}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs">Izoh</Label>
                      <Input value={payNote} onChange={(e) => setPayNote(e.target.value)} placeholder="Chek raqami..." />
                    </div>
                    <Button size="sm" onClick={handlePayment} disabled={loading} className="w-full">
                      {loading ? "..." : "To'lovni qayd etish"}
                    </Button>
                  </div>
                )}

                {/* Qaytarish: nakladnoy ichidan qatorlar bo'yicha (hammasini qaytarish shart emas) */}
                {showReturn && (
                  <div className="border border-destructive/30 rounded-xl p-4 space-y-3 bg-destructive/5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold">Nakladnoydan qaytarish</p>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs"
                        onClick={() =>
                          setReturnQty(
                            Object.fromEntries(
                              order.items
                                .filter((item) => remainingOf(item) > 0)
                                .map((item) => [item.id, String(remainingOf(item))]),
                            ),
                          )
                        }
                      >
                        Hammasini tanlash
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Qaytariladigan miqdorni kiriting — tanlangan tovar omborga qaytadi, sotuv va tannarx
                      yozuvlari shu qism uchun teskari o'tkaziladi.
                    </p>

                    <div className="overflow-x-auto rounded-lg border border-border/60 bg-background">
                      <table className="w-full text-xs">
                        <thead className="bg-muted/50">
                          <tr className="text-left">
                            <th className="px-2 py-2 font-medium text-muted-foreground">Mahsulot</th>
                            <th className="px-2 py-2 text-right font-medium text-muted-foreground">Berilgan</th>
                            <th className="px-2 py-2 text-right font-medium text-muted-foreground">Qaytarilgan</th>
                            <th className="px-2 py-2 text-right font-medium text-muted-foreground">Qolgan</th>
                            <th className="px-2 py-2 text-right font-medium text-muted-foreground w-28">Qaytarish</th>
                            <th className="px-2 py-2 font-medium text-muted-foreground w-36">Holati</th>
                          </tr>
                        </thead>
                        <tbody>
                          {order.items.map((item) => {
                            const remaining = remainingOf(item);
                            const entered = Number(returnQty[item.id] ?? "");
                            const invalid = Number.isFinite(entered) && entered > remaining + 1e-9;
                            return (
                              <tr key={item.id} className={cn("border-t border-border/40", remaining <= 0 && "opacity-50")}>
                                <td className="px-2 py-1.5">
                                  <p className="font-medium">{item.productName}</p>
                                  <p className="font-mono text-[11px] text-muted-foreground">{item.productSku}</p>
                                </td>
                                <td className="px-2 py-1.5 text-right tabular-nums">{num(item.quantity)} {item.unitName}</td>
                                <td className="px-2 py-1.5 text-right tabular-nums">{num(item.returnedQty) || "\u2014"}</td>
                                <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{remaining}</td>
                                <td className="px-2 py-1.5 text-right">
                                  <Input
                                    type="number"
                                    min="0"
                                    max={remaining}
                                    step="any"
                                    disabled={remaining <= 0}
                                    aria-label={`${item.productName} — qaytariladigan miqdor`}
                                    data-testid={`return-qty-${item.productSku}`}
                                    className={cn("h-7 text-right text-xs", invalid && "border-destructive text-destructive")}
                                    value={returnQty[item.id] ?? ""}
                                    onChange={(e) => setReturnQty((prev) => ({ ...prev, [item.id]: e.target.value }))}
                                    placeholder="0"
                                  />
                                </td>
                                <td className="px-2 py-1.5">
                                  <Select
                                    value={returnDisposition[item.id] ?? "sellable"}
                                    onValueChange={(value) => setReturnDisposition((prev) => ({ ...prev, [item.id]: value as ReturnDisposition }))}
                                    disabled={remaining <= 0}
                                  >
                                    <SelectTrigger className="h-7 text-xs" data-testid={`return-disposition-${item.productSku}`}><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                      {(Object.keys(DISPOSITION_LABELS) as ReturnDisposition[]).map((key) => (
                                        <SelectItem key={key} value={key}>{DISPOSITION_LABELS[key]}</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    {overLimit.length > 0 && (
                      <p className="text-xs text-destructive">
                        {overLimit[0]!.item.productName}: qolganidan ko'p ({remainingOf(overLimit[0]!.item)} gacha)
                      </p>
                    )}

                    {returnLines.some((line) => ["quarantine", "supplier_return"].includes(returnDisposition[line.item.id] ?? "sellable")) && (
                      <div>
                        <Label className="text-xs">Karantin / qaytarish ombori</Label>
                        <Select value={dispositionWarehouseId ?? undefined} onValueChange={setDispositionWarehouseId}>
                          <SelectTrigger className="h-8 text-xs" data-testid="return-disposition-warehouse"><SelectValue placeholder="Omborni tanlang" /></SelectTrigger>
                          <SelectContent>
                            {warehouseOptions.filter((row) => row.id !== order.warehouseId).map((row) => (
                              <SelectItem key={row.id} value={row.id}>{row.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}

                    <div>
                      <Label className="text-xs">Sabab</Label>
                      <Input value={returnReason} onChange={(e) => setReturnReason(e.target.value)} placeholder="Ixtiyoriy..." />
                    </div>
                    {paid > 0 && (
                      <div className="grid grid-cols-2 gap-3 items-end">
                        <label className="flex items-center gap-2 text-xs cursor-pointer">
                          <input type="checkbox" checked={refund} onChange={(e) => setRefund(e.target.checked)} />
                          Pulni qaytarish
                        </label>
                        {refund && (
                          <Select value={refundMethod} onValueChange={(v) => setRefundMethod(v as PaymentMethod)}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="cash">Naqd</SelectItem>
                              <SelectItem value="card">Karta</SelectItem>
                              <SelectItem value="bank">Bank</SelectItem>
                              <SelectItem value="transfer">O'tkazma</SelectItem>
                            </SelectContent>
                          </Select>
                        )}
                      </div>
                    )}
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={handleReturn}
                      disabled={loading || returnLines.length === 0 || overLimit.length > 0}
                      className="w-full"
                      data-testid="submit-return"
                    >
                      {loading
                        ? "..."
                        : returnLines.length === 0
                          ? "Miqdorni kiriting"
                          : `${returnLines.length} qatorni qaytarish · ${fmt(returnValue)}`}
                    </Button>
                  </div>
                )}

                <Separator />

                {/* Items */}
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Mahsulotlar</p>
                  <div className="space-y-2">
                    {order.items.map((item) => (
                      <div key={item.id} className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{item.productName}</p>
                          <p className="text-xs text-muted-foreground font-mono">
                            {item.productSku} · {num(item.quantity)} {item.unitName}
                            {num(item.returnedQty) > 0 && (
                              <span className="ml-2 font-sans text-destructive">
                                qaytarilgan {num(item.returnedQty)} · qolgan {remainingOf(item)}
                              </span>
                            )}
                          </p>
                        </div>
                        <div className="text-right ml-4">
                          <p className="text-xs text-muted-foreground">{new Intl.NumberFormat("uz-UZ").format(num(item.unitPrice))} × {num(item.quantity)}</p>
                          <p className="text-sm font-semibold">
                            {item.priceCurrency ? formatMoney(item.currencyTotal, item.priceCurrency) : fmt(num(item.lineTotal))}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Qaytarish tarixi: qaysi hujjat, kim, qaysi mahsulotdan qancha */}
                {order.returns.length > 0 && (
                  <>
                    <Separator />
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Qaytarishlar</p>
                      <div className="space-y-2">
                        {order.returns.map((record) => (
                          <div key={record.id} className="rounded-lg border border-border/60 p-2.5">
                            <div className="flex flex-wrap items-baseline justify-between gap-2">
                              <span className="font-mono text-xs font-semibold">
                                {record.number}
                                {record.kind === "delivery_refusal" && <Badge variant="outline" className="ml-1.5 text-[10px]">Yetkazilmadi</Badge>}
                              </span>
                              <span className="text-sm font-semibold text-destructive">{fmt(num(record.totalAmount))}</span>
                            </div>
                            <p className="text-[11px] text-muted-foreground">
                              {new Date(record.createdAt).toLocaleString("uz-UZ")}
                              {record.createdByName ? ` · ${record.createdByName}` : ""}
                              {num(record.refundAmount) > 0 ? ` · ${fmt(num(record.refundAmount))} qaytarildi` : ""}
                              {record.reason ? ` · ${record.reason}` : ""}
                            </p>
                            <ul className="mt-1 space-y-0.5">
                              {record.items.map((line) => (
                                <li key={line.orderItemId + line.productId} className="flex justify-between text-xs">
                                  <span className="truncate">
                                    {line.productName}
                                    {line.disposition && line.disposition !== "sellable" && <span className="text-muted-foreground"> · {DISPOSITION_LABELS[line.disposition]}</span>}
                                  </span>
                                  <span className="ml-3 shrink-0 tabular-nums text-muted-foreground">
                                    {num(line.quantity)} · {fmt(num(line.lineTotal))}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}

                {/* Payments */}
                {order.payments.length > 0 && (
                  <>
                    <Separator />
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">To'lovlar</p>
                      {order.payments.map((p) => (
                        <div key={p.id} className="flex items-center justify-between gap-2 py-1.5 text-sm border-b border-border/40 last:border-0" data-testid={`order-payment-${p.id}`}>
                          <div className={cn(p.status === "reversed" && "text-muted-foreground line-through")}>
                            <span className="font-medium">
                              {p.currency !== order.currency ? `${formatMoney(p.foreignAmount, p.currency)} (${fmt(num(p.amount))})` : fmt(num(p.amount))}
                            </span>
                            <span className="text-xs text-muted-foreground ml-2">{PAYMENT_LABELS[p.method] ?? p.method}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            {p.status === "reversed" && (
                              <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] text-destructive" title={p.reversalReason ?? undefined}>bekor qilingan</span>
                            )}
                            <span className="text-xs text-muted-foreground">{p.paymentDate}</span>
                            {p.status !== "reversed" && can("finance.approve") && (
                              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" data-testid={`reverse-payment-${p.id}`} onClick={() => setReversingPayment(p.id)}>
                                Bekor qilish
                              </Button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {reversingPayment && <PaymentReversalDialog paymentId={reversingPayment} onClose={() => setReversingPayment(null)} />}

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
