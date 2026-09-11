/**
 * POS chek PDF (80 mm termal ko'rinishda).
 * Chet valyutadagi qator o'z valyutasida, oxirida valyuta bo'yicha jami, to'langan va qaytim;
 * balans/keshbekdan to'lov, qaytim balansga va qarz ham chiqadi.
 */
import jsPDF from "jspdf";
import { fmtNum } from "./pdf-utils.ts";

export type ReceiptItem = {
  name: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
  /** Chet valyutadagi qator: valyuta va shu valyutadagi summa. */
  currency?: string | null;
  currencyTotal?: number;
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
  /** Asosiy valyutada mijoz bergan summa (qaytim bilan). */
  paidAmount: number;
  change: number;
  paymentMethod: string;
  /** Asosiy valyuta yozuvi; standart "so'm". */
  currency?: string;
  /** Pulsiz to'lovlar (keshbek, balans) — asosiy valyutada. */
  extraPayments?: { label: string; amount: number }[];
  /** Chet valyuta qatnashgan chek: valyuta bo'yicha jami, to'langan va qaytim. */
  currencyTotals?: { currency: string; total: number; paid: number; change: number }[];
  changeToBalance?: number;
  debt?: number;
};

type CompanyInfo = {
  name: string;
  address?: string;
  phone?: string;
  taxId?: string;
};

type Rgb = [number, number, number];
type Row = { label: string; value: string; bold?: boolean; big?: boolean; color?: Rgb };

const DARK: Rgb = [20, 20, 40];
const MUTED: Rgb = [100, 100, 130];
const GREEN: Rgb = [34, 150, 80];
const RED: Rgb = [220, 50, 50];
const AMBER: Rgb = [180, 110, 20];

const PAY_LABELS: Record<string, string> = {
  cash: "Naqd pul",
  card: "Plastik karta",
  bank: "Bank o'tkazmasi",
  transfer: "O'tkazma",
};

const PAGE_WIDTH = 80;

function drawReceipt(doc: jsPDF, data: ReceiptData): void {
  const currency = data.currency ?? "so'm";
  const sum = (n: number) => `${fmtNum(n)} ${currency}`;
  const inCurrency = (n: number, code: string) => `${fmtNum(n, 2)} ${code}`;
  const pw = PAGE_WIDTH;
  let y = 8;

  // Kompaniya
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(...DARK);
  doc.text(data.company.name, pw / 2, y, { align: "center" });
  y += 6;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...MUTED);
  for (const line of [data.company.address, data.company.phone, data.company.taxId ? `STIR: ${data.company.taxId}` : null]) {
    if (!line) continue;
    doc.text(line, pw / 2, y, { align: "center" });
    y += 4.5;
  }

  doc.setDrawColor(180, 180, 200);
  doc.setLineWidth(0.3);
  doc.line(5, y, pw - 5, y);
  y += 5;

  // Chek ma'lumotlari
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...DARK);
  doc.text("CHEK", pw / 2, y, { align: "center" });
  y += 5;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
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

  doc.line(5, y, pw - 5, y);
  y += 5;

  // Ustunlar
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

  // Qatorlar — chet valyutadagisi o'z valyutasida
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...DARK);
  for (const item of data.items) {
    const nameLines = doc.splitTextToSize(item.name, 38);
    doc.text(nameLines, 5, y);
    const lineH = nameLines.length * 4;
    const baseY = y + (lineH - 4) / 2;
    const foreign = item.currency ? { code: item.currency, total: item.currencyTotal ?? 0 } : null;
    doc.text(`×${fmtNum(item.qty, 1)}`, 44, baseY, { align: "right" });
    doc.text(foreign ? fmtNum(foreign.total / (item.qty || 1), 2) : fmtNum(item.unitPrice), 58, baseY, { align: "right" });
    doc.setFont("helvetica", "bold");
    doc.text(foreign ? inCurrency(foreign.total, foreign.code) : fmtNum(item.lineTotal), pw - 5, baseY, { align: "right" });
    doc.setFont("helvetica", "normal");
    y += Math.max(lineH, 5) + 1;
  }

  y += 2;
  doc.setDrawColor(180, 180, 200);
  doc.line(5, y, pw - 5, y);
  y += 5;

  // Jami va to'lovlar
  const byCurrency = data.currencyTotals ?? [];
  const extras = (data.extraPayments ?? []).filter((p) => p.amount > 0);
  const rows: Row[] = [
    { label: "Soliqsiz", value: sum(data.subtotal) },
    ...(data.discountTotal > 0 ? [{ label: "Chegirma", value: `-${sum(data.discountTotal)}`, color: RED }] : []),
    ...(data.taxTotal > 0 ? [{ label: "QQS", value: sum(data.taxTotal) }] : []),
  ];
  if (byCurrency.length > 0) {
    for (const part of byCurrency) rows.push({ label: `JAMI (${part.currency})`, value: inCurrency(part.total, part.currency), bold: true, big: true });
    for (const payment of extras) rows.push({ label: payment.label, value: sum(payment.amount) });
    for (const part of byCurrency) {
      if (part.paid > 0) rows.push({ label: `To'landi (${part.currency})`, value: inCurrency(part.paid + part.change, part.currency) });
      if (part.change > 0) rows.push({ label: `QAYTIM (${part.currency})`, value: inCurrency(part.change, part.currency), bold: true, color: GREEN });
    }
  } else {
    rows.push({ label: "JAMI", value: sum(data.totalAmount), bold: true, big: true });
    for (const payment of extras) rows.push({ label: payment.label, value: sum(payment.amount) });
    if (data.paidAmount > 0) rows.push({ label: PAY_LABELS[data.paymentMethod] ?? data.paymentMethod, value: sum(data.paidAmount) });
    if (data.change > 0) rows.push({ label: "QAYTIM", value: sum(data.change), bold: true, color: GREEN });
  }
  if ((data.changeToBalance ?? 0) > 0) rows.push({ label: "Qaytim balansga", value: `+${sum(data.changeToBalance!)}`, bold: true, color: GREEN });
  if ((data.debt ?? 0) > 0) rows.push({ label: "Qarzga yozildi", value: sum(data.debt!), bold: true, color: AMBER });

  for (const row of rows) {
    doc.setFont("helvetica", row.bold ? "bold" : "normal");
    doc.setFontSize(row.big ? 10.5 : 8.5);
    doc.setTextColor(...(row.color ?? DARK));
    doc.text(row.label, 5, y);
    doc.text(row.value, pw - 5, y, { align: "right" });
    y += row.big ? 6 : 5;
  }

  doc.setDrawColor(180, 180, 200);
  doc.line(5, y + 1, pw - 5, y + 1);
  y += 7;

  doc.setFont("helvetica", "italic");
  doc.setFontSize(8);
  doc.setTextColor(100, 100, 140);
  doc.text("Xaridingiz uchun rahmat!", pw / 2, y, { align: "center" });
  y += 4.5;
  doc.text("Qaytib keling!", pw / 2, y, { align: "center" });
}

function newReceiptDoc(): jsPDF {
  // 200 mm balandlik ko'p cheklar uchun yetarli (jsPDF sahifani keyin kichraytirmaydi)
  return new jsPDF({ unit: "mm", format: [PAGE_WIDTH, 200], orientation: "portrait" });
}

export function generateReceiptPDF(data: ReceiptData): void {
  const doc = newReceiptDoc();
  drawReceipt(doc, data);
  doc.save(`receipt-${data.orderNumber}.pdf`);
}

/** Chekni yangi oynada brauzer orqali chop etish uchun ochadi. */
export function printReceiptInBrowser(data: ReceiptData): void {
  const doc = newReceiptDoc();
  drawReceipt(doc, data);
  const url = doc.output("bloburl");
  const win = window.open(url as unknown as string, "_blank");
  if (win) {
    win.onload = () => win.print();
  }
}
