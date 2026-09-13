import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DeliveryRealtimeMessage } from "@bum/shared";
import { closeDb, db } from "../src/db/client.js";
import { withTransaction } from "../src/db/transaction.js";
import { revokeUserSessions } from "../src/modules/auth/session.js";
import { publishDeliveryEvent } from "../src/modules/delivery/realtime-bus.js";
import { messageFor, originAllowed, realtimeTiming } from "../src/modules/delivery/realtime.js";
import { buildServer } from "../src/server.js";
import {
  agentAction,
  assign,
  caller,
  confirmedOrder,
  deliveryAgent,
  deliveryCompany,
  near,
  resetUnits,
  startShift,
  taskForOrder,
  type DeliveryCompany,
} from "./delivery-setup.js";
import { addEmployee, resetDatabase, signedIn } from "./helpers.js";

type Socket = Awaited<ReturnType<FastifyInstance["injectWS"]>>;
/** `injectWS` natijasi va `onInit` dagi ulanish turli `ws` tip e'lonlaridan — tinglash uchun umumiy qism yetadi. */
type MessageSource = { on(event: "message", listener: (data: unknown) => void): unknown };
type Predicate = (message: DeliveryRealtimeMessage) => boolean;

let app: FastifyInstance;
let adminCookie: string;
let company: DeliveryCompany;
const sockets: Socket[] = [];

beforeAll(async () => {
  // Qayta tekshiruv sinovda tez bo'lsin (hub birinchi ulanishda shu qiymat bilan taymer ochadi)
  realtimeTiming.recheckMs = 300;
  app = await buildServer();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await closeDb();
});

beforeEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate();
  await resetDatabase();
  await resetUnits();
  adminCookie = (await signedIn(app, { isPlatformAdmin: true })).cookie;
  company = await deliveryCompany(app, adminCookie, "Jonli");
});

/** Kelgan xabarlar va kutish (xabar oldin kelgan bo'lsa ham topiladi). */
function listen(socket: MessageSource) {
  const messages: DeliveryRealtimeMessage[] = [];
  const waiters: { predicate: Predicate; resolve: (message: DeliveryRealtimeMessage) => void }[] = [];
  socket.on("message", (data) => {
    const message = JSON.parse(String(data)) as DeliveryRealtimeMessage;
    messages.push(message);
    for (const waiter of [...waiters]) {
      if (!waiter.predicate(message)) continue;
      waiters.splice(waiters.indexOf(waiter), 1);
      waiter.resolve(message);
    }
  });
  const next = (predicate: Predicate, timeoutMs = 5000) => {
    const found = messages.find(predicate);
    if (found) return Promise.resolve(found);
    return new Promise<DeliveryRealtimeMessage>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Kutilgan xabar kelmadi")), timeoutMs);
      waiters.push({
        predicate,
        resolve: (message) => {
          clearTimeout(timer);
          resolve(message);
        },
      });
    });
  };
  return { messages, next };
}

async function connect(cookie: string) {
  // Tinglovchi ochilishdan OLDIN ulanadi (brauzerdagi `onmessage` kabi) — server darhol yuborgan "ready" yo'qolmaydi
  const holder: { listener?: ReturnType<typeof listen> } = {};
  const socket = await app.injectWS(
    "/api/delivery/ws",
    { headers: { cookie } },
    {
      onInit: (ws) => {
        holder.listener = listen(ws);
      },
    },
  );
  sockets.push(socket);
  const listener = holder.listener!;
  const ready = await listener.next((message) => message.type === "ready");
  return { socket, ready, ...listener };
}

const closed = (socket: Socket) => new Promise<number>((resolve) => socket.on("close", (code) => resolve(code)));
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const isTask =
  (taskId: string, action?: string): Predicate =>
  (message) =>
    message.type === "task" && message.taskId === taskId && (action === undefined || message.action === action);

describe("dostavka real-time: filtrlash (sof)", () => {
  const manager = { userId: "u1", companyId: "c1", manager: true, viewLocation: false, deliveryAgentId: null };
  const agent = { userId: "u2", companyId: "c1", manager: false, viewLocation: false, deliveryAgentId: "a1" };
  const task = { type: "task" as const, companyId: "c1", taskId: "t1", agentIds: ["a1"], status: "assigned" as const, action: "ASSIGNED" };

  it("kompaniya, agent, lokatsiya ruxsati va Origin", () => {
    expect(messageFor(manager, task)).toEqual({ type: "task", taskId: "t1", status: "assigned", action: "ASSIGNED" });
    expect(messageFor(agent, task)).not.toBeNull();
    expect(messageFor({ ...agent, deliveryAgentId: "a2" }, task)).toBeNull();
    expect(messageFor({ ...manager, companyId: "c2" }, task)).toBeNull();
    expect(messageFor(manager, { type: "location", companyId: "c1", deliveryAgentId: "a1" })).toBeNull();
    expect(messageFor({ ...manager, viewLocation: true }, { type: "location", companyId: "c1", deliveryAgentId: "a1" })).not.toBeNull();
    expect(messageFor(agent, { type: "session", companyId: "c1", deliveryAgentId: "a2" })).toBeNull();
    expect(messageFor(agent, { type: "agents", companyId: "c1" })).toBeNull();
    expect(messageFor(agent, { type: "policy", companyId: "c1" })).toEqual({ type: "policy" });

    expect(originAllowed(undefined, "bum-erp.uz")).toBe(true);
    expect(originAllowed("https://bum-erp.uz", "bum-erp.uz")).toBe(true);
    expect(originAllowed("https://evil.example", "bum-erp.uz")).toBe(false);
    expect(originAllowed("not a url", "bum-erp.uz")).toBe(false);
  });
});

describe("dostavka real-time (WebSocket)", () => {
  it("ulanish: sessiyasiz 401, begona Origin 403, dostavka ruxsatisiz 403; boshqaruvchi va agent qabul qilinadi", async () => {
    await expect(app.injectWS("/api/delivery/ws", { headers: {} })).rejects.toThrow(/401/);
    await expect(app.injectWS("/api/delivery/ws", { headers: { cookie: company.ownerCookie, origin: "https://evil.example" } })).rejects.toThrow(/403/);
    const cashier = await addEmployee(app, company, "Kassir");
    await expect(app.injectWS("/api/delivery/ws", { headers: { cookie: cashier.cookie } })).rejects.toThrow(/403/);

    const manager = await connect(company.ownerCookie);
    expect(manager.ready).toEqual({ type: "ready", manager: true, agent: false });
    const agent = await deliveryAgent(app, company);
    const agentSocket = await connect(agent.cookie);
    expect(agentSocket.ready).toEqual({ type: "ready", manager: false, agent: true });
  });

  it("hodisalar: boshqaruvchi — kompaniya yetkazmalari, agent — faqat o'zinikiga; boshqa kompaniya hech narsa olmaydi", async () => {
    const first = await deliveryAgent(app, company);
    const second = await deliveryAgent(app, company);
    const other = await deliveryCompany(app, adminCookie, "Boshqa jonli");
    const manager = await connect(company.ownerCookie);
    const firstSocket = await connect(first.cookie);
    const secondSocket = await connect(second.cookie);
    const foreign = await connect(other.ownerCookie);

    const orderId = await confirmedOrder(app, company, "3");
    const { id: taskId } = await taskForOrder(app, company.ownerCookie, orderId);
    await manager.next(isTask(taskId, "CREATED"));

    await assign(app, company.ownerCookie, taskId, first.id);
    await manager.next(isTask(taskId, "ASSIGNED"));
    expect(await firstSocket.next(isTask(taskId, "ASSIGNED"))).toEqual({ type: "task", taskId, status: "assigned", action: "ASSIGNED" });

    expect((await agentAction(app, first.cookie, taskId, "accept")).statusCode).toBe(200);
    await manager.next(isTask(taskId, "ACCEPTED"));

    await startShift(app, first.cookie);
    await manager.next((message) => message.type === "session" && message.deliveryAgentId === first.id);
    await firstSocket.next((message) => message.type === "session");
    const located = await caller(app)(first.cookie, "POST", "/api/delivery/agent/locations", { points: [near(40)] });
    expect(located.statusCode, located.body).toBe(200);
    await manager.next((message) => message.type === "location" && message.deliveryAgentId === first.id);

    // Boshqa agentga o'tkazish — yangi agent ham, olib tashlangan agent ham xabar oladi
    await assign(app, company.ownerCookie, taskId, second.id);
    await secondSocket.next(isTask(taskId, "REASSIGNED"));
    await firstSocket.next(isTask(taskId, "REASSIGNED"));

    await pause(500);
    expect(secondSocket.messages.filter((message) => message.type === "task" && message.action !== "REASSIGNED")).toEqual([]);
    expect(secondSocket.messages.some((message) => message.type === "location" || message.type === "session")).toBe(false);
    expect(foreign.messages.filter((message) => message.type !== "ready")).toEqual([]);
  });

  it("bekor qilingan tranzaksiya hodisa bermaydi — faqat commit bo'lgani keladi", async () => {
    const manager = await connect(company.ownerCookie);
    const rolledBack = randomUUID();
    const committed = randomUUID();
    await expect(
      withTransaction(async (tx) => {
        await publishDeliveryEvent(tx, { type: "task", companyId: company.companyId, taskId: rolledBack, agentIds: [], status: null, action: "TEST" });
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    await withTransaction((tx) =>
      publishDeliveryEvent(tx, { type: "task", companyId: company.companyId, taskId: committed, agentIds: [], status: null, action: "TEST" }),
    );
    await manager.next(isTask(committed));
    await pause(300);
    expect(manager.messages.some(isTask(rolledBack))).toBe(false);
  });

  it("qayta tekshiruv: sessiya bekor qilinsa — 4401, agent faolsizlantirilsa — ulanish yopiladi", async () => {
    const first = await deliveryAgent(app, company);
    const second = await deliveryAgent(app, company);
    const firstSocket = await connect(first.cookie);
    const secondSocket = await connect(second.cookie);

    const firstClosed = closed(firstSocket.socket);
    await revokeUserSessions(db, first.userId);
    expect(await firstClosed).toBe(4401);

    const secondClosed = closed(secondSocket.socket);
    const res = await caller(app)(company.ownerCookie, "PATCH", `/api/delivery/agents/${second.id}`, { isActive: false });
    expect(res.statusCode, res.body).toBe(200);
    expect([4401, 4403]).toContain(await secondClosed);
  });
});
