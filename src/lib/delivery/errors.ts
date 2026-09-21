/**
 * Dostavka API xatolari → foydalanuvchi tilidagi xabar (server `details.reason` kodi bo'yicha).
 */
import type { TFunction } from "i18next";
import { ApiError, errorMessage } from "@/lib/api.ts";

const KNOWN_REASONS = new Set([
  "low_accuracy",
  "stale",
  "invalid",
  "work_session_required",
  "invalid_transition",
  "photo_required",
  "signature_required",
  "signer_required",
  "proof_invalid",
  "location_required",
  "otp_missing",
  "otp_expired",
  "otp_locked",
  "customer_location_missing",
  "comment_required",
  "nothing_delivered",
  "quantity_range",
  "offline_too_old",
  "offline_disabled",
  "clock_skew",
  "sms_unavailable",
  "task_in_progress",
  "order_not_deliverable",
  "open_tasks",
  "task_exists",
  "date_in_past",
  "already_returned",
  "nothing_to_return",
  "nothing_to_redeliver",
  "redelivery_exists",
  "redelivery_open",
  "redelivery_required",
  "review_not_pending",
  "not_assigned",
  "on_route",
  "recipient_invalid",
  "auto_assign_disabled",
]);

/** Tarmoq xatosi (internet yo'q yoki service worker keshida javob yo'q) — amal navbatga qo'yilishi mumkin. */
export function isNetworkError(error: unknown): boolean {
  if (error instanceof ApiError) return error.code === "NETWORK" || error.status === 0;
  return error instanceof TypeError;
}

export function deliveryErrorMessage(error: unknown, t: TFunction<"delivery">): string {
  if (error instanceof ApiError) {
    if (error.code === "LOCATION_DENIED") return t("error.location_denied");
    if (error.code === "LOCATION_UNAVAILABLE") return t("error.location_unavailable");
    if (isNetworkError(error)) return t("error.network");
    const details = (error.details ?? {}) as Record<string, unknown>;
    const reason = typeof details.reason === "string" ? details.reason : null;
    if (reason === "geofence") return t("error.geofence", { distance: details.distanceMeters, radius: details.radiusMeters });
    if (reason === "otp_invalid") return t("error.otp_invalid", { count: Number(details.attemptsLeft ?? 0) });
    if (reason === "payment_mismatch") {
      return t("error.payment_mismatch", { expected: details.expectedAmount, collected: details.collectedAmount, mismatch: details.mismatchAmount });
    }
    if (reason && KNOWN_REASONS.has(reason)) return t(`error.${reason}`);
  } else if (isNetworkError(error)) {
    return t("error.network");
  }
  return errorMessage(error);
}
