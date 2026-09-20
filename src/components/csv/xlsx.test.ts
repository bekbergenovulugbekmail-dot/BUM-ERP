/**
 * Excel shablon va `.xlsx` o'qish. Shablon → fayl → parser zanjiri to'liq aylanib tekshiriladi:
 * shablonning o'zi importga berilsa, namuna qatori ma'lumot sifatida O'TMASLIGI kerak.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { buildIssuesXlsx, buildTemplateXlsx, isExcelFile, parseXlsx, type SheetColumn } from "./xlsx.ts";

// `exceljs` dinamik yuklanadi (ilovada ham shunday) — jsdom'da birinchi `import()` bir necha soniya oladi,
// shuning uchun uni testlardan OLDIN bir marta isitamiz, keyin har bir test tez ishlaydi.
beforeAll(async () => {
  await import("exceljs");
}, 60_000);

const COLUMNS: SheetColumn[] = [
  { key: "name", aliases: ["Mijoz nomi", "name"], required: true, example: "Anvar aka do'koni" },
  { key: "phone", aliases: ["Telefon", "phone"], required: true, example: "+998901234567" },
  { key: "territory", aliases: ["Hudud", "territory"], example: "Urganch" },
  { key: "creditLimit", aliases: ["Kredit limiti", "creditLimit"], example: "1000000" },
];

/** Blob'ni parser kutadigan `File` ga o'raydi (jsdom'da `File` bor). */
const asFile = (blob: Blob, name = "shablon.xlsx") =>
  new File([blob], name, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });

/** Sarlavha va qatorlardan .xlsx yasaydi — "foydalanuvchi to'ldirgan fayl" o'rnida (raqam katagi ham bo'ladi). */
async function sheetFrom(rows: (string | number)[][]): Promise<File> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Mijozlar");
  for (const row of rows) sheet.addRow(row);
  const buffer = await workbook.xlsx.writeBuffer();
  return asFile(new Blob([buffer]), "mijozlar.xlsx");
}

describe("isExcelFile", () => {
  it("faqat .xlsx va .xls ni tan oladi", () => {
    expect(isExcelFile("mijozlar.xlsx")).toBe(true);
    expect(isExcelFile("MIJOZLAR.XLSX")).toBe(true);
    expect(isExcelFile("eski.xls")).toBe(true);
    expect(isExcelFile("mijozlar.csv")).toBe(false);
    expect(isExcelFile("mijozlar.xlsx.exe")).toBe(false);
  });
});

describe("Excel shablon", () => {
  it("1-qator sarlavha (majburiyda *), 2-qator `#` bilan boshlanadigan namuna", async () => {
    const parsed = await parseXlsx(asFile(await buildTemplateXlsx(COLUMNS, "mijozlar")));

    expect(parsed.fields).toEqual(["Mijoz nomi*", "Telefon*", "Hudud", "Kredit limiti"]);
    expect(parsed.raw).toHaveLength(1);
    // Namuna qatori `#` bilan boshlanadi — CsvToolbar uni import qilmaydi
    expect(parsed.raw[0]!["Mijoz nomi*"]).toBe("# Anvar aka do'koni");
    expect(parsed.raw[0]!["Telefon*"]).toBe("+998901234567");
    expect(parsed.raw[0]!["Hudud"]).toBe("Urganch");
  });

  it("shablon buzilmagan .xlsx — qayta o'qilganda ustunlar soni saqlanadi", async () => {
    const blob = await buildTemplateXlsx(COLUMNS, "mijozlar");
    expect(blob.size).toBeGreaterThan(0);
    const parsed = await parseXlsx(asFile(blob));
    expect(parsed.fields).toHaveLength(COLUMNS.length);
  });
});

describe("parseXlsx", () => {
  it("sarlavha va qatorlarni o'qiydi, butunlay bo'sh qatorni tashlaydi", async () => {
    const file = await sheetFrom([
      ["Mijoz nomi", "Telefon", "Hudud"],
      ["Anvar do'koni", "+998901234567", "Urganch"],
      ["", "", ""],
      ["Bobur do'koni", "+998901234568", "Xiva"],
    ]);
    const parsed = await parseXlsx(file);

    expect(parsed.fields).toEqual(["Mijoz nomi", "Telefon", "Hudud"]);
    expect(parsed.raw).toHaveLength(2);
    expect(parsed.raw[0]).toMatchObject({ "Mijoz nomi": "Anvar do'koni", Telefon: "+998901234567", Hudud: "Urganch" });
    expect(parsed.raw[1]).toMatchObject({ "Mijoz nomi": "Bobur do'koni", Hudud: "Xiva" });
  });

  it("raqam katagi matnga aylanadi (kredit limiti va telefon yo'qolmaydi)", async () => {
    const file = await sheetFrom([
      ["Mijoz nomi", "Kredit limiti"],
      ["Raqamli", 1000000],
    ]);
    const parsed = await parseXlsx(file);
    expect(parsed.raw[0]!["Kredit limiti"]).toBe("1000000");
  });

  it("bo'sh varaqda qator qaytmaydi", async () => {
    const parsed = await parseXlsx(await sheetFrom([["Mijoz nomi", "Telefon"]]));
    expect(parsed.raw).toHaveLength(0);
  });
});

describe("Xatolar fayli", () => {
  it("xato va dublikat qatorlar sarlavha bilan yoziladi", async () => {
    const blob = await buildIssuesXlsx([
      { row: 2, key: "Do'kon A", message: "Nomi majburiy", kind: "Xato" },
      { row: 5, key: "Do'kon B", message: "Bu mijoz allaqachon mavjud", kind: "Dublikat" },
    ]);
    const parsed = await parseXlsx(asFile(blob, "xatolar.xlsx"));

    expect(parsed.fields).toEqual(["Qator", "Turi", "Mijoz", "Sabab"]);
    expect(parsed.raw).toHaveLength(2);
    expect(parsed.raw[0]).toMatchObject({ Qator: "2", Turi: "Xato", Mijoz: "Do'kon A", Sabab: "Nomi majburiy" });
    expect(parsed.raw[1]).toMatchObject({ Turi: "Dublikat", Sabab: "Bu mijoz allaqachon mavjud" });
  });
});
