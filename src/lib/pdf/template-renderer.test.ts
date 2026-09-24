/**
 * Shablon renderer: KO'RINISHni shablon boshqaradi, QIYMATni esa hujjat ma'lumoti.
 *
 * Eng muhim tekshiruv — MOLIYAVIY YAXLITLIK: shablonni qanday o'zgartirmaylik, qog'ozdagi
 * summa hujjat ma'lumotidagi summa bo'lib qolishi kerak.
 */
import { describe, expect, it, vi } from "vitest";
import type { DocumentTemplateSchema } from "@bum/shared";

vi.mock("jspdf", async (importOriginal) => {
  const actual = await importOriginal<typeof import("jspdf")>();
  const Wrapped = function (...args: ConstructorParameters<typeof actual.jsPDF>) {
    const doc = new actual.jsPDF(...args);
    doc.save = (() => doc) as typeof doc.save;
    return doc;
  } as unknown as typeof actual.jsPDF;
  return { ...actual, default: Wrapped, jsPDF: Wrapped };
});

const { renderTemplate, isVisible } = await import("./template-renderer.ts");
type Data = Parameters<typeof renderTemplate>[1];

const page: DocumentTemplateSchema["page"] = {
  size: "a4",
  orientation: "portrait",
  margins: { top: 14, right: 14, bottom: 14, left: 14 },
  footerOnEveryPage: true,
  signaturesOnLastPage: true,
};

const schema = (elements: DocumentTemplateSchema["sections"][number]["elements"]): DocumentTemplateSchema => ({
  schemaVersion: 1,
  page,
  sections: [
    { key: "header", elements: [] },
    { key: "body", elements },
    { key: "footer", elements: [] },
  ],
});

const data = (overrides: Partial<Data> = {}): Data => ({
  company: { name: "BUM DISTRIBUTION" },
  values: { "customer.name": "Test Market", "finance.debt": "0", "document.number": "DL-2026-0005" },
  items: [
    { name: "Coca Cola 1L", unit: "Dona", quantity: "12", price: "8 300", total: "99 600" },
    { name: "Suv 0.5L", unit: "Blok", quantity: "2", price: "36 000", total: "72 000" },
  ],
  totals: { total: "171 600 so'm", debt: "0 so'm" },
  numbers: { "finance.debt": 0 },
  ...overrides,
});

/** Sahifadagi matn (jsPDF oqimidan). */
function pageText(doc: Awaited<ReturnType<typeof renderTemplate>>, pageNumber = 1): string {
  const pages = (doc as unknown as { internal: { pages: string[][] } }).internal.pages;
  return (pages[pageNumber] ?? []).join(" ");
}

describe("Shablon renderer", () => {
  it("matn yorlig'i va dinamik qiymat qog'ozga tushadi", async () => {
    const doc = await renderTemplate(
      schema([
        { id: "a", type: "text", label: "QABUL QILUVCHI" },
        { id: "b", type: "field", field: "customer.name", label: "Mijoz" },
      ]),
      data(),
    );
    const text = pageText(doc);
    expect(text).toContain("QABUL QILUVCHI");
    expect(text).toContain("Test Market");
  });

  it("jadval ustunlari SHABLONDAN — SKU olib tashlansa qog'ozda ham yo'q", async () => {
    const withSku = await renderTemplate(
      schema([{ id: "t", type: "itemsTable", columns: [{ key: "name" }, { key: "sku", label: "SKU" }, { key: "total" }] }]),
      data({ items: [{ name: "Coca Cola 1L", sku: "COLA-1", total: "99 600" }] }),
    );
    expect(pageText(withSku)).toContain("COLA-1");

    const withoutSku = await renderTemplate(
      schema([{ id: "t", type: "itemsTable", columns: [{ key: "name" }, { key: "total" }] }]),
      data({ items: [{ name: "Coca Cola 1L", sku: "COLA-1", total: "99 600" }] }),
    );
    expect(pageText(withoutSku), "ustun olib tashlangan — qiymat ham chiqmaydi").not.toContain("COLA-1");
    expect(pageText(withoutSku)).toContain("Coca Cola 1L");
  });

  it("ustun nomini o'zgartirish mumkin, qiymat esa o'zgarmaydi", async () => {
    const doc = await renderTemplate(
      schema([{ id: "t", type: "itemsTable", columns: [{ key: "name", label: "Tovar" }, { key: "total" }] }]),
      data(),
    );
    const text = pageText(doc);
    expect(text).toContain("Tovar");
    expect(text).toContain("99 600");
  });

  it("MOLIYAVIY YAXLITLIK: shablon o'zgarsa ham summa hujjatdagidek qoladi", async () => {
    const compact = await renderTemplate(schema([{ id: "x", type: "totals", rows: ["total"] }]), data());
    const detailed = await renderTemplate(
      schema([
        { id: "t", type: "itemsTable", columns: [{ key: "name" }, { key: "total" }] },
        { id: "x", type: "totals", rows: ["total", "debt"] },
      ]),
      data(),
    );
    // Ikkala ko'rinishda ham AYNAN bir summa
    expect(pageText(compact)).toContain("171 600");
    expect(pageText(detailed)).toContain("171 600");
  });

  it("jami blokida faqat tanlangan qatorlar chiqadi", async () => {
    const doc = await renderTemplate(schema([{ id: "x", type: "totals", rows: ["total"] }]), data());
    const text = pageText(doc);
    expect(text).toContain("Jami");
    expect(text, "qarz qatori tanlanmagan").not.toContain("Qarz");
  });

  it("shart bajarilmasa element umuman chizilmaydi", async () => {
    const hidden = await renderTemplate(
      schema([{ id: "a", type: "text", label: "QARZINGIZ BOR", visibleWhen: { field: "finance.debt", operator: "gt", value: 0 } }]),
      data(),
    );
    expect(pageText(hidden)).not.toContain("QARZINGIZ BOR");

    const shown = await renderTemplate(
      schema([{ id: "a", type: "text", label: "QARZINGIZ BOR", visibleWhen: { field: "finance.debt", operator: "gt", value: 0 } }]),
      data({ values: { "finance.debt": "50000" }, numbers: { "finance.debt": 50_000 } }),
    );
    expect(pageText(shown)).toContain("QARZINGIZ BOR");
  });

  it("imzo yorliqlarini foydalanuvchi o'zi yozadi", async () => {
    const doc = await renderTemplate(schema([{ id: "s", type: "signatures", label: "Dostavshik|Do'kon egasi" }]), data());
    const text = pageText(doc);
    expect(text).toContain("Dostavshik");
    expect(text).toContain("egasi");
  });

  it("uzun jadval ko'p sahifaga bo'linadi va chetdan chiqmaydi", async () => {
    const items = Array.from({ length: 90 }, (_, index) => ({
      name: `Mahsulot ${index + 1}`,
      unit: "Dona",
      quantity: "10",
      price: "8 300",
      total: "83 000",
    }));
    const doc = await renderTemplate(
      schema([
        { id: "t", type: "itemsTable", columns: [{ key: "index" }, { key: "name" }, { key: "quantity" }, { key: "total" }] },
        { id: "x", type: "totals", rows: ["total"] },
        { id: "s", type: "signatures", label: "Topshirdi|Qabul qildi" },
      ]),
      data({ items }),
    );
    expect(doc.getNumberOfPages()).toBeGreaterThan(1);
    // Jami va imzo OXIRGI sahifada va ko'rinadi
    const last = pageText(doc, doc.getNumberOfPages());
    expect(last).toContain("Jami");
    expect(last).toContain("Topshirdi");
  });
});

describe("Shart tekshiruvi (sof funksiya)", () => {
  const values = data();
  it("son va matn taqqoslash", () => {
    expect(isVisible({ field: "finance.debt", operator: "gt", value: 0 }, values)).toBe(false);
    expect(isVisible({ field: "customer.name", operator: "notEmpty" }, values)).toBe(true);
    expect(isVisible({ field: "customer.name", operator: "eq", value: "Test Market" }, values)).toBe(true);
    expect(isVisible({ field: "yoq.maydon", operator: "empty" }, values)).toBe(true);
  });

  it("shart yo'q bo'lsa element ko'rinadi", () => {
    expect(isVisible(undefined, values)).toBe(true);
  });
});
