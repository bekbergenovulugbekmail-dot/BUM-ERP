/**
 * Hududlar (Urganch, Xiva ...) — marshrutlar shu hudud tarkibida bo'ladi.
 *
 * Avval hudud ochiladi, keyin unga marshrut qo'shiladi ("Urganch" hududida "Luchevoy", "Nadmes bozor").
 * Hudud o'chirilmaydi: marshruti bor hudud faqat faolsizlantiriladi (ma'lumot yo'qolmaydi).
 */
import { and, asc, eq, ilike, ne, sql } from "drizzle-orm";
import { conflict, notFound } from "@bum/shared";
import { distributionRoutes, territories } from "../../db/schema/crm.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import type { RequestMeta } from "../../shared/audit.js";
import type { TenantContext } from "../company/tenant.js";
import { distributionAudit } from "./sales-reps.service.js";

export type TerritoryInput = { name: string; description?: string | null };

/** Hudud shu kompaniyaniki ekanini tekshiradi (marshrut biriktirishda). */
export async function assertTerritory(conn: DbOrTx, companyId: string, territoryId: string) {
  const [row] = await conn
    .select({ id: territories.id, isActive: territories.isActive })
    .from(territories)
    .where(and(eq(territories.id, territoryId), eq(territories.companyId, companyId)))
    .limit(1);
  if (!row) throw notFound("Hudud topilmadi");
  return row;
}

export async function listTerritories(conn: DbOrTx, tenant: TenantContext, includeInactive = false) {
  return conn
    .select({
      id: territories.id,
      name: territories.name,
      description: territories.description,
      isActive: territories.isActive,
      createdAt: territories.createdAt,
      // Tashqi ustun ANIQ ko'rsatiladi: qo'shilmasiz so'rovda drizzle jadval nomini qo'shmaydi va
      // ichki jadvalning "id" ustuni bilan chalkashib ketadi
      routeCount: sql<number>`(select count(*)::int from ${distributionRoutes} where ${distributionRoutes.territoryId} = ${sql.identifier("territories")}.${sql.identifier("id")})`,
    })
    .from(territories)
    .where(and(eq(territories.companyId, tenant.company.id), includeInactive ? undefined : eq(territories.isActive, true)))
    .orderBy(asc(territories.name));
}

/** Nom bo'yicha takrorlanmaydi (registrga befarq). */
async function assertNameFree(tx: Tx, companyId: string, name: string, exceptId?: string) {
  const [taken] = await tx
    .select({ id: territories.id })
    .from(territories)
    .where(
      and(
        eq(territories.companyId, companyId),
        ilike(territories.name, name),
        exceptId ? ne(territories.id, exceptId) : undefined,
      ),
    )
    .limit(1);
  if (taken) throw conflict(`"${name}" hududi allaqachon bor`);
}

export async function createTerritory(tx: Tx, tenant: TenantContext, input: TerritoryInput, meta: RequestMeta) {
  const companyId = tenant.company.id;
  const name = input.name.trim();
  await assertNameFree(tx, companyId, name);
  const [territory] = await tx
    .insert(territories)
    .values({ companyId, name, description: input.description ?? null })
    .returning({ id: territories.id, name: territories.name, description: territories.description, isActive: territories.isActive });
  await distributionAudit(tx, tenant, meta, {
    action: "TERRITORY_CREATED",
    resource: "territories",
    resourceId: territory!.id,
    details: { name },
  });
  return territory!;
}

export async function updateTerritory(
  tx: Tx,
  tenant: TenantContext,
  territoryId: string,
  patch: Partial<TerritoryInput> & { isActive?: boolean },
  meta: RequestMeta,
) {
  const companyId = tenant.company.id;
  await assertTerritory(tx, companyId, territoryId);
  const name = patch.name?.trim();
  if (name) await assertNameFree(tx, companyId, name, territoryId);

  const [territory] = await tx
    .update(territories)
    .set({
      ...(name ? { name } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
      updatedAt: new Date(),
    })
    .where(eq(territories.id, territoryId))
    .returning({ id: territories.id, name: territories.name, description: territories.description, isActive: territories.isActive });
  await distributionAudit(tx, tenant, meta, {
    action: "TERRITORY_UPDATED",
    resource: "territories",
    resourceId: territoryId,
    details: { name: territory!.name, isActive: territory!.isActive },
  });
  return territory!;
}

/** Marshruti bor hudud o'chirilmaydi — avval marshrutlar boshqa hududga o'tkaziladi. */
export async function deleteTerritory(tx: Tx, tenant: TenantContext, territoryId: string, meta: RequestMeta) {
  const companyId = tenant.company.id;
  await assertTerritory(tx, companyId, territoryId);
  const [used] = await tx
    .select({ id: distributionRoutes.id })
    .from(distributionRoutes)
    .where(and(eq(distributionRoutes.companyId, companyId), eq(distributionRoutes.territoryId, territoryId)))
    .limit(1);
  if (used) throw conflict("Hududda marshrutlar bor — avval ularni boshqa hududga o'tkazing yoki hududni faolsizlantiring");

  await tx.delete(territories).where(eq(territories.id, territoryId));
  await distributionAudit(tx, tenant, meta, {
    action: "TERRITORY_DELETED",
    resource: "territories",
    resourceId: territoryId,
    details: {},
  });
}

/** Import uchun: nomi bo'yicha topadi, bo'lmasa ochadi. */
export async function findOrCreateTerritory(tx: Tx, tenant: TenantContext, name: string, meta: RequestMeta) {
  const trimmed = name.trim();
  const [found] = await tx
    .select({ id: territories.id })
    .from(territories)
    .where(and(eq(territories.companyId, tenant.company.id), ilike(territories.name, trimmed)))
    .limit(1);
  if (found) return found.id;
  const created = await createTerritory(tx, tenant, { name: trimmed }, meta);
  return created.id;
}
