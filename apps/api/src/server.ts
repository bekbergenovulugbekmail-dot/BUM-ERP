/**
 * BUM ERP API — kirish nuqtasi.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import type { FastifyBaseLogger } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import { env, features, isProd } from "./env.js";
import { logger } from "./shared/logger.js";
import { registerErrorHandler } from "./shared/errors.js";
import { closeDb, pool } from "./db/client.js";
import { authRoutes } from "./modules/auth/routes.js";
import { companyRoutes } from "./modules/company/routes.js";
import { platformRoutes } from "./modules/platform/routes.js";
import { publicRoutes } from "./modules/public/routes.js";
import { registrationRoutes } from "./modules/registration/routes.js";

export async function buildServer() {
  const app = Fastify({
    // pino instansiyasi Fastify'ning bazaviy logger tipiga keltiriladi —
    // aks holda butun FastifyInstance tipi pino'ga bog'lanib qoladi.
    loggerInstance: logger as unknown as FastifyBaseLogger,
    trustProxy: true,
    bodyLimit: 2 * 1024 * 1024,
  });

  await app.register(helmet, {
    // SPA alohida originda turadi, shuning uchun CSP shu yerda emas.
    contentSecurityPolicy: false,
  });

  await app.register(cors, {
    origin: env.WEB_ORIGIN,
    /** Cookie yuborilishi uchun majburiy. */
    credentials: true,
  });

  await app.register(cookie, {
    secret: env.SESSION_SECRET,
    parseOptions: {
      httpOnly: true,
      secure: isProd,
      sameSite: "lax",
      path: "/",
    },
  });

  registerErrorHandler(app);

  app.get("/health", async () => {
    await pool.query("select 1");
    return {
      status: "ok",
      env: env.NODE_ENV,
      features,
      time: new Date().toISOString(),
    };
  });

  /** `requireAuth` to'ldiradi — qarang modules/auth/guard.ts. */
  app.decorateRequest("auth", null);

  // Modul marshrutlari
  await app.register(authRoutes, { prefix: "/api/auth" });
  await app.register(registrationRoutes, { prefix: "/api/registration" });
  await app.register(publicRoutes, { prefix: "/api/public" });
  await app.register(platformRoutes, { prefix: "/api/platform" });
  await app.register(companyRoutes, { prefix: "/api/company" });

  return app;
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : "";
const isEntrypoint = entryPath !== "" && fileURLToPath(import.meta.url) === entryPath;

if (isEntrypoint) {
  const app = await buildServer();

  const shutdown = async (signal: string) => {
    app.log.info(`${signal} — to'xtatilmoqda`);
    await app.close();
    await closeDb();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  try {
    await app.listen({ port: env.PORT, host: env.HOST });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}
