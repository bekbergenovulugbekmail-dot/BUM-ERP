/**
 * Kompaniya obunasi: 25 kunlik trial, tarif sotib olish so'rovi, platforma admini tasdig'i (faollashtirish /
 * uzaytirish), muddat tugashi, trial ogohlantirishlari, tarix.
 *
 *  - Vaqt — faqat server soati; qurilma yoki so'rovdagi sanaga ishonilmaydi.
 *  - Uzaytirish (`renewalWindow`): amaldagi to'langan obuna / litsenziya — joriy tugash sanasidan; trial, tugagan yoki
 *    tizimdan oldingi muddatsiz obuna — hozirdan. Muddat = asosiy oylar + bonus.
 *  - Ogohlantirish: trial ham, qo'shimcha (pullik) litsenziya ham tugashiga 10/5/3/1 kun qolganda kompaniya egasiga
 *    bildirishnoma; har chegara bir marta (`trial_warning_days` / `licenses.warning_days`), uzaytirilganda qaytadan.
 *  - To'lov shlyuzi yo'q: egasi so'rov yuboradi, admin to'lovni tasdiqlaydi. Tasdiq: to'lov + obuna/litsenziya + tarix +
 *    audit — bitta tranzaksiyada, to'lov qatori qulflangan; takroriy tasdiq hech narsani ikki marta qo'llamaydi.
 */
import { and, desc, eq, gt, inArray, isNotNull, lte, sql } from "drizzle-orm";
import {
  LICENSE_WARNING_DAYS,
  TRIAL_DAYS,
  TRIAL_INCLUDED_LICENSES,
  badRequest,
  conflict,
  daysLeft,
  effectiveMonths,
  effectiveSubscriptionStatus,
  licenseWarning,
  notFound,
  renewalWindow,
  trialWarning,
  type SubscriptionPaymentStatus,
} from "@bum/shared";
import { notifications } from "../../db/schema/notifications.js";
import { companies, users } from "../../db/schema/platform.js";
import {
  licenseHistory,
  licenses,
  subscriptionHistory,
  subscriptionPayments,
  subscriptionPlans,
  subscriptions,
} from "../../db/schema/subscription.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import { writeAuditLog, type RequestMeta } from "../../shared/audit.js";
import {
  assignLicense,
  auditLicense,
  licenseCounts,
  listLicenses,
  lockSubscription,
  writeLicenseHistory,
  type Actor,
  type PaymentRow,
  type SubscriptionRow,
} from "./license.service.js";
import { loadActivePlan, loadPlan, type PlanRow } from "./plans.js";

const DAY_MS = 86_400_000;

async function writeSubscriptionHistory(
  tx: Tx,
  subscription: SubscriptionRow,
  event: string,
  extra: {
    plan?: PlanRow | null;
    price?: string;
    startAt?: Date | null;
    expiresAt?: Date | null;
    paymentId?: string | null;
    paymentReference?: string | null;
    createdBy?: string | null;
  } = {},
): Promise<void> {
  const plan = extra.plan ?? null;
  await tx.insert(subscriptionHistory).values({
    companyId: subscription.companyId,
    subscriptionId: subscription.id,
    event,
    status: subscription.status,
    planId: plan?.id ?? null,
    planName: plan?.name ?? null,
    price: extra.price ?? "0",
    durationMonths: plan?.durationMonths ?? 0,
    bonusMonths: plan?.bonusMonths ?? 0,
    effectiveMonths: plan ? effectiveMonths(plan) : 0,
    startAt: extra.startAt === undefined ? subscription.startAt : extra.startAt,
    expiresAt: extra.expiresAt === undefined ? subscription.expiresAt : extra.expiresAt,
    includedLicenses: subscription.includedLicenses,
    paymentId: extra.paymentId ?? null,
    paymentReference: extra.paymentReference ?? null,
    createdBy: extra.createdBy ?? null,
  });
}

function auditSubscription(
  tx: Tx,
  actor: Actor,
  meta: RequestMeta | undefined,
  companyId: string,
  action: string,
  resourceId: string,
  details: Record<string, unknown>,
  severity: "info" | "warning" = "info",
): Promise<void> {
  return writeAuditLog(
    {
      companyId,
      userId: actor?.id ?? null,
      userName: actor?.name ?? null,
      action,
      resource: "subscriptions",
      resourceId,
      severity,
      details,
      ...(meta ?? {}),
    },
    tx,
  );
}

export const trialEndFrom = (now: Date) => new Date(now.getTime() + TRIAL_DAYS * DAY_MS);

/** Yangi kompaniya: 25 kunlik trial, 3 included litsenziya, egasiga birinchisi. */
export async function startTrial(
  tx: Tx,
  input: { companyId: string; ownerId: string; actor: Actor; meta?: RequestMeta; now: Date; trialEndsAt: Date },
): Promise<SubscriptionRow> {
  const [subscription] = await tx
    .insert(subscriptions)
    .values({
      companyId: input.companyId,
      status: "trial",
      startAt: input.now,
      expiresAt: input.trialEndsAt,
      includedLicenses: TRIAL_INCLUDED_LICENSES,
    })
    .returning();
  await writeSubscriptionHistory(tx, subscription!, "trial_started", { createdBy: input.actor?.id });
  await auditSubscription(tx, input.actor, input.meta, input.companyId, "TRIAL_CREATED", subscription!.id, {
    days: TRIAL_DAYS,
    expiresAt: input.trialEndsAt.toISOString(),
    includedLicenses: TRIAL_INCLUDED_LICENSES,
  });
  await assignLicense(tx, { companyId: input.companyId, userId: input.ownerId, actor: input.actor, meta: input.meta, now: input.now });
  return subscription!;
}

// ─── O'qish ──────────────────────────────────────────────────────────────────

const paymentColumns = {
  id: subscriptionPayments.id,
  companyId: subscriptionPayments.companyId,
  kind: subscriptionPayments.kind,
  planId: subscriptionPayments.planId,
  planName: subscriptionPlans.name,
  planCode: subscriptionPlans.code,
  licenseId: subscriptionPayments.licenseId,
  amount: subscriptionPayments.amount,
  currency: subscriptionPayments.currency,
  status: subscriptionPayments.status,
  reference: subscriptionPayments.reference,
  note: subscriptionPayments.note,
  requestedBy: subscriptionPayments.requestedBy,
  confirmedAt: subscriptionPayments.confirmedAt,
  cancelledAt: subscriptionPayments.cancelledAt,
  createdAt: subscriptionPayments.createdAt,
  licenseUserName: sql<string | null>`(select u."name" from "licenses" l join "users" u on u."id" = l."user_id" where l."id" = ${subscriptionPayments.licenseId})`,
  licenseUserPhone: sql<string | null>`(select u."phone" from "licenses" l join "users" u on u."id" = l."user_id" where l."id" = ${subscriptionPayments.licenseId})`,
};

export async function subscriptionOverview(conn: DbOrTx, companyId: string, now = new Date()) {
  const [row] = await conn
    .select({ subscription: subscriptions, planName: subscriptionPlans.name, planCode: subscriptionPlans.code })
    .from(subscriptions)
    .leftJoin(subscriptionPlans, eq(subscriptionPlans.id, subscriptions.planId))
    .where(eq(subscriptions.companyId, companyId))
    .limit(1);
  if (!row) return { subscription: null, licenses: null, pendingPayments: [] };

  const sub = row.subscription;
  const status = effectiveSubscriptionStatus(sub, now);
  const pendingPayments = await conn
    .select(paymentColumns)
    .from(subscriptionPayments)
    .innerJoin(subscriptionPlans, eq(subscriptionPlans.id, subscriptionPayments.planId))
    .where(and(eq(subscriptionPayments.companyId, companyId), eq(subscriptionPayments.status, "pending")))
    .orderBy(desc(subscriptionPayments.createdAt));

  return {
    subscription: {
      id: sub.id,
      status,
      /** Trialdan tugagan (true) yoki to'langan obuna tugagan — ekrandagi matn uchun. */
      isTrial: sub.status === "trial",
      planId: sub.planId,
      planCode: row.planCode,
      planName: row.planName,
      startAt: sub.startAt,
      expiresAt: sub.expiresAt,
      baseDurationMonths: sub.baseDurationMonths,
      bonusMonths: sub.bonusMonths,
      effectiveMonths: sub.baseDurationMonths + sub.bonusMonths,
      includedLicenses: sub.includedLicenses,
      daysLeft: daysLeft(sub.expiresAt, now),
      trialWarning: trialWarning(status, sub.expiresAt, now),
    },
    licenses: await licenseCounts(conn, companyId, sub.includedLicenses, now),
    pendingPayments,
  };
}

export function listPayments(conn: DbOrTx, filter: { companyId?: string; status?: SubscriptionPaymentStatus; limit: number }) {
  return conn
    .select({ ...paymentColumns, companyName: companies.name })
    .from(subscriptionPayments)
    .innerJoin(subscriptionPlans, eq(subscriptionPlans.id, subscriptionPayments.planId))
    .innerJoin(companies, eq(companies.id, subscriptionPayments.companyId))
    .where(
      and(
        filter.companyId ? eq(subscriptionPayments.companyId, filter.companyId) : undefined,
        filter.status ? eq(subscriptionPayments.status, filter.status) : undefined,
      ),
    )
    .orderBy(desc(subscriptionPayments.createdAt))
    .limit(filter.limit);
}

export async function listHistory(conn: DbOrTx, companyId: string, limit: number) {
  const [subscriptionRows, licenseRows] = await Promise.all([
    conn
      .select({
        id: subscriptionHistory.id,
        event: subscriptionHistory.event,
        status: subscriptionHistory.status,
        planName: subscriptionHistory.planName,
        price: subscriptionHistory.price,
        durationMonths: subscriptionHistory.durationMonths,
        bonusMonths: subscriptionHistory.bonusMonths,
        effectiveMonths: subscriptionHistory.effectiveMonths,
        startAt: subscriptionHistory.startAt,
        expiresAt: subscriptionHistory.expiresAt,
        includedLicenses: subscriptionHistory.includedLicenses,
        paymentReference: subscriptionHistory.paymentReference,
        createdAt: subscriptionHistory.createdAt,
        createdByName: users.name,
      })
      .from(subscriptionHistory)
      .leftJoin(users, eq(users.id, subscriptionHistory.createdBy))
      .where(eq(subscriptionHistory.companyId, companyId))
      .orderBy(desc(subscriptionHistory.createdAt))
      .limit(limit),
    conn
      .select({
        id: licenseHistory.id,
        licenseId: licenseHistory.licenseId,
        event: licenseHistory.event,
        licenseType: licenseHistory.licenseType,
        status: licenseHistory.status,
        planName: licenseHistory.planName,
        price: licenseHistory.price,
        startAt: licenseHistory.startAt,
        expiresAt: licenseHistory.expiresAt,
        createdAt: licenseHistory.createdAt,
        userName: sql<string | null>`(select u."name" from "users" u where u."id" = ${licenseHistory.userId})`,
        userPhone: sql<string | null>`(select u."phone" from "users" u where u."id" = ${licenseHistory.userId})`,
        employeeName: sql<string | null>`(select e."name" from "employees" e where e."id" = ${licenseHistory.employeeId})`,
        actorName: sql<string | null>`(select u."name" from "users" u where u."id" = ${licenseHistory.actorId})`,
      })
      .from(licenseHistory)
      .where(eq(licenseHistory.companyId, companyId))
      .orderBy(desc(licenseHistory.createdAt))
      .limit(limit),
  ]);
  return { subscriptions: subscriptionRows, licenses: licenseRows };
}

/** Platforma admini: kompaniya obunasi to'liq — holat, litsenziyalar, tarix, to'lovlar. */
export async function companySubscriptionDetails(conn: DbOrTx, companyId: string) {
  const [company] = await conn
    .select({ id: companies.id, name: companies.name, ownerId: companies.ownerId })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);
  if (!company) throw notFound("Kompaniya topilmadi");
  const overview = await subscriptionOverview(conn, companyId);
  return {
    company: { id: company.id, name: company.name },
    ...overview,
    licenseList: await listLicenses(conn, companyId, company.ownerId),
    history: await listHistory(conn, companyId, 100),
    payments: await listPayments(conn, { companyId, limit: 100 }),
  };
}

// ─── To'lov so'rovlari (kompaniya egasi) ─────────────────────────────────────

type Requester = { companyId: string; actor: Actor };

async function findByIdempotencyKey(tx: Tx, companyId: string, key: string): Promise<PaymentRow | null> {
  const [row] = await tx
    .select()
    .from(subscriptionPayments)
    .where(and(eq(subscriptionPayments.companyId, companyId), eq(subscriptionPayments.idempotencyKey, key)))
    .limit(1);
  return row ?? null;
}

/** Asosiy tarifga to'lov so'rovi. Oldingi kutilayotgan obuna so'rovi yangisi bilan almashtiriladi. */
export async function requestSubscriptionPurchase(
  tx: Tx,
  requester: Requester,
  input: { planId: string; idempotencyKey: string },
  meta: RequestMeta,
  now = new Date(),
): Promise<{ payment: PaymentRow; duplicate: boolean }> {
  // Qulf — bir xil kalit bilan parallel so'rovlar ham bitta to'lov yaratadi
  await lockSubscription(tx, requester.companyId);
  const existing = await findByIdempotencyKey(tx, requester.companyId, input.idempotencyKey);
  if (existing) {
    if (existing.kind !== "subscription" || existing.planId !== input.planId) throw conflict("Bu so'rov kaliti boshqa to'lov uchun ishlatilgan");
    return { payment: existing, duplicate: true };
  }

  const plan = await loadActivePlan(tx, input.planId, "main");
  await tx
    .update(subscriptionPayments)
    .set({ status: "cancelled", cancelledAt: now, updatedAt: now, note: "Yangi so'rov bilan almashtirildi" })
    .where(
      and(
        eq(subscriptionPayments.companyId, requester.companyId),
        eq(subscriptionPayments.kind, "subscription"),
        eq(subscriptionPayments.status, "pending"),
      ),
    );
  const [payment] = await tx
    .insert(subscriptionPayments)
    .values({
      companyId: requester.companyId,
      kind: "subscription",
      planId: plan.id,
      amount: plan.price,
      currency: plan.currency,
      idempotencyKey: input.idempotencyKey,
      requestedBy: requester.actor?.id ?? null,
    })
    .returning();
  await auditSubscription(tx, requester.actor, meta, requester.companyId, "SUBSCRIPTION_PAYMENT_REQUESTED", payment!.id, {
    planCode: plan.code,
    amount: plan.price,
    effectiveMonths: effectiveMonths(plan),
  });
  return { payment: payment!, duplicate: false };
}

/** Qo'shimcha litsenziyaga to'lov so'rovi: kutilayotganini to'lash yoki amaldagi/tugaganini uzaytirish. */
export async function requestLicensePurchase(
  tx: Tx,
  requester: Requester,
  input: { licenseId: string; planId: string; idempotencyKey: string },
  meta: RequestMeta,
  now = new Date(),
): Promise<{ payment: PaymentRow; duplicate: boolean }> {
  await lockSubscription(tx, requester.companyId);
  const existing = await findByIdempotencyKey(tx, requester.companyId, input.idempotencyKey);
  if (existing) {
    if (existing.kind !== "license" || existing.licenseId !== input.licenseId || existing.planId !== input.planId) {
      throw conflict("Bu so'rov kaliti boshqa to'lov uchun ishlatilgan");
    }
    return { payment: existing, duplicate: true };
  }

  const [license] = await tx
    .select()
    .from(licenses)
    .where(and(eq(licenses.id, input.licenseId), eq(licenses.companyId, requester.companyId)))
    .limit(1)
    .for("update");
  // Boshqa kompaniya litsenziyasi ham "topilmadi"
  if (!license) throw notFound("Litsenziya topilmadi");
  if (license.status === "revoked") throw conflict("Litsenziya bekor qilingan");
  if (license.licenseType === "included") throw badRequest("Included litsenziya obuna bilan birga uzaytiriladi");

  const plan = await loadActivePlan(tx, input.planId, "additional_license");
  await tx
    .update(subscriptionPayments)
    .set({ status: "cancelled", cancelledAt: now, updatedAt: now, note: "Yangi so'rov bilan almashtirildi" })
    .where(and(eq(subscriptionPayments.licenseId, license.id), eq(subscriptionPayments.status, "pending")));
  if (license.status === "pending_payment") {
    await tx.update(licenses).set({ planId: plan.id, price: plan.price, updatedAt: now }).where(eq(licenses.id, license.id));
  }
  const [payment] = await tx
    .insert(subscriptionPayments)
    .values({
      companyId: requester.companyId,
      kind: "license",
      planId: plan.id,
      licenseId: license.id,
      amount: plan.price,
      currency: plan.currency,
      idempotencyKey: input.idempotencyKey,
      requestedBy: requester.actor?.id ?? null,
    })
    .returning();
  await auditLicense(tx, requester.actor, meta, "LICENSE_PAYMENT_REQUESTED", license, {
    planCode: plan.code,
    amount: plan.price,
    paymentId: payment!.id,
  });
  return { payment: payment!, duplicate: false };
}

/** `companyId` berilsa — faqat o'sha kompaniya to'lovi (egasi); `null` — platforma admini. */
export async function cancelPayment(
  tx: Tx,
  scope: {
    companyId: string | null;
    actor: Actor;
    /** Kompaniya yo'li: to'lov turiga qarab ruxsat (litsenziya — `license.manage`, tarif — `subscription.manage`). */
    authorizeKind?: (kind: PaymentRow["kind"]) => Promise<void>;
  },
  paymentId: string,
  meta: RequestMeta,
  now = new Date(),
): Promise<PaymentRow> {
  const [payment] = await tx
    .select()
    .from(subscriptionPayments)
    .where(and(eq(subscriptionPayments.id, paymentId), scope.companyId ? eq(subscriptionPayments.companyId, scope.companyId) : undefined))
    .limit(1)
    .for("update");
  if (!payment) throw notFound("To'lov so'rovi topilmadi");
  if (scope.authorizeKind) await scope.authorizeKind(payment.kind);
  if (payment.status === "paid") throw conflict("Tasdiqlangan to'lovni bekor qilib bo'lmaydi");
  if (payment.status === "cancelled") return payment;

  const [cancelled] = await tx
    .update(subscriptionPayments)
    .set({ status: "cancelled", cancelledAt: now, updatedAt: now })
    .where(eq(subscriptionPayments.id, payment.id))
    .returning();
  await auditSubscription(tx, scope.actor, meta, payment.companyId, "SUBSCRIPTION_PAYMENT_CANCELLED", payment.id, {
    kind: payment.kind,
    amount: payment.amount,
    by: scope.companyId ? "company" : "platform_admin",
  });
  return cancelled!;
}

// ─── Tasdiqlash (platforma admini) ───────────────────────────────────────────

export async function confirmPayment(
  tx: Tx,
  admin: NonNullable<Actor>,
  paymentId: string,
  input: { reference?: string | null },
  meta: RequestMeta,
  now = new Date(),
): Promise<{ payment: PaymentRow; duplicate: boolean }> {
  const [payment] = await tx.select().from(subscriptionPayments).where(eq(subscriptionPayments.id, paymentId)).limit(1).for("update");
  if (!payment) throw notFound("To'lov so'rovi topilmadi");
  // Takroriy tasdiq — hech narsa ikki marta qo'llanmaydi
  if (payment.status === "paid") return { payment, duplicate: true };
  if (payment.status === "cancelled") throw conflict("Bekor qilingan to'lovni tasdiqlab bo'lmaydi");

  const plan = await loadPlan(tx, payment.planId);
  const months = effectiveMonths(plan);
  const reference = input.reference?.trim() || null;

  if (payment.kind === "subscription") {
    const subscription = await lockSubscription(tx, payment.companyId);
    const current = effectiveSubscriptionStatus(subscription, now);
    // Amaldagi to'langan obuna — tugash sanasidan; trial, tugagan va muddatsiz — hozirdan
    const continuing = subscription.status === "active" && current === "active" && subscription.expiresAt !== null;
    const window = renewalWindow(subscription.expiresAt, continuing, now, months);
    const [updated] = await tx
      .update(subscriptions)
      .set({
        planId: plan.id,
        status: "active",
        startAt: continuing ? subscription.startAt : window.startAt,
        baseDurationMonths: plan.durationMonths,
        bonusMonths: plan.bonusMonths,
        expiresAt: window.expiresAt,
        includedLicenses: Math.max(subscription.includedLicenses, plan.includedLicenses),
        trialWarningDays: null,
        cancelledAt: null,
        updatedAt: now,
      })
      .where(eq(subscriptions.id, subscription.id))
      .returning();
    await writeSubscriptionHistory(tx, updated!, continuing ? "renewed" : "activated", {
      plan,
      price: payment.amount,
      startAt: window.startAt,
      expiresAt: window.expiresAt,
      paymentId: payment.id,
      paymentReference: reference,
      createdBy: admin.id,
    });
    // Kompaniya holati: trial → active (to'xtatilgan/tugatilgan holatga tegilmaydi — u platforma admini qarori)
    await tx
      .update(companies)
      .set({ status: "active", trialEndsAt: null, updatedAt: now })
      .where(and(eq(companies.id, payment.companyId), inArray(companies.status, ["trial", "pending"])));
    await auditSubscription(tx, admin, meta, payment.companyId, continuing ? "SUBSCRIPTION_RENEWED" : "SUBSCRIPTION_CREATED", subscription.id, {
      planCode: plan.code,
      from: current,
      startAt: window.startAt.toISOString(),
      expiresAt: window.expiresAt.toISOString(),
      effectiveMonths: months,
      paymentId: payment.id,
    });
  } else {
    const [license] = payment.licenseId
      ? await tx.select().from(licenses).where(eq(licenses.id, payment.licenseId)).limit(1).for("update")
      : [];
    if (!license || license.status === "revoked") throw conflict("Litsenziya bekor qilingan — to'lov so'rovini bekor qiling");
    const continuing = license.status === "active" && license.expiresAt !== null && license.expiresAt.getTime() > now.getTime();
    const window = renewalWindow(license.expiresAt, continuing, now, months);
    const [updated] = await tx
      .update(licenses)
      .set({
        status: "active",
        planId: plan.id,
        price: payment.amount,
        startAt: continuing ? license.startAt : window.startAt,
        expiresAt: window.expiresAt,
        warningDays: null,
        updatedAt: now,
      })
      .where(eq(licenses.id, license.id))
      .returning();
    await writeLicenseHistory(tx, { ...updated!, startAt: window.startAt }, continuing ? "renewed" : "activated", {
      actorId: admin.id,
      paymentId: payment.id,
      planName: plan.name,
    });
    await auditLicense(tx, admin, meta, continuing ? "LICENSE_RENEWED" : "ADDITIONAL_LICENSE_PURCHASED", updated!, {
      planCode: plan.code,
      effectiveMonths: months,
      paymentId: payment.id,
    });
  }

  const [paid] = await tx
    .update(subscriptionPayments)
    .set({ status: "paid", reference, confirmedBy: admin.id, confirmedAt: now, updatedAt: now })
    .where(eq(subscriptionPayments.id, payment.id))
    .returning();
  return { payment: paid!, duplicate: false };
}

/** Platforma admini: included litsenziyalar sonini o'zgartirish (ishlatilayotganidan kam emas). */
export async function setIncludedLicenses(
  tx: Tx,
  admin: NonNullable<Actor>,
  companyId: string,
  includedLicenses: number,
  meta: RequestMeta,
  now = new Date(),
): Promise<SubscriptionRow> {
  const [exists] = await tx.select({ id: companies.id }).from(companies).where(eq(companies.id, companyId)).limit(1);
  if (!exists) throw notFound("Kompaniya topilmadi");
  const subscription = await lockSubscription(tx, companyId);
  const counts = await licenseCounts(tx, companyId, subscription.includedLicenses, now);
  if (includedLicenses < counts.includedUsed) {
    throw badRequest(`Hozir ${counts.includedUsed} ta included litsenziya ishlatilmoqda — avval xodimlarni bepul qiling`);
  }
  if (includedLicenses === subscription.includedLicenses) return subscription;

  const [updated] = await tx
    .update(subscriptions)
    .set({ includedLicenses, updatedAt: now })
    .where(eq(subscriptions.id, subscription.id))
    .returning();
  await writeSubscriptionHistory(tx, updated!, "licenses_changed", { createdBy: admin.id });
  await auditSubscription(tx, admin, meta, companyId, "SUBSCRIPTION_LICENSES_CHANGED", subscription.id, {
    from: subscription.includedLicenses,
    to: includedLicenses,
  }, "warning");
  return updated!;
}

// ─── Davriy: muddat tugashi va trial ogohlantirishlari ───────────────────────

export type ExpiryResult = { subscriptionsExpired: number; licensesExpired: number; trialWarnings: number; licenseWarnings: number };

/** Bildirishnoma matni uchun: kompaniya egasi va litsenziya tegishli xodimning ismi. */
async function licenseNotifyTarget(tx: Tx, license: { companyId: string; userId: string }) {
  const [row] = await tx
    .select({ ownerId: companies.ownerId, userName: users.name })
    .from(companies)
    .innerJoin(users, eq(users.id, license.userId))
    .where(eq(companies.id, license.companyId))
    .limit(1);
  return row ?? null;
}

export async function processSubscriptionExpiry(tx: Tx, now = new Date()): Promise<ExpiryResult> {
  const dueSubscriptions = await tx
    .select()
    .from(subscriptions)
    .where(and(inArray(subscriptions.status, ["trial", "active"]), isNotNull(subscriptions.expiresAt), lte(subscriptions.expiresAt, now)))
    .for("update", { skipLocked: true });
  for (const subscription of dueSubscriptions) {
    const [expired] = await tx
      .update(subscriptions)
      .set({ status: "expired", updatedAt: now })
      .where(eq(subscriptions.id, subscription.id))
      .returning();
    await writeSubscriptionHistory(tx, expired!, "expired");
    await auditSubscription(tx, null, undefined, subscription.companyId, "SUBSCRIPTION_EXPIRED", subscription.id, {
      previousStatus: subscription.status,
      expiresAt: subscription.expiresAt?.toISOString() ?? null,
    }, "warning");
  }

  const dueLicenses = await tx
    .select()
    .from(licenses)
    .where(and(eq(licenses.licenseType, "additional"), eq(licenses.status, "active"), isNotNull(licenses.expiresAt), lte(licenses.expiresAt, now)))
    .for("update", { skipLocked: true });
  for (const license of dueLicenses) {
    const [expired] = await tx.update(licenses).set({ status: "expired", updatedAt: now }).where(eq(licenses.id, license.id)).returning();
    await writeLicenseHistory(tx, expired!, "expired");
    await auditLicense(tx, null, undefined, "LICENSE_EXPIRED", expired!);
    // Ilgari jim tugardi — ega xodim tizimga kira olmay qolgandan keyin bilardi
    const target = await licenseNotifyTarget(tx, license);
    if (!target?.ownerId) continue;
    await tx.insert(notifications).values({
      companyId: license.companyId,
      userId: target.ownerId,
      type: "system",
      severity: "warning",
      title: "Qo'shimcha litsenziya muddati tugadi",
      message: `${target.userName} uchun qo'shimcha litsenziya tugadi — u tizimga kira olmaydi. Obuna sahifasida uzaytiring.`,
      relatedType: "license",
      relatedId: license.id,
      link: "/subscription",
    });
  }

  // Trial tugashiga 10/5/3/1 kun qolganda egasiga bildirishnoma — har chegara bir marta
  const trials = await tx
    .select({ subscription: subscriptions, ownerId: companies.ownerId })
    .from(subscriptions)
    .innerJoin(companies, eq(companies.id, subscriptions.companyId))
    .where(
      and(
        eq(subscriptions.status, "trial"),
        gt(subscriptions.expiresAt, now),
        lte(subscriptions.expiresAt, new Date(now.getTime() + 10 * DAY_MS)),
      ),
    );
  let trialWarnings = 0;
  for (const { subscription, ownerId } of trials) {
    const warning = trialWarning("trial", subscription.expiresAt, now);
    if (warning === null || (subscription.trialWarningDays !== null && warning >= subscription.trialWarningDays)) continue;
    await tx.update(subscriptions).set({ trialWarningDays: warning, updatedAt: now }).where(eq(subscriptions.id, subscription.id));
    if (!ownerId) continue;
    await tx.insert(notifications).values({
      companyId: subscription.companyId,
      userId: ownerId,
      type: "system",
      severity: warning <= 3 ? "warning" : "info",
      title: `BUM ERP sinov muddati tugashiga ${warning} kun qoldi`,
      message: "Ma'lumotlaringiz saqlanadi, lekin muddat tugagach ish bo'limlari yopiladi. Obunani faollashtiring.",
      relatedType: "subscription",
      relatedId: subscription.id,
      link: "/subscription",
    });
    trialWarnings += 1;
  }

  // Qo'shimcha litsenziya tugashiga 10/5/3/1 kun qolganda egasiga bildirishnoma — har chegara bir marta
  const horizon = new Date(now.getTime() + Math.max(...LICENSE_WARNING_DAYS) * DAY_MS);
  const expiringLicenses = await tx
    .select({ license: licenses, ownerId: companies.ownerId, userName: users.name })
    .from(licenses)
    .innerJoin(companies, eq(companies.id, licenses.companyId))
    .innerJoin(users, eq(users.id, licenses.userId))
    .where(
      and(
        eq(licenses.licenseType, "additional"),
        eq(licenses.status, "active"),
        gt(licenses.expiresAt, now),
        lte(licenses.expiresAt, horizon),
      ),
    );
  let licenseWarnings = 0;
  for (const { license, ownerId, userName } of expiringLicenses) {
    const warning = licenseWarning({ type: license.licenseType, status: license.status, expiresAt: license.expiresAt }, now);
    if (warning === null || (license.warningDays !== null && warning >= license.warningDays)) continue;
    await tx.update(licenses).set({ warningDays: warning, updatedAt: now }).where(eq(licenses.id, license.id));
    if (!ownerId) continue;
    await tx.insert(notifications).values({
      companyId: license.companyId,
      userId: ownerId,
      type: "system",
      severity: warning <= 3 ? "warning" : "info",
      title: `Qo'shimcha litsenziya tugashiga ${warning} kun qoldi`,
      message: `${userName} uchun qo'shimcha litsenziya tugaydi. Muddat tugagach u tizimga kira olmaydi — obuna sahifasida uzaytiring.`,
      relatedType: "license",
      relatedId: license.id,
      link: "/subscription",
    });
    licenseWarnings += 1;
  }

  return { subscriptionsExpired: dueSubscriptions.length, licensesExpired: dueLicenses.length, trialWarnings, licenseWarnings };
}
