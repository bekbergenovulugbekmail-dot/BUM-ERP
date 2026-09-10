"use node";

import { v, ConvexError } from "convex/values";
import OpenAI from "openai";
import { action } from "../_generated/server";
import { api } from "../_generated/api";

const openai = new OpenAI({
  baseURL: "https://ai-gateway.hercules.app/v1",
  apiKey: process.env.HERCULES_API_KEY,
});

export const askAssistant = action({
  args: {
    question: v.string(),
    context: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ answer: string }> => {
    // SECURITY: require authentication before any data access
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError({ code: "UNAUTHENTICATED", message: "Tizimga kirish talab etiladi" });
    }

    // All sub-queries run with the caller's auth context.
    // They are now tenant-scoped (each uses getTenantId internally),
    // so they will ONLY return data for the authenticated user's active company.
    const [salesStats, stockLevels, employees, expenses] = await Promise.all([
      ctx.runQuery(api.analytics.reports.getSalesSummary, { days: 30 }),
      ctx.runQuery(api.analytics.reports.getStockSummary, {}),
      ctx.runQuery(api.hr.employees.getStats, {}),
      ctx.runQuery(api.analytics.reports.getExpenseSummary, { days: 30 }),
    ]);

    const bizContext = `
You are an ERP AI assistant for a business management system. Here is real-time business data for the current authenticated company ONLY:

SALES (last 30 days):
- Total orders: ${salesStats.totalOrders}
- Total revenue: ${salesStats.totalRevenue.toLocaleString()} UZS
- Paid: ${salesStats.paidRevenue.toLocaleString()} UZS
- Top products: ${salesStats.topProducts.map((p) => `${p.name} (${p.qty} sold)`).join(", ") || "none"}

INVENTORY:
- Total SKUs: ${stockLevels.totalProducts}
- Low stock items: ${stockLevels.lowStock}
- Out of stock: ${stockLevels.outOfStock}
- Total stock value: ${stockLevels.totalValue.toLocaleString()} UZS

EMPLOYEES:
- Active staff: ${employees.active}
- Total salary fund: ${employees.totalSalary.toLocaleString()} UZS/month

EXPENSES (last 30 days):
- Total: ${expenses.total.toLocaleString()} UZS
- By category: ${expenses.byCategory.map((c) => `${c.category}: ${c.amount.toLocaleString()}`).join(", ") || "none"}

${args.context ? `Additional context: ${args.context}` : ""}

Answer questions in the same language the user writes in (Uzbek, Russian, or Kazakh). Be concise, specific, and give actionable recommendations.`;

    try {
      const response = await openai.chat.completions.create({
        model: "openai/gpt-5.6-luna",
        reasoning_effort: "low",
        messages: [
          { role: "system", content: bizContext },
          { role: "user", content: args.question },
        ],
      });
      return { answer: response.choices[0]?.message?.content ?? "Javob olishda xatolik" };
    } catch (error) {
      if (error instanceof OpenAI.APIError) {
        // eslint-disable-next-line preserve-caught-error
        throw new Error(`AI xatoligi: ${error.message}`);
      }
      // eslint-disable-next-line preserve-caught-error
      throw new Error("AI assistant ishlamayapti. Qayta urinib ko'ring.");
    }
  },
});
