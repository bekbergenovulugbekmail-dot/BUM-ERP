/**
 * Hududlar — GEOGRAFIK ma'lumotnoma: viloyat → shahar/tuman → mahalla (`kind` + `parentId`).
 *
 * Marshrut shahar/tuman darajasidagi hududga biriktiriladi ("Urganch" ichida "Luchevoy", "Nadmes bozor"),
 * mijozning "Shahar/tuman" va "Mahalla" maydonlari ham shu ma'lumotnomadan tanlanadi. Mijozda ular MATN
 * bo'lib saqlanadi (dostavka, eksport va saralash shunga tayanadi), shuning uchun ma'lumotnomadagi nom
 * o'zgarsa mijozlardagi qiymat ham yangilanadi — ikkovi ajralib qolmaydi.
 *
 * Hudud o'chirilmaydi: marshruti, mijozi yoki ichki hududi bori faqat faolsizlantiriladi.
 */
import { and, asc, eq, ilike, isNull, ne, sql } from "drizzle-orm";
import { badRequest, conflict, notFound } from "@bum/shared";
import { distributionRoutes, territories } from "../../db/schema/crm.js";
import { customers } from "../../db/schema/sales.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import type { RequestMeta } from "../../shared/audit.js";
import type { TenantContext } from "../company/tenant.js";
import { distributionAudit } from "./sales-reps.service.js";
import { UZBEKISTAN_REGIONS } from "./uzbekistan-regions.js";

/** 'region' — viloyat, 'district' — shahar/tuman, 'neighborhood' — mahalla. */
export type TerritoryKind = "region" | "district" | "neighborhood";

export type TerritoryInput = {
  name: string;
  kind?: TerritoryKind;
  /** Ota hudud: tuman viloyat ichida, mahalla tuman ichida (yuqori daraja — null). */
  parentId?: string | null;
  description?: string | null;
};

/** Qaysi daraja qaysi otaga tushadi: mahalla — tuman ichida, tuman — viloyat ichida (yoki yakka). */
const PARENT_OF: Record<TerritoryKind, TerritoryKind | null> = {
  region: null,
  district: "region",
  neighborhood: "district",
};

const KIND_LABEL: Record<TerritoryKind, string> = {
  region: "viloyat",
  district: "shahar/tuman",
  neighborhood: "mahalla",
};

/**
 * Ota hududni tekshiradi: mahalla faqat shahar/tuman ichida, shahar/tuman faqat viloyat ichida bo'ladi.
 * Mahallaning otasi MAJBURIY (qaysi tumanga tegishli ekani bilinmasa, ma'lumotnoma ma'nosini yo'qotadi).
 */
async function assertParent(conn: DbOrTx, companyId: string, kind: TerritoryKind, parentId: string | null | undefined) {
  if (!parentId) {
    if (kind === "neighborhood") throw badRequest("Mahalla qaysi shahar/tumanga tegishli ekani ko'rsatilsin");
    return null;
  }
  if (kind === "region") throw badRequest("Viloyat eng yuqori daraja — uning ota hududi bo'lmaydi");
  const [parent] = await conn
    .select({ id: territories.id, kind: territories.kind })
    .from(territories)
    .where(and(eq(territories.id, parentId), eq(territories.companyId, companyId)))
    .limit(1);
  if (!parent) throw notFound("Ota hudud topilmadi");
  const expected = PARENT_OF[kind];
  if (parent.kind !== expected) {
    throw badRequest(`${KIND_LABEL[kind]} faqat ${KIND_LABEL[expected as TerritoryKind]} ichida bo'ladi`);
  }
  return parent.id;
}

/** Hudud shu kompaniyaniki ekanini tekshiradi (marshrut biriktirishda). */
export async function assertTerritory(conn: DbOrTx, companyId: string, territoryId: string) {
  const [row] = await conn
    .select({
      id: territories.id,
      name: territories.name,
      kind: territories.kind,
      parentId: territories.parentId,
      isActive: territories.isActive,
    })
    .from(territories)
    .where(and(eq(territories.id, territoryId), eq(territories.companyId, companyId)))
    .limit(1);
  if (!row) throw notFound("Hudud topilmadi");
  return row;
}

export async function listTerritories(
  conn: DbOrTx,
  tenant: TenantContext,
  includeInactive = false,
  kind?: TerritoryKind,
) {
  const self = sql`${sql.identifier("territories")}.${sql.identifier("id")}`;
  const selfName = sql`${sql.identifier("territories")}.${sql.identifier("name")}`;
  return conn
    .select({
      id: territories.id,
      name: territories.name,
      kind: territories.kind,
      parentId: territories.parentId,
      description: territories.description,
      isActive: territories.isActive,
      createdAt: territories.createdAt,
      // Tashqi ustun ANIQ ko'rsatiladi: qo'shilmasiz so'rovda drizzle jadval nomini qo'shmaydi va
      // ichki jadvalning "id" ustuni bilan chalkashib ketadi
      routeCount: sql<number>`(select count(*)::int from ${distributionRoutes} where ${distributionRoutes.territoryId} = ${self})`,
      /** Shu hudud ichidagi hududlar (viloyatda tumanlar, tumanda mahallalar). */
      childCount: sql<number>`(select count(*)::int from "territories" child where child."parent_id" = ${self})`,
      /**
       * Mijozlar soni: mijozda hudud MATN bo'lib saqlanadi, shuning uchun nom bo'yicha (registrga befarq).
       * Shahar/tuman — `customers.city`, mahalla — `customers.district`.
       */
      customerCount: sql<number>`(
        select count(*)::int from ${customers} cu
        where cu.${sql.identifier("company_id")} = ${territories.companyId}
          and lower(btrim(case when ${territories.kind} = 'neighborhood' then cu.${sql.identifier("district")} else cu.${sql.identifier("city")} end))
              = lower(btrim(${selfName}))
      )`,
    })
    .from(territories)
    .where(
      and(
        eq(territories.companyId, tenant.company.id),
        includeInactive ? undefined : eq(territories.isActive, true),
        kind ? eq(territories.kind, kind) : undefined,
      ),
    )
    .orderBy(asc(territories.kind), asc(territories.name));
}

/**
 * Nom OTA hudud ichida takrorlanmaydi (registrga befarq): turli tumanlarda bir xil nomli mahalla
 * bo'lishi mumkin, bitta tuman ichida esa — yo'q.
 */
async function assertNameFree(tx: Tx, companyId: string, name: string, parentId: string | null, exceptId?: string) {
  const [taken] = await tx
    .select({ id: territories.id })
    .from(territories)
    .where(
      and(
        eq(territories.companyId, companyId),
        ilike(territories.name, name),
        parentId ? eq(territories.parentId, parentId) : isNull(territories.parentId),
        exceptId ? ne(territories.id, exceptId) : undefined,
      ),
    )
    .limit(1);
  if (taken) throw conflict(`"${name}" hududi allaqachon bor`);
}

const returning = {
  id: territories.id,
  name: territories.name,
  kind: territories.kind,
  parentId: territories.parentId,
  description: territories.description,
  isActive: territories.isActive,
};

export async function createTerritory(tx: Tx, tenant: TenantContext, input: TerritoryInput, meta: RequestMeta) {
  const companyId = tenant.company.id;
  const name = input.name.trim();
  const kind = input.kind ?? "district";
  const parentId = await assertParent(tx, companyId, kind, input.parentId);
  await assertNameFree(tx, companyId, name, parentId);
  const [territory] = await tx
    .insert(territories)
    .values({ companyId, name, kind, parentId, description: input.description ?? null })
    .returning(returning);
  await distributionAudit(tx, tenant, meta, {
    action: "TERRITORY_CREATED",
    resource: "territories",
    resourceId: territory!.id,
    details: { name, kind, parentId },
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
  const current = await assertTerritory(tx, companyId, territoryId);
  const name = patch.name?.trim();
  const kind = (patch.kind ?? current.kind) as TerritoryKind;
  // Ota hudud yoki daraja o'zgarsa — qoidaga mosligi qayta tekshiriladi
  const parentId =
    patch.parentId !== undefined || patch.kind !== undefined
      ? await assertParent(tx, companyId, kind, patch.parentId !== undefined ? patch.parentId : current.parentId)
      : current.parentId;
  if (name && (name.toLowerCase() !== current.name.toLowerCase() || parentId !== current.parentId)) {
    await assertNameFree(tx, companyId, name, parentId, territoryId);
  }

  const [territory] = await tx
    .update(territories)
    .set({
      ...(name ? { name } : {}),
      ...(patch.kind !== undefined ? { kind } : {}),
      ...(patch.parentId !== undefined || patch.kind !== undefined ? { parentId } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
      updatedAt: new Date(),
    })
    .where(eq(territories.id, territoryId))
    .returning(returning);

  // Nom o'zgargan bo'lsa — mijozlardagi matn ham yangilanadi (ma'lumotnoma bilan ajralib qolmasin)
  let renamedCustomers = 0;
  if (name && name !== current.name) {
    const column = current.kind === "neighborhood" ? customers.district : customers.city;
    const updated = await tx
      .update(customers)
      .set({ [current.kind === "neighborhood" ? "district" : "city"]: name, updatedAt: new Date() })
      .where(and(eq(customers.companyId, companyId), ilike(column, current.name)))
      .returning({ id: customers.id });
    renamedCustomers = updated.length;
  }

  await distributionAudit(tx, tenant, meta, {
    action: "TERRITORY_UPDATED",
    resource: "territories",
    resourceId: territoryId,
    details: { name: territory!.name, kind: territory!.kind, isActive: territory!.isActive, renamedCustomers },
  });
  return { ...territory!, renamedCustomers };
}

/** Ishlatilayotgan hudud o'chirilmaydi: marshruti, ichki hududi yoki mijozi bori faqat faolsizlantiriladi. */
export async function deleteTerritory(tx: Tx, tenant: TenantContext, territoryId: string, meta: RequestMeta) {
  const companyId = tenant.company.id;
  const current = await assertTerritory(tx, companyId, territoryId);
  const [used] = await tx
    .select({ id: distributionRoutes.id })
    .from(distributionRoutes)
    .where(and(eq(distributionRoutes.companyId, companyId), eq(distributionRoutes.territoryId, territoryId)))
    .limit(1);
  if (used) throw conflict("Hududda marshrutlar bor — avval ularni boshqa hududga o'tkazing yoki hududni faolsizlantiring");

  const [child] = await tx
    .select({ id: territories.id })
    .from(territories)
    .where(and(eq(territories.companyId, companyId), eq(territories.parentId, territoryId)))
    .limit(1);
  if (child) throw conflict("Hudud ichida boshqa hududlar bor — avval ularni o'chiring yoki ko'chiring");

  // Mijozda hudud MATN bo'lib saqlanadi: nomi ishlatilayotgan bo'lsa o'chirish ma'lumotni yetim qoldiradi
  const column = current.kind === "neighborhood" ? customers.district : customers.city;
  const [inUse] = await tx
    .select({ id: customers.id })
    .from(customers)
    .where(and(eq(customers.companyId, companyId), ilike(column, current.name)))
    .limit(1);
  if (inUse) throw conflict("Bu hudud mijozlarda ko'rsatilgan — avval mijozlarni boshqa hududga o'tkazing");

  await tx.delete(territories).where(eq(territories.id, territoryId));
  await distributionAudit(tx, tenant, meta, {
    action: "TERRITORY_DELETED",
    resource: "territories",
    resourceId: territoryId,
    details: {},
  });
}

/**
 * Import uchun: nomi bo'yicha topadi, bo'lmasa ochadi (standart daraja — shahar/tuman).
 * Mahalla uchun `parentId` majburiy — qaysi tumanga tegishli ekani bilinmasa ma'lumotnoma buziladi.
 */
export async function findOrCreateTerritory(
  tx: Tx,
  tenant: TenantContext,
  name: string,
  meta: RequestMeta,
  options: { kind?: TerritoryKind; parentId?: string | null } = {},
) {
  const trimmed = name.trim();
  const kind = options.kind ?? "district";
  const parentId = options.parentId ?? null;
  const [found] = await tx
    .select({ id: territories.id })
    .from(territories)
    .where(
      and(
        eq(territories.companyId, tenant.company.id),
        ilike(territories.name, trimmed),
        eq(territories.kind, kind),
        parentId ? eq(territories.parentId, parentId) : isNull(territories.parentId),
      ),
    )
    .limit(1);
  if (found) return found.id;
  const created = await createTerritory(tx, tenant, { name: trimmed, kind, parentId }, meta);
  return created.id;
}

/**
 * O'zbekiston viloyat va tumanlari ro'yxatini ma'lumotnomaga yuklaydi (bir marta bosiladigan amal).
 *
 * Faqat YETISHMAYOTGANINI qo'shadi va viloyatsiz turgan mavjud shahar/tumanni o'z viloyatiga bog'laydi
 * ("Urganch" → "Xorazm viloyati"): mavjud yozuv o'chirilmaydi, nomi o'zgartirilmaydi, mijozlarga
 * tegilmaydi. Takroriy bosilsa hech narsa qo'shilmaydi (idempotent).
 */
export async function seedUzbekistanRegions(tx: Tx, tenant: TenantContext, meta: RequestMeta) {
  const companyId = tenant.company.id;
  const existing = await tx
    .select({ id: territories.id, name: territories.name, kind: territories.kind, parentId: territories.parentId })
    .from(territories)
    .where(eq(territories.companyId, companyId));

  const key = (name: string) => name.trim().toLowerCase();
  const byName = new Map(existing.map((row) => [key(row.name), row]));
  let regionsAdded = 0;
  let districtsAdded = 0;
  let districtsLinked = 0;

  for (const region of UZBEKISTAN_REGIONS) {
    let regionRow = byName.get(key(region.name));
    if (regionRow && regionRow.kind !== "region") {
      // Shu nom boshqa darajada band (masalan, "Toshkent shahri" tuman bo'lib kiritilgan) — tegmaymiz
      continue;
    }
    if (!regionRow) {
      const [created] = await tx
        .insert(territories)
        .values({ companyId, name: region.name, kind: "region", parentId: null })
        .returning({ id: territories.id, name: territories.name, kind: territories.kind, parentId: territories.parentId });
      regionRow = created!;
      byName.set(key(region.name), regionRow);
      regionsAdded += 1;
    }

    for (const district of region.districts) {
      const found = byName.get(key(district));
      if (found) {
        // Bor, lekin viloyatsiz turibdi — o'z viloyatiga bog'laymiz (nomi o'zgarmaydi)
        if (found.kind === "district" && !found.parentId) {
          await tx.update(territories).set({ parentId: regionRow.id, updatedAt: new Date() }).where(eq(territories.id, found.id));
          found.parentId = regionRow.id;
          districtsLinked += 1;
        }
        continue;
      }
      const [created] = await tx
        .insert(territories)
        .values({ companyId, name: district, kind: "district", parentId: regionRow.id })
        .returning({ id: territories.id, name: territories.name, kind: territories.kind, parentId: territories.parentId });
      byName.set(key(district), created!);
      districtsAdded += 1;
    }
  }

  const result = { regionsAdded, districtsAdded, districtsLinked };
  if (regionsAdded + districtsAdded + districtsLinked > 0) {
    await distributionAudit(tx, tenant, meta, {
      action: "TERRITORIES_SEEDED",
      resource: "territories",
      resourceId: companyId,
      details: result,
    });
  }
  return result;
}
