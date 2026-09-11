/**
 * /api/notifications — bildirishnomalar (convex/notifications.ts). Kompaniyaning faol a'zosi uchun.
 *
 *   GET    / (?unreadOnly=&limit=), /unread-count
 *   POST   /:notificationId/read, /read-all, /clear-read
 *   DELETE /:notificationId           — o'zidan yopish (global bildirishnoma boshqalarda qoladi)
 *   POST   /refresh                   — aqlli ogohlantirishlar (kompaniyaga 5 daqiqada bir)
 *   POST   /                          — bildirishnoma yuborish: company.manage, havola faqat ichki yo'l
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { db } from "../../db/client.js";
import { withTransaction } from "../../db/transaction.js";
import { requestMeta } from "../../shared/audit.js";
import { authOf, requireAuth } from "../auth/guard.js";
import { requirePermission, requireTenant, requireTenantForWrite } from "../company/tenant.js";
import {
  clearRead,
  createNotification,
  dismissNotification,
  listNotifications,
  markAllRead,
  markRead,
  refreshSmartAlerts,
  unreadCount,
} from "./notifications.service.js";

const boolQuery = z.enum(["true", "false"]).transform((v) => v === "true").optional();
const listQuery = z.object({ unreadOnly: boolQuery, limit: z.coerce.number().int().min(1).max(200).default(50) });
const idParams = z.object({ notificationId: z.uuid() });
const createBody = z.strictObject({
  title: z.string().trim().min(1).max(300),
  message: z.string().trim().min(1).max(2000),
  severity: z.enum(["info", "warning", "error", "success"]).default("info"),
  type: z.enum(["low_stock", "expiring_soon", "pending_approval", "overdue_payment", "leave_request", "po_received", "production_complete", "system"]).optional(),
  userId: z.uuid().nullable().optional(),
  /** Faqat ilova ichidagi yo'l — tashqi saytga yo'naltirish (fishing) mumkin emas. */
  link: z
    .string()
    .trim()
    .max(500)
    .regex(/^\/(?![/\\])[\w\-/?=&.%#]*$/, "Havola ilova ichidagi yo'l bo'lishi kerak")
    .nullable()
    .optional(),
});

const tenantOf = (req: FastifyRequest) => requireTenant(db, authOf(req).user);

export async function notificationRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.get("/", async (req) => {
    const query = listQuery.parse(req.query);
    return { notifications: await listNotifications(db, await tenantOf(req), query) };
  });

  app.get("/unread-count", async (req) => ({ count: await unreadCount(db, await tenantOf(req)) }));

  app.post("/:notificationId/read", async (req, reply) => {
    const { notificationId } = idParams.parse(req.params);
    await withTransaction(async (tx) => markRead(tx, await requireTenant(tx, authOf(req).user), notificationId));
    return reply.status(204).send();
  });

  app.post("/read-all", async (req, reply) => {
    await withTransaction(async (tx) => markAllRead(tx, await requireTenant(tx, authOf(req).user)));
    return reply.status(204).send();
  });

  app.delete("/:notificationId", async (req, reply) => {
    const { notificationId } = idParams.parse(req.params);
    await withTransaction(async (tx) => dismissNotification(tx, await requireTenant(tx, authOf(req).user), notificationId));
    return reply.status(204).send();
  });

  app.post("/clear-read", async (req, reply) => {
    await withTransaction(async (tx) => clearRead(tx, await requireTenant(tx, authOf(req).user)));
    return reply.status(204).send();
  });

  app.post("/refresh", async (req) => refreshSmartAlerts(await tenantOf(req)));

  app.post("/", async (req, reply) => {
    const body = createBody.parse(req.body);
    const notification = await withTransaction(async (tx) => {
      const tenant = await requireTenantForWrite(tx, authOf(req).user);
      await requirePermission(tx, tenant, "company.manage");
      return createNotification(tx, tenant, body, requestMeta(req));
    });
    reply.status(201);
    return { notification };
  });
}
