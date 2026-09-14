/**
 * GPS kuzatuvi — bitta interfeys: Android ilovada fondagi xizmat (ekran qulflanganda va boshqa ilovaga o'tilganda ham,
 * doimiy bildirishnoma bilan; bepul ochiq manbali `@capacitor-community/background-geolocation`), brauzerda —
 * `navigator.geolocation.watchPosition` (faqat sahifa ochiq paytda). Kuzatuv faqat chaqiruvchi yoqqan paytda (ish
 * sessiyasida) ishlaydi va to'xtatish funksiyasi bilan darhol o'chadi.
 *
 * Zaryad: GPS har soniya emas, siyosatdagi oraliqqa mos (10–30 s) so'raladi va o'lchovlar paket bilan keladi —
 * telefon protsessori har o'lchovda uyg'onmaydi (`patches/@capacitor-community__background-geolocation.patch`;
 * eski APK yangi parametrlarni e'tiborsiz qoldiradi va avvalgidek ishlaydi).
 */
import { registerPlugin } from "@capacitor/core";
import { hasNativePlugin } from "./platform.ts";

export type LocationFix = { latitude: number; longitude: number; accuracy: number; timestamp: number; mocked: boolean };
export type LocationFailure = { denied: boolean; message: string };

type NativePosition = { latitude: number; longitude: number; accuracy: number; time: number | null; simulated: boolean };
type BackgroundGeolocationPlugin = {
  addWatcher(
    options: {
      backgroundTitle?: string;
      backgroundMessage?: string;
      requestPermissions?: boolean;
      stale?: boolean;
      distanceFilter?: number;
      /** O'lchov oralig'i, ms (patch; standart — 1000). */
      interval?: number;
      /** Eng tez oraliq, ms — boshqa ilovalar GPS'idan bepul foydalanish uchun. */
      fastestInterval?: number;
      /** O'lchovlarni paket bilan yetkazish kutish vaqti, ms. */
      maxWaitTime?: number;
    },
    callback: (position?: NativePosition, error?: { code?: string; message: string }) => void,
  ): Promise<string>;
  removeWatcher(options: { id: string }): Promise<void>;
};

const PLUGIN = "BackgroundGeolocation";
const BackgroundGeolocation = registerPlugin<BackgroundGeolocationPlugin>(PLUGIN);

/** GPS so'rash oralig'i chegaralari: tez-tez so'rash zaryadni yeydi, siyrak — yo'l nuqtalari kamayadi. */
const MIN_SAMPLE_SECONDS = 10;
const MAX_SAMPLE_SECONDS = 30;

/** Kuzatuv siyosati oralig'idan GPS o'lchov oralig'i (ms): siyosat oralig'ining uchdan biri, 10–30 s. */
export function sampleIntervalMs(intervalSeconds: number): number {
  const seconds = Math.min(MAX_SAMPLE_SECONDS, Math.max(MIN_SAMPLE_SECONDS, Math.round(intervalSeconds / 3)));
  return seconds * 1000;
}

let lastFix: LocationFix | null = null;

/** Kuzatuvning oxirgi o'lchovi — yetarlicha yangi va aniq bo'lsa (amal uchun GPS qayta yoqilmaydi). */
export function recentFix(maxAgeMs: number, maxAccuracyMeters: number): LocationFix | null {
  if (!lastFix || lastFix.mocked) return null;
  if (Date.now() - lastFix.timestamp > maxAgeMs || lastFix.accuracy > maxAccuracyMeters) return null;
  return lastFix;
}

export const locationSupported = (): boolean => hasNativePlugin(PLUGIN) || (typeof navigator !== "undefined" && "geolocation" in navigator);

/** Android ilovada fondagi kuzatuv mavjudmi (ekran qulflanganda ham). */
export const backgroundLocationAvailable = (): boolean => hasNativePlugin(PLUGIN);

/**
 * Kuzatuvni boshlaydi va to'xtatish funksiyasini qaytaradi. `background` — Android ilovada doimiy bildirishnoma matni
 * (bo'lmasa kuzatuv faqat ilova ochiq paytda); `intervalSeconds` — kuzatuv siyosati oralig'i.
 */
export function watchLocation(
  onFix: (fix: LocationFix) => void,
  onFailure: (failure: LocationFailure) => void,
  options: { background: { title: string; message: string } | null; intervalSeconds?: number },
): () => void {
  const sampleMs = sampleIntervalMs(options.intervalSeconds ?? 60);
  const deliver = (fix: LocationFix) => {
    lastFix = fix;
    onFix(fix);
  };

  if (hasNativePlugin(PLUGIN)) {
    let watcherId: string | null = null;
    let stopped = false;
    Promise.resolve(
      BackgroundGeolocation.addWatcher(
        {
          requestPermissions: true,
          stale: false,
          distanceFilter: 10,
          interval: sampleMs,
          fastestInterval: Math.max(5_000, Math.round(sampleMs / 2)),
          maxWaitTime: sampleMs * 2,
          ...(options.background ? { backgroundTitle: options.background.title, backgroundMessage: options.background.message } : {}),
        },
        (position, error) => {
          if (error) {
            onFailure({ denied: error.code === "NOT_AUTHORIZED", message: error.message });
            return;
          }
          if (position) {
            deliver({
              latitude: position.latitude,
              longitude: position.longitude,
              accuracy: position.accuracy,
              timestamp: position.time ?? Date.now(),
              mocked: position.simulated === true,
            });
          }
        },
      ),
    )
      .then((id) => {
        if (stopped) void BackgroundGeolocation.removeWatcher({ id });
        else watcherId = id;
      })
      .catch((error: unknown) => onFailure({ denied: false, message: error instanceof Error ? error.message : String(error) }));
    return () => {
      stopped = true;
      if (watcherId) void BackgroundGeolocation.removeWatcher({ id: watcherId });
    };
  }

  if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
    onFailure({ denied: false, message: "Geolocation mavjud emas" });
    return () => undefined;
  }
  const watchId = navigator.geolocation.watchPosition(
    (position) =>
      deliver({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
        timestamp: position.timestamp,
        mocked: false,
      }),
    (error) => onFailure({ denied: error.code === error.PERMISSION_DENIED, message: error.message }),
    { enableHighAccuracy: true, maximumAge: sampleMs, timeout: 60_000 },
  );
  return () => navigator.geolocation.clearWatch(watchId);
}
