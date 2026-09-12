/**
 * Chekdagi mahsulotlarni qisman qaytarish (desktop kassa va web).
 *
 * Har qaytarish — `sales_returns` hujjati (qatorlari bilan), bitta tranzaksiyada:
 *  - zaxira sotuvdagi tannarxda qaytadi (qator tannarxining ulushi), `sales_order_items.returned_qty` oshadi
 *  - jurnal: DR sotuv daromadi / CR debitorlar (qaytarilgan summa), DR tovar zaxirasi / CR tovar tannarxi
 *  - mijoz qarzi qaytarilgan summaga kamayadi; pul faqat to'langani qaytarishdan keyingi chek summasidan oshsa qaytadi
 *    (qarzga olingan tovar qaytsa — avval qarz yopiladi)
 *  - qaytadigan pul to'lov manbalariga ulush bo'yicha: balansdan to'langan qismi balansga, keshbekdan — keshbekka,
 *    qolgani tanlangan usulda (naqd/karta — kassa yoki bankdan, yoki mijoz balansiga); shu chekdan berilgan
 *    keshbekning ulushi bekor qilinadi
 *  - kassa smenasi: qaytarishlar yig'indisi oshadi, qaytgan naqd/karta tushumdan ayriladi
 * Oxirgi qoldiq aynan qolgan summa bilan qaytadi (ulushlarni yaxlitlash qoldig'isiz). Hamma qatorlar qaytsa — `returned`.
 * Chet valyutada to'langan chekda pul asosiy valyutada qaytadi.
 */
import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { badRequest, notFound } from "@bum/shared";
import { products } from "../../db/schema/catalog.js";
import {
  customerCashbackTransactions,
  customerPayments,
  customers,
  posShifts,
  salesOrderItems,
  salesOrders,
  salesReturnItems,
  salesReturns,
} from "../../db/schema/sales.js";
import type { Tx } from "../../db/transaction.js";
import type { RequestMeta } from "../../shared/audit.js";
import { fromMinor, mulDivRound, rescale, toMinor } from "../../shared/decimal.js";
import { nextDocumentNumber } from "../../shared/numbering.js";
import { assertProductsInScope } from "../catalog/category-scope.js";
import { unitFactorToBase } from "../catalog/conversions.js";
import type { TenantContext } from "../company/tenant.js";
import { ledgerAccountFor, recordCashTransaction, resolvePaymentAccount, todayIso } from "../finance/cash.service.js";
import { postJournalEntry, requireAccountBySubtype } from "../finance/journal.service.js";
import { moveStock } from "../inventory/stock.service.js";
import { assertWarehouseAccess } from "../inventory/warehouses.service.js";
import { reverseCashback } from "./cashback.service.js";
import { refundToBalance } from "./customer-balance.service.js";
import { salesAudit } from "./customers.service.js";
import { getOrder } from "./orders.service.js";

export const REFUND_METHODS = ["cash", "card", "balance"] as const;
export type RefundMethod = (typeof REFUND_METHODS)[number];

export type ReturnItemsInput = {
  items: { orderItemId: string; quantity: string }[];
  refundMethod: RefundMethod;
  reason?: string | null;
  /** Pul qaytaradigan ochiq kassa smenasi; web'da berilmasa — asosiy kassa yoki bankdan, smenaga yozilmaydi. */
  shiftId?: string | null;
  /** Desktop kassa sinxroni: qurilmadagi ID, raqam, vaqt va qurilma. */
  offline?: { id: string; number: string; returnedAt: Date; deviceId: string };
};

const minBig = (a: bigint, b: bigint) => (a < b ? a : b);
const positive = (value: bigint) => (value > 0n ? value : 0n);
const sumMoney = (column: AnyPgColumn) => sql<string>`coalesce(sum(${column}), 0)::numeric(18,2)`;

export async function returnSaleItems(tx: Tx, tenant: TenantContext, orderId: string, input: ReturnItemsInput, meta: RequestMeta) {
  const companyId = tenant.company.id;
  const offline = input.offline;

  const [order] = await tx
    .select({
      id: salesOrders.id,
      number: salesOrders.number,
      status: salesOrders.status,
      customerId: salesOrders.customerId,
      warehouseId: salesOrders.warehouseId,
      totalAmount: salesOrders.totalAmount,
      paidAmount: salesOrders.paidAmount,
    })
    .from(salesOrders)
    .where(and(eq(salesOrders.id, orderId), eq(salesOrders.companyId, companyId)))
    .limit(1)
    .for("update");
  if (!order) throw notFound("Chek topilmadi");
  if (order.status !== "shipped" && order.status !== "delivered") throw badRequest("Faqat yakunlangan chekdagi mahsulot qaytariladi");
  assertWarehouseAccess(tenant, order.warehouseId);

  const ids = input.items.map((item) => item.orderItemId);
  if (ids.length === 0) throw badRequest("Qaytariladigan mahsulotni tanlang");
  if (new Set(ids).size !== ids.length) throw badRequest("Mahsulot qatori takrorlangan");
  if (input.refundMethod === "balance" && !order.customerId) throw badRequest("Balansga qaytarish uchun chekda mijoz bo'lishi kerak");

  const allItems = await tx
    .select({
      id: salesOrderItems.id,
      productId: salesOrderItems.productId,
      unitId: salesOrderItems.unitId,
      quantity: salesOrderItems.quantity,
      returnedQty: salesOrderItems.returnedQty,
      lineTotal: salesOrderItems.lineTotal,
      costPrice: salesOrderItems.costPrice,
    })
    .from(salesOrderItems)
    .where(eq(salesOrderItems.orderId, orderId))
    .for("update");
  const rowById = new Map(allItems.map((row) => [row.id, row]));
  if (ids.some((id) => !rowById.has(id))) throw badRequest("Chekda bunday mahsulot qatori yo'q");
  const rows = ids.map((id) => rowById.get(id)!);
  await assertProductsInScope(tx, tenant, rows.map((row) => row.productId));

  const productRows = await tx
    .select({ id: products.id, name: products.name, baseUnitId: products.baseUnitId })
    .from(products)
    .where(inArray(products.id, [...new Set(rows.map((row) => row.productId))]));
  const productById = new Map(productRows.map((product) => [product.id, product]));

  let shift: { id: string } | null = null;
  if (input.shiftId) {
    const [row] = await tx
      .select({ id: posShifts.id, status: posShifts.status, deviceId: posShifts.deviceId })
      .from(posShifts)
      .where(and(eq(posShifts.id, input.shiftId), eq(posShifts.companyId, companyId)))
      .limit(1)
      .for("update");
    if (!row || (row.deviceId ?? null) !== (offline?.deviceId ?? null)) throw notFound("Smena topilmadi");
    // Offline qaytarish smena yopilishidan oldin qurilmada bo'lgan
    if (row.status !== "open" && !offline) throw badRequest("Smena yopilgan");
    shift = row;
  }

  // Oldingi qaytarishlar: qator bo'yicha summa va tannarx, hujjat bo'yicha qaytgan manbalar
  const previousRows = await tx
    .select({
      orderItemId: salesReturnItems.orderItemId,
      lineTotal: sumMoney(salesReturnItems.lineTotal),
      cogs: sumMoney(salesReturnItems.cogs),
    })
    .from(salesReturnItems)
    .where(inArray(salesReturnItems.orderItemId, ids))
    .groupBy(salesReturnItems.orderItemId);
  const previous = new Map(previousRows.map((row) => [row.orderItemId, { lineTotal: toMinor(row.lineTotal), cogs: toMinor(row.cogs) }]));

  const lines = input.items.map((request) => {
    const row = rowById.get(request.orderItemId)!;
    const product = productById.get(row.productId)!;
    const quantity = toMinor(row.quantity, 4);
    const remaining = quantity - toMinor(row.returnedQty, 4);
    const qty = toMinor(request.quantity, 4);
    if (qty <= 0n) throw badRequest("Miqdor musbat bo'lishi kerak");
    if (qty > remaining) throw badRequest(`${product.name}: qaytarish miqdori qolganidan ko'p (qolgan ${fromMinor(remaining, 4)})`);
    const before = previous.get(row.id) ?? { lineTotal: 0n, cogs: 0n };
    const lineCogs = rescale(quantity * toMinor(row.costPrice, 4), 8, 2);
    const last = qty === remaining;
    return {
      row,
      product,
      qty,
      value: last ? positive(toMinor(row.lineTotal) - before.lineTotal) : mulDivRound(toMinor(row.lineTotal), qty, quantity),
      cogs: last ? positive(lineCogs - before.cogs) : mulDivRound(lineCogs, qty, quantity),
    };
  });
  const totalValue = lines.reduce((sum, line) => sum + line.value, 0n);
  const totalCogs = lines.reduce((sum, line) => sum + line.cogs, 0n);
  const requestedById = new Map(lines.map((line) => [line.row.id, line.qty]));
  const allReturned = allItems.every(
    (item) => toMinor(item.returnedQty, 4) + (requestedById.get(item.id) ?? 0n) === toMinor(item.quantity, 4),
  );

  const date = offline ? offline.returnedAt.toISOString().slice(0, 10) : todayIso();
  const returnId = offline?.id ?? randomUUID();
  const number =
    offline?.number ??
    (await nextDocumentNumber(tx, {
      table: salesReturns,
      column: salesReturns.number,
      companyColumn: salesReturns.companyId,
      companyId,
      prefix: `QR-${date.slice(0, 4)}-`,
      width: 4,
    }));

  const [done] = await tx
    .select({
      returned: sumMoney(salesReturns.totalAmount),
      balance: sumMoney(salesReturns.balanceRestored),
      cashback: sumMoney(salesReturns.cashbackRestored),
      reversed: sumMoney(salesReturns.cashbackReversed),
    })
    .from(salesReturns)
    .where(eq(salesReturns.orderId, orderId));

  // Pul: to'langani qaytarishdan keyingi chek summasidan oshgan qismi, qaytarilgan summadan ko'p emas
  const orderTotal = toMinor(order.totalAmount);
  const netAfter = orderTotal - toMinor(done!.returned) - totalValue;
  const paid = toMinor(order.paidAmount);
  const refund = minBig(totalValue, positive(paid - netAfter));

  // To'lov manbalari ulushi: balans va keshbekdan to'langanining hali qaytmagan qismi
  const [sources] = order.customerId
    ? await tx
        .select({
          balance: sql<string>`coalesce(sum(${customerPayments.amount}) filter (where ${customerPayments.method} = 'balance'), 0)::numeric(18,2)`,
          cashback: sql<string>`coalesce(sum(${customerPayments.amount}) filter (where ${customerPayments.method} = 'cashback'), 0)::numeric(18,2)`,
        })
        .from(customerPayments)
        .where(eq(customerPayments.orderId, orderId))
    : [{ balance: "0", cashback: "0" }];
  const balanceLeft = positive(toMinor(sources!.balance) - toMinor(done!.balance));
  const cashbackLeft = positive(toMinor(sources!.cashback) - toMinor(done!.cashback));
  const balanceBack = paid > 0n ? minBig(balanceLeft, mulDivRound(balanceLeft, refund, paid)) : 0n;
  const cashbackBack = paid > 0n ? minBig(cashbackLeft, mulDivRound(cashbackLeft, refund, paid)) : 0n;
  const money = refund - balanceBack - cashbackBack;

  // Shu chekdan berilgan keshbekning ulushi (oxirgi qaytarishda — qolgani)
  let reverse = 0n;
  if (order.customerId) {
    const [earnedRow] = await tx
      .select({ total: sumMoney(customerCashbackTransactions.amount) })
      .from(customerCashbackTransactions)
      .where(and(eq(customerCashbackTransactions.orderId, orderId), eq(customerCashbackTransactions.type, "earn")));
    const left = positive(toMinor(earnedRow!.total) - toMinor(done!.reversed));
    reverse = allReturned ? left : orderTotal > 0n ? minBig(left, mulDivRound(toMinor(earnedRow!.total), totalValue, orderTotal)) : 0n;
  }

  await tx.insert(salesReturns).values({
    id: returnId,
    companyId,
    orderId,
    number,
    posShiftId: shift?.id ?? null,
    deviceId: offline?.deviceId ?? null,
    totalAmount: fromMinor(totalValue),
    cogs: fromMinor(totalCogs),
    refundMethod: input.refundMethod,
    reason: input.reason ?? null,
    createdBy: tenant.user.id,
    ...(offline ? { createdAt: offline.returnedAt } : {}),
  });

  for (const line of lines) {
    await tx.insert(salesReturnItems).values({
      companyId,
      returnId,
      orderItemId: line.row.id,
      productId: line.row.productId,
      quantity: fromMinor(line.qty, 4),
      lineTotal: fromMinor(line.value),
      cogs: fromMinor(line.cogs),
    });
    const factor = toMinor(await unitFactorToBase(tx, companyId, line.product, line.row.unitId), 4);
    const baseQty = rescale(line.qty * factor, 8, 4);
    await moveStock(tx, companyId, tenant.user.id, {
      type: "return_in",
      productId: line.row.productId,
      warehouseId: order.warehouseId,
      quantity: fromMinor(baseQty, 4),
      costPrice: fromMinor(mulDivRound(line.cogs, 1_000_000n, baseQty), 4),
      referenceType: "sales_return",
      referenceId: returnId,
      notes: `Qaytarish: ${number} (${order.number})`,
      occurredAt: offline?.returnedAt,
    });
    await tx
      .update(salesOrderItems)
      .set({ returnedQty: sql`${salesOrderItems.returnedQty} + ${fromMinor(line.qty, 4)}::numeric`, updatedAt: new Date() })
      .where(eq(salesOrderItems.id, line.row.id));
  }

  const journal: { accountId: string; debit?: string; credit?: string }[] = [];
  if (totalValue > 0n) {
    journal.push(
      { accountId: await requireAccountBySubtype(tx, companyId, "sales", "income", "Sotuv daromadi"), debit: fromMinor(totalValue) },
      { accountId: await requireAccountBySubtype(tx, companyId, "receivable", "asset", "Debitorlar"), credit: fromMinor(totalValue) },
    );
  }
  if (totalCogs > 0n) {
    journal.push(
      { accountId: await requireAccountBySubtype(tx, companyId, "inventory", "asset", "Tovar zaxirasi"), debit: fromMinor(totalCogs) },
      { accountId: await requireAccountBySubtype(tx, companyId, "cogs", "expense", "Tovar tannarxi"), credit: fromMinor(totalCogs) },
    );
  }
  if (journal.length > 0) {
    await postJournalEntry(tx, companyId, tenant.user.id, {
      entryDate: date,
      description: `Qaytarish: ${number} (${order.number})`,
      referenceType: "sales_return",
      referenceId: returnId,
      lines: journal,
    });
  }
  if (order.customerId && totalValue > 0n) {
    await tx
      .update(customers)
      .set({
        totalDebt: sql`${customers.totalDebt} - ${fromMinor(totalValue)}::numeric`,
        totalPurchased: sql`${customers.totalPurchased} - ${fromMinor(totalValue)}::numeric`,
        updatedAt: new Date(),
      })
      .where(eq(customers.id, order.customerId));
  }

  // Pul qaytishi: tanlangan usulda; balans va keshbek ulushi o'z hisobiga
  if (money > 0n && input.refundMethod === "balance") {
    await refundToBalance(
      tx,
      tenant,
      { customerId: order.customerId!, orderId, orderNumber: number, amount: fromMinor(money), posShiftId: shift?.id ?? null, date },
      meta,
    );
  } else if (money > 0n) {
    const amount = fromMinor(money);
    const { account } = await recordCashTransaction(tx, companyId, tenant.user.id, {
      cashAccountId: await resolvePaymentAccount(tx, companyId, input.refundMethod === "card" ? "card" : "cash"),
      type: "out",
      amount,
      txDate: date,
      description: `Qaytarish: ${number} (${order.number})`,
      category: "sales_refund",
      referenceType: "sales_return",
      referenceId: returnId,
      // Offline kassada pul allaqachon berilgan — hisobdagi qoldiq yetmasa ham yoziladi
      allowOverdraft: offline !== undefined,
    });
    await postJournalEntry(tx, companyId, tenant.user.id, {
      entryDate: date,
      description: `Pul qaytarish: ${number}`,
      referenceType: "sales_return_refund",
      referenceId: returnId,
      lines: [
        { accountId: await requireAccountBySubtype(tx, companyId, "receivable", "asset", "Debitorlar"), debit: amount },
        { accountId: await ledgerAccountFor(tx, companyId, account.type), credit: amount },
      ],
    });
    if (order.customerId) {
      await tx
        .update(customers)
        .set({ totalDebt: sql`${customers.totalDebt} + ${amount}::numeric`, updatedAt: new Date() })
        .where(eq(customers.id, order.customerId));
    }
  }
  if (balanceBack > 0n) {
    await refundToBalance(
      tx,
      tenant,
      { customerId: order.customerId!, orderId, orderNumber: number, amount: fromMinor(balanceBack), posShiftId: shift?.id ?? null, date },
      meta,
    );
  }
  const cashback =
    order.customerId && (cashbackBack > 0n || reverse > 0n)
      ? await reverseCashback(tx, tenant, { customerId: order.customerId, orderId, label: number, restore: cashbackBack, reverse, date }, meta)
      : { redeemedRefunded: 0n, earnedReversed: 0n };

  if (shift) {
    await tx
      .update(posShifts)
      .set({
        totalReturns: sql`${posShifts.totalReturns} + ${fromMinor(totalValue)}::numeric`,
        ...(money > 0n && input.refundMethod === "cash" ? { totalCash: sql`${posShifts.totalCash} - ${fromMinor(money)}::numeric` } : {}),
        ...(money > 0n && input.refundMethod === "card" ? { totalCard: sql`${posShifts.totalCard} - ${fromMinor(money)}::numeric` } : {}),
        updatedAt: new Date(),
      })
      .where(eq(posShifts.id, shift.id));
  }

  const paidAfter = paid - refund;
  const status = allReturned ? ("returned" as const) : paidAfter >= netAfter ? ("delivered" as const) : order.status;
  await tx
    .update(salesOrders)
    .set({ paidAmount: fromMinor(paidAfter), status, updatedAt: new Date() })
    .where(eq(salesOrders.id, orderId));

  const summary = {
    id: returnId,
    number,
    totalAmount: fromMinor(totalValue),
    refundMethod: input.refundMethod,
    refundAmount: fromMinor(money),
    balanceRestored: fromMinor(balanceBack),
    cashbackRestored: fromMinor(cashback.redeemedRefunded),
    cashbackReversed: fromMinor(cashback.earnedReversed),
  };
  await tx
    .update(salesReturns)
    .set({
      refundAmount: summary.refundAmount,
      balanceRestored: summary.balanceRestored,
      cashbackRestored: summary.cashbackRestored,
      cashbackReversed: summary.cashbackReversed,
      updatedAt: new Date(),
    })
    .where(eq(salesReturns.id, returnId));

  await salesAudit(tx, tenant, meta, {
    action: "SALES_RETURN_CREATED",
    resource: "sales_returns",
    resourceId: returnId,
    details: {
      ...summary,
      orderId,
      orderNumber: order.number,
      cogs: fromMinor(totalCogs),
      items: lines.map((line) => ({ orderItemId: line.row.id, quantity: fromMinor(line.qty, 4), lineTotal: fromMinor(line.value) })),
      orderStatus: status,
      ...(offline ? { deviceId: offline.deviceId, returnedAt: offline.returnedAt.toISOString() } : {}),
    },
  });
  return { return: summary, order: await getOrder(tx, tenant, orderId) };
}
