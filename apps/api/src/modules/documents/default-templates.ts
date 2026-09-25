/**
 * Standart shablonlar — hozirgi qog'oz ko'rinishining shablon tilidagi ifodasi.
 *
 * Muhim: bu shablonlar bazaga YOZILMAYDI va tahrirlanmaydi. Ular "zavod sozlamasi":
 * kompaniyada o'z shabloni bo'lmasa hujjat shular bilan chiziladi, foydalanuvchi esa
 * nusxa olib (`duplicate`) o'zinikini yaratadi. Shu sababli standartni buzib qo'yish
 * imkoni yo'q — 18-qoida.
 */
import { DEFAULT_PAGE, type DocumentTemplateSchema, type DocumentType } from "@bum/shared";

const id = (prefix: string, index: number) => `${prefix}-${index}`;

/** Yetkazma nakladnoyi: agent qo'liga beriladigan qog'oz. */
const deliveryWaybill: DocumentTemplateSchema = {
  schemaVersion: 1,
  page: { ...DEFAULT_PAGE, margins: { ...DEFAULT_PAGE.margins } },
  sections: [
    {
      key: "header",
      elements: [
        { id: id("h", 1), type: "text", label: "YETKAZMA NAKLADNOYI", style: { fontSize: 16, bold: true, align: "center" } },
        { id: id("h", 2), type: "field", field: "company.name", style: { fontSize: 11, bold: true } },
        { id: id("h", 3), type: "field", field: "document.number", label: "Hujjat" },
        { id: id("h", 4), type: "field", field: "document.date", label: "Sana" },
      ],
    },
    {
      key: "body",
      elements: [
        // Ism va telefon bitta qatorda ("Karimov Jasur · +998 …") — nakladnoy qisqa qoladi, ikkitasi bir A4 ga sig'adi.
        // "Mas'ul shaxs" standartda yo'q (topshirgan — imzo qatorida); kerak bo'lsa dizaynerda maydon sifatida qo'shiladi
        { id: id("b", 6), type: "field", field: "delivery.salesRep", label: "Savdo agenti" },
        { id: id("b", 1), type: "field", field: "delivery.agent", label: "Yetkazuvchi" },
        { id: id("b", 3), type: "field", field: "warehouse.name", label: "Ombor" },
        {
          id: id("b", 4),
          type: "itemsTable",
          columns: [
            { key: "index" },
            { key: "customerName" },
            { key: "customerPhone" },
            { key: "customerAddress" },
            { key: "total", align: "right" },
            { key: "customerDebt", align: "right" },
          ],
        },
        { id: id("b", 5), type: "totals", rows: ["total", "debt"] },
      ],
    },
    {
      key: "footer",
      elements: [
        { id: id("f", 1), type: "signatures", label: "Topshirdi|Qabul qildi" },
        { id: id("f", 2), type: "pageNumber", style: { align: "right", fontSize: 8 } },
      ],
    },
  ],
};

/** Sotuv hisob-fakturasi. */
const salesInvoice: DocumentTemplateSchema = {
  schemaVersion: 1,
  page: { ...DEFAULT_PAGE, margins: { ...DEFAULT_PAGE.margins } },
  sections: [
    {
      key: "header",
      elements: [
        { id: id("h", 1), type: "text", label: "HISOB-FAKTURA", style: { fontSize: 16, bold: true, align: "center" } },
        { id: id("h", 2), type: "field", field: "company.name", style: { fontSize: 11, bold: true } },
        { id: id("h", 3), type: "field", field: "company.taxId", label: "STIR" },
        { id: id("h", 4), type: "field", field: "document.number", label: "Hujjat" },
        { id: id("h", 5), type: "field", field: "document.date", label: "Sana" },
      ],
    },
    {
      key: "body",
      elements: [
        { id: id("b", 1), type: "field", field: "customer.name", label: "Mijoz" },
        { id: id("b", 2), type: "field", field: "customer.phone", label: "Telefon" },
        { id: id("b", 3), type: "field", field: "customer.address", label: "Manzil" },
        {
          id: id("b", 4),
          type: "itemsTable",
          columns: [
            { key: "index" },
            { key: "name" },
            { key: "sku" },
            { key: "unit" },
            { key: "quantity", align: "right" },
            { key: "price", align: "right" },
            { key: "total", align: "right" },
          ],
        },
        { id: id("b", 5), type: "totals", rows: ["subtotal", "discount", "total", "paid", "debt"] },
        // Qarz bo'lmasa bu satr umuman chizilmaydi
        { id: id("b", 6), type: "text", label: "Qarzni kelishilgan muddatda tolashingizni soraymiz.", visibleWhen: { field: "finance.debt", operator: "gt", value: 0 }, style: { fontSize: 8 } },
      ],
    },
    {
      key: "footer",
      elements: [
        { id: id("f", 1), type: "signatures", label: "Topshirdi|Qabul qildi" },
        { id: id("f", 2), type: "pageNumber", style: { align: "right", fontSize: 8 } },
      ],
    },
  ],
};

/** Xarid buyurtmasi. */
const purchaseOrder: DocumentTemplateSchema = {
  schemaVersion: 1,
  page: { ...DEFAULT_PAGE, margins: { ...DEFAULT_PAGE.margins } },
  sections: [
    {
      key: "header",
      elements: [
        { id: id("h", 1), type: "text", label: "XARID BUYURTMASI", style: { fontSize: 16, bold: true, align: "center" } },
        { id: id("h", 2), type: "field", field: "company.name", style: { fontSize: 11, bold: true } },
        { id: id("h", 3), type: "field", field: "document.number", label: "Hujjat" },
        { id: id("h", 4), type: "field", field: "document.date", label: "Sana" },
      ],
    },
    {
      key: "body",
      elements: [
        { id: id("b", 1), type: "field", field: "supplier.name", label: "Taminotchi" },
        { id: id("b", 2), type: "field", field: "warehouse.name", label: "Ombor" },
        {
          id: id("b", 3),
          type: "itemsTable",
          columns: [
            { key: "index" },
            { key: "name" },
            { key: "unit" },
            { key: "quantity", align: "right" },
            { key: "price", align: "right" },
            { key: "total", align: "right" },
          ],
        },
        { id: id("b", 4), type: "totals", rows: ["subtotal", "total", "paid", "debt"] },
      ],
    },
    {
      key: "footer",
      elements: [
        { id: id("f", 1), type: "signatures", label: "Buyurtma berdi|Qabul qildi" },
        { id: id("f", 2), type: "pageNumber", style: { align: "right", fontSize: 8 } },
      ],
    },
  ],
};

/** Maosh varaqasi. */
const payslip: DocumentTemplateSchema = {
  schemaVersion: 1,
  page: { ...DEFAULT_PAGE, margins: { ...DEFAULT_PAGE.margins } },
  sections: [
    {
      key: "header",
      elements: [
        { id: id("h", 1), type: "text", label: "MAOSH VARAQASI", style: { fontSize: 16, bold: true, align: "center" } },
        { id: id("h", 2), type: "field", field: "company.name", style: { fontSize: 11, bold: true } },
        { id: id("h", 3), type: "field", field: "document.date", label: "Davr" },
      ],
    },
    {
      key: "body",
      elements: [
        { id: id("b", 1), type: "field", field: "employee.name", label: "Xodim" },
        { id: id("b", 2), type: "totals", rows: ["total", "paid", "debt"] },
      ],
    },
    {
      key: "footer",
      elements: [{ id: id("f", 1), type: "signatures", label: "Topshirdi|Qabul qildi" }],
    },
  ],
};

export const DEFAULT_TEMPLATES: Record<DocumentType, DocumentTemplateSchema> = {
  delivery_waybill: deliveryWaybill,
  sales_invoice: salesInvoice,
  purchase_order: purchaseOrder,
  payslip: payslip,
};

/** Standart shablonning nusxasi (chaqiruvchi uni o'zgartirsa asl nusxa buzilmasin). */
export const defaultSchemaFor = (type: DocumentType): DocumentTemplateSchema =>
  structuredClone(DEFAULT_TEMPLATES[type]);
