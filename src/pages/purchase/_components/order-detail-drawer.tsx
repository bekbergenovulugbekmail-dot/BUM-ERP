import { useState } from "react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "motion/react";
import {
  X, CheckCircle, Truck, CreditCard,
  Ban, ChevronDown, ChevronUp, FileDown,
} from "lucide-react";
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

  const confirmOrder = useApiMutation(() => api.post(`/api/purchase/orders/${orderId}/confirm`));
  const cancelOrder = useApiMutation(() => api.post(`/api/purchase/orders/${orderId}/cancel`));
  const receiveGoods = useApiMutation((body: object) =>
    api.post<{ total: string; status: string }>(`/api/purchase/orders/${orderId}/receipts`, body),
  );
  const recordPayment = useApiMutation((body: object) =>
    api.post<{ created: boolean }>("/api/purchase/payments", body),
  );

  const [showReceive, setShowReceive] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const [receiveLines, setReceiveLines] = useState<Record<string, ReceiveLine>>({});
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState<PaymentMethod>("cash");
  const [payNote, setPayNote] = useState("");
  // Bitta to'lov formasi — bitta reference (ikki marta bosilsa server takrorlamaydi)
  const [payReference, setPayReference] = useState(() => newReference("SP"));
  const [loading, setLoading] = useState(false);

  const updateReceive = (itemId: string, patch: Partial<ReceiveLine>) =>
    setReceiveLines((p) => {
      const current: ReceiveLine = p[itemId] ?? { qty: 0, batchNumber: "", expiryDate: "" };
      return { ...p, [itemId]: { ...current, ...patch } };
    });

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
        paymentDate: todayLocal(),
        method: payMethod,
        reference: payReference,
        notes: payNote.trim() || null,
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
                    { label: "Jami", value: fmt(num(order.totalAmount)) },
                    { label: "To'langan", value: fmt(num(order.paidAmount)) },
                    { label: "Qoldi", value: fmt(balance) },
                    { label: "Valyuta", value: order.currency },
                  ].map(({ label, value }) => (
                    <div key={label} className="bg-muted/40 rounded-lg px-3 py-2">
                      <p className="text-xs text-muted-foreground">{label}</p>
                      <p className="font-semibold mt-0.5">{value}</p>
                    </div>
                  ))}
                </div>

                {/* Action buttons */}
                <div className="flex flex-wrap gap-2">
                  {order.status === "draft" && can("purchase.approve") && (
                    <Button size="sm" onClick={handleConfirm} disabled={confirmOrder.isPending}>
                      <CheckCircle className="h-4 w-4 mr-1" /> Tasdiqlash
                    </Button>
                  )}
                  {["confirmed", "partial"].includes(order.status) && can("warehouse.receive") && (
                    <Button size="sm" variant="secondary" onClick={() => setShowReceive((p) => !p)}>
                      <Truck className="h-4 w-4 mr-1" /> Tovar qabul qilish
                      {showReceive ? <ChevronUp className="h-3.5 w-3.5 ml-1" /> : <ChevronDown className="h-3.5 w-3.5 ml-1" />}
                    </Button>
                  )}
                  {["confirmed", "partial", "received", "invoiced"].includes(order.status) && balance > 0 && can("purchase.approve") && (
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
                </div>

                {/* Receive form */}
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
                            <SelectItem value="bank">Bank</SelectItem>
                            <SelectItem value="card">Karta</SelectItem>
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
                          <p className="text-sm font-semibold">{fmt(num(item.lineTotal))}</p>
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
                            <span className="font-medium">{fmt(num(p.amount))}</span>
                            <span className="text-xs text-muted-foreground ml-2">{PAYMENT_LABELS[p.method] ?? p.method}</span>
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
