import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { motion } from "motion/react";
import { CheckCircle, Printer, X, FileDown } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Separator } from "@/components/ui/separator.tsx";
import type { Id } from "@/convex/_generated/dataModel.d.ts";
import { generateReceiptPDF } from "@/lib/pdf/receipt-pdf.ts";

const fmt = (n: number) => new Intl.NumberFormat("uz-UZ").format(Math.round(n));

type Props = {
  orderId: Id<"salesOrders">;
  change: number;
  total: number;
  payMethod: string;
  onClose: () => void;
  cashierName?: string;
};

const PAY_LABELS: Record<string, string> = {
  cash: "Naqd", card: "Karta", bank: "Bank", transfer: "O'tkazma",
};

export default function POSReceipt({ orderId, change, total, payMethod, onClose, cashierName }: Props) {
  const order = useQuery(api.sales.orders.getById, { id: orderId });
  const company = useQuery(api.admin.getCompany, {});

  const handlePrint = () => window.print();

  const handleDownloadPDF = () => {
    if (!order) return;
    generateReceiptPDF({
      company: {
        name: company?.name ?? "BUM ERP",
        address: company?.address,
        phone: company?.phone,
        taxId: company?.taxId,
      },
      orderNumber: order.number,
      date: new Date().toLocaleString("uz-UZ"),
      cashierName: cashierName,
      items: order.items.map((item) => ({
        name: item.productName,
        qty: item.qty,
        unitPrice: item.unitPrice,
        lineTotal: item.lineTotal,
      })),
      subtotal: order.totalAmount,
      taxTotal: 0,
      discountTotal: 0,
      totalAmount: order.totalAmount,
      paidAmount: total,
      change,
      paymentMethod: payMethod,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="relative bg-card border border-border rounded-2xl p-6 w-full max-w-sm shadow-2xl"
      >
        {/* Success */}
        <div className="flex flex-col items-center mb-4">
          <div className="h-14 w-14 rounded-full bg-emerald-500/10 flex items-center justify-center mb-2">
            <CheckCircle className="h-8 w-8 text-emerald-500" />
          </div>
          <h3 className="font-bold text-lg">Sotuv amalga oshdi!</h3>
          <p className="text-xs text-muted-foreground font-mono">{order?.number}</p>
        </div>

        <Separator />

        {/* Items */}
        {order && (
          <div className="my-3 space-y-1.5 max-h-40 overflow-y-auto">
            {order.items.map((item) => (
              <div key={item._id} className="flex justify-between text-sm">
                <span className="text-muted-foreground truncate max-w-[60%]">
                  {item.productName} × {item.qty}
                </span>
                <span className="font-medium">{fmt(item.lineTotal)} so'm</span>
              </div>
            ))}
          </div>
        )}

        <Separator />

        {/* Totals */}
        <div className="mt-3 space-y-1 text-sm">
          <div className="flex justify-between font-bold text-base">
            <span>Jami to'lov</span>
            <span className="text-primary">{fmt(total)} so'm</span>
          </div>
          <div className="flex justify-between text-muted-foreground">
            <span>To'lov usuli</span>
            <span>{PAY_LABELS[payMethod] ?? payMethod}</span>
          </div>
          {change > 0 && (
            <div className="flex justify-between font-bold text-emerald-600 dark:text-emerald-400">
              <span>Qaytim</span>
              <span>{fmt(change)} so'm</span>
            </div>
          )}
        </div>

        {/* Date */}
        <p className="text-center text-xs text-muted-foreground mt-3">
          {new Date().toLocaleString("uz-UZ")}
        </p>

        {/* Actions */}
        <div className="flex gap-2 mt-4">
          <Button variant="secondary" size="sm" className="flex-1" onClick={handlePrint}>
            <Printer className="h-4 w-4 mr-1" /> Chop
          </Button>
          <Button variant="secondary" size="sm" className="flex-1" onClick={handleDownloadPDF} disabled={!order}>
            <FileDown className="h-4 w-4 mr-1" /> PDF
          </Button>
          <Button size="sm" className="flex-1" onClick={onClose}>
            Yangi
          </Button>
        </div>
      </motion.div>
    </div>
  );
}
