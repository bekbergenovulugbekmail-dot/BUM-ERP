/**
 * Reysning uchta hujjati — BITTA snapshotdan (server `delivery_trips.snapshot`):
 *   1) mijoz nakladnoylari        — `snapshot.tasks` (W1 dagi nakladnoy ma'lumoti)
 *   2) omborchining yig'ma ro'yxati — `pickList`: mahsulot × birlik jami
 *   3) marshrut varag'i            — `routeSheet`: mijoz × mahsulot jadvali (ustunlar dinamik)
 *
 * `reconcileTrip` uchalasini solishtiradi: har mahsulot bo'yicha miqdor va reys summasi bir xil bo'lishi SHART. Chop etishdan
 * oldin tekshiriladi — farq bo'lsa hujjat chiqmaydi (noto'g'ri yuk xati omborda yoki mijozda janjal bo'lmasin).
 * Hisob minor birlikda (miqdor 4 xona, summa 2 xona) — float xatosi yo'q.
 */
import type { SingleDeliveryWaybill, WaybillOrderItem } from "@/lib/pdf/delivery-waybill-pdf.ts";

export type TripTask = Omit<SingleDeliveryWaybill, "items"> & { id: string; items: (WaybillOrderItem & { productId: string })[] };

export type TripSnapshot = {
  number: string;
  tripDate: string;
  createdAt: string;
  warehouse: { id: string; name: string | null };
  agent: { id: string; code: string | null; name: string | null; phone: string | null };
  tasks: TripTask[];
  lines: { productId: string; productName: string; productSku: string | null; unitName: string; quantity: string; amount: string }[];
  totals: { quantity: string; amount: string; tasks: number };
};

export type TripLine = {
  id: string;
  productId: string;
  productName: string;
  productSku: string | null;
  unitName: string;
  requiredQty: string;
  pickedQty: string | null;
  pickStatus: "pending" | "picked" | "partially_picked" | "missing";
  note: string | null;
};

export type Trip = {
  id: string;
  number: string;
  tripDate: string;
  status: "picking" | "loaded" | "out_for_delivery" | "cancelled";
  totalAmount: string;
  snapshot: TripSnapshot;
  lines: TripLine[];
  createdByName: string | null;
  loadedAt: string | null;
  outAt: string | null;
  cancelReason: string | null;
};

const QTY = 10_000n;
const MONEY = 100n;

/** "12.5" → 125000n (4 xona) yoki 1250n (2 xona). */
function toMinor(value: string | number, scale: bigint): bigint {
  const text = String(value).trim();
  const negative = text.startsWith("-");
  const [whole = "0", fraction = ""] = text.replace(/^-/, "").split(".");
  const digits = scale === QTY ? 4 : 2;
  const minor = BigInt(whole || "0") * scale + BigInt((fraction + "0000").slice(0, digits) || "0");
  return negative ? -minor : minor;
}

function fromMinor(value: bigint, scale: bigint): string {
  const digits = scale === QTY ? 4 : 2;
  const negative = value < 0n;
  const abs = negative ? -value : value;
  return `${negative ? "-" : ""}${abs / scale}.${String(abs % scale).padStart(digits, "0")}`;
}

const keyOf = (productId: string, unitName: string | null) => `${productId}|${unitName ?? "—"}`;

/** Omborchining yig'ma ro'yxati: snapshot qatorlari (server yig'gan) — miqdor tartibida emas, nom tartibida. */
export function pickList(snapshot: TripSnapshot) {
  return snapshot.lines.map((line, index) => ({ index: index + 1, key: keyOf(line.productId, line.unitName), ...line }));
}

/** Marshrut varag'i: qatorlar — mijozlar (reys tartibida), ustunlar — reysdagi mahsulotlar (birlik bilan). */
export function routeSheet(snapshot: TripSnapshot) {
  const columns = snapshot.lines.map((line) => ({ key: keyOf(line.productId, line.unitName), productName: line.productName, unitName: line.unitName }));
  const totals = new Map<string, bigint>(columns.map((column) => [column.key, 0n]));
  let grand = 0n;
  const rows = snapshot.tasks.map((task, index) => {
    const cells = new Map<string, bigint>();
    for (const item of task.items) {
      const key = keyOf(item.productId, item.unitName);
      cells.set(key, (cells.get(key) ?? 0n) + toMinor(item.quantity, QTY));
    }
    for (const [key, value] of cells) totals.set(key, (totals.get(key) ?? 0n) + value);
    const amount = toMinor(String(task.taskTotal ?? task.orderTotal), MONEY);
    grand += amount;
    return {
      index: index + 1,
      taskNumber: task.number,
      orderNumber: task.orderNumber,
      customerName: task.customerName,
      customerPhone: task.customerPhone,
      customerAddress: task.customerAddress,
      salesRepName: task.salesRepName ?? null,
      cells: Object.fromEntries([...cells].map(([key, value]) => [key, fromMinor(value, QTY)])),
      amount: fromMinor(amount, MONEY),
    };
  });
  return {
    columns,
    rows,
    columnTotals: Object.fromEntries([...totals].map(([key, value]) => [key, fromMinor(value, QTY)])),
    grandAmount: fromMinor(grand, MONEY),
  };
}

/**
 * Uchta hujjatni solishtirish: (a) nakladnoy qatorlari yig'indisi = yig'ma ro'yxat = marshrut varag'i ustun jami — har
 * mahsulot × birlik uchun; (b) nakladnoylar summasi = marshrut varag'i jami = reys jami.
 */
export function reconcileTrip(snapshot: TripSnapshot) {
  const mismatches: string[] = [];
  const fromWaybills = new Map<string, bigint>();
  for (const task of snapshot.tasks) {
    for (const item of task.items) {
      const key = keyOf(item.productId, item.unitName);
      fromWaybills.set(key, (fromWaybills.get(key) ?? 0n) + toMinor(item.quantity, QTY));
    }
  }
  const sheet = routeSheet(snapshot);
  const keys = new Set([...fromWaybills.keys(), ...snapshot.lines.map((line) => keyOf(line.productId, line.unitName))]);
  for (const key of keys) {
    const line = snapshot.lines.find((row) => keyOf(row.productId, row.unitName) === key);
    const waybills = fromWaybills.get(key) ?? 0n;
    const picking = line ? toMinor(line.quantity, QTY) : 0n;
    const route = toMinor(sheet.columnTotals[key] ?? "0", QTY);
    if (waybills !== picking || picking !== route) {
      mismatches.push(`${line?.productName ?? key}: nakladnoy ${fromMinor(waybills, QTY)}, ombor ${fromMinor(picking, QTY)}, marshrut ${fromMinor(route, QTY)}`);
    }
  }
  const waybillAmount = snapshot.tasks.reduce((sum, task) => sum + toMinor(String(task.taskTotal ?? task.orderTotal), MONEY), 0n);
  if (waybillAmount !== toMinor(sheet.grandAmount, MONEY) || waybillAmount !== toMinor(snapshot.totals.amount, MONEY)) {
    mismatches.push(`Summa: nakladnoylar ${fromMinor(waybillAmount, MONEY)}, marshrut ${sheet.grandAmount}, reys ${snapshot.totals.amount}`);
  }
  return { ok: mismatches.length === 0, mismatches };
}

export const PICK_STATUS_LABELS: Record<TripLine["pickStatus"], string> = {
  pending: "Kutilmoqda",
  picked: "Terildi",
  partially_picked: "Qisman",
  missing: "Yo'q",
};

export const TRIP_STATUS_LABELS: Record<Trip["status"], string> = {
  picking: "Terilmoqda",
  loaded: "Yuklandi",
  out_for_delivery: "Yo'lda",
  cancelled: "Bekor qilingan",
};
