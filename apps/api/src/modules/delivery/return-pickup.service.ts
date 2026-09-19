/**
 * Mijozdan tovarni QAYTARIB OLISH (dostavchi) — ilgari sotilgan chek bo'yicha.
 *
 * Oqim:
 *   1) dostavchi mijozning oldingi xaridlarini ko'radi — qachon, qanday narxda olgani va qancha qaytarish mumkinligi;
 *   2) kerakli qatorlarni belgilab, sabab bilan yuboradi;
 *   3) siyosatga ko'ra (`returnPickupApproval`):
 *        - `true` (standart) — yozuv `pending` bo'lib turadi, tovar mashinada; supervayzer/omborchi QABUL qilganda
 *          savdo qaytarish hujjati yoziladi (zaxira qaytadi, qarz kamayadi yoki pul qaytariladi);
 *        - `false` — dostavchi yuborishi bilan darhol yoziladi.
 *
 * Pul, zaxira va jurnal FAQAT mavjud savdo qaytarish oqimida (`returnSaleItems`) harakatlanadi — bu yerda nusxa yo'q.
 * Dostavchi faqat O'ZI yetkazma qilgan mijozning cheklarini ko'radi va qaytarib oladi.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { AppError, badRequest, notFound } from "@bum/shared";
import { products, units } from "../../db/schema/catalog.js";
import {
  deliveryAgents,
  deliveryReturnPickupItems,
  deliveryReturnPickups,
  deliveryTasks,
} from "../../db/schema/delivery.js";
import { users } from "../../db/schema/platform.js";
import { customers, salesOrderItems, salesOrders } from "../../db/schema/sales.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import { writeAuditLog, type RequestMeta } from "../../shared/audit.js";
import { fromMinor, mulDivRound, toMinor } from "../../shared/decimal.js";
import { nextDocumentNumber } from "../../shared/numbering.js";
import type { TenantContext } from "../company/tenant.js";
import { COMPLETED_STATUSES, isCompletedSale } from "../sales/sale-status.js";
import { returnSaleItems, type RefundMethod } from "../sales/returns.service.js";
import type { DeliveryAgentContext } from "./agent-context.js";
import { getDeliveryPolicy } from "./policy.service.js";

export type PickupStatus = (typeof deliveryReturnPickups.status.enumValues)[number];

export type CreatePickupInput = {
  customerId: string;
  orderId: string;
  items: { orderItemId: string; quantity: string }[];
  reason?: string | null;
  refundMethod: RefundMethod;
  taskId?: string | null;
};

const QTY_SCALE = 4;

/** Dostavchi shu mijozga yetkazma qilganmi — boshqa mijozning cheki ko'rinmaydi. */
async function assertAgentCustomer(conn: DbOrTx, context: DeliveryAgentContext, customerId: string) {
  const [row] = await conn
    .select({ id: deliveryTasks.id })
    .from(deliveryTasks)
    .where(
      and(
        eq(deliveryTasks.companyId, context.company.id),
        eq(deliveryTasks.deliveryAgentId, context.deliveryAgent.id),
        eq(deliveryTasks.customerId, customerId),
      ),
    )
    .limit(1);
  if (!row) throw notFound("Mijoz topilmadi");
}

/** Shu qator bo'yicha hali qabul qilinmagan (kutilayotgan) so'rovlardagi miqdor. */
async function pendingByItem(conn: DbOrTx, companyId: string, orderItemIds: string[]) {
  if (orderItemIds.length === 0) return new Map<string, bigint>();
  const rows = await conn
    .select({
      orderItemId: deliveryReturnPickupItems.orderItemId,
      quantity: sql<string>`coalesce(sum(${deliveryReturnPickupItems.quantity}), 0)::numeric(18,4)`,
    })
    .from(deliveryReturnPickupItems)
    .innerJoin(deliveryReturnPickups, eq(deliveryReturnPickups.id, deliveryReturnPickupItems.pickupId))
    .where(
      and(
        eq(deliveryReturnPickups.companyId, companyId),
        eq(deliveryReturnPickups.status, "pending"),
        inArray(deliveryReturnPickupItems.orderItemId, orderItemIds),
      ),
    )
    .groupBy(deliveryReturnPickupItems.orderItemId);
  return new Map(rows.map((row) => [row.orderItemId, toMinor(row.quantity, QTY_SCALE)]));
}

/**
 * Mijozning oldingi xaridlari: qaysi chekdan, QACHON olingan va QANDAY narxda; qancha qaytarish mumkin.
 * Faqat yakunlangan cheklar va qaytarilmagan qoldiq qatorlar.
 */
export async function customerPurchases(
  conn: DbOrTx,
  context: DeliveryAgentContext,
  customerId: string,
  options: { limit?: number } = {},
) {
  await assertAgentCustomer(conn, context, customerId);
  const rows = await conn
    .select({
      orderId: salesOrders.id,
      orderNumber: salesOrders.number,
      orderDate: salesOrders.orderDate,
      currency: salesOrders.currency,
      orderItemId: salesOrderItems.id,
      productId: salesOrderItems.productId,
      productName: products.name,
      sku: products.sku,
      unitName: units.shortName,
      quantity: salesOrderItems.quantity,
      returnedQty: salesOrderItems.returnedQty,
      unitPrice: salesOrderItems.unitPrice,
      lineTotal: salesOrderItems.lineTotal,
    })
    .from(salesOrders)
    .innerJoin(salesOrderItems, eq(salesOrderItems.orderId, salesOrders.id))
    .innerJoin(products, eq(products.id, salesOrderItems.productId))
    .innerJoin(units, eq(units.id, salesOrderItems.unitId))
    .where(
      and(
        eq(salesOrders.companyId, context.company.id),
        eq(salesOrders.customerId, customerId),
        inArray(salesOrders.status, [...COMPLETED_STATUSES]),
        sql`${salesOrderItems.quantity} > ${salesOrderItems.returnedQty}`,
      ),
    )
    .orderBy(desc(salesOrders.orderDate), desc(salesOrders.createdAt))
    .limit(options.limit ?? 200);

  const pending = await pendingByItem(conn, context.company.id, rows.map((row) => row.orderItemId));
  const items = rows
    .map((row) => {
      const remaining =
        toMinor(row.quantity, QTY_SCALE) - toMinor(row.returnedQty, QTY_SCALE) - (pending.get(row.orderItemId) ?? 0n);
      return {
        ...row,
        pendingQty: fromMinor(pending.get(row.orderItemId) ?? 0n, QTY_SCALE),
        returnableQty: fromMinor(remaining > 0n ? remaining : 0n, QTY_SCALE),
      };
    })
    .filter((row) => Number(row.returnableQty) > 0);

  // Chek bo'yicha guruh — dostavchi "qaysi xariddan" ekanini ko'rib turadi
  const orders = new Map<string, { id: string; number: string; orderDate: string; currency: string; items: typeof items }>();
  for (const item of items) {
    const group = orders.get(item.orderId) ?? {
      id: item.orderId,
      number: item.orderNumber,
      orderDate: item.orderDate,
      currency: item.currency,
      items: [] as typeof items,
    };
    group.items.push(item);
    orders.set(item.orderId, group);
  }
  return { orders: [...orders.values()] };
}

/** Ro'yxat: supervayzerga (barcha) yoki dostavchiga (faqat o'ziniki). */
export async function listReturnPickups(
  conn: DbOrTx,
  companyId: string,
  filters: { status?: PickupStatus; agentId?: string; limit?: number } = {},
) {
  const rows = await conn
    .select({
      id: deliveryReturnPickups.id,
      number: deliveryReturnPickups.number,
      status: deliveryReturnPickups.status,
      orderId: deliveryReturnPickups.orderId,
      orderNumber: salesOrders.number,
      customerId: deliveryReturnPickups.customerId,
      customerName: customers.name,
      customerPhone: customers.phone,
      agentId: deliveryReturnPickups.agentId,
      agentName: users.name,
      taskId: deliveryReturnPickups.taskId,
      reason: deliveryReturnPickups.reason,
      refundMethod: deliveryReturnPickups.refundMethod,
      amount: deliveryReturnPickups.amount,
      note: deliveryReturnPickups.note,
      returnId: deliveryReturnPickups.returnId,
      decidedAt: deliveryReturnPickups.decidedAt,
      createdAt: deliveryReturnPickups.createdAt,
    })
    .from(deliveryReturnPickups)
    .innerJoin(salesOrders, eq(salesOrders.id, deliveryReturnPickups.orderId))
    .innerJoin(customers, eq(customers.id, deliveryReturnPickups.customerId))
    .leftJoin(deliveryAgents, eq(deliveryAgents.id, deliveryReturnPickups.agentId))
    .leftJoin(users, eq(users.id, deliveryAgents.userId))
    .where(
      and(
        eq(deliveryReturnPickups.companyId, companyId),
        filters.status ? eq(deliveryReturnPickups.status, filters.status) : undefined,
        filters.agentId ? eq(deliveryReturnPickups.agentId, filters.agentId) : undefined,
      ),
    )
    .orderBy(desc(deliveryReturnPickups.createdAt))
    .limit(filters.limit ?? 100);
  if (rows.length === 0) return { pickups: [] };

  const lines = await conn
    .select({
      pickupId: deliveryReturnPickupItems.pickupId,
      orderItemId: deliveryReturnPickupItems.orderItemId,
      productName: products.name,
      unitName: units.shortName,
      quantity: deliveryReturnPickupItems.quantity,
      unitPrice: deliveryReturnPickupItems.unitPrice,
    })
    .from(deliveryReturnPickupItems)
    .innerJoin(products, eq(products.id, deliveryReturnPickupItems.productId))
    .innerJoin(salesOrderItems, eq(salesOrderItems.id, deliveryReturnPickupItems.orderItemId))
    .innerJoin(units, eq(units.id, salesOrderItems.unitId))
    .where(inArray(deliveryReturnPickupItems.pickupId, rows.map((row) => row.id)));
  const byPickup = new Map<string, typeof lines>();
  for (const line of lines) byPickup.set(line.pickupId, [...(byPickup.get(line.pickupId) ?? []), line]);

  return { pickups: rows.map((row) => ({ ...row, items: byPickup.get(row.id) ?? [] })) };
}

async function lockPickup(tx: Tx, companyId: string, pickupId: string) {
  const [row] = await tx
    .select()
    .from(deliveryReturnPickups)
    .where(and(eq(deliveryReturnPickups.id, pickupId), eq(deliveryReturnPickups.companyId, companyId)))
    .limit(1)
    .for("update");
  if (!row) throw notFound("Qaytarish so'rovi topilmadi");
  return row;
}

/**
 * Dostavchi qaytarib olgan tovarni yozadi. Siyosatga ko'ra darhol rasmiylashtiriladi yoki qabul kutadi.
 * Miqdor chekdagi qoldiqdan (va kutilayotgan so'rovlardan) oshmasligi tekshiriladi.
 */
export async function createReturnPickup(
  tx: Tx,
  context: DeliveryAgentContext,
  input: CreatePickupInput,
  meta: RequestMeta,
) {
  const companyId = context.company.id;
  await assertAgentCustomer(tx, context, input.customerId);
  if (input.items.length === 0) throw badRequest("Qaytariladigan mahsulotni tanlang");
  const ids = input.items.map((item) => item.orderItemId);
  if (new Set(ids).size !== ids.length) throw badRequest("Mahsulot qatori takrorlangan");

  const [order] = await tx
    .select({ id: salesOrders.id, number: salesOrders.number, status: salesOrders.status, customerId: salesOrders.customerId })
    .from(salesOrders)
    .where(and(eq(salesOrders.id, input.orderId), eq(salesOrders.companyId, companyId)))
    .limit(1);
  if (!order) throw notFound("Chek topilmadi");
  if (order.customerId !== input.customerId) throw badRequest("Chek boshqa mijozniki");
  if (!isCompletedSale(order.status)) throw badRequest("Faqat yakunlangan chekdagi mahsulot qaytariladi");

  const rows = await tx
    .select({
      id: salesOrderItems.id,
      productId: salesOrderItems.productId,
      quantity: salesOrderItems.quantity,
      returnedQty: salesOrderItems.returnedQty,
      unitPrice: salesOrderItems.unitPrice,
      lineTotal: salesOrderItems.lineTotal,
      productName: products.name,
    })
    .from(salesOrderItems)
    .innerJoin(products, eq(products.id, salesOrderItems.productId))
    .where(eq(salesOrderItems.orderId, order.id))
    .for("update", { of: salesOrderItems });
  const rowById = new Map(rows.map((row) => [row.id, row]));
  if (ids.some((id) => !rowById.has(id))) throw badRequest("Chekda bunday mahsulot qatori yo'q");

  const pending = await pendingByItem(tx, companyId, ids);
  let amount = 0n;
  const lines = input.items.map((item) => {
    const row = rowById.get(item.orderItemId)!;
    const qty = toMinor(item.quantity, QTY_SCALE);
    if (qty <= 0n) throw badRequest("Miqdor musbat bo'lishi kerak");
    const remaining =
      toMinor(row.quantity, QTY_SCALE) - toMinor(row.returnedQty, QTY_SCALE) - (pending.get(row.id) ?? 0n);
    if (qty > remaining) {
      throw badRequest(`${row.productName}: qaytarish miqdori qolganidan ko'p (qolgan ${fromMinor(remaining > 0n ? remaining : 0n, QTY_SCALE)})`, {
        reason: "quantity_range",
        orderItemId: row.id,
      });
    }
    const orderQty = toMinor(row.quantity, QTY_SCALE);
    const value = orderQty === 0n ? 0n : mulDivRound(toMinor(row.lineTotal), qty, orderQty);
    amount += value;
    return { row, qty, value };
  });

  const policy = await getDeliveryPolicy(tx, companyId);
  const number = await nextDocumentNumber(tx, {
    table: deliveryReturnPickups,
    column: deliveryReturnPickups.number,
    companyColumn: deliveryReturnPickups.companyId,
    companyId,
    prefix: "QQ-",
    width: 5,
  });

  const [pickup] = await tx
    .insert(deliveryReturnPickups)
    .values({
      companyId,
      number,
      orderId: order.id,
      customerId: input.customerId,
      agentId: context.deliveryAgent.id,
      taskId: input.taskId ?? null,
      createdBy: context.user.id,
      status: "pending",
      reason: input.reason?.trim() || null,
      refundMethod: input.refundMethod,
      amount: fromMinor(amount),
    })
    .returning();

  for (const line of lines) {
    await tx.insert(deliveryReturnPickupItems).values({
      pickupId: pickup!.id,
      orderItemId: line.row.id,
      productId: line.row.productId,
      quantity: fromMinor(line.qty, QTY_SCALE),
      unitPrice: line.row.unitPrice,
    });
  }

  await writeAuditLog(
    {
      companyId,
      userId: context.user.id,
      userName: context.user.name,
      action: "DELIVERY_RETURN_PICKUP_CREATED",
      resource: "delivery_return_pickups",
      resourceId: pickup!.id,
      details: {
        number,
        orderNumber: order.number,
        amount: fromMinor(amount),
        approval: policy.returnPickupApproval,
        items: lines.map((line) => ({ orderItemId: line.row.id, quantity: fromMinor(line.qty, QTY_SCALE) })),
      },
      ...meta,
    },
    tx,
  );

  // Siyosat: tasdiqsiz rejimda dostavchining o'zi yakunlaydi
  if (!policy.returnPickupApproval) {
    return settlePickup(tx, context, pickup!.id, { refundMethod: input.refundMethod, note: null }, meta, "agent");
  }
  return { pickup: { ...pickup!, items: lines.map((line) => ({ orderItemId: line.row.id, quantity: fromMinor(line.qty, QTY_SCALE) })) } };
}

/** Qabul qilish: savdo qaytarish hujjati yoziladi — zaxira qaytadi, qarz/pul hisob-kitob qilinadi. */
async function settlePickup(
  tx: Tx,
  tenant: TenantContext,
  pickupId: string,
  input: { refundMethod?: RefundMethod | null; note?: string | null },
  meta: RequestMeta,
  by: "agent" | "supervisor",
) {
  const pickup = await lockPickup(tx, tenant.company.id, pickupId);
  if (pickup.status !== "pending") {
    throw new AppError("CONFLICT", "So'rov allaqachon ko'rib chiqilgan", { reason: "already_decided", status: pickup.status });
  }
  const items = await tx
    .select({ orderItemId: deliveryReturnPickupItems.orderItemId, quantity: deliveryReturnPickupItems.quantity })
    .from(deliveryReturnPickupItems)
    .where(eq(deliveryReturnPickupItems.pickupId, pickup.id));
  if (items.length === 0) throw badRequest("So'rovda mahsulot yo'q");

  const refundMethod = (input.refundMethod ?? pickup.refundMethod) as RefundMethod;
  const result = await returnSaleItems(
    tx,
    tenant,
    pickup.orderId,
    {
      items: items.map((item) => ({ orderItemId: item.orderItemId, quantity: item.quantity })),
      refundMethod,
      reason: `Dostavchi qaytarib oldi ${pickup.number}${pickup.reason ? `: ${pickup.reason}` : ""}`,
    },
    meta,
  );

  const now = new Date();
  const [updated] = await tx
    .update(deliveryReturnPickups)
    .set({
      status: "accepted",
      refundMethod,
      returnId: result.return.id,
      amount: result.return.totalAmount,
      note: input.note?.trim() || pickup.note,
      decidedBy: tenant.user.id,
      decidedAt: now,
      updatedAt: now,
    })
    .where(eq(deliveryReturnPickups.id, pickup.id))
    .returning();

  await writeAuditLog(
    {
      companyId: tenant.company.id,
      userId: tenant.user.id,
      userName: tenant.user.name,
      action: "DELIVERY_RETURN_PICKUP_ACCEPTED",
      resource: "delivery_return_pickups",
      resourceId: pickup.id,
      details: { number: pickup.number, by, returnNumber: result.return.number, amount: result.return.totalAmount, refundMethod },
      ...meta,
    },
    tx,
  );
  return { pickup: updated!, return: result.return };
}

export function acceptReturnPickup(
  tx: Tx,
  tenant: TenantContext,
  pickupId: string,
  input: { refundMethod?: RefundMethod | null; note?: string | null },
  meta: RequestMeta,
) {
  return settlePickup(tx, tenant, pickupId, input, meta, "supervisor");
}

/** Rad etish: tovar qaytmaydi, hech qanday pul yoki zaxira harakati bo'lmaydi. */
export async function rejectReturnPickup(
  tx: Tx,
  tenant: TenantContext,
  pickupId: string,
  input: { note: string },
  meta: RequestMeta,
) {
  const pickup = await lockPickup(tx, tenant.company.id, pickupId);
  if (pickup.status !== "pending") {
    throw new AppError("CONFLICT", "So'rov allaqachon ko'rib chiqilgan", { reason: "already_decided", status: pickup.status });
  }
  const note = input.note.trim();
  if (note.length < 3) throw badRequest("Rad etish sababini yozing");
  const now = new Date();
  const [updated] = await tx
    .update(deliveryReturnPickups)
    .set({ status: "rejected", note, decidedBy: tenant.user.id, decidedAt: now, updatedAt: now })
    .where(eq(deliveryReturnPickups.id, pickup.id))
    .returning();
  await writeAuditLog(
    {
      companyId: tenant.company.id,
      userId: tenant.user.id,
      userName: tenant.user.name,
      action: "DELIVERY_RETURN_PICKUP_REJECTED",
      resource: "delivery_return_pickups",
      resourceId: pickup.id,
      details: { number: pickup.number, note },
      ...meta,
    },
    tx,
  );
  return { pickup: updated! };
}
