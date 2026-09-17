/**
 * Davriy Telegram vazifalari (soatlik `startMaintenance` ichidan chaqiriladi):
 *   - egasiga kunlik xulosa (kechqurun 20:00 dan keyin, kuniga bir marta)
 *   - mijozlarga qarz eslatmasi (ertalab 10:00 dan keyin, kuniga bir marta)
 *
 * Qoidalar:
 *   - "kuniga bir marta" har suhbatning `state` ustunidagi sana bo'yicha — server qayta ishga tushsa ham takrorlanmaydi
 *   - bir nechta API nusxasi bo'lsa advisory lock bitta nusxaga ruxsat beradi
 *   - xato bo'lsa jurnalga yoziladi, qolgan suhbatlar baribir xabar oladi
 */
import { and, eq, isNotNull, lte, sql } from "drizzle-orm";
import { db } from "../../db/client.js";
import { telegramBots, telegramChats } from "../../db/schema/telegram.js";
import { customers, salesOrders } from "../../db/schema/sales.js";
import { logger } from "../../shared/logger.js";
import { botToken } from "./bots.service.js";
import { dailySummary, stockAlert } from "./owner-reports.service.js";
import { notifyDebtReminder } from "./notify.service.js";
import { sendMessage } from "./telegram-api.service.js";

/** Kunlik xulosa shu soatdan keyin yuboriladi (server vaqti). */
const DAILY_SUMMARY_HOUR = 20;
/** Qarz eslatmasi shu soatdan keyin. */
const DEBT_REMINDER_HOUR = 10;
/** To'lov muddati shu kun qolganda ham eslatiladi. */
const REMIND_BEFORE_DAYS = 3;

const localDay = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

/**
 * Kunni "band qilish": shu kun uchun belgi qo'yilmagan bo'lsa qo'yadi va `true` qaytaradi.
 * Bitta UPDATE bo'lgani uchun ikkita API nusxasi bir vaqtda ishlasa ham xabar ikki marta ketmaydi.
 */
async function claimDay(chatId: string, key: string, day: string): Promise<boolean> {
  const claimed = await db
    .update(telegramChats)
    .set({ state: sql`coalesce(${telegramChats.state}, '{}'::jsonb) || ${JSON.stringify({ [key]: day })}::jsonb` })
    .where(and(eq(telegramChats.id, chatId), sql`coalesce(${telegramChats.state} ->> ${key}, '') <> ${day}`))
    .returning({ id: telegramChats.id });
  return claimed.length > 0;
}

/** Egasiga kunlik xulosa + qoldiq ogohlantirishi. Yuborilgan suhbatlar soni. */
export async function runOwnerDailySummaries(now = new Date()): Promise<number> {
  if (now.getHours() < DAILY_SUMMARY_HOUR) return 0;
  const day = localDay(now);
  const chats = await db
    .select({ id: telegramChats.id, chatId: telegramChats.chatId, companyId: telegramChats.companyId, tokenCipher: telegramBots.tokenCipher })
    .from(telegramChats)
    .innerJoin(telegramBots, eq(telegramBots.id, telegramChats.botId))
    .where(
      and(
        eq(telegramBots.kind, "owner"),
        eq(telegramBots.isActive, true),
        isNotNull(telegramChats.linkedAt),
        isNotNull(telegramChats.companyId),
        sql`coalesce(${telegramChats.state} ->> 'dailySummaryAt', '') <> ${day}`,
      ),
    );

  let sent = 0;
  for (const chat of chats) {
    if (!chat.companyId) continue;
    try {
      if (!(await claimDay(chat.id, "dailySummaryAt", day))) continue;
      const token = botToken({ tokenCipher: chat.tokenCipher });
      await sendMessage(token, chat.chatId, await dailySummary(db, chat.companyId, now));
      const stock = await stockAlert(db, chat.companyId);
      if (stock.startsWith("<b>")) await sendMessage(token, chat.chatId, stock);
      sent += 1;
    } catch (error) {
      logger.warn({ err: error, companyId: chat.companyId }, "Kunlik xulosa yuborilmadi");
    }
  }
  return sent;
}

/** Mijozlarga qarz eslatmasi (bot va `debtReminder` yoqilgan kompaniyalarda). */
export async function runCustomerDebtReminders(now = new Date()): Promise<number> {
  if (now.getHours() < DEBT_REMINDER_HOUR) return 0;
  const day = localDay(now);
  const horizon = localDay(new Date(now.getTime() + REMIND_BEFORE_DAYS * 86_400_000));

  const chats = await db
    .select({
      id: telegramChats.id,
      chatId: telegramChats.chatId,
      customerId: telegramChats.customerId,
      companyId: telegramBots.companyId,
      features: telegramBots.features,
    })
    .from(telegramChats)
    .innerJoin(telegramBots, eq(telegramBots.id, telegramChats.botId))
    .where(
      and(
        eq(telegramBots.kind, "customer"),
        eq(telegramBots.isActive, true),
        isNotNull(telegramChats.linkedAt),
        isNotNull(telegramChats.customerId),
        sql`coalesce(${telegramChats.state} ->> 'debtReminderAt', '') <> ${day}`,
      ),
    );

  let sent = 0;
  for (const chat of chats) {
    if (!chat.customerId || !chat.companyId || chat.features?.debtReminder !== true) continue;
    try {
      // Muddati kelgan (yoki yaqinlashgan) qarz: buyurtma sanasi + mijozning to'lov muddati
      const [row] = await db
        .select({
          debt: sql<string>`coalesce(sum(${salesOrders.totalAmount} - ${salesOrders.paidAmount}), 0)::text`,
          dueDate: sql<string | null>`min((${salesOrders.orderDate} + (${customers.paymentTermDays} || ' days')::interval)::date)::text`,
        })
        .from(salesOrders)
        .innerJoin(customers, eq(customers.id, salesOrders.customerId))
        .where(
          and(
            eq(salesOrders.companyId, chat.companyId),
            eq(salesOrders.customerId, chat.customerId),
            sql`${salesOrders.totalAmount} > ${salesOrders.paidAmount}`,
            sql`${salesOrders.status} <> 'cancelled'`,
            lte(sql`(${salesOrders.orderDate} + (${customers.paymentTermDays} || ' days')::interval)::date`, sql`${horizon}::date`),
          ),
        );
      if (!row || Number(row.debt) <= 0) continue;
      if (!(await claimDay(chat.id, "debtReminderAt", day))) continue;

      await notifyDebtReminder({
        companyId: chat.companyId,
        customerId: chat.customerId,
        debt: row.debt,
        dueDate: row.dueDate,
        overdue: Boolean(row.dueDate && row.dueDate < day),
      });
      sent += 1;
    } catch (error) {
      logger.warn({ err: error, customerId: chat.customerId }, "Qarz eslatmasi yuborilmadi");
    }
  }
  return sent;
}

/** Ikkala vazifa (takrorlanmaslik har suhbat bo'yicha `claimDay` bilan ta'minlanadi). */
export async function runTelegramJobs(now = new Date()): Promise<{ summaries: number; reminders: number }> {
  return { summaries: await runOwnerDailySummaries(now), reminders: await runCustomerDebtReminders(now) };
}
