/**
 * Chek hisobi (offline) — serverdagi `completeSale` (apps/api/src/modules/sales/pos.service.ts) bilan aynan bir xil:
 * qator summalari, sotuv valyutalari bo'yicha qismlar, keshbek va balans, qaytim, qarz, chet valyuta to'lovlari.
 * Renderer (oldindan ko'rish) va main (navbatga yoziladigan chek) shu funksiyadan foydalanadi.
 *
 * Farq: server xato beradigan joyda (keshbek/balans chegarasi) bu yerda summa chegaraga qisqartiriladi — kassir
 * ekranda to'g'ri qiymatni ko'radi; qolgan qat'iy shartlar `errors` da.
 */
import { computeLine, fromMinor, minBig, mulDivRound, scalePrice, toMinor } from "./money.js";
import type { PaymentMethod } from "./sync-types.js";

export type CalcProduct = {
  id: string;
  name: string;
  baseUnitId: string;
  salesPrice: string;
  salesCurrency: string | null;
  taxRate: string;
  taxIncluded: boolean;
  categoryId: string | null;
  /** Aksiya narxi (sotuv narxi valyutasida) va oxirgi kuni (null — muddatsiz). */
  promoPrice?: string | null;
  promoPriceEnd?: string | null;
};

/** Sotuv sanasi aksiya uchun — server bilan bir xil (UTC kuni, YYYY-MM-DD). */
export const promoDateOf = (at: Date = new Date()): string => at.toISOString().slice(0, 10);

/** Amaldagi aksiya narxi — serverdagi `activePromoPrice` (packages/shared) bilan aynan bir xil qoida. */
export function activePromoPrice(product: Pick<CalcProduct, "promoPrice" | "promoPriceEnd">, date: string): string | null {
  if (product.promoPrice === null || product.promoPrice === undefined || product.promoPrice === "") return null;
  if (product.promoPriceEnd && product.promoPriceEnd < date) return null;
  return product.promoPrice;
}

export type CalcConversion = { fromUnitId: string; toUnitId: string; factor: string; productId: string | null };

/** Birlik → asosiy birlik koeffitsienti; mahsulotga xos konversiya umumiysidan ustun. Yo'q bo'lsa — null. */
export function unitFactor(product: Pick<CalcProduct, "id" | "baseUnitId">, unitId: string, conversions: CalcConversion[]): string | null {
  if (unitId === product.baseUnitId) return "1";
  const matches = conversions
    .filter((c) => c.fromUnitId === unitId && c.toUnitId === product.baseUnitId && (c.productId === product.id || c.productId === null))
    .sort((a, b) => Number(a.productId === null) - Number(b.productId === null));
  return matches[0]?.factor ?? null;
}

/**
 * Prays-list narxi asosiy valyutada, tanlangan birlikda; `promoDate` berilsa — shu kunda amaldagi aksiya narxi (kassa
 * serveri ham shunday hisoblaydi). Narx valyutasi yoqilmagan bo'lsa — null.
 */
export function listPrice(product: CalcProduct, factor: string, baseCurrency: string, rates: Record<string, string>, promoDate?: string): string | null {
  const price = (promoDate ? activePromoPrice(product, promoDate) : null) ?? product.salesPrice;
  let unitBase = price;
  if (product.salesCurrency && product.salesCurrency !== baseCurrency) {
    const rate = rates[product.salesCurrency];
    if (!rate) return null;
    unitBase = scalePrice(price, rate);
  }
  return scalePrice(unitBase, factor);
}

export type SaleLineInput = {
  productId: string;
  quantity: string;
  unitPrice: string;
  discountPercent: string;
  taxRate: string;
  taxIncluded: boolean;
  salesCurrency: string | null;
};

export type SaleCalcInput = {
  lines: SaleLineInput[];
  baseCurrency: string;
  /** Kod → kurs (1 birlik necha asosiy valyuta). */
  rates: Record<string, string>;
  saleCurrencies: string[];
  customer: { balance: string; cashbackBalance: string } | null;
  cashback: { enabled: boolean; maxUsagePercent: number } | null;
  paymentMethod: PaymentMethod;
  /** null — aniq to'lanadigan summa. */
  amountPaid: string | null;
  /**
   * Aralash to'lov (asosiy valyutada): naqd, karta, bank — har qism bir marta (karta terminal bo'yicha: UZCARD va HUMO
   * alohida); summa null — shu qismga qolgan qoldiq (faqat bitta qismda). Berilsa `paymentMethod`/`amountPaid` e'tiborsiz.
   */
  payments?: { method: "cash" | "card" | "bank"; amount: string | null; terminalId?: string | null }[];
  /** null — ishlatilmaydi; "" yoki son — so'ralgan summa (chegaraga qisqartiriladi). */
  cashbackAmount: string | null;
  balanceAmount: string | null;
  changeToBalance: boolean;
  /** Chet valyuta qismlari: summa null — aniq qoldiq. */
  currencyPayments: { currency: string; amount: string | null; method: "cash" | "card" }[];
};

export type ForeignPart = {
  currency: string;
  method: "cash" | "card";
  rate: string;
  total: bigint;
  covered: bigint;
  due: bigint;
  dueBase: bigint;
  tendered: bigint;
  paid: bigint;
  change: bigint;
  paidBase: bigint;
};

export type SaleCalc = {
  lines: { net: bigint; tax: bigint; discount: bigint; lineTotal: bigint; currency: string; rate: string; currencyTotal: bigint }[];
  subtotal: bigint;
  tax: bigint;
  discount: bigint;
  total: bigint;
  buckets: { currency: string; rate: string; total: bigint; base: bigint }[];
  cashbackUsed: bigint;
  cashbackLimit: bigint;
  balanceUsed: bigint;
  baseCovered: bigint;
  hasBaseBucket: boolean;
  due: bigint;
  tendered: bigint;
  paid: bigint;
  /** Asosiy valyutadagi to'lov qismlari: berilgan (naqdda — qaytim bilan) va qabul qilingan; karta — terminal bilan. */
  payments: { method: PaymentMethod; tendered: bigint; paid: bigint; terminalId?: string }[];
  cashPaid: bigint;
  change: bigint;
  changeKept: bigint;
  foreign: ForeignPart[];
  foreignPaidBase: bigint;
  debt: bigint;
  errors: string[];
};

const basisPoints = (percent: number) => BigInt(Math.round(percent * 100));
const safeMinor = (text: string | null, scale = 2) => {
  if (text === null || text.trim() === "") return null;
  try {
    return toMinor(text, scale);
  } catch {
    return null;
  }
};

const METHOD_NAMES: Record<string, string> = { cash: "Naqd", card: "Karta", bank: "Bank", transfer: "O'tkazma" };

/** Asosiy valyutadagi to'lov qismlari: aralash (`payments`, null — qoldiq) yoki bitta usul (`amountPaid`, null — aniq). */
function paymentParts(input: SaleCalcInput, due: bigint, errors: string[]): { method: PaymentMethod; tendered: bigint; terminalId?: string }[] {
  if (!input.payments || input.payments.length === 0) {
    const tendered = input.amountPaid === null ? due : (safeMinor(input.amountPaid) ?? 0n);
    if (tendered < 0n) errors.push("To'lov summasi manfiy bo'lmasin");
    return [{ method: input.paymentMethod, tendered }];
  }
  // Server bilan bir xil: qism kaliti — usul + terminal (UZCARD va HUMO — ikki qism, bitta terminal ikki marta — xato)
  const seen = new Set<string>();
  let known = 0n;
  let openParts = 0;
  for (const part of input.payments) {
    const key = `${part.method}|${part.terminalId ?? ""}`;
    if (seen.has(key)) {
      errors.push(part.terminalId ? "Bitta terminal to'lovi bir marta kiritiladi" : `${METHOD_NAMES[part.method] ?? part.method} to'lovi bir marta kiritiladi`);
    }
    seen.add(key);
    if (part.terminalId && part.method !== "card") errors.push("Terminal faqat karta to'lovida tanlanadi");
    if (part.amount === null) {
      openParts += 1;
      continue;
    }
    const value = safeMinor(part.amount) ?? 0n;
    if (value < 0n) errors.push("To'lov summasi manfiy bo'lmasin");
    known += value;
  }
  if (openParts > 1) errors.push("Qoldiq faqat bitta to'lov usuliga yoziladi");
  const rest = due > known ? due - known : 0n;
  let restGiven = false;
  return input.payments.map((part) => {
    const terminal = part.terminalId ? { terminalId: part.terminalId } : {};
    if (part.amount !== null) return { method: part.method, tendered: safeMinor(part.amount) ?? 0n, ...terminal };
    const tendered = restGiven ? 0n : rest;
    restGiven = true;
    return { method: part.method, tendered, ...terminal };
  });
}

export function computeSale(input: SaleCalcInput): SaleCalc {
  const errors: string[] = [];
  const base = input.baseCurrency;
  const saleCurrencies = [...new Set(input.saleCurrencies.length > 0 ? input.saleCurrencies : [base])];
  const rateOf = (code: string) => (code === base ? "1.0000" : (input.rates[code] ?? null));

  let subtotal = 0n;
  let tax = 0n;
  let discount = 0n;
  const bucketMap = new Map<string, { currency: string; rate: string; total: bigint; base: bigint }>();
  const lines = input.lines.map((line) => {
    const amounts = computeLine(line);
    subtotal += amounts.net;
    tax += amounts.tax;
    discount += amounts.discount;
    const own = line.salesCurrency ?? base;
    const code = saleCurrencies.includes(own) ? own : saleCurrencies[0]!;
    const rate = rateOf(code);
    if (!rate) errors.push(`${code} valyutasi kursi yo'q`);
    const safeRate = rate ?? "1.0000";
    const currencyTotal = code === base ? amounts.lineTotal : mulDivRound(amounts.lineTotal, 10_000n, toMinor(safeRate, 4));
    const bucket = bucketMap.get(code) ?? { currency: code, rate: safeRate, total: 0n, base: 0n };
    bucket.total += currencyTotal;
    bucket.base += amounts.lineTotal;
    bucketMap.set(code, bucket);
    return { ...amounts, currency: code, rate: safeRate, currencyTotal };
  });
  const total = subtotal + tax;
  const baseTotal = bucketMap.get(base)?.base ?? 0n;

  // Keshbek: sozlama yoqilgan, mijoz keshbeki, chek ulushi chegarasi va chek summasidan oshmaydi
  const cashbackLimit = input.cashback?.enabled ? (total * basisPoints(input.cashback.maxUsagePercent)) / 10_000n : 0n;
  let cashbackUsed = 0n;
  if (input.cashbackAmount !== null && input.customer && input.cashback?.enabled) {
    const available = toMinor(input.customer.cashbackBalance);
    const requested = safeMinor(input.cashbackAmount) ?? available;
    cashbackUsed = requested > 0n ? minBig(requested, available, cashbackLimit, total) : 0n;
  }
  let balanceUsed = 0n;
  if (input.balanceAmount !== null && input.customer) {
    const available = toMinor(input.customer.balance);
    const requested = safeMinor(input.balanceAmount) ?? available;
    balanceUsed = requested > 0n ? minBig(requested, available, total - cashbackUsed) : 0n;
    if (balanceUsed < 0n) balanceUsed = 0n;
  }

  const nonCash = cashbackUsed + balanceUsed;
  const baseCovered = nonCash < baseTotal ? nonCash : baseTotal;
  let uncovered = nonCash - baseCovered;
  const due = baseTotal - baseCovered;
  const hasBaseBucket = bucketMap.has(base);
  // Server bilan bir xil: karta va bank qoldiqdan oshmaydi, ortig'i faqat naqddan — qaytim
  const parts = paymentParts(input, due, errors);
  const tendered = parts.reduce((sum, part) => sum + part.tendered, 0n);
  if (!hasBaseBucket && tendered > 0n) errors.push(`Chekda ${base} dagi mahsulot yo'q — to'lov valyuta bo'yicha kiritiladi`);
  const cardBank = parts.reduce((sum, part) => sum + (part.method === "cash" ? 0n : part.tendered), 0n);
  if (cardBank > due) errors.push("Karta yoki bank to'lovi chek summasidan oshmasligi kerak");
  const cardBankPaid = cardBank < due ? cardBank : due;
  const cashTendered = parts.find((part) => part.method === "cash")?.tendered ?? 0n;
  const cashPaid = cashTendered < due - cardBankPaid ? cashTendered : due - cardBankPaid;
  const change = cashTendered - cashPaid;
  const paid = cardBankPaid + cashPaid;
  const payments = parts.map((part) => ({
    method: part.method,
    tendered: part.tendered,
    paid: part.method === "cash" ? cashPaid : part.tendered,
    ...(part.terminalId ? { terminalId: part.terminalId } : {}),
  }));
  if (!input.customer && paid < due) errors.push("Mijozsiz sotuvda chek to'liq to'lanishi kerak");

  const tenderedByCurrency = new Map(input.currencyPayments.map((p) => [p.currency, p]));
  const foreign: ForeignPart[] = [];
  for (const bucket of bucketMap.values()) {
    if (bucket.currency === base) continue;
    const rate = toMinor(bucket.rate, 4);
    const coveredBase = uncovered < bucket.base ? uncovered : bucket.base;
    uncovered -= coveredBase;
    const dueBase = bucket.base - coveredBase;
    const dueInCurrency = coveredBase === 0n ? bucket.total : dueBase === 0n ? 0n : mulDivRound(dueBase, 10_000n, rate);
    const payment = tenderedByCurrency.get(bucket.currency);
    const method = payment?.method ?? "cash";
    const tenderedHere = payment && payment.amount !== null ? (safeMinor(payment.amount) ?? 0n) : dueInCurrency;
    if (method === "card" && tenderedHere > dueInCurrency) {
      errors.push(`${bucket.currency} karta to'lovi qoldiqdan oshmasligi kerak (${fromMinor(dueInCurrency)})`);
    }
    const paidHere = tenderedHere < dueInCurrency ? tenderedHere : dueInCurrency;
    const computedBase = paidHere === dueInCurrency ? dueBase : mulDivRound(paidHere, rate, 10_000n);
    foreign.push({
      currency: bucket.currency,
      method,
      rate: bucket.rate,
      total: bucket.total,
      covered: bucket.total - dueInCurrency,
      due: dueInCurrency,
      dueBase,
      tendered: tenderedHere,
      paid: paidHere,
      change: tenderedHere - paidHere,
      paidBase: computedBase < dueBase ? computedBase : dueBase,
    });
    if (!input.customer && paidHere < dueInCurrency) errors.push(`Mijozsiz sotuvda ${bucket.currency} qismi to'liq to'lanishi kerak`);
  }
  const foreignPaidBase = foreign.reduce((sum, part) => sum + part.paidBase, 0n);
  const changeKept = input.changeToBalance && input.customer && change > 0n ? change : 0n;
  const debt = due - paid + foreign.reduce((sum, part) => sum + (part.dueBase - part.paidBase), 0n);
  if (input.lines.length === 0) errors.push("Savatcha bo'sh");

  return {
    lines,
    subtotal,
    tax,
    discount,
    total,
    buckets: [...bucketMap.values()],
    cashbackUsed,
    cashbackLimit,
    balanceUsed,
    baseCovered,
    hasBaseBucket,
    due,
    tendered,
    paid,
    payments,
    cashPaid,
    change,
    changeKept,
    foreign,
    foreignPaidBase,
    debt,
    errors: [...new Set(errors)],
  };
}

/**
 * Chekdan beriladigan keshbek (taxminiy — yakuniysi serverda): qator summasi × (asos / chek) × foiz.
 * Foiz — mahsulot kategoriyasi (yoki eng yaqin ota) foizi, bo'lmasa chek summasi pog'onasi.
 */
export function estimateCashback(
  settings: { enabled: boolean; accrualBase: "paid" | "total"; tiers: { minAmount: number; percent: number }[]; categoryRates: { categoryId: string; percent: number }[] },
  lines: { productId: string; lineTotal: bigint }[],
  total: bigint,
  paidBase: bigint,
  categoryOf: (productId: string) => string | null,
  parentOf: (categoryId: string) => string | null,
): bigint {
  const baseMinor = settings.accrualBase === "total" ? total : paidBase;
  if (!settings.enabled || total <= 0n || baseMinor <= 0n) return 0n;
  const tier = [...settings.tiers].sort((a, b) => b.minAmount - a.minAmount).find((candidate) => total >= toMinor(String(candidate.minAmount)));
  const tierRate = tier ? basisPoints(tier.percent) : 0n;
  const rates = new Map(settings.categoryRates.map((rate) => [rate.categoryId, basisPoints(rate.percent)]));
  const rateFor = (productId: string) => {
    let categoryId = categoryOf(productId);
    for (let depth = 0; categoryId && depth < 50; depth++) {
      const rate = rates.get(categoryId);
      if (rate !== undefined) return rate;
      categoryId = parentOf(categoryId);
    }
    return tierRate;
  };
  let earned = 0n;
  for (const line of lines) {
    const rate = rateFor(line.productId);
    if (rate > 0n) earned += (line.lineTotal * baseMinor * rate) / (total * 10_000n);
  }
  return earned;
}
