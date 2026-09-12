/**
 * Qurilmadan serverga amallar (push) — offline navbat.
 *
 *  - Har amal `opId` bilan: bir marta bajariladi, natija (yoki rad etish sababi) `pos_sync_operations` da saqlanadi;
 *    takror kelsa o'sha javob `duplicate: true` bilan qaytadi. Parallel takroriy so'rov unikal indeks bilan to'siladi.
 *  - Amallar kelgan tartibda, har biri o'z tranzaksiyasida. Biznes xatosi (AppError) — amal rad etiladi va saqlanadi,
 *    keyingilari davom etadi; boshqa (infratuzilma) xato — butun so'rov 500, qurilma keyinroq qayta yuboradi
 *    (bajarilganlari takrorlanmaydi).
 *  - Amal vaqti qurilmadan (offline) — kelajakda 5 daqiqadan, o'tmishda 30 kundan uzoq bo'lmasin.
 *  - Kassir har amalda qayta tekshiriladi (`cashierTenant`).
 */
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { AppError, badRequest, conflict, notFound } from "@bum/shared";
import { db } from "../../db/client.js";
import { posSyncOperations, type PosSyncError } from "../../db/schema/pos.js";
import { posShifts } from "../../db/schema/sales.js";
import { withTransaction, type Tx } from "../../db/transaction.js";
import type { RequestMeta } from "../../shared/audit.js";
import { moneySchema } from "../../shared/decimal.js";
import { closeShift, openShift } from "../sales/pos.service.js";
import { cashierTenant, type DeviceContext } from "./device-auth.js";

export const MAX_OPS_PER_PUSH = 100;
const MAX_FUTURE_MS = 5 * 60_000;
const MAX_AGE_MS = 30 * 86_400_000;

const clientTime = z.iso.datetime({ offset: true }).transform((value) => new Date(value));
const foreignCash = z
  .array(z.strictObject({ currency: z.string().trim().toUpperCase().length(3), amount: moneySchema }))
  .max(10)
  .optional();
const notes = z.string().trim().max(500).nullable().optional();
const common = { opId: z.uuid(), cashierId: z.uuid(), createdAt: clientTime };

export const syncOperationSchema = z.discriminatedUnion("type", [
  z.strictObject({
    ...common,
    type: z.literal("shift.open"),
    payload: z.strictObject({ shiftId: z.uuid(), openingCash: moneySchema, openingForeignCash: foreignCash, notes }),
  }),
  z.strictObject({
    ...common,
    type: z.literal("shift.close"),
    payload: z.strictObject({ shiftId: z.uuid(), closingCash: moneySchema, closingForeignCash: foreignCash, notes }),
  }),
]);
export type SyncOperation = z.infer<typeof syncOperationSchema>;

export type PushResult = {
  opId: string | null;
  status: "applied" | "rejected" | "invalid";
  duplicate?: boolean;
  result?: Record<string, unknown> | null;
  error?: PosSyncError | null;
};

function assertClientTime(at: Date) {
  const now = Date.now();
  if (at.getTime() > now + MAX_FUTURE_MS) throw badRequest("Qurilma vaqti noto'g'ri — soatni tekshiring", { reason: "clock_future" });
  if (at.getTime() < now - MAX_AGE_MS) throw badRequest("Amal 30 kundan eski — sinxron qilinmaydi", { reason: "too_old" });
}

async function applyOperation(tx: Tx, context: DeviceContext, op: SyncOperation, meta: RequestMeta): Promise<Record<string, unknown>> {
  assertClientTime(op.createdAt);
  const tenant = await cashierTenant(tx, context, op.cashierId);

  switch (op.type) {
    case "shift.open": {
      const [existing] = await tx.select({ id: posShifts.id }).from(posShifts).where(eq(posShifts.id, op.payload.shiftId)).limit(1);
      if (existing) throw conflict("Bu smena identifikatori band");
      const shift = await openShift(
        tx,
        tenant,
        {
          warehouseId: context.device.warehouseId,
          openingCash: op.payload.openingCash,
          openingForeignCash: op.payload.openingForeignCash,
          notes: op.payload.notes ?? null,
          id: op.payload.shiftId,
          openedAt: op.createdAt,
          deviceId: context.device.id,
        },
        meta,
      );
      return { shiftId: shift.id };
    }
    case "shift.close": {
      const [shift] = await tx
        .select({ deviceId: posShifts.deviceId })
        .from(posShifts)
        .where(and(eq(posShifts.id, op.payload.shiftId), eq(posShifts.companyId, context.company.id)))
        .limit(1);
      if (!shift || shift.deviceId !== context.device.id) throw notFound("Smena topilmadi");
      const closed = await closeShift(
        tx,
        tenant,
        op.payload.shiftId,
        {
          closingCash: op.payload.closingCash,
          closingForeignCash: op.payload.closingForeignCash,
          notes: op.payload.notes ?? null,
          closedAt: op.createdAt,
        },
        meta,
      );
      return { shiftId: op.payload.shiftId, expectedCash: closed.expectedCash, difference: closed.difference, foreignCash: closed.foreignCash };
    }
  }
}

async function storedOperation(deviceId: string, opId: string): Promise<PushResult | null> {
  const [row] = await db
    .select({ status: posSyncOperations.status, result: posSyncOperations.result, error: posSyncOperations.error })
    .from(posSyncOperations)
    .where(and(eq(posSyncOperations.deviceId, deviceId), eq(posSyncOperations.opId, opId)))
    .limit(1);
  return row ? { opId, status: row.status, duplicate: true, result: row.result, error: row.error } : null;
}

const errorOf = (error: AppError): PosSyncError => ({
  code: error.code,
  message: error.message,
  ...(error.details === undefined ? {} : { details: error.details }),
});

export async function pushOperations(context: DeviceContext, rawOps: unknown[], meta: RequestMeta): Promise<PushResult[]> {
  const results: PushResult[] = [];
  for (const raw of rawOps) {
    const head = z.object({ opId: z.uuid(), type: z.string().max(40) }).safeParse(raw);
    if (!head.success) {
      results.push({ opId: null, status: "invalid", error: { code: "BAD_REQUEST", message: "Amal identifikatori (opId) yoki turi noto'g'ri" } });
      continue;
    }
    const { opId, type } = head.data;
    const stored = await storedOperation(context.device.id, opId);
    if (stored) {
      results.push(stored);
      continue;
    }

    const parsed = syncOperationSchema.safeParse(raw);
    const record = (status: "applied" | "rejected", extra: { result?: Record<string, unknown>; error?: PosSyncError }) => ({
      companyId: context.company.id,
      deviceId: context.device.id,
      opId,
      type,
      status,
      cashierId: parsed.success ? parsed.data.cashierId : null,
      clientCreatedAt: parsed.success ? parsed.data.createdAt : null,
      ...extra,
    });

    if (!parsed.success) {
      const error: PosSyncError = { code: "BAD_REQUEST", message: "Amal tarkibi noto'g'ri", details: z.flattenError(parsed.error).fieldErrors };
      await db.insert(posSyncOperations).values(record("rejected", { error })).onConflictDoNothing();
      results.push((await storedOperation(context.device.id, opId)) ?? { opId, status: "rejected", error });
      continue;
    }

    try {
      const applied = await withTransaction(async (tx) => {
        const [claimed] = await tx
          .insert(posSyncOperations)
          .values(record("applied", {}))
          .onConflictDoNothing()
          .returning({ id: posSyncOperations.id });
        if (!claimed) return null;
        const result = await applyOperation(tx, context, parsed.data, meta);
        await tx.update(posSyncOperations).set({ result }).where(eq(posSyncOperations.id, claimed.id));
        return result;
      });
      results.push(applied === null ? ((await storedOperation(context.device.id, opId)) ?? { opId, status: "applied" }) : { opId, status: "applied", result: applied });
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
      const error = errorOf(err);
      await db.insert(posSyncOperations).values(record("rejected", { error })).onConflictDoNothing();
      results.push({ opId, status: "rejected", error });
    }
  }
  return results;
}
