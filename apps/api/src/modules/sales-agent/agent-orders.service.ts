/**
 * Agent buyurtmasi.
 *
 *  - Katalog: faqat sotiladigan faol mahsulotlar, sahifalab; dona narxi (valyuta kursi bilan asosiy valyutada),
 *    blok (mahsulot sotuv birligi yoki mahsulotga xos konversiya) narxi, ombordagi mavjud qoldiq.
 *  - Qoralama: `PUT /orders/drafts/:clientRequestId` — agent qurilmasi yaratgan identifikator bilan: birinchi so'rov
 *    yaratadi, takroriy so'rov (tarmoq uzilishi) o'sha qoralamani yangilaydi — takror buyurtma bo'lmaydi.
 *  - Yuborish — bitta tranzaksiya: hudud, joy sifati, geofence (do'kon koordinatasi majburiy), yetkazish kuni siyosati,
 *    nasiya muddati, joriy narx bilan qayta hisob, qoldiq, kredit limiti (siyosat: rad yoki supervayzer tasdig'i),
 *    tashrifga bog'lash, tasdiqlash. Geofence buzilishi hodisa, audit va supervayzer bildirishnomasi bilan saqlanadi.
 *    Qayta yuborish natijani o'zgartirmaydi. Zaxira chiqimi va qarz — mavjud jo'natish qoidasi bo'yicha (ombor).
 */
import { and, asc, desc, eq, ilike, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { AppError, FULL_ACCESS_ROLES, badRequest, conflict, notFound, type SalesAgentPolicy } from "@bum/shared";
import { products, unitConversions, units } from "../../db/schema/catalog.js";
import { routeCustomers, salesReps } from "../../db/schema/crm.js";
import { stockLevels, warehouses } from "../../db/schema/inventory.js";
import { notifications } from "../../db/schema/notifications.js";
import { companyMembers, roles } from "../../db/schema/platform.js";
import { customers, salesOrderItems, salesOrders } from "../../db/schema/sales.js";
import { agentOrders, agentVisits, orderPromotions, type AgentOrderLine } from "../../db/schema/sales-agent.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import { writeAuditLog, type AuditEntry, type RequestMeta } from "../../shared/audit.js";
import { fromMinor, rescale, toMinor } from "../../shared/decimal.js";
import { distanceMeters, pointOf } from "../../shared/geo.js";
import type { StorageClient } from "../../shared/storage.js";
import { categoryScope } from "../catalog/category-scope.js";
import type { TenantContext } from "../company/tenant.js";
import { todayIso } from "../finance/cash.service.js";
import { currencyRate } from "../finance/currencies.service.js";
import { VIEW_TTL } from "../files/files.service.js";
import { cancelOrder, confirmOrder, createOrder, updateOrder, type SalesItemInput } from "../sales/orders.service.js";
import type { AgentContext } from "./agent-context.js";
import { checkLocationQuality, insertLocationEvent, type LocationInput } from "./location.service.js";
import { getSalesAgentPolicy } from "./policy.service.js";
import { activePromotions, applyPromotions, saveOrderPromotions } from "./promotions.service.js";
import { accessibleStore, todayRoutes } from "./stores.service.js";
import { assertVisitReady, finishVisitWithOrder, openStoreVisit } from "./visits.service.js";
import { requireWorkSession } from "./work-session.repo.js";

export type PaymentType = (typeof agentOrders.paymentType.enumValues)[number];
export type ApprovalStatus = (typeof agentOrders.approvalStatus.enumValues)[number];

/** Rad etish hodisasi (va bildirishnoma) saqlanishi uchun xato tranzaksiyadan keyin tashlanadi. */
export type OrderOutcome<T> = { order: T } | { blocked: AppError };

const DAY_MS = 86_400_000;
const shiftDate = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
const mul4 = (a: string, b: string) => fromMinor(rescale(toMinor(a, 4) * toMinor(b, 4), 8, 4), 4);
const likePattern = (value: string) => `%${value.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
const formatMeters = (meters: number) => (meters < 1000 ? `${meters} m` : `${(meters / 1000).toFixed(1)} km`);
/** Toshkent vaqti HH:MM. */
const clock = (date: Date) => new Date(date.getTime() + 5 * 3_600_000).toISOString().slice(11, 16);

function audit(tx: Tx, tenant: TenantContext, meta: RequestMeta, entry: Omit<AuditEntry, "userId" | "userName" | "companyId">) {
  return writeAuditLog({ userId: tenant.user.id, userName: tenant.user.name, companyId: tenant.company.id, ...entry, ...meta }, tx);
}

// ─── Katalog ─────────────────────────────────────────────────────────────────

type BoxUnit = { unitId: string; unitName: string; factor: string };

/** Blok (qadoq): mahsulot sotuv birligi konversiyasi, bo'lmasa mahsulotga xos eng katta konversiya. */
async function boxUnits(conn: DbOrTx, companyId: string, rows: { id: string; baseUnitId: string; salesUnitId: string | null }[]) {
  const result = new Map<string, BoxUnit>();
  if (rows.length === 0) return result;
  const conversions = await conn
    .select({
      productId: unitConversions.productId,
      fromUnitId: unitConversions.fromUnitId,
      toUnitId: unitConversions.toUnitId,
      factor: unitConversions.factor,
      unitName: units.shortName,
    })
    .from(unitConversions)
    .innerJoin(units, eq(units.id, unitConversions.fromUnitId))
    .where(
      and(
        eq(unitConversions.companyId, companyId),
        or(inArray(unitConversions.productId, rows.map((row) => row.id)), isNull(unitConversions.productId)),
      ),
    );
  for (const product of rows) {
    const toBase = conversions.filter((c) => c.toUnitId === product.baseUnitId);
    const own = toBase
      .filter((c) => c.productId === product.id)
      .sort((a, b) => Number(toMinor(b.factor, 4) - toMinor(a.factor, 4)));
    const salesUnit = product.salesUnitId && product.salesUnitId !== product.baseUnitId ? product.salesUnitId : null;
    const bySalesUnit = salesUnit
      ? (own.find((c) => c.fromUnitId === salesUnit) ?? toBase.find((c) => c.productId === null && c.fromUnitId === salesUnit))
      : undefined;
    const pick = bySalesUnit ?? own[0];
    if (pick) result.set(product.id, { unitId: pick.fromUnitId, unitName: pick.unitName, factor: pick.factor });
  }
  return result;
}

/** Agent buyurtmalari ombori: standart, bo'lmasa birinchi faol ombor. */
async function agentWarehouseId(conn: DbOrTx, companyId: string) {
  const [warehouse] = await conn
    .select({ id: warehouses.id })
    .from(warehouses)
    .where(and(eq(warehouses.companyId, companyId), eq(warehouses.isActive, true)))
    .orderBy(desc(warehouses.isDefault), asc(warehouses.createdAt))
    .limit(1);
  return warehouse?.id ?? null;
}

export async function agentCatalog(
  conn: DbOrTx,
  context: AgentContext,
  options: { search?: string; categoryId?: string; limit: number; offset: number },
) {
  const companyId = context.company.id;
  const warehouseId = await agentWarehouseId(conn, companyId);
  const scope = await categoryScope(conn, context);
  const pattern = options.search ? likePattern(options.search) : null;

  const rows = await conn
    .select({
      id: products.id,
      name: products.name,
      sku: products.sku,
      categoryId: products.categoryId,
      baseUnitId: products.baseUnitId,
      salesUnitId: products.salesUnitId,
      unitName: units.shortName,
      salesPrice: products.salesPrice,
      salesCurrency: products.salesCurrency,
      hasImage: sql<boolean>`${products.imageKey} is not null`,
      available: warehouseId
        ? sql<string>`coalesce((select sl."quantity" - sl."reserved_qty" from "stock_levels" sl where sl."product_id" = "products"."id" and sl."warehouse_id" = ${warehouseId}), 0)::numeric(18,4)::text`
        : sql<string>`'0.0000'`,
    })
    .from(products)
    .innerJoin(units, eq(units.id, products.baseUnitId))
    .where(
      and(
        eq(products.companyId, companyId),
        eq(products.isActive, true),
        eq(products.isSaleable, true),
        scope === null ? undefined : scope.length > 0 ? inArray(products.categoryId, scope) : sql`false`,
        options.categoryId ? eq(products.categoryId, options.categoryId) : undefined,
        pattern ? or(ilike(products.name, pattern), ilike(products.sku, pattern), ilike(products.barcode, pattern)) : undefined,
      ),
    )
    .orderBy(asc(products.name), asc(products.id))
    .limit(options.limit + 1)
    .offset(options.offset);

  const page = rows.slice(0, options.limit);
  const boxes = await boxUnits(conn, companyId, page);
  const promotionsByProduct = await activePromotions(conn, companyId, todayIso(), page.map((row) => row.id));
  const rates = new Map<string, string>();
  const items = [];
  for (const { baseUnitId: _baseUnitId, salesUnitId: _salesUnitId, salesPrice, salesCurrency, ...row } of page) {
    // Narxi boshqa valyutada — sotuv buyurtmasi bilan bir xil: joriy kurs bilan asosiy valyutada
    let piecePrice = salesPrice;
    if (salesCurrency) {
      if (!rates.has(salesCurrency)) rates.set(salesCurrency, await currencyRate(conn, companyId, salesCurrency));
      piecePrice = mul4(salesPrice, rates.get(salesCurrency)!);
    }
    const box = boxes.get(row.id);
    items.push({
      ...row,
      piecePrice,
      box: box ? { ...box, price: mul4(piecePrice, box.factor) } : null,
      promotions: promotionsByProduct.get(row.id) ?? [],
    });
  }
  return { products: items, nextOffset: rows.length > options.limit ? options.offset + options.limit : null };
}

/** Mahsulot rasmi — imzolangan qisqa muddatli havola (saqlash ochiq emas). */
export async function catalogImageUrl(conn: DbOrTx, context: AgentContext, productId: string, client: StorageClient) {
  const [product] = await conn
    .select({ key: products.imageKey })
    .from(products)
    .where(and(eq(products.id, productId), eq(products.companyId, context.company.id), eq(products.isActive, true)))
    .limit(1);
  if (!product?.key) throw notFound("Rasm topilmadi");
  return { url: client.signedUrl("GET", product.key, VIEW_TTL), expiresIn: VIEW_TTL };
}

// ─── Qatorlar, yetkazish kuni, qoldiq ────────────────────────────────────────

type LineInput = { productId: string; pieces: string; boxes: string };

/** Dona + blok × koeffitsient = asosiy birlikdagi miqdor (server hisoblaydi). Nol qatorlar tashlab yuboriladi. */
async function resolveLines(conn: DbOrTx, companyId: string, input: LineInput[]) {
  const ids = input.map((line) => line.productId);
  if (new Set(ids).size !== ids.length) throw badRequest("Bir mahsulot buyurtmada bir marta bo'ladi");
  const rows =
    ids.length > 0
      ? await conn
          .select({ id: products.id, name: products.name, baseUnitId: products.baseUnitId, salesUnitId: products.salesUnitId })
          .from(products)
          .where(and(eq(products.companyId, companyId), inArray(products.id, ids)))
      : [];
  const byId = new Map(rows.map((row) => [row.id, row]));
  const boxes = await boxUnits(conn, companyId, rows);

  const lines: AgentOrderLine[] = [];
  const items: SalesItemInput[] = [];
  for (const line of input) {
    const product = byId.get(line.productId);
    if (!product) throw badRequest("Mahsulot topilmadi");
    const box = boxes.get(product.id) ?? null;
    const pieces = toMinor(line.pieces, 4);
    const boxCount = toMinor(line.boxes, 4);
    if (boxCount > 0n && !box) throw badRequest(`${product.name}: blok (qadoq) birligi belgilanmagan`);
    const quantity = pieces + (box ? rescale(boxCount * toMinor(box.factor, 4), 8, 4) : 0n);
    if (quantity === 0n) continue;
    lines.push({
      productId: product.id,
      pieces: fromMinor(pieces, 4),
      boxes: fromMinor(boxCount, 4),
      boxUnitId: box?.unitId ?? null,
      boxFactor: box?.factor ?? null,
    });
    items.push({ productId: product.id, unitId: product.baseUnitId, quantity: fromMinor(quantity, 4) });
  }
  if (items.length === 0) throw badRequest("Kamida bitta mahsulot miqdorini kiriting", { reason: "empty_order" });
  return { lines, items };
}

/**
 * Yetkazish kuni: "assigned" — supervayzer bugungi marshrut biriktirishida belgilagan kun (agent yuborgani e'tiborsiz);
 * "choose" — agent bugundan `maxDeliveryDays` gacha tanlaydi (yuborishda majburiy).
 */
async function resolveDeliveryDate(
  conn: DbOrTx,
  context: AgentContext,
  customerId: string,
  policy: SalesAgentPolicy,
  requested: string | null | undefined,
  required: boolean,
) {
  const today = todayIso();
  if (policy.deliveryDateMode === "assigned") {
    const routes = (await todayRoutes(conn, context, today)).filter((route) => route.deliveryDate);
    if (routes.length === 0) return null;
    const [member] = await conn
      .select({ routeId: routeCustomers.routeId })
      .from(routeCustomers)
      .where(and(eq(routeCustomers.customerId, customerId), inArray(routeCustomers.routeId, routes.map((route) => route.id))))
      .limit(1);
    return routes.find((route) => route.id === member?.routeId)?.deliveryDate ?? null;
  }
  if (!requested) {
    if (required) throw badRequest("Yetkazib berish kunini tanlang", { reason: "delivery_date_required" });
    return null;
  }
  const latest = shiftDate(today, policy.maxDeliveryDays);
  if (requested < today || requested > latest) {
    throw badRequest(`Yetkazib berish kuni ${today} — ${latest} oralig'ida bo'lishi kerak`, { reason: "delivery_date_out_of_range" });
  }
  return requested;
}

/** Qoldiq: bir mahsulotning barcha qatorlari (to'lanadigan va aksiya bo'yicha bepul) jamlanadi. */
async function assertStock(tx: Tx, companyId: string, warehouseId: string, items: SalesItemInput[]) {
  const requested = new Map<string, bigint>();
  for (const item of items) requested.set(item.productId, (requested.get(item.productId) ?? 0n) + toMinor(item.quantity, 4));
  const ids = [...requested.keys()];
  const levels = await tx
    .select({ productId: stockLevels.productId, quantity: stockLevels.quantity, reservedQty: stockLevels.reservedQty })
    .from(stockLevels)
    .where(and(eq(stockLevels.companyId, companyId), eq(stockLevels.warehouseId, warehouseId), inArray(stockLevels.productId, ids)));
  const available = new Map(levels.map((row) => [row.productId, toMinor(row.quantity, 4) - toMinor(row.reservedQty, 4)]));
  const names = new Map(
    (await tx.select({ id: products.id, name: products.name }).from(products).where(inArray(products.id, ids))).map((row) => [row.id, row.name]),
  );
  for (const [productId, need] of requested) {
    const have = available.get(productId) ?? 0n;
    if (need > have) {
      const left = fromMinor(have > 0n ? have : 0n, 4);
      throw badRequest(`${names.get(productId)}: omborda yetarli emas (mavjud ${left})`, {
        reason: "out_of_stock",
        productId,
        available: left,
      });
    }
  }
}

/** `sales_agent.supervise` ruxsati bor (yoki to'liq huquqli) faol a'zolarga shaxsiy bildirishnoma. */
async function notifySupervisors(
  tx: Tx,
  companyId: string,
  input: { title: string; message: string; relatedType: string; relatedId: string; link: string },
) {
  const members = await tx
    .select({
      userId: companyMembers.userId,
      companyRole: companyMembers.companyRole,
      permissions: roles.permissions,
      roleActive: roles.isActive,
    })
    .from(companyMembers)
    .leftJoin(
      roles,
      sql`(${companyMembers.roleId} is not null and ${roles.id} = ${companyMembers.roleId})
        or (${companyMembers.roleId} is null and ${roles.name} = ${companyMembers.companyRole}
            and (${roles.companyId} = ${companyId} or ${roles.companyId} is null))`,
    )
    .where(and(eq(companyMembers.companyId, companyId), eq(companyMembers.isActive, true)));
  const recipients = new Set<string>();
  for (const member of members) {
    const fullAccess = (FULL_ACCESS_ROLES as readonly string[]).includes(member.companyRole);
    if (fullAccess || (member.roleActive && member.permissions?.includes("sales_agent.supervise"))) recipients.add(member.userId);
  }
  if (recipients.size === 0) return;
  await tx.insert(notifications).values(
    [...recipients].map((userId) => ({
      companyId,
      userId,
      isGlobal: false,
      type: "system" as const,
      severity: "warning" as const,
      title: input.title,
      message: input.message,
      relatedType: input.relatedType,
      relatedId: input.relatedId,
      link: input.link,
    })),
  );
}

// ─── Ko'rinish ───────────────────────────────────────────────────────────────

const orderFields = {
  id: salesOrders.id,
  number: salesOrders.number,
  status: salesOrders.status,
  orderDate: salesOrders.orderDate,
  deliveryDate: salesOrders.deliveryDate,
  currency: salesOrders.currency,
  subtotal: salesOrders.subtotal,
  taxAmount: salesOrders.taxAmount,
  discountAmount: salesOrders.discountAmount,
  totalAmount: salesOrders.totalAmount,
  paidAmount: salesOrders.paidAmount,
  notes: salesOrders.notes,
  customerId: agentOrders.customerId,
  customerName: customers.name,
  salesRepId: agentOrders.salesRepId,
  salesRepName: salesReps.name,
  visitId: agentOrders.visitId,
  clientRequestId: agentOrders.clientRequestId,
  paymentType: agentOrders.paymentType,
  paymentDueDate: agentOrders.paymentDueDate,
  lines: agentOrders.lines,
  submittedAt: agentOrders.submittedAt,
  submitDistanceMeters: agentOrders.submitDistanceMeters,
  approvalStatus: agentOrders.approvalStatus,
  rejectionReason: agentOrders.rejectionReason,
  createdAt: agentOrders.createdAt,
  updatedAt: agentOrders.updatedAt,
};

type OrderFilter = {
  orderId?: string;
  salesRepId?: string;
  customerId?: string;
  approval?: ApprovalStatus;
  state?: "draft" | "submitted";
  date?: string;
};

function findOrders(conn: DbOrTx, companyId: string, filter: OrderFilter, limit: number) {
  return conn
    .select(orderFields)
    .from(agentOrders)
    .innerJoin(salesOrders, eq(salesOrders.id, agentOrders.orderId))
    .innerJoin(customers, eq(customers.id, agentOrders.customerId))
    .innerJoin(salesReps, eq(salesReps.id, agentOrders.salesRepId))
    .where(
      and(
        eq(agentOrders.companyId, companyId),
        filter.orderId ? eq(agentOrders.orderId, filter.orderId) : undefined,
        filter.salesRepId ? eq(agentOrders.salesRepId, filter.salesRepId) : undefined,
        filter.customerId ? eq(agentOrders.customerId, filter.customerId) : undefined,
        filter.approval ? eq(agentOrders.approvalStatus, filter.approval) : undefined,
        filter.state === "draft" ? and(isNull(agentOrders.submittedAt), eq(salesOrders.status, "draft")) : undefined,
        filter.state === "submitted" ? isNotNull(agentOrders.submittedAt) : undefined,
        filter.date ? eq(salesOrders.orderDate, filter.date) : undefined,
      ),
    )
    .orderBy(desc(agentOrders.updatedAt))
    .limit(limit);
}

async function orderView(conn: DbOrTx, companyId: string, orderId: string, salesRepId?: string) {
  const [order] = await findOrders(conn, companyId, { orderId, salesRepId }, 1);
  if (!order) throw notFound("Buyurtma topilmadi");
  const items = await conn
    .select({
      productId: salesOrderItems.productId,
      productName: products.name,
      quantity: salesOrderItems.quantity,
      unitPrice: salesOrderItems.unitPrice,
      discountPercent: salesOrderItems.discountPercent,
      lineTotal: salesOrderItems.lineTotal,
    })
    .from(salesOrderItems)
    .innerJoin(products, eq(products.id, salesOrderItems.productId))
    .where(eq(salesOrderItems.orderId, orderId))
    .orderBy(asc(products.name), asc(salesOrderItems.unitPrice));
  const promotionsApplied = await conn
    .select({
      promotionId: orderPromotions.promotionId,
      productId: orderPromotions.productId,
      rule: orderPromotions.rule,
      paidQuantity: orderPromotions.paidQuantity,
      freeQuantity: orderPromotions.freeQuantity,
      discountAmount: orderPromotions.discountAmount,
    })
    .from(orderPromotions)
    .where(eq(orderPromotions.orderId, orderId));
  return { ...order, items, promotions: promotionsApplied };
}

export type AgentOrderView = Awaited<ReturnType<typeof orderView>>;

export function listAgentOrders(conn: DbOrTx, context: AgentContext, options: { state?: "draft" | "submitted"; customerId?: string }) {
  return findOrders(conn, context.company.id, { salesRepId: context.agent.id, ...options }, 100);
}

export function getAgentOrder(conn: DbOrTx, context: AgentContext, orderId: string) {
  return orderView(conn, context.company.id, orderId, context.agent.id);
}

// ─── Qoralama ────────────────────────────────────────────────────────────────

export type DraftInput = {
  customerId: string;
  items: LineInput[];
  paymentType: PaymentType;
  paymentDueDate?: string | null;
  deliveryDate?: string | null;
  notes?: string | null;
};

export async function saveAgentDraft(tx: Tx, context: AgentContext, clientRequestId: string, input: DraftInput, meta: RequestMeta) {
  const companyId = context.company.id;
  // Bir agentning parallel so'rovlari navbatma-navbat (bir identifikator — bitta buyurtma)
  await tx.select({ id: salesReps.id }).from(salesReps).where(eq(salesReps.id, context.agent.id)).for("update");
  const [existing] = await tx
    .select({ orderId: agentOrders.orderId, customerId: agentOrders.customerId, submittedAt: agentOrders.submittedAt, status: salesOrders.status })
    .from(agentOrders)
    .innerJoin(salesOrders, eq(salesOrders.id, agentOrders.orderId))
    .where(
      and(
        eq(agentOrders.companyId, companyId),
        eq(agentOrders.salesRepId, context.agent.id),
        eq(agentOrders.clientRequestId, clientRequestId),
      ),
    )
    .limit(1);
  if (existing && existing.customerId !== input.customerId) throw conflict("Bu so'rov identifikatori boshqa do'kon buyurtmasiga tegishli");
  if (existing && (existing.submittedAt || existing.status !== "draft")) throw conflict("Buyurtma yuborilgan — o'zgartirib bo'lmaydi");

  await accessibleStore(tx, context, input.customerId);
  const policy = await getSalesAgentPolicy(tx, companyId);
  const { lines, items } = await resolveLines(tx, companyId, input.items);
  const priced = await applyPromotions(tx, companyId, input.customerId, items);
  const deliveryDate = await resolveDeliveryDate(tx, context, input.customerId, policy, input.deliveryDate, false);
  if (input.paymentDueDate && input.paymentDueDate < todayIso()) {
    throw badRequest("To'lov muddati bugundan oldin bo'lmaydi", { reason: "due_date_past" });
  }
  const paymentDueDate = input.paymentType === "credit" ? (input.paymentDueDate ?? null) : null;
  const notes = input.notes?.trim() || null;

  let orderId: string;
  if (existing) {
    orderId = existing.orderId;
    await updateOrder(tx, context, orderId, { items: priced.items, deliveryDate, notes }, meta, { trustedPricing: true });
    await tx
      .update(agentOrders)
      .set({ lines, paymentType: input.paymentType, paymentDueDate, updatedAt: new Date() })
      .where(eq(agentOrders.orderId, orderId));
  } else {
    const warehouseId = await agentWarehouseId(tx, companyId);
    if (!warehouseId) throw badRequest("Kompaniyada faol ombor yo'q");
    const order = await createOrder(
      tx,
      context,
      { customerId: input.customerId, warehouseId, orderDate: todayIso(), deliveryDate, notes, items: priced.items },
      meta,
      { trustedPricing: true },
    );
    orderId = order.id;
    await tx.insert(agentOrders).values({
      orderId,
      companyId,
      salesRepId: context.agent.id,
      customerId: input.customerId,
      clientRequestId,
      paymentType: input.paymentType,
      paymentDueDate,
      lines,
    });
    await audit(tx, context, meta, {
      action: "ORDER_CREATED",
      resource: "sales_orders",
      resourceId: orderId,
      details: { number: order.number, customerId: input.customerId, clientRequestId },
    });
  }
  await saveOrderPromotions(tx, companyId, orderId, priced.applied);
  return orderView(tx, companyId, orderId, context.agent.id);
}

// ─── Yuborish ────────────────────────────────────────────────────────────────

export async function submitAgentOrder(
  tx: Tx,
  context: AgentContext,
  orderId: string,
  input: LocationInput,
  meta: RequestMeta,
): Promise<OrderOutcome<AgentOrderView>> {
  const companyId = context.company.id;
  const [row] = await tx
    .select({
      customerId: agentOrders.customerId,
      lines: agentOrders.lines,
      paymentType: agentOrders.paymentType,
      paymentDueDate: agentOrders.paymentDueDate,
      submittedAt: agentOrders.submittedAt,
      status: salesOrders.status,
      number: salesOrders.number,
      deliveryDate: salesOrders.deliveryDate,
      warehouseId: salesOrders.warehouseId,
    })
    .from(agentOrders)
    .innerJoin(salesOrders, eq(salesOrders.id, agentOrders.orderId))
    .where(and(eq(agentOrders.orderId, orderId), eq(agentOrders.companyId, companyId), eq(agentOrders.salesRepId, context.agent.id)))
    .limit(1)
    .for("update");
  if (!row) throw notFound("Buyurtma topilmadi");
  // Takroriy yuborish (javob yetib kelmay qayta urinish) — natija o'zgarmaydi
  if (row.submittedAt) return { order: await orderView(tx, companyId, orderId, context.agent.id) };
  if (row.status !== "draft") throw conflict("Buyurtma qoralama emas");
  await requireWorkSession(tx, context.agent.id);

  const store = await accessibleStore(tx, context, row.customerId);
  const policy = await getSalesAgentPolicy(tx, companyId);

  const rejection = checkLocationQuality(policy, input);
  if (rejection) {
    await insertLocationEvent(tx, context, rejection.reason, input, { action: "order_submit", orderId });
    return { blocked: badRequest(rejection.message, { reason: rejection.reason }) };
  }
  const storePoint = pointOf(store.latitude, store.longitude);
  if (!storePoint) {
    throw badRequest("Do'kon koordinatasi kiritilmagan — buyurtma geofence tekshiruvisiz yuborilmaydi. Supervayzerga murojaat qiling", {
      reason: "store_location_missing",
    });
  }
  const distance = Math.round(distanceMeters(input, storePoint));
  if (distance > policy.geofenceRadiusMeters) {
    const details = {
      action: "order_submit",
      orderId,
      number: row.number,
      customerId: store.id,
      latitude: input.latitude,
      longitude: input.longitude,
      accuracy: input.accuracy,
      storeLatitude: storePoint.latitude,
      storeLongitude: storePoint.longitude,
      distanceMeters: distance,
      radiusMeters: policy.geofenceRadiusMeters,
    };
    await insertLocationEvent(tx, context, "geofence_block", input, details);
    await audit(tx, context, meta, { action: "GEO_FENCE_ORDER_ATTEMPT", resource: "sales_orders", resourceId: orderId, severity: "warning", details });
    await notifySupervisors(tx, companyId, {
      title: "Geo-fence buzilishi",
      message: `Xodim: ${context.agent.name}. Do'kon: ${store.name}. Ruxsat: ${policy.geofenceRadiusMeters} m. Agent masofasi: ${formatMeters(distance)}. Vaqt: ${clock(new Date())}`,
      relatedType: "sales_orders",
      relatedId: orderId,
      link: "/distribution",
    });
    return {
      blocked: new AppError(
        "FORBIDDEN",
        `Siz do'kondan ${distance} m uzoqdasiz — buyurtma ${policy.geofenceRadiusMeters} m ichida yuboriladi`,
        { reason: "geofence", distanceMeters: distance, radiusMeters: policy.geofenceRadiusMeters },
      ),
    };
  }

  // Tashrif: shu do'konda ochiq, hududdan chiqib bekor bo'lmagan, rasmlar va minimal vaqt (siyosat bo'yicha)
  const storeVisit = policy.orderRequiresVisit ? await openStoreVisit(tx, context.agent.id, row.customerId) : null;
  if (policy.orderRequiresVisit) {
    if (!storeVisit) {
      throw badRequest("Buyurtma do'kondagi tashrifda yuboriladi — avval tashrifni boshlang", { reason: "visit_required" });
    }
    if (storeVisit.invalidatedAt) {
      throw badRequest("Tashrif do'kon hududidan chiqilgani uchun bekor qilingan — yangi tashrif boshlang", { reason: "visit_invalid" });
    }
    await assertVisitReady(tx, storeVisit, policy, { shelf: true, duration: true });
  }

  const deliveryDate = await resolveDeliveryDate(tx, context, row.customerId, policy, row.deliveryDate, true);
  if (row.paymentType === "credit") {
    if (policy.creditDueDateRequired && !row.paymentDueDate) {
      throw badRequest("Nasiya buyurtma uchun to'lov muddatini kiriting", { reason: "due_date_required" });
    }
    if (row.paymentDueDate && row.paymentDueDate < todayIso()) {
      throw badRequest("To'lov muddati o'tib ketgan — yangilang", { reason: "due_date_past" });
    }
  }

  // Joriy narx, aksiya va yetkazish kuni bilan qayta hisoblash, keyin qoldiq (bepul miqdor bilan)
  const { items } = await resolveLines(tx, companyId, row.lines);
  const priced = await applyPromotions(tx, companyId, row.customerId, items);
  await updateOrder(tx, context, orderId, { items: priced.items, deliveryDate }, meta, { trustedPricing: true });
  await saveOrderPromotions(tx, companyId, orderId, priced.applied);
  const [order] = await tx.select({ totalAmount: salesOrders.totalAmount }).from(salesOrders).where(eq(salesOrders.id, orderId)).limit(1);
  await assertStock(tx, companyId, row.warehouseId, priced.items);

  let pendingApproval = false;
  if (row.paymentType === "credit") {
    const [customer] = await tx
      .select({ totalDebt: customers.totalDebt, creditLimit: customers.creditLimit })
      .from(customers)
      .where(eq(customers.id, row.customerId))
      .limit(1)
      .for("update");
    const limit = toMinor(customer!.creditLimit);
    if (limit > 0n) {
      // Qarz + hali jo'natilmagan tasdiqlangan buyurtmalar + shu buyurtma
      const [open] = await tx
        .select({ amount: sql<string>`coalesce(sum(${salesOrders.totalAmount} - ${salesOrders.paidAmount}), 0)::numeric(18,2)::text` })
        .from(salesOrders)
        .where(
          and(
            eq(salesOrders.companyId, companyId),
            eq(salesOrders.customerId, row.customerId),
            eq(salesOrders.status, "confirmed"),
            ne(salesOrders.id, orderId),
          ),
        );
      const exposure = toMinor(customer!.totalDebt) + toMinor(open!.amount) + toMinor(order!.totalAmount);
      if (exposure > limit) {
        if (policy.creditLimitPolicy === "block") {
          throw badRequest(`Kredit limitidan oshadi (limit ${fromMinor(limit)}, qarz va ochiq buyurtmalar bilan ${fromMinor(exposure)})`, {
            reason: "credit_limit",
            limit: fromMinor(limit),
            exposure: fromMinor(exposure),
          });
        }
        pendingApproval = true;
      }
    }
  }

  const [openVisit] = storeVisit
    ? [storeVisit]
    : await tx
        .select({ id: agentVisits.id })
        .from(agentVisits)
        .where(and(eq(agentVisits.salesRepId, context.agent.id), eq(agentVisits.customerId, row.customerId), eq(agentVisits.status, "in_progress")))
        .limit(1);
  const now = new Date();
  await tx
    .update(agentOrders)
    .set({
      submittedAt: now,
      submitLatitude: input.latitude.toFixed(6),
      submitLongitude: input.longitude.toFixed(6),
      submitAccuracy: input.accuracy.toFixed(2),
      submitDistanceMeters: distance,
      visitId: openVisit?.id ?? null,
      approvalStatus: pendingApproval ? "pending" : null,
      updatedAt: now,
    })
    .where(eq(agentOrders.orderId, orderId));

  if (pendingApproval) {
    await notifySupervisors(tx, companyId, {
      title: "Buyurtma tasdiq kutmoqda",
      message: `${context.agent.name}: ${store.name}, ${row.number} — ${order!.totalAmount} (kredit limitidan oshadi)`,
      relatedType: "sales_orders",
      relatedId: orderId,
      link: "/distribution",
    });
  } else {
    await confirmOrder(tx, context, orderId, meta);
  }
  await audit(tx, context, meta, {
    action: "ORDER_SUBMITTED",
    resource: "sales_orders",
    resourceId: orderId,
    details: {
      number: row.number,
      customerId: row.customerId,
      totalAmount: order!.totalAmount,
      paymentType: row.paymentType,
      distanceMeters: distance,
      pendingApproval,
    },
  });
  for (const promotion of priced.applied) {
    await audit(tx, context, meta, {
      action: "PROMOTION_APPLIED",
      resource: "sales_orders",
      resourceId: orderId,
      details: { number: row.number, ...promotion },
    });
  }
  if (row.paymentType === "credit") {
    await audit(tx, context, meta, {
      action: "CREDIT_ORDER",
      resource: "sales_orders",
      resourceId: orderId,
      details: { number: row.number, totalAmount: order!.totalAmount, paymentDueDate: row.paymentDueDate },
    });
  }
  // Tashrif buyurtma bilan yakunlanadi — agent bugungi marshrutga qaytadi
  if (storeVisit) await finishVisitWithOrder(tx, context, storeVisit, policy, input, distance, meta);
  return { order: await orderView(tx, companyId, orderId, context.agent.id) };
}

/** Agent faqat yuborilmagan yoki tasdiq kutayotgan buyurtmani bekor qiladi. */
export async function cancelAgentOrder(tx: Tx, context: AgentContext, orderId: string, reason: string | null, meta: RequestMeta) {
  const companyId = context.company.id;
  const [row] = await tx
    .select({ status: salesOrders.status, number: salesOrders.number })
    .from(agentOrders)
    .innerJoin(salesOrders, eq(salesOrders.id, agentOrders.orderId))
    .where(and(eq(agentOrders.orderId, orderId), eq(agentOrders.companyId, companyId), eq(agentOrders.salesRepId, context.agent.id)))
    .limit(1)
    .for("update");
  if (!row) throw notFound("Buyurtma topilmadi");
  if (row.status !== "cancelled") {
    if (row.status !== "draft") throw conflict("Tasdiqlangan buyurtmani ombor yoki menejer bekor qiladi");
    await cancelOrder(tx, context, orderId, reason, meta);
    await tx.update(agentOrders).set({ updatedAt: new Date() }).where(eq(agentOrders.orderId, orderId));
    await audit(tx, context, meta, { action: "ORDER_CANCELLED", resource: "sales_orders", resourceId: orderId, details: { number: row.number, reason } });
  }
  return orderView(tx, companyId, orderId, context.agent.id);
}

// ─── Supervayzer ─────────────────────────────────────────────────────────────

export function supervisorOrders(
  conn: DbOrTx,
  tenant: TenantContext,
  options: { approval?: ApprovalStatus; date?: string; salesRepId?: string; limit: number },
) {
  return findOrders(conn, tenant.company.id, { ...options, state: "submitted" }, options.limit);
}

async function lockPending(tx: Tx, tenant: TenantContext, orderId: string) {
  const [row] = await tx
    .select({
      approvalStatus: agentOrders.approvalStatus,
      status: salesOrders.status,
      number: salesOrders.number,
      warehouseId: salesOrders.warehouseId,
      lines: agentOrders.lines,
    })
    .from(agentOrders)
    .innerJoin(salesOrders, eq(salesOrders.id, agentOrders.orderId))
    .where(and(eq(agentOrders.orderId, orderId), eq(agentOrders.companyId, tenant.company.id)))
    .limit(1)
    .for("update");
  if (!row) throw notFound("Buyurtma topilmadi");
  if (row.approvalStatus !== "pending" || row.status !== "draft") throw conflict("Buyurtma tasdiq kutmayapti");
  return row;
}

export async function approveAgentOrder(tx: Tx, tenant: TenantContext, orderId: string, meta: RequestMeta) {
  const row = await lockPending(tx, tenant, orderId);
  // Yuborilgandagi qatorlar (aksiya bepul miqdori bilan) — qayta narxlanmaydi
  const items = await tx
    .select({ productId: salesOrderItems.productId, unitId: salesOrderItems.unitId, quantity: salesOrderItems.quantity })
    .from(salesOrderItems)
    .where(eq(salesOrderItems.orderId, orderId));
  await assertStock(tx, tenant.company.id, row.warehouseId, items);
  await confirmOrder(tx, tenant, orderId, meta);
  const now = new Date();
  await tx
    .update(agentOrders)
    .set({ approvalStatus: "approved", approvedBy: tenant.user.id, approvedAt: now, updatedAt: now })
    .where(eq(agentOrders.orderId, orderId));
  await audit(tx, tenant, meta, { action: "ORDER_APPROVED", resource: "sales_orders", resourceId: orderId, details: { number: row.number } });
  return orderView(tx, tenant.company.id, orderId);
}

export async function rejectAgentOrder(tx: Tx, tenant: TenantContext, orderId: string, reason: string, meta: RequestMeta) {
  const row = await lockPending(tx, tenant, orderId);
  await cancelOrder(tx, tenant, orderId, reason, meta);
  const now = new Date();
  await tx
    .update(agentOrders)
    .set({ approvalStatus: "rejected", approvedBy: tenant.user.id, approvedAt: now, rejectionReason: reason, updatedAt: now })
    .where(eq(agentOrders.orderId, orderId));
  await audit(tx, tenant, meta, { action: "ORDER_REJECTED", resource: "sales_orders", resourceId: orderId, details: { number: row.number, reason } });
  return orderView(tx, tenant.company.id, orderId);
}
