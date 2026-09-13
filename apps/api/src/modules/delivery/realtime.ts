/**
 * Dostavka real-time: `GET /api/delivery/ws` (WebSocket).
 *
 *  - Ulanish: sessiya cookie'si (requireAuth), Origin tekshiruvi (boshqa saytdan cookie bilan ulanish — CSWSH — rad),
 *    aktiv kompaniya va ruxsat: `delivery.view` (boshqaruvchi) yoki bog'langan faol yetkazuvchi (`delivery.accept`).
 *  - Hodisalar PostgreSQL LISTEN orqali (bitta ajratilgan ulanish, faqat mijoz bor paytda); har mijozga `messageFor`
 *    bo'yicha: boshqaruvchi — kompaniya yetkazmalari va agentlar, lokatsiya — faqat `delivery.view_location`, agent —
 *    faqat o'ziga tegishli yetkazmalar va o'z ish sessiyasi. Boshqa kompaniya hodisasi hech kimga bormaydi.
 *  - Xabarda faqat ID va holat — ma'lumot REST orqali (RBAC bilan) qayta olinadi.
 *  - Har daqiqada sessiya va ruxsat qayta tekshiriladi (faollik vaqti cho'zilmaydi): sessiya tugagan — 4401,
 *    ruxsat yoki kompaniya o'zgargan — 4403. Ping/pong 30 s; foydalanuvchiga ko'pi bilan 5 ulanish.
 *  - LISTEN ulanishi uzilsa hamma mijozlar 1012 bilan yopiladi — ular qayta ulanib, ma'lumotni yangilaydi (o'tkazib
 *    yuborilgan hodisa qolmaydi).
 */
import type { FastifyBaseLogger } from "fastify";
import pg from "pg";
import type { WebSocket } from "ws";
import { and, eq } from "drizzle-orm";
import { AppError, type DeliveryRealtimeMessage } from "@bum/shared";
import { db } from "../../db/client.js";
import { deliveryAgents } from "../../db/schema/delivery.js";
import { env } from "../../env.js";
import { peekSession } from "../auth/session.js";
import { resolveCompanyContext } from "../company/company-context.js";
import { effectivePermissions, requireTenant } from "../company/tenant.js";
import { DELIVERY_CHANNEL, parseDeliveryBusEvent, type DeliveryBusEvent } from "./realtime-bus.js";

export type RealtimeAccess = {
  userId: string;
  companyId: string;
  manager: boolean;
  viewLocation: boolean;
  deliveryAgentId: string | null;
};

/** Vaqtlar (sinovlarda qisqartiriladi). */
export const realtimeTiming = { recheckMs: 60_000, heartbeatMs: 30_000 };
export const MAX_CONNECTIONS_PER_USER = 5;
export const CLOSE_CODES = { unauthenticated: 4401, forbidden: 4403, tooMany: 4409, restart: 1012, unavailable: 1011, shutdown: 1001 } as const;

/** @param companyKey tab biznesi (`bumCompany`); null — foydalanuvchining saqlangan aktiv kompaniyasi. */
export async function resolveRealtimeAccess(token: string, companyKey: string | null = null): Promise<RealtimeAccess | "unauthenticated" | "forbidden"> {
  const session = await peekSession(token);
  if (!session) return "unauthenticated";
  let tenant;
  try {
    tenant = await requireTenant(db, await resolveCompanyContext(db, session.user, companyKey));
  } catch (error) {
    if (error instanceof AppError) return "forbidden";
    throw error;
  }
  const permissions = await effectivePermissions(db, tenant);
  let deliveryAgentId: string | null = null;
  if (permissions.includes("delivery.accept")) {
    const [agent] = await db
      .select({ id: deliveryAgents.id })
      .from(deliveryAgents)
      .where(and(eq(deliveryAgents.companyId, tenant.company.id), eq(deliveryAgents.userId, session.user.id), eq(deliveryAgents.isActive, true)))
      .limit(1);
    deliveryAgentId = agent?.id ?? null;
  }
  const manager = permissions.includes("delivery.view");
  if (!manager && !deliveryAgentId) return "forbidden";
  return {
    userId: session.user.id,
    companyId: tenant.company.id,
    manager,
    viewLocation: permissions.includes("delivery.view_location"),
    deliveryAgentId,
  };
}

/** Brauzer WebSocket so'rovida Origin'ni har doim yuboradi: faqat ilova manzili yoki shu host (bir domen proksi). */
export function originAllowed(origin: string | undefined, host: string | undefined): boolean {
  if (!origin) return true;
  if (origin === env.WEB_ORIGIN) return true;
  try {
    return host !== undefined && new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** Hodisani shu mijozga yuborish kerakmi va nimani (null — yuborilmaydi). */
export function messageFor(access: RealtimeAccess, event: DeliveryBusEvent): DeliveryRealtimeMessage | null {
  if (event.companyId !== access.companyId) return null;
  switch (event.type) {
    case "task":
      return access.manager || (access.deliveryAgentId !== null && event.agentIds.includes(access.deliveryAgentId))
        ? { type: "task", taskId: event.taskId, status: event.status, action: event.action }
        : null;
    case "location":
      return access.viewLocation ? { type: "location", deliveryAgentId: event.deliveryAgentId } : null;
    case "session":
      return access.manager || access.deliveryAgentId === event.deliveryAgentId ? { type: "session", deliveryAgentId: event.deliveryAgentId } : null;
    case "agents":
      return access.manager ? { type: "agents" } : null;
    case "policy":
      return { type: "policy" };
  }
}

type Client = { socket: WebSocket; token: string; companyKey: string | null; access: RealtimeAccess; alive: boolean };

export class DeliveryRealtimeHub {
  private readonly clients = new Set<Client>();
  private listener: pg.Client | null = null;
  private connecting: Promise<boolean> | null = null;
  private heartbeat: NodeJS.Timeout | null = null;
  private recheckTimer: NodeJS.Timeout | null = null;
  private closed = false;

  constructor(private readonly log: FastifyBaseLogger) {}

  get size() {
    return this.clients.size;
  }

  async add(socket: WebSocket, token: string, access: RealtimeAccess, companyKey: string | null = null) {
    if (this.closed) {
      socket.close(CLOSE_CODES.shutdown);
      return;
    }
    const own = [...this.clients].filter((item) => item.access.userId === access.userId);
    for (const extra of own.slice(0, Math.max(0, own.length - MAX_CONNECTIONS_PER_USER + 1))) {
      extra.socket.close(CLOSE_CODES.tooMany, "too many connections");
    }
    const client: Client = { socket, token, companyKey, access, alive: true };
    this.clients.add(client);
    socket.on("pong", () => {
      client.alive = true;
    });
    socket.on("message", (data) => {
      if (String(data) === "ping") this.send(client, { type: "pong" });
    });
    socket.on("close", () => {
      this.clients.delete(client);
      this.stopIfIdle();
    });
    socket.on("error", () => socket.terminate());
    this.startTimers();

    // "ready" faqat LISTEN o'rnatilgach — undan keyingi hodisa o'tkazib yuborilmaydi
    if (!(await this.ensureListening())) {
      socket.close(CLOSE_CODES.unavailable, "realtime unavailable");
      return;
    }
    this.send(client, { type: "ready", manager: access.manager, agent: access.deliveryAgentId !== null });
  }

  dispatch(event: DeliveryBusEvent) {
    for (const client of this.clients) {
      const message = messageFor(client.access, event);
      if (message) this.send(client, message);
    }
  }

  /** Sessiya va ruxsatlarni qayta tekshirish (faollik vaqti yangilanmaydi). */
  async recheck() {
    for (const client of [...this.clients]) {
      let access: Awaited<ReturnType<typeof resolveRealtimeAccess>>;
      try {
        access = await resolveRealtimeAccess(client.token, client.companyKey);
      } catch (error) {
        this.log.warn({ err: error }, "delivery realtime: qayta tekshirishda xato");
        continue;
      }
      if (access === "unauthenticated") client.socket.close(CLOSE_CODES.unauthenticated, "session");
      else if (access === "forbidden" || access.companyId !== client.access.companyId) client.socket.close(CLOSE_CODES.forbidden, "access");
      else client.access = access;
    }
  }

  async close() {
    this.closed = true;
    this.stopTimers();
    for (const client of this.clients) client.socket.close(CLOSE_CODES.shutdown, "shutdown");
    this.clients.clear();
    await this.endListener();
  }

  private send(client: Client, message: DeliveryRealtimeMessage) {
    if (client.socket.readyState === client.socket.OPEN) client.socket.send(JSON.stringify(message));
  }

  private ensureListening(): Promise<boolean> {
    if (this.listener) return Promise.resolve(true);
    if (!this.connecting) {
      this.connecting = this.connectListener().finally(() => {
        this.connecting = null;
      });
    }
    return this.connecting;
  }

  private async connectListener(): Promise<boolean> {
    const client = new pg.Client({ connectionString: env.DATABASE_URL });
    client.on("notification", (message) => {
      if (message.channel !== DELIVERY_CHANNEL) return;
      const event = parseDeliveryBusEvent(message.payload);
      if (event) this.dispatch(event);
    });
    client.on("error", (error) => {
      this.log.warn({ err: error }, "delivery realtime: LISTEN ulanishi xatosi");
      this.dropListener(client);
    });
    client.on("end", () => this.dropListener(client));
    try {
      await client.connect();
      await client.query(`LISTEN ${DELIVERY_CHANNEL}`);
    } catch (error) {
      this.log.warn({ err: error }, "delivery realtime: LISTEN o'rnatilmadi");
      await client.end().catch(() => {});
      return false;
    }
    if (this.closed || this.clients.size === 0) {
      await client.end().catch(() => {});
      return !this.closed;
    }
    this.listener = client;
    return true;
  }

  /** LISTEN uzildi — mijozlar qayta ulanadi (keyingi `add` yangi LISTEN ochadi) va ma'lumotni yangilaydi. */
  private dropListener(client: pg.Client) {
    if (this.listener !== client) return;
    this.listener = null;
    for (const item of this.clients) item.socket.close(CLOSE_CODES.restart, "listener restart");
  }

  private stopIfIdle() {
    if (this.clients.size > 0) return;
    this.stopTimers();
    void this.endListener();
  }

  private async endListener() {
    const listener = this.listener;
    this.listener = null;
    if (listener) await listener.end().catch(() => {});
  }

  private startTimers() {
    if (!this.heartbeat) {
      this.heartbeat = setInterval(() => {
        for (const client of this.clients) {
          if (!client.alive) {
            client.socket.terminate();
            continue;
          }
          client.alive = false;
          client.socket.ping();
        }
      }, realtimeTiming.heartbeatMs);
      this.heartbeat.unref();
    }
    if (!this.recheckTimer) {
      this.recheckTimer = setInterval(() => void this.recheck(), realtimeTiming.recheckMs);
      this.recheckTimer.unref();
    }
  }

  private stopTimers() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.recheckTimer) clearInterval(this.recheckTimer);
    this.heartbeat = null;
    this.recheckTimer = null;
  }
}
