/**
 * YETKAZMA REYSI — bitta yetkazuvchining bitta ombordan bir kunlik yuki (egasining vazifasi, W6; Z2 qarori).
 *
 * Reys yaratilganda tanlangan yetkazmalarning nakladnoy ma'lumoti (W1 dagi yagona manba — `deliveryWaybillsByIds`:
 * yetkazma qatorlari, savdo agenti va yetkazuvchi) O'ZGARMAS snapshot bo'lib saqlanadi. Uchta hujjat:
 *   1) mijoz nakladnoylari        — snapshot.tasks
 *   2) omborchining yig'ma ro'yxati — `delivery_trip_lines` (mahsulot × birlik jami), 2 nusxada chop etiladi
 *   3) yetkazuvchining marshrut varag'i — mijoz × mahsulot jadvali
 * Hammasi bitta snapshotdan — jami miqdor va summa har uchalasida teng (test bilan tekshiriladi). Keyinroq buyurtma yoki
 * yetkazma o'zgarsa ham chop etilgan hujjatlar bir-biridan ajralmaydi; o'zgarish kerak bo'lsa reys bekor qilinib qayta tuziladi.
 *
 * Terish (picked / partially_picked / missing) va yuklash (loaded → out_for_delivery) faqat QAYD: zaxira, qarz va jurnal
 * o'zgarmaydi — ombordan chiqim avvalgidek yetkazma "boshlash"ida (Z2). Bitta yetkazma bir vaqtda faqat bitta faol reysda.
 */
import { and, asc, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { badRequest, conflict, notFound } from "@bum/shared";
import { deliveryAgents, deliveryTasks, deliveryTripLines, deliveryTripTasks, deliveryTrips } from "../../db/schema/delivery.js";
import { warehouses } from "../../db/schema/inventory.js";
import { users } from "../../db/schema/platform.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import { writeAuditLog, type RequestMeta } from "../../shared/audit.js";
import { fromMinor, toMinor } from "../../shared/decimal.js";
import { nextDocumentNumber } from "../../shared/numbering.js";
import type { TenantContext } from "../company/tenant.js";
import { deliveryWaybillsByIds } from "./tasks.service.js";

/** Reysga kiradigan holatlar: hali yo'lga chiqmagan yetkazmalar. */
export const TRIP_ELIGIBLE_STATUSES = ["ready", "assigned", "accepted"] as const;

type WaybillTask = Awaited<ReturnType<typeof deliveryWaybillsByIds>>["tasks"][number];

export type TripSnapshot = {
  number: string;
  tripDate: string;
  createdAt: string;
  warehouse: { id: string; name: string | null };
  agent: { id: string; code: string | null; name: string | null; phone: string | null };
  tasks: WaybillTask[];
  lines: { productId: string; productName: string; productSku: string | null; unitName: string; quantity: string; amount: string }[];
  totals: { quantity: string; amount: string; tasks: number };
};

async function audit(conn: DbOrTx, tenant: TenantContext, meta: RequestMeta, action: string, resourceId: string, details: Record<string, unknown>) {
  await writeAuditLog(
    { userId: tenant.user.id, userName: tenant.user.name, companyId: tenant.company.id, action, resource: "delivery_trips", resourceId, details, ...meta },
    conn,
  );
}

/**
 * "Yetkazishga chiqadiganlar": sana (va ixtiyoriy yetkazuvchi) bo'yicha hali yo'lga chiqmagan, yetkazuvchiga
 * biriktirilgan va faol reysga kirmagan BARCHA yetkazmalar — "hammasini tanlash" sahifadagi emas, serverdagi ro'yxat.
 */
export async function outgoingTaskIds(conn: DbOrTx, tenant: TenantContext, filters: { date: string; deliveryAgentId?: string }) {
  const inTrip = conn.select({ taskId: deliveryTripTasks.taskId }).from(deliveryTripTasks).where(and(eq(deliveryTripTasks.companyId, tenant.company.id), eq(deliveryTripTasks.active, true)));
  const rows = await conn
    .select({ id: deliveryTasks.id })
    .from(deliveryTasks)
    .where(
      and(
        eq(deliveryTasks.companyId, tenant.company.id),
        eq(deliveryTasks.scheduledDate, filters.date),
        inArray(deliveryTasks.status, [...TRIP_ELIGIBLE_STATUSES]),
        sql`${deliveryTasks.deliveryAgentId} is not null`,
        filters.deliveryAgentId ? eq(deliveryTasks.deliveryAgentId, filters.deliveryAgentId) : undefined,
        notInArray(deliveryTasks.id, inTrip),
      ),
    )
    .orderBy(asc(deliveryTasks.deliveryAgentId), asc(sql`coalesce(${deliveryTasks.routeOrder}, 2147483647)`), asc(deliveryTasks.number));
  return rows.map((row) => row.id);
}

/** Snapshotdan yig'ma: mahsulot × birlik bo'yicha jami miqdor va summa (float emas — minor birlikda). */
export function aggregateLines(tasks: WaybillTask[]) {
  const map = new Map<string, { productId: string; productName: string; productSku: string | null; unitName: string; quantity: bigint; amount: bigint }>();
  for (const task of tasks) {
    for (const item of task.items) {
      const unitName = item.unitName ?? "—";
      const key = `${item.productId}|${unitName}`;
      const entry = map.get(key) ?? { productId: item.productId, productName: item.productName, productSku: item.productSku, unitName, quantity: 0n, amount: 0n };
      entry.quantity += toMinor(item.quantity, 4);
      entry.amount += toMinor(item.lineTotal);
      map.set(key, entry);
    }
  }
  return [...map.values()]
    .sort((a, b) => a.productName.localeCompare(b.productName))
    .map((row) => ({ ...row, quantity: fromMinor(row.quantity, 4), amount: fromMinor(row.amount) }));
}

/** Tanlangan yetkazmalardan reys(lar): yetkazuvchi × ombor × sana bo'yicha guruhlanadi. */
export async function createTrips(tx: Tx, tenant: TenantContext, input: { taskIds: string[] }, meta: RequestMeta) {
  const companyId = tenant.company.id;
  const ids = [...new Set(input.taskIds)];
  if (ids.length === 0) throw badRequest("Yetkazma tanlanmagan");
  const tasks = await tx
    .select({
      id: deliveryTasks.id,
      number: deliveryTasks.number,
      status: deliveryTasks.status,
      agentId: deliveryTasks.deliveryAgentId,
      warehouseId: deliveryTasks.warehouseId,
      date: deliveryTasks.scheduledDate,
      routeOrder: deliveryTasks.routeOrder,
    })
    .from(deliveryTasks)
    .where(and(eq(deliveryTasks.companyId, companyId), inArray(deliveryTasks.id, ids)))
    .orderBy(asc(deliveryTasks.id))
    .for("update");
  if (tasks.length !== ids.length) throw notFound("Yetkazma topilmadi");
  const invalid = tasks.filter((task) => !(TRIP_ELIGIBLE_STATUSES as readonly string[]).includes(task.status));
  if (invalid.length > 0) throw badRequest(`Yo'lga chiqqan yoki yopilgan yetkazma reysga kirmaydi: ${invalid.map((task) => task.number).join(", ")}`);
  const unassigned = tasks.filter((task) => !task.agentId);
  if (unassigned.length > 0) throw badRequest(`Yetkazuvchiga biriktirilmagan: ${unassigned.map((task) => task.number).join(", ")}`);
  const busy = await tx
    .select({ taskId: deliveryTripTasks.taskId, number: deliveryTrips.number })
    .from(deliveryTripTasks)
    .innerJoin(deliveryTrips, eq(deliveryTrips.id, deliveryTripTasks.tripId))
    .where(and(inArray(deliveryTripTasks.taskId, ids), eq(deliveryTripTasks.active, true)));
  if (busy.length > 0) {
    const numbers = busy.map((row) => `${tasks.find((task) => task.id === row.taskId)?.number} (${row.number})`);
    throw conflict(`Yetkazma allaqachon reysda: ${numbers.join(", ")}`, { reason: "already_in_trip" });
  }

  const groups = new Map<string, typeof tasks>();
  for (const task of tasks) {
    const key = `${task.agentId}|${task.warehouseId}|${task.date}`;
    groups.set(key, [...(groups.get(key) ?? []), task]);
  }

  const created: string[] = [];
  for (const group of groups.values()) {
    const ordered = [...group].sort((a, b) => (a.routeOrder ?? 2_147_483_647) - (b.routeOrder ?? 2_147_483_647) || a.number.localeCompare(b.number));
    // Nakladnoy manbai — W1 dagi yagona funksiya; qarz snapshotga YOZILMAYDI (chop etishda ruxsatga qarab qo'shiladi)
    const data = await deliveryWaybillsByIds(tx, tenant, ordered.map((task) => task.id), false);
    const byId = new Map(data.tasks.map((task) => [task.id, task]));
    const snapshotTasks = ordered.map((task) => byId.get(task.id)).filter((task): task is WaybillTask => Boolean(task));
    if (snapshotTasks.length !== ordered.length) throw badRequest("Yetkazma ma'lumoti to'liq emas — sahifani yangilang");
    const lines = aggregateLines(snapshotTasks);
    if (lines.length === 0) throw badRequest("Reysda mahsulot yo'q");
    const first = snapshotTasks[0]!;
    const totalAmount = snapshotTasks.reduce((sum, task) => sum + toMinor(String(task.taskTotal)), 0n);
    const totalQty = lines.reduce((sum, line) => sum + toMinor(line.quantity, 4), 0n);
    const [agent] = await tx.select({ id: deliveryAgents.id, code: deliveryAgents.code }).from(deliveryAgents).where(eq(deliveryAgents.id, group[0]!.agentId!)).limit(1);
    const [warehouse] = await tx.select({ name: warehouses.name }).from(warehouses).where(eq(warehouses.id, group[0]!.warehouseId)).limit(1);

    const tripDate = group[0]!.date;
    const number = await nextDocumentNumber(tx, {
      table: deliveryTrips,
      column: deliveryTrips.number,
      companyColumn: deliveryTrips.companyId,
      companyId,
      prefix: `RS-${tripDate.slice(0, 4)}-`,
      width: 5,
    });
    const snapshot: TripSnapshot = {
      number,
      tripDate,
      createdAt: new Date().toISOString(),
      warehouse: { id: group[0]!.warehouseId, name: warehouse?.name ?? null },
      agent: { id: agent!.id, code: agent!.code, name: first.agentName, phone: first.agentPhone ?? null },
      tasks: snapshotTasks,
      lines,
      totals: { quantity: fromMinor(totalQty, 4), amount: fromMinor(totalAmount), tasks: snapshotTasks.length },
    };
    const [trip] = await tx
      .insert(deliveryTrips)
      .values({
        companyId,
        number,
        tripDate,
        deliveryAgentId: agent!.id,
        warehouseId: group[0]!.warehouseId,
        snapshot: snapshot as unknown as Record<string, unknown>,
        totalAmount: fromMinor(totalAmount),
        createdBy: tenant.user.id,
      })
      .returning({ id: deliveryTrips.id });
    await tx.insert(deliveryTripTasks).values(ordered.map((task, position) => ({ tripId: trip!.id, taskId: task.id, companyId, position })));
    await tx.insert(deliveryTripLines).values(
      lines.map((line) => ({
        companyId,
        tripId: trip!.id,
        productId: line.productId,
        productName: line.productName,
        productSku: line.productSku,
        unitName: line.unitName,
        requiredQty: line.quantity,
      })),
    );
    await audit(tx, tenant, meta, "DELIVERY_TRIP_CREATED", trip!.id, { number, tasks: ordered.map((task) => task.number), totalAmount: fromMinor(totalAmount) });
    created.push(trip!.id);
  }
  const trips = [];
  for (const id of created) trips.push(await getTrip(tx, tenant, id, false));
  return trips;
}

export async function getTrip(conn: DbOrTx, tenant: TenantContext, tripId: string, canViewDebt: boolean) {
  const [trip] = await conn
    .select({
      id: deliveryTrips.id,
      number: deliveryTrips.number,
      tripDate: deliveryTrips.tripDate,
      status: deliveryTrips.status,
      deliveryAgentId: deliveryTrips.deliveryAgentId,
      warehouseId: deliveryTrips.warehouseId,
      totalAmount: deliveryTrips.totalAmount,
      snapshot: deliveryTrips.snapshot,
      createdAt: deliveryTrips.createdAt,
      createdByName: users.name,
      loadedAt: deliveryTrips.loadedAt,
      outAt: deliveryTrips.outAt,
      cancelledAt: deliveryTrips.cancelledAt,
      cancelReason: deliveryTrips.cancelReason,
    })
    .from(deliveryTrips)
    .leftJoin(users, eq(users.id, deliveryTrips.createdBy))
    .where(and(eq(deliveryTrips.id, tripId), eq(deliveryTrips.companyId, tenant.company.id)))
    .limit(1);
  if (!trip) throw notFound("Reys topilmadi");
  const lines = await conn
    .select()
    .from(deliveryTripLines)
    .where(eq(deliveryTripLines.tripId, trip.id))
    .orderBy(asc(deliveryTripLines.productName), asc(deliveryTripLines.unitName));
  const snapshot = trip.snapshot as unknown as TripSnapshot;
  // Qarz snapshotda yo'q; chop etishda ruxsat bo'lsa — joriy qarz (maxfiy ma'lumot ruxsatsiz chiqmaydi)
  if (canViewDebt) {
    const debts = await deliveryWaybillsByIds(conn, tenant, snapshot.tasks.map((task) => task.id), true).catch(() => ({ tasks: [] }));
    const debtById = new Map(debts.tasks.map((task) => [task.id, task.customerDebt]));
    snapshot.tasks = snapshot.tasks.map((task) => ({ ...task, customerDebt: debtById.get(task.id) ?? null }));
  }
  return { ...trip, snapshot, lines };
}

export async function listTrips(conn: DbOrTx, tenant: TenantContext, filters: { date?: string; limit: number }) {
  return conn
    .select({
      id: deliveryTrips.id,
      number: deliveryTrips.number,
      tripDate: deliveryTrips.tripDate,
      status: deliveryTrips.status,
      totalAmount: deliveryTrips.totalAmount,
      agentName: sql<string | null>`${deliveryTrips.snapshot} -> 'agent' ->> 'name'`,
      tasks: sql<number>`(${deliveryTrips.snapshot} -> 'totals' ->> 'tasks')::int`,
      warehouseName: warehouses.name,
      createdAt: deliveryTrips.createdAt,
    })
    .from(deliveryTrips)
    .leftJoin(warehouses, eq(warehouses.id, deliveryTrips.warehouseId))
    .where(and(eq(deliveryTrips.companyId, tenant.company.id), filters.date ? eq(deliveryTrips.tripDate, filters.date) : undefined))
    .orderBy(desc(deliveryTrips.tripDate), desc(deliveryTrips.createdAt))
    .limit(filters.limit);
}

async function lockTrip(tx: Tx, tenant: TenantContext, tripId: string) {
  const [trip] = await tx
    .select()
    .from(deliveryTrips)
    .where(and(eq(deliveryTrips.id, tripId), eq(deliveryTrips.companyId, tenant.company.id)))
    .limit(1)
    .for("update");
  if (!trip) throw notFound("Reys topilmadi");
  return trip;
}

/** Omborchi terdi: har qator uchun terilgan miqdor → holat (to'liq / qisman / yo'q). Zaxira o'zgarmaydi. */
export async function recordPicking(
  tx: Tx,
  tenant: TenantContext,
  tripId: string,
  input: { lines: { lineId: string; pickedQty: string; note?: string | null }[] },
  meta: RequestMeta,
) {
  const trip = await lockTrip(tx, tenant, tripId);
  if (trip.status !== "picking") throw badRequest("Terish faqat yuklashdan oldin");
  const current = await tx.select().from(deliveryTripLines).where(eq(deliveryTripLines.tripId, trip.id)).for("update");
  for (const row of input.lines) {
    const line = current.find((item) => item.id === row.lineId);
    if (!line) throw notFound("Reys qatori topilmadi");
    const picked = toMinor(row.pickedQty, 4);
    const required = toMinor(line.requiredQty, 4);
    if (picked < 0n || picked > required) throw badRequest(`${line.productName}: 0 dan ${fromMinor(required, 4)} gacha`);
    const status = picked === required ? "picked" : picked === 0n ? "missing" : "partially_picked";
    await tx
      .update(deliveryTripLines)
      .set({ pickedQty: fromMinor(picked, 4), pickStatus: status, note: row.note?.trim() || null, updatedBy: tenant.user.id, updatedAt: new Date() })
      .where(eq(deliveryTripLines.id, line.id));
  }
  await audit(tx, tenant, meta, "DELIVERY_TRIP_PICKED", trip.id, { number: trip.number, lines: input.lines });
  return getTrip(tx, tenant, trip.id, false);
}

/** Yuklandi: hamma qator terilgan (yoki yo'qligi qayd etilgan) bo'lishi kerak. */
export async function loadTrip(tx: Tx, tenant: TenantContext, tripId: string, meta: RequestMeta) {
  const trip = await lockTrip(tx, tenant, tripId);
  if (trip.status !== "picking") throw badRequest("Reys yuklash holatida emas");
  const pending = await tx.select({ name: deliveryTripLines.productName }).from(deliveryTripLines).where(and(eq(deliveryTripLines.tripId, trip.id), eq(deliveryTripLines.pickStatus, "pending")));
  if (pending.length > 0) throw badRequest(`Terilmagan mahsulotlar bor: ${pending.map((row) => row.name).join(", ")}`);
  await tx.update(deliveryTrips).set({ status: "loaded", loadedBy: tenant.user.id, loadedAt: new Date(), updatedAt: new Date() }).where(eq(deliveryTrips.id, trip.id));
  await audit(tx, tenant, meta, "DELIVERY_TRIP_LOADED", trip.id, { number: trip.number });
  return getTrip(tx, tenant, trip.id, false);
}

/** Yo'lga chiqdi (belgi): yetkazmalarning o'zi yetkazuvchi "boshlash"ini bosganda boshlanadi — ombor/pul shu yerda emas. */
export async function markTripOut(tx: Tx, tenant: TenantContext, tripId: string, meta: RequestMeta) {
  const trip = await lockTrip(tx, tenant, tripId);
  if (trip.status !== "loaded") throw badRequest("Avval reys yuklanishi kerak");
  await tx.update(deliveryTrips).set({ status: "out_for_delivery", outAt: new Date(), updatedAt: new Date() }).where(eq(deliveryTrips.id, trip.id));
  await audit(tx, tenant, meta, "DELIVERY_TRIP_OUT", trip.id, { number: trip.number });
  return getTrip(tx, tenant, trip.id, false);
}

/** Bekor qilish (yo'lga chiqquncha): yetkazmalar bo'shaydi, reys va snapshot tarixda qoladi. */
export async function cancelTrip(tx: Tx, tenant: TenantContext, tripId: string, reason: string, meta: RequestMeta) {
  const trip = await lockTrip(tx, tenant, tripId);
  if (trip.status === "cancelled") throw conflict("Reys allaqachon bekor qilingan");
  if (trip.status === "out_for_delivery") throw badRequest("Yo'lga chiqqan reys bekor qilinmaydi — yetkazmalar o'z oqimida yopiladi");
  await tx.update(deliveryTripTasks).set({ active: false }).where(eq(deliveryTripTasks.tripId, trip.id));
  await tx.update(deliveryTrips).set({ status: "cancelled", cancelledAt: new Date(), cancelReason: reason.trim(), updatedAt: new Date() }).where(eq(deliveryTrips.id, trip.id));
  await audit(tx, tenant, meta, "DELIVERY_TRIP_CANCELLED", trip.id, { number: trip.number, reason });
  return getTrip(tx, tenant, trip.id, false);
}

