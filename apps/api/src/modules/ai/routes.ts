/**
 * /api/ai — AI yordamchi (convex/analytics/ai.ts).
 *
 *   GET  /status      — yoqilganmi (sessiya)
 *   POST /assistant   — analytics.view; soatiga 20 ta; kalit yo'q — 503; tashqi xizmat xatosi — 502
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../../db/client.js";
import { authOf, requireAuth } from "../auth/guard.js";
import { requirePermission, requireTenant } from "../company/tenant.js";
import { AssistantUnavailableError, askAssistant, assistantProvider } from "./assistant.service.js";

const askBody = z.strictObject({
  question: z.string().trim().min(1).max(2000),
  context: z.string().trim().max(2000).nullable().optional(),
  history: z
    .array(z.strictObject({ role: z.enum(["user", "assistant"]), content: z.string().trim().min(1).max(4000) }))
    .max(20)
    .refine((history) => history.length === 0 || history[0]!.role === "user", {
      message: "Suhbat tarixi foydalanuvchi xabari bilan boshlanishi kerak",
    })
    .optional(),
});

export async function aiRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.get("/status", async () => ({ enabled: assistantProvider.client !== null }));

  app.post("/assistant", async (req, reply) => {
    const body = askBody.parse(req.body);
    const tenant = await requireTenant(db, authOf(req).user);
    await requirePermission(db, tenant, "analytics.view");

    const client = assistantProvider.client;
    if (!client) {
      return reply.status(503).send({ code: "SERVICE_UNAVAILABLE", message: "AI yordamchi sozlanmagan (ANTHROPIC_API_KEY)" });
    }
    try {
      return await askAssistant(db, tenant, body, client);
    } catch (error) {
      if (error instanceof AssistantUnavailableError) {
        return reply.status(502).send({ code: "AI_ERROR", message: error.message });
      }
      throw error;
    }
  });
}
