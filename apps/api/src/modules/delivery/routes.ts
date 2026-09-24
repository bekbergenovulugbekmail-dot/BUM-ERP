/**
 * /api/delivery — dostavka (yetkazib berish) moduli. ORDER ≠ DELIVERY: yetkazma buyurtmadan alohida.
 *
 * Boshqaruv (supervayzer / menejer):
 *   GET  /policy                                   delivery.view yoki delivery.accept (agent)
 *   PUT  /policy, GET /policy/recipients           delivery.manage
 *   GET  /agents (?activeOnly=&branchId=&territory=)   delivery.view
 *   GET  /agents/supervisors                       delivery.manage — supervayzer nomzodlari
 *   POST /agents, PATCH /agents/:agentId           delivery.manage — xodim + login + rol + profil; faolsizlantirish
 *   GET  /agents/live                              delivery.view_location — joriy joy, ish sessiyasi, joriy yetkazma
 *   GET  /agents/:agentId/track (?date=)           delivery.view_location — kunlik iz (audit)
 *   GET  /agents/:agentId/cash                     delivery.view — yetkazuvchidagi (kassaga topshirilmagan) naqd
 *   POST /agents/:agentId/cash-handover            delivery.manage (boshqa kassaga — finance.manage) — naqdni kassaga topshirish
 *   GET  /dashboard (?date=)                       delivery.view
 *   GET  /reports (?from=&to=&agentId=)            delivery.view_reports
 *   GET  /ready-orders (?search=&limit=)           delivery.manage — yetkazma yaratiladigan buyurtmalar
 *   GET  /waybill (?agentId=&date=)                delivery.view — nakladnoy (qarz faqat finance.view bilan)
 *   POST /waybills/bulk                            delivery.view — tanlanganlar uchun nakladnoy (holat o'zgarmaydi)
 *   GET  /tasks (?dateFrom=&dateTo=&status=&agentId=&unassigned=&branchId=&territory=&customerId=&search=&overdue=&reviewPending=&limit=&cursor=)   delivery.view
 *   POST /tasks                                    delivery.manage (+ delivery.assign — agent bilan)
 *   GET  /tasks/:taskId, GET /tasks/:taskId/proofs/:proofId   delivery.view
 *   PATCH /tasks/:taskId                           delivery.manage — ustuvorlik, izohlar, to'lov (yo'lga chiqquncha)
 *   POST /tasks/:taskId/assign                     delivery.assign (boshqa agentga — delivery.reassign)
 *   POST /tasks/:taskId/unassign                   delivery.reassign
 *   POST /tasks/:taskId/reschedule, /cancel        delivery.manage
 *   PUT  /route-order                              delivery.manage_routes
 *   POST /tasks/:taskId/return                     delivery.return — qaytgan mahsulot omborga (zaxira, qarz, jurnal)
 *   POST /tasks/:taskId/redeliver                  delivery.manage (+ delivery.assign — agent bilan) — qoldiq uchun yangi yetkazma
 *   POST /tasks/:taskId/payment-review             delivery.manage — to'lov farqini ko'rib chiqish
 *   POST /tasks/:taskId/otp                        delivery.manage — OTP berish (kod javobda bir marta)
 *   POST /auto-assign/preview                      delivery.assign — avtomatik biriktirish rejasi (hech narsa yozilmaydi)
 *   POST /auto-assign                              delivery.assign — rejadagi juftliklarni qayta tekshirib biriktirish
 *   POST /route-plan                               delivery.view (apply — delivery.manage_routes) — agentning kunlik eng qisqa marshruti
 *   GET  /dispatch                                 delivery.manage — taqsimot: yetkazmasiz buyurtmalar + biriktirilmagan yetkazmalar (hudud, marshrut)
 *   POST /dispatch/assign                          delivery.assign (+ delivery.manage — buyurtmadan) — hammasini bitta agentga, marshrut tartibi bilan
 * Real-time:
 *   GET  /ws (WebSocket)                           delivery.view yoki bog'langan faol yetkazuvchi; Origin tekshiriladi
 * Yetkazuvchi agent (delivery.accept + bog'langan faol agent; agent, kompaniya va mijoz ID'si so'rovdan olinmaydi):
 *   GET  /agent/me, GET /agent/dashboard, GET /agent/tasks (?scope=today|upcoming|history&lat=&lng=), GET /agent/tasks/:taskId
 *   GET  /agent/work-session, POST /agent/work-session/start, POST /agent/work-session/end
 *   POST /agent/locations                          ish sessiyasida (1–20 nuqta)
 *   POST /agent/tasks/:taskId/accept               delivery.accept
 *   POST /agent/tasks/:taskId/start                delivery.start
 *   POST /agent/tasks/:taskId/arrive               delivery.arrive — geofence
 *   POST /agent/tasks/:taskId/delivering           delivery.confirm
 *   POST /agent/tasks/:taskId/proofs, GET .../proofs/:proofId   delivery.confirm — rasm (kamera) / imzo
 *   POST /agent/tasks/:taskId/otp/resend           delivery.confirm — SMS sozlangan bo'lsa
 *   POST /agent/tasks/:taskId/payments             delivery.collect_payment — bitta usul yoki aralash (`parts`)
 *   GET  /agent/payment-options                    ruxsat etilgan usullar va faol karta terminallari
 *   POST /agent/tasks/:taskId/confirm              delivery.confirm — to'liq yoki qisman, OTP, geofence
 *   POST /agent/tasks/:taskId/fail                 delivery.fail — sabab ("Boshqa" — izoh majburiy)
 *   GET  /agent/customers (?search=), GET /agent/customers/:customerId
 *   GET  /agent/cash                               o'zidagi (kassaga topshirilmagan) naqd — faqat o'qish
 *   GET  /agent/debts                              delivery.view_debt
 *   GET  /agent/reports (?from=&to=)
 *   GET  /agent/route (?lat=&lng=)                  bugungi ochiq yetkazmalarning eng qisqa tartibi (tavsiya, yozilmaydi)
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  AppError,
  DELIVERY_AUTO_ASSIGN_STRATEGIES,
  DELIVERY_COLLECTION_METHODS,
  MAX_PAYMENT_PARTS,
  DELIVERY_FAILURE_REASONS,
  DELIVERY_LOCATION_BATCH_MAX,
  DELIVERY_PAYMENT_TYPES,
  DELIVERY_PRIORITIES,
  DELIVERY_PROOF_KINDS,
  DELIVERY_STATUSES,
  DELIVERY_TIME_RE,
  DELIVERY_VEHICLE_TYPES,
  badRequest,
  forbidden,
  notFound,
  unauthenticated,
  type DeliveryPolicy,
  type Permission,
} from "@bum/shared";
import { db } from "../../db/client.js";
import { deliveryAgents } from "../../db/schema/delivery.js";
import { companies } from "../../db/schema/platform.js";
import { withTransaction, type Tx } from "../../db/transaction.js";
import { requestMeta } from "../../shared/audit.js";
import { decimalSchema, moneySchema, qtySchema } from "../../shared/decimal.js";
import { authOf, requireAuth } from "../auth/guard.js";
import { SESSION_COOKIE } from "../auth/session.js";
import { COMPANY_CONTEXT_QUERY, companyKeyFrom } from "../company/company-context.js";
import { effectivePermissions, requirePermission, requireTenant, requireTenantForWrite, type TenantContext } from "../company/tenant.js";
import { effectiveScopes, isResponsibleOnly, responsibleDeliveryAgentIds } from "../company/responsibility.service.js";
import { recipientCandidates } from "../sales-agent/policy.service.js";
import { agentCashSummary, handoverAgentCash } from "./agent-cash.service.js";
import { notifyCustomerPaymentReceived } from "../telegram/notify.service.js";
import { requireDeliveryAgent, type DeliveryAgentContext } from "./agent-context.js";
import {
  acceptReturnPickup,
  createReturnPickup,
  customerPurchases,
  listReturnPickups,
  rejectReturnPickup,
} from "./return-pickup.service.js";
import { applyAutoAssign, planAutoAssign } from "./auto-assign.service.js";
import { DISPATCH_ASSIGN_MAX, assignDispatch, dispatchBoard } from "./dispatch.service.js";
import { planAgentDay, tasksInOrder } from "./route-plan.service.js";
import { CLOSE_CODES, DeliveryRealtimeHub, originAllowed, resolveRealtimeAccess, type RealtimeAccess } from "./realtime.js";
import { localDate } from "./task.repo.js";
import { writeAuditLog } from "../../shared/audit.js";
import {
  acceptDelivery,
  addDeliveryProof,
  arriveDelivery,
  beginHandover,
  collectDeliveryPayment,
  confirmDelivery,
  deliveryProofContent,
  failDelivery,
  issueDeliveryOtp,
  resendDeliveryOtp,
  returnDeliveryGoods,
  reviewDeliveryPayment,
  startDelivery,
  type Outcome,
} from "./lifecycle.service.js";
import { paymentTerminalOptions } from "../finance/terminals.service.js";
import { deliveryPolicySchema, getDeliveryPolicy, saveDeliveryPolicy } from "./policy.service.js";
import { agentCustomer, agentCustomers, agentDashboard, agentDebts, agentReport, agentTaskList, supervisorDashboard, supervisorReport } from "./reports.service.js";
import {
  assignDeliveryTask,
  cancelDeliveryTask,
  createDeliveryTask,
  getDeliveryTask,
  deliveryWaybill,
  deliveryWaybillsByIds,
  listDeliveryTasks,
  readyOrdersForDelivery,
  redeliverRemainder,
  rescheduleDeliveryTask,
  setDeliveryRouteOrder,
  unassignDeliveryTask,
  updateDeliveryTask,
} from "./tasks.service.js";
import { createDeliveryAgent, deliverySupervisorCandidates, getDeliveryAgent, listDeliveryAgents, updateDeliveryAgent } from "./team.service.js";
import {
  currentDeliverySession,
  deliveryAgentTrack,
  deliveryLive,
  endDeliverySession,
  recordDeliveryLocations,
  startDeliverySession,
} from "./tracking.service.js";

// ─── Sxemalar ────────────────────────────────────────────────────────────────

const isoDate = z.iso.date();
const isoDateTime = z.iso.datetime({ offset: true }).transform((value) => new Date(value));
const timeOfDay = z.string().regex(DELIVERY_TIME_RE, "Vaqt HH:MM ko'rinishida");
const boolQuery = z
  .enum(["true", "false"])
  .transform((value) => value === "true")
  .optional();
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => value || null)
    .nullable()
    .optional();
const positiveMoney = decimalSchema({ scale: 2, positive: true });

const latitude = z.number().min(-90).max(90);
const longitude = z.number().min(-180).max(180);
const accuracy = z.number().min(0).max(100_000);
const placeFields = { latitude, longitude, accuracy, recordedAt: isoDateTime };
const actionFields = { clientRequestId: z.uuid(), occurredAt: isoDateTime.optional() };
const optionalPlaceFields = { latitude: latitude.optional(), longitude: longitude.optional(), accuracy: accuracy.optional(), recordedAt: isoDateTime.optional() };
const pairedPlace = (body: { latitude?: number; longitude?: number; accuracy?: number }) =>
  (body.latitude === undefined) === (body.longitude === undefined) && (body.latitude === undefined) === (body.accuracy === undefined);
const pairMessage = { message: "latitude, longitude va accuracy birga beriladi" };

const taskParams = z.object({ taskId: z.uuid() });
const proofParams = z.object({ taskId: z.uuid(), proofId: z.uuid() });
const agentParams = z.object({ agentId: z.uuid() });
/** Nakladnoy: qaysi agent va qaysi kun. */
const waybillQuery = z.object({ agentId: z.uuid(), date: z.iso.date() });
/** Bir yo'la chiqariladigan yetkazmalar — ro'yxat serverda yana filtrlanadi. */
const bulkWaybillBody = z.strictObject({ taskIds: z.array(z.uuid()).min(1).max(200) });

const cashHandoverBody = z.strictObject({
  amount: moneySchema,
  /** Standart — asosiy naqd kassa; boshqa kassa — finance.manage. */
  toCashAccountId: z.uuid().nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});
const customerParams = z.object({ customerId: z.uuid() });

const schedule = z.strictObject({ days: z.array(z.number().int().min(0).max(6)).min(1).max(7), start: timeOfDay, end: timeOfDay }).refine((value) => value.start < value.end, {
  message: "Ish vaqti boshlanishi tugashdan oldin bo'lsin",
});
const profileShape = {
  supervisorUserId: z.uuid().nullable().optional(),
  branchId: z.uuid().nullable().optional(),
  territory: optionalText(100),
  deliveryZone: optionalText(200),
  vehicleType: z.enum(DELIVERY_VEHICLE_TYPES).nullable().optional(),
  vehicleNumber: optionalText(20),
  maxLoadKg: decimalSchema({ scale: 2, positive: true }).nullable().optional(),
  workingSchedule: schedule.nullable().optional(),
  notes: optionalText(1000),
};
const agentCreateBody = z.strictObject({
  name: z.string().trim().min(1).max(200),
  phone: z.string().trim().min(1).max(32),
  password: z.string().min(1).max(256),
  hireDate: isoDate.optional(),
  ...profileShape,
});
const agentPatchBody = z.strictObject({ ...profileShape, isActive: z.boolean().optional() });
const agentsQuery = z.object({ activeOnly: boolQuery, branchId: z.uuid().optional(), territory: z.string().trim().min(1).max(100).optional() });

const taskCreateBody = z.strictObject({
  orderId: z.uuid(),
  scheduledDate: isoDate.optional(),
  windowStart: timeOfDay.nullable().optional(),
  windowEnd: timeOfDay.nullable().optional(),
  priority: z.enum(DELIVERY_PRIORITIES).optional(),
  paymentType: z.enum(DELIVERY_PAYMENT_TYPES).optional(),
  expectedAmount: moneySchema.optional(),
  deliveryNote: optionalText(1000),
  supervisorNote: optionalText(1000),
  deliveryAgentId: z.uuid().nullable().optional(),
  routeOrder: z.number().int().min(1).max(10_000).nullable().optional(),
});
/** Qoldiqni qayta yetkazish: buyurtma emas, ASL yetkazma ko'rsatiladi (qatorlar undan olinadi). */
const redeliverBody = z.strictObject({
  scheduledDate: isoDate.optional(),
  windowStart: timeOfDay.nullable().optional(),
  windowEnd: timeOfDay.nullable().optional(),
  priority: z.enum(DELIVERY_PRIORITIES).optional(),
  paymentType: z.enum(DELIVERY_PAYMENT_TYPES).optional(),
  expectedAmount: moneySchema.optional(),
  deliveryNote: optionalText(1000),
  supervisorNote: optionalText(1000),
  deliveryAgentId: z.uuid().nullable().optional(),
  routeOrder: z.number().int().min(1).max(10_000).nullable().optional(),
  reason: optionalText(500),
});
const taskPatchBody = z.strictObject({
  priority: z.enum(DELIVERY_PRIORITIES).optional(),
  deliveryNote: optionalText(1000),
  supervisorNote: optionalText(1000),
  paymentType: z.enum(DELIVERY_PAYMENT_TYPES).optional(),
  expectedAmount: moneySchema.optional(),
  windowStart: timeOfDay.nullable().optional(),
  windowEnd: timeOfDay.nullable().optional(),
});
const assignBody = z.strictObject({
  deliveryAgentId: z.uuid(),
  scheduledDate: isoDate.optional(),
  routeOrder: z.number().int().min(1).max(10_000).nullable().optional(),
});
const rescheduleBody = z.strictObject({
  scheduledDate: isoDate,
  windowStart: timeOfDay.nullable().optional(),
  windowEnd: timeOfDay.nullable().optional(),
  reason: optionalText(500),
});
const cancelBody = z.strictObject({ reason: z.string().trim().min(3).max(500) });
const routeOrderBody = z.strictObject({ deliveryAgentId: z.uuid(), date: isoDate, taskIds: z.array(z.uuid()).min(1).max(200) });
const returnBody = z.strictObject({ refundMethod: z.enum(["cash", "card", "bank", "balance"]).default("balance"), reason: optionalText(500) });
const reviewBody = z.strictObject({ decision: z.enum(["approved", "rejected"]), note: z.string().trim().min(3).max(500) });
const statusList = z
  .string()
  .max(300)
  .transform((value) => value.split(",").map((item) => item.trim()).filter(Boolean))
  .pipe(z.array(z.enum(DELIVERY_STATUSES)).max(DELIVERY_STATUSES.length));
const tasksQuery = z.object({
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
  status: statusList.optional(),
  agentId: z.uuid().optional(),
  unassigned: boolQuery,
  branchId: z.uuid().optional(),
  territory: z.string().trim().min(1).max(100).optional(),
  customerId: z.uuid().optional(),
  search: z.string().trim().min(1).max(100).optional(),
  overdue: boolQuery,
  reviewPending: boolQuery,
  /** Tovari omborga qaytarilmagan yetkazmalar (yetkazilmagan yoki qisman). */
  returnPending: boolQuery,
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().max(500).optional(),
});
const readyQuery = z.object({ search: z.string().trim().min(1).max(100).optional(), limit: z.coerce.number().int().min(1).max(200).default(100) });
const dateQuery = z.object({ date: isoDate.optional() });
const reportQuery = z.object({ from: isoDate.optional(), to: isoDate.optional(), agentId: z.uuid().optional() });
const agentReportQuery = z.object({ from: isoDate.optional(), to: isoDate.optional() });

const sessionStartBody = z.strictObject(placeFields);
const sessionEndBody = z.strictObject(optionalPlaceFields).refine((body) => (body.latitude === undefined) === (body.longitude === undefined), pairMessage);
const locationsBody = z.strictObject({
  points: z
    .array(z.strictObject({ ...placeFields, mocked: z.boolean().optional() }))
    .min(1)
    .max(DELIVERY_LOCATION_BATCH_MAX),
});
const agentTasksQuery = z
  .object({ scope: z.enum(["today", "upcoming", "history"]).default("today"), lat: z.coerce.number().min(-90).max(90).optional(), lng: z.coerce.number().min(-180).max(180).optional() })
  .refine((query) => (query.lat === undefined) === (query.lng === undefined), { message: "lat va lng birga beriladi" });
const agentCustomersQuery = z.object({ search: z.string().trim().min(1).max(100).optional() });

/** Dostavchi mijozdan qaytarib olgan tovar. */
const pickupParams = z.object({ pickupId: z.uuid() });
const pickupBody = z.strictObject({
  customerId: z.uuid(),
  orderId: z.uuid(),
  items: z
    .array(z.strictObject({ orderItemId: z.uuid(), quantity: qtySchema }))
    .min(1)
    .max(200),
  reason: optionalText(500),
  refundMethod: z.enum(["cash", "card", "bank", "balance"]).default("balance"),
  taskId: z.uuid().nullable().optional(),
});
const pickupAcceptBody = z.strictObject({
  refundMethod: z.enum(["cash", "card", "bank", "balance"]).optional(),
  note: optionalText(500),
});
const pickupRejectBody = z.strictObject({ note: z.string().trim().min(3).max(500) });
const pickupQuery = z.object({
  status: z.enum(["pending", "accepted", "rejected"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

const acceptBody = z.strictObject(actionFields);
const startBody = z.strictObject({ ...actionFields, ...optionalPlaceFields }).refine(pairedPlace, pairMessage);
const arriveBody = z.strictObject({ ...actionFields, ...placeFields });
const proofBody = z
  .strictObject({
    ...actionFields,
    ...optionalPlaceFields,
    kind: z.enum(DELIVERY_PROOF_KINDS),
    contentType: z.string().trim().toLowerCase().max(100),
    /** Base64; turi va hajmi serverda baytlardan tekshiriladi. */
    data: z.string().min(8).max(4_100_000).regex(/^[A-Za-z0-9+/]+={0,2}$/, "base64 emas"),
    signerName: optionalText(200),
  })
  .refine(pairedPlace, pairMessage);
const deliveryPaymentPart = z.strictObject({
  method: z.enum(DELIVERY_COLLECTION_METHODS),
  amount: positiveMoney,
  /** Karta terminali (UZCARD, HUMO ...) — pul uning bank hisobiga. */
  terminalId: z.uuid().nullable().optional(),
});
/** Bitta usul yoki aralash (`parts`: naqd + karta + bank) — faqat siyosatda ruxsat etilgan usullar. */
const paymentBody = z.union([
  deliveryPaymentPart.extend(actionFields),
  z.strictObject({ ...actionFields, parts: z.array(deliveryPaymentPart).min(1).max(MAX_PAYMENT_PARTS) }),
]);
const confirmBody = z.strictObject({
  ...actionFields,
  ...placeFields,
  items: z.array(z.strictObject({ taskItemId: z.uuid(), deliveredQty: qtySchema })).max(500).optional(),
  otp: z.string().regex(/^\d{6}$/, "OTP 6 raqam").optional(),
});
const failBody = z
  .strictObject({ ...actionFields, ...optionalPlaceFields, reason: z.enum(DELIVERY_FAILURE_REASONS), comment: optionalText(500) })
  .refine(pairedPlace, pairMessage);

/** JSON'dagi base64 isbot uchun (3 MB → ~4 MB matn). */
const PROOF_BODY_LIMIT = 6 * 1024 * 1024;

// ─── Yordamchilar ────────────────────────────────────────────────────────────

async function readTenantWith(req: FastifyRequest, permission: Permission): Promise<TenantContext> {
  const tenant = await requireTenant(db, authOf(req).user);
  await requirePermission(db, tenant, permission);
  return tenant;
}

function writeTenantWith<T>(req: FastifyRequest, permission: Permission, fn: (tx: Tx, tenant: TenantContext) => Promise<T>): Promise<T> {
  return withTransaction(async (tx) => {
    const tenant = await requireTenantForWrite(tx, authOf(req).user);
    await requirePermission(tx, tenant, permission);
    return fn(tx, tenant);
  });
}

/**
 * "Mas'ul bo'lganlari" chegarasi yoqilgan bo'lsa — foydalanuvchining yetkazuvchi profillari,
 * aks holda `null` (chegara yo'q).
 */
async function deliveryScopeFor(tenant: TenantContext): Promise<string[] | null> {
  const scopes = await effectiveScopes(db, tenant);
  if (!isResponsibleOnly(scopes, "delivery.view")) return null;
  return responsibleDeliveryAgentIds(db, tenant);
}

async function readAgent(req: FastifyRequest): Promise<{ context: DeliveryAgentContext; permissions: Permission[] }> {
  const tenant = await requireTenant(db, authOf(req).user);
  await requirePermission(db, tenant, "delivery.accept");
  return { context: await requireDeliveryAgent(db, tenant), permissions: await effectivePermissions(db, tenant) };
}

/** Agent amali: ish joyi ruxsati (`delivery.accept`) + amal ruxsati + bog'langan faol agent. */
function writeAgent<T>(req: FastifyRequest, permission: Permission | null, fn: (tx: Tx, context: DeliveryAgentContext) => Promise<T>): Promise<T> {
  return withTransaction(async (tx) => {
    const tenant = await requireTenantForWrite(tx, authOf(req).user);
    await requirePermission(tx, tenant, "delivery.accept");
    if (permission) await requirePermission(tx, tenant, permission);
    return fn(tx, await requireDeliveryAgent(tx, tenant));
  });
}

/** Rad etish hodisasi tranzaksiyada saqlangach xato qaytariladi. */
function outcomeOf<T>(outcome: Outcome<T>): T {
  if ("blocked" in outcome) throw outcome.blocked as AppError;
  return outcome.result;
}

const placeOf = (body: { latitude?: number; longitude?: number; accuracy?: number; recordedAt?: Date }) =>
  body.latitude !== undefined && body.longitude !== undefined && body.accuracy !== undefined
    ? { latitude: body.latitude, longitude: body.longitude, accuracy: body.accuracy, recordedAt: body.recordedAt }
    : null;

function sendProof(reply: FastifyReply, proof: { content: Buffer; contentType: string }) {
  return reply
    .header("content-type", proof.contentType)
    .header("cache-control", "private, no-store")
    .header("x-content-type-options", "nosniff")
    .send(proof.content);
}

/** Agentga yetkazma tafsiloti (qarz — ruxsat bo'lsa). */
async function agentTaskView(context: DeliveryAgentContext, taskId: string, permissions: Permission[]) {
  return getDeliveryTask(db, context.company.id, taskId, {
    kind: "agent",
    deliveryAgentId: context.deliveryAgent.id,
    canViewDebt: permissions.includes("delivery.view_debt"),
  });
}

async function agentPermissions(context: DeliveryAgentContext) {
  return effectivePermissions(db, context);
}

export async function deliveryRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  // ─── Siyosat ─────────────────────────────────────────────────────────────

  app.get("/policy", async (req) => {
    const tenant = await requireTenant(db, authOf(req).user);
    const permissions = await effectivePermissions(db, tenant);
    if (!permissions.includes("delivery.view") && !permissions.includes("delivery.accept")) throw forbidden();
    return { policy: await getDeliveryPolicy(db, tenant.company.id) };
  });

  app.put("/policy", async (req) => {
    const body = deliveryPolicySchema.parse(req.body);
    const policy = await writeTenantWith(req, "delivery.manage", (tx, tenant) => saveDeliveryPolicy(tx, tenant, body, requestMeta(req)));
    return { policy };
  });

  app.get("/policy/recipients", async (req) => {
    const tenant = await readTenantWith(req, "delivery.manage");
    return { recipients: await recipientCandidates(db, tenant.company.id) };
  });

  // ─── Yetkazuvchi agentlar ────────────────────────────────────────────────

  app.get("/agents", async (req) => {
    const query = agentsQuery.parse(req.query);
    const tenant = await readTenantWith(req, "delivery.view");
    return { agents: await listDeliveryAgents(db, tenant, query) };
  });

  app.get("/agents/supervisors", async (req) => {
    const tenant = await readTenantWith(req, "delivery.manage");
    return { supervisors: await deliverySupervisorCandidates(db, tenant.company.id) };
  });

  app.post("/agents", async (req, reply) => {
    const body = agentCreateBody.parse(req.body);
    const agent = await writeTenantWith(req, "delivery.manage", (tx, tenant) => createDeliveryAgent(tx, tenant, body, requestMeta(req)));
    reply.status(201);
    return { agent };
  });

  app.get("/agents/live", async (req) => {
    const tenant = await readTenantWith(req, "delivery.view_location");
    return { agents: await deliveryLive(db, tenant), serverTime: new Date() };
  });

  app.patch("/agents/:agentId", async (req) => {
    const { agentId } = agentParams.parse(req.params);
    const body = agentPatchBody.parse(req.body);
    const agent = await writeTenantWith(req, "delivery.manage", (tx, tenant) => updateDeliveryAgent(tx, tenant, agentId, body, requestMeta(req)));
    return { agent };
  });

  app.get("/agents/:agentId", async (req) => {
    const { agentId } = agentParams.parse(req.params);
    const tenant = await readTenantWith(req, "delivery.view");
    return { agent: await getDeliveryAgent(db, tenant.company.id, agentId) };
  });

  app.get("/agents/:agentId/track", async (req) => {
    const { agentId } = agentParams.parse(req.params);
    const { date } = dateQuery.parse(req.query);
    const tenant = await readTenantWith(req, "delivery.view_location");
    return deliveryAgentTrack(tenant, agentId, date ?? localDate(), requestMeta(req));
  });

  // Yetkazuvchidagi naqd (dostavkada yig'ilgan, kassaga topshirilmagan) va kassaga topshirish
  app.get("/agents/:agentId/cash", async (req) => {
    const { agentId } = agentParams.parse(req.params);
    const tenant = await readTenantWith(req, "delivery.view");
    return { cash: await agentCashSummary(db, tenant.company.id, agentId) };
  });

  app.post("/agents/:agentId/cash-handover", async (req, reply) => {
    const { agentId } = agentParams.parse(req.params);
    const body = cashHandoverBody.parse(req.body);
    const handover = await writeTenantWith(req, "delivery.manage", (tx, tenant) => handoverAgentCash(tx, tenant, agentId, body, requestMeta(req)));
    reply.status(201);
    return { handover };
  });

  // ─── Boshqaruv paneli va hisobotlar ──────────────────────────────────────

  app.get("/dashboard", async (req) => {
    const { date } = dateQuery.parse(req.query);
    const tenant = await readTenantWith(req, "delivery.view");
    return { dashboard: await supervisorDashboard(db, tenant, date) };
  });

  app.get("/reports", async (req) => {
    const query = reportQuery.parse(req.query);
    const tenant = await readTenantWith(req, "delivery.view_reports");
    return { report: await supervisorReport(db, tenant, { from: query.from, to: query.to, deliveryAgentId: query.agentId }) };
  });

  // ─── Yetkazmalar ─────────────────────────────────────────────────────────

  app.get("/ready-orders", async (req) => {
    const query = readyQuery.parse(req.query);
    const tenant = await readTenantWith(req, "delivery.manage");
    return { orders: await readyOrdersForDelivery(db, tenant, query) };
  });

  /**
   * Nakladnoy (dostavka varaqasi) ma'lumoti — agentga biriktirilgan kunlik yetkazmalar.
   * Mijoz qarzi faqat `finance.view` bilan qo'shiladi (qog'ozga chiqadigan maxfiy ma'lumot).
   */
  /**
   * Tanlangan yetkazmalar uchun nakladnoy ma'lumoti (ko'pini birdan chiqarish).
   * Chop etish faqat HUJJAT amali — yetkazma holati o'zgarmaydi. Kim, qachon va qaysi
   * yetkazmalarni chiqarganini auditga yozamiz.
   */
  app.post("/waybills/bulk", async (req) => {
    const body = bulkWaybillBody.parse(req.body);
    const tenant = await readTenantWith(req, "delivery.view");
    const canViewDebt = (await effectivePermissions(db, tenant)).includes("finance.view");
    const result = await deliveryWaybillsByIds(db, tenant, body.taskIds, canViewDebt);
    await writeAuditLog(
      {
        userId: tenant.user.id,
        userName: tenant.user.name,
        companyId: tenant.company.id,
        action: "DELIVERY_WAYBILLS_PRINTED",
        resource: "delivery_tasks",
        resourceId: tenant.company.id,
        details: { requested: body.taskIds.length, printed: result.tasks.length },
        ...requestMeta(req),
      },
      db,
    );
    return result;
  });

  app.get("/waybill", async (req) => {
    const query = waybillQuery.parse(req.query);
    const tenant = await readTenantWith(req, "delivery.view");
    const canViewDebt = (await effectivePermissions(db, tenant)).includes("finance.view");
    return deliveryWaybill(db, tenant, { agentId: query.agentId, date: query.date }, canViewDebt);
  });

  app.get("/tasks", async (req) => {
    const query = tasksQuery.parse(req.query);
    const tenant = await readTenantWith(req, "delivery.view");
    const responsibleAgentIds = await deliveryScopeFor(tenant);
    return listDeliveryTasks(db, tenant, {
      ...(responsibleAgentIds ? { responsibleAgentIds } : {}),
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
      statuses: query.status,
      deliveryAgentId: query.agentId,
      unassigned: query.unassigned,
      branchId: query.branchId,
      territory: query.territory,
      customerId: query.customerId,
      search: query.search,
      overdue: query.overdue,
      reviewPending: query.reviewPending,
      returnPending: query.returnPending,
      limit: query.limit,
      cursor: query.cursor,
    });
  });

  app.post("/tasks", async (req, reply) => {
    const body = taskCreateBody.parse(req.body);
    const taskId = await writeTenantWith(req, "delivery.manage", async (tx, tenant) => {
      const permissions = await effectivePermissions(tx, tenant);
      return createDeliveryTask(tx, tenant, body, requestMeta(req), "manual", { allowAssign: permissions.includes("delivery.assign") });
    });
    const tenant = await requireTenant(db, authOf(req).user);
    reply.status(201);
    return { task: await getDeliveryTask(db, tenant.company.id, taskId, { kind: "manager" }) };
  });

  app.get("/tasks/:taskId", async (req) => {
    const { taskId } = taskParams.parse(req.params);
    const tenant = await readTenantWith(req, "delivery.view");
    const task = await getDeliveryTask(db, tenant.company.id, taskId, { kind: "manager" });
    // Chegara yoqilgan bo'lsa begona yetkazma TOPILMADI bo'lib qaytadi (mavjudligi oshkor bo'lmaydi)
    const responsibleAgentIds = await deliveryScopeFor(tenant);
    if (responsibleAgentIds && !responsibleAgentIds.includes(task.deliveryAgentId ?? "")) {
      throw notFound("Yetkazma topilmadi");
    }
    return { task };
  });

  app.get("/tasks/:taskId/proofs/:proofId", async (req, reply) => {
    const { taskId, proofId } = proofParams.parse(req.params);
    const tenant = await readTenantWith(req, "delivery.view");
    return sendProof(reply, await deliveryProofContent(db, tenant.company.id, taskId, proofId));
  });

  const managerTask = async (req: FastifyRequest, taskId: string) => {
    const tenant = await requireTenant(db, authOf(req).user);
    return { task: await getDeliveryTask(db, tenant.company.id, taskId, { kind: "manager" }) };
  };

  app.patch("/tasks/:taskId", async (req) => {
    const { taskId } = taskParams.parse(req.params);
    const body = taskPatchBody.parse(req.body);
    await writeTenantWith(req, "delivery.manage", (tx, tenant) => updateDeliveryTask(tx, tenant, taskId, body, requestMeta(req)));
    return managerTask(req, taskId);
  });

  app.post("/tasks/:taskId/assign", async (req) => {
    const { taskId } = taskParams.parse(req.params);
    const body = assignBody.parse(req.body);
    await writeTenantWith(req, "delivery.assign", async (tx, tenant) => {
      const permissions = await effectivePermissions(tx, tenant);
      await assignDeliveryTask(tx, tenant, taskId, body, requestMeta(req), { allowReassign: permissions.includes("delivery.reassign") });
    });
    return managerTask(req, taskId);
  });

  app.post("/tasks/:taskId/unassign", async (req) => {
    const { taskId } = taskParams.parse(req.params);
    await writeTenantWith(req, "delivery.reassign", (tx, tenant) => unassignDeliveryTask(tx, tenant, taskId, requestMeta(req)));
    return managerTask(req, taskId);
  });

  app.post("/tasks/:taskId/reschedule", async (req) => {
    const { taskId } = taskParams.parse(req.params);
    const body = rescheduleBody.parse(req.body);
    await writeTenantWith(req, "delivery.manage", (tx, tenant) => rescheduleDeliveryTask(tx, tenant, taskId, body, requestMeta(req)));
    return managerTask(req, taskId);
  });

  app.post("/tasks/:taskId/cancel", async (req) => {
    const { taskId } = taskParams.parse(req.params);
    const { reason } = cancelBody.parse(req.body);
    await writeTenantWith(req, "delivery.manage", (tx, tenant) => cancelDeliveryTask(tx, tenant, taskId, reason, requestMeta(req)));
    return managerTask(req, taskId);
  });

  app.put("/route-order", async (req) => {
    const body = routeOrderBody.parse(req.body);
    await writeTenantWith(req, "delivery.manage_routes", (tx, tenant) => setDeliveryRouteOrder(tx, tenant, body, requestMeta(req)));
    return { ok: true };
  });

  app.post("/tasks/:taskId/return", async (req) => {
    const { taskId } = taskParams.parse(req.params);
    const body = returnBody.parse(req.body);
    await writeTenantWith(req, "delivery.return", async (tx, tenant) => {
      // Balansdan boshqa usulda pul qaytarish — kassa/bank chiqimi: savdo qaytarish ruxsati ham kerak
      if (body.refundMethod !== "balance") await requirePermission(tx, tenant, "sales.refund");
      return returnDeliveryGoods(tx, tenant, taskId, body, requestMeta(req));
    });
    return managerTask(req, taskId);
  });

  app.post("/tasks/:taskId/redeliver", async (req, reply) => {
    const { taskId } = taskParams.parse(req.params);
    const body = redeliverBody.parse(req.body);
    const newTaskId = await writeTenantWith(req, "delivery.manage", async (tx, tenant) => {
      const permissions = await effectivePermissions(tx, tenant);
      return redeliverRemainder(tx, tenant, taskId, body, requestMeta(req), { allowAssign: permissions.includes("delivery.assign") });
    });
    reply.status(201);
    return managerTask(req, newTaskId);
  });

  // ─── Dostavchi qaytarib olgan tovar (supervayzer) ──────────────────────────

  app.get("/returns/pickups", async (req) => {
    const query = pickupQuery.parse(req.query);
    const tenant = await readTenantWith(req, "delivery.view");
    return listReturnPickups(db, tenant.company.id, query);
  });

  app.post("/returns/pickups/:pickupId/accept", async (req) => {
    const { pickupId } = pickupParams.parse(req.params);
    const body = pickupAcceptBody.parse(req.body);
    return writeTenantWith(req, "delivery.return", async (tx, tenant) => {
      // Balansdan boshqa usulda pul qaytarish — kassa/bank chiqimi: savdo qaytarish ruxsati ham kerak
      if (body.refundMethod && body.refundMethod !== "balance") await requirePermission(tx, tenant, "sales.refund");
      return acceptReturnPickup(tx, tenant, pickupId, body, requestMeta(req));
    });
  });

  app.post("/returns/pickups/:pickupId/reject", async (req) => {
    const { pickupId } = pickupParams.parse(req.params);
    const body = pickupRejectBody.parse(req.body);
    return writeTenantWith(req, "delivery.return", (tx, tenant) => rejectReturnPickup(tx, tenant, pickupId, body, requestMeta(req)));
  });

  app.post("/tasks/:taskId/payment-review", async (req) => {
    const { taskId } = taskParams.parse(req.params);
    const body = reviewBody.parse(req.body);
    await writeTenantWith(req, "delivery.manage", (tx, tenant) => reviewDeliveryPayment(tx, tenant, taskId, body, requestMeta(req)));
    return managerTask(req, taskId);
  });

  app.post("/tasks/:taskId/otp", async (req) => {
    const { taskId } = taskParams.parse(req.params);
    const otp = await writeTenantWith(req, "delivery.manage", (tx, tenant) => issueDeliveryOtp(tx, tenant, taskId, requestMeta(req)));
    return { otp };
  });

  // ─── Avtomatik biriktirish ───────────────────────────────────────────────

  const autoAssignPreviewBody = z.strictObject({
    date: isoDate,
    strategy: z.enum(DELIVERY_AUTO_ASSIGN_STRATEGIES).optional(),
    taskIds: z.array(z.uuid()).min(1).max(200).optional(),
  });
  const autoAssignApplyBody = z
    .strictObject({
      date: isoDate,
      strategy: z.enum(DELIVERY_AUTO_ASSIGN_STRATEGIES).optional(),
      assignments: z.array(z.strictObject({ taskId: z.uuid(), deliveryAgentId: z.uuid() })).min(1).max(200).optional(),
    })
    .refine((body) => !body.assignments || new Set(body.assignments.map((item) => item.taskId)).size === body.assignments.length, {
      message: "Yetkazma takrorlangan",
    });

  const assertAutoAssign = (policy: DeliveryPolicy, date: string) => {
    if (!policy.autoAssign.enabled) {
      throw new AppError("CONFLICT", "Avtomatik biriktirish siyosatda o'chirilgan", { reason: "auto_assign_disabled" });
    }
    if (date < localDate()) throw badRequest("O'tgan kun uchun biriktirilmaydi — avval qayta rejalang", { reason: "date_in_past" });
  };

  app.post("/auto-assign/preview", async (req) => {
    const body = autoAssignPreviewBody.parse(req.body);
    const tenant = await readTenantWith(req, "delivery.assign");
    const policy = await getDeliveryPolicy(db, tenant.company.id);
    assertAutoAssign(policy, body.date);
    return { plan: await planAutoAssign(db, tenant.company.id, policy, body) };
  });

  app.post("/auto-assign", async (req) => {
    const body = autoAssignApplyBody.parse(req.body);
    const result = await writeTenantWith(req, "delivery.assign", async (tx, tenant) => {
      const policy = await getDeliveryPolicy(tx, tenant.company.id);
      assertAutoAssign(policy, body.date);
      return applyAutoAssign(tx, tenant, policy, body, requestMeta(req), "manual");
    });
    return { result };
  });

  // ─── Marshrut va taqsimot ────────────────────────────────────────────────

  const routePlanBody = z.strictObject({
    deliveryAgentId: z.uuid(),
    date: isoDate,
    /** Boshlang'ich joy; berilmasa — bugun uchun yetkazuvchining oxirgi joyi (2 soatdan yangi), bo'lmasa erkin. */
    origin: z.strictObject({ latitude, longitude }).nullable().optional(),
    apply: z.boolean().default(false),
  });
  const dispatchAssignBody = z.strictObject({
    orderIds: z.array(z.uuid()).max(DISPATCH_ASSIGN_MAX).default([]),
    taskIds: z.array(z.uuid()).max(DISPATCH_ASSIGN_MAX).default([]),
    deliveryAgentId: z.uuid(),
    scheduledDate: isoDate.optional(),
    /** Biriktirilgandan keyin agentning shu kundagi yetkazmalari eng qisqa yo'l tartibida (delivery.manage_routes). */
    optimize: z.boolean().default(true),
  });
  const agentRouteQuery = z
    .object({ lat: z.coerce.number().min(-90).max(90).optional(), lng: z.coerce.number().min(-180).max(180).optional() })
    .refine((query) => (query.lat === undefined) === (query.lng === undefined), { message: "lat va lng birga beriladi" });

  const assertCompanyAgent = async (companyId: string, deliveryAgentId: string) => {
    const [agent] = await db
      .select({ id: deliveryAgents.id })
      .from(deliveryAgents)
      .where(and(eq(deliveryAgents.id, deliveryAgentId), eq(deliveryAgents.companyId, companyId)))
      .limit(1);
    if (!agent) throw notFound("Yetkazuvchi agent topilmadi");
  };

  app.post("/route-plan", async (req) => {
    const body = routePlanBody.parse(req.body);
    const tenant = await readTenantWith(req, body.apply ? "delivery.manage_routes" : "delivery.view");
    await assertCompanyAgent(tenant.company.id, body.deliveryAgentId);
    const plan = await planAgentDay(db, tenant.company.id, body.deliveryAgentId, body.date, {
      origin: body.origin ?? null,
      useAgentLocation: body.date === localDate(),
      dates: "exact",
    });
    const applied = body.apply && plan.taskIds.length > 0;
    if (applied) {
      await writeTenantWith(req, "delivery.manage_routes", (tx, writer) =>
        setDeliveryRouteOrder(tx, writer, { deliveryAgentId: body.deliveryAgentId, date: body.date, taskIds: plan.taskIds }, requestMeta(req)),
      );
    }
    return { ...plan, applied, tasks: await tasksInOrder(db, tenant.company.id, plan.taskIds) };
  });

  app.get("/dispatch", async (req) => {
    const tenant = await readTenantWith(req, "delivery.manage");
    return dispatchBoard(db, tenant);
  });

  app.post("/dispatch/assign", async (req) => {
    const body = dispatchAssignBody.parse(req.body);
    const meta = requestMeta(req);
    let canOrderRoutes = false;
    const result = await writeTenantWith(req, "delivery.assign", async (tx, tenant) => {
      const permissions = await effectivePermissions(tx, tenant);
      if (body.orderIds.length > 0 && !permissions.includes("delivery.manage")) {
        throw forbidden("Buyurtmadan yetkazma yaratish uchun ruxsat kerak (delivery.manage)");
      }
      canOrderRoutes = permissions.includes("delivery.manage_routes");
      return assignDispatch(tx, tenant, body, meta, { allowReassign: permissions.includes("delivery.reassign") });
    });

    // Marshrut tartibi — biriktirish saqlangach (tashqi marshrut xizmati tranzaksiyani ushlab turmasin)
    const routes: { date: string; route: Awaited<ReturnType<typeof planAgentDay>>["route"]; taskIds: string[]; unlocatedTaskIds: string[] }[] = [];
    let optimizeError: string | null = null;
    if (body.optimize && canOrderRoutes) {
      const tenant = await requireTenant(db, authOf(req).user);
      for (const date of result.dates) {
        const plan = await planAgentDay(db, tenant.company.id, body.deliveryAgentId, date, { origin: null, useAgentLocation: date === localDate(), dates: "exact" });
        try {
          if (plan.taskIds.length > 0) {
            await writeTenantWith(req, "delivery.manage_routes", (tx, writer) =>
              setDeliveryRouteOrder(tx, writer, { deliveryAgentId: body.deliveryAgentId, date, taskIds: plan.taskIds }, meta),
            );
          }
          routes.push({ date, route: plan.route, taskIds: plan.taskIds, unlocatedTaskIds: plan.unlocatedTaskIds });
        } catch (error) {
          // Biriktirish saqlangan; tartibni keyin qayta hisoblash mumkin
          if (!(error instanceof AppError)) throw error;
          optimizeError = error.message;
        }
      }
    }
    return { ...result, optimized: body.optimize && canOrderRoutes && optimizeError === null, optimizeError, routes };
  });

  app.get("/agent/route", async (req) => {
    const query = agentRouteQuery.parse(req.query);
    const { context } = await readAgent(req);
    const origin = query.lat !== undefined && query.lng !== undefined ? { latitude: query.lat, longitude: query.lng } : null;
    const plan = await planAgentDay(db, context.company.id, context.deliveryAgent.id, localDate(), { origin, useAgentLocation: true, dates: "until" });
    return { ...plan, tasks: await tasksInOrder(db, context.company.id, plan.taskIds) };
  });

  // ─── Real-time (WebSocket) ───────────────────────────────────────────────

  const hub = new DeliveryRealtimeHub(app.log);
  app.addHook("onClose", async () => hub.close());
  const upgrades = new WeakMap<FastifyRequest, { token: string; access: RealtimeAccess; companyKey: string | null }>();

  app.get(
    "/ws",
    {
      websocket: true,
      // Ulanishdan oldin (HTTP javob bilan rad etiladi): Origin, sessiya, kompaniya va ruxsat
      preHandler: async (req) => {
        if (!originAllowed(req.headers.origin, req.headers.host)) throw forbidden("Ruxsat etilmagan manba");
        const token = req.cookies[SESSION_COOKIE] ?? "";
        // Tab biznesi — WebSocket sarlavha yubora olmaydi, shuning uchun so'rov parametrida
        const companyKey = companyKeyFrom((req.query as Record<string, unknown> | undefined)?.[COMPANY_CONTEXT_QUERY]);
        const access = await resolveRealtimeAccess(token, companyKey);
        if (access === "unauthenticated") throw unauthenticated();
        if (access === "forbidden") throw forbidden("Dostavka real-time uchun ruxsat yo'q");
        upgrades.set(req, { token, access, companyKey });
      },
    },
    async (socket, req) => {
      const upgrade = upgrades.get(req);
      if (!upgrade) {
        socket.close(CLOSE_CODES.forbidden);
        return;
      }
      await hub.add(socket, upgrade.token, upgrade.access, upgrade.companyKey);
    },
  );

  // ─── Yetkazuvchi agent ish joyi ──────────────────────────────────────────

  app.get("/agent/me", async (req) => {
    const { context, permissions } = await readAgent(req);
    const [company] = await db
      .select({ id: companies.id, name: companies.name, currency: companies.currency })
      .from(companies)
      .where(eq(companies.id, context.company.id))
      .limit(1);
    const deliveryPermissions = permissions.filter((permission) => permission.startsWith("delivery."));
    return { agent: context.deliveryAgent, company: company!, permissions: deliveryPermissions };
  });

  app.get("/agent/dashboard", async (req) => {
    const { context, permissions } = await readAgent(req);
    return { dashboard: await agentDashboard(db, context, permissions.includes("delivery.view_debt")) };
  });

  app.get("/agent/tasks", async (req) => {
    const query = agentTasksQuery.parse(req.query);
    const { context } = await readAgent(req);
    const origin = query.lat !== undefined && query.lng !== undefined ? { latitude: query.lat, longitude: query.lng } : null;
    return { tasks: await agentTaskList(db, context, { scope: query.scope, origin }) };
  });

  app.get("/agent/tasks/:taskId", async (req) => {
    const { taskId } = taskParams.parse(req.params);
    const { context, permissions } = await readAgent(req);
    return { task: await agentTaskView(context, taskId, permissions) };
  });

  /**
   * Agentning O'ZIDAGI naqd: qancha pul yig'ilgan va kassaga topshirilmagan.
   * Faqat O'QISH — topshirishni pulni QABUL QILUVCHI qayd etadi (ikki tomonlama nazorat),
   * shuning uchun bu yerda `POST` yo'q va agent boshqa agentning pulini ko'rmaydi.
   */
  app.get("/agent/cash", async (req) => {
    const { context } = await readAgent(req);
    return { cash: await agentCashSummary(db, context.company.id, context.deliveryAgent.id) };
  });

  app.get("/agent/work-session", async (req) => {
    const { context } = await readAgent(req);
    return { session: await currentDeliverySession(db, context.deliveryAgent.id) };
  });

  app.post("/agent/work-session/start", async (req, reply) => {
    const body = sessionStartBody.parse(req.body);
    const result = await writeAgent(req, null, (tx, context) => startDeliverySession(tx, context, body, requestMeta(req)));
    reply.status(result.created ? 201 : 200);
    return { session: result.session };
  });

  app.post("/agent/work-session/end", async (req) => {
    const body = sessionEndBody.parse(req.body ?? {});
    return { session: await writeAgent(req, null, (tx, context) => endDeliverySession(tx, context, body, requestMeta(req))) };
  });

  app.post("/agent/locations", async (req) => {
    const { points } = locationsBody.parse(req.body);
    return writeAgent(req, null, (tx, context) => recordDeliveryLocations(tx, context, points));
  });

  const agentTaskResponse = async (req: FastifyRequest, taskId: string) => {
    const tenant = await requireTenant(db, authOf(req).user);
    const context = await requireDeliveryAgent(db, tenant);
    return agentTaskView(context, taskId, await agentPermissions(context));
  };

  app.post("/agent/tasks/:taskId/accept", async (req) => {
    const { taskId } = taskParams.parse(req.params);
    const body = acceptBody.parse(req.body);
    await writeAgent(req, "delivery.accept", (tx, context) => acceptDelivery(tx, context, taskId, body, requestMeta(req)));
    return { task: await agentTaskResponse(req, taskId) };
  });

  app.post("/agent/tasks/:taskId/start", async (req) => {
    const { taskId } = taskParams.parse(req.params);
    const body = startBody.parse(req.body);
    await writeAgent(req, "delivery.start", (tx, context) =>
      startDelivery(tx, context, taskId, { clientRequestId: body.clientRequestId, occurredAt: body.occurredAt, place: placeOf(body) }, requestMeta(req)),
    );
    return { task: await agentTaskResponse(req, taskId) };
  });

  app.post("/agent/tasks/:taskId/arrive", async (req) => {
    const { taskId } = taskParams.parse(req.params);
    const body = arriveBody.parse(req.body);
    const outcome = await writeAgent(req, "delivery.arrive", (tx, context) =>
      arriveDelivery(
        tx,
        context,
        taskId,
        {
          clientRequestId: body.clientRequestId,
          occurredAt: body.occurredAt,
          place: { latitude: body.latitude, longitude: body.longitude, accuracy: body.accuracy, recordedAt: body.recordedAt },
        },
        requestMeta(req),
      ),
    );
    const arrival = outcomeOf(outcome);
    return { task: await agentTaskResponse(req, taskId), otpIssued: arrival.otpIssued, smsSent: arrival.smsSent };
  });

  app.post("/agent/tasks/:taskId/delivering", async (req) => {
    const { taskId } = taskParams.parse(req.params);
    const body = acceptBody.parse(req.body);
    await writeAgent(req, "delivery.confirm", (tx, context) => beginHandover(tx, context, taskId, body, requestMeta(req)));
    return { task: await agentTaskResponse(req, taskId) };
  });

  app.post("/agent/tasks/:taskId/otp/resend", async (req) => {
    const { taskId } = taskParams.parse(req.params);
    const result = await writeAgent(req, "delivery.confirm", (tx, context) => resendDeliveryOtp(tx, context, taskId, requestMeta(req)));
    return result;
  });

  app.post("/agent/tasks/:taskId/proofs", { bodyLimit: PROOF_BODY_LIMIT }, async (req, reply) => {
    const { taskId } = taskParams.parse(req.params);
    const body = proofBody.parse(req.body);
    const outcome = await writeAgent(req, "delivery.confirm", (tx, context) =>
      addDeliveryProof(
        tx,
        context,
        taskId,
        {
          clientRequestId: body.clientRequestId,
          occurredAt: body.occurredAt,
          kind: body.kind,
          data: Buffer.from(body.data, "base64"),
          signerName: body.signerName,
          place: placeOf(body),
        },
        requestMeta(req),
      ),
    );
    reply.status(201);
    return { proof: outcomeOf(outcome) };
  });

  app.get("/agent/tasks/:taskId/proofs/:proofId", async (req, reply) => {
    const { taskId, proofId } = proofParams.parse(req.params);
    const { context } = await readAgent(req);
    return sendProof(reply, await deliveryProofContent(db, context.company.id, taskId, proofId, context.deliveryAgent.id));
  });

  app.post("/agent/tasks/:taskId/payments", async (req, reply) => {
    const { taskId } = taskParams.parse(req.params);
    const body = paymentBody.parse(req.body);
    const parts = "parts" in body ? body.parts : [{ method: body.method, amount: body.amount, terminalId: body.terminalId }];
    const input = { clientRequestId: body.clientRequestId, occurredAt: body.occurredAt, parts };
    let collector = { companyId: "", name: "" };
    const result = await writeAgent(req, "delivery.collect_payment", (tx, context) => {
      collector = { companyId: context.company.id, name: context.deliveryAgent.name ?? context.deliveryAgent.code };
      return collectDeliveryPayment(tx, context, taskId, input, requestMeta(req));
    });
    reply.status(result.created ? 201 : 200);
    // Mijozga "to'lovingiz qabul qilindi" — tranzaksiyadan keyin, javobni kutmasdan
    if (result.notify) {
      void notifyCustomerPaymentReceived({
        companyId: collector.companyId,
        customerId: result.notify.customerId,
        amount: result.notify.amount,
        method: result.notify.method,
        collectedBy: `Yetkazuvchi ${collector.name}`,
      });
    }
    return { payment: result.payment, payments: result.payments, task: await agentTaskResponse(req, taskId) };
  });

  app.post("/agent/tasks/:taskId/confirm", async (req) => {
    const { taskId } = taskParams.parse(req.params);
    const body = confirmBody.parse(req.body);
    const outcome = await writeAgent(req, "delivery.confirm", (tx, context) =>
      confirmDelivery(
        tx,
        context,
        taskId,
        {
          clientRequestId: body.clientRequestId,
          occurredAt: body.occurredAt,
          place: { latitude: body.latitude, longitude: body.longitude, accuracy: body.accuracy, recordedAt: body.recordedAt },
          items: body.items,
          otp: body.otp,
        },
        requestMeta(req),
      ),
    );
    const summary = outcomeOf(outcome);
    const task = await agentTaskResponse(req, taskId);
    const tenant = await requireTenant(db, authOf(req).user);
    // Mijozning umumiy qarzi — faqat `delivery.view_debt` bilan
    const canViewDebt = (await effectivePermissions(db, tenant)).includes("delivery.view_debt");
    const { customerDebt: _customerDebt, ...publicSummary } = summary;
    return { summary: canViewDebt ? summary : publicSummary, task };
  });

  app.post("/agent/tasks/:taskId/fail", async (req) => {
    const { taskId } = taskParams.parse(req.params);
    const body = failBody.parse(req.body);
    await writeAgent(req, "delivery.fail", (tx, context) =>
      failDelivery(
        tx,
        context,
        taskId,
        { clientRequestId: body.clientRequestId, occurredAt: body.occurredAt, reason: body.reason, comment: body.comment, place: placeOf(body) },
        requestMeta(req),
      ),
    );
    return { task: await agentTaskResponse(req, taskId) };
  });

  app.get("/agent/customers", async (req) => {
    const query = agentCustomersQuery.parse(req.query);
    const { context, permissions } = await readAgent(req);
    return { customers: await agentCustomers(db, context, { search: query.search, canViewDebt: permissions.includes("delivery.view_debt") }) };
  });

  app.get("/agent/customers/:customerId", async (req) => {
    const { customerId } = customerParams.parse(req.params);
    const { context, permissions } = await readAgent(req);
    return agentCustomer(db, context, customerId, permissions.includes("delivery.view_debt"));
  });

  // Dostavshik to'lov oynasi: siyosatda ruxsat etilgan usullar va faol karta terminallari (bank hisobi ma'lumotisiz)
  app.get("/agent/customers/:customerId/purchases", async (req) => {
    const { customerId } = customerParams.parse(req.params);
    const { context } = await readAgent(req);
    return customerPurchases(db, context, customerId);
  });

  app.get("/agent/returns", async (req) => {
    const query = pickupQuery.parse(req.query);
    const { context } = await readAgent(req);
    return listReturnPickups(db, context.company.id, { ...query, agentId: context.deliveryAgent.id });
  });

  app.post("/agent/returns", async (req, reply) => {
    const body = pickupBody.parse(req.body);
    const result = await writeAgent(req, "delivery.return_pickup", async (tx, context) => {
      // Tasdiqsiz rejimda dostavchi pulni darhol qaytaradi — balansdan boshqasi uchun savdo qaytarish ruxsati
      if (body.refundMethod !== "balance") await requirePermission(tx, context, "sales.refund");
      return createReturnPickup(tx, context, body, requestMeta(req));
    });
    reply.status(201);
    return result;
  });

  app.get("/agent/payment-options", async (req) => {
    const { context } = await readAgent(req);
    const policy = await getDeliveryPolicy(db, context.company.id);
    return { methods: policy.collectionMethods, terminals: await paymentTerminalOptions(db, context.company.id), maxParts: MAX_PAYMENT_PARTS };
  });

  app.get("/agent/debts", async (req) => {
    const { context, permissions } = await readAgent(req);
    if (!permissions.includes("delivery.view_debt")) throw forbidden("Ruxsat yo'q: delivery.view_debt");
    return agentDebts(db, context);
  });

  app.get("/agent/reports", async (req) => {
    const query = agentReportQuery.parse(req.query);
    const { context } = await readAgent(req);
    return { report: await agentReport(db, context, query.from, query.to) };
  });
}
