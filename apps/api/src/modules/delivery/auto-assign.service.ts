/**
 * Avtomatik biriktirish — "tayyor" (biriktirilmagan) yetkazmalarni faol yetkazuvchilarga taqsimlash.
 *
 * Qoidalar (siyosat `autoAssign`, har agent uchun):
 *  - login va a'zolik faol, profil faol;
 *  - ish jadvalida shu hafta kuni bor (jadval belgilanmagan bo'lsa — cheklov yo'q);
 *  - bugungi yetkazma uchun ish sessiyasi ochiq (ixtiyoriy);
 *  - shu kundagi ochiq yetkazmalar soni limitdan kam;
 *  - agent filiali belgilangan bo'lsa — buyurtma omborining filiali mos;
 *  - transport maks. yuki belgilangan va yetkazma og'irligi ma'lum bo'lsa — oshmaydi (og'irlik: mahsulot og'irligi ×
 *    asosiy birlikdagi miqdor; og'irlik yoki birlik konversiyasi bo'lmasa — yuk tekshirilmaydi);
 *  - masofa chegarasi (boshlang'ich nuqta ma'lum bo'lsa).
 * Strategiya: balanced — eng kam ochiq yetkazma (teng bo'lsa yaqini), nearest — eng yaqin (teng bo'lsa kam yuklangani).
 * Boshlang'ich nuqta — shu kundagi oxirgi (tartib raqami bo'yicha) yetkazma mijozi, bo'lmasa bugun uchun ish vaqtidagi
 * joriy joyi (30 daqiqagacha eski); har biriktirilgan yetkazmadan keyin — o'sha mijoz. Yetkazmalar tartibi: ustuvorlik
 * (shoshilinch → past), vaqt oynasi, yaratilgan vaqt. Bu marshrut optimallashtirish (TSP) emas — ochko'z taqsimlash.
 *
 * Reja (`planAutoAssign`) hech narsa yozmaydi. Qo'llash (`applyAutoAssign`) kompaniya bo'yicha advisory qulf ostida
 * yetkazmalarni FOR UPDATE bilan qayta o'qib, har juftlikni qayta tekshiradi va mavjud `assignDeliveryTask` orqali
 * biriktiradi (hodisa, audit, real-time). Holati o'zgargan yoki shartga to'g'ri kelmay qolgan juftlik o'tkazib yuboriladi.
 */
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  OPEN_DELIVERY_STATUSES,
  type DeliveryAutoAssignSkipReason,
  type DeliveryAutoAssignStrategy,
  type DeliveryPolicy,
  type DeliveryPriority,
  type DeliveryStatus,
} from "@bum/shared";
import { products, unitConversions } from "../../db/schema/catalog.js";
import {
  deliveryAgents,
  deliveryLocationLatest,
  deliveryTaskItems,
  deliveryTasks,
  deliveryWorkSessions,
  type DeliveryWorkingSchedule,
} from "../../db/schema/delivery.js";
import { warehouses } from "../../db/schema/inventory.js";
import { companyMembers, users } from "../../db/schema/platform.js";
import { customers, salesOrderItems } from "../../db/schema/sales.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import type { RequestMeta } from "../../shared/audit.js";
import { distanceMeters, pointOf, type GeoPoint } from "../../shared/geo.js";
import type { TenantContext } from "../company/tenant.js";
import { hhmm, localDate } from "./task.repo.js";
import { assignDeliveryTask } from "./tasks.service.js";

const OPEN: DeliveryStatus[] = [...OPEN_DELIVERY_STATUSES];
const PRIORITY_RANK: Record<DeliveryPriority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
/** Joriy joy shundan eski bo'lsa boshlang'ich nuqta sifatida olinmaydi. */
const LOCATION_FRESH_MS = 30 * 60_000;

export type AutoAssignProposal = {
  taskId: string;
  number: string;
  customerName: string;
  deliveryAgentId: string;
  agentCode: string;
  agentName: string | null;
  distanceMeters: number | null;
  openTasksAfter: number;
  loadKgAfter: number | null;
};

export type AutoAssignSkip = {
  taskId: string;
  number: string | null;
  customerName: string | null;
  reason: DeliveryAutoAssignSkipReason;
  /** Nechta agent qaysi sabab bilan mos kelmadi. */
  counts?: Partial<Record<DeliveryAutoAssignSkipReason, number>>;
};

export type AutoAssignAgentSummary = {
  id: string;
  code: string;
  name: string | null;
  openTasks: number;
  loadKg: number;
  maxLoadKg: number | null;
  onDuty: boolean;
};

export type AutoAssignPlan = {
  date: string;
  strategy: DeliveryAutoAssignStrategy;
  proposals: AutoAssignProposal[];
  skipped: AutoAssignSkip[];
  agents: AutoAssignAgentSummary[];
};

type PlanTask = {
  id: string;
  number: string;
  customerName: string;
  status: DeliveryStatus;
  deliveryAgentId: string | null;
  scheduledDate: string;
  priority: DeliveryPriority;
  windowStart: string | null;
  createdAt: Date;
  point: GeoPoint | null;
  branchId: string | null;
  weightKg: number | null;
};

type PlanAgent = {
  id: string;
  code: string;
  name: string | null;
  branchId: string | null;
  maxLoadKg: number | null;
  schedule: DeliveryWorkingSchedule | null;
  onDuty: boolean;
  openTasks: number;
  loadKg: number;
  origin: GeoPoint | null;
};

const KG_PER_UNIT: Record<string, number> = {
  kg: 1,
  кг: 1,
  kilogram: 1,
  g: 0.001,
  gr: 0.001,
  г: 0.001,
  gram: 0.001,
  t: 1000,
  tn: 1000,
  ton: 1000,
  tonna: 1000,
  т: 1000,
};

/** Mahsulot og'irligi (asosiy birlik uchun) → kg; noma'lum birlik — null (yuk tekshirilmaydi). */
export function weightToKg(weight: string | null, unit: string | null): number | null {
  if (weight === null || unit === null) return null;
  const value = Number(weight);
  const factor = KG_PER_UNIT[unit.trim().toLowerCase()];
  return Number.isFinite(value) && value >= 0 && factor !== undefined ? value * factor : null;
}

/** Hafta kuni (0 — yakshanba), mahalliy sana bo'yicha. */
export const weekdayOf = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();

const round1 = (value: number) => Math.round(value * 10) / 10;

async function taskWeights(conn: DbOrTx, companyId: string, taskIds: string[]) {
  const result = new Map<string, number | null>();
  if (taskIds.length === 0) return result;
  const rows = await conn
    .select({
      taskId: deliveryTaskItems.taskId,
      quantity: deliveryTaskItems.quantity,
      unitId: salesOrderItems.unitId,
      productId: products.id,
      baseUnitId: products.baseUnitId,
      weight: products.weight,
      weightUnit: products.weightUnit,
    })
    .from(deliveryTaskItems)
    .innerJoin(salesOrderItems, eq(salesOrderItems.id, deliveryTaskItems.orderItemId))
    .innerJoin(products, eq(products.id, deliveryTaskItems.productId))
    .where(inArray(deliveryTaskItems.taskId, taskIds));
  const unitIds = [...new Set(rows.filter((row) => row.unitId !== row.baseUnitId).map((row) => row.unitId))];
  const conversions =
    unitIds.length > 0
      ? await conn
          .select({ fromUnitId: unitConversions.fromUnitId, toUnitId: unitConversions.toUnitId, productId: unitConversions.productId, factor: unitConversions.factor })
          .from(unitConversions)
          .where(and(eq(unitConversions.companyId, companyId), inArray(unitConversions.fromUnitId, unitIds)))
      : [];
  for (const row of rows) {
    const current = result.has(row.taskId) ? result.get(row.taskId)! : 0;
    if (current === null) continue;
    const kg = weightToKg(row.weight, row.weightUnit);
    let factor: number | null = row.unitId === row.baseUnitId ? 1 : null;
    if (factor === null) {
      const matches = conversions.filter((item) => item.fromUnitId === row.unitId && item.toUnitId === row.baseUnitId);
      const match = matches.find((item) => item.productId === row.productId) ?? matches.find((item) => item.productId === null);
      factor = match ? Number(match.factor) : null;
    }
    result.set(row.taskId, kg === null || factor === null ? null : current + Number(row.quantity) * factor * kg);
  }
  return result;
}

async function loadTasks(conn: DbOrTx, companyId: string, filter: { date: string } | { taskIds: string[] }, lock: boolean): Promise<PlanTask[]> {
  const query = conn
    .select({
      id: deliveryTasks.id,
      number: deliveryTasks.number,
      status: deliveryTasks.status,
      deliveryAgentId: deliveryTasks.deliveryAgentId,
      scheduledDate: deliveryTasks.scheduledDate,
      priority: deliveryTasks.priority,
      windowStart: deliveryTasks.windowStart,
      createdAt: deliveryTasks.createdAt,
      customerName: customers.name,
      latitude: customers.latitude,
      longitude: customers.longitude,
      branchId: warehouses.branchId,
    })
    .from(deliveryTasks)
    .innerJoin(customers, eq(customers.id, deliveryTasks.customerId))
    .leftJoin(warehouses, eq(warehouses.id, deliveryTasks.warehouseId))
    .where(
      and(
        eq(deliveryTasks.companyId, companyId),
        "taskIds" in filter
          ? inArray(deliveryTasks.id, filter.taskIds)
          : and(eq(deliveryTasks.scheduledDate, filter.date), eq(deliveryTasks.status, "ready"), isNull(deliveryTasks.deliveryAgentId)),
      ),
    );
  const rows = lock ? await query.for("update", { of: deliveryTasks }) : await query;
  const weights = await taskWeights(conn, companyId, rows.map((row) => row.id));
  return rows.map(({ latitude, longitude, windowStart, ...row }) => ({
    ...row,
    windowStart: hhmm(windowStart),
    point: pointOf(latitude, longitude),
    weightKg: weights.get(row.id) ?? null,
  }));
}

async function loadAgents(conn: DbOrTx, companyId: string, date: string, now: Date): Promise<PlanAgent[]> {
  const rows = await conn
    .select({
      id: deliveryAgents.id,
      code: deliveryAgents.code,
      name: users.name,
      branchId: deliveryAgents.branchId,
      maxLoadKg: deliveryAgents.maxLoadKg,
      schedule: deliveryAgents.workingSchedule,
      userActive: users.isActive,
      memberActive: companyMembers.isActive,
      sessionId: deliveryWorkSessions.id,
      latitude: deliveryLocationLatest.latitude,
      longitude: deliveryLocationLatest.longitude,
      receivedAt: deliveryLocationLatest.receivedAt,
    })
    .from(deliveryAgents)
    .innerJoin(users, eq(users.id, deliveryAgents.userId))
    .leftJoin(companyMembers, and(eq(companyMembers.companyId, deliveryAgents.companyId), eq(companyMembers.userId, deliveryAgents.userId)))
    .leftJoin(deliveryWorkSessions, and(eq(deliveryWorkSessions.deliveryAgentId, deliveryAgents.id), eq(deliveryWorkSessions.status, "active")))
    .leftJoin(deliveryLocationLatest, eq(deliveryLocationLatest.deliveryAgentId, deliveryAgents.id))
    .where(and(eq(deliveryAgents.companyId, companyId), eq(deliveryAgents.isActive, true)))
    .orderBy(asc(deliveryAgents.code));
  const active = rows.filter((row) => row.userActive && row.memberActive === true);
  if (active.length === 0) return [];

  const open = await conn
    .select({
      id: deliveryTasks.id,
      deliveryAgentId: deliveryTasks.deliveryAgentId,
      latitude: customers.latitude,
      longitude: customers.longitude,
    })
    .from(deliveryTasks)
    .innerJoin(customers, eq(customers.id, deliveryTasks.customerId))
    .where(
      and(
        eq(deliveryTasks.companyId, companyId),
        eq(deliveryTasks.scheduledDate, date),
        inArray(deliveryTasks.status, OPEN),
        inArray(
          deliveryTasks.deliveryAgentId,
          active.map((row) => row.id),
        ),
      ),
    )
    .orderBy(sql`${deliveryTasks.routeOrder} asc nulls first`, asc(deliveryTasks.assignedAt));
  const weights = await taskWeights(conn, companyId, open.map((task) => task.id));
  const today = localDate(now);

  return active.map((agent) => {
    const own = open.filter((task) => task.deliveryAgentId === agent.id);
    const lastStop = [...own].reverse().map((task) => pointOf(task.latitude, task.longitude)).find((point) => point !== null) ?? null;
    const fresh =
      date === today && agent.sessionId !== null && agent.receivedAt !== null && now.getTime() - agent.receivedAt.getTime() <= LOCATION_FRESH_MS
        ? pointOf(agent.latitude, agent.longitude)
        : null;
    return {
      id: agent.id,
      code: agent.code,
      name: agent.name,
      branchId: agent.branchId,
      maxLoadKg: agent.maxLoadKg === null ? null : Number(agent.maxLoadKg),
      schedule: agent.schedule,
      onDuty: agent.sessionId !== null,
      openTasks: own.length,
      loadKg: own.reduce((sum, task) => sum + (weights.get(task.id) ?? 0), 0),
      origin: lastStop ?? fresh,
    };
  });
}

type Evaluation = { ok: true; distance: number | null } | { ok: false; reason: DeliveryAutoAssignSkipReason };

export function evaluateCandidate(
  agent: Pick<PlanAgent, "schedule" | "onDuty" | "openTasks" | "branchId" | "maxLoadKg" | "loadKg" | "origin">,
  task: Pick<PlanTask, "branchId" | "weightKg" | "point">,
  rules: DeliveryPolicy["autoAssign"],
  date: string,
  today: string,
): Evaluation {
  if (rules.respectSchedule && agent.schedule && !agent.schedule.days.includes(weekdayOf(date))) return { ok: false, reason: "schedule" };
  if (rules.requireOnDuty && date === today && !agent.onDuty) return { ok: false, reason: "off_duty" };
  if (agent.openTasks >= rules.maxTasksPerAgent) return { ok: false, reason: "task_limit" };
  if (rules.respectBranch && agent.branchId && task.branchId && agent.branchId !== task.branchId) return { ok: false, reason: "branch" };
  if (rules.respectCapacity && agent.maxLoadKg !== null && task.weightKg !== null && agent.loadKg + task.weightKg > agent.maxLoadKg + 1e-9) {
    return { ok: false, reason: "load_limit" };
  }
  const distance = agent.origin && task.point ? Math.round(distanceMeters(agent.origin, task.point)) : null;
  if (rules.maxDistanceKm > 0 && distance !== null && distance > rules.maxDistanceKm * 1000) return { ok: false, reason: "too_far" };
  return { ok: true, distance };
}

type Option = { agent: Pick<PlanAgent, "openTasks" | "code">; distance: number | null };

/** Manfiy — `a` yaxshiroq. */
export function compareCandidates(a: Option, b: Option, strategy: DeliveryAutoAssignStrategy): number {
  const load = a.agent.openTasks - b.agent.openTasks;
  const da = a.distance ?? Number.POSITIVE_INFINITY;
  const db = b.distance ?? Number.POSITIVE_INFINITY;
  const distance = da === db ? 0 : da < db ? -1 : 1;
  const primary = strategy === "balanced" ? load || distance : distance || load;
  return primary || a.agent.code.localeCompare(b.agent.code);
}

const taskOrder = (a: PlanTask, b: PlanTask) =>
  PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
  (a.windowStart ?? "99:99").localeCompare(b.windowStart ?? "99:99") ||
  a.createdAt.getTime() - b.createdAt.getTime() ||
  a.id.localeCompare(b.id);

type PlanInput = {
  date: string;
  strategy: DeliveryAutoAssignStrategy;
  taskIds?: string[];
  pairs?: { taskId: string; deliveryAgentId: string }[];
  lock?: boolean;
};

async function buildPlan(conn: DbOrTx, companyId: string, policy: DeliveryPolicy, input: PlanInput): Promise<AutoAssignPlan> {
  const now = new Date();
  const today = localDate(now);
  const ids = input.pairs ? input.pairs.map((pair) => pair.taskId) : input.taskIds;
  const tasks = await loadTasks(conn, companyId, ids ? { taskIds: ids } : { date: input.date }, input.lock ?? false);
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const agents = await loadAgents(conn, companyId, input.date, now);
  const summary = agents.map(({ id, code, name, openTasks, loadKg, maxLoadKg, onDuty }) => ({ id, code, name, openTasks, loadKg: round1(loadKg), maxLoadKg, onDuty }));
  const agentById = new Map(agents.map((agent) => [agent.id, agent]));
  const proposals: AutoAssignProposal[] = [];
  const skipped: AutoAssignSkip[] = [];

  const usable = (task: PlanTask): boolean => task.status === "ready" && task.deliveryAgentId === null && task.scheduledDate === input.date;
  const skip = (taskId: string, task: PlanTask | undefined, reason: DeliveryAutoAssignSkipReason, counts?: AutoAssignSkip["counts"]) =>
    skipped.push({ taskId, number: task?.number ?? null, customerName: task?.customerName ?? null, reason, ...(counts ? { counts } : {}) });
  const accept = (task: PlanTask, agent: PlanAgent, distance: number | null) => {
    agent.openTasks += 1;
    agent.loadKg += task.weightKg ?? 0;
    if (task.point) agent.origin = task.point;
    proposals.push({
      taskId: task.id,
      number: task.number,
      customerName: task.customerName,
      deliveryAgentId: agent.id,
      agentCode: agent.code,
      agentName: agent.name,
      distanceMeters: distance,
      openTasksAfter: agent.openTasks,
      loadKgAfter: agent.maxLoadKg === null ? null : round1(agent.loadKg),
    });
  };

  if (input.pairs) {
    const seen = new Set<string>();
    for (const pair of input.pairs) {
      const task = taskById.get(pair.taskId);
      if (!task || !usable(task) || seen.has(pair.taskId)) {
        skip(pair.taskId, task, "task_not_ready");
        continue;
      }
      seen.add(pair.taskId);
      const agent = agentById.get(pair.deliveryAgentId);
      if (!agent) {
        skip(pair.taskId, task, "agent_unavailable");
        continue;
      }
      const result = evaluateCandidate(agent, task, policy.autoAssign, input.date, today);
      if (result.ok) accept(task, agent, result.distance);
      else skip(pair.taskId, task, result.reason);
    }
  } else {
    if (input.taskIds) for (const id of input.taskIds) if (!taskById.has(id)) skip(id, undefined, "task_not_ready");
    const candidates: PlanTask[] = [];
    for (const task of tasks) {
      if (usable(task)) candidates.push(task);
      else skip(task.id, task, "task_not_ready");
    }
    candidates.sort(taskOrder);
    for (const task of candidates) {
      if (agents.length === 0) {
        skip(task.id, task, "no_agents");
        continue;
      }
      const counts: Partial<Record<DeliveryAutoAssignSkipReason, number>> = {};
      let best: { agent: PlanAgent; distance: number | null } | null = null;
      for (const agent of agents) {
        const result = evaluateCandidate(agent, task, policy.autoAssign, input.date, today);
        if (!result.ok) {
          counts[result.reason] = (counts[result.reason] ?? 0) + 1;
          continue;
        }
        const option = { agent, distance: result.distance };
        if (!best || compareCandidates(option, best, input.strategy) < 0) best = option;
      }
      if (best) accept(task, best.agent, best.distance);
      else {
        const reason = (Object.entries(counts) as [DeliveryAutoAssignSkipReason, number][]).sort((a, b) => b[1] - a[1])[0]![0];
        skip(task.id, task, reason, counts);
      }
    }
  }
  return { date: input.date, strategy: input.strategy, proposals, skipped, agents: summary };
}

/** Reja — hech narsa yozilmaydi. */
export function planAutoAssign(
  conn: DbOrTx,
  companyId: string,
  policy: DeliveryPolicy,
  input: { date: string; strategy?: DeliveryAutoAssignStrategy; taskIds?: string[] },
) {
  return buildPlan(conn, companyId, policy, { date: input.date, strategy: input.strategy ?? policy.autoAssign.strategy, taskIds: input.taskIds });
}

export async function applyAutoAssign(
  tx: Tx,
  tenant: TenantContext,
  policy: DeliveryPolicy,
  input: { date: string; strategy?: DeliveryAutoAssignStrategy; taskIds?: string[]; assignments?: { taskId: string; deliveryAgentId: string }[] },
  meta: RequestMeta,
  trigger: "manual" | "on_create",
) {
  // Bir kompaniyada ikkita avtomatik taqsimlash bir vaqtda agent limitini buzmasin
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`delivery-auto-assign:${tenant.company.id}`}, 0))`);
  const strategy = input.strategy ?? policy.autoAssign.strategy;
  const plan = await buildPlan(tx, tenant.company.id, policy, {
    date: input.date,
    strategy,
    taskIds: input.taskIds,
    pairs: input.assignments,
    lock: true,
  });
  for (const proposal of plan.proposals) {
    await assignDeliveryTask(tx, tenant, proposal.taskId, { deliveryAgentId: proposal.deliveryAgentId }, meta, {
      allowReassign: false,
      auto: { strategy, trigger, distanceMeters: proposal.distanceMeters },
    });
  }
  return { date: plan.date, strategy, assigned: plan.proposals, skipped: plan.skipped };
}
