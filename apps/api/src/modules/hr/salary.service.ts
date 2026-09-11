/**
 * Maosh (convex/hr/salary.ts).
 *
 * Holatlar: draft → approved → paid; approved → draft (qaytarish).
 * Vazifalar ajratimi: tayyorlash va tahrir — `hr.salary`; tasdiqlash va to'lash — `hr.approve`;
 * tayyorlagan foydalanuvchi o'zi tasdiqlay olmaydi (kompaniya egasidan tashqari).
 *
 * Hisob (butun sonlarda):
 *  - oylik: asosiy × ishlagan kun / norma kun; kunlik: stavka × kun; soatlik: stavka × soat
 *  - kun: kelgan/kechikkan/bayram — 1, yarim kun — 0,5, ta'til — 1 (tasdiqlangan haq to'lanmaydigan ta'til — 0), kelmagan — 0
 *  - ortiqcha ish: soatlik stavka × 1,5 × soat
 *  - soliq = hisoblangan × stavka; qo'lga = hisoblangan − soliq − ushlab qolish
 *  - kompaniya shu oyda davomat yuritmagan bo'lsa — to'liq oy (norma kun, kuniga 8 soat)
 *
 * To'lov bitta tranzaksiyada: kassa/bank chiqimi (qo'lga summa) va jurnal
 * DR ish haqi xarajatlari (hisoblangan − ushlab qolish) / CR kassa (qo'lga) + CR ish haqidan soliq majburiyati.
 *
 * Convex'dan farqlar:
 *  - `updateSalaryPayment` (`hr.manage`) holatni to'g'ridan-to'g'ri "approved"/"paid" qilardi —
 *    tasdiqlash ruxsati chetlab o'tilardi; tasdiqlangan va to'langan maosh ham tahrirlanardi
 *  - `approveSalaryPayment` holatni tekshirmasdi (to'langan → tasdiqlangan), tayyorlagan o'zi tasdiqlardi,
 *    kim tasdiqlagani yozilmasdi
 *  - davomati yo'q xodimga to'liq oy hisoblanardi (`actualDays || workDays`) — hatto butun oy kelmagan bo'lsa ham
 *  - soatlik/kunlik stavka e'tiborsiz — hammasi oylik deb hisoblanardi; soliq tahrirda qattiq 12% edi;
 *    qo'lga summa manfiy bo'lishi mumkin edi; summalar float
 *  - "to'landi" kassadan pul chiqarmasdi va jurnalga yozmasdi
 *  - bir oy uchun parallel hisoblash dublikat yaratardi (endi advisory lock + unique)
 */
import { and, asc, eq, getTableColumns, gte, inArray, lt, sql } from "drizzle-orm";
import { badRequest, forbidden, notFound } from "@bum/shared";
import { attendances, departments, employees, leaves, positions, salaryPayments } from "../../db/schema/hr.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import type { RequestMeta } from "../../shared/audit.js";
import { fromMinor, mulDivRound, rescale, toMinor } from "../../shared/decimal.js";
import { isFullAccessRole, type TenantContext } from "../company/tenant.js";
import {
  ledgerAccountFor,
  recordCashTransaction,
  resolvePaymentAccount,
  todayIso,
  type PaymentMethod,
} from "../finance/cash.service.js";
import { postJournalEntry, requireAccountBySubtype } from "../finance/journal.service.js";
import { monthRange } from "./attendance.service.js";
import { hrAudit } from "./org.service.js";

const { legacyId: _legacyId, companyId: _companyId, ...salaryFields } = getTableColumns(salaryPayments);

export type SalaryStatus = (typeof salaryPayments.status.enumValues)[number];

async function lockSalary(tx: Tx, tenant: TenantContext, salaryId: string) {
  const [salary] = await tx
    .select(salaryFields)
    .from(salaryPayments)
    .where(and(eq(salaryPayments.id, salaryId), eq(salaryPayments.companyId, tenant.company.id)))
    .limit(1)
    .for("update");
  if (!salary) throw notFound("Maosh yozuvi topilmadi");
  return salary;
}

export async function listSalaries(
  conn: DbOrTx,
  tenant: TenantContext,
  options: { month?: string; employeeId?: string; status?: SalaryStatus; limit: number },
) {
  return conn
    .select({
      ...salaryFields,
      employeeName: employees.name,
      employeeCode: employees.code,
      departmentName: departments.name,
      positionName: positions.name,
    })
    .from(salaryPayments)
    .innerJoin(employees, eq(employees.id, salaryPayments.employeeId))
    .leftJoin(departments, eq(departments.id, employees.departmentId))
    .leftJoin(positions, eq(positions.id, employees.positionId))
    .where(
      and(
        eq(salaryPayments.companyId, tenant.company.id),
        options.month ? eq(salaryPayments.month, options.month) : undefined,
        options.employeeId ? eq(salaryPayments.employeeId, options.employeeId) : undefined,
        options.status ? eq(salaryPayments.status, options.status) : undefined,
      ),
    )
    .orderBy(sql`${salaryPayments.month} desc`, asc(employees.name))
    .limit(options.limit);
}

export async function salarySummary(conn: DbOrTx, tenant: TenantContext, month: string) {
  const [summary] = await conn
    .select({
      total: sql<number>`count(*)::int`,
      draft: sql<number>`(count(*) filter (where ${salaryPayments.status} = 'draft'))::int`,
      approved: sql<number>`(count(*) filter (where ${salaryPayments.status} = 'approved'))::int`,
      paid: sql<number>`(count(*) filter (where ${salaryPayments.status} = 'paid'))::int`,
      totalGross: sql<string>`coalesce(sum(${salaryPayments.grossSalary}), 0)::numeric(18,2)`,
      totalBonus: sql<string>`coalesce(sum(${salaryPayments.bonus}), 0)::numeric(18,2)`,
      totalTax: sql<string>`coalesce(sum(${salaryPayments.tax}), 0)::numeric(18,2)`,
      totalNet: sql<string>`coalesce(sum(${salaryPayments.netSalary}), 0)::numeric(18,2)`,
    })
    .from(salaryPayments)
    .where(and(eq(salaryPayments.companyId, tenant.company.id), eq(salaryPayments.month, month)));
  return summary!;
}

export async function generateSalaries(
  tx: Tx,
  tenant: TenantContext,
  input: { month: string; taxRate?: string; workDays?: string },
  meta: RequestMeta,
) {
  const companyId = tenant.company.id;
  const { start, next } = monthRange(input.month);
  const taxRate = input.taxRate ?? "12";
  const workDays = toMinor(input.workDays ?? "26", 4);
  if (workDays <= 0n) throw badRequest("Norma kunlar musbat bo'lishi kerak");
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${companyId}:salary:${input.month}`}))`);

  const staff = await tx
    .select({ id: employees.id, baseSalary: employees.baseSalary, salaryType: employees.salaryType })
    .from(employees)
    .where(and(eq(employees.companyId, companyId), eq(employees.status, "active"), lt(employees.hireDate, next)));
  const existing = new Set(
    (
      await tx
        .select({ employeeId: salaryPayments.employeeId })
        .from(salaryPayments)
        .where(and(eq(salaryPayments.companyId, companyId), eq(salaryPayments.month, input.month)))
    ).map((r) => r.employeeId),
  );
  const pending = staff.filter((s) => !existing.has(s.id));
  if (pending.length === 0) return { created: 0, attendanceBased: false };

  const records = await tx
    .select({
      employeeId: attendances.employeeId,
      date: attendances.attendanceDate,
      status: attendances.status,
      workHours: attendances.workHours,
      overtime: attendances.overtime,
    })
    .from(attendances)
    .where(and(eq(attendances.companyId, companyId), gte(attendances.attendanceDate, start), lt(attendances.attendanceDate, next)));
  const attendanceBased = records.length > 0;

  const unpaidLeaves = await tx
    .select({ employeeId: leaves.employeeId, startDate: leaves.startDate, endDate: leaves.endDate })
    .from(leaves)
    .where(
      and(
        eq(leaves.companyId, companyId),
        eq(leaves.status, "approved"),
        eq(leaves.type, "unpaid"),
        inArray(leaves.employeeId, pending.map((p) => p.id)),
        lt(leaves.startDate, next),
        gte(leaves.endDate, start),
      ),
    );
  const isUnpaidLeave = (employeeId: string, date: string) =>
    unpaidLeaves.some((l) => l.employeeId === employeeId && l.startDate <= date && l.endDate >= date);

  const rate = toMinor(taxRate, 2);
  for (const employee of pending) {
    let days = 0n;
    let hours = 0n;
    let overtime = 0n;
    if (attendanceBased) {
      for (const record of records.filter((r) => r.employeeId === employee.id)) {
        hours += toMinor(record.workHours, 4);
        overtime += toMinor(record.overtime, 4);
        if (record.status === "present" || record.status === "late" || record.status === "holiday") days += 10000n;
        else if (record.status === "half_day") days += 5000n;
        else if (record.status === "on_leave" && !isUnpaidLeave(employee.id, record.date)) days += 10000n;
      }
    } else {
      days = workDays;
      hours = workDays * 8n;
    }

    const base = toMinor(employee.baseSalary);
    let earned: bigint;
    let hourlyRate: bigint; // 4 xona
    if (employee.salaryType === "monthly") {
      earned = mulDivRound(base, days, workDays);
      hourlyRate = mulDivRound(base, 1_000_000n, workDays * 8n);
    } else if (employee.salaryType === "daily") {
      earned = rescale(base * days, 6, 2);
      hourlyRate = mulDivRound(base, 100n, 8n);
    } else {
      earned = rescale(base * hours, 6, 2);
      hourlyRate = base * 100n;
    }
    const overtimePay = rescale(mulDivRound(hourlyRate * overtime, 15n, 10n), 8, 2);
    const gross = earned + overtimePay;
    const tax = mulDivRound(gross, rate, 10000n);

    await tx.insert(salaryPayments).values({
      companyId,
      employeeId: employee.id,
      month: input.month,
      baseSalary: employee.baseSalary,
      workDays: fromMinor(workDays, 4),
      actualDays: fromMinor(days, 4),
      overtime: fromMinor(overtime, 4),
      overtimePay: fromMinor(overtimePay),
      grossSalary: fromMinor(gross),
      taxRate,
      tax: fromMinor(tax),
      netSalary: fromMinor(gross - tax),
      createdBy: tenant.user.id,
    });
  }

  await hrAudit(tx, tenant, meta, {
    action: "SALARY_GENERATED",
    resource: "salary_payments",
    resourceId: companyId,
    details: { month: input.month, created: pending.length, attendanceBased, taxRate },
  });
  return { created: pending.length, attendanceBased };
}

export async function updateSalary(
  tx: Tx,
  tenant: TenantContext,
  salaryId: string,
  input: { bonus?: string; deductions?: string; notes?: string | null },
  meta: RequestMeta,
) {
  const salary = await lockSalary(tx, tenant, salaryId);
  if (salary.status !== "draft") throw badRequest("Faqat qoralama maosh tahrirlanadi");

  const earned = toMinor(salary.grossSalary) - toMinor(salary.bonus) - toMinor(salary.overtimePay);
  const bonus = toMinor(input.bonus ?? salary.bonus);
  const deductions = toMinor(input.deductions ?? salary.deductions);
  const gross = earned + toMinor(salary.overtimePay) + bonus;
  const tax = mulDivRound(gross, toMinor(salary.taxRate, 2), 10000n);
  const net = gross - tax - deductions;
  if (net < 0n) throw badRequest("Ushlab qolish qo'lga beriladigan summadan katta");

  const [updated] = await tx
    .update(salaryPayments)
    .set({
      bonus: fromMinor(bonus),
      deductions: fromMinor(deductions),
      grossSalary: fromMinor(gross),
      tax: fromMinor(tax),
      netSalary: fromMinor(net),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      updatedAt: new Date(),
    })
    .where(eq(salaryPayments.id, salaryId))
    .returning(salaryFields);

  await hrAudit(tx, tenant, meta, {
    action: "SALARY_UPDATED",
    resource: "salary_payments",
    resourceId: salaryId,
    details: { bonus: fromMinor(bonus), deductions: fromMinor(deductions), netSalary: fromMinor(net) },
  });
  return updated!;
}

export async function approveSalary(tx: Tx, tenant: TenantContext, salaryId: string, meta: RequestMeta) {
  const salary = await lockSalary(tx, tenant, salaryId);
  if (salary.status !== "draft") throw badRequest("Faqat qoralama maosh tasdiqlanadi");
  if (salary.createdBy === tenant.user.id && !isFullAccessRole(tenant.membership.companyRole)) {
    throw forbidden("Maoshni tayyorlagan xodim uni o'zi tasdiqlay olmaydi");
  }

  const [updated] = await tx
    .update(salaryPayments)
    .set({ status: "approved", approvedBy: tenant.user.id, updatedAt: new Date() })
    .where(eq(salaryPayments.id, salaryId))
    .returning(salaryFields);
  await hrAudit(tx, tenant, meta, {
    action: "SALARY_APPROVED",
    resource: "salary_payments",
    resourceId: salaryId,
    details: { employeeId: salary.employeeId, month: salary.month, netSalary: salary.netSalary },
  });
  return updated!;
}

export async function revertSalary(tx: Tx, tenant: TenantContext, salaryId: string, meta: RequestMeta) {
  const salary = await lockSalary(tx, tenant, salaryId);
  if (salary.status !== "approved") throw badRequest("Faqat tasdiqlangan (to'lanmagan) maosh qaytariladi");

  const [updated] = await tx
    .update(salaryPayments)
    .set({ status: "draft", approvedBy: null, updatedAt: new Date() })
    .where(eq(salaryPayments.id, salaryId))
    .returning(salaryFields);
  await hrAudit(tx, tenant, meta, {
    action: "SALARY_REVERTED",
    resource: "salary_payments",
    resourceId: salaryId,
    details: { employeeId: salary.employeeId, month: salary.month },
  });
  return updated!;
}

export async function deleteSalary(tx: Tx, tenant: TenantContext, salaryId: string, meta: RequestMeta) {
  const salary = await lockSalary(tx, tenant, salaryId);
  if (salary.status !== "draft") throw badRequest("Faqat qoralama maosh o'chiriladi");

  await tx.delete(salaryPayments).where(eq(salaryPayments.id, salaryId));
  await hrAudit(tx, tenant, meta, {
    action: "SALARY_DELETED",
    resource: "salary_payments",
    resourceId: salaryId,
    details: { employeeId: salary.employeeId, month: salary.month },
  });
}

export async function paySalary(
  tx: Tx,
  tenant: TenantContext,
  salaryId: string,
  input: { method?: PaymentMethod; cashAccountId?: string | null; paidDate?: string },
  meta: RequestMeta,
) {
  const companyId = tenant.company.id;
  const salary = await lockSalary(tx, tenant, salaryId);
  if (salary.status !== "approved") throw badRequest("Faqat tasdiqlangan maosh to'lanadi");

  const [employee] = await tx.select({ name: employees.name }).from(employees).where(eq(employees.id, salary.employeeId));
  const paidDate = input.paidDate ?? todayIso();
  const description = `Maosh ${salary.month}: ${employee?.name ?? ""}`.trim();
  const net = toMinor(salary.netSalary);
  const tax = toMinor(salary.tax);
  const expense = toMinor(salary.grossSalary) - toMinor(salary.deductions);

  const lines: { accountId: string; debit?: string; credit?: string }[] = [];
  if (net > 0n) {
    const { account } = await recordCashTransaction(tx, companyId, tenant.user.id, {
      cashAccountId: await resolvePaymentAccount(tx, companyId, input.method ?? "cash", input.cashAccountId),
      type: "out",
      amount: salary.netSalary,
      txDate: paidDate,
      description,
      category: "salary",
      referenceType: "salary_payment",
      referenceId: salary.id,
    });
    lines.push({ accountId: await ledgerAccountFor(tx, companyId, account.type), credit: salary.netSalary });
  }
  if (tax > 0n) {
    lines.push({
      accountId: await requireAccountBySubtype(tx, companyId, "payroll_tax", "liability", "Ish haqidan soliq majburiyati"),
      credit: salary.tax,
    });
  }
  if (expense > 0n) {
    lines.unshift({
      accountId: await requireAccountBySubtype(tx, companyId, "salary", "expense", "Ish haqi xarajatlari"),
      debit: fromMinor(expense),
    });
    await postJournalEntry(tx, companyId, tenant.user.id, {
      entryDate: paidDate,
      description,
      referenceType: "salary_payment",
      referenceId: salary.id,
      lines,
    });
  }

  const [updated] = await tx
    .update(salaryPayments)
    .set({ status: "paid", paidDate, updatedAt: new Date() })
    .where(eq(salaryPayments.id, salaryId))
    .returning(salaryFields);
  await hrAudit(tx, tenant, meta, {
    action: "SALARY_PAID",
    resource: "salary_payments",
    resourceId: salaryId,
    details: { employeeId: salary.employeeId, month: salary.month, netSalary: salary.netSalary },
  });
  return updated!;
}
