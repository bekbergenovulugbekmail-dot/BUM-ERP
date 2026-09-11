/**
 * /api/sales-agent — sotuv agentining mobil ish joyi. Hammasi `sales_agent.use` va bog'langan faol agent bilan.
 *
 *   GET /me                                        agent profili va kompaniya
 *   GET /today (?lat=&lng=)                        bugungi marshrut va uning do'konlari
 *   GET /stores (?scope=today|all&search=&lat=&lng=&limit=)   do'konlar (joy berilsa — yaqinidan)
 *   GET /stores/:customerId (?lat=&lng=)           do'kon profili (faqat agentga ochiq do'kon)
 *   GET /debtors (?filter=overdue|today|soon|all&lat=&lng=)   qarzdorlar
 *
 * `lat`/`lng` — agentning joriy joyi (masofa serverda hisoblanadi); `agentId` so'rovdan olinmaydi.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import { companies } from "../../db/schema/platform.js";
import type { GeoPoint } from "../../shared/geo.js";
import { authOf, requireAuth } from "../auth/guard.js";
import { requirePermission, requireTenant } from "../company/tenant.js";
import { requireAgent, type AgentContext } from "./agent-context.js";
import { agentDebtors, agentStore, agentStores, agentToday } from "./stores.service.js";

const originShape = {
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
};
const originQuery = z
  .object(originShape)
  .refine((query) => (query.lat === undefined) === (query.lng === undefined), { message: "lat va lng birga beriladi" });
const storesQuery = z
  .object({
    ...originShape,
    scope: z.enum(["today", "all"]).default("today"),
    search: z.string().trim().min(1).max(100).optional(),
    limit: z.coerce.number().int().min(1).max(500).default(200),
  })
  .refine((query) => (query.lat === undefined) === (query.lng === undefined), { message: "lat va lng birga beriladi" });
const debtorsQuery = z
  .object({ ...originShape, filter: z.enum(["overdue", "today", "soon", "all"]).default("all") })
  .refine((query) => (query.lat === undefined) === (query.lng === undefined), { message: "lat va lng birga beriladi" });
const storeParams = z.object({ customerId: z.uuid() });

const originOf = (query: { lat?: number; lng?: number }): GeoPoint | null =>
  query.lat !== undefined && query.lng !== undefined ? { latitude: query.lat, longitude: query.lng } : null;

async function readAgent(req: FastifyRequest): Promise<AgentContext> {
  const tenant = await requireTenant(db, authOf(req).user);
  await requirePermission(db, tenant, "sales_agent.use");
  return requireAgent(db, tenant);
}

export async function salesAgentRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.get("/me", async (req) => {
    const context = await readAgent(req);
    const [company] = await db
      .select({ id: companies.id, name: companies.name, currency: companies.currency })
      .from(companies)
      .where(eq(companies.id, context.company.id))
      .limit(1);
    return { agent: context.agent, company: company! };
  });

  app.get("/today", async (req) => {
    const query = originQuery.parse(req.query);
    return agentToday(db, await readAgent(req), originOf(query));
  });

  app.get("/stores", async (req) => {
    const query = storesQuery.parse(req.query);
    return { stores: await agentStores(db, await readAgent(req), { ...query, origin: originOf(query) }) };
  });

  app.get("/stores/:customerId", async (req) => {
    const { customerId } = storeParams.parse(req.params);
    const query = originQuery.parse(req.query);
    return { store: await agentStore(db, await readAgent(req), customerId, originOf(query)) };
  });

  app.get("/debtors", async (req) => {
    const query = debtorsQuery.parse(req.query);
    return { debtors: await agentDebtors(db, await readAgent(req), { filter: query.filter, origin: originOf(query) }) };
  });
}
