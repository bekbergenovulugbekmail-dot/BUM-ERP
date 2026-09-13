/**
 * /api/subscription — aktiv kompaniyaning obunasi va litsenziyalari (companyId so'rovdan olinmaydi).
 * Obuna tugagan bo'lsa ham ochiq (kirish darajasi `account`) — uzaytirish shu yerdan.
 *
 *   GET  /                                joriy obuna, litsenziyalar soni, kutilayotgan to'lovlar     subscription.view
 *   GET  /plans                           faol tariflar: asosiy va qo'shimcha litsenziya              subscription.view | license.view | employee.software_access.manage
 *   GET  /licenses                        joriy litsenziyalar va hisob                                license.view
 *   GET  /history                         obuna va litsenziya tarixi (?limit=)                        subscription.view
 *   GET  /payments                        to'lov so'rovlari (?status=)                                subscription.view
 *   POST /purchase                        asosiy tarifga to'lov so'rovi {planId, idempotencyKey}       subscription.manage
 *   POST /licenses/:licenseId/purchase    qo'shimcha litsenziyaga to'lov so'rovi {planId, idempotencyKey}   license.manage
 *   POST /payments/:paymentId/cancel      kutilayotgan so'rovni bekor qilish                           subscription.manage
 *
 * Faollashtirish faqat platforma admini to'lovni tasdiqlaganda (/api/platform/billing/...).
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { SUBSCRIPTION_PAYMENT_STATUSES, forbidden, type Permission } from "@bum/shared";
import { db } from "../../db/client.js";
import { withTransaction, type Tx } from "../../db/transaction.js";
import { requestMeta } from "../../shared/audit.js";
import { authOf, requireAuth } from "../auth/guard.js";
import { effectivePermissions, requirePermission, requireTenant, type TenantContext } from "../company/tenant.js";
import { licenseCounts, listLicenses, lockSubscription } from "./license.service.js";
import { listActivePlans } from "./plans.js";
import {
  cancelPayment,
  listHistory,
  listPayments,
  requestLicensePurchase,
  requestSubscriptionPurchase,
  subscriptionOverview,
} from "./subscription.service.js";

const idempotencyKey = z.string().trim().min(8).max(100).regex(/^[\w:-]+$/, "So'rov kaliti noto'g'ri");
const purchaseBody = z.strictObject({ planId: z.uuid(), idempotencyKey });
const licenseParams = z.object({ licenseId: z.uuid() });
const paymentParams = z.object({ paymentId: z.uuid() });
const historyQuery = z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) });
const paymentsQuery = z.object({
  status: z.enum(SUBSCRIPTION_PAYMENT_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

async function readTenant(req: FastifyRequest, permission: Permission): Promise<TenantContext> {
  const tenant = await requireTenant(db, authOf(req).user, { access: "account" });
  await requirePermission(db, tenant, permission);
  return tenant;
}

function writeInTenant<T>(req: FastifyRequest, permission: Permission, fn: (tx: Tx, tenant: TenantContext) => Promise<T>): Promise<T> {
  return withTransaction(async (tx) => {
    const tenant = await requireTenant(tx, authOf(req).user, { access: "account" });
    await requirePermission(tx, tenant, permission);
    return fn(tx, tenant);
  });
}

export async function subscriptionRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.get("/", async (req) => {
    const tenant = await readTenant(req, "subscription.view");
    return subscriptionOverview(db, tenant.company.id);
  });

  app.get("/plans", async (req) => {
    const tenant = await requireTenant(db, authOf(req).user, { access: "account" });
    const permissions = await effectivePermissions(db, tenant);
    const allowed: Permission[] = ["subscription.view", "license.view", "employee.software_access.manage"];
    if (!allowed.some((permission) => permissions.includes(permission))) throw forbidden("Bu amal uchun ruxsat yo'q: subscription.view");
    return listActivePlans(db);
  });

  app.get("/licenses", async (req) => {
    const tenant = await readTenant(req, "license.view");
    const licenses = await listLicenses(db, tenant.company.id, tenant.company.ownerId);
    // Hisob — obunadagi included soni bilan (tranzaksiyasiz o'qish; qulf faqat yozishda)
    const counts = await withTransaction(async (tx) => {
      const subscription = await lockSubscription(tx, tenant.company.id);
      return licenseCounts(tx, tenant.company.id, subscription.includedLicenses);
    });
    return { licenses, counts };
  });

  app.get("/history", async (req) => {
    const { limit } = historyQuery.parse(req.query);
    const tenant = await readTenant(req, "subscription.view");
    return listHistory(db, tenant.company.id, limit);
  });

  app.get("/payments", async (req) => {
    const query = paymentsQuery.parse(req.query);
    const tenant = await readTenant(req, "subscription.view");
    return { payments: await listPayments(db, { ...query, companyId: tenant.company.id }) };
  });

  app.post("/purchase", async (req, reply) => {
    const body = purchaseBody.parse(req.body);
    const { user } = authOf(req);
    const result = await writeInTenant(req, "subscription.manage", (tx, tenant) =>
      requestSubscriptionPurchase(tx, { companyId: tenant.company.id, actor: user }, body, requestMeta(req)),
    );
    reply.status(result.duplicate ? 200 : 201);
    return result;
  });

  app.post("/licenses/:licenseId/purchase", async (req, reply) => {
    const { licenseId } = licenseParams.parse(req.params);
    const body = purchaseBody.parse(req.body);
    const { user } = authOf(req);
    const result = await writeInTenant(req, "license.manage", (tx, tenant) =>
      requestLicensePurchase(tx, { companyId: tenant.company.id, actor: user }, { ...body, licenseId }, requestMeta(req)),
    );
    reply.status(result.duplicate ? 200 : 201);
    return result;
  });

  app.post("/payments/:paymentId/cancel", async (req) => {
    const { paymentId } = paymentParams.parse(req.params);
    const { user } = authOf(req);
    const payment = await writeInTenant(req, "subscription.manage", (tx, tenant) =>
      cancelPayment(tx, { companyId: tenant.company.id, actor: user }, paymentId, requestMeta(req)),
    );
    return { payment };
  });
}
