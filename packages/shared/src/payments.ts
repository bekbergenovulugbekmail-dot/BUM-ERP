/**
 * To'lov taqsimoti va terminallar — server va web uchun umumiy ro'yxatlar.
 */

/** Mijozdan pul qabul qilish usullari (qism bo'yicha). Balans va keshbek — alohida mexanizm. */
export const ALLOCATION_METHODS = ["cash", "card", "bank", "transfer"] as const;
export type AllocationMethod = (typeof ALLOCATION_METHODS)[number];

export const ALLOCATION_METHOD_LABELS: Record<AllocationMethod, string> = {
  cash: "Naqd",
  card: "Karta",
  bank: "Bank",
  transfer: "O'tkazma",
};

/** Bitta to'lovdagi qismlar chegarasi (masalan: naqd + UZCARD + HUMO + bank). */
export const MAX_PAYMENT_PARTS = 8;

/** Karta to'lov tizimlari (terminal). */
export const TERMINAL_NETWORKS = ["uzcard", "humo", "visa", "mastercard", "unionpay", "other"] as const;
export type TerminalNetwork = (typeof TERMINAL_NETWORKS)[number];

export const TERMINAL_NETWORK_LABELS: Record<TerminalNetwork, string> = {
  uzcard: "UZCARD",
  humo: "HUMO",
  visa: "VISA",
  mastercard: "Mastercard",
  unionpay: "UnionPay",
  other: "Karta",
};
