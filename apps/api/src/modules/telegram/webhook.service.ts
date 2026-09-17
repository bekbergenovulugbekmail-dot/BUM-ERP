/**
 * Telegram'dan kelgan yangilanishlarni qayta ishlash.
 *
 * Qoida: bu yo'l OCHIQ (Telegram sessiya cookie yubormaydi), shuning uchun kim yozayotgani
 * faqat webhook siri va ulashilgan telefon orqali aniqlanadi. Bog'lanmagan suhbatga
 * biznes ma'lumoti KO'RSATILMAYDI — avval kontakt so'raladi.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../../db/client.js";
import { withTransaction } from "../../db/transaction.js";
import { customers, salesOrders } from "../../db/schema/sales.js";
import { products } from "../../db/schema/catalog.js";
import { logger } from "../../shared/logger.js";
import {
  botToken,
  findChat,
  linkCustomerChat,
  linkOwnerChat,
  saveChatState,
  touchChat,
  type BotRow,
} from "./bots.service.js";
import { createBotOrder, searchBotProducts } from "./bot-orders.service.js";
import { dailySummary, debtorsReport, search, staffReport, stockAlert } from "./owner-reports.service.js";
import { notifyOwner } from "./notify.service.js";
import { answerCallback, sendMessage, type ReplyMarkup } from "./telegram-api.service.js";

/** Telegram yangilanishining bizga kerakli qismi. */
export type Update = {
  message?: {
    chat: { id: number };
    text?: string;
    contact?: { phone_number: string; user_id?: number };
  };
  callback_query?: { id: string; data?: string; message?: { chat: { id: number } } };
};

const CONTACT_KEYBOARD: ReplyMarkup = {
  keyboard: [[{ text: "📱 Telefon raqamni ulashish", request_contact: true }]],
  resize_keyboard: true,
  one_time_keyboard: true,
};

const OWNER_MENU: ReplyMarkup = {
  inline_keyboard: [
    [
      { text: "📊 Bugungi xulosa", callback_data: "summary" },
      { text: "📦 Qoldiq", callback_data: "stock" },
    ],
    [
      { text: "💳 Qarzdorlar", callback_data: "debtors" },
      { text: "👥 Xodimlar", callback_data: "staff" },
    ],
  ],
};

/** Yangilanishni qayta ishlaydi. Xato bo'lsa jurnalga yoziladi — Telegram'ga har doim 200 qaytadi. */
export async function handleUpdate(bot: BotRow, update: Update): Promise<void> {
  const token = botToken(bot);
  try {
    if (update.callback_query) {
      const chatId = update.callback_query.message?.chat.id;
      await answerCallback(token, update.callback_query.id);
      if (chatId) await handleCommand(bot, token, chatId, `/${update.callback_query.data ?? ""}`);
      return;
    }

    const message = update.message;
    if (!message) return;
    const chatId = message.chat.id;

    if (message.contact) {
      await handleContact(bot, token, chatId, message.contact.phone_number);
      return;
    }
    if (message.text) await handleCommand(bot, token, chatId, message.text.trim());
  } catch (error) {
    logger.error({ err: error, botId: bot.id }, "Telegram yangilanishini qayta ishlab bo'lmadi");
  }
}

async function handleContact(bot: BotRow, token: string, chatId: number, phone: string) {
  if (bot.kind === "owner") {
    const owner = await withTransaction((tx) => linkOwnerChat(tx, bot.id, chatId, phone));
    if (!owner) {
      await sendMessage(
        token,
        chatId,
        "Bu raqam BUM ERP'da biznes egasi sifatida topilmadi.\n\nBiznesingiz ro'yxatdan o'tgan raqamni ulashing yoki administratorga murojaat qiling.",
      );
      return;
    }
    await sendMessage(
      token,
      chatId,
      `Salom, ${owner.userName ?? "hurmatli egasi"}!\n<b>${owner.companyName}</b> biznesi ulandi.\n\nQuyidagi tugmalardan foydalaning yoki qidirish uchun shunchaki matn yozing (mijoz nomi, telefon, mahsulot).`,
      OWNER_MENU,
    );
    return;
  }

  const customer = await withTransaction((tx) => linkCustomerChat(tx, bot, chatId, phone));
  if (!customer) {
    await sendMessage(token, chatId, "Bu raqam mijozlar ro'yxatida topilmadi. Do'kon bilan bog'laning — raqamingizni kartochkangizga qo'shib qo'yishadi.");
    return;
  }
  await sendMessage(token, chatId, `Salom, ${customer.name}! Xaridlaringiz haqidagi xabarlar shu yerga keladi.`, customerMenu(bot));
}

function customerMenu(bot: BotRow): ReplyMarkup | undefined {
  const features = bot.features ?? {};
  const buttons = [];
  if (features.history) buttons.push({ text: "🧾 Xaridlarim", callback_data: "history" }, { text: "💳 Qarzim", callback_data: "debt" });
  if (features.ordering) buttons.push({ text: "🛒 Buyurtma berish", callback_data: "order" });
  return buttons.length > 0 ? { inline_keyboard: [buttons] } : undefined;
}

async function handleCommand(bot: BotRow, token: string, chatId: number, text: string) {
  const chat = await withTransaction((tx) => touchChat(tx, bot.id, chatId));
  const linked = Boolean(chat.linkedAt);

  if (text === "/start" || !linked) {
    const greeting =
      bot.kind === "owner"
        ? "BUM ERP — biznes egasi boti.\n\nBiznesingizni ulash uchun ERP'da ro'yxatdan o'tgan telefon raqamingizni ulashing."
        : "Xush kelibsiz! Xaridlaringiz va to'lovlaringiz haqidagi xabarlarni olish uchun telefon raqamingizni ulashing.";
    await sendMessage(token, chatId, greeting, CONTACT_KEYBOARD);
    return;
  }

  if (bot.kind === "owner") await ownerCommand(bot, token, chatId, text, chat.companyId);
  else await customerCommand(bot, token, chatId, text, chat.customerId);
}

async function ownerCommand(bot: BotRow, token: string, chatId: number, text: string, companyId: string | null) {
  if (!companyId) {
    await sendMessage(token, chatId, "Biznes aniqlanmadi — /start bosib raqamingizni qayta ulashing.");
    return;
  }
  const command = text.replace(/^\//, "").toLowerCase();

  if (command === "summary" || command === "hisobot") {
    await sendMessage(token, chatId, await dailySummary(db, companyId), OWNER_MENU);
    return;
  }
  if (command === "stock" || command === "qoldiq") {
    await sendMessage(token, chatId, await stockAlert(db, companyId), OWNER_MENU);
    return;
  }
  if (command === "debtors" || command === "qarz") {
    await sendMessage(token, chatId, await debtorsReport(db, companyId), OWNER_MENU);
    return;
  }
  if (command === "staff" || command === "xodim") {
    await sendMessage(token, chatId, await staffReport(db, companyId), OWNER_MENU);
    return;
  }
  if (command === "help" || command === "yordam") {
    await sendMessage(
      token,
      chatId,
      "Tugmalardan foydalaning yoki qidirish uchun matn yozing.\n\n/summary — bugungi xulosa\n/stock — qoldiq\n/debtors — qarzdorlar\n/staff — xodimlar",
      OWNER_MENU,
    );
    return;
  }
  if (text.startsWith("/")) {
    await sendMessage(token, chatId, "Bunday buyruq yo'q. /help — buyruqlar ro'yxati.", OWNER_MENU);
    return;
  }
  // Erkin matn — qidiruv
  await sendMessage(token, chatId, await search(db, companyId, text.slice(0, 60)), OWNER_MENU);
}

async function customerCommand(bot: BotRow, token: string, chatId: number, text: string, customerId: string | null) {
  const features = bot.features ?? {};
  if (!customerId) {
    await sendMessage(token, chatId, "Mijoz kartochkasi aniqlanmadi — /start bosing.");
    return;
  }
  const command = text.replace(/^\//, "").toLowerCase();

  if ((command === "history" || command === "xaridlar") && features.history) {
    await sendMessage(token, chatId, await customerHistory(customerId), customerMenu(bot));
    return;
  }
  if ((command === "debt" || command === "qarz") && features.history) {
    await sendMessage(token, chatId, await customerDebt(customerId), customerMenu(bot));
    return;
  }
  if (features.ordering && (await handleOrderFlow(bot, token, chatId, text, command))) return;
  await sendMessage(token, chatId, "Quyidagi tugmalardan foydalaning.", customerMenu(bot));
}

// ─── Botdan buyurtma berish ──────────────────────────────────────────────────

/** Savatdagi qator. */
type CartLine = { productId: string; name: string; price: string; quantity: string };
type OrderState = { step: "search" | "quantity"; productId?: string; name?: string; price?: string; cart: CartLine[] };

const money = (value: string | number | null) => new Intl.NumberFormat("uz-UZ").format(Math.round(Number(value ?? 0)));

function cartText(cart: CartLine[]) {
  const total = cart.reduce((sum, line) => sum + Number(line.price) * Number(line.quantity), 0);
  return [
    "<b>Savatingiz</b>",
    "",
    ...cart.map((line) => `${line.name} × ${Number(line.quantity)} — ${money(Number(line.price) * Number(line.quantity))} so'm`),
    "",
    `Jami: <b>${money(total)} so'm</b>`,
  ].join("\n");
}

const CART_MENU: ReplyMarkup = {
  inline_keyboard: [
    [
      { text: "➕ Yana qo'shish", callback_data: "order" },
      { text: "✅ Buyurtmani yuborish", callback_data: "order_send" },
    ],
    [{ text: "❌ Bekor qilish", callback_data: "order_cancel" }],
  ],
};

/**
 * Buyurtma oqimi. `true` qaytsa — xabar shu oqimda qayta ishlandi.
 * Holat suhbat qatorida (`telegram_chats.state`) saqlanadi: bot bir nechta nusxada ishlasa ham buzilmaydi.
 */
async function handleOrderFlow(bot: BotRow, token: string, chatId: number, text: string, command: string): Promise<boolean> {
  const chat = await withTransaction((tx) => touchChat(tx, bot.id, chatId));
  const state = (chat.state?.order as OrderState | undefined) ?? null;
  const companyId = bot.companyId;
  const customerId = chat.customerId;
  if (!companyId || !customerId) return false;

  const setState = (next: OrderState | null) => withTransaction((tx) => saveChatState(tx, chat.id, "order", next));

  if (command === "order") {
    await setState({ step: "search", cart: state?.cart ?? [] });
    await sendMessage(token, chatId, "Kerakli mahsulot nomini yozing (masalan: <i>shakar</i>).");
    return true;
  }

  if (command === "order_cancel") {
    await setState(null);
    await sendMessage(token, chatId, "Buyurtma bekor qilindi.", customerMenu(bot));
    return true;
  }

  if (command === "order_send") {
    if (!state || state.cart.length === 0) {
      await sendMessage(token, chatId, "Savat bo'sh.", customerMenu(bot));
      return true;
    }
    try {
      const order = await withTransaction((tx) =>
        createBotOrder(tx, companyId, customerId, state.cart.map((line) => ({ productId: line.productId, quantity: line.quantity }))),
      );
      await setState(null);
      await sendMessage(
        token,
        chatId,
        `Buyurtmangiz qabul qilindi — <b>${order.number}</b>.\n\nDo'kon xodimi tasdiqlab, siz bilan bog'lanadi.`,
        customerMenu(bot),
      );
      await notifyOwner(
        companyId,
        `<b>🛒 Botdan yangi buyurtma</b>\n\nHujjat: ${order.number}\nSumma: ${money(order.totalAmount)} so'm\n\nDasturda tasdiqlash kerak.`,
      );
    } catch (error) {
      logger.warn({ err: error, companyId }, "Botdan buyurtma yaratilmadi");
      await sendMessage(token, chatId, "Buyurtmani rasmiylashtirib bo'lmadi. Iltimos, do'kon bilan bog'laning.", customerMenu(bot));
    }
    return true;
  }

  if (command.startsWith("order_item_")) {
    const productId = command.slice("order_item_".length);
    const [product] = await searchBotProductById(companyId, productId);
    if (!product) {
      await sendMessage(token, chatId, "Mahsulot topilmadi.", customerMenu(bot));
      return true;
    }
    await setState({ step: "quantity", productId: product.id, name: product.name, price: product.price, cart: state?.cart ?? [] });
    await sendMessage(token, chatId, `<b>${product.name}</b> — ${money(product.price)} so'm.\n\nNechta kerak? Raqam yozing.`);
    return true;
  }

  if (!state) return false;

  if (state.step === "quantity") {
    const quantity = Number(text.replace(",", ".").trim());
    if (!Number.isFinite(quantity) || quantity <= 0) {
      await sendMessage(token, chatId, "Miqdorni raqam bilan yozing, masalan: 2");
      return true;
    }
    const cart = [
      ...state.cart,
      { productId: state.productId!, name: state.name!, price: state.price!, quantity: String(quantity) },
    ];
    await setState({ step: "search", cart });
    await sendMessage(token, chatId, cartText(cart), CART_MENU);
    return true;
  }

  // step === "search" — erkin matn qidiruv so'rovi
  const found = await searchBotProducts(db, companyId, text.slice(0, 60));
  if (found.length === 0) {
    await sendMessage(token, chatId, `"${text.slice(0, 60)}" topilmadi. Boshqa nom bilan urinib ko'ring.`);
    return true;
  }
  await sendMessage(token, chatId, "Mahsulotni tanlang:", {
    inline_keyboard: found.map((product) => [
      { text: `${product.name} — ${money(product.price)} so'm`, callback_data: `order_item_${product.id}` },
    ]),
  });
  return true;
}

/** Tanlangan mahsulot (tugma bosilganda id bo'yicha). */
async function searchBotProductById(companyId: string, productId: string) {
  return db
    .select({ id: products.id, name: products.name, price: products.salesPrice })
    .from(products)
    .where(and(eq(products.companyId, companyId), eq(products.id, productId), eq(products.isActive, true)))
    .limit(1);
}

/** Mijozning oxirgi xaridlari. */
async function customerHistory(customerId: string) {
  const rows = await db
    .select({
      number: salesOrders.number,
      date: salesOrders.orderDate,
      total: salesOrders.totalAmount,
      paid: salesOrders.paidAmount,
    })
    .from(salesOrders)
    .where(and(eq(salesOrders.customerId, customerId), sql`${salesOrders.status} <> 'cancelled'`))
    .orderBy(desc(salesOrders.orderDate), desc(salesOrders.createdAt))
    .limit(10);

  if (rows.length === 0) return "Hali xarid yo'q.";
  const lines = ["<b>Oxirgi xaridlaringiz</b>", ""];
  for (const row of rows) {
    const debt = Number(row.total) - Number(row.paid);
    lines.push(`${row.date} · ${money(row.total)} so'm${debt > 0 ? ` · qarz ${money(debt)} so'm` : " · to'langan"}`);
  }
  return lines.join("\n");
}

/** Mijozning joriy qarzi va keshbek balansi. */
async function customerDebt(customerId: string) {
  const [row] = await db
    .select({
      debt: sql<string>`coalesce(sum(${salesOrders.totalAmount} - ${salesOrders.paidAmount}), 0)::text`,
    })
    .from(salesOrders)
    .where(and(eq(salesOrders.customerId, customerId), sql`${salesOrders.totalAmount} > ${salesOrders.paidAmount}`, sql`${salesOrders.status} <> 'cancelled'`));

  const [card] = await db
    .select({ cashback: customers.cashbackBalance, name: customers.name })
    .from(customers)
    .where(eq(customers.id, customerId))
    .limit(1);

  const debt = Number(row?.debt ?? 0);
  const lines = [debt > 0 ? `Joriy qarzingiz: <b>${money(debt)} so'm</b>` : "Qarzingiz yo'q ✅"];
  if (card && Number(card.cashback) > 0) lines.push(`Keshbek balansi: ${money(card.cashback)} so'm`);
  return lines.join("\n");
}

