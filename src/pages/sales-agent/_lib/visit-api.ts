/**
 * Tashrif amallari yordamchilari: yangi GPS o'lchovi (tashrif boshlash/yakunlashda eskirgan nuqta yuborilmaydi),
 * rasmni siqib yuklash va server xatolarini agent tilidagi xabarga aylantirish.
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

/** Telefon rasmi odatda 3–10 MB: JPEG ga siqiladi (mobil internet uchun). Xato bo'lsa — asl fayl. */
async function compressImage(file: File, maxSide: number, quality: number): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    return blob ?? file;
  } catch {
    return file;
  }
}

async function base64Of(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

type SignedUpload = { key: string; uploadUrl: string; method: "PUT"; headers: Record<string, string> };
type VisitPhoto = AgentVisit["photos"][number];

/**
 * Rasm: fayl saqlash (S3) sozlangan bo'lsa — imzolangan URL → PUT → biriktirish; sozlanmagan bo'lsa (503) — kichikroq
 * JPEG to'g'ridan-to'g'ri API'ga (bazada saqlanadi). Joy har doim yuboriladi: server rasm do'kon hududida olinganini tekshiradi.
 */
export async function uploadVisitPhoto(visitId: string, file: File, kind: PhotoKind, point: LocationPayload): Promise<VisitPhoto> {
  const blob = await compressImage(file, 1600, 0.82);
  const contentType = blob.type || file.type;
  let upload: SignedUpload | null = null;
  try {
    upload = await api.post<SignedUpload>(`/api/sales-agent/visits/${visitId}/photos/uploads`, { contentType, size: blob.size });
  } catch (err) {
    if (!(err instanceof ApiError && err.status === 503)) throw err;
  }

  if (!upload) {
    const small = await compressImage(file, 1280, 0.72);
    const { photo } = await api.post<{ photo: VisitPhoto }>(`/api/sales-agent/visits/${visitId}/photos/direct`, {
      kind,
      contentType: small.type || "image/jpeg",
      data: await base64Of(small),
      ...point,
    });
    return photo;
  }

  let response: Response;
  try {
    response = await fetch(upload.uploadUrl, { method: upload.method, headers: upload.headers, body: blob });
  } catch {
    throw new ApiError(0, "UPLOAD_FAILED", "");
  }
  if (!response.ok) throw new ApiError(response.status, "UPLOAD_FAILED", "");

  const { photo } = await api.post<{ photo: VisitPhoto }>(`/api/sales-agent/visits/${visitId}/photos`, { key: upload.key, kind, ...point });
  return photo;
}

const LOCATION_REASONS = new Set(["low_accuracy", "stale", "invalid"]);
const VISIT_REASONS = new Set([
  "storefront_photo_required",
  "shelf_photo_required",
  "visit_too_short",
  "visit_required",
  "visit_invalid",
  "work_session_required",
  "photo_invalid",
  "visit_in_progress",
]);
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
      remainingSeconds?: number;
    };
    if (details.reason === "geofence" && typeof details.distanceMeters === "number") {
      return t(`${action}.geofence`, { distance: details.distanceMeters, radius: details.radiusMeters });
    }
    if (details.reason && LOCATION_REASONS.has(details.reason)) return t(`location.rejected.${details.reason}`);
    if (details.reason === "photo_required") return t("visit.photo.required");
    if (details.reason && VISIT_REASONS.has(details.reason)) {
      return t(`visit.error.${details.reason}`, { minutes: Math.max(1, Math.ceil((details.remainingSeconds ?? 0) / 60)) });
    }
    if (details.reason && ORDER_REASONS.has(details.reason)) {
      return t(`order.error.${details.reason}`, { limit: details.limit, exposure: details.exposure, available: details.available });
    }
    if (error.code === "LOCATION_DENIED") return t("location.denied");
    if (error.code === "LOCATION_UNAVAILABLE") return t("location.unavailable");
    if (error.code === "UPLOAD_FAILED") return t("visit.photo.upload_failed");
  }
  return errorMessage(error);
}
