/**
 * Karta to'lov terminallari (UZCARD, HUMO, VISA ...) va ularning bank hisobiga bog'lanishi.
 *
 * Terminal karta tushumi qaysi bank hisobiga tushishini belgilaydi: to'lov qismida terminal tanlansa — pul shu hisobga,
 * jurnal shu hisobning buxgalteriya hisobiga (bog'langan bo'lsa 1021 ..., aks holda 1020). Haqiqiy ekvayring API'si
 * ulanmagan: "to'lov o'tdi" degan tasdiq terminaldan kelmaydi — kassir yoki dostavshik terminal chekiga qarab kiritadi.
 * Terminal o'chirilmaydi, faolsizlantiriladi (eski to'lovlarning bog'lanishi saqlanadi).
 */
import { and, asc, eq, ne } from "drizzle-orm";
import { badRequest, conflict, notFound, type TerminalNetwork } from "@bum/shared";
import { cashAccounts, paymentTerminals } from "../../db/schema/finance.js";
import { branches } from "../../db/schema/platform.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import type { RequestMeta } from "../../shared/audit.js";
import type { TenantContext } from "../company/tenant.js";
import { companyCurrency, financeAudit } from "./accounts.service.js";

export type TerminalInput = {
  name: string;
  network: TerminalNetwork;
  provider?: string | null;
  cashAccountId: string;
  branchId?: string | null;
  terminalIdentifier?: string | null;
  /** Ekvayring komissiyasi, % (0 — komissiyasiz). */
  commissionPercent?: string;
  /** Kassada to'lov usuli sifatida ko'rinadi. */
  showInPos?: boolean;
  isActive?: boolean;
};

const terminalFields = {
  id: paymentTerminals.id,
  name: paymentTerminals.name,
  network: paymentTerminals.network,
  provider: paymentTerminals.provider,
  cashAccountId: paymentTerminals.cashAccountId,
  cashAccountName: cashAccounts.name,
  bankName: cashAccounts.bankName,
  accountNumber: cashAccounts.accountNumber,
  branchId: paymentTerminals.branchId,
  branchName: branches.name,
  terminalIdentifier: paymentTerminals.terminalIdentifier,
  commissionPercent: paymentTerminals.commissionPercent,
  showInPos: paymentTerminals.showInPos,
  isActive: paymentTerminals.isActive,
  createdAt: paymentTerminals.createdAt,
  updatedAt: paymentTerminals.updatedAt,
};

function terminalQuery(conn: DbOrTx) {
  return conn
    .select(terminalFields)
    .from(paymentTerminals)
    .innerJoin(cashAccounts, eq(cashAccounts.id, paymentTerminals.cashAccountId))
    .leftJoin(branches, eq(branches.id, paymentTerminals.branchId));
}

export async function listTerminals(conn: DbOrTx, companyId: string, options: { includeInactive?: boolean } = {}) {
  return terminalQuery(conn)
    .where(and(eq(paymentTerminals.companyId, companyId), options.includeInactive ? undefined : eq(paymentTerminals.isActive, true)))
    .orderBy(asc(paymentTerminals.name));
}

export async function getTerminal(conn: DbOrTx, companyId: string, terminalId: string) {
  const [row] = await terminalQuery(conn)
    .where(and(eq(paymentTerminals.id, terminalId), eq(paymentTerminals.companyId, companyId)))
    .limit(1);
  if (!row) throw notFound("Terminal topilmadi");
  return row;
}

/** Terminal bog'lanadigan hisob: shu kompaniyaning faol, asosiy valyutadagi bank hisobi. */
async function assertTerminalAccount(conn: DbOrTx, companyId: string, cashAccountId: string) {
  const [account] = await conn
    .select({ type: cashAccounts.type, isActive: cashAccounts.isActive, currency: cashAccounts.currency })
    .from(cashAccounts)
    .where(and(eq(cashAccounts.id, cashAccountId), eq(cashAccounts.companyId, companyId)))
    .limit(1);
  if (!account) throw notFound("Bank hisobi topilmadi");
  if (account.type !== "bank") throw badRequest("Terminal faqat bank hisobiga bog'lanadi");
  if (!account.isActive) throw badRequest("Bank hisobi faol emas");
  if (account.currency !== (await companyCurrency(conn, companyId))) throw badRequest("Terminal asosiy valyutadagi bank hisobiga bog'lanadi");
}

async function assertBranch(conn: DbOrTx, companyId: string, branchId: string) {
  const [branch] = await conn
    .select({ id: branches.id })
    .from(branches)
    .where(and(eq(branches.id, branchId), eq(branches.companyId, companyId)))
    .limit(1);
  if (!branch) throw notFound("Filial topilmadi");
}

async function assertUnique(tx: Tx, companyId: string, input: { name?: string; terminalIdentifier?: string | null }, exceptId?: string) {
  if (input.name) {
    const [taken] = await tx
      .select({ id: paymentTerminals.id })
      .from(paymentTerminals)
      .where(and(eq(paymentTerminals.companyId, companyId), eq(paymentTerminals.name, input.name), exceptId ? ne(paymentTerminals.id, exceptId) : undefined))
      .limit(1);
    if (taken) throw conflict(`"${input.name}" nomli terminal bor`);
  }
  if (input.terminalIdentifier) {
    const [taken] = await tx
      .select({ id: paymentTerminals.id })
      .from(paymentTerminals)
      .where(
        and(
          eq(paymentTerminals.companyId, companyId),
          eq(paymentTerminals.terminalIdentifier, input.terminalIdentifier),
          exceptId ? ne(paymentTerminals.id, exceptId) : undefined,
        ),
      )
      .limit(1);
    if (taken) throw conflict(`Terminal ID ${input.terminalIdentifier} boshqa terminalda`);
  }
}

export async function createTerminal(tx: Tx, tenant: TenantContext, input: TerminalInput, meta: RequestMeta) {
  const companyId = tenant.company.id;
  await assertTerminalAccount(tx, companyId, input.cashAccountId);
  if (input.branchId) await assertBranch(tx, companyId, input.branchId);
  await assertUnique(tx, companyId, input);
  const [row] = await tx
    .insert(paymentTerminals)
    .values({
      companyId,
      name: input.name,
      network: input.network,
      provider: input.provider ?? null,
      cashAccountId: input.cashAccountId,
      branchId: input.branchId ?? null,
      terminalIdentifier: input.terminalIdentifier ?? null,
      commissionPercent: input.commissionPercent ?? "0",
      showInPos: input.showInPos ?? true,
      isActive: input.isActive ?? true,
    })
    .returning({ id: paymentTerminals.id });
  await financeAudit(tx, tenant, meta, {
    action: "PAYMENT_TERMINAL_CREATED",
    resource: "payment_terminals",
    resourceId: row!.id,
    details: {
      name: input.name,
      network: input.network,
      cashAccountId: input.cashAccountId,
      branchId: input.branchId ?? null,
      commissionPercent: input.commissionPercent ?? "0",
    },
  });
  return getTerminal(tx, companyId, row!.id);
}

export async function updateTerminal(tx: Tx, tenant: TenantContext, terminalId: string, patch: Partial<TerminalInput>, meta: RequestMeta) {
  const companyId = tenant.company.id;
  const [current] = await tx
    .select({ id: paymentTerminals.id })
    .from(paymentTerminals)
    .where(and(eq(paymentTerminals.id, terminalId), eq(paymentTerminals.companyId, companyId)))
    .limit(1)
    .for("update");
  if (!current) throw notFound("Terminal topilmadi");
  if (patch.cashAccountId) await assertTerminalAccount(tx, companyId, patch.cashAccountId);
  if (patch.branchId) await assertBranch(tx, companyId, patch.branchId);
  await assertUnique(tx, companyId, patch, terminalId);
  await tx
    .update(paymentTerminals)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(paymentTerminals.id, terminalId));
  await financeAudit(tx, tenant, meta, {
    action: "PAYMENT_TERMINAL_UPDATED",
    resource: "payment_terminals",
    resourceId: terminalId,
    details: {
      changes: Object.keys(patch),
      ...(patch.cashAccountId ? { cashAccountId: patch.cashAccountId } : {}),
      ...(patch.commissionPercent !== undefined ? { commissionPercent: patch.commissionPercent } : {}),
    },
  });
  return getTerminal(tx, companyId, terminalId);
}

/** Shu kompaniyaning terminali (faolligidan qat'i nazar); boshqa kompaniyaniki — topilmadi. */
export async function findCompanyTerminal(conn: DbOrTx, companyId: string, terminalId: string) {
  const [terminal] = await conn
    .select({
      id: paymentTerminals.id,
      name: paymentTerminals.name,
      network: paymentTerminals.network,
      cashAccountId: paymentTerminals.cashAccountId,
      commissionPercent: paymentTerminals.commissionPercent,
      isActive: paymentTerminals.isActive,
    })
    .from(paymentTerminals)
    .where(and(eq(paymentTerminals.id, terminalId), eq(paymentTerminals.companyId, companyId)))
    .limit(1);
  if (!terminal) throw notFound("Terminal topilmadi");
  return terminal;
}

/** To'lovda ishlatiladigan terminal: shu kompaniyaniki va faol. */
export async function requireActiveTerminal(conn: DbOrTx, companyId: string, terminalId: string) {
  const terminal = await findCompanyTerminal(conn, companyId, terminalId);
  if (!terminal.isActive) throw badRequest(`"${terminal.name}" terminali faol emas`);
  return terminal;
}

/**
 * Kassa ekrani va dostavshik uchun: faol terminallar (bank hisobi va komissiya ma'lumotisiz).
 * `posOnly` — faqat "Kassada ko'rsatish" belgilanganlari (web va desktop kassa).
 */
export async function paymentTerminalOptions(conn: DbOrTx, companyId: string, options: { posOnly?: boolean } = {}) {
  return conn
    .select({ id: paymentTerminals.id, name: paymentTerminals.name, network: paymentTerminals.network, branchId: paymentTerminals.branchId })
    .from(paymentTerminals)
    .innerJoin(cashAccounts, eq(cashAccounts.id, paymentTerminals.cashAccountId))
    .where(
      and(
        eq(paymentTerminals.companyId, companyId),
        eq(paymentTerminals.isActive, true),
        eq(cashAccounts.isActive, true),
        options.posOnly ? eq(paymentTerminals.showInPos, true) : undefined,
      ),
    )
    .orderBy(asc(paymentTerminals.name));
}

/** Kassada to'lov usuli sifatida ko'rsatiladigan bank hisoblari: faol, asosiy valyutada, "Kassada ko'rsatish" belgilangan. */
export async function posBankAccountOptions(conn: DbOrTx, companyId: string) {
  const currency = await companyCurrency(conn, companyId);
  return conn
    .select({ id: cashAccounts.id, name: cashAccounts.name, bankName: cashAccounts.bankName })
    .from(cashAccounts)
    .where(
      and(
        eq(cashAccounts.companyId, companyId),
        eq(cashAccounts.type, "bank"),
        eq(cashAccounts.isActive, true),
        eq(cashAccounts.showInPos, true),
        eq(cashAccounts.currency, currency),
      ),
    )
    .orderBy(asc(cashAccounts.name));
}
