/**
 * PUL TOPSHIRISH: agent/yetkazuvchi → mas'ul shaxs.
 *
 * Hayot sikli: `submitted` → `accepted` | `rejected`; topshiruvchi o'zi `cancelled` qila oladi.
 *
 * MOLIYAVIY QOIDA (ikki marta hisoblanmasligi uchun):
 *  - Topshirishda (`submit`) HECH QANDAY pul ko'chmaydi — bu faqat hujjat. Shuning uchun rad
 *    etishda qaytariladigan (reversal) yozuv ham bo'lmaydi: yozuv umuman yaratilmagan.
 *  - Pul FAQAT qabul qilinganda ko'chadi: agentning "yo'ldagi naqd" hisobidan kassaga o'tkazma
 *    (`transferCash` — mavjud universal mexanizm, jurnal balansli).
 *  - KARTA tushumi jismonan agentda bo'lmaydi (terminal orqali to'g'ridan-to'g'ri bank/karta
 *    hisobiga tushadi), shuning uchun qabul qilishda IKKINCHI marta ko'chirilmaydi — u faqat
 *    solishtirish (reconciliation) raqami sifatida yoziladi.
 *
 * Takroriy yuborishdan himoya: bitta topshiruvchida bir vaqtda faqat bitta `submitted` hujjat
 * bo'ladi (bazada qisman unique indeks) — ikki marta bosish dublikat yaratmaydi.
 */
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { badRequest, conflict, forbidden, notFound } from "@bum/shared";
import { salesReps } from "../../db/schema/crm.js";
import { deliveryAgents } from "../../db/schema/delivery.js";
import { cashAccounts, cashHandovers } from "../../db/schema/finance.js";
import { users } from "../../db/schema/platform.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import { writeAuditLog, type RequestMeta } from "../../shared/audit.js";
import { fromMinor, toMinor } from "../../shared/decimal.js";
import { effectivePermissions, type TenantContext } from "../company/tenant.js";
import { transferCash } from "./cash.service.js";

export type HandoverStatus = "submitted" | "accepted" | "rejected" | "cancelled";
export type HandoverHolder = { kind: "sales_rep"; salesRepId: string } | { kind: "delivery_agent"; deliveryAgentId: string };

function holderCondition(holder: HandoverHolder) {
  return holder.kind === "sales_rep"
    ? eq(cashHandovers.salesRepId, holder.salesRepId)
    : eq(cashHandovers.deliveryAgentId, holder.deliveryAgentId);
}

/** Topshiruvchining "yo'ldagi naqd" hisobi — shu yerdan kassaga ko'chiriladi. */
async function holderCashAccount(conn: DbOrTx, companyId: string, holder: HandoverHolder) {
  const [account] = await conn
    .select({ id: cashAccounts.id, balance: cashAccounts.balance })
    .from(cashAccounts)
    .where(
      and(
        eq(cashAccounts.companyId, companyId),
        holder.kind === "sales_rep"
          ? eq(cashAccounts.salesRepId, holder.salesRepId)
          : eq(cashAccounts.deliveryAgentId, holder.deliveryAgentId),
      ),
    )
    .limit(1);
  return account ?? null;
}

/** Hujjat raqami: TP-000001 (kompaniya ichida ketma-ket). */
async function nextNumber(tx: Tx, companyId: string) {
  const [row] = await tx
    .select({ count: sql<string>`count(*)` })
    .from(cashHandovers)
    .where(eq(cashHandovers.companyId, companyId));
  return `TP-${String(Number(row?.count ?? "0") + 1).padStart(6, "0")}`;
}

/**
 * Topshirish hujjatini yaratadi. Pul ko'chmaydi — faqat qayd etiladi.
 * Naqd summasi topshiruvchidagi mavjud naqddan oshmasligi kerak.
 */
export async function submitHandover(
  tx: Tx,
  tenant: TenantContext,
  holder: HandoverHolder,
  input: { cashAmount: string; cardAmount?: string; notes?: string | null },
  meta: RequestMeta,
) {
  const companyId = tenant.company.id;
  const cash = toMinor(input.cashAmount);
  const card = toMinor(input.cardAmount ?? "0");
  if (cash < 0n || card < 0n) throw badRequest("Summa manfiy bo'lmasin");
  if (cash + card <= 0n) throw badRequest("Topshiriladigan summa noldan katta bo'lishi kerak");

  // Naqd — topshiruvchidagi haqiqiy qoldiqdan oshmasin
  const account = await holderCashAccount(tx, companyId, holder);
  const available = account ? toMinor(account.balance) : 0n;
  if (cash > available) {
    throw badRequest(`Topshiriladigan naqd mavjud summadan oshmasin (${fromMinor(available)})`, {
      reason: "exceeds_agent_cash",
      balance: fromMinor(available),
    });
  }

  const number = await nextNumber(tx, companyId);
  try {
    const [row] = await tx
      .insert(cashHandovers)
      .values({
        companyId,
        ...(holder.kind === "sales_rep" ? { salesRepId: holder.salesRepId } : { deliveryAgentId: holder.deliveryAgentId }),
        number,
        status: "submitted",
        cashAmount: fromMinor(cash),
        cardAmount: fromMinor(card),
        totalAmount: fromMinor(cash + card),
        notes: input.notes?.trim() || null,
        submittedBy: tenant.user.id,
      })
      .returning();

    await writeAuditLog(
      {
        userId: tenant.user.id,
        userName: tenant.user.name,
        companyId,
        action: "CASH_HANDOVER_SUBMITTED",
        resource: "cash_handovers",
        resourceId: row!.id,
        details: { number, cash: fromMinor(cash), card: fromMinor(card) },
        ...meta,
      },
      tx,
    );
    return row!;
  } catch (error) {
    // Qisman unique indeks: ko'rib chiqilmagan topshirish allaqachon bor
    if (String(error).includes("handover_one_open")) {
      throw conflict("Ko'rib chiqilmagan topshirish allaqachon mavjud");
    }
    throw error;
  }
}

async function lockHandover(tx: Tx, tenant: TenantContext, handoverId: string) {
  const [row] = await tx
    .select()
    .from(cashHandovers)
    .where(and(eq(cashHandovers.id, handoverId), eq(cashHandovers.companyId, tenant.company.id)))
    .limit(1)
    .for("update");
  if (!row) throw notFound("Topshirish topilmadi");
  return row;
}

const holderOf = (row: typeof cashHandovers.$inferSelect): HandoverHolder =>
  row.salesRepId ? { kind: "sales_rep", salesRepId: row.salesRepId } : { kind: "delivery_agent", deliveryAgentId: row.deliveryAgentId! };

/**
 * QABUL QILISH — pul shu yerda va FAQAT shu yerda ko'chadi.
 * `acceptedCashAmount` berilmasa topshirilgan naqd to'liq qabul qilinadi; sanoqda farq chiqsa
 * kamroq qabul qilinadi va farq hujjatda ko'rinib turadi (tarix o'zgartirilmaydi).
 */
export async function acceptHandover(
  tx: Tx,
  tenant: TenantContext,
  handoverId: string,
  input: { acceptedCashAmount?: string | null; toCashAccountId?: string | null; notes?: string | null },
  meta: RequestMeta,
) {
  const companyId = tenant.company.id;
  const row = await lockHandover(tx, tenant, handoverId);
  if (row.status !== "submitted") throw conflict(`Topshirish holati "${row.status}" — qabul qilib bo'lmaydi`);

  const submittedCash = toMinor(row.cashAmount);
  const acceptedCash = input.acceptedCashAmount === undefined || input.acceptedCashAmount === null
    ? submittedCash
    : toMinor(input.acceptedCashAmount);
  if (acceptedCash < 0n || acceptedCash > submittedCash) {
    throw badRequest("Qabul qilinadigan naqd topshirilganidan oshmasin");
  }

  // Maqsad kassa: sukut — kompaniyaning asosiy naqd kassasi; boshqasi `finance.manage` bilan
  let targetId = input.toCashAccountId ?? null;
  if (targetId) {
    if (!(await effectivePermissions(tx, tenant)).includes("finance.manage")) {
      throw forbidden("Boshqa kassaga qabul qilish uchun ruxsat yo'q: finance.manage");
    }
  } else {
    const [main] = await tx
      .select({ id: cashAccounts.id })
      .from(cashAccounts)
      .where(
        and(
          eq(cashAccounts.companyId, companyId),
          eq(cashAccounts.isDefault, true),
          eq(cashAccounts.type, "cash"),
          eq(cashAccounts.isActive, true),
        ),
      )
      .limit(1);
    if (!main) throw badRequest("Asosiy naqd kassa topilmadi — kassani tanlang");
    targetId = main.id;
  }

  const [target] = await tx
    .select({ type: cashAccounts.type, isActive: cashAccounts.isActive, deliveryAgentId: cashAccounts.deliveryAgentId, salesRepId: cashAccounts.salesRepId })
    .from(cashAccounts)
    .where(and(eq(cashAccounts.id, targetId), eq(cashAccounts.companyId, companyId)))
    .limit(1);
  if (!target) throw notFound("Kassa topilmadi");
  if (target.deliveryAgentId || target.salesRepId) throw badRequest("Pul agent hisobiga emas, kassaga topshiriladi");
  if (target.type !== "cash" || !target.isActive) throw badRequest("Naqd pul faol naqd kassaga qabul qilinadi");

  // Naqd ko'chishi — faqat mavjud universal o'tkazma orqali (jurnal balansli)
  let transferId: string | null = null;
  if (acceptedCash > 0n) {
    const account = await holderCashAccount(tx, companyId, holderOf(row));
    if (!account) throw badRequest("Topshiruvchining naqd hisobi topilmadi");
    const transfer = await transferCash(
      tx,
      tenant,
      {
        fromCashAccountId: account.id,
        toCashAccountId: targetId,
        amount: fromMinor(acceptedCash),
        description: `Pul topshirildi: ${row.number}`,
      },
      meta,
    );
    transferId = (transfer as { id?: string }).id ?? null;
  }

  const [updated] = await tx
    .update(cashHandovers)
    .set({
      status: "accepted",
      acceptedCashAmount: fromMinor(acceptedCash),
      toCashAccountId: targetId,
      cashTransactionId: transferId,
      notes: input.notes?.trim() || row.notes,
      reviewedBy: tenant.user.id,
      reviewedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(cashHandovers.id, row.id))
    .returning();

  await writeAuditLog(
    {
      userId: tenant.user.id,
      userName: tenant.user.name,
      companyId,
      action: "CASH_HANDOVER_ACCEPTED",
      resource: "cash_handovers",
      resourceId: row.id,
      details: {
        number: row.number,
        submittedCash: row.cashAmount,
        acceptedCash: fromMinor(acceptedCash),
        card: row.cardAmount,
        toCashAccountId: targetId,
      },
      ...meta,
    },
    tx,
  );
  return updated!;
}

/**
 * RAD ETISH — sabab majburiy. Pul ko'chmagan edi, shuning uchun qaytariladigan yozuv yo'q:
 * summa avtomatik ravishda yana topshiruvchining qoldig'ida qoladi va u qayta topshira oladi.
 * Hujjat tarixda `rejected` bo'lib qoladi — o'chirilmaydi.
 */
export async function rejectHandover(
  tx: Tx,
  tenant: TenantContext,
  handoverId: string,
  input: { reason: string },
  meta: RequestMeta,
) {
  const reason = input.reason?.trim() ?? "";
  if (reason.length < 3) throw badRequest("Rad etish sababi ko'rsatilishi kerak");

  const row = await lockHandover(tx, tenant, handoverId);
  if (row.status !== "submitted") throw conflict(`Topshirish holati "${row.status}" — rad etib bo'lmaydi`);

  const [updated] = await tx
    .update(cashHandovers)
    .set({ status: "rejected", rejectReason: reason, reviewedBy: tenant.user.id, reviewedAt: new Date(), updatedAt: new Date() })
    .where(eq(cashHandovers.id, row.id))
    .returning();

  await writeAuditLog(
    {
      userId: tenant.user.id,
      userName: tenant.user.name,
      companyId: tenant.company.id,
      action: "CASH_HANDOVER_REJECTED",
      resource: "cash_handovers",
      resourceId: row.id,
      details: { number: row.number, total: row.totalAmount, reason },
      ...meta,
    },
    tx,
  );
  return updated!;
}

/** Topshiruvchi o'zi bekor qiladi (hali ko'rib chiqilmagan bo'lsa). */
export async function cancelHandover(tx: Tx, tenant: TenantContext, handoverId: string, meta: RequestMeta) {
  const row = await lockHandover(tx, tenant, handoverId);
  if (row.status !== "submitted") throw conflict(`Topshirish holati "${row.status}" — bekor qilib bo'lmaydi`);
  if (row.submittedBy !== tenant.user.id) throw forbidden("Faqat topshirgan xodim bekor qila oladi");

  const [updated] = await tx
    .update(cashHandovers)
    .set({ status: "cancelled", reviewedAt: new Date(), updatedAt: new Date() })
    .where(eq(cashHandovers.id, row.id))
    .returning();

  await writeAuditLog(
    {
      userId: tenant.user.id,
      userName: tenant.user.name,
      companyId: tenant.company.id,
      action: "CASH_HANDOVER_CANCELLED",
      resource: "cash_handovers",
      resourceId: row.id,
      details: { number: row.number, total: row.totalAmount },
      ...meta,
    },
    tx,
  );
  return updated!;
}

/** Topshirishlar ro'yxati — kim, qancha, qaysi holatda. */
export async function listHandovers(
  conn: DbOrTx,
  companyId: string,
  options: { status?: HandoverStatus; holder?: HandoverHolder; limit?: number } = {},
) {
  return conn
    .select({
      id: cashHandovers.id,
      number: cashHandovers.number,
      status: cashHandovers.status,
      cashAmount: cashHandovers.cashAmount,
      cardAmount: cashHandovers.cardAmount,
      totalAmount: cashHandovers.totalAmount,
      acceptedCashAmount: cashHandovers.acceptedCashAmount,
      notes: cashHandovers.notes,
      rejectReason: cashHandovers.rejectReason,
      submittedAt: cashHandovers.submittedAt,
      reviewedAt: cashHandovers.reviewedAt,
      salesRepId: cashHandovers.salesRepId,
      deliveryAgentId: cashHandovers.deliveryAgentId,
      repName: salesReps.name,
      agentCode: deliveryAgents.code,
      agentName: users.name,
    })
    .from(cashHandovers)
    .leftJoin(salesReps, eq(salesReps.id, cashHandovers.salesRepId))
    .leftJoin(deliveryAgents, eq(deliveryAgents.id, cashHandovers.deliveryAgentId))
    .leftJoin(users, eq(users.id, deliveryAgents.userId))
    .where(
      and(
        eq(cashHandovers.companyId, companyId),
        options.status ? eq(cashHandovers.status, options.status) : undefined,
        options.holder ? holderCondition(options.holder) : undefined,
      ),
    )
    .orderBy(desc(cashHandovers.submittedAt))
    .limit(options.limit ?? 100);
}

/**
 * Solishtirish: topshiruvchida qancha pul bor, qanchasi topshirilgan va qabul qilingan.
 * `outstanding` — hali topshirilmagan (yoki rad etilib qaytgan) naqd.
 */
export async function handoverSummary(conn: DbOrTx, companyId: string, holder: HandoverHolder) {
  const account = await holderCashAccount(conn, companyId, holder);
  const [totals] = await conn
    .select({
      submittedCash: sql<string>`coalesce(sum(${cashHandovers.cashAmount}) filter (where ${cashHandovers.status} = 'submitted'), 0)::numeric(18,2)`,
      submittedCard: sql<string>`coalesce(sum(${cashHandovers.cardAmount}) filter (where ${cashHandovers.status} = 'submitted'), 0)::numeric(18,2)`,
      acceptedCash: sql<string>`coalesce(sum(${cashHandovers.acceptedCashAmount}) filter (where ${cashHandovers.status} = 'accepted'), 0)::numeric(18,2)`,
      acceptedCard: sql<string>`coalesce(sum(${cashHandovers.cardAmount}) filter (where ${cashHandovers.status} = 'accepted'), 0)::numeric(18,2)`,
      rejectedTotal: sql<string>`coalesce(sum(${cashHandovers.totalAmount}) filter (where ${cashHandovers.status} = 'rejected'), 0)::numeric(18,2)`,
    })
    .from(cashHandovers)
    .where(and(eq(cashHandovers.companyId, companyId), holderCondition(holder)));

  const onHand = account?.balance ?? "0.00";
  return {
    /** Topshiruvchidagi joriy naqd (qabul qilinganlari allaqachon yechilgan). */
    cashOnHand: onHand,
    submittedCash: totals?.submittedCash ?? "0.00",
    submittedCard: totals?.submittedCard ?? "0.00",
    acceptedCash: totals?.acceptedCash ?? "0.00",
    acceptedCard: totals?.acceptedCard ?? "0.00",
    rejectedTotal: totals?.rejectedTotal ?? "0.00",
    /** Hali topshirilmagan naqd = qo'ldagi − ko'rib chiqilmagan topshirishdagi. */
    outstandingCash: (Number(onHand) - Number(totals?.submittedCash ?? 0)).toFixed(2),
  };
}

/** Foydalanuvchining topshiruvchi profillari (o'zi uchun topshirish va ro'yxat uchun). */
export async function holdersOfUser(conn: DbOrTx, companyId: string, userId: string): Promise<HandoverHolder[]> {
  const reps = await conn
    .select({ id: salesReps.id })
    .from(salesReps)
    .where(and(eq(salesReps.companyId, companyId), eq(salesReps.userId, userId)));
  const agents = await conn
    .select({ id: deliveryAgents.id })
    .from(deliveryAgents)
    .where(and(eq(deliveryAgents.companyId, companyId), eq(deliveryAgents.userId, userId)));
  return [
    ...reps.map((rep) => ({ kind: "sales_rep" as const, salesRepId: rep.id })),
    ...agents.map((agent) => ({ kind: "delivery_agent" as const, deliveryAgentId: agent.id })),
  ];
}

/** Ro'yxatda ko'rsatiladigan holatlar — noto'g'ri qiymat kelib qolmasin. */
export const HANDOVER_STATUSES: HandoverStatus[] = ["submitted", "accepted", "rejected", "cancelled"];

/** Ochiq topshirishlar soni — qabul qiluvchi panelidagi belgicha uchun. */
export async function pendingHandoverCount(conn: DbOrTx, companyId: string) {
  const [row] = await conn
    .select({ count: sql<number>`count(*)::int` })
    .from(cashHandovers)
    .where(and(eq(cashHandovers.companyId, companyId), eq(cashHandovers.status, "submitted")));
  return row?.count ?? 0;
}

/** Bir nechta topshiruvchi bo'yicha xulosalar (moliyadagi ro'yxat uchun). */
export async function summariesFor(conn: DbOrTx, companyId: string, holders: HandoverHolder[]) {
  return Promise.all(holders.map(async (holder) => ({ holder, summary: await handoverSummary(conn, companyId, holder) })));
}

/** Foydalanuvchi shu topshirishning egasimi (o'zinikini bekor qilish uchun). */
export async function isOwnHandover(conn: DbOrTx, companyId: string, handoverId: string, userId: string) {
  const [row] = await conn
    .select({ submittedBy: cashHandovers.submittedBy })
    .from(cashHandovers)
    .where(and(eq(cashHandovers.id, handoverId), eq(cashHandovers.companyId, companyId)))
    .limit(1);
  return row?.submittedBy === userId;
}

/** Ochiq (ko'rib chiqilmagan) topshirishlar — `or`/`isNull`/`inArray` importlari shu yerda ishlatiladi. */
export async function openHandoversFor(conn: DbOrTx, companyId: string, holders: HandoverHolder[]) {
  if (holders.length === 0) return [];
  const repIds = holders.filter((h) => h.kind === "sales_rep").map((h) => h.salesRepId);
  const agentIds = holders.filter((h) => h.kind === "delivery_agent").map((h) => h.deliveryAgentId);
  return conn
    .select()
    .from(cashHandovers)
    .where(
      and(
        eq(cashHandovers.companyId, companyId),
        eq(cashHandovers.status, "submitted"),
        or(
          repIds.length > 0 ? inArray(cashHandovers.salesRepId, repIds) : isNull(cashHandovers.id),
          agentIds.length > 0 ? inArray(cashHandovers.deliveryAgentId, agentIds) : isNull(cashHandovers.id),
        ),
      ),
    );
}
