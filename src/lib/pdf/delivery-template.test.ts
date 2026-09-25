/**
 * Yetkazma nakladnoyi shablon bilan: MAHSULOTLAR va ustun nomlari.
 *
 * Regressiya (2026-09-25, egasi yuborgan PDF): qog'ozda jadval sarlavhasi xom kalit
 * (`index`, `name`, `quantity`) bo'lib chiqqan, qatorlar esa deyarli bo'sh edi —
 * nakladnoyga buyurtma qatorlari umuman yuborilmasdi.
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

const { waybillDocumentData, renderWaybillsWithTemplate } = await import("./delivery-template.ts");
const { renderTemplate } = await import("./template-renderer.ts");
type Waybill = Parameters<typeof waybillDocumentData>[0];

const options = { company: { name: "BONNU MARKET" }, currency: "so'm", responsibleName: "Xamdam Allaberganov" };

const delivery = (items: Waybill["items"]): Waybill => ({
  number: "DL-2026-0005",
  status: "assigned",
  scheduledDate: "2026-09-25",
  orderNumber: "SO-2026-0004",
  orderTotal: 42_200,
  customerName: "Test Market",
  customerPhone: "+998900000000",
  customerAddress: "Urganch sh.",
  customerDebt: 0,
  warehouseName: "Asosiy ombor",
  agentCode: "DA-002",
  agentName: "Раматов Расул",
  items,
});

const ITEMS: NonNullable<Waybill["items"]> = [
  { productName: "EZO Osvijitel Pure Comfort 460 ml", productSku: "EZO-460", quantity: "1", unitName: "d", unitPrice: "17200", lineTotal: "17200" },
  { productName: "Gel jidkiy dlya mytya posudy 900", productSku: "GEL-900", quantity: "1", unitName: "d", unitPrice: "16500", lineTotal: "16500" },
  { productName: "Kislorodnyy Ochistitel Neo Max 150 gr", productSku: "NEO-150", quantity: "1", unitName: "d", unitPrice: "8500", lineTotal: "8500" },
];

const page: DocumentTemplateSchema["page"] = {
  size: "a4", orientation: "portrait",
  margins: { top: 14, right: 14, bottom: 14, left: 14 },
  footerOnEveryPage: true, signaturesOnLastPage: true,
};

const tableSchema = (columns: { key: string; label?: string }[]): DocumentTemplateSchema => ({
  schemaVersion: 1,
  page,
  sections: [
    { key: "header", elements: [] },
    { key: "body", elements: [{ id: "t", type: "itemsTable", columns }] },
    { key: "footer", elements: [] },
  ],
});

const pageText = (doc: Awaited<ReturnType<typeof renderTemplate>>, n = 1) =>
  ((doc as unknown as { internal: { pages: string[][] } }).internal.pages[n] ?? []).join(" ");

describe("Nakladnoyda mahsulotlar", () => {
  it("buyurtma qatorlari jadvalga tushadi", () => {
    const data = waybillDocumentData(delivery(ITEMS), options);
    expect(data.items).toHaveLength(3);
    expect(data.items[0]).toMatchObject({ name: "EZO Osvijitel Pure Comfort 460 ml", sku: "EZO-460", unit: "d" });
    expect(data.items[2]!.total).toContain("8");
  });

  it("mijoz ustunlari har qatorda takrorlanadi — ikkala ustun turi ham tanlanadi", () => {
    const data = waybillDocumentData(delivery(ITEMS), options);
    for (const row of data.items) {
      expect(row.customerName).toBe("Test Market");
      expect(row.customerPhone).toBe("+998900000000");
    }
  });

  it("mahsulotsiz buyurtmada jadval bo'sh qolmaydi — yig'ma qator chiqadi", () => {
    const data = waybillDocumentData(delivery([]), options);
    expect(data.items).toHaveLength(1);
    expect(data.items[0]!.customerName).toBe("Test Market");
    expect(data.items[0]!.total).toContain("42");
  });

  it("eski javobda (items yo'q) ham yiqilmaydi", () => {
    const { items: _items, ...withoutItems } = delivery(ITEMS);
    const data = waybillDocumentData(withoutItems as Waybill, options);
    expect(data.items).toHaveLength(1);
  });

  it("MOLIYAVIY YAXLITLIK: jami buyurtmadan keladi, qatorlardan qayta hisoblanmaydi", () => {
    // Qatorlar yig'indisi 42 200 bo'lsa ham, jami hujjatdagi qiymat bo'lib qoladi
    const data = waybillDocumentData({ ...delivery(ITEMS), orderTotal: 40_000 }, options);
    expect(data.numbers?.["finance.total"]).toBe(40_000);
    expect(data.totals.total).toContain("40");
  });
});

describe("Ustun sarlavhalari", () => {
  it("shablonda nom yozilmasa ham xom kalit emas, o'zbekcha nom chiqadi", async () => {
    const doc = await renderTemplate(
      tableSchema([{ key: "index" }, { key: "name" }, { key: "quantity" }, { key: "total" }]),
      waybillDocumentData(delivery(ITEMS), options),
    );
    const text = pageText(doc);
    expect(text).toContain("Mahsulot");
    expect(text).toContain("Miqdor");
    expect(text).toContain("Summa");
    expect(text, "xom kalit qog'ozga tushmaydi").not.toContain("quantity");
  });

  it("foydalanuvchi yozgan nom ustun turadi", async () => {
    const doc = await renderTemplate(
      tableSchema([{ key: "name", label: "Tovar nomi" }, { key: "total" }]),
      waybillDocumentData(delivery(ITEMS), options),
    );
    expect(pageText(doc)).toContain("Tovar nomi");
  });

  it("mijoz ustunlari ham o'zbekcha nomlanadi", async () => {
    const doc = await renderTemplate(
      tableSchema([{ key: "customerName" }, { key: "customerPhone" }, { key: "customerDebt" }]),
      waybillDocumentData(delivery(ITEMS), options),
    );
    const text = pageText(doc);
    expect(text).toContain("Mijoz");
    expect(text).toContain("Telefon");
    expect(text).toContain("Qarz");
  });
});

describe("Ko'p yetkazma", () => {
  it("qisqa yetkazmalar bitta A4 ga joylashadi (aqlli rejim — standart)", async () => {
    const doc = await renderWaybillsWithTemplate(
      tableSchema([{ key: "name" }, { key: "total" }]),
      [delivery(ITEMS), { ...delivery(ITEMS), number: "DL-2026-0006" }],
      options,
    );
    expect(doc.getNumberOfPages(), "ikkitasi bir varaqqa sig'adi").toBe(1);
  });

  it("`full` rejimda har yetkazma o'z sahifasida qoladi", async () => {
    const doc = await renderWaybillsWithTemplate(
      tableSchema([{ key: "name" }, { key: "total" }]),
      [delivery(ITEMS), { ...delivery(ITEMS), number: "DL-2026-0006" }],
      { ...options, mode: "full" },
    );
    expect(doc.getNumberOfPages()).toBe(2);
  });
});
