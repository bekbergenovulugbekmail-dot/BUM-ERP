/**
 * Purchase Order PDF Generator
 */
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { CompanyInfo } from "./pdf-utils.ts";
import {
  PDF_COLORS,
  drawCompanyHeader, drawInfoBox, drawFooter, fmtNum, fmtMoney,
} from "./pdf-utils.ts";

export type POItem = {
  productName: string;
  productSku: string;
  orderedQty: number;
  receivedQty: number;
  unitName: string;
  unitPrice: number;
  lineTotal: number;
};

export type PurchaseOrderData = {
  company: CompanyInfo;
  number: string;
  orderDate: string;
  expectedDate?: string;
  supplierName: string;
  supplierPhone?: string;
  warehouseName: string;
  items: POItem[];
  totalAmount: number;
  paidAmount: number;
  balance: number;
  currency: string;
  notes?: string;
  status: string;
  paymentTerms?: number;
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Qoralama",
  confirmed: "Tasdiqlangan",
  partial: "Qisman qabul",
  received: "Qabul qilindi",
  paid: "To'langan",
  cancelled: "Bekor",
};

export function generatePurchaseOrderPDF(data: PurchaseOrderData): void {
  const doc = new jsPDF({ unit: "mm", format: "a4" });

  let y = drawCompanyHeader(
    doc, data.company,
    "XARID BUYURTMASI",
    data.number,
    data.orderDate,
    "Holat",
    STATUS_LABELS[data.status] ?? data.status
  );

  y = drawInfoBox(doc, y, [
    { label: "Yetkazuvchi", value: data.supplierName },
    { label: "Ombor", value: data.warehouseName },
    ...(data.supplierPhone ? [{ label: "Telefon", value: data.supplierPhone }] : []),
    ...(data.expectedDate ? [{ label: "Kutilayotgan sana", value: data.expectedDate }] : []),
    ...(data.paymentTerms ? [{ label: "To'lov muddati", value: `${data.paymentTerms} kun` }] : []),
    { label: "Valyuta", value: data.currency },
  ], 2);

  y += 4;

  autoTable(doc, {
    startY: y,
    head: [["#", "Mahsulot", "SKU", "Buyurtma", "Qabul", "Narxi", "Jami"]],
    body: data.items.map((item, i) => [
      String(i + 1),
      item.productName,
      item.productSku,
      `${fmtNum(item.orderedQty, 2)} ${item.unitName}`,
      `${fmtNum(item.receivedQty, 2)} ${item.unitName}`,
      fmtMoney(item.unitPrice, data.currency),
      fmtMoney(item.lineTotal, data.currency),
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
      0: { cellWidth: 10, halign: "center" },
      1: { cellWidth: 55 },
      2: { cellWidth: 22, textColor: PDF_COLORS.textMuted },
      3: { halign: "center" },
      4: { halign: "center" },
      5: { halign: "right" },
      6: { halign: "right", fontStyle: "bold" },
    },
    margin: { left: 14, right: 14 },
    styles: { lineColor: PDF_COLORS.border, lineWidth: 0.2 },
  });

  const tableY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
  const pw = doc.internal.pageSize.getWidth();
  const boxX = pw - 80;

  const rows = [
    { label: "JAMI:", value: fmtMoney(data.totalAmount, data.currency), bold: true },
    { label: "To'langan:", value: fmtMoney(data.paidAmount, data.currency), color: PDF_COLORS.green as [number, number, number] },
    { label: "Qoldi:", value: fmtMoney(data.balance, data.currency), bold: true, color: data.balance > 0 ? PDF_COLORS.amber as [number, number, number] : PDF_COLORS.green as [number, number, number] },
  ];

  doc.setFillColor(...PDF_COLORS.rowAlt);
  doc.roundedRect(boxX - 2, tableY - 2, 70, rows.length * 8 + 6, 3, 3, "F");

  rows.forEach((row, idx) => {
    const ry = tableY + idx * 8 + 4;
    doc.setFont("helvetica", row.bold ? "bold" : "normal");
    doc.setFontSize(row.bold ? 10 : 9);
    doc.setTextColor(...(row.color ?? PDF_COLORS.textDark));
    doc.text(row.label, boxX + 2, ry);
    doc.text(row.value, boxX + 66, ry, { align: "right" });
  });

  if (data.notes) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(...PDF_COLORS.textMuted);
    doc.text("Izoh:", 14, tableY + 4);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...PDF_COLORS.textDark);
    const lines = doc.splitTextToSize(data.notes, 100);
    doc.text(lines, 14, tableY + 11);
  }

  drawFooter(doc, `${data.company.name}  —  Xarid buyurtmasi ${data.number}`);
  doc.save(`purchase-order-${data.number}.pdf`);
}
