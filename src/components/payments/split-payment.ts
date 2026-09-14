/**
 * Aralash to'lov qismlari: turlar va hisob funksiyalari (kassa, qarz to'lash va dostavshik oynalari uchun umumiy).
 * Aniq hisob-kitob va tekshiruv — serverda (universal taqsimot); bu yerda faqat ekranda ko'rsatish va API tanasi.
 */
import { TERMINAL_NETWORK_LABELS, type TerminalNetwork } from "@bum/shared";

export type PaymentTerminalOption = { id: string; name: string; network: TerminalNetwork; branchId?: string | null };
/** Kassada ko'rsatiladigan bank hisobi (Moliya → Kassa & Bank → "Kassada ko'rsatish"). */
export type PaymentBankAccountOption = { id: string; name: string; bankName: string | null };
export type SplitMethod = "cash" | "card" | "bank";
export type SplitRow = { key: string; method: SplitMethod; terminalId: string | null; cashAccountId: string | null; amount: string };
export type SplitPart = { method: SplitMethod; amount: string; terminalId?: string; cashAccountId?: string };

const MONEY_RE = /^\d{1,13}(\.\d{1,2})?$/;
const normalize = (value: string) => value.replace(/\s/g, "").replace(",", ".");

/** Qism summasi tiyinda; noto'g'ri kiritilgan — 0. */
export function rowMinor(row: SplitRow): bigint {
  const value = normalize(row.amount);
  if (!MONEY_RE.test(value)) return 0n;
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, "0"));
}

export const splitPaidMinor = (rows: SplitRow[]) => rows.reduce((sum, row) => sum + rowMinor(row), 0n);

export const minorText = (minor: bigint) => `${minor / 100n}.${String(minor % 100n).padStart(2, "0")}`;

/** Qism kaliti: usul + terminal + bank hisobi (server bilan bir xil — takror qism rad etiladi). */
export const partKey = (row: { method: string; terminalId: string | null; cashAccountId: string | null }) =>
  `${row.method}|${row.terminalId ?? ""}|${row.cashAccountId ?? ""}`;

export function newSplitRow(method: SplitMethod = "cash", terminalId: string | null = null, amount = "", cashAccountId: string | null = null): SplitRow {
  return { key: crypto.randomUUID(), method, terminalId, cashAccountId, amount };
}

/** Takrorlangan qism (bir xil usul, terminal va hisob) — server rad etadi, oldindan ko'rsatiladi. */
export function hasDuplicateParts(rows: SplitRow[]) {
  const keys = rows.filter((row) => rowMinor(row) > 0n).map(partKey);
  return new Set(keys).size !== keys.length;
}

/** API tanasi uchun qismlar (nol summalilarsiz). */
export function splitParts(rows: SplitRow[]): SplitPart[] {
  return rows
    .filter((row) => rowMinor(row) > 0n)
    .map((row) => ({
      method: row.method,
      amount: minorText(rowMinor(row)),
      ...(row.terminalId ? { terminalId: row.terminalId } : {}),
      ...(row.cashAccountId ? { cashAccountId: row.cashAccountId } : {}),
    }));
}

/** Terminal yorlig'i: "UZCARD"; shu tizimdagi bir nechta terminal bo'lsa — "UZCARD · Kassa 2". */
export function terminalOptionLabel(terminal: PaymentTerminalOption, all: readonly PaymentTerminalOption[]) {
  const network = TERMINAL_NETWORK_LABELS[terminal.network] ?? terminal.name;
  return all.filter((item) => item.network === terminal.network).length > 1 ? `${network} · ${terminal.name}` : network;
}
