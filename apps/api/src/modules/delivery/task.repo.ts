/**
 * Yetkazma yordamchilari: qulflash (FOR UPDATE — takroriy bosish va parallel amallar bitta natija beradi), holat o'tishi
 * tekshiruvi, hodisa (tarix) va audit yozuvi, mahalliy sana/vaqt (Toshkent, UTC+5).
 */
import { and, eq } from "drizzle-orm";
import { AppError, DELIVERY_STATUS_LABELS, canDeliveryTransition, notFound, type DeliveryStatus } from "@bum/shared";
import { deliveryEvents, deliveryTasks } from "../../db/schema/delivery.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import { writeAuditLog, type RequestMeta } from "../../shared/audit.js";
import type { TenantContext } from "../company/tenant.js";
import { publishDeliveryEvent } from "./realtime-bus.js";

export type DeliveryTaskRow = typeof deliveryTasks.$inferSelect;

const TASHKENT_OFFSET_MS = 5 * 3_600_000;
/** Toshkent sanasi YYYY-MM-DD. */
export const localDate = (at = new Date()) => new Date(at.getTime() + TASHKENT_OFFSET_MS).toISOString().slice(0, 10);
/** Toshkent vaqti HH:MM. */
export const localTime = (at = new Date()) => new Date(at.getTime() + TASHKENT_OFFSET_MS).toISOString().slice(11, 16);
/** Mahalliy kun boshlanishi (UTC lahza). */
export const localDayStart = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) - TASHKENT_OFFSET_MS);

/** `time` ustuni "HH:MM:SS" → "HH:MM". */
export const hhmm = (value: string | null) => (value ? value.slice(0, 5) : null);

export async function lockTask(tx: Tx, companyId: string, taskId: string): Promise<DeliveryTaskRow> {
  const [task] = await tx
    .select()
    .from(deliveryTasks)
    .where(and(eq(deliveryTasks.id, taskId), eq(deliveryTasks.companyId, companyId)))
    .limit(1)
    .for("update");
  if (!task) throw notFound("Yetkazma topilmadi");
  return task;
}

export function assertTransition(from: DeliveryStatus, to: DeliveryStatus) {
  if (!canDeliveryTransition(from, to)) {
    throw new AppError("CONFLICT", `Yetkazma holati «${DELIVERY_STATUS_LABELS[from]}» — bu amal mumkin emas`, { reason: "invalid_transition", from, to });
  }
}

export type EventPoint = { latitude: number; longitude: number; accuracy: number } | null;

export type DeliveryEventInput = {
  action: string;
  fromStatus?: DeliveryStatus | null;
  toStatus?: DeliveryStatus | null;
  actorUserId: string | null;
  occurredAt?: Date;
  point?: EventPoint;
  distanceMeters?: number | null;
  note?: string | null;
  details?: Record<string, unknown>;
  clientRequestId?: string | null;
  offline?: boolean;
};

/**
 * Hodisa (tarix) yozuvi + real-time xabar (commit bo'lganda). Xabar oluvchi agentlar: yetkazmaning joriy agenti va
 * biriktirishdagi yangi/eski agent (`details.toAgentId` / `fromAgentId`).
 */
export async function insertDeliveryEvent(
  tx: Tx,
  task: { id: string; companyId: string; deliveryAgentId?: string | null; status?: DeliveryStatus },
  input: DeliveryEventInput,
) {
  const agentIds = [task.deliveryAgentId, input.details?.toAgentId, input.details?.fromAgentId].filter((id): id is string => typeof id === "string");
  await publishDeliveryEvent(tx, {
    type: "task",
    companyId: task.companyId,
    taskId: task.id,
    agentIds: [...new Set(agentIds)],
    status: input.toStatus ?? task.status ?? null,
    action: input.action,
  });
  const [event] = await tx
    .insert(deliveryEvents)
    .values({
      companyId: task.companyId,
      taskId: task.id,
      action: input.action,
      fromStatus: input.fromStatus ?? null,
      toStatus: input.toStatus ?? null,
      actorUserId: input.actorUserId,
      occurredAt: input.occurredAt ?? new Date(),
      latitude: input.point ? input.point.latitude.toFixed(6) : null,
      longitude: input.point ? input.point.longitude.toFixed(6) : null,
      accuracy: input.point ? input.point.accuracy.toFixed(2) : null,
      distanceMeters: input.distanceMeters ?? null,
      note: input.note ?? null,
      details: input.details ?? null,
      clientRequestId: input.clientRequestId ?? null,
      offline: input.offline ?? false,
    })
    .returning({ id: deliveryEvents.id });
  return event!;
}

/** Shu so'rov kaliti bilan amal bajarilganmi (takroriy bosish yoki oflayn navbat qayta yuborilgan). */
export async function eventByRequest(conn: DbOrTx, taskId: string, clientRequestId: string) {
  const [event] = await conn
    .select({ id: deliveryEvents.id, action: deliveryEvents.action })
    .from(deliveryEvents)
    .where(and(eq(deliveryEvents.taskId, taskId), eq(deliveryEvents.clientRequestId, clientRequestId)))
    .limit(1);
  return event ?? null;
}

export function deliveryAudit(
  tx: Tx,
  tenant: TenantContext,
  meta: RequestMeta,
  action: string,
  taskId: string,
  details: Record<string, unknown>,
  severity: "info" | "warning" = "info",
) {
  return writeAuditLog(
    { userId: tenant.user.id, userName: tenant.user.name, companyId: tenant.company.id, action, resource: "delivery_tasks", resourceId: taskId, details, severity, ...meta },
    tx,
  );
}
