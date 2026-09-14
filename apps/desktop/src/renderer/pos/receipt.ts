/** Chek: web bilan bir xil termal shablon (`buildReceiptHtml`), kompaniya sozlamasi + qurilma qog'oz kengligi. */
import { DEFAULT_RECEIPT_TEMPLATE, currencySymbol, type ReceiptTemplate } from "@bum/shared";
import { buildReceiptHtml, sampleReceipt, type ReceiptDocument } from "@/lib/print/receipt-html.ts";
import type { DevicePrefs, LocalSale, PosContext } from "../../shared/kassa-api.js";
import { PAYMENT_LABELS, num } from "../format.ts";
import { call } from "../kassa.ts";
import { paymentPartLabel } from "./terminals.ts";

export function receiptTemplate(context: PosContext | null, prefs: DevicePrefs): ReceiptTemplate {
  return { ...DEFAULT_RECEIPT_TEMPLATE, ...((context?.receipt ?? {}) as Partial<ReceiptTemplate>), paperWidth: prefs.paperWidth };
}

function companyOf(context: PosContext | null): ReceiptDocument["company"] {
  return {
    name: context?.company?.name ?? "BUM ERP",
    address: context?.company?.address ?? null,
    phone: context?.company?.phone ?? null,
    taxId: context?.company?.taxId ?? null,
  };
}

export function saleDocument(sale: LocalSale, context: PosContext | null): ReceiptDocument {
  return {
    company: companyOf(context),
    number: sale.number,
    date: new Date(sale.createdAt).toLocaleString("uz-UZ"),
    cashierName: sale.cashierName,
    items: sale.lines.map((line) => ({
      name: line.name,
      sku: line.sku,
      quantity: num(line.quantity),
      unitPrice: num(line.unitPrice),
      lineTotal: num(line.lineTotal),
      currency: line.currency,
      currencyTotal: num(line.currencyTotal),
    })),
    currencyTotals: sale.currencyTotals.map((part) => ({ currency: part.currency, total: num(part.total), paid: num(part.paid), change: num(part.change) })),
    taxAmount: num(sale.tax),
    discountAmount: num(sale.discount),
    totalAmount: num(sale.total),
    payments: [
      { label: "Keshbekdan", amount: num(sale.cashbackUsed) },
      { label: "Balansdan", amount: num(sale.balanceUsed) },
      // Aralash to'lov — har usul alohida qatorda (berilgan summa, naqdda qaytim bilan)
      ...(sale.payments?.length
        ? sale.payments.map((part) => ({ label: paymentPartLabel(part), amount: num(part.tendered) }))
        : [{ label: PAYMENT_LABELS[sale.paymentMethod] ?? sale.paymentMethod, amount: num(sale.tendered) }]),
    ],
    change: num(sale.change),
    changeToBalance: num(sale.changeToBalance),
    debt: num(sale.debt),
    customer:
      sale.customer && sale.customerAfter
        ? { name: sale.customer.name, phone: sale.customer.phone, totalDebt: num(sale.customerAfter.totalDebt), balance: num(sale.customerAfter.balance) }
        : null,
    cashback: sale.customer && sale.customerAfter ? { earned: num(sale.cashbackEarned), balance: num(sale.customerAfter.cashbackBalance) } : null,
    currencyLabel: currencySymbol(context?.baseCurrency ?? "UZS"),
  };
}

export async function printSale(sale: LocalSale, context: PosContext | null, prefs: DevicePrefs): Promise<void> {
  await call("device:print", { html: buildReceiptHtml(saleDocument(sale, context), receiptTemplate(context, prefs)) });
}

export async function printSample(context: PosContext | null, prefs: DevicePrefs, cashierName: string | null): Promise<void> {
  await call("device:print", { html: buildReceiptHtml(sampleReceipt(companyOf(context), cashierName), receiptTemplate(context, prefs)) });
}
