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
  createDocument,
  PDF_COLORS,
  afterTable, drawCompanyHeader, drawFooter, drawInfoBox, drawNotes, drawSignatures, drawTotalsBox,
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

/**
 * Qog'ozda qaysi ustunlar chiqishi. Har bir biznesning nakladnoyi har xil: kimdir mijoz qarzini
 * agentga ko'rsatmaydi, kimdirga manzil kerak emas. Sukut bo'yicha hammasi chiqadi — bu
 * ilgarigi ko'rinish, ya'ni mavjud bizneslar uchun hech narsa o'zgarmaydi.
 */
export type WaybillColumns = {
  address: boolean;
  phone: boolean;
  /** Qarz ustuni: ma'lumot kelmagan bo'lsa (ruxsat yo'q) baribir chiqmaydi. */
  debt: boolean;
};

export const DEFAULT_WAYBILL_COLUMNS: WaybillColumns = { address: true, phone: true, debt: true };

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
  columns?: WaybillColumns;
};

const dash = (value: string | null | undefined) => (value && value.trim() !== "" ? value : "—");

export async function generateDeliveryWaybillPDF(data: DeliveryWaybillData): Promise<jsPDF> {
  const doc = await createDocument();
  const header = { title: "YETKAZMA NAKLADNOYI", number: data.number, date: data.date };

  const columns = data.columns ?? DEFAULT_WAYBILL_COLUMNS;
  // Qarz ustuni faqat ma'lumot kelganda chiziladi (ruxsati yo'q xodimda umuman bo'lmaydi)
  const showDebt = columns.debt && data.tasks.some((task) => task.customerDebt !== null);

  // Ustunlar ro'yxati bir joyda quriladi — sarlavha, kenglik va katak tartibi doim mos keladi
  const layout: { head: string; width?: number; align?: "center" | "right"; bold?: boolean; cell: (task: WaybillTask, index: number) => string }[] = [
    { head: "#", width: 8, align: "center", cell: (_task, index) => String(index + 1) },
    { head: "Yetkazma", width: 24, cell: (task) => task.number },
    { head: "Buyurtma", width: 24, cell: (task) => dash(task.orderNumber) },
    { head: "Mijoz", cell: (task) => task.customerName },
  ];
  if (columns.address) layout.push({ head: "Manzil", width: 38, cell: (task) => dash(task.customerAddress) });
  if (columns.phone) layout.push({ head: "Telefon", width: 26, cell: (task) => dash(task.customerPhone) });
  layout.push({ head: "Summa", width: 24, align: "right", bold: true, cell: (task) => fmtMoney(task.orderTotal, data.currency) });
  if (showDebt) {
    layout.push({
      head: "Qarzi",
      width: 22,
      align: "right",
      cell: (task) => (task.customerDebt === null ? "—" : fmtMoney(task.customerDebt, data.currency)),
    });
  }

  const head = layout.map((column) => column.head);
  const body = data.tasks.map((task, index) => layout.map((column) => column.cell(task, index)));

  const columnStyles: Record<number, Record<string, unknown>> = {};
  layout.forEach((column, index) => {
    const style: Record<string, unknown> = {};
    if (column.width !== undefined) style.cellWidth = column.width;
    if (column.align) style.halign = column.align;
    if (column.bold) style.fontStyle = "bold";
    if (Object.keys(style).length > 0) columnStyles[index] = style;
  });

  const options = tableOptions(doc, data.company, header, columnStyles);
  // BIRINCHI sahifaning sarlavhasi shu yerda chiziladi: `tableOptions` uni ataylab o'tkazib
  // yuboradi (chaqiruvchi chizgan deb hisoblaydi) va keyingi sahifalarga o'zi qo'shadi.
  const headerBottom = drawCompanyHeader(doc, data.company, header.title, header.number, header.date);
  // Agent va mas'ul shaxs — kim nimani topshirgani hujjatdan aniq ko'rinishi uchun
  const startY = drawInfoBox(
    doc,
    headerBottom,
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
  return doc;
}

/** Bitta yetkazma uchun nakladnoy ma'lumoti (ko'pini birdan chiqarishda). */
/** Nakladnoydagi buyurtma qatori — dostavshik do'konda shu ro'yxat bo'yicha solishtiradi. */
export type WaybillOrderItem = {
  productName: string;
  productSku: string | null;
  quantity: string;
  unitName: string | null;
  unitPrice: string;
  lineTotal: string;
};

export type SingleDeliveryWaybill = {
  number: string;
  status: string;
  scheduledDate: string;
  orderNumber: string | null;
  orderTotal: number;
  customerName: string;
  customerPhone: string | null;
  customerAddress: string | null;
  customerDebt: number | null;
  warehouseName: string | null;
  agentCode: string | null;
  agentName: string | null;
  /** Serverdan keladi; eski javoblarda bo'lmasligi mumkin. */
  items?: WaybillOrderItem[];
};

/**
 * KO'P NAKLADNOY BITTA FAYLDA (7-vazifa).
 *
 * Har yetkazma O'Z SAHIFASIDAN boshlanadi — qog'ozlar bir-biriga qo'shilib ketmaydi va
 * har birini alohida uzib berish mumkin. Ko'rinish boshqa hujjatlar bilan bir xil:
 * o'sha A4 yordamchilari (kompaniya sarlavhasi, ma'lumot bloki, jami, imzolar).
 *
 * Chop etish HUJJAT amali — yetkazma holatini o'zgartirmaydi (buni server ham kafolatlaydi).
 */
export async function generateBulkDeliveryWaybillsPDF(data: {
  company: CompanyInfo;
  currency: string;
  responsibleName: string;
  deliveries: SingleDeliveryWaybill[];
}): Promise<jsPDF> {
  const doc = await createDocument();
  const showDebt = data.deliveries.some((row) => row.customerDebt !== null);

  data.deliveries.forEach((delivery, index) => {
    // Birinchisidan keyin har biri yangi sahifada
    if (index > 0) doc.addPage();

    const header = { title: "YETKAZMA NAKLADNOYI", number: delivery.number, date: delivery.scheduledDate };
    const columnStyles: Record<number, Record<string, unknown>> = {
      0: { cellWidth: 46 },
      1: { halign: "right" as const, fontStyle: "bold" as const },
    };
    const options = tableOptions(doc, data.company, header, columnStyles);
    const headerBottom = drawCompanyHeader(doc, data.company, header.title, header.number, header.date);

    const startY = drawInfoBox(
      doc,
      headerBottom,
      [
        { label: "Mijoz", value: delivery.customerName },
        { label: "Telefon", value: dash(delivery.customerPhone) },
        { label: "Manzil", value: dash(delivery.customerAddress), wide: true },
        { label: "Yetkazuvchi agent", value: dash(delivery.agentName ?? delivery.agentCode) },
        { label: "Ombor", value: dash(delivery.warehouseName) },
        { label: "Buyurtma", value: dash(delivery.orderNumber) },
        { label: "Mas'ul shaxs", value: data.responsibleName },
      ],
      2,
    );

    const body: string[][] = [
      ["Yetkazma raqami", delivery.number],
      ["Sana", delivery.scheduledDate],
      ["Buyurtma", dash(delivery.orderNumber)],
      ["Summa", fmtMoney(delivery.orderTotal, data.currency)],
    ];
    if (showDebt) {
      body.push(["Mijoz qarzi", delivery.customerDebt === null ? "—" : fmtMoney(delivery.customerDebt, data.currency)]);
    }
    autoTable(doc, { ...options, startY, head: [["Ko'rsatkich", "Qiymat"]], body });

    const totals: TotalRow[] = [
      { label: "Yetkazma summasi", value: fmtMoney(delivery.orderTotal, data.currency), bold: true },
    ];
    if (showDebt && delivery.customerDebt !== null) {
      totals.push({ label: "Mijoz qarzi", value: fmtMoney(delivery.customerDebt, data.currency), color: PDF_COLORS.red });
    }
    const y = drawTotalsBox(doc, afterTable(doc), totals, data.company, header);
    drawSignatures(doc, y, data.company, header, ["Topshirdi (mas'ul shaxs)", "Qabul qildi (mijoz)"]);
  });

  drawFooter(doc);
  doc.save(`nakladnoylar-${data.deliveries.length}-ta.pdf`);
  return doc;
}
