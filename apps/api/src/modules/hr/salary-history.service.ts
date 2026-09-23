/**
 * FIKSATSIYALANGAN OYLIK TARIXI.
 *
 * Muammo: `employees.base_salary` bitta qiymat — oylik oshirilsa, OLDINGI oylarni qayta
 * hisoblaganda yangi stavka ishlatilib, tugagan oyning hisob-kitobi buzilardi.
 *
 * Yechim: har o'zgarish "qaysi oydan amal qiladi" bilan yoziladi. Maosh tayyorlashda shu oyga
 * AMAL QILGAN stavka olinadi; `employees.base_salary` esa joriy (eng oxirgi) stavka bo'lib qoladi,
 * shuning uchun mavjud ekranlar va hisobotlar o'zgarmaydi.
 *
 * Tarixi yo'q xodimda avvalgidek `employees.base_salary` ishlatiladi — eski ma'lumot buzilmaydi.
 */
import { and, desc, eq, inArray, lte } from "drizzle-orm";
import { badRequest } from "@bum/shared";
import { employeeSalaryHistory, employees } from "../../db/schema/hr.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import type { TenantContext } from "../company/tenant.js";

const MONTH_RE = /^\d{4}-\d{2}$/;

export function assertMonth(month: string): string {
  if (!MONTH_RE.test(month)) throw badRequest("Oy 'YYYY-MM' ko'rinishida bo'lishi kerak");
  return month;
}

/**
 * Oylik o'zgarishini yozadi. `employees.base_salary` ni ham yangilaydi (joriy stavka),
 * lekin faqat o'zgarish KELAJAK yoki JORIY oyga tegishli bo'lsa — orqaga qarab kiritilgan
 * tuzatish joriy stavkani o'zgartirib yubormasligi kerak.
 */
export async function recordSalaryChange(
  tx: Tx,
  tenant: TenantContext,
  input: { employeeId: string; newSalary: string; effectiveMonth: string; reason?: string | null },
) {
  assertMonth(input.effectiveMonth);
  const companyId = tenant.company.id;
  const [employee] = await tx
    .select({ id: employees.id, baseSalary: employees.baseSalary })
    .from(employees)
    .where(and(eq(employees.id, input.employeeId), eq(employees.companyId, companyId)))
    .limit(1)
    .for("update");
  if (!employee) throw badRequest("Xodim topilmadi");

  if (Number(input.newSalary) < 0) throw badRequest("Oylik manfiy bo'lmasin");

  const [row] = await tx
    .insert(employeeSalaryHistory)
    .values({
      companyId,
      employeeId: employee.id,
      oldSalary: employee.baseSalary,
      newSalary: input.newSalary,
      effectiveMonth: input.effectiveMonth,
      reason: input.reason?.trim() || null,
      changedBy: tenant.user.id,
    })
    .returning();

  // Joriy stavka — eng KEYINGI amal qiladigan yozuv (orqaga qarab tuzatish uni o'zgartirmaydi)
  const [latest] = await tx
    .select({ newSalary: employeeSalaryHistory.newSalary })
    .from(employeeSalaryHistory)
    .where(and(eq(employeeSalaryHistory.companyId, companyId), eq(employeeSalaryHistory.employeeId, employee.id)))
    .orderBy(desc(employeeSalaryHistory.effectiveMonth), desc(employeeSalaryHistory.createdAt))
    .limit(1);
  if (latest) {
    await tx
      .update(employees)
      .set({ baseSalary: latest.newSalary, updatedAt: new Date() })
      .where(eq(employees.id, employee.id));
  }
  return row!;
}

/** Xodimning oylik o'zgarishlari — yangisidan eskisiga. */
export async function listSalaryHistory(conn: DbOrTx, tenant: TenantContext, employeeId: string) {
  return conn
    .select()
    .from(employeeSalaryHistory)
    .where(
      and(eq(employeeSalaryHistory.companyId, tenant.company.id), eq(employeeSalaryHistory.employeeId, employeeId)),
    )
    .orderBy(desc(employeeSalaryHistory.effectiveMonth), desc(employeeSalaryHistory.createdAt));
}

/**
 * Berilgan OYGA amal qilgan stavkalar: employeeId → oylik.
 * Tarixda shu oyga (yoki undan oldinga) yozuv bo'lmasa xodim ro'yxatga tushmaydi —
 * chaqiruvchi `employees.base_salary` ga qaytadi.
 */
export async function effectiveSalaries(
  conn: DbOrTx,
  companyId: string,
  employeeIds: string[],
  month: string,
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (employeeIds.length === 0) return result;
  assertMonth(month);

  const rows = await conn
    .select({
      employeeId: employeeSalaryHistory.employeeId,
      newSalary: employeeSalaryHistory.newSalary,
      effectiveMonth: employeeSalaryHistory.effectiveMonth,
      createdAt: employeeSalaryHistory.createdAt,
    })
    .from(employeeSalaryHistory)
    .where(
      and(
        eq(employeeSalaryHistory.companyId, companyId),
        inArray(employeeSalaryHistory.employeeId, employeeIds),
        lte(employeeSalaryHistory.effectiveMonth, month),
      ),
    )
    .orderBy(employeeSalaryHistory.effectiveMonth, employeeSalaryHistory.createdAt);

  // Tartib eskidan yangiga — oxirgi yozuv shu oyga amal qilgan stavka bo'ladi
  for (const row of rows) result.set(row.employeeId, row.newSalary);
  return result;
}
