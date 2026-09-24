/**
 * Sales Invoice PDF Generator
 * Produces a professional A4 invoice for a sales order.
 */
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { CompanyInfo, TotalRow } from "./pdf-utils.ts";
import {
  createDocument,
  PDF_COLORS,
  afterTable, drawCompanyHeader, drawFooter, drawInfoBox, drawNotes, drawSignatures, drawTotalsBox,
  fmtMoney, fmtNum, tableOptions,
} from "./pdf-utils.ts";

export type InvoiceItem = {
  name: string;
  sku: string;
  qty: number;
  unit: string;
  unitPrice: number;
  discount: number;
  taxRate: number;
  lineTotal: number;
};

export type InvoiceData = {
  company: CompanyInfo;
  number: string;
  date: string;
  deliveryDate?: string;
  customerName: string;
  customerPhone?: string;
  customerAddress?: string;
  warehouseName: string;
  items: InvoiceItem[];
  subtotal: number;
  taxTotal: number;
  discountTotal: number;
  totalAmount: number;
  paidAmount: number;
  balance: number;
  currency?: string;
  notes?: string;
  status: string;
  paymentMethod?: string;
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Qoralama",
  confirmed: "Tasdiqlangan",
  shipped: "Jo'natilgan",
  delivered: "Yetkazilgan",
  returned: "Qaytarilgan",
  cancelled: "Bekor qilindi",
};

const STATUS_COLORS: Record<string, [number, number, number]> = {
  draft: [120, 120, 140],
  confirmed: [59, 130, 246],
  shipped: [245, 158, 11],
  delivered: [34, 197, 94],
  returned: [239, 68, 68],
  cancelled: [239, 68, 68],
};

export async function generateSalesInvoicePDF(data: InvoiceData): Promise<jsPDF> {
  const doc = await createDocument();
  const currency = data.currency ?? "so'm";
  /** Har sahifada takrorlanadigan sarlavha (50+ qatorli nakladnoyda 2-sahifa ham to'liq hujjat). */
  const pageHeader = {
    title: "HISOB-FAKTURA",
    number: data.number,
    date: data.date,
    rightLabel: "Holat",
    rightValue: STATUS_LABELS[data.status] ?? data.status,
  };

  let y = drawCompanyHeader(
    doc, data.company,
    "HISOB-FAKTURA",
    data.number,
    data.date,
    "Holat",
    STATUS_LABELS[data.status] ?? data.status
  );

  // Status badge
  const statusColor = STATUS_COLORS[data.status] ?? PDF_COLORS.primary;
  doc.setFillColor(...statusColor);
  doc.roundedRect(14, y - 2, 40, 7, 2, 2, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(255, 255, 255);
  doc.text(STATUS_LABELS[data.status] ?? data.status, 34, y + 2.5, { align: "center" });

  y += 12;

  // Customer + Warehouse info
  y = drawInfoBox(doc, y, [
    { label: "Mijoz", value: data.customerName },
    { label: "Ombor", value: data.warehouseName },
    ...(data.customerPhone ? [{ label: "Telefon", value: data.customerPhone }] : []),
    ...(data.deliveryDate ? [{ label: "Yetkazish sanasi", value: data.deliveryDate }] : []),
    ...(data.customerAddress ? [{ label: "Manzil", value: data.customerAddress, wide: true }] : []),
  ], 2);

  y += 4;

  // Items table
  autoTable(doc, {
    startY: y,
    head: [["#", "Mahsulot", "SKU", "Miqdor", "Narxi", "Chegirma", "Soliq", "Jami"]],
    body: data.items.map((item, i) => [
      String(i + 1),
      item.name,
      item.sku,
      `${fmtNum(item.qty, 2)} ${item.unit}`,
      fmtMoney(item.unitPrice, currency),
      item.discount > 0 ? `${item.discount}%` : "—",
      item.taxRate > 0 ? `${item.taxRate}%` : "—",
      fmtMoney(item.lineTotal, currency),
    ]),
    ...tableOptions(doc, data.company, pageHeader, {
      0: { cellWidth: 8, halign: "center" },
      1: { cellWidth: 50 },
      2: { cellWidth: 22, textColor: PDF_COLORS.textMuted },
      3: { halign: "center" },
      4: { halign: "right" },
      5: { halign: "center" },
      6: { halign: "center" },
      7: { halign: "right", fontStyle: "bold" },
    }),
  });

  const tableY = afterTable(doc);

  // Jami — faqat oxirgi sahifada; hujjat turida yo'q maydon ko'rsatilmaydi (soxta qator yo'q)
  const totals: TotalRow[] = [
    { label: "Jami mahsulot:", value: `${fmtNum(data.items.length)} nomda` },
    { label: "Subtotal:", value: fmtMoney(data.subtotal, currency) },
    ...(data.discountTotal > 0 ? [{ label: "Chegirma:", value: `-${fmtMoney(data.discountTotal, currency)}`, color: PDF_COLORS.red }] : []),
    ...(data.taxTotal > 0 ? [{ label: "Soliq:", value: fmtMoney(data.taxTotal, currency) }] : []),
    { label: "JAMI:", value: fmtMoney(data.totalAmount, currency), bold: true },
    { label: "To'langan:", value: fmtMoney(data.paidAmount, currency), color: PDF_COLORS.green },
    { label: "Qoldi:", value: fmtMoney(data.balance, currency), bold: true, color: data.balance > 0 ? PDF_COLORS.amber : PDF_COLORS.green },
  ];
  let blockY = drawTotalsBox(doc, tableY, totals, data.company, pageHeader);
  if (data.notes) blockY = Math.max(blockY, drawNotes(doc, tableY, data.notes, data.company, pageHeader));
  drawSignatures(doc, blockY, data.company, pageHeader, ["Sotuvchi (imzo)", "Mijoz (imzo)"]);

  drawFooter(doc, `${data.company.name}  —  Hisob-faktura ${data.number}`);

  doc.save(`invoice-${data.number}.pdf`);
  return doc;
}
