/**
 * Hisob-faktura va xarid buyurtmasini KOMPANIYANING SHABLONI bilan chiqarish.
 *
 * Qoida yetkazma nakladnoyidagidek: shablon bo'lsa — u, bo'lmasa avvalgi qat'iy ko'rinish.
 * Shuning uchun shablon yaratilmaguncha hech kimda hech narsa o'zgarmaydi.
 *
 * MOLIYAVIY YAXLITLIK: bu yerda faqat mavjud qiymatlar KO'CHIRILADI — hech narsa qayta
 * hisoblanmaydi. `fmtMoney` bilan formatlash — bu ko'rinish, hisob emas: hujjat generatorlari
 * ham aynan shu funksiya bilan chizadi.
 */
import type jsPDF from "jspdf";
import type { DocumentTemplateSchema } from "@bum/shared";
import { fmtMoney, fmtNum, type CompanyInfo } from "./pdf-utils.ts";
import type { DocumentData } from "./template-renderer.ts";
import type { InvoiceData } from "./invoice-pdf.ts";
import type { PurchaseOrderData } from "./purchase-order-pdf.ts";

const dash = (value: string | null | undefined) => value || "—";

/** Kompaniya maydonlari hamma hujjatda bir xil. */
function companyValues(company: CompanyInfo): Record<string, string> {
  return {
    "company.name": company.name,
    "company.legalName": company.legalName ?? "",
    "company.taxId": company.taxId ?? "",
    "company.address": company.address ?? "",
    "company.phone": company.phone ?? "",
  };
}

/** Hamma hujjatda bir xil ustun nomlari — shablonda nom yozilmagan bo'lsa shular ishlatiladi. */
const COLUMN_LABELS: Record<string, string> = {
  index: "№",
  name: "Mahsulot",
  sku: "SKU",
  barcode: "Shtrix-kod",
  unit: "Birlik",
  quantity: "Miqdor",
  price: "Narx",
  discount: "Chegirma",
  total: "Summa",
};

/** Sotuv hisob-fakturasi → shablon uchun tayyor ma'lumot. */
export function invoiceDocumentData(data: InvoiceData, createdByName: string): DocumentData {
  const currency = data.currency ?? "so'm";
  const money = (value: number) => fmtMoney(value, currency);
  return {
    company: data.company,
    values: {
      ...companyValues(data.company),
      "document.number": data.number,
      "document.date": data.date,
      "document.notes": data.notes ?? "",
      "customer.name": data.customerName,
      "customer.phone": dash(data.customerPhone),
      "customer.address": dash(data.customerAddress),
      "warehouse.name": dash(data.warehouseName),
      "finance.subtotal": money(data.subtotal),
      "finance.discount": money(data.discountTotal),
      "finance.tax": money(data.taxTotal),
      "finance.total": money(data.totalAmount),
      "finance.paid": money(data.paidAmount),
      "finance.debt": money(data.balance),
      "user.name": createdByName,
      "system.printedAt": new Date().toLocaleString("uz-UZ"),
    },
    numbers: {
      "finance.subtotal": data.subtotal,
      "finance.discount": data.discountTotal,
      "finance.tax": data.taxTotal,
      "finance.total": data.totalAmount,
      "finance.paid": data.paidAmount,
      "finance.debt": data.balance,
    },
    items: data.items.map((item) => ({
      name: item.name,
      sku: dash(item.sku),
      unit: item.unit,
      quantity: fmtNum(item.qty, 2),
      price: money(item.unitPrice),
      discount: item.discount > 0 ? `${fmtNum(item.discount, 2)}%` : "",
      total: money(item.lineTotal),
    })),
    totals: {
      subtotal: money(data.subtotal),
      discount: money(data.discountTotal),
      tax: money(data.taxTotal),
      total: money(data.totalAmount),
      paid: money(data.paidAmount),
      debt: money(data.balance),
    },
    columnLabels: COLUMN_LABELS,
    codes: { documentNumber: data.number, orderNumber: data.number, customerPhone: data.customerPhone || undefined },
  };
}

/** Xarid buyurtmasi → shablon uchun tayyor ma'lumot. */
export function purchaseDocumentData(data: PurchaseOrderData, createdByName: string): DocumentData {
  const money = (value: number) => fmtMoney(value, data.currency);
  // Xaridda oraliq summa alohida kelmaydi — jami bilan bir xil (soliq va chegirma qatorda)
  return {
    company: data.company,
    values: {
      ...companyValues(data.company),
      "document.number": data.number,
      "document.date": data.orderDate,
      "document.notes": data.notes ?? "",
      "supplier.name": data.supplierName,
      "supplier.phone": dash(data.supplierPhone),
      "warehouse.name": dash(data.warehouseName),
      "finance.total": money(data.totalAmount),
      "finance.paid": money(data.paidAmount),
      "finance.debt": money(data.balance),
      "user.name": createdByName,
      "system.printedAt": new Date().toLocaleString("uz-UZ"),
    },
    numbers: {
      "finance.total": data.totalAmount,
      "finance.paid": data.paidAmount,
      "finance.debt": data.balance,
    },
    items: data.items.map((item) => ({
      name: item.productName,
      sku: dash(item.productSku),
      unit: item.unitName,
      quantity: fmtNum(item.orderedQty, 2),
      price: money(item.unitPrice),
      total: money(item.lineTotal),
    })),
    totals: {
      total: money(data.totalAmount),
      paid: money(data.paidAmount),
      debt: money(data.balance),
    },
    columnLabels: COLUMN_LABELS,
    codes: { documentNumber: data.number, orderNumber: data.number },
  };
}

/**
 * Kompaniyaning amaldagi shablonini oladi. Shablon yo'q bo'lsa (yoki so'rov muvaffaqiyatsiz
 * bo'lsa) `null` — chaqiruvchi avvalgi qat'iy ko'rinishga tushadi.
 */
export async function activeTemplate(
  documentType: "sales_invoice" | "purchase_order",
): Promise<DocumentTemplateSchema | null> {
  const { api } = await import("@/lib/api.ts");
  const result = await api
    .get<{ schema: DocumentTemplateSchema; custom: boolean }>(`/api/documents/active/${documentType}`)
    .catch(() => null);
  return result?.custom ? result.schema : null;
}

/** Shablon bilan chizib, faylni saqlaydi. */
export async function saveWithTemplate(
  schema: DocumentTemplateSchema,
  data: DocumentData,
  fileName: string,
): Promise<jsPDF> {
  const { renderTemplate } = await import("./template-renderer.ts");
  const doc = await renderTemplate(schema, data);
  doc.save(fileName);
  return doc;
}
