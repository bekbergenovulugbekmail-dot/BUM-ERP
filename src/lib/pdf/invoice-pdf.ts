/**
 * Sales Invoice PDF Generator
 * Produces a professional A4 invoice for a sales order.
 */
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { CompanyInfo } from "./pdf-utils.ts";
import {
  PDF_COLORS,
  drawCompanyHeader, drawInfoBox, drawFooter, fmtNum, fmtMoney,
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

export function generateSalesInvoicePDF(data: InvoiceData): void {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const currency = data.currency ?? "so'm";

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
    theme: "grid",
    headStyles: {
      fillColor: PDF_COLORS.headerBg,
      textColor: PDF_COLORS.headerText,
      fontStyle: "bold",
      fontSize: 8.5,
      halign: "center",
    },
    bodyStyles: { fontSize: 8.5, textColor: PDF_COLORS.textDark },
    alternateRowStyles: { fillColor: PDF_COLORS.rowAlt },
    columnStyles: {
      0: { cellWidth: 8, halign: "center" },
      1: { cellWidth: 50 },
      2: { cellWidth: 22, textColor: PDF_COLORS.textMuted },
      3: { halign: "center" },
      4: { halign: "right" },
      5: { halign: "center" },
      6: { halign: "center" },
      7: { halign: "right", fontStyle: "bold" },
    },
    margin: { left: 14, right: 14 },
    styles: { lineColor: PDF_COLORS.border, lineWidth: 0.2 },
  });

  const tableY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;

  // Totals box (right side)
  const pw = doc.internal.pageSize.getWidth();
  const boxX = pw - 85;
  const boxW = 71;
  let ty = tableY;

  const totals: { label: string; value: string; bold?: boolean; color?: [number, number, number] }[] = [
    { label: "Subtotal:", value: fmtMoney(data.subtotal, currency) },
    ...(data.discountTotal > 0 ? [{ label: "Chegirma:", value: `-${fmtMoney(data.discountTotal, currency)}`, color: PDF_COLORS.red }] : []),
    ...(data.taxTotal > 0 ? [{ label: "Soliq:", value: fmtMoney(data.taxTotal, currency) }] : []),
    { label: "JAMI:", value: fmtMoney(data.totalAmount, currency), bold: true },
    { label: "To'langan:", value: fmtMoney(data.paidAmount, currency), color: PDF_COLORS.green },
    { label: "Qoldi:", value: fmtMoney(data.balance, currency), bold: true, color: data.balance > 0 ? PDF_COLORS.amber : PDF_COLORS.green },
  ];

  doc.setFillColor(...PDF_COLORS.rowAlt);
  doc.roundedRect(boxX - 2, ty - 2, boxW + 4, totals.length * 8 + 6, 3, 3, "F");

  totals.forEach((row, idx) => {
    const ry = ty + idx * 8 + 4;
    doc.setFont("helvetica", row.bold ? "bold" : "normal");
    doc.setFontSize(row.bold ? 10 : 9);
    doc.setTextColor(...(row.color ?? PDF_COLORS.textDark));
    doc.text(row.label, boxX + 2, ry);
    doc.text(row.value, boxX + boxW - 2, ry, { align: "right" });
  });

  // Notes
  if (data.notes) {
    const notesY = tableY;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(...PDF_COLORS.textMuted);
    doc.text("Izoh:", 14, notesY + 4);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(...PDF_COLORS.textDark);
    const lines = doc.splitTextToSize(data.notes, 100);
    doc.text(lines, 14, notesY + 11);
  }

  // Signature line
  const sigY = Math.max(
    tableY + totals.length * 8 + 18,
    (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 50
  );
  doc.setDrawColor(...PDF_COLORS.border);
  doc.line(14, sigY, 80, sigY);
  doc.line(pw - 80, sigY, pw - 14, sigY);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...PDF_COLORS.textMuted);
  doc.text("Sotuvchi imzosi", 47, sigY + 5, { align: "center" });
  doc.text("Mijoz imzosi", pw - 47, sigY + 5, { align: "center" });

  drawFooter(doc, `${data.company.name}  —  Hisob-faktura ${data.number}`);

  doc.save(`invoice-${data.number}.pdf`);
}
