/**
 * Telegram botlari va suhbatlar.
 *
 * Ikki xil bot:
 *  - `owner` — PLATFORMA boti, bitta: barcha biznes egalari shu bot orqali o'z biznesi bo'yicha
 *    hisobot va ogohlantirish oladi. Kim qaysi biznesga tegishli ekani ERP'dagi telefon raqami
 *    bo'yicha aniqlanadi (Telegram "kontaktni ulashish" tugmasi).
 *  - `customer` — HAR BIZNESNING o'z boti: egasi Sozlamalar → Integratsiyalar bo'limida
 *    BotFather'dan olingan tokenni qo'yadi va qaysi xabarlar borishini o'zi belgilaydi.
 *
 * Token bazada SHIFRLANGAN holda (`secret-box.ts`), hech qayerda ochiq ko'rsatilmaydi.
 */
import { relations } from "drizzle-orm";
import { bigint, boolean, index, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { companies, users } from "./platform.js";
import { customers } from "./sales.js";
import { pk, timestamps } from "./_shared.js";

export const telegramBotKind = pgEnum("telegram_bot_kind", ["owner", "customer"]);

export const telegramBots = pgTable(
  "telegram_bots",
  {
    id: pk(),
    /** `null` — platformaning egalar boti (bitta); aks holda shu kompaniyaning mijoz boti. */
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
    kind: telegramBotKind("kind").notNull(),
    /** `@bot_username` — `getMe` dan olinadi, foydalanuvchiga havola ko'rsatish uchun. */
    username: varchar("username", { length: 64 }),
    /** Shifrlangan bot tokeni. */
    tokenCipher: text("token_cipher").notNull(),
    /** Webhook manzilidagi tasodifiy bo'lak — kim yozayotganini aniqlaydi. */
    webhookSecret: varchar("webhook_secret", { length: 64 }).notNull(),
    isActive: boolean("is_active").notNull().default(true),
    /** Mijoz boti uchun yoqilgan imkoniyatlar: {purchase:true, payment:true, ...}. */
    features: jsonb("features").$type<Record<string, boolean>>().notNull().default({}),
    /** Oxirgi webhook o'rnatish natijasi (xato bo'lsa egasi ko'rsin). */
    lastError: text("last_error"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("telegram_bot_secret_key").on(t.webhookSecret),
    uniqueIndex("telegram_bot_company_kind_key").on(t.companyId, t.kind),
    index("telegram_bot_kind_idx").on(t.kind, t.isActive),
  ],
);

/**
 * Bot bilan yozishayotgan odam. Telefon raqami ulashilgach ERP foydalanuvchisi (egalar boti) yoki
 * mijoz kartochkasi (mijoz boti) bilan bog'lanadi; bog'lanmagunча faqat "kontakt yuboring" deyiladi.
 */
export const telegramChats = pgTable(
  "telegram_chats",
  {
    id: pk(),
    botId: uuid("bot_id")
      .notNull()
      .references(() => telegramBots.id, { onDelete: "cascade" }),
    /** Telegram chat identifikatori (musbat — shaxsiy chat). */
    chatId: bigint("chat_id", { mode: "number" }).notNull(),
    /** Ulashilgan telefon (E.164). */
    phone: varchar("phone", { length: 20 }),
    /** Egalar botida — ERP foydalanuvchisi. */
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    /** Qaysi biznes bo'yicha yozishmoqda. */
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
    /** Mijoz botida — mijoz kartochkasi. */
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    /** Suhbat holati (masalan botdan buyurtma berish qadamlari). */
    state: jsonb("state").$type<Record<string, unknown>>(),
    linkedAt: timestamp("linked_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("telegram_chat_key").on(t.botId, t.chatId),
    index("telegram_chat_company_idx").on(t.companyId),
    index("telegram_chat_customer_idx").on(t.customerId),
  ],
);

export const telegramBotsRelations = relations(telegramBots, ({ one, many }) => ({
  company: one(companies, { fields: [telegramBots.companyId], references: [companies.id] }),
  chats: many(telegramChats),
}));

export const telegramChatsRelations = relations(telegramChats, ({ one }) => ({
  bot: one(telegramBots, { fields: [telegramChats.botId], references: [telegramBots.id] }),
  user: one(users, { fields: [telegramChats.userId], references: [users.id] }),
  customer: one(customers, { fields: [telegramChats.customerId], references: [customers.id] }),
}));
