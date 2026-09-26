/**
 * Ombor qoldig'i eksporti (Excel).
 *
 * Ma'lumot serverdan (`GET /api/inventory/stock/export`) — qoldiq, band va mavjud `stock_levels` dan, bu yerda
 * hech narsa qayta hisoblanmaydi (faqat "Jami" varag'ida omborlar bo'yicha qo'shiladi). Tannarx ruxsatsiz
 * serverdan `null` keladi — ustunning o'zi ham chiqmaydi (0 yozilmaydi: 0 noto'g'ri ma'lumot berardi).
 *
 * Ikki xil:
 *  - `catalog`   — tanlangan ombordagi mahsulotlar ro'yxati (miqdorsiz): SKU, shtrix-kod, nom, kategoriya, birlik, narxlar
 *  - `quantities` — foydalanuvchiga ochiq BARCHA omborlar: har ombor alohida qator + "Jami" varag'i
 */
export type StockExportRow = {
  warehouseId: string;
  warehouseName: string;
  productId: string;
  productSku: string | null;
  productBarcode: string | null;
  productName: string;
  categoryName: string | null;
  unitName: string;
  quantity: string;
  reservedQty: string;
  availableQty: string;
  avgCostPrice: string | null;
  /** Asosiy sotuv narxi (mahsulot kartochkasi); eski javobda bo'lmasligi mumkin. */
  salesPrice?: string | null;
  retailPrice: string | null;
  wholesalePrice: string | null;
};

export type StockExportKind = "catalog" | "quantities";

type Column = { header: string; width: number; value: (row: StockExportRow) => string | number | null; number?: "qty" | "money" };

const num = (value: string | null) => (value === null || value === "" ? null : Number(value));

export function exportColumns(kind: StockExportKind, costVisible: boolean): Column[] {
  const head: Column[] = [
    { header: "SKU", width: 14, value: (row) => row.productSku ?? "" },
    { header: "Shtrix-kod", width: 16, value: (row) => row.productBarcode ?? "" },
    { header: "Mahsulot", width: 40, value: (row) => row.productName },
    { header: "Kategoriya", width: 20, value: (row) => row.categoryName ?? "" },
    { header: "Birlik", width: 8, value: (row) => row.unitName },
  ];
  const quantities: Column[] = kind === "quantities"
    ? [
        { header: "Ombor", width: 18, value: (row) => row.warehouseName },
        { header: "Haqiqiy qoldiq", width: 14, value: (row) => num(row.quantity), number: "qty" },
        { header: "Band (buyurtmalar)", width: 16, value: (row) => num(row.reservedQty), number: "qty" },
        { header: "Mavjud (sotish mumkin)", width: 18, value: (row) => num(row.availableQty), number: "qty" },
      ]
    : [];
  const prices: Column[] = [
    ...(costVisible ? [{ header: "Tannarx", width: 14, value: (row: StockExportRow) => num(row.avgCostPrice), number: "money" as const }] : []),
    { header: "Sotuv narxi", width: 14, value: (row) => num(row.retailPrice), number: "money" },
    { header: "Ulgurji narx", width: 14, value: (row) => num(row.wholesalePrice), number: "money" },
  ];
  return [...head, ...quantities, ...prices];
}

/** Omborlar bo'yicha yig'indi — mahsulot × (qoldiq, band, mavjud). Minor birlikda (4 xona) qo'shiladi, float xatosiz. */
export function totalsByProduct(rows: StockExportRow[]) {
  const scale = 10_000n;
  const toMinor = (value: string) => {
    const [whole = "0", fraction = ""] = value.replace(/^-/, "").split(".");
    const minor = BigInt(whole) * scale + BigInt((fraction + "0000").slice(0, 4));
    return value.startsWith("-") ? -minor : minor;
  };
  const fromMinor = (value: bigint) => {
    const sign = value < 0n ? "-" : "";
    const abs = value < 0n ? -value : value;
    return `${sign}${abs / scale}.${String(abs % scale).padStart(4, "0")}`;
  };
  const map = new Map<string, { row: StockExportRow; quantity: bigint; reserved: bigint; available: bigint; warehouses: number }>();
  for (const row of rows) {
    const entry = map.get(row.productId) ?? { row, quantity: 0n, reserved: 0n, available: 0n, warehouses: 0 };
    entry.quantity += toMinor(row.quantity);
    entry.reserved += toMinor(row.reservedQty);
    entry.available += toMinor(row.availableQty);
    entry.warehouses += 1;
    map.set(row.productId, entry);
  }
  return [...map.values()]
    .map((entry) => ({
      ...entry.row,
      warehouseName: `${entry.warehouses} ta ombor`,
      quantity: fromMinor(entry.quantity),
      reservedQty: fromMinor(entry.reserved),
      availableQty: fromMinor(entry.available),
    }))
    .sort((a, b) => a.productName.localeCompare(b.productName));
}

/** Katalog eksportida bitta ombor ichida mahsulot bir marta (server bitta omborni beradi, lekin himoya uchun). */
function uniqueProducts(rows: StockExportRow[]) {
  const seen = new Set<string>();
  return rows.filter((row) => (seen.has(row.productId) ? false : (seen.add(row.productId), true)));
}

export async function buildStockXlsx(
  kind: StockExportKind,
  rows: StockExportRow[],
  options: { costVisible: boolean; companyName: string; warehouseLabel: string; date: string },
): Promise<{ blob: Blob; filename: string }> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "BUM ERP";
  workbook.created = new Date();

  const addSheet = (name: string, title: string, data: StockExportRow[]) => {
    const columns = exportColumns(kind, options.costVisible);
    const sheet = workbook.addWorksheet(name);
    sheet.addRow([title]).font = { bold: true, size: 13 };
    sheet.addRow([`${options.companyName} · ${options.date}`]);
    sheet.addRow([]);
    const header = sheet.addRow(columns.map((column) => column.header));
    header.font = { bold: true, color: { argb: "FFFFFFFF" } };
    header.eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E2850" } };
    });
    for (const row of data) sheet.addRow(columns.map((column) => column.value(row)));
    columns.forEach((column, index) => {
      const col = sheet.getColumn(index + 1);
      col.width = column.width;
      if (column.number === "qty") col.numFmt = "#,##0.####";
      if (column.number === "money") col.numFmt = "#,##0.00";
    });
    sheet.views = [{ state: "frozen", ySplit: 4 }];
  };

  const safe = (text: string) => text.replace(/[^\p{L}\p{N}-]+/gu, "_");
  if (kind === "catalog") {
    addSheet("Mahsulotlar", `Mahsulotlar — ${options.warehouseLabel}`, uniqueProducts(rows));
    const blob = new Blob([await workbook.xlsx.writeBuffer()], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    return { blob, filename: `mahsulotlar-${safe(options.warehouseLabel)}-${options.date}.xlsx` };
  }
  addSheet("Omborlar bo'yicha", `Ombordagi qoldiq — ${options.warehouseLabel}`, rows);
  addSheet("Jami", "Barcha omborlar bo'yicha jami", totalsByProduct(rows));
  const blob = new Blob([await workbook.xlsx.writeBuffer()], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  return { blob, filename: `ombor-qoldigi-${safe(options.warehouseLabel)}-${options.date}.xlsx` };
}
