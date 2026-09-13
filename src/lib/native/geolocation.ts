/**
 * GPS kuzatuvi — bitta interfeys: Android ilovada fondagi xizmat (ekran qulflanganda va boshqa ilovaga o'tilganda ham,
 * doimiy bildirishnoma bilan; bepul ochiq manbali `@capacitor-community/background-geolocation`), brauzerda —
 * `navigator.geolocation.watchPosition` (faqat sahifa ochiq paytda). Kuzatuv faqat chaqiruvchi yoqqan paytda (ish
 * sessiyasida) ishlaydi va to'xtatish funksiyasi bilan darhol o'chadi.
 */
import { registerPlugin } from "@capacitor/core";
import { hasNativePlugin } from "./platform.ts";

export type LocationFix = { latitude: number; longitude: number; accuracy: number; timestamp: number; mocked: boolean };
export type LocationFailure = { denied: boolean; message: string };

type NativePosition = { latitude: number; longitude: number; accuracy: number; time: number | null; simulated: boolean };
type BackgroundGeolocationPlugin = {
  addWatcher(
    options: { backgroundTitle?: string; backgroundMessage?: string; requestPermissions?: boolean; stale?: boolean; distanceFilter?: number },
    callback: (position?: NativePosition, error?: { code?: string; message: string }) => void,
  ): Promise<string>;
  removeWatcher(options: { id: string }): Promise<void>;
};

const PLUGIN = "BackgroundGeolocation";
const BackgroundGeolocation = registerPlugin<BackgroundGeolocationPlugin>(PLUGIN);

export const locationSupported = (): boolean => hasNativePlugin(PLUGIN) || (typeof navigator !== "undefined" && "geolocation" in navigator);

/** Android ilovada fondagi kuzatuv mavjudmi (ekran qulflanganda ham). */
export const backgroundLocationAvailable = (): boolean => hasNativePlugin(PLUGIN);

/**
 * Kuzatuvni boshlaydi va to'xtatish funksiyasini qaytaradi. `background` — Android ilovada doimiy bildirishnoma matni
 * (bo'lmasa kuzatuv faqat ilova ochiq paytda).
 */
export function watchLocation(
  onFix: (fix: LocationFix) => void,
  onFailure: (failure: LocationFailure) => void,
  options: { background: { title: string; message: string } | null },
): () => void {
  if (hasNativePlugin(PLUGIN)) {
    let watcherId: string | null = null;
    let stopped = false;
    Promise.resolve(
      BackgroundGeolocation.addWatcher(
        {
          requestPermissions: true,
          stale: false,
          distanceFilter: 10,
          ...(options.background ? { backgroundTitle: options.background.title, backgroundMessage: options.background.message } : {}),
        },
        (position, error) => {
          if (error) {
            onFailure({ denied: error.code === "NOT_AUTHORIZED", message: error.message });
            return;
          }
          if (position) {
            onFix({
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
      onFix({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
        timestamp: position.timestamp,
        mocked: false,
      }),
    (error) => onFailure({ denied: error.code === error.PERMISSION_DENIED, message: error.message }),
    { enableHighAccuracy: true, maximumAge: 10_000, timeout: 30_000 },
  );
  return () => navigator.geolocation.clearWatch(watchId);
}
