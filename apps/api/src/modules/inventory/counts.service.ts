/**
 * Inventarizatsiya (convex/warehouse/inventoryCounts.ts).
 *
 * Convex'dan farqlar:
 *  - applyAdjustments qoldiqni hisob yaratilgan paytdagi eski `difference` bo'yicha
 *    yozardi — orada bo'lgan sotuv/kirim yo'qolib ketardi. Endi tuzatma = sanalgan
 *    miqdor − JORIY qoldiq (qulf ostida)
 *  - bekor qilingan yoki yakunlangan hisobni qo'llash taqiqlangan
 *  - qoldig'i yo'q mahsulot sanalgan bo'lsa ham qo'llanadi (Convex o'tkazib yuborardi)
 *  - hisobga mahsulot qo'shish mumkin (omborda qoldig'i yo'q topilma)
 *  - `warehouse.count` ruxsati; qo'llash qo'shimcha `warehouse.manage` (routes)
 */
import { and, desc, eq, getTableColumns, ilike, inArray, isNotNull, or, sql } from "drizzle-orm";
import { badRequest, notFound } from "@bum/shared";
import { products, units } from "../../db/schema/catalog.js";
import { inventoryCountItems, inventoryCounts, stockLevels, warehouses } from "../../db/schema/inventory.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import { writeAuditLog, type RequestMeta } from "../../shared/audit.js";
import { fromMinor } from "../../shared/decimal.js";
import type { TenantContext } from "../company/tenant.js";
import { todayIso } from "../finance/cash.service.js";
import { moveStock, movementValue, postStockJournal } from "./stock.service.js";
import { assertProductsInScope, categoryScope, productScopeCondition } from "../catalog/category-scope.js";
import { allowedWarehouses, assertWarehouseAccess } from "./warehouses.service.js";

const { legacyId: _l1, companyId: _c1, ...countFields } = getTableColumns(inventoryCounts);
const { legacyId: _l2, companyId: _c2, ...itemFields } = getTableColumns(inventoryCountItems);

export type CountStatus = (typeof inventoryCounts.status.enumValues)[number];

function audit(tx: Tx, tenant: TenantContext, meta: RequestMeta, action: string, id: string, details: Record<string, unknown>) {
  return writeAuditLog(
    {
      userId: tenant.user.id,
      userName: tenant.user.name,
      companyId: tenant.company.id,
      action,
      resource: "inventory_counts",
      resourceId: id,
      details,
      ...meta,
    },
    tx,
  );
}

export async function listCounts(
  conn: DbOrTx,
  tenant: TenantContext,
  options: { warehouseId?: string; status?: CountStatus },
) {
  if (options.warehouseId) assertWarehouseAccess(tenant, options.warehouseId);
  const allowed = options.warehouseId ? null : allowedWarehouses(tenant);

  return conn
    .select({
      ...countFields,
      warehouseName: warehouses.name,
      itemCount: sql<number>`(select count(*)::int from ${inventoryCountItems} where ${inventoryCountItems.countId} = ${inventoryCounts.id})`,
      countedItems: sql<number>`(select count(*)::int from ${inventoryCountItems} where ${inventoryCountItems.countId} = ${inventoryCounts.id} and ${inventoryCountItems.countedQty} is not null)`,
    })
    .from(inventoryCounts)
    .innerJoin(warehouses, eq(warehouses.id, inventoryCounts.warehouseId))
    .where(
      and(
        eq(inventoryCounts.companyId, tenant.company.id),
        options.warehouseId ? eq(inventoryCounts.warehouseId, options.warehouseId) : undefined,
        allowed ? inArray(inventoryCounts.warehouseId, allowed) : undefined,
        options.status ? eq(inventoryCounts.status, options.status) : undefined,
      ),
    )
    .orderBy(desc(inventoryCounts.createdAt))
    .limit(100);
}

async function loadCount(conn: DbOrTx, tenant: TenantContext, countId: string, forUpdate = false) {
  const query = conn
    .select(countFields)
    .from(inventoryCounts)
    .where(and(eq(inventoryCounts.id, countId), eq(inventoryCounts.companyId, tenant.company.id)))
    .limit(1);
  const [count] = forUpdate ? await query.for("update") : await query;
  if (!count) throw notFound("Inventarizatsiya topilmadi");
  assertWarehouseAccess(tenant, count.warehouseId);
  return count;
}

function assertEditable(count: { status: CountStatus; adjustmentsMade: boolean }) {
  if (count.adjustmentsMade || count.status === "completed" || count.status === "cancelled") {
    throw badRequest("Inventarizatsiya yakunlangan yoki bekor qilingan");
  }
}

/**
 * Hisob va uning qatorlari.
 *
 * Qatorlar QIDIRUV bilan va chegaralangan holda qaytadi: hisob butun katalogdan quriladi, katta
 * katalogli bizneslarda esa hamma qatorni bir yo'la yuborish og'ir bo'lardi. Jarayon ko'rsatkichlari
 * (sanalgan, ortiqcha, kam) SERVERDA sanaladi — shuning uchun ular chegaradan mustaqil va har doim to'g'ri.
 */
export async function getCount(
  conn: DbOrTx,
  tenant: TenantContext,
  countId: string,
  options: { search?: string; limit?: number } = {},
) {
  const count = await loadCount(conn, tenant, countId);
  const [warehouse] = await conn.select({ name: warehouses.name }).from(warehouses).where(eq(warehouses.id, count.warehouseId));
  const scope = productScopeCondition(await categoryScope(conn, tenant));
  const belongs = and(eq(inventoryCountItems.countId, countId), eq(inventoryCountItems.companyId, tenant.company.id));

  const [summary] = await conn
    .select({
      itemCount: sql<number>`count(*)::int`,
      countedItems: sql<number>`(count(*) filter (where ${inventoryCountItems.countedQty} is not null))::int`,
      surplusItems: sql<number>`(count(*) filter (where ${inventoryCountItems.difference} > 0))::int`,
      shortageItems: sql<number>`(count(*) filter (where ${inventoryCountItems.difference} < 0))::int`,
    })
    .from(inventoryCountItems)
    .innerJoin(products, eq(products.id, inventoryCountItems.productId))
    .where(and(belongs, scope));

  // ILIKE maxsus belgilari (% _ \) oddiy matn sifatida qidirilsin
  const needle = options.search?.trim();
  const pattern = needle ? `%${needle.replace(/[\\%_]/g, (char) => `\\${char}`)}%` : null;
  const items = await conn
    .select({ ...itemFields, productName: products.name, productSku: products.sku, unitName: units.shortName })
    .from(inventoryCountItems)
    .innerJoin(products, eq(products.id, inventoryCountItems.productId))
    .innerJoin(units, eq(units.id, products.baseUnitId))
    .where(and(belongs, scope, pattern ? or(ilike(products.name, pattern), ilike(products.sku, pattern)) : undefined))
    .orderBy(products.name)
    .limit(options.limit ?? 200);

  return {
    ...count,
    warehouseName: warehouse?.name ?? null,
    itemCount: summary?.itemCount ?? 0,
    countedItems: summary?.countedItems ?? 0,
    surplusItems: summary?.surplusItems ?? 0,
    shortageItems: summary?.shortageItems ?? 0,
    items,
  };
}

export async function createCount(
  tx: Tx,
  tenant: TenantContext,
  input: { warehouseId: string; name: string; notes?: string | null },
  meta: RequestMeta,
) {
  const [warehouse] = await tx
    .select({ id: warehouses.id, isActive: warehouses.isActive })
    .from(warehouses)
    .where(and(eq(warehouses.id, input.warehouseId), eq(warehouses.companyId, tenant.company.id)))
    .limit(1);
  if (!warehouse) throw notFound("Ombor topilmadi");
  if (!warehouse.isActive) throw badRequest("Ombor faol emas");
  assertWarehouseAccess(tenant, warehouse.id);

  const [count] = await tx
    .insert(inventoryCounts)
    .values({
      companyId: tenant.company.id,
      warehouseId: warehouse.id,
      name: input.name,
      notes: input.notes ?? null,
      countedBy: tenant.user.id,
    })
    .returning(countFields);

  /**
   * Hisob MAHSULOTLAR ro'yxatidan quriladi, qoldiqdan emas.
   *
   * Ilgari u faqat `stock_levels` dan olinardi — omborda hech qachon harakat bo'lmagan mahsulotda
   * bunday qator umuman yo'q, shuning uchun ular ro'yxatga tushmasdi va sanoqchi "chala ro'yxat"
   * ko'rardi. Holbuki inventarizatsiya aynan shunday tovarni topish uchun ham qilinadi
   * (qoldiq 0 deb turgan mahsulot omborda chiqib qolishi mumkin).
   */
  const levels = await tx
    .select({ productId: products.id, quantity: sql<string>`coalesce(${stockLevels.quantity}, '0')::numeric(18,4)` })
    .from(products)
    .leftJoin(
      stockLevels,
      and(eq(stockLevels.productId, products.id), eq(stockLevels.warehouseId, warehouse.id), eq(stockLevels.companyId, tenant.company.id)),
    )
    .where(
      and(
        eq(products.companyId, tenant.company.id),
        eq(products.isActive, true),
        // Cheklangan xodimning hisobiga faqat uning kategoriyalaridagi mahsulotlar kiradi
        productScopeCondition(await categoryScope(tx, tenant)),
      ),
    );
  // Katalog katta bo'lishi mumkin — bo'laklab yoziladi (bitta INSERT parametr chegarasiga urilmasin)
  const CHUNK = 500;
  for (let index = 0; index < levels.length; index += CHUNK) {
    await tx.insert(inventoryCountItems).values(
      levels.slice(index, index + CHUNK).map((l) => ({
        companyId: tenant.company.id,
        countId: count!.id,
        productId: l.productId,
        expectedQty: l.quantity,
      })),
    );
  }

  await audit(tx, tenant, meta, "INVENTORY_COUNT_CREATED", count!.id, { warehouseId: warehouse.id, items: levels.length });
  return { ...count!, itemCount: levels.length };
}

export async function addCountItem(tx: Tx, tenant: TenantContext, countId: string, productId: string, meta: RequestMeta) {
  const count = await loadCount(tx, tenant, countId, true);
  assertEditable(count);

  const [product] = await tx
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.id, productId), eq(products.companyId, tenant.company.id)))
    .limit(1);
  if (!product) throw badRequest("Mahsulot topilmadi");
  await assertProductsInScope(tx, tenant, [product.id]);

  const [level] = await tx
    .select({ quantity: stockLevels.quantity })
    .from(stockLevels)
    .where(
      and(
        eq(stockLevels.companyId, tenant.company.id),
        eq(stockLevels.warehouseId, count.warehouseId),
        eq(stockLevels.productId, product.id),
      ),
    )
    .limit(1);

  const [item] = await tx
    .insert(inventoryCountItems)
    .values({ companyId: tenant.company.id, countId, productId: product.id, expectedQty: level?.quantity ?? "0" })
    .returning(itemFields);

  await audit(tx, tenant, meta, "INVENTORY_COUNT_ITEM_ADDED", countId, { productId: product.id });
  return item!;
}

export async function updateCountItem(
  tx: Tx,
  tenant: TenantContext,
  countId: string,
  itemId: string,
  input: { countedQty: string; notes?: string | null },
) {
  const count = await loadCount(tx, tenant, countId, true);
  assertEditable(count);

  const [existing] = await tx
    .select({ productId: inventoryCountItems.productId })
    .from(inventoryCountItems)
    .where(and(eq(inventoryCountItems.id, itemId), eq(inventoryCountItems.countId, countId)))
    .limit(1);
  if (existing) await assertProductsInScope(tx, tenant, [existing.productId]);

  const [item] = await tx
    .update(inventoryCountItems)
    .set({
      countedQty: input.countedQty,
      difference: sql`${input.countedQty}::numeric - ${inventoryCountItems.expectedQty}`,
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(inventoryCountItems.id, itemId),
        eq(inventoryCountItems.countId, countId),
        eq(inventoryCountItems.companyId, tenant.company.id),
      ),
    )
    .returning(itemFields);
  if (!item) throw notFound("Hisob qatori topilmadi");

  // Birinchi sanalgan qator hisobni "jarayonda" holatiga o'tkazadi
  if (count.status === "draft") {
    await tx
      .update(inventoryCounts)
      .set({ status: "in_progress", startedAt: new Date(), updatedAt: new Date() })
      .where(eq(inventoryCounts.id, countId));
  }
  return item;
}

export async function setCountStatus(
  tx: Tx,
  tenant: TenantContext,
  countId: string,
  status: "in_progress" | "cancelled",
  meta: RequestMeta,
) {
  const count = await loadCount(tx, tenant, countId, true);
  assertEditable(count);

  const [updated] = await tx
    .update(inventoryCounts)
    .set({
      status,
      ...(status === "in_progress" && !count.startedAt ? { startedAt: new Date() } : {}),
      updatedAt: new Date(),
    })
    .where(eq(inventoryCounts.id, countId))
    .returning(countFields);

  await audit(tx, tenant, meta, "INVENTORY_COUNT_STATUS_CHANGED", countId, { from: count.status, to: status });
  return updated!;
}

export async function applyCount(tx: Tx, tenant: TenantContext, countId: string, meta: RequestMeta) {
  const count = await loadCount(tx, tenant, countId, true);
  assertEditable(count);

  const items = await tx
    .select({ productId: inventoryCountItems.productId, countedQty: inventoryCountItems.countedQty })
    .from(inventoryCountItems)
    .where(and(eq(inventoryCountItems.countId, countId), isNotNull(inventoryCountItems.countedQty)));
  // Cheklangan xodim boshqa kategoriyadagi sanalgan qatorlari bor hisobni qo'llay olmaydi
  await assertProductsInScope(tx, tenant, items.map((i) => i.productId));

  let adjusted = 0;
  // Buxgalteriya uchun tannarxdagi ortiqcha va kamomad
  let surplus = 0n;
  let shortage = 0n;
  for (const item of items) {
    // Farq JORIY qoldiqqa nisbatan — hisob yaratilgandan keyingi harakatlar ham hisobga olinadi
    const [row] = await tx.execute<{ delta: string }>(
      sql`select (${item.countedQty}::numeric - coalesce((
            select ${stockLevels.quantity} from ${stockLevels}
            where ${stockLevels.companyId} = ${tenant.company.id}
              and ${stockLevels.warehouseId} = ${count.warehouseId}
              and ${stockLevels.productId} = ${item.productId}
            for update
          ), 0))::text as delta`,
    ).then((r) => r.rows);
    const delta = row?.delta ?? "0";
    if (Number(delta) === 0) continue;

    const { movement } = await moveStock(tx, tenant.company.id, tenant.user.id, {
      type: "count",
      productId: item.productId,
      warehouseId: count.warehouseId,
      quantity: delta,
      referenceType: "inventory_count",
      referenceId: countId,
      notes: `Inventarizatsiya: ${count.name}`,
    });
    const value = movementValue(movement.quantity, movement.costPrice);
    if (movement.quantity.startsWith("-")) shortage += value;
    else surplus += value;
    adjusted++;
  }

  // Ortiqcha — 4100 Boshqa daromadlar, kamomad — 5500 Boshqa xarajatlar (tannarxda)
  const journal = await postStockJournal(tx, tenant.company.id, tenant.user.id, {
    referenceType: "inventory_count",
    referenceId: countId,
    date: todayIso(),
    description: `Inventarizatsiya: ${count.name}`,
    incoming: surplus,
    outgoing: shortage,
    incomingCounter: "other_income",
  });

  const [updated] = await tx
    .update(inventoryCounts)
    .set({ status: "completed", adjustmentsMade: true, completedAt: new Date(), updatedAt: new Date() })
    .where(eq(inventoryCounts.id, countId))
    .returning(countFields);

  await audit(tx, tenant, meta, "INVENTORY_COUNT_APPLIED", countId, {
    counted: items.length,
    adjusted,
    surplus: fromMinor(surplus),
    shortage: fromMinor(shortage),
    journalEntryId: journal?.id ?? null,
  });
  return { count: updated!, adjusted };
}
