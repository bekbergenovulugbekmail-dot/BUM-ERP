/**
 * Savdo agentlari (convex/crm/salesReps.ts).
 *
 * Convex'dan farqlar:
 *  - kod "agentlar soni + 1" edi — o'chirishdan keyin va parallel yaratishda takrorlanardi (`SR-001`, advisory lock)
 *  - `getStats` har agentga kompaniyaning BARCHA buyurtmalari sonini va doim `thisMonthSales: 0`
 *    qaytarardi — endi agentning shu oydagi lidlari, yutilgan lidlar summasi, tashriflari va savdosi.
 *    Tashrif va savdo ko'rsatkichlari MAYDON ma'lumotidan (`agent_visits`, `agent_orders`) olinadi —
 *    agent ilovasi, rahbar paneli va agent hisoboti bir xil manbadan hisoblaydi
 *  - lid/marshrut/tashrifga bog'langan agentni o'chirish tarixni yo'qotardi — endi faqat faolsizlantirish
 *  - `userId` kompaniya a'zosi ekani tekshiriladi; `update` / `remove` to'xtatilgan kompaniyada ham yozardi
 *  - o'qish `distribution.view` talab qiladi (CRM'dagi lidga agent tanlash — faqat id, nom, kod)
 */
import { and, asc, eq, getTableColumns, ne, sql } from "drizzle-orm";
import { badRequest, conflict, notFound } from "@bum/shared";
import { distributionRoutes, leads, routeVisits, salesReps } from "../../db/schema/crm.js";
import { salesOrders } from "../../db/schema/sales.js";
import { PAYABLE_STATUSES } from "../sales/sale-status.js";
import { companyMembers } from "../../db/schema/platform.js";
import { agentOrders, agentProspects, agentVisits, agentWorkSessions } from "../../db/schema/sales-agent.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import { writeAuditLog, type RequestMeta } from "../../shared/audit.js";
import { nextDocumentNumber } from "../../shared/numbering.js";
import type { TenantContext } from "../company/tenant.js";
import { todayIso } from "../finance/cash.service.js";

const { legacyId: _legacyId, companyId: _companyId, ...repFields } = getTableColumns(salesReps);

export function distributionAudit(
  tx: Tx,
  tenant: TenantContext,
  meta: RequestMeta,
  entry: { action: string; resource: string; resourceId: string; details: Record<string, unknown> },
) {
  return writeAuditLog(
    { userId: tenant.user.id, userName: tenant.user.name, companyId: tenant.company.id, ...entry, ...meta },
    tx,
  );
}

/** Agent shu kompaniyaniki (faolligi talab qilinsa — faol). */
export async function assertSalesRep(conn: DbOrTx, companyId: string, salesRepId: string, requireActive = true) {
  const [rep] = await conn
    .select({ id: salesReps.id, isActive: salesReps.isActive })
    .from(salesReps)
    .where(and(eq(salesReps.id, salesRepId), eq(salesReps.companyId, companyId)))
    .limit(1);
  if (!rep) throw badRequest("Savdo agenti topilmadi");
  if (requireActive && !rep.isActive) throw badRequest("Savdo agenti faol emas");
}

async function assertMember(tx: Tx, companyId: string, userId: string) {
  const [member] = await tx
    .select({ id: companyMembers.id })
    .from(companyMembers)
    .where(and(eq(companyMembers.companyId, companyId), eq(companyMembers.userId, userId), eq(companyMembers.isActive, true)))
    .limit(1);
  if (!member) throw badRequest("Foydalanuvchi kompaniya a'zosi emas");
}

/** Kompaniya a'zosi va boshqa agentga bog'lanmagan: bitta foydalanuvchi — bitta agent ish joyi. */
async function assertUserFree(tx: Tx, companyId: string, userId: string, exceptRepId?: string) {
  await assertMember(tx, companyId, userId);
  const [taken] = await tx
    .select({ name: salesReps.name })
    .from(salesReps)
    .where(
      and(
        eq(salesReps.companyId, companyId),
        eq(salesReps.userId, userId),
        exceptRepId ? ne(salesReps.id, exceptRepId) : undefined,
      ),
    )
    .limit(1);
  if (taken) throw conflict(`Bu foydalanuvchi boshqa savdo agentiga bog'langan: ${taken.name}`);
}

export type SalesRepInput = {
  name: string;
  phone?: string | null;
  email?: string | null;
  userId?: string | null;
  region?: string | null;
  monthlyTarget?: string;
  commission?: string;
  notes?: string | null;
};

export async function listSalesReps(conn: DbOrTx, tenant: TenantContext, includeInactive = false) {
  return conn
    .select(repFields)
    .from(salesReps)
    .where(and(eq(salesReps.companyId, tenant.company.id), includeInactive ? undefined : eq(salesReps.isActive, true)))
    .orderBy(asc(salesReps.name));
}

/**
 * Bitta jadvalli so'rovda drizzle ustunni jadval nomisiz yozadi ("id") — ichki so'rovda u
 * `leads.id` ga bog'lanib qolardi. Shuning uchun tashqi ustun aniq ko'rsatiladi.
 */
const outerRepId = sql.raw(`"sales_reps"."id"`);

export async function salesRepStats(conn: DbOrTx, tenant: TenantContext) {
  const monthStart = `${todayIso().slice(0, 7)}-01`;
  return conn
    .select({
      ...repFields,
      leadsThisMonth: sql<number>`(select count(*)::int from ${leads} where ${leads.salesRepId} = ${outerRepId} and ${leads.createdAt} >= ${monthStart}::date)`,
      openLeads: sql<number>`(select count(*)::int from ${leads} where ${leads.salesRepId} = ${outerRepId} and ${leads.stage} not in ('won', 'lost'))`,
      wonValueThisMonth: sql<string>`(select coalesce(sum(${leads.estimatedValue}), 0)::numeric(18,2) from ${leads} where ${leads.salesRepId} = ${outerRepId} and ${leads.stage} = 'won' and ${leads.updatedAt} >= ${monthStart}::date)`,
      // DIQQAT: tashrif ko'rsatkichlari MAYDONDAGI tashrifdan (`agent_visits`) olinadi — agent ilovasi shu
      // jadvalga yozadi. `route_visits` — marshrut-kun jurnali (boshqa granularlik, qo'lda kiritiladi) va
      // KPI uchun manba EMAS: aks holda rahbar panelida tashriflar doim 0 bo'lib turardi.
      visitsThisMonth: sql<number>`(select count(*)::int from ${agentVisits}
        where ${agentVisits.salesRepId} = ${outerRepId} and ${agentVisits.status} = 'completed' and ${agentVisits.visitDate} >= ${monthStart}::date)`,
      orderedVisitsThisMonth: sql<number>`(select count(*)::int from ${agentVisits}
        where ${agentVisits.salesRepId} = ${outerRepId} and ${agentVisits.result} = 'ordered' and ${agentVisits.visitDate} >= ${monthStart}::date)`,
      noOrderVisitsThisMonth: sql<number>`(select count(*)::int from ${agentVisits}
        where ${agentVisits.salesRepId} = ${outerRepId} and ${agentVisits.result} = 'no_order' and ${agentVisits.visitDate} >= ${monthStart}::date)`,
      // Savdo — agentning yuborilgan buyurtmalari (agent hisobotidagi qoida bilan AYNAN bir xil)
      visitSalesThisMonth: sql<string>`(select coalesce(sum(${salesOrders.totalAmount}), 0)::numeric(18,2)
        from ${agentOrders} join ${salesOrders} on ${salesOrders.id} = ${agentOrders.orderId}
        where ${agentOrders.salesRepId} = ${outerRepId} and ${agentOrders.submittedAt} is not null
          and ${salesOrders.status} in ${sql.raw(`(${PAYABLE_STATUSES.map((status) => `'${status}'`).join(", ")})`)}
          and ${salesOrders.orderDate} >= ${monthStart}::date)`,
      ordersThisMonth: sql<number>`(select count(*)::int
        from ${agentOrders} join ${salesOrders} on ${salesOrders.id} = ${agentOrders.orderId}
        where ${agentOrders.salesRepId} = ${outerRepId} and ${agentOrders.submittedAt} is not null
          and ${salesOrders.status} in ${sql.raw(`(${PAYABLE_STATUSES.map((status) => `'${status}'`).join(", ")})`)}
          and ${salesOrders.orderDate} >= ${monthStart}::date)`,
    })
    .from(salesReps)
    .where(and(eq(salesReps.companyId, tenant.company.id), eq(salesReps.isActive, true)))
    .orderBy(asc(salesReps.name));
}

export async function createSalesRep(tx: Tx, tenant: TenantContext, input: SalesRepInput, meta: RequestMeta) {
  const companyId = tenant.company.id;
  if (input.userId) await assertUserFree(tx, companyId, input.userId);
  const code = await nextDocumentNumber(tx, {
    table: salesReps,
    column: salesReps.code,
    companyColumn: salesReps.companyId,
    companyId,
    prefix: "SR-",
    width: 3,
  });

  const [rep] = await tx.insert(salesReps).values({ ...input, code, companyId }).returning(repFields);
  await distributionAudit(tx, tenant, meta, {
    action: "SALES_REP_CREATED",
    resource: "sales_reps",
    resourceId: rep!.id,
    details: { code, name: rep!.name },
  });
  return rep!;
}

export async function updateSalesRep(
  tx: Tx,
  tenant: TenantContext,
  salesRepId: string,
  patch: Partial<SalesRepInput> & { isActive?: boolean },
  meta: RequestMeta,
) {
  const companyId = tenant.company.id;
  if (patch.userId) await assertUserFree(tx, companyId, patch.userId, salesRepId);

  const [rep] = await tx
    .update(salesReps)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(salesReps.id, salesRepId), eq(salesReps.companyId, companyId)))
    .returning(repFields);
  if (!rep) throw notFound("Savdo agenti topilmadi");

  await distributionAudit(tx, tenant, meta, {
    action: "SALES_REP_UPDATED",
    resource: "sales_reps",
    resourceId: salesRepId,
    details: { changes: Object.keys(patch) },
  });
  return rep;
}

export async function deleteSalesRep(tx: Tx, tenant: TenantContext, salesRepId: string, meta: RequestMeta) {
  const companyId = tenant.company.id;
  const [rep] = await tx
    .select({ id: salesReps.id, code: salesReps.code })
    .from(salesReps)
    .where(and(eq(salesReps.id, salesRepId), eq(salesReps.companyId, companyId)))
    .limit(1)
    .for("update");
  if (!rep) throw notFound("Savdo agenti topilmadi");

  const [usage] = await tx
    .select({
      used: sql<boolean>`exists (select 1 from ${leads} where ${leads.salesRepId} = ${rep.id})
        or exists (select 1 from ${distributionRoutes} where ${distributionRoutes.salesRepId} = ${rep.id})
        or exists (select 1 from ${routeVisits} where ${routeVisits.salesRepId} = ${rep.id})
        or exists (select 1 from ${agentVisits} where ${agentVisits.salesRepId} = ${rep.id})
        or exists (select 1 from ${agentOrders} where ${agentOrders.salesRepId} = ${rep.id})
        or exists (select 1 from ${agentProspects} where ${agentProspects.salesRepId} = ${rep.id})
        or exists (select 1 from ${agentWorkSessions} where ${agentWorkSessions.salesRepId} = ${rep.id})`,
    })
    .from(sql`(select 1) as probe`);
  if (usage?.used) throw conflict("Agentga lid, marshrut yoki tashrif bog'langan — faolsizlantiring");

  await tx.delete(salesReps).where(eq(salesReps.id, rep.id));
  await distributionAudit(tx, tenant, meta, {
    action: "SALES_REP_DELETED",
    resource: "sales_reps",
    resourceId: rep.id,
    details: { code: rep.code },
  });
}
