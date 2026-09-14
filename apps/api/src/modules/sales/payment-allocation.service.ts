/**
 * Universal to'lov taqsimoti — mijozdan pul qabul qilinadigan hamma joyda (POS web va desktop, yetkazishda, qarz va
 * buyurtma to'lovi) bitta qoidalar to'plami: to'lov hujjati (`payments`) va usul bo'yicha qismlar (`customer_payments`:
 * usul, summa, kassa/bank hisobi, terminal). Har qism o'z hisobiga kassa harakati va jurnal (DR shu hisobning
 * buxgalteriya hisobi / CR debitorlar) bilan yoziladi — "hammasi naqd" deb bitta yozuv qilinmaydi.
 *
 * Tekshiruvlar serverda (mijoz yuborgan kompaniya, hisob va terminal ID'siga ishonilmaydi): qism summasi manfiy emas
 * (nol qism e'tiborsiz); usul kanalga ruxsat etilgan; terminal va hisob shu kompaniyaniki va faol; terminal — faqat
 * karta, hisobi terminalga bog'langani; hisob turi usulga mos (naqd — kassa, karta/bank/o'tkazma — bank) va asosiy
 * valyutada; bir xil qism (usul + terminal + hisob) takrorlanmaydi.
 *
 * Hisob-kitob: karta va bank jami summadan oshmaydi; ortiqcha to'lov rad etiladi — qaytim faqat qoida ruxsat bersa
 * (bitta naqd qism, mijoz ortig'ini beradi); kam to'lov — faqat nasiya ruxsat etilganda (qoldiq mijoz qarziga).
 */
import { and, asc, eq } from "drizzle-orm";
import {
  ALLOCATION_METHOD_LABELS,
  MAX_PAYMENT_PARTS,
  badRequest,
  notFound,
  type AllocationMethod,
} from "@bum/shared";
import { cashAccounts } from "../../db/schema/finance.js";
import { customerPayments, payments, salesOrders } from "../../db/schema/sales.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import type { RequestMeta } from "../../shared/audit.js";
import { fromMinor, toMinor } from "../../shared/decimal.js";
import type { TenantContext } from "../company/tenant.js";
import { companyCurrency } from "../finance/accounts.service.js";
import { findCompanyTerminal } from "../finance/terminals.service.js";
import { recordCustomerPayment } from "./payments.service.js";

export type PaymentPartInput = {
  method: AllocationMethod;
  amount: string;
  terminalId?: string | null;
  cashAccountId?: string | null;
};

export type ResolvedPart = {
  method: AllocationMethod;
  amount: bigint;
  terminalId: string | null;
  cashAccountId: string | null;
};

export type PaymentSource = "pos" | "pos_device" | "delivery" | "sales_payment" | "pos_customer_payment";

/** Qismlarni tekshiradi va terminal hisobini aniqlaydi; nol summali qismlar natijaga kirmaydi. */
export async function resolvePaymentParts(
  conn: DbOrTx,
  companyId: string,
  parts: PaymentPartInput[],
  /** `offline` — desktop kassa cheki qurilmada yopilgan: keyin faolsizlantirilgan terminal yoki hisob rad etilmaydi. */
  options: { allowedMethods?: readonly AllocationMethod[]; offline?: boolean } = {},
): Promise<ResolvedPart[]> {
  if (parts.length > MAX_PAYMENT_PARTS) throw badRequest(`Bitta to'lovda ko'pi bilan ${MAX_PAYMENT_PARTS} ta qism`);
  const baseCurrency = await companyCurrency(conn, companyId);
  const seen = new Set<string>();
  const resolved: ResolvedPart[] = [];
  for (const part of parts) {
    const label = ALLOCATION_METHOD_LABELS[part.method] ?? part.method;
    const amount = toMinor(part.amount);
    if (amount < 0n) throw badRequest("To'lov summasi manfiy bo'lmasin");
    if (options.allowedMethods && !options.allowedMethods.includes(part.method)) {
      throw badRequest(`${label} usuli bu yerda ruxsat etilmagan`, { reason: "payment_method_not_allowed", method: part.method });
    }
    let cashAccountId = part.cashAccountId ?? null;
    const terminalId = part.terminalId ?? null;
    if (terminalId) {
      if (part.method !== "card") throw badRequest("Terminal faqat karta to'lovida tanlanadi");
      const terminal = await findCompanyTerminal(conn, companyId, terminalId);
      if (!terminal.isActive && !options.offline) throw badRequest(`"${terminal.name}" terminali faol emas`);
      if (cashAccountId && cashAccountId !== terminal.cashAccountId) throw badRequest("Hisob terminalga bog'langan bank hisobiga mos emas");
      cashAccountId = terminal.cashAccountId;
    }
    if (cashAccountId) {
      const [account] = await conn
        .select({ type: cashAccounts.type, isActive: cashAccounts.isActive, currency: cashAccounts.currency, name: cashAccounts.name })
        .from(cashAccounts)
        .where(and(eq(cashAccounts.id, cashAccountId), eq(cashAccounts.companyId, companyId)))
        .limit(1);
      if (!account) throw notFound("Kassa yoki bank hisobi topilmadi");
      if (!account.isActive && !options.offline) throw badRequest(`"${account.name}" hisobi faol emas`);
      const expected = part.method === "cash" ? "cash" : "bank";
      if (account.type !== expected) {
        throw badRequest(part.method === "cash" ? "Naqd to'lov kassaga tushadi — bank hisobi tanlangan" : `${label} to'lovi bank hisobiga tushadi — kassa tanlangan`);
      }
      if (account.currency !== baseCurrency) throw badRequest(`"${account.name}" asosiy valyutada emas — valyutadagi to'lov alohida kiritiladi`);
    }
    const key = `${part.method}|${terminalId ?? ""}|${cashAccountId ?? ""}`;
    if (seen.has(key)) throw badRequest(`${label} to'lovi bir marta kiritiladi`);
    seen.add(key);
    if (amount > 0n) resolved.push({ method: part.method, amount, terminalId, cashAccountId });
  }
  return resolved;
}

export type SettleRules = {
  /** Ortig'i qaytim sifatida — faqat naqd qismdan (qism kamaytiriladi). Aks holda ortiqcha to'lov rad. */
  allowCashChange: boolean;
  /** Kam to'lov qoldig'i qarzga (nasiya). Aks holda rad. */
  allowShortfall: boolean;
  /** Kam to'lov rad etilganda xabar (masalan, mijozsiz sotuv); funksiya — qoldiq summa bilan. */
  shortfallMessage?: string | ((remaining: string) => string);
};

export type Settlement = {
  /** Qabul qilingan qismlar (qaytim ayirilgan, nol qismlarsiz). */
  allocations: ResolvedPart[];
  tendered: bigint;
  paid: bigint;
  change: bigint;
  shortfall: bigint;
};

/** Jami summa `due` ga nisbatan qoidalar: sof funksiya (bazaga yozmaydi). */
export function settlePaymentParts(parts: ResolvedPart[], due: bigint, rules: SettleRules): Settlement {
  const nonCash = parts.reduce((sum, part) => sum + (part.method === "cash" ? 0n : part.amount), 0n);
  if (nonCash > due) throw badRequest("Karta yoki bank to'lovi chek summasidan oshmasligi kerak", { reason: "overpayment" });
  const cash = parts.reduce((sum, part) => sum + (part.method === "cash" ? part.amount : 0n), 0n);
  const tendered = nonCash + cash;
  let change = 0n;
  if (tendered > due) {
    if (!rules.allowCashChange || cash === 0n) {
      throw badRequest(`To'lov jami summadan oshib ketdi: to'langan ${fromMinor(tendered)}, jami ${fromMinor(due)}`, {
        reason: "overpayment",
        total: fromMinor(due),
        paid: fromMinor(tendered),
      });
    }
    change = tendered - due;
  }
  // Qaytim oxirgi naqd qism(lar)dan ayriladi
  let cut = change;
  const allocations = [...parts]
    .reverse()
    .map((part) => {
      if (part.method !== "cash" || cut === 0n) return part;
      const take = part.amount < cut ? part.amount : cut;
      cut -= take;
      return { ...part, amount: part.amount - take };
    })
    .reverse()
    .filter((part) => part.amount > 0n);
  const paid = tendered - change;
  const shortfall = due - paid;
  if (shortfall > 0n && !rules.allowShortfall) {
    const remaining = fromMinor(shortfall);
    const message = typeof rules.shortfallMessage === "function" ? rules.shortfallMessage(remaining) : rules.shortfallMessage;
    throw badRequest(message ?? `To'lov to'liq emas: qoldiq ${remaining}`, {
      reason: "underpayment",
      remaining,
    });
  }
  return { allocations, tendered, paid, change, shortfall };
}

/** Idempotentlik kaliti bo'yicha mavjud hujjat va uning qismlari. */
export async function findPaymentByKey(conn: DbOrTx, companyId: string, idempotencyKey: string) {
  const [header] = await conn
    .select()
    .from(payments)
    .where(and(eq(payments.companyId, companyId), eq(payments.idempotencyKey, idempotencyKey)))
    .limit(1);
  if (!header) return null;
  const allocations = await conn
    .select()
    .from(customerPayments)
    .where(eq(customerPayments.paymentId, header.id))
    .orderBy(asc(customerPayments.createdAt), asc(customerPayments.id));
  return { payment: header, allocations };
}

export async function createPaymentHeader(
  tx: Tx,
  tenant: TenantContext,
  input: { source: PaymentSource; idempotencyKey?: string | null; customerId?: string | null; orderId?: string | null; total: bigint },
) {
  const [header] = await tx
    .insert(payments)
    .values({
      companyId: tenant.company.id,
      source: input.source,
      idempotencyKey: input.idempotencyKey ?? null,
      customerId: input.customerId ?? null,
      orderId: input.orderId ?? null,
      totalAmount: fromMinor(input.total),
      currency: await companyCurrency(tx, tenant.company.id),
      createdBy: tenant.user.id,
      createdAt: new Date(),
    })
    .returning();
  return header!;
}

/**
 * Tayyor qismlarni yozadi: har biri `recordCustomerPayment` (kassa/bank kirimi, jurnal, buyurtma to'langani, mijoz qarzi).
 * Havola — `kalit:tartib` (kalit bo'lsa), birinchi qism uchun `firstReference` berilsa — shu (eski havolalar bilan mos).
 */
export async function recordAllocations(
  tx: Tx,
  tenant: TenantContext,
  header: { id: string; idempotencyKey: string | null },
  parts: ResolvedPart[],
  target: { customerId?: string | null; orderId?: string | null; paymentDate?: string; notes?: string | null; firstReference?: string | null },
  meta: RequestMeta,
) {
  const rows = [];
  for (const [index, part] of parts.entries()) {
    const reference =
      index === 0 && target.firstReference ? target.firstReference : header.idempotencyKey ? `${header.idempotencyKey}:${index}` : null;
    const { payment } = await recordCustomerPayment(
      tx,
      tenant,
      {
        customerId: target.orderId ? null : (target.customerId ?? null),
        orderId: target.orderId ?? null,
        amount: fromMinor(part.amount),
        method: part.method,
        cashAccountId: part.cashAccountId,
        terminalId: part.terminalId,
        paymentId: header.id,
        reference,
        ...(target.paymentDate ? { paymentDate: target.paymentDate } : {}),
        notes: target.notes ?? null,
      },
      meta,
    );
    rows.push(payment);
  }
  return rows;
}

/**
 * Mijoz yoki buyurtma bo'yicha aralash to'lov (qarz, buyurtma to'lovi, kassada qarz to'lash): jami summa qismlar
 * yig'indisi; ortiqcha to'lov (qarz yoki buyurtma qoldig'idan) — rad, hech bir qism yozilmaydi (bitta tranzaksiya).
 */
export async function recordMixedCustomerPayment(
  tx: Tx,
  tenant: TenantContext,
  input: {
    source: PaymentSource;
    customerId?: string | null;
    orderId?: string | null;
    parts: PaymentPartInput[];
    idempotencyKey?: string | null;
    paymentDate?: string;
    notes?: string | null;
    allowedMethods?: readonly AllocationMethod[];
  },
  meta: RequestMeta,
) {
  const companyId = tenant.company.id;
  if (!input.orderId && !input.customerId) throw badRequest("Mijoz yoki buyurtma tanlanishi kerak");
  // To'lov hujjatidagi mijoz buyurtma mijozi bilan bir xil (boshqa kompaniya mijozi yozilib qolmasin)
  if (input.orderId && input.customerId) {
    const [order] = await tx
      .select({ customerId: salesOrders.customerId })
      .from(salesOrders)
      .where(and(eq(salesOrders.id, input.orderId), eq(salesOrders.companyId, companyId)))
      .limit(1);
    if (!order) throw notFound("Buyurtma topilmadi");
    if (order.customerId !== input.customerId) throw badRequest("Buyurtma boshqa mijozniki");
  }
  if (input.idempotencyKey) {
    const existing = await findPaymentByKey(tx, companyId, input.idempotencyKey);
    if (existing) return { ...existing, created: false };
  }
  const parts = await resolvePaymentParts(tx, companyId, input.parts, { allowedMethods: input.allowedMethods });
  if (parts.length === 0) throw badRequest("To'lov summasi kiritilmagan");
  const total = parts.reduce((sum, part) => sum + part.amount, 0n);
  const header = await createPaymentHeader(tx, tenant, {
    source: input.source,
    idempotencyKey: input.idempotencyKey,
    customerId: input.customerId,
    orderId: input.orderId,
    total,
  });
  const allocations = await recordAllocations(tx, tenant, header, parts, input, meta);
  return { payment: header, allocations, created: true };
}
