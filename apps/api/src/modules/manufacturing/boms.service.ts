/**
 * Retseptlar — BOM (convex/manufacturing/boms.ts).
 *
 * Convex'dan farqlar:
 *  - ruxsat nomi `production.manage` edi — katalogda yo'q, "Ishlab chiqarish menejeri" roli
 *    hech narsa qila olmasdi; endi `manufacturing.manage`, o'qish `manufacturing.view`
 *    (Convex'da o'qish ruxsatsiz edi)
 *  - tayyor mahsulotning o'zi tarkibga qo'shilardi, retseptlar sikl hosil qilishi mumkin edi
 *  - birlik tekshirilmasdi (konversiyasiz birlik qabul qilinardi); miqdor va chiqindi foizi erkin edi
 *  - buyurtmalari bor retsept o'chirilib, buyurtmalar yetim qolardi — endi faolsizlantirish
 */
import { and, asc, eq, getTableColumns, inArray, sql } from "drizzle-orm";
import { badRequest, conflict, notFound } from "@bum/shared";
import { products, units } from "../../db/schema/catalog.js";
import { bomItems, boms, productionOrders } from "../../db/schema/manufacturing.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import { writeAuditLog, type RequestMeta } from "../../shared/audit.js";
import { unitFactorToBase } from "../catalog/conversions.js";
import type { TenantContext } from "../company/tenant.js";

const { legacyId: _l1, companyId: _c1, ...bomFields } = getTableColumns(boms);
const { legacyId: _l2, companyId: _c2, ...itemFields } = getTableColumns(bomItems);

export function manufacturingAudit(
  tx: Tx,
  tenant: TenantContext,
  meta: RequestMeta,
  entry: { action: string; resource: string; resourceId: string; details: Record<string, unknown> },
) {
  return writeAuditLog(
    { userId: tenant.user.id, userName: tenant.user.name, companyId: tenant.company.id, ...entry, ...meta },
    tx,
  );
}

export type BomInput = {
  productId: string;
  name: string;
  version?: string;
  quantity?: string;
  unitId?: string;
  notes?: string | null;
};

export type BomItemInput = {
  productId: string;
  quantity: string;
  unitId?: string;
  scrapPercent?: string;
  notes?: string | null;
};

async function loadProduct(tx: Tx, companyId: string, productId: string) {
  const [product] = await tx
    .select({ id: products.id, name: products.name, baseUnitId: products.baseUnitId, isActive: products.isActive })
    .from(products)
    .where(and(eq(products.id, productId), eq(products.companyId, companyId)))
    .limit(1);
  if (!product) throw badRequest("Mahsulot topilmadi");
  if (!product.isActive) throw badRequest(`${product.name}: mahsulot faol emas`);
  return product;
}

async function lockBom(tx: Tx, tenant: TenantContext, bomId: string) {
  const [bom] = await tx
    .select(bomFields)
    .from(boms)
    .where(and(eq(boms.id, bomId), eq(boms.companyId, tenant.company.id)))
    .limit(1)
    .for("update");
  if (!bom) throw notFound("Retsept topilmadi");
  return bom;
}

/** Tarkibdagi mahsulot (va uning retseptlari zanjiri) tayyor mahsulotni o'z ichiga olmasin. */
async function assertNoCycle(tx: Tx, companyId: string, finishedProductId: string, componentId: string) {
  if (componentId === finishedProductId) throw badRequest("Mahsulot o'z retseptiga tarkib bo'la olmaydi");
  const seen = new Set<string>([componentId]);
  let frontier = [componentId];
  while (frontier.length > 0) {
    const rows = await tx
      .select({ productId: bomItems.productId })
      .from(bomItems)
      .innerJoin(boms, eq(boms.id, bomItems.bomId))
      .where(and(eq(boms.companyId, companyId), inArray(boms.productId, frontier)));
    const next: string[] = [];
    for (const row of rows) {
      if (row.productId === finishedProductId) throw badRequest("Retseptlar sikl hosil qiladi");
      if (!seen.has(row.productId)) {
        seen.add(row.productId);
        next.push(row.productId);
      }
    }
    frontier = next;
  }
}

export async function listBoms(conn: DbOrTx, tenant: TenantContext, options: { productId?: string; includeInactive?: boolean }) {
  return conn
    .select({
      ...bomFields,
      productName: products.name,
      unitName: units.shortName,
      itemCount: sql<number>`(select count(*)::int from ${bomItems} where ${bomItems.bomId} = ${boms.id})`,
    })
    .from(boms)
    .innerJoin(products, eq(products.id, boms.productId))
    .innerJoin(units, eq(units.id, boms.unitId))
    .where(
      and(
        eq(boms.companyId, tenant.company.id),
        options.productId ? eq(boms.productId, options.productId) : undefined,
        options.includeInactive ? undefined : eq(boms.isActive, true),
      ),
    )
    .orderBy(asc(products.name), asc(boms.version));
}

export async function getBom(conn: DbOrTx, tenant: TenantContext, bomId: string) {
  const [bom] = await conn
    .select({ ...bomFields, productName: products.name, unitName: units.shortName })
    .from(boms)
    .innerJoin(products, eq(products.id, boms.productId))
    .innerJoin(units, eq(units.id, boms.unitId))
    .where(and(eq(boms.id, bomId), eq(boms.companyId, tenant.company.id)))
    .limit(1);
  if (!bom) throw notFound("Retsept topilmadi");

  const items = await conn
    .select({
      ...itemFields,
      componentName: products.name,
      componentSku: products.sku,
      purchasePrice: products.purchasePrice,
      unitName: units.shortName,
    })
    .from(bomItems)
    .innerJoin(products, eq(products.id, bomItems.productId))
    .innerJoin(units, eq(units.id, bomItems.unitId))
    .where(eq(bomItems.bomId, bomId))
    .orderBy(asc(products.name));
  return { ...bom, items };
}

export async function createBom(tx: Tx, tenant: TenantContext, input: BomInput, meta: RequestMeta) {
  const companyId = tenant.company.id;
  const product = await loadProduct(tx, companyId, input.productId);
  const unitId = input.unitId ?? product.baseUnitId;
  await unitFactorToBase(tx, companyId, product, unitId);

  const [bom] = await tx
    .insert(boms)
    .values({ ...input, unitId, companyId })
    .returning({ id: boms.id, version: boms.version });
  await manufacturingAudit(tx, tenant, meta, {
    action: "BOM_CREATED",
    resource: "boms",
    resourceId: bom!.id,
    details: { productId: product.id, name: input.name, version: bom!.version },
  });
  return getBom(tx, tenant, bom!.id);
}

export async function updateBom(
  tx: Tx,
  tenant: TenantContext,
  bomId: string,
  patch: { name?: string; version?: string; quantity?: string; isActive?: boolean; notes?: string | null },
  meta: RequestMeta,
) {
  await lockBom(tx, tenant, bomId);
  await tx.update(boms).set({ ...patch, updatedAt: new Date() }).where(eq(boms.id, bomId));
  await manufacturingAudit(tx, tenant, meta, {
    action: "BOM_UPDATED",
    resource: "boms",
    resourceId: bomId,
    details: { changes: Object.keys(patch) },
  });
  return getBom(tx, tenant, bomId);
}

export async function deleteBom(tx: Tx, tenant: TenantContext, bomId: string, meta: RequestMeta) {
  const bom = await lockBom(tx, tenant, bomId);
  const [order] = await tx.select({ id: productionOrders.id }).from(productionOrders).where(eq(productionOrders.bomId, bomId)).limit(1);
  if (order) throw conflict("Retsept bo'yicha buyurtmalar bor — o'chirish o'rniga faolsizlantiring");

  await tx.delete(boms).where(eq(boms.id, bomId));
  await manufacturingAudit(tx, tenant, meta, {
    action: "BOM_DELETED",
    resource: "boms",
    resourceId: bomId,
    details: { name: bom.name, version: bom.version },
  });
}

export async function addBomItem(tx: Tx, tenant: TenantContext, bomId: string, input: BomItemInput, meta: RequestMeta) {
  const companyId = tenant.company.id;
  const bom = await lockBom(tx, tenant, bomId);
  const component = await loadProduct(tx, companyId, input.productId);
  await assertNoCycle(tx, companyId, bom.productId, component.id);
  const unitId = input.unitId ?? component.baseUnitId;
  await unitFactorToBase(tx, companyId, component, unitId);

  const [item] = await tx
    .insert(bomItems)
    .values({ ...input, unitId, bomId, companyId })
    .returning(itemFields);
  await manufacturingAudit(tx, tenant, meta, {
    action: "BOM_ITEM_ADDED",
    resource: "boms",
    resourceId: bomId,
    details: { productId: component.id, quantity: item!.quantity },
  });
  return item!;
}

export async function updateBomItem(
  tx: Tx,
  tenant: TenantContext,
  bomId: string,
  itemId: string,
  patch: { quantity?: string; scrapPercent?: string; notes?: string | null },
  meta: RequestMeta,
) {
  await lockBom(tx, tenant, bomId);
  const [item] = await tx
    .update(bomItems)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(bomItems.id, itemId), eq(bomItems.bomId, bomId)))
    .returning(itemFields);
  if (!item) throw notFound("Retsept tarkibi topilmadi");

  await manufacturingAudit(tx, tenant, meta, {
    action: "BOM_ITEM_UPDATED",
    resource: "boms",
    resourceId: bomId,
    details: { itemId, changes: Object.keys(patch) },
  });
  return item;
}

export async function deleteBomItem(tx: Tx, tenant: TenantContext, bomId: string, itemId: string, meta: RequestMeta) {
  await lockBom(tx, tenant, bomId);
  const [deleted] = await tx
    .delete(bomItems)
    .where(and(eq(bomItems.id, itemId), eq(bomItems.bomId, bomId)))
    .returning({ productId: bomItems.productId });
  if (!deleted) throw notFound("Retsept tarkibi topilmadi");

  await manufacturingAudit(tx, tenant, meta, {
    action: "BOM_ITEM_DELETED",
    resource: "boms",
    resourceId: bomId,
    details: { productId: deleted.productId },
  });
}
