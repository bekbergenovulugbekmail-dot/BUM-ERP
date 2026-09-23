/**
 * KPI: oylik mukofotni xodim haqiqatda qilgan ishdan hisoblash.
 *
 * Qoida lavozimga yoziladi — shu lavozimdagi hamma xodimga tegadi; alohida xodimga yozilgani
 * o'sha xodim uchun lavozim qoidasining O'RNIGA ishlaydi (har ko'rsatkich bo'yicha alohida).
 * Bir xodimda bir nechta ko'rsatkich bo'lsa — ular qo'shiladi.
 *
 * Hisob PROGRESSIV: har bosqich faqat o'z oralig'iga tushgan qismga qo'llanadi.
 *   Bosqichlar: 0–100 → 4 000, 100–200 → 6 000, 200+ → 9 000; 214 ta yetkazma uchun
 *   100×4 000 + 100×6 000 + 14×9 000 = 1 126 000.
 *
 * Barcha hisob butun sonlarda (bigint): ko'rsatkich 4 xona, pul 2 xona.
 * Ko'rsatkichlar faqat O'QILADI — hech qanday hujjat o'zgartirilmaydi.
 */
import { and, eq, gte, inArray, lt, or, sql } from "drizzle-orm";
import { badRequest } from "@bum/shared";
import { customerPayments, salesOrders, salesOrderItems } from "../../db/schema/sales.js";
import { agentOrders, agentVisits } from "../../db/schema/sales-agent.js";
import { salesReps } from "../../db/schema/crm.js";
import { deliveryAgents, deliveryTasks } from "../../db/schema/delivery.js";
import { products } from "../../db/schema/catalog.js";
import { stockMovements } from "../../db/schema/inventory.js";
import { employees, kpiRuleTiers, kpiRules } from "../../db/schema/hr.js";
import type { DbOrTx } from "../../db/transaction.js";
import { fromMinor, toMinor } from "../../shared/decimal.js";

export type KpiMetric = (typeof KPI_METRICS)[number];

export const KPI_METRICS = [
  "delivery_count",
  "delivery_amount",
  "delivery_weight_kg",
  "agent_sales_amount",
  "agent_order_count",
  "agent_visit_count",
  "agent_collected_amount",
  "cashier_receipt_count",
  "cashier_sales_amount",
  "warehouse_receipt_count",
  "warehouse_issue_count",
] as const;

/**
 * Ko'rsatkich turi stavka ma'nosini belgilaydi:
 *  - `money` → stavka FOIZ (summadan);
 *  - `count` va `weight` → stavka bir dona / bir kg uchun SUMMA.
 */
export const METRIC_KIND: Record<KpiMetric, "money" | "count" | "weight"> = {
  delivery_count: "count",
  delivery_amount: "money",
  delivery_weight_kg: "weight",
  agent_sales_amount: "money",
  agent_order_count: "count",
  agent_visit_count: "count",
  agent_collected_amount: "money",
  cashier_receipt_count: "count",
  cashier_sales_amount: "money",
  warehouse_receipt_count: "count",
  warehouse_issue_count: "count",
};

/** Ko'rsatkich turiga mos yagona stavka turi — foydalanuvchi noto'g'ri juftlik yubormasin. */
export const rateTypeFor = (metric: KpiMetric): "percent" | "per_unit" =>
  METRIC_KIND[metric] === "money" ? "percent" : "per_unit";

/** Ko'rsatkich va stavka 4 xonali, pul 2 xonali. */
const VALUE_SCALE = 4;
const MONEY_SCALE = 2;

export type Tier = { fromValue: string; toValue: string | null; rate: string };

/**
 * Progressiv hisob. `value` — ko'rsatkich (4 xona), natija — pul (2 xona).
 * `percent` da stavka foiz (100 ga bo'linadi), `per_unit` da bir birlik uchun summa.
 */
export function tierAmount(value: bigint, tiers: Tier[], rateType: "percent" | "per_unit"): bigint {
  if (value <= 0n) return 0n;
  const ordered = [...tiers].sort((a, b) => (toMinor(a.fromValue, VALUE_SCALE) < toMinor(b.fromValue, VALUE_SCALE) ? -1 : 1));

  let total = 0n; // 4+4 = 8 xonali oraliq yig'indi
  for (const tier of ordered) {
    const from = toMinor(tier.fromValue, VALUE_SCALE);
    const to = tier.toValue === null ? null : toMinor(tier.toValue, VALUE_SCALE);
    if (value <= from) continue;
    const upper = to === null || to > value ? value : to;
    const span = upper - from;
    if (span <= 0n) continue;
    total += span * toMinor(tier.rate, VALUE_SCALE);
  }
  if (total === 0n) return 0n;

  // percent: (qiymat × foiz) / 100; per_unit: qiymat × stavka. Ikkalasi ham 8 xonadan 2 xonaga keltiriladi.
  const divisor = rateType === "percent" ? 100n : 1n;
  const scaleDown = 10n ** BigInt(VALUE_SCALE + VALUE_SCALE - MONEY_SCALE);
  const denominator = divisor * scaleDown;
  return (total * 2n + denominator) / (2n * denominator); // yarmi yuqoriga yaxlitlanadi
}

/** Oy chegaralari: "2026-09" → ["2026-09-01", "2026-10-01"). */
function monthRange(month: string) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw badRequest("Oy 'YYYY-MM' ko'rinishida bo'lishi kerak");
  const [year, mon] = month.split("-").map(Number) as [number, number];
  const start = `${month}-01`;
  const nextMonth = mon === 12 ? `${year + 1}-01` : `${year}-${String(mon + 1).padStart(2, "0")}`;
  return { start, next: `${nextMonth}-01` };
}

/** Xodimni ko'rsatkich manbalariga bog'laydigan identifikatorlar. */
export type EmployeeLinks = {
  employeeId: string;
  userId: string | null;
  salesRepId: string | null;
  deliveryAgentId: string | null;
};

/** Xodimlarning savdo agenti / yetkazuvchi profillarini bir so'rovda oladi. */
export async function employeeLinks(conn: DbOrTx, companyId: string, employeeIds: string[]): Promise<EmployeeLinks[]> {
  if (employeeIds.length === 0) return [];
  const rows = await conn
    .select({
      employeeId: employees.id,
      userId: employees.userId,
      salesRepId: salesReps.id,
      deliveryAgentId: deliveryAgents.id,
    })
    .from(employees)
    .leftJoin(salesReps, and(eq(salesReps.companyId, companyId), eq(salesReps.userId, employees.userId)))
    .leftJoin(deliveryAgents, and(eq(deliveryAgents.companyId, companyId), eq(deliveryAgents.employeeId, employees.id)))
    .where(and(eq(employees.companyId, companyId), inArray(employees.id, employeeIds)));
  return rows;
}

/** Yetkazma "bajarilgan" deb hisoblanadigan holatlar. */
const DELIVERED = ["delivered", "partially_delivered"] as const;

/**
 * Bitta ko'rsatkichning oylik qiymati (4 xonali bigint). Faqat SELECT.
 * Xodim tegishli profilga bog'lanmagan bo'lsa (masalan yetkazuvchi emas) — 0.
 */
export async function metricValue(
  conn: DbOrTx,
  companyId: string,
  links: EmployeeLinks,
  metric: KpiMetric,
  month: string,
): Promise<bigint> {
  const { start, next } = monthRange(month);
  const zero = 0n;

  switch (metric) {
    case "delivery_count":
    case "delivery_amount": {
      if (!links.deliveryAgentId) return zero;
      const [row] = await conn
        .select({
          count: sql<string>`count(*)::text`,
          amount: sql<string>`coalesce(sum(${salesOrders.totalAmount}), 0)::text`,
        })
        .from(deliveryTasks)
        .leftJoin(salesOrders, eq(salesOrders.id, deliveryTasks.orderId))
        .where(
          and(
            eq(deliveryTasks.companyId, companyId),
            eq(deliveryTasks.deliveryAgentId, links.deliveryAgentId),
            inArray(deliveryTasks.status, [...DELIVERED]),
            gte(deliveryTasks.scheduledDate, start),
            lt(deliveryTasks.scheduledDate, next),
          ),
        );
      const text = metric === "delivery_count" ? (row?.count ?? "0") : (row?.amount ?? "0");
      return toMinor(Number(text).toFixed(VALUE_SCALE), VALUE_SCALE);
    }

    case "delivery_weight_kg": {
      if (!links.deliveryAgentId) return zero;
      // Og'irlik mahsulot kartochkasidan; `g` grammda yozilgan bo'lsa kg ga keltiriladi
      const [row] = await conn
        .select({
          kg: sql<string>`coalesce(sum(${salesOrderItems.quantity} * ${products.weight} *
            case lower(coalesce(${products.weightUnit}, 'kg'))
              when 'g' then 0.001 when 'gramm' then 0.001
              when 't' then 1000 when 'tonna' then 1000
              else 1 end), 0)::text`,
        })
        .from(deliveryTasks)
        .innerJoin(salesOrderItems, eq(salesOrderItems.orderId, deliveryTasks.orderId))
        .innerJoin(products, eq(products.id, salesOrderItems.productId))
        .where(
          and(
            eq(deliveryTasks.companyId, companyId),
            eq(deliveryTasks.deliveryAgentId, links.deliveryAgentId),
            inArray(deliveryTasks.status, [...DELIVERED]),
            gte(deliveryTasks.scheduledDate, start),
            lt(deliveryTasks.scheduledDate, next),
          ),
        );
      return toMinor(Number(row?.kg ?? "0").toFixed(VALUE_SCALE), VALUE_SCALE);
    }

    case "agent_sales_amount":
    case "agent_order_count": {
      if (!links.salesRepId) return zero;
      const [row] = await conn
        .select({
          count: sql<string>`count(*)::text`,
          amount: sql<string>`coalesce(sum(${salesOrders.totalAmount}), 0)::text`,
        })
        .from(agentOrders)
        .innerJoin(salesOrders, eq(salesOrders.id, agentOrders.orderId))
        .where(
          and(
            eq(agentOrders.companyId, companyId),
            eq(agentOrders.salesRepId, links.salesRepId),
            gte(salesOrders.orderDate, start),
            lt(salesOrders.orderDate, next),
            // Bekor qilingan buyurtma KPI ga kirmaydi
            sql`${salesOrders.status} <> 'cancelled'`,
          ),
        );
      const text = metric === "agent_order_count" ? (row?.count ?? "0") : (row?.amount ?? "0");
      return toMinor(Number(text).toFixed(VALUE_SCALE), VALUE_SCALE);
    }

    case "agent_visit_count": {
      if (!links.salesRepId) return zero;
      const [row] = await conn
        .select({ count: sql<string>`count(*)::text` })
        .from(agentVisits)
        .where(
          and(
            eq(agentVisits.companyId, companyId),
            eq(agentVisits.salesRepId, links.salesRepId),
            eq(agentVisits.status, "completed"),
            gte(agentVisits.visitDate, start),
            lt(agentVisits.visitDate, next),
          ),
        );
      return toMinor(Number(row?.count ?? "0").toFixed(VALUE_SCALE), VALUE_SCALE);
    }

    case "agent_collected_amount": {
      if (!links.userId) return zero;
      const [row] = await conn
        .select({ amount: sql<string>`coalesce(sum(${customerPayments.amount}), 0)::text` })
        .from(customerPayments)
        .where(
          and(
            eq(customerPayments.companyId, companyId),
            eq(customerPayments.createdBy, links.userId),
            gte(customerPayments.paymentDate, start),
            lt(customerPayments.paymentDate, next),
          ),
        );
      return toMinor(Number(row?.amount ?? "0").toFixed(VALUE_SCALE), VALUE_SCALE);
    }

    case "cashier_receipt_count":
    case "cashier_sales_amount": {
      if (!links.userId) return zero;
      const [row] = await conn
        .select({
          count: sql<string>`count(*)::text`,
          amount: sql<string>`coalesce(sum(${salesOrders.totalAmount}), 0)::text`,
        })
        .from(salesOrders)
        .where(
          and(
            eq(salesOrders.companyId, companyId),
            eq(salesOrders.createdBy, links.userId),
            eq(salesOrders.source, "pos"),
            gte(salesOrders.orderDate, start),
            lt(salesOrders.orderDate, next),
            sql`${salesOrders.status} <> 'cancelled'`,
          ),
        );
      const text = metric === "cashier_receipt_count" ? (row?.count ?? "0") : (row?.amount ?? "0");
      return toMinor(Number(text).toFixed(VALUE_SCALE), VALUE_SCALE);
    }

    case "warehouse_receipt_count":
    case "warehouse_issue_count": {
      if (!links.userId) return zero;
      const kinds = metric === "warehouse_receipt_count" ? ["receive", "transfer_in"] : ["issue", "transfer_out", "write_off"];
      const [row] = await conn
        .select({ count: sql<string>`count(*)::text` })
        .from(stockMovements)
        .where(
          and(
            eq(stockMovements.companyId, companyId),
            eq(stockMovements.performedBy, links.userId),
            inArray(sql`${stockMovements.type}::text`, kinds),
            gte(stockMovements.occurredAt, new Date(start)),
            lt(stockMovements.occurredAt, new Date(next)),
          ),
        );
      return toMinor(Number(row?.count ?? "0").toFixed(VALUE_SCALE), VALUE_SCALE);
    }
  }
}

export type ResolvedRule = {
  ruleId: string;
  metric: KpiMetric;
  rateType: "percent" | "per_unit";
  /** PLAN: ko'rsatkich shundan kam bo'lsa pul hisoblanmaydi. `null` — chegara yo'q. */
  minValue: string | null;
  tiers: Tier[];
  /** Qoida lavozimdanmi yoki shu xodimga alohida yozilganmi. */
  source: "position" | "employee";
};

/**
 * Xodimlarga tegishli faol qoidalar. Xodimga alohida yozilgani lavozim qoidasining o'rniga qo'yiladi.
 * Natija: employeeId → qoidalar.
 */
export async function resolveRules(
  conn: DbOrTx,
  companyId: string,
  staff: { id: string; positionId: string | null }[],
): Promise<Map<string, ResolvedRule[]>> {
  const result = new Map<string, ResolvedRule[]>();
  if (staff.length === 0) return result;

  const positionIds = [...new Set(staff.map((row) => row.positionId).filter((id): id is string => id !== null))];
  const employeeIds = staff.map((row) => row.id);

  const rules = await conn
    .select({
      id: kpiRules.id,
      positionId: kpiRules.positionId,
      employeeId: kpiRules.employeeId,
      metric: kpiRules.metric,
      rateType: kpiRules.rateType,
      minValue: kpiRules.minValue,
    })
    .from(kpiRules)
    .where(
      and(
        eq(kpiRules.companyId, companyId),
        eq(kpiRules.isActive, true),
        // Xodimning o'z qoidasi YOKI lavozim qoidasi (lavozimsiz xodimlarda ikkinchisi bo'lmaydi)
        or(
          inArray(kpiRules.employeeId, employeeIds),
          ...(positionIds.length > 0 ? [inArray(kpiRules.positionId, positionIds)] : []),
        ),
      ),
    );
  if (rules.length === 0) return result;

  const tiers = await conn
    .select({
      ruleId: kpiRuleTiers.ruleId,
      fromValue: kpiRuleTiers.fromValue,
      toValue: kpiRuleTiers.toValue,
      rate: kpiRuleTiers.rate,
    })
    .from(kpiRuleTiers)
    .where(inArray(kpiRuleTiers.ruleId, rules.map((rule) => rule.id)));
  const tiersByRule = new Map<string, Tier[]>();
  for (const tier of tiers) {
    tiersByRule.set(tier.ruleId, [...(tiersByRule.get(tier.ruleId) ?? []), tier]);
  }

  for (const person of staff) {
    const byMetric = new Map<KpiMetric, ResolvedRule>();
    // Avval lavozim qoidalari, keyin xodimning o'ziniki — ikkinchisi birinchisini almashtiradi
    for (const rule of rules) {
      const matchesPosition = rule.positionId !== null && rule.positionId === person.positionId;
      const matchesEmployee = rule.employeeId !== null && rule.employeeId === person.id;
      if (!matchesPosition && !matchesEmployee) continue;
      const metric = rule.metric as KpiMetric;
      const existing = byMetric.get(metric);
      if (existing?.source === "employee" && matchesPosition) continue;
      byMetric.set(metric, {
        ruleId: rule.id,
        metric,
        rateType: rule.rateType,
        minValue: rule.minValue,
        tiers: tiersByRule.get(rule.id) ?? [],
        source: matchesEmployee ? "employee" : "position",
      });
    }
    if (byMetric.size > 0) result.set(person.id, [...byMetric.values()]);
  }
  return result;
}

export type KpiLine = { metric: KpiMetric; metricValue: string; amount: string; ruleId: string };
export type KpiResult = { total: string; lines: KpiLine[] };

/** Bitta xodimning oylik KPI'si. Qoida bo'lmasa — 0 va bo'sh ro'yxat. */
export async function computeKpi(
  conn: DbOrTx,
  companyId: string,
  links: EmployeeLinks,
  rules: ResolvedRule[],
  month: string,
): Promise<KpiResult> {
  const lines: KpiLine[] = [];
  let total = 0n;
  for (const rule of rules) {
    if (rule.tiers.length === 0) continue;
    const value = await metricValue(conn, companyId, links, rule.metric, month);
    // PLAN bajarilmadi — qoida bo'yicha pul yo'q (ko'rsatkichning o'zi hisobotda ko'rinib turadi)
    const planMet = rule.minValue === null || value >= toMinor(rule.minValue, VALUE_SCALE);
    const amount = planMet ? tierAmount(value, rule.tiers, rule.rateType) : 0n;
    if (amount === 0n && value === 0n) continue;
    total += amount;
    lines.push({
      metric: rule.metric,
      metricValue: fromMinor(value, VALUE_SCALE),
      amount: fromMinor(amount, MONEY_SCALE),
      ruleId: rule.ruleId,
    });
  }
  return { total: fromMinor(total, MONEY_SCALE), lines };
}
