/**
 * SUPERVAYZER PANELI (2026-09-26) — yangi hisob-kitob EMAS, mavjud manbalar yig'indisi:
 *   - agent KPI (oy): `salesRepStats` (agent_visits + agent_orders × sales_orders, PAYABLE holatlar) — rahbar paneli bilan bir xil;
 *   - bugun: agent_orders × sales_orders (yuborilgan), agent_visits (yakunlangan);
 *   - qarz: `customers.total_debt` (jurnalga moslangan kesh) — agent marshrutlaridagi mijozlar;
 *   - agentdagi naqd: agentning "yo'ldagi naqd" kassasi (`cash_accounts.sales_rep_id`);
 *   - yetkazish: `supervisorDashboard` (yetkazish chegarasi bilan).
 * Jamoa chegarasi ("mas'ul bo'lganlari") serverda: `salesRepIds` bo'lsa faqat shular.
 *
 * Zanjir: Agent → Buyurtma → Ombor → Yetkazish → To'lov → Qarz → Topshirish — bitta buyurtma bo'yicha.
 */
import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import { notFound } from "@bum/shared";
import { salesReps } from "../../db/schema/crm.js";
import { deliveryAgents, deliveryPayments, deliveryTasks } from "../../db/schema/delivery.js";
import { cashAccounts } from "../../db/schema/finance.js";
import { stockMovements, warehouses } from "../../db/schema/inventory.js";
import { users } from "../../db/schema/platform.js";
import { customerPayments, customers, salesOrders } from "../../db/schema/sales.js";
import { agentOrders } from "../../db/schema/sales-agent.js";
import type { DbOrTx } from "../../db/transaction.js";
import { fromMinor, toMinor } from "../../shared/decimal.js";
import type { TenantContext } from "../company/tenant.js";
import { salesRepStats } from "../distribution/sales-reps.service.js";
import { supervisorDashboard } from "../delivery/reports.service.js";
import type { DeliveryScope } from "../delivery/scope.js";
import { PAYABLE_STATUSES } from "../sales/sale-status.js";

const outerRep = sql.raw(`"sales_reps"."id"`);
const payable = sql.raw(`(${PAYABLE_STATUSES.map((status) => `'${status}'`).join(", ")})`);

export async function supervisorOverview(
  conn: DbOrTx,
  tenant: TenantContext,
  options: { date: string; salesRepIds: string[] | null; deliveryScope: DeliveryScope; withDelivery: boolean },
) {
  const companyId = tenant.company.id;
  const stats = (await salesRepStats(conn, tenant)).filter((row) => !options.salesRepIds || options.salesRepIds.includes(row.id));
  const ids = stats.map((row) => row.id);

  const today = ids.length
    ? await conn
        .select({
          salesRepId: salesReps.id,
          // Ichki so'rovlar aliaslar bilan (Drizzle bitta jadvalli select'da ustunlarni jadval nomisiz yozadi)
          ordersToday: sql<number>`(select count(*)::int from agent_orders ao join sales_orders so on so.id = ao.order_id
            where ao.sales_rep_id = ${outerRep} and ao.submitted_at is not null
              and so.status in ${payable} and so.order_date = ${options.date}::date)`,
          salesToday: sql<string>`(select coalesce(sum(so.total_amount), 0)::numeric(18,2) from agent_orders ao join sales_orders so on so.id = ao.order_id
            where ao.sales_rep_id = ${outerRep} and ao.submitted_at is not null
              and so.status in ${payable} and so.order_date = ${options.date}::date)`,
          pendingApproval: sql<number>`(select count(*)::int from agent_orders ao where ao.sales_rep_id = ${outerRep} and ao.approval_status = 'pending')`,
          visitsToday: sql<number>`(select count(*)::int from agent_visits av
            where av.sales_rep_id = ${outerRep} and av.status = 'completed' and av.visit_date = ${options.date}::date)`,
          // Qarz — agentning faol marshrutlaridagi mijozlar (har mijoz bir marta), `customers.total_debt` (jurnalga moslangan)
          customers: sql<number>`(select count(distinct rc.customer_id)::int from route_customers rc
            join distribution_routes dr on dr.id = rc.route_id where dr.sales_rep_id = ${outerRep} and dr.is_active)`,
          customerDebt: sql<string>`(select coalesce(sum(c.total_debt), 0)::numeric(18,2) from customers c
            where c.id in (select rc.customer_id from route_customers rc
              join distribution_routes dr on dr.id = rc.route_id where dr.sales_rep_id = ${outerRep} and dr.is_active))`,
          cashOnHand: sql<string>`(select coalesce(sum(ca.balance), 0)::numeric(18,2) from cash_accounts ca where ca.sales_rep_id = ${outerRep})`,
        })
        .from(salesReps)
        .where(and(eq(salesReps.companyId, companyId), inArray(salesReps.id, ids)))
    : [];
  const byRep = new Map(today.map((row) => [row.salesRepId, row]));

  const agents = stats.map((row) => {
    const day = byRep.get(row.id);
    const target = toMinor(row.monthlyTarget ?? "0");
    const month = toMinor(row.visitSalesThisMonth);
    return {
      id: row.id,
      name: row.name,
      code: row.code,
      phone: row.phone,
      region: row.region,
      monthlyTarget: row.monthlyTarget,
      salesThisMonth: row.visitSalesThisMonth,
      ordersThisMonth: row.ordersThisMonth,
      visitsThisMonth: row.visitsThisMonth,
      /** Oylik plan bajarilishi, % (plan bo'lmasa null). */
      targetPercent: target > 0n ? Number((month * 1000n) / target) / 10 : null,
      ordersToday: day?.ordersToday ?? 0,
      salesToday: day?.salesToday ?? "0.00",
      visitsToday: day?.visitsToday ?? 0,
      pendingApproval: day?.pendingApproval ?? 0,
      customers: day?.customers ?? 0,
      customerDebt: day?.customerDebt ?? "0.00",
      cashOnHand: day?.cashOnHand ?? "0.00",
    };
  });
  const sum = (pick: (row: (typeof agents)[number]) => string) => fromMinor(agents.reduce((total, row) => total + toMinor(pick(row)), 0n));
  return {
    date: options.date,
    scoped: options.salesRepIds !== null,
    totals: {
      agents: agents.length,
      ordersToday: agents.reduce((total, row) => total + row.ordersToday, 0),
      salesToday: sum((row) => row.salesToday),
      salesThisMonth: sum((row) => row.salesThisMonth),
      visitsToday: agents.reduce((total, row) => total + row.visitsToday, 0),
      pendingApproval: agents.reduce((total, row) => total + row.pendingApproval, 0),
      customerDebt: sum((row) => row.customerDebt),
      cashOnHand: sum((row) => row.cashOnHand),
    },
    agents,
    /** Yetkazish ko'rinishi — `delivery.view` bo'lsa (aks holda null). */
    delivery: options.withDelivery ? await supervisorDashboard(conn, tenant, options.date, options.deliveryScope) : null,
  };
}

/** Bitta agent buyurtmasining to'liq zanjiri. Jamoa chegarasidan tashqari — TOPILMADI. */
export async function supervisorOrderChain(conn: DbOrTx, tenant: TenantContext, orderId: string, salesRepIds: string[] | null) {
  const companyId = tenant.company.id;
  const actingUser = users;
  const [order] = await conn
    .select({
      orderId: salesOrders.id,
      number: salesOrders.number,
      status: salesOrders.status,
      orderDate: salesOrders.orderDate,
      deliveryDate: salesOrders.deliveryDate,
      totalAmount: salesOrders.totalAmount,
      paidAmount: salesOrders.paidAmount,
      warehouseName: warehouses.name,
      customerId: salesOrders.customerId,
      customerName: customers.name,
      customerDebt: customers.totalDebt,
      salesRepId: agentOrders.salesRepId,
      salesRepName: salesReps.name,
      paymentType: agentOrders.paymentType,
      submittedAt: agentOrders.submittedAt,
      submitDistanceMeters: agentOrders.submitDistanceMeters,
      approvalStatus: agentOrders.approvalStatus,
      visitId: agentOrders.visitId,
      actingUserId: agentOrders.actingUserId,
      actingUserName: actingUser.name,
      overrideReason: agentOrders.submitOverrideReason,
    })
    .from(agentOrders)
    .innerJoin(salesOrders, eq(salesOrders.id, agentOrders.orderId))
    .innerJoin(salesReps, eq(salesReps.id, agentOrders.salesRepId))
    .leftJoin(customers, eq(customers.id, salesOrders.customerId))
    .leftJoin(warehouses, eq(warehouses.id, salesOrders.warehouseId))
    .leftJoin(actingUser, eq(actingUser.id, agentOrders.actingUserId))
    .where(and(eq(agentOrders.orderId, orderId), eq(agentOrders.companyId, companyId)))
    .limit(1);
  if (!order || (salesRepIds && !salesRepIds.includes(order.salesRepId))) throw notFound("Buyurtma topilmadi");

  const tasks = await conn
    .select({
      id: deliveryTasks.id,
      number: deliveryTasks.number,
      status: deliveryTasks.status,
      scheduledDate: deliveryTasks.scheduledDate,
      deliveredAt: deliveryTasks.deliveredAt,
      expectedAmount: deliveryTasks.expectedAmount,
      collectedAmount: deliveryTasks.collectedAmount,
      failureReason: deliveryTasks.failureReason,
      deliveryAgentId: deliveryTasks.deliveryAgentId,
      deliveryAgentName: users.name,
    })
    .from(deliveryTasks)
    .leftJoin(deliveryAgents, eq(deliveryAgents.id, deliveryTasks.deliveryAgentId))
    .leftJoin(users, eq(users.id, deliveryAgents.userId))
    .where(and(eq(deliveryTasks.companyId, companyId), eq(deliveryTasks.orderId, orderId)))
    .orderBy(asc(deliveryTasks.createdAt));
  const taskIds = tasks.map((task) => task.id);

  const stock = await conn
    .select({
      type: stockMovements.type,
      referenceType: stockMovements.referenceType,
      lines: sql<number>`count(*)::int`,
      quantity: sql<string>`sum(${stockMovements.quantity})::numeric(18,4)`,
      at: sql<Date>`max(${stockMovements.createdAt})`,
    })
    .from(stockMovements)
    .where(and(eq(stockMovements.companyId, companyId), inArray(stockMovements.referenceId, [orderId, ...taskIds])))
    .groupBy(stockMovements.type, stockMovements.referenceType);

  const collected = taskIds.length
    ? await conn
        .select({ taskId: deliveryPayments.taskId, method: deliveryPayments.method, amount: deliveryPayments.amount, collectedAt: deliveryPayments.collectedAt })
        .from(deliveryPayments)
        .where(inArray(deliveryPayments.taskId, taskIds))
        .orderBy(asc(deliveryPayments.collectedAt))
    : [];
  const payments = await conn
    .select({ id: customerPayments.id, amount: customerPayments.amount, method: customerPayments.method, paymentDate: customerPayments.paymentDate, status: customerPayments.status })
    .from(customerPayments)
    .where(and(eq(customerPayments.companyId, companyId), eq(customerPayments.orderId, orderId)))
    .orderBy(desc(customerPayments.paymentDate));

  // Topshirish: pulni yig'gan yetkazuvchi(lar) va savdo agentidagi hali kassaga topshirilmagan naqd
  const agentIds = [...new Set(tasks.map((task) => task.deliveryAgentId).filter((id): id is string => Boolean(id)))];
  const cashHolders = await conn
    .select({ id: cashAccounts.id, name: cashAccounts.name, balance: cashAccounts.balance, deliveryAgentId: cashAccounts.deliveryAgentId, salesRepId: cashAccounts.salesRepId })
    .from(cashAccounts)
    .where(
      and(
        eq(cashAccounts.companyId, companyId),
        or(eq(cashAccounts.salesRepId, order.salesRepId), agentIds.length ? inArray(cashAccounts.deliveryAgentId, agentIds) : sql`false`),
      ),
    );

  const { customerDebt, ...orderRest } = order;
  return {
    agent: { salesRepId: order.salesRepId, name: order.salesRepName, actingUserId: order.actingUserId, actingUserName: order.actingUserName, overrideReason: order.overrideReason },
    order: orderRest,
    warehouse: { name: order.warehouseName, movements: stock },
    delivery: tasks,
    payments: { collected, customerPayments: payments },
    debt: { customerId: order.customerId, customerName: order.customerName, totalDebt: customerDebt, orderBalance: fromMinor(toMinor(order.totalAmount) - toMinor(order.paidAmount)) },
    handover: cashHolders,
  };
}
