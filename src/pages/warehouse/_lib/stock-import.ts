/**
 * Ombor qoldig'i Excel importi — ustunlarni aniqlash (sarlavha nomi bo'yicha) va server so'rovi qatorlari.
 * Hisob-kitob (birlik konversiyasi, qiymat, xatolar) — FAQAT serverda (`POST /api/inventory/stock/import`).
 */
import type { SheetColumn } from "@/components/csv/xlsx.ts";

export type StockImportField = "sku" | "barcode" | "name" | "unit" | "warehouse" | "quantity" | "costPrice" | "salesPrice";

export const STOCK_IMPORT_COLUMNS: (SheetColumn & { key: StockImportField; label: string })[] = [
  { key: "sku", label: "SKU", aliases: ["sku", "artikul", "kod", "код", "артикул"], example: "MM-COLA" },
  { key: "barcode", label: "Shtrix-kod", aliases: ["shtrix-kod", "shtrix kod", "shtrixkod", "barcode", "штрих-код", "штрихкод"], example: "4780000000011" },
  { key: "name", label: "Mahsulot", aliases: ["mahsulot", "nomi", "mahsulot nomi", "product", "name", "товар", "наименование"], example: "Coca Cola 1L" },
  { key: "unit", label: "Birlik", aliases: ["birlik", "o'lchov birligi", "unit", "ед", "ед. изм", "единица"], example: "blok" },
  { key: "quantity", label: "Miqdor", aliases: ["miqdor", "soni", "qoldiq", "quantity", "qty", "количество", "кол-во"], required: true, example: "10" },
  { key: "warehouse", label: "Ombor", aliases: ["ombor", "warehouse", "склад"], example: "Asosiy ombor" },
  { key: "costPrice", label: "Tannarx", aliases: ["tannarx", "xarid narxi", "kirim narxi", "purchase cost", "cost", "cost price", "себестоимость", "закупочная цена"], example: "60000" },
  { key: "salesPrice", label: "Sotuv narxi", aliases: ["sotuv narxi", "narx", "sale price", "price", "цена", "цена продажи"], example: "15000" },
];

const normalize = (text: string) => text.toLowerCase().replace(/\*/g, "").replace(/[‘’`ʻʼ]/g, "'").replace(/\s+/g, " ").trim();

/** Sarlavha → maydon. Topilmagan ustun e'tiborsiz qoldiriladi. */
export function mapHeaders(headers: string[]): Partial<Record<StockImportField, string>> {
  const result: Partial<Record<StockImportField, string>> = {};
  for (const header of headers) {
    const text = normalize(header);
    const column = STOCK_IMPORT_COLUMNS.find((item) => normalize(item.label) === text || item.aliases.some((alias) => normalize(alias) === text));
    if (column && !result[column.key]) result[column.key] = header;
  }
  return result;
}

export type StockImportRequestRow = Partial<Record<StockImportField, string>> & { quantity: string };

/** Namuna qatori (`#` bilan boshlanadi) va butunlay bo'sh qatorlar tashlanadi. */
export function toRequestRows(raw: Record<string, string>[], mapping: Partial<Record<StockImportField, string>>): StockImportRequestRow[] {
  return raw
    .filter((row) => !Object.values(row).some((value) => value.trim().startsWith("#")))
    .map((row) => {
      const out: Record<string, string> = {};
      for (const [field, header] of Object.entries(mapping)) {
        const value = (row[header] ?? "").trim();
        if (value) out[field] = value;
      }
      return { ...out, quantity: out.quantity ?? "" } as StockImportRequestRow;
    })
    .filter((row) => Object.keys(row).some((key) => key !== "quantity") || row.quantity);
}

export type StockImportPreviewLine = {
  row: number;
  productId: string | null;
  sku: string | null;
  barcode: string | null;
  name: string | null;
  unit: string | null;
  quantity: string;
  factor: string;
  baseUnit: string | null;
  baseQuantity: string;
  costPrice: string | null;
  baseCostPrice: string | null;
  value: string;
  currentQuantity: string;
  quantityAfter: string;
  salesPrice: string | null;
  excelSalesPrice: string | null;
  errors: string[];
  warnings: string[];
};

export type StockImportResult = {
  importId: string | null;
  duplicate: boolean;
  applied: boolean;
  lines: StockImportPreviewLine[];
  totals: { rows: number; valid: number; invalid: number; products: number; value: string } | null;
};
