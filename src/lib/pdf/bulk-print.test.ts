/**
 * KO'P NAKLADNOY BITTA FAYLDA: ma'lumot aralashmasligi va A4 ga aqlli joylashuv.
 *
 * REGRESSIYA (2026-09-25, egasi yuborgan PDF): ikkita nakladnoy chiqarilganda ikkinchisida
 * mahsulot nomlari teshik (`EZ  сви  ит  л`) va jami noto'g'ri (`42,200` → `2,200`) edi.
 *
 * Sabab ma'lumotda emas edi: har nakladnoy ALOHIDA PDF qilinib, sahifasi birinchisiga
 * nusxalanardi. Har PDF o'ziga faqat ISHLATGAN gliflarini joylaydi, shuning uchun
 * nusxalangan sahifadagi glif raqamlari boshqa to'plamga tegib, harflar yo'qolardi.
 *
 * Shu sababli bu yerda PDF ichidan MATN AJRATIB olinadi va har nakladnoy faqat o'z
 * ma'lumotini ko'rsatishi tekshiriladi — "PDF yaratildi" degan tekshiruv yetarli emas.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
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
type Waybill = Parameters<typeof waybillDocumentData>[0];

/**
 * HAQIQIY unicode shrift — brauzerdagidek. Shriftsiz jsPDF `helvetica` ga tushadi va kirill
 * o'sha yerda buziladi; u holda bu test glif muammosini umuman tekshira olmasdi.
 */
beforeAll(async () => {
  const dir = resolve(import.meta.dirname, "../../../public/fonts");
  const files = new Map<string, Buffer>([
    ["/fonts/PTSans-Regular.ttf", await readFile(resolve(dir, "PTSans-Regular.ttf"))],
    ["/fonts/PTSans-Bold.ttf", await readFile(resolve(dir, "PTSans-Bold.ttf"))],
  ]);
  vi.stubGlobal("fetch", async (url: string) => {
    const data = files.get(String(url));
    if (!data) return { ok: false, status: 404 };
    return { ok: true, status: 200, arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) };
  });
});

const options = { company: { name: "BONNU MARKET" }, currency: "UZS", responsibleName: "Xamdam" };

const schema: DocumentTemplateSchema = {
  schemaVersion: 1,
  page: { size: "a4", orientation: "portrait", margins: { top: 14, right: 14, bottom: 14, left: 14 }, footerOnEveryPage: true, signaturesOnLastPage: true },
  sections: [
    { key: "header", elements: [{ id: "h1", type: "text", label: "YETKAZMA NAKLADNOYI" }, { id: "h2", type: "field", field: "document.number", label: "Hujjat" }] },
    {
      key: "body",
      elements: [
        { id: "b1", type: "field", field: "customer.name", label: "Mijoz" },
        { id: "b2", type: "field", field: "document.date", label: "Sana" },
        { id: "b3", type: "itemsTable", columns: [{ key: "index" }, { key: "name" }, { key: "quantity" }, { key: "total" }] },
        { id: "b4", type: "totals", rows: ["total", "debt"] },
      ],
    },
    { key: "footer", elements: [] },
  ],
};

type Item = NonNullable<Waybill["items"]>[number];
const item = (name: string, total: number): Item => ({
  productName: name, productSku: "SKU", quantity: "1", unitName: "d", unitPrice: String(total), lineTotal: String(total),
});

const waybill = (number: string, customer: string, date: string, items: Item[], total: number): Waybill => ({
  number, status: "assigned", scheduledDate: date, orderNumber: `SO-${number}`, orderTotal: total,
  customerName: customer, customerPhone: null, customerAddress: null, customerDebt: 0,
  warehouseName: "Asosiy ombor", agentCode: "DA-002", agentName: "Раматов Расул", items,
});

/**
 * PDF ichidagi MATN — chizilgan glif kodlarini hujjatning o'z CMap'i orqali o'giradi.
 * Shu sababli glif to'plami buzilgan bo'lsa, matn ham buzuq chiqadi (test tutadi).
 */
function extractText(doc: { output: (type: string) => string }): string {
  const raw = doc.output("datauristring");
  const pdf = Buffer.from(raw.slice(raw.indexOf(",") + 1), "base64").toString("latin1");

  const cmap = new Map<number, string>();
  for (const m of pdf.matchAll(/<([0-9a-fA-F]{4})>\s*<([0-9a-fA-F]{4,})>/g)) {
    cmap.set(Number.parseInt(m[1]!, 16), String.fromCodePoint(Number.parseInt(m[2]!.slice(0, 4), 16)));
  }
  let text = "";
  for (const m of pdf.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) {
    const hex = m[1]!;
    for (let i = 0; i + 4 <= hex.length; i += 4) {
      // Xaritada yo'q kod — buzilgan glif; testda ko'rinsin deb "?" bilan belgilanadi
      text += cmap.get(Number.parseInt(hex.slice(i, i + 4), 16)) ?? "?";
    }
    text += " ";
  }
  return text;
}

describe("Ma'lumot aralashmasligi", () => {
  it("ikkita nakladnoy: har biri FAQAT o'z mijozi va summasi bilan", async () => {
    const doc = await renderWaybillsWithTemplate(
      schema,
      [
        waybill("DL-2026-0004", "Кроп Шоп", "2026-09-24", [item("Ezo Жидкий Порошок Baby 1500", 35_200)], 35_200),
        waybill("DL-2026-0005", "Test Market", "2026-09-25", [item("Pure Comfort 460", 17_200), item("Neo Max 150", 8_500), item("Gel 900", 16_500)], 42_200),
      ],
      options,
    );
    const text = extractText(doc);

    // Har ikkala hujjat raqami, mijozi va summasi BUZILMASDAN chiqadi
    expect(text).toContain("DL-2026-0004");
    expect(text).toContain("DL-2026-0005");
    expect(text).toContain("Кроп Шоп");
    expect(text).toContain("Test Market");
    // Ajratgich mahalliy formatga bog'liq (probel yoki vergul) — raqamlar butun bo'lishi muhim
    expect(text, "42 200 buzilib 2 200 bo'lmasin").toMatch(/42[\s,]200/u);
    expect(text).toMatch(/35[\s,]200/u);
    // Mahsulot nomlari teshik bo'lmasin
    expect(text).toContain("Ezo Жидкий Порошок Baby 1500");
    expect(text).toContain("Pure Comfort 460");
    expect(text, "xaritada yo'q glif qolmasin").not.toContain("?");
  });

  it("to'rtta turli mijoz: har bir qiymat bitta hujjatga tegishli bo'lib qoladi", async () => {
    const doc = await renderWaybillsWithTemplate(
      schema,
      [
        waybill("DL-1", "Alfa Do'kon", "2026-09-21", [item("Mahsulot A", 1_000)], 1_000),
        waybill("DL-2", "Бета Маркет", "2026-09-22", [item("Товар Б", 2_000)], 2_000),
        waybill("DL-3", "Gamma Shop", "2026-09-23", [item("Mahsulot V", 3_000)], 3_000),
        waybill("DL-4", "Дельта Савдо", "2026-09-24", [item("Товар Г", 4_000)], 4_000),
      ],
      options,
    );
    const text = extractText(doc);
    for (const value of ["Alfa Do", "Бета Маркет", "Gamma Shop", "Дельта Савдо", "Mahsulot A", "Товар Б", "Mahsulot V", "Товар Г"]) {
      expect(text, `${value} yo'q yoki buzilgan`).toContain(value);
    }
    expect(text).not.toContain("?");
  });

  it("kirill gliflari PDF shriftiga kiradi (nusxalashda yo'qolardi)", async () => {
    const doc = await renderWaybillsWithTemplate(
      schema,
      [
        waybill("DL-1", "Latin Only", "2026-09-24", [item("Latin product", 1_000)], 1_000),
        waybill("DL-2", "Кроп Шоп", "2026-09-25", [item("Жидкий Порошок", 2_000)], 2_000),
      ],
      options,
    );
    const raw = doc.output("datauristring");
    const pdf = Buffer.from(raw.slice(raw.indexOf(",") + 1), "base64").toString("latin1");
    // `К` = U+041A — birinchi hujjat kirill ishlatmagan bo'lsa ham shriftda bo'lishi shart
    expect(/<04[0-4][0-9a-f]>/i.test(pdf), "kirill glifi shriftga kirmagan").toBe(true);
  });
});

describe("A4 ga aqlli joylashuv", () => {
  const short = (n: number) => waybill(`DL-${n}`, `Mijoz ${n}`, "2026-09-25", [item(`Mahsulot ${n}`, 1_000)], 1_000);

  it("ikkita qisqa nakladnoy BITTA A4 ga sig'adi", async () => {
    const doc = await renderWaybillsWithTemplate(schema, [short(1), short(2)], options);
    expect(doc.getNumberOfPages()).toBe(1);
  });

  it("uchta qisqa nakladnoy ham sig'sa bitta A4 da qoladi", async () => {
    const doc = await renderWaybillsWithTemplate(schema, [short(1), short(2), short(3)], options);
    expect(doc.getNumberOfPages()).toBe(1);
  });

  it("uzun nakladnoy o'z sahifasidan boshlanadi — o'rtasidan bo'linmaydi", async () => {
    const many = Array.from({ length: 60 }, (_, i) => item(`Mahsulot ${i + 1}`, 1_000));
    const doc = await renderWaybillsWithTemplate(
      schema,
      [short(1), waybill("DL-UZUN", "Katta Mijoz", "2026-09-25", many, 60_000)],
      options,
    );
    expect(doc.getNumberOfPages()).toBeGreaterThan(1);
    const text = extractText(doc);
    expect(text).toContain("Katta Mijoz");
    expect(text).toContain("Mahsulot 60");
    expect(text).not.toContain("?");
  });

  it("`full` rejimda har nakladnoy alohida sahifada (eski xulq)", async () => {
    const doc = await renderWaybillsWithTemplate(schema, [short(1), short(2), short(3)], { ...options, mode: "full" });
    expect(doc.getNumberOfPages()).toBe(3);
  });

  it("tartib foydalanuvchi tanlaganidek qoladi", async () => {
    const doc = await renderWaybillsWithTemplate(schema, [short(3), short(1), short(2)], options);
    const text = extractText(doc);
    expect(text.indexOf("Mijoz 3")).toBeLessThan(text.indexOf("Mijoz 1"));
    expect(text.indexOf("Mijoz 1")).toBeLessThan(text.indexOf("Mijoz 2"));
  });

  it("20 ta nakladnoy: hammasi chiqadi va hech biri buzilmaydi", async () => {
    const list = Array.from({ length: 20 }, (_, i) => short(i + 1));
    const doc = await renderWaybillsWithTemplate(schema, list, options);
    const text = extractText(doc);
    for (let i = 1; i <= 20; i += 1) expect(text, `Mijoz ${i} yo'q`).toContain(`Mijoz ${i}`);
    expect(text).not.toContain("?");
    // Har sahifaga bir nechtasi joylashgani uchun sahifa soni 20 dan sezilarli kam
    expect(doc.getNumberOfPages()).toBeLessThan(20);
  });
});
