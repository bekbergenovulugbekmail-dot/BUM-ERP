/**
 * Kompaniyalar: yaratish (platforma admini yoki o'zi ro'yxatdan o'tish),
 * ro'yxat, tafsilot, holat.
 *
 *  - createCompanyWithOwner — Convex'dagi platformCreateCompany / registerCompany:
 *    kompaniya, "Asosiy filial" (BR-001), kompaniyaning standart rollari,
 *    "Asosiy ombor" (WH-001) va egasining "Business Owner" a'zoligi. Egasi shu
 *    yerda yangi hisob sifatida yaratiladi. Hammasi bitta tranzaksiyada.
 *  - listCompanies / getCompanyDetails — platformListCompanies / platformGetCompany
 *  - setCompanyStatus — platformUpdateCompanyStatus; to'xtatilgan va tugatilgan
 *    kompaniyada yozish amallari company/tenant.ts da yopiladi
 */
import { desc, eq, like, or, sql } from "drizzle-orm";
import { DEFAULT_ROLES, effectiveSubscriptionStatus, notFound } from "@bum/shared";
import { warehouses } from "../../db/schema/inventory.js";
import { seedFinanceDefaults } from "../finance/accounts.service.js";
import { branches, companies, companyMembers, roles, users } from "../../db/schema/platform.js";
import { subscriptions } from "../../db/schema/subscription.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import { writeAuditLog, type RequestMeta } from "../../shared/audit.js";
import type { SessionUser } from "../auth/session.js";
import { startTrial, trialEndFrom } from "../subscription/subscription.service.js";
import { auditUserAction, insertUser, type NewAccount } from "../users/user-admin.service.js";

const OWNER_ROLE = "Business Owner";

export const COMPANY_STATUSES = ["active", "trial", "pending", "suspended", "cancelled"] as const;
export type CompanyStatus = (typeof COMPANY_STATUSES)[number];

/** Convex'dagi RESERVED_SLUGS bilan bir xil — subdomen va marshrutlar bilan to'qnashmasin. */
const RESERVED_SLUGS = new Set([
  "admin", "app", "auth", "www", "api", "mail", "ftp",
  "support", "billing", "status", "dev", "staging",
  "help", "docs", "blog", "t", "tenant", "platform",
]);

/** Convex'dagi nameToSlug: "ALKON MCHJ" → "alkon-mchj", "Mega Trade" → "mega-trade". */
export function nameToSlug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 32) || "company"
  );
}

async function generateUniqueSlug(tx: Tx, name: string): Promise<string> {
  const base = nameToSlug(name);
  const candidate = RESERVED_SLUGS.has(base) ? `${base}-co` : base;

  const taken = new Set(
    (
      await tx
        .select({ slug: companies.slug })
        .from(companies)
        .where(or(eq(companies.slug, candidate), like(companies.slug, `${candidate}-%`)))
    ).map((r) => r.slug),
  );

  if (!taken.has(candidate)) return candidate;
  for (let i = 2; i <= 99; i++) {
    if (!taken.has(`${candidate}-${i}`)) return `${candidate}-${i}`;
  }
  // Juda kam holat; poygada unikal indeks baribir 409 qaytaradi
  return `${candidate}-${crypto.randomUUID().slice(0, 6)}`;
}

export type NewCompanyInput = {
  name: string;
  legalName?: string;
  taxId?: string;
  phone?: string;
  address?: string;
  city?: string;
  region?: string;
  country?: string;
  currency?: string;
  language?: string;
  branchName?: string;
  owner: NewAccount;
};

export type CreateCompanyOptions = {
  status?: CompanyStatus;
  auditAction?: "COMPANY_CREATED" | "COMPANY_REGISTERED";
};

/**
 * Har yangi kompaniya — server vaqti bo'yicha 25 kunlik bepul trial va 3 ta included litsenziya (egasi — birinchisi).
 *
 * @param actor platforma admini; `null` — o'zi ro'yxatdan o'tish (audit egasi nomidan).
 */
export async function createCompanyWithOwner(
  tx: Tx,
  actor: SessionUser | null,
  input: NewCompanyInput,
  meta: RequestMeta,
  options: CreateCompanyOptions = {},
) {
  // Egasi birinchi — raqam band bo'lsa shu yerda to'xtaydi
  const owner = await insertUser(tx, input.owner);
  const auditActor = actor ?? owner;
  const slug = await generateUniqueSlug(tx, input.name);
  const now = new Date();
  const trialEndsAt = trialEndFrom(now);

  const [company] = await tx
    .insert(companies)
    .values({
      name: input.name,
      legalName: input.legalName,
      taxId: input.taxId,
      phone: input.phone,
      address: input.address,
      city: input.city,
      region: input.region,
      country: input.country ?? "UZ",
      currency: input.currency ?? "UZS",
      language: input.language ?? "uz",
      ownerId: owner.id,
      status: options.status ?? "active",
      trialEndsAt,
      isActive: true,
      slug,
    })
    .returning({
      id: companies.id,
      name: companies.name,
      slug: companies.slug,
      status: companies.status,
      trialEndsAt: companies.trialEndsAt,
    });
  const companyId = company!.id;

  const [branch] = await tx
    .insert(branches)
    .values({
      companyId,
      name: input.branchName || "Asosiy filial",
      code: "BR-001",
      address: input.address,
      city: input.city,
      phone: input.phone,
      isDefault: true,
    })
    .returning({ id: branches.id });

  const companyRoles = await tx
    .insert(roles)
    .values(
      DEFAULT_ROLES.map((role) => ({
        companyId,
        name: role.name,
        description: role.description,
        color: role.color,
        permissions: [...role.permissions],
        isSystem: role.isSystem,
        memberCount: role.name === OWNER_ROLE ? 1 : 0,
      })),
    )
    .returning({ id: roles.id, name: roles.name });
  const ownerRole = companyRoles.find((r) => r.name === OWNER_ROLE)!;

  await tx.insert(warehouses).values({
    companyId,
    name: "Asosiy ombor",
    code: "WH-001",
    address: input.address,
    branchId: branch!.id,
    isDefault: true,
  });
  await seedFinanceDefaults(tx, companyId, input.currency ?? "UZS");

  await tx.insert(companyMembers).values({
    companyId,
    userId: owner.id,
    companyRole: OWNER_ROLE,
    roleId: ownerRole.id,
    branchId: branch!.id,
    joinedAt: new Date(),
  });
  await tx.update(users).set({ activeCompanyId: companyId }).where(eq(users.id, owner.id));
  await startTrial(tx, { companyId, ownerId: owner.id, actor: auditActor, meta, now, trialEndsAt });

  await writeAuditLog(
    {
      userId: auditActor.id,
      userName: auditActor.name,
      companyId,
      action: options.auditAction ?? "COMPANY_CREATED",
      resource: "companies",
      resourceId: companyId,
      details: { name: company!.name, slug, ownerId: owner.id, status: company!.status },
      ...meta,
    },
    tx,
  );
  await auditUserAction(tx, auditActor, meta, {
    action: "USER_CREATED",
    targetId: owner.id,
    companyId,
    details: { phone: owner.phone, role: OWNER_ROLE },
  });

  return {
    company: company!,
    owner: { id: owner.id, phone: owner.phone, name: owner.name },
  };
}

export async function listCompanies(conn: DbOrTx, filter: { status?: CompanyStatus } = {}) {
  const rows = await conn
    .select({
      id: companies.id,
      name: companies.name,
      slug: companies.slug,
      status: companies.status,
      isActive: companies.isActive,
      trialEndsAt: companies.trialEndsAt,
      createdAt: companies.createdAt,
      memberCount: sql<number>`(select count(*)::int from ${companyMembers} where ${companyMembers.companyId} = ${companies.id})`,
      ownerId: users.id,
      ownerPhone: users.phone,
      ownerName: users.name,
      ownerActive: users.isActive,
      subscriptionStatus: subscriptions.status,
      subscriptionExpiresAt: subscriptions.expiresAt,
      includedLicenses: subscriptions.includedLicenses,
      usedLicenses: sql<number>`(select count(*)::int from "licenses" l where l."company_id" = ${companies.id} and l."status" = 'active')`,
      pendingPayments: sql<number>`(select count(*)::int from "subscription_payments" p where p."company_id" = ${companies.id} and p."status" = 'pending')`,
    })
    .from(companies)
    .leftJoin(users, eq(users.id, companies.ownerId))
    .leftJoin(subscriptions, eq(subscriptions.companyId, companies.id))
    .where(filter.status ? eq(companies.status, filter.status) : undefined)
    .orderBy(desc(companies.createdAt));

  const now = new Date();
  return rows.map(({ ownerId, ownerPhone, ownerName, ownerActive, subscriptionStatus, subscriptionExpiresAt, includedLicenses, usedLicenses, pendingPayments, ...company }) => ({
    ...company,
    owner: ownerId ? { id: ownerId, phone: ownerPhone, name: ownerName, isActive: ownerActive } : null,
    subscription: subscriptionStatus
      ? {
          status: effectiveSubscriptionStatus({ status: subscriptionStatus, expiresAt: subscriptionExpiresAt }, now),
          expiresAt: subscriptionExpiresAt,
          includedLicenses,
          usedLicenses,
          pendingPayments,
        }
      : null,
  }));
}

/** Kompaniya, egasi, a'zolar va filiallar. Foydalanuvchi maydonlari ruxsat ro'yxati bo'yicha — xeshlar yo'q. */
export async function getCompanyDetails(conn: DbOrTx, companyId: string) {
  const [company] = await conn.select().from(companies).where(eq(companies.id, companyId)).limit(1);
  if (!company) throw notFound("Kompaniya topilmadi");

  const [owner] = company.ownerId
    ? await conn
        .select({ id: users.id, phone: users.phone, name: users.name, isActive: users.isActive })
        .from(users)
        .where(eq(users.id, company.ownerId))
        .limit(1)
    : [];

  const members = await conn
    .select({
      userId: users.id,
      phone: users.phone,
      name: users.name,
      userActive: users.isActive,
      companyRole: companyMembers.companyRole,
      branchId: companyMembers.branchId,
      membershipActive: companyMembers.isActive,
      joinedAt: companyMembers.joinedAt,
    })
    .from(companyMembers)
    .innerJoin(users, eq(users.id, companyMembers.userId))
    .where(eq(companyMembers.companyId, companyId))
    .orderBy(companyMembers.joinedAt);

  const companyBranches = await conn
    .select()
    .from(branches)
    .where(eq(branches.companyId, companyId))
    .orderBy(branches.code);

  // legacy_id — ko'chirish uchun ichki ustun, API javobiga chiqmaydi
  const { legacyId: _legacyId, ...publicCompany } = company;
  return {
    company: publicCompany,
    owner: owner ?? null,
    members,
    branches: companyBranches.map(({ legacyId: _branchLegacyId, ...branch }) => branch),
  };
}

export async function setCompanyStatus(
  tx: Tx,
  actor: SessionUser,
  companyId: string,
  status: CompanyStatus,
  reason: string | undefined,
  meta: RequestMeta,
) {
  const [company] = await tx
    .select({ id: companies.id, status: companies.status })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1)
    .for("update");
  if (!company) throw notFound("Kompaniya topilmadi");

  const suspending = status === "suspended";
  const [updated] = await tx
    .update(companies)
    .set({
      status,
      suspendedAt: suspending ? new Date() : null,
      suspendReason: suspending ? (reason ?? null) : null,
      updatedAt: new Date(),
    })
    .where(eq(companies.id, companyId))
    .returning({
      id: companies.id,
      status: companies.status,
      suspendedAt: companies.suspendedAt,
      suspendReason: companies.suspendReason,
    });

  if (company.status !== status) {
    await writeAuditLog(
      {
        userId: actor.id,
        userName: actor.name,
        companyId,
        action: "COMPANY_STATUS_CHANGED",
        resource: "companies",
        resourceId: companyId,
        severity: suspending || status === "cancelled" ? "warning" : "info",
        details: { from: company.status, to: status, ...(reason ? { reason } : {}) },
        ...meta,
      },
      tx,
    );
  }
  return updated!;
}
