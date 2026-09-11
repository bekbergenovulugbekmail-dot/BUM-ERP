import { useEffect, useRef } from "react";
import { motion } from "motion/react";
import { CheckCircle, Printer, FileDown } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Separator } from "@/components/ui/separator.tsx";
import { generateReceiptPDF } from "@/lib/pdf/receipt-pdf.ts";
import { useActiveCompany } from "@/hooks/use-company.ts";
import { usePrintSettings } from "@/hooks/use-print-settings.ts";
import { buildReceiptHtml, printHtml, type ReceiptDocument } from "@/lib/print/receipt-html.ts";
import {
  PAYMENT_LABELS, num, type PaymentMethod, type PosCustomerSummary, type SalesOrderDetail,
} from "@/pages/sales/_lib/types.ts";

const fmt = (n: number) => new Intl.NumberFormat("uz-UZ").format(Math.round(n));

type Props = {
  /** `POST /api/sales/pos/sales` javobidagi buyurtma — summalar serverniki. */
  order: SalesOrderDetail;
  /** Chekka yozilgan to'lov (chek summasidan oshmaydi). */
  paid: string;
  change: string;
  payMethod: PaymentMethod;
  /** Mijoz balansidan yechilgan summa. */
  balanceUsed?: string;
  /** Mijozga berilmay balansiga yozilgan qaytim. */
  changeToBalance?: string;
  /** Shu chekdan qarzga yozilgan summa. */
  debt?: string;
  /** Keshbek bilan to'langan summa va shu chekdan hisoblangan keshbek. */
  cashbackUsed?: string;
  cashbackEarned?: string;
  /** Sotuvdan keyingi mijoz holati (umumiy qarz va balans). */
  customer?: PosCustomerSummary | null;
  onClose: () => void;
  cashierName?: string;
};

export default function POSReceipt({
  order, paid, change, payMethod, balanceUsed, changeToBalance, debt, cashbackUsed, cashbackEarned, customer,
  onClose, cashierName,
}: Props) {
  const company = useActiveCompany().data?.company;
  const total = num(order.totalAmount);
  const changeAmount = num(change);

  const { receipt: template, isLoaded: templateLoaded } = usePrintSettings();

  // Chop etish sozlamalardagi shablon bo'yicha (termal chek HTML)
  const receiptDocument = (): ReceiptDocument => ({
    company: {
      name: company?.name ?? "BUM ERP",
      address: company?.address,
      phone: company?.phone,
      taxId: company?.taxId,
    },
    number: order.number,
    date: new Date(order.createdAt).toLocaleString("uz-UZ"),
    cashierName,
    items: order.items.map((item) => ({
      name: item.productName,
      sku: item.productSku,
      quantity: num(item.quantity),
      unitPrice: num(item.unitPrice),
      lineTotal: num(item.lineTotal),
    })),
    taxAmount: num(order.taxAmount),
    discountAmount: num(order.discountAmount),
    totalAmount: total,
    payments: [
      { label: "Keshbekdan", amount: num(cashbackUsed) },
      { label: "Balansdan", amount: num(balanceUsed) },
      // Mijoz bergan summa: chekka yozilgan to'lov + qaytim (balansga o'tgani ham)
      { label: PAYMENT_LABELS[payMethod] ?? payMethod, amount: num(paid) + changeAmount + num(changeToBalance) },
    ],
    change: changeAmount,
    changeToBalance: num(changeToBalance),
    debt: num(debt),
    customer: customer
      ? { name: customer.name, phone: customer.phone, totalDebt: num(customer.totalDebt), balance: num(customer.balance) }
      : null,
    cashback: customer ? { earned: num(cashbackEarned), balance: num(customer.cashbackBalance) } : null,
  });
  const handlePrint = () => printHtml(buildReceiptHtml(receiptDocument(), template));

  // Avtomatik chop etish — shablon yuklangach, bir marta
  const autoPrinted = useRef(false);
  useEffect(() => {
    if (!templateLoaded || autoPrinted.current) return;
    autoPrinted.current = true;
    if (template.autoPrint) handlePrint();
  });

  const handleDownloadPDF = () => {
    generateReceiptPDF({
      company: {
        name: company?.name ?? "BUM ERP",
        address: company?.address ?? undefined,
        phone: company?.phone ?? undefined,
        taxId: company?.taxId ?? undefined,
      },
      orderNumber: order.number,
      date: new Date(order.createdAt).toLocaleString("uz-UZ"),
      cashierName,
      items: order.items.map((item) => ({
        name: item.productName,
        qty: num(item.quantity),
        unitPrice: num(item.unitPrice),
        lineTotal: num(item.lineTotal),
      })),
      subtotal: num(order.subtotal),
      taxTotal: num(order.taxAmount),
      discountTotal: num(order.discountAmount),
      totalAmount: total,
      // Mijoz bergan summa = chekka yozilgan to'lov + qaytim
      paidAmount: num(paid) + changeAmount,
      change: changeAmount,
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
          <p className="text-xs text-muted-foreground font-mono">{order.number}</p>
        </div>

        <Separator />

        {/* Items */}
        <div className="my-3 space-y-1.5 max-h-40 overflow-y-auto">
          {order.items.map((item) => (
            <div key={item.id} className="flex justify-between text-sm">
              <span className="text-muted-foreground truncate max-w-[60%]">
                {item.productName} × {num(item.quantity)}
              </span>
              <span className="font-medium">{fmt(num(item.lineTotal))} so'm</span>
            </div>
          ))}
        </div>

        <Separator />

        {/* Totals */}
        <div className="mt-3 space-y-1 text-sm">
          {num(order.taxAmount) > 0 && (
            <div className="flex justify-between text-muted-foreground">
              <span>shu jumladan QQS</span>
              <span>{fmt(num(order.taxAmount))} so'm</span>
            </div>
          )}
          <div className="flex justify-between font-bold text-base">
            <span>Jami to'lov</span>
            <span className="text-primary">{fmt(total)} so'm</span>
          </div>
          <div className="flex justify-between text-muted-foreground">
            <span>To'lov usuli</span>
            <span>{PAYMENT_LABELS[payMethod] ?? payMethod}</span>
          </div>
          {num(cashbackUsed) > 0 && (
            <div className="flex justify-between text-muted-foreground">
              <span>Keshbekdan to'landi</span>
              <span>{fmt(num(cashbackUsed))} so'm</span>
            </div>
          )}
          {num(balanceUsed) > 0 && (
            <div className="flex justify-between text-muted-foreground">
              <span>Balansdan to'landi</span>
              <span>{fmt(num(balanceUsed))} so'm</span>
            </div>
          )}
          {num(debt) > 0 && (
            <div className="flex justify-between font-semibold text-amber-600 dark:text-amber-400">
              <span>Qarzga</span>
              <span>{fmt(num(debt))} so'm</span>
            </div>
          )}
          {changeAmount > 0 && (
            <div className="flex justify-between font-bold text-emerald-600 dark:text-emerald-400">
              <span>Qaytim</span>
              <span>{fmt(changeAmount)} so'm</span>
            </div>
          )}
          {num(changeToBalance) > 0 && (
            <div className="flex justify-between font-semibold text-emerald-600 dark:text-emerald-400">
              <span>Qaytim balansga</span>
              <span>+{fmt(num(changeToBalance))} so'm</span>
            </div>
          )}
          {customer && (
            <div className="mt-2 pt-2 border-t border-dashed border-border space-y-1">
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">Mijoz</span>
                <span className="font-medium truncate">{customer.name}</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Umumiy qarz</span>
                <span>{fmt(Math.max(0, num(customer.totalDebt)))} so'm</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Balans</span>
                <span>{fmt(num(customer.balance))} so'm</span>
              </div>
              {(num(cashbackEarned) > 0 || num(customer.cashbackBalance) > 0) && (
                <div className="flex justify-between text-violet-600 dark:text-violet-400">
                  <span>Keshbek{num(cashbackEarned) > 0 ? ` (+${fmt(num(cashbackEarned))})` : ""}</span>
                  <span>{fmt(num(customer.cashbackBalance))} so'm</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Date */}
        <p className="text-center text-xs text-muted-foreground mt-3">
          {new Date(order.createdAt).toLocaleString("uz-UZ")}
        </p>

        {/* Actions */}
        <div className="flex gap-2 mt-4">
          <Button variant="secondary" size="sm" className="flex-1" onClick={handlePrint}>
            <Printer className="h-4 w-4 mr-1" /> Chop
          </Button>
          <Button variant="secondary" size="sm" className="flex-1" onClick={handleDownloadPDF}>
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
