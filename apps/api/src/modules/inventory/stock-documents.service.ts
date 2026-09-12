/**
 * Ko'p qatorli ombor hujjatlari — desktop kassadan (offline) keladi:
 *  - hisobdan chiqarish (`stock_writeoff`): har qator `writeoff` harakati, bitta jurnal (DR boshqa xarajatlar / CR zaxira)
 *  - boshqa omborga ko'chirish (`stock_transfer`): `transfer_out` + `transfer_in` manba o'rtacha tannarxida, jurnal yo'q
 *    (zaxira hisobi bir xil); qulflar mahsulot va ombor tartibida — qarama-qarshi ko'chirishlar deadlock bermaydi
 *  - inventarizatsiya (`inventory_counts`, darhol yakunlangan): farq SANASH LAHZASIDAGI qoldiqqa nisbatan —
 *    joriy qoldiq − sanashdan keyingi harakatlar; keyingi harakatlar saqlanadi
 *
 * Tovar jismonan harakatlangan: qoldiq yetmasa ham yoziladi (manfiy qoldiq) — `stock_shortage` nomuvofiqligi.
 * Qabul qiluvchi omborga kassir ruxsati talab qilinmaydi (jo'natish — kassir omboridan).
 */
import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import { badRequest, notFound } from "@bum/shared";
import { products } from "../../db/schema/catalog.js";
import { inventoryCountItems, inventoryCounts, stockLevels, stockMovements, warehouses } from "../../db/schema/inventory.js";
import type { Tx } from "../../db/transaction.js";
import { writeAuditLog, type RequestMeta } from "../../shared/audit.js";
import { fromMinor } from "../../shared/decimal.js";
import { assertProductsInScope } from "../catalog/category-scope.js";
import type { TenantContext } from "../company/tenant.js";
import { moveStock, movementValue, postStockJournal, signedQtyMinor, signedQtyText, toBaseUnit } from "./stock.service.js";
import { assertWarehouseAccess } from "./warehouses.service.js";

export type StockDocumentConflict = { kind: string; details: Record<string, unknown> };
type StockItem = { productId: string; unitId: string; quantity: string };
type Shortage = { productId: string; requested: string; available: string };

const isoDate = (at: Date) => at.toISOString().slice(0, 10);

/** Chiqimdan keyingi qoldiq manfiy bo'lsa — qancha so'ralgan va qancha bor edi. */
function shortageOf(productId: string, requested: string, levelAfter: string): Shortage | null {
  const after = signedQtyMinor(levelAfter);
  if (after >= 0n) return null;
  const wanted = signedQtyMinor(requested);
  const available = after + wanted;
  return { productId, requested: signedQtyText(wanted), available: signedQtyText(available > 0n ? available : 0n) };
}

async function audit(tx: Tx, tenant: TenantContext, meta: RequestMeta, action: string, resource: string, id: string, details: Record<string, unknown>) {
  await writeAuditLog(
    { userId: tenant.user.id, userName: tenant.user.name, companyId: tenant.company.id, action, resource, resourceId: id, details, ...meta },
    tx,
  );
}

export async function writeOffStock(
  tx: Tx,
  tenant: TenantContext,
  input: { id: string; number: string; warehouseId: string; items: StockItem[]; reason: string | null; occurredAt: Date; allowNegative: boolean },
  meta: RequestMeta,
) {
  assertWarehouseAccess(tenant, input.warehouseId);
  await assertProductsInScope(tx, tenant, input.items.map((item) => item.productId));
  const companyId = tenant.company.id;
  const notes = `${input.number}${input.reason ? `: ${input.reason}` : ""}`.slice(0, 2000);

  let total = 0n;
  const shortages: Shortage[] = [];
  const lines: { productId: string; quantity: string; costPrice: string }[] = [];
  for (const item of input.items) {
    const base = await toBaseUnit(tx, companyId, item);
    const { movement, level } = await moveStock(tx, companyId, tenant.user.id, {
      type: "writeoff",
      productId: item.productId,
      warehouseId: input.warehouseId,
      quantity: base.quantity,
      referenceType: "stock_writeoff",
      referenceId: input.id,
      notes,
      occurredAt: input.occurredAt,
      allowNegative: input.allowNegative,
    });
    total += movementValue(movement.quantity, movement.costPrice);
    lines.push({ productId: item.productId, quantity: base.quantity, costPrice: movement.costPrice });
    const shortage = shortageOf(item.productId, base.quantity, level.quantity);
    if (shortage) shortages.push(shortage);
  }

  const journal = await postStockJournal(tx, companyId, tenant.user.id, {
    referenceType: "stock_writeoff",
    referenceId: input.id,
    date: isoDate(input.occurredAt),
    description: `Hisobdan chiqarish ${notes}`.slice(0, 500),
    incoming: 0n,
    outgoing: total,
    incomingCounter: "capital",
  });

  await audit(tx, tenant, meta, "STOCK_WRITTEN_OFF", "stock_movements", input.id, {
    number: input.number,
    warehouseId: input.warehouseId,
    reason: input.reason,
    items: lines,
    value: fromMinor(total),
    journalEntryId: journal?.id ?? null,
  });

  const conflicts: StockDocumentConflict[] = shortages.length > 0 ? [{ kind: "stock_shortage", details: { warehouseId: input.warehouseId, items: shortages } }] : [];
  return { id: input.id, number: input.number, value: fromMinor(total), journalEntryId: journal?.id ?? null, conflicts };
}

export async function transferStockItems(
  tx: Tx,
  tenant: TenantContext,
  input: {
    id: string;
    number: string;
    fromWarehouseId: string;
    toWarehouseId: string;
    items: StockItem[];
    notes: string | null;
    occurredAt: Date;
    allowNegative: boolean;
  },
  meta: RequestMeta,
) {
  if (input.fromWarehouseId === input.toWarehouseId) throw badRequest("Bir xil ombor tanlandi");
  assertWarehouseAccess(tenant, input.fromWarehouseId);
  const companyId = tenant.company.id;
  const [target] = await tx
    .select({ id: warehouses.id, isActive: warehouses.isActive })
    .from(warehouses)
    .where(and(eq(warehouses.id, input.toWarehouseId), eq(warehouses.companyId, companyId)))
    .limit(1);
  if (!target) throw notFound("Qabul qiluvchi ombor topilmadi");
  if (!target.isActive) throw badRequest("Qabul qiluvchi ombor faol emas");
  const productIds = input.items.map((item) => item.productId);
  await assertProductsInScope(tx, tenant, productIds);

  // Qulflar doim bir xil tartibda (mahsulot, ombor)
  await tx
    .select({ id: stockLevels.id })
    .from(stockLevels)
    .where(
      and(
        eq(stockLevels.companyId, companyId),
        inArray(stockLevels.productId, productIds),
        inArray(stockLevels.warehouseId, [input.fromWarehouseId, input.toWarehouseId]),
      ),
    )
    .orderBy(asc(stockLevels.productId), asc(stockLevels.warehouseId))
    .for("update");

  const notes = `${input.number}${input.notes ? `: ${input.notes}` : ""}`.slice(0, 2000);
  let total = 0n;
  const shortages: Shortage[] = [];
  const lines: { productId: string; quantity: string; costPrice: string }[] = [];
  for (const item of input.items) {
    const base = await toBaseUnit(tx, companyId, item);
    const common = { productId: item.productId, quantity: base.quantity, referenceType: "stock_transfer", referenceId: input.id, notes, occurredAt: input.occurredAt };
    const out = await moveStock(tx, companyId, tenant.user.id, { ...common, type: "transfer_out", warehouseId: input.fromWarehouseId, allowNegative: input.allowNegative });
    // Qabul qiluvchi ombor manbadagi o'rtacha tannarxni oladi
    await moveStock(tx, companyId, tenant.user.id, { ...common, type: "transfer_in", warehouseId: input.toWarehouseId, costPrice: out.movement.costPrice });
    total += movementValue(out.movement.quantity, out.movement.costPrice);
    lines.push({ productId: item.productId, quantity: base.quantity, costPrice: out.movement.costPrice });
    const shortage = shortageOf(item.productId, base.quantity, out.level.quantity);
    if (shortage) shortages.push(shortage);
  }

  await audit(tx, tenant, meta, "STOCK_TRANSFERRED", "stock_movements", input.id, {
    number: input.number,
    fromWarehouseId: input.fromWarehouseId,
    toWarehouseId: input.toWarehouseId,
    notes: input.notes,
    items: lines,
    value: fromMinor(total),
  });

  const conflicts: StockDocumentConflict[] = shortages.length > 0 ? [{ kind: "stock_shortage", details: { warehouseId: input.fromWarehouseId, items: shortages } }] : [];
  return { id: input.id, number: input.number, toWarehouseId: input.toWarehouseId, value: fromMinor(total), conflicts };
}

const ITEM_CHUNK = 1000;

/**
 * Qurilmadagi inventarizatsiya: sanalgan miqdorlar (asosiy birlikda) `countedAt` lahzasi bo'yicha. Kutilgan qoldiq =
 * joriy qoldiq − sanashdan keyingi harakatlar yig'indisi (qulf ostida); tuzatma `count` harakati sanash vaqti bilan.
 */
export async function applyDeviceCount(
  tx: Tx,
  tenant: TenantContext,
  input: { id: string; number: string; warehouseId: string; countedAt: Date; items: { productId: string; countedQty: string }[]; notes: string | null },
  meta: RequestMeta,
) {
  assertWarehouseAccess(tenant, input.warehouseId);
  const companyId = tenant.company.id;
  const productIds = input.items.map((item) => item.productId);
  const known = await tx
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.companyId, companyId), inArray(products.id, productIds)));
  if (known.length !== new Set(productIds).size) throw badRequest("Mahsulot topilmadi");
  await assertProductsInScope(tx, tenant, productIds);
  const [warehouse] = await tx
    .select({ id: warehouses.id, isActive: warehouses.isActive })
    .from(warehouses)
    .where(and(eq(warehouses.id, input.warehouseId), eq(warehouses.companyId, companyId)))
    .limit(1);
  if (!warehouse) throw notFound("Ombor topilmadi");
  if (!warehouse.isActive) throw badRequest("Ombor faol emas");

  // Qoldiq qatorlari qulflangach keyingi harakatlar yig'indisi — parallel chiqim qulfni kutadi
  const levels = await tx
    .select({ productId: stockLevels.productId, quantity: stockLevels.quantity })
    .from(stockLevels)
    .where(and(eq(stockLevels.companyId, companyId), eq(stockLevels.warehouseId, warehouse.id), inArray(stockLevels.productId, productIds)))
    .orderBy(asc(stockLevels.productId))
    .for("update");
  const later = await tx
    .select({ productId: stockMovements.productId, quantity: sql<string>`sum(${stockMovements.quantity})::text` })
    .from(stockMovements)
    .where(
      and(
        eq(stockMovements.companyId, companyId),
        eq(stockMovements.warehouseId, warehouse.id),
        inArray(stockMovements.productId, productIds),
        gt(stockMovements.occurredAt, input.countedAt),
      ),
    )
    .groupBy(stockMovements.productId);
  const current = new Map(levels.map((row) => [row.productId, signedQtyMinor(row.quantity)]));
  const afterCount = new Map(later.map((row) => [row.productId, signedQtyMinor(row.quantity)]));

  const [count] = await tx
    .insert(inventoryCounts)
    .values({
      id: input.id,
      companyId,
      warehouseId: warehouse.id,
      name: input.number,
      status: "completed",
      countedBy: tenant.user.id,
      startedAt: input.countedAt,
      completedAt: input.countedAt,
      adjustmentsMade: true,
      notes: input.notes,
    })
    .returning({ id: inventoryCounts.id });

  let surplus = 0n;
  let shortage = 0n;
  let adjusted = 0;
  const negative: { productId: string; quantity: string }[] = [];
  const rows: (typeof inventoryCountItems.$inferInsert)[] = [];
  for (const item of input.items) {
    const counted = signedQtyMinor(item.countedQty);
    const expected = (current.get(item.productId) ?? 0n) - (afterCount.get(item.productId) ?? 0n);
    const delta = counted - expected;
    rows.push({
      companyId,
      countId: count!.id,
      productId: item.productId,
      expectedQty: signedQtyText(expected),
      countedQty: signedQtyText(counted),
      difference: signedQtyText(delta),
    });
    if (delta === 0n) continue;
    const { movement, level } = await moveStock(tx, companyId, tenant.user.id, {
      type: "count",
      productId: item.productId,
      warehouseId: warehouse.id,
      quantity: signedQtyText(delta),
      referenceType: "inventory_count",
      referenceId: count!.id,
      notes: `Inventarizatsiya: ${input.number}`,
      occurredAt: input.countedAt,
      allowNegative: true,
    });
    const value = movementValue(movement.quantity, movement.costPrice);
    if (movement.quantity.startsWith("-")) shortage += value;
    else surplus += value;
    adjusted += 1;
    if (level.quantity.startsWith("-")) negative.push({ productId: item.productId, quantity: level.quantity });
  }
  for (let i = 0; i < rows.length; i += ITEM_CHUNK) await tx.insert(inventoryCountItems).values(rows.slice(i, i + ITEM_CHUNK));

  // Ortiqcha — 4100 Boshqa daromadlar, kamomad — 5500 Boshqa xarajatlar (tannarxda)
  const journal = await postStockJournal(tx, companyId, tenant.user.id, {
    referenceType: "inventory_count",
    referenceId: count!.id,
    date: isoDate(input.countedAt),
    description: `Inventarizatsiya: ${input.number}`,
    incoming: surplus,
    outgoing: shortage,
    incomingCounter: "other_income",
  });

  await audit(tx, tenant, meta, "INVENTORY_COUNT_APPLIED", "inventory_counts", count!.id, {
    number: input.number,
    countedAt: input.countedAt.toISOString(),
    counted: input.items.length,
    adjusted,
    surplus: fromMinor(surplus),
    shortage: fromMinor(shortage),
    journalEntryId: journal?.id ?? null,
  });

  const conflicts: StockDocumentConflict[] = negative.length > 0 ? [{ kind: "stock_shortage", details: { warehouseId: warehouse.id, items: negative } }] : [];
  return {
    countId: count!.id,
    number: input.number,
    adjusted,
    surplus: fromMinor(surplus),
    shortage: fromMinor(shortage),
    journalEntryId: journal?.id ?? null,
    conflicts,
  };
}
