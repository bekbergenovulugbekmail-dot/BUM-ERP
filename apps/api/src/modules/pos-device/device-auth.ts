/**
 * Desktop kassa qurilmasi autentifikatsiyasi.
 *
 *  - Token (`bumpos_…`, 32 bayt tasodifiy) faqat ro'yxatdan o'tkazishda bir marta qaytadi; bazada SHA-256 xeshi.
 *  - `Authorization: Bearer <token>`; o'chirilgan qurilma yoki tugatilgan kompaniya — 401/403.
 *  - Kassir: qurilma amalida kelgan `cashierId` — kompaniyaning faol a'zosi, `pos.use` va qurilma omboriga ruxsati
 *    bo'lishi shart (qurilma kassirni PIN bilan tekshiradi; server a'zolik va ruxsatni har amalda qayta tekshiradi).
 */
import { createHash, randomBytes } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { and, eq } from "drizzle-orm";
import { effectiveSubscriptionStatus, forbidden, unauthenticated } from "@bum/shared";
import { db } from "../../db/client.js";
import { companies, companyMembers, users } from "../../db/schema/platform.js";
import { posDevices } from "../../db/schema/pos.js";
import { subscriptions } from "../../db/schema/subscription.js";
import { warehouses } from "../../db/schema/inventory.js";
import type { DbOrTx } from "../../db/transaction.js";
import { requirePermission, requireTenant, type TenantContext } from "../company/tenant.js";
import { assertWarehouseAccess } from "../inventory/warehouses.service.js";
import { accessDenied, subscriptionDenial, type SubscriptionSnapshot } from "../subscription/access.js";

export const DEVICE_TOKEN_PREFIX = "bumpos_";

export const hashDeviceToken = (token: string) => createHash("sha256").update(token).digest("hex");

export function newDeviceToken() {
  const token = `${DEVICE_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  return { token, tokenHash: hashDeviceToken(token) };
}

export type DeviceContext = {
  device: { id: string; name: string; code: string; warehouseId: string; warehouseName: string };
  company: {
    id: string;
    name: string;
    currency: string;
    status: string;
    isActive: boolean;
    trialEndsAt: Date | null;
    subscription: SubscriptionSnapshot | null;
  };
};

declare module "fastify" {
  interface FastifyRequest {
    posDevice: DeviceContext | null;
  }
}

export async function requireDevice(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
  if (!token.startsWith(DEVICE_TOKEN_PREFIX)) throw unauthenticated("Kassa qurilmasi tokeni yo'q");

  const [row] = await db
    .select({
      id: posDevices.id,
      name: posDevices.name,
      code: posDevices.code,
      isActive: posDevices.isActive,
      warehouseId: posDevices.warehouseId,
      warehouseName: warehouses.name,
      companyId: companies.id,
      companyName: companies.name,
      currency: companies.currency,
      status: companies.status,
      companyActive: companies.isActive,
      trialEndsAt: companies.trialEndsAt,
      subscriptionStatus: subscriptions.status,
      subscriptionExpiresAt: subscriptions.expiresAt,
    })
    .from(posDevices)
    .innerJoin(companies, eq(companies.id, posDevices.companyId))
    .innerJoin(warehouses, eq(warehouses.id, posDevices.warehouseId))
    .leftJoin(subscriptions, eq(subscriptions.companyId, posDevices.companyId))
    .where(eq(posDevices.tokenHash, hashDeviceToken(token)))
    .limit(1);
  if (!row || !row.isActive) throw unauthenticated("Kassa qurilmasi ro'yxatdan o'tmagan yoki o'chirilgan");
  if (row.status === "cancelled") throw forbidden("Kompaniya tugatilgan");

  req.posDevice = {
    device: { id: row.id, name: row.name, code: row.code, warehouseId: row.warehouseId, warehouseName: row.warehouseName },
    company: {
      id: row.companyId,
      name: row.companyName,
      currency: row.currency,
      status: row.status,
      isActive: row.companyActive,
      trialEndsAt: row.trialEndsAt,
      subscription: row.subscriptionStatus ? { status: row.subscriptionStatus, expiresAt: row.subscriptionExpiresAt } : null,
    },
  };
}

/**
 * Obuna tugagan kompaniya qurilmasi: sinxron (pull/push) va kassir kirishi yopiq — butun so'rov 403, ya'ni
 * kassadagi offline amallar navbatda qoladi va obuna uzaytirilgach yuboriladi (hech narsa yo'qolmaydi).
 */
export function assertDeviceSubscription(context: DeviceContext): void {
  const denial = subscriptionDenial(context.company.subscription);
  if (denial) throw accessDenied(denial, context.company.subscription);
}

export function deviceSubscriptionView(context: DeviceContext) {
  const subscription = context.company.subscription;
  if (!subscription) return null;
  return { status: effectiveSubscriptionStatus(subscription), expiresAt: subscription.expiresAt?.toISOString() ?? null };
}

export function deviceOf(req: FastifyRequest): DeviceContext {
  if (!req.posDevice) throw unauthenticated("Kassa qurilmasi tokeni yo'q");
  return req.posDevice;
}

/** Qurilma amali uchun kassir konteksti: faol foydalanuvchi, faol a'zolik, `pos.use`, qurilma omboriga ruxsat. */
export async function cashierTenant(conn: DbOrTx, context: DeviceContext, cashierId: string): Promise<TenantContext> {
  const [user] = await conn.select().from(users).where(eq(users.id, cashierId)).limit(1);
  if (!user || !user.isActive) throw forbidden("Kassir faol emas");
  const [member] = await conn
    .select({ isActive: companyMembers.isActive })
    .from(companyMembers)
    .where(and(eq(companyMembers.companyId, context.company.id), eq(companyMembers.userId, user.id)))
    .limit(1);
  // Umumiy "kirishingiz cheklangan" o'rniga aniq sabab — kassir boshqa kompaniya xodimi bo'lishi mumkin
  if (!member || !member.isActive) {
    throw forbidden(`Bu foydalanuvchi «${context.company.name}» kompaniyasining faol xodimi emas. Boshqa kompaniya bilan ishlash uchun kassada «Qurilmani uzish» ni bosing.`);
  }
  const tenant = await requireTenant(conn, { ...user, activeCompanyId: context.company.id });
  await requirePermission(conn, tenant, "pos.use");
  assertWarehouseAccess(tenant, context.device.warehouseId);
  return tenant;
}
