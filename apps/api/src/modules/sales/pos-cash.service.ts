/**
 * Kassa smenasidagi naqd harakatlari (desktop va web kassa): inkassatsiya (naqdni seyf yoki bankka olish), almashtirish
 * puli (maydalash uchun kassaga pul qo'yish), kassadan xarajat, boshqa kirim/chiqim.
 *
 *  - Kutilgan naqd = boshlang'ich + naqd tushum + kirimlar − chiqimlar; smena yopilishidagi farq shu bilan.
 *  - POS naqd tushumi kompaniyaning asosiy kassasiga yoziladi — kassa qutisi shu kassaning bir qismi. Shu sababli
 *    inkassatsiya, almashtirish puli va boshqa kirim/chiqim buxgalteriyada harakat emas (pul kompaniya kassasi ichida);
 *    web'da `targetAccountId` berilsa (masalan, bank) — asosiy kassadan o'sha hisobga o'tkazma.
 *  - Xarajat — "to'langan" xarajat hujjati (EXP-…), asosiy kassadan chiqim va jurnal; ruxsat `pos.cash.expense`
 *    (yoki `finance.manage`).
 */
import { and, asc, eq, getTableColumns, sql } from "drizzle-orm";
import { badRequest, forbidden, notFound } from "@bum/shared";
import { cashAccounts, expenses } from "../../db/schema/finance.js";
import { posCashMovements, posShifts } from "../../db/schema/sales.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import type { RequestMeta } from "../../shared/audit.js";
import { fromMinor, toMinor } from "../../shared/decimal.js";
import { nextDocumentNumber } from "../../shared/numbering.js";
import { effectivePermissions, type TenantContext } from "../company/tenant.js";
import { companyCurrency } from "../finance/accounts.service.js";
import { todayIso, transferCash } from "../finance/cash.service.js";
import { postExpensePayment } from "../finance/expenses.service.js";
import { assertWarehouseAccess } from "../inventory/warehouses.service.js";
import { salesAudit } from "./customers.service.js";
import { assertShiftOperator, getShift, lockShift, type SaleConflict } from "./pos.service.js";

export const CASH_MOVEMENT_KINDS = ["collection", "change_fund", "expense", "other_in", "other_out"] as const;
export type CashMovementKind = (typeof CASH_MOVEMENT_KINDS)[number];

const INCOMING: readonly CashMovementKind[] = ["change_fund", "other_in"];
const LABELS: Record<CashMovementKind, string> = {
  collection: "Inkassatsiya",
  change_fund: "Almashtirish puli",
  expense: "Kassadan xarajat",
  other_in: "Kassaga kirim",
  other_out: "Kassadan chiqim",
};

const { companyId: _companyId, ...movementFields } = getTableColumns(posCashMovements);

export async function listCashMovements(conn: DbOrTx, tenant: TenantContext, shiftId: string) {
  const shift = await getShift(conn, tenant, shiftId);
  assertWarehouseAccess(tenant, shift.warehouseId);
  return conn
    .select(movementFields)
    .from(posCashMovements)
    .where(eq(posCashMovements.shiftId, shift.id))
    .orderBy(asc(posCashMovements.occurredAt), asc(posCashMovements.id));
}

export async function posCashMovement(
  tx: Tx,
  tenant: TenantContext,
  input: {
    shiftId: string;
    kind: CashMovementKind;
    amount: string;
    /** Xarajat kategoriyasi (standart "kassa"). */
    category?: string | null;
    notes?: string | null;
    /** Web: inkassatsiyani asosiy kassadan boshqa hisobga (bank, seyf kassasi) o'tkazish. */
    targetAccountId?: string | null;
    /** Desktop kassa sinxroni: qurilmadagi ID, vaqt va qurilma. */
    offline?: { id: string; occurredAt: Date; deviceId: string };
  },
  meta: RequestMeta,
) {
  const companyId = tenant.company.id;
  const offline = input.offline;
  const conflicts: SaleConflict[] = [];
  const shift = await lockShift(tx, tenant, input.shiftId);
  if ((shift.deviceId ?? null) !== (offline?.deviceId ?? null)) throw notFound("Smena topilmadi");
  if (shift.status !== "open") {
    if (!offline) throw badRequest("Smena yopilgan");
    conflicts.push({ kind: "shift_closed", details: { shiftId: shift.id } });
  }
  await assertShiftOperator(tx, tenant, shift.cashierId);
  assertWarehouseAccess(tenant, shift.warehouseId);

  const amount = toMinor(input.amount);
  if (amount <= 0n) throw badRequest("Summa musbat bo'lishi kerak");
  const type = INCOMING.includes(input.kind) ? "in" : "out";
  const occurredAt = offline?.occurredAt ?? new Date();
  const date = offline ? occurredAt.toISOString().slice(0, 10) : todayIso();
  const notes = input.notes?.trim() || null;
  const category = input.kind === "expense" ? input.category?.trim() || "kassa" : null;

  let expenseId: string | null = null;
  if (input.kind === "expense") {
    const permissions = await effectivePermissions(tx, tenant);
    if (!permissions.includes("pos.cash.expense") && !permissions.includes("finance.manage")) {
      throw forbidden("Ruxsat yo'q: pos.cash.expense");
    }
    const number = await nextDocumentNumber(tx, {
      table: expenses,
      column: expenses.number,
      companyColumn: expenses.companyId,
      companyId,
      prefix: `EXP-${date.slice(0, 4)}-`,
      width: 4,
    });
    const [expense] = await tx
      .insert(expenses)
      .values({
        companyId,
        number,
        category: category!,
        description: notes ?? LABELS.expense,
        amount: fromMinor(amount),
        currency: await companyCurrency(tx, companyId),
        expenseDate: date,
        paidBy: tenant.user.name,
        status: "paid",
        notes: "Kassa smenasidan to'langan",
        createdBy: tenant.user.id,
      })
      .returning({
        id: expenses.id,
        number: expenses.number,
        description: expenses.description,
        category: expenses.category,
        amount: expenses.amount,
        currency: expenses.currency,
        accountId: expenses.accountId,
      });
    await postExpensePayment(tx, tenant, expense!, { paidDate: date, allowOverdraft: offline !== undefined });
    expenseId = expense!.id;
  }

  if (input.targetAccountId) {
    if (offline || input.kind !== "collection") throw badRequest("Hisobga faqat onlayn inkassatsiya o'tkaziladi");
    const [source] = await tx
      .select({ id: cashAccounts.id })
      .from(cashAccounts)
      .where(and(eq(cashAccounts.companyId, companyId), eq(cashAccounts.isDefault, true), eq(cashAccounts.isActive, true)))
      .limit(1);
    if (!source) throw badRequest("Asosiy kassa belgilanmagan");
    await transferCash(
      tx,
      tenant,
      { fromCashAccountId: source.id, toCashAccountId: input.targetAccountId, amount: fromMinor(amount), txDate: date, description: `${LABELS.collection}: smena` },
      meta,
    );
  }

  const [movement] = await tx
    .insert(posCashMovements)
    .values({
      ...(offline ? { id: offline.id } : {}),
      companyId,
      shiftId: shift.id,
      deviceId: offline?.deviceId ?? null,
      type,
      kind: input.kind,
      amount: fromMinor(amount),
      category,
      notes,
      expenseId,
      cashierId: tenant.user.id,
      cashierName: tenant.user.name,
      occurredAt,
    })
    .returning(movementFields);

  await tx
    .update(posShifts)
    .set({
      ...(type === "in"
        ? { cashIn: sql`${posShifts.cashIn} + ${fromMinor(amount)}::numeric` }
        : { cashOut: sql`${posShifts.cashOut} + ${fromMinor(amount)}::numeric` }),
      updatedAt: new Date(),
    })
    .where(eq(posShifts.id, shift.id));

  await salesAudit(tx, tenant, meta, {
    action: "POS_CASH_MOVEMENT",
    resource: "pos_cash_movements",
    resourceId: movement!.id,
    details: {
      shiftId: shift.id,
      kind: input.kind,
      type,
      amount: fromMinor(amount),
      expenseId,
      ...(input.targetAccountId ? { targetAccountId: input.targetAccountId } : {}),
      ...(offline ? { deviceId: offline.deviceId, occurredAt: occurredAt.toISOString() } : {}),
    },
  });
  return { movement: movement!, shift: await getShift(tx, tenant, shift.id), conflicts };
}
