"use node";

import { getAuthUserId } from "@convex-dev/auth/server";
import { v, ConvexError } from "convex/values";
import Anthropic from "@anthropic-ai/sdk";
import { action } from "../_generated/server";
import { api } from "../_generated/api";

/**
 * To'g'ridan-to'g'ri Anthropic API.
 * Tashqi AI gateway'ga bog'liqlik yo'q — to'g'ridan-to'g'ri Anthropic API.
 *
 * Convex env: npx convex env set ANTHROPIC_API_KEY sk-ant-...
 */
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const MODEL = "claude-sonnet-4-6";

export const askAssistant = action({
  args: {
    question: v.string(),
    context: v.optional(v.string()),
    /** Ko'p bosqichli suhbat uchun oldingi xabarlar */
    history: v.optional(
      v.array(
        v.object({
          role: v.union(v.literal("user"), v.literal("assistant")),
          content: v.string(),
        }),
      ),
    ),
  },
  handler: async (ctx, args): Promise<{ answer: string }> => {
    // XAVFSIZLIK: ma'lumotga tegishdan oldin autentifikatsiya
    const authUserId = await getAuthUserId(ctx);
    if (!authUserId) {
      throw new ConvexError({
        code: "UNAUTHENTICATED",
        message: "Tizimga kirish talab etiladi",
      });
    }

    // Barcha so'rovlar chaqiruvchining auth konteksti bilan ishlaydi va
    // tenant-scoped — faqat joriy kompaniya ma'lumotini qaytaradi.
    const [salesStats, stockLevels, employees, expenses] = await Promise.all([
      ctx.runQuery(api.analytics.reports.getSalesSummary, { days: 30 }),
      ctx.runQuery(api.analytics.reports.getStockSummary, {}),
      ctx.runQuery(api.hr.employees.getStats, {}),
      ctx.runQuery(api.analytics.reports.getExpenseSummary, { days: 30 }),
    ]);

    const systemPrompt = `Siz BUM ERP tizimining biznes-tahlilchi yordamchisisiz.

Quyida joriy kompaniyaning real vaqtdagi ma'lumotlari keltirilgan.
Faqat shu ma'lumotlarga tayaning. Raqamlarni o'ylab topmang —
ma'lumot yetishmasa, buni ochiq ayting.

SOTUV (oxirgi 30 kun):
- Buyurtmalar: ${salesStats.totalOrders}
- Aylanma: ${salesStats.totalRevenue.toLocaleString()} so'm
- To'langan: ${salesStats.paidRevenue.toLocaleString()} so'm
- Eng ko'p sotilgan: ${salesStats.topProducts.map((p) => `${p.name} (${p.qty} dona)`).join(", ") || "ma'lumot yo'q"}

OMBOR:
- Jami SKU: ${stockLevels.totalProducts}
- Kam qolgan: ${stockLevels.lowStock}
- Tugagan: ${stockLevels.outOfStock}
- Qoldiq qiymati: ${stockLevels.totalValue.toLocaleString()} so'm

XODIMLAR:
- Faol: ${employees.active}
- Oylik fondi: ${employees.totalSalary.toLocaleString()} so'm/oy

XARAJATLAR (oxirgi 30 kun):
- Jami: ${expenses.total.toLocaleString()} so'm
- Turlari bo'yicha: ${expenses.byCategory.map((c) => `${c.category}: ${c.amount.toLocaleString()}`).join(", ") || "ma'lumot yo'q"}
${args.context ? `\nQo'shimcha kontekst: ${args.context}` : ""}

QOIDALAR:
- Foydalanuvchi qaysi tilda yozsa, o'sha tilda javob bering (o'zbek, rus yoki qoraqalpoq).
- Qisqa va aniq bo'ling. Umumiy maslahat emas, shu raqamlarga asoslangan xulosa bering.
- Muammo ko'rsangiz, uni nima qilish kerakligi bilan birga ayting.`;

    try {
      const response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 2048,
        system: systemPrompt,
        messages: [
          ...(args.history ?? []),
          { role: "user" as const, content: args.question },
        ],
      });

      const answer = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === "text")
        .map((block) => block.text)
        .join("\n")
        .trim();

      return { answer: answer || "Javob olishda xatolik" };
    } catch (error) {
      if (error instanceof Anthropic.APIError) {
        const msg =
          error.status === 429
            ? "So'rovlar chegarasi oshdi. Bir oz kutib qayta urining."
            : error.status === 401
              ? "AI kaliti noto'g'ri. Administratorga murojaat qiling."
              : `AI xatoligi: ${error.message}`;
        // eslint-disable-next-line preserve-caught-error
        throw new ConvexError({ code: "AI_ERROR", message: msg });
      }
      // eslint-disable-next-line preserve-caught-error
      throw new ConvexError({
        code: "AI_ERROR",
        message: "AI yordamchi ishlamayapti. Qayta urinib ko'ring.",
      });
    }
  },
});
