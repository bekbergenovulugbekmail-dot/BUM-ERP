/**
 * /api/platform — hozircha faqat bootstrap. PHASE 5 da kompaniya va
 * platforma admin boshqaruvi shu yerga qo'shiladi.
 *
 * Convex mosligi:
 *   companies.platformAdminCount      → GET  /bootstrap  ({ enabled, needed })
 *   companies.platformSetAdminByEmail → POST /bootstrap
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { forbidden, notFound } from "@bum/shared";
import { withTransaction } from "../../db/transaction.js";
import { env } from "../../env.js";
import { requestMeta } from "../../shared/audit.js";
import { assertNotLimited, recordHit } from "../../shared/rate-limit.js";
import { startSession } from "../auth/auth.service.js";
import { setSessionCookie } from "../auth/session.js";
import {
  bootstrapKeyMatches,
  bootstrapPlatformAdmin,
  hasPlatformAdmin,
} from "./bootstrap.service.js";

const BOOTSTRAP_WINDOW_SECONDS = 15 * 60;
/** Kalitni tanlab topishga qarshi: bitta IP dan 15 daqiqada 5 ta xato. */
const MAX_BOOTSTRAP_FAILS_PER_IP = 5;

const bootstrapBody = z.object({
  secretKey: z.string().min(1).max(512),
  phone: z.string().min(1).max(32),
  password: z.string().min(1).max(256),
  name: z.string().max(200).optional(),
});

export async function platformRoutes(app: FastifyInstance): Promise<void> {
  /** Faqat ikki boolean — PII yo'q (Convex'da adminlar soni qaytardi). */
  app.get("/bootstrap", async () => ({
    enabled: Boolean(env.PLATFORM_BOOTSTRAP_KEY),
    needed: !(await hasPlatformAdmin()),
  }));

  app.post("/bootstrap", async (req, reply) => {
    if (!env.PLATFORM_BOOTSTRAP_KEY) throw notFound("Bootstrap o'chirilgan");

    const body = bootstrapBody.parse(req.body);
    const meta = requestMeta(req);

    const bucket = `bootstrap:ip:${meta.ipAddress}`;
    await assertNotLimited(bucket, MAX_BOOTSTRAP_FAILS_PER_IP, BOOTSTRAP_WINDOW_SECONDS);
    if (!bootstrapKeyMatches(body.secretKey, env.PLATFORM_BOOTSTRAP_KEY)) {
      await recordHit(bucket, BOOTSTRAP_WINDOW_SECONDS);
      throw forbidden("Noto'g'ri maxfiy kalit");
    }

    // Admin yaratiladi va shu tranzaksiyada tizimga kiritiladi
    const { session, me } = await withTransaction(async (tx) => {
      const { user } = await bootstrapPlatformAdmin(tx, body, { ...meta, via: "http" });
      return startSession(tx, { user, upgradedHash: null }, meta);
    });

    setSessionCookie(reply, session.token, session.expiresAt);
    return { user: me };
  });
}
