/**
 * Telefon bildirishnomasi (Android ilova): ilova fonda bo'lganda muhim hodisa haqida — masalan, dostavshikka yangi
 * yetkazma biriktirilganda. Tashqi push xizmati ishlatilmaydi: xabar real-time ulanishdan keladi (ish vaqtida ilova
 * fondagi lokatsiya xizmati bilan tirik turadi). Bildirishnoma bosilsa — `extra.url` dagi sahifa ochiladi (faqat shu
 * saytdagi nisbiy yo'l). Brauzerda — hech narsa qilinmaydi (sahifaning o'zi yangilanadi).
 */
import { registerPlugin } from "@capacitor/core";
import { hasNativePlugin } from "./platform.ts";

type ActionPerformed = { notification: { extra?: Record<string, string> | null } };

type LocalNotificationsPlugin = {
  requestPermissions(): Promise<{ display: "granted" | "denied" | "prompt" | "prompt-with-rationale" }>;
  schedule(options: { notifications: { id: number; title: string; body: string; extra?: Record<string, string> }[] }): Promise<unknown>;
  addListener(event: "localNotificationActionPerformed", handler: (action: ActionPerformed) => void): Promise<{ remove: () => Promise<void> }>;
};

const PLUGIN = "LocalNotifications";
const LocalNotifications = registerPlugin<LocalNotificationsPlugin>(PLUGIN);
let permission: Promise<boolean> | null = null;
let listening = false;
let sequence = Math.floor(Date.now() / 1000) % 1_000_000;

/** Bildirishnomadagi manzil xavfsizmi: shu saytdagi nisbiy yo'l (`/...`), boshqa sayt yoki sxema emas. */
export function isSafeAppPath(url: string | null | undefined): url is string {
  // Brauzer URL'dan tab va yangi qatorni olib tashlaydi ("/\t/evil" → "//evil") — boshqaruv belgilari va bo'shliq rad
  // eslint-disable-next-line no-control-regex -- boshqaruv belgilari ataylab qidiriladi
  return typeof url === "string" && url.startsWith("/") && !url.startsWith("//") && !/[\\\s\u0000-\u001f\u007f]/.test(url);
}

function listenTaps() {
  if (listening) return;
  listening = true;
  LocalNotifications.addListener("localNotificationActionPerformed", (action) => {
    const url = action.notification.extra?.url;
    if (isSafeAppPath(url)) window.location.assign(url);
  }).catch(() => {
    listening = false;
  });
}

async function allowed(): Promise<boolean> {
  permission ??= LocalNotifications.requestPermissions()
    .then((result) => result.display === "granted")
    .catch(() => false);
  return permission;
}

/** Faqat Android ilovada va ilova ko'rinmay turganda. `extra.url` — bosilganda ochiladigan sahifa. */
export async function notifyInBackground(title: string, body: string, extra?: Record<string, string>): Promise<void> {
  if (!hasNativePlugin(PLUGIN) || typeof document === "undefined" || document.visibilityState === "visible") return;
  listenTaps();
  if (!(await allowed())) return;
  sequence += 1;
  await LocalNotifications.schedule({ notifications: [{ id: sequence, title, body, extra }] }).catch(() => undefined);
}

/** Ish boshlanganda ruxsatni oldindan so'rash (birinchi xabar kutib qolmasin). */
export function prepareNotifications(): void {
  if (!hasNativePlugin(PLUGIN)) return;
  listenTaps();
  void allowed();
}
