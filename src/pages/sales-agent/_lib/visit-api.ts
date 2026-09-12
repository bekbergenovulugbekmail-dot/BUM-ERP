/**
 * Tashrif amallari yordamchilari: yangi GPS o'lchovi (tashrif boshlash/yakunlashda eskirgan nuqta yuborilmaydi),
 * rasmni siqib saqlashga yuklash va server xatolarini agent tilidagi xabarga aylantirish.
 */
import type { TFunction } from "i18next";
import { api, ApiError, errorMessage } from "@/lib/api.ts";
import type { AgentVisit, PhotoKind } from "./types.ts";

export type LocationPayload = { latitude: number; longitude: number; accuracy: number; recordedAt: string };

/** Hozirgi joy — 15 soniyadan eski bo'lmagan o'lchov. */
export function freshPosition(): Promise<LocationPayload> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      reject(new ApiError(0, "LOCATION_UNAVAILABLE", ""));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          recordedAt: new Date(position.timestamp).toISOString(),
        }),
      (error) =>
        reject(new ApiError(0, error.code === error.PERMISSION_DENIED ? "LOCATION_DENIED" : "LOCATION_UNAVAILABLE", error.message)),
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 15_000 },
    );
  });
}

const MAX_SIDE = 1600;

/** Telefon rasmi odatda 3–10 MB: 1600 px JPEG ga siqiladi (mobil internet uchun). Xato bo'lsa — asl fayl. */
async function compressImage(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
    return blob ?? file;
  } catch {
    return file;
  }
}

type SignedUpload = { key: string; uploadUrl: string; method: "PUT"; headers: Record<string, string> };

/** Rasm: imzolangan URL → saqlashga PUT → tashrifga biriktirish (server kalit, hajm va turni tekshiradi). */
export async function uploadVisitPhoto(
  visitId: string,
  file: File,
  kind: PhotoKind,
  point: { latitude: number; longitude: number; accuracy: number | null } | null,
): Promise<AgentVisit["photos"][number]> {
  const blob = await compressImage(file);
  const contentType = blob.type || file.type;
  const upload = await api.post<SignedUpload>(`/api/sales-agent/visits/${visitId}/photos/uploads`, { contentType, size: blob.size });

  let response: Response;
  try {
    response = await fetch(upload.uploadUrl, { method: upload.method, headers: upload.headers, body: blob });
  } catch {
    throw new ApiError(0, "UPLOAD_FAILED", "");
  }
  if (!response.ok) throw new ApiError(response.status, "UPLOAD_FAILED", "");

  const { photo } = await api.post<{ photo: AgentVisit["photos"][number] }>(`/api/sales-agent/visits/${visitId}/photos`, {
    key: upload.key,
    kind,
    ...(point ? { latitude: point.latitude, longitude: point.longitude, accuracy: point.accuracy } : {}),
  });
  return photo;
}

const LOCATION_REASONS = new Set(["low_accuracy", "stale", "invalid"]);
const ORDER_REASONS = new Set([
  "credit_limit",
  "out_of_stock",
  "due_date_required",
  "due_date_past",
  "delivery_date_required",
  "delivery_date_out_of_range",
  "store_location_missing",
  "empty_order",
]);

/** Server xatosi (sabab kodi bilan) → agent tilidagi xabar; `action` — geofence matni tashrif yoki buyurtma uchun. */
export function visitErrorMessage(error: unknown, t: TFunction<"agent">, action: "visit" | "order" = "visit"): string {
  if (error instanceof ApiError) {
    const details = (error.details ?? {}) as {
      reason?: string;
      distanceMeters?: number;
      radiusMeters?: number;
      limit?: string;
      exposure?: string;
      available?: string;
    };
    if (details.reason === "geofence" && typeof details.distanceMeters === "number") {
      return t(`${action}.geofence`, { distance: details.distanceMeters, radius: details.radiusMeters });
    }
    if (details.reason && LOCATION_REASONS.has(details.reason)) return t(`location.rejected.${details.reason}`);
    if (details.reason === "photo_required") return t("visit.photo.required");
    if (details.reason && ORDER_REASONS.has(details.reason)) {
      return t(`order.error.${details.reason}`, { limit: details.limit, exposure: details.exposure, available: details.available });
    }
    if (error.code === "LOCATION_DENIED") return t("location.denied");
    if (error.code === "LOCATION_UNAVAILABLE") return t("location.unavailable");
    if (error.code === "UPLOAD_FAILED") return t("visit.photo.upload_failed");
  }
  return errorMessage(error);
}
