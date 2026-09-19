/**
 * YETIM FOYDALANUVCHILARNI KADRLAR BILAN MOSLASH.
 *
 *   node --import tsx src/cli/employee-reconcile.ts --company <slug|id>            # faqat ko'rsatadi (dry-run)
 *   node --import tsx src/cli/employee-reconcile.ts --company <slug|id> --apply    # yozadi
 *   ... --include-inactive     # kompaniyadan chiqarilgan (faolsiz) a'zolar uchun ham
 *
 * Nima qiladi: "Foydalanuvchilarda bor, Xodimlarda yo'q" holatini tuzatadi — bu yozuvlar HR kartochkasi
 * avtomatik ochilmagan davrdan qolgan. Har bir yetim foydalanuvchi uchun:
 *   - shu kompaniyada bog'lanmagan, o'sha telefonli kartochka bo'lsa — LOGINGA ULANADI (yangisi ochilmaydi);
 *   - bir nechta mos kartochka bo'lsa — AMBIGUOUS deb qoldiriladi (odam hal qiladi);
 *   - mos kartochka bo'lmasa — yangi kartochka ochiladi (bo'lim "Asosiy", lavozim — kompaniyadagi roli).
 *
 * Hech narsa o'chirilmaydi va mavjud kartochka ma'lumotlari o'zgartirilmaydi.
 * Kartochka yaratish/ulash ilovaning O'Z xizmatidan (`createHrCard`) foydalanadi — yagona manba.
 */
import { and, eq, isNull, ne, or, sql } from "drizzle-orm";
import { normalizePhone } from "@bum/shared";
import { db, pool } from "../db/client.js";
import { withTransaction } from "../db/transaction.js";
import { employees } from "../db/schema/hr.js";
import { companies, companyMembers, users } from "../db/schema/platform.js";
import { createHrCard } from "../modules/hr/employees.service.js";
import type { TenantContext } from "../modules/company/tenant.js";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const includeInactive = args.includes("--include-inactive");
const companyKey = args.includes("--company") ? args[args.indexOf("--company") + 1] : null;
if (!companyKey) {
  console.error("Foydalanish: employee-reconcile.ts --company <slug|id> [--apply] [--include-inactive]");
  process.exit(2);
}

const [company] = await db
  .select({ id: companies.id, name: companies.name, slug: companies.slug, status: companies.status, isActive: companies.isActive, ownerId: companies.ownerId, trialEndsAt: companies.trialEndsAt })
  .from(companies)
  .where(sql`${companies.id}::text = ${companyKey} or lower(${companies.slug}) = ${companyKey.toLowerCase()}`)
  .limit(1);
if (!company) {
  console.error(`Kompaniya topilmadi: ${companyKey}`);
  process.exit(1);
}

/** Kartochkasi yo'q a'zolar. */
const orphans = await db
  .select({
    userId: users.id,
    name: users.name,
    phone: users.phone,
    role: companyMembers.companyRole,
    memberActive: companyMembers.isActive,
    joinedAt: companyMembers.joinedAt,
  })
  .from(companyMembers)
  .innerJoin(users, eq(users.id, companyMembers.userId))
  .leftJoin(employees, and(eq(employees.userId, users.id), eq(employees.companyId, company.id)))
  .where(
    and(
      eq(companyMembers.companyId, company.id),
      isNull(employees.id),
      includeInactive ? undefined : eq(companyMembers.isActive, true),
    ),
  );

console.log(`${company.name} (${company.slug ?? company.id}) — kartochkasiz a'zolar: ${orphans.length}${apply ? "" : "   [DRY-RUN]"}`);

/** Egasini aktor sifatida ishlatamiz (audit izida ko'rinadi). */
const [owner] = company.ownerId
  ? await db.select().from(users).where(eq(users.id, company.ownerId)).limit(1)
  : [];
if (!owner) {
  console.error("Kompaniya egasi topilmadi — audit aktori yo'q, to'xtatildi");
  process.exit(1);
}

/** Egasining haqiqiy a'zoligi — audit va ruxsat tekshiruvlari shundan o'qiydi. */
const [ownerMembership] = await db
  .select()
  .from(companyMembers)
  .where(and(eq(companyMembers.companyId, company.id), eq(companyMembers.userId, owner.id)))
  .limit(1);
if (!ownerMembership) {
  console.error("Egasining a'zoligi topilmadi — to'xtatildi");
  process.exit(1);
}

const tenant = {
  user: owner,
  company: { id: company.id, name: company.name, status: company.status, isActive: company.isActive, ownerId: company.ownerId, trialEndsAt: company.trialEndsAt },
  membership: ownerMembership,
} as unknown as TenantContext;

const meta = { ipAddress: "127.0.0.1", userAgent: "cli:employee-reconcile" };
let linked = 0;
let created = 0;
let ambiguous = 0;

for (const orphan of orphans) {
  const phone = normalizePhone(orphan.phone ?? "");
  const candidates = phone
    ? await db
        .select({ id: employees.id, name: employees.name, status: employees.status })
        .from(employees)
        .where(
          and(
            eq(employees.companyId, company.id),
            or(eq(employees.phone, phone), eq(employees.phone, orphan.phone)),
            isNull(employees.userId),
            ne(employees.status, "terminated"),
          ),
        )
    : [];

  if (candidates.length > 1) {
    ambiguous += 1;
    console.log(`  AMBIGUOUS  ${orphan.phone} — ${candidates.length} ta mos kartochka: ${candidates.map((row) => row.id).join(", ")}`);
    continue;
  }

  const action = candidates.length === 1 ? `ULANADI → ${candidates[0]!.name}` : "YANGI KARTOCHKA";
  console.log(`  ${action.padEnd(28)} ${orphan.phone}  ${orphan.name ?? "(ismsiz)"}  rol=${orphan.role}  faol=${orphan.memberActive}`);
  if (!apply) {
    if (candidates.length === 1) linked += 1;
    else created += 1;
    continue;
  }

  // Ilovaning o'z xizmati: mos kartochka bo'lsa ulaydi, bo'lmasa ochadi
  await withTransaction((tx) =>
    createHrCard(
      tx,
      tenant,
      {
        name: orphan.name?.trim() || orphan.phone,
        phone: orphan.phone,
        userId: orphan.userId,
        role: orphan.role,
        hireDate: orphan.joinedAt ? new Date(orphan.joinedAt).toISOString().slice(0, 10) : undefined,
      },
      meta,
    ),
  );
  if (candidates.length === 1) linked += 1;
  else created += 1;
}

console.log(`\nNatija: ulandi ${linked}, yangi kartochka ${created}, aniqlanmadi (AMBIGUOUS) ${ambiguous}${apply ? "" : "   [DRY-RUN — yozilmadi]"}`);
await pool.end();
