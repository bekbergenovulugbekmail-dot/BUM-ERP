/**
 * ERKIN JOYLASHUV: dizaynerdagi joy = PDF dagi joy.
 *
 * Bu yerda PDF ga yuborilgan HAQIQIY chizish buyruqlari (matn, rasm, chiziq, to'rtburchak)
 * yozib olinadi va ularning koordinatasi shablondagi `x/y` bilan solishtiriladi. "PDF
 * yaratildi" degan tekshiruv joy siljishini (drift) ushlamaydi — bu esa ushlaydi.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentElement, DocumentTemplateSchema } from "@bum/shared";
import type { DocumentData } from "./template-common.ts";

type Call = { method: string; args: unknown[]; page: number; doc: object };
const calls: Call[] = [];

vi.mock("jspdf", async (importOriginal) => {
  const actual = await importOriginal<typeof import("jspdf")>();
  const Wrapped = function (...args: ConstructorParameters<typeof actual.jsPDF>) {
    const doc = new actual.jsPDF(...args);
    doc.save = (() => doc) as typeof doc.save;
    for (const method of ["text", "addImage", "line", "roundedRect", "rect"] as const) {
      const original = (doc[method] as (...a: unknown[]) => unknown).bind(doc);
      (doc as unknown as Record<string, unknown>)[method] = (...a: unknown[]) => {
        calls.push({ method, args: a, page: doc.getCurrentPageInfo().pageNumber, doc });
        return original(...a);
      };
    }
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

beforeEach(() => {
  calls.length = 0;
});

const { renderTemplate, renderDocuments, convertToFreeLayout } = await import("./template-renderer.ts");
const { layoutShifts, fitColumnWidths, renderElementSprites, SPRITE_BLEED } = await import("./template-free.ts");

/** 2×1 qizil PNG. */
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAD0lEQVR4nGP4z8Dwn4EBAAj+Af9IxWaQAAAAAElFTkSuQmCC";

const data = (rows = 2): DocumentData => ({
  company: { name: "BUM Demo" },
  values: { "document.number": "DL-7", "document.date": "2026-09-25", "customer.name": "Test Market" },
  items: Array.from({ length: rows }, (_, index) => ({ name: `Mahsulot ${index + 1}`, quantity: "1", total: "1 000" })),
  totals: { total: "3 000" },
  columnLabels: { index: "№", name: "Mahsulot", quantity: "Miqdor", total: "Summa" },
  codes: { documentNumber: "DL-7" },
});

const free = (elements: DocumentElement[]): DocumentTemplateSchema => ({
  schemaVersion: 1,
  page: { size: "a4", layout: "free", orientation: "portrait", margins: { top: 14, right: 14, bottom: 14, left: 14 }, footerOnEveryPage: true, signaturesOnLastPage: true },
  sections: [{ key: "header", elements: [] }, { key: "body", elements }, { key: "footer", elements: [] }],
});

/**
 * Element matni — qutining tepasidan (`baseline: "top"`) chiziladi. Keyingi sahifadagi
 * kompaniya sarlavhasi ham hujjat nomini yozadi, lekin u element emas — shuning uchun ajratiladi.
 */
const textCall = (value: string) =>
  calls.find((call) => call.method === "text" && JSON.stringify(call.args[0]).includes(value)
    && (call.args[3] as { baseline?: string } | undefined)?.baseline === "top");

describe("sof hisob", () => {
  it("jadval o'ssa faqat uning OSTIDAGI elementlar suriladi", () => {
    const shifts = layoutShifts(
      [
        { id: "table", y: 50, h: 30 },
        { id: "below", y: 90, h: 10 },
        { id: "beside", y: 60, h: 10 },
        { id: "above", y: 20, h: 10 },
      ],
      { table: 45 },
    );
    expect(shifts).toEqual({ table: 0, below: 15, beside: 0, above: 0 });
  });

  it("jadval loyihadagidan qisqa bo'lsa hech narsa surilmaydi (joylashuv barqaror)", () => {
    expect(layoutShifts([{ id: "t", y: 50, h: 30 }, { id: "b", y: 90, h: 5 }], { t: 12 })).toEqual({ t: 0, b: 0 });
  });

  it("jadval kengaytirilsa ustunlar nisbati saqlanadi", () => {
    expect(fitColumnWidths([10, 30, 20], 120)).toEqual([20, 60, 40]);
    // "auto" ustun bor — berilganlari o'z o'lchamida
    expect(fitColumnWidths([10, undefined, 20], 180)).toEqual([10, undefined, 20]);
  });
});

describe("PDF dagi joy = shablondagi joy", () => {
  it("matn aynan x/y da, tepadan boshlanadi", async () => {
    await renderTemplate(free([{ id: "t", type: "text", label: "YETKAZMA NAKLADNOYI", x: 120, y: 18, width: 80, height: 8 }]), data());
    const call = textCall("YETKAZMA NAKLADNOYI");
    expect(call, "matn chizilmadi").toBeTruthy();
    expect(call!.args[1]).toBeCloseTo(120, 5);
    expect(call!.args[2]).toBeCloseTo(18, 5);
    expect(call!.args[3]).toMatchObject({ baseline: "top", align: "left" });
  });

  it("o'ngga tekislangan maydon qutining o'ng chetida", async () => {
    await renderTemplate(free([{ id: "f", type: "field", field: "customer.name", label: "Mijoz", x: 20, y: 200, width: 100, height: 6, style: { align: "right" } }]), data());
    const call = textCall("Mijoz: Test Market");
    expect(call!.args[1]).toBeCloseTo(120, 5);
    expect(call!.args[2]).toBeCloseTo(200, 5);
  });

  it("rasm qutiga nisbat saqlanib sig'adi (contain)", async () => {
    await renderTemplate(free([{ id: "i", type: "image", imageData: PNG, x: 150, y: 10, width: 40, height: 40 }]), data());
    const image = calls.find((call) => call.method === "addImage")!;
    // 2:1 rasm 40×40 qutida → 40×20, vertikal o'rtada
    expect(image.args.slice(1, 5)).toEqual([150, 20, 40, 20]);
  });

  it("QR pastki o'ngda — kvadrat, qutining o'zida", async () => {
    await renderTemplate(free([{ id: "q", type: "qr", qrSource: "documentNumber", x: 170, y: 250, width: 26, height: 26 }]), data());
    const image = calls.find((call) => call.method === "addImage")!;
    expect(image.args.slice(1, 5)).toEqual([170, 250, 26, 26]);
  });

  it("vertikal chiziq qutining o'rtasidan", async () => {
    await renderTemplate(free([{ id: "l", type: "line", x: 100, y: 40, width: 2, height: 60 }]), data());
    const line = calls.find((call) => call.method === "line")!;
    expect(line.args).toEqual([101, 40, 101, 100]);
  });

  it("jadval o'z qutisida, eni qutining eni", async () => {
    await renderTemplate(free([{ id: "t", type: "itemsTable", columns: [{ key: "index" }, { key: "name" }, { key: "total" }], x: 30, y: 120, width: 150, height: 30 }]), data());
    const header = calls.find((call) => call.method === "text" && call.args[0] === "Mahsulot")!;
    expect(header.args[2] as number).toBeGreaterThan(120);
    const cells = calls.filter((call) => call.method === "rect" && call.page === 1).map((call) => call.args as number[]);
    expect(Math.min(...cells.map((cell) => cell[0]!))).toBeCloseTo(30, 3);
    expect(Math.max(...cells.map((cell) => cell[0]! + cell[2]!))).toBeCloseTo(180, 3);
    expect(Math.min(...cells.map((cell) => cell[1]!))).toBeCloseTo(120, 3);
  });

  it("jadval ko'p qatorli bo'lsa ostidagi imzo suriladi, yonidagi QR joyida qoladi", async () => {
    const schema = free([
      { id: "t", type: "itemsTable", columns: [{ key: "name" }, { key: "total" }], x: 14, y: 60, width: 120, height: 20 },
      { id: "q", type: "qr", qrSource: "documentNumber", x: 150, y: 60, width: 22, height: 22 },
      { id: "s", type: "text", label: "PASTDAGI IMZO", x: 14, y: 90, width: 80, height: 6 },
    ]);
    await renderTemplate(schema, data(1));
    expect(textCall("PASTDAGI IMZO")!.args[2]).toBeCloseTo(90, 5);

    calls.length = 0;
    await renderTemplate(schema, data(12));
    const moved = textCall("PASTDAGI IMZO")!.args[2] as number;
    expect(moved, "imzo jadval ostiga surilishi kerak").toBeGreaterThan(100);
    const qr = calls.find((call) => call.method === "addImage")!;
    expect(qr.args[2], "yonidagi QR surilmaydi").toBe(60);
  });

  it("juda uzun jadval keyingi sahifaga o'tadi, ostidagi matn oxirgi sahifada", async () => {
    const doc = await renderTemplate(
      free([
        { id: "t", type: "itemsTable", columns: [{ key: "name" }, { key: "total" }], x: 14, y: 60, width: 182, height: 20 },
        { id: "s", type: "text", label: "OXIRGI MATN", x: 14, y: 90, width: 80, height: 6 },
      ]),
      data(80),
    );
    expect(doc.getNumberOfPages()).toBeGreaterThan(1);
    const last = textCall("OXIRGI MATN")!;
    const lastRow = calls.find((call) => call.method === "text" && JSON.stringify(call.args[0]).includes("Mahsulot 80"))!;
    expect(last.page).toBe(doc.getNumberOfPages());
    expect(lastRow.page).toBe(last.page);
    // Loyihadagi oraliq (jadval pasti 80 → matn 90) saqlanadi: oxirgi qatordan pastda
    expect(last.args[2] as number).toBeGreaterThan(lastRow.args[2] as number);
  });

  it("sahifa raqami erkin joyida, jami soni bilan", async () => {
    await renderTemplate(free([{ id: "p", type: "pageNumber", x: 20, y: 280, width: 30, height: 5 }]), data());
    const call = textCall("1 / 1")!;
    expect([call.args[1], call.args[2]]).toEqual([20, 280]);
  });
});

describe("ko'p hujjat erkin joylashuvda", () => {
  const compact = free([
    { id: "h", type: "text", label: "NAKLADNOY", x: 14, y: 14, width: 100, height: 8 },
    { id: "n", type: "field", field: "document.number", x: 14, y: 24, width: 100, height: 6 },
    { id: "t", type: "itemsTable", columns: [{ key: "name" }, { key: "total" }], x: 14, y: 34, width: 182, height: 30 },
    { id: "s", type: "signatures", x: 14, y: 100, width: 182, height: 22 },
    // Sahifa raqami varaq pastida — hujjat balandligiga KIRMASLIGI kerak
    { id: "p", type: "pageNumber", x: 170, y: 285, width: 26, height: 5 },
  ]);

  it("ikkitasi bitta A4 da, ikkinchisi xuddi shu joylashuvda pastroqda", async () => {
    const doc = await renderDocuments(compact, [data(), { ...data(), values: { ...data().values, "document.number": "DL-8" } }], "smart");
    expect(doc.getNumberOfPages()).toBe(1);
    // O'lchash uchun chizilgan (tashlab yuboriladigan) nusxa emas — natija hujjatining o'zi
    const first = calls.filter((call) => call.doc === doc && call.method === "text" && JSON.stringify(call.args[0]).includes("NAKLADNOY"));
    expect(first).toHaveLength(2);
    const [a, b] = first.map((call) => call.args[2] as number);
    expect(a).toBe(14);
    // Ikkinchisi: birinchisi tugagan joy + ajratgich
    expect(b! - a!).toBeGreaterThan(108);
    expect(b! + 108).toBeLessThan(297);
    // Sahifa raqami — varaqda BIR marta, loyihadagi joyida
    const numbers = calls.filter((call) => call.doc === doc && call.method === "text" && JSON.stringify(call.args[0]) === '["1 / 1"]');
    expect(numbers).toHaveLength(1);
    expect([numbers[0]!.args[1], numbers[0]!.args[2]]).toEqual([170, 285]);
  });

  it("uchtasi — ikkitasi birinchi varaqda, uchinchisi ikkinchisida", async () => {
    const doc = await renderDocuments(compact, [data(), data(), data()], "smart");
    expect(doc.getNumberOfPages()).toBe(2);
    const numbers = calls.filter((call) => call.doc === doc && call.method === "text" && /^\d \/ 2$/.test(String(call.args[0])));
    expect(numbers.map((call) => String(call.args[0]))).toEqual(["1 / 2", "2 / 2"]);
  });

  it("`full` rejimi — har biri o'z varag'ida", async () => {
    const doc = await renderDocuments(compact, [data(), data()], "full");
    expect(doc.getNumberOfPages()).toBe(2);
  });
});

describe("oqim shablonini erkin joylashuvga o'tkazish", () => {
  it("har element o'z joyini oladi va tartibi saqlanadi", async () => {
    const flow: DocumentTemplateSchema = {
      ...free([]),
      page: { ...free([]).page, layout: undefined },
      sections: [
        { key: "header", elements: [{ id: "h1", type: "text", label: "YETKAZMA NAKLADNOYI", style: { fontSize: 16, align: "center" } }] },
        {
          key: "body",
          elements: [
            { id: "b1", type: "field", field: "customer.name", label: "Mijoz" },
            { id: "b2", type: "itemsTable", columns: [{ key: "name" }, { key: "total" }] },
            { id: "b3", type: "totals", rows: ["total"] },
            { id: "sp", type: "spacer", height: 4 },
          ],
        },
        { key: "footer", elements: [{ id: "f1", type: "signatures" }] },
      ],
    };
    const converted = await convertToFreeLayout(flow, data());
    expect(converted.page.layout).toBe("free");
    const all = converted.sections.flatMap((section) => section.elements);
    const byId = (id: string) => all.find((element) => element.id === id)!;
    // Bo'sh joy olib tashlanadi, sarlavha ostidagi chiziq alohida element bo'ladi
    expect(all.some((element) => element.type === "spacer")).toBe(false);
    expect(all.filter((element) => element.type === "line")).toHaveLength(1);
    for (const element of all) {
      expect(element.x, element.type).toBeTypeOf("number");
      expect(element.y, element.type).toBeTypeOf("number");
    }
    const order = ["h1", "b1", "b2", "b3", "f1"].map((id) => byId(id).y!);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // Jami bloki o'ng tomonda (oqimdagidek)
    expect(byId("b3").x!).toBeGreaterThan(100);
  });
});

describe("dizayner rasmlari", () => {
  it("har element o'z sahifasida, zaxira bilan", async () => {
    const result = await renderElementSprites(
      [
        { id: "a", type: "text", label: "Salom", x: 50, y: 50, width: 60, height: 8 },
        { id: "b", type: "itemsTable", columns: [{ key: "name" }], x: 0, y: 0, width: 100, height: 5 },
      ],
      data(3),
    );
    expect(result.pages.map((page) => page.id)).toEqual(["a", "b"]);
    expect(result.pages[0]!.width).toBeCloseTo(60 + SPRITE_BLEED * 2, 5);
    // Jadval namunada 5 mm dan baland — haqiqiy balandligi qaytadi
    expect(result.pages[1]!.natural).toBeGreaterThan(5);
    expect(result.pdf.byteLength).toBeGreaterThan(1000);
  });
});
