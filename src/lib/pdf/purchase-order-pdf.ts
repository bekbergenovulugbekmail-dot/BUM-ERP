/**
 * Purchase Order PDF Generator
 */
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { CompanyInfo } from "./pdf-utils.ts";
import type { TotalRow } from "./pdf-utils.ts";
import {
  PDF_COLORS,
  afterTable, drawCompanyHeader, drawFooter, drawInfoBox, drawNotes, drawSignatures, drawTotalsBox,
  fmtMoney, fmtNum, tableOptions,
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

export function generatePurchaseOrderPDF(data: PurchaseOrderData): jsPDF {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  /** Har sahifada takrorlanadigan sarlavha. */
  const pageHeader = {
    title: "XARID BUYURTMASI",
    number: data.number,
    date: data.orderDate,
    rightLabel: "Holat",
    rightValue: STATUS_LABELS[data.status] ?? data.status,
  };

  let y = drawCompanyHeader(
    doc, data.company,
    pageHeader.title,
    pageHeader.number,
    pageHeader.date,
    pageHeader.rightLabel,
    pageHeader.rightValue,
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
    ...tableOptions(doc, data.company, pageHeader, {
      0: { cellWidth: 10, halign: "center" },
      1: { cellWidth: 55 },
      2: { cellWidth: 22, textColor: PDF_COLORS.textMuted },
      3: { halign: "center" },
      4: { halign: "center" },
      5: { halign: "right" },
      6: { halign: "right", fontStyle: "bold" },
    }),
  });

  const tableY = afterTable(doc);
  const rows: TotalRow[] = [
    { label: "Jami mahsulot:", value: `${fmtNum(data.items.length)} nomda` },
    { label: "JAMI:", value: fmtMoney(data.totalAmount, data.currency), bold: true },
    { label: "To'langan:", value: fmtMoney(data.paidAmount, data.currency), color: PDF_COLORS.green },
    { label: "Qoldi:", value: fmtMoney(data.balance, data.currency), bold: true, color: data.balance > 0 ? PDF_COLORS.amber : PDF_COLORS.green },
  ];
  let y2 = drawTotalsBox(doc, tableY, rows, data.company, pageHeader);
  if (data.notes) y2 = Math.max(y2, drawNotes(doc, tableY, data.notes, data.company, pageHeader));
  drawSignatures(doc, y2, data.company, pageHeader, ["Yetkazuvchi (imzo)", "Qabul qildi (imzo)"]);

  drawFooter(doc, `${data.company.name}  —  Xarid buyurtmasi ${data.number}`);
  doc.save(`purchase-order-${data.number}.pdf`);
  return doc;
}
