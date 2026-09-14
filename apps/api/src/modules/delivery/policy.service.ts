/**
 * Dostavka siyosati — `settings` jadvalida JSON (`delivery.policy`, guruh `delivery`).
 * O'qish: yetkazuvchi agent (geofence, kuzatuv, tasdiqlash usullari) va boshqaruvchi; saqlash — `delivery.manage`.
 * Saqlangan qiymat standart bilan birlashtiriladi (ichki `autoAssign` ham — yangi maydon qo'shilsa eski sozlama
 * yo'qolmaydi); buzilgan JSON — standart qiymat. Saqlanganda real-time `policy` hodisasi.
 */
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  DEFAULT_DELIVERY_POLICY,
  DELIVERY_AUTO_ASSIGN_LIMITS,
  DELIVERY_AUTO_ASSIGN_STRATEGIES,
  DELIVERY_COLLECTION_METHODS,
  DELIVERY_MISMATCH_POLICIES,
  DELIVERY_POLICY_LIMITS,
  badRequest,
  type DeliveryAutoAssignPolicy,
  type DeliveryPolicy,
} from "@bum/shared";
import { companyMembers, settings } from "../../db/schema/platform.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import type { RequestMeta } from "../../shared/audit.js";
import { upsertCompanySetting } from "../company/settings.service.js";
import type { TenantContext } from "../company/tenant.js";
import { publishDeliveryEvent } from "./realtime-bus.js";

export const DELIVERY_POLICY_KEY = "delivery.policy";

const bounded = (key: keyof typeof DELIVERY_POLICY_LIMITS) => {
  const [min, max] = DELIVERY_POLICY_LIMITS[key];
  return z.number().int().min(min).max(max);
};

const autoBounded = (key: keyof typeof DELIVERY_AUTO_ASSIGN_LIMITS) => {
  const [min, max] = DELIVERY_AUTO_ASSIGN_LIMITS[key];
  return z.number().int().min(min).max(max);
};

const recipientList = z
  .array(z.uuid())
  .max(50)
  .transform((ids) => [...new Set(ids)]);

const autoAssignShape = {
  enabled: z.boolean(),
  onCreate: z.boolean(),
  strategy: z.enum(DELIVERY_AUTO_ASSIGN_STRATEGIES),
  maxTasksPerAgent: autoBounded("maxTasksPerAgent"),
  maxDistanceKm: autoBounded("maxDistanceKm"),
  respectSchedule: z.boolean(),
  requireOnDuty: z.boolean(),
  respectCapacity: z.boolean(),
  respectBranch: z.boolean(),
} satisfies Record<keyof DeliveryAutoAssignPolicy, z.ZodType>;

const policyShape = {
  geofenceRadiusMeters: bounded("geofenceRadiusMeters"),
  maxAccuracyMeters: bounded("maxAccuracyMeters"),
  maxLocationAgeSeconds: bounded("maxLocationAgeSeconds"),
  trackingIntervalSeconds: bounded("trackingIntervalSeconds"),
  trackingDistanceMeters: bounded("trackingDistanceMeters"),
  maxJumpSpeedKmh: bounded("maxJumpSpeedKmh"),
  locationRetentionDays: bounded("locationRetentionDays"),
  deliveryRequiredByDefault: z.boolean(),
  collectOnDelivery: z.boolean(),
  collectionMethods: z
    .array(z.enum(DELIVERY_COLLECTION_METHODS))
    .min(1)
    .max(DELIVERY_COLLECTION_METHODS.length)
    .refine((methods) => new Set(methods).size === methods.length, "To'lov usuli takrorlangan"),
  requireCustomerLocation: z.boolean(),
  confirmation: z.strictObject({ otp: z.boolean(), signature: z.boolean(), photo: z.boolean() }),
  otpTtlMinutes: bounded("otpTtlMinutes"),
  otpMaxAttempts: bounded("otpMaxAttempts"),
  mismatchPolicy: z.enum(DELIVERY_MISMATCH_POLICIES),
  offlineActionsAllowed: z.boolean(),
  offlineMaxAgeHours: bounded("offlineMaxAgeHours"),
  geofenceAlerts: z.boolean(),
  notificationRecipients: z.strictObject({ failed: recipientList, mismatch: recipientList, geofence: recipientList }),
  autoAssign: z.strictObject(autoAssignShape),
} satisfies Record<keyof DeliveryPolicy, z.ZodType>;

export const deliveryPolicySchema = z.strictObject(policyShape);
const storedPolicySchema = z.object({ ...policyShape, autoAssign: z.object(autoAssignShape).partial() }).partial();

export async function getDeliveryPolicy(conn: DbOrTx, companyId: string): Promise<DeliveryPolicy> {
  const [row] = await conn
    .select({ value: settings.value })
    .from(settings)
    .where(and(eq(settings.companyId, companyId), eq(settings.key, DELIVERY_POLICY_KEY)))
    .limit(1);
  if (!row) return DEFAULT_DELIVERY_POLICY;
  let json: unknown;
  try {
    json = JSON.parse(row.value);
  } catch {
    return DEFAULT_DELIVERY_POLICY;
  }
  const stored = storedPolicySchema.safeParse(json);
  if (!stored.success) return DEFAULT_DELIVERY_POLICY;
  const merged = deliveryPolicySchema.safeParse({
    ...DEFAULT_DELIVERY_POLICY,
    ...stored.data,
    autoAssign: { ...DEFAULT_DELIVERY_POLICY.autoAssign, ...stored.data.autoAssign },
  });
  return merged.success ? merged.data : DEFAULT_DELIVERY_POLICY;
}

export async function saveDeliveryPolicy(tx: Tx, tenant: TenantContext, input: DeliveryPolicy, meta: RequestMeta) {
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
    { key: DELIVERY_POLICY_KEY, value: JSON.stringify(input), group: "delivery", description: "Dostavka siyosati" },
    meta,
  );
  await publishDeliveryEvent(tx, { type: "policy", companyId: tenant.company.id });
  return input;
}
