/**
 * /api/crm — lidlar va faoliyatlar (convex/crm/*). Savdo agentlari, marshrutlar va tashriflar — /api/distribution.
 *
 *   GET    /sales-reps                                                    crm.view (lidga agent tanlash: faqat faollar, id/nom/kod)
 *   GET    /leads (?stage=&salesRepId=&search=&limit=), /leads/stats      crm.view
 *   POST   /leads, PATCH / DELETE /leads/:leadId, POST /leads/:leadId/stage   crm.manage
 *   GET    /activities (?customerId=&leadId=&status=&type=&limit=)        crm.view
 *   POST   /activities, PATCH / DELETE /activities/:activityId            crm.manage
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Permission } from "@bum/shared";
import { db } from "../../db/client.js";
import { withTransaction, type Tx } from "../../db/transaction.js";
import { requestMeta } from "../../shared/audit.js";
import { moneySchema } from "../../shared/decimal.js";
import { authOf, requireAuth } from "../auth/guard.js";
import { requirePermission, requireTenant, requireTenantForWrite, type TenantContext } from "../company/tenant.js";
import { listSalesReps } from "../distribution/sales-reps.service.js";
import { createActivity, deleteActivity, listActivities, updateActivity } from "./activities.service.js";
import { changeLeadStage, createLead, deleteLead, leadStats, listLeads, updateLead } from "./leads.service.js";

const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null)
    .nullable()
    .optional();
const isoDate = z.iso.date();
const limitQuery = z.coerce.number().int().min(1).max(500).default(200);

const leadStages = ["new", "contacted", "qualified", "proposal", "won", "lost"] as const;
const leadBody = z.strictObject({
  name: z.string().trim().min(1).max(200),
  companyName: nullableText(200),
  phone: nullableText(20),
  email: nullableText(255),
  source: z.enum(["website", "referral", "social", "cold_call", "exhibition", "other"]).optional(),
  estimatedValue: moneySchema.nullable().optional(),
  salesRepId: z.uuid().nullable().optional(),
  expectedCloseDate: isoDate.nullable().optional(),
  notes: nullableText(2000),
});
const leadStageBody = z.strictObject({
  stage: z.enum(leadStages),
  lostReason: nullableText(1000),
  customerId: z.uuid().nullable().optional(),
  convertToCustomer: z.boolean().optional(),
});
const leadsQuery = z.object({
  stage: z.enum(leadStages).optional(),
  salesRepId: z.uuid().optional(),
  search: z.string().trim().min(1).max(100).optional(),
  limit: limitQuery,
});

const activityTypes = ["call", "meeting", "email", "note", "task"] as const;
const activityStatuses = ["planned", "done", "cancelled"] as const;
const activityBody = z.strictObject({
  type: z.enum(activityTypes),
  title: z.string().trim().min(1).max(300),
  description: nullableText(5000),
  customerId: z.uuid().nullable().optional(),
  leadId: z.uuid().nullable().optional(),
  activityDate: isoDate,
  dueDate: isoDate.nullable().optional(),
  status: z.enum(activityStatuses).optional(),
  outcome: nullableText(2000),
});
const activitiesQuery = z.object({
  customerId: z.uuid().optional(),
  leadId: z.uuid().optional(),
  status: z.enum(activityStatuses).optional(),
  type: z.enum(activityTypes).optional(),
  limit: limitQuery,
});

const leadParams = z.object({ leadId: z.uuid() });
const activityParams = z.object({ activityId: z.uuid() });

async function readTenant(req: FastifyRequest): Promise<TenantContext> {
  const tenant = await requireTenant(db, authOf(req).user);
  await requirePermission(db, tenant, "crm.view");
  return tenant;
}

function writeInTenant<T>(req: FastifyRequest, fn: (tx: Tx, tenant: TenantContext) => Promise<T>): Promise<T> {
  const permission: Permission = "crm.manage";
  return withTransaction(async (tx) => {
    const tenant = await requireTenantForWrite(tx, authOf(req).user);
    await requirePermission(tx, tenant, permission);
    return fn(tx, tenant);
  });
}

export async function crmRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  // ─── Lidga agent tanlash ─────────────────────────────────────────────────
  // Maqsad, komissiya va statistika — distribution.view bilan /api/distribution/sales-reps da

  app.get("/sales-reps", async (req) => {
    const reps = await listSalesReps(db, await readTenant(req));
    return { salesReps: reps.map(({ id, name, code }) => ({ id, name, code })) };
  });

  // ─── Lidlar ──────────────────────────────────────────────────────────────

  app.get("/leads", async (req) => {
    const query = leadsQuery.parse(req.query);
    return { leads: await listLeads(db, await readTenant(req), query) };
  });

  app.get("/leads/stats", async (req) => leadStats(db, await readTenant(req)));

  app.post("/leads", async (req, reply) => {
    const body = leadBody.parse(req.body);
    const lead = await writeInTenant(req, (tx, tenant) => createLead(tx, tenant, body, requestMeta(req)));
    reply.status(201);
    return { lead };
  });

  app.patch("/leads/:leadId", async (req) => {
    const { leadId } = leadParams.parse(req.params);
    const patch = leadBody.partial().parse(req.body);
    return { lead: await writeInTenant(req, (tx, tenant) => updateLead(tx, tenant, leadId, patch, requestMeta(req))) };
  });

  app.post("/leads/:leadId/stage", async (req) => {
    const { leadId } = leadParams.parse(req.params);
    const body = leadStageBody.parse(req.body);
    return { lead: await writeInTenant(req, (tx, tenant) => changeLeadStage(tx, tenant, leadId, body, requestMeta(req))) };
  });

  app.delete("/leads/:leadId", async (req, reply) => {
    const { leadId } = leadParams.parse(req.params);
    await writeInTenant(req, (tx, tenant) => deleteLead(tx, tenant, leadId, requestMeta(req)));
    return reply.status(204).send();
  });

  // ─── Faoliyatlar ─────────────────────────────────────────────────────────

  app.get("/activities", async (req) => {
    const query = activitiesQuery.parse(req.query);
    return { activities: await listActivities(db, await readTenant(req), query) };
  });

  app.post("/activities", async (req, reply) => {
    const body = activityBody.parse(req.body);
    const activity = await writeInTenant(req, (tx, tenant) => createActivity(tx, tenant, body, requestMeta(req)));
    reply.status(201);
    return { activity };
  });

  app.patch("/activities/:activityId", async (req) => {
    const { activityId } = activityParams.parse(req.params);
    const patch = activityBody.partial().parse(req.body);
    return { activity: await writeInTenant(req, (tx, tenant) => updateActivity(tx, tenant, activityId, patch, requestMeta(req))) };
  });

  app.delete("/activities/:activityId", async (req, reply) => {
    const { activityId } = activityParams.parse(req.params);
    await writeInTenant(req, (tx, tenant) => deleteActivity(tx, tenant, activityId, requestMeta(req)));
    return reply.status(204).send();
  });
}
