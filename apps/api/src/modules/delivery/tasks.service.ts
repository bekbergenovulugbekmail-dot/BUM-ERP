/**
 * Yetkazma vazifalari (boshqaruv): yaratish (qo'lda yoki buyurtma tasdiqlanganda avtomatik), biriktirish, boshqa agentga
 * o'tkazish, qayta rejalash, bekor qilish, ustuvorlik va izohlar, yetkazish tartibi, ro'yxat (server filtrlari va
 * sahifalash) va tafsilot. Buyurtmaning o'zi (miqdor, narx, holat) bu yerda o'zgartirilmaydi — ORDER ≠ DELIVERY.
 */
import { and, asc, desc, eq, ilike, inArray, isNotNull, isNull, lt, max, notExists, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  AppError,
  OPEN_DELIVERY_STATUSES,
  badRequest,
  forbidden,
  notFound,
  type DeliveryPaymentType,
  type DeliveryPriority,
  type DeliveryStatus,
} from "@bum/shared";
import { products, units } from "../../db/schema/catalog.js";
import { deliveryAgents, deliveryEvents, deliveryPayments, deliveryProofs, deliveryTaskItems, deliveryTasks } from "../../db/schema/delivery.js";
import { users } from "../../db/schema/platform.js";
import { customers, salesOrderItems, salesOrders, salesReturns } from "../../db/schema/sales.js";
import { agentOrders } from "../../db/schema/sales-agent.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import type { RequestMeta } from "../../shared/audit.js";
import { fromMinor, mulDivRound, toMinor } from "../../shared/decimal.js";
import { nextDocumentNumber } from "../../shared/numbering.js";
import type { TenantContext } from "../company/tenant.js";
import { getDeliveryPolicy } from "./policy.service.js";
import { applyAutoAssign } from "./auto-assign.service.js";
import { publishDeliveryEvent } from "./realtime-bus.js";
import { assertTransition, deliveryAudit, hhmm, insertDeliveryEvent, localDate, localTime, lockTask, type DeliveryTaskRow } from "./task.repo.js";

const OPEN: DeliveryStatus[] = [...OPEN_DELIVERY_STATUSES];
/** Yo'lga chiqquncha — to'lov turi, summa va vaqt oynasi o'zgartiriladi. */
const BEFORE_ROUTE: DeliveryStatus[] = ["ready", "assigned", "accepted"];
const RESCHEDULABLE: DeliveryStatus[] = ["ready", "assigned", "accepted", "failed"];

const likePattern = (value: string) => `%${value.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

function assertWindow(start: string | null | undefined, end: string | null | undefined) {
  if ((start ?? null) === null !== ((end ?? null) === null)) throw badRequest("Vaqt oynasining boshlanishi va tugashi birga beriladi");
  if (start && end && start >= end) throw badRequest("Vaqt oynasi noto'g'ri: boshlanish tugashdan oldin bo'lsin");
}

function assertNotPast(date: string) {
  if (date < localDate()) throw badRequest("Yetkazish sanasi o'tgan kun bo'lmasin", { reason: "date_in_past" });
}

/** Buyurtmaning yig'ilmagan qoldig'i: jami − qaytarilgan − to'langan (manfiy bo'lmaydi). */
export async function orderOutstanding(conn: DbOrTx, order: { id: string; totalAmount: string; paidAmount: string }) {
  const [returned] = await conn
    .select({ total: sql<string>`coalesce(sum(${salesReturns.totalAmount}), 0)::numeric(18,2)` })
    .from(salesReturns)
    .where(eq(salesReturns.orderId, order.id));
  const value = toMinor(order.totalAmount) - toMinor(returned!.total) - toMinor(order.paidAmount);
  return value > 0n ? value : 0n;
}

async function nextRouteOrder(tx: Tx, deliveryAgentId: string, date: string) {
  const [row] = await tx
    .select({ last: max(deliveryTasks.routeOrder) })
    .from(deliveryTasks)
    .where(and(eq(deliveryTasks.deliveryAgentId, deliveryAgentId), eq(deliveryTasks.scheduledDate, date), inArray(deliveryTasks.status, OPEN)));
  return (row?.last ?? 0) + 1;
}

/** Qayta rejalashda eski urinishning geofence, OTP va xato maydonlari tozalanadi (tarix — hodisalarda). */
const REPLAN_RESET = {
  failedAt: null,
  failureReason: null,
  failureComment: null,
  arrivedAt: null,
  deliveringAt: null,
  arrivalLatitude: null,
  arrivalLongitude: null,
  arrivalAccuracy: null,
  arrivalDistanceMeters: null,
  otpHash: null,
  otpExpiresAt: null,
  otpAttempts: 0,
} as const;

// ─── Yaratish ────────────────────────────────────────────────────────────────

export type DeliveryTaskInput = {
  orderId: string;
  scheduledDate?: string;
  windowStart?: string | null;
  windowEnd?: string | null;
  priority?: DeliveryPriority;
  paymentType?: DeliveryPaymentType;
  expectedAmount?: string;
  deliveryNote?: string | null;
  supervisorNote?: string | null;
  deliveryAgentId?: string | null;
  routeOrder?: number | null;
};

export async function createDeliveryTask(
  tx: Tx,
  tenant: TenantContext,
  input: DeliveryTaskInput,
  meta: RequestMeta,
  source: "manual" | "auto" = "manual",
  options: { allowAssign?: boolean } = {},
): Promise<string> {
  const companyId = tenant.company.id;
  const [order] = await tx
    .select({
      id: salesOrders.id,
      number: salesOrders.number,
      status: salesOrders.status,
      isPos: salesOrders.isPos,
      customerId: salesOrders.customerId,
      warehouseId: salesOrders.warehouseId,
      totalAmount: salesOrders.totalAmount,
      paidAmount: salesOrders.paidAmount,
      deliveryDate: salesOrders.deliveryDate,
      notes: salesOrders.notes,
    })
    .from(salesOrders)
    .where(and(eq(salesOrders.id, input.orderId), eq(salesOrders.companyId, companyId)))
    .limit(1)
    .for("update");
  if (!order) throw notFound("Buyurtma topilmadi");
  if (order.isPos) throw badRequest("Kassa chekiga yetkazma yaratilmaydi");
  if (!order.customerId) throw badRequest("Yetkazish uchun buyurtmada mijoz bo'lishi kerak");
  if (order.status !== "confirmed" && order.status !== "shipped" && order.status !== "delivered") {
    throw badRequest("Faqat tasdiqlangan buyurtma yetkaziladi");
  }
  const [open] = await tx
    .select({ id: deliveryTasks.id, number: deliveryTasks.number })
    .from(deliveryTasks)
    .where(and(eq(deliveryTasks.orderId, order.id), inArray(deliveryTasks.status, OPEN)))
    .limit(1);
  if (open) throw new AppError("CONFLICT", `Buyurtmada yakunlanmagan yetkazma bor (${open.number})`, { reason: "task_exists", taskId: open.id });

  const orderItems = await tx
    .select({ id: salesOrderItems.id, productId: salesOrderItems.productId, quantity: salesOrderItems.quantity, returnedQty: salesOrderItems.returnedQty })
    .from(salesOrderItems)
    .where(eq(salesOrderItems.orderId, order.id));
  const plannable = orderItems
    .map((item) => ({ ...item, remaining: toMinor(item.quantity, 4) - toMinor(item.returnedQty, 4) }))
    .filter((item) => item.remaining > 0n);
  if (plannable.length === 0) throw badRequest("Buyurtmada yetkaziladigan mahsulot qolmagan");

  const policy = await getDeliveryPolicy(tx, companyId);
  const [agentOrder] = await tx.select({ paymentType: agentOrders.paymentType }).from(agentOrders).where(eq(agentOrders.orderId, order.id)).limit(1);
  const paymentType: DeliveryPaymentType =
    input.paymentType ?? (agentOrder ? agentOrder.paymentType : policy.collectOnDelivery ? "cash" : "credit");
  const outstanding = await orderOutstanding(tx, order);
  let expected = paymentType === "credit" ? 0n : outstanding;
  if (input.expectedAmount !== undefined) {
    expected = toMinor(input.expectedAmount);
    if (expected > outstanding) throw badRequest(`Yig'iladigan summa buyurtma qoldig'idan ortiq (qoldiq ${fromMinor(outstanding)})`);
  }

  const today = localDate();
  const scheduledDate = input.scheduledDate ?? (order.deliveryDate && order.deliveryDate > today ? order.deliveryDate : today);
  if (input.scheduledDate) assertNotPast(input.scheduledDate);
  assertWindow(input.windowStart, input.windowEnd);

  const number = await nextDocumentNumber(tx, {
    table: deliveryTasks,
    column: deliveryTasks.number,
    companyColumn: deliveryTasks.companyId,
    companyId,
    prefix: `DL-${today.slice(0, 4)}-`,
    width: 4,
  });
  const [task] = await tx
    .insert(deliveryTasks)
    .values({
      companyId,
      number,
      orderId: order.id,
      customerId: order.customerId,
      warehouseId: order.warehouseId,
      status: "ready",
      priority: input.priority ?? "normal",
      scheduledDate,
      windowStart: input.windowStart ?? null,
      windowEnd: input.windowEnd ?? null,
      paymentType,
      expectedAmount: fromMinor(expected),
      paymentStatus: expected > 0n ? "pending" : "not_required",
      customerNote: order.notes,
      deliveryNote: input.deliveryNote ?? null,
      supervisorNote: input.supervisorNote ?? null,
      createdBy: tenant.user.id,
    })
    .returning();
  await tx.insert(deliveryTaskItems).values(
    plannable.map((item) => ({ taskId: task!.id, orderItemId: item.id, productId: item.productId, quantity: fromMinor(item.remaining, 4) })),
  );
  await insertDeliveryEvent(tx, task!, { action: "CREATED", toStatus: "ready", actorUserId: tenant.user.id, details: { source, orderNumber: order.number } });
  await deliveryAudit(tx, tenant, meta, "DELIVERY_TASK_CREATED", task!.id, {
    number,
    orderId: order.id,
    orderNumber: order.number,
    source,
    paymentType,
    expectedAmount: fromMinor(expected),
  });
  if (input.deliveryAgentId) {
    if (options.allowAssign === false) throw forbidden("Agentga biriktirish uchun ruxsat kerak (delivery.assign)");
    await assignDeliveryTask(tx, tenant, task!.id, { deliveryAgentId: input.deliveryAgentId, routeOrder: input.routeOrder ?? null }, meta, { allowReassign: false });
  } else if (policy.autoAssign.enabled && policy.autoAssign.onCreate && scheduledDate >= today) {
    // Siyosat bo'yicha darhol avtomatik biriktirish; mos agent bo'lmasa yetkazma "tayyor" qoladi (xato emas)
    await applyAutoAssign(tx, tenant, policy, { date: scheduledDate, taskIds: [task!.id] }, meta, "on_create");
  }
  return task!.id;
}

/**
 * Buyurtma tasdiqlanganda: buyurtmada "yetkazish kerak" belgilangan bo'lsa (bo'lmasa — siyosatdagi standart) va
 * mijozli, kassa cheki emas, ochiq yetkazmasi yo'q — yetkazma yaratiladi. Takror chaqirilsa ikkinchisi yaratilmaydi.
 */
export async function autoCreateDeliveryTask(tx: Tx, tenant: TenantContext, orderId: string, meta: RequestMeta) {
  const [order] = await tx
    .select({ deliveryRequired: salesOrders.deliveryRequired, isPos: salesOrders.isPos, customerId: salesOrders.customerId, status: salesOrders.status })
    .from(salesOrders)
    .where(and(eq(salesOrders.id, orderId), eq(salesOrders.companyId, tenant.company.id)))
    .limit(1);
  if (!order || order.isPos || !order.customerId || order.status !== "confirmed") return null;
  const policy = await getDeliveryPolicy(tx, tenant.company.id);
  if (!(order.deliveryRequired ?? policy.deliveryRequiredByDefault)) return null;
  const [open] = await tx
    .select({ id: deliveryTasks.id })
    .from(deliveryTasks)
    .where(and(eq(deliveryTasks.orderId, orderId), inArray(deliveryTasks.status, OPEN)))
    .limit(1);
  if (open) return null;
  return createDeliveryTask(tx, tenant, { orderId }, meta, "auto");
}

// ─── Biriktirish, qayta rejalash, bekor qilish ───────────────────────────────

export async function assignDeliveryTask(
  tx: Tx,
  tenant: TenantContext,
  taskId: string,
  input: { deliveryAgentId: string; scheduledDate?: string; routeOrder?: number | null },
  meta: RequestMeta,
  options: {
    allowReassign: boolean;
    /** Avtomatik biriktirish (hodisa va auditda belgilanadi). */
    auto?: { strategy: import("@bum/shared").DeliveryAutoAssignStrategy; trigger: "manual" | "on_create"; distanceMeters: number | null };
  },
) {
  const companyId = tenant.company.id;
  const task = await lockTask(tx, companyId, taskId);
  const [agent] = await tx
    .select({ id: deliveryAgents.id, isActive: deliveryAgents.isActive })
    .from(deliveryAgents)
    .where(and(eq(deliveryAgents.id, input.deliveryAgentId), eq(deliveryAgents.companyId, companyId)))
    .limit(1);
  if (!agent) throw badRequest("Yetkazuvchi agent topilmadi");
  if (!agent.isActive) throw badRequest("Yetkazuvchi agent faol emas");

  const changesAgent = task.deliveryAgentId !== null && task.deliveryAgentId !== agent.id;
  if (changesAgent && !options.allowReassign) throw forbidden("Boshqa agentga o'tkazish uchun ruxsat kerak (delivery.reassign)");
  assertTransition(task.status, "assigned");
  if (input.scheduledDate) assertNotPast(input.scheduledDate);
  const scheduledDate = input.scheduledDate ?? task.scheduledDate;
  const keepsSlot = !changesAgent && task.deliveryAgentId === agent.id && scheduledDate === task.scheduledDate && task.routeOrder !== null;
  const routeOrder = input.routeOrder ?? (keepsSlot ? task.routeOrder : await nextRouteOrder(tx, agent.id, scheduledDate));

  const now = new Date();
  await tx
    .update(deliveryTasks)
    .set({
      deliveryAgentId: agent.id,
      status: "assigned",
      scheduledDate,
      routeOrder,
      assignedBy: tenant.user.id,
      assignedAt: now,
      acceptedAt: null,
      ...(task.status === "failed" ? REPLAN_RESET : {}),
      updatedAt: now,
    })
    .where(eq(deliveryTasks.id, task.id));
  const action = changesAgent ? "REASSIGNED" : "ASSIGNED";
  const details = { fromAgentId: task.deliveryAgentId, toAgentId: agent.id, scheduledDate, routeOrder, ...(options.auto ? { auto: options.auto } : {}) };
  await insertDeliveryEvent(tx, task, { action, fromStatus: task.status, toStatus: "assigned", actorUserId: tenant.user.id, details });
  const auditAction = options.auto ? "DELIVERY_AUTO_ASSIGNED" : changesAgent ? "DELIVERY_REASSIGNED" : "DELIVERY_ASSIGNED";
  await deliveryAudit(tx, tenant, meta, auditAction, task.id, { number: task.number, ...details });
}

export async function unassignDeliveryTask(tx: Tx, tenant: TenantContext, taskId: string, meta: RequestMeta) {
  const task = await lockTask(tx, tenant.company.id, taskId);
  if (!task.deliveryAgentId) throw new AppError("CONFLICT", "Yetkazma agentga biriktirilmagan", { reason: "not_assigned" });
  assertTransition(task.status, "ready");
  const now = new Date();
  await tx
    .update(deliveryTasks)
    .set({
      deliveryAgentId: null,
      routeOrder: null,
      status: "ready",
      assignedAt: null,
      acceptedAt: null,
      ...(task.status === "failed" ? REPLAN_RESET : {}),
      updatedAt: now,
    })
    .where(eq(deliveryTasks.id, task.id));
  await insertDeliveryEvent(tx, task, { action: "UNASSIGNED", fromStatus: task.status, toStatus: "ready", actorUserId: tenant.user.id, details: { fromAgentId: task.deliveryAgentId } });
  await deliveryAudit(tx, tenant, meta, "DELIVERY_UNASSIGNED", task.id, { number: task.number, fromAgentId: task.deliveryAgentId });
}

export async function rescheduleDeliveryTask(
  tx: Tx,
  tenant: TenantContext,
  taskId: string,
  input: { scheduledDate: string; windowStart?: string | null; windowEnd?: string | null; reason?: string | null },
  meta: RequestMeta,
) {
  const task = await lockTask(tx, tenant.company.id, taskId);
  if (!RESCHEDULABLE.includes(task.status)) {
    throw new AppError("CONFLICT", "Yo'ldagi yoki yakunlangan yetkazma qayta rejalanmaydi", { reason: "invalid_transition", from: task.status });
  }
  assertNotPast(input.scheduledDate);
  const windowStart = input.windowStart !== undefined ? input.windowStart : hhmm(task.windowStart);
  const windowEnd = input.windowEnd !== undefined ? input.windowEnd : hhmm(task.windowEnd);
  assertWindow(windowStart, windowEnd);

  // Qabul qilingan yoki yetkazilmagan yetkazma yangi kunga — agent qayta qabul qiladi
  const status: DeliveryStatus = task.status === "accepted" || task.status === "failed" ? (task.deliveryAgentId ? "assigned" : "ready") : task.status;
  if (status !== task.status) assertTransition(task.status, status);
  const dateChanged = input.scheduledDate !== task.scheduledDate;
  const routeOrder = task.deliveryAgentId && dateChanged ? await nextRouteOrder(tx, task.deliveryAgentId, input.scheduledDate) : task.routeOrder;
  const now = new Date();
  await tx
    .update(deliveryTasks)
    .set({
      scheduledDate: input.scheduledDate,
      windowStart,
      windowEnd,
      routeOrder,
      status,
      ...(status !== task.status ? { acceptedAt: null } : {}),
      ...(task.status === "failed" ? REPLAN_RESET : {}),
      updatedAt: now,
    })
    .where(eq(deliveryTasks.id, task.id));
  const details = {
    from: { scheduledDate: task.scheduledDate, windowStart: hhmm(task.windowStart), windowEnd: hhmm(task.windowEnd) },
    to: { scheduledDate: input.scheduledDate, windowStart, windowEnd },
  };
  await insertDeliveryEvent(tx, task, {
    action: "RESCHEDULED",
    fromStatus: task.status,
    toStatus: status,
    actorUserId: tenant.user.id,
    note: input.reason ?? null,
    details,
  });
  await deliveryAudit(tx, tenant, meta, "DELIVERY_RESCHEDULED", task.id, { number: task.number, ...details, reason: input.reason ?? null });
}

export async function cancelDeliveryTask(tx: Tx, tenant: TenantContext, taskId: string, reason: string, meta: RequestMeta) {
  const task = await lockTask(tx, tenant.company.id, taskId);
  assertTransition(task.status, "cancelled");
  const now = new Date();
  await tx
    .update(deliveryTasks)
    .set({ status: "cancelled", cancelledAt: now, cancelReason: reason, updatedAt: now })
    .where(eq(deliveryTasks.id, task.id));
  await insertDeliveryEvent(tx, task, { action: "CANCELLED", fromStatus: task.status, toStatus: "cancelled", actorUserId: tenant.user.id, note: reason });
  await deliveryAudit(tx, tenant, meta, "DELIVERY_CANCELLED", task.id, { number: task.number, reason, agentId: task.deliveryAgentId }, "warning");
}

export type DeliveryTaskPatch = {
  priority?: DeliveryPriority;
  deliveryNote?: string | null;
  supervisorNote?: string | null;
  paymentType?: DeliveryPaymentType;
  expectedAmount?: string;
  windowStart?: string | null;
  windowEnd?: string | null;
};

export async function updateDeliveryTask(tx: Tx, tenant: TenantContext, taskId: string, patch: DeliveryTaskPatch, meta: RequestMeta) {
  const task = await lockTask(tx, tenant.company.id, taskId);
  if (!OPEN.includes(task.status)) throw new AppError("CONFLICT", "Yakunlangan yetkazma o'zgartirilmaydi", { reason: "invalid_transition", from: task.status });
  const planning = patch.paymentType !== undefined || patch.expectedAmount !== undefined || patch.windowStart !== undefined || patch.windowEnd !== undefined;
  if (planning && !BEFORE_ROUTE.includes(task.status)) {
    throw new AppError("CONFLICT", "Yo'ldagi yetkazmada to'lov summasi va vaqt oynasi o'zgarmaydi", { reason: "on_route" });
  }

  const set: Partial<typeof deliveryTasks.$inferInsert> = {};
  if (patch.priority !== undefined) set.priority = patch.priority;
  if (patch.deliveryNote !== undefined) set.deliveryNote = patch.deliveryNote;
  if (patch.supervisorNote !== undefined) set.supervisorNote = patch.supervisorNote;
  if (patch.windowStart !== undefined || patch.windowEnd !== undefined) {
    const windowStart = patch.windowStart !== undefined ? patch.windowStart : hhmm(task.windowStart);
    const windowEnd = patch.windowEnd !== undefined ? patch.windowEnd : hhmm(task.windowEnd);
    assertWindow(windowStart, windowEnd);
    set.windowStart = windowStart;
    set.windowEnd = windowEnd;
  }
  if (patch.paymentType !== undefined || patch.expectedAmount !== undefined) {
    const [order] = await tx
      .select({ id: salesOrders.id, totalAmount: salesOrders.totalAmount, paidAmount: salesOrders.paidAmount })
      .from(salesOrders)
      .where(eq(salesOrders.id, task.orderId))
      .limit(1);
    const outstanding = await orderOutstanding(tx, order!);
    const paymentType = patch.paymentType ?? task.paymentType;
    let expected = patch.expectedAmount !== undefined ? toMinor(patch.expectedAmount) : paymentType === "credit" ? 0n : outstanding;
    if (expected > outstanding) throw badRequest(`Yig'iladigan summa buyurtma qoldig'idan ortiq (qoldiq ${fromMinor(outstanding)})`);
    if (paymentType === "credit" && patch.expectedAmount === undefined) expected = 0n;
    set.paymentType = paymentType;
    set.expectedAmount = fromMinor(expected);
    set.paymentStatus = expected > 0n ? "pending" : "not_required";
  }
  await tx.update(deliveryTasks).set({ ...set, updatedAt: new Date() }).where(eq(deliveryTasks.id, task.id));
  // Izoh matni hodisaga yozilmaydi (ichki izoh agentga ko'rinmasin)
  const changes = Object.keys(patch);
  await insertDeliveryEvent(tx, task, { action: "UPDATED", actorUserId: tenant.user.id, details: { changes } });
  await deliveryAudit(tx, tenant, meta, "DELIVERY_TASK_UPDATED", task.id, { number: task.number, changes });
}

/** Agentning kunlik yetkazish tartibi: berilgan ro'yxat tartibida 1, 2, 3 … */
export async function setDeliveryRouteOrder(
  tx: Tx,
  tenant: TenantContext,
  input: { deliveryAgentId: string; date: string; taskIds: string[] },
  meta: RequestMeta,
) {
  if (new Set(input.taskIds).size !== input.taskIds.length) throw badRequest("Yetkazma takrorlangan");
  const rows = await tx
    .select({ id: deliveryTasks.id, status: deliveryTasks.status })
    .from(deliveryTasks)
    .where(
      and(
        eq(deliveryTasks.companyId, tenant.company.id),
        eq(deliveryTasks.deliveryAgentId, input.deliveryAgentId),
        eq(deliveryTasks.scheduledDate, input.date),
        inArray(deliveryTasks.id, input.taskIds),
      ),
    )
    .for("update");
  if (rows.length !== input.taskIds.length) throw badRequest("Yetkazma topilmadi yoki boshqa agent yoki kunga tegishli");
  if (rows.some((row) => !OPEN.includes(row.status))) throw badRequest("Yakunlangan yetkazma tartibi o'zgarmaydi");
  for (const [index, id] of input.taskIds.entries()) {
    await tx.update(deliveryTasks).set({ routeOrder: index + 1, updatedAt: new Date() }).where(eq(deliveryTasks.id, id));
    const status = rows.find((row) => row.id === id)!.status;
    await publishDeliveryEvent(tx, { type: "task", companyId: tenant.company.id, taskId: id, agentIds: [input.deliveryAgentId], status, action: "ROUTE_ORDER" });
  }
  await deliveryAudit(tx, tenant, meta, "DELIVERY_ROUTE_ORDER", input.taskIds[0]!, { deliveryAgentId: input.deliveryAgentId, date: input.date, taskIds: input.taskIds });
}

// ─── Ro'yxat va tafsilot ─────────────────────────────────────────────────────

const agentUser = alias(users, "delivery_agent_user");

export const taskListFields = {
  id: deliveryTasks.id,
  number: deliveryTasks.number,
  status: deliveryTasks.status,
  priority: deliveryTasks.priority,
  scheduledDate: deliveryTasks.scheduledDate,
  windowStart: deliveryTasks.windowStart,
  windowEnd: deliveryTasks.windowEnd,
  routeOrder: deliveryTasks.routeOrder,
  paymentType: deliveryTasks.paymentType,
  expectedAmount: deliveryTasks.expectedAmount,
  collectedAmount: deliveryTasks.collectedAmount,
  paymentStatus: deliveryTasks.paymentStatus,
  paymentReview: deliveryTasks.paymentReview,
  failureReason: deliveryTasks.failureReason,
  deliveryAgentId: deliveryTasks.deliveryAgentId,
  agentCode: deliveryAgents.code,
  agentName: agentUser.name,
  orderId: deliveryTasks.orderId,
  orderNumber: salesOrders.number,
  orderTotal: salesOrders.totalAmount,
  customerId: deliveryTasks.customerId,
  customerName: customers.name,
  customerPhone: customers.phone,
  customerAddress: customers.address,
  customerLatitude: customers.latitude,
  customerLongitude: customers.longitude,
  customerCity: customers.city,
  customerDistrict: customers.district,
  assignedAt: deliveryTasks.assignedAt,
  startedAt: deliveryTasks.startedAt,
  arrivedAt: deliveryTasks.arrivedAt,
  deliveredAt: deliveryTasks.deliveredAt,
  failedAt: deliveryTasks.failedAt,
  returnedAt: deliveryTasks.returnedAt,
  createdAt: deliveryTasks.createdAt,
};

export function taskListQuery(conn: DbOrTx) {
  return conn
    .select(taskListFields)
    .from(deliveryTasks)
    .innerJoin(salesOrders, eq(salesOrders.id, deliveryTasks.orderId))
    .innerJoin(customers, eq(customers.id, deliveryTasks.customerId))
    .leftJoin(deliveryAgents, eq(deliveryAgents.id, deliveryTasks.deliveryAgentId))
    .leftJoin(agentUser, eq(agentUser.id, deliveryAgents.userId));
}

type ListRow = Awaited<ReturnType<ReturnType<typeof taskListQuery>["execute"]>>[number];

/** Kechikkan: ochiq va rejalangan kun o'tgan yoki bugun vaqt oynasi tugagan. */
export function isOverdue(row: { status: DeliveryStatus; scheduledDate: string; windowEnd: string | null }, now = new Date()) {
  if (!OPEN.includes(row.status)) return false;
  const today = localDate(now);
  return row.scheduledDate < today || (row.scheduledDate === today && row.windowEnd !== null && hhmm(row.windowEnd)! < localTime(now));
}

export function overdueCondition(now = new Date()): SQL {
  const today = localDate(now);
  return and(
    inArray(deliveryTasks.status, OPEN),
    or(
      lt(deliveryTasks.scheduledDate, today),
      and(eq(deliveryTasks.scheduledDate, today), isNotNull(deliveryTasks.windowEnd), sql`${deliveryTasks.windowEnd} < ${localTime(now)}::time`),
    ),
  )!;
}

export const presentTask = <T extends ListRow>(row: T) => ({
  ...row,
  windowStart: hhmm(row.windowStart),
  windowEnd: hhmm(row.windowEnd),
  overdue: isOverdue(row),
});

export type DeliveryTaskFilters = {
  dateFrom?: string;
  dateTo?: string;
  statuses?: DeliveryStatus[];
  deliveryAgentId?: string;
  unassigned?: boolean;
  branchId?: string;
  territory?: string;
  customerId?: string;
  search?: string;
  overdue?: boolean;
  reviewPending?: boolean;
  limit: number;
  cursor?: string;
};

type Cursor = { d: string; c: string; i: string };
const encodeTaskCursor = (row: { scheduledDate: string; createdAt: Date; id: string }) =>
  Buffer.from(JSON.stringify({ d: row.scheduledDate, c: row.createdAt.toISOString(), i: row.id } satisfies Cursor)).toString("base64url");
function decodeTaskCursor(value: string): Cursor {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Cursor;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(parsed.d) || Number.isNaN(Date.parse(parsed.c)) || !/^[0-9a-f-]{36}$/i.test(parsed.i)) throw new Error("cursor");
    return parsed;
  } catch {
    throw badRequest("Sahifa kursori noto'g'ri");
  }
}

export async function listDeliveryTasks(conn: DbOrTx, tenant: TenantContext, filters: DeliveryTaskFilters) {
  const conditions: (SQL | undefined)[] = [eq(deliveryTasks.companyId, tenant.company.id)];
  if (filters.dateFrom) conditions.push(sql`${deliveryTasks.scheduledDate} >= ${filters.dateFrom}::date`);
  if (filters.dateTo) conditions.push(sql`${deliveryTasks.scheduledDate} <= ${filters.dateTo}::date`);
  if (filters.statuses?.length) conditions.push(inArray(deliveryTasks.status, filters.statuses));
  if (filters.deliveryAgentId) conditions.push(eq(deliveryTasks.deliveryAgentId, filters.deliveryAgentId));
  if (filters.unassigned) conditions.push(isNull(deliveryTasks.deliveryAgentId));
  if (filters.branchId) conditions.push(eq(deliveryAgents.branchId, filters.branchId));
  if (filters.territory) conditions.push(eq(deliveryAgents.territory, filters.territory));
  if (filters.customerId) conditions.push(eq(deliveryTasks.customerId, filters.customerId));
  if (filters.overdue) conditions.push(overdueCondition());
  if (filters.reviewPending) conditions.push(eq(deliveryTasks.paymentReview, "pending"));
  if (filters.search) {
    const pattern = likePattern(filters.search);
    conditions.push(or(ilike(deliveryTasks.number, pattern), ilike(salesOrders.number, pattern), ilike(customers.name, pattern)));
  }
  if (filters.cursor) {
    const cursor = decodeTaskCursor(filters.cursor);
    conditions.push(
      sql`(${deliveryTasks.scheduledDate}, ${deliveryTasks.createdAt}, ${deliveryTasks.id}) < (${cursor.d}::date, ${cursor.c}::timestamptz, ${cursor.i}::uuid)`,
    );
  }
  const rows = await taskListQuery(conn)
    .where(and(...conditions))
    .orderBy(desc(deliveryTasks.scheduledDate), desc(deliveryTasks.createdAt), desc(deliveryTasks.id))
    .limit(filters.limit + 1);
  const page = rows.slice(0, filters.limit);
  return { tasks: page.map(presentTask), nextCursor: rows.length > filters.limit ? encodeTaskCursor(page[page.length - 1]!) : null };
}

export type TaskAudience = { kind: "manager" } | { kind: "agent"; deliveryAgentId: string; canViewDebt: boolean };

const actorUser = alias(users, "delivery_actor_user");

export async function getDeliveryTask(conn: DbOrTx, companyId: string, taskId: string, audience: TaskAudience) {
  const [task] = await conn.select().from(deliveryTasks).where(and(eq(deliveryTasks.id, taskId), eq(deliveryTasks.companyId, companyId))).limit(1);
  // Agent faqat o'ziga biriktirilgan yetkazmani ko'radi — boshqasi "topilmadi" (mavjudligi ham oshkor bo'lmaydi)
  if (!task || (audience.kind === "agent" && task.deliveryAgentId !== audience.deliveryAgentId)) throw notFound("Yetkazma topilmadi");

  const [order] = await conn
    .select({
      id: salesOrders.id,
      number: salesOrders.number,
      status: salesOrders.status,
      orderDate: salesOrders.orderDate,
      totalAmount: salesOrders.totalAmount,
      paidAmount: salesOrders.paidAmount,
      currency: salesOrders.currency,
    })
    .from(salesOrders)
    .where(eq(salesOrders.id, task.orderId))
    .limit(1);
  const [customer] = await conn
    .select({
      id: customers.id,
      name: customers.name,
      phone: customers.phone,
      address: customers.address,
      contactName: customers.contactName,
      latitude: customers.latitude,
      longitude: customers.longitude,
      totalDebt: customers.totalDebt,
      balance: customers.balance,
    })
    .from(customers)
    .where(eq(customers.id, task.customerId))
    .limit(1);
  const [agent] = task.deliveryAgentId
    ? await conn
        .select({ id: deliveryAgents.id, code: deliveryAgents.code, name: users.name, phone: users.phone })
        .from(deliveryAgents)
        .innerJoin(users, eq(users.id, deliveryAgents.userId))
        .where(eq(deliveryAgents.id, task.deliveryAgentId))
        .limit(1)
    : [];

  const itemRows = await conn
    .select({
      id: deliveryTaskItems.id,
      orderItemId: deliveryTaskItems.orderItemId,
      productId: deliveryTaskItems.productId,
      productName: products.name,
      productSku: products.sku,
      unitName: units.shortName,
      quantity: deliveryTaskItems.quantity,
      deliveredQty: deliveryTaskItems.deliveredQty,
      returnedQty: deliveryTaskItems.returnedQty,
      orderQuantity: salesOrderItems.quantity,
      unitPrice: salesOrderItems.unitPrice,
      lineTotal: salesOrderItems.lineTotal,
    })
    .from(deliveryTaskItems)
    .innerJoin(salesOrderItems, eq(salesOrderItems.id, deliveryTaskItems.orderItemId))
    .innerJoin(products, eq(products.id, deliveryTaskItems.productId))
    .innerJoin(units, eq(units.id, salesOrderItems.unitId))
    .where(eq(deliveryTaskItems.taskId, task.id))
    .orderBy(asc(products.name), asc(deliveryTaskItems.id));
  const items = itemRows.map(({ orderQuantity, lineTotal, ...item }) => {
    const orderQty = toMinor(orderQuantity, 4);
    const share = (qty: string | null) => (qty === null || orderQty === 0n ? null : fromMinor(mulDivRound(toMinor(lineTotal), toMinor(qty, 4), orderQty)));
    return { ...item, value: share(item.quantity)!, deliveredValue: share(item.deliveredQty) };
  });

  const payments = await conn
    .select({
      id: deliveryPayments.id,
      method: deliveryPayments.method,
      amount: deliveryPayments.amount,
      collectedAt: deliveryPayments.collectedAt,
      collectedByName: actorUser.name,
      offline: deliveryPayments.offline,
      customerPaymentId: deliveryPayments.customerPaymentId,
    })
    .from(deliveryPayments)
    .leftJoin(actorUser, eq(actorUser.id, deliveryPayments.collectedBy))
    .where(eq(deliveryPayments.taskId, task.id))
    .orderBy(asc(deliveryPayments.collectedAt));
  const proofs = await conn
    .select({
      id: deliveryProofs.id,
      kind: deliveryProofs.kind,
      contentType: deliveryProofs.contentType,
      sizeBytes: deliveryProofs.sizeBytes,
      signerName: deliveryProofs.signerName,
      distanceMeters: deliveryProofs.distanceMeters,
      takenAt: deliveryProofs.takenAt,
    })
    .from(deliveryProofs)
    .where(eq(deliveryProofs.taskId, task.id))
    .orderBy(asc(deliveryProofs.takenAt));
  const events = await conn
    .select({
      id: deliveryEvents.id,
      action: deliveryEvents.action,
      fromStatus: deliveryEvents.fromStatus,
      toStatus: deliveryEvents.toStatus,
      actorName: actorUser.name,
      occurredAt: deliveryEvents.occurredAt,
      receivedAt: deliveryEvents.receivedAt,
      distanceMeters: deliveryEvents.distanceMeters,
      note: deliveryEvents.note,
      details: deliveryEvents.details,
      offline: deliveryEvents.offline,
    })
    .from(deliveryEvents)
    .leftJoin(actorUser, eq(actorUser.id, deliveryEvents.actorUserId))
    .where(eq(deliveryEvents.taskId, task.id))
    .orderBy(asc(deliveryEvents.occurredAt), asc(deliveryEvents.receivedAt));

  const {
    otpHash,
    supervisorNote,
    paymentReviewNote,
    arrivalLatitude: _arrivalLatitude,
    arrivalLongitude: _arrivalLongitude,
    confirmLatitude: _confirmLatitude,
    confirmLongitude: _confirmLongitude,
    ...fields
  } = task;
  const base = {
    ...fields,
    windowStart: hhmm(task.windowStart),
    windowEnd: hhmm(task.windowEnd),
    overdue: isOverdue(task),
    otpIssued: otpHash !== null,
    otpVerified: task.otpVerifiedAt !== null,
    order: order!,
    agent: agent ?? null,
    items,
    payments,
    proofs,
  };
  if (audience.kind === "manager") {
    return { ...base, supervisorNote, paymentReviewNote, customer: customer!, events };
  }
  const { totalDebt, balance, ...publicCustomer } = customer!;
  return {
    ...base,
    customer: audience.canViewDebt ? { ...publicCustomer, totalDebt, balance } : publicCustomer,
    events: events.map(({ details: _details, ...event }) => event),
  };
}

/** Yetkazma yaratish mumkin bo'lgan buyurtmalar: tasdiqlangan/jo'natilgan, mijozli, kassa emas, ochiq yoki yetkazilgan yetkazmasiz. */
export async function readyOrdersForDelivery(conn: DbOrTx, tenant: TenantContext, options: { search?: string; limit: number }) {
  const conditions: (SQL | undefined)[] = [
    eq(salesOrders.companyId, tenant.company.id),
    inArray(salesOrders.status, ["confirmed", "shipped", "delivered"]),
    eq(salesOrders.isPos, false),
    isNotNull(salesOrders.customerId),
    notExists(
      conn
        .select({ one: sql`1` })
        .from(deliveryTasks)
        .where(and(eq(deliveryTasks.orderId, salesOrders.id), inArray(deliveryTasks.status, [...OPEN, "delivered", "partially_delivered"]))),
    ),
  ];
  if (options.search) {
    const pattern = likePattern(options.search);
    conditions.push(or(ilike(salesOrders.number, pattern), ilike(customers.name, pattern)));
  }
  return conn
    .select({
      id: salesOrders.id,
      number: salesOrders.number,
      status: salesOrders.status,
      orderDate: salesOrders.orderDate,
      deliveryDate: salesOrders.deliveryDate,
      deliveryRequired: salesOrders.deliveryRequired,
      totalAmount: salesOrders.totalAmount,
      paidAmount: salesOrders.paidAmount,
      customerId: salesOrders.customerId,
      customerName: customers.name,
      customerAddress: customers.address,
      customerCity: customers.city,
      customerDistrict: customers.district,
      customerLatitude: customers.latitude,
      customerLongitude: customers.longitude,
      hasLocation: sql<boolean>`${customers.latitude} is not null and ${customers.longitude} is not null`,
    })
    .from(salesOrders)
    .innerJoin(customers, eq(customers.id, salesOrders.customerId))
    .where(and(...conditions))
    .orderBy(desc(salesOrders.orderDate), desc(salesOrders.createdAt))
    .limit(options.limit);
}

export type { DeliveryTaskRow };
