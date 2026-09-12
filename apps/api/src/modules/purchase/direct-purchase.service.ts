/**
 * Kassada xarid (desktop kassa, offline): ta'minotchidan tovar keldi. Bitta tranzaksiyada — tasdiqlangan xarid
 * buyurtmasi (qurilmadagi ID, `K01-P000001` raqami va qator ID'lari, qurilmadagi kurslar), to'liq qabul (zaxira,
 * tannarx, partiya, sotuv narxi, ta'minotchi qarzi, jurnal) va ixtiyoriy darhol to'lov: naqd — kassa smenasi
 * chiqimi (kutilgan naqd kamayadi), karta — bankdan.
 */
import { randomUUID } from "node:crypto";
import type { Tx } from "../../db/transaction.js";
import type { RequestMeta } from "../../shared/audit.js";
import type { TenantContext } from "../company/tenant.js";
import { posCashMovement } from "../sales/pos-cash.service.js";
import { createOrder, receiveGoods, type OrderItemInput } from "./orders.service.js";
import { recordSupplierPayment } from "./payments.service.js";

export type DirectPurchaseInput = {
  supplierId: string;
  warehouseId: string;
  items: (OrderItemInput & { id: string; batchNumber?: string | null; expiryDate?: string | null })[];
  notes?: string | null;
  payment?: { shiftId: string; amount: string; method: "cash" | "card" } | null;
  offline: { id: string; number: string; occurredAt: Date; deviceId: string; rates?: Record<string, string> };
};

export async function completeDirectPurchase(tx: Tx, tenant: TenantContext, input: DirectPurchaseInput, meta: RequestMeta) {
  const { offline } = input;
  const date = offline.occurredAt.toISOString().slice(0, 10);
  const order = await createOrder(
    tx,
    tenant,
    {
      supplierId: input.supplierId,
      warehouseId: input.warehouseId,
      orderDate: date,
      notes: input.notes ?? null,
      items: input.items.map(({ batchNumber: _batch, expiryDate: _expiry, ...item }) => item),
    },
    meta,
    { id: offline.id, number: offline.number, deviceId: offline.deviceId, createdAt: offline.occurredAt, rates: offline.rates, confirmed: true },
  );

  const receipt = await receiveGoods(
    tx,
    tenant,
    order.id,
    {
      receiptDate: date,
      notes: input.notes ?? null,
      items: input.items.map((item) => ({
        orderItemId: item.id,
        receivedQty: item.orderedQty,
        batchNumber: item.batchNumber ?? null,
        expiryDate: item.expiryDate ?? null,
      })),
    },
    meta,
    { rates: offline.rates, occurredAt: offline.occurredAt },
  );

  let payment: { id: string; amount: string; method: "cash" | "card" } | null = null;
  if (input.payment) {
    const paid = await recordSupplierPayment(
      tx,
      tenant,
      { supplierId: input.supplierId, orderId: order.id, amount: input.payment.amount, method: input.payment.method, paymentDate: date, offline: true },
      meta,
    );
    if (input.payment.method === "cash") {
      await posCashMovement(
        tx,
        tenant,
        {
          shiftId: input.payment.shiftId,
          kind: "supplier_payment",
          amount: input.payment.amount,
          notes: order.number,
          reference: { type: "supplier_payment", id: paid.payment.id },
          offline: { id: randomUUID(), occurredAt: offline.occurredAt, deviceId: offline.deviceId },
        },
        meta,
      );
    }
    payment = { id: paid.payment.id, amount: paid.payment.amount, method: input.payment.method };
  }

  return { orderId: order.id, number: order.number, receiptId: receipt.receipt.id, total: receipt.total, status: receipt.status, payment };
}
