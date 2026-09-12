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
import { startMaintenance } from "./shared/maintenance.js";
import { closeDb, pool } from "./db/client.js";
import { aiRoutes } from "./modules/ai/routes.js";
import { analyticsRoutes } from "./modules/analytics/routes.js";
import { authRoutes } from "./modules/auth/routes.js";
import { catalogRoutes } from "./modules/catalog/routes.js";
import { companyRoutes } from "./modules/company/routes.js";
import { crmRoutes } from "./modules/crm/routes.js";
import { distributionRoutes } from "./modules/distribution/routes.js";
import { salesAgentRoutes } from "./modules/sales-agent/routes.js";
import { posDeviceRoutes, posDevicesAdminRoutes } from "./modules/pos-device/routes.js";
import { fileRoutes } from "./modules/files/routes.js";
import { financeRoutes } from "./modules/finance/routes.js";
import { hrRoutes } from "./modules/hr/routes.js";
import { inventoryRoutes } from "./modules/inventory/routes.js";
import { manufacturingRoutes } from "./modules/manufacturing/routes.js";
import { notificationRoutes } from "./modules/notifications/routes.js";
import { platformRoutes } from "./modules/platform/routes.js";
import { publicRoutes } from "./modules/public/routes.js";
import { purchaseRoutes } from "./modules/purchase/routes.js";
import { registrationRoutes } from "./modules/registration/routes.js";
import { salesRoutes } from "./modules/sales/routes.js";

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
  await app.register(catalogRoutes, { prefix: "/api/catalog" });
  await app.register(inventoryRoutes, { prefix: "/api/inventory" });
  await app.register(financeRoutes, { prefix: "/api/finance" });
  await app.register(purchaseRoutes, { prefix: "/api/purchase" });
  await app.register(salesRoutes, { prefix: "/api/sales" });
  await app.register(crmRoutes, { prefix: "/api/crm" });
  await app.register(distributionRoutes, { prefix: "/api/distribution" });
  await app.register(salesAgentRoutes, { prefix: "/api/sales-agent" });
  await app.register(posDeviceRoutes, { prefix: "/api/pos-device" });
  await app.register(posDevicesAdminRoutes, { prefix: "/api/pos/devices" });
  await app.register(manufacturingRoutes, { prefix: "/api/manufacturing" });
  await app.register(hrRoutes, { prefix: "/api/hr" });
  await app.register(analyticsRoutes, { prefix: "/api/analytics" });
  await app.register(notificationRoutes, { prefix: "/api/notifications" });
  await app.register(aiRoutes, { prefix: "/api/ai" });
  await app.register(fileRoutes, { prefix: "/api/files" });

  return app;
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : "";
const isEntrypoint = entryPath !== "" && fileURLToPath(import.meta.url) === entryPath;

if (isEntrypoint) {
  const app = await buildServer();
  let stopMaintenance = () => {};

  const shutdown = async (signal: string) => {
    app.log.info(`${signal} — to'xtatilmoqda`);
    stopMaintenance();
    await app.close();
    await closeDb();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  try {
    await app.listen({ port: env.PORT, host: env.HOST });
    stopMaintenance = startMaintenance(app.log);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}
