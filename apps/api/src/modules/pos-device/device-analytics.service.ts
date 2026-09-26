/**
 * Desktop kassa analitikasi (internet bilan, `analytics.view`).
 *
 *  - qurilma omboridagi savdo (barcha kassalar va web): tushum, qaytarish, cheklar, kunlar, kassirlar, to'lov turlari;
 *    tannarx — sotuv lahzasidagi AVCO (`sales_order_items.cost_price`), qaytarishda — qaytarish yozuvidagi tannarx
 *  - to'liq qaytarilgan chek (`returned`) qaytarish yozuvi bo'lsa tushumda qoladi va qaytarish sifatida ayriladi
 *    (ikki marta ayirilmaydi)
 *  - qurilma ombori: xaridlar, qoldiq qiymati, sotilmayotgan mahsulotlar, kategoriya bo'yicha tannarx
 *  - kompaniya bo'yicha: xarajatlar, kirim-chiqim (kassa/bank tranzaksiyalari, asosiy valyutada), mijoz va ta'minotchi
 *    qarzlari
 * Sanalar — UTC kun (`order_date` bilan bir xil).
 */
import { and, asc, desc, eq, gt, gte, inArray, lt, lte, ne, notInArray, sql } from "drizzle-orm";
import { categories, products } from "../../db/schema/catalog.js";
import { cashTransactions, expenses } from "../../db/schema/finance.js";
import { stockLevels } from "../../db/schema/inventory.js";
import { users } from "../../db/schema/platform.js";
import { purchaseOrders, suppliers } from "../../db/schema/purchase.js";
import { customers, posShifts, salesOrderItems, salesOrders, salesReturnItems, salesReturns } from "../../db/schema/sales.js";
import type { DbOrTx } from "../../db/transaction.js";
import { fromMinor, mulDivRound, rescale, toMinor } from "../../shared/decimal.js";
import type { DeviceContext } from "./device-auth.js";

const MONEY_SUM = (column: unknown) => sql<string>`coalesce(sum(${column}), 0)::text`;
const minor = (value: string | null | undefined) => toMinor(value ?? "0");
const qtyMinor = (value: string | null | undefined) => toMinor(value ?? "0", 4);

/** Ishorali qiymat matni (2 kasr). */
const signed = (value: bigint) => (value < 0n ? `-${fromMinor(-value)}` : fromMinor(value));
const signedQty = (value: bigint) => (value < 0n ? `-${fromMinor(-value, 4)}` : fromMinor(value, 4));
const moneyText = (text: string) => signed(text.startsWith("-") ? -toMinor(text.slice(1)) : toMinor(text));

function percentOf(part: bigint, whole: bigint): string | null {
  if (whole <= 0n) return null;
  const value = mulDivRound(part < 0n ? -part : part, 10_000n, whole);
  return part < 0n ? `-${fromMinor(value)}` : fromMinor(value);
}

const CASH_FLOW_LABELS: Record<string, string> = {
  sales_order: "Savdo tushumi",
  pos_sale: "Kassa savdosi",
  pos_shift: "Kassa smenasi",
  customer_payment: "Mijozlar to'lovi",
  customer_balance: "Mijoz balansi",
  supplier_payment: "Ta'minotchilarga to'lov",
  purchase_return: "Ta'minotchi qaytargan pul",
  sales_return: "Mijozga qaytarilgan pul",
  expense: "Xarajatlar",
  salary_payment: "Ish haqi",
  pos_cash_movement: "Kassa kirim-chiqimi",
  other: "Boshqa",
};

type BalanceRow = { id: string; name: string; phone: string | null; amount: string };

function balanceGroup(totals: { total: string; count: number } | undefined, rows: BalanceRow[]) {
  return {
    total: moneyText(totals?.total ?? "0"),
    count: totals?.count ?? 0,
    top: rows.map((row) => ({ ...row, amount: moneyText(row.amount) })),
  };
}

export async function deviceAnalytics(conn: DbOrTx, context: DeviceContext, range: { from: string; to: string }) {
  const companyId = context.company.id;
  const warehouseId = context.device.warehouseId;

  const counted = sql`(${salesOrders.status} in ('completed', 'shipped', 'delivered') or (${salesOrders.status} = 'returned' and exists (select 1 from ${salesReturns} sr where sr.order_id = ${salesOrders.id})))`;
  const orderScope = and(
    eq(salesOrders.companyId, companyId),
    eq(salesOrders.warehouseId, warehouseId),
    gte(salesOrders.orderDate, range.from),
    lte(salesOrders.orderDate, range.to),
    counted,
  );
  const returnDay = sql<string>`to_char(${salesReturns.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`;
  const returnScope = and(eq(salesReturns.companyId, companyId), eq(salesOrders.warehouseId, warehouseId), sql`${returnDay} between ${range.from} and ${range.to}`);

  // ─── Savdo ───────────────────────────────────────────────────────────────
  const orderDays = await conn
    .select({
      date: salesOrders.orderDate,
      receipts: sql<number>`count(*)::int`,
      revenue: MONEY_SUM(salesOrders.totalAmount),
      debt: sql<string>`coalesce(sum(greatest(${salesOrders.totalAmount} - ${salesOrders.paidAmount}, 0)), 0)::text`,
      webPaid: sql<string>`coalesce(sum(${salesOrders.paidAmount}) filter (where not ${salesOrders.isPos}), 0)::text`,
    })
    .from(salesOrders)
    .where(orderScope)
    .groupBy(salesOrders.orderDate);
  const itemDays = await conn
    .select({
      date: salesOrders.orderDate,
      cogs: sql<string>`coalesce(sum(round(${salesOrderItems.quantity} * ${salesOrderItems.costPrice}, 2)), 0)::text`,
      quantity: MONEY_SUM(salesOrderItems.quantity),
    })
    .from(salesOrderItems)
    .innerJoin(salesOrders, eq(salesOrders.id, salesOrderItems.orderId))
    .where(orderScope)
    .groupBy(salesOrders.orderDate);
  const returnDays = await conn
    .select({ date: returnDay, total: MONEY_SUM(salesReturns.totalAmount), cogs: MONEY_SUM(salesReturns.cogs) })
    .from(salesReturns)
    .innerJoin(salesOrders, eq(salesOrders.id, salesReturns.orderId))
    .where(returnScope)
    .groupBy(returnDay);

  const days = new Map<string, { revenue: bigint; returns: bigint; cogs: bigint; receipts: number }>();
  const dayAcc = (date: string) => {
    let acc = days.get(date);
    if (!acc) days.set(date, (acc = { revenue: 0n, returns: 0n, cogs: 0n, receipts: 0 }));
    return acc;
  };
  let revenue = 0n;
  let receipts = 0;
  let debt = 0n;
  let webPaid = 0n;
  for (const row of orderDays) {
    const acc = dayAcc(row.date);
    acc.revenue += minor(row.revenue);
    acc.receipts += row.receipts;
    revenue += minor(row.revenue);
    receipts += row.receipts;
    debt += minor(row.debt);
    webPaid += minor(row.webPaid);
  }
  let cogs = 0n;
  for (const row of itemDays) {
    dayAcc(row.date).cogs += minor(row.cogs);
    cogs += minor(row.cogs);
  }
  let returned = 0n;
  for (const row of returnDays) {
    const acc = dayAcc(row.date);
    acc.returns += minor(row.total);
    acc.cogs -= minor(row.cogs);
    returned += minor(row.total);
    cogs -= minor(row.cogs);
  }

  // ─── Mahsulotlar ─────────────────────────────────────────────────────────
  const soldProducts = await conn
    .select({
      productId: salesOrderItems.productId,
      quantity: MONEY_SUM(salesOrderItems.quantity),
      revenue: MONEY_SUM(salesOrderItems.lineTotal),
      cogs: sql<string>`coalesce(sum(round(${salesOrderItems.quantity} * ${salesOrderItems.costPrice}, 2)), 0)::text`,
    })
    .from(salesOrderItems)
    .innerJoin(salesOrders, eq(salesOrders.id, salesOrderItems.orderId))
    .where(orderScope)
    .groupBy(salesOrderItems.productId);
  const returnedProducts = await conn
    .select({
      productId: salesReturnItems.productId,
      quantity: MONEY_SUM(salesReturnItems.quantity),
      revenue: MONEY_SUM(salesReturnItems.lineTotal),
      cogs: MONEY_SUM(salesReturnItems.cogs),
    })
    .from(salesReturnItems)
    .innerJoin(salesReturns, eq(salesReturns.id, salesReturnItems.returnId))
    .innerJoin(salesOrders, eq(salesOrders.id, salesReturns.orderId))
    .where(returnScope)
    .groupBy(salesReturnItems.productId);

  const byProduct = new Map<string, { quantity: bigint; revenue: bigint; cogs: bigint }>();
  for (const [rows, sign] of [
    [soldProducts, 1n],
    [returnedProducts, -1n],
  ] as const) {
    for (const row of rows) {
      const acc = byProduct.get(row.productId) ?? { quantity: 0n, revenue: 0n, cogs: 0n };
      acc.quantity += sign * qtyMinor(row.quantity);
      acc.revenue += sign * minor(row.revenue);
      acc.cogs += sign * minor(row.cogs);
      byProduct.set(row.productId, acc);
    }
  }
  const items = [...byProduct.values()].reduce((sum, acc) => sum + acc.quantity, 0n);

  const stockRows = await conn
    .select({ productId: stockLevels.productId, quantity: stockLevels.quantity, avgCostPrice: stockLevels.avgCostPrice })
    .from(stockLevels)
    .where(and(eq(stockLevels.companyId, companyId), eq(stockLevels.warehouseId, warehouseId), gt(stockLevels.quantity, "0")));
  const productIds = [...new Set([...byProduct.keys(), ...stockRows.map((row) => row.productId)])];
  const productInfo = new Map(
    (productIds.length > 0
      ? await conn
          .select({ id: products.id, name: products.name, sku: products.sku, categoryId: products.categoryId, isActive: products.isActive })
          .from(products)
          .where(and(eq(products.companyId, companyId), inArray(products.id, productIds)))
      : []
    ).map((row) => [row.id, row]),
  );
  const stockValueOf = (row: { quantity: string; avgCostPrice: string }) => rescale(qtyMinor(row.quantity) * toMinor(row.avgCostPrice, 4), 8, 2);
  const stockValue = stockRows.reduce((sum, row) => sum + stockValueOf(row), 0n);

  const top = [...byProduct.entries()]
    .sort(([, a], [, b]) => (b.revenue > a.revenue ? 1 : b.revenue < a.revenue ? -1 : 0))
    .slice(0, 20)
    .map(([productId, acc]) => ({
      productId,
      name: productInfo.get(productId)?.name ?? "—",
      sku: productInfo.get(productId)?.sku ?? "",
      quantity: signedQty(acc.quantity),
      revenue: signed(acc.revenue),
      cogs: signed(acc.cogs),
      profit: signed(acc.revenue - acc.cogs),
    }));
  const slow = stockRows
    .filter((row) => !byProduct.has(row.productId) && productInfo.get(row.productId)?.isActive)
    .map((row) => ({ row, value: stockValueOf(row) }))
    .sort((a, b) => (b.value > a.value ? 1 : b.value < a.value ? -1 : 0))
    .slice(0, 20)
    .map(({ row, value }) => ({
      productId: row.productId,
      name: productInfo.get(row.productId)!.name,
      sku: productInfo.get(row.productId)!.sku,
      stock: signedQty(qtyMinor(row.quantity)),
      value: signed(value),
    }));

  const categoryNames = new Map(
    (await conn.select({ id: categories.id, name: categories.name }).from(categories).where(eq(categories.companyId, companyId))).map((row) => [row.id, row.name]),
  );
  const byCategory = new Map<string, { soldQty: bigint; revenue: bigint; cogs: bigint; stockQty: bigint; stockValue: bigint }>();
  const categoryAcc = (productId: string) => {
    const key = productInfo.get(productId)?.categoryId ?? "";
    let acc = byCategory.get(key);
    if (!acc) byCategory.set(key, (acc = { soldQty: 0n, revenue: 0n, cogs: 0n, stockQty: 0n, stockValue: 0n }));
    return acc;
  };
  for (const [productId, acc] of byProduct) {
    const category = categoryAcc(productId);
    category.soldQty += acc.quantity;
    category.revenue += acc.revenue;
    category.cogs += acc.cogs;
  }
  for (const row of stockRows) {
    const category = categoryAcc(row.productId);
    category.stockQty += qtyMinor(row.quantity);
    category.stockValue += stockValueOf(row);
  }
  const categoryStats = [...byCategory.entries()]
    .map(([key, acc]) => ({
      categoryId: key || null,
      name: key ? (categoryNames.get(key) ?? "—") : "Kategoriyasiz",
      soldQty: signedQty(acc.soldQty),
      revenue: signed(acc.revenue),
      cogs: signed(acc.cogs),
      profit: signed(acc.revenue - acc.cogs),
      stockQty: signedQty(acc.stockQty),
      stockValue: signed(acc.stockValue),
      order: acc.stockValue + acc.revenue,
    }))
    .sort((a, b) => (b.order > a.order ? 1 : b.order < a.order ? -1 : 0))
    .map(({ order: _order, ...row }) => row);

  // ─── To'lovlar, kassirlar, xarid, xarajat ────────────────────────────────
  const shiftDay = sql<string>`to_char(${posShifts.openedAt} at time zone 'UTC', 'YYYY-MM-DD')`;
  const [shiftTotals] = await conn
    .select({ cash: MONEY_SUM(posShifts.totalCash), card: MONEY_SUM(posShifts.totalCard) })
    .from(posShifts)
    .where(and(eq(posShifts.companyId, companyId), eq(posShifts.warehouseId, warehouseId), sql`${shiftDay} between ${range.from} and ${range.to}`));
  const payments = [
    { key: "cash", label: "Naqd (kassa smenalari, qaytarishdan keyin)", amount: minor(shiftTotals?.cash) },
    { key: "card", label: "Karta (kassa smenalari)", amount: minor(shiftTotals?.card) },
    { key: "web", label: "Web savdo to'lovlari", amount: webPaid },
    { key: "debt", label: "Qarzga", amount: debt },
  ]
    .filter((line) => line.amount !== 0n)
    .sort((a, b) => (b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : 0))
    .map((line) => ({ ...line, amount: signed(line.amount) }));

  const cashiers = (
    await conn
      .select({ name: users.name, receipts: sql<number>`count(*)::int`, revenue: MONEY_SUM(salesOrders.totalAmount) })
      .from(salesOrders)
      .leftJoin(users, eq(users.id, salesOrders.createdBy))
      .where(orderScope)
      .groupBy(users.name)
  )
    .map((row) => ({ name: row.name ?? "—", receipts: row.receipts, revenue: moneyText(row.revenue) }))
    .sort((a, b) => b.receipts - a.receipts);

  const [purchaseTotal] = await conn
    .select({ total: MONEY_SUM(purchaseOrders.totalAmount) })
    .from(purchaseOrders)
    .where(
      and(
        eq(purchaseOrders.companyId, companyId),
        eq(purchaseOrders.warehouseId, warehouseId),
        notInArray(purchaseOrders.status, ["draft", "cancelled"]),
        gte(purchaseOrders.orderDate, range.from),
        lte(purchaseOrders.orderDate, range.to),
      ),
    );
  const [expenseTotal] = await conn
    .select({ total: MONEY_SUM(expenses.amount) })
    .from(expenses)
    .where(and(eq(expenses.companyId, companyId), ne(expenses.status, "pending"), ne(expenses.status, "reversed"), gte(expenses.expenseDate, range.from), lte(expenses.expenseDate, range.to)));

  // ─── Kirim-chiqim (kompaniya kassa va bank hisoblari) ────────────────────
  const flowKey = sql<string>`coalesce(${cashTransactions.referenceType}, 'other')`;
  const flows = await conn
    .select({ type: cashTransactions.type, key: flowKey, amount: MONEY_SUM(cashTransactions.amount) })
    .from(cashTransactions)
    .where(
      and(
        eq(cashTransactions.companyId, companyId),
        eq(cashTransactions.currency, context.company.currency),
        inArray(cashTransactions.type, ["in", "out"]),
        gte(cashTransactions.txDate, range.from),
        lte(cashTransactions.txDate, range.to),
      ),
    )
    .groupBy(cashTransactions.type, flowKey);
  const flowLines = (type: "in" | "out") =>
    flows
      .filter((row) => row.type === type)
      .map((row) => ({ key: row.key, label: CASH_FLOW_LABELS[row.key] ?? row.key, amount: minor(row.amount) }))
      .sort((a, b) => (b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : 0));
  const income = flowLines("in");
  const expense = flowLines("out");
  const totalIncome = income.reduce((sum, line) => sum + line.amount, 0n);
  const totalExpense = expense.reduce((sum, line) => sum + line.amount, 0n);

  // ─── Qarzdorlik va haqdorlik ─────────────────────────────────────────────
  const partyTotals = async (table: typeof customers | typeof suppliers, amount: ReturnType<typeof sql<string>>, condition: ReturnType<typeof and>) =>
    (await conn.select({ total: sql<string>`coalesce(sum(${amount}), 0)::text`, count: sql<number>`count(*)::int` }).from(table).where(condition))[0];

  const debtorCondition = and(eq(customers.companyId, companyId), gt(customers.totalDebt, "0"));
  const debtors = await conn
    .select({ id: customers.id, name: customers.name, phone: customers.phone, amount: sql<string>`${customers.totalDebt}::text` })
    .from(customers)
    .where(debtorCondition)
    .orderBy(desc(customers.totalDebt))
    .limit(10);
  const prepaidCondition = and(eq(customers.companyId, companyId), gt(customers.balance, "0"));
  const prepaid = await conn
    .select({ id: customers.id, name: customers.name, phone: customers.phone, amount: sql<string>`${customers.balance}::text` })
    .from(customers)
    .where(prepaidCondition)
    .orderBy(desc(customers.balance))
    .limit(10);
  const creditorCondition = and(eq(suppliers.companyId, companyId), gt(suppliers.totalDebt, "0"));
  const creditors = await conn
    .select({ id: suppliers.id, name: suppliers.name, phone: suppliers.phone, amount: sql<string>`${suppliers.totalDebt}::text` })
    .from(suppliers)
    .where(creditorCondition)
    .orderBy(desc(suppliers.totalDebt))
    .limit(10);
  const advanceCondition = and(eq(suppliers.companyId, companyId), lt(suppliers.totalDebt, "0"));
  const advances = await conn
    .select({ id: suppliers.id, name: suppliers.name, phone: suppliers.phone, amount: sql<string>`(-${suppliers.totalDebt})::text` })
    .from(suppliers)
    .where(advanceCondition)
    .orderBy(asc(suppliers.totalDebt))
    .limit(10);
  const [customerCount] = await conn
    .select({ count: sql<number>`count(*)::int` })
    .from(customers)
    .where(and(eq(customers.companyId, companyId), eq(customers.isActive, true)));

  const netRevenue = revenue - returned;
  const grossProfit = netRevenue - cogs;
  return {
    period: range,
    generatedAt: new Date().toISOString(),
    scope: `Ombor: ${context.device.warehouseName} — barcha kassalar va web; xarajat, kirim-chiqim va qarzlar — kompaniya bo'yicha`,
    kpis: {
      revenue: signed(revenue),
      returns: signed(returned),
      netRevenue: signed(netRevenue),
      cogs: signed(cogs),
      grossProfit: signed(grossProfit),
      margin: percentOf(grossProfit, netRevenue),
      receipts,
      averageReceipt: signed(receipts > 0 ? netRevenue / BigInt(receipts) : 0n),
      itemsSold: signedQty(items),
      purchases: moneyText(purchaseTotal?.total ?? "0"),
      expenses: moneyText(expenseTotal?.total ?? "0"),
      stockValue: signed(stockValue),
      customers: customerCount?.count ?? 0,
    },
    daily: [...days.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, acc]) => ({ date, revenue: signed(acc.revenue), returns: signed(acc.returns), profit: signed(acc.revenue - acc.returns - acc.cogs), receipts: acc.receipts })),
    payments,
    cashiers,
    cashFlow: {
      income: income.map((line) => ({ ...line, amount: signed(line.amount) })),
      expense: expense.map((line) => ({ ...line, amount: signed(line.amount) })),
      totalIncome: signed(totalIncome),
      totalExpense: signed(totalExpense),
      net: signed(totalIncome - totalExpense),
    },
    receivables: balanceGroup(await partyTotals(customers, sql<string>`${customers.totalDebt}`, debtorCondition), debtors),
    customerBalances: balanceGroup(await partyTotals(customers, sql<string>`${customers.balance}`, prepaidCondition), prepaid),
    payables: balanceGroup(await partyTotals(suppliers, sql<string>`${suppliers.totalDebt}`, creditorCondition), creditors),
    supplierAdvances: balanceGroup(await partyTotals(suppliers, sql<string>`-${suppliers.totalDebt}`, advanceCondition), advances),
    products: { top, slow },
    categories: categoryStats,
  };
}
