/**
 * Ombor qoldig'i A4 hisoboti: jami (AVCO) aniq, tannarx ruxsatisiz ustun chiqmaydi, 100 / 500 / 1000 mahsulotda
 * sarlavha har sahifada, qator footer ustiga tushmaydi, hech narsa sahifadan chiqmaydi.
 */
import { describe, expect, it, vi } from "vitest";
import type { StockExportRow } from "@/pages/warehouse/_lib/stock-export.ts";

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
const { buildStockReport, generateStockReportPDF } = await import("./stock-report-pdf.ts");

const company = { name: "BUM OMBOR MCHJ", taxId: "301234567" };
const row = (index: number, overrides: Partial<StockExportRow> = {}): StockExportRow => ({
  warehouseId: "w1",
  warehouseName: "Asosiy ombor",
  productId: `p${index}`,
  productSku: `SKU-${String(index).padStart(4, "0")}`,
  productBarcode: `478${String(index).padStart(10, "0")}`,
  productName: `Mahsulot ${String(index).padStart(4, "0")}`,
  categoryName: null,
  unitName: "dona",
  quantity: `${index}.0000`,
  reservedQty: "0.0000",
  availableQty: `${index}.0000`,
  avgCostPrice: "1000.0000",
  retailPrice: "1500.00",
  wholesalePrice: null,
  ...overrides,
});

// Haqiqiy import natijasi: A 60 dona × 10 000, B 100 × 5 000, C 200 × 3 000 = 1 700 000
const imported = [
  row(1, { productName: "Product A", quantity: "60.0000", avgCostPrice: "10000.0000", retailPrice: "12000.00" }),
  row(2, { productName: "Product B", quantity: "100.0000", avgCostPrice: "5000.0000", retailPrice: "8000.00" }),
  row(3, { productName: "Product C", quantity: "200.0000", avgCostPrice: "3000.0000", retailPrice: "4000.00" }),
];

type Doc = Awaited<ReturnType<typeof generateStockReportPDF>>["doc"];
const pageText = (doc: Doc, page: number) => ((doc as unknown as { internal: { pages: string[][] } }).internal.pages[page] ?? []).join(" ");
const PT_HEIGHT = 841.89;
const PT_PER_MM = 72 / 25.4;
function textBlocks(doc: Doc, page: number) {
  const blocks: { top: number; left: number; text: string }[] = [];
  for (const match of pageText(doc, page).matchAll(/([\d.]+)\s+([\d.]+)\s+Td\s*\n?\s*\((.*?)\)\s*Tj/gs)) {
    blocks.push({ left: Number(match[1]) / PT_PER_MM, top: (PT_HEIGHT - Number(match[2])) / PT_PER_MM, text: match[3]! });
  }
  return blocks;
}
const generate = (rows: StockExportRow[], costVisible = true) =>
  generateStockReportPDF(rows, { company, warehouseName: "Asosiy ombor", costVisible, generatedBy: "Omborchi Ali", generatedAt: new Date(2026, 8, 26, 14, 5), save: false });

describe("Ombor qoldig'i A4 hisoboti", () => {
  it("jami: mahsulotlar, miqdor va qiymat (AVCO) — Excel import bilan bir xil", () => {
    const report = buildStockReport(imported, true);
    expect(report.totals).toEqual({ products: 3, quantity: "360.0000", value: "1700000.00" });
    expect(report.lines.map((line) => line.value)).toEqual(["600000.00", "500000.00", "600000.00"]);
    expect(report.lines[0]).toMatchObject({ margin: "2000.00", marginPercent: "16.7" });
    // Asosiy sotuv narxi (mahsulot kartochkasi) chakana narxdan ustun; 0 — narx yo'q
    const [withSales] = buildStockReport([{ ...imported[0]!, salesPrice: "15000.00" }], true).lines;
    expect(withSales).toMatchObject({ salePrice: "15000.00", margin: "5000.00", marginPercent: "33.3" });
    const [zero] = buildStockReport([{ ...imported[0]!, salesPrice: "0.00" }], true).lines;
    expect(zero!.salePrice).toBe("12000.00");
  });

  it("qiymat qator bo'yicha yaxlitlanadi va float xatosiz qo'shiladi", () => {
    const rows = Array.from({ length: 1000 }, (_, index) => row(index + 1, { quantity: "0.1000", avgCostPrice: "0.3000" }));
    // 0.1 × 0.3 = 0.03 → 1000 ta = 30.00 (float'da 29.999999…)
    expect(buildStockReport(rows, true).totals.value).toBe("30.00");
  });

  it("tannarx ruxsatisiz: tannarx, qiymat va marja umuman yo'q (0 yozilmaydi)", async () => {
    const hidden = imported.map((item) => ({ ...item, avgCostPrice: null }));
    const report = buildStockReport(hidden, false);
    expect(report.totals.value).toBeNull();
    expect(report.lines.every((line) => line.cost === null && line.value === null && line.margin === null)).toBe(true);
    const { doc } = await generate(hidden, false);
    const text = pageText(doc, 1);
    expect(text).not.toContain("Tannarx)");
    expect(text).not.toContain("Qiymat");
    expect(text).not.toContain("Marja");
    expect(text).toContain("Sotuv");
  });

  it("A4 format, sarlavha: kompaniya, ombor, sana-vaqt, tuzgan xodim; ustunlar", async () => {
    const { doc } = await generate(imported);
    expect(Math.round(doc.internal.pageSize.getWidth())).toBe(A4.width);
    expect(Math.round(doc.internal.pageSize.getHeight())).toBe(A4.height);
    expect(doc.getNumberOfPages()).toBe(1);
    const text = pageText(doc, 1);
    for (const needle of ["BUM OMBOR MCHJ", "OMBOR QOLDIG'I", "Asosiy ombor", "2026-09-26 14:05", "Omborchi Ali", "SKU", "Shtrix-kod", "Mahsulot", "Birlik", "Miqdor", "Tannarx", "Qiymat", "Sotuv", "Marja", "AVCO", "JAMI:", "Product A"]) {
      expect(text, needle).toContain(needle);
    }
  });

  for (const count of [100, 500, 1000]) {
    it(`${count} mahsulot: ko'p sahifa, sarlavha takrorlanadi, qator kesilmaydi va footer ustiga tushmaydi`, async () => {
      const rows = Array.from({ length: count }, (_, index) => row(index + 1));
      const { doc, report } = await generate(rows);
      const pages = doc.getNumberOfPages();
      expect(pages).toBeGreaterThan(1);
      const seen = new Set<string>();
      let totalsPages = 0;
      for (let page = 1; page <= pages; page += 1) {
        const text = pageText(doc, page);
        expect(text, `${page}-sahifa: kompaniya`).toContain("BUM OMBOR MCHJ");
        if (text.includes("JAMI:")) totalsPages += 1;
        const blocks = textBlocks(doc, page);
        if (blocks.some((block) => block.text.startsWith("SKU-"))) expect(text, `${page}-sahifa: jadval sarlavhasi`).toContain("Shtrix-kod");
        for (const block of blocks) {
          expect(block.top).toBeGreaterThanOrEqual(0);
          expect(block.top).toBeLessThanOrEqual(A4.height);
          expect(block.left).toBeGreaterThanOrEqual(0);
          expect(block.left).toBeLessThanOrEqual(A4.width);
          if (block.text.startsWith("SKU-")) {
            expect(block.top, `${page}: qator footer ustida`).toBeLessThanOrEqual(contentBottom());
            seen.add(block.text);
          }
        }
      }
      expect(seen.size, "har mahsulot aynan chizilgan").toBe(count);
      expect(totalsPages, "jami bir marta").toBe(1);
      expect(report.totals.products).toBe(count);
    }, 60_000);
  }
});
