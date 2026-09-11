/**
 * /api/sales-agent — sotuv agentining mobil ish joyi.
 *
 *   GET /me        sales_agent.use — bog'langan agent profili va kompaniya
 *
 * Har so'rovda: kompaniya a'zoligi, `sales_agent.use` ruxsati va foydalanuvchiga bog'langan faol agent.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { companies } from "../../db/schema/platform.js";
import { authOf, requireAuth } from "../auth/guard.js";
import { requirePermission, requireTenant } from "../company/tenant.js";
import { requireAgent, type AgentContext } from "./agent-context.js";

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
}
