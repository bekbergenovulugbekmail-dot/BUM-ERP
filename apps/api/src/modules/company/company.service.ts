/**
 * Aktiv kompaniya, kompaniyalar ro'yxati, almashtirish, kompaniya ma'lumotlari
 * va filiallar.
 *
 * Convex'dan ataylab farqlar (xavfsizlik):
 *  - updateCompany Convex'da har qanday a'zoga ochiq edi — endi `company.manage`
 *  - createBranch/updateBranch ham har qanday a'zoga ochiq edi — endi `branches.manage`
 *  - updateBranch boshqa filiallarning isDefault ini tushirmasdi (ikkita asosiy
 *    filial bo'lib qolardi) — endi doim bitta, bazada partial unique bilan
 *
 * Ruxsat tekshiruvi controller'da (routes.ts); bu yerdagi funksiyalar tayyor
 * TenantContext va tx qabul qiladi.
 */
import { and, eq, ne, sql } from "drizzle-orm";
import { badRequest, forbidden, notFound } from "@bum/shared";
import { branches, companies, companyMembers, users } from "../../db/schema/platform.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import { writeAuditLog, type RequestMeta } from "../../shared/audit.js";
import { buildMe } from "../auth/auth.service.js";
import type { SessionUser } from "../auth/session.js";
import type { TenantContext } from "./tenant.js";

function audit(
  conn: DbOrTx,
  actor: SessionUser,
  meta: RequestMeta,
  entry: { action: string; resource: string; resourceId: string; companyId: string; details?: Record<string, unknown> },
): Promise<void> {
  return writeAuditLog(
    {
      userId: actor.id,
      userName: actor.name,
      companyId: entry.companyId,
      action: entry.action,
      resource: entry.resource,
      resourceId: entry.resourceId,
      ...(entry.details ? { details: entry.details } : {}),
      ...meta,
    },
    conn,
  );
}

/** Berilgan maydonlardan qaysilari haqiqatan o'zgarganini qaytaradi. */
function changedKeys<T extends Record<string, unknown>>(current: T, patch: Partial<T>): (keyof T & string)[] {
  return (Object.keys(patch) as (keyof T & string)[]).filter(
    (key) => patch[key] !== undefined && patch[key] !== current[key],
  );
}

// ─── Kompaniya ───────────────────────────────────────────────────────────────

const companyColumns = {
  id: companies.id,
  name: companies.name,
  legalName: companies.legalName,
  taxId: companies.taxId,
  phone: companies.phone,
  email: companies.email,
  website: companies.website,
  address: companies.address,
  city: companies.city,
  region: companies.region,
  country: companies.country,
  currency: companies.currency,
  language: companies.language,
  logoUrl: companies.logoUrl,
  slug: companies.slug,
  status: companies.status,
  isActive: companies.isActive,
  ownerId: companies.ownerId,
  trialEndsAt: companies.trialEndsAt,
  createdAt: companies.createdAt,
};

export async function getCompany(conn: DbOrTx, companyId: string) {
  const [company] = await conn.select(companyColumns).from(companies).where(eq(companies.id, companyId)).limit(1);
  if (!company) throw notFound("Kompaniya topilmadi");
  return company;
}

export async function listMyCompanies(conn: DbOrTx, user: SessionUser) {
  const rows = await conn
    .select({
      id: companies.id,
      name: companies.name,
      slug: companies.slug,
      logoUrl: companies.logoUrl,
      status: companies.status,
      isActive: companies.isActive,
      currency: companies.currency,
      trialEndsAt: companies.trialEndsAt,
      companyRole: companyMembers.companyRole,
      membershipActive: companyMembers.isActive,
    })
    .from(companyMembers)
    .innerJoin(companies, eq(companies.id, companyMembers.companyId))
    .where(eq(companyMembers.userId, user.id))
    .orderBy(companies.name);

  return rows.map((row) => ({ ...row, isCurrent: row.id === user.activeCompanyId }));
}

/** Faol biznesni almashtiradi va maqsad biznes (manzil bo'lagi uchun) ma'lumotini qaytaradi. */
export async function switchCompany(
  tx: Tx,
  user: SessionUser,
  companyId: string,
  meta: RequestMeta,
): Promise<{ id: string; slug: string | null }> {
  const [membership] = await tx
    .select({ isActive: companyMembers.isActive, slug: companies.slug })
    .from(companyMembers)
    .innerJoin(companies, eq(companies.id, companyMembers.companyId))
    .where(and(eq(companyMembers.companyId, companyId), eq(companyMembers.userId, user.id)))
    .limit(1);

  if (!membership || !membership.isActive) throw forbidden("Bu kompaniyaga kirishingiz yo'q");
  if (user.activeCompanyId === companyId) return { id: companyId, slug: membership.slug };

  await tx.update(users).set({ activeCompanyId: companyId }).where(eq(users.id, user.id));
  await audit(tx, user, meta, {
    action: "COMPANY_SWITCHED",
    resource: "companies",
    resourceId: companyId,
    companyId,
    details: { from: user.activeCompanyId },
  });
  return { id: companyId, slug: membership.slug };
}

/**
 * Biznes manzili (slug) bo'yicha KIRISH HUQUQINI tekshiradi — sessiya ochilishidan OLDIN chaqiriladi.
 * Noto'g'ri manzil — 404, to'xtatilgan yoki begona biznes — 403. Hech narsa yozilmaydi.
 */
export async function assertCompanyLoginBySlug(conn: DbOrTx, user: SessionUser, slug: string) {
  // Manzil bo'lagi odatda slug; slug'siz eski bizneslarda id bo'lishi mumkin
  const key = slug.trim().toLowerCase();
  const isId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(key);
  const [company] = await conn
    .select({ id: companies.id, name: companies.name, status: companies.status })
    .from(companies)
    .where(isId ? eq(companies.id, key) : sql`lower(${companies.slug}) = ${key}`)
    .limit(1);
  if (!company) throw notFound("Bunday biznes manzili topilmadi");
  if (company.status === "suspended" || company.status === "cancelled") {
    throw forbidden(`${company.name} vaqtincha to'xtatilgan — administratorga murojaat qiling`);
  }

  if (!user.isPlatformAdmin) {
    const [membership] = await conn
      .select({ isActive: companyMembers.isActive })
      .from(companyMembers)
      .where(and(eq(companyMembers.companyId, company.id), eq(companyMembers.userId, user.id)))
      .limit(1);
    if (!membership || !membership.isActive) {
      throw forbidden(`Siz ${company.name} xodimi emassiz — o'z biznesingiz manzilidan kiring`);
    }
  }
  return company;
}

/**
 * Biznes manzili (slug) bo'yicha kirishda shu biznesni faollashtiradi:
 * `app.bum-erp.uz/bonnu-market` — faqat Bonnu Marketga kirish.
 * Huquq `assertCompanyLoginBySlug` da tekshirilgan bo'lishi kerak (sessiyadan oldin).
 */
export async function activateCompanyBySlug(tx: Tx, user: SessionUser, slug: string, meta: RequestMeta) {
  const company = await assertCompanyLoginBySlug(tx, user, slug);

  if (user.activeCompanyId !== company.id) {
    await tx.update(users).set({ activeCompanyId: company.id }).where(eq(users.id, user.id));
    await audit(tx, user, meta, {
      action: "COMPANY_SWITCHED",
      resource: "companies",
      resourceId: company.id,
      companyId: company.id,
      details: { from: user.activeCompanyId, via: "login_slug" },
    });
  }
  return buildMe(tx, { ...user, activeCompanyId: company.id });
}

export type CompanyPatch = {
  name?: string;
  legalName?: string | null;
  taxId?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  address?: string | null;
  city?: string | null;
  region?: string | null;
  country?: string;
  currency?: string;
  language?: string;
};

export async function updateCompany(tx: Tx, tenant: TenantContext, patch: CompanyPatch, meta: RequestMeta) {
  const [current] = await tx
    .select(companyColumns)
    .from(companies)
    .where(eq(companies.id, tenant.company.id))
    .limit(1)
    .for("update");
  if (!current) throw notFound("Kompaniya topilmadi");

  const changes = changedKeys(current, patch);
  if (changes.length === 0) return current;

  const set = Object.fromEntries(changes.map((key) => [key, patch[key as keyof CompanyPatch]]));
  const [updated] = await tx
    .update(companies)
    .set({ ...set, updatedAt: new Date() })
    .where(eq(companies.id, current.id))
    .returning(companyColumns);

  await audit(tx, tenant.user, meta, {
    action: "COMPANY_UPDATED",
    resource: "companies",
    resourceId: current.id,
    companyId: current.id,
    details: { changes },
  });
  return updated!;
}

// ─── Filiallar ───────────────────────────────────────────────────────────────

export async function listBranches(conn: DbOrTx, tenant: TenantContext) {
  return conn
    .select()
    .from(branches)
    .where(eq(branches.companyId, tenant.company.id))
    .orderBy(branches.code);
}

export type NewBranch = {
  name: string;
  code: string;
  address?: string | null;
  city?: string | null;
  phone?: string | null;
  isDefault?: boolean;
};

async function clearDefaultBranch(tx: Tx, companyId: string, exceptId?: string): Promise<void> {
  const condition = exceptId
    ? and(eq(branches.companyId, companyId), eq(branches.isDefault, true), ne(branches.id, exceptId))
    : and(eq(branches.companyId, companyId), eq(branches.isDefault, true));
  await tx.update(branches).set({ isDefault: false, updatedAt: new Date() }).where(condition);
}

export async function createBranch(tx: Tx, tenant: TenantContext, input: NewBranch, meta: RequestMeta) {
  const companyId = tenant.company.id;
  if (input.isDefault) await clearDefaultBranch(tx, companyId);

  const [branch] = await tx
    .insert(branches)
    .values({ ...input, companyId, isDefault: input.isDefault ?? false })
    .returning();

  await audit(tx, tenant.user, meta, {
    action: "BRANCH_CREATED",
    resource: "branches",
    resourceId: branch!.id,
    companyId,
    details: { code: branch!.code, isDefault: branch!.isDefault },
  });
  return branch!;
}

export type BranchPatch = Partial<NewBranch> & { isActive?: boolean };

export async function updateBranch(
  tx: Tx,
  tenant: TenantContext,
  branchId: string,
  patch: BranchPatch,
  meta: RequestMeta,
) {
  const companyId = tenant.company.id;
  const [branch] = await tx
    .select()
    .from(branches)
    .where(and(eq(branches.id, branchId), eq(branches.companyId, companyId)))
    .limit(1)
    .for("update");
  // Boshqa kompaniya filiali ham "topilmadi"
  if (!branch) throw notFound("Filial topilmadi");

  const willBeDefault = patch.isDefault ?? branch.isDefault;
  const willBeActive = patch.isActive ?? branch.isActive;
  if (branch.isDefault && patch.isDefault === false) {
    throw badRequest("Asosiy filialni olib bo'lmaydi — boshqa filialni asosiy qiling");
  }
  if (willBeDefault && !willBeActive) {
    throw badRequest("Asosiy filial faol bo'lishi kerak");
  }

  const changes = changedKeys(branch, patch);
  if (changes.length === 0) return branch;

  if (patch.isDefault && !branch.isDefault) await clearDefaultBranch(tx, companyId, branch.id);

  const set = Object.fromEntries(changes.map((key) => [key, patch[key as keyof BranchPatch]]));
  const [updated] = await tx
    .update(branches)
    .set({ ...set, updatedAt: new Date() })
    .where(eq(branches.id, branch.id))
    .returning();

  await audit(tx, tenant.user, meta, {
    action: "BRANCH_UPDATED",
    resource: "branches",
    resourceId: branch.id,
    companyId,
    details: { changes },
  });
  return updated!;
}
