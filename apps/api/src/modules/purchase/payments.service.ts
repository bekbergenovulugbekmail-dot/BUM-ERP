/**
 * Ta'minotchiga to'lov (convex/purchase/orders.ts `recordPayment`).
 *
 * Bitta tranzaksiyada: to'lov, kassa/bank chiqimi (`recordCashTransaction`), jurnal, buyurtmaning to'langan
 * summasi (valyuta bo'yicha), ta'minotchi qarzi (valyuta bo'yicha + kitob qiymati).
 *
 * Valyutada to'lov: pul shu valyutadagi kassa/bankdan chiqadi, qarz o'z valyutasida kamayadi. Jurnal asosiy
 * valyutada: DR kreditorlar — qarzning kitob qiymatidan ulush, CR kassa — to'lov kunidagi kurs bilan,
 * farqi — kurs farqi (CR 4200 daromad / DR 5700 xarajat). Qarzdan ortig'i (avans) joriy kurs bilan.
 * Asosiy valyutada kurs 1 — farq bo'lmaydi.
 *
 * Convex'dan farqlar:
 *  - usul "bank" bo'lsa ham pul asosiy (naqd) kassadan yechilar, jurnal esa bankni
 *    kreditlardi — endi karta/bank/o'tkazmada bank hisobidan, jurnal haqiqiy hisob turiga qarab
 *  - ortiqcha to'lov mumkin edi (buyurtma summasidan ham, qarzdan ham)
 *  - buyurtma boshqa ta'minotchiniki ekani tekshirilmasdi; qoralama/bekor qilingan buyurtmaga ham to'lanardi
 *  - takroriy `reference` boshqa ta'minotchining to'lovini qaytarardi — endi ta'minotchi ichida, bazada unique
 *  - to'lov buyurtmani qabul qilinmasdan "paid" qilardi (keyin qabul qilib bo'lmasdi) —
 *    endi "paid" faqat to'liq qabul + to'liq to'lovda; tovar kelmasdan to'lov — avans
 *  - kassa manfiyga tushardi; `purchase.create` bilan — endi `purchase.approve`
 */
import { and, desc, eq, getTableColumns, lt, or, sql } from "drizzle-orm";
import { ALLOCATION_METHODS, badRequest, notFound } from "@bum/shared";
import { purchaseOrderCurrencies, purchaseOrders, supplierPayments, suppliers } from "../../db/schema/purchase.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import type { RequestMeta } from "../../shared/audit.js";
import { UUID_RE, decodeCursor, encodeCursor } from "../../shared/cursor.js";
import { fromMinor, mulDivRound, rescale, toMinor } from "../../shared/decimal.js";
import type { TenantContext } from "../company/tenant.js";
import { companyCurrency } from "../finance/accounts.service.js";
import { applyOutgoingBankCommission } from "../finance/bank-commission.service.js";
import { ledgerAccountFor, recordCashTransaction, resolvePaymentAccount, todayIso } from "../finance/cash.service.js";
import { currencyRate } from "../finance/currencies.service.js";
import { resolvePaymentParts, type PaymentPartInput } from "../finance/payment-parts.service.js";
import { ensureAccountBySubtype, postJournalEntry, requireAccountBySubtype } from "../finance/journal.service.js";
import { applySupplierBalance, lockSupplierBalance } from "./supplier-balances.service.js";
import { purchaseAudit } from "./suppliers.service.js";

const { legacyId: _legacyId, companyId: _companyId, ...paymentFields } = getTableColumns(supplierPayments);

/** `balance`, `cashback` — faqat mijoz to'lovi uchun; ta'minotchiga qo'llanmaydi. */
export type PaymentMethod = Exclude<(typeof supplierPayments.method.enumValues)[number], "balance" | "cashback">;

export type SupplierPaymentInput = {
  supplierId: string;
  orderId?: string | null;
  amount: string;
  /** Standart — asosiy valyuta; boshqasi kompaniyada yoqilgan bo'lishi kerak. */
  currency?: string;
  paymentDate?: string;
  method: PaymentMethod;
  cashAccountId?: string | null;
  reference?: string | null;
  notes?: string | null;
  /**
   * Desktop kassa sinxroni: pul qurilmada berilgan — qarzdan ortig'i buyurtmasiz ham avans bo'lib yoziladi, kassa
   * qoldig'i yetmasa ham chiqim yoziladi (natijada `overpaid`).
   */
  offline?: boolean;
};

export async function recordSupplierPayment(tx: Tx, tenant: TenantContext, input: SupplierPaymentInput, meta: RequestMeta) {
  const companyId = tenant.company.id;
  const [supplier] = await tx
    .select({ id: suppliers.id, name: suppliers.name })
    .from(suppliers)
    .where(and(eq(suppliers.id, input.supplierId), eq(suppliers.companyId, companyId)))
    .limit(1)
    .for("update");
  if (!supplier) throw notFound("Ta'minotchi topilmadi");

  if (input.reference) {
    const [existing] = await tx
      .select(paymentFields)
      .from(supplierPayments)
      .where(
        and(
          eq(supplierPayments.companyId, companyId),
          eq(supplierPayments.supplierId, supplier.id),
          eq(supplierPayments.reference, input.reference),
        ),
      )
      .limit(1);
    if (existing) return { payment: existing, created: false };
  }

  const baseCurrency = await companyCurrency(tx, companyId);
  const currency = input.currency ?? baseCurrency;
  const rate = currency === baseCurrency ? "1.0000" : await currencyRate(tx, companyId, currency);
  const amount = toMinor(input.amount);

  let order: { id: string; number: string; status: string } | null = null;
  let bucket: { id: string; totalAmount: string; paidAmount: string } | null = null;
  if (input.orderId) {
    const [row] = await tx
      .select({
        id: purchaseOrders.id,
        number: purchaseOrders.number,
        supplierId: purchaseOrders.supplierId,
        status: purchaseOrders.status,
      })
      .from(purchaseOrders)
      .where(and(eq(purchaseOrders.id, input.orderId), eq(purchaseOrders.companyId, companyId)))
      .limit(1)
      .for("update");
    if (!row) throw notFound("Buyurtma topilmadi");
    if (row.supplierId !== supplier.id) throw badRequest("Buyurtma boshqa ta'minotchiniki");
    if (row.status === "draft" || row.status === "cancelled") {
      throw badRequest("Qoralama yoki bekor qilingan buyurtmaga to'lov qilib bo'lmaydi");
    }
    const [currencyRow] = await tx
      .select({
        id: purchaseOrderCurrencies.id,
        totalAmount: purchaseOrderCurrencies.totalAmount,
        paidAmount: purchaseOrderCurrencies.paidAmount,
      })
      .from(purchaseOrderCurrencies)
      .where(and(eq(purchaseOrderCurrencies.orderId, row.id), eq(purchaseOrderCurrencies.currency, currency)))
      .limit(1)
      .for("update");
    if (!currencyRow) throw badRequest(`Buyurtmada ${currency} valyutasidagi mahsulot yo'q`);
    const balance = toMinor(currencyRow.totalAmount) - toMinor(currencyRow.paidAmount);
    if (amount > balance) {
      throw badRequest(`To'lov buyurtma qoldig'idan ortiq (qoldiq ${fromMinor(balance)} ${currency})`);
    }
    order = row;
    bucket = currencyRow;
  }

  const balanceRow = await lockSupplierBalance(tx, companyId, supplier.id, currency);
  const debt = toMinor(balanceRow.debt);
  const book = toMinor(balanceRow.bookValue);
  const overpaid = !order && amount > debt ? amount - (debt > 0n ? debt : 0n) : 0n;
  if (overpaid > 0n && !input.offline) {
    throw badRequest(
      `To'lov ta'minotchi qarzidan ortiq (qarz ${fromMinor(debt > 0n ? debt : 0n)} ${currency}) — avans uchun buyurtmani tanlang`,
    );
  }

  // Asosiy valyutada: kassadan to'lov kunidagi kurs bilan; kreditorlardan qarzning kitob qiymati ulushi
  const rateMinor = toMinor(rate, 4);
  const baseAmount = rescale(amount * rateMinor, 6, 2);
  let bookReduction = baseAmount;
  if (debt > 0n && book > 0n) {
    const covered = amount < debt ? amount : debt;
    const coveredBook = covered === debt ? book : mulDivRound(book, covered, debt);
    bookReduction = coveredBook + rescale((amount - covered) * rateMinor, 6, 2);
  }
  const fx = bookReduction - baseAmount;

  const paymentDate = input.paymentDate ?? todayIso();
  const cashAccountId = await resolvePaymentAccount(tx, companyId, input.method, input.cashAccountId, currency);

  const [payment] = await tx
    .insert(supplierPayments)
    .values({
      companyId,
      supplierId: supplier.id,
      orderId: order?.id ?? null,
      amount: fromMinor(amount),
      currency,
      exchangeRate: rate,
      baseAmount: fromMinor(baseAmount),
      fxAmount: fromMinor(fx),
      paymentDate,
      method: input.method,
      reference: input.reference ?? null,
      notes: input.notes ?? null,
      createdBy: tenant.user.id,
    })
    .returning({ id: supplierPayments.id });

  const description = order ? `${supplier.name}ga to'lov (${order.number})` : `${supplier.name}ga to'lov`;
  const { account } = await recordCashTransaction(tx, companyId, tenant.user.id, {
    cashAccountId,
    type: "out",
    amount: fromMinor(amount),
    currency,
    txDate: paymentDate,
    description,
    category: "purchase",
    referenceType: "supplier_payment",
    referenceId: payment!.id,
    allowOverdraft: input.offline,
  });

  const lines: { accountId: string; debit?: string; credit?: string }[] = [
    { accountId: await requireAccountBySubtype(tx, companyId, "payable", "liability", "Kreditorlar"), debit: fromMinor(bookReduction) },
    { accountId: await ledgerAccountFor(tx, companyId, account), credit: fromMinor(baseAmount) },
  ];
  if (fx > 0n) lines.push({ accountId: await ensureAccountBySubtype(tx, companyId, "fx_gain"), credit: fromMinor(fx) });
  if (fx < 0n) lines.push({ accountId: await ensureAccountBySubtype(tx, companyId, "fx_loss"), debit: fromMinor(-fx) });
  const { entry } = await postJournalEntry(tx, companyId, tenant.user.id, {
    entryDate: paymentDate,
    description,
    referenceType: "supplier_payment",
    referenceId: payment!.id,
    lines,
  });

  // Bank hisobidan to'lov — hisob komissiyasi alohida chiqim va "Bank komissiyasi" xarajati (ta'minotchi balansiga to'liq summa)
  await applyOutgoingBankCommission(tx, tenant, {
    cashAccountId: account.id,
    amount: fromMinor(amount),
    date: paymentDate,
    description,
    sourceType: "supplier_payment",
    sourceId: payment!.id,
    allowOverdraft: input.offline,
  });

  const [updated] = await tx
    .update(supplierPayments)
    .set({ cashAccountId: account.id, journalEntryId: entry.id, updatedAt: new Date() })
    .where(eq(supplierPayments.id, payment!.id))
    .returning(paymentFields);

  if (order && bucket) {
    await tx
      .update(purchaseOrderCurrencies)
      .set({ paidAmount: fromMinor(toMinor(bucket.paidAmount) + amount), updatedAt: new Date() })
      .where(eq(purchaseOrderCurrencies.id, bucket.id));
    const buckets = await tx
      .select({ totalAmount: purchaseOrderCurrencies.totalAmount, paidAmount: purchaseOrderCurrencies.paidAmount })
      .from(purchaseOrderCurrencies)
      .where(eq(purchaseOrderCurrencies.orderId, order.id));
    const allPaid = buckets.every((b) => toMinor(b.paidAmount) >= toMinor(b.totalAmount));
    const settled = allPaid && (order.status === "received" || order.status === "invoiced");
    await tx
      .update(purchaseOrders)
      .set({
        paidAmount: sql`${purchaseOrders.paidAmount} + ${fromMinor(baseAmount)}::numeric`,
        ...(settled ? { status: "paid" as const } : {}),
        updatedAt: new Date(),
      })
      .where(eq(purchaseOrders.id, order.id));
  }

  await applySupplierBalance(tx, {
    companyId,
    userId: tenant.user.id,
    supplierId: supplier.id,
    currency,
    debtDelta: -amount,
    bookDelta: -bookReduction,
    date: paymentDate,
    description: supplier.name,
  });

  await purchaseAudit(tx, tenant, meta, {
    action: "SUPPLIER_PAYMENT_RECORDED",
    resource: "supplier_payments",
    resourceId: payment!.id,
    details: {
      supplierId: supplier.id,
      orderId: order?.id ?? null,
      amount: fromMinor(amount),
      currency,
      exchangeRate: rate,
      baseAmount: fromMinor(baseAmount),
      fxAmount: fromMinor(fx),
      cashAccountId: account.id,
      ...(overpaid > 0n ? { advance: fromMinor(overpaid) } : {}),
    },
  });
  return { payment: updated!, created: true, overpaid: overpaid > 0n ? fromMinor(overpaid) : null };
}

/**
 * Ta'minotchiga ARALASH to'lov: bitta to'lov bir nechta usulga bo'linadi (naqd + UZCARD + bank).
 *
 * Yangi to'lov mexanizmi yaratilmaydi — qismlar mijoz to'lovlaridagi bilan bir xil universal qatlamda
 * tekshiriladi (`resolvePaymentParts`: usul, terminal → bank hisobi, hisob turi va valyutasi, takrorlanmaslik),
 * so'ng har qism mavjud `recordSupplierPayment` orqali yoziladi. Shuning uchun har qism uchun kassa chiqimi,
 * jurnal (DR kreditorlar / CR shu hisob), bank komissiyasi, buyurtma qoldig'i va ta'minotchi balansi avvalgidek
 * hisoblanadi va har bir yozuv alohida balanslanadi.
 *
 * Qoldiqdan ortiq to'lash har qismda tekshiriladi — oshsa butun tranzaksiya bekor bo'ladi. Kam to'lash mumkin
 * (qarz qoladi). Faqat asosiy valyuta: valyutadagi to'lov bitta usul bilan alohida kiritiladi.
 * Takroriy yuborishdan himoya — `reference`: har qismga `reference:tartib` beriladi (bazada unique).
 */
export async function recordMixedSupplierPayment(
  tx: Tx,
  tenant: TenantContext,
  input: {
    supplierId: string;
    orderId?: string | null;
    parts: PaymentPartInput[];
    paymentDate?: string;
    reference?: string | null;
    notes?: string | null;
    offline?: boolean;
  },
  meta: RequestMeta,
) {
  const resolved = await resolvePaymentParts(tx, tenant.company.id, input.parts, {
    allowedMethods: ALLOCATION_METHODS,
    offline: input.offline,
  });
  if (resolved.length === 0) throw badRequest("To'lov summasi kiritilmagan");

  const rows = [];
  let created = false;
  let total = 0n;
  for (const [index, part] of resolved.entries()) {
    const result = await recordSupplierPayment(
      tx,
      tenant,
      {
        supplierId: input.supplierId,
        orderId: input.orderId ?? null,
        amount: fromMinor(part.amount),
        paymentDate: input.paymentDate,
        method: part.method,
        cashAccountId: part.cashAccountId,
        reference: input.reference ? `${input.reference}:${index}` : null,
        notes: input.notes ?? null,
        offline: input.offline,
      },
      meta,
    );
    rows.push(result.payment);
    created = created || result.created;
    total += part.amount;
  }
  return { payments: rows, created, total: fromMinor(total) };
}

export async function listSupplierPayments(
  conn: DbOrTx,
  tenant: TenantContext,
  options: { supplierId?: string; orderId?: string; limit: number; cursor?: string },
) {
  let after: { date: string; id: string } | null = null;
  if (options.cursor) {
    const [date, id] = decodeCursor(options.cursor, 2) as [string, string];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !UUID_RE.test(id)) throw badRequest("Kursor noto'g'ri");
    after = { date, id };
  }

  const rows = await conn
    .select({ ...paymentFields, supplierName: suppliers.name })
    .from(supplierPayments)
    .innerJoin(suppliers, eq(suppliers.id, supplierPayments.supplierId))
    .where(
      and(
        eq(supplierPayments.companyId, tenant.company.id),
        options.supplierId ? eq(supplierPayments.supplierId, options.supplierId) : undefined,
        options.orderId ? eq(supplierPayments.orderId, options.orderId) : undefined,
        after
          ? or(
              lt(supplierPayments.paymentDate, after.date),
              and(eq(supplierPayments.paymentDate, after.date), lt(supplierPayments.id, after.id)),
            )
          : undefined,
      ),
    )
    .orderBy(desc(supplierPayments.paymentDate), desc(supplierPayments.id))
    .limit(options.limit + 1);

  const page = rows.slice(0, options.limit);
  const last = page.at(-1);
  return {
    payments: page,
    nextCursor: rows.length > options.limit && last ? encodeCursor([last.paymentDate, last.id]) : null,
  };
}
