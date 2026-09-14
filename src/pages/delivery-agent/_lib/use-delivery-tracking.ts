/**
 * Yetkazuvchi lokatsiyasi — faqat faol ish sessiyasida. Brauzerda — ilova ochiq paytda (`watchPosition`); Android
 * ilovada — fonda ham (ekran qulflanganda, doimiy bildirishnoma bilan), `@/lib/native/geolocation.ts`.
 * Nuqta siyosatdagi oraliqda yoki siljish chegarasidan ko'p yurilganda buferga olinadi va paket bilan yuboriladi;
 * internet yo'q bo'lsa bufer qurilmada saqlanadi (200 tagacha) va qaytganda yuboriladi. Server sifatni tekshiradi.
 *
 * Zaryad: serverga har nuqtada emas, eng ko'pi bilan har 30–120 soniyada bitta paket (mobil radio har safar
 * uyg'onmaydi); siyosatdagi aniqlikdan yomon nuqta yuborilmaydi; ish sessiyasi yopilgan (409) bo'lsa kuzatuv to'xtaydi.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api } from "@/lib/api.ts";
import { locationSupported, watchLocation } from "@/lib/native/geolocation.ts";

export type TrackingStatus = "locating" | "active" | "rejected" | "denied" | "unavailable";
/** `mocked` — Android ilova soxta GPS (mock location) ni aniqlasa; server shubhali deb belgilaydi. */
export type BufferedPoint = { latitude: number; longitude: number; accuracy: number; recordedAt: string; mocked?: boolean };

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
/** Ekrandagi nuqta shu masofadan kam siljisa qayta chizilmaydi. */
const DISPLAY_THRESHOLD_METERS = 5;
const FLUSH_MIN_MS = 30_000;
const FLUSH_MAX_MS = 120_000;
const supported = locationSupported;
const BACKGROUND_NOTICE = { title: "BUM ERP — dostavka", message: "Ish vaqti: lokatsiya yetkazmalar uchun yuborilmoqda" };

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

/** Keyingi paketgacha kutish (ms): siyosat oralig'i, 30–120 s; bufer to'lsa yoki vaqti kelgan bo'lsa — 0. */
export function flushDelayMs(now: number, lastFlushAt: number, intervalSeconds: number, buffered: number) {
  if (buffered >= BATCH) return 0;
  const spacing = Math.min(FLUSH_MAX_MS, Math.max(FLUSH_MIN_MS, intervalSeconds * 1000));
  return Math.max(0, lastFlushAt + spacing - now);
}

export function useDeliveryTracking(
  enabled: boolean,
  intervalSeconds: number,
  distanceMeters: number,
  options: { maxAccuracyMeters?: number; onSessionEnded?: () => void } = {},
): DeliveryLocation {
  const [state, setState] = useState(() => ({
    status: (supported() ? "locating" : "unavailable") as TrackingStatus,
    point: null as DeliveryLocation["point"],
    accuracy: null as number | null,
    origin: null as DeliveryLocation["origin"],
    reason: null as string | null,
    buffered: readBuffer().length,
  }));
  const [attempt, setAttempt] = useState(0);
  const settings = useRef({ intervalSeconds, distanceMeters, maxAccuracyMeters: options.maxAccuracyMeters });
  const onSessionEnded = useRef(options.onSessionEnded);
  const lastBuffered = useRef<BufferedPoint | null>(null);
  const shown = useRef<{ latitude: number; longitude: number; accuracy: number } | null>(null);
  const origin = useRef<DeliveryLocation["origin"]>(null);
  const sending = useRef(false);
  const lastFlushAt = useRef(0);
  const flushTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    settings.current = { ...settings.current, intervalSeconds, distanceMeters, maxAccuracyMeters: options.maxAccuracyMeters };
    onSessionEnded.current = options.onSessionEnded;
  }, [intervalSeconds, distanceMeters, options.maxAccuracyMeters, options.onSessionEnded]);

  const flush = useCallback(async () => {
    if (sending.current || (typeof navigator !== "undefined" && !navigator.onLine)) return;
    sending.current = true;
    lastFlushAt.current = Date.now();
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
          // Tarmoq xatosi — keyin qayta; ish sessiyasi yopilgan (409) — kuzatuv to'xtaydi; yaroqsiz — bufer tashlanadi
          if (!(error instanceof ApiError) || error.code === "NETWORK" || error.status === 0 || error.status >= 500 || error.status === 429) break;
          if (error.status === 409) {
            writeBuffer([]);
            onSessionEnded.current?.();
            break;
          }
        }
        buffer = readBuffer().slice(batch.length);
        writeBuffer(buffer);
      }
      setState((previous) => ({ ...previous, buffered: readBuffer().length }));
    } finally {
      sending.current = false;
    }
  }, []);

  const scheduleFlush = useCallback(() => {
    const delay = flushDelayMs(Date.now(), lastFlushAt.current, settings.current.intervalSeconds, readBuffer().length);
    if (delay === 0) {
      window.clearTimeout(flushTimer.current);
      flushTimer.current = undefined;
      void flush();
      return;
    }
    if (flushTimer.current !== undefined) return;
    flushTimer.current = window.setTimeout(() => {
      flushTimer.current = undefined;
      void flush();
    }, delay);
  }, [flush]);

  useEffect(() => {
    if (!enabled) return;
    const onOnline = () => void flush();
    window.addEventListener("online", onOnline);
    void flush();
    return () => {
      window.removeEventListener("online", onOnline);
      window.clearTimeout(flushTimer.current);
      flushTimer.current = undefined;
    };
  }, [enabled, flush]);

  useEffect(() => {
    if (!enabled || !supported()) return;
    return watchLocation(
      (fix) => {
        const next: BufferedPoint = {
          latitude: fix.latitude,
          longitude: fix.longitude,
          accuracy: fix.accuracy,
          recordedAt: new Date(fix.timestamp).toISOString(),
          ...(fix.mocked ? { mocked: true } : {}),
        };
        const originMoved = !origin.current || roughMeters(origin.current, next) >= ORIGIN_THRESHOLD_METERS;
        if (originMoved) origin.current = { latitude: next.latitude, longitude: next.longitude };
        const displayMoved =
          !shown.current ||
          originMoved ||
          roughMeters(shown.current, next) >= DISPLAY_THRESHOLD_METERS ||
          Math.abs(shown.current.accuracy - next.accuracy) >= 10;
        if (displayMoved) {
          shown.current = { latitude: next.latitude, longitude: next.longitude, accuracy: next.accuracy };
          const stableOrigin = origin.current;
          setState((previous) => ({
            ...previous,
            point: { latitude: next.latitude, longitude: next.longitude },
            accuracy: next.accuracy,
            origin: stableOrigin,
            status: previous.status === "rejected" ? "rejected" : "active",
          }));
        }
        // Server baribir rad etadigan past aniqlikdagi nuqta yuborilmaydi (soxta GPS belgisi esa server uchun yuboriladi)
        const maxAccuracy = settings.current.maxAccuracyMeters;
        if (maxAccuracy !== undefined && next.accuracy > maxAccuracy && !next.mocked) return;
        if (!shouldBuffer(lastBuffered.current, next, settings.current.intervalSeconds, settings.current.distanceMeters)) return;
        lastBuffered.current = next;
        writeBuffer([...readBuffer(), next]);
        setState((previous) => ({ ...previous, buffered: readBuffer().length }));
        scheduleFlush();
      },
      (failure) => {
        setState((previous) => ({ ...previous, status: failure.denied ? "denied" : previous.point ? previous.status : "unavailable" }));
      },
      { background: BACKGROUND_NOTICE, intervalSeconds: settings.current.intervalSeconds },
    );
  }, [enabled, attempt, scheduleFlush]);

  const request = useCallback(() => {
    setState((previous) => ({ ...previous, status: supported() ? "locating" : "unavailable" }));
    setAttempt((value) => value + 1);
  }, []);

  return { ...state, request };
}
