/**
 * Shared PDF generation utilities for BUM ERP.
 * Uses jsPDF + jspdf-autotable (client-side, no server needed).
 */
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { redirectHelvetica, applyUnicodeFont } from "./unicode-font.ts";

/**
 * Hujjat yaratishning YAGONA yo'li: har hujjat unicode shrift bilan ochiladi, shuning uchun
 * kirill ism va manzillar buzilmaydi. Shrift birinchi hujjatda yuklanadi va keshlanadi.
 */
export async function createDocument(options: { format?: string | number[]; orientation?: "portrait" | "landscape" } = {}): Promise<jsPDF> {
  const doc = new jsPDF({ unit: "mm", format: options.format ?? "a4", orientation: options.orientation ?? "portrait" });
  redirectHelvetica(doc, await applyUnicodeFont(doc));
  return doc;
}

// Brand colors (indigo palette matching ERP theme)
export const PDF_COLORS = {
  primary: [63, 81, 181] as [number, number, number],      // indigo-600
  primaryLight: [197, 202, 233] as [number, number, number], // indigo-200
  headerBg: [30, 40, 80] as [number, number, number],       // dark navy
  headerText: [255, 255, 255] as [number, number, number],
  rowAlt: [247, 248, 252] as [number, number, number],
  textDark: [20, 20, 40] as [number, number, number],
  textMuted: [100, 100, 130] as [number, number, number],
  green: [34, 197, 94] as [number, number, number],
  red: [239, 68, 68] as [number, number, number],
  amber: [245, 158, 11] as [number, number, number],
  border: [220, 220, 235] as [number, number, number],
  footerBg: [240, 242, 255] as [number, number, number],
};

/**
 * A4 (210 x 297 mm) hujjat o'lchovlari — barcha nakladnoy va hujjatlar shu chegaralarda chiziladi.
 *
 * `top` — har sahifadagi kompaniya sarlavhasi uchun ajratilgan joy (jadval shundan pastda boshlanadi),
 * `bottom` — sahifa raqami va tagline bo'lgan footer tasmasi uchun (qator tasma ustiga tushmaydi).
 */
export const A4 = {
  width: 210,
  height: 297,
  marginX: 14,
  /** Sarlavha balandligi (46) + kichik bo'shliq. */
  headerHeight: 46,
  /** Footer tasmasi (12) + bo'shliq. */
  footerHeight: 16,
} as const;

/** Sahifadagi ishchi maydon pastki chegarasi — bundan pastga hech narsa chizilmaydi. */
export const contentBottom = () => A4.height - A4.footerHeight;

/**
 * Blok (jami qutisi, imzo, izoh) shu sahifaga sig'adimi; sig'masa yangi sahifa ochiladi va
 * sarlavha qayta chiziladi. Qaytadi: blok chiziladigan Y.
 *
 * Shusiz uzun nakladnoyda jami va imzo sahifa chetidan tashqariga chiqib ketardi (ko'rinmasdi).
 */
export function ensureSpace(doc: jsPDF, y: number, needed: number, company?: CompanyInfo, header?: { title: string; number: string; date: string }): number {
  if (y + needed <= contentBottom()) return y;
  doc.addPage();
  return company && header ? drawCompanyHeader(doc, company, header.title, header.number, header.date) : A4.marginX;
}

export type CompanyInfo = {
  name: string;
  legalName?: string;
  taxId?: string;
  address?: string;
  phone?: string;
  email?: string;
  website?: string;
};

/**
 * Draw a professional company header on the PDF.
 * Returns the Y position after the header.
 */
export function drawCompanyHeader(
  doc: jsPDF,
  company: CompanyInfo,
  docTitle: string,
  docNumber: string,
  docDate: string,
  rightLabel?: string,
  rightValue?: string
): number {
  const pw = doc.internal.pageSize.getWidth();

  // Header background
  doc.setFillColor(...PDF_COLORS.headerBg);
  doc.rect(0, 0, pw, 38, "F");

  // Company name
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(...PDF_COLORS.headerText);
  doc.text(company.name, 14, 14);

  // Sub info
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(180, 185, 220);
  const subParts: string[] = [];
  if (company.legalName) subParts.push(company.legalName);
  if (company.taxId) subParts.push(`TIN: ${company.taxId}`);
  if (company.address) subParts.push(company.address);
  if (company.phone) subParts.push(company.phone);
  doc.text(subParts.join("  |  "), 14, 22);
  if (company.email || company.website) {
    doc.text([company.email, company.website].filter(Boolean).join("  |  "), 14, 29);
  }

  // Document info on the right
  doc.setTextColor(...PDF_COLORS.headerText);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(docTitle, pw - 14, 14, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(`# ${docNumber}`, pw - 14, 22, { align: "right" });
  doc.text(docDate, pw - 14, 29, { align: "right" });
  if (rightLabel && rightValue) {
    doc.text(`${rightLabel}: ${rightValue}`, pw - 14, 35, { align: "right" });
  }

  return 46;
}

/**
 * Nakladnoy jadvali uchun umumiy sozlama: A4 chegaralari, har sahifada TAKRORLANADIGAN jadval
 * sarlavhasi va kompaniya sarlavhasi, footer tasmasi ustiga chiqmaslik.
 *
 * `didDrawPage` har yangi sahifada kompaniya sarlavhasini qayta chizadi — 50+ qatorli hujjatda
 * ikkinchi sahifa ham to'liq hujjat bo'lib qoladi.
 */
export function tableOptions(
  doc: jsPDF,
  company: CompanyInfo,
  header: { title: string; number: string; date: string; rightLabel?: string; rightValue?: string },
  columnStyles: Record<number, Record<string, unknown>>,
) {
  let firstPage = true;
  return {
    theme: "grid" as const,
    headStyles: {
      fillColor: PDF_COLORS.headerBg,
      textColor: PDF_COLORS.headerText,
      fontStyle: "bold" as const,
      fontSize: 8.5,
      halign: "center" as const,
    },
    bodyStyles: { fontSize: 8.5, textColor: PDF_COLORS.textDark },
    alternateRowStyles: { fillColor: PDF_COLORS.rowAlt },
    columnStyles,
    /** Jadval sarlavhasi har sahifada — qator qaysi ustun ekani chalkashmaydi. */
    showHead: "everyPage" as const,
    /** Qator sahifa chegarasida ikkiga bo'linmaydi (matn kesilmaydi). */
    rowPageBreak: "avoid" as const,
    margin: { left: A4.marginX, right: A4.marginX, top: A4.headerHeight, bottom: A4.footerHeight },
    styles: { lineColor: PDF_COLORS.border, lineWidth: 0.2, overflow: "linebreak" as const },
    didDrawPage: () => {
      // Birinchi sahifada sarlavha jadvaldan oldin chizilgan — faqat keyingilariga qo'shamiz
      if (firstPage) {
        firstPage = false;
        return;
      }
      drawCompanyHeader(doc, company, header.title, header.number, header.date, header.rightLabel, header.rightValue);
    },
  };
}

/** Jadvaldan keyingi Y (autoTable natijasi). */
export const afterTable = (doc: jsPDF, gap = 6) =>
  (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + gap;

export type TotalRow = { label: string; value: string; bold?: boolean; color?: [number, number, number] };

/**
 * Jami qutisi — o'ng tomonda. Sahifaga sig'masa yangi sahifaga o'tadi, shuning uchun jami
 * HAR DOIM oxirgi sahifada va to'liq ko'rinadi.
 */
export function drawTotalsBox(
  doc: jsPDF,
  startY: number,
  rows: TotalRow[],
  company: CompanyInfo,
  header: { title: string; number: string; date: string },
  boxWidth = 71,
): number {
  const height = rows.length * 8 + 6;
  const y = ensureSpace(doc, startY, height, company, header);
  const boxX = A4.width - A4.marginX - boxWidth;

  doc.setFillColor(...PDF_COLORS.rowAlt);
  doc.roundedRect(boxX - 2, y - 2, boxWidth + 4, height, 3, 3, "F");
  rows.forEach((row, index) => {
    const ry = y + index * 8 + 4;
    doc.setFont("helvetica", row.bold ? "bold" : "normal");
    doc.setFontSize(row.bold ? 10 : 9);
    doc.setTextColor(...(row.color ?? PDF_COLORS.textDark));
    doc.text(row.label, boxX + 2, ry);
    doc.text(row.value, boxX + boxWidth - 2, ry, { align: "right" });
  });
  return y + height;
}

/** Imzo joylari — topshirdi / qabul qildi. Sig'masa yangi sahifada chiziladi. */
export function drawSignatures(
  doc: jsPDF,
  startY: number,
  company: CompanyInfo,
  header: { title: string; number: string; date: string },
  labels: [string, string] = ["Topshirdi (imzo)", "Qabul qildi (imzo)"],
): number {
  const y = ensureSpace(doc, startY + 12, 20, company, header) + 8;
  const right = A4.width - A4.marginX;
  doc.setDrawColor(...PDF_COLORS.border);
  doc.line(A4.marginX, y, A4.marginX + 66, y);
  doc.line(right - 66, y, right, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...PDF_COLORS.textMuted);
  doc.text(labels[0], A4.marginX + 33, y + 5, { align: "center" });
  doc.text(labels[1], right - 33, y + 5, { align: "center" });
  doc.text(`Sana: ${new Date().toLocaleDateString("uz-UZ")}`, A4.marginX, y + 12);
  return y + 14;
}

/** Izoh bloki — jadvaldan keyin chap tomonda; sig'masa yangi sahifaga o'tadi. */
export function drawNotes(
  doc: jsPDF,
  startY: number,
  notes: string,
  company: CompanyInfo,
  header: { title: string; number: string; date: string },
  width = 100,
): number {
  const lines = doc.splitTextToSize(notes, width) as string[];
  const y = ensureSpace(doc, startY, lines.length * 4.5 + 10, company, header);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(...PDF_COLORS.textMuted);
  doc.text("Izoh:", A4.marginX, y + 4);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...PDF_COLORS.textDark);
  doc.text(lines, A4.marginX, y + 11);
  return y + lines.length * 4.5 + 12;
}

/**
 * Draw a summary box with key-value pairs in a grid.
 */
export function drawInfoBox(
  doc: jsPDF,
  startY: number,
  items: { label: string; value: string; wide?: boolean }[],
  cols = 2
): number {
  const pw = doc.internal.pageSize.getWidth();
  const colW = (pw - 28) / cols;
  const rowH = 12;

  let x = 14;
  let y = startY;
  let colIdx = 0;

  items.forEach((item) => {
    const span = item.wide ? cols : 1;
    const w = colW * span;

    doc.setFillColor(...PDF_COLORS.rowAlt);
    doc.roundedRect(x, y, w - 3, rowH, 2, 2, "F");

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...PDF_COLORS.textMuted);
    doc.text(item.label, x + 3, y + 4.5);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...PDF_COLORS.textDark);
    doc.text(item.value, x + 3, y + 10);

    colIdx += span;
    if (colIdx >= cols) {
      colIdx = 0;
      x = 14;
      y += rowH + 3;
    } else {
      x += w;
    }
  });

  return colIdx > 0 ? y + rowH + 6 : y + 6;
}

/**
 * Draw footer with page numbers and a tagline.
 */
export function drawFooter(doc: jsPDF, tagline = "BUM ERP — Generated automatically"): void {
  const pw = doc.internal.pageSize.getWidth();
  const ph = doc.internal.pageSize.getHeight();
  const pageCount = doc.getNumberOfPages();

  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFillColor(...PDF_COLORS.footerBg);
    doc.rect(0, ph - 12, pw, 12, "F");
    doc.setFont("helvetica", "italic");
    doc.setFontSize(7.5);
    doc.setTextColor(...PDF_COLORS.textMuted);
    doc.text(tagline, 14, ph - 5);
    doc.text(
      `${new Date().toLocaleDateString("uz-UZ")}  —  ${i} / ${pageCount}`,
      pw - 14,
      ph - 5,
      { align: "right" }
    );
  }
}

/**
 * Draw a coloured status badge inline.
 */
export function drawStatusBadge(
  doc: jsPDF,
  x: number,
  y: number,
  label: string,
  color: [number, number, number]
): void {
  const w = doc.getTextWidth(label) + 6;
  doc.setFillColor(color[0], color[1], color[2]);
  doc.roundedRect(x, y - 4, w, 6, 1.5, 1.5, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(255, 255, 255);
  doc.text(label, x + 3, y);
}

/** Format number with thousands separator */
export function fmtNum(n: number, decimals = 0): string {
  return new Intl.NumberFormat("uz-UZ", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n);
}

/** Format currency */
export function fmtMoney(n: number, currency = "so'm"): string {
  return `${fmtNum(n)} ${currency}`;
}

export { autoTable };
export default jsPDF;
