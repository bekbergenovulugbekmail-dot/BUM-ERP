/** Kassalar va kassa hujjatlari — server javoblari (`/api/finance/cash/*`, `/api/finance/cash-documents`). */
export type CashRegister = {
  id: string;
  name: string;
  type: "cash" | "bank" | "card" | "ewallet";
  currency: string;
  balance: string;
  isDefault: boolean;
  employeeId: string | null;
  employeeName: string | null;
  employeeCode: string | null;
};

export type TransferTarget = { id: string; name: string; type: CashRegister["type"]; currency: string; isDefault: boolean };

export type CashCategory = {
  id: string;
  name: string;
  direction: "in" | "out";
  counterAccountCode: string;
  counterAccountName: string;
  isActive: boolean;
};

export type CashDocumentKind = "transfer" | "method_correction" | "method_exchange" | "currency_exchange" | "income" | "expense";

export type CashDocument = {
  id: string;
  number: string;
  kind: CashDocumentKind;
  status: "posted" | "reversed";
  docDate: string;
  fromCashAccountId: string | null;
  toCashAccountId: string | null;
  fromCashAccountName: string | null;
  toCashAccountName: string | null;
  amount: string;
  currency: string;
  toAmount: string | null;
  toCurrency: string | null;
  dealRate: string | null;
  difference: string;
  categoryName: string | null;
  counterpartyName: string | null;
  responsibleName: string | null;
  reason: string;
  reference: string | null;
  createdByName: string | null;
  approvedByName: string | null;
  approvedBy: string | null;
  reversedByName: string | null;
  reversalReason: string | null;
};

export type CashReport = {
  account: CashRegister;
  from: string;
  to: string;
  opening: string;
  lines: { group: string; label: string; direction: "in" | "out"; amount: string; count: number }[];
  totals: Record<"in" | "out" | "income" | "expense" | "transferIn" | "transferOut" | "exchangeIn" | "exchangeOut" | "correctionIn" | "correctionOut" | "reversalIn" | "reversalOut", string>;
  closing: string;
  currentBalance: string;
  consistent: boolean;
};

export const KIND_LABELS: Record<CashDocumentKind, string> = {
  transfer: "O'tkazma",
  method_correction: "To'lov usulini tuzatish",
  method_exchange: "To'lov usulini ayirboshlash",
  currency_exchange: "Valyuta ayirboshlash",
  income: "Kirim",
  expense: "Chiqim",
};

export const TYPE_LABELS: Record<CashRegister["type"], string> = { cash: "Naqd", bank: "Bank", card: "Karta", ewallet: "Hamyon" };

export const money = (value: string | number, currency?: string) =>
  `${new Intl.NumberFormat("uz-UZ", { maximumFractionDigits: 2 }).format(Number(value))}${currency && currency !== "UZS" ? ` ${currency}` : ""}`;

export const localToday = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};
