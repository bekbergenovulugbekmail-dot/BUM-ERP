/**
 * Hujjat dizayneri uchun mijoz tomondagi turlar va namuna ma'lumot.
 *
 * Namuna ma'lumot faqat OLDINDAN KO'RISH uchun: production hujjati bilan aralashmaydi va
 * hech qayerga yozilmaydi. Ko'rish oynasi HAQIQIY PDF chiziladi — shuning uchun "ko'rgani
 * bilan bosib chiqqani" bir xil bo'ladi.
 */
import type { DocumentType } from "@bum/shared";
import type { DocumentData } from "@/lib/pdf/template-renderer.ts";

export type TemplateRow = {
  id: string;
  documentType: DocumentType;
  name: string;
  status: "active" | "archived";
  isDefault: boolean;
  currentVersionId: string | null;
  version: number | null;
  createdAt: string;
  updatedAt: string;
};

export type FieldRow = { path: string; label: string; group: string; kind: string };
export type ColumnRow = { key: string; label: string; kind: string };

export type FieldCatalog = {
  fields: FieldRow[];
  columns: ColumnRow[];
  totalRows: readonly string[];
  paymentRows: readonly string[];
};

export type VersionRow = { id: string; version: number; note: string | null; createdAt: string };

export const GROUP_LABELS: Record<string, string> = {
  company: "Kompaniya",
  customer: "Mijoz",
  supplier: "Ta'minotchi",
  document: "Hujjat",
  delivery: "Yetkazma",
  warehouse: "Ombor",
  finance: "Moliya",
  employee: "Xodim",
  user: "Foydalanuvchi",
  system: "Tizim",
};

export const ELEMENT_LABELS: Record<string, string> = {
  text: "Matn",
  field: "Maydon",
  image: "Rasm",
  line: "Chiziq",
  spacer: "Bo'sh joy",
  itemsTable: "Jadval",
  totals: "Jami bloki",
  payments: "To'lovlar",
  signatures: "Imzo",
  qr: "QR kod",
  barcode: "Shtrix-kod",
  rect: "To'rtburchak",
  pageNumber: "Sahifa raqami",
};

export const SECTION_LABELS: Record<string, string> = {
  header: "Sarlavha",
  body: "Asosiy qism",
  footer: "Taglik",
};

/**
 * Oldindan ko'rish uchun NAMUNA ma'lumot — hujjat turiga mos.
 * Summalar shunchaki ko'rsatish uchun; hujjat chiqarilganda haqiqiy qiymat keladi.
 */
export function sampleData(documentType: DocumentType, companyName: string): DocumentData {
  const base: DocumentData = {
    company: { name: companyName || "BUM ERP", taxId: "301234567", address: "Urganch sh., Al-Xorazmiy 12", phone: "+998 90 123 45 67" },
    values: {
      "company.name": companyName || "BUM ERP",
      "company.legalName": `${companyName || "BUM ERP"} MCHJ`,
      "company.taxId": "301234567",
      "company.address": "Urganch sh., Al-Xorazmiy 12",
      "company.phone": "+998 90 123 45 67",
      "document.number": "NAMUNA-0001",
      "document.date": "2026-09-24",
      "document.notes": "Namuna hujjat",
      "customer.name": "Test Market",
      "customer.phone": "+998 90 000 00 00",
      "customer.address": "Urganch sh., Bozor ko'chasi 5",
      "supplier.name": "Global Trade MCHJ",
      "supplier.phone": "+998 91 111 22 33",
      "delivery.route": "Shovot-01",
      "delivery.routeWarehouse": "Shovot-01 · Asosiy ombor",
      "delivery.salesRep": "Karimov Jasur · +998 94 555 66 77",
      "delivery.agent": "Raxmatov Rasul · +998 93 222 33 44",
      "delivery.salesRepName": "Karimov Jasur",
      "delivery.salesRepPhone": "+998 94 555 66 77",
      "delivery.agentName": "Raxmatov Rasul",
      "delivery.agentPhone": "+998 93 222 33 44",
      "delivery.responsibleName": "Ombor mudiri",
      "warehouse.name": "Asosiy ombor",
      "employee.name": "Sardor Yusupov",
      "user.name": "Kompaniya egasi",
      "system.printedAt": "2026-09-24 16:00",
      "finance.subtotal": "1 000 000 so'm",
      "finance.discount": "50 000 so'm",
      "finance.tax": "0 so'm",
      "finance.total": "950 000 so'm",
      "finance.paid": "500 000 so'm",
      "finance.debt": "450 000 so'm",
    },
    numbers: { "finance.debt": 450_000, "finance.discount": 50_000, "finance.total": 950_000 },
    items: [],
    totals: {
      subtotal: "1 000 000 so'm",
      discount: "50 000 so'm",
      tax: "0 so'm",
      total: "950 000 so'm",
      paid: "500 000 so'm",
      debt: "450 000 so'm",
    },
    payments: { cash: "300 000 so'm", card: "200 000 so'm" },
    /**
     * QR va shtrix-kod namunasi. Shusiz oldindan ko'rishda kod UMUMAN chizilmasdi
     * (manba bo'sh bo'lsa element o'tkazib yuboriladi) va foydalanuvchi QR ishlamayapti deb
     * o'ylardi — 2026-09-25 da aynan shu shikoyat kelgan.
     */
    codes: { documentNumber: "NAMUNA-0001", orderNumber: "SO-NAMUNA-0001", customerPhone: "+998900000000" },
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
      cost: "Tannarx",
      margin: "Marja",
      customerName: "Mijoz",
      customerPhone: "Telefon",
      customerAddress: "Manzil",
      customerDebt: "Qarz",
    },
  };

  base.items =
    documentType === "delivery_waybill"
      ? [
          { customerName: "Test Market", customerPhone: "+998 90 000 00 00", customerAddress: "Bozor ko'chasi 5", total: "420 000", customerDebt: "100 000" },
          { customerName: "Oqtepa Do'kon", customerPhone: "+998 91 222 33 44", customerAddress: "Navoiy 12", total: "530 000", customerDebt: "0" },
        ]
      : [
          { name: "Coca Cola 1L", sku: "COLA-1", barcode: "4780001", unit: "Dona", quantity: "12", price: "8 300", discount: "0", total: "99 600", cost: "6 000", margin: "2 300" },
          { name: "Suv 0.5L", sku: "SUV-05", barcode: "4780002", unit: "Blok", quantity: "2", price: "36 000", discount: "0", total: "72 000", cost: "30 000", margin: "6 000" },
          { name: "Pechenye", sku: "PECH", barcode: "4780003", unit: "Quti", quantity: "5", price: "24 000", discount: "5 000", total: "115 000", cost: "18 000", margin: "6 000" },
        ];

  return base;
}
