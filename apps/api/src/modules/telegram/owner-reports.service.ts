/**
 * Egalar boti uchun hisobotlar — FAQAT O'QISH.
 *
 * Har so'rov aniq bitta kompaniya bo'yicha (suhbat bog'langan biznes), shuning uchun
 * boshqa biznesning ma'lumoti chiqib ketmaydi.
 */
import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { cashAccounts } from "../../db/schema/finance.js";
import { products } from "../../db/schema/catalog.js";
import { stockLevels } from "../../db/schema/inventory.js";
import { customers, salesOrderItems, salesOrders } from "../../db/schema/sales.js";
import { agentVisits } from "../../db/schema/sales-agent.js";
import type { DbOrTx } from "../../db/transaction.js";

const money = (value: string | number | null) =>
  new Intl.NumberFormat("uz-UZ").format(Math.round(Number(value ?? 0)));

/** Kun chegaralari (server vaqti bo'yicha). */
function dayRange(date = new Date()) {
  const day = date.toISOString().slice(0, 10);
  const next = new Date(date.getTime() + 86_400_000).toISOString().slice(0, 10);
  return { day, next };
}

/** Bugungi savdo xulosasi: summa, chek soni, to'lov turlari, eng ko'p sotilganlar. */
export async function dailySummary(conn: DbOrTx, companyId: string, date = new Date()) {
  const { day, next } = dayRange(date);
  const notCancelled = sql`${salesOrders.status} <> 'cancelled'`;

  const [totals] = await conn
    .select({
      receipts: sql<string>`count(*)::text`,
      total: sql<string>`coalesce(sum(${salesOrders.totalAmount}), 0)::text`,
      paid: sql<string>`coalesce(sum(${salesOrders.paidAmount}), 0)::text`,
    })
    .from(salesOrders)
    .where(and(eq(salesOrders.companyId, companyId), gte(salesOrders.orderDate, day), lt(salesOrders.orderDate, next), notCancelled));

  const top = await conn
    .select({
      name: products.name,
      qty: sql<string>`sum(${salesOrderItems.quantity})::text`,
      amount: sql<string>`sum(${salesOrderItems.lineTotal})::text`,
    })
    .from(salesOrderItems)
    .innerJoin(salesOrders, eq(salesOrders.id, salesOrderItems.orderId))
    .innerJoin(products, eq(products.id, salesOrderItems.productId))
    .where(and(eq(salesOrders.companyId, companyId), gte(salesOrders.orderDate, day), lt(salesOrders.orderDate, next), notCancelled))
    .groupBy(products.name)
    .orderBy(desc(sql`sum(${salesOrderItems.lineTotal})`))
    .limit(5);

  const cash = await conn
    .select({ name: cashAccounts.name, balance: cashAccounts.balance })
    .from(cashAccounts)
    .where(and(eq(cashAccounts.companyId, companyId), eq(cashAccounts.isActive, true)))
    .orderBy(desc(cashAccounts.isDefault));

  const debt = Number(totals?.total ?? 0) - Number(totals?.paid ?? 0);

  const lines = [
    `<b>Kunlik xulosa — ${day}</b>`,
    ``,
    `Savdo: <b>${money(totals?.total ?? 0)} so'm</b> · ${totals?.receipts ?? 0} ta chek`,
    `To'landi: ${money(totals?.paid ?? 0)} so'm${debt > 0 ? ` · qarzga: ${money(debt)} so'm` : ""}`,
  ];

  if (top.length > 0) {
    lines.push("", "<b>Eng ko'p sotilganlar</b>");
    for (const [index, row] of top.entries()) {
      lines.push(`${index + 1}. ${row.name} — ${money(row.amount)} so'm (${Number(row.qty)} dona)`);
    }
  }
  if (cash.length > 0) {
    lines.push("", "<b>Kassa qoldiqlari</b>");
    for (const row of cash.slice(0, 6)) lines.push(`${row.name}: ${money(row.balance)} so'm`);
  }
  return lines.join("\n");
}

/** Qoldiq ogohlantirishi: tugagan va minimal darajadan past mahsulotlar. */
export async function stockAlert(conn: DbOrTx, companyId: string) {
  const rows = await conn
    .select({
      name: products.name,
      quantity: sql<string>`sum(${stockLevels.quantity})::text`,
      minStock: products.minStock,
    })
    .from(products)
    .leftJoin(stockLevels, eq(stockLevels.productId, products.id))
    .where(and(eq(products.companyId, companyId), eq(products.isActive, true)))
    .groupBy(products.id, products.name, products.minStock)
    .having(sql`coalesce(sum(${stockLevels.quantity}), 0) <= ${products.minStock}`)
    .orderBy(sql`coalesce(sum(${stockLevels.quantity}), 0)`)
    .limit(15);

  if (rows.length === 0) return "Qoldiq bo'yicha ogohlantirish yo'q — hamma mahsulot yetarli.";
  const lines = ["<b>Qoldiq kam yoki tugagan</b>", ""];
  for (const row of rows) {
    const qty = Number(row.quantity ?? 0);
    lines.push(`${qty <= 0 ? "❌" : "⚠️"} ${row.name} — ${qty} dona (minimal ${Number(row.minStock)})`);
  }
  return lines.join("\n");
}

/** Qarzdor mijozlar: eng katta qarzdan boshlab. */
export async function debtorsReport(conn: DbOrTx, companyId: string) {
  const rows = await conn
    .select({
      name: customers.name,
      phone: customers.phone,
      debt: sql<string>`sum(${salesOrders.totalAmount} - ${salesOrders.paidAmount})::text`,
    })
    .from(salesOrders)
    .innerJoin(customers, eq(customers.id, salesOrders.customerId))
    .where(and(eq(salesOrders.companyId, companyId), sql`${salesOrders.totalAmount} > ${salesOrders.paidAmount}`, sql`${salesOrders.status} <> 'cancelled'`))
    .groupBy(customers.id, customers.name, customers.phone)
    .orderBy(desc(sql`sum(${salesOrders.totalAmount} - ${salesOrders.paidAmount})`))
    .limit(10);

  if (rows.length === 0) return "Qarzdor mijoz yo'q.";
  const total = rows.reduce((sum, row) => sum + Number(row.debt), 0);
  const lines = [`<b>Qarzdorlar</b> — jami ${money(total)} so'm`, ""];
  for (const row of rows) lines.push(`${row.name}${row.phone ? ` (${row.phone})` : ""} — ${money(row.debt)} so'm`);
  return lines.join("\n");
}

/** Xodimlar faoliyati: bugungi tashriflar va yetkazuvchilardagi topshirilmagan naqd. */
export async function staffReport(conn: DbOrTx, companyId: string) {
  const { day, next } = dayRange();
  const visits = await conn
    .select({ count: sql<string>`count(*)::text` })
    .from(agentVisits)
    .where(and(eq(agentVisits.companyId, companyId), gte(agentVisits.visitDate, day), lt(agentVisits.visitDate, next), eq(agentVisits.status, "completed")));

  const onHand = await conn
    .select({ name: cashAccounts.name, balance: cashAccounts.balance })
    .from(cashAccounts)
    .where(and(eq(cashAccounts.companyId, companyId), sql`${cashAccounts.deliveryAgentId} is not null`, sql`${cashAccounts.balance} <> 0`));

  const lines = ["<b>Xodimlar</b>", "", `Bugungi bajarilgan tashriflar: ${visits[0]?.count ?? 0} ta`];
  if (onHand.length > 0) {
    lines.push("", "<b>Topshirilmagan naqd</b>");
    for (const row of onHand) lines.push(`${row.name}: ${money(row.balance)} so'm`);
  } else {
    lines.push("", "Topshirilmagan naqd yo'q.");
  }
  return lines.join("\n");
}

/** Mijoz yoki mahsulot qidirish (bot ichidagi erkin so'rov). */
export async function search(conn: DbOrTx, companyId: string, query: string) {
  const pattern = `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

  const foundCustomers = await conn
    .select({
      name: customers.name,
      phone: customers.phone,
      debt: sql<string>`coalesce((
        select sum(o.total_amount - o.paid_amount) from sales_orders o
        where o.customer_id = ${customers.id} and o.status <> 'cancelled' and o.total_amount > o.paid_amount
      ), 0)::text`,
    })
    .from(customers)
    .where(and(eq(customers.companyId, companyId), sql`(${customers.name} ilike ${pattern} or ${customers.phone} ilike ${pattern})`))
    .limit(5);

  const foundProducts = await conn
    .select({
      name: products.name,
      sku: products.sku,
      price: products.salesPrice,
      stock: sql<string>`coalesce((select sum(quantity) from stock_levels s where s.product_id = ${products.id}), 0)::text`,
    })
    .from(products)
    .where(and(eq(products.companyId, companyId), sql`(${products.name} ilike ${pattern} or ${products.sku} ilike ${pattern} or ${products.barcode} ilike ${pattern})`))
    .limit(5);

  if (foundCustomers.length === 0 && foundProducts.length === 0) return `"${query}" bo'yicha hech narsa topilmadi.`;

  const lines: string[] = [];
  if (foundCustomers.length > 0) {
    lines.push("<b>Mijozlar</b>");
    for (const row of foundCustomers) {
      const debt = Number(row.debt);
      lines.push(`${row.name}${row.phone ? ` · ${row.phone}` : ""}${debt > 0 ? ` · qarz ${money(debt)} so'm` : ""}`);
    }
  }
  if (foundProducts.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push("<b>Mahsulotlar</b>");
    for (const row of foundProducts) {
      lines.push(`${row.name} (${row.sku}) — ${money(row.price)} so'm · qoldiq ${Number(row.stock)}`);
    }
  }
  return lines.join("\n");
}
