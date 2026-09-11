/**
 * /api/distribution — savdo agentlari, marshrutlar va tashriflar (convex/crm/salesReps.ts, distribution.ts).
 *
 *   GET    /sales-reps (?includeInactive=), /sales-reps/stats             distribution.view
 *   POST   /sales-reps, PATCH / DELETE /sales-reps/:salesRepId            distribution.manage
 *   GET    /routes (?includeInactive=), /routes/:routeId                  distribution.view
 *   POST   /routes, PATCH / DELETE /routes/:routeId                       distribution.manage
 *   POST   /routes/:routeId/customers, PUT /routes/:routeId/customers/order,
 *          DELETE /routes/:routeId/customers/:memberId                   distribution.manage
 *   GET    /visits (?routeId=&salesRepId=&status=&dateFrom=&dateTo=&limit=)   distribution.view
 *   POST   /visits, PATCH /visits/:visitId                                distribution.manage
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Permission } from "@bum/shared";
import { db } from "../../db/client.js";
import { withTransaction, type Tx } from "../../db/transaction.js";
import { requestMeta } from "../../shared/audit.js";
import { moneySchema, percentSchema } from "../../shared/decimal.js";
import { authOf, requireAuth } from "../auth/guard.js";
import { requirePermission, requireTenant, requireTenantForWrite, type TenantContext } from "../company/tenant.js";
import {
  addRouteCustomer,
  createRoute,
  createVisit,
  deleteRoute,
  getRoute,
  listRoutes,
  listVisits,
  removeRouteCustomer,
  reorderRouteCustomers,
  updateRoute,
  updateVisit,
} from "./distribution.service.js";
import { createSalesRep, deleteSalesRep, listSalesReps, salesRepStats, updateSalesRep } from "./sales-reps.service.js";

const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null)
    .nullable()
    .optional();
const boolQuery = z.enum(["true", "false"]).transform((v) => v === "true").optional();
const isoDate = z.iso.date();
const limitQuery = z.coerce.number().int().min(1).max(500).default(200);
const color = z.string().trim().regex(/^#[0-9a-fA-F]{3,8}$/).nullable().optional();

const repBody = z.strictObject({
  name: z.string().trim().min(1).max(200),
  phone: nullableText(20),
  email: nullableText(255),
  userId: z.uuid().nullable().optional(),
  region: nullableText(100),
  monthlyTarget: moneySchema.optional(),
  commission: percentSchema.optional(),
  notes: nullableText(2000),
});
const repPatch = repBody.partial().extend({ isActive: z.boolean().optional() });

const routeBody = z.strictObject({
  name: z.string().trim().min(1).max(200),
  salesRepId: z.uuid().nullable().optional(),
  description: nullableText(2000),
  /** 0 = yakshanba … 6 = shanba */
  days: z.array(z.number().int().min(0).max(6)).max(7),
  color,
});
const routePatch = routeBody.partial().extend({ isActive: z.boolean().optional() });
const routeCustomerBody = z.strictObject({ customerId: z.uuid(), visitNotes: nullableText(1000) });
const reorderBody = z.strictObject({ memberIds: z.array(z.uuid()).max(1000) });

const visitStatuses = ["planned", "in_progress", "completed", "cancelled"] as const;
const visitBody = z.strictObject({
  routeId: z.uuid(),
  salesRepId: z.uuid().nullable().optional(),
  visitDate: isoDate,
  notes: nullableText(2000),
});
const visitPatch = z.strictObject({
  status: z.enum(visitStatuses).optional(),
  customersVisited: z.number().int().min(0).optional(),
  ordersCreated: z.number().int().min(0).optional(),
  totalAmount: moneySchema.optional(),
  notes: nullableText(2000),
});
const visitsQuery = z.object({
  routeId: z.uuid().optional(),
  salesRepId: z.uuid().optional(),
  status: z.enum(visitStatuses).optional(),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
  limit: limitQuery,
});

const includeInactiveQuery = z.object({ includeInactive: boolQuery });
const repParams = z.object({ salesRepId: z.uuid() });
const routeParams = z.object({ routeId: z.uuid() });
const memberParams = z.object({ routeId: z.uuid(), memberId: z.uuid() });
const visitParams = z.object({ visitId: z.uuid() });

async function readTenant(req: FastifyRequest): Promise<TenantContext> {
  const tenant = await requireTenant(db, authOf(req).user);
  await requirePermission(db, tenant, "distribution.view");
  return tenant;
}

function writeInTenant<T>(req: FastifyRequest, fn: (tx: Tx, tenant: TenantContext) => Promise<T>): Promise<T> {
  const permission: Permission = "distribution.manage";
  return withTransaction(async (tx) => {
    const tenant = await requireTenantForWrite(tx, authOf(req).user);
    await requirePermission(tx, tenant, permission);
    return fn(tx, tenant);
  });
}

export async function distributionRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  // ─── Savdo agentlari ─────────────────────────────────────────────────────

  app.get("/sales-reps", async (req) => {
    const { includeInactive } = includeInactiveQuery.parse(req.query);
    return { salesReps: await listSalesReps(db, await readTenant(req), includeInactive ?? false) };
  });

  app.get("/sales-reps/stats", async (req) => ({ salesReps: await salesRepStats(db, await readTenant(req)) }));

  app.post("/sales-reps", async (req, reply) => {
    const body = repBody.parse(req.body);
    const salesRep = await writeInTenant(req, (tx, tenant) => createSalesRep(tx, tenant, body, requestMeta(req)));
    reply.status(201);
    return { salesRep };
  });

  app.patch("/sales-reps/:salesRepId", async (req) => {
    const { salesRepId } = repParams.parse(req.params);
    const patch = repPatch.parse(req.body);
    return { salesRep: await writeInTenant(req, (tx, tenant) => updateSalesRep(tx, tenant, salesRepId, patch, requestMeta(req))) };
  });

  app.delete("/sales-reps/:salesRepId", async (req, reply) => {
    const { salesRepId } = repParams.parse(req.params);
    await writeInTenant(req, (tx, tenant) => deleteSalesRep(tx, tenant, salesRepId, requestMeta(req)));
    return reply.status(204).send();
  });

  // ─── Marshrutlar ─────────────────────────────────────────────────────────

  app.get("/routes", async (req) => {
    const { includeInactive } = includeInactiveQuery.parse(req.query);
    return { routes: await listRoutes(db, await readTenant(req), includeInactive ?? false) };
  });

  app.get("/routes/:routeId", async (req) => {
    const { routeId } = routeParams.parse(req.params);
    return { route: await getRoute(db, await readTenant(req), routeId) };
  });

  app.post("/routes", async (req, reply) => {
    const body = routeBody.parse(req.body);
    const route = await writeInTenant(req, (tx, tenant) => createRoute(tx, tenant, body, requestMeta(req)));
    reply.status(201);
    return { route };
  });

  app.patch("/routes/:routeId", async (req) => {
    const { routeId } = routeParams.parse(req.params);
    const patch = routePatch.parse(req.body);
    return { route: await writeInTenant(req, (tx, tenant) => updateRoute(tx, tenant, routeId, patch, requestMeta(req))) };
  });

  app.delete("/routes/:routeId", async (req, reply) => {
    const { routeId } = routeParams.parse(req.params);
    await writeInTenant(req, (tx, tenant) => deleteRoute(tx, tenant, routeId, requestMeta(req)));
    return reply.status(204).send();
  });

  app.post("/routes/:routeId/customers", async (req, reply) => {
    const { routeId } = routeParams.parse(req.params);
    const body = routeCustomerBody.parse(req.body);
    const member = await writeInTenant(req, (tx, tenant) => addRouteCustomer(tx, tenant, routeId, body, requestMeta(req)));
    reply.status(201);
    return { member };
  });

  app.put("/routes/:routeId/customers/order", async (req) => {
    const { routeId } = routeParams.parse(req.params);
    const { memberIds } = reorderBody.parse(req.body);
    return { route: await writeInTenant(req, (tx, tenant) => reorderRouteCustomers(tx, tenant, routeId, memberIds, requestMeta(req))) };
  });

  app.delete("/routes/:routeId/customers/:memberId", async (req, reply) => {
    const { routeId, memberId } = memberParams.parse(req.params);
    await writeInTenant(req, (tx, tenant) => removeRouteCustomer(tx, tenant, routeId, memberId, requestMeta(req)));
    return reply.status(204).send();
  });

  // ─── Tashriflar ──────────────────────────────────────────────────────────

  app.get("/visits", async (req) => {
    const query = visitsQuery.parse(req.query);
    return { visits: await listVisits(db, await readTenant(req), query) };
  });

  app.post("/visits", async (req, reply) => {
    const body = visitBody.parse(req.body);
    const visit = await writeInTenant(req, (tx, tenant) => createVisit(tx, tenant, body, requestMeta(req)));
    reply.status(201);
    return { visit };
  });

  app.patch("/visits/:visitId", async (req) => {
    const { visitId } = visitParams.parse(req.params);
    const patch = visitPatch.parse(req.body);
    return { visit: await writeInTenant(req, (tx, tenant) => updateVisit(tx, tenant, visitId, patch, requestMeta(req))) };
  });
}
