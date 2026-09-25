/**
 * Mijoz akti (hisob-kitob) — turlar va eksport (Excel, PDF).
 *
 * Ma'lumot serverdan tayyor keladi (`GET /api/sales/customers/:id/statement`) — bu yerda HECH NARSA qayta
 * hisoblanmaydi, faqat formatlanadi. Manba — buxgalteriya jurnali, shuning uchun eksport qilingan akt bilan
 * buxgalteriya har doim bir xil.
 */
import type { CompanyInfo } from "@/lib/pdf/pdf-utils.ts";

export type StatementLine = {
  date: string;
  entryId: string;
  entryNumber: string;
  kind: string;
  label: string;
  document: { type: string | null; id: string | null; number: string | null; orderNumber: string | null; status: string | null };
  description: string;
  debit: string;
  credit: string;
  balance: string;
  walletChange: string;
  walletBalance: string;
  createdBy: string | null;
  createdAt: string;
};

export type StatementAgingBucket = "not_due" | "d0_7" | "d8_30" | "d31_60" | "d61_90" | "d90_plus";

export type CustomerStatement = {
  customer: { id: string; name: string; code: string | null; phone: string | null; paymentTermDays: number };
  from: string;
  to: string;
  opening: { debt: string; wallet: string };
  lines: StatementLine[];
  totals: { debit: string; credit: string };
  closing: { debt: string; wallet: string };
  months: { month: string; opening: string; debit: string; credit: string; closing: string }[];
  aging: {
    asOf: string;
    buckets: Record<StatementAgingBucket, string>;
    documents: { id: string; number: string; orderDate: string; dueDate: string; outstanding: string; daysOverdue: number; bucket: StatementAgingBucket }[];
    undocumented: string;
  };
  reconciliation: { ledgerDebt: string; cachedDebt: string; difference: string; ok: boolean };
};

export const AGING_LABELS: Record<StatementAgingBucket, string> = {
  not_due: "Muddati kelmagan",
  d0_7: "1–7 kun",
  d8_30: "8–30 kun",
  d31_60: "31–60 kun",
  d61_90: "61–90 kun",
  d90_plus: "90+ kun",
};

export const money = (value: string | number) =>
  new Intl.NumberFormat("uz-UZ", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(Number(value));

const MONTHS = ["yanvar", "fevral", "mart", "aprel", "may", "iyun", "iyul", "avgust", "sentabr", "oktabr", "noyabr", "dekabr"];
export const monthLabel = (month: string) => `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;

/** Hujjat ustuni matni: raqam (+ buyurtma), bekor qilingan bo'lsa belgisi bilan. */
export function documentText(line: StatementLine) {
  const parts = [line.document.number, line.document.orderNumber && line.document.orderNumber !== line.document.number ? line.document.orderNumber : null]
    .filter(Boolean)
    .join(" · ");
  const reversed = line.document.status === "reversed" && line.kind === "payment" ? " (bekor qilingan)" : "";
  return `${parts || line.entryNumber}${reversed}`;
}

const fileBase = (statement: CustomerStatement) =>
  `akt-${(statement.customer.code ?? statement.customer.name).replace(/[^\p{L}\p{N}-]+/gu, "_")}-${statement.from}_${statement.to}`;

/** Excel: "Akt", "Oyma-oy", "Qarz yoshi" varaqlari. Summalar RAQAM bo'lib yoziladi (Excelda qo'shish mumkin). */
export async function statementXlsx(statement: CustomerStatement, companyName: string): Promise<{ blob: Blob; filename: string }> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "BUM ERP";
  workbook.created = new Date();
  const moneyFormat = "#,##0.00";

  const sheet = workbook.addWorksheet("Akt");
  sheet.addRow([`${companyName} — mijoz bilan hisob-kitob akti`]).font = { bold: true, size: 13 };
  sheet.addRow([`Mijoz: ${statement.customer.name}${statement.customer.code ? ` (${statement.customer.code})` : ""}`]);
  sheet.addRow([`Davr: ${statement.from} — ${statement.to}`]);
  sheet.addRow([]);
  sheet.addRow(["Boshlang'ich qoldiq", "", "", "", "", Number(statement.opening.debt)]).font = { bold: true };
  const header = sheet.addRow(["Sana", "Operatsiya", "Hujjat", "Qarz oshdi (+)", "Qarz kamaydi (−)", "Qoldiq", "Hamyon", "Kiritgan", "Izoh"]);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E2850" } };
  });
  for (const line of statement.lines) {
    sheet.addRow([
      line.date,
      line.label,
      documentText(line),
      Number(line.debit) || null,
      Number(line.credit) || null,
      Number(line.balance),
      Number(line.walletChange) || null,
      line.createdBy ?? "",
      line.description,
    ]);
  }
  sheet.addRow(["Jami aylanma", "", "", Number(statement.totals.debit), Number(statement.totals.credit)]).font = { bold: true };
  sheet.addRow(["Yakuniy qoldiq", "", "", "", "", Number(statement.closing.debt), Number(statement.closing.wallet)]).font = { bold: true };
  sheet.columns = [{ width: 12 }, { width: 22 }, { width: 28 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 14 }, { width: 20 }, { width: 50 }];
  for (const column of [4, 5, 6, 7]) sheet.getColumn(column).numFmt = moneyFormat;

  const months = workbook.addWorksheet("Oyma-oy");
  months.addRow(["Oy", "Boshlang'ich", "Qarz oshdi (+)", "Qarz kamaydi (−)", "Oy oxiri"]).font = { bold: true };
  for (const row of statement.months) {
    months.addRow([monthLabel(row.month), Number(row.opening), Number(row.debit), Number(row.credit), Number(row.closing)]);
  }
  months.columns = [{ width: 18 }, { width: 16 }, { width: 16 }, { width: 18 }, { width: 16 }];
  for (const column of [2, 3, 4, 5]) months.getColumn(column).numFmt = moneyFormat;

  const aging = workbook.addWorksheet("Qarz yoshi");
  aging.addRow([`Ochiq hujjatlar, ${statement.aging.asOf} holatiga`]).font = { bold: true };
  aging.addRow(["Hujjat", "Sana", "Muddat", "Kechikish (kun)", "Guruh", "Qoldiq"]).font = { bold: true };
  for (const doc of statement.aging.documents) {
    aging.addRow([doc.number, doc.orderDate, doc.dueDate, doc.daysOverdue, AGING_LABELS[doc.bucket], Number(doc.outstanding)]);
  }
  if (Number(statement.aging.undocumented) !== 0) aging.addRow(["Hujjatsiz qarz (boshlang'ich/tuzatish)", "", "", "", "", Number(statement.aging.undocumented)]);
  aging.columns = [{ width: 34 }, { width: 12 }, { width: 12 }, { width: 16 }, { width: 18 }, { width: 16 }];
  aging.getColumn(6).numFmt = moneyFormat;

  const blob = new Blob([await workbook.xlsx.writeBuffer()], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  return { blob, filename: `${fileBase(statement)}.xlsx` };
}

/** PDF: A4, kirill shrift bilan (hujjatlar bilan bir xil dvigatel). */
export async function statementPdf(statement: CustomerStatement, company: CompanyInfo): Promise<{ blob: Blob; filename: string }> {
  const { autoTable, createDocument, drawCompanyHeader, drawFooter, PDF_COLORS, A4 } = await import("@/lib/pdf/pdf-utils.ts");
  const doc = await createDocument();
  let y = drawCompanyHeader(doc, company, "HISOB-KITOB AKTI", statement.customer.code ?? "", `${statement.from} — ${statement.to}`);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...PDF_COLORS.textDark);
  doc.text(`Mijoz: ${statement.customer.name}`, A4.marginX, y);
  y += 6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(`Boshlang'ich qoldiq (${statement.from}): ${money(statement.opening.debt)} so'm`, A4.marginX, y);
  y += 3;

  autoTable(doc, {
    startY: y + 2,
    head: [["Sana", "Operatsiya", "Hujjat", "+ Qarz", "− Qarz", "Qoldiq"]],
    body: statement.lines.map((line) => [
      line.date,
      line.label,
      documentText(line),
      Number(line.debit) ? money(line.debit) : "",
      Number(line.credit) ? money(line.credit) : "",
      money(line.balance),
    ]),
    foot: [["", "Jami aylanma", "", money(statement.totals.debit), money(statement.totals.credit), money(statement.closing.debt)]],
    theme: "grid",
    styles: { fontSize: 8, lineColor: PDF_COLORS.border, lineWidth: 0.2 },
    headStyles: { fillColor: PDF_COLORS.headerBg, textColor: PDF_COLORS.headerText, fontStyle: "bold" },
    footStyles: { fillColor: PDF_COLORS.rowAlt, textColor: PDF_COLORS.textDark, fontStyle: "bold" },
    columnStyles: { 3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right" } },
    margin: { left: A4.marginX, right: A4.marginX, bottom: A4.footerHeight },
  });
  let after = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;

  if (statement.months.length > 1) {
    autoTable(doc, {
      startY: after,
      head: [["Oy", "Boshlang'ich", "+ Qarz", "− Qarz", "Oy oxiri"]],
      body: statement.months.map((row) => [monthLabel(row.month), money(row.opening), money(row.debit), money(row.credit), money(row.closing)]),
      theme: "grid",
      styles: { fontSize: 8, lineColor: PDF_COLORS.border, lineWidth: 0.2 },
      headStyles: { fillColor: PDF_COLORS.headerBg, textColor: PDF_COLORS.headerText },
      columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" } },
      margin: { left: A4.marginX, right: A4.marginX, bottom: A4.footerHeight },
    });
    after = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
  }

  if (after > 250) {
    doc.addPage();
    after = 20;
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...PDF_COLORS.textDark);
  const closing = Number(statement.closing.debt);
  doc.text(
    closing > 0
      ? `${statement.to} holatiga mijozning qarzi: ${money(closing)} so'm`
      : closing < 0
        ? `${statement.to} holatiga mijozning ortiqcha to'lovi: ${money(-closing)} so'm`
        : `${statement.to} holatiga qarz yo'q`,
    A4.marginX,
    after,
  );
  const lineY = after + 22;
  doc.setDrawColor(...PDF_COLORS.border);
  doc.line(A4.marginX, lineY, A4.marginX + 70, lineY);
  doc.line(A4.width - A4.marginX - 70, lineY, A4.width - A4.marginX, lineY);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...PDF_COLORS.textMuted);
  doc.text(company.name, A4.marginX + 35, lineY + 4, { align: "center" });
  doc.text(statement.customer.name, A4.width - A4.marginX - 35, lineY + 4, { align: "center" });
  drawFooter(doc);
  return { blob: doc.output("blob"), filename: `${fileBase(statement)}.pdf` };
}
