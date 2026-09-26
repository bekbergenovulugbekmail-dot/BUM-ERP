import { describe, expect, it } from "vitest";
import { mapHeaders, toRequestRows } from "./stock-import.ts";

describe("ombor Excel importi — ustunlar", () => {
  it("o'zbek, rus va ingliz sarlavhalari; `*` va katta harf farqi yo'q", () => {
    expect(mapHeaders(["SKU", "Shtrix-kod", "Mahsulot", "Birlik", "Miqdor*", "Ombor", "Tannarx", "Sotuv narxi"])).toEqual({
      sku: "SKU", barcode: "Shtrix-kod", name: "Mahsulot", unit: "Birlik", quantity: "Miqdor*", warehouse: "Ombor", costPrice: "Tannarx", salesPrice: "Sotuv narxi",
    });
    expect(mapHeaders(["Артикул", "Наименование", "Количество", "Себестоимость"])).toEqual({ sku: "Артикул", name: "Наименование", quantity: "Количество", costPrice: "Себестоимость" });
    expect(mapHeaders(["Product", "Qty", "Purchase cost", "Nimadir"])).toEqual({ name: "Product", quantity: "Qty", costPrice: "Purchase cost" });
  });

  it("namuna (#) va bo'sh qatorlar tashlanadi, bo'sh katak yuborilmaydi", () => {
    const mapping = mapHeaders(["SKU", "Miqdor", "Birlik"]);
    const rows = toRequestRows(
      [
        { SKU: "# MM-COLA", Miqdor: "10", Birlik: "blok" },
        { SKU: "IMP-A", Miqdor: "10", Birlik: "bl" },
        { SKU: "", Miqdor: "", Birlik: "" },
        { SKU: "IMP-B", Miqdor: "100", Birlik: "" },
      ],
      mapping,
    );
    expect(rows).toEqual([{ sku: "IMP-A", quantity: "10", unit: "bl" }, { sku: "IMP-B", quantity: "100" }]);
  });
});
