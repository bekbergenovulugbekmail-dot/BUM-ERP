/**
 * BOSHQARILADIGAN TO'LOV USULLARI (2026-09-27) — kanonik turlar (naqd / karta / bank / o'tkazma) ustidagi SOZLAMA qatlami.
 *
 * Usul yangi pul hisobi EMAS: u mavjud terminalga (UZCARD, HUMO …) yoki hisobga (bank, kutilayotgan karta hisobi) faqat
 * havola qiladi. Pul harakati, balans, jurnal — avvalgi `method` + `terminalId` + `cashAccountId` zanjiri orqali; usul ID'si
 * to'lov qatorida hisobot va nazorat uchun saqlanadi. Aralash to'lov — bir necha qism, nasiya — qoldiq qarzga (usul emas).
 *
 * Qoidalar serverda: usul shu kompaniyaniki va faol; mijoz yuborgan terminal/hisob usul sozlamasiga zid bo'lsa — rad;
 * usul ma'lum kassalarga cheklangan bo'lsa, boshqa kassa smenasida — 403 (offline chek rad etilmaydi, nomuvofiqlik).
 */
import { and, asc, eq, inArray } from "drizzle-orm";
import { AppError, badRequest, conflict, notFound, type AllocationMethod } from "@bum/shared";
import { cashAccounts, paymentMethodKassas, paymentMethods, paymentTerminals } from "../../db/schema/finance.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import type { RequestMeta } from "../../shared/audit.js";
import type { TenantContext } from "../company/tenant.js";
import { companyCurrency, financeAudit } from "./accounts.service.js";

export type PaymentMethodKind = "cash" | "card" | "bank" | "transfer";

export type PaymentMethodInput = {
  name: string;
  kind: PaymentMethodKind;
  terminalId?: string | null;
  cashAccountId?: string | null;
  showInPos?: boolean;
  isActive?: boolean;
  sortOrder?: number;
  /** Ruxsat etilgan kassalar; bo'sh — barcha kassalarda. */
  kassaIds?: string[];
};

const methodFields = {
  id: paymentMethods.id,
  name: paymentMethods.name,
  kind: paymentMethods.kind,
  terminalId: paymentMethods.terminalId,
  cashAccountId: paymentMethods.cashAccountId,
  showInPos: paymentMethods.showInPos,
  isActive: paymentMethods.isActive,
  sortOrder: paymentMethods.sortOrder,
};

async function kassaIdsByMethod(conn: DbOrTx, methodIds: string[]) {
  const map = new Map<string, string[]>();
  if (methodIds.length === 0) return map;
  const rows = await conn.select().from(paymentMethodKassas).where(inArray(paymentMethodKassas.paymentMethodId, methodIds));
  for (const row of rows) map.set(row.paymentMethodId, [...(map.get(row.paymentMethodId) ?? []), row.cashAccountId]);
  return map;
}

export async function listPaymentMethods(conn: DbOrTx, companyId: string, options: { includeInactive?: boolean } = {}) {
  const rows = await conn
    .select({ ...methodFields, terminalName: paymentTerminals.name, accountName: cashAccounts.name })
    .from(paymentMethods)
    .leftJoin(paymentTerminals, eq(paymentTerminals.id, paymentMethods.terminalId))
    .leftJoin(cashAccounts, eq(cashAccounts.id, paymentMethods.cashAccountId))
    .where(and(eq(paymentMethods.companyId, companyId), ...(options.includeInactive ? [] : [eq(paymentMethods.isActive, true)])))
    .orderBy(asc(paymentMethods.sortOrder), asc(paymentMethods.name));
  const kassas = await kassaIdsByMethod(conn, rows.map((row) => row.id));
  return rows.map((row) => ({ ...row, kassaIds: kassas.get(row.id) ?? [] }));
}

/** Kassa ekrani: shu kassada ruxsat etilgan, kassada ko'rinadigan faol usullar (kassasiz smena — cheklanmaganlari). */
export async function posPaymentMethods(conn: DbOrTx, companyId: string, kassaId: string | null) {
  const list = await listPaymentMethods(conn, companyId);
  return list.filter((method) => method.showInPos && (method.kassaIds.length === 0 || (kassaId !== null && method.kassaIds.includes(kassaId))));
}

/** Usul sozlamasi mosligi: terminal — karta; hisob — usul turiga mos (naqd usul hisobga bog'lanmaydi). */
async function assertMethodConfig(conn: DbOrTx, companyId: string, input: Pick<PaymentMethodInput, "kind" | "terminalId" | "cashAccountId" | "kassaIds">) {
  if (input.kind === "cash" && (input.terminalId || input.cashAccountId)) {
    throw badRequest("Naqd usul hisob yoki terminalga bog'lanmaydi — pul smena kassasiga tushadi");
  }
  if (input.terminalId) {
    if (input.kind !== "card") throw badRequest("Terminal faqat karta usuliga bog'lanadi");
    const [terminal] = await conn
      .select({ id: paymentTerminals.id, cashAccountId: paymentTerminals.cashAccountId })
      .from(paymentTerminals)
      .where(and(eq(paymentTerminals.id, input.terminalId), eq(paymentTerminals.companyId, companyId)))
      .limit(1);
    if (!terminal) throw notFound("Terminal topilmadi");
    if (input.cashAccountId && input.cashAccountId !== terminal.cashAccountId) throw badRequest("Terminal usulida hisob terminalning o'zidan olinadi");
  }
  if (input.cashAccountId) {
    const [account] = await conn
      .select({ type: cashAccounts.type, currency: cashAccounts.currency })
      .from(cashAccounts)
      .where(and(eq(cashAccounts.id, input.cashAccountId), eq(cashAccounts.companyId, companyId)))
      .limit(1);
    if (!account) throw notFound("Hisob topilmadi");
    if (account.type === "cash") throw badRequest("Karta/bank usuli naqd kassaga bog'lanmaydi");
    if (account.currency !== (await companyCurrency(conn, companyId))) throw badRequest("Usul hisobi asosiy valyutada bo'lishi kerak");
  }
  const kassaIds = [...new Set(input.kassaIds ?? [])];
  if (kassaIds.length > 0) {
    const found = await conn
      .select({ id: cashAccounts.id })
      .from(cashAccounts)
      .where(and(eq(cashAccounts.companyId, companyId), eq(cashAccounts.type, "cash"), inArray(cashAccounts.id, kassaIds)));
    if (found.length !== kassaIds.length) throw badRequest("Kassalar ro'yxatida begona yoki naqd bo'lmagan hisob bor");
  }
  return kassaIds;
}

async function assertNameFree(conn: DbOrTx, companyId: string, name: string, selfId?: string) {
  const [taken] = await conn
    .select({ id: paymentMethods.id })
    .from(paymentMethods)
    .where(and(eq(paymentMethods.companyId, companyId), eq(paymentMethods.name, name)))
    .limit(1);
  if (taken && taken.id !== selfId) throw conflict(`"${name}" nomli to'lov usuli bor`);
}

async function methodById(conn: DbOrTx, companyId: string, id: string) {
  const [row] = (await listPaymentMethods(conn, companyId, { includeInactive: true })).filter((method) => method.id === id);
  if (!row) throw notFound("To'lov usuli topilmadi");
  return row;
}

export async function createPaymentMethod(tx: Tx, tenant: TenantContext, input: PaymentMethodInput, meta: RequestMeta) {
  const companyId = tenant.company.id;
  const kassaIds = await assertMethodConfig(tx, companyId, input);
  await assertNameFree(tx, companyId, input.name);
  const [row] = await tx
    .insert(paymentMethods)
    .values({
      companyId,
      name: input.name,
      kind: input.kind,
      terminalId: input.terminalId ?? null,
      cashAccountId: input.terminalId ? null : (input.cashAccountId ?? null),
      showInPos: input.showInPos ?? true,
      isActive: input.isActive ?? true,
      sortOrder: input.sortOrder ?? 0,
    })
    .returning({ id: paymentMethods.id });
  if (kassaIds.length > 0) await tx.insert(paymentMethodKassas).values(kassaIds.map((cashAccountId) => ({ paymentMethodId: row!.id, cashAccountId })));
  await financeAudit(tx, tenant, meta, {
    action: "PAYMENT_METHOD_CREATED",
    resource: "payment_methods",
    resourceId: row!.id,
    details: { name: input.name, kind: input.kind, terminalId: input.terminalId ?? null, cashAccountId: input.cashAccountId ?? null, kassaIds },
  });
  return methodById(tx, companyId, row!.id);
}

export async function updatePaymentMethod(
  tx: Tx,
  tenant: TenantContext,
  id: string,
  patch: Partial<Omit<PaymentMethodInput, "kind">>,
  meta: RequestMeta,
) {
  const companyId = tenant.company.id;
  const current = await methodById(tx, companyId, id);
  // Tur o'zgarmaydi: tarixiy to'lovlar shu usul ID'si bilan boshqa turda ko'rinib qolmasin
  const next = {
    kind: current.kind,
    terminalId: patch.terminalId !== undefined ? patch.terminalId : current.terminalId,
    cashAccountId: patch.cashAccountId !== undefined ? patch.cashAccountId : current.cashAccountId,
    kassaIds: patch.kassaIds ?? current.kassaIds,
  };
  const kassaIds = await assertMethodConfig(tx, companyId, next);
  if (patch.name && patch.name !== current.name) await assertNameFree(tx, companyId, patch.name, id);
  await tx
    .update(paymentMethods)
    .set({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.terminalId !== undefined ? { terminalId: patch.terminalId } : {}),
      ...(patch.cashAccountId !== undefined || patch.terminalId ? { cashAccountId: next.terminalId ? null : next.cashAccountId } : {}),
      ...(patch.showInPos !== undefined ? { showInPos: patch.showInPos } : {}),
      ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
      ...(patch.sortOrder !== undefined ? { sortOrder: patch.sortOrder } : {}),
      updatedAt: new Date(),
    })
    .where(eq(paymentMethods.id, id));
  if (patch.kassaIds) {
    await tx.delete(paymentMethodKassas).where(eq(paymentMethodKassas.paymentMethodId, id));
    if (kassaIds.length > 0) await tx.insert(paymentMethodKassas).values(kassaIds.map((cashAccountId) => ({ paymentMethodId: id, cashAccountId })));
  }
  await financeAudit(tx, tenant, meta, {
    action: "PAYMENT_METHOD_UPDATED",
    resource: "payment_methods",
    resourceId: id,
    details: { changes: Object.keys(patch), before: { ...current } },
  });
  return methodById(tx, companyId, id);
}

/**
 * Mavjud sozlamadan usullar ro'yxatini tayyorlash (faqat havola — yangi hisob yaratilmaydi): "Naqd", har faol terminal
 * (UZCARD, HUMO …) va kassada ko'rinadigan bank hisoblari. Nomi band bo'lsa — o'tkazib yuboriladi (takror chaqirish xavfsiz).
 */
export async function bootstrapPaymentMethods(tx: Tx, tenant: TenantContext, meta: RequestMeta) {
  const companyId = tenant.company.id;
  const existing = new Set((await listPaymentMethods(tx, companyId, { includeInactive: true })).map((method) => method.name));
  const terminals = await tx
    .select({ id: paymentTerminals.id, name: paymentTerminals.name })
    .from(paymentTerminals)
    .where(and(eq(paymentTerminals.companyId, companyId), eq(paymentTerminals.isActive, true)))
    .orderBy(asc(paymentTerminals.name));
  const banks = await tx
    .select({ id: cashAccounts.id, name: cashAccounts.name })
    .from(cashAccounts)
    .where(and(eq(cashAccounts.companyId, companyId), eq(cashAccounts.type, "bank"), eq(cashAccounts.isActive, true), eq(cashAccounts.showInPos, true)));
  const wanted: PaymentMethodInput[] = [
    { name: "Naqd", kind: "cash", sortOrder: 0 },
    ...terminals.map((terminal, index) => ({ name: terminal.name, kind: "card" as const, terminalId: terminal.id, sortOrder: 10 + index })),
    ...banks.map((bank, index) => ({ name: `Bank: ${bank.name}`, kind: "bank" as const, cashAccountId: bank.id, sortOrder: 50 + index })),
  ];
  const created = [];
  for (const method of wanted) {
    if (existing.has(method.name)) continue;
    created.push(await createPaymentMethod(tx, tenant, method, meta));
  }
  return created;
}

export type MethodConflict = { kind: string; details: Record<string, unknown> };

/**
 * To'lov qismidagi usulni kanonik qismga aylantirish (yagona server manbai). Qaytaradi: tur, terminal va hisob — usul
 * sozlamasidan; mijoz yuborgani zid bo'lsa — rad (offline — usul sozlamasi ustun, nomuvofiqlik).
 */
export async function applyPaymentMethod<T extends { method: AllocationMethod; terminalId?: string | null; cashAccountId?: string | null; paymentMethodId?: string | null }>(
  conn: DbOrTx,
  companyId: string,
  part: T,
  options: { kassaId?: string | null; offline?: boolean; conflicts?: MethodConflict[] },
): Promise<T> {
  if (!part.paymentMethodId) return part;
  const [method] = await conn
    .select(methodFields)
    .from(paymentMethods)
    .where(and(eq(paymentMethods.id, part.paymentMethodId), eq(paymentMethods.companyId, companyId)))
    .limit(1);
  if (!method) throw notFound("To'lov usuli topilmadi");
  if (!method.isActive && !options.offline) throw badRequest(`"${method.name}" to'lov usuli faol emas`);
  if (part.method !== method.kind) throw badRequest(`"${method.name}" — ${method.kind} usuli, qism turi ${part.method}`);
  const mismatch =
    (part.terminalId && part.terminalId !== method.terminalId) ||
    (method.kind !== "cash" && part.cashAccountId && part.cashAccountId !== method.cashAccountId && !method.terminalId);
  if (mismatch) {
    if (!options.offline) throw badRequest(`"${method.name}" usuli sozlamasidagi terminal/hisobdan boshqasi yuborildi`);
    options.conflicts?.push({ kind: "payment_method_overridden", details: { paymentMethodId: method.id, terminalId: part.terminalId, cashAccountId: part.cashAccountId } });
  }
  if (options.kassaId !== undefined) {
    const allowed = (await kassaIdsByMethod(conn, [method.id])).get(method.id) ?? [];
    if (allowed.length > 0 && (!options.kassaId || !allowed.includes(options.kassaId))) {
      if (!options.offline) {
        throw new AppError("FORBIDDEN", `"${method.name}" usuli bu kassada ruxsat etilmagan`, { reason: "payment_method_not_allowed_for_kassa" });
      }
      options.conflicts?.push({ kind: "payment_method_kassa_mismatch", details: { paymentMethodId: method.id, kassaId: options.kassaId } });
    }
  }
  return {
    ...part,
    terminalId: method.terminalId,
    // Naqd — kassani smena belgilaydi (mijoz hisobi e'tiborsiz emas: kassa servisi tekshiradi)
    cashAccountId: method.kind === "cash" ? (part.cashAccountId ?? null) : method.terminalId ? null : method.cashAccountId,
  };
}
