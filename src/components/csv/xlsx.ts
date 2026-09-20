/**
 * Excel (.xlsx) o'qish va yozish — `CsvToolbar` uchun.
 *
 * `exceljs` ATAYLAB dinamik `import()` bilan yuklanadi: u ~1 MB, lekin faqat foydalanuvchi shablon
 * yuklab olganda yoki `.xlsx` fayl tanlaganda kerak bo'ladi. Shunday qilib asosiy bundle kattalashmaydi
 * (CSV yo'li umuman tegilmagan — `papaparse` o'sha-o'sha).
 *
 * Shablon va xato faylining tuzilishi CSV bilan BIR XIL qoidaga bo'ysunadi:
 *   1-qator — sarlavha (majburiy ustunda `*`),
 *   2-qator — `#` bilan boshlanadigan NAMUNA; import uni o'tkazib yuboradi (o'chirish shart emas).
 */

/** Shablon va xato faylida ishlatiladigan ustun ta'rifi (`CsvToolbar` dagi `CsvColumn` ning kerakli qismi). */
export type SheetColumn = { key: string; aliases: string[]; required?: boolean; example?: string };

export type SheetRows = { fields: string[]; raw: Record<string, string>[] };

/** Excel katagini matnga aylantiradi: sana, formula va raqamlar ham import uchun matn bo'lib chiqadi. */
function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) {
    // Excel sanasi — ISO (YYYY-MM-DD): server sanani shu ko'rinishda kutadi
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  if (typeof value === "object") {
    const rich = value as { text?: unknown; result?: unknown; richText?: { text: string }[]; hyperlink?: string };
    if (Array.isArray(rich.richText)) return rich.richText.map((part) => part.text).join("");
    // Formula katagi — hisoblangan natija olinadi (formula matni emas)
    if (rich.result !== undefined) return cellText(rich.result);
    if (rich.text !== undefined) return cellText(rich.text);
    return "";
  }
  return String(value).trim();
}

/** Fayl nomi `.xlsx` / `.xls` ga tugaydimi. */
export const isExcelFile = (name: string) => /\.xlsx?$/i.test(name.trim());

/**
 * `.xlsx` ni CSV parseri bergan shaklga keltiradi: sarlavhalar ro'yxati va sarlavha→qiymat obyektlari.
 * Faqat BIRINCHI varaq o'qiladi; butunlay bo'sh qatorlar tashlanadi.
 */
export async function parseXlsx(file: File): Promise<SheetRows> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());

  const sheet = workbook.worksheets[0];
  if (!sheet) return { fields: [], raw: [] };

  const headerRow = sheet.getRow(1);
  const fields: string[] = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, col) => {
    fields[col - 1] = cellText(cell.value);
  });
  // Oxiridagi bo'sh ustunlar kerak emas; o'rtadagi bo'sh sarlavha "ustun N" bo'lib qoladi (moslashda tanlanmaydi)
  while (fields.length > 0 && !fields[fields.length - 1]) fields.pop();
  const headers = fields.map((field, index) => field || `ustun ${index + 1}`);

  const raw: Record<string, string>[] = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const entry: Record<string, string> = {};
    let filled = false;
    headers.forEach((header, index) => {
      const text = cellText(row.getCell(index + 1).value);
      entry[header] = text;
      if (text !== "") filled = true;
    });
    if (filled) raw.push(entry);
  });

  return { fields: headers, raw };
}

/** Sarlavha qatorini chiroyli qiladi: qalin, ko'kish fon, oq harf, muzlatilgan. */
function styleHeader(sheet: {
  getRow: (n: number) => {
    font: unknown;
    fill: unknown;
    alignment: unknown;
    height: number;
    eachCell: (cb: (cell: { border: unknown }) => void) => void;
  };
  views: unknown[];
}) {
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF10B981" } };
  header.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  header.height = 28;
  header.eachCell((cell) => {
    cell.border = {
      top: { style: "thin", color: { argb: "FFD1D5DB" } },
      left: { style: "thin", color: { argb: "FFD1D5DB" } },
      bottom: { style: "thin", color: { argb: "FFD1D5DB" } },
      right: { style: "thin", color: { argb: "FFD1D5DB" } },
    };
  });
  // Sarlavha doim ko'rinib tursin
  sheet.views = [{ state: "frozen", ySplit: 1 }];
}

/** Ustun kengligi: sarlavha va namuna uzunligiga qarab (juda tor yoki juda keng bo'lmasin). */
const widthOf = (header: string, example: string) => Math.min(40, Math.max(14, header.length + 4, example.length + 4));

/**
 * Import shabloni (.xlsx): 1-qator sarlavha, 2-qator `#` bilan boshlanadigan namuna.
 * Namuna qatori kulrang va qiya — foydalanuvchi uni ma'lumot emasligini darhol ko'radi.
 */
export async function buildTemplateXlsx(columns: SheetColumn[], sheetName = "Shablon"): Promise<Blob> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "BUM ERP";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet(sheetName.slice(0, 31));

  const headers = columns.map((column) => `${column.aliases[0] ?? column.key}${column.required ? "*" : ""}`);
  // Namuna `#` bilan boshlanadi — CSV bilan bir xil qoida, import uni tashlab ketadi
  const sample = columns.map((column, index) => (index === 0 ? `# ${column.example ?? ""}` : (column.example ?? "")));

  sheet.addRow(headers);
  sheet.addRow(sample);
  sheet.columns = columns.map((column, index) => ({ width: widthOf(headers[index] ?? "", sample[index] ?? "") }));
  styleHeader(sheet as never);

  const sampleRow = sheet.getRow(2);
  sampleRow.font = { italic: true, color: { argb: "FF9CA3AF" } };
  // Matn sifatida o'qilsin: "+998..." raqamga aylanib ketmasin
  sampleRow.eachCell((cell) => {
    cell.numFmt = "@";
  });

  return new Blob([await workbook.xlsx.writeBuffer()], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

export type SheetIssue = { row: number; key?: string | null; message: string; kind: string };

/** Import natijasidagi muammolarni Excelga yozadi ("Xatolarni yuklab olish"). */
export async function buildIssuesXlsx(issues: SheetIssue[]): Promise<Blob> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "BUM ERP";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("Xatolar");

  sheet.addRow(["Qator", "Turi", "Mijoz", "Sabab"]);
  for (const issue of issues) sheet.addRow([issue.row, issue.kind, issue.key ?? "", issue.message]);
  sheet.columns = [{ width: 10 }, { width: 18 }, { width: 30 }, { width: 70 }];
  styleHeader(sheet as never);
  sheet.getColumn(4).alignment = { wrapText: true, vertical: "top" };

  return new Blob([await workbook.xlsx.writeBuffer()], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

/** Blob'ni brauzerda yuklab olish. */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
