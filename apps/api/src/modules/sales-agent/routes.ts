/**
 * /api/sales-agent — sotuv agentining mobil ish joyi va supervayzer nazorati.
 *
 * Agent (`sales_agent.use` + bog'langan faol agent; `agentId` hech qachon so'rovdan olinmaydi):
 *   GET  /me                                        agent profili va kompaniya
 *   GET  /today (?lat=&lng=)                        bugungi marshrut, do'konlari va ularning tashrif holati
 *   GET  /stores (?scope=today|all&search=&lat=&lng=&limit=)   do'konlar (joy berilsa — yaqinidan)
 *   GET  /stores/:customerId (?lat=&lng=)           do'kon profili va bugungi tashrifi (faqat agentga ochiq do'kon)
 *   GET  /debtors (?filter=overdue|today|soon|all&lat=&lng=)   qarzdorlar
 *   GET  /cash                                      agentdagi topshirilmagan naqd
 *   POST /payments                                  mijozdan to'lov qabul qilish (naqd — agent hisobiga)
 *   GET  /customers/:customerId/history             mijoz tarixi: buyurtmalar, to'lovlar, o'z tashriflari, o'rtachalar
 *   PATCH /customers/:customerId                    aloqa ma'lumotlari (sales_agent.customer.edit)
 *   PUT  /customers/:customerId/location            joylashuv — mijoz yonida (sales_agent.customer.location.edit)
 *   POST /customers/:customerId/photo, GET .../photo   vitrina rasmi (sales_agent.customer.photo.create)
 *   POST /location                                  joriy lokatsiya (server sifatni tekshiradi)
 *   POST /location/events                           ruxsat berilmadi / aniqlab bo'lmadi
 *   GET  /visits/current, GET /visits (?date=)      ochiq tashrif, kunlik tashriflar
 *   POST /visits/start                              tashrifni boshlash (joy sifati va geofence)
 *   POST /visits/:visitId/complete                  BUYURTMA YO'Q (sabab; rasmlar va minimal vaqt siyosat bo'yicha)
 *   POST /visits/:visitId/photos/uploads            rasm uchun imzolangan yuklash URL (S3)
 *   POST /visits/:visitId/photos                    yuklangan rasmni biriktirish (do'kon hududida)
 *   POST /visits/:visitId/photos/direct             S3 sozlanmaganda: rasm bazaga (base64, 3 MB gacha)
 *   GET  /visits/:visitId/photos/:photoId/url       rasmni ko'rish havolasi (imzolangan 5 daqiqa yoki /content)
 *   GET  /visits/:visitId/photos/:photoId/content   bazadagi rasm
 *   GET  /catalog (?search=&categoryId=&brandId=&limit=&offset=), GET /catalog/:productId/image   katalog (dona/blok, qoldiq, rasm)
 *   GET  /catalog/filters                           kategoriya va brendlar (agentga ko'rinadigan mahsulotlardan)
 *   GET  /orders (?state=draft|submitted&customerId=), GET /orders/:orderId              o'z buyurtmalari
 *   PUT  /orders/drafts/:clientRequestId            qoralama (idempotent: bir identifikator — bitta buyurtma)
 *   POST /orders/:orderId/submit                    yuborish (geofence, kredit, qoldiq — atomar)
 *   POST /orders/:orderId/cancel                    yuborilmagan / tasdiq kutayotganini bekor qilish
 *   GET  /promotions (?filter=active|upcoming|ending_soon)     aksiyalar (hisoblash buyurtmada, serverda)
 *   GET  /dashboard                                 bugungi savdo va plan, tashriflar, oylik plan, o'rin
 *   GET  /reports (?from=&to=)                      hisobotlar: sotuv, tashrif, plan, qarz, aksiya (93 kungacha, faqat o'zi)
 *   GET  /prospects, POST /prospects                yangi mijoz topish (o'zi yuborganlari)
 * Siyosat:
 *   GET  /policy                                    sales_agent.use yoki sales_agent.supervise
 *   PUT  /policy                                    sales_agent.supervise
 *   GET  /policy/recipients                         sales_agent.supervise — bildirishnoma oluvchi nomzodlar (faol a'zolar)
 * Supervayzer:
 *   GET  /supervisor/agents                         sales_agent.location.view — holat, oxirgi joy, bugungi marshrut
 *   GET  /supervisor/agents/:salesRepId             sales_agent.location.view — bugungi do'konlar, tashrif holati, savdo
 *   GET  /supervisor/prospects, POST /supervisor/prospects/:id/convert|reject   sales_agent.supervise
 *   GET  /supervisor/live (?since=)                 sales_agent.location.live — yangilangan joylar
 *   GET  /supervisor/agents/:salesRepId/history (?date=)   sales_agent.location.history (audit)
 *   GET  /supervisor/events (?date=&type=&salesRepId=&limit=)   sales_agent.supervise
 *   GET  /supervisor/visits (?date=&salesRepId=&limit=)        sales_agent.supervise — tashriflar va sabablar
 *   GET  /supervisor/visits/:visitId/photos/:photoId/url       sales_agent.supervise
 *   GET  /supervisor/orders (?approval=&date=&salesRepId=)     sales_agent.supervise — agent buyurtmalari
 *   POST /supervisor/orders/:orderId/approve|reject            sales_agent.supervise — kredit limiti tasdig'i
 *   GET/POST /supervisor/promotions, PATCH/DELETE /supervisor/promotions/:promotionId   promotions.manage
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { forbidden, notFound, type Permission } from "@bum/shared";
import { db } from "../../db/client.js";
import { products } from "../../db/schema/catalog.js";
import { companies } from "../../db/schema/platform.js";
import {
  agentLocationEvents,
  agentOrders,
  agentProspects,
  agentVisitPhotos,
  agentVisits,
  promotions,
} from "../../db/schema/sales-agent.js";
import { loadProductImage } from "../files/files.service.js";
import { sendStoredImage } from "../files/routes.js";
import { withTransaction, type Tx } from "../../db/transaction.js";
import { requestMeta } from "../../shared/audit.js";
import { MAX_PAYMENT_PARTS } from "@bum/shared";
import { moneySchema, percentSchema, qtySchema } from "../../shared/decimal.js";
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
import { VIEW_TTL } from "../files/files.service.js";
import { todayIso } from "../finance/cash.service.js";
import { requireAgent, type AgentContext } from "./agent-context.js";
import {
  agentCatalog,
  approveAgentOrder,
  catalogFilters,
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
import { repCashSummary, salesRepCashAccount } from "./agent-cash.service.js";
import { recordMixedCustomerPayment } from "../sales/payment-allocation.service.js";
import { notifyCustomerPaymentReceived } from "../telegram/notify.service.js";
import { alertSuspiciousLocation } from "../telegram/alerts.service.js";
import { getSalesAgentPolicy, recipientCandidates, salesAgentPolicySchema, saveSalesAgentPolicy } from "./policy.service.js";
import { agentPromotions, createPromotion, deletePromotion, listPromotions, updatePromotion } from "./promotions.service.js";
import { agentDashboard } from "./dashboard.service.js";
import { agentReport } from "./reports.service.js";
import { createSalesAgent, listTeam, supervisorCandidates, updateTeamMember } from "./team.service.js";
import { currentWorkSession, endWorkSession, startWorkSession } from "./work-session.service.js";
import { addCustomerPhoto, customerHistory, customerPhotoContent, saveCustomerLocation, updateAgentCustomer } from "./customers.service.js";
import { convertProspect, createProspect, listAgentProspects, rejectProspect, supervisorProspects } from "./prospects.service.js";
import { accessibleStore, agentDebtors, agentStore, agentStores, agentToday } from "./stores.service.js";
import {
  agentLocationHistory,
  locationEvents,
  supervisorAgentDetail,
  supervisorAgents,
  supervisorLive,
} from "./supervisor.service.js";
import {
  addDirectVisitPhoto,
  addVisitPhoto,
  agentVisitsOn,
  completeVisit,
  createVisitPhotoUpload,
  currentVisit,
  latestStoreVisit,
  startVisit,
  storeVisitStatuses,
  supervisorVisits,
  visitPhotoContent,
  visitPhotoRef,
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
/** Agent qabul qilgan to'lov: aralash ham bo'lishi mumkin (naqd + karta). */
const agentPaymentBody = z.strictObject({
  customerId: z.uuid(),
  orderId: z.uuid().nullable().optional(),
  /** Takroriy yuborishda ikkinchi to'lov yozilmasin. */
  clientRequestId: z.uuid(),
  parts: z
    .array(
      z.strictObject({
        method: z.enum(["cash", "card", "bank"]),
        amount: moneySchema,
        terminalId: z.uuid().nullable().optional(),
      }),
    )
    .min(1)
    .max(MAX_PAYMENT_PARTS),
  notes: z.string().trim().max(500).nullable().optional(),
});

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
const sessionEndBody = z
  .strictObject({
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    accuracy: z.number().min(0).max(100_000).optional(),
    recordedAt: z.iso.datetime({ offset: true }).transform((value) => new Date(value)).optional(),
  })
  .refine((body) => (body.latitude === undefined) === (body.longitude === undefined), {
    message: "latitude va longitude birga beriladi",
  });
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
/** Rasm joyi majburiy — server rasm do'kon hududida olinganini tekshiradi. */
const photoPlace = {
  kind: z.enum(agentVisitPhotos.kind.enumValues),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy: z.number().min(0).max(100_000),
  recordedAt: z.iso.datetime({ offset: true }).transform((value) => new Date(value)).optional(),
};
const photoBody = z.strictObject({ key: z.string().trim().min(1).max(300), ...photoPlace });
const directPhotoBody = z.strictObject({
  ...photoPlace,
  contentType: z.string().trim().toLowerCase().max(100),
  /** Base64; turi va hajmi serverda baytlardan tekshiriladi. */
  data: z.string().min(8).max(4_100_000).regex(/^[A-Za-z0-9+/]+={0,2}$/, "base64 emas"),
});
/** JSON'dagi base64 rasm uchun (3 MB → ~4 MB matn). */
const DIRECT_PHOTO_BODY_LIMIT = 6 * 1024 * 1024;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => value || null)
    .nullable()
    .optional();
/** Faqat aloqa ma'lumotlari — moliyaviy maydonlar (limit, chegirma, muddat) rad etiladi. */
const customerPatchBody = z.strictObject({
  contactName: optionalText(200),
  phone: optionalText(20),
  address: optionalText(500),
  notes: optionalText(1000),
});
const customerLocationBody = z.strictObject(locationFields);
const customerPhotoBody = z.strictObject({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy: z.number().min(0).max(100_000),
  recordedAt: z.iso.datetime({ offset: true }).transform((value) => new Date(value)).optional(),
  contentType: z.string().trim().toLowerCase().max(100),
  data: z.string().min(8).max(4_100_000).regex(/^[A-Za-z0-9+/]+={0,2}$/, "base64 emas"),
});

const isoDate = z.iso.date();
const dateQuery = z.object({ date: isoDate.optional() });
const reportQuery = z.object({ from: isoDate.optional(), to: isoDate.optional() });
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
  brandId: z.uuid().optional(),
  /** Do'kon tanlangan bo'lsa narx shu mijoz bilan kelishilganidan olinadi. */
  customerId: z.uuid().optional(),
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

const teamCreateBody = z.strictObject({
  name: z.string().trim().min(1).max(200),
  phone: z.string().trim().min(1).max(32),
  password: z.string().min(1).max(256),
  region: z.string().trim().max(100).nullable().optional(),
  supervisorUserId: z.uuid().nullable().optional(),
  monthlyTarget: moneySchema.optional(),
  hireDate: isoDate.optional(),
});
const teamPatchBody = z.strictObject({
  name: z.string().trim().min(1).max(200).optional(),
  region: z.string().trim().max(100).nullable().optional(),
  supervisorUserId: z.uuid().nullable().optional(),
  monthlyTarget: moneySchema.optional(),
  isActive: z.boolean().optional(),
});
const teamParams = z.object({ salesRepId: z.uuid() });
const prospectBody = z
  .strictObject({
    name: z.string().trim().min(1).max(200),
    phone: z.string().trim().max(20).nullable().optional(),
    address: z.string().trim().max(500).nullable().optional(),
    comment: z.string().trim().max(1000).nullable().optional(),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    accuracy: z.number().min(0).max(100_000).nullable().optional(),
  })
  .refine((body) => (body.latitude === undefined) === (body.longitude === undefined), {
    message: "latitude va longitude birga beriladi",
  });
const prospectsQuery = z.object({ status: z.enum(agentProspects.status.enumValues).optional() });
const prospectParams = z.object({ prospectId: z.uuid() });
const convertBody = z.strictObject({ routeId: z.uuid().nullable().optional() });
const agentPromotionsQuery = z.object({ filter: z.enum(["active", "upcoming", "ending_soon"]).default("active") });
const managePromotionsQuery = z.object({ status: z.enum(["active", "upcoming", "ended", "all"]).default("all") });
const promotionParams = z.object({ promotionId: z.uuid() });
const promotionShape = {
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).nullable().optional(),
  type: z.enum(promotions.type.enumValues),
  productId: z.uuid(),
  minQuantity: qtySchema,
  freeQuantity: qtySchema.nullable().optional(),
  discountPercent: percentSchema.nullable().optional(),
  startsAt: isoDate,
  endsAt: isoDate,
  isActive: z.boolean().optional(),
};
const promotionBody = z.strictObject(promotionShape);
const promotionPatch = z.strictObject(promotionShape).partial();

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

/** Agent amali qo'shimcha ruxsat bilan (masalan, mijozni tahrirlash). */
function writeAgentWith<T>(req: FastifyRequest, permission: Permission, fn: (tx: Tx, context: AgentContext) => Promise<T>): Promise<T> {
  return withTransaction(async (tx) => {
    const tenant = await requireTenantForWrite(tx, authOf(req).user);
    await requirePermission(tx, tenant, "sales_agent.use");
    await requirePermission(tx, tenant, permission);
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

/** Rasm havolasi: bazadagi rasm — shu API'ning autentifikatsiyali `/content` yo'li, S3 dagisi — imzolangan havola. */
async function photoLink(
  reply: FastifyReply,
  ref: { key: string; inDatabase: boolean },
  contentPath: string,
): Promise<{ url: string; expiresIn: number } | FastifyReply> {
  if (ref.inDatabase) return { url: contentPath, expiresIn: VIEW_TTL };
  const client = storageProvider.client;
  if (!client) return storageUnavailable(reply);
  return { url: client.signedUrl("GET", ref.key, VIEW_TTL), expiresIn: VIEW_TTL };
}

function sendPhoto(reply: FastifyReply, photo: { content: Buffer; contentType: string }) {
  return reply
    .header("content-type", photo.contentType)
    .header("cache-control", "private, no-store")
    .header("x-content-type-options", "nosniff")
    .send(photo.content);
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

  // ─── Mijozdan to'lov qabul qilish ────────────────────────────────────────
  // Naqd pul agentning "yo'ldagi naqd" hisobiga tushadi — kassaga topshirilguncha
  // kimda qancha borligi moliyada ko'rinib turadi.

  app.get("/cash", async (req) => {
    const context = await readAgent(req);
    return repCashSummary(db, context.company.id, context.agent.id);
  });

  app.post("/payments", async (req, reply) => {
    const body = agentPaymentBody.parse(req.body);
    const result = await writeAgent(req, async (tx, context) => {
      const cashAccountId = await salesRepCashAccount(tx, context.company.id, context.agent);
      const payment = await recordMixedCustomerPayment(
        tx,
        context,
        {
          source: "sales_payment",
          customerId: body.customerId,
          orderId: body.orderId ?? null,
          // Naqd — agent hisobiga; karta/bank — o'z hisobiga (terminal bo'yicha)
          parts: body.parts.map((part) => (part.method === "cash" ? { ...part, cashAccountId } : part)),
          idempotencyKey: `agent_payment:${body.clientRequestId}`,
          notes: body.notes ?? null,
        },
        requestMeta(req),
      );
      return { payment, companyId: context.company.id, agentName: context.agent.name };
    });

    // Xabar tranzaksiyadan KEYIN — tarmoq kutishi bazani band qilmasin
    void notifyCustomerPaymentReceived({
      companyId: result.companyId,
      customerId: body.customerId,
      amount: body.parts.reduce((sum, part) => sum + Number(part.amount), 0).toFixed(2),
      method: body.parts.length === 1 ? (body.parts[0]?.method ?? "cash") : "aralash",
      collectedBy: `Savdo agenti ${result.agentName}`,
    });

    reply.status(result.payment.created ? 201 : 200);
    return result.payment;
  });

  app.get("/debtors", async (req) => {
    const query = debtorsQuery.parse(req.query);
    return { debtors: await agentDebtors(db, await readAgent(req), { filter: query.filter, origin: originOf(query) }) };
  });

  // ─── Mijozlar ────────────────────────────────────────────────────────────

  app.get("/customers/:customerId/history", async (req) => {
    const { customerId } = storeParams.parse(req.params);
    return customerHistory(db, await readAgent(req), customerId);
  });

  app.patch("/customers/:customerId", async (req) => {
    const { customerId } = storeParams.parse(req.params);
    const body = customerPatchBody.parse(req.body);
    const store = await writeAgentWith(req, "sales_agent.customer.edit", (tx, context) =>
      updateAgentCustomer(tx, context, customerId, body, requestMeta(req)),
    );
    return { store };
  });

  app.put("/customers/:customerId/location", async (req) => {
    const { customerId } = storeParams.parse(req.params);
    const body = customerLocationBody.parse(req.body);
    const store = await writeAgentWith(req, "sales_agent.customer.location.edit", (tx, context) =>
      saveCustomerLocation(tx, context, customerId, body, requestMeta(req)),
    );
    return { store };
  });

  app.post("/customers/:customerId/photo", { bodyLimit: DIRECT_PHOTO_BODY_LIMIT }, async (req, reply) => {
    const { customerId } = storeParams.parse(req.params);
    const { data, contentType: _declared, ...point } = customerPhotoBody.parse(req.body);
    const photo = await writeAgentWith(req, "sales_agent.customer.photo.create", (tx, context) =>
      addCustomerPhoto(tx, context, customerId, { ...point, data: Buffer.from(data, "base64") }, requestMeta(req)),
    );
    reply.status(201);
    return { photo };
  });

  app.get("/customers/:customerId/photo", async (req, reply) => {
    const { customerId } = storeParams.parse(req.params);
    return sendPhoto(reply, await customerPhotoContent(db, await readAgent(req), customerId));
  });

  // ─── Ish sessiyasi ───────────────────────────────────────────────────────

  app.get("/work-session", async (req) => ({ session: await currentWorkSession(db, await readAgent(req)) }));

  app.post("/work-session/start", async (req, reply) => {
    const body = locationBody.parse(req.body);
    const result = await writeAgent(req, (tx, context) => startWorkSession(tx, context, body, requestMeta(req)));
    reply.status(result.created ? 201 : 200);
    return { session: result.session };
  });

  app.post("/work-session/end", async (req) => {
    const body = sessionEndBody.parse(req.body ?? {});
    return { session: await writeAgent(req, (tx, context) => endWorkSession(tx, context, body, requestMeta(req))) };
  });

  // ─── Lokatsiya ───────────────────────────────────────────────────────────

  app.post("/location", async (req) => {
    const body = locationBody.parse(req.body);
    let owner = { companyId: "", agent: "" };
    const result = await writeAgent(req, (tx, context) => {
      owner = { companyId: context.company.id, agent: context.agent.name ?? context.agent.code };
      return recordAgentLocation(tx, context, body);
    });
    // Soxta GPS yoki sakrash — egasiga darhol xabar (tranzaksiyadan keyin)
    if (result.accepted && result.suspicious) void alertSuspiciousLocation(owner.companyId, { agent: owner.agent, flags: result.flags });
    return result;
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

  app.post("/visits/:visitId/photos/direct", { bodyLimit: DIRECT_PHOTO_BODY_LIMIT }, async (req, reply) => {
    const { visitId } = visitParams.parse(req.params);
    const { data, contentType: _declared, ...body } = directPhotoBody.parse(req.body);
    const bytes = Buffer.from(data, "base64");
    const photo = await writeAgent(req, (tx, context) => addDirectVisitPhoto(tx, context, visitId, { ...body, data: bytes }, requestMeta(req)));
    reply.status(201);
    return { photo };
  });

  app.get("/visits/:visitId/photos/:photoId/url", async (req, reply) => {
    const ids = photoParams.parse(req.params);
    const context = await readAgent(req);
    const ref = await visitPhotoRef(db, context.company.id, ids, context.agent.id);
    return photoLink(reply, ref, `/api/sales-agent/visits/${ids.visitId}/photos/${ids.photoId}/content`);
  });

  app.get("/visits/:visitId/photos/:photoId/content", async (req, reply) => {
    const ids = photoParams.parse(req.params);
    const context = await readAgent(req);
    return sendPhoto(reply, await visitPhotoContent(db, context.company.id, ids, context.agent.id));
  });

  // ─── Katalog va buyurtmalar ──────────────────────────────────────────────

  app.get("/catalog", async (req) => {
    const query = catalogQuery.parse(req.query);
    const context = await readAgent(req);
    // Begona do'kon id'si bilan narx sizib chiqmasin — do'kon agentning marshrutida bo'lishi shart
    if (query.customerId) await accessibleStore(db, context, query.customerId);
    return agentCatalog(db, context, query, storageProvider.client);
  });

  app.get("/catalog/filters", async (req) => catalogFilters(db, await readAgent(req)));

  app.get("/catalog/:productId/image", async (req, reply) => {
    const { productId } = productParams.parse(req.params);
    // Saqlash (S3) sozlanmagan bo'lsa ham rasm bazadan beriladi — 503 faqat kalit saqlashda bo'lsa
    const result = await catalogImageUrl(db, await readAgent(req), productId, storageProvider.client);
    return result ?? storageUnavailable(reply);
  });

  /**
   * Bazadagi rasm mazmuni — AGENT ruxsati bilan (`/api/files/...` yo'li `products.view` talab qiladi,
   * sotuv agentida esa u yo'q). Faqat o'z kompaniyasining faol mahsuloti.
   */
  app.get("/catalog/:productId/image/content", async (req, reply) => {
    const { productId } = productParams.parse(req.params);
    const context = await readAgent(req);
    const [product] = await db
      .select({ id: products.id })
      .from(products)
      .where(and(eq(products.id, productId), eq(products.companyId, context.company.id), eq(products.isActive, true)))
      .limit(1);
    if (!product) throw notFound("Rasm topilmadi");
    const image = await loadProductImage(db, context.company.id, productId);
    if (image.kind !== "database") throw notFound("Rasm topilmadi");
    return sendStoredImage(reply, image);
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

  // ─── Agentlar jamoasi ("Sotuv agenti qo'shish") ──────────────────────────

  app.get("/team", async (req) => ({ agents: await listTeam(db, await readTenantWith(req, "sales_agent.agents.manage")) }));

  app.get("/team/supervisors", async (req) => {
    const tenant = await readTenantWith(req, "sales_agent.agents.manage");
    return { supervisors: await supervisorCandidates(db, tenant.company.id) };
  });

  app.post("/team", async (req, reply) => {
    const body = teamCreateBody.parse(req.body);
    const agent = await withTransaction(async (tx) => {
      const tenant = await requireTenantForWrite(tx, authOf(req).user);
      await requirePermission(tx, tenant, "sales_agent.agents.manage");
      return createSalesAgent(tx, tenant, body, requestMeta(req));
    });
    reply.status(201);
    return { agent };
  });

  app.patch("/team/:salesRepId", async (req) => {
    const { salesRepId } = teamParams.parse(req.params);
    const body = teamPatchBody.parse(req.body);
    const agent = await withTransaction(async (tx) => {
      const tenant = await requireTenantForWrite(tx, authOf(req).user);
      await requirePermission(tx, tenant, "sales_agent.agents.manage");
      return updateTeamMember(tx, tenant, salesRepId, body, requestMeta(req));
    });
    return { agent };
  });

  // ─── Bosh sahifa va yangi mijozlar ───────────────────────────────────────

  app.get("/dashboard", async (req) => agentDashboard(db, await readAgent(req)));

  app.get("/reports", async (req) => {
    const query = reportQuery.parse(req.query);
    const today = todayIso();
    return agentReport(db, await readAgent(req), { from: query.from ?? `${today.slice(0, 7)}-01`, to: query.to ?? today });
  });

  app.get("/prospects", async (req) => ({ prospects: await listAgentProspects(db, await readAgent(req)) }));

  app.post("/prospects", async (req, reply) => {
    const body = prospectBody.parse(req.body);
    const prospect = await writeAgent(req, (tx, context) => createProspect(tx, context, body, requestMeta(req)));
    reply.status(201);
    return { prospect };
  });

  app.get("/supervisor/prospects", async (req) => {
    const { status } = prospectsQuery.parse(req.query);
    return { prospects: await supervisorProspects(db, await readTenantWith(req, "sales_agent.supervise"), status) };
  });

  app.post("/supervisor/prospects/:prospectId/convert", async (req) => {
    const { prospectId } = prospectParams.parse(req.params);
    const body = convertBody.parse(req.body ?? {});
    return withTransaction(async (tx) => {
      const tenant = await requireTenantForWrite(tx, authOf(req).user);
      await requirePermission(tx, tenant, "sales_agent.supervise");
      return convertProspect(tx, tenant, prospectId, body, requestMeta(req));
    });
  });

  app.post("/supervisor/prospects/:prospectId/reject", async (req) => {
    const { prospectId } = prospectParams.parse(req.params);
    const { reason } = rejectBody.parse(req.body);
    const prospect = await withTransaction(async (tx) => {
      const tenant = await requireTenantForWrite(tx, authOf(req).user);
      await requirePermission(tx, tenant, "sales_agent.supervise");
      return rejectProspect(tx, tenant, prospectId, reason, requestMeta(req));
    });
    return { prospect };
  });

  // ─── Aksiyalar ───────────────────────────────────────────────────────────

  app.get("/promotions", async (req) => {
    const { filter } = agentPromotionsQuery.parse(req.query);
    return { promotions: await agentPromotions(db, await readAgent(req), filter) };
  });

  app.get("/supervisor/promotions", async (req) => {
    const { status } = managePromotionsQuery.parse(req.query);
    return { promotions: await listPromotions(db, await readTenantWith(req, "promotions.manage"), status) };
  });

  app.post("/supervisor/promotions", async (req, reply) => {
    const body = promotionBody.parse(req.body);
    const promotion = await withTransaction(async (tx) => {
      const tenant = await requireTenantForWrite(tx, authOf(req).user);
      await requirePermission(tx, tenant, "promotions.manage");
      return createPromotion(tx, tenant, body, requestMeta(req));
    });
    reply.status(201);
    return { promotion };
  });

  app.patch("/supervisor/promotions/:promotionId", async (req) => {
    const { promotionId } = promotionParams.parse(req.params);
    const body = promotionPatch.parse(req.body);
    const promotion = await withTransaction(async (tx) => {
      const tenant = await requireTenantForWrite(tx, authOf(req).user);
      await requirePermission(tx, tenant, "promotions.manage");
      return updatePromotion(tx, tenant, promotionId, body, requestMeta(req));
    });
    return { promotion };
  });

  app.delete("/supervisor/promotions/:promotionId", async (req, reply) => {
    const { promotionId } = promotionParams.parse(req.params);
    await withTransaction(async (tx) => {
      const tenant = await requireTenantForWrite(tx, authOf(req).user);
      await requirePermission(tx, tenant, "promotions.manage");
      await deletePromotion(tx, tenant, promotionId, requestMeta(req));
    });
    return reply.status(204).send();
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

  app.get("/policy/recipients", async (req) => {
    const tenant = await readTenantWith(req, "sales_agent.supervise");
    return { recipients: await recipientCandidates(db, tenant.company.id) };
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

  app.get("/supervisor/agents/:salesRepId", async (req) => {
    const { salesRepId } = historyParams.parse(req.params);
    return supervisorAgentDetail(db, await readTenantWith(req, "sales_agent.location.view"), salesRepId);
  });

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
    const tenant = await readTenantWith(req, "sales_agent.supervise");
    const ref = await visitPhotoRef(db, tenant.company.id, ids);
    return photoLink(reply, ref, `/api/sales-agent/supervisor/visits/${ids.visitId}/photos/${ids.photoId}/content`);
  });

  app.get("/supervisor/visits/:visitId/photos/:photoId/content", async (req, reply) => {
    const ids = photoParams.parse(req.params);
    const tenant = await readTenantWith(req, "sales_agent.supervise");
    return sendPhoto(reply, await visitPhotoContent(db, tenant.company.id, ids));
  });
}
