import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { toast } from "sonner";
import { motion, AnimatePresence } from "motion/react";
import {
  X, CheckCircle, Truck, CreditCard, Ban, ChevronDown, ChevronUp, FileDown,
} from "lucide-react";
import { generateSalesInvoicePDF } from "@/lib/pdf/invoice-pdf.ts";
import { useQuery as useConvexQuery } from "convex/react";
import { api as convexApi } from "@/convex/_generated/api.js";
import { Button } from "@/components/ui/button.tsx";
import { Separator } from "@/components/ui/separator.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { cn } from "@/lib/utils.ts";
import type { Id } from "@/convex/_generated/dataModel.d.ts";

type Props = {
  orderId: Id<"salesOrders">;
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
  const order = useQuery(api.sales.orders.getById, { id: orderId });
  const company = useConvexQuery(convexApi.admin.getCompany, {});
  const confirmOrder = useMutation(api.sales.orders.confirm);
  const shipOrder = useMutation(api.sales.orders.ship);
  const cancelOrder = useMutation(api.sales.orders.cancel);
  const recordPayment = useMutation(api.sales.orders.recordPayment);

  const [showPayment, setShowPayment] = useState(false);
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState<"cash" | "card" | "bank" | "transfer">("cash");
  const [payRef, setPayRef] = useState("");
  const [loading, setLoading] = useState(false);

  const handleConfirm = async () => {
    try { await confirmOrder({ id: orderId }); toast.success("Tasdiqlandi"); }
    catch (err) { toast.error(err instanceof Error ? err.message : "Xatolik"); }
  };
  const handleShip = async () => {
    setLoading(true);
    try { await shipOrder({ id: orderId }); toast.success("Jo'natildi, ombor yangilandi"); }
    catch (err) { toast.error(err instanceof Error ? err.message : "Xatolik"); }
    finally { setLoading(false); }
  };
  const handleCancel = async () => {
    try { await cancelOrder({ id: orderId }); toast.success("Bekor qilindi"); }
    catch (err) { toast.error(err instanceof Error ? err.message : "Xatolik"); }
  };

  const handlePayment = async () => {
    if (!order || !payAmount) return;
    setLoading(true);
    try {
      await recordPayment({
        orderId,
        amount: parseFloat(payAmount),
        method: payMethod,
        reference: payRef || undefined,
      });
      toast.success("To'lov qayd etildi");
      setShowPayment(false);
      setPayAmount("");
    } catch (err) { toast.error(err instanceof Error ? err.message : "Xatolik"); }
    finally { setLoading(false); }
  };

  const handlePrintInvoice = () => {
    if (!order) return;
    generateSalesInvoicePDF({
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
      date: order.orderDate,
      deliveryDate: order.deliveryDate,
      customerName: order.customerName,
      warehouseName: order.warehouseName,
      items: order.items.map((item) => ({
        name: item.productName,
        sku: item.productSku ?? "",
        qty: item.qty,
        unit: item.unitName ?? "dona",
        unitPrice: item.unitPrice,
        discount: item.discountPercent ?? 0,
        taxRate: item.taxRate ?? 0,
        lineTotal: item.lineTotal,
      })),
      subtotal: order.totalAmount,
      taxTotal: 0,
      discountTotal: 0,
      totalAmount: order.totalAmount,
      paidAmount: order.paidAmount,
      balance: order.balance,
      notes: order.notes,
      status: order.status,
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
          <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
            <div>
              <p className="font-bold text-base">{order?.number ?? "..."}</p>
              <p className="text-xs text-muted-foreground">{order?.customerName}</p>
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
            {!order ? (
              <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  {[
                    { label: "Ombor", value: order.warehouseName },
                    { label: "Sana", value: order.orderDate },
                    { label: "Jami", value: fmt(order.totalAmount) },
                    { label: "To'langan", value: fmt(order.paidAmount) },
                    { label: "Qoldi", value: fmt(order.balance) },
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
                  {order.status === "draft" && (
                    <Button size="sm" onClick={handleConfirm}>
                      <CheckCircle className="h-4 w-4 mr-1" /> Tasdiqlash
                    </Button>
                  )}
                  {order.status === "confirmed" && (
                    <Button size="sm" variant="secondary" onClick={handleShip} disabled={loading}>
                      <Truck className="h-4 w-4 mr-1" /> Jo'natish
                    </Button>
                  )}
                  {["shipped", "delivered"].includes(order.status) && order.balance > 0 && (
                    <Button size="sm" variant="secondary" onClick={() => setShowPayment((p) => !p)}>
                      <CreditCard className="h-4 w-4 mr-1" /> To'lov
                      {showPayment ? <ChevronUp className="h-3.5 w-3.5 ml-1" /> : <ChevronDown className="h-3.5 w-3.5 ml-1" />}
                    </Button>
                  )}
                  {["draft", "confirmed"].includes(order.status) && (
                    <Button size="sm" variant="ghost" className="text-destructive" onClick={handleCancel}>
                      <Ban className="h-4 w-4 mr-1" /> Bekor
                    </Button>
                  )}
                  <Button size="sm" variant="secondary" onClick={handlePrintInvoice} disabled={!order}>
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
                          placeholder={String(Math.round(order.balance))} />
                      </div>
                      <div>
                        <Label className="text-xs">Usul</Label>
                        <Select value={payMethod} onValueChange={(v) => setPayMethod(v as typeof payMethod)}>
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
                      <Label className="text-xs">Havola</Label>
                      <Input value={payRef} onChange={(e) => setPayRef(e.target.value)} placeholder="Chek raqami..." />
                    </div>
                    <Button size="sm" onClick={handlePayment} disabled={loading} className="w-full">
                      {loading ? "..." : "To'lovni qayd etish"}
                    </Button>
                  </div>
                )}

                <Separator />

                {/* Items */}
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Mahsulotlar</p>
                  <div className="space-y-2">
                    {order.items.map((item) => (
                      <div key={item._id} className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{item.productName}</p>
                          <p className="text-xs text-muted-foreground font-mono">{item.productSku} · {item.qty} {item.unitName}</p>
                        </div>
                        <div className="text-right ml-4">
                          <p className="text-xs text-muted-foreground">{new Intl.NumberFormat("uz-UZ").format(item.unitPrice)} × {item.qty}</p>
                          <p className="text-sm font-semibold">{fmt(item.lineTotal)}</p>
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
                        <div key={p._id} className="flex justify-between py-1.5 text-sm border-b border-border/40 last:border-0">
                          <div>
                            <span className="font-medium">{fmt(p.amount)}</span>
                            <span className="text-xs text-muted-foreground ml-2">{p.method}</span>
                          </div>
                          <span className="text-xs text-muted-foreground">{p.paymentDate}</span>
                        </div>
                      ))}
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
