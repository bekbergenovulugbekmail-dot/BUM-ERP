/**
 * SMS yuborish — Eskiz.uz. Kalit bo'lmasa `smsProvider.client = null` — SMS funksiyalari o'chiq (503).
 *
 * Eskiz API: POST /auth/login (email, password) → data.token; POST /message/sms/send
 * (mobile_phone: 998XXXXXXXXX, message, from). Token eskirsa (401) bir marta qayta kiriladi.
 */
import { env, features } from "../env.js";

export type SmsClient = (phone: string, message: string) => Promise<void>;

export class SmsDeliveryError extends Error {}

export function eskizClient(config: { baseUrl: string; email: string; password: string; sender: string }): SmsClient {
  let token: string | null = null;

  async function login(): Promise<string> {
    const form = new FormData();
    form.set("email", config.email);
    form.set("password", config.password);
    const response = await fetch(`${config.baseUrl}/auth/login`, { method: "POST", body: form, signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new SmsDeliveryError(`Eskiz: kirish rad etildi (${response.status})`);
    const body = (await response.json()) as { data?: { token?: string } };
    if (!body.data?.token) throw new SmsDeliveryError("Eskiz: javobda token yo'q");
    token = body.data.token;
    return token;
  }

  async function send(phone: string, message: string, retried: boolean): Promise<void> {
    const bearer = token ?? (await login());
    const form = new FormData();
    form.set("mobile_phone", phone.replace(/\D/g, ""));
    form.set("message", message);
    form.set("from", config.sender);
    const response = await fetch(`${config.baseUrl}/message/sms/send`, {
      method: "POST",
      headers: { authorization: `Bearer ${bearer}` },
      body: form,
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 401 && !retried) {
      token = null;
      return send(phone, message, true);
    }
    if (!response.ok) throw new SmsDeliveryError(`Eskiz: SMS yuborilmadi (${response.status})`);
  }

  return (phone, message) => send(phone, message, false);
}

/** Testlar mijozni almashtiradi. */
export const smsProvider: { client: SmsClient | null } = {
  client: features.sms
    ? eskizClient({ baseUrl: env.ESKIZ_BASE_URL, email: env.ESKIZ_EMAIL!, password: env.ESKIZ_PASSWORD!, sender: env.ESKIZ_SENDER })
    : null,
};
