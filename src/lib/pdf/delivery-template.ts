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
import { fmtMoney, fmtNum } from "./pdf-utils.ts";
import type { DocumentData, PackMode } from "./template-renderer.ts";
import { personLine, type SingleDeliveryWaybill } from "./delivery-waybill-pdf.ts";

const dash = (value: string | null | undefined) => value ?? "—";

/** Bitta yetkazma → shablon uchun tayyor ma'lumot. */
export function waybillDocumentData(
  delivery: SingleDeliveryWaybill,
  options: { company: CompanyInfo; currency: string; responsibleName: string },
): DocumentData {
  const debt = delivery.customerDebt ?? 0;
  // Shu reysdagi tovar summasi (qisman/qayta yetkazishda buyurtmaning to'liq summasi emas)
  const total = Number(delivery.taskTotal ?? delivery.orderTotal);
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
      "delivery.agentPhone": dash(delivery.agentPhone ?? null),
      // Savdo agenti: agent buyurtmasi bo'lmasa "—" (boshqa hujjatdan olinmaydi — har nakladnoy o'z yetkazmasidan)
      "delivery.salesRepName": dash(delivery.salesRepName ?? null),
      "delivery.salesRepPhone": dash(delivery.salesRepPhone ?? null),
      "delivery.salesRep": personLine(delivery.salesRepName, delivery.salesRepPhone),
      "delivery.agent": personLine(delivery.agentName ?? delivery.agentCode, delivery.agentPhone),
      "delivery.responsibleName": options.responsibleName,
      "delivery.route": dash(delivery.routeName ?? null),
      // Standart shablonda bitta qator: "Shovot-01 · Asosiy ombor" (nakladnoy ixcham qoladi)
      "delivery.routeWarehouse": [delivery.routeName, delivery.warehouseName].filter((part) => part && part.trim()).join(" · ") || "—",
      "warehouse.name": dash(delivery.warehouseName),
      "finance.total": money(total),
      "finance.debt": money(debt),
      "user.name": options.responsibleName,
      "system.printedAt": new Date().toLocaleString("uz-UZ"),
    },
    // Shart tekshiruvi uchun sonlar (masalan "qarz > 0 bo'lsa ogohlantirish chiqsin")
    numbers: { "finance.total": total, "finance.debt": debt },
    /**
     * Jadval qatorlari — BUYURTMADAGI MAHSULOTLAR (serverdan keladi). Mijoz ustunlari
     * har qatorda takrorlanadi, chunki nakladnoy bitta mijozga tegishli: shu bilan
     * foydalanuvchi mijoz ustunini ham, mahsulot ustunini ham tanlay oladi.
     *
     * Mahsulotsiz (eski javob yoki qatorsiz buyurtma) — bitta yig'ma qator qoladi,
     * aks holda jadval umuman bo'sh chiqardi.
     */
    items:
      delivery.items && delivery.items.length > 0
        ? delivery.items.map((item) => ({
            name: item.productName,
            sku: dash(item.productSku),
            barcode: dash(item.productBarcode ?? null),
            discount: item.discountPercent && Number(item.discountPercent) > 0 ? `${fmtNum(Number(item.discountPercent), 2)}%` : "",
            unit: dash(item.unitName),
            quantity: fmtNum(Number(item.quantity), 2),
            price: money(Number(item.unitPrice)),
            total: money(Number(item.lineTotal)),
            customerName: delivery.customerName,
            customerPhone: dash(delivery.customerPhone),
            customerAddress: dash(delivery.customerAddress),
            customerDebt: money(debt),
          }))
        : [
            {
              customerName: delivery.customerName,
              customerPhone: dash(delivery.customerPhone),
              customerAddress: dash(delivery.customerAddress),
              total: money(total),
              customerDebt: money(debt),
            },
          ],
    totals: { total: money(total), debt: money(debt) },
    // Ustun nomlari — shablonda nom yozilmagan bo'lsa shular chiqadi (xom kalit emas)
    columnLabels: {
      index: "№",
      name: "Mahsulot",
      sku: "SKU",
      barcode: "Shtrix-kod",
      unit: "Birlik",
      quantity: "Miqdor",
      price: "Narx",
      discount: "Chegirma",
      total: "Summa",
      customerName: "Mijoz",
      customerPhone: "Telefon",
      customerAddress: "Manzil",
      customerDebt: "Qarz",
    },
    codes: {
      documentNumber: delivery.number,
      orderNumber: delivery.orderNumber ?? undefined,
      customerPhone: delivery.customerPhone ?? undefined,
    },
  };
}

/**
 * Ko'p yetkazma — hammasi BITTA PDF ichida, A4 varaqlarga aqlli joylashtiriladi.
 *
 * Ilgari har yetkazma alohida PDF qilinib, sahifasi birinchisiga nusxalanardi. Bu gliflarni
 * buzardi (har PDF faqat o'zi ishlatgan harflarni ichiga oladi), natijada nomlar teshik va
 * summalar noto'g'ri chiqardi. Endi `renderDocuments` hammasini bitta hujjatga chizadi.
 */
export async function renderWaybillsWithTemplate(
  schema: DocumentTemplateSchema,
  deliveries: SingleDeliveryWaybill[],
  options: { company: CompanyInfo; currency: string; responsibleName: string; mode?: PackMode },
): Promise<jsPDF> {
  const { renderDocuments } = await import("./template-renderer.ts");
  const list = deliveries.map((delivery) => waybillDocumentData(delivery, options));
  return renderDocuments(schema, list.length > 0 ? list : [waybillDocumentData({} as SingleDeliveryWaybill, options)], options.mode ?? "smart");
}
