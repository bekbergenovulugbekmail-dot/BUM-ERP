/**
 * Telegram Bot API bilan ishlash — eng kichik qism: xabar yuborish, bot haqida ma'lumot, webhook.
 *
 * Tashqi xizmat ishlamasa ERP ishi to'xtamasligi kerak: yuborish xatosi jurnalga yoziladi va
 * chaqiruvchiga `false` qaytadi (hujjat baribir yoziladi). Token hech qachon jurnalga tushmaydi.
 */
import { env } from "../../env.js";
import { logger } from "../../shared/logger.js";

const API = "https://api.telegram.org";
/** Telegram javob bermasa uzoq kutib turmaymiz — foydalanuvchi so'rovi bloklanmasin. */
const TIMEOUT_MS = 8000;

type TelegramResponse<T> = { ok: boolean; result?: T; description?: string };

async function call<T>(token: string, method: string, payload: unknown): Promise<TelegramResponse<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${API}/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    return (await response.json()) as TelegramResponse<T>;
  } catch (error) {
    // Xato matnida token qolib ketmasin (manzilda token bor) — o'rniga yulduzcha
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, description: message.split(token).join("***") };
  } finally {
    clearTimeout(timer);
  }
}

export type InlineButton = { text: string; callback_data: string };
export type ReplyMarkup =
  | { inline_keyboard: InlineButton[][] }
  | { keyboard: { text: string; request_contact?: boolean }[][]; resize_keyboard?: boolean; one_time_keyboard?: boolean }
  | { remove_keyboard: true };

/** Xabar yuboradi. Xato bo'lsa `false` — chaqiruvchi ishni davom ettiraveradi. */
export async function sendMessage(
  token: string,
  chatId: number,
  text: string,
  markup?: ReplyMarkup,
): Promise<boolean> {
  const result = await call(token, "sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...(markup ? { reply_markup: markup } : {}),
  });
  if (!result.ok) logger.warn({ chatId, description: result.description }, "Telegram xabari yuborilmadi");
  return result.ok;
}

/** Tugma bosilgandagi "soat"ni o'chiradi (javob bermasa Telegram 30 s kutadi). */
export async function answerCallback(token: string, callbackId: string, text?: string): Promise<void> {
  await call(token, "answerCallbackQuery", { callback_query_id: callbackId, ...(text ? { text } : {}) });
}

export type BotInfo = { id: number; username: string; first_name: string };

/** Token haqiqiyligini tekshiradi va bot nomini qaytaradi. */
export async function getBotInfo(token: string): Promise<BotInfo | null> {
  const result = await call<BotInfo>(token, "getMe", {});
  return result.ok && result.result ? result.result : null;
}

/**
 * Webhook manzili. Standart — saytning o'zi (`WEB_ORIGIN`): nginx `/api/` ni API'ga uzatadi,
 * shuning uchun alohida sozlash shart emas. API alohida domenda bo'lsa `PUBLIC_API_URL` beriladi.
 * Telegram faqat HTTPS qabul qiladi — boshqa manzil bilan webhook o'rnatilmaydi.
 */
export function webhookUrl(secret: string): string | null {
  const base = (env.PUBLIC_API_URL ?? env.WEB_ORIGIN).replace(/\/+$/, "");
  if (!base.startsWith("https://")) return null;
  return `${base}/api/telegram/webhook/${secret}`;
}

/**
 * Webhook'ni o'rnatadi. Public manzil yo'q bo'lsa (lokal ishlab chiqish) — o'rnatilmaydi va
 * sabab qaytariladi; bot sozlamasi baribir saqlanadi, manzil paydo bo'lgach qayta urinib ko'riladi.
 */
export async function setWebhook(token: string, secret: string): Promise<{ ok: boolean; error: string | null }> {
  const url = webhookUrl(secret);
  if (!url) {
    return {
      ok: false,
      error: "Ommaviy HTTPS manzil yo'q (WEB_ORIGIN yoki PUBLIC_API_URL) — webhook o'rnatilmadi, bot xabar qabul qilmaydi",
    };
  }
  const result = await call(token, "setWebhook", {
    url,
    // Telegram har so'rovda shu sarlavhani yuboradi — begona so'rov qabul qilinmaydi
    secret_token: secret,
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: true,
  });
  return { ok: result.ok, error: result.ok ? null : (result.description ?? "Noma'lum xato") };
}

export async function deleteWebhook(token: string): Promise<void> {
  await call(token, "deleteWebhook", { drop_pending_updates: true });
}
