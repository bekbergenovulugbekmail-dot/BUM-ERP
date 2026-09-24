/**
 * A4 hujjatlar: nakladnoy va xarid buyurtmasi qog'ozga to'g'ri chiqishi kerak.
 *
 * Regressiya: 50+ qatorli hujjatda kompaniya sarlavhasi faqat birinchi sahifada chizilardi,
 * jadval qatorlari footer tasmasi ustiga tushardi, jami qutisi va imzo joyi esa sahifa chetidan
 * tashqariga chiqib ko'rinmay qolardi.
 */
import { describe, expect, it, vi } from "vitest";

/**
 * Test faqat CHIZILGAN hujjatni tekshiradi — diskka fayl yozilmasligi kerak.
 * jsPDF `save` ni NUSXA (instance) ga yozadi, shuning uchun konstruktordan keyin almashtiriladi.
 */
vi.mock("jspdf", async (importOriginal) => {
  const actual = await importOriginal<typeof import("jspdf")>();
  const Wrapped = function (...args: ConstructorParameters<typeof actual.jsPDF>) {
    const doc = new actual.jsPDF(...args);
    doc.save = (() => doc) as typeof doc.save;
    return doc;
  } as unknown as typeof actual.jsPDF;
  return { ...actual, default: Wrapped, jsPDF: Wrapped };
});

const { A4, contentBottom } = await import("./pdf-utils.ts");
const { generateSalesInvoicePDF } = await import("./invoice-pdf.ts");
const { generatePurchaseOrderPDF } = await import("./purchase-order-pdf.ts");
const { generateDeliveryWaybillPDF } = await import("./delivery-waybill-pdf.ts");
type InvoiceItem = Parameters<typeof generateSalesInvoicePDF>[0]["items"][number];

const company = {
  name: "BUM DISTRIBUTION MCHJ",
  legalName: "BUM DISTRIBUTION",
  taxId: "301234567",
  address: "Urganch sh., Al-Xorazmiy 12",
  phone: "+998 90 123 45 67",
};

const item = (index: number, name = `Mahsulot ${index}`): InvoiceItem => ({
  name,
  sku: `SKU-${String(index).padStart(4, "0")}`,
  qty: 10 + index,
  unit: index % 3 === 0 ? "blok" : index % 3 === 1 ? "dona" : "pachka",
  unitPrice: 10_000 + index * 137,
  discount: index % 5 === 0 ? 5 : 0,
  taxRate: 0,
  lineTotal: (10 + index) * (10_000 + index * 137),
});

const invoice = (count: number, overrides: Partial<Parameters<typeof generateSalesInvoicePDF>[0]> = {}) => {
  const items = Array.from({ length: count }, (_, index) => item(index + 1));
  const subtotal = items.reduce((sum, row) => sum + row.lineTotal, 0);
  return generateSalesInvoicePDF({
    company,
    number: "SO-2026-0042",
    date: "2026-09-22",
    status: "completed",
    customerName: "BARAKA SAVDO MCHJ",
    customerPhone: "+998 91 000 00 00",
    customerAddress: "Xiva sh., Ichan qal'a 4",
    warehouseName: "Asosiy ombor",
    deliveryDate: "2026-09-23",
    currency: "so'm",
    items,
    subtotal,
    discountTotal: 0,
    taxTotal: 0,
    totalAmount: subtotal,
    paidAmount: 0,
    balance: subtotal,
    notes: undefined,
    ...overrides,
  });
};

type Doc = Awaited<ReturnType<typeof generateSalesInvoicePDF>>;

/** Sahifa tarkibidagi matn (jsPDF oqimidan) — sarlavha va jami qidirish uchun. */
function pageText(doc: Doc, page: number): string {
  const pages = (doc as unknown as { internal: { pages: string[][] } }).internal.pages;
  return (pages[page] ?? []).join(" ");
}

const pageCount = (doc: Doc) => doc.getNumberOfPages();

/** A4 balandligi punktda (jsPDF ichki birligi). */
const PT_HEIGHT = 841.89;
const PT_PER_MM = 72 / 25.4;

/**
 * Sahifadagi matn bloklari: qayerga chizilgani (mm, YUQORIDAN) va matni.
 * jsPDF oqimida `x y Td ... (matn) Tj` bo'ladi; `y` — punktda va PASTDAN.
 */
function textBlocks(doc: Doc, page: number): { top: number; text: string }[] {
  const stream = pageText(doc, page);
  const blocks: { top: number; text: string }[] = [];
  const re = /([\d.]+)\s+([\d.]+)\s+Td\s*\n?\s*\((.*?)\)\s*Tj/gs;
  for (const match of stream.matchAll(re)) {
    blocks.push({ top: (PT_HEIGHT - Number(match[2])) / PT_PER_MM, text: match[3]! });
  }
  return blocks;
}

describe("A4 hujjatlar", () => {
  it("sahifa formati aynan A4 (210 x 297 mm)", async () => {
    const doc = await invoice(1);
    expect(Math.round(doc.internal.pageSize.getWidth())).toBe(A4.width);
    expect(Math.round(doc.internal.pageSize.getHeight())).toBe(A4.height);
    expect(pageCount(doc), "bitta mahsulot — bitta sahifa").toBe(1);
  });

  it("bitta, o'nta va 50+ mahsulot — hammasi chiziladi", async () => {
    expect(pageCount(await invoice(1))).toBe(1);
    expect(pageCount(await invoice(10))).toBe(1);
    const big = await invoice(60);
    expect(pageCount(big), "60 qator bir sahifaga sig'maydi").toBeGreaterThan(1);
    const huge = await invoice(120);
    expect(pageCount(huge)).toBeGreaterThan(pageCount(big));
  });

  it("kompaniya sarlavhasi HAR sahifada takrorlanadi", async () => {
    const doc = await invoice(80);
    const pages = pageCount(doc);
    expect(pages).toBeGreaterThan(1);
    for (let page = 1; page <= pages; page += 1) {
      expect(pageText(doc, page), `${page}-sahifada sarlavha yo'q`).toContain("BUM DISTRIBUTION");
      expect(pageText(doc, page), `${page}-sahifada hujjat raqami yo'q`).toContain("SO-2026-0042");
    }
  });

  it("jadval sarlavhasi qator bo'lgan har sahifada qaytadi", async () => {
    const doc = await invoice(80);
    let pagesWithRows = 0;
    for (let page = 1; page <= pageCount(doc); page += 1) {
      const text = pageText(doc, page);
      // Qator bor sahifa: SKU ko'rinadi. Oxirgi sahifa faqat jami/imzo bo'lishi mumkin.
      if (!text.includes("SKU-")) continue;
      pagesWithRows += 1;
      expect(text, `${page}-sahifada ustun nomlari yo'q`).toContain("Mahsulot");
    }
    expect(pagesWithRows, "qator bir necha sahifaga bo'lindi").toBeGreaterThan(1);
  });

  it("jami bir marta va barcha qatorlardan keyin; imzo undan keyin, sahifa ichida", async () => {
    const doc = await invoice(80);
    const pages = pageCount(doc);
    const pageOf = (needle: string) =>
      [...Array(pages).keys()].map((index) => index + 1).filter((page) => pageText(doc, page).includes(needle));

    const totalPages = pageOf("JAMI:");
    expect(totalPages, "jami butun hujjatda bir marta").toHaveLength(1);
    const lastRowPage = Math.max(...pageOf("SKU-"));
    expect(totalPages[0]!, "jami barcha qatorlardan keyin").toBeGreaterThanOrEqual(lastRowPage);

    const signaturePages = pageOf("imzo");
    expect(signaturePages, "imzo bir marta").toHaveLength(1);
    expect(signaturePages[0]!, "imzo jamidan keyin").toBeGreaterThanOrEqual(totalPages[0]!);

    // Ikkalasi ham sahifa ichida (chetdan tashqarida emas)
    for (const [page, needle] of [[totalPages[0]!, "JAMI:"], [signaturePages[0]!, "imzo"]] as const) {
      const block = textBlocks(doc, page).find((row) => row.text.includes(needle))!;
      expect(block.top, `${needle} sahifadan chiqib ketmaydi`).toBeLessThanOrEqual(A4.height);
      expect(block.top).toBeGreaterThanOrEqual(0);
    }
  });

  it("hech bir element sahifadan tashqariga chiqmaydi, qator footer ustiga tushmaydi", async () => {
    for (const count of [47, 60, 120]) {
      const doc = await invoice(count);
      for (let page = 1; page <= pageCount(doc); page += 1) {
        for (const block of textBlocks(doc, page)) {
          expect(block.top, `${count}/${page}: "${block.text}" sahifadan yuqorida`).toBeGreaterThanOrEqual(0);
          expect(block.top, `${count}/${page}: "${block.text}" sahifadan pastda`).toBeLessThanOrEqual(A4.height);
          // Jadval qatorlari (SKU) footer tasmasiga tushmaydi — footerning o'zi bundan mustasno
          if (block.text.includes("SKU-")) {
            expect(block.top, `${count}/${page}: qator footer ustida`).toBeLessThanOrEqual(contentBottom());
          }
        }
      }
    }
    expect(contentBottom()).toBe(A4.height - A4.footerHeight);
  });

  it("uzun mahsulot nomi va aralash birliklar kesilmaydi", async () => {
    const longName = "Coca Cola Zero Sugar 1.5 L plastik shishada, 6 tali blok qadoq, aksiya narxida";
    const doc = await invoice(3, {
      items: [
        { ...item(1, longName), unit: "blok" },
        { ...item(2), unit: "pachka" },
        { ...item(3), unit: "dona" },
      ],
    });
    const text = pageText(doc, 1);
    // Nom bo'linib ko'chsa ham birinchi bo'lagi chiqadi; birliklar to'liq ko'rinadi
    expect(text).toContain("Coca Cola Zero Sugar");
    for (const unit of ["blok", "pachka", "dona"]) {
      expect(text, `${unit} birligi ko'rinmadi`).toContain(unit);
    }
  });

  it("chegirma, to'langan va qarz — mavjud bo'lsagina ko'rsatiladi", async () => {
    const withDiscount = await invoice(5, { discountTotal: 50_000, paidAmount: 100_000, balance: 900_000, totalAmount: 1_000_000 });
    const text = pageText(withDiscount, pageCount(withDiscount));
    expect(text, "jami qatorida chegirma").toContain("Chegirma:");
    expect(text).toContain("To'langan:");
    expect(text).toContain("Qoldi:");

    // Chegirma yo'q hujjatda jami ichida soxta qator chiqmaydi ("Chegirma" — jadval USTUNI, u qoladi)
    const plain = await invoice(5);
    expect(pageText(plain, pageCount(plain)), "soxta chegirma qatori").not.toContain("Chegirma:");
  });

  it("izoh chap tomonda, jami o'ngda — ikkalasi ham sahifa ichida", async () => {
    const doc = await invoice(45, { notes: "Yetkazish ertaga soat 9:00 da. Mashina raqami 95 A 123 BC. Qabul qiluvchi: Sardor aka." });
    const pages = pageCount(doc);
    const notesPage = [...Array(pages).keys()]
      .map((index) => index + 1)
      .find((page) => pageText(doc, page).includes("Izoh:"))!;
    expect(notesPage, "izoh chizilgan").toBeGreaterThan(0);
    expect(pageText(doc, notesPage), "izoh va jami bir sahifada").toContain("JAMI:");
    for (const block of textBlocks(doc, notesPage)) {
      expect(block.top).toBeLessThanOrEqual(A4.height);
    }
  });

  it("xarid buyurtmasi ham bir xil A4 standartida", async () => {
    const items = Array.from({ length: 70 }, (_, index) => ({
      productName: `Xarid mahsuloti ${index + 1}`,
      productSku: `P-${index + 1}`,
      unitName: index % 2 === 0 ? "blok" : "dona",
      orderedQty: 100,
      receivedQty: 100,
      unitPrice: 60_000,
      lineTotal: 6_000_000,
    }));
    const doc = await generatePurchaseOrderPDF({
      company,
      number: "PO-2026-0007",
      orderDate: "2026-09-22",
      status: "received",
      supplierName: "TA'MINOTCHI MCHJ",
      supplierPhone: "+998 94 111 22 33",
      warehouseName: "Asosiy ombor",
      expectedDate: "2026-09-25",
      paymentTerms: 14,
      currency: "so'm",
      items,
      totalAmount: 420_000_000,
      paidAmount: 0,
      balance: 420_000_000,
      notes: undefined,
    });

    expect(Math.round(doc.internal.pageSize.getWidth())).toBe(A4.width);
    const pages = doc.getNumberOfPages();
    expect(pages).toBeGreaterThan(1);
    for (let page = 1; page <= pages; page += 1) {
      const text = pageText(doc, page);
      expect(text, `${page}-sahifada sarlavha yo'q`).toContain("BUM DISTRIBUTION");
      if (text.includes("P-1")) expect(text, `${page}-sahifada ustun nomlari yo'q`).toContain("Mahsulot");
    }
    expect(pageText(doc, pages)).toContain("JAMI:");
    expect(pageText(doc, pages)).toContain("imzo");
  });

  /**
   * Yetkazma nakladnoyi: agent qo'liga beriladigan qog'oz. Mas'ul shaxs va agent nomi
   * oynada tahrirlanadi — hujjatga aynan TAHRIRLANGAN qiymat tushishi kerak, aks holda
   * foydalanuvchi to'g'rilagan narsa qog'ozda ko'rinmay qolardi.
   */
  const waybill = (count: number, overrides: Partial<Parameters<typeof generateDeliveryWaybillPDF>[0]> = {}) =>
    generateDeliveryWaybillPDF({
      company,
      number: "AG-01-2026-09-22",
      date: "2026-09-22",
      agentName: "Sardor Yusupov",
      agentCode: "AG-01",
      agentPhone: "+998 93 222 33 44",
      responsibleName: "Ombor mudiri Aziz aka",
      warehouseName: "Asosiy ombor",
      currency: "so'm",
      tasks: Array.from({ length: count }, (_, index) => ({
        number: `YT-${index + 1}`,
        orderNumber: `SO-${index + 1}`,
        customerName: `Mijoz ${index + 1}`,
        customerPhone: "+998 90 000 00 00",
        customerAddress: "Urganch sh., ko'cha 1",
        orderTotal: 250_000,
        customerDebt: 100_000,
      })),
      ...overrides,
    });

  it("nakladnoy A4 standartida; mas'ul shaxs va agent nomi qog'ozda", async () => {
    const doc = await waybill(3);
    expect(Math.round(doc.internal.pageSize.getWidth())).toBe(A4.width);
    const text = pageText(doc, 1);
    expect(text, "mas'ul shaxs").toContain("Ombor mudiri Aziz aka");
    expect(text, "agent nomi").toContain("Sardor Yusupov");
    expect(pageText(doc, pageCount(doc)), "jami summa qatori").toContain("Jami summa");
    expect(pageText(doc, pageCount(doc)), "jami qarz qatori").toContain("Jami qarz");
  });

  it("ustunlarni o'chirish qog'ozdan olib tashlaydi (qarz, manzil, telefon)", async () => {
    const hidden = await waybill(3, { columns: { address: false, phone: false, debt: false } });
    const text = [...Array(pageCount(hidden)).keys()].map((index) => pageText(hidden, index + 1)).join(" ");
    expect(text, "qarz ustuni o'chirilgan").not.toContain("Jami qarz");
    expect(text).not.toContain("Manzil");
    expect(text).not.toContain("Telefon");
    // Summa va mijoz baribir qoladi — ular hujjatning mohiyati
    expect(text).toContain("Mijoz 1");
    expect(text).toContain("Jami summa");
  });

  it("uzun nakladnoy ko'p sahifaga bo'linadi, sarlavha va imzo joyida qoladi", async () => {
    const doc = await waybill(70);
    const pages = pageCount(doc);
    expect(pages).toBeGreaterThan(1);
    for (let page = 1; page <= pages; page += 1) {
      expect(pageText(doc, page), `${page}-sahifada sarlavha yo'q`).toContain("BUM DISTRIBUTION");
      for (const block of textBlocks(doc, page)) {
        expect(block.top, `"${block.text}" sahifadan chiqib ketdi`).toBeGreaterThanOrEqual(0);
        expect(block.top).toBeLessThanOrEqual(A4.height);
      }
    }
    expect(pageText(doc, pages), "imzo qatori").toContain("Topshirdi");
  });
});
