/**
 * Yetkazma nakladnoyini KOMPANIYANING SHABLONI bilan chiqarish.
 *
 * Qoida: shablon bo'lsa — u, bo'lmasa avvalgi qat'iy ko'rinish. Shu sababli hech kimda
 * hech narsa o'z-o'zidan o'zgarmaydi: nakladnoy faqat foydalanuvchi shablon yaratib,
 * uni standart qilgandan keyin yangicha chiqadi.
 *
 * MOLIYAVIY YAXLITLIK: bu yerda faqat mavjud qiymatlar KO'CHIRILADI — hech narsa qayta
 * hisoblanmaydi. Summalar hujjat ma'lumotidan qanday kelgan bo'lsa, shundayligicha ketadi.
 */
import type jsPDF from "jspdf";
import type { DocumentTemplateSchema } from "@bum/shared";
import type { CompanyInfo } from "./pdf-utils.ts";
import { fmtMoney } from "./pdf-utils.ts";
import type { DocumentData } from "./template-renderer.ts";
import type { SingleDeliveryWaybill } from "./delivery-waybill-pdf.ts";

const dash = (value: string | null | undefined) => value ?? "—";

/** Bitta yetkazma → shablon uchun tayyor ma'lumot. */
export function waybillDocumentData(
  delivery: SingleDeliveryWaybill,
  options: { company: CompanyInfo; currency: string; responsibleName: string },
): DocumentData {
  const debt = delivery.customerDebt ?? 0;
  const money = (value: number) => fmtMoney(value, options.currency);
  return {
    company: options.company,
    values: {
      "company.name": options.company.name,
      "company.legalName": options.company.legalName ?? "",
      "company.taxId": options.company.taxId ?? "",
      "company.address": options.company.address ?? "",
      "company.phone": options.company.phone ?? "",
      "document.number": delivery.number,
      "document.date": delivery.scheduledDate,
      "document.notes": "",
      "customer.name": delivery.customerName,
      "customer.phone": dash(delivery.customerPhone),
      "customer.address": dash(delivery.customerAddress),
      "delivery.agentName": dash(delivery.agentName ?? delivery.agentCode),
      "delivery.agentPhone": "",
      "delivery.responsibleName": options.responsibleName,
      "warehouse.name": dash(delivery.warehouseName),
      "finance.total": money(delivery.orderTotal),
      "finance.debt": money(debt),
      "user.name": options.responsibleName,
      "system.printedAt": new Date().toLocaleString("uz-UZ"),
    },
    // Shart tekshiruvi uchun sonlar (masalan "qarz > 0 bo'lsa ogohlantirish chiqsin")
    numbers: { "finance.total": delivery.orderTotal, "finance.debt": debt },
    items: [
      {
        customerName: delivery.customerName,
        customerPhone: dash(delivery.customerPhone),
        customerAddress: dash(delivery.customerAddress),
        total: money(delivery.orderTotal),
        customerDebt: money(debt),
      },
    ],
    totals: { total: money(delivery.orderTotal), debt: money(debt) },
    codes: {
      documentNumber: delivery.number,
      orderNumber: delivery.orderNumber ?? undefined,
      customerPhone: delivery.customerPhone ?? undefined,
    },
  };
}

/**
 * Ko'p yetkazma — har biri O'Z SAHIFASIDA, shablon bo'yicha.
 *
 * `renderTemplate` bitta hujjat chizadi, shuning uchun bu yerda sahifalar birlashtiriladi:
 * har yetkazma alohida chiziladi va sahifalari umumiy hujjatga ko'chiriladi.
 */
export async function renderWaybillsWithTemplate(
  schema: DocumentTemplateSchema,
  deliveries: SingleDeliveryWaybill[],
  options: { company: CompanyInfo; currency: string; responsibleName: string },
): Promise<jsPDF> {
  const { renderTemplate } = await import("./template-renderer.ts");
  const [first, ...rest] = deliveries;
  if (!first) return renderTemplate(schema, waybillDocumentData({} as SingleDeliveryWaybill, options));

  const doc = await renderTemplate(schema, waybillDocumentData(first, options));
  for (const delivery of rest) {
    const next = await renderTemplate(schema, waybillDocumentData(delivery, options));
    const pages = next.getNumberOfPages();
    for (let page = 1; page <= pages; page += 1) {
      doc.addPage();
      // jsPDF sahifa tarkibini nusxalash: ichki `pages` massivi — chizilgan buyruqlar oqimi
      const source = (next as unknown as { internal: { pages: string[][] } }).internal.pages[page];
      const target = (doc as unknown as { internal: { pages: string[][] } }).internal.pages;
      if (source) target[target.length - 1] = [...source];
    }
  }
  return doc;
}
