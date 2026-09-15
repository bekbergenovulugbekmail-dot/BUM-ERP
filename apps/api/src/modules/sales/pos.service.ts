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
import { and, desc, eq, getTableColumns, inArray, isNull, sql } from "drizzle-orm";
import { AppError, badRequest, conflict, forbidden, notFound } from "@bum/shared";
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
import { allowedWarehouses, assertWarehouseAccess } from "../inventory/warehouses.service.js";
import { computeCashback, earnCashback, getCashbackSettings, maxCashbackUsage, redeemCashback } from "./cashback.service.js";
import { customerSummary, depositToBalance, payFromBalance } from "./customer-balance.service.js";
import { createCustomer, salesAudit, type CustomerInput } from "./customers.service.js";
import {
  assignSaleCurrencies,
  dispatchOrder,
  getOrder,
  insertSalesItems,
  prepareSalesItems,
  type SaleBucket,
  type SalesItemInput,
  type SalesItemRow,
} from "./orders.service.js";
import {
  createPaymentHeader,
  findPaymentByKey,
  recordAllocations,
  recordMixedCustomerPayment,
  resolvePaymentParts,
  settlePaymentParts,
  type PaymentPartInput,
} from "./payment-allocation.service.js";
import { recordCustomerPayment } from "./payments.service.js";
import { getSalesPolicy, notifyMembersWithPermission } from "./sales-policy.service.js";
import { addCurrencyAmounts } from "./shift-totals.js";

const { legacyId: _legacyId, companyId: _companyId, ...shiftFields } = getTableColumns(posShifts);
/** Kassada bo'lishi kerak: boshlang'ich + naqd tushum + kassaga kirimlar − chiqimlar (inkassatsiya, xarajat). */
const expectedCashSql = sql<string>`(${posShifts.openingCash} + ${posShifts.totalCash} + ${posShifts.cashIn} - ${posShifts.cashOut})::numeric(18,2)`;

export type ShiftStatus = (typeof posShifts.status.enumValues)[number];

export async function getShift(conn: DbOrTx, tenant: TenantContext, shiftId: string) {
  const [shift] = await conn
    .select({ ...shiftFields, warehouseName: warehouses.name, expectedCash: expectedCashSql })
    .from(posShifts)
    .innerJoin(warehouses, eq(warehouses.id, posShifts.warehouseId))
    .where(and(eq(posShifts.id, shiftId), eq(posShifts.companyId, tenant.company.id)))
    .limit(1);
  if (!shift) throw notFound("Smena topilmadi");
  // Ruxsat berilmagan ombor smenasi (kassa summalari) ko'rinmaydi
  assertWarehouseAccess(tenant, shift.warehouseId);
  return shift;
}

export async function getOpenShift(conn: DbOrTx, tenant: TenantContext, warehouseId: string) {
  assertWarehouseAccess(tenant, warehouseId);
  const [shift] = await conn
    .select({ ...shiftFields, warehouseName: warehouses.name, expectedCash: expectedCashSql })
    .from(posShifts)
    .innerJoin(warehouses, eq(warehouses.id, posShifts.warehouseId))
    .where(
      and(
        eq(posShifts.companyId, tenant.company.id),
        eq(posShifts.warehouseId, warehouseId),
        eq(posShifts.status, "open"),
        // Desktop kassa smenalari web kassaga ko'rinmaydi (har qurilmaning o'z smenasi)
        isNull(posShifts.deviceId),
      ),
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
  // Ombor tanlanmasa ham faqat ruxsat berilgan omborlar smenalari
  const allowed = allowedWarehouses(tenant);
  return conn
    .select({ ...shiftFields, warehouseName: warehouses.name, expectedCash: expectedCashSql })
    .from(posShifts)
    .innerJoin(warehouses, eq(warehouses.id, posShifts.warehouseId))
    .where(
      and(
        eq(posShifts.companyId, tenant.company.id),
        options.warehouseId ? eq(posShifts.warehouseId, options.warehouseId) : undefined,
        !options.warehouseId && allowed ? inArray(posShifts.warehouseId, allowed) : undefined,
        options.status ? eq(posShifts.status, options.status) : undefined,
      ),
    )
    .orderBy(desc(posShifts.openedAt))
    .limit(options.limit);
}

export async function openShift(
  tx: Tx,
  tenant: TenantContext,
  input: {
    warehouseId: string;
    openingCash: string;
    /** Chet valyutadagi boshlang'ich naqd (yoqilgan qo'shimcha valyutalar). */
    openingForeignCash?: { currency: string; amount: string }[];
    notes?: string | null;
    /** Desktop kassa (sinxron): qurilmada yaratilgan smena ID'si, ochilgan vaqti va qurilma. */
    id?: string;
    openedAt?: Date;
    deviceId?: string;
  },
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
    .where(
      and(
        eq(posShifts.companyId, companyId),
        eq(posShifts.status, "open"),
        input.deviceId ? eq(posShifts.deviceId, input.deviceId) : and(eq(posShifts.warehouseId, input.warehouseId), isNull(posShifts.deviceId)),
      ),
    )
    .limit(1);
  if (existing) throw conflict(input.deviceId ? "Bu kassada smena allaqachon ochiq" : "Bu omborda smena allaqachon ochiq");

  // Chet valyutadagi boshlang'ich naqd — faqat yoqilgan qo'shimcha valyutalar, har biri bir marta
  const baseCurrency = await companyCurrency(tx, companyId);
  const openingForeignCash: Record<string, string> = {};
  const seen = new Set<string>();
  for (const row of input.openingForeignCash ?? []) {
    if (row.currency === baseCurrency) throw badRequest(`${baseCurrency} dagi boshlang'ich naqd asosiy maydonda kiritiladi`);
    if (seen.has(row.currency)) throw badRequest(`${row.currency} bir marta kiritiladi`);
    seen.add(row.currency);
    await currencyRate(tx, companyId, row.currency);
    if (toMinor(row.amount) > 0n) openingForeignCash[row.currency] = fromMinor(toMinor(row.amount));
  }

  const [shift] = await tx
    .insert(posShifts)
    .values({
      ...(input.id ? { id: input.id } : {}),
      companyId,
      warehouseId: input.warehouseId,
      deviceId: input.deviceId ?? null,
      cashierId: tenant.user.id,
      cashierName: tenant.user.name,
      openedAt: input.openedAt ?? new Date(),
      openingCash: input.openingCash,
      openingForeignCash,
      notes: input.notes ?? null,
    })
    .returning({ id: posShifts.id });

  await salesAudit(tx, tenant, meta, {
    action: "POS_SHIFT_OPENED",
    resource: "pos_shifts",
    resourceId: shift!.id,
    details: { warehouseId: input.warehouseId, openingCash: input.openingCash, openingForeignCash },
  });
  return getShift(tx, tenant, shift!.id);
}

export async function lockShift(tx: Tx, tenant: TenantContext, shiftId: string) {
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
export async function assertShiftOperator(conn: DbOrTx, tenant: TenantContext, cashierId: string | null) {
  if (cashierId === tenant.user.id) return;
  if (!(await effectivePermissions(conn, tenant)).includes("sales.approve")) {
    throw forbidden("Bu smena boshqa kassirga tegishli");
  }
}

/** Offline hujjatdagi qurilma kurslari server kursidan farq qilsa — `rate_changed` nomuvofiqligi (hujjat rad etilmaydi). */
export async function offlineRateConflicts(
  conn: DbOrTx,
  companyId: string,
  rates: Record<string, string> | undefined,
): Promise<SaleConflict[]> {
  if (!rates) return [];
  const baseCurrency = await companyCurrency(conn, companyId);
  const conflicts: SaleConflict[] = [];
  for (const [code, deviceRate] of Object.entries(rates)) {
    if (code === baseCurrency) continue;
    const serverRate = await currencyRate(conn, companyId, code).catch((error: unknown) => {
      if (error instanceof AppError) return null;
      throw error;
    });
    if (serverRate === null || toMinor(serverRate, 4) !== toMinor(deviceRate, 4)) {
      conflicts.push({ kind: "rate_changed", details: { currency: code, deviceRate, serverRate } });
    }
  }
  return conflicts;
}

export async function closeShift(
  tx: Tx,
  tenant: TenantContext,
  shiftId: string,
  input: {
    closingCash: string;
    /** Kassada sanalgan chet valyuta naqdi; smenada shu valyutada naqd bo'lsa — majburiy. */
    closingForeignCash?: { currency: string; amount: string }[];
    notes?: string | null;
    /** Desktop kassa (sinxron): smena qurilmada yopilgan vaqt va qurilma. */
    closedAt?: Date;
    deviceId?: string;
  },
  meta: RequestMeta,
) {
  const shift = await lockShift(tx, tenant, shiftId);
  if (shift.status !== "open") throw badRequest("Smena allaqachon yopilgan");
  // Desktop smenasini web'dan yopib bo'lmaydi: qurilmada hali sinxron bo'lmagan cheklar bo'lishi mumkin
  if ((shift.deviceId ?? null) !== (input.deviceId ?? null)) {
    throw badRequest(shift.deviceId ? "Kassa qurilmasi smenasi faqat o'sha kassada yopiladi" : "Bu smena web kassaniki");
  }
  await assertShiftOperator(tx, tenant, shift.cashierId);

  const expected = toMinor(shift.openingCash) + toMinor(shift.totalCash) + toMinor(shift.cashIn) - toMinor(shift.cashOut);
  const difference = toMinor(input.closingCash) - expected;

  // Har chet valyuta alohida sanaladi: kutilgan = boshlang'ich + naqd tushum
  const counted = new Map<string, bigint>();
  for (const row of input.closingForeignCash ?? []) {
    if (counted.has(row.currency)) throw badRequest(`${row.currency} bir marta kiritiladi`);
    counted.set(row.currency, toMinor(row.amount));
  }
  const codes = [
    ...new Set([...Object.keys(shift.openingForeignCash), ...Object.keys(shift.foreignCash), ...counted.keys()]),
  ].sort();
  const foreignCash = codes.map((currency) => {
    const expectedAmount = toMinor(shift.openingForeignCash[currency] ?? "0") + toMinor(shift.foreignCash[currency] ?? "0");
    const countedAmount = counted.get(currency);
    if (countedAmount === undefined && expectedAmount !== 0n) throw badRequest(`Kassadagi ${currency} naqdini kiriting`);
    const actual = countedAmount ?? 0n;
    return {
      currency,
      expected: fromMinor(expectedAmount),
      counted: fromMinor(actual),
      difference: fromMinor(actual - expectedAmount),
    };
  });

  // Savdo siyosati: farq chegaradan oshsa (yoki chet valyutada farq bo'lsa) — rahbar ko'rib chiqadi
  const { shiftDifferenceTolerance } = await getSalesPolicy(tx, tenant.company.id);
  const absolute = difference < 0n ? -difference : difference;
  const needsReview = absolute > toMinor(shiftDifferenceTolerance) || foreignCash.some((row) => toMinor(row.difference) !== 0n);

  await tx
    .update(posShifts)
    .set({
      status: "closed",
      closedAt: input.closedAt ?? new Date(),
      closingCash: input.closingCash,
      closingForeignCash: foreignCash.length > 0 ? Object.fromEntries(foreignCash.map((row) => [row.currency, row.counted])) : null,
      cashDifference: fromMinor(difference),
      differenceReview: needsReview ? "pending" : null,
      notes: input.notes ?? shift.notes,
      updatedAt: new Date(),
    })
    .where(eq(posShifts.id, shiftId));

  await salesAudit(tx, tenant, meta, {
    action: "POS_SHIFT_CLOSED",
    resource: "pos_shifts",
    resourceId: shiftId,
    details: {
      expectedCash: fromMinor(expected),
      closingCash: input.closingCash,
      difference: fromMinor(difference),
      ...(foreignCash.length > 0 ? { foreignCash } : {}),
      ...(needsReview ? { review: "pending" } : {}),
    },
  });
  if (needsReview) {
    await notifyMembersWithPermission(tx, tenant.company.id, "sales.approve", {
      title: "Smena kassa farqini ko'rib chiqing",
      message: `${shift.cashierName ?? "Kassir"}: farq ${fromMinor(difference)} (kutilgan ${fromMinor(expected)}, sanalgan ${fromMinor(toMinor(input.closingCash))})${
        foreignCash.some((row) => toMinor(row.difference) !== 0n) ? ", valyutada ham farq bor" : ""
      }`,
      relatedType: "pos_shifts",
      relatedId: shiftId,
      link: "/settings",
      excludeUserId: shift.cashierId,
    });
  }
  return {
    shift: await getShift(tx, tenant, shiftId),
    expectedCash: fromMinor(expected),
    difference: fromMinor(difference),
    /** Valyuta bo'yicha kutilgan, sanalgan va farq. */
    foreignCash,
    /** `pending` — farq chegaradan oshdi, rahbar ko'rib chiqadi. */
    review: needsReview ? ("pending" as const) : null,
  };
}

/** Ko'rib chiqilishi kerak bo'lgan (yoki ko'rib chiqilgan) kassa farqli smenalar — `sales.approve`. */
export async function listShiftReviews(conn: DbOrTx, tenant: TenantContext, options: { status: "pending" | "approved" | "rejected"; limit: number }) {
  const allowed = allowedWarehouses(tenant);
  return conn
    .select({ ...shiftFields, warehouseName: warehouses.name, expectedCash: expectedCashSql })
    .from(posShifts)
    .innerJoin(warehouses, eq(warehouses.id, posShifts.warehouseId))
    .where(
      and(
        eq(posShifts.companyId, tenant.company.id),
        eq(posShifts.differenceReview, options.status),
        allowed ? inArray(posShifts.warehouseId, allowed) : undefined,
      ),
    )
    .orderBy(desc(posShifts.closedAt))
    .limit(options.limit);
}

/** Kassa farqini ko'rib chiqish: tasdiqlash yoki rad (izoh bilan). O'z smenasini — faqat kompaniya egasi. */
export async function reviewShiftDifference(
  tx: Tx,
  tenant: TenantContext,
  shiftId: string,
  input: { decision: "approved" | "rejected"; note?: string | null },
  meta: RequestMeta,
) {
  const shift = await lockShift(tx, tenant, shiftId);
  assertWarehouseAccess(tenant, shift.warehouseId);
  if (shift.differenceReview !== "pending") {
    throw new AppError("CONFLICT", "Bu smena farqi ko'rib chiqishni kutmayapti", { reason: "review_not_pending", review: shift.differenceReview });
  }
  if (shift.cashierId === tenant.user.id && tenant.membership.companyRole !== "owner") {
    throw new AppError("FORBIDDEN", "O'z smenangiz farqini boshqa rahbar ko'rib chiqadi", { reason: "self_review" });
  }
  const note = input.note?.trim() || null;
  if (input.decision === "rejected" && !note) throw badRequest("Rad etish sababini yozing");
  await tx
    .update(posShifts)
    .set({ differenceReview: input.decision, differenceReviewedBy: tenant.user.id, differenceReviewedAt: new Date(), differenceReviewNote: note, updatedAt: new Date() })
    .where(eq(posShifts.id, shiftId));
  await salesAudit(tx, tenant, meta, {
    action: "POS_SHIFT_DIFFERENCE_REVIEWED",
    resource: "pos_shifts",
    resourceId: shiftId,
    details: { decision: input.decision, difference: shift.cashDifference, note },
  });
  return getShift(tx, tenant, shiftId);
}

/** Desktop kassaning offline cheki: qurilmadagi ID, raqam (`K01-000123`), yopilgan vaqt, qator ID'lari va kurslar. */
export type OfflineSale = {
  id: string;
  number: string;
  soldAt: Date;
  deviceId: string;
  itemIds: string[];
  rates?: Record<string, string>;
};

/** Offline chek sinxronidagi nomuvofiqlik — chek baribir yoziladi, rahbar ko'rib chiqadi. */
export type SaleConflict = { kind: string; details: Record<string, unknown> };

const minBigInt = (...values: bigint[]) => values.reduce((a, b) => (b < a ? b : a));

type BasePaymentMethod = "cash" | "card" | "bank" | "transfer";

/** Kassadagi aralash to'lov qismi: karta — terminal bilan (pul terminalning bank hisobiga), yoki aniq kassa/bank hisobi. */
export type PosPaymentPart = { method: "cash" | "card" | "bank"; amount: string; terminalId?: string | null; cashAccountId?: string | null };

/** Asosiy valyutadagi to'lov qismlari: aralash (`payments`) yoki bitta usul (`paymentMethod` + `amountPaid`). */
function posPaymentParts(input: { payments?: PosPaymentPart[]; paymentMethod: PaymentMethod; amountPaid?: string }): PaymentPartInput[] {
  if (!input.payments || input.payments.length === 0) return [{ method: input.paymentMethod, amount: input.amountPaid ?? "0" }];
  return input.payments;
}

export async function completeSale(
  tx: Tx,
  tenant: TenantContext,
  input: {
    shiftId: string;
    customerId?: string | null;
    items: SalesItemInput[];
    paymentMethod: PaymentMethod;
    /** Bitta usulda berilgan summa (`payments` bo'lmasa). */
    amountPaid?: string;
    /**
     * Aralash to'lov (asosiy valyutada): naqd, karta (terminal bo'yicha — masalan UZCARD va HUMO alohida), bank; berilsa
     * `paymentMethod`/`amountPaid` e'tiborsiz. Jami chek summasidan oshmaydi — qaytim faqat bitta naqd to'lovda.
     */
    payments?: PosPaymentPart[];
    /** Nasiya: to'lanmagan qoldiq mijoz qarziga yoziladi (mijoz tanlangan bo'lishi shart). Belgilanmasa kam to'lov rad. */
    onCredit?: boolean;
    /** Web kassa so'rov kaliti: takroriy yuborishda ikkinchi chek, to'lov va jurnal yozilmaydi (409, chek raqami bilan). */
    clientRequestId?: string | null;
    /** Mijoz keshbekidan yechiladigan qism — sozlamadagi chek ulushi chegarasida. */
    cashbackAmount?: string | null;
    /** Mijoz balansidan yechiladigan qism — naqd/karta to'lovidan oldin qo'llanadi. */
    balanceAmount?: string | null;
    /** Naqd qaytim mijozga berilmaydi, kassada qolib mijoz balansiga yoziladi. */
    changeToBalance?: boolean;
    /** Sotuv valyutalari: mahsulot o'z narx valyutasida, u tanlanmagan bo'lsa birinchi valyutada. Standart — asosiy. */
    saleCurrencies?: string[];
    /**
     * Chet valyutadagi to'lovlar (har valyutaga bittadan): naqd — shu valyutadagi kassaga, ortig'i qaytim;
     * karta — shu valyutadagi bank hisobiga, qoldiqdan oshmaydi. Asosiy valyutadagi qism — `amountPaid`.
     */
    currencyPayments?: { currency: string; amount: string; method?: "cash" | "card" }[];
    notes?: string | null;
    /**
     * Desktop kassa sinxroni. Chek qurilmada allaqachon yopilgan (tovar va pul berilgan) — server rad etish o'rniga
     * nomuvofiqlikni qayd etadi: zaxira yetmasa (manfiy qoldiq), narx/kurs o'zgargan, mijoz faol emas, kredit limiti,
     * balans yoki keshbek yetmasa (farqi qarzga), smena yopilgan.
     */
    offline?: OfflineSale;
  },
  meta: RequestMeta,
) {
  const companyId = tenant.company.id;
  const offline = input.offline;
  const conflicts: SaleConflict[] = [];
  const shift = await lockShift(tx, tenant, input.shiftId);
  if (shift.status !== "open") {
    if (!offline) throw badRequest("Smena yopilgan");
    conflicts.push({ kind: "shift_closed", details: { shiftId: shift.id } });
  }
  // Web kassa desktop smenasiga (va aksincha) chek yoza olmaydi
  if ((shift.deviceId ?? null) !== (offline?.deviceId ?? null)) throw notFound("Smena topilmadi");
  await assertShiftOperator(tx, tenant, shift.cashierId);
  assertWarehouseAccess(tenant, shift.warehouseId);
  // Idempotentlik: bir xil so'rov smena qulfi ostida ketma-ket — ikkinchisi birinchi yozgan chekni ko'radi
  if (input.clientRequestId && !offline) {
    const [existing] = await tx
      .select({ id: salesOrders.id, number: salesOrders.number })
      .from(salesOrders)
      .where(and(eq(salesOrders.companyId, companyId), eq(salesOrders.clientRequestId, input.clientRequestId)))
      .limit(1);
    if (existing) {
      throw new AppError("CONFLICT", `Bu chek allaqachon yozilgan (${existing.number})`, { duplicate: true, orderId: existing.id, number: existing.number });
    }
  }

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
    if (!customer.isActive) {
      if (!offline) throw badRequest("Mijoz faol emas");
      conflicts.push({ kind: "customer_inactive", details: { customerId: input.customerId } });
    }
    customerDiscount = customer.discountPercent;
    customerBalance = toMinor(customer.balance);
    customerCashback = toMinor(customer.cashbackBalance);
  }

  if (offline && offline.itemIds.length !== input.items.length) throw badRequest("Chek qatorlari identifikatori noto'g'ri");
  // Offline chek: narx va chegirma qurilmadagi shartda (prays-listdan farqi — nomuvofiqlik), kurs — sotuv lahzasidagi
  const { items, totals, priceChanges, discountOverLimit } = await prepareSalesItems(
    tx,
    tenant,
    input.items,
    customerDiscount,
    offline
      ? { trustedPricing: true, rates: offline.rates, promoDate: offline.soldAt.toISOString().slice(0, 10) }
      : { promoDate: todayIso() },
  );
  if (priceChanges.length > 0) conflicts.push({ kind: "price_changed", details: { items: priceChanges } });
  if (discountOverLimit.length > 0) conflicts.push({ kind: "discount_over_limit", details: { items: discountOverLimit } });
  const total = toMinor(totals.totalAmount);
  const cashbackSettings = input.customerId ? await getCashbackSettings(tx, companyId) : null;

  // Chek valyutalari; buxgalteriya asosiy valyutada, to'lov har valyuta bo'yicha
  const baseCurrency = await companyCurrency(tx, companyId);
  const saleCurrencies = [...new Set(input.saleCurrencies?.length ? input.saleCurrencies : [baseCurrency])];
  conflicts.push(...(await offlineRateConflicts(tx, companyId, offline?.rates)));
  const saleItems: SalesItemRow[] = offline ? items.map((item, index) => ({ ...item, id: offline.itemIds[index]! })) : items;
  const buckets = await assignSaleCurrencies(tx, companyId, baseCurrency, saleCurrencies, saleItems, offline?.rates);
  const baseTotal = buckets.get(baseCurrency)?.base ?? 0n;

  let fromCashback = input.cashbackAmount ? toMinor(input.cashbackAmount) : 0n;
  if (offline && fromCashback > 0n) {
    // Offline: keshbek boshqa kassada ishlatilgan yoki sozlama o'zgargan bo'lishi mumkin — yetmagani qarzga
    const limit = cashbackSettings?.enabled ? maxCashbackUsage(cashbackSettings, total) : 0n;
    const allowed = minBigInt(fromCashback, customerCashback, limit);
    if (allowed < fromCashback) {
      conflicts.push({ kind: "cashback_insufficient", details: { requested: fromMinor(fromCashback), applied: fromMinor(allowed) } });
      fromCashback = allowed;
    }
  }
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

  let fromBalance = input.balanceAmount ? toMinor(input.balanceAmount) : 0n;
  if (offline && fromBalance > 0n && input.customerId) {
    // Offline: balans boshqa kassada sarflangan bo'lishi mumkin — yetmagani qarzga
    const allowed = minBigInt(fromBalance, customerBalance, total - fromCashback);
    if (allowed < fromBalance) {
      conflicts.push({ kind: "balance_insufficient", details: { requested: fromMinor(fromBalance), applied: fromMinor(allowed) } });
      fromBalance = allowed;
    }
  }
  if ((fromBalance > 0n || input.changeToBalance) && !input.customerId) {
    throw badRequest("Mijoz balansidan foydalanish uchun mijoz tanlanishi kerak");
  }
  if (fromCashback + fromBalance > total) throw badRequest("Balans va keshbekdan to'lov chek summasidan oshmasligi kerak");
  if (fromBalance > customerBalance) {
    throw badRequest(`Mijoz balansida yetarli mablag' yo'q (balans ${fromMinor(customerBalance)})`);
  }

  // Balans va keshbek (asosiy valyutada): avval asosiy valyutadagi qismga, qolgani chet valyuta qismlariga — asosiy qiymatda
  const nonCash = fromCashback + fromBalance;
  const baseCovered = nonCash < baseTotal ? nonCash : baseTotal;
  let uncovered = nonCash - baseCovered;

  // Keshbek va balansdan keyin qolgani naqd/karta/bank bilan (aralash ham) — universal taqsimot qoidalari
  // (`payment-allocation.service.ts`): terminal va hisob shu kompaniyaniki; karta/bank qoldiqdan oshmaydi; ortiqcha to'lov
  // rad, qaytim faqat bitta naqd to'lovda; kam to'lov — faqat mijoz tanlanib nasiya (`onCredit`) belgilanganda.
  // Offline chek qurilmada yopilgan (pul va qaytim berilgan) — qaytim va qarz rad etilmaydi
  const due = baseTotal - baseCovered;
  const requestedParts = await resolvePaymentParts(tx, companyId, posPaymentParts(input), { offline: offline !== undefined });
  const tendered = requestedParts.reduce((sum, part) => sum + part.amount, 0n);
  if (!buckets.has(baseCurrency) && tendered > 0n) {
    throw badRequest(`Chekda ${baseCurrency} dagi mahsulot yo'q — to'lov valyuta bo'yicha kiritiladi`);
  }
  const singleCash = requestedParts.length === 1 && requestedParts[0]!.method === "cash";
  const creditAllowed = !!input.customerId && (offline !== undefined || input.onCredit === true);
  const { allocations, change, paid } = settlePaymentParts(requestedParts, due, {
    allowCashChange: offline !== undefined || singleCash,
    allowShortfall: creditAllowed,
    shortfallMessage: input.customerId
      ? (remaining) => `To'lov to'liq emas: qoldiq ${remaining} — qarzga yozish uchun nasiya belgilanadi`
      : "Mijozsiz sotuvda chek to'liq to'lanishi kerak",
  });
  const cashPaid = allocations.reduce((sum, part) => sum + (part.method === "cash" ? part.amount : 0n), 0n);

  // Chet valyutadagi qismlar: naqd (ortig'i — o'sha valyutada qaytim) yoki karta; shu valyutadagi kassa/bankka
  const tenderedByCurrency = new Map<string, { amount: bigint; method: "cash" | "card" }>();
  for (const payment of input.currencyPayments ?? []) {
    if (payment.currency === baseCurrency) {
      throw badRequest(`${baseCurrency} dagi to'lov asosiy to'lov maydonida kiritiladi`);
    }
    if (!buckets.has(payment.currency)) throw badRequest(`Chekda ${payment.currency} dagi mahsulot yo'q`);
    if (tenderedByCurrency.has(payment.currency)) throw badRequest(`${payment.currency} bo'yicha to'lov bir marta kiritiladi`);
    tenderedByCurrency.set(payment.currency, { amount: toMinor(payment.amount), method: payment.method ?? "cash" });
  }
  const foreignParts: (SaleBucket & {
    method: "cash" | "card";
    covered: bigint;
    due: bigint;
    dueBase: bigint;
    paid: bigint;
    change: bigint;
    paidBase: bigint;
  })[] = [];
  for (const bucket of buckets.values()) {
    if (bucket.currency === baseCurrency) continue;
    const rate = toMinor(bucket.rate, 4);
    const coveredBase = uncovered < bucket.base ? uncovered : bucket.base;
    uncovered -= coveredBase;
    const dueBase = bucket.base - coveredBase;
    // Balans yopmagan qism valyutada; to'liq yopilsa yoki umuman tegilmasa — yaxlitlashsiz
    const dueInCurrency = coveredBase === 0n ? bucket.total : dueBase === 0n ? 0n : mulDivRound(dueBase, 10_000n, rate);
    const tender = tenderedByCurrency.get(bucket.currency) ?? { amount: 0n, method: "cash" as const };
    if (tender.method === "card" && tender.amount > dueInCurrency) {
      throw badRequest(`${bucket.currency} karta to'lovi qoldiqdan oshmasligi kerak (${fromMinor(dueInCurrency)})`);
    }
    const paidInCurrency = tender.amount < dueInCurrency ? tender.amount : dueInCurrency;
    // To'liq to'lansa — aynan qolgan asosiy qiymat (yaxlitlash qoldig'isiz)
    const computedBase = paidInCurrency === dueInCurrency ? dueBase : mulDivRound(paidInCurrency, rate, 10_000n);
    foreignParts.push({
      ...bucket,
      method: tender.method,
      covered: bucket.total - dueInCurrency,
      due: dueInCurrency,
      dueBase,
      paid: paidInCurrency,
      change: tender.amount - paidInCurrency,
      paidBase: computedBase < dueBase ? computedBase : dueBase,
    });
  }
  for (const part of foreignParts) {
    if (!input.customerId && part.paid < part.due) {
      throw badRequest(`Mijozsiz sotuvda ${part.currency} qismi to'liq to'lanishi kerak`);
    }
    if (!creditAllowed && part.paid < part.due) {
      throw badRequest(`${part.currency} qismi to'liq to'lanmagan — qarzga yozish uchun nasiya belgilanadi`, { reason: "underpayment" });
    }
  }
  const foreignPaidBase = foreignParts.reduce((sum, part) => sum + part.paidBase, 0n);

  const today = offline ? offline.soldAt.toISOString().slice(0, 10) : todayIso();
  const number = offline
    ? offline.number
    : await nextDocumentNumber(tx, {
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
      ...(offline ? { id: offline.id, deviceId: offline.deviceId, createdAt: offline.soldAt } : {}),
      ...(input.clientRequestId && !offline ? { clientRequestId: input.clientRequestId } : {}),
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
  await insertSalesItems(tx, companyId, order!.id, saleItems);

  const dispatched = await dispatchOrder(
    tx,
    tenant,
    order!,
    today,
    paid + fromBalance + fromCashback + foreignPaidBase,
    offline ? { allowNegativeStock: true, skipCreditLimit: true, occurredAt: offline.soldAt } : {},
  );
  if (dispatched.shortages.length > 0) {
    conflicts.push({ kind: "stock_shortage", details: { warehouseId: shift.warehouseId, items: dispatched.shortages } });
  }
  if (dispatched.creditLimit) conflicts.push({ kind: "credit_limit", details: { customerId: input.customerId, ...dispatched.creditLimit } });
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
  // To'lov hujjati va qismlari: har qism — o'z kassa/bank hisobi (karta terminali — uning bank hisobi), kassa harakati
  // va jurnal yozuvi bilan. Hujjat kaliti — web so'rov kaliti yoki desktop chek ID'si (takroriy yuborishda ikkinchisi yo'q)
  const paymentTotal = paid + foreignParts.reduce((sum, part) => sum + (part.paid > 0n ? part.paidBase : 0n), 0n);
  const paymentHeader =
    paymentTotal > 0n
      ? await createPaymentHeader(tx, tenant, {
          source: offline ? "pos_device" : "pos",
          idempotencyKey: offline ? `pos_device:${offline.id}` : input.clientRequestId ? `pos:${input.clientRequestId}` : null,
          customerId: input.customerId ?? null,
          orderId: order!.id,
          total: paymentTotal,
        })
      : null;
  if (paymentHeader) await recordAllocations(tx, tenant, paymentHeader, allocations, { orderId: order!.id, paymentDate: today }, meta);
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
        method: part.method,
        paymentDate: today,
        paymentId: paymentHeader?.id ?? null,
      },
      meta,
    );
  }

  // Qaytim kassada qoladi va mijoz balansiga yoziladi (faqat naqdda qaytim bo'ladi)
  let changeKept = 0n;
  // Balansga yoziladigan qaytim chek summasidan oshmaydi: katta "berilgan summa" bilan mijozga yo'q pulni balans qilib
  // bo'lmaydi (balansni to'ldirish — alohida amal, pul kassaga kirim bo'ladi). Offline chek qurilmada yopilgan — rad etilmaydi
  if (input.changeToBalance && change > due) {
    if (!offline) {
      throw badRequest(`Balansga yoziladigan qaytim (${fromMinor(change)}) chek summasidan oshmasligi kerak — balansni to'ldirish amalidan foydalaning`);
    }
    // Offline kassa: qurilmada yopilgan chek rad etilmaydi — lekin katta "qaytim" bilan balans yaratish rahbarga ko'rinadi
    conflicts.push({ kind: "change_over_total", details: { customerId: input.customerId, change: fromMinor(change), total: fromMinor(due) } });
  }
  // Savdo siyosati: balansga yoziladigan katta qaytim ham depozit chegarasida (offline — nomuvofiqlik)
  const { cashierDepositLimit } = input.changeToBalance && change > 0n ? await getSalesPolicy(tx, companyId) : { cashierDepositLimit: null };
  if (cashierDepositLimit !== null && change > toMinor(cashierDepositLimit)) {
    if (offline) {
      conflicts.push({ kind: "deposit_over_limit", details: { customerId: input.customerId, amount: fromMinor(change), limit: cashierDepositLimit, source: "change" } });
    } else if (!(await effectivePermissions(tx, tenant)).includes("sales.approve")) {
      throw new AppError("FORBIDDEN", `Balansga ${cashierDepositLimit} dan ortiq qaytimni rahbar (sales.approve) yozadi`, { reason: "deposit_limit", limit: cashierDepositLimit });
    }
  }
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
        // Offline chek: qaytim kassada qolgan va mijozga va'da qilingan — mijoz keyin faolsizlantirilgan bo'lsa ham
        allowInactive: offline !== undefined,
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

  const cashIn = cashPaid + changeKept;
  const paidBy = (...methods: BasePaymentMethod[]) => allocations.reduce((sum, part) => sum + (methods.includes(part.method) ? part.amount : 0n), 0n);
  const cardIn = paidBy("card");
  const bankIn = paidBy("bank", "transfer");
  // Chet valyutadagi tushum smenada valyuta bo'yicha: naqd — kassa sanog'i uchun, karta — alohida
  const foreignIn = (method: "cash" | "card") =>
    new Map(foreignParts.filter((part) => part.method === method && part.paid > 0n).map((part) => [part.currency, part.paid]));
  const foreignCashIn = foreignIn("cash");
  const foreignCardIn = foreignIn("card");

  await tx
    .update(posShifts)
    .set({
      totalSales: sql`${posShifts.totalSales} + ${totals.totalAmount}::numeric`,
      ...(cashIn > 0n ? { totalCash: sql`${posShifts.totalCash} + ${fromMinor(cashIn)}::numeric` } : {}),
      ...(cardIn > 0n ? { totalCard: sql`${posShifts.totalCard} + ${fromMinor(cardIn)}::numeric` } : {}),
      ...(bankIn > 0n ? { totalBank: sql`${posShifts.totalBank} + ${fromMinor(bankIn)}::numeric` } : {}),
      ...(foreignCashIn.size > 0 ? { foreignCash: addCurrencyAmounts(posShifts.foreignCash, foreignCashIn) } : {}),
      ...(foreignCardIn.size > 0 ? { foreignCard: addCurrencyAmounts(posShifts.foreignCard, foreignCardIn) } : {}),
      receiptCount: sql`${posShifts.receiptCount} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(posShifts.id, shift.id));

  const debt = due - paid + foreignParts.reduce((sum, part) => sum + (part.dueBase - part.paidBase), 0n);
  const paymentSummary = allocations.map((part) => ({
    method: part.method,
    amount: fromMinor(part.amount),
    ...(part.terminalId ? { terminalId: part.terminalId } : {}),
    // Kassada tanlangan aniq bank hisobi (terminal hisobi — terminal orqali ma'lum)
    ...(part.cashAccountId && !part.terminalId && part.method !== "cash" ? { cashAccountId: part.cashAccountId } : {}),
  }));
  // Valyuta bo'yicha natija — faqat chet valyuta qatnashgan chekda; `covered` — balans va keshbek yopgani (valyutada)
  const currencyTotals =
    buckets.size > 1 || !buckets.has(baseCurrency)
      ? [...buckets.values()].map((bucket) => {
          const part = foreignParts.find((p) => p.currency === bucket.currency);
          return part
            ? {
                currency: bucket.currency,
                total: fromMinor(bucket.total),
                covered: fromMinor(part.covered),
                paid: fromMinor(part.paid),
                change: fromMinor(part.change),
              }
            : {
                currency: bucket.currency,
                total: fromMinor(bucket.total),
                covered: fromMinor(baseCovered),
                paid: fromMinor(paid),
                change: fromMinor(change),
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
      payments: paymentSummary,
      change: fromMinor(change),
      balanceUsed: fromMinor(fromBalance),
      changeToBalance: fromMinor(changeKept),
      debt: fromMinor(debt),
      cashbackUsed: fromMinor(fromCashback),
      cashbackEarned: fromMinor(cashbackEarned),
      ...(currencyTotals.length > 0 ? { currencyTotals } : {}),
      ...(offline ? { deviceId: offline.deviceId, soldAt: offline.soldAt.toISOString(), conflicts: conflicts.map((c) => c.kind) } : {}),
    },
  });
  return {
    /** Offline chek sinxronidagi nomuvofiqliklar (web kassada doim bo'sh). */
    conflicts,
    order: await getOrder(tx, tenant, order!.id),
    paid: paidText,
    /** Asosiy valyutadagi to'lov usullari bo'yicha qabul qilingan summa (qaytimsiz). */
    payments: paymentSummary,
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
  /** Bitta usuldagi summa (`parts` bo'lmasa majburiy). */
  amount?: string;
  /** `balance` — qarzni mijoz balansidan yopish (kassaga pul tushmaydi). */
  method: PaymentMethod | "balance";
  /** Qarzni aralash to'lash (naqd + karta terminali + bank); jami qarzdan oshmaydi. Faqat `debt`, web kassada. */
  parts?: PaymentPartInput[];
  /** Takroriy yuborishdan himoya kaliti (aralash to'lovda). */
  clientRequestId?: string | null;
  notes?: string | null;
  /**
   * Desktop kassa sinxroni: pul qurilmada qabul qilingan. Qarz boshqa kassada to'langan bo'lsa — qarzdan ortig'i
   * mijoz balansiga (`debt_overpaid` nomuvofiqligi); yopilgan smena — `shift_closed`.
   */
  offline?: { occurredAt: Date; deviceId: string };
};

/** Kassada mijoz balansini to'ldirish yoki qarzini to'lash; naqd/karta smena yig'indisiga qo'shiladi. */
export async function posCustomerPayment(tx: Tx, tenant: TenantContext, input: PosCustomerPaymentInput, meta: RequestMeta) {
  const offline = input.offline;
  const conflicts: SaleConflict[] = [];
  const shift = await lockShift(tx, tenant, input.shiftId);
  if ((shift.deviceId ?? null) !== (offline?.deviceId ?? null)) throw notFound("Smena topilmadi");
  if (shift.status !== "open") {
    if (!offline) throw badRequest("Smena yopilgan");
    conflicts.push({ kind: "shift_closed", details: { shiftId: shift.id } });
  }
  await assertShiftOperator(tx, tenant, shift.cashierId);
  assertWarehouseAccess(tenant, shift.warehouseId);
  const date = offline ? offline.occurredAt.toISOString().slice(0, 10) : undefined;

  const notes = input.notes ?? null;
  if (input.parts?.length) {
    if (input.purpose !== "debt" || offline) throw badRequest("Aralash to'lov faqat kassada qarzni to'lashda");
    const idempotencyKey = input.clientRequestId ? `pos_customer_payment:${input.clientRequestId}` : null;
    // Takroriy yuborish (qarz allaqachon yopilgan) — ortiqcha to'lov deb rad etilmaydi, birinchi natija qaytadi
    const previous = idempotencyKey ? await findPaymentByKey(tx, tenant.company.id, idempotencyKey) : null;
    if (previous) {
      if (previous.payment.customerId !== input.customerId) throw conflict("So'rov kaliti boshqa mijoz to'lovida ishlatilgan");
      return {
        customer: await customerSummary(tx, tenant.company.id, input.customerId),
        shift: await getShift(tx, tenant, shift.id),
        payment: previous.payment,
        conflicts,
      };
    }
    const [row] = await tx
      .select({ totalDebt: customers.totalDebt })
      .from(customers)
      .where(and(eq(customers.id, input.customerId), eq(customers.companyId, tenant.company.id)))
      .limit(1)
      .for("update");
    if (!row) throw notFound("Mijoz topilmadi");
    const debt = toMinor(row.totalDebt) > 0n ? toMinor(row.totalDebt) : 0n;
    const resolved = await resolvePaymentParts(tx, tenant.company.id, input.parts);
    // Qarzdan ortiq to'lov rad (ortig'i balansga — alohida "balansni to'ldirish" amali)
    const { allocations } = settlePaymentParts(resolved, debt, { allowCashChange: false, allowShortfall: true });
    if (allocations.length === 0) throw badRequest("To'lov summasi kiritilmagan");
    const result = await recordMixedCustomerPayment(
      tx,
      tenant,
      {
        source: "pos_customer_payment",
        customerId: input.customerId,
        parts: allocations.map((part) => ({ ...part, amount: fromMinor(part.amount) })),
        idempotencyKey,
        notes,
      },
      meta,
    );
    if (result.created) {
      const sumOf = (...methods: string[]) =>
        result.allocations.reduce((sum, row) => sum + (methods.includes(row.method) ? toMinor(row.amount) : 0n), 0n);
      const [cashIn, cardIn, bankIn] = [sumOf("cash"), sumOf("card"), sumOf("bank", "transfer")];
      await tx
        .update(posShifts)
        .set({
          ...(cashIn > 0n ? { totalCash: sql`${posShifts.totalCash} + ${fromMinor(cashIn)}::numeric` } : {}),
          ...(cardIn > 0n ? { totalCard: sql`${posShifts.totalCard} + ${fromMinor(cardIn)}::numeric` } : {}),
          ...(bankIn > 0n ? { totalBank: sql`${posShifts.totalBank} + ${fromMinor(bankIn)}::numeric` } : {}),
          updatedAt: new Date(),
        })
        .where(eq(posShifts.id, shift.id));
    }
    return {
      customer: await customerSummary(tx, tenant.company.id, input.customerId),
      shift: await getShift(tx, tenant, shift.id),
      payment: result.payment,
      conflicts,
    };
  }
  if (!input.amount) throw badRequest("To'lov summasi kiritilmagan");
  const amount = input.amount;
  if (input.method === "balance") {
    if (input.purpose !== "debt") throw badRequest("Balansni balansning o'zidan to'ldirib bo'lmaydi");
    await payFromBalance(tx, tenant, { customerId: input.customerId, amount, posShiftId: shift.id, notes }, meta);
  } else if (input.purpose === "deposit") {
    // Savdo siyosati: katta summani balansga yozish — rahbar (sales.approve); offline qurilmada pul olingan — nomuvofiqlik
    const { cashierDepositLimit } = await getSalesPolicy(tx, tenant.company.id);
    if (cashierDepositLimit !== null && toMinor(amount) > toMinor(cashierDepositLimit)) {
      if (offline) conflicts.push({ kind: "deposit_over_limit", details: { customerId: input.customerId, amount, limit: cashierDepositLimit } });
      else if (!(await effectivePermissions(tx, tenant)).includes("sales.approve")) {
        throw new AppError("FORBIDDEN", `Balansga ${cashierDepositLimit} dan ortiq summani rahbar (sales.approve) yozadi`, { reason: "deposit_limit", limit: cashierDepositLimit });
      }
    }
    await depositToBalance(
      tx,
      tenant,
      { customerId: input.customerId, type: "deposit", amount, method: input.method, posShiftId: shift.id, notes, date, allowInactive: offline !== undefined },
      meta,
    );
  } else {
    let payAmount = toMinor(amount);
    if (offline) {
      const [row] = await tx
        .select({ totalDebt: customers.totalDebt })
        .from(customers)
        .where(and(eq(customers.id, input.customerId), eq(customers.companyId, tenant.company.id)))
        .limit(1)
        .for("update");
      if (!row) throw notFound("Mijoz topilmadi");
      const debt = toMinor(row.totalDebt) > 0n ? toMinor(row.totalDebt) : 0n;
      if (payAmount > debt) {
        const excess = payAmount - debt;
        conflicts.push({
          kind: "debt_overpaid",
          details: { customerId: input.customerId, requested: amount, applied: fromMinor(debt), deposited: fromMinor(excess) },
        });
        await depositToBalance(
          tx,
          tenant,
          { customerId: input.customerId, type: "deposit", amount: fromMinor(excess), method: input.method, posShiftId: shift.id, notes, date, allowInactive: true },
          meta,
        );
        payAmount = debt;
      }
    }
    if (payAmount > 0n) {
      await recordCustomerPayment(
        tx,
        tenant,
        { customerId: input.customerId, amount: fromMinor(payAmount), method: input.method, notes, ...(date ? { paymentDate: date } : {}) },
        meta,
      );
    }
  }

  // Smena tushumi usul bo'yicha: naqd — kassa sanog'i, karta, bank/o'tkazma — alohida (balansdan yopish — tushum emas)
  if (input.method !== "balance") {
    const column = input.method === "cash" ? posShifts.totalCash : input.method === "card" ? posShifts.totalCard : posShifts.totalBank;
    const key = input.method === "cash" ? "totalCash" : input.method === "card" ? "totalCard" : "totalBank";
    await tx
      .update(posShifts)
      .set({ [key]: sql`${column} + ${amount}::numeric`, updatedAt: new Date() })
      .where(eq(posShifts.id, shift.id));
  }
  return {
    customer: await customerSummary(tx, tenant.company.id, input.customerId),
    shift: await getShift(tx, tenant, shift.id),
    conflicts,
  };
}
