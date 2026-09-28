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
import { and, asc, eq, getTableColumns, gte, inArray, lt, ne, sql } from "drizzle-orm";
import { badRequest, conflict, forbidden, notFound } from "@bum/shared";
import { attendances, departments, employees, leaves, positions, salaryKpiLines, salaryPayments } from "../../db/schema/hr.js";
import { computeKpi, employeeLinks, resolveRules } from "./kpi.service.js";
import { effectiveSalaries } from "./salary-history.service.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import type { RequestMeta } from "../../shared/audit.js";
import { fromMinor, mulDivRound, rescale, toMinor } from "../../shared/decimal.js";
import { assertModuleEnabled } from "../company/modules.service.js";
import { isFullAccessRole, type TenantContext } from "../company/tenant.js";
import {
  ledgerAccountFor,
  recordCashTransaction,
  resolvePaymentAccount,
  todayIso,
  type PaymentMethod,
} from "../finance/cash.service.js";
import { assertPeriodOpen, ensureAccountBySubtype, postJournalEntry, requireAccountBySubtype } from "../finance/journal.service.js";
import { mirrorReferences, type SourceRef } from "../finance/reversal.service.js";
import { expenses, journalEntries } from "../../db/schema/finance.js";
import { applyOutgoingBankCommission } from "../finance/bank-commission.service.js";
import { monthRange } from "./attendance.service.js";
import { allowanceTotalsForMonth } from "./allowances.service.js";
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
      reversed: sql<number>`(count(*) filter (where ${salaryPayments.status} = 'reversed'))::int`,
      // Bekor qilingan maosh jamiga kirmaydi (uning o'rniga to'g'rilangani hisoblanadi)
      totalGross: sql<string>`coalesce(sum(${salaryPayments.grossSalary}) filter (where ${salaryPayments.status} <> 'reversed'), 0)::numeric(18,2)`,
      totalBonus: sql<string>`coalesce(sum(${salaryPayments.bonus}) filter (where ${salaryPayments.status} <> 'reversed'), 0)::numeric(18,2)`,
      totalTax: sql<string>`coalesce(sum(${salaryPayments.tax}) filter (where ${salaryPayments.status} <> 'reversed'), 0)::numeric(18,2)`,
      totalNet: sql<string>`coalesce(sum(${salaryPayments.netSalary}) filter (where ${salaryPayments.status} <> 'reversed'), 0)::numeric(18,2)`,
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
    .select({
      id: employees.id,
      baseSalary: employees.baseSalary,
      salaryType: employees.salaryType,
      positionId: employees.positionId,
    })
    .from(employees)
    .where(and(eq(employees.companyId, companyId), eq(employees.status, "active"), lt(employees.hireDate, next)));
  const existing = new Set(
    (
      await tx
        .select({ employeeId: salaryPayments.employeeId })
        .from(salaryPayments)
        // Bekor qilingan maosh o'rniga to'g'rilangani tayyorlanadi
        .where(and(eq(salaryPayments.companyId, companyId), eq(salaryPayments.month, input.month), ne(salaryPayments.status, "reversed")))
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

  // ── KPI: mukofot xodim qilgan ishdan hisoblanadi (qoida bo'lmasa — 0) ────
  const kpiRulesByEmployee = await resolveRules(tx, companyId, pending);
  const linksById = new Map(
    (await employeeLinks(tx, companyId, pending.map((person) => person.id))).map((row) => [row.employeeId, row]),
  );

  // Yo'l puli, ovqat puli va boshqa muntazam to'lovlar — shu oyga tegishlilari
  const allowanceTotals = await allowanceTotalsForMonth(tx, companyId, input.month);
  // Shu OYGA amal qilgan oylik stavkalar: oylik keyin oshirilsa ham tugagan oy qayta
  // hisoblanganda eski stavka ishlatiladi. Tarixi yo'q xodimda joriy `baseSalary` qoladi.
  const salaryForMonth = await effectiveSalaries(tx, companyId, pending.map((person) => person.id), input.month);
  const rate = toMinor(taxRate, 2);
  let kpiTotal = 0n;
  /** Haqiqatda yozilgan varaqalar soni (to'lovi yo'q xodimlar o'tkazib yuboriladi). */
  let created = 0;
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

    const monthSalary = salaryForMonth.get(employee.id) ?? employee.baseSalary;
    const base = toMinor(monthSalary);
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

    // KPI mukofoti — hisoblangan summaga qo'shiladi, soliq shundan ham olinadi
    const rules = kpiRulesByEmployee.get(employee.id) ?? [];
    const links = linksById.get(employee.id);
    const kpi = links && rules.length > 0
      ? await computeKpi(tx, companyId, links, rules, input.month)
      : { total: "0.00", lines: [] };
    const bonus = toMinor(kpi.total);
    kpiTotal += bonus;

    const gross = earned + overtimePay + bonus;
    const tax = mulDivRound(gross, rate, 10000n);
    // Kompensatsiya (yo'l, ovqat) soliqqa kirmaydi — qo'lga beriladigan summaga qo'shiladi
    const allowances = allowanceTotals.get(employee.id) ?? 0n;

    // To'lanadigan hech narsasi yo'q xodim (maoshi kiritilmagan, KPI va qo'shimcha to'lovi ham yo'q)
    // varaqaga tushmaydi — maoshi belgilangach keyingi hisobda paydo bo'ladi
    if (gross === 0n && allowances === 0n) continue;

    const [row] = await tx.insert(salaryPayments).values({
      companyId,
      employeeId: employee.id,
      month: input.month,
      baseSalary: monthSalary,
      workDays: fromMinor(workDays, 4),
      actualDays: fromMinor(days, 4),
      overtime: fromMinor(overtime, 4),
      overtimePay: fromMinor(overtimePay),
      bonus: fromMinor(bonus),
      allowances: fromMinor(allowances),
      grossSalary: fromMinor(gross),
      taxRate,
      tax: fromMinor(tax),
      netSalary: fromMinor(gross - tax + allowances),
      createdBy: tenant.user.id,
    }).returning({ id: salaryPayments.id });
    created += 1;

    // KPI qanday chiqqani saqlanadi — oylik varaqasida "nega shuncha" ko'rinadi
    if (row && kpi.lines.length > 0) {
      await tx.insert(salaryKpiLines).values(
        kpi.lines.map((line) => ({
          companyId,
          salaryPaymentId: row.id,
          metric: line.metric,
          metricValue: line.metricValue,
          amount: line.amount,
          ruleId: line.ruleId,
          // SNAPSHOT — keyin qoida o'zgarsa ham shu oy hisoboti o'zgarmaydi
          target: line.target,
          achievementPercent: line.achievementPercent,
          weight: line.weight,
          bonusType: line.bonusType,
        })),
      );
    }
  }

  await hrAudit(tx, tenant, meta, {
    action: "SALARY_GENERATED",
    resource: "salary_payments",
    resourceId: companyId,
    details: { month: input.month, created, attendanceBased, taxRate, kpiTotal: fromMinor(kpiTotal) },
  });
  return { created, attendanceBased };
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
  // Kompensatsiya (yo'l, ovqat) soliqqa kirmaydi, lekin qo'lga beriladigan summada qoladi
  const allowances = toMinor(salary.allowances);
  const net = gross - tax - deductions + allowances;
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

/** Oyning oxirgi kuni (`2026-09` → `2026-09-30`) — hisoblangan xarajat shu sanada tan olinadi. */
function monthEndIso(month: string): string {
  const [year, index] = month.split("-").map(Number);
  return new Date(Date.UTC(year!, index!, 0)).toISOString().slice(0, 10);
}

/** Maosh tarkibi: soliq solinadigan ish haqi (5100), kompensatsiya (5500), soliq (2200) va qo'lga beriladigan summa. */
function salaryParts(salary: { grossSalary: string; deductions: string; allowances: string; tax: string; netSalary: string }) {
  return {
    expense: toMinor(salary.grossSalary) - toMinor(salary.deductions),
    compensation: toMinor(salary.allowances),
    tax: toMinor(salary.tax),
    net: toMinor(salary.netSalary),
  };
}

/**
 * HISOBLASH (accrual, egasi qarori 2026-09-28): maosh TASDIQLANGANDA xarajat o'z oyida tan olinadi —
 * DR 5100 ish haqi + DR 5500 kompensatsiya / CR 2250 ish haqi bo'yicha qarz + CR 2200 soliq.
 * To'lov keyingi oyda bo'lsa ham o'sha oy foydasi o'zgarmaydi: to'lovda faqat DR 2250 / CR kassa.
 * Yozuv sanasi — maosh oyining oxirgi kuni; o'sha davr yopilgan bo'lsa amal rad etiladi (hisobot topshirilgan).
 */
async function postSalaryAccrual(
  tx: Tx,
  tenant: TenantContext,
  salary: { id: string; month: string; grossSalary: string; deductions: string; allowances: string; tax: string; netSalary: string },
  employeeName: string,
) {
  const companyId = tenant.company.id;
  const { expense, compensation, tax, net } = salaryParts(salary);
  if (net + tax === 0n) return null;
  const entryDate = monthEndIso(salary.month);
  await assertPeriodOpen(tx, companyId, entryDate);
  const description = `Maosh hisoblandi ${salary.month}: ${employeeName}`.trim();
  const lines: { accountId: string; debit?: string; credit?: string; description?: string }[] = [];
  if (expense > 0n) {
    lines.push({ accountId: await requireAccountBySubtype(tx, companyId, "salary", "expense", "Ish haqi xarajatlari"), debit: fromMinor(expense) });
  }
  if (compensation > 0n) {
    lines.push({
      accountId: await requireAccountBySubtype(tx, companyId, "other", "expense", "Boshqa xarajatlar"),
      debit: fromMinor(compensation),
      description: "Xodimga kompensatsiya (yo'l, ovqat va boshqa)",
    });
  }
  if (net > 0n) {
    lines.push({ accountId: await ensureAccountBySubtype(tx, companyId, "payroll_payable"), credit: fromMinor(net) });
  }
  if (tax > 0n) {
    lines.push({ accountId: await requireAccountBySubtype(tx, companyId, "payroll_tax", "liability", "Ish haqidan soliq majburiyati"), credit: fromMinor(tax) });
  }
  if (lines.length < 2) return null;
  const { entry } = await postJournalEntry(tx, companyId, tenant.user.id, {
    entryDate,
    description,
    referenceType: "salary_accrual",
    referenceId: salary.id,
    lines,
  });
  return entry;
}

/** Shu maosh uchun hisoblash yozuvi bormi (eski, accrual'gacha tasdiqlangan maoshlarda — yo'q). */
async function accrualEntryId(tx: Tx, companyId: string, salaryId: string) {
  const [row] = await tx
    .select({ id: journalEntries.id })
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.companyId, companyId),
        eq(journalEntries.referenceType, "salary_accrual"),
        eq(journalEntries.referenceId, salaryId),
        eq(journalEntries.status, "posted"),
      ),
    )
    .limit(1);
  return row?.id ?? null;
}

export async function approveSalary(tx: Tx, tenant: TenantContext, salaryId: string, meta: RequestMeta) {
  const salary = await lockSalary(tx, tenant, salaryId);
  if (salary.status !== "draft") throw badRequest("Faqat qoralama maosh tasdiqlanadi");
  if (salary.createdBy === tenant.user.id && !isFullAccessRole(tenant.membership.companyRole)) {
    throw forbidden("Maoshni tayyorlagan xodim uni o'zi tasdiqlay olmaydi");
  }
  // Tasdiqlash endi buxgalteriya yozuvini yozadi — moliya moduli o'chiq bo'lsa amalga oshmaydi
  await assertModuleEnabled(tx, tenant.company.id, "finance");
  const [employee] = await tx.select({ name: employees.name }).from(employees).where(eq(employees.id, salary.employeeId));
  const entry = await postSalaryAccrual(tx, tenant, salary, employee?.name ?? "");

  const [updated] = await tx
    .update(salaryPayments)
    .set({ status: "approved", approvedBy: tenant.user.id, updatedAt: new Date() })
    .where(eq(salaryPayments.id, salaryId))
    .returning(salaryFields);
  await hrAudit(tx, tenant, meta, {
    action: "SALARY_APPROVED",
    resource: "salary_payments",
    resourceId: salaryId,
    details: { employeeId: salary.employeeId, month: salary.month, netSalary: salary.netSalary, accrualEntryId: entry?.id ?? null },
  });
  return updated!;
}

export async function revertSalary(tx: Tx, tenant: TenantContext, salaryId: string, meta: RequestMeta) {
  const salary = await lockSalary(tx, tenant, salaryId);
  if (salary.status !== "approved") throw badRequest("Faqat tasdiqlangan (to'lanmagan) maosh qaytariladi");
  // Tasdiqlashdagi hisoblash yozuvi teskari yoziladi (asl yozuv o'chirilmaydi) — qoralamada xarajat bo'lmaydi
  if (await accrualEntryId(tx, tenant.company.id, salary.id)) {
    const [employee] = await tx.select({ name: employees.name }).from(employees).where(eq(employees.id, salary.employeeId));
    await mirrorReferences(tx, tenant.company.id, tenant.user.id, {
      refs: [{ type: "salary_accrual", id: salary.id }],
      reversalType: "salary_accrual_reversal",
      label: `Maosh hisobi bekor qilindi ${salary.month}: ${employee?.name ?? ""}`.trim(),
      date: todayIso(),
    });
  }

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
  // To'lov kassa harakati va jurnal yozadi — moliya moduli o'chiq bo'lsa amalga oshmaydi
  await assertModuleEnabled(tx, companyId, "finance");
  const salary = await lockSalary(tx, tenant, salaryId);
  if (salary.status !== "approved") throw badRequest("Faqat tasdiqlangan maosh to'lanadi");

  const [employee] = await tx.select({ name: employees.name }).from(employees).where(eq(employees.id, salary.employeeId));
  const paidDate = input.paidDate ?? todayIso();
  const description = `Maosh ${salary.month}: ${employee?.name ?? ""}`.trim();
  const { expense, compensation, tax, net } = salaryParts(salary);
  /**
   * Hisoblash (accrual) yozuvi tasdiqlashda yozilgan bo'lsa — to'lovda faqat qarz yopiladi:
   * DR 2250 ish haqi bo'yicha qarz / CR kassa. Xarajat va soliq o'z oyida qolaveradi.
   * Eski (accrual'gacha tasdiqlangan) maoshlarda yozuv yo'q — o'shalar avvalgidek to'liq yoziladi:
   * DR 5100 + DR 5500 / CR kassa + CR 2200.
   */
  const accrued = (await accrualEntryId(tx, companyId, salary.id)) !== null;

  const lines: { accountId: string; debit?: string; credit?: string; description?: string }[] = [];
  let paidAccountId: string | null = null;
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
    lines.push({ accountId: await ledgerAccountFor(tx, companyId, account), credit: salary.netSalary });
    paidAccountId = account.id;
  }
  if (accrued) {
    if (net > 0n) {
      lines.unshift({ accountId: await ensureAccountBySubtype(tx, companyId, "payroll_payable"), debit: salary.netSalary });
    }
  } else {
    if (tax > 0n) {
      lines.push({
        accountId: await requireAccountBySubtype(tx, companyId, "payroll_tax", "liability", "Ish haqidan soliq majburiyati"),
        credit: salary.tax,
      });
    }
    if (compensation > 0n) {
      lines.unshift({
        accountId: await requireAccountBySubtype(tx, companyId, "other", "expense", "Boshqa xarajatlar"),
        debit: fromMinor(compensation),
        description: "Xodimga kompensatsiya (yo'l, ovqat va boshqa)",
      });
    }
    if (expense > 0n) {
      lines.unshift({
        accountId: await requireAccountBySubtype(tx, companyId, "salary", "expense", "Ish haqi xarajatlari"),
        debit: fromMinor(expense),
      });
    }
  }
  // Debet (ish haqi + kompensatsiya) = kredit (qo'lga berilgan + soliq) — invariant postJournalEntry da ham tekshiriladi
  if (lines.length >= 2) {
    await postJournalEntry(tx, companyId, tenant.user.id, {
      entryDate: paidDate,
      description,
      referenceType: "salary_payment",
      referenceId: salary.id,
      lines,
    });
  }

  // Bankdan o'tkazilgan maosh — hisob komissiyasi alohida "Bank komissiyasi" xarajati
  if (paidAccountId) {
    await applyOutgoingBankCommission(tx, tenant, {
      cashAccountId: paidAccountId,
      amount: salary.netSalary,
      date: paidDate,
      description,
      sourceType: "salary_payment",
      sourceId: salary.id,
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

/**
 * TO'LANGAN MAOSHNI BEKOR QILISH (egasi qarori, 2026-09-28). Asl maosh hujjati, kassa harakati va jurnal yozuvi
 * o'zgarmaydi va o'chirilmaydi — kompensatsion teskari yozuvlar (`reversal.service`): pul o'sha kassa/bankka qaytadi,
 * jurnal debet ↔ kredit (ish haqi xarajati, kompensatsiya, soliq majburiyati), bank komissiyasi (bo'lsa) ham qaytadi.
 * Holat `reversed`, kim/qachon/nega saqlanadi va auditga yoziladi (asl va teskari yozuvlar id lari bilan). Qayta bekor
 * qilish — 409. Shu oy uchun to'g'rilangan maosh qaytadan tayyorlanadi (yagonalik faqat bekor qilinmaganlar orasida).
 */
export async function reverseSalary(tx: Tx, tenant: TenantContext, salaryId: string, reason: string, meta: RequestMeta) {
  const companyId = tenant.company.id;
  const cleanReason = reason.trim();
  if (cleanReason.length < 3) throw badRequest("Bekor qilish sababini yozing");
  await assertModuleEnabled(tx, companyId, "finance");
  const today = todayIso();
  await assertPeriodOpen(tx, companyId, today);
  const salary = await lockSalary(tx, tenant, salaryId);
  if (salary.status === "reversed") throw conflict("Maosh allaqachon bekor qilingan");
  if (salary.status !== "paid") throw badRequest("Faqat to'langan maosh bekor qilinadi — to'lanmaganini qoralamaga qaytaring");

  // Bankdan to'langanda yozilgan komissiya xarajatlari — ular ham qaytadi
  const fees = await tx
    .select({ id: expenses.id })
    .from(expenses)
    .where(and(eq(expenses.companyId, companyId), eq(expenses.referenceType, "salary_payment"), eq(expenses.referenceId, salary.id), ne(expenses.status, "reversed")));
  // Hisoblash (accrual) yozuvi ham teskari yoziladi: xarajat, soliq majburiyati va ish haqi qarzi nolga qaytadi
  const accrued = (await accrualEntryId(tx, companyId, salary.id)) !== null;
  const refs: SourceRef[] = [
    { type: "salary_payment", id: salary.id },
    ...(accrued ? [{ type: "salary_accrual", id: salary.id }] : []),
    ...fees.map((fee) => ({ type: "bank_fee", id: fee.id })),
  ];
  const [employee] = await tx.select({ name: employees.name }).from(employees).where(eq(employees.id, salary.employeeId));
  const entries = await mirrorReferences(tx, companyId, tenant.user.id, {
    refs,
    reversalType: "salary_reversal",
    label: `Maosh ${salary.month} bekor qilindi: ${employee?.name ?? ""} — ${cleanReason}`,
    date: today,
  });
  const reversedAt = new Date();
  for (const fee of fees) {
    await tx
      .update(expenses)
      .set({ status: "reversed", reversedAt, reversedBy: tenant.user.id, reversalReason: cleanReason, updatedAt: reversedAt })
      .where(eq(expenses.id, fee.id));
  }
  const [updated] = await tx
    .update(salaryPayments)
    .set({ status: "reversed", reversedAt, reversedBy: tenant.user.id, reversalReason: cleanReason, updatedAt: reversedAt })
    .where(eq(salaryPayments.id, salary.id))
    .returning(salaryFields);

  await hrAudit(tx, tenant, meta, {
    action: "SALARY_REVERSED",
    resource: "salary_payments",
    resourceId: salary.id,
    details: {
      employeeId: salary.employeeId,
      month: salary.month,
      netSalary: salary.netSalary,
      paidDate: salary.paidDate,
      reason: cleanReason,
      originalReference: { type: "salary_payment", id: salary.id },
      reversalJournalEntries: entries,
      fees: fees.map((fee) => fee.id),
    },
  });
  return updated!;
}
