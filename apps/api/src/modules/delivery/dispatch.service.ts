/**
 * Dostavka taqsimoti ("Marshrut bo'yicha" / "Hudud bo'yicha"): yetkazilishi kerak bo'lgan hamma narsa bitta ro'yxatda —
 * yetkazmasi hali yaratilmagan tasdiqlangan buyurtmalar va agentga biriktirilmagan "tayyor" yetkazmalar. Har qatorda
 * mijoz hududi (shahar/tuman, mahalla), koordinatasi va distribyutsiya marshrutlaridagi o'rni — guruhlash mijozda.
 *
 * Ommaviy biriktirish: tanlangan buyurtmalardan yetkazma yaratiladi (agent bilan — siyosatdagi avtomatik biriktirish
 * ishlamaydi) va tanlangan yetkazmalar agentga biriktiriladi — hammasi bitta tranzaksiyada (biri xato bo'lsa hech biri
 * yozilmaydi). Har biri odatdagidek hodisa va auditga yoziladi.
 */
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { badRequest } from "@bum/shared";
import { distributionRoutes, routeCustomers } from "../../db/schema/crm.js";
import { deliveryTasks } from "../../db/schema/delivery.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import type { RequestMeta } from "../../shared/audit.js";
import type { TenantContext } from "../company/tenant.js";
import { deliveryAudit } from "./task.repo.js";
import { assignDeliveryTask, createDeliveryTask, readyOrdersForDelivery, taskListQuery } from "./tasks.service.js";
import { taskScopeCondition, type DeliveryScope } from "./scope.js";

export const DISPATCH_LIMIT = 500;
export const DISPATCH_ASSIGN_MAX = 200;

export async function dispatchBoard(conn: DbOrTx, tenant: TenantContext, scope: DeliveryScope = null) {
  const companyId = tenant.company.id;
  const orders = await readyOrdersForDelivery(conn, tenant, { limit: DISPATCH_LIMIT, scope });
  const tasks = await taskListQuery(conn)
    .where(and(eq(deliveryTasks.companyId, companyId), isNull(deliveryTasks.deliveryAgentId), eq(deliveryTasks.status, "ready"), taskScopeCondition(scope)))
    .orderBy(asc(deliveryTasks.scheduledDate), asc(deliveryTasks.createdAt))
    .limit(DISPATCH_LIMIT);

  const customerIds = [...new Set([...orders.map((order) => order.customerId!), ...tasks.map((task) => task.customerId)])];
  const memberships = customerIds.length
    ? await conn
        .select({
          customerId: routeCustomers.customerId,
          routeId: distributionRoutes.id,
          routeName: distributionRoutes.name,
          color: distributionRoutes.color,
          position: routeCustomers.sortOrder,
        })
        .from(routeCustomers)
        .innerJoin(distributionRoutes, eq(distributionRoutes.id, routeCustomers.routeId))
        .where(and(eq(distributionRoutes.companyId, companyId), eq(distributionRoutes.isActive, true), inArray(routeCustomers.customerId, customerIds)))
        .orderBy(asc(distributionRoutes.name), asc(routeCustomers.sortOrder))
    : [];
  const routesOf = (customerId: string) =>
    memberships.filter((row) => row.customerId === customerId).map(({ routeId, routeName, color, position }) => ({ id: routeId, name: routeName, color, position }));

  const items = [
    ...tasks.map((task) => ({
      key: `task:${task.id}`,
      kind: "task" as const,
      orderId: task.orderId,
      orderNumber: task.orderNumber,
      taskId: task.id,
      taskNumber: task.number,
      date: task.scheduledDate,
      totalAmount: task.orderTotal,
      customerId: task.customerId,
      customerName: task.customerName,
      customerAddress: task.customerAddress,
      city: task.customerCity,
      district: task.customerDistrict,
      latitude: task.customerLatitude,
      longitude: task.customerLongitude,
      routes: routesOf(task.customerId),
    })),
    ...orders.map((order) => ({
      key: `order:${order.id}`,
      kind: "order" as const,
      orderId: order.id,
      orderNumber: order.number,
      taskId: null,
      taskNumber: null,
      date: order.deliveryDate,
      totalAmount: order.totalAmount,
      customerId: order.customerId!,
      customerName: order.customerName,
      customerAddress: order.customerAddress,
      city: order.customerCity,
      district: order.customerDistrict,
      latitude: order.customerLatitude,
      longitude: order.customerLongitude,
      routes: routesOf(order.customerId!),
    })),
  ];
  const routes = [...new Map(memberships.map((row) => [row.routeId, { id: row.routeId, name: row.routeName, color: row.color }])).values()];
  return { items, routes, truncated: orders.length >= DISPATCH_LIMIT || tasks.length >= DISPATCH_LIMIT };
}

export type DispatchAssignInput = {
  orderIds: string[];
  taskIds: string[];
  deliveryAgentId: string;
  scheduledDate?: string;
};

/** Yaratilgan/biriktirilgan yetkazmalar ID'lari va ularning sanalari (marshrut tartibi shu kunlar uchun). */
export async function assignDispatch(
  tx: Tx,
  tenant: TenantContext,
  input: DispatchAssignInput,
  meta: RequestMeta,
  options: { allowReassign: boolean },
) {
  const total = input.orderIds.length + input.taskIds.length;
  if (total === 0) throw badRequest("Biriktirish uchun buyurtma yoki yetkazma tanlang");
  if (total > DISPATCH_ASSIGN_MAX) throw badRequest(`Bir martada ko'pi bilan ${DISPATCH_ASSIGN_MAX} ta`);
  if (new Set(input.orderIds).size !== input.orderIds.length || new Set(input.taskIds).size !== input.taskIds.length) {
    throw badRequest("Ro'yxatda takrorlangan qator bor");
  }

  const created: string[] = [];
  for (const orderId of input.orderIds) {
    created.push(
      await createDeliveryTask(tx, tenant, { orderId, scheduledDate: input.scheduledDate, deliveryAgentId: input.deliveryAgentId }, meta, "manual", { allowAssign: true }),
    );
  }
  for (const taskId of input.taskIds) {
    await assignDeliveryTask(tx, tenant, taskId, { deliveryAgentId: input.deliveryAgentId, scheduledDate: input.scheduledDate }, meta, options);
  }

  const taskIds = [...created, ...input.taskIds];
  const rows = await tx
    .select({ id: deliveryTasks.id, scheduledDate: deliveryTasks.scheduledDate })
    .from(deliveryTasks)
    .where(and(eq(deliveryTasks.companyId, tenant.company.id), inArray(deliveryTasks.id, taskIds)));
  const dates = [...new Set(rows.map((row) => row.scheduledDate))].sort();
  await deliveryAudit(tx, tenant, meta, "DELIVERY_BULK_ASSIGNED", taskIds[0]!, {
    deliveryAgentId: input.deliveryAgentId,
    created: created.length,
    assigned: input.taskIds.length,
    taskIds,
    dates,
  });
  return { taskIds, created: created.length, assigned: input.taskIds.length, dates };
}
