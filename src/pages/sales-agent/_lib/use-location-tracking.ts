/**
 * Agent lokatsiyasi kuzatuvi — ilova ochiq paytda (brauzer `watchPosition`).
 * Serverga siyosatdagi oraliqda yoki 50 m dan ko'p siljiganda yuboriladi; server sifatni tekshiradi va rad etsa sababini
 * qaytaradi. Ruxsat berilmasa — holat "denied" (sotuv amallari bloklanadi) va serverga bir marta xabar beriladi.
 * Telefon qulflanganda yoki boshqa ilovaga o'tilganda brauzer lokatsiya bermaydi — fonda kuzatuv native ilovada.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "@/lib/api.ts";

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
const supported = () => typeof navigator !== "undefined" && "geolocation" in navigator;

/** Taxminiy masofa (faqat yuborish qarori uchun; aniq hisob serverda). */
function roughMeters(a: Point, b: Point) {
  const dLat = (b.latitude - a.latitude) * 111_320;
  const dLng = (b.longitude - a.longitude) * 111_320 * Math.cos((a.latitude * Math.PI) / 180);
  return Math.hypot(dLat, dLng);
}

export function useLocationTracking(enabled: boolean, intervalSeconds: number): AgentLocation {
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
  const lastSent = useRef<{ at: number; point: Point } | null>(null);
  const origin = useRef<Point | null>(null);
  const sending = useRef(false);
  const reported = useRef<Set<string>>(new Set());

  useEffect(() => {
    interval.current = intervalSeconds;
  }, [intervalSeconds]);

  const report = useCallback((type: "permission_denied" | "update_failure", message: string) => {
    if (reported.current.has(type)) return;
    reported.current.add(type);
    void api.post("/api/sales-agent/location/events", { type, message }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!enabled || !supported()) return;
    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const point = { latitude: position.coords.latitude, longitude: position.coords.longitude };
        const accuracy = position.coords.accuracy;
        if (!origin.current || roughMeters(origin.current, point) >= ORIGIN_THRESHOLD_METERS) origin.current = point;
        const stableOrigin = origin.current;
        setState((previous) => ({
          ...previous,
          point,
          accuracy,
          origin: stableOrigin,
          status: previous.status === "rejected" ? "rejected" : "active",
        }));

        const now = Date.now();
        const due =
          !lastSent.current ||
          now - lastSent.current.at >= interval.current * 1000 ||
          roughMeters(lastSent.current.point, point) >= MOVE_THRESHOLD_METERS;
        if (!due || sending.current) return;
        sending.current = true;
        api
          .post<LocationResponse>("/api/sales-agent/location", {
            latitude: point.latitude,
            longitude: point.longitude,
            accuracy,
            recordedAt: new Date(position.timestamp).toISOString(),
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
          .catch((error: unknown) => setState((previous) => ({ ...previous, message: errorMessage(error) })))
          .finally(() => {
            sending.current = false;
          });
      },
      (error) => {
        const denied = error.code === error.PERMISSION_DENIED;
        setState((previous) => ({
          ...previous,
          status: denied ? "denied" : previous.point ? previous.status : "unavailable",
          message: error.message || null,
        }));
        report(denied ? "permission_denied" : "update_failure", error.message);
      },
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 30_000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [enabled, attempt, report]);

  /** "Lokatsiyani yoqish" — qayta so'rash (brauzer ruxsat oynasi yoki GPS). */
  const request = useCallback(() => {
    setState((previous) => ({ ...previous, status: supported() ? "locating" : "unavailable", message: null }));
    setAttempt((value) => value + 1);
  }, []);

  return { ...state, request };
}
