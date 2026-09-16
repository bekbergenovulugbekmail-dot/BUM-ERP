/**
 * To'lov qismlari — pul KIRIMI va CHIQIMI uchun umumiy (yo'nalishdan mustaqil) qatlam.
 *
 * Bu yerda faqat "usul → hisob" tekshiruvi va summalar arifmetikasi bor; qaysi tomon (mijoz, ta'minotchi,
 * xarajat) ekani va buxgalteriya yo'nalishi chaqiruvchi modulda hal qilinadi. Shuning uchun bitta to'plam
 * qoidalar POS, mijoz to'lovi, yetkazishdagi inkassatsiya, ta'minotchiga to'lov va xarajat to'lovida bir xil ishlaydi.
 *
 * Tekshiruvlar serverda (mijoz yuborgan kompaniya, hisob va terminal ID'siga ishonilmaydi): qism summasi manfiy emas
 * (nol qism e'tiborsiz); usul kanalga ruxsat etilgan; terminal va hisob shu kompaniyaniki va faol; terminal — faqat
 * karta, hisobi terminalga bog'langani; hisob turi usulga mos (naqd — kassa, karta/bank/o'tkazma — bank) va asosiy
 * valyutada; bir xil qism (usul + terminal + hisob) takrorlanmaydi.
 */
import { and, eq } from "drizzle-orm";
import { ALLOCATION_METHOD_LABELS, MAX_PAYMENT_PARTS, badRequest, notFound, type AllocationMethod } from "@bum/shared";
import { cashAccounts } from "../../db/schema/finance.js";
import type { DbOrTx } from "../../db/transaction.js";
import { fromMinor, toMinor } from "../../shared/decimal.js";
import { companyCurrency } from "./accounts.service.js";
import { findCompanyTerminal } from "./terminals.service.js";

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
      // Naqd — faqat kassaga; karta va o'tkazma — bank yoki "kutilayotgan" hisobga (terminal puli qirqimgacha o'sha yerda)
      if (part.method === "cash" ? account.type !== "cash" : account.type === "cash") {
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
