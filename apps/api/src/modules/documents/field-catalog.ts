/**
 * Maydonlar katalogi — shablonda ishlatish MUMKIN bo'lgan bog'lanishlar ro'yxati.
 *
 * Nega server beradi: brauzer hech qachon o'zi maydon nomi o'ylab topmasin. Dizaynerda
 * ko'ringan har bir maydon shu ro'yxatdan keladi, saqlashda esa shablon yana shu ro'yxat
 * bo'yicha tekshiriladi — ya'ni "maxfiy ustunni qo'lda yozib qo'yish" yo'li yo'q.
 *
 * MAXFIY MAYDON: tannarx va marja faqat `products.view_cost` ruxsati bo'lganda ro'yxatga
 * kiradi. Ruxsatsiz foydalanuvchi uni na ko'radi, na shablonga yozib qo'ya oladi.
 */
import type { DocumentType, Permission } from "@bum/shared";

export type FieldGroup =
  | "company"
  | "customer"
  | "supplier"
  | "document"
  | "delivery"
  | "warehouse"
  | "finance"
  | "employee"
  | "user"
  | "system";

export type FieldDefinition = {
  /** Shablondagi yo'l: `customer.name`. */
  path: string;
  label: string;
  group: FieldGroup;
  /** Qiymat turi — dizayner formatlashni shunga qarab taklif qiladi. */
  kind: "text" | "number" | "money" | "date";
  /** Shu maydon qaysi hujjat turlarida bor. */
  documentTypes: readonly DocumentType[];
  /** Bo'lsa — shu ruxsatsiz maydon ro'yxatga kirmaydi. */
  permission?: Permission;
};

const ALL: readonly DocumentType[] = ["delivery_waybill", "sales_invoice", "purchase_order", "payslip"];
const SALES: readonly DocumentType[] = ["delivery_waybill", "sales_invoice"];

export const FIELD_CATALOG: readonly FieldDefinition[] = [
  { path: "company.name", label: "Kompaniya nomi", group: "company", kind: "text", documentTypes: ALL },
  { path: "company.legalName", label: "Yuridik nomi", group: "company", kind: "text", documentTypes: ALL },
  { path: "company.taxId", label: "STIR", group: "company", kind: "text", documentTypes: ALL },
  { path: "company.address", label: "Manzil", group: "company", kind: "text", documentTypes: ALL },
  { path: "company.phone", label: "Telefon", group: "company", kind: "text", documentTypes: ALL },

  { path: "document.number", label: "Hujjat raqami", group: "document", kind: "text", documentTypes: ALL },
  { path: "document.date", label: "Sana", group: "document", kind: "date", documentTypes: ALL },
  { path: "document.notes", label: "Izoh", group: "document", kind: "text", documentTypes: ALL },

  { path: "customer.name", label: "Mijoz nomi", group: "customer", kind: "text", documentTypes: SALES },
  { path: "customer.phone", label: "Mijoz telefoni", group: "customer", kind: "text", documentTypes: SALES },
  { path: "customer.address", label: "Mijoz manzili", group: "customer", kind: "text", documentTypes: SALES },

  { path: "supplier.name", label: "Taminotchi", group: "supplier", kind: "text", documentTypes: ["purchase_order"] },
  { path: "supplier.phone", label: "Taminotchi telefoni", group: "supplier", kind: "text", documentTypes: ["purchase_order"] },

  { path: "delivery.agentName", label: "Yetkazuvchi", group: "delivery", kind: "text", documentTypes: ["delivery_waybill"] },
  { path: "delivery.agentPhone", label: "Yetkazuvchi telefoni", group: "delivery", kind: "text", documentTypes: ["delivery_waybill"] },
  { path: "delivery.responsibleName", label: "Masul shaxs", group: "delivery", kind: "text", documentTypes: ["delivery_waybill"] },

  { path: "warehouse.name", label: "Ombor", group: "warehouse", kind: "text", documentTypes: ALL },

  // Moliya: qiymat SERVERDAN keladi, shablon faqat joyini va ko'rinishini belgilaydi
  { path: "finance.subtotal", label: "Oraliq summa", group: "finance", kind: "money", documentTypes: ALL },
  { path: "finance.discount", label: "Chegirma", group: "finance", kind: "money", documentTypes: ALL },
  { path: "finance.tax", label: "Soliq", group: "finance", kind: "money", documentTypes: ALL },
  { path: "finance.total", label: "Jami", group: "finance", kind: "money", documentTypes: ALL },
  { path: "finance.paid", label: "Tolangan", group: "finance", kind: "money", documentTypes: ALL },
  { path: "finance.debt", label: "Qarz", group: "finance", kind: "money", documentTypes: ALL },

  { path: "employee.name", label: "Xodim", group: "employee", kind: "text", documentTypes: ["payslip"] },
  { path: "user.name", label: "Hujjatni yaratgan", group: "user", kind: "text", documentTypes: ALL },
  { path: "system.printedAt", label: "Chop etilgan vaqt", group: "system", kind: "date", documentTypes: ALL },
];

/** Mahsulot yoki yetkazma jadvalining ustunlari. */
export type ColumnDefinition = {
  key: string;
  label: string;
  kind: "text" | "number" | "money";
  documentTypes: readonly DocumentType[];
  permission?: Permission;
};

export const COLUMN_CATALOG: readonly ColumnDefinition[] = [
  { key: "index", label: "N", kind: "number", documentTypes: ALL },
  { key: "name", label: "Mahsulot", kind: "text", documentTypes: ALL },
  { key: "sku", label: "SKU", kind: "text", documentTypes: ALL },
  { key: "barcode", label: "Shtrix-kod", kind: "text", documentTypes: ALL },
  { key: "unit", label: "Birlik", kind: "text", documentTypes: ALL },
  { key: "quantity", label: "Miqdor", kind: "number", documentTypes: ALL },
  { key: "price", label: "Narx", kind: "money", documentTypes: ALL },
  { key: "discount", label: "Chegirma", kind: "money", documentTypes: ALL },
  { key: "total", label: "Summa", kind: "money", documentTypes: ALL },
  // Yetkazma nakladnoyida jadval qatori — MIJOZ, mahsulot emas
  { key: "customerName", label: "Mijoz", kind: "text", documentTypes: ["delivery_waybill"] },
  { key: "customerPhone", label: "Telefon", kind: "text", documentTypes: ["delivery_waybill"] },
  { key: "customerAddress", label: "Manzil", kind: "text", documentTypes: ["delivery_waybill"] },
  { key: "customerDebt", label: "Qarz", kind: "money", documentTypes: ["delivery_waybill"] },
  // MAXFIY: faqat tannarxni korish ruxsati bilan
  { key: "cost", label: "Tannarx", kind: "money", documentTypes: ALL, permission: "products.view_cost" },
  { key: "margin", label: "Marja", kind: "money", documentTypes: ALL, permission: "products.view_cost" },
];

/** Jami blokidagi qatorlar. */
export const TOTAL_ROWS = ["subtotal", "discount", "tax", "total", "paid", "debt"] as const;

/** Tolov bloki qatorlari — mavjud tolov usullari. */
export const PAYMENT_ROWS = ["cash", "card", "bank", "transfer"] as const;

export type CatalogAccess = { documentType: DocumentType; permissions: ReadonlySet<string> };

const allowed = (item: { documentTypes: readonly DocumentType[]; permission?: Permission }, access: CatalogAccess) =>
  item.documentTypes.includes(access.documentType) && (!item.permission || access.permissions.has(item.permission));

/** Shu hujjat turi va shu foydalanuvchi uchun ruxsat etilgan maydonlar. */
export function fieldsFor(access: CatalogAccess): FieldDefinition[] {
  return FIELD_CATALOG.filter((field) => allowed(field, access));
}

export function columnsFor(access: CatalogAccess): ColumnDefinition[] {
  return COLUMN_CATALOG.filter((column) => allowed(column, access));
}

/** Boglanish yoli ruxsat etilganmi (saqlashda tekshiriladi). */
export function isFieldAllowed(path: string, access: CatalogAccess): boolean {
  const field = FIELD_CATALOG.find((item) => item.path === path);
  return Boolean(field && allowed(field, access));
}

export function isColumnAllowed(key: string, access: CatalogAccess): boolean {
  const column = COLUMN_CATALOG.find((item) => item.key === key);
  return Boolean(column && allowed(column, access));
}
