/**
 * /api/analytics — bosh sahifa va tahlil hisobotlari (convex/dashboard.ts, convex/analytics/reports.ts).
 * Hammasi `analytics.view`; `days` — 1…366 (standart 30).
 *
 *   GET /dashboard
 *   GET /reports/sales, /reports/expenses, /reports/purchases, /reports/overview, /reports/stock-velocity (?days=)
 *   GET /reports/stock
 *   GET /reports/top-customers (?days=&limit=)
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { db } from "../../db/client.js";
import { authOf, requireAuth } from "../auth/guard.js";
import { requirePermission, requireTenant, type TenantContext } from "../company/tenant.js";
import { getDashboard } from "./dashboard.service.js";
import {
  biOverview,
  expenseSummary,
  purchaseSummary,
  salesSummary,
  stockSummary,
  stockVelocity,
  topCustomers,
} from "./reports.service.js";

const daysQuery = z.object({ days: z.coerce.number().int().min(1).max(366).default(30) });
const topCustomersQuery = daysQuery.extend({ limit: z.coerce.number().int().min(1).max(50).default(10) });

async function readTenant(req: FastifyRequest): Promise<TenantContext> {
  const tenant = await requireTenant(db, authOf(req).user);
  await requirePermission(db, tenant, "analytics.view");
  return tenant;
}

export async function analyticsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.get("/dashboard", async (req) => getDashboard(db, await readTenant(req)));

  app.get("/reports/sales", async (req) => {
    const { days } = daysQuery.parse(req.query);
    return salesSummary(db, await readTenant(req), days);
  });

  app.get("/reports/stock", async (req) => stockSummary(db, await readTenant(req)));

  app.get("/reports/expenses", async (req) => {
    const { days } = daysQuery.parse(req.query);
    return expenseSummary(db, await readTenant(req), days);
  });

  app.get("/reports/purchases", async (req) => {
    const { days } = daysQuery.parse(req.query);
    return purchaseSummary(db, await readTenant(req), days);
  });

  app.get("/reports/overview", async (req) => {
    const { days } = daysQuery.parse(req.query);
    return biOverview(db, await readTenant(req), days);
  });

  app.get("/reports/top-customers", async (req) => {
    const { days, limit } = topCustomersQuery.parse(req.query);
    return { customers: await topCustomers(db, await readTenant(req), days, limit) };
  });

  app.get("/reports/stock-velocity", async (req) => {
    const { days } = daysQuery.parse(req.query);
    return { products: await stockVelocity(db, await readTenant(req), days) };
  });
}
