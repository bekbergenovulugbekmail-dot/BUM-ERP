/**
 * Reys hujjatlari PDF: omborchining yig'ma ro'yxati (2 nusxa) va yetkazuvchining marshrut varag'i.
 * Ikkalasi ham reys SNAPSHOTidan (`trip-documents.ts`) — mijoz nakladnoylari bilan jami bir xil. Chop etishdan oldin
 * `reconcileTrip` tekshiradi; farq bo'lsa PDF yaratilmaydi.
 */
import type jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { pickList, reconcileTrip, routeSheet, PICK_STATUS_LABELS, type Trip } from "@/lib/delivery/trip-documents.ts";
import type { CompanyInfo } from "./pdf-utils.ts";
import { A4, PDF_COLORS, afterTable, createDocument, drawCompanyHeader, drawFooter, drawInfoBox, fmtMoney, fmtNum, tableOptions } from "./pdf-utils.ts";

const dash = (value: string | null | undefined) => (value && value.trim() ? value : "—");
const person = (name: string | null | undefined, phone: string | null | undefined) => [name, phone].filter((part) => part && part.trim()).join(" · ") || "—";

function assertReconciled(trip: Trip) {
  const check = reconcileTrip(trip.snapshot);
  if (!check.ok) throw new Error(`Reys hujjatlari bir-biriga mos emas: ${check.mismatches.join("; ")}`);
}

/** Imzo qatorlari — sahifa o'lchamiga qarab (albom varag'ida ham chetdan chiqmaydi). */
function signatures(doc: jsPDF, y: number, labels: string[]) {
  const pageHeight = doc.internal.pageSize.getHeight();
  const pageWidth = doc.internal.pageSize.getWidth();
  if (y + 18 > pageHeight - A4.footerHeight) {
    doc.addPage();
    y = A4.marginX + 6;
  }
  const width = (pageWidth - A4.marginX * 2) / labels.length;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...PDF_COLORS.textDark);
  labels.forEach((label, index) => {
    const x = A4.marginX + index * width;
    doc.line(x, y + 10, x + width - 8, y + 10);
    doc.text(label, x, y + 15);
  });
}

/** Omborchining yig'ma ro'yxati — 2 nusxa (omborchi va yetkazuvchi), terish holati bilan. */
export async function generateTripPickListPDF(trip: Trip, company: CompanyInfo): Promise<jsPDF> {
  assertReconciled(trip);
  const doc = await createDocument();
  const rows = pickList(trip.snapshot);
  const lineOf = (productId: string, unitName: string) => trip.lines.find((line) => line.productId === productId && line.unitName === unitName);
  const copies = ["1-nusxa — omborchi", "2-nusxa — yetkazuvchi"];
  copies.forEach((copy, copyIndex) => {
    if (copyIndex > 0) doc.addPage();
    const header = { title: "YIG'MA RO'YXAT (OMBOR)", number: trip.number, date: trip.tripDate, rightLabel: "Nusxa", rightValue: copy };
    const top = drawCompanyHeader(doc, company, header.title, header.number, header.date, header.rightLabel, header.rightValue);
    const startY = drawInfoBox(
      doc,
      top,
      [
        { label: "Reys", value: trip.number },
        { label: "Sana", value: trip.tripDate },
        { label: "Ombor", value: dash(trip.snapshot.warehouse.name) },
        { label: "Yetkazuvchi", value: person(trip.snapshot.agent.name ?? trip.snapshot.agent.code, trip.snapshot.agent.phone) },
        { label: "Mijozlar", value: String(trip.snapshot.totals.tasks) },
        { label: "Nusxa", value: copy },
      ],
      2,
    );
    autoTable(doc, {
      ...tableOptions(doc, company, header, {
        0: { cellWidth: 9, halign: "center" as const },
        3: { halign: "center" as const },
        4: { halign: "right" as const, fontStyle: "bold" as const },
        5: { halign: "right" as const },
      }),
      startY,
      head: [["№", "Mahsulot", "SKU", "Birlik", "Kerak", "Terildi", "Holat"]],
      body: rows.map((row) => {
        const line = lineOf(row.productId, row.unitName);
        return [
          String(row.index),
          row.productName,
          dash(row.productSku),
          row.unitName,
          fmtNum(Number(row.quantity), 2),
          line?.pickedQty !== null && line?.pickedQty !== undefined ? fmtNum(Number(line.pickedQty), 2) : "",
          line ? PICK_STATUS_LABELS[line.pickStatus] : "",
        ];
      }),
      foot: [["", "JAMI", "", "", fmtNum(Number(trip.snapshot.totals.quantity), 2), "", ""]],
      footStyles: { fillColor: PDF_COLORS.rowAlt, textColor: PDF_COLORS.textDark, fontStyle: "bold" as const, halign: "right" as const },
    });
    signatures(doc, afterTable(doc), ["Berdi (omborchi)", "Oldi (yetkazuvchi)", "Tekshirdi"]);
  });
  drawFooter(doc);
  doc.save(`yigma-royxat-${trip.number}.pdf`);
  return doc;
}

/** Bir sahifaga sig'adigan mahsulot ustunlari soni (albom A4). */
const COLUMNS_PER_PAGE = 8;

/**
 * Yetkazuvchining marshrut varag'i (albom A4): qatorlar — mijozlar reys tartibida, ustunlar — mahsulotlar. Mahsulot ko'p
 * bo'lsa ustunlar guruhlarga bo'linadi (har guruhda mijoz ustuni takrorlanadi), summa va imzo — oxirgi guruhda.
 */
export async function generateRouteSheetPDF(trip: Trip, company: CompanyInfo, currency = "UZS"): Promise<jsPDF> {
  assertReconciled(trip);
  const doc = await createDocument({ orientation: "landscape" });
  const sheet = routeSheet(trip.snapshot);
  const header = { title: "MARSHRUT VARAG'I", number: trip.number, date: trip.tripDate };
  const groups: (typeof sheet.columns)[] = [];
  for (let index = 0; index < sheet.columns.length; index += COLUMNS_PER_PAGE) groups.push(sheet.columns.slice(index, index + COLUMNS_PER_PAGE));

  groups.forEach((columns, groupIndex) => {
    const last = groupIndex === groups.length - 1;
    if (groupIndex > 0) doc.addPage();
    const top = drawCompanyHeader(doc, company, header.title, header.number, header.date, groups.length > 1 ? "Ustunlar" : undefined, groups.length > 1 ? `${groupIndex + 1}/${groups.length}` : undefined);
    const startY = drawInfoBox(
      doc,
      top,
      [
        { label: "Yetkazuvchi", value: person(trip.snapshot.agent.name ?? trip.snapshot.agent.code, trip.snapshot.agent.phone) },
        { label: "Ombor", value: dash(trip.snapshot.warehouse.name) },
        { label: "Sana", value: trip.tripDate },
        { label: "Mijozlar", value: String(sheet.rows.length) },
      ],
      4,
    );
    const head = [["№", "Mijoz", ...columns.map((column) => `${column.productName} (${column.unitName})`), ...(last ? ["Summa", "Imzo"] : [])]];
    const body = sheet.rows.map((row) => [
      String(row.index),
      [row.customerName, dash(row.customerPhone), row.customerAddress ?? "", row.orderNumber ? `№ ${row.orderNumber}` : ""].filter(Boolean).join("\n"),
      ...columns.map((column) => (row.cells[column.key] ? fmtNum(Number(row.cells[column.key]), 2) : "")),
      ...(last ? [fmtMoney(Number(row.amount), currency), ""] : []),
    ]);
    const foot = [["", "JAMI", ...columns.map((column) => fmtNum(Number(sheet.columnTotals[column.key] ?? "0"), 2)), ...(last ? [fmtMoney(Number(sheet.grandAmount), currency), ""] : [])]];
    const styles: Record<number, Record<string, unknown>> = { 0: { cellWidth: 8, halign: "center" as const }, 1: { cellWidth: 58 } };
    columns.forEach((_, index) => (styles[index + 2] = { halign: "center" as const }));
    if (last) {
      styles[columns.length + 2] = { halign: "right" as const, cellWidth: 28 };
      styles[columns.length + 3] = { cellWidth: 22 };
    }
    autoTable(doc, {
      ...tableOptions(doc, company, header, styles),
      startY,
      head,
      body,
      foot,
      headStyles: { fillColor: PDF_COLORS.headerBg, textColor: PDF_COLORS.headerText, fontStyle: "bold" as const, fontSize: 7.5, halign: "center" as const },
      footStyles: { fillColor: PDF_COLORS.rowAlt, textColor: PDF_COLORS.textDark, fontStyle: "bold" as const, halign: "center" as const },
    });
    if (last) signatures(doc, afterTable(doc), ["Yuk topshirdi (omborchi)", "Yuk qabul qildi (yetkazuvchi)", "Kassaga topshirildi"]);
  });
  drawFooter(doc);
  doc.save(`marshrut-varagi-${trip.number}.pdf`);
  return doc;
}
