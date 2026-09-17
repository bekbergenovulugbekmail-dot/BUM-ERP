/**
 * /api/telegram — botlarni sozlash va Telegram'dan kelgan yangilanishlar.
 *
 * Ochiq yo'l (sessiyasiz): `POST /webhook/:secret` — faqat Telegram chaqiradi. Himoya ikki qavat:
 * manzildagi tasodifiy sir va Telegram yuboradigan `X-Telegram-Bot-Api-Secret-Token` sarlavhasi.
 *
 * Sozlash yo'llari:
 *   GET/PUT/DELETE /owner-bot           platforma admini — barcha biznes egalari uchun bitta bot
 *   GET/PUT/DELETE /customer-bot        kompaniya egasi (`settings.manage`) — o'z mijozlar boti
 *   PUT  /customer-bot/features         qaysi xabarlar borishi (ptichkalar)
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { badRequest, forbidden } from "@bum/shared";
import { db } from "../../db/client.js";
import { withTransaction } from "../../db/transaction.js";
import { requestMeta, writeAuditLog } from "../../shared/audit.js";
import { authOf, requireAuth } from "../auth/guard.js";
import { requirePermission, requireTenant, requireTenantForWrite } from "../company/tenant.js";
import {
  CUSTOMER_FEATURES,
  botToken,
  findBot,
  findBotBySecret,
  publicBot,
  saveBot,
  setBotActive,
  updateFeatures,
} from "./bots.service.js";
import { deleteWebhook } from "./telegram-api.service.js";
import { handleUpdate, type Update } from "./webhook.service.js";

const secretParams = z.object({ secret: z.string().min(16).max(64) });
const tokenBody = z.strictObject({ token: z.string().trim().min(20).max(120) });
/** Faqat o'zgargan ptichkalarni yuborish kifoya — qolganlari o'z holicha qoladi. */
const featuresBody = z.strictObject({
  features: z
    .object(Object.fromEntries(Object.keys(CUSTOMER_FEATURES).map((key) => [key, z.boolean().optional()])))
    .strict(),
});

/** Platforma admini — egalar boti faqat unga. */
function requirePlatformAdmin(req: FastifyRequest) {
  const { user } = authOf(req);
  if (!user.isPlatformAdmin) throw forbidden("Bu amal faqat platforma administratori uchun");
  return user;
}

export async function telegramRoutes(app: FastifyInstance): Promise<void> {
  // ─── Telegram'dan kelgan yangilanish (ochiq) ─────────────────────────────
  app.post("/webhook/:secret", async (req, reply) => {
    const { secret } = secretParams.parse(req.params);
    const bot = await findBotBySecret(db, secret);
    // Telegram'ga har doim 200: aks holda u qayta-qayta yuboraveradi
    if (!bot) return reply.status(200).send({ ok: true });

    const header = req.headers["x-telegram-bot-api-secret-token"];
    if (header !== secret) return reply.status(200).send({ ok: true });

    // Javobni kutmasdan 200 qaytaramiz — Telegram 60 s limitiga tushib qolmasin
    void handleUpdate(bot, req.body as Update);
    return reply.status(200).send({ ok: true });
  });

  // ─── Sozlash yo'llari — faqat kirgan foydalanuvchi (webhook yuqorida, ochiq) ──
  const auth = { preHandler: requireAuth };

  // ─── Egalar boti (platforma) ─────────────────────────────────────────────
  app.get("/owner-bot", auth, async (req) => {
    requirePlatformAdmin(req);
    return { bot: publicBot(await findBot(db, "owner", null)) };
  });

  app.put("/owner-bot", auth, async (req) => {
    const user = requirePlatformAdmin(req);
    const body = tokenBody.parse(req.body);
    const result = await withTransaction((tx) =>
      saveBot(tx, { kind: "owner", companyId: null, token: body.token, actorId: user.id }),
    );
    await writeAuditLog({
      userId: user.id,
      userName: user.name,
      action: "TELEGRAM_OWNER_BOT_SAVED",
      resource: "telegram_bots",
      resourceId: result.botId,
      details: { username: result.username },
      ...requestMeta(req),
    });
    return { bot: publicBot(await findBot(db, "owner", null)), webhookError: result.webhookError };
  });

  app.delete("/owner-bot", auth, async (req, reply) => {
    const user = requirePlatformAdmin(req);
    const bot = await findBot(db, "owner", null);
    if (!bot) throw badRequest("Bot sozlanmagan");
    await deleteWebhook(botToken(bot));
    await withTransaction((tx) => setBotActive(tx, bot.id, false));
    await writeAuditLog({
      userId: user.id,
      userName: user.name,
      action: "TELEGRAM_OWNER_BOT_DISABLED",
      resource: "telegram_bots",
      resourceId: bot.id,
      details: {},
      ...requestMeta(req),
    });
    return reply.status(204).send();
  });

  // ─── Mijozlar boti (kompaniya) ───────────────────────────────────────────
  app.get("/customer-bot", auth, async (req) => {
    const tenant = await requireTenant(db, authOf(req).user);
    await requirePermission(db, tenant, "settings.view");
    return {
      bot: publicBot(await findBot(db, "customer", tenant.company.id)),
      availableFeatures: CUSTOMER_FEATURES,
    };
  });

  app.put("/customer-bot", auth, async (req) => {
    const body = tokenBody.parse(req.body);
    const { user } = authOf(req);
    const result = await withTransaction(async (tx) => {
      const tenant = await requireTenantForWrite(tx, user);
      await requirePermission(tx, tenant, "settings.manage");
      const saved = await saveBot(tx, { kind: "customer", companyId: tenant.company.id, token: body.token, actorId: user.id });
      await writeAuditLog(
        {
          userId: user.id,
          userName: user.name,
          companyId: tenant.company.id,
          action: "TELEGRAM_CUSTOMER_BOT_SAVED",
          resource: "telegram_bots",
          resourceId: saved.botId,
          details: { username: saved.username },
          ...requestMeta(req),
        },
        tx,
      );
      return { saved, companyId: tenant.company.id };
    });
    return { bot: publicBot(await findBot(db, "customer", result.companyId)), webhookError: result.saved.webhookError };
  });

  app.put("/customer-bot/features", auth, async (req) => {
    const body = featuresBody.parse(req.body);
    const { user } = authOf(req);
    const companyId = await withTransaction(async (tx) => {
      const tenant = await requireTenantForWrite(tx, user);
      await requirePermission(tx, tenant, "settings.manage");
      const bot = await findBot(tx, "customer", tenant.company.id);
      if (!bot) throw badRequest("Avval bot tokenini qo'ying");
      await updateFeatures(tx, bot, body.features as Record<string, boolean>);
      return tenant.company.id;
    });
    return { bot: publicBot(await findBot(db, "customer", companyId)) };
  });

  app.delete("/customer-bot", auth, async (req, reply) => {
    const { user } = authOf(req);
    await withTransaction(async (tx) => {
      const tenant = await requireTenantForWrite(tx, user);
      await requirePermission(tx, tenant, "settings.manage");
      const bot = await findBot(tx, "customer", tenant.company.id);
      if (!bot) throw badRequest("Bot sozlanmagan");
      await deleteWebhook(botToken(bot));
      await setBotActive(tx, bot.id, false);
    });
    return reply.status(204).send();
  });
}
