/**
 * Reysning 3 hujjati bitta snapshotdan: nakladnoylar, yig'ma ro'yxat va marshrut varag'i jami TENG bo'lishi, farq
 * bo'lsa chop etilmasligi. PDF: yig'ma ro'yxat 2 nusxa, marshrut varag'ida ko'p mahsulot ustunlari guruhlanadi.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("jspdf", async (importOriginal) => {
  const actual = await importOriginal<typeof import("jspdf")>();
  const Wrapped = function (...args: ConstructorParameters<typeof actual.jsPDF>) {
    const doc = new actual.jsPDF(...args);
    doc.save = (() => doc) as typeof doc.save;
    return doc;
  } as unknown as typeof actual.jsPDF;
  return { ...actual, default: Wrapped, jsPDF: Wrapped };
});

const { reconcileTrip, routeSheet, pickList } = await import("./trip-documents.ts");
const { generateRouteSheetPDF, generateTripPickListPDF } = await import("@/lib/pdf/trip-pdf.ts");
type Trip = import("./trip-documents.ts").Trip;
type TripTask = import("./trip-documents.ts").TripTask;

const item = (productId: string, name: string, quantity: string, unitName: string, price: number) => ({
  productId,
  productName: name,
  productSku: productId.toUpperCase(),
  quantity,
  unitName,
  unitPrice: String(price),
  lineTotal: (Number(quantity) * price).toFixed(2),
});

const task = (id: string, customerName: string, items: ReturnType<typeof item>[]): TripTask => ({
  id,
  number: `DL-${id}`,
  status: "assigned",
  scheduledDate: "2026-09-26",
  orderNumber: `SO-${id}`,
  orderTotal: items.reduce((sum, row) => sum + Number(row.lineTotal), 0),
  taskTotal: items.reduce((sum, row) => sum + Number(row.lineTotal), 0).toFixed(2),
  customerName,
  customerPhone: "+998900000000",
  customerAddress: "Urganch",
  customerDebt: null,
  warehouseName: "Asosiy ombor",
  agentCode: "DA-1",
  agentName: "Rasulov Ali",
  items,
});

function tripOf(tasks: TripTask[]): Trip {
  const lines = new Map<string, { productId: string; productName: string; productSku: string | null; unitName: string; quantity: number; amount: number }>();
  for (const t of tasks) for (const row of t.items) {
    const key = `${row.productId}|${row.unitName}`;
    const entry = lines.get(key) ?? { productId: row.productId, productName: row.productName, productSku: row.productSku, unitName: row.unitName ?? "—", quantity: 0, amount: 0 };
    entry.quantity += Number(row.quantity);
    entry.amount += Number(row.lineTotal);
    lines.set(key, entry);
  }
  const amount = tasks.reduce((sum, t) => sum + Number(t.taskTotal), 0);
  return {
    id: "trip",
    number: "RS-2026-00001",
    tripDate: "2026-09-26",
    status: "picking",
    totalAmount: amount.toFixed(2),
    createdByName: "Ega",
    loadedAt: null,
    outAt: null,
    cancelReason: null,
    lines: [...lines.values()].map((line, index) => ({ id: `l${index}`, productId: line.productId, productName: line.productName, productSku: line.productSku, unitName: line.unitName, requiredQty: line.quantity.toFixed(4), pickedQty: null, pickStatus: "pending", note: null })),
    snapshot: {
      number: "RS-2026-00001",
      tripDate: "2026-09-26",
      createdAt: "2026-09-26T08:00:00Z",
      warehouse: { id: "w", name: "Asosiy ombor" },
      agent: { id: "a", code: "DA-1", name: "Rasulov Ali", phone: "+998931110001" },
      tasks,
      lines: [...lines.values()].map((line) => ({ ...line, quantity: line.quantity.toFixed(4), amount: line.amount.toFixed(2) })),
      totals: { quantity: [...lines.values()].reduce((sum, line) => sum + line.quantity, 0).toFixed(4), amount: amount.toFixed(2), tasks: tasks.length },
    },
  };
}

const scenario = () =>
  tripOf([
    task("1", "Test Market", [item("cola", "Coca Cola 1L", "2", "bl", 60000), item("chips", "Chips", "5", "d", 8000)]),
    task("2", "Bonnu Market", [item("cola", "Coca Cola 1L", "3", "bl", 60000)]),
    task("3", "Anor Market", [item("cola", "Coca Cola 1L", "1", "bl", 60000), item("chips", "Chips", "4", "d", 8000)]),
  ]);

describe("Reys hujjatlari mosligi", () => {
  it("nakladnoylar = yig'ma = marshrut varag'i (Cola 6 blok, Chips 9 dona); summa teng", () => {
    const trip = scenario();
    expect(reconcileTrip(trip.snapshot)).toEqual({ ok: true, mismatches: [] });
    const sheet = routeSheet(trip.snapshot);
    expect(sheet.columnTotals["cola|bl"]).toBe("6.0000");
    expect(sheet.columnTotals["chips|d"]).toBe("9.0000");
    expect(sheet.grandAmount).toBe(trip.snapshot.totals.amount);
    expect(sheet.rows.map((row) => row.customerName)).toEqual(["Test Market", "Bonnu Market", "Anor Market"]);
    expect(pickList(trip.snapshot).map((row) => `${row.productName}:${row.quantity}`)).toEqual(["Coca Cola 1L:6.0000", "Chips:9.0000"]);
  });

  it("birliklar aralashmaydi: blok va dona alohida ustun", () => {
    const trip = tripOf([task("1", "A", [item("cola", "Cola", "1", "bl", 60000), item("cola", "Cola", "5", "d", 5000)])]);
    expect(routeSheet(trip.snapshot).columns.map((column) => column.key).sort()).toEqual(["cola|bl", "cola|d"]);
    expect(reconcileTrip(trip.snapshot).ok).toBe(true);
  });

  it("snapshot buzilgan bo'lsa (yig'ma nakladnoydan farq qiladi) — mos emas, PDF chiqmaydi", async () => {
    const trip = scenario();
    trip.snapshot.lines[0]!.quantity = "7.0000";
    const check = reconcileTrip(trip.snapshot);
    expect(check.ok).toBe(false);
    expect(check.mismatches[0]).toContain("Coca Cola 1L");
    await expect(generateTripPickListPDF(trip, { name: "BONNU" })).rejects.toThrow("mos emas");
  });
});

describe("Reys PDF", () => {
  it("yig'ma ro'yxat 2 nusxada (omborchi va yetkazuvchi)", async () => {
    const doc = await generateTripPickListPDF(scenario(), { name: "BONNU" });
    expect(doc.getNumberOfPages()).toBe(2);
  });

  it("marshrut varag'i albomda; 10 mahsulot — ustunlar 2 guruhga bo'linadi, summa oxirgisida", async () => {
    const many = Array.from({ length: 10 }, (_, index) => item(`p${index}`, `Mahsulot ${index + 1}`, "1", "d", 1000));
    const trip = tripOf([task("1", "Test Market", many), task("2", "Bonnu Market", many.slice(0, 3))]);
    const doc = await generateRouteSheetPDF(trip, { name: "BONNU" });
    expect(doc.getNumberOfPages()).toBe(2);
    expect(doc.internal.pageSize.getWidth()).toBeGreaterThan(doc.internal.pageSize.getHeight());
  });
});
