/**
 * Telegram botlari: sozlash ruxsatlari, token shifrlanishi, webhook siri va mijozga xabar qoidalari.
 *
 * Tashqi tarmoqqa chiqmaymiz — `fetch` almashtirilgan (Telegram API javoblari taqlid qilinadi),
 * shuning uchun testlar internetsiz ham ishlaydi.
 */
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { telegramBots, telegramChats } from "../src/db/schema/telegram.js";
import { maskToken, openSecret, sealSecret } from "../src/shared/secret-box.js";
import { notifyPurchase } from "../src/modules/telegram/notify.service.js";
import { buildServer } from "../src/server.js";
import { createCompany, resetDatabase, signedIn } from "./helpers.js";

type Company = Awaited<ReturnType<typeof createCompany>>;

const TOKEN = "1234567890:AAH1234567890abcdefghijklmnopqrstuvw";
const OTHER_TOKEN = "9876543210:BBH1234567890abcdefghijklmnopqrstuvw";

let app: FastifyInstance;
let company: Company;
let adminCookie: string;
/** Telegram API'ga ketgan chaqiruvlar. */
let sent: { method: string; payload: unknown }[] = [];

beforeAll(async () => {
  app = await buildServer();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await closeDb();
});

const call = (cookie: string, method: "GET" | "POST" | "PUT" | "DELETE", url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

async function botRow() {
  const [row] = await db.select().from(telegramBots).where(eq(telegramBots.companyId, company.companyId));
  return row!;
}

async function linkedChat(customerId: string, chatId: number) {
  const bot = await botRow();
  await db.insert(telegramChats).values({ botId: bot.id, chatId, customerId, companyId: company.companyId, linkedAt: new Date() });
}

async function customer(name: string, phone: string) {
  const res = await call(company.ownerCookie, "POST", "/api/sales/customers", { name, phone });
  expect(res.statusCode).toBe(201);
  return res.json().customer.id as string;
}

beforeEach(async () => {
  await resetDatabase();
  sent = [];
  vi.stubGlobal("fetch", (input: string, init?: { body?: string }) => {
    const method = input.split("/").pop() ?? "";
    sent.push({ method, payload: init?.body ? (JSON.parse(init.body) as unknown) : null });
    const result = method === "getMe" ? { id: 1, username: "bum_test_bot", first_name: "BUM" } : true;
    return Promise.resolve({ json: () => Promise.resolve({ ok: true, result }) } as Response);
  });
  const admin = await signedIn(app, { isPlatformAdmin: true });
  adminCookie = admin.cookie;
  company = await createCompany(app, adminCookie, { name: "Bot Savdo" });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Token saqlash", () => {
  it("shifrlangan holda yoziladi va hech qayerda ochiq chiqmaydi", async () => {
    expect((await call(company.ownerCookie, "PUT", "/api/telegram/customer-bot", { token: TOKEN })).statusCode).toBe(200);

    const row = await botRow();
    expect(row.tokenCipher).not.toContain(TOKEN);
    expect(openSecret(row.tokenCipher)).toBe(TOKEN);

    const view = await call(company.ownerCookie, "GET", "/api/telegram/customer-bot");
    expect(view.json().bot.token).toBe(maskToken(TOKEN));
    expect(view.body).not.toContain(TOKEN);
  });

  it("shifrlash-ochish teskari amal, har safar yangi IV", () => {
    expect(openSecret(sealSecret(TOKEN))).toBe(TOKEN);
    expect(sealSecret(TOKEN)).not.toBe(sealSecret(TOKEN));
  });

  it("noto'g'ri shakldagi token rad etiladi", async () => {
    const res = await call(company.ownerCookie, "PUT", "/api/telegram/customer-bot", { token: "shunchaki-matn-token-emas" });
    expect(res.statusCode).toBe(400);
  });
});

describe("Ruxsatlar", () => {
  it("egalar botini faqat platforma admini sozlaydi", async () => {
    expect((await call(company.ownerCookie, "GET", "/api/telegram/owner-bot")).statusCode).toBe(403);
    expect((await call(company.ownerCookie, "PUT", "/api/telegram/owner-bot", { token: TOKEN })).statusCode).toBe(403);
    expect((await call(adminCookie, "PUT", "/api/telegram/owner-bot", { token: TOKEN })).statusCode).toBe(200);
  });

  it("boshqa kompaniya boti ko'rinmaydi", async () => {
    await call(company.ownerCookie, "PUT", "/api/telegram/customer-bot", { token: TOKEN });
    const other = await createCompany(app, adminCookie, { name: "Begona" });
    const res = await call(other.ownerCookie, "GET", "/api/telegram/customer-bot");
    expect(res.statusCode).toBe(200);
    expect(res.json().bot).toBeNull();
  });

  it("sessiyasiz sozlash yo'llari yopiq", async () => {
    expect((await app.inject({ method: "GET", url: "/api/telegram/customer-bot" })).statusCode).toBe(401);
  });
});

describe("Webhook", () => {
  beforeEach(async () => {
    await call(company.ownerCookie, "PUT", "/api/telegram/customer-bot", { token: TOKEN });
  });

  it("noto'g'ri sir yoki sarlavha bilan kelgan so'rov ishlanmaydi", async () => {
    const bot = await botRow();
    const wrongSecret = await app.inject({
      method: "POST",
      url: "/api/telegram/webhook/0000000000000000000000000000",
      payload: { message: { chat: { id: 5 }, text: "/start" } },
    });
    expect(wrongSecret.statusCode).toBe(200);

    const wrongHeader = await app.inject({
      method: "POST",
      url: `/api/telegram/webhook/${bot.webhookSecret}`,
      headers: { "x-telegram-bot-api-secret-token": "boshqa" },
      payload: { message: { chat: { id: 5 }, text: "/start" } },
    });
    expect(wrongHeader.statusCode).toBe(200);

    expect(await db.select().from(telegramChats)).toHaveLength(0);
  });

  it("to'g'ri sir bilan /start suhbatni ochadi (hali bog'lanmagan)", async () => {
    const bot = await botRow();
    const res = await app.inject({
      method: "POST",
      url: `/api/telegram/webhook/${bot.webhookSecret}`,
      headers: { "x-telegram-bot-api-secret-token": bot.webhookSecret },
      payload: { message: { chat: { id: 777 }, text: "/start" } },
    });
    expect(res.statusCode).toBe(200);

    await vi.waitFor(async () => {
      const chats = await db.select().from(telegramChats);
      expect(chats).toHaveLength(1);
      expect(chats[0]!.linkedAt).toBeNull();
    });
    await vi.waitFor(() => expect(sent.some((item) => item.method === "sendMessage")).toBe(true));
  });

  it("ro'yxatda yo'q raqam mijozga bog'lanmaydi", async () => {
    const bot = await botRow();
    await app.inject({
      method: "POST",
      url: `/api/telegram/webhook/${bot.webhookSecret}`,
      headers: { "x-telegram-bot-api-secret-token": bot.webhookSecret },
      payload: { message: { chat: { id: 778 }, contact: { phone_number: "+998900000000" } } },
    });

    // Javob yuboriladi, lekin hech qanday mijoz bog'lanmaydi
    await vi.waitFor(() => expect(sent.some((item) => item.method === "sendMessage")).toBe(true));
    const chats = await db.select().from(telegramChats);
    expect(chats.filter((chat) => chat.customerId !== null || chat.linkedAt !== null)).toHaveLength(0);
  });

  it("mijozning raqami bo'yicha bog'lanadi", async () => {
    const bot = await botRow();
    const customerId = await customer("Anvar", "+998901234567");

    await app.inject({
      method: "POST",
      url: `/api/telegram/webhook/${bot.webhookSecret}`,
      headers: { "x-telegram-bot-api-secret-token": bot.webhookSecret },
      payload: { message: { chat: { id: 779 }, contact: { phone_number: "998901234567" } } },
    });

    await vi.waitFor(async () => {
      const [chat] = await db.select().from(telegramChats);
      expect(chat?.linkedAt).not.toBeNull();
      expect(chat?.customerId).toBe(customerId);
    });
  });
});

describe("Imkoniyatlar (ptichkalar)", () => {
  beforeEach(async () => {
    await call(company.ownerCookie, "PUT", "/api/telegram/customer-bot", { token: TOKEN });
  });

  it("standart holatda buyurtma berish o'chiq, xabarlar yoqiq", async () => {
    const bot = (await call(company.ownerCookie, "GET", "/api/telegram/customer-bot")).json().bot;
    expect(bot.features).toMatchObject({ purchase: true, payment: true, debtReminder: true, history: true, ordering: false });
  });

  it("egasi yoqib-o'chira oladi", async () => {
    const res = await call(company.ownerCookie, "PUT", "/api/telegram/customer-bot/features", {
      features: { purchase: false, ordering: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().bot.features).toMatchObject({ purchase: false, ordering: true, payment: true });
  });

  it("noma'lum imkoniyat nomi rad etiladi", async () => {
    const res = await call(company.ownerCookie, "PUT", "/api/telegram/customer-bot/features", { features: { begona: true } });
    expect(res.statusCode).toBe(400);
  });
});

describe("Xabar yuborish qoidasi", () => {
  beforeEach(async () => {
    await call(company.ownerCookie, "PUT", "/api/telegram/customer-bot", { token: TOKEN });
  });

  it("imkoniyat o'chiq bo'lsa mijozga xabar ketmaydi", async () => {
    await call(company.ownerCookie, "PUT", "/api/telegram/customer-bot/features", { features: { purchase: false } });
    const customerId = await customer("Dilshod", "+998901111111");
    await linkedChat(customerId, 900);

    sent = [];
    await notifyPurchase({ companyId: company.companyId, customerId, number: "SO-1", total: "100", paid: "100", items: [] });
    expect(sent.filter((item) => item.method === "sendMessage")).toHaveLength(0);
  });

  it("imkoniyat yoqiq va suhbat bog'langan bo'lsa xabar ketadi", async () => {
    const customerId = await customer("Zuhra", "+998902222222");
    await linkedChat(customerId, 901);

    sent = [];
    await notifyPurchase({
      companyId: company.companyId,
      customerId,
      number: "SO-2",
      total: "150000",
      paid: "100000",
      items: [{ name: "Shakar", quantity: "2", lineTotal: "150000" }],
    });
    const messages = sent.filter((item) => item.method === "sendMessage");
    expect(messages).toHaveLength(1);
    expect(JSON.stringify(messages[0]!.payload)).toContain("Qoldi");
  });

  it("bog'lanmagan mijozga yuborish xatosiz o'tadi", async () => {
    const customerId = await customer("Sardor", "+998904444444");
    sent = [];
    await expect(
      notifyPurchase({ companyId: company.companyId, customerId, number: "SO-3", total: "1", paid: "1", items: [] }),
    ).resolves.toBeUndefined();
    expect(sent.filter((item) => item.method === "sendMessage")).toHaveLength(0);
  });
});

describe("Botni uzish va almashtirish", () => {
  it("o'chirilgan bot orqali xabar ketmaydi", async () => {
    await call(company.ownerCookie, "PUT", "/api/telegram/customer-bot", { token: TOKEN });
    const customerId = await customer("Olim", "+998903333333");
    await linkedChat(customerId, 902);

    expect((await call(company.ownerCookie, "DELETE", "/api/telegram/customer-bot")).statusCode).toBe(204);

    sent = [];
    await notifyPurchase({ companyId: company.companyId, customerId, number: "SO-4", total: "1", paid: "1", items: [] });
    expect(sent.filter((item) => item.method === "sendMessage")).toHaveLength(0);
  });

  it("tokenni almashtirish bitta yozuvda yangi tokenni saqlaydi", async () => {
    await call(company.ownerCookie, "PUT", "/api/telegram/customer-bot", { token: TOKEN });
    await call(company.ownerCookie, "PUT", "/api/telegram/customer-bot", { token: OTHER_TOKEN });
    const rows = await db.select().from(telegramBots).where(eq(telegramBots.companyId, company.companyId));
    expect(rows).toHaveLength(1);
    expect(openSecret(rows[0]!.tokenCipher)).toBe(OTHER_TOKEN);
  });
});
