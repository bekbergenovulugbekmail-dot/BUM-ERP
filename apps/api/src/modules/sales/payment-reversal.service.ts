/**
 * Mijoz to'lovini BEKOR QILISH (reversal) — audit AUD-001.
 *
 * Qoida: hech narsa O'CHIRILMAYDI. Asl to'lov, kassa kirimi va jurnal yozuvi joyida qoladi; ularning TESKARISI
 * yoziladi va to'lov `reversed` holatiga o'tadi. Shu bilan moliyaviy tarix to'liq saqlanadi: "kim, qachon, nima
 * uchun bekor qildi" ham, bekor qilishdan oldingi holat ham ko'rinadi.
 *
 * Bog'langan operatsiyalar (hammasi BITTA tranzaksiyada, biri yiqilsa — hammasi qaytadi):
 *   aralash to'lovning barcha qismlari (bitta `payments` hujjati) → buyurtmaning to'langan summasi yoki buyurtmasiz
 *   to'lovning taqsimoti → mijoz qarzi → pul (kassa/bank chiqimi; hamyon yoki keshbekka qaytish) → jurnal (teskari)
 *   → ekvayring komissiyasi (teskari) → kassa smenasi hisoblagichi (smena ochiq bo'lsa) → yetkazmada yig'ilgan summa.
 *
 * Himoya: to'lov qatorlari `FOR UPDATE` bilan qulflanadi va holati tekshiriladi — ikkinchi (yoki parallel) so'rov
 * "allaqachon bekor qilingan" bilan rad etiladi. Sabab majburiy. Bugungi sana yopilgan davrda bo'lsa — rad.
 * Qaytarilgan buyurtmaning to'lovi bekor qilinmaydi (pul qaytarishda allaqachon qaytgan bo'lishi mumkin).
 */
import { and, asc, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { badRequest, conflict, notFound } from "@bum/shared";
import {
  customerBalanceTransactions,
  customerCashbackTransactions,
  customerPaymentAllocations,
  customerPayments,
  customers,
  payments,
  posShifts,
  salesOrders,
  salesReturns,
} from "../../db/schema/sales.js";
import { cashAccounts, expenses } from "../../db/schema/finance.js";
import { deliveryPayments, deliveryTasks } from "../../db/schema/delivery.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import type { RequestMeta } from "../../shared/audit.js";
import { fromMinor, toMinor } from "../../shared/decimal.js";
import type { TenantContext } from "../company/tenant.js";
import { ensureAccountBySubtype, assertPeriodOpen, postJournalEntry, requireAccountBySubtype } from "../finance/journal.service.js";
import { ledgerAccountFor, recordCashTransaction, todayIso } from "../finance/cash.service.js";
import { salesAudit } from "./customers.service.js";
import { depositReversalBlockers, lockHeaderDeposits, reverseDepositRows } from "./bank-receipt.service.js";

const MONEY_METHODS = new Set(["cash", "bank", "card", "transfer"]);

type PartRow = typeof customerPayments.$inferSelect;

export type ReversalEffect = {
  paymentIds: string[];
  customer: { id: string; name: string; debtBefore: string; debtAfter: string } | null;
  total: string;
  parts: {
    id: string;
    method: string;
    amount: string;
    currency: string;
    foreignAmount: string | null;
    paymentDate: string;
    /** Pul qayerdan chiqadi (hamyon/keshbek bo'lsa — mijozga qaytadi). */
    moneyBack: { kind: "cash_account"; accountId: string; accountName: string; available: string; enough: boolean } | { kind: "wallet" | "cashback" };
    commission: string | null;
  }[];
  orders: { id: string; number: string; paidBefore: string; paidAfter: string }[];
  /** Buyurtmasiz eski to'lov: taqsimot yozilmagan — so'nggi to'langan hujjatlardan qaytariladi. */
  legacyAllocation: boolean;
  delivery: { taskId: string; collectedBefore: string; collectedAfter: string }[];
  shift: { id: string; open: boolean } | null;
  /** Bank tushumining avans qismi — hujjat bilan birga bekor qilinadi (hamyon kamayadi, pul bankdan qaytadi). */
  advance: { amount: string; accountName: string; walletBefore: string; walletAfter: string } | null;
  /** Bajarib bo'lmaydigan sabablar — bo'sh bo'lsa, bekor qilish mumkin. */
  blockers: string[];
};

/** Qism id'sidan butun to'lov guruhini (aralash to'lov) topadi va qulflaydi. */
async function lockGroup(conn: DbOrTx, companyId: string, partId: string, lock: boolean): Promise<PartRow[]> {
  const base = conn.select().from(customerPayments).where(and(eq(customerPayments.id, partId), eq(customerPayments.companyId, companyId))).limit(1);
  const [part] = lock ? await base.for("update") : await base;
  if (!part) throw notFound("To'lov topilmadi");
  if (!part.paymentId) return [part];
  const group = conn
    .select()
    .from(customerPayments)
    .where(and(eq(customerPayments.companyId, companyId), eq(customerPayments.paymentId, part.paymentId)))
    .orderBy(asc(customerPayments.createdAt), asc(customerPayments.id));
  return lock ? group.for("update") : group;
}

/**
 * Buyurtmaga qaytariladigan summalar: buyurtmali to'lov — o'sha buyurtma; buyurtmasiz — yozilgan taqsimot;
 * taqsimot yozilmagan (audit 0087 migratsiyasidan oldingi) to'lov — oxirgi to'langan hujjatlardan orqaga.
 */
async function orderReleases(conn: DbOrTx, companyId: string, part: PartRow) {
  if (part.orderId) return { releases: [{ orderId: part.orderId, amount: toMinor(part.amount) }], legacy: false };
  const recorded = await conn
    .select({ orderId: customerPaymentAllocations.orderId, amount: customerPaymentAllocations.amount })
    .from(customerPaymentAllocations)
    .where(eq(customerPaymentAllocations.paymentId, part.id));
  if (recorded.length > 0) return { releases: recorded.map((row) => ({ orderId: row.orderId, amount: toMinor(row.amount) })), legacy: false };
  if (!part.customerId) return { releases: [], legacy: false };
  // Eski to'lov: taqsimot saqlanmagan — FIFO taqsimotning teskarisi (eng oxirgi muddatdan)
  const paidDocs = await conn
    .select({ id: salesOrders.id, paid: salesOrders.paidAmount })
    .from(salesOrders)
    .where(
      and(
        eq(salesOrders.companyId, companyId),
        eq(salesOrders.customerId, part.customerId),
        inArray(salesOrders.status, ["completed", "shipped", "delivered"]),
        gt(salesOrders.paidAmount, "0"),
      ),
    )
    .orderBy(desc(salesOrders.orderDate), desc(salesOrders.id));
  let left = toMinor(part.amount);
  const releases: { orderId: string; amount: bigint }[] = [];
  for (const doc of paidDocs) {
    if (left <= 0n) break;
    const take = toMinor(doc.paid) < left ? toMinor(doc.paid) : left;
    releases.push({ orderId: doc.id, amount: take });
    left -= take;
  }
  return { releases, legacy: true };
}

/** Bekor qilish natijasini HISOBLAYDI (hech narsa yozmaydi) — foydalanuvchiga tasdiqlashdan oldin ko'rsatiladi. */
export async function previewPaymentReversal(conn: DbOrTx, tenant: TenantContext, partId: string): Promise<ReversalEffect> {
  const companyId = tenant.company.id;
  const group = await lockGroup(conn, companyId, partId, false);
  return buildEffect(conn, companyId, group);
}

async function buildEffect(conn: DbOrTx, companyId: string, group: PartRow[]): Promise<ReversalEffect> {
  const blockers: string[] = [];
  if (group.some((part) => part.status === "reversed")) blockers.push("To'lov allaqachon bekor qilingan");
  const total = group.reduce((sum, part) => sum + toMinor(part.amount), 0n);
  const customerId = group[0]!.customerId;

  let customer: ReversalEffect["customer"] = null;
  if (customerId) {
    const [row] = await conn.select({ id: customers.id, name: customers.name, totalDebt: customers.totalDebt }).from(customers).where(eq(customers.id, customerId)).limit(1);
    if (row) customer = { id: row.id, name: row.name, debtBefore: row.totalDebt, debtAfter: fromMinor(toMinor(row.totalDebt) + total) };
  }

  const orderDelta = new Map<string, bigint>();
  let legacyAllocation = false;
  const parts: ReversalEffect["parts"] = [];
  const needByAccount = new Map<string, bigint>();
  for (const part of group) {
    const { releases, legacy } = await orderReleases(conn, companyId, part);
    legacyAllocation ||= legacy;
    for (const release of releases) orderDelta.set(release.orderId, (orderDelta.get(release.orderId) ?? 0n) + release.amount);

    const [fee] = await conn
      .select({ amount: expenses.amount })
      .from(expenses)
      .where(and(eq(expenses.companyId, companyId), eq(expenses.referenceType, "customer_payment"), eq(expenses.referenceId, part.id)))
      .limit(1);

    let moneyBack: ReversalEffect["parts"][number]["moneyBack"];
    if (part.method === "balance") moneyBack = { kind: "wallet" };
    else if (part.method === "cashback") moneyBack = { kind: "cashback" };
    else {
      if (!part.cashAccountId) {
        blockers.push(`To'lov qismi (${part.method}) hisobga bog'lanmagan — bekor qilib bo'lmaydi`);
        continue;
      }
      const [account] = await conn.select({ id: cashAccounts.id, name: cashAccounts.name, balance: cashAccounts.balance }).from(cashAccounts).where(eq(cashAccounts.id, part.cashAccountId)).limit(1);
      const moneyOut = toMinor(toMinor(part.foreignAmount) > 0n ? part.foreignAmount : part.amount);
      // Komissiya qaytgach hisobdan mijozga to'liq summa chiqadi: kerakli qoldiq = summa − komissiya
      const need = moneyOut - (fee ? toMinor(fee.amount) : 0n);
      needByAccount.set(part.cashAccountId, (needByAccount.get(part.cashAccountId) ?? 0n) + need);
      const enough = account ? toMinor(account.balance) >= needByAccount.get(part.cashAccountId)! : false;
      moneyBack = { kind: "cash_account", accountId: part.cashAccountId, accountName: account?.name ?? "—", available: account?.balance ?? "0", enough };
      if (!enough) {
        blockers.push(`"${account?.name ?? "hisob"}" da yetarli pul yo'q (qoldiq ${account?.balance ?? "0"}) — pul boshqa kassaga o'tkazilgan bo'lsa, avval uni qaytaring`);
      }
    }
    parts.push({
      id: part.id,
      method: part.method,
      amount: part.amount,
      currency: part.currency,
      foreignAmount: toMinor(part.foreignAmount) > 0n ? part.foreignAmount : null,
      paymentDate: part.paymentDate,
      moneyBack,
      commission: fee?.amount ?? null,
    });
  }

  const orders: ReversalEffect["orders"] = [];
  if (orderDelta.size > 0) {
    const rows = await conn
      .select({ id: salesOrders.id, number: salesOrders.number, paid: salesOrders.paidAmount, status: salesOrders.status })
      .from(salesOrders)
      .where(inArray(salesOrders.id, [...orderDelta.keys()]));
    for (const row of rows) {
      const after = toMinor(row.paid) - orderDelta.get(row.id)!;
      if (row.status === "returned") blockers.push(`${row.number} qaytarilgan — to'lov qaytarish hujjatida hisob-kitob qilingan`);
      const [partial] = await conn.select({ id: salesReturns.id }).from(salesReturns).where(eq(salesReturns.orderId, row.id)).limit(1);
      if (partial && row.status !== "returned") blockers.push(`${row.number} bo'yicha qaytarish bor — avval qaytarishni hisobga oling`);
      if (after < 0n) blockers.push(`${row.number}: to'langan summa manfiy bo'lib qoladi`);
      orders.push({ id: row.id, number: row.number, paidBefore: row.paid, paidAfter: fromMinor(after < 0n ? 0n : after) });
    }
  }

  const delivery: ReversalEffect["delivery"] = [];
  const links = await conn
    .select({ taskId: deliveryPayments.taskId, amount: deliveryPayments.amount, collected: deliveryTasks.collectedAmount })
    .from(deliveryPayments)
    .innerJoin(deliveryTasks, eq(deliveryTasks.id, deliveryPayments.taskId))
    .where(inArray(deliveryPayments.customerPaymentId, group.map((part) => part.id)));
  for (const link of links) {
    const after = toMinor(link.collected) - toMinor(link.amount);
    delivery.push({ taskId: link.taskId, collectedBefore: link.collected, collectedAfter: fromMinor(after < 0n ? 0n : after) });
  }

  // Bank tushumi: hujjatga bog'langan avans kirimi ham birga qaytadi — hamyon va hisob yetarli bo'lishi kerak
  let advance: ReversalEffect["advance"] = null;
  const headerId = group[0]!.paymentId;
  if (headerId) {
    const deposits = (await lockHeaderDeposits(conn, headerId, false)).filter((row) => row.status === "posted");
    if (deposits.length > 0) {
      blockers.push(...(await depositReversalBlockers(conn, deposits, needByAccount)));
      const sum = deposits.reduce((acc, row) => acc + toMinor(row.amount), 0n);
      const [wallet] = await conn.select({ balance: customers.balance }).from(customers).where(eq(customers.id, deposits[0]!.customerId)).limit(1);
      const [account] = await conn.select({ name: cashAccounts.name }).from(cashAccounts).where(eq(cashAccounts.id, deposits[0]!.cashAccountId ?? "")).limit(1);
      advance = {
        amount: fromMinor(sum),
        accountName: account?.name ?? "—",
        walletBefore: wallet?.balance ?? "0",
        walletAfter: fromMinor(toMinor(wallet?.balance ?? "0") - sum),
      };
    }
  }

  let shift: ReversalEffect["shift"] = null;
  const shiftId = group.find((part) => part.posShiftId)?.posShiftId;
  if (shiftId) {
    const [row] = await conn.select({ status: posShifts.status }).from(posShifts).where(eq(posShifts.id, shiftId)).limit(1);
    shift = { id: shiftId, open: row?.status === "open" };
  }

  return {
    paymentIds: group.map((part) => part.id),
    customer,
    total: fromMinor(total),
    parts,
    orders,
    legacyAllocation,
    delivery,
    shift,
    advance,
    blockers: [...new Set(blockers)],
  };
}

/** To'lovni bekor qiladi. Chaqiruvchi tranzaksiya ichida (`writeInTenant`). */
export async function reverseCustomerPayment(tx: Tx, tenant: TenantContext, partId: string, reason: string, meta: RequestMeta) {
  const companyId = tenant.company.id;
  const cleanReason = reason.trim();
  if (cleanReason.length < 3) throw badRequest("Bekor qilish sababini yozing");
  const today = todayIso();
  await assertPeriodOpen(tx, companyId, today);

  // Qulflash tartibi tizimdagidek: to'lov qatorlari → mijoz → hujjatlar
  const group = await lockGroup(tx, companyId, partId, true);
  if (group.some((part) => part.status === "reversed")) throw conflict("To'lov allaqachon bekor qilingan");
  const deposits = group[0]!.paymentId
    ? (await lockHeaderDeposits(tx, group[0]!.paymentId, true)).filter((row) => row.status === "posted")
    : [];
  const customerId = group[0]!.customerId;
  if (customerId) await tx.select({ id: customers.id }).from(customers).where(eq(customers.id, customerId)).for("update");
  const effect = await buildEffect(tx, companyId, group);
  if (effect.blockers.length > 0) throw badRequest(effect.blockers.join("; "), { blockers: effect.blockers });

  const receivable = await requireAccountBySubtype(tx, companyId, "receivable", "asset", "Debitorlar");
  const party = customerId ? { type: "customer" as const, id: customerId } : null;
  const reversalEntries: string[] = [];

  for (const part of group) {
    const label = `To'lov bekor qilindi (${part.paymentDate}, ${part.method}): ${cleanReason}`;

    // 1) Hujjatlar: to'langan summa qaytadi
    const { releases } = await orderReleases(tx, companyId, part);
    for (const release of releases) {
      await tx
        .update(salesOrders)
        .set({ paidAmount: sql`greatest(${salesOrders.paidAmount} - ${fromMinor(release.amount)}::numeric, 0)`, updatedAt: new Date() })
        .where(eq(salesOrders.id, release.orderId));
    }

    // 2) Pul va jurnal (teskari yozuv — asl yozuv o'zgarmaydi)
    let counterAccount: string;
    if (part.method === "balance") {
      counterAccount = await ensureAccountBySubtype(tx, companyId, "customer_advance");
      const [row] = await tx
        .update(customers)
        .set({ balance: sql`${customers.balance} + ${part.amount}::numeric`, updatedAt: new Date() })
        .where(eq(customers.id, part.customerId!))
        .returning({ balance: customers.balance });
      await tx.insert(customerBalanceTransactions).values({
        companyId,
        customerId: part.customerId!,
        type: "refund",
        amount: part.amount,
        balanceAfter: row!.balance,
        orderId: part.orderId,
        paymentId: part.id,
        notes: label,
        createdBy: tenant.user.id,
        createdAt: new Date(),
      });
    } else if (part.method === "cashback") {
      counterAccount = await ensureAccountBySubtype(tx, companyId, "cashback_liability");
      const [row] = await tx
        .update(customers)
        .set({ cashbackBalance: sql`${customers.cashbackBalance} + ${part.amount}::numeric`, updatedAt: new Date() })
        .where(eq(customers.id, part.customerId!))
        .returning({ balance: customers.cashbackBalance });
      await tx.insert(customerCashbackTransactions).values({
        companyId,
        customerId: part.customerId!,
        type: "redeem_refund",
        amount: part.amount,
        balanceAfter: row!.balance,
        orderId: part.orderId,
        paymentId: part.id,
        notes: label,
        createdBy: tenant.user.id,
      });
    } else if (MONEY_METHODS.has(part.method) && part.cashAccountId) {
      // Komissiya qaytadi (bank uni to'lov bilan birga qaytaradi) — keyin mijozga to'liq summa chiqadi
      const [fee] = await tx
        .select({ id: expenses.id, amount: expenses.amount, accountId: expenses.accountId })
        .from(expenses)
        .where(and(eq(expenses.companyId, companyId), eq(expenses.referenceType, "customer_payment"), eq(expenses.referenceId, part.id)))
        .limit(1);
      if (fee) {
        const { account } = await recordCashTransaction(tx, companyId, tenant.user.id, {
          cashAccountId: part.cashAccountId,
          type: "in",
          amount: fee.amount,
          txDate: today,
          description: `Komissiya qaytdi: ${label}`,
          category: "Bank komissiyasi",
          referenceType: "bank_fee_reversal",
          referenceId: fee.id,
        });
        await postJournalEntry(tx, companyId, tenant.user.id, {
          entryDate: today,
          description: `Komissiya qaytdi: ${label}`,
          referenceType: "bank_fee_reversal",
          referenceId: fee.id,
          lines: [
            { accountId: await ledgerAccountFor(tx, companyId, account), debit: fee.amount },
            { accountId: fee.accountId ?? (await ensureAccountBySubtype(tx, companyId, "bank_fees")), credit: fee.amount },
          ],
        });
      }
      // Valyutali to'lov: kassadan o'sha valyutada, asl summada chiqadi (`foreign_amount` > 0 faqat valyutalida)
      const foreign = toMinor(part.foreignAmount) > 0n;
      const { account } = await recordCashTransaction(tx, companyId, tenant.user.id, {
        cashAccountId: part.cashAccountId,
        type: "out",
        amount: foreign ? part.foreignAmount : part.amount,
        currency: part.currency,
        txDate: today,
        description: label,
        category: "sales",
        referenceType: "customer_payment_reversal",
        referenceId: part.id,
      });
      counterAccount = await ledgerAccountFor(tx, companyId, account);
    } else {
      throw badRequest(`To'lov usuli (${part.method}) bo'yicha bekor qilish qo'llab-quvvatlanmaydi`);
    }

    const { entry } = await postJournalEntry(tx, companyId, tenant.user.id, {
      party,
      entryDate: today,
      description: label,
      referenceType: "customer_payment_reversal",
      referenceId: part.id,
      // Asl yozuvning (DR pul / CR debitor) aynan teskarisi — asl summada, kurs farqisiz
      lines: [
        { accountId: receivable, debit: part.amount },
        { accountId: counterAccount, credit: part.amount },
      ],
    });
    reversalEntries.push(entry.id);

    await tx
      .update(customerPayments)
      .set({
        status: "reversed",
        reversedAt: new Date(),
        reversedBy: tenant.user.id,
        reversalReason: cleanReason,
        reversalJournalEntryId: entry.id,
        updatedAt: new Date(),
      })
      .where(eq(customerPayments.id, part.id));
  }

  // 3) Mijoz qarzi — to'lov bekor bo'lgach qarz qaytadi
  const total = group.reduce((sum, part) => sum + toMinor(part.amount), 0n);
  if (customerId) {
    await tx
      .update(customers)
      .set({ totalDebt: sql`${customers.totalDebt} + ${fromMinor(total)}::numeric`, updatedAt: new Date() })
      .where(eq(customers.id, customerId));
  }

  // 4) Kassa smenasi hisoblagichi — smena ochiq bo'lsa (yopilgan smena tarixi o'zgarmaydi)
  if (effect.shift?.open) {
    for (const part of group) {
      const column = part.method === "cash" ? posShifts.totalCash : part.method === "card" ? posShifts.totalCard : part.method === "balance" || part.method === "cashback" ? null : posShifts.totalBank;
      const key = part.method === "cash" ? "totalCash" : part.method === "card" ? "totalCard" : "totalBank";
      if (!column) continue;
      await tx
        .update(posShifts)
        .set({ [key]: sql`greatest(${column} - ${part.amount}::numeric, 0)`, updatedAt: new Date() })
        .where(eq(posShifts.id, effect.shift.id));
    }
  }

  // 5) Yetkazmada yig'ilgan summa
  for (const link of effect.delivery) {
    await tx.update(deliveryTasks).set({ collectedAmount: link.collectedAfter, updatedAt: new Date() }).where(eq(deliveryTasks.id, link.taskId));
  }

  // 6) Bank tushumining avans qismi — teskari yozuvlar, hamyon kamayadi
  if (deposits.length > 0) reversalEntries.push(...(await reverseDepositRows(tx, tenant, deposits, cleanReason)));

  // 7) To'lov hujjati (aralash to'lov sarlavhasi)
  const headerId = group[0]!.paymentId;
  if (headerId) {
    await tx
      .update(payments)
      .set({ status: "reversed", reversedAt: new Date(), reversedBy: tenant.user.id, reversalReason: cleanReason })
      .where(eq(payments.id, headerId));
  }

  await salesAudit(tx, tenant, meta, {
    action: "CUSTOMER_PAYMENT_REVERSED",
    resource: "customer_payments",
    resourceId: partId,
    details: {
      reason: cleanReason,
      total: fromMinor(total),
      paymentIds: effect.paymentIds,
      headerId,
      customerId,
      orders: effect.orders,
      delivery: effect.delivery,
      reversalJournalEntries: reversalEntries,
      legacyAllocation: effect.legacyAllocation,
    },
  });

  return { ...effect, reversalJournalEntries: reversalEntries, blockers: [] };
}
