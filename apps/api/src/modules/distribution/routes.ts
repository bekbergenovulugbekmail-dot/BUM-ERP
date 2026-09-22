/**
 * /api/distribution — savdo agentlari, marshrutlar va tashriflar (convex/crm/salesReps.ts, distribution.ts).
 *
 *   GET    /sales-reps (?includeInactive=), /sales-reps/stats             distribution.view
 *   POST   /sales-reps, PATCH / DELETE /sales-reps/:salesRepId            distribution.manage
 *   GET    /sales-reps/:salesRepId/cash                                   distribution.view — agentdagi naqd
 *   POST   /sales-reps/:salesRepId/cash-handover                          distribution.manage — naqdni kassaga topshirish
 *   GET    /routes (?includeInactive=), /routes/:routeId                  distribution.view
 *   POST   /routes, PATCH / DELETE /routes/:routeId                       distribution.manage
 *   GET    /routes/export (?includeInactive=)                             distribution.view (CSV)
 *   POST   /routes/import                                                 distribution.manage (CSV qatorlari)
 *   POST   /routes/:routeId/customers ({ customerId } yoki { customerIds } — ro'yxatdan ko'p tanlash),
 *          PUT /routes/:routeId/customers/order,
 *          DELETE /routes/:routeId/customers/:memberId                   distribution.manage
 *   POST   /routes/:routeId/optimize ({ apply })                          distribution.view (apply — distribution.manage) — eng qisqa yo'l tartibi
 *   GET    /map                                                           distribution.view — marshrutlar va do'konlar xaritada
 *   GET    /visits (?routeId=&salesRepId=&status=&dateFrom=&dateTo=&limit=)   distribution.view
 *   POST   /visits, PATCH /visits/:visitId                                distribution.manage
 *   GET    /assignments (?dateFrom=&dateTo=&salesRepId=)                  distribution.view
 *   POST   /assignments, DELETE /assignments/:assignmentId               distribution.manage
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
import { exportRoutesCsv, importRoutes } from "./routes-csv.service.js";
import {
  addRouteCustomer,
  addRouteCustomers,
  assignRoute,
  createRoute,
  createVisit,
  deleteAssignment,
  deleteRoute,
  distributionMap,
  getRoute,
  listAssignments,
  listRoutes,
  listVisits,
  planRouteCustomersOrder,
  removeRouteCustomer,
  reorderRouteCustomers,
  updateRoute,
  updateVisit,
} from "./distribution.service.js";
import { createSalesRep, deleteSalesRep, listSalesReps, salesRepStats, updateSalesRep } from "./sales-reps.service.js";
import {
  createTerritory,
  deleteTerritory,
  listTerritories,
  updateTerritory,
} from "./territories.service.js";
import { handoverRepCash, repCashSummary } from "../sales-agent/agent-cash.service.js";

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

/** Hudud — geografik ma'lumotnoma: viloyat → shahar/tuman → mahalla. */
const territoryKind = z.enum(["region", "district", "neighborhood"]);
const territoryBody = z.strictObject({
  name: z.string().trim().min(1).max(200),
  /** Berilmasa — shahar/tuman (marshrutlar shu darajaga biriktiriladi). */
  kind: territoryKind.optional(),
  /** Ota hudud: tuman viloyat ichida, mahalla tuman ichida (mahalla uchun majburiy). */
  parentId: z.uuid().nullable().optional(),
  description: nullableText(2000),
});
const territoryPatch = territoryBody.partial().extend({ isActive: z.boolean().optional() });
const territoryParams = z.object({ territoryId: z.uuid() });

const routeBody = z.strictObject({
  name: z.string().trim().min(1).max(200),
  /**
   * Marshrut hudud tarkibida bo'ladi — ilovada va CSV importda hudud majburiy.
   * API'da ixtiyoriy: hududlar joriy qilinishidan oldin ochilgan marshrutlar "Hududsiz" bo'lib qoladi.
   */
  territoryId: z.uuid().nullable().optional(),
  salesRepId: z.uuid().nullable().optional(),
  description: nullableText(2000),
  /** 0 = yakshanba … 6 = shanba */
  days: z.array(z.number().int().min(0).max(6)).max(7),
  color,
});
const routePatch = routeBody.partial().extend({ isActive: z.boolean().optional() });
/** Marshrutga mijoz qo'shish: bitta (`customerId`) yoki ro'yxatdan belgilab ko'pi (`customerIds`). */
const routeCustomerBody = z
  .strictObject({
    customerId: z.uuid().optional(),
    /** Ro'yxatdan belgilab qo'shish; marshrutda bori o'tkazib yuboriladi. */
    customerIds: z.array(z.uuid()).min(1).max(500).optional(),
    visitNotes: nullableText(1000),
  })
  .refine(
    (body) => (body.customerId === undefined) !== (body.customerIds === undefined),
    "customerId yoki customerIds dan faqat bittasi yuboriladi",
  );
/** CSV import: fayl brauzerda o'qiladi, qatorlar shu yerda tekshiriladi. Do'konlar fayl bilan biriktirilmaydi. */
const routeImportBody = z.strictObject({
  /** Preview: faqat tekshirish — bazaga hech narsa yozilmaydi. */
  dryRun: z.boolean().optional(),
  rows: z
    .array(
      z.strictObject({
        name: z.string().max(300).optional(),
        /** Hudud nomi — marshrut shu hudud tarkibida ochiladi. */
        territory: z.string().max(200).optional(),
        salesRep: z.string().max(200).optional(),
        days: z.string().max(100).optional(),
        description: z.string().max(2000).optional(),
        color: z.string().max(50).optional(),
      }),
    )
    .min(1)
    .max(500),
});
const reorderBody = z.strictObject({ memberIds: z.array(z.uuid()).max(1000) });
const optimizeBody = z.strictObject({ apply: z.boolean().default(true) });

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

const assignmentBody = z.strictObject({
  routeId: z.uuid(),
  salesRepId: z.uuid(),
  assignDate: isoDate,
  deliveryDate: isoDate.nullable().optional(),
  notes: nullableText(1000),
});
const assignmentsQuery = z
  .object({ dateFrom: isoDate, dateTo: isoDate, salesRepId: z.uuid().optional() })
  .refine((query) => query.dateFrom <= query.dateTo, { message: "Sana oralig'i noto'g'ri", path: ["dateTo"] });
const assignmentParams = z.object({ assignmentId: z.uuid() });

/** Agent naqdini kassaga topshirish — yetkazuvchidagi bilan bir xil shakl. */
const cashHandoverBody = z.strictObject({
  amount: moneySchema,
  /** Standart — asosiy naqd kassa; boshqa kassa — finance.manage. */
  toCashAccountId: z.uuid().nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
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

  // Agentdagi topshirilmagan naqd va uni kassaga topshirish (yetkazuvchidagi bilan bir xil qoida)
  app.get("/sales-reps/:salesRepId/cash", async (req) => {
    const { salesRepId } = repParams.parse(req.params);
    const tenant = await readTenant(req);
    return { cash: await repCashSummary(db, tenant.company.id, salesRepId) };
  });

  app.post("/sales-reps/:salesRepId/cash-handover", async (req, reply) => {
    const { salesRepId } = repParams.parse(req.params);
    const body = cashHandoverBody.parse(req.body);
    const handover = await writeInTenant(req, (tx, tenant) => handoverRepCash(tx, tenant, salesRepId, body, requestMeta(req)));
    reply.status(201);
    return { handover };
  });

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

  // ─── Hududlar (marshrutlar shular tarkibida) ──────────────────────────────

  app.get("/territories", async (req) => {
    const { includeInactive, kind } = z
      .object({ includeInactive: boolQuery, kind: territoryKind.optional() })
      .parse(req.query);
    return { territories: await listTerritories(db, await readTenant(req), includeInactive ?? false, kind) };
  });

  app.post("/territories", async (req, reply) => {
    const body = territoryBody.parse(req.body);
    const territory = await writeInTenant(req, (tx, tenant) => createTerritory(tx, tenant, body, requestMeta(req)));
    reply.status(201);
    return { territory };
  });

  app.patch("/territories/:territoryId", async (req) => {
    const { territoryId } = territoryParams.parse(req.params);
    const body = territoryPatch.parse(req.body);
    return { territory: await writeInTenant(req, (tx, tenant) => updateTerritory(tx, tenant, territoryId, body, requestMeta(req))) };
  });

  app.delete("/territories/:territoryId", async (req, reply) => {
    const { territoryId } = territoryParams.parse(req.params);
    await writeInTenant(req, (tx, tenant) => deleteTerritory(tx, tenant, territoryId, requestMeta(req)));
    reply.status(204);
  });

  app.get("/routes", async (req) => {
    const { includeInactive } = includeInactiveQuery.parse(req.query);
    return { routes: await listRoutes(db, await readTenant(req), includeInactive ?? false) };
  });

  app.get("/routes/export", async (req, reply) => {
    const { includeInactive } = includeInactiveQuery.parse(req.query);
    const csv = await exportRoutesCsv(db, await readTenant(req), { includeInactive: includeInactive ?? false });
    const date = new Date().toISOString().slice(0, 10);
    reply
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", `attachment; filename="marshrutlar-${date}.csv"`);
    return csv;
  });

  app.post("/routes/import", async (req) => {
    const { rows, dryRun } = routeImportBody.parse(req.body);
    return writeInTenant(req, (tx, tenant) => importRoutes(tx, tenant, rows, requestMeta(req), { dryRun }));
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
    // Ro'yxatdan belgilab qo'shish: marshrutda bori xato bermaydi, `skipped` bo'lib qaytadi
    if (body.customerIds) {
      const result = await writeInTenant(req, (tx, tenant) =>
        addRouteCustomers(tx, tenant, routeId, { customerIds: body.customerIds!, visitNotes: body.visitNotes }, requestMeta(req)),
      );
      reply.status(201);
      return result;
    }
    const member = await writeInTenant(req, (tx, tenant) =>
      addRouteCustomer(tx, tenant, routeId, { customerId: body.customerId!, visitNotes: body.visitNotes }, requestMeta(req)),
    );
    reply.status(201);
    return { member };
  });

  app.put("/routes/:routeId/customers/order", async (req) => {
    const { routeId } = routeParams.parse(req.params);
    const { memberIds } = reorderBody.parse(req.body);
    return { route: await writeInTenant(req, (tx, tenant) => reorderRouteCustomers(tx, tenant, routeId, memberIds, requestMeta(req))) };
  });

  app.post("/routes/:routeId/optimize", async (req) => {
    const { routeId } = routeParams.parse(req.params);
    const { apply } = optimizeBody.parse(req.body ?? {});
    const tenant = await requireTenant(db, authOf(req).user);
    await requirePermission(db, tenant, apply ? "distribution.manage" : "distribution.view");
    const { plan, memberIds } = await planRouteCustomersOrder(db, tenant, routeId);
    const applied = apply && memberIds.length > 0;
    const route = applied
      ? await writeInTenant(req, (tx, writer) => reorderRouteCustomers(tx, writer, routeId, memberIds, requestMeta(req)))
      : await getRoute(db, tenant, routeId);
    return { route, plan, applied };
  });

  app.get("/map", async (req) => distributionMap(db, await readTenant(req)));

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

  // ─── Sanaga biriktirish ──────────────────────────────────────────────────

  app.get("/assignments", async (req) => {
    const query = assignmentsQuery.parse(req.query);
    return { assignments: await listAssignments(db, await readTenant(req), query) };
  });

  app.post("/assignments", async (req, reply) => {
    const body = assignmentBody.parse(req.body);
    const assignment = await writeInTenant(req, (tx, tenant) => assignRoute(tx, tenant, body, requestMeta(req)));
    reply.status(201);
    return { assignment };
  });

  app.delete("/assignments/:assignmentId", async (req, reply) => {
    const { assignmentId } = assignmentParams.parse(req.params);
    await writeInTenant(req, (tx, tenant) => deleteAssignment(tx, tenant, assignmentId, requestMeta(req)));
    return reply.status(204).send();
  });
}
