/**
 * SHABLON KO'RINISHI PDF GA HAQIQATAN TA'SIR QILADIMI.
 *
 * Sozlamani saqlash yetarli emas: 2026-09-25 da foydalanuvchi "jadval chiziqlarini tahrir
 * qilib bo'lmayapti" dedi. Shuning uchun bu yerda chizilgan PDF ning ICHI o'qiladi —
 * chiziq buyruqlari, naqsh (uzuq/nuqtali) va rasm obyektlari sanaladi.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { DocumentTemplateSchema, TableStyle } from "@bum/shared";
import type { DocumentData } from "./template-renderer.ts";

vi.mock("jspdf", async (importOriginal) => {
  const actual = await importOriginal<typeof import("jspdf")>();
  const Wrapped = function (...args: ConstructorParameters<typeof actual.jsPDF>) {
    const doc = new actual.jsPDF(...args);
    doc.save = (() => doc) as typeof doc.save;
    return doc;
  } as unknown as typeof actual.jsPDF;
  return { ...actual, default: Wrapped, jsPDF: Wrapped };
});

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

const data: DocumentData = {
  company: { name: "BUM Demo" },
  values: { "document.number": "DL-1", "document.date": "2026-09-25" },
  items: [
    { name: "Mahsulot A", quantity: "1", total: "1 000" },
    { name: "Mahsulot B", quantity: "2", total: "2 000" },
  ],
  totals: { total: "3 000" },
  columnLabels: { index: "№", name: "Mahsulot", quantity: "Miqdor", total: "Summa" },
  codes: { documentNumber: "DL-1" },
};

const schemaWith = (table: TableStyle | undefined, extra: Record<string, unknown>[] = []): DocumentTemplateSchema =>
  ({
    schemaVersion: 1,
    page: { size: "a4", orientation: "portrait", margins: { top: 14, right: 14, bottom: 14, left: 14 }, footerOnEveryPage: true, signaturesOnLastPage: true },
    sections: [
      { key: "header", elements: [{ id: "h", type: "text", label: "NAKLADNOY" }] },
      {
        key: "body",
        elements: [
          { id: "t", type: "itemsTable", columns: [{ key: "index" }, { key: "name" }, { key: "quantity" }, { key: "total" }], ...(table ? { table } : {}) },
          ...extra,
        ],
      },
      { key: "footer", elements: [] },
    ],
  }) as unknown as DocumentTemplateSchema;

/** Chizilgan PDF ning xom matni (siqilmagan oqim — jsPDF standart holatda siqmaydi). */
async function render(schema: DocumentTemplateSchema): Promise<string> {
  const { renderTemplate } = await import("./template-renderer.ts");
  const doc = await renderTemplate(schema, data);
  const raw = doc.output("datauristring") as string;
  return Buffer.from(raw.slice(raw.indexOf(",") + 1), "base64").toString("latin1");
}

/** Chiziq chizish buyruqlari soni (`l` va `re` operatorlari). */
const strokes = (pdf: string) => (pdf.match(/\n[\d.\s-]+l\n|\bre\n/g) ?? []).length;

describe("Jadval chiziqlari", () => {
  it("hamma chiziq o'chirilsa chizish buyruqlari kamayadi", async () => {
    const on = strokes(await render(schemaWith({ outer: true, horizontal: true, vertical: true, headerBorder: true })));
    const off = strokes(await render(schemaWith({ outer: false, top: false, bottom: false, left: false, right: false, horizontal: false, vertical: false, headerBorder: false })));
    expect(off, "chiziqsiz jadval kamroq chizilishi kerak").toBeLessThan(on);
  });

  it("`dashed` PDF ga naqsh buyrug'ini qo'yadi", async () => {
    // jsPDF naqshni `[2. 1.5] 0. d`, naqshsiz holatni `[] 0. d` ko'rinishida yozadi
    const pattern = /\[([\d.\s]*)\]\s+0\.?\s+d\b/g;
    // Qavs ICHIDA raqam bo'lsa — haqiqiy naqsh; `[] 0. d` esa naqshni bekor qilish
    const withDash = (text: string) => [...text.matchAll(pattern)].filter((match) => /\d/.test(match[1]!)).length;
    const solid = withDash(await render(schemaWith({ borderStyle: "solid", borderWidth: 0.5 })));
    const dashed = withDash(await render(schemaWith({ borderStyle: "dashed", borderWidth: 0.5 })));
    expect(dashed, "uzuq chiziq naqshi yo'q").toBeGreaterThan(0);
    expect(dashed, "uzuq chiziqda naqsh ko'proq qo'yiladi").toBeGreaterThan(solid);
  });

  it("sarlavha rangi shablondan olinadi", async () => {
    // 255/255 → `1.`, 0/255 → `0.` (jsPDF raqamlarni shunday yozadi)
    const red = /(^|\s)1\.?\s+0\.?\s+0\.?\s+rg/;
    expect(red.test(await render(schemaWith({ headerFill: "#ff0000" }))), "qizil sarlavha foni chizilmadi").toBe(true);
    expect(red.test(await render(schemaWith(undefined))), "standartda qizil bo'lmasligi kerak").toBe(false);
  });

  it("ustun kengligi PDF ni o'zgartiradi", async () => {
    const auto = schemaWith(undefined);
    const fixed = structuredClone(auto);
    const table = fixed.sections.find((section) => section.key === "body")!.elements[0]!;
    table.columns = [
      { key: "index", width: 10 }, { key: "name", width: 120 },
      { key: "quantity", width: 20 }, { key: "total", width: 30 },
    ];
    expect(await render(fixed)).not.toBe(await render(auto));
  });
});

describe("Rasm, QR va to'rtburchak", () => {
  it("rasm PDF ichiga obyekt bo'lib tushadi", async () => {
    const pdf = await render(
      schemaWith(undefined, [
        {
          id: "img",
          type: "image",
          width: 20,
          height: 20,
          // 4×4 qizil PNG
          imageData:
            "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEElEQVR4nGO4o6EBRwzEcQDzAxLBI9OCRQAAAABJRU5ErkJggg==",
        },
      ]),
    );
    expect(pdf).toContain("/Subtype /Image");
  });

  it("to'rtburchak ramka chiziladi", async () => {
    const withRect = await render(schemaWith(undefined, [{ id: "r", type: "rect", width: 80, height: 20, box: { borderWidth: 0.5 } }]));
    const without = await render(schemaWith(undefined));
    expect(strokes(withRect)).toBeGreaterThan(strokes(without));
  });
});
