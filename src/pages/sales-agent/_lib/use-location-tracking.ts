/**
 * Agent lokatsiyasi kuzatuvi — brauzerda ilova ochiq paytda (`watchPosition`), Android ilovada fonda ham (ekran
 * qulflanganda, doimiy bildirishnoma bilan) — `@/lib/native/geolocation.ts`.
 * Serverga siyosatdagi oraliqda yoki 50 m dan ko'p siljiganda yuboriladi (lekin 15 soniyada bir martadan ko'p emas —
 * mashinada har bir necha soniyada so'rov ketib zaryad yemasin); server sifatni tekshiradi va rad etsa sababini
 * qaytaradi. Ruxsat berilmasa — holat "denied" (sotuv amallari bloklanadi) va serverga bir marta xabar beriladi.
 * Ish sessiyasi yopilgan (409) bo'lsa — `onSessionEnded` (ish sessiyasi qayta o'qiladi va kuzatuv to'xtaydi).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api, errorMessage } from "@/lib/api.ts";
import { locationSupported, watchLocation } from "@/lib/native/geolocation.ts";

export type TrackingStatus = "locating" | "active" | "rejected" | "denied" | "unavailable";

type Point = { latitude: number; longitude: number };

export type TrackedLocation = {
  status: TrackingStatus;
  point: Point | null;
  /** Aniqlik radiusi, metr. */
  accuracy: number | null;
  /**
   * So'rovlar uchun barqaror nuqta: birinchi aniqlashda va 100 m dan ko'p siljiganda yangilanadi —
   * do'konlar ro'yxati har GPS yangilanishida qayta yuklanmaydi.
   */
  origin: Point | null;
  /** Server rad etgan sabab (`low_accuracy`, `stale`, `invalid`). */
  reason: string | null;
  /** Server yoki qurilma xabari. */
  message: string | null;
  /** Serverga oxirgi muvaffaqiyatli yuborilgan vaqt (ms). */
  lastSentAt: number | null;
};

export type AgentLocation = TrackedLocation & { request: () => void };

type LocationResponse = { accepted: boolean; reason?: string; message?: string; nextIntervalSeconds: number };

const MOVE_THRESHOLD_METERS = 50;
const ORIGIN_THRESHOLD_METERS = 100;
const DISPLAY_THRESHOLD_METERS = 5;
/** Siljish bo'yicha yuborishda ham ikki so'rov orasidagi eng kam vaqt. */
const MIN_SEND_SPACING_MS = 15_000;
const supported = locationSupported;
const BACKGROUND_NOTICE = { title: "BUM ERP — savdo agenti", message: "Ish vaqti: lokatsiya marshrut uchun yuborilmoqda" };

/** Taxminiy masofa (faqat yuborish qarori uchun; aniq hisob serverda). */
function roughMeters(a: Point, b: Point) {
  const dLat = (b.latitude - a.latitude) * 111_320;
  const dLng = (b.longitude - a.longitude) * 111_320 * Math.cos((a.latitude * Math.PI) / 180);
  return Math.hypot(dLat, dLng);
}

/** Nuqtani yuborish vaqti keldimi: oraliq o'tdi yoki 50 m siljidi (15 soniyadan tez emas). */
export function locationDue(last: { at: number; point: Point } | null, now: number, point: Point, intervalSeconds: number) {
  if (!last) return true;
  const elapsed = now - last.at;
  if (elapsed >= intervalSeconds * 1000) return true;
  return elapsed >= MIN_SEND_SPACING_MS && roughMeters(last.point, point) >= MOVE_THRESHOLD_METERS;
}

export function useLocationTracking(enabled: boolean, intervalSeconds: number, onSessionEnded?: () => void): AgentLocation {
  const [state, setState] = useState<TrackedLocation>(() => ({
    status: supported() ? "locating" : "unavailable",
    point: null,
    accuracy: null,
    origin: null,
    reason: null,
    message: null,
    lastSentAt: null,
  }));
  const [attempt, setAttempt] = useState(0);
  const interval = useRef(intervalSeconds);
  const sessionEnded = useRef(onSessionEnded);
  const lastSent = useRef<{ at: number; point: Point } | null>(null);
  const shown = useRef<{ point: Point; accuracy: number } | null>(null);
  const origin = useRef<Point | null>(null);
  const sending = useRef(false);
  const reported = useRef<Set<string>>(new Set());

  useEffect(() => {
    interval.current = intervalSeconds;
    sessionEnded.current = onSessionEnded;
  }, [intervalSeconds, onSessionEnded]);

  const report = useCallback((type: "permission_denied" | "update_failure", message: string) => {
    if (reported.current.has(type)) return;
    reported.current.add(type);
    void api.post("/api/sales-agent/location/events", { type, message }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!enabled || !supported()) return;
    return watchLocation(
      (fix) => {
        const point = { latitude: fix.latitude, longitude: fix.longitude };
        const accuracy = fix.accuracy;
        const originMoved = !origin.current || roughMeters(origin.current, point) >= ORIGIN_THRESHOLD_METERS;
        if (originMoved) origin.current = point;
        const displayMoved =
          !shown.current || originMoved || roughMeters(shown.current.point, point) >= DISPLAY_THRESHOLD_METERS || Math.abs(shown.current.accuracy - accuracy) >= 10;
        if (displayMoved) {
          shown.current = { point, accuracy };
          const stableOrigin = origin.current;
          setState((previous) => ({
            ...previous,
            point,
            accuracy,
            origin: stableOrigin,
            status: previous.status === "rejected" ? "rejected" : "active",
          }));
        }

        if (!locationDue(lastSent.current, Date.now(), point, interval.current) || sending.current) return;
        sending.current = true;
        api
          .post<LocationResponse>("/api/sales-agent/location", {
            latitude: point.latitude,
            longitude: point.longitude,
            accuracy,
            recordedAt: new Date(fix.timestamp).toISOString(),
          })
          .then((result) => {
            lastSent.current = { at: Date.now(), point };
            interval.current = result.nextIntervalSeconds;
            setState((previous) =>
              result.accepted
                ? { ...previous, status: "active", reason: null, message: null, lastSentAt: Date.now() }
                : { ...previous, status: "rejected", reason: result.reason ?? null, message: result.message ?? null },
            );
          })
          .catch((error: unknown) => {
            // Xato bo'lsa ham darhol qayta urinilmaydi (oraliq bo'yicha keyingi nuqtada)
            lastSent.current = { at: Date.now(), point };
            if (error instanceof ApiError && error.status === 409) sessionEnded.current?.();
            setState((previous) => ({ ...previous, message: errorMessage(error) }));
          })
          .finally(() => {
            sending.current = false;
          });
      },
      (failure) => {
        setState((previous) => ({
          ...previous,
          status: failure.denied ? "denied" : previous.point ? previous.status : "unavailable",
          message: failure.message || null,
        }));
        report(failure.denied ? "permission_denied" : "update_failure", failure.message);
      },
      { background: BACKGROUND_NOTICE, intervalSeconds: interval.current },
    );
  }, [enabled, attempt, report]);

  /** "Lokatsiyani yoqish" — qayta so'rash (brauzer ruxsat oynasi yoki GPS). */
  const request = useCallback(() => {
    setState((previous) => ({ ...previous, status: supported() ? "locating" : "unavailable", message: null }));
    setAttempt((value) => value + 1);
  }, []);

  return { ...state, request };
}
