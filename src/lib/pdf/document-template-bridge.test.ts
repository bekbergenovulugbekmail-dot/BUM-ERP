/**
 * Hisob-faktura va xarid buyurtmasini shablonga ulash.
 *
 * Eng muhim tekshiruv — MOLIYAVIY YAXLITLIK: ko'prik qiymatlarni faqat KO'CHIRADI, qayta
 * hisoblamaydi. Hujjatdagi summa shablon orqali o'zgarmasligi kerak.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("jspdf", async (importOriginal) => {
  const actual = await importOriginal<typeof import("jspdf")>();
  const Wrapped = function (...args: ConstructorParameters<typeof actual.jsPDF>) {
    const doc = new actual.jsPDF(...args);
    doc.save = (() => doc) as typeof doc.save;
    return doc;
  } as unknown as typeof actual.jsPDF;
  return { ...actual, default: Wrapped, jsPDF: Wrapped };
});

const { invoiceDocumentData, purchaseDocumentData } = await import("./document-template-bridge.ts");
const { renderTemplate } = await import("./template-renderer.ts");
type Invoice = Parameters<typeof invoiceDocumentData>[0];
type Purchase = Parameters<typeof purchaseDocumentData>[0];

const company = { name: "BONNU MARKET", taxId: "301234567" };

const invoice: Invoice = {
  company,
  number: "SO-2026-0004",
  date: "2026-09-25",
  customerName: "Test Market",
  customerPhone: "+998900000000",
  customerAddress: "Urganch sh., Bozor 5",
  warehouseName: "Asosiy ombor",
  items: [
    { name: "Coca Cola 1L", sku: "COLA-1", qty: 12, unit: "Dona", unitPrice: 8300, discount: 0, taxRate: 0, lineTotal: 99_600 },
    { name: "Suv 0.5L", sku: "SUV-05", qty: 2, unit: "Blok", unitPrice: 36_000, discount: 5, taxRate: 0, lineTotal: 68_400 },
  ],
  subtotal: 168_000,
  taxTotal: 0,
  discountTotal: 3_600,
  totalAmount: 164_400,
  paidAmount: 100_000,
  balance: 64_400,
  currency: "so'm",
  status: "completed",
};

const purchase: Purchase = {
  company,
  number: "PO-2026-0001",
  orderDate: "2026-09-25",
  supplierName: "Global Trade MCHJ",
  supplierPhone: "+998911112233",
  warehouseName: "Asosiy ombor",
  items: [
    { productName: "Coca Cola 1L", productSku: "COLA-1", orderedQty: 10, receivedQty: 0, unitName: "Blok", unitPrice: 99_600, lineTotal: 996_000 },
  ],
  totalAmount: 996_000,
  paidAmount: 500_000,
  balance: 496_000,
  currency: "so'm",
  status: "confirmed",
};

const page = {
  size: "a4" as const,
  orientation: "portrait" as const,
  margins: { top: 14, right: 14, bottom: 14, left: 14 },
  footerOnEveryPage: true,
  signaturesOnLastPage: true,
};

const schemaWith = (elements: Parameters<typeof renderTemplate>[0]["sections"][number]["elements"]) => ({
  schemaVersion: 1 as const,
  page,
  sections: [
    { key: "header" as const, elements: [] },
    { key: "body" as const, elements },
    { key: "footer" as const, elements: [] },
  ],
});

const pageText = (doc: Awaited<ReturnType<typeof renderTemplate>>, pageNumber = 1) =>
  ((doc as unknown as { internal: { pages: string[][] } }).internal.pages[pageNumber] ?? []).join(" ");

describe("Hisob-faktura → shablon", () => {
  it("mijoz, hujjat va moliya maydonlari to'ladi", () => {
    const data = invoiceDocumentData(invoice, "Kassir Diana");
    expect(data.values["customer.name"]).toBe("Test Market");
    expect(data.values["document.number"]).toBe("SO-2026-0004");
    expect(data.values["warehouse.name"]).toBe("Asosiy ombor");
    expect(data.values["user.name"]).toBe("Kassir Diana");
    // Yetkazma nakladnoyidan farqli: bu yerda oraliq summa, chegirma va to'langan ham bor
    for (const key of ["finance.subtotal", "finance.discount", "finance.tax", "finance.total", "finance.paid", "finance.debt"]) {
      expect(data.values[key], `${key} bo'sh`).toBeTruthy();
    }
  });

  it("jadval qatorlari MAHSULOT bo'ladi (yetkazmada mijoz edi)", () => {
    const data = invoiceDocumentData(invoice, "—");
    expect(data.items).toHaveLength(2);
    expect(data.items[0]).toMatchObject({ name: "Coca Cola 1L", sku: "COLA-1", unit: "Dona" });
    expect(data.items[1]!.unit, "birlik hujjatdan keladi — qayta hisoblanmaydi").toBe("Blok");
  });

  it("MOLIYAVIY YAXLITLIK: summa ko'chiriladi, qayta hisoblanmaydi", () => {
    const data = invoiceDocumentData(invoice, "—");
    // 164 400 — hujjatdagi jami. Qatorlar yig'indisi (168 000) bilan ALMASHTIRILMAYDI
    expect(data.totals.total).toContain("164");
    expect(data.numbers?.["finance.total"]).toBe(164_400);
    expect(data.numbers?.["finance.debt"]).toBe(64_400);
  });

  it("shablon bilan chizilganda summa o'zgarmaydi", async () => {
    const data = invoiceDocumentData(invoice, "—");
    const compact = await renderTemplate(schemaWith([{ id: "x", type: "totals", rows: ["total"] }]), data);
    const detailed = await renderTemplate(
      schemaWith([
        { id: "t", type: "itemsTable", columns: [{ key: "name" }, { key: "quantity" }, { key: "total" }] },
        { id: "x", type: "totals", rows: ["subtotal", "discount", "total", "paid", "debt"] },
      ]),
      data,
    );
    expect(pageText(compact)).toContain("164");
    expect(pageText(detailed)).toContain("164");
  });

  it("chegirmasiz qatorda chegirma ustuni bo'sh qoladi", () => {
    const data = invoiceDocumentData(invoice, "—");
    expect(data.items[0]!.discount, "chegirma 0 — bo'sh").toBe("");
    expect(data.items[1]!.discount).toContain("5");
  });
});

describe("Xarid buyurtmasi → shablon", () => {
  it("ta'minotchi maydonlari to'ladi, mijoz maydonlari umuman yo'q", () => {
    const data = purchaseDocumentData(purchase, "Ombor mudiri");
    expect(data.values["supplier.name"]).toBe("Global Trade MCHJ");
    expect(data.values["supplier.phone"]).toBe("+998911112233");
    expect(data.values["customer.name"], "xaridda mijoz yo'q").toBeUndefined();
  });

  it("jami, to'langan va qarz hujjatdan keladi", () => {
    const data = purchaseDocumentData(purchase, "—");
    expect(data.numbers?.["finance.total"]).toBe(996_000);
    expect(data.numbers?.["finance.paid"]).toBe(500_000);
    expect(data.numbers?.["finance.debt"]).toBe(496_000);
    expect(data.totals.subtotal, "xaridda oraliq summa yo'q — qator chizilmaydi").toBeUndefined();
  });

  it("mahsulot qatori buyurtma birligida ko'rsatiladi", () => {
    const data = purchaseDocumentData(purchase, "—");
    // Miqdor mahalliy formatda (`fmtNum`) — boshqa hujjatlar ham shunday chizadi
    expect(data.items[0]).toMatchObject({ name: "Coca Cola 1L", unit: "Blok" });
    expect(data.items[0]!.quantity).toMatch(/^10[.,]00$/);
  });

  it("shablon bilan chizilganda ta'minotchi va summa qog'ozga tushadi", async () => {
    const doc = await renderTemplate(
      schemaWith([
        { id: "s", type: "field", field: "supplier.name", label: "Ta'minotchi" },
        { id: "t", type: "itemsTable", columns: [{ key: "name" }, { key: "unit" }, { key: "total" }] },
        { id: "x", type: "totals", rows: ["total", "debt"] },
      ]),
      purchaseDocumentData(purchase, "—"),
    );
    const text = pageText(doc);
    expect(text).toContain("Global Trade");
    expect(text).toContain("Blok");
    expect(text).toContain("996");
  });
});

describe("QR va shtrix-kod manbalari", () => {
  it("ikkala hujjatda ham hujjat raqami mavjud", () => {
    expect(invoiceDocumentData(invoice, "—").codes?.documentNumber).toBe("SO-2026-0004");
    expect(purchaseDocumentData(purchase, "—").codes?.documentNumber).toBe("PO-2026-0001");
  });

  it("telefoni yo'q xaridda mijoz telefoni manbasi bo'sh qoladi", () => {
    expect(purchaseDocumentData(purchase, "—").codes?.customerPhone).toBeUndefined();
  });
});
