import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { toast } from "sonner";
import { motion, AnimatePresence } from "motion/react";
import {
  X, CheckCircle, Truck, CreditCard, Package, FileText,
  Phone, Ban, ChevronDown, ChevronUp, FileDown,
} from "lucide-react";
import { generatePurchaseOrderPDF } from "@/lib/pdf/purchase-order-pdf.ts";
import { useQuery as useAdminQuery } from "convex/react";
import { api as adminApi } from "@/convex/_generated/api.js";
import { Button } from "@/components/ui/button.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Separator } from "@/components/ui/separator.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { cn } from "@/lib/utils.ts";
import type { Id } from "@/convex/_generated/dataModel.d.ts";

type Props = {
  orderId: Id<"purchaseOrders">;
  onClose: () => void;
};

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
  const order = useQuery(api.purchase.orders.getById, { id: orderId });
  const company = useAdminQuery(adminApi.admin.getCompany, {});
  const confirmOrder = useMutation(api.purchase.orders.confirm);
  const cancelOrder = useMutation(api.purchase.orders.cancel);
  const receiveGoods = useMutation(api.purchase.orders.receiveGoods);
  const recordPayment = useMutation(api.purchase.orders.recordPayment);

  const [showReceive, setShowReceive] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const [receiveQtys, setReceiveQtys] = useState<Record<string, number>>({});
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState<"cash" | "bank" | "card" | "transfer">("cash");
  const [payRef, setPayRef] = useState("");
  const [loading, setLoading] = useState(false);

  const today = new Date().toISOString().slice(0, 10);

  const handleConfirm = async () => {
    try { await confirmOrder({ id: orderId }); toast.success("Tasdiqlandi"); }
    catch (err) { toast.error(err instanceof Error ? err.message : "Xatolik"); }
  };

  const handleCancel = async () => {
    try { await cancelOrder({ id: orderId }); toast.success("Bekor qilindi"); }
    catch (err) { toast.error(err instanceof Error ? err.message : "Xatolik"); }
  };

  const handleReceive = async () => {
    if (!order) return;
    const items = order.items
      .filter((item) => (receiveQtys[item._id] ?? 0) > 0)
      .map((item) => ({
        orderItemId: item._id,
        productId: item.productId,
        unitId: item.unitId,
        receivedQty: receiveQtys[item._id] ?? 0,
        unitPrice: item.unitPrice,
      }));
    if (!items.length) { toast.error("Kamida bitta miqdor kiriting"); return; }
    setLoading(true);
    try {
      await receiveGoods({ orderId, receiptDate: today, items });
      toast.success("Tovar qabul qilindi va ombor yangilandi");
      setShowReceive(false);
      setReceiveQtys({});
    } catch (err) { toast.error(err instanceof Error ? err.message : "Xatolik"); }
    finally { setLoading(false); }
  };

  const handlePayment = async () => {
    if (!order || !payAmount) return;
    setLoading(true);
    try {
      await recordPayment({
        supplierId: order.supplierId,
        orderId,
        amount: parseFloat(payAmount),
        currency: order.currency,
        exchangeRate: order.exchangeRate,
        paymentDate: today,
        method: payMethod,
        reference: payRef || undefined,
        // cashAccountId omitted → auto-resolves to default cash account
      });
      toast.success("To'lov qayd etildi va kassadan chiqim amalga oshdi");
      setShowPayment(false);
      setPayAmount("");
    } catch (err) { toast.error(err instanceof Error ? err.message : "Xatolik"); }
    finally { setLoading(false); }
  };

  const handlePrintPO = () => {
    if (!order) return;
    generatePurchaseOrderPDF({
      company: {
        name: company?.name ?? "BUM ERP",
        legalName: company?.legalName,
        taxId: company?.taxId,
        address: company?.address,
        phone: company?.phone,
        email: company?.email,
        website: company?.website,
      },
      number: order.number,
      orderDate: order.orderDate,
      expectedDate: order.expectedDate,
      supplierName: order.supplierName,
      warehouseName: order.warehouseName,
      items: order.items.map((item) => ({
        productName: item.productName,
        productSku: item.productSku,
        orderedQty: item.orderedQty,
        receivedQty: item.receivedQty,
        unitName: item.unitName,
        unitPrice: item.unitPrice,
        lineTotal: item.lineTotal,
      })),
      totalAmount: order.totalAmount,
      paidAmount: order.paidAmount,
      balance: order.balance,
      currency: order.currency,
      notes: order.notes,
      status: order.status,
      paymentTerms: undefined,
    });
  };

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
            {!order ? (
              <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
            ) : (
              <>
                {/* Info grid */}
                <div className="grid grid-cols-2 gap-3 text-sm">
                  {[
                    { label: "Ombor", value: order.warehouseName },
                    { label: "Sana", value: order.orderDate },
                    { label: "Jami", value: fmt(order.totalAmount) },
                    { label: "To'langan", value: fmt(order.paidAmount) },
                    { label: "Qoldi", value: fmt(order.balance) },
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
                  {order.status === "draft" && (
                    <Button size="sm" onClick={handleConfirm}>
                      <CheckCircle className="h-4 w-4 mr-1" /> Tasdiqlash
                    </Button>
                  )}
                  {["confirmed", "partial"].includes(order.status) && (
                    <Button size="sm" variant="secondary" onClick={() => setShowReceive((p) => !p)}>
                      <Truck className="h-4 w-4 mr-1" /> Tovar qabul qilish
                      {showReceive ? <ChevronUp className="h-3.5 w-3.5 ml-1" /> : <ChevronDown className="h-3.5 w-3.5 ml-1" />}
                    </Button>
                  )}
                  {["received", "partial", "confirmed"].includes(order.status) && order.balance > 0 && (
                    <Button size="sm" variant="secondary" onClick={() => setShowPayment((p) => !p)}>
                      <CreditCard className="h-4 w-4 mr-1" /> To'lov qilish
                      {showPayment ? <ChevronUp className="h-3.5 w-3.5 ml-1" /> : <ChevronDown className="h-3.5 w-3.5 ml-1" />}
                    </Button>
                  )}
                  {["draft", "confirmed"].includes(order.status) && (
                    <Button size="sm" variant="ghost" className="text-destructive" onClick={handleCancel}>
                      <Ban className="h-4 w-4 mr-1" /> Bekor qilish
                    </Button>
                  )}
                  <Button size="sm" variant="secondary" onClick={handlePrintPO} disabled={!order}>
                    <FileDown className="h-4 w-4 mr-1" /> PDF
                  </Button>
                </div>

                {/* Receive form */}
                {showReceive && (
                  <div className="border border-border rounded-xl p-4 space-y-3 bg-muted/20">
                    <p className="text-sm font-semibold">Tovar qabul qilish</p>
                    {order.items.map((item) => (
                      <div key={item._id} className="flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate">{item.productName}</p>
                          <p className="text-[11px] text-muted-foreground">
                            Buyurtma: {item.orderedQty} | Qabul: {item.receivedQty} | Qoldi: {item.pendingQty} {item.unitName}
                          </p>
                        </div>
                        <Input
                          type="number" min="0" step="0.001" max={item.pendingQty}
                          className="h-8 w-24 text-xs text-right"
                          placeholder="0"
                          value={receiveQtys[item._id] ?? ""}
                          onChange={(e) => setReceiveQtys((p) => ({ ...p, [item._id]: e.target.valueAsNumber || 0 }))}
                        />
                        <span className="text-xs text-muted-foreground w-8">{item.unitName}</span>
                      </div>
                    ))}
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
                          placeholder={String(Math.round(order.balance))} />
                      </div>
                      <div>
                        <Label className="text-xs">Usul</Label>
                        <Select value={payMethod} onValueChange={(v) => setPayMethod(v as typeof payMethod)}>
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
                      <Label className="text-xs">Havola / izoh</Label>
                      <Input value={payRef} onChange={(e) => setPayRef(e.target.value)} placeholder="Chek raqami..." />
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
                      <div key={item._id} className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{item.productName}</p>
                          <p className="text-xs text-muted-foreground font-mono">{item.productSku}</p>
                        </div>
                        <div className="text-right ml-4 shrink-0">
                          <p className="text-xs text-muted-foreground">
                            {item.receivedQty}/{item.orderedQty} {item.unitName}
                          </p>
                          <p className="text-sm font-semibold">{fmt(item.lineTotal)}</p>
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
                        <div key={r._id} className="flex justify-between py-1.5 text-sm border-b border-border/40 last:border-0">
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
                        <div key={p._id} className="flex justify-between py-1.5 text-sm border-b border-border/40 last:border-0">
                          <div>
                            <span className="font-medium">{fmt(p.amount)}</span>
                            <span className="text-xs text-muted-foreground ml-2">{p.method}</span>
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
