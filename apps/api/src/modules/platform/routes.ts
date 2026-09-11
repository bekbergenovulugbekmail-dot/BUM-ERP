/**
 * /api/platform — platforma admini. Barcha marshrutlar `requirePlatformAdmin` ortida.
 *
 *   GET   /companies                  kompaniyalar egalari bilan
 *   POST  /companies                  kompaniya + egasi (platformCreateCompany)
 *   PATCH /users/:userId              telefon raqamini o'zgartirish
 *   POST  /users/:userId/password     parolni tiklash — sessiyalar bekor
 *   POST  /users/:userId/status       faollashtirish / bloklash
 *
 * Bootstrap admin va boshqa platforma adminlariga bu marshrutlar ta'sir qilmaydi
 * (users/user-admin.service.ts). Bootstrap admin `db:seed` orqali yaratiladi.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../../db/client.js";
import { withTransaction } from "../../db/transaction.js";
import { requestMeta } from "../../shared/audit.js";
import { authOf, requirePlatformAdmin } from "../auth/guard.js";
import {
  platformChangePhone,
  platformResetPassword,
  platformSetActive,
} from "../users/user-admin.service.js";
import { createCompanyWithOwner, listCompanies } from "./company.service.js";

const optionalText = (max: number) => z.string().trim().min(1).max(max).optional();

const createCompanyBody = z.object({
  name: z.string().trim().min(1).max(200),
  legalName: optionalText(300),
  taxId: optionalText(32),
  phone: optionalText(20),
  address: optionalText(500),
  city: optionalText(100),
  region: optionalText(100),
  country: z.string().length(2).optional(),
  currency: z.string().length(3).optional(),
  language: z.string().length(2).optional(),
  branchName: optionalText(200),
  owner: z.object({
    phone: z.string().min(1).max(32),
    password: z.string().min(1).max(256),
    name: z.string().max(200).optional(),
  }),
});
const userParams = z.object({ userId: z.uuid() });
const updateUserBody = z.object({ phone: z.string().min(1).max(32) });
const resetPasswordBody = z.object({ newPassword: z.string().min(1).max(256) });
const statusBody = z.object({ isActive: z.boolean() });

export async function platformRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requirePlatformAdmin);

  app.get("/companies", async () => ({ companies: await listCompanies(db) }));

  app.post("/companies", async (req, reply) => {
    const body = createCompanyBody.parse(req.body);
    const { user } = authOf(req);
    const created = await withTransaction((tx) =>
      createCompanyWithOwner(tx, user, body, requestMeta(req)),
    );
    reply.status(201);
    return created;
  });

  app.patch("/users/:userId", async (req) => {
    const { userId } = userParams.parse(req.params);
    const { phone } = updateUserBody.parse(req.body);
    const { user } = authOf(req);
    const updated = await withTransaction((tx) =>
      platformChangePhone(tx, user, userId, phone, requestMeta(req)),
    );
    return { user: { id: updated.id, phone: updated.phone, name: updated.name } };
  });

  app.post("/users/:userId/password", async (req) => {
    const { userId } = userParams.parse(req.params);
    const { newPassword } = resetPasswordBody.parse(req.body);
    const { user } = authOf(req);
    await withTransaction((tx) => platformResetPassword(tx, user, userId, newPassword, requestMeta(req)));
    return { ok: true };
  });

  app.post("/users/:userId/status", async (req) => {
    const { userId } = userParams.parse(req.params);
    const { isActive } = statusBody.parse(req.body);
    const { user } = authOf(req);
    await withTransaction((tx) => platformSetActive(tx, user, userId, isActive, requestMeta(req)));
    return { ok: true };
  });
}
