/**
 * Bildirishnomalar va aqlli ogohlantirishlar (convex/notifications.ts).
 *
 * Kompaniya bo'ylab (global) bildirishnomaning o'qilgan/yopilgan holati har foydalanuvchida
 * alohida (`notification_receipts`); shaxsiy bildirishnoma — o'z qatorida.
 *
 * Convex'dan farqlar:
 *  - global bildirishnomani bir xodim o'qisa, hammada o'qilgan bo'lardi; "o'qilganlarni tozalash"
 *    va o'chirish uni barcha xodimlardan o'chirardi
 *  - istalgan a'zo butun kompaniyaga istalgan havola bilan (tashqi sayt ham) bildirishnoma
 *    yubora olardi — endi `company.manage`, havola faqat ichki yo'l
 *  - aqlli ogohlantirishlarni istalgan foydalanuvchi cheksiz ishga tushirardi — endi kompaniyaga 5 daqiqada bir
 *  - kam zaxira mahsulot bo'yicha (omborni ko'rsatmay) edi — endi ombor bilan; muddati o'tgan mijoz to'lovi
 *    `deliveryDate` bo'yicha edi (ko'pincha bo'sh) — endi buyurtma sanasi + mijozning to'lov muddati;
 *    kechikayotgan xarid buyurtmasi "overdue_payment" turida edi — endi "system"
 *  - `unreadCount` 100 tadan ortig'ini sanamasdi
 */
import { and, count, desc, eq, gte, inArray, isNotNull, isNull, lte, notInArray, or, sql } from "drizzle-orm";
import { badRequest, notFound, type ModuleKey, type Permission } from "@bum/shared";
import { batches, products } from "../../db/schema/catalog.js";
import { expenses } from "../../db/schema/finance.js";
import { employees, leaves } from "../../db/schema/hr.js";
import { stockLevels, warehouses } from "../../db/schema/inventory.js";
import { notificationReceipts, notifications } from "../../db/schema/notifications.js";
import { companyMembers } from "../../db/schema/platform.js";
import { purchaseOrders, suppliers } from "../../db/schema/purchase.js";
import { customers, salesOrders } from "../../db/schema/sales.js";
import { withTransaction, type DbOrTx, type Tx } from "../../db/transaction.js";
import { writeAuditLog, type RequestMeta } from "../../shared/audit.js";
import { fromMinor, toMinor } from "../../shared/decimal.js";
import { recordHit } from "../../shared/rate-limit.js";
import { companyModuleStates } from "../company/modules.service.js";
import { effectivePermissions, type TenantContext } from "../company/tenant.js";
import { todayIso } from "../finance/cash.service.js";
import { shiftDate, trimDecimal } from "../analytics/dates.js";

export type NotificationType = (typeof notifications.type.enumValues)[number];
export type NotificationSeverity = (typeof notifications.severity.enumValues)[number];

const readSql = sql<boolean>`case when ${notifications.isGlobal} then ${notificationReceipts.readAt} is not null else ${notifications.isRead} end`;

function receiptJoin(tenant: TenantContext) {
  return and(eq(notificationReceipts.notificationId, notifications.id), eq(notificationReceipts.userId, tenant.user.id));
}

/**
 * Kompaniya bo'ylab aqlli ogohlantirish (manba turi) → ko'rish ruxsati: xarajat summasi, xodim ta'tili, qarzdorlar va
 * zaxira ma'lumoti shu bo'limga ruxsati yo'q xodimga (masalan, kassirga) ko'rinmaydi.
 */
const ALERT_PERMISSIONS: Record<string, Permission> = {
  expenses: "finance.view",
  leaves: "hr.view",
  stock_levels: "warehouse.view",
  batches: "warehouse.view",
  purchase_orders: "purchase.view",
  sales_orders: "sales.view",
};

/** Ogohlantirish turi → modul: modul o'chiq bo'lsa, ruxsat bo'lsa ham ko'rinmaydi. */
const ALERT_MODULES: Record<string, ModuleKey> = {
  expenses: "finance",
  leaves: "hr",
  stock_levels: "warehouse",
  batches: "warehouse",
  purchase_orders: "purchase",
  sales_orders: "sales",
};

async function hiddenAlertTypes(conn: DbOrTx, tenant: TenantContext): Promise<string[]> {
  const [permissions, modules] = await Promise.all([effectivePermissions(conn, tenant), companyModuleStates(conn, tenant.company.id)]);
  return Object.entries(ALERT_PERMISSIONS)
    .filter(([relatedType, permission]) => !permissions.includes(permission) || modules[ALERT_MODULES[relatedType]!] === false)
    .map(([relatedType]) => relatedType);
}

function visibleTo(tenant: TenantContext, hiddenTypes: readonly string[]) {
  return and(
    eq(notifications.companyId, tenant.company.id),
    or(
      eq(notifications.userId, tenant.user.id),
      and(
        eq(notifications.isGlobal, true),
        isNull(notifications.userId),
        hiddenTypes.length > 0 ? or(isNull(notifications.relatedType), notInArray(notifications.relatedType, [...hiddenTypes])) : undefined,
      ),
    ),
    isNull(notificationReceipts.dismissedAt),
  );
}

export async function listNotifications(conn: DbOrTx, tenant: TenantContext, options: { unreadOnly?: boolean; limit: number }) {
  return conn
    .select({
      id: notifications.id,
      type: notifications.type,
      severity: notifications.severity,
      title: notifications.title,
      message: notifications.message,
      isGlobal: notifications.isGlobal,
      relatedType: notifications.relatedType,
      relatedId: notifications.relatedId,
      link: notifications.link,
      createdAt: notifications.createdAt,
      isRead: readSql,
    })
    .from(notifications)
    .leftJoin(notificationReceipts, receiptJoin(tenant))
    .where(and(visibleTo(tenant, await hiddenAlertTypes(conn, tenant)), options.unreadOnly ? sql`not (${readSql})` : undefined))
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(options.limit);
}

export async function unreadCount(conn: DbOrTx, tenant: TenantContext) {
  const [row] = await conn
    .select({ value: count() })
    .from(notifications)
    .leftJoin(notificationReceipts, receiptJoin(tenant))
    .where(and(visibleTo(tenant, await hiddenAlertTypes(conn, tenant)), sql`not (${readSql})`));
  return row?.value ?? 0;
}

async function loadVisible(tx: Tx, tenant: TenantContext, notificationId: string) {
  const [row] = await tx
    .select({ id: notifications.id, isGlobal: notifications.isGlobal })
    .from(notifications)
    .leftJoin(notificationReceipts, receiptJoin(tenant))
    .where(and(eq(notifications.id, notificationId), visibleTo(tenant, await hiddenAlertTypes(tx, tenant))))
    .limit(1);
  if (!row) throw notFound("Bildirishnoma topilmadi");
  return row;
}

async function upsertReceipt(tx: Tx, tenant: TenantContext, notificationId: string, dismiss: boolean) {
  await tx
    .insert(notificationReceipts)
    .values({
      companyId: tenant.company.id,
      notificationId,
      userId: tenant.user.id,
      readAt: new Date(),
      dismissedAt: dismiss ? new Date() : null,
    })
    .onConflictDoUpdate({
      target: [notificationReceipts.notificationId, notificationReceipts.userId],
      set: {
        readAt: sql`coalesce(${notificationReceipts.readAt}, now())`,
        ...(dismiss ? { dismissedAt: sql`now()` } : {}),
      },
    });
}

export async function markRead(tx: Tx, tenant: TenantContext, notificationId: string) {
  const notification = await loadVisible(tx, tenant, notificationId);
  if (notification.isGlobal) await upsertReceipt(tx, tenant, notificationId, false);
  else await tx.update(notifications).set({ isRead: true, updatedAt: new Date() }).where(eq(notifications.id, notificationId));
}

export async function markAllRead(tx: Tx, tenant: TenantContext) {
  const companyId = tenant.company.id;
  await tx
    .update(notifications)
    .set({ isRead: true, updatedAt: new Date() })
    .where(and(eq(notifications.companyId, companyId), eq(notifications.userId, tenant.user.id), eq(notifications.isRead, false)));
  await tx.execute(sql`
    insert into ${notificationReceipts} (company_id, notification_id, user_id, read_at)
    select ${companyId}, n.id, ${tenant.user.id}, now()
      from ${notifications} n
     where n.company_id = ${companyId} and n.is_global and n.user_id is null
    on conflict (notification_id, user_id) do update set read_at = coalesce(${notificationReceipts}.read_at, now())
  `);
}

export async function dismissNotification(tx: Tx, tenant: TenantContext, notificationId: string) {
  const notification = await loadVisible(tx, tenant, notificationId);
  if (notification.isGlobal) await upsertReceipt(tx, tenant, notificationId, true);
  else await tx.delete(notifications).where(eq(notifications.id, notificationId));
}

export async function clearRead(tx: Tx, tenant: TenantContext) {
  const companyId = tenant.company.id;
  await tx
    .delete(notifications)
    .where(and(eq(notifications.companyId, companyId), eq(notifications.userId, tenant.user.id), eq(notifications.isRead, true)));
  await tx
    .update(notificationReceipts)
    .set({ dismissedAt: new Date() })
    .where(
      and(
        eq(notificationReceipts.companyId, companyId),
        eq(notificationReceipts.userId, tenant.user.id),
        isNotNull(notificationReceipts.readAt),
        isNull(notificationReceipts.dismissedAt),
      ),
    );
}

export async function createNotification(
  tx: Tx,
  tenant: TenantContext,
  input: {
    title: string;
    message: string;
    severity: NotificationSeverity;
    type?: NotificationType;
    userId?: string | null;
    link?: string | null;
  },
  meta: RequestMeta,
) {
  const companyId = tenant.company.id;
  if (input.userId) {
    const [member] = await tx
      .select({ id: companyMembers.id })
      .from(companyMembers)
      .where(and(eq(companyMembers.companyId, companyId), eq(companyMembers.userId, input.userId), eq(companyMembers.isActive, true)))
      .limit(1);
    if (!member) throw badRequest("Qabul qiluvchi kompaniya a'zosi emas");
  }

  const [notification] = await tx
    .insert(notifications)
    .values({
      companyId,
      userId: input.userId ?? null,
      isGlobal: !input.userId,
      type: input.type ?? "system",
      severity: input.severity,
      title: input.title,
      message: input.message,
      link: input.link ?? null,
    })
    .returning({ id: notifications.id, isGlobal: notifications.isGlobal });

  await writeAuditLog(
    {
      userId: tenant.user.id,
      userName: tenant.user.name,
      companyId,
      action: "NOTIFICATION_SENT",
      resource: "notifications",
      resourceId: notification!.id,
      details: { title: input.title, recipient: input.userId ?? "company" },
      ...meta,
    },
    tx,
  );
  return notification!;
}

// ─── Aqlli ogohlantirishlar ──────────────────────────────────────────────────

type AlertInput = {
  type: NotificationType;
  severity: NotificationSeverity;
  title: string;
  message: string;
  relatedType: string;
  relatedId: string;
  link: string;
};

/** Oxirgi 6 soatda shu obyekt uchun bir xil turdagi ogohlantirish bo'lsa — takrorlanmaydi. */
export async function generateSmartAlerts(tx: Tx, companyId: string) {
  const today = todayIso();
  const since = new Date(Date.now() - 6 * 60 * 60 * 1000);
  const recent = await tx
    .select({ type: notifications.type, relatedId: notifications.relatedId })
    .from(notifications)
    .where(and(eq(notifications.companyId, companyId), eq(notifications.isGlobal, true), gte(notifications.createdAt, since)));
  const seen = new Set(recent.map((r) => `${r.type}:${r.relatedId}`));
  const alerts: AlertInput[] = [];
  const push = (alert: AlertInput) => {
    const key = `${alert.type}:${alert.relatedId}`;
    if (seen.has(key)) return;
    seen.add(key);
    alerts.push(alert);
  };

  const lowStock = await tx
    .select({
      id: stockLevels.id,
      quantity: stockLevels.quantity,
      minStock: products.minStock,
      productName: products.name,
      warehouseName: warehouses.name,
    })
    .from(stockLevels)
    .innerJoin(products, eq(products.id, stockLevels.productId))
    .innerJoin(warehouses, eq(warehouses.id, stockLevels.warehouseId))
    .where(
      and(
        eq(stockLevels.companyId, companyId),
        eq(products.isActive, true),
        sql`${products.minStock} > 0 and ${stockLevels.quantity} <= ${products.minStock}`,
      ),
    )
    .limit(500);
  for (const row of lowStock) {
    push({
      type: "low_stock",
      severity: toMinor(row.quantity, 4) === 0n ? "error" : "warning",
      title: "Kam zaxira",
      message: `${row.productName} (${row.warehouseName}): ${trimDecimal(row.quantity)} (minimal: ${trimDecimal(row.minStock)})`,
      relatedType: "stock_levels",
      relatedId: row.id,
      link: "/warehouse",
    });
  }

  const expiring = await tx
    .select({ id: batches.id, batchNumber: batches.batchNumber, expiryDate: batches.expiryDate, productName: products.name })
    .from(batches)
    .innerJoin(products, eq(products.id, batches.productId))
    .where(
      and(
        eq(batches.companyId, companyId),
        sql`${batches.quantity} > 0`,
        gte(batches.expiryDate, today),
        lte(batches.expiryDate, shiftDate(today, 30)),
      ),
    )
    .limit(200);
  for (const batch of expiring) {
    const daysLeft = Math.round((Date.parse(batch.expiryDate!) - Date.parse(today)) / 86_400_000);
    push({
      type: "expiring_soon",
      severity: daysLeft <= 7 ? "error" : "warning",
      title: "Yaroqlilik muddati tugayapti",
      message: `${batch.productName} (partiya ${batch.batchNumber}) — ${daysLeft} kun qoldi`,
      relatedType: "batches",
      relatedId: batch.id,
      link: "/products",
    });
  }

  const latePurchases = await tx
    .select({ id: purchaseOrders.id, number: purchaseOrders.number, expectedDate: purchaseOrders.expectedDate, supplierName: suppliers.name })
    .from(purchaseOrders)
    .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
    .where(
      and(
        eq(purchaseOrders.companyId, companyId),
        inArray(purchaseOrders.status, ["confirmed", "partial"]),
        sql`${purchaseOrders.expectedDate} < ${today}::date`,
      ),
    )
    .limit(200);
  for (const order of latePurchases) {
    push({
      type: "system",
      severity: "warning",
      title: "Yetkazib berish kechikmoqda",
      message: `Xarid ${order.number} (${order.supplierName}) — kutilgan sana ${order.expectedDate}`,
      relatedType: "purchase_orders",
      relatedId: order.id,
      link: "/purchase",
    });
  }

  const overdue = await tx
    .select({
      id: salesOrders.id,
      number: salesOrders.number,
      balance: sql<string>`(${salesOrders.totalAmount} - ${salesOrders.paidAmount})::numeric(18,2)`,
      customerName: customers.name,
    })
    .from(salesOrders)
    .innerJoin(customers, eq(customers.id, salesOrders.customerId))
    .where(
      and(
        eq(salesOrders.companyId, companyId),
        eq(salesOrders.status, "shipped"),
        sql`${salesOrders.totalAmount} > ${salesOrders.paidAmount}`,
        sql`${salesOrders.orderDate} + ${customers.paymentTermDays} < ${today}::date`,
      ),
    )
    .limit(200);
  for (const order of overdue) {
    push({
      type: "overdue_payment",
      severity: "warning",
      title: "To'lov muddati o'tgan",
      message: `Sotuv ${order.number} (${order.customerName}) — qoldiq ${trimDecimal(fromMinor(toMinor(order.balance)))} so'm`,
      relatedType: "sales_orders",
      relatedId: order.id,
      link: "/sales",
    });
  }

  const pendingLeaves = await tx
    .select({ id: leaves.id, startDate: leaves.startDate, endDate: leaves.endDate, days: leaves.days, employeeName: employees.name })
    .from(leaves)
    .innerJoin(employees, eq(employees.id, leaves.employeeId))
    .where(and(eq(leaves.companyId, companyId), eq(leaves.status, "pending")))
    .limit(100);
  for (const leave of pendingLeaves) {
    push({
      type: "leave_request",
      severity: "info",
      title: "Ta'til so'rovi",
      message: `${leave.employeeName} — ${leave.startDate} dan ${leave.endDate} gacha (${trimDecimal(leave.days)} kun)`,
      relatedType: "leaves",
      relatedId: leave.id,
      link: "/hr",
    });
  }

  const pendingExpenses = await tx
    .select({ id: expenses.id, number: expenses.number, description: expenses.description, amount: expenses.amount })
    .from(expenses)
    .where(and(eq(expenses.companyId, companyId), eq(expenses.status, "pending")))
    .limit(100);
  for (const expense of pendingExpenses) {
    push({
      type: "pending_approval",
      severity: "info",
      title: "Tasdiqlash kutilmoqda",
      message: `Xarajat ${expense.number}: ${expense.description} — ${trimDecimal(expense.amount)} so'm`,
      relatedType: "expenses",
      relatedId: expense.id,
      link: "/finance",
    });
  }

  if (alerts.length > 0) {
    await tx.insert(notifications).values(alerts.map((alert) => ({ ...alert, companyId, isGlobal: true })));
  }
  const byType: Record<string, number> = {};
  for (const alert of alerts) byType[alert.type] = (byType[alert.type] ?? 0) + 1;
  return { created: alerts.length, byType };
}

/** Kompaniyaga 5 daqiqada bir marta; ortig'i jimgina o'tkazib yuboriladi. */
export async function refreshSmartAlerts(tenant: TenantContext) {
  const hits = await recordHit(`smart-alerts:${tenant.company.id}`, 300);
  if (hits > 1) return { created: 0, byType: {}, throttled: true };
  const result = await withTransaction((tx) => generateSmartAlerts(tx, tenant.company.id));
  return { ...result, throttled: false };
}
