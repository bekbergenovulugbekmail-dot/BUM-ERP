/**
 * Zaxira: qoldiqlar, harakatlar, o'tkazmalar (convex/warehouse/stock.ts).
 *
 * `moveStock` — zaxirani o'zgartiradigan YAGONA yo'l; xarid, savdo, POS va
 * ishlab chiqarish ham shuni chaqiradi. Qoidalar:
 *  - qoldiq qatori `FOR UPDATE` bilan qulflanadi — parallel chiqimlar bir-birini
 *    ko'rmay ortiqcha yechib yubormaydi (Convex'da tranzaksiya avtomatik edi,
 *    PostgreSQL'da qulf kerak)
 *  - arifmetika PostgreSQL numeric'da (float emas); manfiy qoldiq — aniq xato,
 *    bazada CHECK ham bor
 *  - AVCO faqat tannarxli kirimda qayta hisoblanadi; chiqim joriy o'rtacha
 *    tannarxda yoziladi
 *  - zaxira mahsulotning asosiy o'lchov birligida; qo'lda harakat va o'tkazma boshqa birlikda
 *    kiritilsa (`unitId`) konversiya bilan asosiy birlikka o'tkaziladi (Convex konvertatsiya qilmasdi)
 *
 * Convex'dan farqlar: recordMovement va transferStock ruxsat tekshirmasdi (har
 * qanday a'zo zaxirani o'zgartirardi); o'tkazmada qabul qiluvchi omborga mijoz
 * yuborgan tannarx yozilardi — endi manba ombordagi o'rtacha tannarx.
 */
import { randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, getTableColumns, ilike, inArray, lt, or, sql } from "drizzle-orm";
import { badRequest, notFound } from "@bum/shared";
import { batches, products, units } from "../../db/schema/catalog.js";
import { accounts } from "../../db/schema/finance.js";
import {
  inventoryCountItems,
  inventoryCounts,
  stockLevels,
  stockMovementType,
  stockMovements,
  warehouses,
} from "../../db/schema/inventory.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import { writeAuditLog, type RequestMeta } from "../../shared/audit.js";
import { UUID_RE, decodeCursor, encodeCursor } from "../../shared/cursor.js";
import { fromMinor, mulDivRound, rescale, toMinor } from "../../shared/decimal.js";
import { unitFactorToBase } from "../catalog/conversions.js";
import { assertProductsInScope, categoryScope, productScopeCondition } from "../catalog/category-scope.js";
import type { TenantContext } from "../company/tenant.js";
import { todayIso } from "../finance/cash.service.js";
import { postJournalEntry, requireAccountBySubtype } from "../finance/journal.service.js";
import { allowedWarehouses, assertWarehouseAccess } from "./warehouses.service.js";

export type MovementType = (typeof stockMovementType.enumValues)[number];

const INCOMING = new Set<MovementType>(["receive", "transfer_in", "return_in"]);
const OUTGOING = new Set<MovementType>(["issue", "transfer_out", "writeoff", "return_out"]);

const { legacyId: _legacyId, companyId: _companyId, ...movementFields } = getTableColumns(stockMovements);

export type StockMove = {
  type: MovementType;
  productId: string;
  warehouseId: string;
  /** Yo'nalishli turlarda musbat miqdor; `adjust` / `count` da ishorali farq. */
  quantity: string;
  /** Faqat kirimda (receive, transfer_in, return_in) AVCO ni o'zgartiradi. */
  costPrice?: string | null;
  batchId?: string | null;
  zoneId?: string | null;
  referenceType?: string | null;
  referenceId?: string | null;
  notes?: string | null;
  occurredAt?: Date;
  /**
   * Faqat desktop kassaning offline sotuvi sinxronida: tovar jismonan sotilgan — qoldiq yetmasa ham chiqim yoziladi
   * (qoldiq manfiy bo'ladi, chaqiruvchi nomuvofiqlikni qayd etadi). Tannarx 0 bo'lsa — mahsulot xarid narxi.
   */
  allowNegative?: boolean;
};

/** Ishorali miqdor (4 kasr) ↔ butun son. */
export const signedQtyMinor = (value: string) => (value.startsWith("-") ? -toMinor(value.slice(1), 4) : toMinor(value, 4));
export const signedQtyText = (value: bigint) => (value < 0n ? `-${fromMinor(-value, 4)}` : fromMinor(value, 4));

type TxMovement = { productId: string; warehouseId: string; quantity: string; occurredAt: Date };

/** Tranzaksiyada yozilgan harakatlar (inventarizatsiya harakatlaridan tashqari) — `compensateCountedMovements` uchun. */
const txMovements = new WeakMap<object, TxMovement[]>();

async function lockLevel(tx: Tx, companyId: string, productId: string, warehouseId: string) {
  const [level] = await tx
    .select({ id: stockLevels.id, quantity: stockLevels.quantity, avgCostPrice: stockLevels.avgCostPrice })
    .from(stockLevels)
    .where(
      and(
        eq(stockLevels.companyId, companyId),
        eq(stockLevels.productId, productId),
        eq(stockLevels.warehouseId, warehouseId),
      ),
    )
    .limit(1)
    .for("update");
  return level;
}

export async function moveStock(tx: Tx, companyId: string, performedBy: string | null, move: StockMove) {
  const magnitude = move.quantity.replace(/^-/, "");
  if (Number(magnitude) === 0) throw badRequest("Miqdor noldan farq qilishi kerak");
  const delta = INCOMING.has(move.type)
    ? magnitude
    : OUTGOING.has(move.type)
      ? `-${magnitude}`
      : move.quantity;
  const incoming = !delta.startsWith("-");

  const [product] = await tx
    .select({
      id: products.id,
      baseUnitId: products.baseUnitId,
      purchasePrice: products.purchasePrice,
      purchaseCurrency: products.purchaseCurrency,
    })
    .from(products)
    .where(and(eq(products.id, move.productId), eq(products.companyId, companyId)))
    .limit(1);
  if (!product) throw notFound("Mahsulot topilmadi");

  const [warehouse] = await tx
    .select({ id: warehouses.id, isActive: warehouses.isActive })
    .from(warehouses)
    .where(and(eq(warehouses.id, move.warehouseId), eq(warehouses.companyId, companyId)))
    .limit(1);
  if (!warehouse) throw notFound("Ombor topilmadi");
  if (!warehouse.isActive) throw badRequest("Ombor faol emas");

  if (move.batchId) {
    const [batch] = await tx
      .select({ id: batches.id })
      .from(batches)
      .where(and(eq(batches.id, move.batchId), eq(batches.companyId, companyId), eq(batches.productId, product.id)))
      .limit(1);
    if (!batch) throw badRequest("Partiya topilmadi");
  }

  let level = await lockLevel(tx, companyId, product.id, warehouse.id);
  if (!level) {
    if (!incoming && !move.allowNegative) throw badRequest("Bu mahsulot omborda mavjud emas");
    await tx.insert(stockLevels).values({ companyId, productId: product.id, warehouseId: warehouse.id }).onConflictDoNothing();
    level = await lockLevel(tx, companyId, product.id, warehouse.id);
  }

  // Nol tannarxli kirim (bepul tovar) ham o'rtachani kamaytiradi; tannarx berilmasa o'zgarmaydi.
  // Qoldiq nol yoki manfiy bo'lsa (offline sotuvdan keyin) o'rtacha — kirim tannarxi (manfiy miqdor bilan tortish ma'nosiz).
  const updatesCost = INCOMING.has(move.type) && move.costPrice != null;
  const [updated] = await tx
    .update(stockLevels)
    .set({
      quantity: sql`${stockLevels.quantity} + ${delta}::numeric`,
      ...(updatesCost
        ? {
            avgCostPrice: sql`case when ${stockLevels.quantity} <= 0 then round(${move.costPrice}::numeric, 4)
              else round((${stockLevels.quantity} * ${stockLevels.avgCostPrice} + ${delta}::numeric * ${move.costPrice}::numeric) / (${stockLevels.quantity} + ${delta}::numeric), 4) end`,
          }
        : {}),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(stockLevels.id, level!.id),
        move.allowNegative && !incoming ? undefined : sql`${stockLevels.quantity} + ${delta}::numeric >= 0`,
      ),
    )
    .returning({ quantity: stockLevels.quantity, avgCostPrice: stockLevels.avgCostPrice });
  if (!updated) throw badRequest("Yetarli zaxira mavjud emas");

  // Hech qachon kirim bo'lmagan mahsulot offline sotilsa — tannarx xarid narxidan (asosiy valyutada bo'lsa)
  let issueCost = level!.avgCostPrice;
  if (move.allowNegative && !incoming && toMinor(issueCost, 4) === 0n && !product.purchaseCurrency) {
    issueCost = product.purchasePrice;
  }

  const [movement] = await tx
    .insert(stockMovements)
    .values({
      companyId,
      type: move.type,
      productId: product.id,
      warehouseId: warehouse.id,
      zoneId: move.zoneId ?? null,
      batchId: move.batchId ?? null,
      quantity: delta,
      unitId: product.baseUnitId,
      costPrice: updatesCost ? move.costPrice! : issueCost,
      referenceType: move.referenceType ?? null,
      referenceId: move.referenceId ?? null,
      notes: move.notes ?? null,
      performedBy,
      occurredAt: move.occurredAt ?? new Date(),
    })
    .returning(movementFields);

  if (move.type !== "count") {
    const moved = txMovements.get(tx) ?? [];
    moved.push({ productId: product.id, warehouseId: warehouse.id, quantity: movement!.quantity, occurredAt: movement!.occurredAt });
    txMovements.set(tx, moved);
  }

  return { movement: movement!, level: updated };
}

// ─── O'qish ──────────────────────────────────────────────────────────────────

export async function listStock(
  conn: DbOrTx,
  tenant: TenantContext,
  options: { warehouseId: string; search?: string; lowStockOnly?: boolean },
) {
  assertWarehouseAccess(tenant, options.warehouseId);
  const pattern = options.search ? `%${options.search.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;

  return conn
    .select({
      id: stockLevels.id,
      productId: stockLevels.productId,
      warehouseId: stockLevels.warehouseId,
      quantity: stockLevels.quantity,
      reservedQty: stockLevels.reservedQty,
      availableQty: sql<string>`${stockLevels.quantity} - ${stockLevels.reservedQty}`,
      avgCostPrice: stockLevels.avgCostPrice,
      productName: products.name,
      productSku: products.sku,
      productBarcode: products.barcode,
      minStock: products.minStock,
      maxStock: products.maxStock,
      unitName: units.shortName,
      isLow: sql<boolean>`${stockLevels.quantity} <= ${products.minStock}`,
      isOverstock: sql<boolean>`${products.maxStock} is not null and ${stockLevels.quantity} > ${products.maxStock}`,
      updatedAt: stockLevels.updatedAt,
    })
    .from(stockLevels)
    .innerJoin(products, eq(products.id, stockLevels.productId))
    .innerJoin(units, eq(units.id, products.baseUnitId))
    .where(
      and(
        eq(stockLevels.companyId, tenant.company.id),
        eq(stockLevels.warehouseId, options.warehouseId),
        eq(products.isActive, true),
        productScopeCondition(await categoryScope(conn, tenant)),
        options.lowStockOnly ? sql`${stockLevels.quantity} <= ${products.minStock}` : undefined,
        pattern
          ? or(ilike(products.name, pattern), ilike(products.sku, pattern), ilike(products.barcode, pattern))
          : undefined,
      ),
    )
    .orderBy(asc(products.name));
}

export async function productStock(conn: DbOrTx, tenant: TenantContext, productId: string) {
  const [product] = await conn
    .select({ id: products.id })
    .from(products)
    .where(
      and(
        eq(products.id, productId),
        eq(products.companyId, tenant.company.id),
        productScopeCondition(await categoryScope(conn, tenant)),
      ),
    )
    .limit(1);
  if (!product) throw notFound("Mahsulot topilmadi");

  const allowed = allowedWarehouses(tenant);
  return conn
    .select({
      warehouseId: stockLevels.warehouseId,
      warehouseName: warehouses.name,
      quantity: stockLevels.quantity,
      reservedQty: stockLevels.reservedQty,
      avgCostPrice: stockLevels.avgCostPrice,
    })
    .from(stockLevels)
    .innerJoin(warehouses, eq(warehouses.id, stockLevels.warehouseId))
    .where(
      and(
        eq(stockLevels.companyId, tenant.company.id),
        eq(stockLevels.productId, productId),
        allowed ? inArray(stockLevels.warehouseId, allowed) : undefined,
      ),
    )
    .orderBy(asc(warehouses.name));
}

export async function warehouseStats(conn: DbOrTx, tenant: TenantContext, warehouseId: string) {
  assertWarehouseAccess(tenant, warehouseId);
  const [stats] = await conn
    .select({
      totalValue: sql<string>`coalesce(sum(${stockLevels.quantity} * ${stockLevels.avgCostPrice}), 0)::numeric(18,2)`,
      totalItems: count(),
      lowStockCount: sql<number>`(count(*) filter (where ${stockLevels.quantity} > 0 and ${stockLevels.quantity} <= ${products.minStock}))::int`,
      zeroStockCount: sql<number>`(count(*) filter (where ${stockLevels.quantity} = 0))::int`,
    })
    .from(stockLevels)
    .innerJoin(products, eq(products.id, stockLevels.productId))
    .where(
      and(
        eq(stockLevels.companyId, tenant.company.id),
        eq(stockLevels.warehouseId, warehouseId),
        eq(products.isActive, true),
        productScopeCondition(await categoryScope(conn, tenant)),
      ),
    );
  return stats!;
}

export async function listMovements(
  conn: DbOrTx,
  tenant: TenantContext,
  options: { warehouseId?: string; productId?: string; type?: MovementType; limit: number; cursor?: string },
) {
  if (options.warehouseId) assertWarehouseAccess(tenant, options.warehouseId);
  const allowed = options.warehouseId ? null : allowedWarehouses(tenant);

  let after: { at: Date; id: string } | null = null;
  if (options.cursor) {
    const [iso, id] = decodeCursor(options.cursor, 2) as [string, string];
    const at = new Date(iso);
    if (Number.isNaN(at.getTime()) || !UUID_RE.test(id)) throw badRequest("Kursor noto'g'ri");
    after = { at, id };
  }

  const rows = await conn
    .select({
      ...movementFields,
      productName: products.name,
      productSku: products.sku,
      warehouseName: warehouses.name,
      unitName: units.shortName,
    })
    .from(stockMovements)
    .innerJoin(products, eq(products.id, stockMovements.productId))
    .innerJoin(warehouses, eq(warehouses.id, stockMovements.warehouseId))
    .innerJoin(units, eq(units.id, stockMovements.unitId))
    .where(
      and(
        eq(stockMovements.companyId, tenant.company.id),
        options.warehouseId ? eq(stockMovements.warehouseId, options.warehouseId) : undefined,
        allowed ? inArray(stockMovements.warehouseId, allowed) : undefined,
        options.productId ? eq(stockMovements.productId, options.productId) : undefined,
        productScopeCondition(await categoryScope(conn, tenant)),
        options.type ? eq(stockMovements.type, options.type) : undefined,
        after
          ? or(
              lt(stockMovements.occurredAt, after.at),
              and(eq(stockMovements.occurredAt, after.at), lt(stockMovements.id, after.id)),
            )
          : undefined,
      ),
    )
    .orderBy(desc(stockMovements.occurredAt), desc(stockMovements.id))
    .limit(options.limit + 1);

  const page = rows.slice(0, options.limit);
  const last = page.at(-1);
  return {
    movements: page,
    nextCursor:
      rows.length > options.limit && last ? encodeCursor([last.occurredAt.toISOString(), last.id]) : null,
  };
}

// ─── Qo'lda harakat va o'tkazma ──────────────────────────────────────────────

export const MANUAL_MOVEMENT_TYPES = ["receive", "issue", "adjust", "writeoff", "return_in", "return_out"] as const;
export type ManualMovementType = (typeof MANUAL_MOVEMENT_TYPES)[number];

const MOVEMENT_LABELS: Record<ManualMovementType, string> = {
  receive: "Tovar qabul qilindi",
  issue: "Tovar chiqarildi",
  adjust: "Zaxira tuzatildi",
  writeoff: "Hisobdan chiqarildi",
  return_in: "Qaytib kelgan tovar",
  return_out: "Qaytarilgan tovar",
};

/** Harakat qiymati tannarxda (tiyin): |miqdor| × tannarx. */
export function movementValue(quantity: string, costPrice: string): bigint {
  return rescale(toMinor(quantity.replace(/^-/, ""), 4) * toMinor(costPrice, 4), 8, 2);
}

/**
 * Qo'lda harakat va inventarizatsiya buxgalteriyasi (tannarxda):
 *   kirim  — DR 1200 Tovar zaxirasi / CR qarshi hisob (standart: qabul — 3000 Ustav kapitali, ya'ni boshlang'ich
 *            qoldiq; tuzatish va ortiqcha — 4100 Boshqa daromadlar)
 *   chiqim — DR qarshi hisob (standart 5500 Boshqa xarajatlar) / CR 1200
 * `counterAccountId` — kompaniyaning istalgan faol hisobi (masalan, 2000 Kreditorlar), tovar zaxirasidan boshqa.
 */
export async function postStockJournal(
  tx: Tx,
  companyId: string,
  userId: string,
  input: {
    referenceType: string;
    referenceId: string;
    date: string;
    description: string;
    /** Tiyinda. */
    incoming: bigint;
    outgoing: bigint;
    incomingCounter: "capital" | "other_income";
    counterAccountId?: string | null;
  },
) {
  if (input.incoming <= 0n && input.outgoing <= 0n) return null;
  const inventory = await requireAccountBySubtype(tx, companyId, "inventory", "asset", "Tovar zaxirasi");
  let counter: string | null = null;
  if (input.counterAccountId) {
    const [account] = await tx
      .select({ id: accounts.id, isActive: accounts.isActive })
      .from(accounts)
      .where(and(eq(accounts.id, input.counterAccountId), eq(accounts.companyId, companyId)))
      .limit(1);
    if (!account || !account.isActive) throw badRequest("Qarshi hisob topilmadi");
    if (account.id === inventory) throw badRequest("Qarshi hisob tovar zaxirasi hisobi bo'lmasligi kerak");
    counter = account.id;
  }

  const lines: { accountId: string; debit?: string; credit?: string }[] = [];
  if (input.incoming > 0n) {
    const credit =
      counter ??
      (input.incomingCounter === "capital"
        ? await requireAccountBySubtype(tx, companyId, "capital", "equity", "Ustav kapitali")
        : await requireAccountBySubtype(tx, companyId, "other", "income", "Boshqa daromadlar"));
    lines.push({ accountId: inventory, debit: fromMinor(input.incoming) }, { accountId: credit, credit: fromMinor(input.incoming) });
  }
  if (input.outgoing > 0n) {
    const debit = counter ?? (await requireAccountBySubtype(tx, companyId, "other", "expense", "Boshqa xarajatlar"));
    lines.push({ accountId: debit, debit: fromMinor(input.outgoing) }, { accountId: inventory, credit: fromMinor(input.outgoing) });
  }
  const { entry } = await postJournalEntry(tx, companyId, userId, {
    entryDate: input.date,
    description: input.description,
    referenceType: input.referenceType,
    referenceId: input.referenceId,
    lines,
  });
  return entry;
}

/**
 * Boshqa o'lchov birligidagi miqdor va birlik narxini asosiy birlikka o'tkazadi:
 * 2 quti × 12 = 24 dona, quti narxi 24000 → dona narxi 2000. Aniq o'nlik arifmetika.
 */
export async function toBaseUnit(
  tx: Tx,
  companyId: string,
  input: { productId: string; unitId?: string | null; quantity: string; costPrice?: string | null },
) {
  if (!input.unitId) return { quantity: input.quantity, costPrice: input.costPrice, factor: "1" };

  const [product] = await tx
    .select({ id: products.id, name: products.name, baseUnitId: products.baseUnitId })
    .from(products)
    .where(and(eq(products.id, input.productId), eq(products.companyId, companyId)))
    .limit(1);
  if (!product) throw notFound("Mahsulot topilmadi");

  const factor = await unitFactorToBase(tx, companyId, product, input.unitId);
  if (factor === "1") return { quantity: input.quantity, costPrice: input.costPrice, factor };

  const factorMinor = toMinor(factor, 4);
  return {
    quantity: fromMinor(rescale(toMinor(input.quantity, 4) * factorMinor, 8, 4), 4),
    costPrice:
      input.costPrice == null ? input.costPrice : fromMinor(mulDivRound(toMinor(input.costPrice, 4), 10_000n, factorMinor), 4),
    factor,
  };
}

export async function recordManualMovement(
  tx: Tx,
  tenant: TenantContext,
  input: Omit<StockMove, "type" | "referenceType" | "referenceId" | "zoneId"> & {
    type: ManualMovementType;
    /** Kiritilgan birlik; berilmasa — asosiy birlik. */
    unitId?: string | null;
    /** Buxgalteriyadagi qarshi hisob; berilmasa — standart (`postStockJournal`). */
    counterAccountId?: string | null;
  },
  meta: RequestMeta,
) {
  assertWarehouseAccess(tenant, input.warehouseId);
  await assertProductsInScope(tx, tenant, [input.productId]);
  const { unitId, counterAccountId, ...move } = input;
  const base = await toBaseUnit(tx, tenant.company.id, input);
  const result = await moveStock(tx, tenant.company.id, tenant.user.id, {
    ...move,
    quantity: base.quantity,
    costPrice: base.costPrice,
  });

  // Buxgalteriya: harakat tannarxda (kirim — zaxira ko'payadi, chiqim — kamayadi)
  const value = movementValue(result.movement.quantity, result.movement.costPrice);
  const incoming = !result.movement.quantity.startsWith("-");
  const journal = await postStockJournal(tx, tenant.company.id, tenant.user.id, {
    referenceType: "stock_movement",
    referenceId: result.movement.id,
    date: input.occurredAt ? input.occurredAt.toISOString().slice(0, 10) : todayIso(),
    description: MOVEMENT_LABELS[input.type],
    incoming: incoming ? value : 0n,
    outgoing: incoming ? 0n : value,
    incomingCounter: input.type === "adjust" ? "other_income" : "capital",
    counterAccountId,
  });

  await writeAuditLog(
    {
      userId: tenant.user.id,
      userName: tenant.user.name,
      companyId: tenant.company.id,
      action: "STOCK_MOVEMENT_RECORDED",
      resource: "stock_movements",
      resourceId: result.movement.id,
      details: {
        type: input.type,
        productId: input.productId,
        warehouseId: input.warehouseId,
        quantity: result.movement.quantity,
        ...(unitId && base.factor !== "1" ? { enteredQuantity: input.quantity, unitId, factor: base.factor } : {}),
        value: fromMinor(value),
        journalEntryId: journal?.id ?? null,
      },
      ...meta,
    },
    tx,
  );
  // O'tgan sana bilan — undan keyingi inventarizatsiya bu tovarni allaqachon sanagan bo'lishi mumkin
  if (input.occurredAt) await compensateCountedMovements(tx, tenant.company.id, tenant.user.id);
  return { ...result, journalEntryId: journal?.id ?? null };
}

export async function transferStock(
  tx: Tx,
  tenant: TenantContext,
  input: {
    productId: string;
    fromWarehouseId: string;
    toWarehouseId: string;
    quantity: string;
    unitId?: string | null;
    /** O'tgan sana bilan kiritish; berilmasa — hozir. */
    occurredAt?: Date;
    notes?: string | null;
  },
  meta: RequestMeta,
) {
  if (input.fromWarehouseId === input.toWarehouseId) throw badRequest("Bir xil ombor tanlandi");
  assertWarehouseAccess(tenant, input.fromWarehouseId);
  assertWarehouseAccess(tenant, input.toWarehouseId);
  await assertProductsInScope(tx, tenant, [input.productId]);

  // Ikki qarama-qarshi o'tkazma deadlock bermasligi uchun qulflar doim bir xil tartibda
  await tx
    .select({ id: stockLevels.id })
    .from(stockLevels)
    .where(
      and(
        eq(stockLevels.companyId, tenant.company.id),
        eq(stockLevels.productId, input.productId),
        inArray(stockLevels.warehouseId, [input.fromWarehouseId, input.toWarehouseId]),
      ),
    )
    .orderBy(asc(stockLevels.warehouseId))
    .for("update");

  const referenceId = randomUUID();
  const { quantity } = await toBaseUnit(tx, tenant.company.id, input);
  const base = {
    productId: input.productId,
    quantity,
    notes: input.notes ?? null,
    referenceType: "transfer",
    referenceId,
    occurredAt: input.occurredAt,
  };

  const out = await moveStock(tx, tenant.company.id, tenant.user.id, {
    ...base,
    type: "transfer_out",
    warehouseId: input.fromWarehouseId,
  });
  // Qabul qiluvchi ombor manbadagi o'rtacha tannarxni oladi — mijoz tannarx bera olmaydi
  const into = await moveStock(tx, tenant.company.id, tenant.user.id, {
    ...base,
    type: "transfer_in",
    warehouseId: input.toWarehouseId,
    costPrice: out.movement.costPrice,
  });

  await writeAuditLog(
    {
      userId: tenant.user.id,
      userName: tenant.user.name,
      companyId: tenant.company.id,
      action: "STOCK_TRANSFERRED",
      resource: "stock_movements",
      resourceId: referenceId,
      details: { ...input, baseQuantity: quantity, costPrice: out.movement.costPrice },
      ...meta,
    },
    tx,
  );
  if (input.occurredAt) await compensateCountedMovements(tx, tenant.company.id, tenant.user.id);
  return { referenceId, from: out.level, to: into.level, costPrice: out.movement.costPrice };
}

// ─── Kech yozilgan hujjat va inventarizatsiya ───────────────────────────────

export type CountCompensation = { productId: string; warehouseId: string; countId: string; countName: string; quantity: string };

/**
 * Inventarizatsiyadan OLDIN bo'lgan, lekin undan KEYIN yozilayotgan harakat — boshqa kassaning kech sinxron bo'lgan
 * offline hujjati yoki o'tgan sana bilan kiritilgan kirim/chiqim. Sanoq bu tovarni allaqachon hisobga olgan (sanalgan
 * miqdorga kirgan), shuning uchun qoldiq ikkinchi marta o'zgarmasligi kerak: joriy tranzaksiyadagi shunday harakatlar
 * uchun eng oxirgi mos inventarizatsiya nomidan teskari tuzatma (`count`) va jurnal (boshqa daromad/xarajat) yoziladi.
 * Hujjatning o'zi (tannarx, sotuv, qarz) o'zgarmaydi. Chaqiruvchilar — offline sinxron va o'tgan sanali qo'lda harakat.
 */
export async function compensateCountedMovements(tx: Tx, companyId: string, userId: string): Promise<CountCompensation[]> {
  const moved = txMovements.get(tx) ?? [];
  txMovements.delete(tx);
  if (moved.length === 0) return [];

  const values = sql.join(
    moved.map((item, index) => sql`(${index}::int, ${item.productId}::uuid, ${item.warehouseId}::uuid, ${item.occurredAt.toISOString()}::timestamptz)`),
    sql`, `,
  );
  const { rows } = await tx.execute<{ idx: number; count_id: string; completed_at: Date | string; name: string }>(sql`
    select v.idx, c.id as count_id, c.completed_at, c.name
    from (values ${values}) as v(idx, product_id, warehouse_id, occurred_at)
    join lateral (
      select ic.id, ic.completed_at, ic.name
      from ${inventoryCounts} ic
      join ${inventoryCountItems} ici on ici.count_id = ic.id
      where ic.company_id = ${companyId}
        and ic.warehouse_id = v.warehouse_id
        and ic.status = 'completed'
        and ic.adjustments_made
        and ici.product_id = v.product_id
        and ici.counted_qty is not null
        and ic.completed_at > v.occurred_at
      order by ic.completed_at desc
      limit 1
    ) c on true`);

  const groups = new Map<string, { productId: string; warehouseId: string; countId: string; countName: string; countedAt: Date; quantity: bigint }>();
  for (const row of rows) {
    const item = moved[Number(row.idx)]!;
    const key = `${item.productId}:${item.warehouseId}:${row.count_id}`;
    const group = groups.get(key) ?? {
      productId: item.productId,
      warehouseId: item.warehouseId,
      countId: row.count_id,
      countName: row.name,
      countedAt: new Date(row.completed_at),
      quantity: 0n,
    };
    group.quantity += signedQtyMinor(item.quantity);
    groups.set(key, group);
  }

  const adjustments: CountCompensation[] = [];
  for (const group of groups.values()) {
    if (group.quantity === 0n) continue;
    const quantity = signedQtyText(-group.quantity);
    const { movement } = await moveStock(tx, companyId, userId, {
      type: "count",
      productId: group.productId,
      warehouseId: group.warehouseId,
      quantity,
      referenceType: "inventory_count",
      referenceId: group.countId,
      notes: `Inventarizatsiya tuzatmasi (${group.countName}): sanashdan oldingi hujjat kech yozildi`,
      occurredAt: group.countedAt,
      allowNegative: true,
    });
    const value = movementValue(movement.quantity, movement.costPrice);
    const incoming = !movement.quantity.startsWith("-");
    await postStockJournal(tx, companyId, userId, {
      referenceType: "inventory_count",
      referenceId: group.countId,
      date: todayIso(),
      description: `Inventarizatsiya tuzatmasi: ${group.countName}`,
      incoming: incoming ? value : 0n,
      outgoing: incoming ? 0n : value,
      incomingCounter: "other_income",
    });
    adjustments.push({ productId: group.productId, warehouseId: group.warehouseId, countId: group.countId, countName: group.countName, quantity });
  }
  return adjustments;
}
