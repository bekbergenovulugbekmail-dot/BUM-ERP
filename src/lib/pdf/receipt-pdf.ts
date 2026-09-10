/**
 * POS Thermal Receipt PDF Generator
 * Produces a 80mm thermal-style receipt.
 */
import jsPDF from "jspdf";
import { fmtNum } from "./pdf-utils.ts";

export type ReceiptItem = {
  name: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
};

export type ReceiptData = {
  company: CompanyInfo;
  orderNumber: string;
  date: string;
  cashierName?: string;
  shiftNumber?: string;
  items: ReceiptItem[];
  subtotal: number;
  taxTotal: number;
  discountTotal: number;
  totalAmount: number;
  paidAmount: number;
  change: number;
  paymentMethod: string;
  currency?: string;
};

type CompanyInfo = {
  name: string;
  address?: string;
  phone?: string;
  taxId?: string;
};

const PAY_LABELS: Record<string, string> = {
  cash: "Naqd pul",
  card: "Plastik karta",
  bank: "Bank o'tkazmasi",
  transfer: "O'tkazma",
};

export function generateReceiptPDF(data: ReceiptData): void {
  // 80mm wide thermal format
  const doc = new jsPDF({ unit: "mm", format: [80, 200], orientation: "portrait" });
  const currency = data.currency ?? "so'm";
  const pw = 80;
  let y = 8;

  // Company name header
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(20, 20, 40);
  doc.text(data.company.name, pw / 2, y, { align: "center" });
  y += 6;

  if (data.company.address) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(100, 100, 130);
    doc.text(data.company.address, pw / 2, y, { align: "center" });
    y += 4.5;
  }
  if (data.company.phone) {
    doc.text(data.company.phone, pw / 2, y, { align: "center" });
    y += 4.5;
  }
  if (data.company.taxId) {
    doc.text(`TIN: ${data.company.taxId}`, pw / 2, y, { align: "center" });
    y += 4.5;
  }

  // Divider
  doc.setDrawColor(180, 180, 200);
  doc.setLineWidth(0.3);
  doc.line(5, y, pw - 5, y);
  y += 5;

  // Order info
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(20, 20, 40);
  doc.text("CHEK", pw / 2, y, { align: "center" });
  y += 5;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(100, 100, 130);
  doc.text(`# ${data.orderNumber}`, 5, y);
  doc.text(data.date, pw - 5, y, { align: "right" });
  y += 4.5;

  if (data.cashierName) {
    doc.text(`Kassir: ${data.cashierName}`, 5, y);
    y += 4.5;
  }
  if (data.shiftNumber) {
    doc.text(`Smena: ${data.shiftNumber}`, 5, y);
    y += 4.5;
  }

  // Divider
  doc.line(5, y, pw - 5, y);
  y += 5;

  // Column headers
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(60, 60, 80);
  doc.text("Mahsulot", 5, y);
  doc.text("Soni", 44, y, { align: "right" });
  doc.text("Narxi", 58, y, { align: "right" });
  doc.text("Jami", pw - 5, y, { align: "right" });
  y += 4;

  doc.setDrawColor(200, 200, 220);
  doc.line(5, y, pw - 5, y);
  y += 4;

  // Items
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(20, 20, 40);

  data.items.forEach((item) => {
    // Name (wrap if too long)
    const nameLines = doc.splitTextToSize(item.name, 38);
    doc.text(nameLines, 5, y);
    const lineH = nameLines.length * 4;
    const baseY = y + (lineH - 4) / 2;
    doc.text(`×${fmtNum(item.qty, 1)}`, 44, baseY, { align: "right" });
    doc.text(fmtNum(item.unitPrice), 58, baseY, { align: "right" });
    doc.setFont("helvetica", "bold");
    doc.text(fmtNum(item.lineTotal), pw - 5, baseY, { align: "right" });
    doc.setFont("helvetica", "normal");
    y += Math.max(lineH, 5) + 1;
  });

  // Divider
  y += 2;
  doc.setDrawColor(180, 180, 200);
  doc.line(5, y, pw - 5, y);
  y += 5;

  // Totals
  const totals: { label: string; value: string; bold?: boolean; big?: boolean; color?: [number, number, number] }[] = [
    { label: "Subtotal", value: `${fmtNum(data.subtotal)} ${currency}` },
    ...(data.discountTotal > 0 ? [{ label: "Chegirma", value: `-${fmtNum(data.discountTotal)} ${currency}`, color: [220, 50, 50] as [number, number, number] }] : []),
    ...(data.taxTotal > 0 ? [{ label: "Soliq", value: `${fmtNum(data.taxTotal)} ${currency}` }] : []),
    { label: "JAMI", value: `${fmtNum(data.totalAmount)} ${currency}`, bold: true, big: true },
    { label: PAY_LABELS[data.paymentMethod] ?? data.paymentMethod, value: `${fmtNum(data.paidAmount)} ${currency}` },
    ...(data.change > 0 ? [{ label: "QAYTIM", value: `${fmtNum(data.change)} ${currency}`, bold: true, color: [34, 150, 80] as [number, number, number] }] : []),
  ];

  totals.forEach((row) => {
    doc.setFont("helvetica", row.bold ? "bold" : "normal");
    doc.setFontSize(row.big ? 10.5 : 8.5);
    doc.setTextColor(...(row.color ?? ([20, 20, 40] as [number, number, number])));
    doc.text(row.label, 5, y);
    doc.text(row.value, pw - 5, y, { align: "right" });
    y += row.big ? 6 : 5;
  });

  // Bottom divider
  doc.setDrawColor(180, 180, 200);
  doc.line(5, y + 1, pw - 5, y + 1);
  y += 7;

  // Thank you message
  doc.setFont("helvetica", "italic");
  doc.setFontSize(8);
  doc.setTextColor(100, 100, 140);
  doc.text("Xaridingiz uchun rahmat!", pw / 2, y, { align: "center" });
  y += 4.5;
  doc.text("Qaytib keling!", pw / 2, y, { align: "center" });

  // Resize page height to content
  const finalPageH = Math.max(y + 12, 100);
  // Note: jsPDF doesn't allow dynamic page resize after creation,
  // but the 200mm height is enough for most receipts.

  doc.save(`receipt-${data.orderNumber}.pdf`);
}

/** Open receipt in a new window for browser printing */
export function printReceiptInBrowser(data: ReceiptData): void {
  const doc = new jsPDF({ unit: "mm", format: [80, 200] });
  generateReceiptPDFToDoc(doc, data);
  const url = doc.output("bloburl");
  const win = window.open(url as unknown as string, "_blank");
  if (win) {
    win.onload = () => win.print();
  }
}

function generateReceiptPDFToDoc(doc: jsPDF, data: ReceiptData): void {
  // Re-use same logic, just writes to provided doc
  const currency = data.currency ?? "so'm";
  const pw = 80;
  let y = 8;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(20, 20, 40);
  doc.text(data.company.name, pw / 2, y, { align: "center" });
  y += 6;

  if (data.company.address) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(100, 100, 130);
    doc.text(data.company.address, pw / 2, y, { align: "center" });
    y += 4.5;
  }
  if (data.company.phone) {
    doc.text(data.company.phone, pw / 2, y, { align: "center" });
    y += 4.5;
  }

  doc.setDrawColor(180, 180, 200);
  doc.line(5, y, pw - 5, y);
  y += 5;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(20, 20, 40);
  doc.text("CHEK", pw / 2, y, { align: "center" });
  y += 5;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(100, 100, 130);
  doc.text(`# ${data.orderNumber}`, 5, y);
  doc.text(data.date, pw - 5, y, { align: "right" });
  y += 4.5;

  doc.line(5, y, pw - 5, y);
  y += 5;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.text("Mahsulot", 5, y);
  doc.text("Soni", 44, y, { align: "right" });
  doc.text("Narxi", 58, y, { align: "right" });
  doc.text("Jami", pw - 5, y, { align: "right" });
  y += 4;
  doc.setDrawColor(200, 200, 220);
  doc.line(5, y, pw - 5, y);
  y += 4;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(20, 20, 40);

  data.items.forEach((item) => {
    const nameLines = doc.splitTextToSize(item.name, 38);
    doc.text(nameLines, 5, y);
    const lineH = nameLines.length * 4;
    const baseY = y + (lineH - 4) / 2;
    doc.text(`×${fmtNum(item.qty, 1)}`, 44, baseY, { align: "right" });
    doc.text(fmtNum(item.unitPrice), 58, baseY, { align: "right" });
    doc.setFont("helvetica", "bold");
    doc.text(fmtNum(item.lineTotal), pw - 5, baseY, { align: "right" });
    doc.setFont("helvetica", "normal");
    y += Math.max(lineH, 5) + 1;
  });

  y += 2;
  doc.setDrawColor(180, 180, 200);
  doc.line(5, y, pw - 5, y);
  y += 5;

  const totals = [
    { label: "JAMI", value: `${fmtNum(data.totalAmount)} ${currency}`, bold: true, big: true },
    { label: "To'landi", value: `${fmtNum(data.paidAmount)} ${currency}` },
    ...(data.change > 0 ? [{ label: "QAYTIM", value: `${fmtNum(data.change)} ${currency}`, bold: true }] : []),
  ];

  totals.forEach((row) => {
    doc.setFont("helvetica", row.bold ? "bold" : "normal");
    doc.setFontSize(row.big ? 11 : 9);
    doc.setTextColor(20, 20, 40);
    doc.text(row.label, 5, y);
    doc.text(row.value, pw - 5, y, { align: "right" });
    y += row.big ? 6 : 5;
  });

  doc.line(5, y + 1, pw - 5, y + 1);
  y += 7;

  doc.setFont("helvetica", "italic");
  doc.setFontSize(8);
  doc.setTextColor(100, 100, 140);
  doc.text("Xaridingiz uchun rahmat!", pw / 2, y, { align: "center" });
}
