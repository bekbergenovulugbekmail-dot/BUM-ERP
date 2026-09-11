/**
 * O'lchov birliklari (platforma) va birlik konversiyalari (kompaniya).
 *
 * Convex'dagi convex/products/units.ts da autentifikatsiya UMUMAN yo'q edi:
 * istalgan odam (tizimga kirmagan ham) global birlik va konversiya yaratardi,
 * listConversions esa barcha kompaniyalarning konversiyalarini qaytarardi.
 *
 *  - units: platforma darajasida, yozish faqat platforma admini (sxema qarori)
 *  - unit_conversions: kompaniyaga tegishli, `products.manage`
 */
import { and, eq, inArray } from "drizzle-orm";
import { badRequest, notFound } from "@bum/shared";
import { products, unitConversions, units } from "../../db/schema/catalog.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import { writeAuditLog, type RequestMeta } from "../../shared/audit.js";
import type { SessionUser } from "../auth/session.js";
import type { TenantContext } from "../company/tenant.js";
import { assertConversionInScope } from "./category-scope.js";

/** Convex'dagi seedDefaultUnits bilan bir xil ro'yxat. */
export const DEFAULT_UNITS = [
  { name: "Dona", shortName: "d", isBase: true },
  { name: "Kilogramm", shortName: "kg", isBase: true },
  { name: "Litr", shortName: "l", isBase: true },
  { name: "Metr", shortName: "m", isBase: true },
  { name: "Quti", shortName: "qt", isBase: false },
  { name: "Blok", shortName: "bl", isBase: false },
  { name: "Pallet", shortName: "pal", isBase: false },
  { name: "Gramm", shortName: "g", isBase: false },
  { name: "Millilitr", shortName: "ml", isBase: false },
] as const;

const unitColumns = {
  id: units.id,
  name: units.name,
  shortName: units.shortName,
  isBase: units.isBase,
  isActive: units.isActive,
};

/** Idempotent — nomi band birliklar o'tkazib yuboriladi (`db:seed` chaqiradi). */
export async function seedDefaultUnits(conn: DbOrTx): Promise<number> {
  const inserted = await conn
    .insert(units)
    .values(DEFAULT_UNITS.map((u) => ({ ...u })))
    .onConflictDoNothing()
    .returning({ id: units.id });
  return inserted.length;
}

export async function listUnits(conn: DbOrTx, includeInactive = false) {
  return conn
    .select(unitColumns)
    .from(units)
    .where(includeInactive ? undefined : eq(units.isActive, true))
    .orderBy(units.name);
}

/** Faol birliklar mavjudligini tekshiradi (mahsulot va partiya yozishda). */
export async function assertUnitsActive(conn: DbOrTx, ids: (string | null | undefined)[]): Promise<void> {
  const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (wanted.length === 0) return;
  const found = await conn
    .select({ id: units.id })
    .from(units)
    .where(and(inArray(units.id, wanted), eq(units.isActive, true)));
  if (found.length !== wanted.length) throw badRequest("O'lchov birligi topilmadi");
}

function auditPlatform(tx: Tx, actor: SessionUser, meta: RequestMeta, action: string, id: string, details: Record<string, unknown>) {
  return writeAuditLog(
    { userId: actor.id, userName: actor.name, action, resource: "units", resourceId: id, details, ...meta },
    tx,
  );
}

export type UnitInput = { name: string; shortName: string; isBase: boolean };

export async function createUnit(tx: Tx, actor: SessionUser, input: UnitInput, meta: RequestMeta) {
  const [unit] = await tx.insert(units).values(input).returning(unitColumns);
  await auditPlatform(tx, actor, meta, "UNIT_CREATED", unit!.id, { ...input });
  return unit!;
}

export async function updateUnit(
  tx: Tx,
  actor: SessionUser,
  unitId: string,
  patch: Partial<UnitInput> & { isActive?: boolean },
  meta: RequestMeta,
) {
  const [updated] = await tx
    .update(units)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(units.id, unitId))
    .returning(unitColumns);
  if (!updated) throw notFound("O'lchov birligi topilmadi");
  await auditPlatform(tx, actor, meta, "UNIT_UPDATED", unitId, { changes: Object.keys(patch) });
  return updated;
}

// ─── Konversiyalar (kompaniya) ───────────────────────────────────────────────

const conversionColumns = {
  id: unitConversions.id,
  fromUnitId: unitConversions.fromUnitId,
  toUnitId: unitConversions.toUnitId,
  factor: unitConversions.factor,
  productId: unitConversions.productId,
  createdAt: unitConversions.createdAt,
};

export async function listConversions(conn: DbOrTx, tenant: TenantContext, productId?: string) {
  return conn
    .select(conversionColumns)
    .from(unitConversions)
    .where(
      and(
        eq(unitConversions.companyId, tenant.company.id),
        productId ? eq(unitConversions.productId, productId) : undefined,
      ),
    )
    .orderBy(unitConversions.createdAt);
}

export type ConversionInput = {
  fromUnitId: string;
  toUnitId: string;
  factor: string;
  productId?: string | null;
};

export async function createConversion(tx: Tx, tenant: TenantContext, input: ConversionInput, meta: RequestMeta) {
  if (input.fromUnitId === input.toUnitId) throw badRequest("Birlik o'ziga konvertatsiya qilinmaydi");
  await assertUnitsActive(tx, [input.fromUnitId, input.toUnitId]);

  if (input.productId) {
    const [product] = await tx
      .select({ id: products.id })
      .from(products)
      .where(and(eq(products.id, input.productId), eq(products.companyId, tenant.company.id)))
      .limit(1);
    if (!product) throw badRequest("Mahsulot topilmadi");
  }
  await assertConversionInScope(tx, tenant, input.productId ?? null);

  const [conversion] = await tx
    .insert(unitConversions)
    .values({ ...input, productId: input.productId ?? null, companyId: tenant.company.id })
    .returning(conversionColumns);

  await writeAuditLog(
    {
      userId: tenant.user.id,
      userName: tenant.user.name,
      companyId: tenant.company.id,
      action: "UNIT_CONVERSION_CREATED",
      resource: "unit_conversions",
      resourceId: conversion!.id,
      details: { ...input },
      ...meta,
    },
    tx,
  );
  return conversion!;
}

export async function deleteConversion(tx: Tx, tenant: TenantContext, conversionId: string, meta: RequestMeta) {
  const [existing] = await tx
    .select({ productId: unitConversions.productId })
    .from(unitConversions)
    .where(and(eq(unitConversions.id, conversionId), eq(unitConversions.companyId, tenant.company.id)))
    .limit(1);
  if (existing) await assertConversionInScope(tx, tenant, existing.productId);

  const [deleted] = await tx
    .delete(unitConversions)
    .where(and(eq(unitConversions.id, conversionId), eq(unitConversions.companyId, tenant.company.id)))
    .returning(conversionColumns);
  if (!deleted) throw notFound("Konversiya topilmadi");

  await writeAuditLog(
    {
      userId: tenant.user.id,
      userName: tenant.user.name,
      companyId: tenant.company.id,
      action: "UNIT_CONVERSION_DELETED",
      resource: "unit_conversions",
      resourceId: conversionId,
      details: { fromUnitId: deleted.fromUnitId, toUnitId: deleted.toUnitId, factor: deleted.factor },
      ...meta,
    },
    tx,
  );
}
