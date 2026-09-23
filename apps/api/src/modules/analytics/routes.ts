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
import { companyModuleStates } from "../company/modules.service.js";
import {
  effectivePermissions,
  hasPermission,
  requirePermission,
  requireTenant,
  type TenantContext,
} from "../company/tenant.js";
import type { TenantAccess } from "../subscription/access.js";
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

async function readTenant(req: FastifyRequest, access: TenantAccess = "business"): Promise<TenantContext> {
  const tenant = await requireTenant(db, authOf(req).user, { access });
  await requirePermission(db, tenant, "analytics.view");
  return tenant;
}

export async function analyticsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  // Obuna tugaganda ham ochiq (Bosh sahifa + Obuna); hisobotlar — yopiq
  app.get("/dashboard", async (req) => {
    const tenant = await readTenant(req, "dashboard");
    const [dashboard, permissions, modules] = await Promise.all([
      getDashboard(db, tenant),
      effectivePermissions(db, tenant),
      companyModuleStates(db, tenant.company.id),
    ]);
    // Kassa/bank qoldig'i va qarzlar — moliya ma'lumoti: `analytics.view` o'zi yetmaydi (moliya ruxsati va moduli).
    // Foyda va tannarx esa undan ham tor: `analytics.view_profit` (standart holatda faqat egada).
    const finance = permissions.includes("finance.view") && modules.finance;
    const profit = finance && permissions.includes("analytics.view_profit");
    return {
      ...dashboard,
      ...(finance ? {} : { cashBalance: null, bankBalance: null, supplierDebt: null, customerDebt: null }),
      ...(profit ? {} : { cogs: null, grossProfit: null }),
      financeHidden: !finance,
      profitHidden: !profit,
    };
  });

  app.get("/reports/sales", async (req) => {
    const { days } = daysQuery.parse(req.query);
    return salesSummary(db, await readTenant(req), days);
  });

  /** Ombor qiymati va ABC qiymatlari — tannarxdan hisoblanadi, shuning uchun `products.view_cost` kerak. */
  app.get("/reports/stock", async (req) => {
    const tenant = await readTenant(req);
    const summary = await stockSummary(db, tenant);
    if (await hasPermission(db, tenant, "products.view_cost")) return { ...summary, costHidden: false };
    // ABC harfi qoladi (u ish uchun kerak), pul qiymati esa yashiriladi
    return {
      ...summary,
      totalValue: null,
      abcData: summary.abcData.map((row) => ({ ...row, value: null })),
      costHidden: true,
    };
  });

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
    const tenant = await readTenant(req);
    const overview = await biOverview(db, tenant, days);
    // Foyda, marja va tannarx — alohida ruxsat bilan. Aylanma va xarajat ochiq qoladi: ular
    // ikkovidan foydani hisoblab bo'lmaydi, chunki tannarx (COGS) yashirilgan.
    if ((await effectivePermissions(db, tenant)).includes("analytics.view_profit")) {
      return { ...overview, profitHidden: false };
    }
    return { ...overview, cogs: null, grossProfit: null, netProfit: null, grossMargin: null, profitHidden: true };
  });

  app.get("/reports/top-customers", async (req) => {
    const { days, limit } = topCustomersQuery.parse(req.query);
    return { customers: await topCustomers(db, await readTenant(req), days, limit) };
  });

  /** Qoldiq qiymati (`value`) tannarxdan hisoblanadi — miqdor va harakatlilik ochiq, pul yopiq. */
  app.get("/reports/stock-velocity", async (req) => {
    const { days } = daysQuery.parse(req.query);
    const tenant = await readTenant(req);
    const products = await stockVelocity(db, tenant, days);
    if (await hasPermission(db, tenant, "products.view_cost")) return { products, costHidden: false };
    return { products: products.map((row) => ({ ...row, value: null })), costHidden: true };
  });
}
