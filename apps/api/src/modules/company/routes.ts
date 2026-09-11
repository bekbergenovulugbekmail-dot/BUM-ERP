/**
 * /api/company — kompaniya egasining o'z xodimlarini boshqarishi.
 *
 * Kompaniya har doim egasining AKTIV kompaniyasi — so'rovda companyId
 * qabul qilinmaydi, ya'ni boshqa kompaniyaga murojaat qilishning yo'li yo'q.
 *
 * Convex mosligi: userAdmin.createUserAccount / resetUserPassword (kompaniya darajasi).
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../../db/client.js";
import { withTransaction } from "../../db/transaction.js";
import { requestMeta } from "../../shared/audit.js";
import { authOf, requireAuth } from "../auth/guard.js";
import {
  createEmployee,
  listCompanyMembers,
  ownerResetEmployeePassword,
  resolveOwnedCompany,
} from "../users/user-admin.service.js";

const employeeBody = z.object({
  phone: z.string().min(1).max(32),
  password: z.string().min(1).max(256),
  name: z.string().max(200).optional(),
  role: z.string().min(1).max(100).optional(),
});
const userParams = z.object({ userId: z.uuid() });
const resetPasswordBody = z.object({ newPassword: z.string().min(1).max(256) });

export async function companyRoutes(app: FastifyInstance): Promise<void> {
  app.get("/employees", { preHandler: requireAuth }, async (req) => {
    const company = await resolveOwnedCompany(db, authOf(req).user);
    return { employees: await listCompanyMembers(db, company.id) };
  });

  app.post("/employees", { preHandler: requireAuth }, async (req, reply) => {
    const body = employeeBody.parse(req.body);
    const { user } = authOf(req);

    const { user: employee, role } = await withTransaction(async (tx) => {
      const company = await resolveOwnedCompany(tx, user);
      return createEmployee(tx, user, company, body, requestMeta(req));
    });

    reply.status(201);
    return { employee: { id: employee.id, phone: employee.phone, name: employee.name, companyRole: role } };
  });

  app.post("/employees/:userId/password", { preHandler: requireAuth }, async (req) => {
    const { userId } = userParams.parse(req.params);
    const { newPassword } = resetPasswordBody.parse(req.body);
    const { user } = authOf(req);

    await withTransaction(async (tx) => {
      const company = await resolveOwnedCompany(tx, user);
      await ownerResetEmployeePassword(tx, user, company, userId, newPassword, requestMeta(req));
    });
    return { ok: true };
  });
}
