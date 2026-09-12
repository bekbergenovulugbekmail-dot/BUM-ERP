/** Kassa ekrani tezkor tugmalari: standart qiymatlar, nomlar va klaviatura hodisasidan tugma nomi (main va renderer). */
import type { HotkeyAction } from "./kassa-api.js";

export const DEFAULT_HOTKEYS: Record<HotkeyAction, string> = {
  help: "F1",
  search: "F2",
  quantity: "F3",
  customer: "F4",
  hold: "F5",
  held: "F6",
  return: "F7",
  unsynced: "F8",
  payCash: "F9",
  payCard: "F10",
  payBank: "F11",
  complete: "F12",
};

export const HOTKEY_LABELS: Record<HotkeyAction, string> = {
  help: "Tugmalar ro'yxati",
  search: "Mahsulot qidirish / shtrix-kod",
  quantity: "Tanlangan qator miqdori",
  customer: "Mijoz tanlash",
  hold: "Chekni kechiktirish",
  held: "Kechiktirilgan cheklar",
  return: "Mahsulotni qaytarish",
  unsynced: "Sinxron bo'lmagan cheklar",
  payCash: "Naqd to'lov",
  payCard: "Karta to'lov",
  payBank: "Bank to'lov",
  complete: "Chekni yakunlash",
};

export const HOTKEY_ACTIONS = Object.keys(DEFAULT_HOTKEYS) as HotkeyAction[];

/** F1–F12 (modifikator bilan ham) yoki Ctrl/Alt + harf/raqam. Oddiy harflar — matn kiritish uchun band. */
export const HOTKEY_PATTERN = /^(?:(?:Ctrl\+)?(?:Alt\+)?(?:Shift\+)?F(?:[1-9]|1[0-2])|(?=(?:Ctrl|Alt)\+)(?:Ctrl\+)?(?:Alt\+)?(?:Shift\+)?[A-Z0-9])$/;

export function keyName(event: { key: string; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }): string | null {
  const functionKey = /^F(?:[1-9]|1[0-2])$/.test(event.key);
  const character = /^[a-z0-9]$/i.test(event.key) && (event.ctrlKey || event.altKey);
  if (!functionKey && !character) return null;
  return `${event.ctrlKey ? "Ctrl+" : ""}${event.altKey ? "Alt+" : ""}${event.shiftKey ? "Shift+" : ""}${functionKey ? event.key : event.key.toUpperCase()}`;
}
