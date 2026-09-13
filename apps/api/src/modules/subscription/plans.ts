/** Tariflar — faqat bazadan (narx, muddat, bonus kodga yozilmaydi). */
import { and, asc, eq } from "drizzle-orm";
import { badRequest, effectiveMonths, type SubscriptionPlanKind } from "@bum/shared";
import { subscriptionPlans } from "../../db/schema/subscription.js";
import type { DbOrTx } from "../../db/transaction.js";

export type PlanRow = typeof subscriptionPlans.$inferSelect;

export const planView = (plan: PlanRow) => ({
  id: plan.id,
  code: plan.code,
  kind: plan.kind,
  name: plan.name,
  price: plan.price,
  currency: plan.currency,
  durationMonths: plan.durationMonths,
  bonusMonths: plan.bonusMonths,
  effectiveMonths: effectiveMonths(plan),
  includedLicenses: plan.includedLicenses,
});

export async function listActivePlans(conn: DbOrTx) {
  const rows = await conn
    .select()
    .from(subscriptionPlans)
    .where(eq(subscriptionPlans.isActive, true))
    .orderBy(asc(subscriptionPlans.sortOrder), asc(subscriptionPlans.durationMonths));
  return {
    main: rows.filter((plan) => plan.kind === "main").map(planView),
    additional: rows.filter((plan) => plan.kind === "additional_license").map(planView),
  };
}

export async function loadActivePlan(conn: DbOrTx, planId: string, kind: SubscriptionPlanKind): Promise<PlanRow> {
  const [plan] = await conn
    .select()
    .from(subscriptionPlans)
    .where(and(eq(subscriptionPlans.id, planId), eq(subscriptionPlans.kind, kind), eq(subscriptionPlans.isActive, true)))
    .limit(1);
  if (!plan) throw badRequest(kind === "main" ? "Obuna tarifi topilmadi yoki faol emas" : "Qo'shimcha litsenziya tarifi topilmadi yoki faol emas");
  return plan;
}

/** Tasdiqlashda — tarif keyinroq nofaol qilingan bo'lsa ham so'rov paytidagi tarif bo'yicha. */
export async function loadPlan(conn: DbOrTx, planId: string): Promise<PlanRow> {
  const [plan] = await conn.select().from(subscriptionPlans).where(eq(subscriptionPlans.id, planId)).limit(1);
  if (!plan) throw badRequest("Tarif topilmadi");
  return plan;
}
