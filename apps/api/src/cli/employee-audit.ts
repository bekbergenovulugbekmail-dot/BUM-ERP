/**
 * XODIM ↔ FOYDALANUVCHI MOSLIGI AUDITI (faqat o'qiydi, hech narsani o'zgartirmaydi).
 *
 *   node --import tsx src/cli/employee-audit.ts [--company <slug|id>] [--json]
 *
 * Nimani ko'rsatadi:
 *   1. Foydalanuvchi bor, unga bog'langan xodim kartochkasi ham bor
 *   2. Foydalanuvchi bor, LEKIN xodim kartochkasi yo'q  (Foydalanuvchilarda ko'rinadi, Xodimlarda yo'q)
 *   3. Xodim kartochkasi bor, loginga bog'langan
 *   4. Xodim kartochkasi bor, loginsiz (bepul xodim yoki importdan)
 *   5. Foydalanuvchi a'zoligi bor / 6. a'zoligi yo'q (kompaniyadan chiqarilgan, lekin yozuvlar qolgan)
 *   7. Xodim kompaniyasi bor / 8. kompaniyasi yo'q (bo'lishi mumkin emas — FK)
 *   9. Foydalanuvchi + xodim + a'zolik BIR kompaniyada
 *  10. Xodim va uning foydalanuvchisi HAR XIL kompaniyada (tenant buzilishi — jiddiy)
 *
 * Har bir muammoli yozuv uchun id, userId, employeeId, companyId, telefon, ism, rol va holat chiqadi.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { db, pool } from "../db/client.js";
import { employees } from "../db/schema/hr.js";
import { companies, companyMembers, users } from "../db/schema/platform.js";

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const companyArg = args[args.indexOf("--company") + 1];
const companyFilter = args.includes("--company") ? companyArg : null;

type Row = Record<string, unknown>;

function print(title: string, rows: Row[]) {
  if (asJson) return;
  console.log(`\n── ${title} — ${rows.length} ta`);
  if (rows.length === 0) return;
  for (const row of rows.slice(0, 50)) console.log("   ", JSON.stringify(row));
  if (rows.length > 50) console.log(`    … va yana ${rows.length - 50} ta`);
}

const companyList = await db
  .select({ id: companies.id, name: companies.name, slug: companies.slug })
  .from(companies)
  .where(
    companyFilter
      ? sql`${companies.id}::text = ${companyFilter} or lower(${companies.slug}) = ${companyFilter.toLowerCase()}`
      : sql`true`,
  );
if (companyList.length === 0) {
  console.error("Kompaniya topilmadi");
  process.exit(1);
}

const report: Record<string, Row[]> = {};

for (const company of companyList) {
  const scope = eq(companyMembers.companyId, company.id);

  /** Kompaniya a'zolari (login qiluvchilar) va ularning xodim kartochkasi. */
  const members = await db
    .select({
      userId: users.id,
      phone: users.phone,
      name: users.name,
      role: companyMembers.companyRole,
      memberActive: companyMembers.isActive,
      userActive: users.isActive,
      employeeId: employees.id,
      employeeCode: employees.code,
      employeeStatus: employees.status,
      employeeCompanyId: employees.companyId,
    })
    .from(companyMembers)
    .innerJoin(users, eq(users.id, companyMembers.userId))
    .leftJoin(employees, and(eq(employees.userId, users.id), eq(employees.companyId, company.id)))
    .where(scope);

  const withCard = members.filter((row) => row.employeeId);
  const withoutCard = members.filter((row) => !row.employeeId);

  /** Xodim kartochkalari. */
  const cards = await db
    .select({
      employeeId: employees.id,
      code: employees.code,
      name: employees.name,
      phone: employees.phone,
      status: employees.status,
      userId: employees.userId,
      companyId: employees.companyId,
    })
    .from(employees)
    .where(eq(employees.companyId, company.id));

  const linkedCards = cards.filter((row) => row.userId);
  const freeCards = cards.filter((row) => !row.userId);

  /** Kartochkasi loginga bog'langan, lekin o'sha login shu kompaniyaning a'zosi emas. */
  const memberIds = new Set(members.map((row) => row.userId));
  const cardsWithoutMembership = linkedCards.filter((row) => !memberIds.has(row.userId!));

  /** Xodim va uning foydalanuvchisi boshqa-boshqa kompaniyada (tenant buzilishi). */
  const crossTenant = await db
    .select({
      employeeId: employees.id,
      employeeCompanyId: employees.companyId,
      userId: users.id,
      phone: users.phone,
      activeCompanyId: users.activeCompanyId,
    })
    .from(employees)
    .innerJoin(users, eq(users.id, employees.userId))
    .leftJoin(companyMembers, and(eq(companyMembers.userId, users.id), eq(companyMembers.companyId, employees.companyId)))
    .where(and(eq(employees.companyId, company.id), isNull(companyMembers.userId)));

  const label = `${company.name} (${company.slug ?? company.id})`;
  report[`${label} :: 1. foydalanuvchi + kartochka`] = withCard.map((row) => ({ userId: row.userId, employeeId: row.employeeId }));
  report[`${label} :: 2. FOYDALANUVCHI BOR, KARTOCHKA YO'Q`] = withoutCard.map((row) => ({
    userId: row.userId,
    phone: row.phone,
    name: row.name,
    role: row.role,
    memberActive: row.memberActive,
    userActive: row.userActive,
    companyId: company.id,
  }));
  report[`${label} :: 3. kartochka loginli`] = linkedCards.map((row) => ({ employeeId: row.employeeId, userId: row.userId }));
  report[`${label} :: 4. kartochka loginsiz`] = freeCards.map((row) => ({
    employeeId: row.employeeId,
    code: row.code,
    name: row.name,
    phone: row.phone,
    status: row.status,
  }));
  report[`${label} :: 6. KARTOCHKA LOGINLI, A'ZOLIK YO'Q`] = cardsWithoutMembership.map((row) => ({
    employeeId: row.employeeId,
    userId: row.userId,
    name: row.name,
    phone: row.phone,
    status: row.status,
    companyId: row.companyId,
  }));
  report[`${label} :: 10. XODIM VA LOGIN HAR XIL KOMPANIYADA`] = crossTenant.map((row) => ({
    employeeId: row.employeeId,
    employeeCompanyId: row.employeeCompanyId,
    userId: row.userId,
    phone: row.phone,
    activeCompanyId: row.activeCompanyId,
  }));
}

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  for (const [title, rows] of Object.entries(report)) {
    const problem = /YO'Q|HAR XIL/.test(title);
    // Muammoli guruhlar — yozuvlari bilan, qolganlari faqat son bilan
    if (problem) print(title, rows);
    else console.log(`
── ${title} — ${rows.length} ta`);
  }
  const problems = Object.entries(report).filter(([title, rows]) => /YO'Q|HAR XIL/.test(title) && rows.length > 0);
  console.log(`\nJami muammoli guruh: ${problems.length}`);
}

await pool.end();
