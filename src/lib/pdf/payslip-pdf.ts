/**
 * Employee Payslip PDF Generator
 */
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { CompanyInfo } from "./pdf-utils.ts";
import {
  PDF_COLORS,
  A4, drawCompanyHeader, drawInfoBox, drawFooter, fmtNum, fmtMoney,
} from "./pdf-utils.ts";

export type PayslipData = {
  company: CompanyInfo;
  employeeName: string;
  employeeCode: string;
  department: string;
  position: string;
  period: string; // e.g. "2024-11"
  workingDays: number;
  presentDays: number;
  absentDays: number;
  lateDays: number;
  halfDays: number;
  baseSalary: number;
  overtimePay: number;
  bonuses: number;
  grossSalary: number;
  inpsTax: number;
  otherDeductions: number;
  totalDeductions: number;
  netSalary: number;
  currency?: string;
  status: string;
  notes?: string;
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Qoralama",
  approved: "Tasdiqlangan",
  paid: "To'langan",
};

export function generatePayslipPDF(data: PayslipData): void {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const currency = data.currency ?? "so'm";

  let y = drawCompanyHeader(
    doc, data.company,
    "MAOSH VARAQASI",
    `${data.employeeCode}/${data.period}`,
    data.period,
    "Holat",
    STATUS_LABELS[data.status] ?? data.status
  );

  y = drawInfoBox(doc, y, [
    { label: "Xodim", value: data.employeeName },
    { label: "Xodim kodi", value: data.employeeCode },
    { label: "Bo'lim", value: data.department },
    { label: "Lavozim", value: data.position },
    { label: "Davr", value: data.period, wide: false },
    { label: "Ish kunlari", value: `${data.workingDays} kun` },
  ], 2);

  y += 4;

  // Attendance summary
  autoTable(doc, {
    startY: y,
    head: [["Ko'rsatkich", "Kunlar", "", "Ko'rsatkich", "Kunlar"]],
    body: [
      ["Ish kunlari", String(data.workingDays), "", "Kelmadi", String(data.absentDays)],
      ["Keldi", String(data.presentDays), "", "Kech keldi", String(data.lateDays)],
      ["Yarim kun", String(data.halfDays), "", "", ""],
    ],
    theme: "plain",
    headStyles: { fillColor: PDF_COLORS.primaryLight, textColor: PDF_COLORS.textDark, fontStyle: "bold", fontSize: 8 },
    bodyStyles: { fontSize: 8.5 },
    columnStyles: {
      0: { cellWidth: 40 },
      1: { cellWidth: 20, halign: "center" },
      2: { cellWidth: 10 },
      3: { cellWidth: 40 },
      4: { cellWidth: 20, halign: "center" },
    },
    margin: { left: 14, right: 14, bottom: A4.footerHeight },
  });

  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;

  // Earnings & Deductions side by side
  const pw = doc.internal.pageSize.getWidth();
  const halfW = (pw - 31) / 2;

  // Earnings table
  autoTable(doc, {
    startY: y,
    tableWidth: halfW,
    margin: { left: 14 },
    head: [["Hisoblash", "Summa"]],
    body: [
      ["Asosiy maosh", fmtMoney(data.baseSalary, currency)],
      ["Ortiqcha ish", fmtMoney(data.overtimePay, currency)],
      ["Bonus/mukofot", fmtMoney(data.bonuses, currency)],
      ["YALPI MAOSH", fmtMoney(data.grossSalary, currency)],
    ],
    theme: "grid",
    headStyles: { fillColor: [39, 174, 96], textColor: 255, fontStyle: "bold", fontSize: 8.5 },
    bodyStyles: { fontSize: 8.5 },
    alternateRowStyles: { fillColor: [240, 255, 248] },
    columnStyles: {
      0: { cellWidth: halfW * 0.6 },
      1: { halign: "right", fontStyle: "bold" },
    },
    styles: { lineColor: PDF_COLORS.border, lineWidth: 0.2 },
    didParseCell: (data) => {
      if (data.row.index === 3) {
        data.cell.styles.fillColor = [34, 197, 94];
        data.cell.styles.textColor = [255, 255, 255];
        data.cell.styles.fontStyle = "bold";
      }
    },
  });

  // Deductions table (right side)
  autoTable(doc, {
    startY: y,
    tableWidth: halfW,
    margin: { left: 17 + halfW },
    head: [["Ushlab qolish", "Summa"]],
    body: [
      ["INPS (12%)", fmtMoney(data.inpsTax, currency)],
      ["Boshqa ushlamalar", fmtMoney(data.otherDeductions, currency)],
      ["JAMI USHLAB QOLISH", fmtMoney(data.totalDeductions, currency)],
    ],
    theme: "grid",
    headStyles: { fillColor: [239, 68, 68], textColor: 255, fontStyle: "bold", fontSize: 8.5 },
    bodyStyles: { fontSize: 8.5 },
    alternateRowStyles: { fillColor: [255, 245, 245] },
    columnStyles: {
      0: { cellWidth: halfW * 0.6 },
      1: { halign: "right", fontStyle: "bold" },
    },
    styles: { lineColor: PDF_COLORS.border, lineWidth: 0.2 },
    didParseCell: (data) => {
      if (data.row.index === 2) {
        data.cell.styles.fillColor = [239, 68, 68];
        data.cell.styles.textColor = [255, 255, 255];
        data.cell.styles.fontStyle = "bold";
      }
    },
  });

  const netY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;

  // Net salary box
  doc.setFillColor(...PDF_COLORS.headerBg);
  doc.roundedRect(14, netY, pw - 28, 18, 4, 4, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(180, 190, 230);
  doc.text("TOZA (NET) MAOSH:", 20, netY + 11);
  doc.setFontSize(16);
  doc.setTextColor(255, 255, 255);
  doc.text(fmtMoney(data.netSalary, currency), pw - 20, netY + 12, { align: "right" });

  if (data.notes) {
    const notesY = netY + 26;
    doc.setFont("helvetica", "italic");
    doc.setFontSize(8.5);
    doc.setTextColor(...PDF_COLORS.textMuted);
    const lines = doc.splitTextToSize(data.notes, pw - 28);
    doc.text(lines, 14, notesY);
  }

  // Signatures
  const sigY = Math.max(netY + 44, 240);
  const sigW = (pw - 28) / 3;
  doc.setDrawColor(...PDF_COLORS.border);
  ["Buxgalter", "Xodim", "Rahbar"].forEach((label, i) => {
    const sx = 14 + i * (sigW + 7);
    doc.line(sx, sigY, sx + sigW - 7, sigY);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...PDF_COLORS.textMuted);
    doc.text(label, sx + (sigW - 7) / 2, sigY + 5, { align: "center" });
  });

  drawFooter(doc, `${data.company.name}  —  Maosh varaqasi ${data.period}`);
  doc.save(`payslip-${data.employeeCode}-${data.period}.pdf`);
}
