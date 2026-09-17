/**
 * KPI qoidalarini boshqarish va oldindan ko'rish.
 *
 * Hisoblashning o'zi `kpi.service.ts` da. Bu yerda faqat qoidalar: ro'yxat, saqlash, o'chirish
 * va "oylik tayyorlanmasdan turib kim qancha oladi" ko'rinishi (faqat SELECT).
 */
import { and, eq, inArray } from "drizzle-orm";
import { badRequest, notFound } from "@bum/shared";
import { employees, kpiRuleTiers, kpiRules, positions } from "../../db/schema/hr.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import type { RequestMeta } from "../../shared/audit.js";
import type { TenantContext } from "../company/tenant.js";
import { hrAudit } from "./org.service.js";
import {
  KPI_METRICS,
  computeKpi,
  employeeLinks,
  rateTypeFor,
  resolveRules,
  type KpiMetric,
  type Tier,
} from "./kpi.service.js";

export type TierInput = { fromValue: string; toValue?: string | null; rate: string };
export type KpiRuleInput = {
  positionId?: string | null;
  employeeId?: string | null;
  metric: KpiMetric;
  tiers: TierInput[];
  isActive?: boolean;
  notes?: string | null;
};

/**
 * Bosqichlar mantiqan to'g'rimi: 0 dan boshlanadi, orasida bo'shliq va kesishuv yo'q,
 * oxirgisi ochiq (cheksiz) bo'lishi mumkin. Noto'g'ri bosqich — noto'g'ri oylik, shuning uchun qat'iy.
 */
function assertTiers(tiers: TierInput[]) {
  if (tiers.length === 0) throw badRequest("Kamida bitta bosqich kerak");
  const ordered = [...tiers].sort((a, b) => Number(a.fromValue) - Number(b.fromValue));
  let previousTo: number | null = 0;
  for (const [index, tier] of ordered.entries()) {
    const from = Number(tier.fromValue);
    const to = tier.toValue === null || tier.toValue === undefined || tier.toValue === "" ? null : Number(tier.toValue);
    if (!Number.isFinite(from) || from < 0) throw badRequest("Bosqich boshlanishi manfiy bo'lmasin");
    if (to !== null && to <= from) throw badRequest("Bosqich tugashi boshlanishidan katta bo'lishi kerak");
    if (Number(tier.rate) < 0) throw badRequest("Stavka manfiy bo'lmasin");
    if (previousTo === null) throw badRequest("Cheksiz bosqichdan keyin boshqa bosqich bo'lmaydi");
    if (from !== previousTo) {
      throw badRequest(
        index === 0 ? "Birinchi bosqich 0 dan boshlanishi kerak" : "Bosqichlar orasida bo'shliq yoki kesishuv bor",
      );
    }
    previousTo = to;
  }
}

/** Qoidalar ro'yxati — lavozim/xodim nomi va bosqichlari bilan. */
export async function listKpiRules(conn: DbOrTx, companyId: string) {
  const rules = await conn
    .select({
      id: kpiRules.id,
      positionId: kpiRules.positionId,
      employeeId: kpiRules.employeeId,
      metric: kpiRules.metric,
      rateType: kpiRules.rateType,
      isActive: kpiRules.isActive,
      notes: kpiRules.notes,
      positionName: positions.name,
      employeeName: employees.name,
    })
    .from(kpiRules)
    .leftJoin(positions, eq(positions.id, kpiRules.positionId))
    .leftJoin(employees, eq(employees.id, kpiRules.employeeId))
    .where(eq(kpiRules.companyId, companyId));
  if (rules.length === 0) return { rules: [] };

  const tiers = await conn
    .select({
      ruleId: kpiRuleTiers.ruleId,
      fromValue: kpiRuleTiers.fromValue,
      toValue: kpiRuleTiers.toValue,
      rate: kpiRuleTiers.rate,
    })
    .from(kpiRuleTiers)
    .where(inArray(kpiRuleTiers.ruleId, rules.map((rule) => rule.id)));

  return {
    rules: rules.map((rule) => ({
      ...rule,
      tiers: tiers
        .filter((tier) => tier.ruleId === rule.id)
        .map(({ fromValue, toValue, rate }): Tier => ({ fromValue, toValue, rate }))
        .sort((a, b) => Number(a.fromValue) - Number(b.fromValue)),
    })),
  };
}

/**
 * Qoidani yaratadi yoki almashtiradi — maqsad (lavozim yoki xodim) va ko'rsatkich juftligiga bitta qoida.
 * Bosqichlar butunlay qayta yoziladi, shuning uchun yarim holat qolmaydi.
 */
export async function saveKpiRule(tx: Tx, tenant: TenantContext, input: KpiRuleInput, meta: RequestMeta) {
  const companyId = tenant.company.id;
  const positionId = input.positionId ?? null;
  const employeeId = input.employeeId ?? null;
  if ((positionId === null) === (employeeId === null)) {
    throw badRequest("Qoida yo lavozimga, yo xodimga biriktiriladi");
  }
  if (!KPI_METRICS.includes(input.metric)) throw badRequest("Noma'lum ko'rsatkich");
  assertTiers(input.tiers);

  // Maqsad shu kompaniyanikimi
  if (positionId) {
    const [row] = await tx
      .select({ id: positions.id })
      .from(positions)
      .where(and(eq(positions.id, positionId), eq(positions.companyId, companyId)))
      .limit(1);
    if (!row) throw badRequest("Lavozim topilmadi");
  } else {
    const [row] = await tx
      .select({ id: employees.id })
      .from(employees)
      .where(and(eq(employees.id, employeeId!), eq(employees.companyId, companyId)))
      .limit(1);
    if (!row) throw badRequest("Xodim topilmadi");
  }

  const rateType = rateTypeFor(input.metric);
  const [existing] = await tx
    .select({ id: kpiRules.id })
    .from(kpiRules)
    .where(
      and(
        eq(kpiRules.companyId, companyId),
        eq(kpiRules.metric, input.metric),
        positionId ? eq(kpiRules.positionId, positionId) : eq(kpiRules.employeeId, employeeId!),
      ),
    )
    .limit(1);

  let ruleId: string;
  if (existing) {
    ruleId = existing.id;
    await tx
      .update(kpiRules)
      .set({ rateType, isActive: input.isActive ?? true, notes: input.notes ?? null, updatedAt: new Date() })
      .where(eq(kpiRules.id, ruleId));
    await tx.delete(kpiRuleTiers).where(eq(kpiRuleTiers.ruleId, ruleId));
  } else {
    const [created] = await tx
      .insert(kpiRules)
      .values({
        companyId,
        positionId,
        employeeId,
        metric: input.metric,
        rateType,
        isActive: input.isActive ?? true,
        notes: input.notes ?? null,
        createdBy: tenant.user.id,
      })
      .returning({ id: kpiRules.id });
    ruleId = created!.id;
  }

  await tx.insert(kpiRuleTiers).values(
    input.tiers.map((tier) => ({
      companyId,
      ruleId,
      fromValue: tier.fromValue,
      toValue: tier.toValue === undefined || tier.toValue === "" ? null : tier.toValue,
      rate: tier.rate,
    })),
  );

  await hrAudit(tx, tenant, meta, {
    action: existing ? "KPI_RULE_UPDATED" : "KPI_RULE_CREATED",
    resource: "kpi_rules",
    resourceId: ruleId,
    details: { metric: input.metric, positionId, employeeId, tiers: input.tiers.length },
  });
  return { ruleId };
}

export async function deleteKpiRule(tx: Tx, tenant: TenantContext, ruleId: string, meta: RequestMeta) {
  const companyId = tenant.company.id;
  const [row] = await tx
    .select({ id: kpiRules.id, metric: kpiRules.metric })
    .from(kpiRules)
    .where(and(eq(kpiRules.id, ruleId), eq(kpiRules.companyId, companyId)))
    .limit(1);
  if (!row) throw notFound("Qoida topilmadi");
  // Bosqichlar cascade bilan o'chadi; hisoblangan oyliklardagi KPI qatorlari qoladi (rule_id — null)
  await tx.delete(kpiRules).where(eq(kpiRules.id, ruleId));
  await hrAudit(tx, tenant, meta, {
    action: "KPI_RULE_DELETED",
    resource: "kpi_rules",
    resourceId: ruleId,
    details: { metric: row.metric },
  });
  return { deleted: true };
}

/**
 * Oldindan ko'rish: oylik tayyorlanmasdan turib kim qancha KPI olishini ko'rsatadi.
 * Faqat o'qiydi — hech narsa saqlanmaydi va o'zgartirilmaydi.
 */
export async function kpiPreview(conn: DbOrTx, companyId: string, month: string, employeeId?: string) {
  const staff = await conn
    .select({ id: employees.id, name: employees.name, positionId: employees.positionId, positionName: positions.name })
    .from(employees)
    .leftJoin(positions, eq(positions.id, employees.positionId))
    .where(
      and(
        eq(employees.companyId, companyId),
        eq(employees.status, "active"),
        ...(employeeId ? [eq(employees.id, employeeId)] : []),
      ),
    );
  if (staff.length === 0) return { month, employees: [] };

  const rulesByEmployee = await resolveRules(conn, companyId, staff);
  const links = new Map(
    (await employeeLinks(conn, companyId, staff.map((row) => row.id))).map((row) => [row.employeeId, row]),
  );

  const result = [];
  for (const person of staff) {
    const rules = rulesByEmployee.get(person.id) ?? [];
    const link = links.get(person.id);
    if (rules.length === 0 || !link) continue;
    const kpi = await computeKpi(conn, companyId, link, rules, month);
    result.push({
      employeeId: person.id,
      name: person.name,
      positionName: person.positionName,
      total: kpi.total,
      lines: kpi.lines,
    });
  }
  return { month, employees: result };
}
