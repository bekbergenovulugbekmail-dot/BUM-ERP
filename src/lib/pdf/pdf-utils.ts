/**
 * Shared PDF generation utilities for BUM ERP.
 * Uses jsPDF + jspdf-autotable (client-side, no server needed).
 */
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

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
