/**
 * Platforma admini kompaniyani egasi bilan birga yaratadi.
 *
 * Convex'dagi companies.platformCreateCompany muqobili: kompaniya (status
 * active), "Asosiy filial" (BR-001), kompaniyaning standart rollari,
 * "Asosiy ombor" (WH-001) va egasining "Business Owner" a'zoligi.
 *
 * Farq: egasi shu yerda yangi hisob sifatida yaratiladi (Convex'da mavjud
 * ownerUserId berilardi). Hammasi bitta tranzaksiyada — raqam band bo'lsa
 * hech narsa qolmaydi.
 */
import { desc, eq, like, or } from "drizzle-orm";
import { DEFAULT_ROLES } from "@bum/shared";
import { warehouses } from "../../db/schema/inventory.js";
import { branches, companies, companyMembers, roles, users } from "../../db/schema/platform.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import { writeAuditLog, type RequestMeta } from "../../shared/audit.js";
import type { SessionUser } from "../auth/session.js";
import { auditUserAction, insertUser, type NewAccount } from "../users/user-admin.service.js";

const OWNER_ROLE = "Business Owner";

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

export async function createCompanyWithOwner(
  tx: Tx,
  actor: SessionUser,
  input: NewCompanyInput,
  meta: RequestMeta,
) {
  // Egasi birinchi — raqam band bo'lsa shu yerda to'xtaydi
  const owner = await insertUser(tx, input.owner);
  const slug = await generateUniqueSlug(tx, input.name);

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
      status: "active",
      isActive: true,
      slug,
    })
    .returning({ id: companies.id, name: companies.name, slug: companies.slug });
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

  await tx.insert(companyMembers).values({
    companyId,
    userId: owner.id,
    companyRole: OWNER_ROLE,
    roleId: ownerRole.id,
    branchId: branch!.id,
    joinedAt: new Date(),
  });
  await tx.update(users).set({ activeCompanyId: companyId }).where(eq(users.id, owner.id));

  await writeAuditLog(
    {
      userId: actor.id,
      userName: actor.name,
      companyId,
      action: "COMPANY_CREATED",
      resource: "companies",
      resourceId: companyId,
      details: { name: company!.name, slug, ownerId: owner.id },
      ...meta,
    },
    tx,
  );
  await auditUserAction(tx, actor, meta, {
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

export async function listCompanies(conn: DbOrTx) {
  const rows = await conn
    .select({
      id: companies.id,
      name: companies.name,
      slug: companies.slug,
      status: companies.status,
      isActive: companies.isActive,
      createdAt: companies.createdAt,
      ownerId: users.id,
      ownerPhone: users.phone,
      ownerName: users.name,
      ownerActive: users.isActive,
    })
    .from(companies)
    .leftJoin(users, eq(users.id, companies.ownerId))
    .orderBy(desc(companies.createdAt));

  return rows.map(({ ownerId, ownerPhone, ownerName, ownerActive, ...company }) => ({
    ...company,
    owner: ownerId ? { id: ownerId, phone: ownerPhone, name: ownerName, isActive: ownerActive } : null,
  }));
}
