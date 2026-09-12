/**
 * Yetkazuvchi lokatsiyasi — faqat faol ish sessiyasida va ilova ochiq paytda (brauzer `watchPosition`).
 * Nuqta siyosatdagi oraliqda yoki siljish chegarasidan ko'p yurilganda buferga olinadi va paket bilan yuboriladi;
 * internet yo'q bo'lsa bufer qurilmada saqlanadi (200 tagacha) va qaytganda yuboriladi. Server sifatni tekshiradi.
 * Telefon qulflanganda yoki boshqa ilovaga o'tilganda brauzer lokatsiya bermaydi — fondagi kuzatuv faqat native ilovada.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api } from "@/lib/api.ts";

export type TrackingStatus = "locating" | "active" | "rejected" | "denied" | "unavailable";
export type BufferedPoint = { latitude: number; longitude: number; accuracy: number; recordedAt: string };

export type DeliveryLocation = {
  status: TrackingStatus;
  point: { latitude: number; longitude: number } | null;
  accuracy: number | null;
  /** So'rovlar uchun barqaror nuqta (100 m dan ko'p siljiganda yangilanadi). */
  origin: { latitude: number; longitude: number } | null;
  reason: string | null;
  buffered: number;
  request: () => void;
};

type BatchResult = { accepted: number; rejected: { index: number; reason: string; message: string }[]; nextIntervalSeconds: number };

export const LOCATION_BUFFER_KEY = "bum:delivery-locations";
const BUFFER_MAX = 200;
const BATCH = 20;
const ORIGIN_THRESHOLD_METERS = 100;
const supported = () => typeof navigator !== "undefined" && "geolocation" in navigator;

/** Taxminiy masofa (faqat yuborish qarori uchun; aniq hisob serverda). */
export function roughMeters(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const dLat = (b.latitude - a.latitude) * 111_320;
  const dLng = (b.longitude - a.longitude) * 111_320 * Math.cos((a.latitude * Math.PI) / 180);
  return Math.hypot(dLat, dLng);
}

export function readBuffer(): BufferedPoint[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(LOCATION_BUFFER_KEY) ?? "[]") as BufferedPoint[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeBuffer(points: BufferedPoint[]) {
  try {
    localStorage.setItem(LOCATION_BUFFER_KEY, JSON.stringify(points.slice(-BUFFER_MAX)));
  } catch {
    // xotira to'lgan — eng eskisi yo'qoladi, ish davom etadi
  }
}

/** Yangi nuqtani buferga olish kerakmi: oraliq o'tdi yoki siljish chegarasidan ko'p yurildi. */
export function shouldBuffer(last: BufferedPoint | null, next: BufferedPoint, intervalSeconds: number, distanceMeters: number) {
  if (!last) return true;
  return Date.parse(next.recordedAt) - Date.parse(last.recordedAt) >= intervalSeconds * 1000 || roughMeters(last, next) >= distanceMeters;
}

export function useDeliveryTracking(enabled: boolean, intervalSeconds: number, distanceMeters: number): DeliveryLocation {
  const [state, setState] = useState(() => ({
    status: (supported() ? "locating" : "unavailable") as TrackingStatus,
    point: null as DeliveryLocation["point"],
    accuracy: null as number | null,
    origin: null as DeliveryLocation["origin"],
    reason: null as string | null,
    buffered: readBuffer().length,
  }));
  const [attempt, setAttempt] = useState(0);
  const settings = useRef({ intervalSeconds, distanceMeters });
  const lastBuffered = useRef<BufferedPoint | null>(null);
  const origin = useRef<DeliveryLocation["origin"]>(null);
  const sending = useRef(false);

  useEffect(() => {
    settings.current = { intervalSeconds, distanceMeters };
  }, [intervalSeconds, distanceMeters]);

  const flush = useCallback(async () => {
    if (sending.current || (typeof navigator !== "undefined" && !navigator.onLine)) return;
    sending.current = true;
    try {
      let buffer = readBuffer();
      while (buffer.length > 0) {
        const batch = buffer.slice(0, BATCH);
        try {
          const result = await api.post<BatchResult>("/api/delivery/agent/locations", { points: batch });
          settings.current = { ...settings.current, intervalSeconds: result.nextIntervalSeconds };
          const reason = result.accepted === 0 ? (result.rejected[0]?.reason ?? null) : null;
          setState((previous) => ({ ...previous, status: reason ? "rejected" : "active", reason }));
        } catch (error) {
          // Ish sessiyasi yopilgan yoki nuqtalar yaroqsiz — bufer tashlanadi; tarmoq xatosi — keyin qayta
          if (!(error instanceof ApiError) || error.code === "NETWORK" || error.status === 0 || error.status >= 500 || error.status === 429) break;
        }
        buffer = readBuffer().slice(batch.length);
        writeBuffer(buffer);
      }
      setState((previous) => ({ ...previous, buffered: readBuffer().length }));
    } finally {
      sending.current = false;
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const onOnline = () => void flush();
    window.addEventListener("online", onOnline);
    void flush();
    return () => window.removeEventListener("online", onOnline);
  }, [enabled, flush]);

  useEffect(() => {
    if (!enabled || !supported()) return;
    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const next: BufferedPoint = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          recordedAt: new Date(position.timestamp).toISOString(),
        };
        if (!origin.current || roughMeters(origin.current, next) >= ORIGIN_THRESHOLD_METERS) origin.current = { latitude: next.latitude, longitude: next.longitude };
        const stableOrigin = origin.current;
        setState((previous) => ({
          ...previous,
          point: { latitude: next.latitude, longitude: next.longitude },
          accuracy: next.accuracy,
          origin: stableOrigin,
          status: previous.status === "rejected" ? "rejected" : "active",
        }));
        if (!shouldBuffer(lastBuffered.current, next, settings.current.intervalSeconds, settings.current.distanceMeters)) return;
        lastBuffered.current = next;
        writeBuffer([...readBuffer(), next]);
        setState((previous) => ({ ...previous, buffered: readBuffer().length }));
        void flush();
      },
      (error) => {
        const denied = error.code === error.PERMISSION_DENIED;
        setState((previous) => ({ ...previous, status: denied ? "denied" : previous.point ? previous.status : "unavailable" }));
      },
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 30_000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [enabled, attempt, flush]);

  const request = useCallback(() => {
    setState((previous) => ({ ...previous, status: supported() ? "locating" : "unavailable" }));
    setAttempt((value) => value + 1);
  }, []);

  return { ...state, request };
}
