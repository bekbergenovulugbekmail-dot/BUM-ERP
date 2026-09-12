/**
 * Agent amali: onlayn — darhol serverga; internet yo'q (yoki shu yetkazmaning oldingi amali navbatda) va siyosat ruxsat
 * bersa — qurilma navbatiga (so'rov kaliti va amal vaqti bilan). Server rad etgan amal (4xx) navbatga tushmaydi —
 * xato darhol ko'rsatiladi.
 */
import type { QueryClient } from "@tanstack/react-query";
import { ApiError, api } from "@/lib/api.ts";
import { isNetworkError } from "@/lib/delivery/errors.ts";
import { enqueue, readQueue, type DeliveryAction, type QueueError, type QueuedAction } from "./offline-queue.ts";

export type ActionOutcome<T> = { queued: false; data: T } | { queued: true };

export const actionPath = (taskId: string, action: DeliveryAction) => `/api/delivery/agent/tasks/${taskId}/${action}`;

/** Keyinroq qayta yuboriladigan xato: tarmoq, server vaqtincha ishlamayapti, so'rov chegarasi yoki sessiya tugagan. */
export function isRetryable(error: unknown): boolean {
  return isNetworkError(error) || (error instanceof ApiError && (error.status >= 500 || error.status === 429 || error.status === 401));
}

export function classifyQueueError(error: unknown): { network: boolean; error: QueueError } {
  const details = error instanceof ApiError ? error.details : undefined;
  const reason = details && typeof details === "object" && "reason" in details ? (details as { reason?: unknown }).reason : undefined;
  return {
    network: isRetryable(error),
    error: {
      status: error instanceof ApiError ? error.status : 0,
      code: error instanceof ApiError ? error.code : "UNKNOWN",
      message: error instanceof Error ? error.message : "",
      reason: typeof reason === "string" ? reason : null,
      details,
    },
  };
}

export async function performAction<T>(
  taskId: string,
  action: DeliveryAction,
  body: QueuedAction["body"],
  options: { offlineAllowed: boolean; meta?: QueuedAction["meta"] },
): Promise<ActionOutcome<T>> {
  // Shu yetkazmaning oldingi amali navbatda bo'lsa — tartib buzilmasin, keyingisi ham navbatga
  const waiting = readQueue().some((item) => item.taskId === taskId && item.state === "pending");
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  if (!(options.offlineAllowed && (waiting || offline))) {
    try {
      return { queued: false, data: await api.post<T>(actionPath(taskId, action), body) };
    } catch (error) {
      if (!options.offlineAllowed || !isNetworkError(error)) throw error;
    }
  }
  enqueue(taskId, action, body, options.meta);
  return { queued: true };
}

export function invalidateDelivery(queryClient: QueryClient) {
  return queryClient.invalidateQueries({
    predicate: (query) => typeof query.queryKey[0] === "string" && query.queryKey[0].startsWith("/api/delivery/agent"),
  });
}
