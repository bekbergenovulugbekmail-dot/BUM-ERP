/**
 * Ishlab chiqarish buyurtmalari (convex/manufacturing/orders.ts).
 *
 * Holatlar: draft → confirmed → in_progress → completed; draft / confirmed / in_progress → cancelled.
 *
 * Yakunlash bitta tranzaksiyada: xomashyo chiqimi (`moveStock`, shu lahzadagi AVCO, birlik
 * konversiyasi bilan), mehnat va mashina vaqti tannarxi, tayyor mahsulot kirimi
 * (tannarx = xomashyo + mehnat, AVCO ga kiradi), mehnat tannarxi jurnali
 * (DR tovar zaxirasi / CR ish haqi xarajatlari — xarajat tayyor mahsulot tannarxiga o'tadi).
 * Xomashyo va tayyor mahsulot bitta "Tovar zaxirasi" hisobida — ular uchun jurnal yozuvi kerak emas.
 *
 * Convex'dan farqlar:
 *  - xomashyo tannarxi buyurtma yaratilgandagi XARID NARXI edi (AVCO emas) — tayyor mahsulot tannarxi noto'g'ri
 *  - zaxira yetmasa jimgina 0 ga tushirilardi; birlik konversiyasi e'tiborsiz edi
 *  - `actualMaterials` boshqa buyurtmaning materialini ham qabul qilardi; ishlab chiqarilgan
 *    miqdor 0 yoki manfiy bo'lishi mumkin edi
 *  - yakunlangan buyurtmaga vaqt yozuvi qo'shilib, tannarx keyin o'zgarardi
 *  - ombor ruxsati tekshirilmasdi; ruxsat nomlari katalogda yo'q edi (`production.*`); o'qish ruxsatsiz
 *  - raqam parallel yaratishda takrorlanardi; summalar float edi
 */
import { and, asc, desc, eq, getTableColumns, gte, inArray, lte, sql } from "drizzle-orm";
import { badRequest, notFound } from "@bum/shared";
import { products, units } from "../../db/schema/catalog.js";
import { stockLevels, warehouses } from "../../db/schema/inventory.js";
import { boms, bomItems, productionMaterials, productionOrders, productionTimeLines, workCenters } from "../../db/schema/manufacturing.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import type { RequestMeta } from "../../shared/audit.js";
import { fromMinor, mulDivRound, rescale, toMinor } from "../../shared/decimal.js";
import { nextDocumentNumber } from "../../shared/numbering.js";
import { unitFactorToBase } from "../catalog/conversions.js";
import type { TenantContext } from "../company/tenant.js";
import { todayIso } from "../finance/cash.service.js";
import { currencyRate } from "../finance/currencies.service.js";
import { postJournalEntry, requireAccountBySubtype } from "../finance/journal.service.js";
import { moveStock } from "../inventory/stock.service.js";
import { assertWarehouseAccess } from "../inventory/warehouses.service.js";
import { manufacturingAudit } from "./boms.service.js";

const { legacyId: _l1, companyId: _c1, ...orderFields } = getTableColumns(productionOrders);
const { legacyId: _l2, companyId: _c2, ...materialFields } = getTableColumns(productionMaterials);
const { legacyId: _l3, companyId: _c3, ...timeLineFields } = getTableColumns(productionTimeLines);

export type ProductionStatus = (typeof productionOrders.status.enumValues)[number];

async function lockOrder(tx: Tx, tenant: TenantContext, orderId: string) {
  const [order] = await tx
    .select(orderFields)
    .from(productionOrders)
    .where(and(eq(productionOrders.id, orderId), eq(productionOrders.companyId, tenant.company.id)))
    .limit(1)
    .for("update");
  if (!order) throw notFound("Ishlab chiqarish buyurtmasi topilmadi");
  return order;
}

/**
 * Omborda qoldiq bo'lsa — o'rtacha tannarx, bo'lmasa xarid narxi (reja uchun taxmin).
 * Xarid narxi boshqa valyutada bo'lsa — joriy kurs bilan asosiy valyutada.
 */
async function estimatedBaseCost(
  tx: Tx,
  companyId: string,
  warehouseId: string,
  product: { id: string; purchasePrice: string; purchaseCurrency?: string | null },
) {
  const [level] = await tx
    .select({ quantity: stockLevels.quantity, avgCostPrice: stockLevels.avgCostPrice })
    .from(stockLevels)
    .where(and(eq(stockLevels.companyId, companyId), eq(stockLevels.productId, product.id), eq(stockLevels.warehouseId, warehouseId)))
    .limit(1);
  if (level && toMinor(level.quantity, 4) > 0n) return level.avgCostPrice;
  if (!product.purchaseCurrency) return product.purchasePrice;
  const rate = await currencyRate(tx, companyId, product.purchaseCurrency);
  return fromMinor(rescale(toMinor(product.purchasePrice, 4) * toMinor(rate, 4), 8, 4), 4);
}

// ─── O'qish ──────────────────────────────────────────────────────────────────

export async function getOrder(conn: DbOrTx, tenant: TenantContext, orderId: string) {
  const [order] = await conn
    .select({
      ...orderFields,
      productName: products.name,
      productSku: products.sku,
      warehouseName: warehouses.name,
      bomName: boms.name,
    })
    .from(productionOrders)
    .innerJoin(products, eq(products.id, productionOrders.productId))
    .innerJoin(warehouses, eq(warehouses.id, productionOrders.warehouseId))
    .innerJoin(boms, eq(boms.id, productionOrders.bomId))
    .where(and(eq(productionOrders.id, orderId), eq(productionOrders.companyId, tenant.company.id)))
    .limit(1);
  if (!order) throw notFound("Ishlab chiqarish buyurtmasi topilmadi");

  const materials = await conn
    .select({ ...materialFields, componentName: products.name, componentSku: products.sku, unitName: units.shortName })
    .from(productionMaterials)
    .innerJoin(products, eq(products.id, productionMaterials.productId))
    .innerJoin(units, eq(units.id, productionMaterials.unitId))
    .where(eq(productionMaterials.orderId, orderId))
    .orderBy(asc(products.name));

  const timeLines = await conn
    .select({ ...timeLineFields, workCenterName: workCenters.name })
    .from(productionTimeLines)
    .innerJoin(workCenters, eq(workCenters.id, productionTimeLines.workCenterId))
    .where(eq(productionTimeLines.orderId, orderId))
    .orderBy(asc(productionTimeLines.createdAt));

  return { ...order, materials, timeLines };
}

export async function listOrders(
  conn: DbOrTx,
  tenant: TenantContext,
  options: { status?: ProductionStatus; productId?: string; dateFrom?: string; dateTo?: string; limit: number },
) {
  return conn
    .select({ ...orderFields, productName: products.name, warehouseName: warehouses.name, bomName: boms.name })
    .from(productionOrders)
    .innerJoin(products, eq(products.id, productionOrders.productId))
    .innerJoin(warehouses, eq(warehouses.id, productionOrders.warehouseId))
    .innerJoin(boms, eq(boms.id, productionOrders.bomId))
    .where(
      and(
        eq(productionOrders.companyId, tenant.company.id),
        options.status ? eq(productionOrders.status, options.status) : undefined,
        options.productId ? eq(productionOrders.productId, options.productId) : undefined,
        options.dateFrom ? gte(productionOrders.plannedDate, options.dateFrom) : undefined,
        options.dateTo ? lte(productionOrders.plannedDate, options.dateTo) : undefined,
      ),
    )
    .orderBy(desc(productionOrders.plannedDate), desc(productionOrders.createdAt))
    .limit(options.limit);
}

export async function productionStats(conn: DbOrTx, tenant: TenantContext) {
  const monthStart = `${todayIso().slice(0, 7)}-01`;
  const byStatus = await conn
    .select({ status: productionOrders.status, count: sql<number>`count(*)::int` })
    .from(productionOrders)
    .where(eq(productionOrders.companyId, tenant.company.id))
    .groupBy(productionOrders.status);

  const [totals] = await conn
    .select({
      total: sql<number>`count(*)::int`,
      completedCost: sql<string>`coalesce(sum(${productionOrders.totalCost}) filter (where ${productionOrders.status} = 'completed'), 0)::numeric(18,2)`,
      completedThisMonth: sql<number>`(count(*) filter (where ${productionOrders.status} = 'completed' and ${productionOrders.completedAt} >= ${monthStart}::date))::int`,
    })
    .from(productionOrders)
    .where(eq(productionOrders.companyId, tenant.company.id));

  return { ...totals!, byStatus };
}

// ─── Hayot sikli ─────────────────────────────────────────────────────────────

export async function createOrder(
  tx: Tx,
  tenant: TenantContext,
  input: { bomId: string; warehouseId: string; plannedQty: string; plannedDate: string; notes?: string | null },
  meta: RequestMeta,
) {
  const companyId = tenant.company.id;
  const [bom] = await tx
    .select({ id: boms.id, productId: boms.productId, quantity: boms.quantity, isActive: boms.isActive })
    .from(boms)
    .where(and(eq(boms.id, input.bomId), eq(boms.companyId, companyId)))
    .limit(1);
  if (!bom) throw badRequest("Retsept topilmadi");
  if (!bom.isActive) throw badRequest("Retsept faol emas");

  const [warehouse] = await tx
    .select({ isActive: warehouses.isActive })
    .from(warehouses)
    .where(and(eq(warehouses.id, input.warehouseId), eq(warehouses.companyId, companyId)))
    .limit(1);
  if (!warehouse) throw badRequest("Ombor topilmadi");
  if (!warehouse.isActive) throw badRequest("Ombor faol emas");
  assertWarehouseAccess(tenant, input.warehouseId);

  const items = await tx.select().from(bomItems).where(eq(bomItems.bomId, bom.id));
  if (items.length === 0) throw badRequest("Retseptda tarkib yo'q");
  const productRows = await tx
    .select({
      id: products.id,
      name: products.name,
      baseUnitId: products.baseUnitId,
      purchasePrice: products.purchasePrice,
      purchaseCurrency: products.purchaseCurrency,
    })
    .from(products)
    .where(inArray(products.id, items.map((i) => i.productId)));
  const productById = new Map(productRows.map((p) => [p.id, p]));

  const planned = toMinor(input.plannedQty, 4);
  if (planned <= 0n) throw badRequest("Rejalashtirilgan miqdor musbat bo'lishi kerak");
  const bomQty = toMinor(bom.quantity, 4);

  let materialCost = 0n;
  const materials: { productId: string; unitId: string; plannedQty: string; unitCost: string; totalCost: string }[] = [];
  for (const item of items) {
    const product = productById.get(item.productId)!;
    // retsept miqdori × (reja / retsept chiqishi) × (1 + chiqindi %)
    const base = mulDivRound(toMinor(item.quantity, 4), planned, bomQty);
    const quantity = mulDivRound(base, 10000n + toMinor(item.scrapPercent, 2), 10000n);
    const factor = await unitFactorToBase(tx, companyId, product, item.unitId);
    const baseCost = await estimatedBaseCost(tx, companyId, input.warehouseId, product);
    const unitCost = rescale(toMinor(baseCost, 4) * toMinor(factor, 4), 8, 4);
    const lineCost = rescale(quantity * unitCost, 8, 2);
    materialCost += lineCost;
    materials.push({
      productId: product.id,
      unitId: item.unitId,
      plannedQty: fromMinor(quantity, 4),
      unitCost: fromMinor(unitCost, 4),
      totalCost: fromMinor(lineCost),
    });
  }

  const number = await nextDocumentNumber(tx, {
    table: productionOrders,
    column: productionOrders.number,
    companyColumn: productionOrders.companyId,
    companyId,
    prefix: `MO-${input.plannedDate.slice(0, 4)}-`,
    width: 4,
  });

  const [order] = await tx
    .insert(productionOrders)
    .values({
      companyId,
      number,
      bomId: bom.id,
      productId: bom.productId,
      warehouseId: input.warehouseId,
      plannedQty: input.plannedQty,
      plannedDate: input.plannedDate,
      notes: input.notes ?? null,
      totalMaterialCost: fromMinor(materialCost),
      totalCost: fromMinor(materialCost),
      unitCost: fromMinor(mulDivRound(materialCost, 1_000_000n, planned), 4),
      createdBy: tenant.user.id,
    })
    .returning({ id: productionOrders.id });
  await tx.insert(productionMaterials).values(materials.map((m) => ({ ...m, companyId, orderId: order!.id })));

  await manufacturingAudit(tx, tenant, meta, {
    action: "PRODUCTION_ORDER_CREATED",
    resource: "production_orders",
    resourceId: order!.id,
    details: { number, bomId: bom.id, plannedQty: input.plannedQty },
  });
  return getOrder(tx, tenant, order!.id);
}

async function transition(
  tx: Tx,
  tenant: TenantContext,
  orderId: string,
  from: ProductionStatus[],
  to: ProductionStatus,
  meta: RequestMeta,
) {
  const order = await lockOrder(tx, tenant, orderId);
  if (!from.includes(order.status)) throw badRequest(`Holatni o'zgartirib bo'lmaydi: ${order.status} → ${to}`);

  await tx
    .update(productionOrders)
    .set({ status: to, ...(to === "in_progress" ? { startedAt: new Date() } : {}), updatedAt: new Date() })
    .where(eq(productionOrders.id, orderId));
  await manufacturingAudit(tx, tenant, meta, {
    action: "PRODUCTION_ORDER_STATUS_CHANGED",
    resource: "production_orders",
    resourceId: orderId,
    details: { number: order.number, from: order.status, to },
  });
  return getOrder(tx, tenant, orderId);
}

export const confirmOrder = (tx: Tx, tenant: TenantContext, orderId: string, meta: RequestMeta) =>
  transition(tx, tenant, orderId, ["draft"], "confirmed", meta);

export const startOrder = (tx: Tx, tenant: TenantContext, orderId: string, meta: RequestMeta) =>
  transition(tx, tenant, orderId, ["confirmed"], "in_progress", meta);

export const cancelOrder = (tx: Tx, tenant: TenantContext, orderId: string, meta: RequestMeta) =>
  transition(tx, tenant, orderId, ["draft", "confirmed", "in_progress"], "cancelled", meta);

async function refreshLaborCost(tx: Tx, order: { id: string; plannedQty: string; totalMaterialCost: string }) {
  const [labor] = await tx
    .select({ sum: sql<string>`coalesce(sum(${productionTimeLines.totalCost}), 0)::numeric(18,2)` })
    .from(productionTimeLines)
    .where(eq(productionTimeLines.orderId, order.id));
  const total = toMinor(order.totalMaterialCost) + toMinor(labor!.sum);
  await tx
    .update(productionOrders)
    .set({
      totalLaborCost: labor!.sum,
      totalCost: fromMinor(total),
      unitCost: fromMinor(mulDivRound(total, 1_000_000n, toMinor(order.plannedQty, 4)), 4),
      updatedAt: new Date(),
    })
    .where(eq(productionOrders.id, order.id));
}

export async function addTimeLine(
  tx: Tx,
  tenant: TenantContext,
  orderId: string,
  input: { workCenterId: string; plannedHours?: string; actualHours: string },
  meta: RequestMeta,
) {
  const order = await lockOrder(tx, tenant, orderId);
  if (order.status === "completed" || order.status === "cancelled") {
    throw badRequest("Yakunlangan yoki bekor qilingan buyurtmaga vaqt yozilmaydi");
  }
  const [workCenter] = await tx
    .select({ id: workCenters.id, costPerHour: workCenters.costPerHour, isActive: workCenters.isActive })
    .from(workCenters)
    .where(and(eq(workCenters.id, input.workCenterId), eq(workCenters.companyId, tenant.company.id)))
    .limit(1);
  if (!workCenter) throw badRequest("Ish markazi topilmadi");
  if (!workCenter.isActive) throw badRequest("Ish markazi faol emas");

  const totalCost = rescale(toMinor(input.actualHours, 4) * toMinor(workCenter.costPerHour), 6, 2);
  const [timeLine] = await tx
    .insert(productionTimeLines)
    .values({
      companyId: tenant.company.id,
      orderId,
      workCenterId: workCenter.id,
      plannedHours: input.plannedHours ?? "0",
      actualHours: input.actualHours,
      costPerHour: workCenter.costPerHour,
      totalCost: fromMinor(totalCost),
    })
    .returning(timeLineFields);
  await refreshLaborCost(tx, order);

  await manufacturingAudit(tx, tenant, meta, {
    action: "PRODUCTION_TIME_ADDED",
    resource: "production_orders",
    resourceId: orderId,
    details: { workCenterId: workCenter.id, actualHours: input.actualHours, totalCost: fromMinor(totalCost) },
  });
  return timeLine!;
}

export async function deleteTimeLine(tx: Tx, tenant: TenantContext, orderId: string, timeLineId: string, meta: RequestMeta) {
  const order = await lockOrder(tx, tenant, orderId);
  if (order.status === "completed" || order.status === "cancelled") {
    throw badRequest("Yakunlangan yoki bekor qilingan buyurtma o'zgartirilmaydi");
  }
  const [deleted] = await tx
    .delete(productionTimeLines)
    .where(and(eq(productionTimeLines.id, timeLineId), eq(productionTimeLines.orderId, orderId)))
    .returning({ id: productionTimeLines.id });
  if (!deleted) throw notFound("Vaqt yozuvi topilmadi");
  await refreshLaborCost(tx, order);

  await manufacturingAudit(tx, tenant, meta, {
    action: "PRODUCTION_TIME_DELETED",
    resource: "production_orders",
    resourceId: orderId,
    details: { timeLineId },
  });
}

export async function completeOrder(
  tx: Tx,
  tenant: TenantContext,
  orderId: string,
  input: { producedQty: string; actualMaterials?: { materialId: string; actualQty: string }[] },
  meta: RequestMeta,
) {
  const companyId = tenant.company.id;
  const order = await lockOrder(tx, tenant, orderId);
  if (order.status !== "in_progress") throw badRequest("Faqat jarayondagi buyurtma yakunlanadi");
  assertWarehouseAccess(tenant, order.warehouseId);

  const produced = toMinor(input.producedQty, 4);
  if (produced <= 0n) throw badRequest("Ishlab chiqarilgan miqdor musbat bo'lishi kerak");

  const materials = await tx
    .select(materialFields)
    .from(productionMaterials)
    .where(eq(productionMaterials.orderId, orderId))
    .for("update");
  const materialIds = new Set(materials.map((m) => m.id));
  const actual = new Map<string, bigint>();
  for (const line of input.actualMaterials ?? []) {
    if (!materialIds.has(line.materialId)) throw badRequest("Material bu buyurtmaga tegishli emas");
    if (actual.has(line.materialId)) throw badRequest("Material ikki marta kiritilgan");
    actual.set(line.materialId, toMinor(line.actualQty, 4));
  }

  const [bom] = await tx.select({ unitId: boms.unitId }).from(boms).where(eq(boms.id, order.bomId));
  const productRows = await tx
    .select({ id: products.id, name: products.name, baseUnitId: products.baseUnitId })
    .from(products)
    .where(inArray(products.id, [order.productId, ...materials.map((m) => m.productId)]));
  const productById = new Map(productRows.map((p) => [p.id, p]));

  let materialCost = 0n;
  for (const material of materials) {
    const quantity = actual.get(material.id) ?? toMinor(material.plannedQty, 4);
    if (quantity === 0n) {
      await tx
        .update(productionMaterials)
        .set({ actualQty: "0", totalCost: "0", updatedAt: new Date() })
        .where(eq(productionMaterials.id, material.id));
      continue;
    }
    const product = productById.get(material.productId)!;
    const factor = toMinor(await unitFactorToBase(tx, companyId, product, material.unitId), 4);
    const { movement } = await moveStock(tx, companyId, tenant.user.id, {
      type: "issue",
      productId: product.id,
      warehouseId: order.warehouseId,
      quantity: fromMinor(rescale(quantity * factor, 8, 4), 4),
      referenceType: "production_order",
      referenceId: order.id,
      notes: `Ishlab chiqarish: ${order.number}`,
    });
    const unitCost = rescale(toMinor(movement.costPrice, 4) * factor, 8, 4);
    const lineCost = rescale(quantity * unitCost, 8, 2);
    materialCost += lineCost;
    await tx
      .update(productionMaterials)
      .set({ actualQty: fromMinor(quantity, 4), unitCost: fromMinor(unitCost, 4), totalCost: fromMinor(lineCost), updatedAt: new Date() })
      .where(eq(productionMaterials.id, material.id));
  }

  const [labor] = await tx
    .select({ sum: sql<string>`coalesce(sum(${productionTimeLines.totalCost}), 0)::numeric(18,2)` })
    .from(productionTimeLines)
    .where(eq(productionTimeLines.orderId, orderId));
  const laborCost = toMinor(labor!.sum);
  const totalCost = materialCost + laborCost;

  const finished = productById.get(order.productId)!;
  const finishedFactor = toMinor(await unitFactorToBase(tx, companyId, finished, bom!.unitId), 4);
  const baseProduced = rescale(produced * finishedFactor, 8, 4);
  await moveStock(tx, companyId, tenant.user.id, {
    type: "receive",
    productId: finished.id,
    warehouseId: order.warehouseId,
    quantity: fromMinor(baseProduced, 4),
    costPrice: fromMinor(mulDivRound(totalCost, 1_000_000n, baseProduced), 4),
    referenceType: "production_order",
    referenceId: order.id,
    notes: `Tayyor mahsulot: ${order.number}`,
  });

  if (laborCost > 0n) {
    await postJournalEntry(tx, companyId, tenant.user.id, {
      entryDate: todayIso(),
      description: `Ishlab chiqarish tannarxi: ${order.number}`,
      referenceType: "production_order",
      referenceId: order.id,
      lines: [
        { accountId: await requireAccountBySubtype(tx, companyId, "inventory", "asset", "Tovar zaxirasi"), debit: labor!.sum },
        { accountId: await requireAccountBySubtype(tx, companyId, "salary", "expense", "Ish haqi xarajatlari"), credit: labor!.sum },
      ],
    });
  }

  await tx
    .update(productionOrders)
    .set({
      status: "completed",
      producedQty: input.producedQty,
      completedAt: new Date(),
      totalMaterialCost: fromMinor(materialCost),
      totalLaborCost: labor!.sum,
      totalCost: fromMinor(totalCost),
      unitCost: fromMinor(mulDivRound(totalCost, 1_000_000n, produced), 4),
      updatedAt: new Date(),
    })
    .where(eq(productionOrders.id, orderId));

  await manufacturingAudit(tx, tenant, meta, {
    action: "PRODUCTION_ORDER_COMPLETED",
    resource: "production_orders",
    resourceId: orderId,
    details: { number: order.number, producedQty: input.producedQty, totalCost: fromMinor(totalCost) },
  });
  return getOrder(tx, tenant, orderId);
}
