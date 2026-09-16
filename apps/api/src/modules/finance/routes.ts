/**
 * /api/finance — hisoblar rejasi, jurnal, kassa/bank, xarajatlar (convex/finance/*).
 *
 *   POST   /setup                                              finance.manage (standart hisoblar; idempotent)
 *   GET    /accounts (?type=&includeInactive=)                 finance.view
 *   POST   /accounts, PATCH /accounts/:accountId               finance.manage
 *   GET    /reports/trial-balance, /reports/profit-loss (?dateFrom=&dateTo=)   finance.view
 *   GET    /reports/bank-commissions (?dateFrom=&dateTo=&cashAccountId=)   finance.view (karta va pul chiqarish komissiyasi)
 *   GET    /journal (?dateFrom=&dateTo=&status=&referenceType=&limit=&cursor=), /journal/:entryId   finance.view
 *   POST   /journal                                            finance.manage (qo'lda yozuv)
 *   POST   /journal/:entryId/void                              finance.approve (faqat qo'lda yozuv)
 *   GET    /dashboard                                          finance.view
 *   GET    /cash-accounts (?includeInactive=)                  finance.view
 *   GET    /cash-accounts/:cashAccountId/transactions (?dateFrom=&dateTo=&limit=&cursor=)   finance.view
 *   POST   /cash-accounts, PATCH /cash-accounts/:cashAccountId finance.manage
 *   POST   /cash-transactions, /cash-transfers                 finance.manage
 *   GET    /settlements                                        finance.view (kutilayotgan karta/hamyon puli)
 *   POST   /cash-accounts/:cashAccountId/settle                finance.manage (qirqim: komissiya ushlanib bank hisobiga)
 *   GET    /terminals (?includeInactive=), /terminals/:terminalId   finance.view (karta terminallari → bank hisobi)
 *   POST   /terminals, PATCH /terminals/:terminalId            finance.manage
 *   GET    /expenses (?status=&category=&dateFrom=&dateTo=&limit=&cursor=), /expenses/stats   finance.view
 *   POST   /expenses, PATCH / DELETE /expenses/:expenseId      finance.manage
 *   POST   /expenses/:expenseId/status                         finance.approve (paid — kassa chiqimi + jurnal)
 *   GET    /currencies                                         a'zo (valyutalar va kurslar; CBU kursi kunda bir yangilanadi)
 *   GET    /currencies/cbu                                     a'zo (Markaziy bank kurslari; 503 — olib bo'lmasa)
 *   PUT    /currencies, POST /currencies/refresh               settings.manage
 *   PUT    /currencies/:code/rate                              currency_rates.manage (bitta kurs; tarix va audit)
 *   GET    /currencies/history (?code=&limit=)                 currency_rates.view (eski → yangi kurs, kim, qaysi kassa)
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { MAX_COMPANY_CURRENCIES, TERMINAL_NETWORKS, type Permission } from "@bum/shared";
import { db } from "../../db/client.js";
import { withTransaction, type Tx } from "../../db/transaction.js";
import { requestMeta } from "../../shared/audit.js";
import { decimalSchema, moneySchema, percentSchema } from "../../shared/decimal.js";
import { authOf, requireAuth } from "../auth/guard.js";
import { requirePermission, requireTenant, requireTenantForWrite, type TenantContext } from "../company/tenant.js";
import {
  companyCurrency,
  createAccount,
  listAccounts,
  profitAndLoss,
  seedFinanceDefaults,
  trialBalance,
  updateAccount,
} from "./accounts.service.js";
import {
  createCashAccount,
  financeDashboard,
  listCashAccounts,
  listCashTransactions,
  recordManualCashTransaction,
  transferCash,
  updateCashAccount,
} from "./cash.service.js";
import {
  createExpense,
  deleteExpense,
  expenseStats,
  listExpenses,
  setExpenseStatus,
  updateExpense,
} from "./expenses.service.js";
import { bankCommissionReport } from "./bank-commission-report.service.js";
import {
  getCbuRates,
  getCurrencySettings,
  listRateHistory,
  refreshCbuRates,
  refreshStaleCbuRates,
  saveCurrencySettings,
  setCurrencyRate,
} from "./currencies.service.js";
import { createManualEntry, getJournalEntry, getLockDate, listJournal, setLockDate, voidManualEntry } from "./journal.service.js";
import { listPendingSettlements, settleCashAccount } from "./settlement.service.js";
import { createTerminal, getTerminal, listTerminals, updateTerminal } from "./terminals.service.js";

const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null)
    .nullable()
    .optional();
const boolQuery = z.enum(["true", "false"]).transform((v) => v === "true").optional();
const isoDate = z.iso.date();
const positiveMoney = decimalSchema({ scale: 2, positive: true });
const limitQuery = z.coerce.number().int().min(1).max(200).default(50);
const cursorQuery = z.string().max(500).optional();

const accountTypes = ["asset", "liability", "equity", "income", "expense"] as const;
const accountBody = z.strictObject({
  code: z.string().trim().min(1).max(32),
  name: z.string().trim().min(1).max(200),
  type: z.enum(accountTypes),
  subtype: nullableText(64),
  parentId: z.uuid().nullable().optional(),
  description: nullableText(2000),
});
const accountPatch = z.strictObject({
  name: z.string().trim().min(1).max(200).optional(),
  subtype: nullableText(64),
  parentId: z.uuid().nullable().optional(),
  description: nullableText(2000),
  isActive: z.boolean().optional(),
});
const accountsQuery = z.object({ type: z.enum(accountTypes).optional(), includeInactive: boolQuery });
const rangeQuery = z.object({ dateFrom: isoDate.optional(), dateTo: isoDate.optional() });
const bankCommissionQuery = z.object({ dateFrom: isoDate.optional(), dateTo: isoDate.optional(), cashAccountId: z.uuid().optional() });

const journalBody = z.strictObject({
  entryDate: isoDate,
  description: z.string().trim().min(1).max(1000),
  notes: nullableText(2000),
  lines: z
    .array(
      z.strictObject({
        accountId: z.uuid(),
        debit: moneySchema.optional(),
        credit: moneySchema.optional(),
        description: nullableText(500),
      }),
    )
    .min(2)
    .max(200),
});
const journalQuery = z.object({
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
  status: z.enum(["draft", "posted", "voided"]).optional(),
  /** `manual` — qo'lda kiritilganlar. */
  referenceType: z.string().trim().min(1).max(50).optional(),
  limit: limitQuery,
  cursor: cursorQuery,
});

const cashAccountBody = z.strictObject({
  name: z.string().trim().min(1).max(200),
  /** `card`/`ewallet` — kutilayotgan hisob: pul qirqimgacha shu yerda, komissiya qirqimda ushlanadi. */
  type: z.enum(["cash", "bank", "card", "ewallet"]),
  bankName: nullableText(200),
  accountNumber: nullableText(64),
  isDefault: z.boolean().optional(),
  openingBalance: moneySchema.optional(),
  /** Standart — asosiy valyuta; valyutali kassa asosiy bo'la olmaydi. */
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Valyuta kodi 3 harf (ISO 4217)").optional(),
  /** Alohida buxgalteriya hisobi (aktiv); bo'lmasa 1010 naqd / 1020 bank. */
  ledgerAccountId: z.uuid().nullable().optional(),
  /** Bank hisobi kassada to'lov usuli sifatida ko'rinadi. */
  showInPos: z.boolean().optional(),
  /** Bank hisobidan pul chiqarish komissiyasi, % (0–100). */
  outgoingCommissionPercent: percentSchema.optional(),
  /** Kutilayotgan hisob qaysi bank hisobiga qirqiladi. */
  settlesToCashAccountId: z.uuid().nullable().optional(),
  /** Qirqim komissiyasi, % (0–100) — kutilayotgan hisobdan bankka o'tkazishda ushlanadi. */
  settlementCommissionPercent: percentSchema.optional(),
});
const cashAccountPatch = z.strictObject({
  name: z.string().trim().min(1).max(200).optional(),
  bankName: nullableText(200),
  accountNumber: nullableText(64),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
  ledgerAccountId: z.uuid().nullable().optional(),
  showInPos: z.boolean().optional(),
  outgoingCommissionPercent: percentSchema.optional(),
  /** Kutilayotgan hisob qaysi bank hisobiga qirqiladi. */
  settlesToCashAccountId: z.uuid().nullable().optional(),
  /** Qirqim komissiyasi, % (0–100). */
  settlementCommissionPercent: percentSchema.optional(),
});
/** Qirqim: kutilayotgan hisobdan bank hisobiga (komissiya qirqimda ushlanadi). */
const settlementBody = z.strictObject({
  /** Berilmasa — qirqilmagan butun qoldiq. */
  amount: positiveMoney.optional(),
  /** Berilmasa — hisobga bog'langan bank hisobi. */
  toCashAccountId: z.uuid().optional(),
  txDate: isoDate.optional(),
  notes: nullableText(500),
});
const terminalBody = z.strictObject({
  name: z.string().trim().min(1).max(100),
  network: z.enum(TERMINAL_NETWORKS),
  provider: nullableText(100),
  cashAccountId: z.uuid(),
  branchId: z.uuid().nullable().optional(),
  terminalIdentifier: nullableText(64),
  /** Ekvayring komissiyasi, % (0–100): to'lovdan ushlanadi, bank komissiyasi xarajati. */
  commissionPercent: percentSchema.optional(),
  showInPos: z.boolean().optional(),
  isActive: z.boolean().optional(),
});
const terminalParams = z.object({ terminalId: z.uuid() });
const cashTransactionsQuery = z.object({
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
  limit: limitQuery,
  cursor: cursorQuery,
});
const cashTransactionBody = z.strictObject({
  cashAccountId: z.uuid(),
  type: z.enum(["in", "out"]),
  amount: positiveMoney,
  txDate: isoDate.optional(),
  description: z.string().trim().min(1).max(1000),
  category: nullableText(64),
  counterAccountId: z.uuid().nullable().optional(),
});
const cashTransferBody = z.strictObject({
  fromCashAccountId: z.uuid(),
  toCashAccountId: z.uuid(),
  amount: positiveMoney,
  txDate: isoDate.optional(),
  description: nullableText(1000),
});

const expenseStatuses = ["pending", "approved", "paid"] as const;
const expenseBody = z.strictObject({
  category: z.string().trim().min(1).max(64),
  description: z.string().trim().min(1).max(1000),
  amount: positiveMoney,
  expenseDate: isoDate,
  accountId: z.uuid().nullable().optional(),
  paidBy: nullableText(200),
  notes: nullableText(2000),
});
const expensesQuery = z.object({
  status: z.enum(expenseStatuses).optional(),
  category: z.string().trim().min(1).max(64).optional(),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
  limit: limitQuery,
  cursor: cursorQuery,
});
const expenseStatusBody = z.strictObject({
  status: z.enum(expenseStatuses),
  cashAccountId: z.uuid().nullable().optional(),
  paidDate: isoDate.optional(),
});

const currenciesBody = z.strictObject({
  cbuEnabled: z.boolean(),
  currencies: z
    .array(
      z.strictObject({
        code: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Valyuta kodi 3 harf (ISO 4217)"),
        rate: decimalSchema({ scale: 4, positive: true }).optional(),
        source: z.enum(["manual", "cbu"]),
        isActive: z.boolean(),
      }),
    )
    .max(MAX_COMPANY_CURRENCIES),
});

const accountParams = z.object({ accountId: z.uuid() });
const entryParams = z.object({ entryId: z.uuid() });
const lockDateBody = z.strictObject({ lockDate: z.iso.date().nullable() });
const cashAccountParams = z.object({ cashAccountId: z.uuid() });
const expenseParams = z.object({ expenseId: z.uuid() });
const includeInactiveQuery = z.object({ includeInactive: boolQuery });

const currencyCodeSchema = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Valyuta kodi 3 harf (ISO 4217)");
const currencyParams = z.object({ code: currencyCodeSchema });
const currencyRateBody = z.strictObject({ rate: decimalSchema({ scale: 4, positive: true }) });
const rateHistoryQuery = z.object({
  code: currencyCodeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

async function readTenant(req: FastifyRequest, permission: Permission): Promise<TenantContext> {
  const tenant = await requireTenant(db, authOf(req).user);
  await requirePermission(db, tenant, permission);
  return tenant;
}

function writeInTenant<T>(
  req: FastifyRequest,
  permission: Permission,
  fn: (tx: Tx, tenant: TenantContext) => Promise<T>,
): Promise<T> {
  return withTransaction(async (tx) => {
    const tenant = await requireTenantForWrite(tx, authOf(req).user);
    await requirePermission(tx, tenant, permission);
    return fn(tx, tenant);
  });
}

export async function financeRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.post("/setup", async (req) =>
    writeInTenant(req, "finance.manage", async (tx, tenant) =>
      seedFinanceDefaults(tx, tenant.company.id, await companyCurrency(tx, tenant.company.id)),
    ),
  );

  // ─── Hisoblar rejasi va hisobotlar ───────────────────────────────────────

  app.get("/accounts", async (req) => {
    const query = accountsQuery.parse(req.query);
    return { accounts: await listAccounts(db, await readTenant(req, "finance.view"), query) };
  });

  app.post("/accounts", async (req, reply) => {
    const body = accountBody.parse(req.body);
    const account = await writeInTenant(req, "finance.manage", (tx, tenant) =>
      createAccount(tx, tenant, body, requestMeta(req)),
    );
    reply.status(201);
    return { account };
  });

  app.patch("/accounts/:accountId", async (req) => {
    const { accountId } = accountParams.parse(req.params);
    const patch = accountPatch.parse(req.body);
    const account = await writeInTenant(req, "finance.manage", (tx, tenant) =>
      updateAccount(tx, tenant, accountId, patch, requestMeta(req)),
    );
    return { account };
  });

  app.get("/reports/trial-balance", async (req) => {
    const range = rangeQuery.parse(req.query);
    return trialBalance(db, await readTenant(req, "finance.view"), range);
  });

  app.get("/reports/profit-loss", async (req) => {
    const range = rangeQuery.parse(req.query);
    return profitAndLoss(db, await readTenant(req, "finance.view"), range);
  });

  app.get("/reports/bank-commissions", async (req) => {
    const query = bankCommissionQuery.parse(req.query);
    return bankCommissionReport(db, await readTenant(req, "finance.view"), query);
  });

  // ─── Jurnal ──────────────────────────────────────────────────────────────

  app.get("/journal", async (req) => {
    const query = journalQuery.parse(req.query);
    return listJournal(db, await readTenant(req, "finance.view"), query);
  });

  app.get("/journal/:entryId", async (req) => {
    const { entryId } = entryParams.parse(req.params);
    return { entry: await getJournalEntry(db, await readTenant(req, "finance.view"), entryId) };
  });

  // Yopilgan davr: shu sanagacha qo'lda hujjat (jurnal yozuvi va uni bekor qilish, kassa amali, xarajat) kiritilmaydi
  app.get("/lock-date", async (req) => {
    const tenant = await readTenant(req, "finance.view");
    return { lockDate: await getLockDate(db, tenant.company.id) };
  });

  app.put("/lock-date", async (req) => {
    const { lockDate } = lockDateBody.parse(req.body);
    return { lockDate: await writeInTenant(req, "finance.approve", (tx, tenant) => setLockDate(tx, tenant, lockDate, requestMeta(req))) };
  });

  app.post("/journal", async (req, reply) => {
    const body = journalBody.parse(req.body);
    const entry = await writeInTenant(req, "finance.manage", (tx, tenant) =>
      createManualEntry(tx, tenant, body, requestMeta(req)),
    );
    reply.status(201);
    return { entry };
  });

  app.post("/journal/:entryId/void", async (req) => {
    const { entryId } = entryParams.parse(req.params);
    const entry = await writeInTenant(req, "finance.approve", (tx, tenant) =>
      voidManualEntry(tx, tenant, entryId, requestMeta(req)),
    );
    return { entry };
  });

  // ─── Kassa va bank ───────────────────────────────────────────────────────

  app.get("/dashboard", async (req) => financeDashboard(db, await readTenant(req, "finance.view")));

  app.get("/cash-accounts", async (req) => {
    const { includeInactive } = includeInactiveQuery.parse(req.query);
    return { cashAccounts: await listCashAccounts(db, await readTenant(req, "finance.view"), includeInactive ?? false) };
  });

  app.get("/cash-accounts/:cashAccountId/transactions", async (req) => {
    const { cashAccountId } = cashAccountParams.parse(req.params);
    const query = cashTransactionsQuery.parse(req.query);
    return listCashTransactions(db, await readTenant(req, "finance.view"), { ...query, cashAccountId });
  });

  app.post("/cash-accounts", async (req, reply) => {
    const body = cashAccountBody.parse(req.body);
    const cashAccount = await writeInTenant(req, "finance.manage", (tx, tenant) =>
      createCashAccount(tx, tenant, body, requestMeta(req)),
    );
    reply.status(201);
    return { cashAccount };
  });

  app.patch("/cash-accounts/:cashAccountId", async (req) => {
    const { cashAccountId } = cashAccountParams.parse(req.params);
    const patch = cashAccountPatch.parse(req.body);
    const cashAccount = await writeInTenant(req, "finance.manage", (tx, tenant) =>
      updateCashAccount(tx, tenant, cashAccountId, patch, requestMeta(req)),
    );
    return { cashAccount };
  });

  app.post("/cash-transactions", async (req, reply) => {
    const body = cashTransactionBody.parse(req.body);
    const result = await writeInTenant(req, "finance.manage", (tx, tenant) =>
      recordManualCashTransaction(tx, tenant, body, requestMeta(req)),
    );
    reply.status(201);
    return result;
  });

  app.post("/cash-transfers", async (req, reply) => {
    const body = cashTransferBody.parse(req.body);
    const result = await writeInTenant(req, "finance.manage", (tx, tenant) =>
      transferCash(tx, tenant, body, requestMeta(req)),
    );
    reply.status(201);
    return result;
  });

  // ─── Qirqim: kutilayotgan karta/hamyon puli → bank hisobi ────────────────

  app.get("/settlements", async (req) => {
    const tenant = await readTenant(req, "finance.view");
    return listPendingSettlements(db, tenant.company.id);
  });

  app.post("/cash-accounts/:cashAccountId/settle", async (req, reply) => {
    const { cashAccountId } = cashAccountParams.parse(req.params);
    const body = settlementBody.parse(req.body ?? {});
    const settlement = await writeInTenant(req, "finance.manage", (tx, tenant) =>
      settleCashAccount(tx, tenant, cashAccountId, body, requestMeta(req)),
    );
    reply.status(201);
    return { settlement };
  });

  // ─── Karta terminallari ──────────────────────────────────────────────────

  app.get("/terminals", async (req) => {
    const { includeInactive } = includeInactiveQuery.parse(req.query);
    const tenant = await readTenant(req, "finance.view");
    return { terminals: await listTerminals(db, tenant.company.id, { includeInactive: includeInactive ?? false }) };
  });

  app.get("/terminals/:terminalId", async (req) => {
    const { terminalId } = terminalParams.parse(req.params);
    const tenant = await readTenant(req, "finance.view");
    return { terminal: await getTerminal(db, tenant.company.id, terminalId) };
  });

  app.post("/terminals", async (req, reply) => {
    const body = terminalBody.parse(req.body);
    const terminal = await writeInTenant(req, "finance.manage", (tx, tenant) => createTerminal(tx, tenant, body, requestMeta(req)));
    reply.status(201);
    return { terminal };
  });

  app.patch("/terminals/:terminalId", async (req) => {
    const { terminalId } = terminalParams.parse(req.params);
    const patch = terminalBody.partial().parse(req.body);
    const terminal = await writeInTenant(req, "finance.manage", (tx, tenant) =>
      updateTerminal(tx, tenant, terminalId, patch, requestMeta(req)),
    );
    return { terminal };
  });

  // ─── Valyutalar va kurslar ───────────────────────────────────────────────

  app.get("/currencies", async (req) => {
    const tenant = await requireTenant(db, authOf(req).user);
    await refreshStaleCbuRates(tenant.company.id);
    return getCurrencySettings(db, tenant.company.id);
  });

  app.get("/currencies/cbu", async (req, reply) => {
    await requireTenant(db, authOf(req).user);
    try {
      return { rates: await getCbuRates() };
    } catch {
      return reply.status(503).send({ code: "SERVICE_UNAVAILABLE", message: "Markaziy bank kurslarini olib bo'lmadi" });
    }
  });

  app.put("/currencies", async (req) => {
    const body = currenciesBody.parse(req.body);
    return writeInTenant(req, "settings.manage", async (tx, tenant) => {
      // Kurslar ham saqlanadi — alohida kurs endpointi kabi kurs ruxsati kerak
      await requirePermission(tx, tenant, "currency_rates.manage");
      return saveCurrencySettings(tx, tenant, body, requestMeta(req));
    });
  });

  app.post("/currencies/refresh", async (req) =>
    writeInTenant(req, "settings.manage", (tx, tenant) => refreshCbuRates(tx, tenant, requestMeta(req))),
  );

  // Bitta valyuta kursi — sozlamalarni boshqarish huquqisiz ham (`currency_rates.manage`)
  app.put("/currencies/:code/rate", async (req) => {
    const { code } = currencyParams.parse(req.params);
    const { rate } = currencyRateBody.parse(req.body);
    const currency = await writeInTenant(req, "currency_rates.manage", (tx, tenant) => setCurrencyRate(tx, tenant, { code, rate }, requestMeta(req)));
    return { currency };
  });

  app.get("/currencies/history", async (req) => {
    const query = rateHistoryQuery.parse(req.query);
    const tenant = await readTenant(req, "currency_rates.view");
    return { history: await listRateHistory(db, tenant.company.id, query) };
  });

  // ─── Xarajatlar ──────────────────────────────────────────────────────────

  app.get("/expenses", async (req) => {
    const query = expensesQuery.parse(req.query);
    return listExpenses(db, await readTenant(req, "finance.view"), query);
  });

  app.get("/expenses/stats", async (req) => expenseStats(db, await readTenant(req, "finance.view")));

  app.post("/expenses", async (req, reply) => {
    const body = expenseBody.parse(req.body);
    const expense = await writeInTenant(req, "finance.manage", (tx, tenant) =>
      createExpense(tx, tenant, body, requestMeta(req)),
    );
    reply.status(201);
    return { expense };
  });

  app.patch("/expenses/:expenseId", async (req) => {
    const { expenseId } = expenseParams.parse(req.params);
    const patch = expenseBody.partial().parse(req.body);
    const expense = await writeInTenant(req, "finance.manage", (tx, tenant) =>
      updateExpense(tx, tenant, expenseId, patch, requestMeta(req)),
    );
    return { expense };
  });

  app.delete("/expenses/:expenseId", async (req, reply) => {
    const { expenseId } = expenseParams.parse(req.params);
    await writeInTenant(req, "finance.manage", (tx, tenant) => deleteExpense(tx, tenant, expenseId, requestMeta(req)));
    return reply.status(204).send();
  });

  app.post("/expenses/:expenseId/status", async (req) => {
    const { expenseId } = expenseParams.parse(req.params);
    const body = expenseStatusBody.parse(req.body);
    return writeInTenant(req, "finance.approve", (tx, tenant) =>
      setExpenseStatus(tx, tenant, expenseId, body, requestMeta(req)),
    );
  });
}
