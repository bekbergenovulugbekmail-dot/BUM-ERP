/**
 * POS: kassa smenalari va chek (convex/sales/pos.ts).
 *
 * Chek bitta tranzaksiyada: buyurtma (`isPos`), zaxira chiqimi va sotuv jurnali
 * (`dispatchOrder`), to'lov (`recordCustomerPayment` — kassa/bank + jurnal), smena yig'indilari.
 *
 * Convex'dan farqlar:
 *  - chek ombori mijozdan kelardi — smenadagidan boshqa ombordan sotish mumkin edi; endi smena ombori
 *  - zaxira yetmasa jimgina 0 ga tushirilardi, qoldig'i yo'q mahsulot ham "sotilardi" — endi xato
 *  - narx va chegirma mijozdan kelardi — kassir istalgan narxda sotardi; endi prays-list, o'zgartirish `sales.edit`
 *  - soliq doim narx ustiga qo'shilardi — `taxIncluded` mahsulotda mijoz soliqni ortiqcha to'lardi
 *  - qisman to'lovda ham jurnal kassani to'liq summaga debetlardi; mijozsiz qarzga sotish mumkin edi
 *  - karta to'lovi naqd kassaga yozilardi — endi bank hisobiga
 *  - smenani istalgan foydalanuvchi yopardi, yopilgan smena qayta yopilardi, kassa farqi hisoblanmasdi;
 *    ombor ruxsati tekshirilmasdi; `cashierName` mijozdan kelardi, `cashierId` yozilmasdi
 *  - `getShifts` / `getOpenShift` ruxsat tekshirmasdi — `pos.use`
 */
import { and, desc, eq, getTableColumns, inArray, sql } from "drizzle-orm";
import { badRequest, conflict, forbidden, notFound } from "@bum/shared";
import { products } from "../../db/schema/catalog.js";
import { warehouses } from "../../db/schema/inventory.js";
import { customers, posShifts, salesOrders } from "../../db/schema/sales.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import type { RequestMeta } from "../../shared/audit.js";
import { fromMinor, mulDivRound, toMinor } from "../../shared/decimal.js";
import { nextDocumentNumber } from "../../shared/numbering.js";
import { effectivePermissions, type TenantContext } from "../company/tenant.js";
import { companyCurrency } from "../finance/accounts.service.js";
import { currencyRate } from "../finance/currencies.service.js";
import { todayIso, type PaymentMethod } from "../finance/cash.service.js";
import { assertWarehouseAccess } from "../inventory/warehouses.service.js";
import { computeCashback, earnCashback, getCashbackSettings, maxCashbackUsage, redeemCashback } from "./cashback.service.js";
import { customerSummary, depositToBalance, payFromBalance } from "./customer-balance.service.js";
import { createCustomer, salesAudit, type CustomerInput } from "./customers.service.js";
import {
  dispatchOrder,
  getOrder,
  insertSalesItems,
  prepareSalesItems,
  type SalesItemInput,
  type SalesItemRow,
} from "./orders.service.js";
import { recordCustomerPayment } from "./payments.service.js";

const { legacyId: _legacyId, companyId: _companyId, ...shiftFields } = getTableColumns(posShifts);
const expectedCashSql = sql<string>`(${posShifts.openingCash} + ${posShifts.totalCash})::numeric(18,2)`;

export type ShiftStatus = (typeof posShifts.status.enumValues)[number];

export async function getShift(conn: DbOrTx, tenant: TenantContext, shiftId: string) {
  const [shift] = await conn
    .select({ ...shiftFields, warehouseName: warehouses.name, expectedCash: expectedCashSql })
    .from(posShifts)
    .innerJoin(warehouses, eq(warehouses.id, posShifts.warehouseId))
    .where(and(eq(posShifts.id, shiftId), eq(posShifts.companyId, tenant.company.id)))
    .limit(1);
  if (!shift) throw notFound("Smena topilmadi");
  return shift;
}

export async function getOpenShift(conn: DbOrTx, tenant: TenantContext, warehouseId: string) {
  assertWarehouseAccess(tenant, warehouseId);
  const [shift] = await conn
    .select({ ...shiftFields, warehouseName: warehouses.name, expectedCash: expectedCashSql })
    .from(posShifts)
    .innerJoin(warehouses, eq(warehouses.id, posShifts.warehouseId))
    .where(
      and(eq(posShifts.companyId, tenant.company.id), eq(posShifts.warehouseId, warehouseId), eq(posShifts.status, "open")),
    )
    .limit(1);
  return shift ?? null;
}

export async function listShifts(
  conn: DbOrTx,
  tenant: TenantContext,
  options: { warehouseId?: string; status?: ShiftStatus; limit: number },
) {
  if (options.warehouseId) assertWarehouseAccess(tenant, options.warehouseId);
  return conn
    .select({ ...shiftFields, warehouseName: warehouses.name, expectedCash: expectedCashSql })
    .from(posShifts)
    .innerJoin(warehouses, eq(warehouses.id, posShifts.warehouseId))
    .where(
      and(
        eq(posShifts.companyId, tenant.company.id),
        options.warehouseId ? eq(posShifts.warehouseId, options.warehouseId) : undefined,
        options.status ? eq(posShifts.status, options.status) : undefined,
      ),
    )
    .orderBy(desc(posShifts.openedAt))
    .limit(options.limit);
}

export async function openShift(
  tx: Tx,
  tenant: TenantContext,
  input: { warehouseId: string; openingCash: string; notes?: string | null },
  meta: RequestMeta,
) {
  const companyId = tenant.company.id;
  const [warehouse] = await tx
    .select({ isActive: warehouses.isActive })
    .from(warehouses)
    .where(and(eq(warehouses.id, input.warehouseId), eq(warehouses.companyId, companyId)))
    .limit(1);
  if (!warehouse) throw badRequest("Ombor topilmadi");
  if (!warehouse.isActive) throw badRequest("Ombor faol emas");
  assertWarehouseAccess(tenant, input.warehouseId);

  const [existing] = await tx
    .select({ id: posShifts.id })
    .from(posShifts)
    .where(and(eq(posShifts.companyId, companyId), eq(posShifts.warehouseId, input.warehouseId), eq(posShifts.status, "open")))
    .limit(1);
  if (existing) throw conflict("Bu omborda smena allaqachon ochiq");

  const [shift] = await tx
    .insert(posShifts)
    .values({
      companyId,
      warehouseId: input.warehouseId,
      cashierId: tenant.user.id,
      cashierName: tenant.user.name,
      openedAt: new Date(),
      openingCash: input.openingCash,
      notes: input.notes ?? null,
    })
    .returning({ id: posShifts.id });

  await salesAudit(tx, tenant, meta, {
    action: "POS_SHIFT_OPENED",
    resource: "pos_shifts",
    resourceId: shift!.id,
    details: { warehouseId: input.warehouseId, openingCash: input.openingCash },
  });
  return getShift(tx, tenant, shift!.id);
}

async function lockShift(tx: Tx, tenant: TenantContext, shiftId: string) {
  const [shift] = await tx
    .select(shiftFields)
    .from(posShifts)
    .where(and(eq(posShifts.id, shiftId), eq(posShifts.companyId, tenant.company.id)))
    .limit(1)
    .for("update");
  if (!shift) throw notFound("Smena topilmadi");
  return shift;
}

/** Smenada kassirning o'zi yoki `sales.approve` ruxsatli menejer ishlaydi. */
async function assertShiftOperator(conn: DbOrTx, tenant: TenantContext, cashierId: string | null) {
  if (cashierId === tenant.user.id) return;
  if (!(await effectivePermissions(conn, tenant)).includes("sales.approve")) {
    throw forbidden("Bu smena boshqa kassirga tegishli");
  }
}

export async function closeShift(
  tx: Tx,
  tenant: TenantContext,
  shiftId: string,
  input: { closingCash: string; notes?: string | null },
  meta: RequestMeta,
) {
  const shift = await lockShift(tx, tenant, shiftId);
  if (shift.status !== "open") throw badRequest("Smena allaqachon yopilgan");
  await assertShiftOperator(tx, tenant, shift.cashierId);

  const expected = toMinor(shift.openingCash) + toMinor(shift.totalCash);
  const difference = toMinor(input.closingCash) - expected;
  await tx
    .update(posShifts)
    .set({
      status: "closed",
      closedAt: new Date(),
      closingCash: input.closingCash,
      notes: input.notes ?? shift.notes,
      updatedAt: new Date(),
    })
    .where(eq(posShifts.id, shiftId));

  await salesAudit(tx, tenant, meta, {
    action: "POS_SHIFT_CLOSED",
    resource: "pos_shifts",
    resourceId: shiftId,
    details: { expectedCash: fromMinor(expected), closingCash: input.closingCash, difference: fromMinor(difference) },
  });
  return { shift: await getShift(tx, tenant, shiftId), expectedCash: fromMinor(expected), difference: fromMinor(difference) };
}

type SaleBucket = { currency: string; rate: string; total: bigint; base: bigint };

/**
 * Qatorlarga chek valyutasini beradi: mahsulot narx valyutasi tanlanganlar ichida bo'lsa — o'sha, aks holda
 * birinchi tanlangan valyuta. Valyutadagi summa = asosiy summa / kurs (tiyinga yaxlitlab). Valyuta bo'yicha
 * asosiy qiymat — qatorlar yig'indisi: valyutadagi jami to'liq to'lansa aynan shu yopiladi.
 */
async function assignSaleCurrencies(
  tx: Tx,
  companyId: string,
  baseCurrency: string,
  saleCurrencies: string[],
  items: SalesItemRow[],
) {
  const rates = new Map<string, string>([[baseCurrency, "1.0000"]]);
  for (const code of saleCurrencies) {
    if (!rates.has(code)) rates.set(code, await currencyRate(tx, companyId, code));
  }
  const productRows = await tx
    .select({ id: products.id, salesCurrency: products.salesCurrency })
    .from(products)
    .where(inArray(products.id, [...new Set(items.map((item) => item.productId))]));
  const ownCurrency = new Map(productRows.map((row) => [row.id, row.salesCurrency ?? baseCurrency]));

  const buckets = new Map<string, SaleBucket>();
  for (const item of items) {
    const own = ownCurrency.get(item.productId) ?? baseCurrency;
    const code = saleCurrencies.includes(own) ? own : saleCurrencies[0]!;
    const rate = rates.get(code)!;
    const baseLine = toMinor(item.lineTotal);
    const currencyLine = code === baseCurrency ? baseLine : mulDivRound(baseLine, 10_000n, toMinor(rate, 4));
    item.priceCurrency = code === baseCurrency ? null : code;
    item.priceRate = rate;
    item.currencyTotal = fromMinor(currencyLine);
    const bucket = buckets.get(code) ?? { currency: code, rate, total: 0n, base: 0n };
    bucket.total += currencyLine;
    bucket.base += baseLine;
    buckets.set(code, bucket);
  }
  return buckets;
}

export async function completeSale(
  tx: Tx,
  tenant: TenantContext,
  input: {
    shiftId: string;
    customerId?: string | null;
    items: SalesItemInput[];
    paymentMethod: PaymentMethod;
    amountPaid: string;
    /** Mijoz keshbekidan yechiladigan qism — sozlamadagi chek ulushi chegarasida. */
    cashbackAmount?: string | null;
    /** Mijoz balansidan yechiladigan qism — naqd/karta to'lovidan oldin qo'llanadi. */
    balanceAmount?: string | null;
    /** Naqd qaytim mijozga berilmaydi, kassada qolib mijoz balansiga yoziladi. */
    changeToBalance?: boolean;
    /** Sotuv valyutalari: mahsulot o'z narx valyutasida, u tanlanmagan bo'lsa birinchi valyutada. Standart — asosiy. */
    saleCurrencies?: string[];
    /** Chet valyutadagi naqd to'lovlar (shu valyutadagi kassaga); asosiy valyutadagi qism — `amountPaid`. */
    currencyPayments?: { currency: string; amount: string }[];
    notes?: string | null;
  },
  meta: RequestMeta,
) {
  const companyId = tenant.company.id;
  const shift = await lockShift(tx, tenant, input.shiftId);
  if (shift.status !== "open") throw badRequest("Smena yopilgan");
  await assertShiftOperator(tx, tenant, shift.cashierId);
  assertWarehouseAccess(tenant, shift.warehouseId);

  let customerDiscount = "0";
  let customerBalance = 0n;
  let customerCashback = 0n;
  if (input.customerId) {
    const [customer] = await tx
      .select({
        discountPercent: customers.discountPercent,
        isActive: customers.isActive,
        balance: customers.balance,
        cashbackBalance: customers.cashbackBalance,
      })
      .from(customers)
      .where(and(eq(customers.id, input.customerId), eq(customers.companyId, companyId)))
      .limit(1);
    if (!customer) throw badRequest("Mijoz topilmadi");
    if (!customer.isActive) throw badRequest("Mijoz faol emas");
    customerDiscount = customer.discountPercent;
    customerBalance = toMinor(customer.balance);
    customerCashback = toMinor(customer.cashbackBalance);
  }

  const { items, totals } = await prepareSalesItems(tx, tenant, input.items, customerDiscount);
  const total = toMinor(totals.totalAmount);
  const cashbackSettings = input.customerId ? await getCashbackSettings(tx, companyId) : null;

  // Chek valyutalari; buxgalteriya asosiy valyutada, to'lov har valyuta bo'yicha
  const baseCurrency = await companyCurrency(tx, companyId);
  const saleCurrencies = [...new Set(input.saleCurrencies?.length ? input.saleCurrencies : [baseCurrency])];
  const saleItems: SalesItemRow[] = items;
  const buckets = await assignSaleCurrencies(tx, companyId, baseCurrency, saleCurrencies, saleItems);
  const baseTotal = buckets.get(baseCurrency)?.base ?? 0n;

  const fromCashback = input.cashbackAmount ? toMinor(input.cashbackAmount) : 0n;
  if (fromCashback > 0n) {
    if (!input.customerId || !cashbackSettings) throw badRequest("Keshbekdan foydalanish uchun mijoz tanlanishi kerak");
    if (!cashbackSettings.enabled) throw badRequest("Keshbek tizimi o'chirilgan");
    const limit = maxCashbackUsage(cashbackSettings, total);
    if (fromCashback > limit) {
      throw badRequest(`Keshbek bilan chekning ${cashbackSettings.maxUsagePercent}% igacha to'lash mumkin (${fromMinor(limit)})`);
    }
    if (fromCashback > customerCashback) {
      throw badRequest(`Mijozning keshbeki yetarli emas (keshbek ${fromMinor(customerCashback)})`);
    }
  }

  const fromBalance = input.balanceAmount ? toMinor(input.balanceAmount) : 0n;
  if ((fromBalance > 0n || input.changeToBalance) && !input.customerId) {
    throw badRequest("Mijoz balansidan foydalanish uchun mijoz tanlanishi kerak");
  }
  // Balans va keshbek asosiy valyutada — faqat chekning asosiy valyutadagi qismiga
  if (fromCashback + fromBalance > baseTotal) {
    throw badRequest(
      baseTotal === total
        ? "Balans va keshbekdan to'lov chek summasidan oshmasligi kerak"
        : `Balans va keshbekdan faqat ${baseCurrency} dagi qismga to'lanadi (${fromMinor(baseTotal)})`,
    );
  }
  if (fromBalance > customerBalance) {
    throw badRequest(`Mijoz balansida yetarli mablag' yo'q (balans ${fromMinor(customerBalance)})`);
  }

  // Keshbek va balansdan keyin qolgani naqd/karta bilan to'lanadi; yetmagani mijoz qarziga yoziladi
  const due = baseTotal - fromCashback - fromBalance;
  const tendered = toMinor(input.amountPaid);
  if (!buckets.has(baseCurrency) && tendered > 0n) {
    throw badRequest(`Chekda ${baseCurrency} dagi mahsulot yo'q — to'lov valyuta bo'yicha kiritiladi`);
  }
  if (input.paymentMethod !== "cash" && tendered > due) {
    throw badRequest("Karta yoki bank to'lovi chek summasidan oshmasligi kerak");
  }
  const paid = tendered < due ? tendered : due;
  const change = tendered - paid;
  if (!input.customerId && paid < due) throw badRequest("Mijozsiz sotuvda chek to'liq to'lanishi kerak");

  // Chet valyutadagi qismlar: naqd, shu valyutadagi kassaga; ortig'i — o'sha valyutada qaytim
  const tenderedByCurrency = new Map<string, bigint>();
  for (const payment of input.currencyPayments ?? []) {
    if (payment.currency === baseCurrency) {
      throw badRequest(`${baseCurrency} dagi to'lov asosiy to'lov maydonida kiritiladi`);
    }
    if (!buckets.has(payment.currency)) throw badRequest(`Chekda ${payment.currency} dagi mahsulot yo'q`);
    tenderedByCurrency.set(payment.currency, (tenderedByCurrency.get(payment.currency) ?? 0n) + toMinor(payment.amount));
  }
  const foreignParts = [...buckets.values()]
    .filter((bucket) => bucket.currency !== baseCurrency)
    .map((bucket) => {
      const given = tenderedByCurrency.get(bucket.currency) ?? 0n;
      const paidInCurrency = given < bucket.total ? given : bucket.total;
      // To'liq to'lansa — aynan valyuta qismining asosiy qiymati (yaxlitlash qoldig'isiz)
      const paidBase =
        paidInCurrency === bucket.total ? bucket.base : mulDivRound(paidInCurrency, toMinor(bucket.rate, 4), 10_000n);
      return { ...bucket, given, paid: paidInCurrency, change: given - paidInCurrency, paidBase };
    });
  for (const part of foreignParts) {
    if (!input.customerId && part.paid < part.total) {
      throw badRequest(`Mijozsiz sotuvda ${part.currency} qismi to'liq to'lanishi kerak`);
    }
  }
  const foreignPaidBase = foreignParts.reduce((sum, part) => sum + part.paidBase, 0n);

  const today = todayIso();
  const number = await nextDocumentNumber(tx, {
    table: salesOrders,
    column: salesOrders.number,
    companyColumn: salesOrders.companyId,
    companyId,
    prefix: `SO-${today.slice(0, 4)}-`,
    width: 4,
  });

  const [order] = await tx
    .insert(salesOrders)
    .values({
      companyId,
      number,
      customerId: input.customerId ?? null,
      warehouseId: shift.warehouseId,
      status: "confirmed",
      orderDate: today,
      currency: await companyCurrency(tx, companyId),
      ...totals,
      isPos: true,
      posShiftId: shift.id,
      notes: input.notes ?? null,
      createdBy: tenant.user.id,
    })
    .returning({
      id: salesOrders.id,
      number: salesOrders.number,
      customerId: salesOrders.customerId,
      warehouseId: salesOrders.warehouseId,
      totalAmount: salesOrders.totalAmount,
      paidAmount: salesOrders.paidAmount,
      isPos: salesOrders.isPos,
    });
  await insertSalesItems(tx, companyId, order!.id, items);

  await dispatchOrder(tx, tenant, order!, today, paid + fromBalance + fromCashback + foreignPaidBase);
  await tx
    .update(salesOrders)
    .set({ status: total === 0n ? "delivered" : "shipped", updatedAt: new Date() })
    .where(eq(salesOrders.id, order!.id));

  if (fromCashback > 0n) {
    await redeemCashback(
      tx,
      tenant,
      { customerId: input.customerId!, orderId: order!.id, amount: fromMinor(fromCashback), date: today },
      meta,
    );
  }
  if (fromBalance > 0n) {
    await payFromBalance(
      tx,
      tenant,
      { customerId: input.customerId!, orderId: order!.id, amount: fromMinor(fromBalance), posShiftId: shift.id, date: today },
      meta,
    );
  }
  const paidText = fromMinor(paid);
  if (paid > 0n) {
    await recordCustomerPayment(
      tx,
      tenant,
      { orderId: order!.id, amount: paidText, method: input.paymentMethod, paymentDate: today },
      meta,
    );
  }
  for (const part of foreignParts) {
    if (part.paid <= 0n) continue;
    await recordCustomerPayment(
      tx,
      tenant,
      {
        orderId: order!.id,
        amount: fromMinor(part.paidBase),
        currency: part.currency,
        foreignAmount: fromMinor(part.paid),
        method: "cash",
        paymentDate: today,
      },
      meta,
    );
  }

  // Qaytim kassada qoladi va mijoz balansiga yoziladi (faqat naqdda qaytim bo'ladi)
  let changeKept = 0n;
  if (input.changeToBalance && change > 0n) {
    await depositToBalance(
      tx,
      tenant,
      {
        customerId: input.customerId!,
        type: "change",
        amount: fromMinor(change),
        method: "cash",
        orderId: order!.id,
        posShiftId: shift.id,
        date: today,
      },
      meta,
    );
    changeKept = change;
  }
  // Keshbek: sozlamaga ko'ra butun chekka yoki faqat pul (naqd/karta/balans) bilan to'langan qismiga
  let cashbackEarned = 0n;
  if (input.customerId && cashbackSettings?.enabled) {
    const base = cashbackSettings.accrualBase === "total" ? total : paid + fromBalance + foreignPaidBase;
    cashbackEarned = await computeCashback(tx, companyId, cashbackSettings, items, total, base);
    await earnCashback(tx, tenant, {
      customerId: input.customerId,
      orderId: order!.id,
      orderNumber: number,
      amount: cashbackEarned,
      date: today,
    });
  }

  const cashIn = input.paymentMethod === "cash" ? paid + changeKept : 0n;

  await tx
    .update(posShifts)
    .set({
      totalSales: sql`${posShifts.totalSales} + ${totals.totalAmount}::numeric`,
      ...(cashIn > 0n ? { totalCash: sql`${posShifts.totalCash} + ${fromMinor(cashIn)}::numeric` } : {}),
      ...(input.paymentMethod === "card" ? { totalCard: sql`${posShifts.totalCard} + ${paidText}::numeric` } : {}),
      receiptCount: sql`${posShifts.receiptCount} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(posShifts.id, shift.id));

  const debt = due - paid + foreignParts.reduce((sum, part) => sum + (part.base - part.paidBase), 0n);
  // Valyuta bo'yicha natija — faqat chet valyuta qatnashgan chekda
  const currencyTotals =
    buckets.size > 1 || !buckets.has(baseCurrency)
      ? [...buckets.values()].map((bucket) => {
          const part = foreignParts.find((p) => p.currency === bucket.currency);
          return bucket.currency === baseCurrency
            ? {
                currency: bucket.currency,
                total: fromMinor(bucket.total),
                paid: fromMinor(paid + fromBalance + fromCashback),
                change: fromMinor(change),
              }
            : {
                currency: bucket.currency,
                total: fromMinor(bucket.total),
                paid: fromMinor(part?.paid ?? 0n),
                change: fromMinor(part?.change ?? 0n),
              };
        })
      : [];
  await salesAudit(tx, tenant, meta, {
    action: "POS_SALE_COMPLETED",
    resource: "sales_orders",
    resourceId: order!.id,
    details: {
      number,
      shiftId: shift.id,
      total: totals.totalAmount,
      paid: paidText,
      change: fromMinor(change),
      balanceUsed: fromMinor(fromBalance),
      changeToBalance: fromMinor(changeKept),
      debt: fromMinor(debt),
      cashbackUsed: fromMinor(fromCashback),
      cashbackEarned: fromMinor(cashbackEarned),
      ...(currencyTotals.length > 0 ? { currencyTotals } : {}),
    },
  });
  return {
    order: await getOrder(tx, tenant, order!.id),
    paid: paidText,
    /** Mijozga qo'lda qaytariladigan qaytim (balansga o'tgani ayirilgan). */
    change: fromMinor(change - changeKept),
    balanceUsed: fromMinor(fromBalance),
    changeToBalance: fromMinor(changeKept),
    /** Shu chekdan mijoz qarziga yozilgan summa. */
    debt: fromMinor(debt),
    cashbackUsed: fromMinor(fromCashback),
    cashbackEarned: fromMinor(cashbackEarned),
    /** Chet valyuta qatnashgan chekda: valyuta bo'yicha jami, to'langan va qaytim. */
    currencyTotals,
    customer: input.customerId ? await customerSummary(tx, companyId, input.customerId) : null,
  };
}

/** Kassada mijoz qo'shish (`pos.use`). Shu telefon raqamli mijoz bo'lsa — takror yaratilmaydi. */
export async function createPosCustomer(
  tx: Tx,
  tenant: TenantContext,
  input: Pick<CustomerInput, "name" | "phone" | "notes">,
  meta: RequestMeta,
) {
  // Oxirgi 9 raqam: "+998 90 123 45 67" va "901234567" — bitta raqam
  const digits = input.phone?.replace(/\D/g, "") ?? "";
  if (digits.length >= 9) {
    const key = digits.slice(-9);
    const [existing] = await tx
      .select({ name: customers.name })
      .from(customers)
      .where(
        and(
          eq(customers.companyId, tenant.company.id),
          sql`right(regexp_replace(coalesce(${customers.phone}, ''), '[^0-9]', '', 'g'), 9) = ${key}`,
        ),
      )
      .limit(1);
    if (existing) throw conflict(`Bu telefon raqamli mijoz bor: ${existing.name}`);
  }
  return createCustomer(tx, tenant, input, meta);
}

export type PosCustomerPaymentInput = {
  shiftId: string;
  customerId: string;
  /** deposit — balansni to'ldirish; debt — qarzni to'lash. */
  purpose: "deposit" | "debt";
  amount: string;
  /** `balance` — qarzni mijoz balansidan yopish (kassaga pul tushmaydi). */
  method: PaymentMethod | "balance";
  notes?: string | null;
};

/** Kassada mijoz balansini to'ldirish yoki qarzini to'lash; naqd/karta smena yig'indisiga qo'shiladi. */
export async function posCustomerPayment(tx: Tx, tenant: TenantContext, input: PosCustomerPaymentInput, meta: RequestMeta) {
  const shift = await lockShift(tx, tenant, input.shiftId);
  if (shift.status !== "open") throw badRequest("Smena yopilgan");
  await assertShiftOperator(tx, tenant, shift.cashierId);
  assertWarehouseAccess(tenant, shift.warehouseId);

  const notes = input.notes ?? null;
  if (input.method === "balance") {
    if (input.purpose !== "debt") throw badRequest("Balansni balansning o'zidan to'ldirib bo'lmaydi");
    await payFromBalance(tx, tenant, { customerId: input.customerId, amount: input.amount, posShiftId: shift.id, notes }, meta);
  } else if (input.purpose === "deposit") {
    await depositToBalance(
      tx,
      tenant,
      { customerId: input.customerId, type: "deposit", amount: input.amount, method: input.method, posShiftId: shift.id, notes },
      meta,
    );
  } else {
    await recordCustomerPayment(tx, tenant, { customerId: input.customerId, amount: input.amount, method: input.method, notes }, meta);
  }

  if (input.method === "cash" || input.method === "card") {
    await tx
      .update(posShifts)
      .set({
        ...(input.method === "cash"
          ? { totalCash: sql`${posShifts.totalCash} + ${input.amount}::numeric` }
          : { totalCard: sql`${posShifts.totalCard} + ${input.amount}::numeric` }),
        updatedAt: new Date(),
      })
      .where(eq(posShifts.id, shift.id));
  }
  return {
    customer: await customerSummary(tx, tenant.company.id, input.customerId),
    shift: await getShift(tx, tenant, shift.id),
  };
}
