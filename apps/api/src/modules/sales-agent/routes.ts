/**
 * /api/sales-agent — sotuv agentining mobil ish joyi va supervayzer nazorati.
 *
 * Agent (`sales_agent.use` + bog'langan faol agent; `agentId` hech qachon so'rovdan olinmaydi):
 *   GET  /me                                        agent profili va kompaniya
 *   GET  /today (?lat=&lng=)                        bugungi marshrut, do'konlari va ularning tashrif holati
 *   GET  /stores (?scope=today|all&search=&lat=&lng=&limit=)   do'konlar (joy berilsa — yaqinidan)
 *   GET  /stores/:customerId (?lat=&lng=)           do'kon profili va bugungi tashrifi (faqat agentga ochiq do'kon)
 *   GET  /debtors (?filter=overdue|today|soon|all&lat=&lng=)   qarzdorlar
 *   POST /location                                  joriy lokatsiya (server sifatni tekshiradi)
 *   POST /location/events                           ruxsat berilmadi / aniqlab bo'lmadi
 *   GET  /visits/current, GET /visits (?date=)      ochiq tashrif, kunlik tashriflar
 *   POST /visits/start                              tashrifni boshlash (joy sifati va geofence)
 *   POST /visits/:visitId/complete                  yakunlash (buyurtmasiz sabab, siyosat bo'yicha rasm)
 *   POST /visits/:visitId/photos/uploads            rasm uchun imzolangan yuklash URL
 *   POST /visits/:visitId/photos                    yuklangan rasmni biriktirish
 *   GET  /visits/:visitId/photos/:photoId/url       rasmni ko'rish (imzolangan, 5 daqiqa)
 *   GET  /catalog (?search=&categoryId=&limit=&offset=), GET /catalog/:productId/image   katalog (dona/blok, qoldiq)
 *   GET  /orders (?state=draft|submitted&customerId=), GET /orders/:orderId              o'z buyurtmalari
 *   PUT  /orders/drafts/:clientRequestId            qoralama (idempotent: bir identifikator — bitta buyurtma)
 *   POST /orders/:orderId/submit                    yuborish (geofence, kredit, qoldiq — atomar)
 *   POST /orders/:orderId/cancel                    yuborilmagan / tasdiq kutayotganini bekor qilish
 * Siyosat:
 *   GET  /policy                                    sales_agent.use yoki sales_agent.supervise
 *   PUT  /policy                                    sales_agent.supervise
 * Supervayzer:
 *   GET  /supervisor/agents                         sales_agent.location.view — holat, oxirgi joy, bugungi marshrut
 *   GET  /supervisor/live (?since=)                 sales_agent.location.live — yangilangan joylar
 *   GET  /supervisor/agents/:salesRepId/history (?date=)   sales_agent.location.history (audit)
 *   GET  /supervisor/events (?date=&type=&salesRepId=&limit=)   sales_agent.supervise
 *   GET  /supervisor/visits (?date=&salesRepId=&limit=)        sales_agent.supervise — tashriflar va sabablar
 *   GET  /supervisor/visits/:visitId/photos/:photoId/url       sales_agent.supervise
 *   GET  /supervisor/orders (?approval=&date=&salesRepId=)     sales_agent.supervise — agent buyurtmalari
 *   POST /supervisor/orders/:orderId/approve|reject            sales_agent.supervise — kredit limiti tasdig'i
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { forbidden, type Permission } from "@bum/shared";
import { db } from "../../db/client.js";
import { companies } from "../../db/schema/platform.js";
import { agentLocationEvents, agentOrders, agentVisitPhotos, agentVisits } from "../../db/schema/sales-agent.js";
import { withTransaction, type Tx } from "../../db/transaction.js";
import { requestMeta } from "../../shared/audit.js";
import { qtySchema } from "../../shared/decimal.js";
import type { GeoPoint } from "../../shared/geo.js";
import { storageProvider } from "../../shared/storage.js";
import { authOf, requireAuth } from "../auth/guard.js";
import {
  effectivePermissions,
  requirePermission,
  requireTenant,
  requireTenantForWrite,
  type TenantContext,
} from "../company/tenant.js";
import { todayIso } from "../finance/cash.service.js";
import { requireAgent, type AgentContext } from "./agent-context.js";
import {
  agentCatalog,
  approveAgentOrder,
  cancelAgentOrder,
  catalogImageUrl,
  getAgentOrder,
  listAgentOrders,
  rejectAgentOrder,
  saveAgentDraft,
  submitAgentOrder,
  supervisorOrders,
} from "./agent-orders.service.js";
import { recordAgentLocation, reportLocationProblem } from "./location.service.js";
import { getSalesAgentPolicy, salesAgentPolicySchema, saveSalesAgentPolicy } from "./policy.service.js";
import { agentDebtors, agentStore, agentStores, agentToday } from "./stores.service.js";
import { agentLocationHistory, locationEvents, supervisorAgents, supervisorLive } from "./supervisor.service.js";
import {
  addVisitPhoto,
  agentVisitsOn,
  completeVisit,
  createVisitPhotoUpload,
  currentVisit,
  latestStoreVisit,
  startVisit,
  storeVisitStatuses,
  supervisorVisits,
  visitPhotoUrl,
  type VisitOutcome,
} from "./visits.service.js";

const originShape = {
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
};
const pairedOrigin = (query: { lat?: number; lng?: number }) => (query.lat === undefined) === (query.lng === undefined);
const pairMessage = { message: "lat va lng birga beriladi" };
const originQuery = z.object(originShape).refine(pairedOrigin, pairMessage);
const storesQuery = z
  .object({
    ...originShape,
    scope: z.enum(["today", "all"]).default("today"),
    search: z.string().trim().min(1).max(100).optional(),
    limit: z.coerce.number().int().min(1).max(500).default(200),
  })
  .refine(pairedOrigin, pairMessage);
const debtorsQuery = z
  .object({ ...originShape, filter: z.enum(["overdue", "today", "soon", "all"]).default("all") })
  .refine(pairedOrigin, pairMessage);
const storeParams = z.object({ customerId: z.uuid() });

const locationFields = {
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy: z.number().min(0).max(100_000),
  recordedAt: z.iso.datetime({ offset: true }).transform((value) => new Date(value)),
};
const locationBody = z.strictObject({ ...locationFields, mocked: z.boolean().optional() });
const problemBody = z.strictObject({
  type: z.enum(["permission_denied", "update_failure"]),
  message: z.string().trim().max(500).nullable().optional(),
});

const visitStartBody = z.strictObject({ customerId: z.uuid(), ...locationFields });
const visitCompleteBody = z.strictObject({
  ...locationFields,
  noOrderReason: z.enum(agentVisits.noOrderReason.enumValues).optional(),
  noOrderComment: z.string().trim().max(500).optional(),
  notes: z.string().trim().max(1000).optional(),
});
const visitParams = z.object({ visitId: z.uuid() });
const photoParams = z.object({ visitId: z.uuid(), photoId: z.uuid() });
const photoUploadBody = z.strictObject({
  contentType: z.string().trim().toLowerCase().max(100),
  size: z.number().int().positive(),
});
const photoBody = z
  .strictObject({
    key: z.string().trim().min(1).max(300),
    kind: z.enum(agentVisitPhotos.kind.enumValues),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    accuracy: z.number().min(0).max(100_000).nullable().optional(),
  })
  .refine((body) => (body.latitude === undefined) === (body.longitude === undefined), {
    message: "latitude va longitude birga beriladi",
  });

const isoDate = z.iso.date();
const dateQuery = z.object({ date: isoDate.optional() });
const historyParams = z.object({ salesRepId: z.uuid() });
const liveQuery = z.object({ since: z.iso.datetime({ offset: true }).transform((value) => new Date(value)).optional() });
const eventsQuery = z.object({
  date: isoDate.optional(),
  type: z.enum(agentLocationEvents.type.enumValues).optional(),
  salesRepId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
const supervisorVisitsQuery = z.object({
  date: isoDate.optional(),
  salesRepId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(300),
});

const catalogQuery = z.object({
  search: z.string().trim().min(1).max(100).optional(),
  categoryId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
});
const productParams = z.object({ productId: z.uuid() });
const orderLine = z.strictObject({
  productId: z.uuid(),
  pieces: qtySchema.default("0"),
  boxes: qtySchema.default("0"),
});
const draftBody = z.strictObject({
  customerId: z.uuid(),
  items: z.array(orderLine).min(1).max(200),
  paymentType: z.enum(agentOrders.paymentType.enumValues).default("cash"),
  paymentDueDate: isoDate.nullable().optional(),
  deliveryDate: isoDate.nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
});
const draftParams = z.object({ clientRequestId: z.uuid() });
const orderParams = z.object({ orderId: z.uuid() });
const agentOrdersQuery = z.object({
  state: z.enum(["draft", "submitted"]).optional(),
  customerId: z.uuid().optional(),
});
const cancelBody = z.strictObject({ reason: z.string().trim().max(500).nullable().optional() });
const supervisorOrdersQuery = z.object({
  approval: z.enum(agentOrders.approvalStatus.enumValues).optional(),
  date: isoDate.optional(),
  salesRepId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
const rejectBody = z.strictObject({ reason: z.string().trim().min(3).max(500) });

const originOf = (query: { lat?: number; lng?: number }): GeoPoint | null =>
  query.lat !== undefined && query.lng !== undefined ? { latitude: query.lat, longitude: query.lng } : null;

async function readAgent(req: FastifyRequest): Promise<AgentContext> {
  const tenant = await requireTenant(db, authOf(req).user);
  await requirePermission(db, tenant, "sales_agent.use");
  return requireAgent(db, tenant);
}

function writeAgent<T>(req: FastifyRequest, fn: (tx: Tx, context: AgentContext) => Promise<T>): Promise<T> {
  return withTransaction(async (tx) => {
    const tenant = await requireTenantForWrite(tx, authOf(req).user);
    await requirePermission(tx, tenant, "sales_agent.use");
    return fn(tx, await requireAgent(tx, tenant));
  });
}

async function readTenantWith(req: FastifyRequest, permission: Permission): Promise<TenantContext> {
  const tenant = await requireTenant(db, authOf(req).user);
  await requirePermission(db, tenant, permission);
  return tenant;
}

/** Rad etish hodisasi tranzaksiyada saqlangach xato qaytariladi. */
function visitOf<T>(outcome: VisitOutcome<T>): T {
  if ("blocked" in outcome) throw outcome.blocked;
  return outcome.visit;
}

function storageUnavailable(reply: FastifyReply) {
  return reply.status(503).send({ code: "SERVICE_UNAVAILABLE", message: "Fayl saqlash sozlanmagan (STORAGE_*)" });
}

export async function salesAgentRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  // ─── Agent ish joyi ──────────────────────────────────────────────────────

  app.get("/me", async (req) => {
    const context = await readAgent(req);
    const [company] = await db
      .select({ id: companies.id, name: companies.name, currency: companies.currency })
      .from(companies)
      .where(eq(companies.id, context.company.id))
      .limit(1);
    return { agent: context.agent, company: company! };
  });

  app.get("/today", async (req) => {
    const query = originQuery.parse(req.query);
    const context = await readAgent(req);
    const today = await agentToday(db, context, originOf(query));
    const statuses = await storeVisitStatuses(db, context, today.stores.map((store) => store.id), today.date);
    return { ...today, stores: today.stores.map((store) => ({ ...store, visitStatus: statuses.get(store.id) ?? "waiting" })) };
  });

  app.get("/stores", async (req) => {
    const query = storesQuery.parse(req.query);
    return { stores: await agentStores(db, await readAgent(req), { ...query, origin: originOf(query) }) };
  });

  app.get("/stores/:customerId", async (req) => {
    const { customerId } = storeParams.parse(req.params);
    const query = originQuery.parse(req.query);
    const context = await readAgent(req);
    const store = await agentStore(db, context, customerId, originOf(query));
    return { store: { ...store, todayVisit: await latestStoreVisit(db, context, customerId) } };
  });

  app.get("/debtors", async (req) => {
    const query = debtorsQuery.parse(req.query);
    return { debtors: await agentDebtors(db, await readAgent(req), { filter: query.filter, origin: originOf(query) }) };
  });

  // ─── Lokatsiya ───────────────────────────────────────────────────────────

  app.post("/location", async (req) => {
    const body = locationBody.parse(req.body);
    return writeAgent(req, (tx, context) => recordAgentLocation(tx, context, body));
  });

  app.post("/location/events", async (req, reply) => {
    const body = problemBody.parse(req.body);
    await writeAgent(req, (tx, context) => reportLocationProblem(tx, context, body, requestMeta(req)));
    return reply.status(204).send();
  });

  // ─── Tashriflar ──────────────────────────────────────────────────────────

  app.get("/visits/current", async (req) => ({ visit: await currentVisit(db, await readAgent(req)) }));

  app.get("/visits", async (req) => {
    const { date } = dateQuery.parse(req.query);
    return { visits: await agentVisitsOn(db, await readAgent(req), date ?? todayIso()) };
  });

  app.post("/visits/start", async (req, reply) => {
    const body = visitStartBody.parse(req.body);
    const visit = visitOf(await writeAgent(req, (tx, context) => startVisit(tx, context, body, requestMeta(req))));
    reply.status(201);
    return { visit };
  });

  app.post("/visits/:visitId/complete", async (req) => {
    const { visitId } = visitParams.parse(req.params);
    const body = visitCompleteBody.parse(req.body);
    return { visit: visitOf(await writeAgent(req, (tx, context) => completeVisit(tx, context, visitId, body, requestMeta(req)))) };
  });

  app.post("/visits/:visitId/photos/uploads", async (req, reply) => {
    const { visitId } = visitParams.parse(req.params);
    const body = photoUploadBody.parse(req.body);
    const client = storageProvider.client;
    if (!client) return storageUnavailable(reply);
    const upload = await writeAgent(req, (tx, context) => createVisitPhotoUpload(tx, context, visitId, body, client));
    reply.status(201);
    return upload;
  });

  app.post("/visits/:visitId/photos", async (req, reply) => {
    const { visitId } = visitParams.parse(req.params);
    const body = photoBody.parse(req.body);
    const client = storageProvider.client;
    if (!client) return storageUnavailable(reply);
    const photo = await writeAgent(req, (tx, context) => addVisitPhoto(tx, context, visitId, body, client, requestMeta(req)));
    reply.status(201);
    return { photo };
  });

  app.get("/visits/:visitId/photos/:photoId/url", async (req, reply) => {
    const ids = photoParams.parse(req.params);
    const client = storageProvider.client;
    if (!client) return storageUnavailable(reply);
    const context = await readAgent(req);
    return visitPhotoUrl(db, context.company.id, ids, client, context.agent.id);
  });

  // ─── Katalog va buyurtmalar ──────────────────────────────────────────────

  app.get("/catalog", async (req) => {
    const query = catalogQuery.parse(req.query);
    return agentCatalog(db, await readAgent(req), query);
  });

  app.get("/catalog/:productId/image", async (req, reply) => {
    const { productId } = productParams.parse(req.params);
    const client = storageProvider.client;
    if (!client) return storageUnavailable(reply);
    return catalogImageUrl(db, await readAgent(req), productId, client);
  });

  app.get("/orders", async (req) => {
    const query = agentOrdersQuery.parse(req.query);
    return { orders: await listAgentOrders(db, await readAgent(req), query) };
  });

  app.get("/orders/:orderId", async (req) => {
    const { orderId } = orderParams.parse(req.params);
    return { order: await getAgentOrder(db, await readAgent(req), orderId) };
  });

  app.put("/orders/drafts/:clientRequestId", async (req) => {
    const { clientRequestId } = draftParams.parse(req.params);
    const body = draftBody.parse(req.body);
    return { order: await writeAgent(req, (tx, context) => saveAgentDraft(tx, context, clientRequestId, body, requestMeta(req))) };
  });

  app.post("/orders/:orderId/submit", async (req) => {
    const { orderId } = orderParams.parse(req.params);
    const body = locationBody.parse(req.body);
    const outcome = await writeAgent(req, (tx, context) => submitAgentOrder(tx, context, orderId, body, requestMeta(req)));
    if ("blocked" in outcome) throw outcome.blocked;
    return { order: outcome.order };
  });

  app.post("/orders/:orderId/cancel", async (req) => {
    const { orderId } = orderParams.parse(req.params);
    const { reason } = cancelBody.parse(req.body ?? {});
    return { order: await writeAgent(req, (tx, context) => cancelAgentOrder(tx, context, orderId, reason ?? null, requestMeta(req))) };
  });

  // ─── Siyosat ─────────────────────────────────────────────────────────────

  app.get("/policy", async (req) => {
    const tenant = await requireTenant(db, authOf(req).user);
    const permissions = await effectivePermissions(db, tenant);
    if (!permissions.includes("sales_agent.use") && !permissions.includes("sales_agent.supervise")) {
      throw forbidden("Bu amal uchun ruxsat yo'q: sales_agent.use");
    }
    return { policy: await getSalesAgentPolicy(db, tenant.company.id) };
  });

  app.put("/policy", async (req) => {
    const body = salesAgentPolicySchema.parse(req.body);
    const policy = await withTransaction(async (tx) => {
      const tenant = await requireTenantForWrite(tx, authOf(req).user);
      await requirePermission(tx, tenant, "sales_agent.supervise");
      return saveSalesAgentPolicy(tx, tenant, body, requestMeta(req));
    });
    return { policy };
  });

  // ─── Supervayzer ─────────────────────────────────────────────────────────

  app.get("/supervisor/agents", async (req) => ({
    agents: await supervisorAgents(db, await readTenantWith(req, "sales_agent.location.view")),
  }));

  app.get("/supervisor/live", async (req) => {
    const { since } = liveQuery.parse(req.query);
    const tenant = await readTenantWith(req, "sales_agent.location.live");
    return { locations: await supervisorLive(db, tenant, since ?? new Date(Date.now() - 15 * 60_000)), serverTime: new Date() };
  });

  app.get("/supervisor/agents/:salesRepId/history", async (req) => {
    const { salesRepId } = historyParams.parse(req.params);
    const { date } = dateQuery.parse(req.query);
    const tenant = await readTenantWith(req, "sales_agent.location.history");
    return agentLocationHistory(db, tenant, salesRepId, date ?? todayIso(), requestMeta(req));
  });

  app.get("/supervisor/events", async (req) => {
    const query = eventsQuery.parse(req.query);
    const tenant = await readTenantWith(req, "sales_agent.supervise");
    return { events: await locationEvents(db, tenant, { ...query, date: query.date ?? todayIso() }) };
  });

  app.get("/supervisor/visits", async (req) => {
    const query = supervisorVisitsQuery.parse(req.query);
    const tenant = await readTenantWith(req, "sales_agent.supervise");
    return supervisorVisits(db, tenant, { ...query, date: query.date ?? todayIso() });
  });

  app.get("/supervisor/orders", async (req) => {
    const query = supervisorOrdersQuery.parse(req.query);
    return { orders: await supervisorOrders(db, await readTenantWith(req, "sales_agent.supervise"), query) };
  });

  app.post("/supervisor/orders/:orderId/approve", async (req) => {
    const { orderId } = orderParams.parse(req.params);
    const order = await withTransaction(async (tx) => {
      const tenant = await requireTenantForWrite(tx, authOf(req).user);
      await requirePermission(tx, tenant, "sales_agent.supervise");
      return approveAgentOrder(tx, tenant, orderId, requestMeta(req));
    });
    return { order };
  });

  app.post("/supervisor/orders/:orderId/reject", async (req) => {
    const { orderId } = orderParams.parse(req.params);
    const { reason } = rejectBody.parse(req.body);
    const order = await withTransaction(async (tx) => {
      const tenant = await requireTenantForWrite(tx, authOf(req).user);
      await requirePermission(tx, tenant, "sales_agent.supervise");
      return rejectAgentOrder(tx, tenant, orderId, reason, requestMeta(req));
    });
    return { order };
  });

  app.get("/supervisor/visits/:visitId/photos/:photoId/url", async (req, reply) => {
    const ids = photoParams.parse(req.params);
    const client = storageProvider.client;
    if (!client) return storageUnavailable(reply);
    const tenant = await readTenantWith(req, "sales_agent.supervise");
    return visitPhotoUrl(db, tenant.company.id, ids, client);
  });
}
