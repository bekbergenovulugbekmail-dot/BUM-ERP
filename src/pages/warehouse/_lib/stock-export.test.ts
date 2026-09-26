import { describe, expect, it } from "vitest";
import { exportColumns, totalsByProduct, type StockExportRow } from "./stock-export.ts";

const row = (warehouse: string, product: string, quantity: string, reserved: string): StockExportRow => ({
  warehouseId: warehouse, warehouseName: warehouse, productId: product, productSku: product, productBarcode: null,
  productName: product, categoryName: null, unitName: "d", quantity, reservedQty: reserved,
  availableQty: (Number(quantity) - Number(reserved)).toFixed(4), avgCostPrice: null, retailPrice: "12000", wholesalePrice: null,
});

describe("Ombor eksporti", () => {
  it("tannarx ustuni faqat ruxsat bilan; miqdor ustunlari faqat miqdorli eksportda", () => {
    const headers = (kind: "catalog" | "quantities", cost: boolean) => exportColumns(kind, cost).map((c) => c.header);
    expect(headers("catalog", false)).not.toContain("Tannarx");
    expect(headers("catalog", true)).toContain("Tannarx");
    expect(headers("catalog", true)).not.toContain("Haqiqiy qoldiq");
    expect(headers("quantities", false)).toEqual(expect.arrayContaining(["Ombor", "Haqiqiy qoldiq", "Band (buyurtmalar)", "Mavjud (sotish mumkin)", "Sotuv narxi"]));
  });

  it("\"Jami\": omborlar bo'yicha aniq qo'shiladi (float xatosiz), mavjud = qoldiq − band", () => {
    const totals = totalsByProduct([row("A", "Cola", "60.1000", "6.0000"), row("B", "Cola", "0.2000", "0.0000"), row("A", "Chips", "3.0000", "0")]);
    const cola = totals.find((t) => t.productId === "Cola")!;
    expect(cola.quantity).toBe("60.3000");
    expect(cola.reservedQty).toBe("6.0000");
    expect(cola.availableQty).toBe("54.3000");
    expect(cola.warehouseName).toBe("2 ta ombor");
    expect(totals.map((t) => t.productName)).toEqual(["Chips", "Cola"]);
  });
});

describe("Ombor eksporti — A4 chop etish", () => {
  const load = async (blob: Blob) => {
    const ExcelJS = (await import("exceljs")).default;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await blob.arrayBuffer());
    return workbook;
  };
  const rows = Array.from({ length: 120 }, (_, index) => ({
    ...row("Asosiy ombor", `P${index}`, "10.0000", "1.0000"),
    productName: `Juda uzun mahsulot nomi ${index} — Coca Cola Zero Sugar 1.5 L plastik shishada`,
    salesPrice: "15000.00",
    retailPrice: null,
  }));

  it("miqdorli eksport: A4 albom, bir sahifa kengligi, sarlavha har sahifada, chegaralar, uzun nom bo'linadi", async () => {
    const { buildStockXlsx } = await import("./stock-export.ts");
    const file = await buildStockXlsx("quantities", rows, { costVisible: true, companyName: "BUM", warehouseLabel: "Asosiy ombor", date: "2026-09-26" });
    const workbook = await load(file.blob);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["Omborlar boʻyicha", "Jami"]);
    for (const sheet of workbook.worksheets) {
      expect(sheet.pageSetup).toMatchObject({ paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: "4:4" });
      const header = sheet.getRow(4);
      expect(header.getCell(1).value).toBe("SKU");
      expect(header.getCell(1).border?.top?.style).toBe("thin");
      const name = sheet.getRow(5).getCell(3);
      expect(name.alignment?.wrapText).toBe(true);
      expect(sheet.getRow(5).getCell(1).border?.bottom?.style).toBe("thin");
      // Sotuv narxi — asosiy narx (retail bo'sh bo'lsa ham)
      expect(sheet.getRow(5).getCell(11).value).toBe(15000);
    }
    // 12 ustun kengligi A4 albomga yaqin (siqish kichik bo'lsin — o'qiladigan shrift)
    const total = workbook.worksheets[0]!.columns.reduce((sum, column) => sum + (column.width ?? 0), 0);
    expect(total).toBeLessThanOrEqual(150);
  });

  it("katalog eksporti (kam ustun): A4 kitob varag'i", async () => {
    const { buildStockXlsx } = await import("./stock-export.ts");
    const file = await buildStockXlsx("catalog", rows, { costVisible: false, companyName: "BUM", warehouseLabel: "Asosiy ombor", date: "2026-09-26" });
    const [sheet] = (await load(file.blob)).worksheets;
    expect(sheet!.pageSetup).toMatchObject({ paperSize: 9, orientation: "portrait", fitToWidth: 1, fitToHeight: 0 });
  });
});
