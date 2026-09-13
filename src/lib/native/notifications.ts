/**
 * Telefon bildirishnomasi (Android ilova): ilova fonda bo'lganda muhim hodisa haqida — masalan, dostavshikka yangi
 * yetkazma biriktirilganda. Tashqi push xizmati ishlatilmaydi: xabar real-time ulanishdan keladi (ish vaqtida ilova
 * fondagi lokatsiya xizmati bilan tirik turadi). Brauzerda — hech narsa qilinmaydi (sahifaning o'zi yangilanadi).
 */
import { registerPlugin } from "@capacitor/core";
import { hasNativePlugin } from "./platform.ts";

type LocalNotificationsPlugin = {
  requestPermissions(): Promise<{ display: "granted" | "denied" | "prompt" | "prompt-with-rationale" }>;
  schedule(options: { notifications: { id: number; title: string; body: string; extra?: Record<string, string> }[] }): Promise<unknown>;
};

const LocalNotifications = registerPlugin<LocalNotificationsPlugin>("LocalNotifications");
let permission: Promise<boolean> | null = null;
let sequence = Math.floor(Date.now() / 1000) % 1_000_000;

async function allowed(): Promise<boolean> {
  permission ??= LocalNotifications.requestPermissions()
    .then((result) => result.display === "granted")
    .catch(() => false);
  return permission;
}

/** Faqat Android ilovada va ilova ko'rinmay turganda. */
export async function notifyInBackground(title: string, body: string, extra?: Record<string, string>): Promise<void> {
  if (!hasNativePlugin("LocalNotifications") || typeof document === "undefined" || document.visibilityState === "visible") return;
  if (!(await allowed())) return;
  sequence += 1;
  await LocalNotifications.schedule({ notifications: [{ id: sequence, title, body, extra }] }).catch(() => undefined);
}

/** Ish boshlanganda ruxsatni oldindan so'rash (birinchi xabar kutib qolmasin). */
export function prepareNotifications(): void {
  if (hasNativePlugin("LocalNotifications")) void allowed();
}
