/**
 * Ombor qoldig'i hisoboti — A4 (210 × 297 mm), ko'p sahifali (100 / 500 / 1000+ mahsulot).
 *
 * Ma'lumot FAQAT serverdan (`GET /api/inventory/stock/export`): qoldiq — `stock_levels.quantity`, tannarx — o'sha
 * ombordagi o'rtacha tannarx (AVCO, `stock_levels.avg_cost_price`). Qiymat = qoldiq × AVCO (qator bo'yicha 2 xonaga
 * yaxlitlab), jami — qatorlar yig'indisi; BigInt'da hisoblanadi (float xatosiz). Tannarx ruxsati bo'lmasa (server `null`
 * beradi) tannarx, qiymat va marja ustunlari umuman chiqmaydi — 0 yoki taxminiy raqam yozilmaydi.
 *
 * Har sahifada: kompaniya sarlavhasi va jadval sarlavhasi takrorlanadi, qator footer tasmasiga tushmaydi, qator ikki
 * sahifaga bo'linmaydi; jami bloki oxirida, sig'masa — yangi sahifada.
 */
import type jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { StockExportRow } from "@/pages/warehouse/_lib/stock-export.ts";
import type { CompanyInfo } from "./pdf-utils.ts";
import { A4, PDF_COLORS, afterTable, createDocument, drawCompanyHeader, drawFooter, drawInfoBox, ensureSpace, fmtNum, tableOptions } from "./pdf-utils.ts";

const minor = (value: string | null | undefined, scale: number) => {
  const text = (value ?? "0").trim() || "0";
  const negative = text.startsWith("-");
  const [whole = "0", fraction = ""] = text.replace(/^-/, "").split(".");
  const result = BigInt(whole || "0") * 10n ** BigInt(scale) + BigInt((fraction + "0".repeat(scale)).slice(0, scale) || "0");
  return negative ? -result : result;
};
/** a (scale from) → scale to, yarmidan yuqoriga yaxlitlash. */
const rescale = (value: bigint, from: number, to: number) => {
  if (from <= to) return value * 10n ** BigInt(to - from);
  const divisor = 10n ** BigInt(from - to);
  const half = divisor / 2n;
  return value >= 0n ? (value + half) / divisor : -((-value + half) / divisor);
};
const toText = (value: bigint, scale: number) => {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const base = 10n ** BigInt(scale);
  const fraction = scale > 0 ? `.${String(abs % base).padStart(scale, "0")}` : "";
  return `${negative ? "-" : ""}${abs / base}${fraction}`;
};

export type StockReportLine = {
  index: number;
  sku: string;
  barcode: string;
  name: string;
  unit: string;
  quantity: string;
  cost: string | null;
  value: string | null;
  salePrice: string | null;
  margin: string | null;
  marginPercent: string | null;
};

export type StockReport = {
  lines: StockReportLine[];
  costVisible: boolean;
  totals: { products: number; quantity: string; value: string | null };
};

/** Hisobot qatorlari va jami — PDF'dan mustaqil (testda va ekranda bir xil hisob). */
export function buildStockReport(rows: StockExportRow[], costVisible: boolean): StockReport {
  const sorted = [...rows].sort((a, b) => a.productName.localeCompare(b.productName));
  let quantity = 0n;
  let value = 0n;
  const lines = sorted.map((row, index): StockReportLine => {
    const qty = minor(row.quantity, 4);
    quantity += qty;
    const hasCost = costVisible && row.avgCostPrice !== null;
    const lineValue = hasCost ? rescale(qty * minor(row.avgCostPrice, 4), 8, 2) : null;
    if (lineValue !== null) value += lineValue;
    // Sotuv narxi — mahsulotning asosiy sotuv narxi (0 — narx qo'yilmagan, ko'rsatilmaydi); bo'lmasa chakana narx
    const salePrice = row.salesPrice && Number(row.salesPrice) > 0 ? row.salesPrice : row.retailPrice;
    const sale = salePrice !== null && salePrice !== undefined && salePrice !== "" ? minor(salePrice, 2) : null;
    const cost = hasCost ? rescale(minor(row.avgCostPrice, 4), 4, 2) : null;
    const margin = sale !== null && cost !== null ? sale - cost : null;
    return {
      index: index + 1,
      sku: row.productSku ?? "",
      barcode: row.productBarcode ?? "",
      name: row.productName,
      unit: row.unitName,
      quantity: toText(qty, 4),
      cost: hasCost ? toText(minor(row.avgCostPrice, 4), 4) : null,
      value: lineValue !== null ? toText(lineValue, 2) : null,
      salePrice: sale !== null ? toText(sale, 2) : null,
      margin: margin !== null ? toText(margin, 2) : null,
      marginPercent: margin !== null && sale !== null && sale > 0n ? toText(rescale((margin * 10_000n) / sale, 2, 1), 1) : null,
    };
  });
  return { lines, costVisible, totals: { products: lines.length, quantity: toText(quantity, 4), value: costVisible ? toText(value, 2) : null } };
}

const qty = (value: string) => fmtNum(Number(value), Number(value) % 1 === 0 ? 0 : 2);
const money = (value: string | null) => (value === null ? "" : fmtNum(Number(value), 0));

export async function generateStockReportPDF(
  rows: StockExportRow[],
  options: { company: CompanyInfo; warehouseName: string; costVisible: boolean; generatedBy: string; generatedAt?: Date; currency?: string; save?: boolean },
): Promise<{ doc: jsPDF; report: StockReport }> {
  const report = buildStockReport(rows, options.costVisible);
  const doc = await createDocument();
  const at = options.generatedAt ?? new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
  const stamp = `${date} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
  const header = { title: "OMBOR QOLDIG'I", number: options.warehouseName, date: stamp };
  const currency = options.currency ?? "so'm";

  const top = drawCompanyHeader(doc, options.company, header.title, header.number, header.date);
  const startY = drawInfoBox(
    doc,
    top,
    [
      { label: "Ombor", value: options.warehouseName },
      { label: "Sana va vaqt", value: stamp },
      { label: "Tuzdi", value: options.generatedBy || "—" },
      { label: "Baholash", value: options.costVisible ? "O'rtacha tannarx (AVCO)" : "Ko'rsatilmaydi (ruxsat yo'q)" },
    ],
    2,
  );

  const withCost = report.costVisible;
  const head = ["№", "SKU", "Shtrix-kod", "Mahsulot", "Birlik", "Miqdor", ...(withCost ? ["Tannarx", "Qiymat"] : []), "Sotuv narxi", ...(withCost ? ["Marja"] : [])];
  const body = report.lines.map((line) => [
    String(line.index),
    line.sku,
    line.barcode,
    line.name,
    line.unit,
    qty(line.quantity),
    ...(withCost ? [money(line.cost), money(line.value)] : []),
    money(line.salePrice),
    ...(withCost ? [line.margin === null ? "" : `${money(line.margin)}${line.marginPercent ? `\n${line.marginPercent}%` : ""}`] : []),
  ]);
  // Kengliklar jami 182 mm (A4 − 2 × 14 mm chet): mahsulot nomi qolgan joyni oladi va bo'linib ko'chadi
  const styles: Record<number, Record<string, unknown>> = withCost
    ? {
        0: { cellWidth: 8, halign: "center" },
        1: { cellWidth: 18 },
        2: { cellWidth: 23 },
        3: { cellWidth: "auto" },
        4: { cellWidth: 11, halign: "center" },
        5: { cellWidth: 15, halign: "right" },
        6: { cellWidth: 17, halign: "right" },
        7: { cellWidth: 20, halign: "right", fontStyle: "bold" },
        8: { cellWidth: 17, halign: "right" },
        9: { cellWidth: 15, halign: "right" },
      }
    : {
        0: { cellWidth: 9, halign: "center" },
        1: { cellWidth: 22 },
        2: { cellWidth: 28 },
        3: { cellWidth: "auto" },
        4: { cellWidth: 14, halign: "center" },
        5: { cellWidth: 20, halign: "right", fontStyle: "bold" },
        6: { cellWidth: 22, halign: "right" },
      };
  const base = tableOptions(doc, options.company, header, styles);
  autoTable(doc, {
    ...base,
    startY,
    head: [head],
    body,
    headStyles: { ...base.headStyles, fontSize: 7.5 },
    bodyStyles: { ...base.bodyStyles, fontSize: 7.5, cellPadding: 1.2 },
  });

  // Jami bloki — sig'masa yangi sahifada (footer ustiga tushmaydi)
  const lines: [string, string][] = [
    ["Mahsulotlar soni", fmtNum(report.totals.products)],
    ["Jami miqdor (asosiy birlikda)", qty(report.totals.quantity)],
    ...(report.totals.value !== null ? [["Ombor qiymati (tannarx, AVCO)", `${fmtNum(Number(report.totals.value), 0)} ${currency}`] as [string, string]] : []),
  ];
  let y = ensureSpace(doc, afterTable(doc), lines.length * 6 + 8, options.company, header);
  const width = 95;
  const x = A4.width - A4.marginX - width;
  doc.setDrawColor(...PDF_COLORS.border);
  doc.setFillColor(...PDF_COLORS.rowAlt);
  doc.rect(x, y, width, lines.length * 6 + 4, "FD");
  doc.setFontSize(9);
  doc.setTextColor(...PDF_COLORS.textDark);
  y += 6;
  doc.setFont("helvetica", "bold");
  doc.text("JAMI:", x + 3, y - 1.5);
  for (const [label, value] of lines) {
    doc.setFont("helvetica", "normal");
    doc.text(label, x + 16, y);
    doc.setFont("helvetica", "bold");
    doc.text(value, x + width - 3, y, { align: "right" });
    y += 6;
  }
  drawFooter(doc, `BUM ERP — ${options.warehouseName} — ${stamp}`);
  if (options.save !== false) doc.save(`ombor-qoldigi-${options.warehouseName.replace(/[^\p{L}\p{N}-]+/gu, "_")}-${date}.pdf`);
  return { doc, report };
}
