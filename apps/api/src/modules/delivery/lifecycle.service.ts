/**
 * Yetkazma jarayoni — barcha tekshiruvlar serverda (mijoz holatni, masofani yoki "ichida" belgisini o'zi o'rnata olmaydi):
 *
 *   qabul → yo'lga chiqish (buyurtma hali jo'natilmagan bo'lsa — mavjud `shipOrder`: zaxira chiqimi, mijoz qarzi, jurnal;
 *   holat qulf ostida tekshiriladi, ikkinchi marta yozilmaydi) → mijozga yetdim (ish sessiyasi, GPS yangiligi va aniqligi,
 *   mijoz koordinatasi, haversine masofa, geofence) → topshirish (rasm/imzo isboti, OTP, to'lov — mavjud mijoz to'lovi:
 *   kassa/bank, jurnal, qarz) → tasdiqlash (to'liq yoki qisman; kam yig'ilsa siyosat bo'yicha) yoki "yetkazib bo'lmadi".
 *   Boshqaruvchi: qaytgan mahsulotni qabul qilish (mavjud qisman qaytarish — zaxira, qarz, jurnal teskari), to'lov farqini
 *   ko'rib chiqish, OTP berish.
 *
 * Har agent amali `clientRequestId` bilan idempotent (takroriy bosish — bitta natija). Oflayn navbatdagi amal vaqti
 * (`occurredAt`) siyosatdagi muddat ichida bo'lishi va o'sha paytda ish sessiyasi ochiq bo'lgani tekshiriladi; GPS yangiligi
 * amal vaqtiga nisbatan, geofence, to'lov qoldig'i va holat o'tishi — qayta serverda.
 */
import { createHash } from "node:crypto";
import { and, asc, count, eq, inArray, isNull, or, sql } from "drizzle-orm";
import {
  AppError,
  DELIVERY_FAILURE_LABELS,
  badRequest,
  conflict,
  notFound,
  rateLimited,
  type DeliveryCollectionMethod,
  type DeliveryFailureReason,
  type DeliveryPaymentReview,
  type DeliveryPaymentStatus,
  type DeliveryPolicy,
  type DeliveryProofKind,
  type DeliveryStatus,
} from "@bum/shared";
import { deliveryAgents, deliveryPayments, deliveryProofs, deliveryTaskItems, deliveryTasks, deliveryWorkSessions } from "../../db/schema/delivery.js";
import { customers, salesOrderItems, salesOrders } from "../../db/schema/sales.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import type { RequestMeta } from "../../shared/audit.js";
import { fromMinor, mulDivRound, toMinor } from "../../shared/decimal.js";
import { distanceMeters, isValidCoordinate, pointOf } from "../../shared/geo.js";
import { recordHit } from "../../shared/rate-limit.js";
import { smsProvider } from "../../shared/sms.js";
import type { TenantContext } from "../company/tenant.js";
import { shipOrder } from "../sales/orders.service.js";
import { isCompletedSale } from "../sales/sale-status.js";
import { createPaymentHeader, recordAllocations, resolvePaymentParts, settlePaymentParts } from "../sales/payment-allocation.service.js";
import { agentCashAccount } from "./agent-cash.service.js";
import { returnSaleItems, type RefundMethod } from "../sales/returns.service.js";
import { checkLocationQuality, type LocationInput } from "../sales-agent/location.service.js";
import { DIRECT_PHOTO_MAX_BYTES, sniffImage } from "../sales-agent/visits.service.js";
import type { DeliveryAgentContext } from "./agent-context.js";
import { notifyDeliveryManagers } from "./notify.js";
import { generateOtp, hashOtp, verifyOtp } from "./otp.js";
import { getDeliveryPolicy } from "./policy.service.js";
import { assertTransition, deliveryAudit, eventByRequest, insertDeliveryEvent, localDate, lockTask, type DeliveryTaskRow, type EventPoint } from "./task.repo.js";
import { orderOutstanding } from "./tasks.service.js";

/** Rad etish hodisasi (geofence, OTP urinishi) tranzaksiyada saqlangach xato qaytariladi. */
export type Outcome<T> = { result: T } | { blocked: AppError };

export type ActionInput = { clientRequestId: string; occurredAt?: Date };
export type Place = LocationInput;
export type OptionalPlace = { latitude: number; longitude: number; accuracy: number; recordedAt?: Date } | null;

const MAX_PROOFS = 10;
/** Shundan yangi amal vaqti — onlayn (real vaqt) amal. */
const REALTIME_MS = 120_000;
const CLOCK_SKEW_MS = 60_000;
const OTP_SENDS_PER_WINDOW = 3;
const OTP_SEND_WINDOW_SECONDS = 600;

const pointFrom = (place: OptionalPlace | Place): EventPoint =>
  place && isValidCoordinate(place) ? { latitude: place.latitude, longitude: place.longitude, accuracy: place.accuracy } : null;

/**
 * Amal vaqti: berilmasa — hozir. Kelajakda (1 daqiqadan ortiq) — rad; 2 daqiqadan eski — oflayn navbat: siyosat ruxsat
 * bermasa yoki `offlineMaxAgeHours` dan eski bo'lsa — rad.
 */
export function resolveOccurredAt(policy: DeliveryPolicy, occurredAt: Date | undefined, now = new Date()): { at: Date; offline: boolean } {
  if (!occurredAt) return { at: now, offline: false };
  const ageMs = now.getTime() - occurredAt.getTime();
  if (ageMs < -CLOCK_SKEW_MS) throw badRequest("Qurilma vaqti noto'g'ri — telefon soatini tekshiring", { reason: "clock_skew" });
  if (ageMs <= REALTIME_MS) return { at: occurredAt, offline: false };
  if (!policy.offlineActionsAllowed) {
    throw badRequest("Oflayn amallar kompaniya siyosatida o'chirilgan — internet bilan qayta bajaring", { reason: "offline_disabled" });
  }
  if (ageMs > policy.offlineMaxAgeHours * 3_600_000) throw badRequest("Navbatdagi amal juda eski — qayta bajaring", { reason: "offline_too_old" });
  return { at: occurredAt, offline: true };
}

/** Amal paytida ish sessiyasi ochiq bo'lishi kerak (oflayn amal — o'sha vaqtdagi sessiya). */
async function requireSessionAt(tx: Tx, deliveryAgentId: string, at: Date, offline: boolean) {
  const moment = at.toISOString();
  const [session] = await tx
    .select({ id: deliveryWorkSessions.id })
    .from(deliveryWorkSessions)
    .where(
      and(
        eq(deliveryWorkSessions.deliveryAgentId, deliveryAgentId),
        offline
          ? and(
              sql`${deliveryWorkSessions.startedAt} <= ${moment}::timestamptz`,
              or(isNull(deliveryWorkSessions.endedAt), sql`${deliveryWorkSessions.endedAt} >= ${moment}::timestamptz`),
            )
          : eq(deliveryWorkSessions.status, "active"),
      ),
    )
    .limit(1);
  if (!session) {
    throw new AppError("CONFLICT", "Ish boshlanmagan — avval «Ishni boshlash» tugmasini bosing", { reason: "work_session_required" });
  }
}

/** Agent faqat o'ziga biriktirilgan yetkazmada ishlaydi — boshqasi "topilmadi". */
async function lockAgentTask(tx: Tx, context: DeliveryAgentContext, taskId: string) {
  const task = await lockTask(tx, context.company.id, taskId);
  if (task.deliveryAgentId !== context.deliveryAgent.id) throw notFound("Yetkazma topilmadi");
  return task;
}

/** GPS sifati amal vaqtiga nisbatan: noto'g'ri, eskirgan yoki aniqligi yetarli emas — rad. */
function assertPlace(policy: DeliveryPolicy, place: Place, at: Date) {
  const rejection = checkLocationQuality(policy, place, at.getTime());
  if (!rejection) return;
  const message = rejection.reason === "low_accuracy" ? "GPS aniqligi yetarli emas. Iltimos, qayta urinib ko'ring." : rejection.message;
  throw badRequest(message, { reason: rejection.reason });
}

type GeofenceResult = { distance: number | null } | { blocked: AppError };

/**
 * Geofence: masofa faqat serverda (haversine, metrga yaxlitlab); `masofa > radius` — rad (200 m radiusda 200 — ruxsat,
 * 201 — rad). Rad etish hodisa, audit va (siyosat bo'yicha) supervayzer bildirishnomasi bilan saqlanadi.
 */
async function geofence(
  tx: Tx,
  context: DeliveryAgentContext,
  task: DeliveryTaskRow,
  policy: DeliveryPolicy,
  place: Place,
  at: Date,
  offline: boolean,
  attempted: "arrive" | "confirm" | "photo",
  meta: RequestMeta,
): Promise<GeofenceResult> {
  const [customer] = await tx
    .select({ name: customers.name, latitude: customers.latitude, longitude: customers.longitude })
    .from(customers)
    .where(eq(customers.id, task.customerId))
    .limit(1);
  const target = pointOf(customer!.latitude, customer!.longitude);
  if (!target) {
    if (policy.requireCustomerLocation) {
      throw badRequest("Mijoz joylashuvi saqlanmagan — supervayzerga murojaat qiling", { reason: "customer_location_missing" });
    }
    return { distance: null };
  }
  const distance = Math.round(distanceMeters(place, target));
  if (distance <= policy.geofenceRadiusMeters) return { distance };

  const details = {
    attempted,
    customerId: task.customerId,
    distanceMeters: distance,
    radiusMeters: policy.geofenceRadiusMeters,
    accuracy: Math.round(place.accuracy),
    latitude: place.latitude,
    longitude: place.longitude,
    recordedAt: place.recordedAt.toISOString(),
  };
  await insertDeliveryEvent(tx, task, {
    action: "GEOFENCE_BLOCK",
    actorUserId: context.user.id,
    occurredAt: at,
    point: pointFrom(place),
    distanceMeters: distance,
    details,
    offline,
  });
  await deliveryAudit(tx, context, meta, "DELIVERY_GEOFENCE_BLOCK", task.id, { number: task.number, ...details }, "warning");
  if (policy.geofenceAlerts) {
    await notifyDeliveryManagers(tx, context.company.id, policy, "geofence", {
      title: "Geofence buzilishi",
      message: `${context.deliveryAgent.name}: ${customer!.name} (${task.number}) — ${distance} m, ruxsat ${policy.geofenceRadiusMeters} m`,
      taskId: task.id,
    });
  }
  const message = attempted === "arrive" ? "Mijoz manziliga yaqinlashing" : "Yetkazib berishni tasdiqlash uchun mijoz manziliga yaqinlashing";
  return {
    blocked: new AppError("FORBIDDEN", message, { reason: "geofence", distanceMeters: distance, radiusMeters: policy.geofenceRadiusMeters }),
  };
}

async function sendOtpSms(conn: DbOrTx, task: DeliveryTaskRow, code: string) {
  const client = smsProvider.client;
  if (!client) return false;
  const [customer] = await conn.select({ phone: customers.phone }).from(customers).where(eq(customers.id, task.customerId)).limit(1);
  if (!customer?.phone) return false;
  try {
    await client(customer.phone, `BUM ERP: ${task.number} yetkazmani qabul qilish kodi ${code}. Kodni faqat mahsulotni olganingizda ayting.`);
    return true;
  } catch {
    return false;
  }
}

/** Yangi OTP: faqat hash saqlanadi; SMS sozlangan bo'lsa mijozga yuboriladi. */
async function issueOtp(tx: Tx, task: DeliveryTaskRow, policy: DeliveryPolicy, at: Date) {
  const code = generateOtp();
  const expiresAt = new Date(at.getTime() + policy.otpTtlMinutes * 60_000);
  await tx
    .update(deliveryTasks)
    .set({ otpHash: hashOtp(task.id, code), otpExpiresAt: expiresAt, otpAttempts: 0, otpVerifiedAt: null, updatedAt: new Date() })
    .where(eq(deliveryTasks.id, task.id));
  const smsSent = await sendOtpSms(tx, task, code);
  return { code, expiresAt, smsSent };
}

// ─── Agent amallari ──────────────────────────────────────────────────────────

export async function acceptDelivery(tx: Tx, context: DeliveryAgentContext, taskId: string, input: ActionInput, meta: RequestMeta) {
  const task = await lockAgentTask(tx, context, taskId);
  if (await eventByRequest(tx, task.id, input.clientRequestId)) return;
  const policy = await getDeliveryPolicy(tx, context.company.id);
  const { at, offline } = resolveOccurredAt(policy, input.occurredAt);
  assertTransition(task.status, "accepted");
  await tx.update(deliveryTasks).set({ status: "accepted", acceptedAt: at, updatedAt: new Date() }).where(eq(deliveryTasks.id, task.id));
  await insertDeliveryEvent(tx, task, {
    action: "ACCEPTED",
    fromStatus: task.status,
    toStatus: "accepted",
    actorUserId: context.user.id,
    occurredAt: at,
    clientRequestId: input.clientRequestId,
    offline,
  });
  await deliveryAudit(tx, context, meta, "DELIVERY_ACCEPTED", task.id, { number: task.number, offline });
}

/**
 * Yo'lga chiqish: mahsulot ombordan chiqadi. Buyurtma hali "tasdiqlangan" bo'lsa — mavjud jo'natish oqimi (zaxira chiqimi,
 * qarz, sotuv jurnali) shu tranzaksiyada; allaqachon jo'natilgan bo'lsa (ombor jo'natgan yoki qayta rejalash) — takror yozilmaydi.
 */
export async function startDelivery(
  tx: Tx,
  context: DeliveryAgentContext,
  taskId: string,
  input: ActionInput & { place?: OptionalPlace },
  meta: RequestMeta,
) {
  const task = await lockAgentTask(tx, context, taskId);
  if (await eventByRequest(tx, task.id, input.clientRequestId)) return;
  const policy = await getDeliveryPolicy(tx, context.company.id);
  const { at, offline } = resolveOccurredAt(policy, input.occurredAt);
  assertTransition(task.status, "out_for_delivery");
  await requireSessionAt(tx, context.deliveryAgent.id, at, offline);

  const [order] = await tx
    .select({ status: salesOrders.status, number: salesOrders.number })
    .from(salesOrders)
    .where(eq(salesOrders.id, task.orderId))
    .limit(1)
    .for("update");
  let dispatched = false;
  if (order!.status === "confirmed") {
    await shipOrder(tx, context, task.orderId, meta);
    dispatched = true;
  } else if (!isCompletedSale(order!.status)) {
    throw new AppError("CONFLICT", `Buyurtma ${order!.number} holati yetkazishga yaroqsiz`, { reason: "order_not_deliverable", orderStatus: order!.status });
  }

  await tx.update(deliveryTasks).set({ status: "out_for_delivery", startedAt: at, updatedAt: new Date() }).where(eq(deliveryTasks.id, task.id));
  await insertDeliveryEvent(tx, task, {
    action: "OUT_FOR_DELIVERY",
    fromStatus: task.status,
    toStatus: "out_for_delivery",
    actorUserId: context.user.id,
    occurredAt: at,
    point: pointFrom(input.place ?? null),
    details: { dispatched },
    clientRequestId: input.clientRequestId,
    offline,
  });
  await deliveryAudit(tx, context, meta, "DELIVERY_STARTED", task.id, { number: task.number, orderNumber: order!.number, dispatched, offline });
}

export async function arriveDelivery(
  tx: Tx,
  context: DeliveryAgentContext,
  taskId: string,
  input: ActionInput & { place: Place },
  meta: RequestMeta,
): Promise<Outcome<{ otpIssued: boolean; smsSent: boolean }>> {
  const task = await lockAgentTask(tx, context, taskId);
  if (await eventByRequest(tx, task.id, input.clientRequestId)) return { result: { otpIssued: task.otpHash !== null, smsSent: false } };
  const policy = await getDeliveryPolicy(tx, context.company.id);
  const { at, offline } = resolveOccurredAt(policy, input.occurredAt);
  assertTransition(task.status, "arrived");
  await requireSessionAt(tx, context.deliveryAgent.id, at, offline);
  assertPlace(policy, input.place, at);
  const geo = await geofence(tx, context, task, policy, input.place, at, offline, "arrive", meta);
  if ("blocked" in geo) return geo;

  await tx
    .update(deliveryTasks)
    .set({
      status: "arrived",
      arrivedAt: at,
      arrivalLatitude: input.place.latitude.toFixed(6),
      arrivalLongitude: input.place.longitude.toFixed(6),
      arrivalAccuracy: input.place.accuracy.toFixed(2),
      arrivalDistanceMeters: geo.distance,
      updatedAt: new Date(),
    })
    .where(eq(deliveryTasks.id, task.id));
  const otp = policy.confirmation.otp ? await issueOtp(tx, task, policy, at) : null;
  await insertDeliveryEvent(tx, task, {
    action: "ARRIVED",
    fromStatus: task.status,
    toStatus: "arrived",
    actorUserId: context.user.id,
    occurredAt: at,
    point: pointFrom(input.place),
    distanceMeters: geo.distance,
    details: { otpIssued: otp !== null, smsSent: otp?.smsSent ?? false },
    clientRequestId: input.clientRequestId,
    offline,
  });
  await deliveryAudit(tx, context, meta, "DELIVERY_ARRIVED", task.id, { number: task.number, distanceMeters: geo.distance, offline });
  return { result: { otpIssued: otp !== null, smsSent: otp?.smsSent ?? false } };
}

export async function beginHandover(tx: Tx, context: DeliveryAgentContext, taskId: string, input: ActionInput, meta: RequestMeta) {
  const task = await lockAgentTask(tx, context, taskId);
  if (await eventByRequest(tx, task.id, input.clientRequestId)) return;
  const policy = await getDeliveryPolicy(tx, context.company.id);
  const { at, offline } = resolveOccurredAt(policy, input.occurredAt);
  assertTransition(task.status, "delivering");
  await requireSessionAt(tx, context.deliveryAgent.id, at, offline);
  await tx.update(deliveryTasks).set({ status: "delivering", deliveringAt: at, updatedAt: new Date() }).where(eq(deliveryTasks.id, task.id));
  await insertDeliveryEvent(tx, task, {
    action: "DELIVERING",
    fromStatus: task.status,
    toStatus: "delivering",
    actorUserId: context.user.id,
    occurredAt: at,
    clientRequestId: input.clientRequestId,
    offline,
  });
  await deliveryAudit(tx, context, meta, "DELIVERY_HANDOVER_STARTED", task.id, { number: task.number, offline });
}

/** Agent mijozga kodni qayta yuboradi (SMS sozlangan bo'lsa; kodning o'zi agentga ko'rinmaydi). */
export async function resendDeliveryOtp(tx: Tx, context: DeliveryAgentContext, taskId: string, meta: RequestMeta) {
  const task = await lockAgentTask(tx, context, taskId);
  if (task.status !== "arrived" && task.status !== "delivering") {
    throw new AppError("CONFLICT", "Kod mijoz oldida so'raladi (yetib kelgandan keyin)", { reason: "invalid_transition", from: task.status });
  }
  if (!smsProvider.client) throw new AppError("CONFLICT", "SMS sozlanmagan — kodni supervayzerdan so'rang", { reason: "sms_unavailable" });
  if ((await recordHit(`delivery-otp:${task.id}`, OTP_SEND_WINDOW_SECONDS)) > OTP_SENDS_PER_WINDOW) throw rateLimited();
  const policy = await getDeliveryPolicy(tx, context.company.id);
  const { smsSent, expiresAt } = await issueOtp(tx, task, policy, new Date());
  await insertDeliveryEvent(tx, task, { action: "OTP_SENT", actorUserId: context.user.id, details: { smsSent } });
  await deliveryAudit(tx, context, meta, "DELIVERY_OTP_SENT", task.id, { number: task.number, smsSent });
  return { smsSent, expiresAt };
}

export type ProofInput = ActionInput & {
  kind: DeliveryProofKind;
  data: Buffer;
  signerName?: string | null;
  place: OptionalPlace;
};

export async function addDeliveryProof(
  tx: Tx,
  context: DeliveryAgentContext,
  taskId: string,
  input: ProofInput,
  meta: RequestMeta,
): Promise<Outcome<{ id: string; kind: DeliveryProofKind; takenAt: Date }>> {
  const task = await lockAgentTask(tx, context, taskId);
  const [existing] = await tx
    .select({ id: deliveryProofs.id, kind: deliveryProofs.kind, takenAt: deliveryProofs.takenAt })
    .from(deliveryProofs)
    .where(and(eq(deliveryProofs.taskId, task.id), eq(deliveryProofs.clientRequestId, input.clientRequestId)))
    .limit(1);
  if (existing) return { result: existing };
  if (task.status !== "arrived" && task.status !== "delivering") {
    throw new AppError("CONFLICT", "Isbot mijoz oldida qo'shiladi (yetib kelgandan keyin)", { reason: "invalid_transition", from: task.status });
  }
  const policy = await getDeliveryPolicy(tx, context.company.id);
  const { at, offline } = resolveOccurredAt(policy, input.occurredAt);
  await requireSessionAt(tx, context.deliveryAgent.id, at, offline);
  const [{ proofs } = { proofs: 0 }] = await tx.select({ proofs: count() }).from(deliveryProofs).where(eq(deliveryProofs.taskId, task.id));
  if (proofs >= MAX_PROOFS) throw badRequest(`Yetkazmaga ko'pi bilan ${MAX_PROOFS} ta isbot`);

  // Turi baytlardan (mijoz yuborgan turga ishonilmaydi): rasm — JPEG/PNG/WebP, imzo — PNG
  const contentType = sniffImage(input.data);
  const allowed = input.kind === "signature" ? contentType === "image/png" : contentType !== null;
  if (!contentType || !allowed || input.data.length > DIRECT_PHOTO_MAX_BYTES) {
    throw badRequest(
      input.kind === "signature"
        ? `Imzo PNG bo'lishi va ${DIRECT_PHOTO_MAX_BYTES / 1024 / 1024} MB dan oshmasligi kerak`
        : `Rasm JPEG, PNG yoki WebP bo'lishi va ${DIRECT_PHOTO_MAX_BYTES / 1024 / 1024} MB dan oshmasligi kerak`,
      { reason: "proof_invalid" },
    );
  }

  let distance: number | null = null;
  if (input.kind === "photo") {
    // Rasm mijoz yonida olinadi — joy majburiy va geofence qayta tekshiriladi
    if (!input.place?.recordedAt) throw badRequest("Rasm joyi (GPS) majburiy", { reason: "location_required" });
    const place: Place = { ...input.place, recordedAt: input.place.recordedAt };
    assertPlace(policy, place, at);
    const geo = await geofence(tx, context, task, policy, place, at, offline, "photo", meta);
    if ("blocked" in geo) return geo;
    distance = geo.distance;
  } else if (!input.signerName || input.signerName.trim().length < 2) {
    throw badRequest("Imzo qo'ygan shaxs ismi majburiy", { reason: "signer_required" });
  }

  const point = pointFrom(input.place);
  const [proof] = await tx
    .insert(deliveryProofs)
    .values({
      companyId: context.company.id,
      taskId: task.id,
      kind: input.kind,
      content: input.data,
      contentType,
      sizeBytes: input.data.length,
      signerName: input.kind === "signature" ? input.signerName!.trim() : null,
      latitude: point ? point.latitude.toFixed(6) : null,
      longitude: point ? point.longitude.toFixed(6) : null,
      accuracy: point ? point.accuracy.toFixed(2) : null,
      distanceMeters: distance,
      takenAt: at,
      uploadedBy: context.user.id,
      clientRequestId: input.clientRequestId,
    })
    .returning({ id: deliveryProofs.id, kind: deliveryProofs.kind, takenAt: deliveryProofs.takenAt });
  if (input.kind === "signature") {
    await tx.update(deliveryTasks).set({ signerName: input.signerName!.trim(), updatedAt: new Date() }).where(eq(deliveryTasks.id, task.id));
  }
  await insertDeliveryEvent(tx, task, {
    action: input.kind === "signature" ? "SIGNATURE" : "PHOTO",
    actorUserId: context.user.id,
    occurredAt: at,
    point,
    distanceMeters: distance,
    details: { proofId: proof!.id, sizeBytes: input.data.length },
    clientRequestId: input.clientRequestId,
    offline,
  });
  await deliveryAudit(tx, context, meta, "DELIVERY_PROOF_ADDED", task.id, { number: task.number, kind: input.kind, sizeBytes: input.data.length });
  return { result: proof! };
}

export type DeliveryPaymentPart = { method: DeliveryCollectionMethod; amount: string; terminalId?: string | null };

/** Qism so'rov kaliti: birinchisi — so'rov kalitining o'zi (eski yozuvlar bilan mos), keyingilari undan hosil qilingan UUID. */
function partRequestId(clientRequestId: string, index: number) {
  if (index === 0) return clientRequestId;
  const hex = createHash("sha256").update(`${clientRequestId}:${index}`).digest("hex");
  const variant = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/**
 * To'lov qabul qilish — universal taqsimot (`payment-allocation.service.ts`): bitta yoki aralash (naqd + karta terminali +
 * bank), faqat siyosatda ruxsat etilgan usullar; jami buyurtma qoldig'idan oshmaydi. Har qism — mijoz to'lovi (kassa/bank
 * kirimi, DR hisob / CR debitorlar, buyurtmaning to'langan summasi, mijoz qarzi) va `delivery_payments` qatori.
 * Takroriy so'rov (qayta bosish, oflayn navbat) — shu so'rov kaliti bo'yicha yangi to'lov yaratmaydi.
 */
export async function collectDeliveryPayment(
  tx: Tx,
  context: DeliveryAgentContext,
  taskId: string,
  input: ActionInput & { parts: DeliveryPaymentPart[] },
  meta: RequestMeta,
) {
  const companyId = context.company.id;
  const task = await lockAgentTask(tx, context, taskId);
  const requestIds = input.parts.map((_, index) => partRequestId(input.clientRequestId, index));
  const existing = await tx
    .select()
    .from(deliveryPayments)
    .where(and(eq(deliveryPayments.companyId, companyId), inArray(deliveryPayments.clientRequestId, requestIds)))
    .orderBy(asc(deliveryPayments.createdAt), asc(deliveryPayments.id));
  const first = existing.find((row) => row.clientRequestId === input.clientRequestId);
  if (first) {
    if (first.taskId !== task.id) throw conflict("So'rov kaliti boshqa yetkazmada ishlatilgan");
    return { payment: first, payments: existing.filter((row) => row.taskId === task.id), created: false, notify: null };
  }
  if (task.status !== "arrived" && task.status !== "delivering") {
    throw new AppError("CONFLICT", "To'lov mijoz oldida qabul qilinadi (yetib kelgandan keyin)", { reason: "invalid_transition", from: task.status });
  }
  const policy = await getDeliveryPolicy(tx, companyId);
  const { at, offline } = resolveOccurredAt(policy, input.occurredAt);
  await requireSessionAt(tx, context.deliveryAgent.id, at, offline);

  // Naqd — yetkazuvchining "yo'ldagi naqd" hisobiga (kassaga topshirilguncha), karta/bank — terminal yoki bank hisobiga
  const agentAccountId = input.parts.some((part) => part.method === "cash") ? await agentCashAccount(tx, companyId, context.deliveryAgent) : null;
  const parts = await resolvePaymentParts(
    tx,
    companyId,
    input.parts.map((part) => (part.method === "cash" ? { ...part, cashAccountId: agentAccountId } : part)),
    { allowedMethods: policy.collectionMethods, offline },
  );
  if (parts.length === 0) throw badRequest("To'lov summasi kiritilmagan");
  const [order] = await tx
    .select({ id: salesOrders.id, totalAmount: salesOrders.totalAmount, paidAmount: salesOrders.paidAmount })
    .from(salesOrders)
    .where(and(eq(salesOrders.id, task.orderId), eq(salesOrders.companyId, companyId)))
    .limit(1)
    .for("update");
  if (!order) throw notFound("Buyurtma topilmadi");
  // Qoldiqdan ortiq yig'ilmaydi (dostavshik aniq summani kiritadi); kami — qisman yig'ish, tasdiqlashda siyosat bo'yicha
  settlePaymentParts(parts, await orderOutstanding(tx, order), { allowCashChange: false, allowShortfall: true });

  const total = parts.reduce((sum, part) => sum + part.amount, 0n);
  const header = await createPaymentHeader(tx, context, {
    source: "delivery",
    idempotencyKey: `delivery:${input.clientRequestId}`,
    customerId: task.customerId,
    orderId: task.orderId,
    total,
  });
  const allocations = await recordAllocations(
    tx,
    context,
    header,
    parts,
    { orderId: task.orderId, paymentDate: localDate(at), notes: `Yetkazma ${task.number}`, firstReference: `delivery:${input.clientRequestId}` },
    meta,
  );
  const rows = [];
  for (const [index, part] of parts.entries()) {
    const [row] = await tx
      .insert(deliveryPayments)
      .values({
        companyId,
        taskId: task.id,
        customerPaymentId: allocations[index]!.id,
        // Usul siyosatdagi ro'yxatdan (`allowedMethods`) — dostavka usullari ichida
        method: part.method as DeliveryCollectionMethod,
        amount: fromMinor(part.amount),
        collectedBy: context.user.id,
        collectedAt: at,
        clientRequestId: partRequestId(input.clientRequestId, index),
        offline,
      })
      .returning();
    rows.push(row!);
  }
  const collected = toMinor(task.collectedAmount) + total;
  await tx.update(deliveryTasks).set({ collectedAmount: fromMinor(collected), updatedAt: new Date() }).where(eq(deliveryTasks.id, task.id));
  const partDetails = parts.map((part, index) => ({
    method: part.method,
    amount: fromMinor(part.amount),
    customerPaymentId: allocations[index]!.id,
    ...(part.terminalId ? { terminalId: part.terminalId } : {}),
  }));
  // Bitta qism — avvalgi ko'rinish (method, amount, customerPaymentId); aralash — `mixed` va qismlar
  const details = partDetails.length === 1 ? partDetails[0]! : { method: "mixed", amount: fromMinor(total), parts: partDetails };
  await insertDeliveryEvent(tx, task, {
    action: "PAYMENT",
    actorUserId: context.user.id,
    occurredAt: at,
    details: { ...details, paymentId: header.id },
    clientRequestId: input.clientRequestId,
    offline,
  });
  await deliveryAudit(tx, context, meta, "DELIVERY_PAYMENT_COLLECTED", task.id, {
    number: task.number,
    ...details,
    paymentId: header.id,
    offline,
  });
  // Mijozga xabar uchun (tranzaksiyadan keyin marshrutda yuboriladi)
  return {
    payment: rows[0]!,
    payments: rows,
    created: true,
    notify: {
      customerId: task.customerId,
      amount: fromMinor(total),
      method: parts.length > 1 ? "mixed" : parts[0]!.method,
    },
  };
}

export type ConfirmSummary = {
  taskId: string;
  number: string;
  status: DeliveryStatus;
  orderNumber: string;
  orderTotal: string;
  deliveredValue: string;
  expectedAmount: string;
  collectedAmount: string;
  mismatchAmount: string;
  paymentStatus: DeliveryPaymentStatus;
  paymentReview: DeliveryPaymentReview;
  /** Buyurtmaning yig'ilmagan qoldig'i (mijoz qarzida). */
  orderBalance: string;
  customerDebt: string;
};

export async function confirmSummary(conn: DbOrTx, taskId: string): Promise<ConfirmSummary> {
  const [task] = await conn.select().from(deliveryTasks).where(eq(deliveryTasks.id, taskId)).limit(1);
  const [order] = await conn
    .select({ id: salesOrders.id, number: salesOrders.number, totalAmount: salesOrders.totalAmount, paidAmount: salesOrders.paidAmount })
    .from(salesOrders)
    .where(eq(salesOrders.id, task!.orderId))
    .limit(1);
  const [customer] = await conn.select({ totalDebt: customers.totalDebt }).from(customers).where(eq(customers.id, task!.customerId)).limit(1);
  const items = await conn
    .select({ deliveredQty: deliveryTaskItems.deliveredQty, orderQuantity: salesOrderItems.quantity, lineTotal: salesOrderItems.lineTotal })
    .from(deliveryTaskItems)
    .innerJoin(salesOrderItems, eq(salesOrderItems.id, deliveryTaskItems.orderItemId))
    .where(eq(deliveryTaskItems.taskId, taskId));
  const deliveredValue = items.reduce((sum, item) => {
    const orderQty = toMinor(item.orderQuantity, 4);
    return item.deliveredQty === null || orderQty === 0n ? sum : sum + mulDivRound(toMinor(item.lineTotal), toMinor(item.deliveredQty, 4), orderQty);
  }, 0n);
  const expected = toMinor(task!.expectedAmount);
  const collected = toMinor(task!.collectedAmount);
  return {
    taskId,
    number: task!.number,
    status: task!.status,
    orderNumber: order!.number,
    orderTotal: order!.totalAmount,
    deliveredValue: fromMinor(deliveredValue),
    expectedAmount: task!.expectedAmount,
    collectedAmount: task!.collectedAmount,
    mismatchAmount: fromMinor(expected > collected ? expected - collected : 0n),
    paymentStatus: task!.paymentStatus,
    paymentReview: task!.paymentReview,
    orderBalance: fromMinor(await orderOutstanding(conn, order!)),
    customerDebt: customer!.totalDebt,
  };
}

export type ConfirmInput = ActionInput & { place: Place; items?: { taskItemId: string; deliveredQty: string }[]; otp?: string };

/**
 * Yetkazishni tasdiqlash (to'liq yoki qisman). Buyurtma o'zgarmaydi — yetkazilgan miqdor yetkazma qatorida; qolgani
 * qaytarish orqali omborga kiradi. Kutilgan to'lov qisman yetkazishda yetkazilgan qiymat ulushida. Kam yig'ilsa:
 * `block` — rad, `approval` — supervayzer ko'rib chiqadi, `debt` — farq mijoz qarzida.
 */
export async function confirmDelivery(
  tx: Tx,
  context: DeliveryAgentContext,
  taskId: string,
  input: ConfirmInput,
  meta: RequestMeta,
): Promise<Outcome<ConfirmSummary>> {
  const task = await lockAgentTask(tx, context, taskId);
  if (await eventByRequest(tx, task.id, input.clientRequestId)) return { result: await confirmSummary(tx, task.id) };
  const policy = await getDeliveryPolicy(tx, context.company.id);
  const { at, offline } = resolveOccurredAt(policy, input.occurredAt);
  if (task.status !== "arrived" && task.status !== "delivering") assertTransition(task.status, "delivered");
  await requireSessionAt(tx, context.deliveryAgent.id, at, offline);
  assertPlace(policy, input.place, at);
  const geo = await geofence(tx, context, task, policy, input.place, at, offline, "confirm", meta);
  if ("blocked" in geo) return geo;

  const items = await tx
    .select({
      id: deliveryTaskItems.id,
      quantity: deliveryTaskItems.quantity,
      orderQuantity: salesOrderItems.quantity,
      lineTotal: salesOrderItems.lineTotal,
    })
    .from(deliveryTaskItems)
    .innerJoin(salesOrderItems, eq(salesOrderItems.id, deliveryTaskItems.orderItemId))
    .where(eq(deliveryTaskItems.taskId, task.id))
    .for("update", { of: deliveryTaskItems });
  const requested = new Map((input.items ?? []).map((item) => [item.taskItemId, item.deliveredQty]));
  if (input.items && requested.size !== input.items.length) throw badRequest("Qator takrorlangan");
  for (const id of requested.keys()) if (!items.some((item) => item.id === id)) throw badRequest("Yetkazmada bunday qator yo'q");

  let fullValue = 0n;
  let deliveredValue = 0n;
  let partial = false;
  const delivered = new Map<string, bigint>();
  for (const item of items) {
    const quantity = toMinor(item.quantity, 4);
    const qty = requested.has(item.id) ? toMinor(requested.get(item.id)!, 4) : quantity;
    if (qty < 0n || qty > quantity) {
      throw badRequest(`Yetkazilgan miqdor 0 dan ${fromMinor(quantity, 4)} gacha bo'lishi kerak`, { reason: "quantity_range", taskItemId: item.id });
    }
    const orderQty = toMinor(item.orderQuantity, 4);
    const value = (part: bigint) => (orderQty === 0n ? 0n : mulDivRound(toMinor(item.lineTotal), part, orderQty));
    fullValue += value(quantity);
    deliveredValue += value(qty);
    if (qty < quantity) partial = true;
    delivered.set(item.id, qty);
  }
  if ([...delivered.values()].every((qty) => qty === 0n)) {
    throw badRequest("Hech narsa yetkazilmadi — «Yetkazib bo'lmadi» amalini tanlang", { reason: "nothing_delivered" });
  }

  const proofs = await tx.select({ kind: deliveryProofs.kind }).from(deliveryProofs).where(eq(deliveryProofs.taskId, task.id));
  if (policy.confirmation.photo && !proofs.some((proof) => proof.kind === "photo")) {
    throw badRequest("Topshirish rasmi talab qilinadi", { reason: "photo_required" });
  }
  if (policy.confirmation.signature && !proofs.some((proof) => proof.kind === "signature")) {
    throw badRequest("Mijoz imzosi talab qilinadi", { reason: "signature_required" });
  }
  let otpVerifiedAt = task.otpVerifiedAt;
  if (policy.confirmation.otp && !otpVerifiedAt) {
    if (!task.otpHash) throw new AppError("CONFLICT", "OTP kod berilmagan — supervayzerdan so'rang", { reason: "otp_missing" });
    if (task.otpAttempts >= policy.otpMaxAttempts) throw badRequest("OTP urinishlari tugadi — yangi kod so'rang", { reason: "otp_locked" });
    if (task.otpExpiresAt && task.otpExpiresAt < at) throw badRequest("OTP kod muddati o'tgan — yangi kod so'rang", { reason: "otp_expired" });
    if (!input.otp || !verifyOtp(task.id, input.otp, task.otpHash)) {
      const attempts = task.otpAttempts + 1;
      await tx.update(deliveryTasks).set({ otpAttempts: attempts, updatedAt: new Date() }).where(eq(deliveryTasks.id, task.id));
      await insertDeliveryEvent(tx, task, { action: "OTP_FAILED", actorUserId: context.user.id, occurredAt: at, details: { attempts }, offline });
      return { blocked: badRequest("OTP kod noto'g'ri", { reason: "otp_invalid", attemptsLeft: Math.max(0, policy.otpMaxAttempts - attempts) }) };
    }
    otpVerifiedAt = at;
  }

  const originalExpected = toMinor(task.expectedAmount);
  const expected = partial && fullValue > 0n ? mulDivRound(originalExpected, deliveredValue, fullValue) : originalExpected;
  const collected = toMinor(task.collectedAmount);
  const mismatch = expected > collected ? expected - collected : 0n;
  let paymentStatus: DeliveryPaymentStatus;
  let paymentReview: DeliveryPaymentReview = task.paymentReview;
  if (expected === 0n && collected === 0n) paymentStatus = "not_required";
  else if (mismatch === 0n) paymentStatus = "paid";
  else if (policy.mismatchPolicy === "block") {
    throw badRequest(`To'lov to'liq yig'ilmagan: kutilgan ${fromMinor(expected)}, yig'ilgan ${fromMinor(collected)}`, {
      reason: "payment_mismatch",
      expectedAmount: fromMinor(expected),
      collectedAmount: fromMinor(collected),
      mismatchAmount: fromMinor(mismatch),
    });
  } else if (policy.mismatchPolicy === "approval") {
    paymentStatus = "mismatch";
    paymentReview = "pending";
  } else {
    paymentStatus = "partial";
  }

  for (const [id, qty] of delivered) {
    await tx.update(deliveryTaskItems).set({ deliveredQty: fromMinor(qty, 4), updatedAt: new Date() }).where(eq(deliveryTaskItems.id, id));
  }
  const status: DeliveryStatus = partial ? "partially_delivered" : "delivered";
  await tx
    .update(deliveryTasks)
    .set({
      status,
      deliveredAt: at,
      deliveringAt: task.deliveringAt ?? at,
      confirmLatitude: input.place.latitude.toFixed(6),
      confirmLongitude: input.place.longitude.toFixed(6),
      confirmAccuracy: input.place.accuracy.toFixed(2),
      confirmDistanceMeters: geo.distance,
      expectedAmount: fromMinor(expected),
      paymentStatus,
      paymentReview,
      otpVerifiedAt,
      updatedAt: new Date(),
    })
    .where(eq(deliveryTasks.id, task.id));
  const details = {
    expectedAmount: fromMinor(expected),
    originalExpectedAmount: task.expectedAmount,
    collectedAmount: fromMinor(collected),
    mismatchAmount: fromMinor(mismatch),
    deliveredValue: fromMinor(deliveredValue),
    fullValue: fromMinor(fullValue),
    paymentStatus,
  };
  await insertDeliveryEvent(tx, task, {
    action: partial ? "PARTIALLY_DELIVERED" : "DELIVERED",
    fromStatus: task.status,
    toStatus: status,
    actorUserId: context.user.id,
    occurredAt: at,
    point: pointFrom(input.place),
    distanceMeters: geo.distance,
    details,
    clientRequestId: input.clientRequestId,
    offline,
  });
  await deliveryAudit(tx, context, meta, "DELIVERY_CONFIRMED", task.id, { number: task.number, status, offline, ...details });
  if (mismatch > 0n) {
    await deliveryAudit(tx, context, meta, "DELIVERY_PAYMENT_MISMATCH", task.id, { number: task.number, policy: policy.mismatchPolicy, ...details }, "warning");
    if (policy.mismatchPolicy === "approval") {
      await notifyDeliveryManagers(tx, context.company.id, policy, "mismatch", {
        title: "To'lov farqi",
        message: `${context.deliveryAgent.name}: ${task.number} — kutilgan ${fromMinor(expected)}, yig'ilgan ${fromMinor(collected)}, farq ${fromMinor(mismatch)}`,
        taskId: task.id,
      });
    }
  }
  return { result: await confirmSummary(tx, task.id) };
}

export async function failDelivery(
  tx: Tx,
  context: DeliveryAgentContext,
  taskId: string,
  input: ActionInput & { reason: DeliveryFailureReason; comment?: string | null; place?: OptionalPlace },
  meta: RequestMeta,
) {
  const task = await lockAgentTask(tx, context, taskId);
  if (await eventByRequest(tx, task.id, input.clientRequestId)) return;
  const comment = input.comment?.trim() || null;
  if (input.reason === "other" && (!comment || comment.length < 3)) {
    throw badRequest("«Boshqa» sababi uchun izoh majburiy", { reason: "comment_required" });
  }
  const policy = await getDeliveryPolicy(tx, context.company.id);
  const { at, offline } = resolveOccurredAt(policy, input.occurredAt);
  assertTransition(task.status, "failed");
  await requireSessionAt(tx, context.deliveryAgent.id, at, offline);

  await tx
    .update(deliveryTasks)
    .set({ status: "failed", failedAt: at, failureReason: input.reason, failureComment: comment, updatedAt: new Date() })
    .where(eq(deliveryTasks.id, task.id));
  await insertDeliveryEvent(tx, task, {
    action: "FAILED",
    fromStatus: task.status,
    toStatus: "failed",
    actorUserId: context.user.id,
    occurredAt: at,
    point: pointFrom(input.place ?? null),
    note: comment,
    details: { reason: input.reason },
    clientRequestId: input.clientRequestId,
    offline,
  });
  await deliveryAudit(tx, context, meta, "DELIVERY_FAILED", task.id, { number: task.number, reason: input.reason, comment, offline }, "warning");
  const collected = toMinor(task.collectedAmount);
  await notifyDeliveryManagers(tx, context.company.id, policy, "failed", {
    title: "Yetkazib bo'lmadi",
    message: `${context.deliveryAgent.name}: ${task.number} — ${DELIVERY_FAILURE_LABELS[input.reason]}${comment ? ` (${comment})` : ""}${
      collected > 0n ? `; yig'ilgan to'lov ${fromMinor(collected)}` : ""
    }`,
    taskId: task.id,
  });
}

// ─── Boshqaruvchi amallari ───────────────────────────────────────────────────

/**
 * Qaytgan mahsulotni omborga qabul qilish: yetkazilmagan (qolgan) miqdor mavjud qisman qaytarish oqimi bilan — zaxira
 * qaytadi, sotuv va qarz kamayadi, jurnal teskari; to'langan pul (bo'lsa) tanlangan usulda qaytadi. Bir marta.
 */
export async function returnDeliveryGoods(
  tx: Tx,
  tenant: TenantContext,
  taskId: string,
  input: { refundMethod: RefundMethod; reason?: string | null },
  meta: RequestMeta,
) {
  const task = await lockTask(tx, tenant.company.id, taskId);
  if (task.status === "failed") assertTransition(task.status, "returned");
  else if (task.status === "partially_delivered") {
    if (task.returnedAt) throw new AppError("CONFLICT", "Qolgan mahsulot allaqachon qaytarilgan", { reason: "already_returned" });
  } else {
    throw new AppError("CONFLICT", "Faqat yetkazilmagan yoki qisman yetkazilgan yetkazmaning mahsuloti qaytariladi", {
      reason: "invalid_transition",
      from: task.status,
    });
  }

  const items = await tx
    .select({
      id: deliveryTaskItems.id,
      orderItemId: deliveryTaskItems.orderItemId,
      quantity: deliveryTaskItems.quantity,
      deliveredQty: deliveryTaskItems.deliveredQty,
      returnedQty: deliveryTaskItems.returnedQty,
    })
    .from(deliveryTaskItems)
    .where(eq(deliveryTaskItems.taskId, task.id))
    .for("update");
  const remaining = items
    .map((item) => ({
      ...item,
      remaining: toMinor(item.quantity, 4) - toMinor(item.deliveredQty ?? "0", 4) - toMinor(item.returnedQty, 4),
    }))
    .filter((item) => item.remaining > 0n);
  if (remaining.length === 0) throw new AppError("CONFLICT", "Qaytariladigan mahsulot yo'q", { reason: "nothing_to_return" });

  const [order] = await tx.select({ status: salesOrders.status }).from(salesOrders).where(eq(salesOrders.id, task.orderId)).limit(1);
  let restocked = false;
  if (isCompletedSale(order!.status)) {
    await returnSaleItems(
      tx,
      tenant,
      task.orderId,
      {
        items: remaining.map((item) => ({ orderItemId: item.orderItemId, quantity: fromMinor(item.remaining, 4) })),
        refundMethod: input.refundMethod,
        reason: `Yetkazma ${task.number} qaytdi${input.reason ? `: ${input.reason}` : ""}`,
      },
      meta,
    );
    restocked = true;
  }
  for (const item of remaining) {
    await tx
      .update(deliveryTaskItems)
      .set({ returnedQty: fromMinor(toMinor(item.returnedQty, 4) + item.remaining, 4), updatedAt: new Date() })
      .where(eq(deliveryTaskItems.id, item.id));
  }
  const now = new Date();
  const status: DeliveryStatus = task.status === "failed" ? "returned" : task.status;
  await tx.update(deliveryTasks).set({ status, returnedAt: now, updatedAt: now }).where(eq(deliveryTasks.id, task.id));
  const details = {
    items: remaining.map((item) => ({ orderItemId: item.orderItemId, quantity: fromMinor(item.remaining, 4) })),
    restocked,
    refundMethod: input.refundMethod,
  };
  await insertDeliveryEvent(tx, task, {
    action: "RETURNED",
    fromStatus: task.status,
    toStatus: status,
    actorUserId: tenant.user.id,
    note: input.reason ?? null,
    details,
  });
  await deliveryAudit(tx, tenant, meta, "DELIVERY_RETURNED", task.id, { number: task.number, reason: input.reason ?? null, ...details });
}

/** To'lov farqini ko'rib chiqish: approved — farq mijoz qarzida qoladi; rejected — kamomad sifatida qayd (izoh bilan). */
export async function reviewDeliveryPayment(
  tx: Tx,
  tenant: TenantContext,
  taskId: string,
  input: { decision: "approved" | "rejected"; note: string },
  meta: RequestMeta,
) {
  const task = await lockTask(tx, tenant.company.id, taskId);
  if (task.paymentReview !== "pending") throw new AppError("CONFLICT", "To'lov farqi ko'rib chiqishni kutmayapti", { reason: "review_not_pending" });
  const now = new Date();
  await tx
    .update(deliveryTasks)
    .set({ paymentReview: input.decision, paymentReviewedBy: tenant.user.id, paymentReviewedAt: now, paymentReviewNote: input.note, updatedAt: now })
    .where(eq(deliveryTasks.id, task.id));
  await insertDeliveryEvent(tx, task, { action: "PAYMENT_REVIEWED", actorUserId: tenant.user.id, details: { decision: input.decision } });
  await deliveryAudit(tx, tenant, meta, "DELIVERY_PAYMENT_REVIEWED", task.id, {
    number: task.number,
    decision: input.decision,
    expectedAmount: task.expectedAmount,
    collectedAmount: task.collectedAmount,
  });
}

/** Boshqaruvchi OTP beradi (SMS yo'q bo'lsa mijozga telefonda aytadi). Kod javobda bir marta; auditga yozilmaydi. */
export async function issueDeliveryOtp(tx: Tx, tenant: TenantContext, taskId: string, meta: RequestMeta) {
  const task = await lockTask(tx, tenant.company.id, taskId);
  if (task.status !== "out_for_delivery" && task.status !== "arrived" && task.status !== "delivering") {
    throw new AppError("CONFLICT", "OTP faqat yo'ldagi yetkazmaga beriladi", { reason: "invalid_transition", from: task.status });
  }
  // OTP mijoz tasdig'i: yetkazmani o'zi olib borayotgan dostavshik (menejer ruxsati bo'lsa ham) kodni o'ziga ololmaydi
  if (task.deliveryAgentId) {
    const [agent] = await tx.select({ userId: deliveryAgents.userId }).from(deliveryAgents).where(eq(deliveryAgents.id, task.deliveryAgentId)).limit(1);
    if (agent?.userId === tenant.user.id) {
      throw new AppError("FORBIDDEN", "O'zingizga biriktirilgan yetkazma uchun OTP bera olmaysiz — boshqa menejer beradi", { reason: "otp_self_issue" });
    }
  }
  const policy = await getDeliveryPolicy(tx, tenant.company.id);
  const otp = await issueOtp(tx, task, policy, new Date());
  await insertDeliveryEvent(tx, task, { action: "OTP_ISSUED", actorUserId: tenant.user.id, details: { smsSent: otp.smsSent } });
  await deliveryAudit(tx, tenant, meta, "DELIVERY_OTP_ISSUED", task.id, { number: task.number, smsSent: otp.smsSent, expiresAt: otp.expiresAt.toISOString() });
  return otp;
}

/** Isbot fayli: boshqaruvchi — kompaniya yetkazmasi, agent — faqat o'z yetkazmasi. */
export async function deliveryProofContent(conn: DbOrTx, companyId: string, taskId: string, proofId: string, deliveryAgentId?: string) {
  const [row] = await conn
    .select({ content: deliveryProofs.content, contentType: deliveryProofs.contentType, agentId: deliveryTasks.deliveryAgentId })
    .from(deliveryProofs)
    .innerJoin(deliveryTasks, eq(deliveryTasks.id, deliveryProofs.taskId))
    .where(and(eq(deliveryProofs.id, proofId), eq(deliveryProofs.taskId, taskId), eq(deliveryTasks.companyId, companyId)))
    .limit(1);
  if (!row || (deliveryAgentId !== undefined && row.agentId !== deliveryAgentId)) throw notFound("Isbot topilmadi");
  return { content: row.content, contentType: row.contentType };
}
