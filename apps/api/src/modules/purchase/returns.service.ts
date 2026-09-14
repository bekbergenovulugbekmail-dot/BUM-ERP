/**
 * Ta'minotchiga qaytarish (qisman; web va desktop kassa).
 *
 * Bitta tranzaksiyada: `purchase_returns` hujjati va qatorlari, zaxira chiqimi (`return_out`), `returned_qty`,
 * jurnal (DR kreditorlar / CR tovar zaxirasi — qabul tannarxi ulushida), ta'minotchi qarzi valyuta bo'yicha (qator
 * valyutasidagi qarz va kitob qiymati kamayadi). Ta'minotchi pul qaytarsa — kassa yoki bankka kirim va qarz shunga
 * qaytadi (DR kassa / CR kreditorlar). Oxirgi qoldiq aniq summada — ulushlarning yaxlitlash qoldig'isiz.
 * Desktop kassa (offline): qoldiq yetmasa ham chiqim (manfiy qoldiq) — `stock_shortage` nomuvofiqligi.
 */
import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { badRequest, notFound } from "@bum/shared";
import { products } from "../../db/schema/catalog.js";
import {
  purchaseOrderItems,
  purchaseOrders,
  purchaseReceiptItems,
  purchaseReturnItems,
  purchaseReturns,
  suppliers,
} from "../../db/schema/purchase.js";
import type { Tx } from "../../db/transaction.js";
import type { RequestMeta } from "../../shared/audit.js";
import { fromMinor, mulDivRound, rescale, toMinor } from "../../shared/decimal.js";
import { nextDocumentNumber } from "../../shared/numbering.js";
import { assertProductsInScope } from "../catalog/category-scope.js";
import { unitFactorToBase } from "../catalog/conversions.js";
import type { TenantContext } from "../company/tenant.js";
import { companyCurrency } from "../finance/accounts.service.js";
import { ledgerAccountFor, recordCashTransaction, resolvePaymentAccount, todayIso } from "../finance/cash.service.js";
import { postJournalEntry, requireAccountBySubtype } from "../finance/journal.service.js";
import { moveStock } from "../inventory/stock.service.js";
import { assertWarehouseAccess } from "../inventory/warehouses.service.js";
import { applySupplierBalance } from "./supplier-balances.service.js";
import { purchaseAudit } from "./suppliers.service.js";

export type PurchaseReturnConflict = { kind: string; details: Record<string, unknown> };

export type PurchaseReturnInput = {
  items: { orderItemId: string; quantity: string }[];
  reason?: string | null;
  /** Ta'minotchi qaytargan pul (asosiy valyutada): naqd — asosiy kassaga, karta — bankka. */
  refund?: { amount: string; method: "cash" | "card" } | null;
  /** Desktop kassa sinxroni: qurilmadagi ID, raqam (`K01-R000001`), vaqt va qurilma. */
  offline?: { id: string; number: string; occurredAt: Date; deviceId: string };
};

const RETURNABLE = new Set(["partial", "received", "invoiced", "paid"]);
const sumText = (column: AnyPgColumn) => sql<string>`coalesce(sum(${column}), 0)::text`;
const positive = (value: bigint) => (value > 0n ? value : 0n);

export async function returnPurchaseItems(tx: Tx, tenant: TenantContext, orderId: string, input: PurchaseReturnInput, meta: RequestMeta) {
  const companyId = tenant.company.id;
  const offline = input.offline;
  const conflicts: PurchaseReturnConflict[] = [];

  const [order] = await tx
    .select({
      id: purchaseOrders.id,
      number: purchaseOrders.number,
      status: purchaseOrders.status,
      supplierId: purchaseOrders.supplierId,
      warehouseId: purchaseOrders.warehouseId,
    })
    .from(purchaseOrders)
    .where(and(eq(purchaseOrders.id, orderId), eq(purchaseOrders.companyId, companyId)))
    .limit(1)
    .for("update");
  if (!order) throw notFound("Xarid topilmadi");
  if (!RETURNABLE.has(order.status)) throw badRequest("Faqat tovari qabul qilingan xarid qaytariladi");
  assertWarehouseAccess(tenant, order.warehouseId);

  const ids = input.items.map((item) => item.orderItemId);
  if (ids.length === 0) throw badRequest("Qaytariladigan mahsulotni tanlang");
  if (new Set(ids).size !== ids.length) throw badRequest("Mahsulot qatori takrorlangan");

  const rows = await tx
    .select({
      id: purchaseOrderItems.id,
      productId: purchaseOrderItems.productId,
      unitId: purchaseOrderItems.unitId,
      currency: purchaseOrderItems.currency,
      receivedQty: purchaseOrderItems.receivedQty,
      returnedQty: purchaseOrderItems.returnedQty,
    })
    .from(purchaseOrderItems)
    .where(and(eq(purchaseOrderItems.orderId, orderId), inArray(purchaseOrderItems.id, ids)))
    .for("update");
  if (rows.length !== ids.length) throw badRequest("Xaridda bunday mahsulot qatori yo'q");
  const rowById = new Map(rows.map((row) => [row.id, row]));
  await assertProductsInScope(tx, tenant, rows.map((row) => row.productId));

  const productRows = await tx
    .select({ id: products.id, name: products.name, baseUnitId: products.baseUnitId })
    .from(products)
    .where(inArray(products.id, [...new Set(rows.map((row) => row.productId))]));
  const productById = new Map(productRows.map((product) => [product.id, product]));

  // Qabul qiymati (kitob va valyutada) va oldingi qaytarishlar — qator bo'yicha
  type Sums = { qty: bigint; value: bigint; foreign: bigint };
  const toSums = (list: { orderItemId: string; qty: string; value: string; foreign: string }[]) =>
    new Map<string, Sums>(list.map((row) => [row.orderItemId, { qty: toMinor(row.qty, 4), value: toMinor(row.value), foreign: toMinor(row.foreign) }]));
  const received = toSums(
    await tx
      .select({
        orderItemId: purchaseReceiptItems.orderItemId,
        qty: sumText(purchaseReceiptItems.receivedQty),
        value: sumText(purchaseReceiptItems.lineTotal),
        foreign: sumText(purchaseReceiptItems.foreignTotal),
      })
      .from(purchaseReceiptItems)
      .where(inArray(purchaseReceiptItems.orderItemId, ids))
      .groupBy(purchaseReceiptItems.orderItemId),
  );
  const returned = toSums(
    await tx
      .select({
        orderItemId: purchaseReturnItems.orderItemId,
        qty: sumText(purchaseReturnItems.quantity),
        value: sumText(purchaseReturnItems.lineTotal),
        foreign: sumText(purchaseReturnItems.foreignTotal),
      })
      .from(purchaseReturnItems)
      .where(inArray(purchaseReturnItems.orderItemId, ids))
      .groupBy(purchaseReturnItems.orderItemId),
  );
  const zero: Sums = { qty: 0n, value: 0n, foreign: 0n };

  const lines = input.items.map((request) => {
    const row = rowById.get(request.orderItemId)!;
    const product = productById.get(row.productId)!;
    const qty = toMinor(request.quantity, 4);
    if (qty <= 0n) throw badRequest("Miqdor musbat bo'lishi kerak");
    const remainingQty = toMinor(row.receivedQty, 4) - toMinor(row.returnedQty, 4);
    if (qty > remainingQty) {
      throw badRequest(`${product.name}: qaytarish miqdori qabul qilinganidan ko'p (qolgan ${fromMinor(positive(remainingQty), 4)})`);
    }
    const rec = received.get(row.id) ?? zero;
    const ret = returned.get(row.id) ?? zero;
    const valueLeft = positive(rec.value - ret.value);
    const foreignLeft = positive(rec.foreign - ret.foreign);
    const last = qty === remainingQty;
    const value = last ? valueLeft : mulDivRound(valueLeft, qty, remainingQty);
    const foreign = row.currency ? (last ? foreignLeft : mulDivRound(foreignLeft, qty, remainingQty)) : value;
    return { row, product, qty, value, foreign };
  });
  const total = lines.reduce((sum, line) => sum + line.value, 0n);

  const refund = input.refund ? { amount: toMinor(input.refund.amount), method: input.refund.method } : null;
  if (refund && refund.amount <= 0n) throw badRequest("Qaytgan pul summasi musbat bo'lishi kerak");

  const date = offline ? offline.occurredAt.toISOString().slice(0, 10) : todayIso();
  const returnId = offline?.id ?? randomUUID();
  const number =
    offline?.number ??
    (await nextDocumentNumber(tx, {
      table: purchaseReturns,
      column: purchaseReturns.number,
      companyColumn: purchaseReturns.companyId,
      companyId,
      prefix: `PR-${date.slice(0, 4)}-`,
      width: 4,
    }));

  await tx.insert(purchaseReturns).values({
    id: returnId,
    companyId,
    orderId,
    supplierId: order.supplierId,
    warehouseId: order.warehouseId,
    number,
    returnDate: date,
    deviceId: offline?.deviceId ?? null,
    totalAmount: fromMinor(total),
    refundMethod: refund?.method ?? null,
    refundAmount: fromMinor(refund?.amount ?? 0n),
    reason: input.reason ?? null,
    createdBy: tenant.user.id,
    ...(offline ? { createdAt: offline.occurredAt } : {}),
  });

  const baseCurrency = await companyCurrency(tx, companyId);
  const byCurrency = new Map<string, { foreign: bigint; base: bigint }>();
  for (const line of lines) {
    const factor = toMinor(await unitFactorToBase(tx, companyId, line.product, line.row.unitId), 4);
    const baseQty = rescale(line.qty * factor, 8, 4);
    await tx.insert(purchaseReturnItems).values({
      companyId,
      returnId,
      orderItemId: line.row.id,
      productId: line.row.productId,
      unitId: line.row.unitId,
      quantity: fromMinor(line.qty, 4),
      costPrice: baseQty > 0n ? fromMinor(mulDivRound(line.value, 1_000_000n, baseQty), 4) : "0",
      lineTotal: fromMinor(line.value),
      currency: line.row.currency,
      foreignTotal: fromMinor(line.foreign),
    });
    const { level } = await moveStock(tx, companyId, tenant.user.id, {
      type: "return_out",
      productId: line.row.productId,
      warehouseId: order.warehouseId,
      quantity: fromMinor(baseQty, 4),
      referenceType: "purchase_return",
      referenceId: returnId,
      notes: `Ta'minotchiga qaytarish: ${number} (${order.number})`,
      occurredAt: offline?.occurredAt,
      allowNegative: offline !== undefined,
    });
    const after = toMinor(level.quantity, 4);
    if (after < 0n) {
      conflicts.push({
        kind: "stock_shortage",
        details: {
          warehouseId: order.warehouseId,
          items: [{ productId: line.row.productId, name: line.product.name, requested: fromMinor(baseQty, 4), available: fromMinor(positive(after + baseQty), 4) }],
        },
      });
    }
    await tx
      .update(purchaseOrderItems)
      .set({ returnedQty: sql`${purchaseOrderItems.returnedQty} + ${fromMinor(line.qty, 4)}::numeric`, updatedAt: new Date() })
      .where(eq(purchaseOrderItems.id, line.row.id));
    const code = line.row.currency ?? baseCurrency;
    const bucket = byCurrency.get(code) ?? { foreign: 0n, base: 0n };
    bucket.foreign += line.foreign;
    bucket.base += line.value;
    byCurrency.set(code, bucket);
  }

  const payable = await requireAccountBySubtype(tx, companyId, "payable", "liability", "Kreditorlar");
  if (total > 0n) {
    await postJournalEntry(tx, companyId, tenant.user.id, {
      entryDate: date,
      description: `Ta'minotchiga qaytarish: ${number} (${order.number})`,
      referenceType: "purchase_return",
      referenceId: returnId,
      lines: [
        { accountId: payable, debit: fromMinor(total) },
        { accountId: await requireAccountBySubtype(tx, companyId, "inventory", "asset", "Tovar zaxirasi"), credit: fromMinor(total) },
      ],
    });
  }
  for (const [currency, amounts] of byCurrency) {
    await applySupplierBalance(tx, {
      companyId,
      userId: tenant.user.id,
      supplierId: order.supplierId,
      currency,
      debtDelta: -amounts.foreign,
      bookDelta: -amounts.base,
      date,
      description: number,
    });
  }
  await tx
    .update(suppliers)
    .set({ totalPurchased: sql`${suppliers.totalPurchased} - ${fromMinor(total)}::numeric`, updatedAt: new Date() })
    .where(eq(suppliers.id, order.supplierId));

  let cashAccountId: string | null = null;
  if (refund) {
    const amount = fromMinor(refund.amount);
    const description = `Ta'minotchidan qaytgan pul: ${number}`;
    const { account } = await recordCashTransaction(tx, companyId, tenant.user.id, {
      cashAccountId: await resolvePaymentAccount(tx, companyId, refund.method),
      type: "in",
      amount,
      txDate: date,
      description,
      category: "purchase_refund",
      referenceType: "purchase_return",
      referenceId: returnId,
    });
    await postJournalEntry(tx, companyId, tenant.user.id, {
      entryDate: date,
      description,
      referenceType: "purchase_return_refund",
      referenceId: returnId,
      lines: [
        { accountId: await ledgerAccountFor(tx, companyId, account), debit: amount },
        { accountId: payable, credit: amount },
      ],
    });
    await applySupplierBalance(tx, {
      companyId,
      userId: tenant.user.id,
      supplierId: order.supplierId,
      currency: baseCurrency,
      debtDelta: refund.amount,
      bookDelta: refund.amount,
      date,
      description,
    });
    cashAccountId = account.id;
    await tx.update(purchaseReturns).set({ cashAccountId: account.id, updatedAt: new Date() }).where(eq(purchaseReturns.id, returnId));
  }

  const summary = {
    id: returnId,
    number,
    orderId,
    orderNumber: order.number,
    totalAmount: fromMinor(total),
    refundMethod: refund?.method ?? null,
    refundAmount: fromMinor(refund?.amount ?? 0n),
    cashAccountId,
  };
  await purchaseAudit(tx, tenant, meta, {
    action: "PURCHASE_RETURN_CREATED",
    resource: "purchase_returns",
    resourceId: returnId,
    details: {
      ...summary,
      items: lines.map((line) => ({ orderItemId: line.row.id, quantity: fromMinor(line.qty, 4), lineTotal: fromMinor(line.value) })),
      ...(offline ? { deviceId: offline.deviceId, occurredAt: offline.occurredAt.toISOString() } : {}),
      ...(conflicts.length > 0 ? { conflicts: conflicts.map((item) => item.kind) } : {}),
    },
  });
  return { return: summary, conflicts };
}
