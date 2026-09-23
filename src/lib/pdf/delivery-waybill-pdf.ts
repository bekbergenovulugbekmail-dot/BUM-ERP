/**
 * YETKAZMA NAKLADNOYI (dostavka varaqasi).
 *
 * Kim uchun: yetkazmalar agentga biriktirilgandan keyin agent qo'liga beriladigan qog'oz —
 * qaysi mijozga nima borishi, qancha pul olinishi va mijozning qarzi shu yerda ko'rinadi.
 *
 * Boshqa hujjatlar bilan BIR XIL ko'rinish: umumiy A4 yordamchilaridan foydalanadi
 * (`pdf-utils.ts`) — ko'p sahifada takrorlanadigan kompaniya sarlavhasi, jami bloki va imzolar.
 * Kompaniya nomi, manzili va rekvizitlari "Sozlamalar → Kompaniya" dan olinadi.
 */
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { CompanyInfo, TotalRow } from "./pdf-utils.ts";
import {
  PDF_COLORS,
  afterTable, drawFooter, drawInfoBox, drawNotes, drawSignatures, drawTotalsBox,
  fmtMoney, tableOptions,
} from "./pdf-utils.ts";

/** Nakladnoydagi bitta yetkazma qatori. */
export type WaybillTask = {
  number: string;
  orderNumber: string | null;
  customerName: string;
  customerPhone: string | null;
  customerAddress: string | null;
  /** Buyurtma summasi — agent shu pulni olib keladi (to'lov usuli mijoz bilan kelishilgan). */
  orderTotal: number;
  /** Mijozning umumiy qarzi — ixtiyoriy: tannarx/qarz ruxsati bo'lmasa yuborilmaydi. */
  customerDebt: number | null;
};

export type DeliveryWaybillData = {
  company: CompanyInfo;
  /** Hujjat raqami — agent kodi va sana asosida (kunlik varaqa). */
  number: string;
  /** Yetkazma kuni. */
  date: string;
  agentName: string;
  agentCode: string;
  agentPhone: string | null;
  /** Topshirayotgan mas'ul shaxs — hujjatni chop etayotgan xodim. */
  responsibleName: string;
  warehouseName: string | null;
  tasks: WaybillTask[];
  currency: string;
  notes?: string | null;
};

const dash = (value: string | null | undefined) => (value && value.trim() !== "" ? value : "—");

export function generateDeliveryWaybillPDF(data: DeliveryWaybillData): void {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const header = { title: "YETKAZMA NAKLADNOYI", number: data.number, date: data.date };

  // Qarz ustuni faqat ma'lumot kelganda chiziladi (ruxsati yo'q xodimda umuman bo'lmaydi)
  const showDebt = data.tasks.some((task) => task.customerDebt !== null);

  const head = ["#", "Yetkazma", "Buyurtma", "Mijoz", "Manzil", "Telefon", "Summa"];
  if (showDebt) head.push("Qarzi");

  const body = data.tasks.map((task, index) => {
    const row = [
      String(index + 1),
      task.number,
      dash(task.orderNumber),
      task.customerName,
      dash(task.customerAddress),
      dash(task.customerPhone),
      fmtMoney(task.orderTotal, data.currency),
    ];
    if (showDebt) row.push(task.customerDebt === null ? "—" : fmtMoney(task.customerDebt, data.currency));
    return row;
  });

  const columnStyles: Record<number, Record<string, unknown>> = {
    0: { halign: "center", cellWidth: 8 },
    1: { cellWidth: 24 },
    2: { cellWidth: 24 },
    4: { cellWidth: 38 },
    5: { cellWidth: 26 },
    6: { halign: "right", cellWidth: 24, fontStyle: "bold" },
  };
  if (showDebt) columnStyles[7] = { halign: "right", cellWidth: 22 };

  const options = tableOptions(doc, data.company, header, columnStyles);
  // Agent va mas'ul shaxs — kim nimani topshirgani hujjatdan aniq ko'rinishi uchun
  const startY = drawInfoBox(
    doc,
    options.margin.top,
    [
      { label: "Yetkazuvchi agent", value: `${data.agentName} · ${data.agentCode}` },
      { label: "Agent telefoni", value: dash(data.agentPhone) },
      { label: "Mas'ul shaxs", value: data.responsibleName },
      { label: "Ombor", value: dash(data.warehouseName) },
    ],
    2,
  );

  autoTable(doc, { ...options, startY, head: [head], body });

  const total = data.tasks.reduce((sum, task) => sum + task.orderTotal, 0);
  const debtTotal = data.tasks.reduce((sum, task) => sum + (task.customerDebt ?? 0), 0);
  const totals: TotalRow[] = [
    { label: "Yetkazmalar", value: String(data.tasks.length) },
    { label: "Jami summa", value: fmtMoney(total, data.currency), bold: true },
  ];
  if (showDebt) totals.push({ label: "Jami qarz", value: fmtMoney(debtTotal, data.currency), color: PDF_COLORS.red });

  let y = drawTotalsBox(doc, afterTable(doc), totals, data.company, header);
  if (data.notes) y = drawNotes(doc, y, data.notes, data.company, header);
  drawSignatures(doc, y, data.company, header, ["Topshirdi (mas'ul shaxs)", "Qabul qildi (agent)"]);
  drawFooter(doc);

  doc.save(`nakladnoy-${data.agentCode}-${data.date}.pdf`);
}
