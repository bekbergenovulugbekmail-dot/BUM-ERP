import { useState } from "react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "motion/react";
import {
  X, CheckCircle, Truck, CreditCard, Ban, ChevronDown, ChevronUp, FileDown, Undo2,
} from "lucide-react";
import { generateSalesInvoicePDF } from "@/lib/pdf/invoice-pdf.ts";
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
  PAYMENT_LABELS, companyInfo, newReference, num, todayLocal,
  type PaymentMethod, type SalesOrderDetail,
} from "../_lib/types.ts";

type Props = {
  orderId: string;
  onClose: () => void;
};

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  confirmed: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400",
  shipped: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400",
  delivered: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400",
  returned: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400",
  cancelled: "bg-destructive/10 text-destructive",
};
const STATUS_LABELS: Record<string, string> = {
  draft: "Qoralama", confirmed: "Tasdiqlangan", shipped: "Jo'natilgan",
  delivered: "Yetkazilgan", returned: "Qaytarilgan", cancelled: "Bekor",
};

const fmt = (n: number) => new Intl.NumberFormat("uz-UZ").format(Math.round(n)) + " so'm";

export default function OrderDetailDrawer({ orderId, onClose }: Props) {
  const { can } = usePermissions();
  const orderQuery = useApiQuery<{ order: SalesOrderDetail }>(`/api/sales/orders/${orderId}`);
  const order = orderQuery.data?.order;
  const company = useActiveCompany().data?.company;

  const confirmOrder = useApiMutation(() => api.post(`/api/sales/orders/${orderId}/confirm`));
  const shipOrder = useApiMutation(() => api.post(`/api/sales/orders/${orderId}/ship`));
  const cancelOrder = useApiMutation(() => api.post(`/api/sales/orders/${orderId}/cancel`));
  const returnOrder = useApiMutation((body: object) =>
    api.post<{ refunded: string }>(`/api/sales/orders/${orderId}/return`, body),
  );
  const recordPayment = useApiMutation((body: object) =>
    api.post<{ created: boolean }>("/api/sales/payments", body),
  );

  const [showPayment, setShowPayment] = useState(false);
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState<PaymentMethod>("cash");
  const [payNote, setPayNote] = useState("");
  // Bitta to'lov formasi — bitta reference (ikki marta bosilsa server takrorlamaydi)
  const [payReference, setPayReference] = useState(() => newReference("CP"));
  const [showReturn, setShowReturn] = useState(false);
  const [returnReason, setReturnReason] = useState("");
  const [refund, setRefund] = useState(true);
  const [refundMethod, setRefundMethod] = useState<PaymentMethod>("cash");
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

  const handleReturn = async () => {
    if (!order) return;
    setLoading(true);
    try {
      const result = await returnOrder.mutateAsync({
        reason: returnReason.trim() || null,
        refund,
        method: refundMethod,
      });
      const refunded = num(result.refunded);
      toast.success(refunded > 0
        ? `Qaytarildi, ${fmt(refunded)} mijozga qaytarildi`
        : "Qaytarildi, tovar omborga qaytdi");
      setShowReturn(false);
      setReturnReason("");
    } catch (err) { toast.error(errorMessage(err)); }
    finally { setLoading(false); }
  };

  const handlePrintInvoice = () => {
    if (!order) return;
    generateSalesInvoicePDF({
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
    });
  };

  const balance = order ? num(order.balance) : 0;
  const paid = order ? num(order.paidAmount) : 0;

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
                <span className={cn("text-xs px-2 py-0.5 rounded-full font-medium", STATUS_COLORS[order.status] ?? "")}>
                  {STATUS_LABELS[order.status] ?? order.status}
                </span>
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
                  {["confirmed", "shipped", "delivered"].includes(order.status) && balance > 0 && can("finance.manage") && (
                    <Button size="sm" variant="secondary" onClick={() => setShowPayment((p) => !p)}>
                      <CreditCard className="h-4 w-4 mr-1" /> To'lov
                      {showPayment ? <ChevronUp className="h-3.5 w-3.5 ml-1" /> : <ChevronDown className="h-3.5 w-3.5 ml-1" />}
                    </Button>
                  )}
                  {["shipped", "delivered"].includes(order.status) && can("sales.refund") && (
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
                  <Button size="sm" variant="secondary" onClick={handlePrintInvoice}>
                    <FileDown className="h-4 w-4 mr-1" /> PDF
                  </Button>
                </div>

                {/* Payment form */}
                {showPayment && (
                  <div className="border border-border rounded-xl p-4 space-y-3 bg-muted/20">
                    <p className="text-sm font-semibold">To'lov qayd etish</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs">Summa (so'm)</Label>
                        <Input type="number" min="0" value={payAmount}
                          onChange={(e) => setPayAmount(e.target.value)}
                          placeholder={String(balance)} />
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

                {/* Return form */}
                {showReturn && (
                  <div className="border border-destructive/30 rounded-xl p-4 space-y-3 bg-destructive/5">
                    <p className="text-sm font-semibold">Buyurtmani qaytarish</p>
                    <p className="text-xs text-muted-foreground">
                      Barcha tovar omborga qaytadi, sotuv va tannarx yozuvlari teskari o'tkaziladi.
                    </p>
                    <div>
                      <Label className="text-xs">Sabab</Label>
                      <Input value={returnReason} onChange={(e) => setReturnReason(e.target.value)} placeholder="Ixtiyoriy..." />
                    </div>
                    {paid > 0 && (
                      <div className="grid grid-cols-2 gap-3 items-end">
                        <label className="flex items-center gap-2 text-xs cursor-pointer">
                          <input type="checkbox" checked={refund} onChange={(e) => setRefund(e.target.checked)} />
                          {fmt(paid)} pulni qaytarish
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
                    <Button size="sm" variant="destructive" onClick={handleReturn} disabled={loading} className="w-full">
                      {loading ? "..." : "Qaytarishni tasdiqlash"}
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
                          <p className="text-xs text-muted-foreground font-mono">{item.productSku} · {num(item.quantity)} {item.unitName}</p>
                        </div>
                        <div className="text-right ml-4">
                          <p className="text-xs text-muted-foreground">{new Intl.NumberFormat("uz-UZ").format(num(item.unitPrice))} × {num(item.quantity)}</p>
                          <p className="text-sm font-semibold">{fmt(num(item.lineTotal))}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Payments */}
                {order.payments.length > 0 && (
                  <>
                    <Separator />
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">To'lovlar</p>
                      {order.payments.map((p) => (
                        <div key={p.id} className="flex justify-between py-1.5 text-sm border-b border-border/40 last:border-0">
                          <div>
                            <span className="font-medium">{fmt(num(p.amount))}</span>
                            <span className="text-xs text-muted-foreground ml-2">{PAYMENT_LABELS[p.method] ?? p.method}</span>
                          </div>
                          <span className="text-xs text-muted-foreground">{p.paymentDate}</span>
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
