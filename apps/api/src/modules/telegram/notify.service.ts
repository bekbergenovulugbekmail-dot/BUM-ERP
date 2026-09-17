/**
 * Telegram xabarnomalari — biznes hodisalaridan mijozga va egasiga.
 *
 * MUHIM: yuborish hech qachon biznes amalini to'xtatmaydi. Telegram ishlamasa yoki mijoz botiga
 * ulanmagan bo'lsa — sotuv/to'lov baribir yoziladi, xabar esa jim o'tkazib yuboriladi.
 * Shuning uchun barcha funksiyalar `void` qaytaradi va ichida xatoni yutadi.
 */
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "../../db/client.js";
import { telegramBots, telegramChats } from "../../db/schema/telegram.js";
import { salesOrderItems, salesOrders } from "../../db/schema/sales.js";
import { products } from "../../db/schema/catalog.js";
import { logger } from "../../shared/logger.js";
import { botToken } from "./bots.service.js";
import { sendMessage } from "./telegram-api.service.js";

const money = (value: string | number | null) => new Intl.NumberFormat("uz-UZ").format(Math.round(Number(value ?? 0)));

/** Kompaniyaning faol mijoz boti (imkoniyat yoqilgan bo'lsa). */
async function customerBot(companyId: string, feature: string) {
  const [bot] = await db
    .select({ id: telegramBots.id, tokenCipher: telegramBots.tokenCipher, features: telegramBots.features })
    .from(telegramBots)
    .where(and(eq(telegramBots.companyId, companyId), eq(telegramBots.kind, "customer"), eq(telegramBots.isActive, true)))
    .limit(1);
  if (!bot) return null;
  return bot.features?.[feature] === true ? bot : null;
}

/** Mijozning ulangan suhbatlari. */
async function customerChats(botId: string, customerId: string) {
  return db
    .select({ chatId: telegramChats.chatId })
    .from(telegramChats)
    .where(and(eq(telegramChats.botId, botId), eq(telegramChats.customerId, customerId), isNotNull(telegramChats.linkedAt)));
}

async function toCustomer(companyId: string, customerId: string | null, feature: string, text: string): Promise<void> {
  if (!customerId) return;
  try {
    const bot = await customerBot(companyId, feature);
    if (!bot) return;
    const chats = await customerChats(bot.id, customerId);
    if (chats.length === 0) return;
    const token = botToken(bot);
    for (const chat of chats) await sendMessage(token, chat.chatId, text);
  } catch (error) {
    // Xabar yuborilmasa ham biznes amali bajarilgan — faqat jurnalga yozamiz
    logger.warn({ err: error, customerId, feature }, "Mijozga Telegram xabari yuborilmadi");
  }
}

/** Xarid cheki. */
export function notifyPurchase(input: {
  companyId: string;
  customerId: string | null;
  number: string;
  total: string;
  paid: string;
  items: { name: string; quantity: string; lineTotal: string }[];
}): Promise<void> {
  const debt = Number(input.total) - Number(input.paid);
  const lines = [
    `<b>Xarid — ${input.number}</b>`,
    "",
    ...input.items.slice(0, 15).map((item) => `${item.name} × ${Number(item.quantity)} — ${money(item.lineTotal)} so'm`),
    "",
    `Jami: <b>${money(input.total)} so'm</b>`,
    `To'landi: ${money(input.paid)} so'm`,
  ];
  if (debt > 0) lines.push(`Qoldi: <b>${money(debt)} so'm</b>`);
  return toCustomer(input.companyId, input.customerId, "purchase", lines.join("\n"));
}

/**
 * To'lov qabul qilindi. `collectedBy` — kassa, savdo agenti yoki yetkazuvchi
 * (mijoz kimga berganini ko'rib turishi kerak).
 */
export function notifyPayment(input: {
  companyId: string;
  customerId: string | null;
  amount: string;
  method: string;
  remainingDebt: string;
  collectedBy?: string | null;
}): Promise<void> {
  const remaining = Number(input.remainingDebt);
  const lines = [
    `<b>To'lovingiz qabul qilindi</b>`,
    "",
    `Summa: <b>${money(input.amount)} so'm</b>`,
    ...(input.collectedBy ? [`Qabul qildi: ${input.collectedBy}`] : []),
    remaining > 0 ? `Qolgan qarz: <b>${money(remaining)} so'm</b>` : "Qarzingiz yopildi ✅",
  ];
  return toCustomer(input.companyId, input.customerId, "payment", lines.join("\n"));
}

/** Qarz eslatmasi. */
export function notifyDebtReminder(input: {
  companyId: string;
  customerId: string | null;
  debt: string;
  dueDate: string | null;
  overdue: boolean;
}): Promise<void> {
  const lines = [
    input.overdue ? "<b>To'lov muddati o'tdi</b>" : "<b>To'lov muddati yaqinlashmoqda</b>",
    "",
    `Qarz: <b>${money(input.debt)} so'm</b>`,
    ...(input.dueDate ? [`Muddat: ${input.dueDate}`] : []),
  ];
  return toCustomer(input.companyId, input.customerId, "debtReminder", lines.join("\n"));
}

/** Egasiga darhol ogohlantirish (platformaning egalar boti orqali). */
export async function notifyOwner(companyId: string, text: string): Promise<void> {
  try {
    const [bot] = await db
      .select({ id: telegramBots.id, tokenCipher: telegramBots.tokenCipher })
      .from(telegramBots)
      .where(and(eq(telegramBots.kind, "owner"), isNull(telegramBots.companyId), eq(telegramBots.isActive, true)))
      .limit(1);
    if (!bot) return;

    const chats = await db
      .select({ chatId: telegramChats.chatId })
      .from(telegramChats)
      .where(and(eq(telegramChats.botId, bot.id), eq(telegramChats.companyId, companyId), isNotNull(telegramChats.linkedAt)));
    if (chats.length === 0) return;

    const token = botToken(bot);
    for (const chat of chats) await sendMessage(token, chat.chatId, text);
  } catch (error) {
    logger.warn({ err: error, companyId }, "Egasiga Telegram xabari yuborilmadi");
  }
}

/**
 * To'lovdan keyin mijozga xabar: qolgan qarzni o'zi hisoblaydi.
 * TRANZAKSIYADAN KEYIN chaqiriladi — tarmoq kutishi bazani band qilmasin.
 */
export async function notifyCustomerPaymentReceived(input: {
  companyId: string;
  customerId: string | null;
  /** Mijoz ko'rsatilmagan bo'lsa — buyurtma orqali topiladi. */
  orderId?: string | null;
  amount: string;
  method: string;
  collectedBy?: string | null;
}): Promise<void> {
  try {
    const customerId = input.customerId ?? (input.orderId ? await orderCustomer(input.companyId, input.orderId) : null);
    if (!customerId) return;
    const [row] = await db
      .select({ debt: sql<string>`coalesce(sum(${salesOrders.totalAmount} - ${salesOrders.paidAmount}), 0)::text` })
      .from(salesOrders)
      .where(
        and(
          eq(salesOrders.companyId, input.companyId),
          eq(salesOrders.customerId, customerId),
          sql`${salesOrders.totalAmount} > ${salesOrders.paidAmount}`,
          sql`${salesOrders.status} <> 'cancelled'`,
        ),
      );
    await notifyPayment({ ...input, customerId, remainingDebt: row?.debt ?? "0" });
  } catch (error) {
    logger.warn({ err: error, orderId: input.orderId }, "To'lov xabarini yuborib bo'lmadi");
  }
}

/**
 * Sotuv yozilgandan KEYIN mijozga chek xabari: buyurtmani va qatorlarini o'zi o'qiydi.
 * Bot sozlanmagan bo'lsa — birinchi so'rovdayoq chiqib ketadi (ortiqcha o'qish bo'lmaydi).
 */
export async function notifyOrderPurchase(companyId: string, orderId: string): Promise<void> {
  try {
    if (!(await customerBot(companyId, "purchase"))) return;
    const [order] = await db
      .select({
        customerId: salesOrders.customerId,
        number: salesOrders.number,
        total: salesOrders.totalAmount,
        paid: salesOrders.paidAmount,
      })
      .from(salesOrders)
      .where(and(eq(salesOrders.id, orderId), eq(salesOrders.companyId, companyId)))
      .limit(1);
    if (!order?.customerId) return;

    const items = await db
      .select({
        name: products.name,
        quantity: salesOrderItems.quantity,
        lineTotal: salesOrderItems.lineTotal,
      })
      .from(salesOrderItems)
      .innerJoin(products, eq(products.id, salesOrderItems.productId))
      .where(eq(salesOrderItems.orderId, orderId))
      .limit(30);

    await notifyPurchase({
      companyId,
      customerId: order.customerId,
      number: order.number,
      total: order.total,
      paid: order.paid,
      items,
    });
  } catch (error) {
    logger.warn({ err: error, orderId }, "Xarid xabarini yuborib bo'lmadi");
  }
}

/** Buyurtma egasini topish (to'lov buyurtma bo'yicha kiritilgan bo'lsa). */
async function orderCustomer(companyId: string, orderId: string): Promise<string | null> {
  const [order] = await db
    .select({ customerId: salesOrders.customerId })
    .from(salesOrders)
    .where(and(eq(salesOrders.id, orderId), eq(salesOrders.companyId, companyId)))
    .limit(1);
  return order?.customerId ?? null;
}
