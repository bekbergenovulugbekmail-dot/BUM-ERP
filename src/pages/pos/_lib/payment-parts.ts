/**
 * Kassada to'lov qismlari: kassir usul tugmasini bosadi (Naqd, UZCARD, HUMO, bank hisobi), summani kiritib "Saqlash"
 * bosadi — qism ro'yxatga qo'shiladi; bir nechta qism — aralash to'lov (alohida rejim yo'q). Bir xil usul (va terminal
 * yoki hisob) qayta saqlansa summasi qo'shiladi — server bir xil qismni ikki marta qabul qilmaydi.
 *
 * Qoidalar server bilan bir xil (`payment-allocation.service.ts`): karta/bank jami chek summasidan oshmaydi; ortiqcha
 * to'lov faqat naqd qismdan qaytim bo'ladi; kam to'lov — faqat mijoz tanlanganda qarzga.
 */
export type PayMethod = "cash" | "card" | "bank";

/** Kassadagi to'lov tugmasi: usul va (ixtiyoriy) terminal yoki bank hisobi. */
export type PayOption = { key: string; method: PayMethod; terminalId: string | null; cashAccountId: string | null; label: string };

export type PayPart = PayOption & { amount: bigint };

/** "25 000", "25000.5", "25,50" → tiyin; bo'sh yoki noto'g'ri — null. */
export function parseMinor(text: string): bigint | null {
  const cleaned = text.replace(/[\s\u00a0]/g, "").replace(",", ".");
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  const [whole, fraction = ""] = cleaned.split(".");
  return BigInt(whole!) * 100n + BigInt((fraction + "00").slice(0, 2));
}

/** Qismni qo'shadi: shu tugma (usul + terminal + hisob) bor bo'lsa summasi qo'shiladi; nol yoki manfiy — o'zgarmaydi. */
export function addPart(parts: PayPart[], option: PayOption, amount: bigint): PayPart[] {
  if (amount <= 0n) return parts;
  const existing = parts.find((part) => part.key === option.key);
  if (existing) return parts.map((part) => (part.key === option.key ? { ...part, amount: part.amount + amount } : part));
  return [...parts, { ...option, amount }];
}

export const removePart = (parts: PayPart[], key: string) => parts.filter((part) => part.key !== key);

export type PaymentPreview = {
  /** Berilgan jami (qaytim bilan). */
  tendered: bigint;
  cash: bigint;
  nonCash: bigint;
  /** Chekka hisoblangan (qaytimsiz). */
  paid: bigint;
  /** Hali to'lanmagan qism (mijoz bo'lsa — qarzga). */
  remaining: bigint;
  /** Naqddan qaytim. */
  change: bigint;
  /** Karta/bank chek summasidan oshdi — yakunlab bo'lmaydi. */
  nonCashOver: boolean;
};

export function previewPayment(parts: PayPart[], due: bigint): PaymentPreview {
  const cash = parts.reduce((sum, part) => sum + (part.method === "cash" ? part.amount : 0n), 0n);
  const nonCash = parts.reduce((sum, part) => sum + (part.method === "cash" ? 0n : part.amount), 0n);
  const tendered = cash + nonCash;
  const over = tendered > due ? tendered - due : 0n;
  const change = over > cash ? cash : over;
  return {
    tendered,
    cash,
    nonCash,
    paid: tendered - change,
    remaining: due > tendered ? due - tendered : 0n,
    change,
    nonCashOver: nonCash > due,
  };
}

/**
 * Tugma bosilganda taklif qilinadigan summa — qolgan qism; karta/bank uchun eng ko'pi (boshqa karta/bank qismlari
 * bilan birga chek summasidan oshmasin). Naqd uchun chegara yo'q (ortig'i qaytim).
 */
export function suggestAmount(parts: PayPart[], option: PayOption, due: bigint): { amount: bigint; max: bigint | null } {
  const preview = previewPayment(parts, due);
  if (option.method === "cash") return { amount: preview.remaining, max: null };
  const otherNonCash = parts.reduce((sum, part) => sum + (part.method !== "cash" && part.key !== option.key ? part.amount : 0n), 0n);
  const own = parts.find((part) => part.key === option.key)?.amount ?? 0n;
  const max = due - otherNonCash - own;
  const limit = max > 0n ? max : 0n;
  return { amount: preview.remaining < limit ? preview.remaining : limit, max: limit };
}

const minorText = (minor: bigint) => {
  const sign = minor < 0n ? "-" : "";
  const abs = minor < 0n ? -minor : minor;
  return `${sign}${abs / 100n}.${String(abs % 100n).padStart(2, "0")}`;
};

/** POST /api/sales/pos/sales `payments` — qismlar tartibida. */
export function paymentsBody(parts: PayPart[]) {
  return parts.map((part) => ({
    method: part.method,
    amount: minorText(part.amount),
    ...(part.terminalId ? { terminalId: part.terminalId } : {}),
    ...(part.cashAccountId ? { cashAccountId: part.cashAccountId } : {}),
  }));
}
