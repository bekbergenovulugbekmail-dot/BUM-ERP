/**
 * Moliya API javoblari (`/api/finance/*`). Summalar — aniq o'nlik satr ("12500.00"),
 * `Number()` faqat ko'rsatish uchun.
 */
import type { TerminalNetwork } from "@bum/shared";

export type AccountType = "asset" | "liability" | "equity" | "income" | "expense";

export type Account = {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  subtype: string | null;
  parentId: string | null;
  currency: string;
  balance: string;
  description: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

/** `card`/`ewallet` — kutilayotgan hisob: pul bank qirqimigacha shu hisobda turadi. */
export type CashAccountType = "cash" | "bank" | "card" | "ewallet";

export const CASH_ACCOUNT_TYPE_LABELS: Record<CashAccountType, string> = {
  cash: "Naqd kassa",
  bank: "Bank hisobi",
  card: "Karta terminali (kutilayotgan)",
  ewallet: "Elektron hamyon (kutilayotgan)",
};

export const isPendingAccountType = (type: CashAccountType) => type === "card" || type === "ewallet";

export type CashAccount = {
  id: string;
  name: string;
  type: CashAccountType;
  currency: string;
  bankName: string | null;
  accountNumber: string | null;
  balance: string;
  /** Alohida buxgalteriya hisobi (bo'lmasa 1010 naqd / 1020 bank). */
  ledgerAccountId: string | null;
  /** Bank hisobi kassada to'lov usuli sifatida ko'rinadi. */
  showInPos: boolean;
  /** Bank hisobidan pul chiqarish komissiyasi, % ("1.00"). */
  outgoingCommissionPercent: string;
  /** Kutilayotgan hisob qaysi bank hisobiga qirqiladi (faqat `card`/`ewallet`). */
  settlesToCashAccountId: string | null;
  /** Qirqim komissiyasi, % ("0.25") — qirqimda ushlanadi. */
  settlementCommissionPercent: string;
  /** Kassaning mas'ul xodimi: rahbar (asosiy) kassada bo'lmaydi, qolganlari xodimga biriktiriladi. */
  employeeId: string | null;
  /** Ro'yxatda qulaylik uchun — mas'ul xodimning ismi va kodi. */
  employeeName?: string | null;
  employeeCode?: string | null;
  isDefault: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

/** `GET /api/finance/settlements` — qirqilmagan karta/hamyon pullari ("UZCARD'dan kutilayotgan"). */
export type PendingSettlement = {
  id: string;
  name: string;
  type: CashAccountType;
  currency: string;
  isActive: boolean;
  /** Qirqilmagan qoldiq. */
  pending: string;
  /** Bugun shu hisobga tushgan summa. */
  today: string;
  commissionPercent: string;
  settlesTo: { id: string; name: string } | null;
  terminals: { id: string; name: string; network: TerminalNetwork }[];
};

export type PaymentTerminal = {
  id: string;
  name: string;
  network: TerminalNetwork;
  provider: string | null;
  cashAccountId: string;
  cashAccountName: string;
  bankName: string | null;
  accountNumber: string | null;
  branchId: string | null;
  branchName: string | null;
  terminalIdentifier: string | null;
  /** Ekvayring komissiyasi, % ("0.25"). */
  commissionPercent: string;
  showInPos: boolean;
  isActive: boolean;
};

export type CashTransaction = {
  id: string;
  cashAccountId: string;
  type: "in" | "out" | "transfer";
  amount: string;
  currency: string;
  txDate: string;
  description: string;
  category: string | null;
  referenceType: string | null;
  referenceId: string | null;
  balanceAfter: string;
  createdBy: string | null;
  createdAt: string;
};

export type FinanceDashboard = {
  totalCash: string;
  totalBank: string;
  totalBalance: string;
  monthIncome: string;
  monthExpense: string;
  monthNetCash: string;
  monthSalesTotal: string;
  monthPurchaseTotal: string;
  accounts: CashAccount[];
};

export type ExpenseStatus = "pending" | "approved" | "paid";

export type Expense = {
  id: string;
  number: string;
  category: string;
  description: string;
  amount: string;
  currency: string;
  expenseDate: string;
  accountId: string | null;
  paidBy: string | null;
  attachmentKey: string | null;
  status: ExpenseStatus;
  notes: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ExpenseStats = {
  totalThisMonth: string;
  countThisMonth: number;
  pendingCount: number;
  pendingAmount: string;
  /** Bu oy, summa bo'yicha kamayish tartibida. */
  byCategory: { category: string; total: string }[];
};

/** `GET /api/finance/reports/bank-commissions` — ekvayring (karta) va pul chiqarish komissiyasi. */
export type BankCommissionReport = {
  dateFrom: string | null;
  dateTo: string | null;
  totals: { acquiring: string; outgoing: string; total: string; cardTurnover: string };
  byAccount: { cashAccountId: string; name: string; acquiring: string; outgoing: string; total: string; cardTurnover: string }[];
  byTerminal: {
    terminalId: string;
    name: string;
    network: TerminalNetwork;
    cashAccountName: string;
    commissionPercent: string;
    turnover: string;
    commission: string;
    net: string;
  }[];
  rows: {
    id: string;
    number: string;
    date: string;
    kind: "acquiring" | "outgoing";
    sourceType: string;
    cashAccountId: string | null;
    cashAccountName: string | null;
    terminalName: string | null;
    sourceAmount: string | null;
    amount: string;
    description: string;
  }[];
};

export type ProfitLossLine ={ accountId: string; code: string; name: string; amount: string };

export type ProfitLoss = {
  income: ProfitLossLine[];
  expenses: ProfitLossLine[];
  totalIncome: string;
  totalExpense: string;
  netProfit: string;
};

export const toNum = (value: string | number | null | undefined) => Number(value ?? 0) || 0;

export const fmt = (value: string | number | null | undefined) =>
  new Intl.NumberFormat("uz-UZ").format(Math.round(toNum(value)));

/** "YYYY-MM-DD" ga kun qo'shish/ayirish (sof funksiya — render ichida xavfsiz). */
export function shiftIsoDate(iso: string, days: number) {
  const [year, month, day] = iso.split("-").map(Number);
  return localIsoDate(new Date(year!, month! - 1, day! + days));
}

/** Mahalliy sana (UTC emas)— "YYYY-MM-DD". */
export function localIsoDate(date = new Date()) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}
