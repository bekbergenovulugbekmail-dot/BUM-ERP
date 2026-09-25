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
