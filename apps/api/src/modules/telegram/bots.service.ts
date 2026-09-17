/**
 * Telegram botlarini ro'yxatga olish va suhbatlarni ERP yozuvlari bilan bog'lash.
 *
 * Egalar boti — platformada bitta (admin qo'yadi). Mijoz boti — har biznesda o'zi (egasi qo'yadi).
 * Token shifrlangan saqlanadi va tashqariga faqat niqoblangan ko'rinishda chiqadi.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { badRequest, normalizePhone } from "@bum/shared";
import { telegramBots, telegramChats } from "../../db/schema/telegram.js";
import { companyMembers, companies, users } from "../../db/schema/platform.js";
import { customers } from "../../db/schema/sales.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import { maskToken, openSecret, sealSecret } from "../../shared/secret-box.js";
import { getBotInfo, setWebhook, webhookUrl } from "./telegram-api.service.js";

export type BotKind = "owner" | "customer";

/** Mijoz botida yoqib/o'chiriladigan imkoniyatlar (egasi belgilaydi). */
export const CUSTOMER_FEATURES = {
  purchase: "Xarid cheki",
  payment: "To'lov qabul qilindi",
  debtReminder: "Qarz eslatmasi",
  history: "Xaridlar tarixi va qarz (bot ichida)",
  ordering: "Botdan buyurtma berish",
} as const;
export type CustomerFeature = keyof typeof CUSTOMER_FEATURES;

export const DEFAULT_CUSTOMER_FEATURES: Record<CustomerFeature, boolean> = {
  purchase: true,
  payment: true,
  debtReminder: true,
  history: true,
  ordering: false,
};

const botView = {
  id: telegramBots.id,
  companyId: telegramBots.companyId,
  kind: telegramBots.kind,
  username: telegramBots.username,
  isActive: telegramBots.isActive,
  features: telegramBots.features,
  lastError: telegramBots.lastError,
  tokenCipher: telegramBots.tokenCipher,
  webhookSecret: telegramBots.webhookSecret,
};

export type BotRow = NonNullable<Awaited<ReturnType<typeof findBot>>>;

/** Bot yozuvi tokensiz ko'rinishda (UI uchun): to'liq token hech qachon chiqmaydi. */
export function publicBot(row: BotRow | null) {
  if (!row) return null;
  return {
    id: row.id,
    kind: row.kind,
    username: row.username,
    isActive: row.isActive,
    features: row.features,
    lastError: row.lastError,
    token: maskToken(openSecret(row.tokenCipher)),
    link: row.username ? `https://t.me/${row.username}` : null,
    webhookConfigured: webhookUrl(row.webhookSecret) !== null,
  };
}

export async function findBot(conn: DbOrTx, kind: BotKind, companyId: string | null) {
  const [row] = await conn
    .select(botView)
    .from(telegramBots)
    .where(
      and(
        eq(telegramBots.kind, kind),
        companyId === null ? isNull(telegramBots.companyId) : eq(telegramBots.companyId, companyId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export function findBotBySecret(conn: DbOrTx, secret: string) {
  return conn
    .select(botView)
    .from(telegramBots)
    .where(and(eq(telegramBots.webhookSecret, secret), eq(telegramBots.isActive, true)))
    .limit(1)
    .then((rows) => rows[0] ?? null);
}

export const botToken = (row: { tokenCipher: string }) => openSecret(row.tokenCipher);

/**
 * Botni saqlaydi (yangi token — yangi webhook siri) va Telegram'da webhook'ni o'rnatadi.
 * Token noto'g'ri bo'lsa saqlanmaydi: `getMe` bilan tekshiriladi.
 */
export async function saveBot(
  tx: Tx,
  input: { kind: BotKind; companyId: string | null; token: string; features?: Record<string, boolean>; actorId: string },
) {
  const token = input.token.trim();
  if (!/^\d{6,}:[A-Za-z0-9_-]{30,}$/.test(token)) throw badRequest("Token ko'rinishi noto'g'ri (BotFather bergan qiymatni to'liq qo'ying)");

  const info = await getBotInfo(token);
  if (!info) throw badRequest("Telegram bu tokenni qabul qilmadi — tokenni tekshiring");

  const secret = randomBytes(24).toString("base64url");
  const hook = await setWebhook(token, secret);

  const values = {
    companyId: input.companyId,
    kind: input.kind,
    username: info.username,
    tokenCipher: sealSecret(token),
    webhookSecret: secret,
    isActive: true,
    features: input.features ?? (input.kind === "customer" ? DEFAULT_CUSTOMER_FEATURES : {}),
    lastError: hook.error,
    createdBy: input.actorId,
  };

  const existing = await findBot(tx, input.kind, input.companyId);
  if (existing) {
    await tx.update(telegramBots).set({ ...values, updatedAt: new Date() }).where(eq(telegramBots.id, existing.id));
    // Token almashdi — eski suhbatlar qoladi, ular o'sha bot yozuviga bog'langan
    return { botId: existing.id, username: info.username, webhookError: hook.error };
  }
  const [created] = await tx.insert(telegramBots).values(values).returning({ id: telegramBots.id });
  return { botId: created!.id, username: info.username, webhookError: hook.error };
}

/** Imkoniyatlarni yangilash (mijoz boti). */
/** Ptichkalarni yangilash: berilganlari almashadi, qolganlari o'z holicha qoladi. */
export async function updateFeatures(tx: Tx, bot: BotRow, features: Record<string, boolean>) {
  const merged = { ...DEFAULT_CUSTOMER_FEATURES, ...(bot.features ?? {}), ...features };
  await tx.update(telegramBots).set({ features: merged, updatedAt: new Date() }).where(eq(telegramBots.id, bot.id));
  return merged;
}

export async function setBotActive(tx: Tx, botId: string, isActive: boolean) {
  await tx.update(telegramBots).set({ isActive, updatedAt: new Date() }).where(eq(telegramBots.id, botId));
}

// ─── Suhbatlar ───────────────────────────────────────────────────────────────

export async function findChat(conn: DbOrTx, botId: string, chatId: number) {
  const [row] = await conn
    .select()
    .from(telegramChats)
    .where(and(eq(telegramChats.botId, botId), eq(telegramChats.chatId, chatId)))
    .limit(1);
  return row ?? null;
}

/** Suhbat holatining bitta bo'limini yozish (`null` — o'chirish). Qolgan bo'limlar tegilmaydi. */
export async function saveChatState(tx: Tx, chatRowId: string, key: string, value: unknown): Promise<void> {
  await tx
    .update(telegramChats)
    .set({
      state:
        value === null
          ? sql`coalesce(${telegramChats.state}, '{}'::jsonb) - ${key}`
          : sql`coalesce(${telegramChats.state}, '{}'::jsonb) || ${JSON.stringify({ [key]: value })}::jsonb`,
    })
    .where(eq(telegramChats.id, chatRowId));
}

export async function touchChat(tx: Tx, botId: string, chatId: number) {
  const existing = await findChat(tx, botId, chatId);
  if (existing) {
    await tx.update(telegramChats).set({ lastSeenAt: new Date() }).where(eq(telegramChats.id, existing.id));
    return existing;
  }
  const [created] = await tx.insert(telegramChats).values({ botId, chatId }).returning();
  return created!;
}

/**
 * Egalar boti: ulashilgan telefon bo'yicha ERP foydalanuvchisini va uning biznesini topadi.
 * Faqat kompaniya EGASI bog'lanadi — xodimlarga bu bot ochilmaydi.
 */
export async function linkOwnerChat(tx: Tx, botId: string, chatId: number, phoneRaw: string) {
  const phone = normalizePhone(phoneRaw);
  const [owner] = await tx
    .select({ userId: users.id, companyId: companies.id, companyName: companies.name, userName: users.name })
    .from(users)
    .innerJoin(companies, eq(companies.ownerId, users.id))
    .where(and(eq(users.phone, phone ?? phoneRaw), eq(users.isActive, true)))
    .limit(1);
  if (!owner) return null;

  const chat = await touchChat(tx, botId, chatId);
  await tx
    .update(telegramChats)
    .set({ phone: phone ?? phoneRaw, userId: owner.userId, companyId: owner.companyId, linkedAt: new Date(), updatedAt: new Date() })
    .where(eq(telegramChats.id, chat.id));
  return owner;
}

/** Mijoz boti: telefon bo'yicha shu biznesning mijoz kartochkasini topadi. */
export async function linkCustomerChat(tx: Tx, bot: { id: string; companyId: string | null }, chatId: number, phoneRaw: string) {
  if (!bot.companyId) return null;
  const phone = normalizePhone(phoneRaw) ?? phoneRaw;
  const [customer] = await tx
    .select({ id: customers.id, name: customers.name })
    .from(customers)
    .where(and(eq(customers.companyId, bot.companyId), eq(customers.phone, phone)))
    .limit(1);
  if (!customer) return null;

  const chat = await touchChat(tx, bot.id, chatId);
  await tx
    .update(telegramChats)
    .set({ phone, customerId: customer.id, companyId: bot.companyId, linkedAt: new Date(), updatedAt: new Date() })
    .where(eq(telegramChats.id, chat.id));
  return customer;
}

/** Shu foydalanuvchi kompaniyaning a'zosimi (egalar botida qo'shimcha tekshiruv). */
export async function isCompanyMember(conn: DbOrTx, companyId: string, userId: string) {
  const [row] = await conn
    .select({ userId: companyMembers.userId })
    .from(companyMembers)
    .where(and(eq(companyMembers.companyId, companyId), eq(companyMembers.userId, userId), eq(companyMembers.isActive, true)))
    .limit(1);
  return Boolean(row);
}
