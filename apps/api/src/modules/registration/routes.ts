/**
 * /api/registration — o'zi ro'yxatdan o'tish (ommaviy, autentifikatsiyasiz).
 *
 *   GET  /   { enabled }        — Convex'dagi isRegistrationEnabled
 *   POST /   kompaniya + ega     — Convex'dagi registerCompany; faqat yoqilgan bo'lsa
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { forbidden } from "@bum/shared";
import { db } from "../../db/client.js";
import { withTransaction } from "../../db/transaction.js";
import { requestMeta } from "../../shared/audit.js";
import { assertNotLimited, recordHit } from "../../shared/rate-limit.js";
import { setSessionCookie } from "../auth/session.js";
import { getPlatformSettings } from "../platform/platform.service.js";
import { registerCompany } from "./registration.service.js";

const REGISTER_WINDOW_SECONDS = 60 * 60;
/** Bitta IP dan soatiga 5 ta urinish — ommaviy kompaniya ochishga qarshi. */
const MAX_REGISTRATIONS_PER_IP = 5;

const registerBody = z.strictObject({
  companyName: z.string().trim().min(1).max(200),
  ownerName: z.string().trim().min(1).max(200).optional(),
  phone: z.string().min(1).max(32),
  password: z.string().min(1).max(256),
  city: z.string().trim().min(1).max(100).optional(),
  address: z.string().trim().min(1).max(500).optional(),
  country: z.string().length(2).optional(),
  currency: z.string().length(3).optional(),
  language: z.string().length(2).optional(),
});

export async function registrationRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", async () => ({ enabled: (await getPlatformSettings(db)).registrationEnabled }));

  app.post("/", async (req, reply) => {
    const settings = await getPlatformSettings(db);
    if (!settings.registrationEnabled) throw forbidden("Ro'yxatdan o'tish yopiq");

    const body = registerBody.parse(req.body);
    const meta = requestMeta(req);

    const bucket = `register:ip:${meta.ipAddress}`;
    await assertNotLimited(bucket, MAX_REGISTRATIONS_PER_IP, REGISTER_WINDOW_SECONDS);
    // Har urinish hisoblanadi, muvaffaqiyatlisi ham
    await recordHit(bucket, REGISTER_WINDOW_SECONDS);

    const { company, session, me } = await withTransaction((tx) =>
      registerCompany(tx, body, settings, meta),
    );

    setSessionCookie(reply, session.token, session.expiresAt);
    reply.status(201);
    return { company, user: me };
  });
}
