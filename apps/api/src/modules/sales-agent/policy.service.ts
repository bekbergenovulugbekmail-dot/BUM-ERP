/**
 * Sotuv agenti siyosati — `settings` jadvalida JSON (`sales_agent.policy`, guruh `sales_agent`).
 * O'qish: agent (kuzatuv oralig'i, geofence) va supervayzer; saqlash — `sales_agent.supervise`.
 * Saqlangan qiymat standart bilan birlashtiriladi; buzilgan JSON — standart qiymat.
 */
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { DEFAULT_SALES_AGENT_POLICY, SALES_AGENT_POLICY_LIMITS, badRequest, type SalesAgentPolicy } from "@bum/shared";
import { companyMembers, roles, settings, users } from "../../db/schema/platform.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import type { RequestMeta } from "../../shared/audit.js";
import { upsertCompanySetting } from "../company/settings.service.js";
import type { TenantContext } from "../company/tenant.js";

export const SALES_AGENT_POLICY_KEY = "sales_agent.policy";

const bounded = (key: keyof typeof SALES_AGENT_POLICY_LIMITS) => {
  const [min, max] = SALES_AGENT_POLICY_LIMITS[key];
  return z.number().int().min(min).max(max);
};

const recipientList = z
  .array(z.uuid())
  .max(50)
  .transform((ids) => [...new Set(ids)]);

const policyShape = {
  geofenceRadiusMeters: bounded("geofenceRadiusMeters"),
  maxAccuracyMeters: bounded("maxAccuracyMeters"),
  maxLocationAgeSeconds: bounded("maxLocationAgeSeconds"),
  trackingIntervalSeconds: bounded("trackingIntervalSeconds"),
  maxJumpSpeedKmh: bounded("maxJumpSpeedKmh"),
  locationRetentionDays: bounded("locationRetentionDays"),
  minVisitMinutes: bounded("minVisitMinutes"),
  storefrontPhotoRequired: z.boolean(),
  shelfPhotoRequired: z.boolean(),
  visitExitPolicy: z.enum(["pause", "invalidate", "flag"]),
  orderRequiresVisit: z.boolean(),
  deliveryDateMode: z.enum(["assigned", "choose"]),
  maxDeliveryDays: bounded("maxDeliveryDays"),
  creditDueDateRequired: z.boolean(),
  creditLimitPolicy: z.enum(["block", "approval"]),
  notificationRecipients: z.strictObject({ geofence: recipientList, approval: recipientList, creditLimit: recipientList }),
} satisfies Record<keyof SalesAgentPolicy, z.ZodType>;

export const salesAgentPolicySchema = z.strictObject(policyShape);
const storedPolicySchema = z.object(policyShape).partial();

export async function getSalesAgentPolicy(conn: DbOrTx, companyId: string): Promise<SalesAgentPolicy> {
  const [row] = await conn
    .select({ value: settings.value })
    .from(settings)
    .where(and(eq(settings.companyId, companyId), eq(settings.key, SALES_AGENT_POLICY_KEY)))
    .limit(1);
  if (!row) return DEFAULT_SALES_AGENT_POLICY;
  let json: unknown;
  try {
    json = JSON.parse(row.value);
  } catch {
    return DEFAULT_SALES_AGENT_POLICY;
  }
  const stored = storedPolicySchema.safeParse(json);
  if (!stored.success) return DEFAULT_SALES_AGENT_POLICY;
  const merged = salesAgentPolicySchema.safeParse({ ...DEFAULT_SALES_AGENT_POLICY, ...stored.data });
  return merged.success ? merged.data : DEFAULT_SALES_AGENT_POLICY;
}

/** Bildirishnoma oluvchi sifatida tanlash mumkin bo'lganlar — kompaniyaning faol a'zolari. */
export async function recipientCandidates(conn: DbOrTx, companyId: string) {
  return conn
    .select({ userId: users.id, name: users.name, role: sql<string>`coalesce(${roles.name}, ${companyMembers.companyRole})` })
    .from(companyMembers)
    .innerJoin(users, eq(users.id, companyMembers.userId))
    .leftJoin(roles, eq(roles.id, companyMembers.roleId))
    .where(and(eq(companyMembers.companyId, companyId), eq(companyMembers.isActive, true), eq(users.isActive, true)))
    .orderBy(asc(users.name));
}

export async function saveSalesAgentPolicy(tx: Tx, tenant: TenantContext, input: SalesAgentPolicy, meta: RequestMeta) {
  const chosen = [...new Set(Object.values(input.notificationRecipients).flat())];
  if (chosen.length > 0) {
    const members = await tx
      .select({ userId: companyMembers.userId })
      .from(companyMembers)
      .where(and(eq(companyMembers.companyId, tenant.company.id), eq(companyMembers.isActive, true), inArray(companyMembers.userId, chosen)));
    if (members.length !== chosen.length) throw badRequest("Bildirishnoma oluvchi kompaniyaning faol a'zosi emas", { reason: "recipient_invalid" });
  }
  await upsertCompanySetting(
    tx,
    tenant,
    { key: SALES_AGENT_POLICY_KEY, value: JSON.stringify(input), group: "sales_agent", description: "Sotuv agenti siyosati" },
    meta,
  );
  return input;
}
