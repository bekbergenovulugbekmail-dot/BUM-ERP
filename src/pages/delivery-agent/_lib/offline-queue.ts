/**
 * Oflayn amallar navbati (qurilmada, `localStorage`): internet yo'q joyda agent amali (qabul, yo'lga chiqish, yetib
 * kelish, isbot, to'lov, tasdiqlash, yetkazilmadi) so'rov kaliti (`clientRequestId`) va amal vaqti (`occurredAt`) bilan
 * saqlanadi; internet qaytganda tartib bilan yuboriladi. Server har amalni qayta tekshiradi (ruxsat, holat, GPS
 * yangiligi amal vaqtiga nisbatan, geofence, to'lov qoldig'i) va kalit bo'yicha takrorni rad etmaydi, qayta bajarmaydi.
 * Server rad etsa (4xx) — amal "yuborilmadi" bo'lib qoladi, shu yetkazmaning keyingi amallari kutadi.
 *
 * Navbat foydalanuvchiga bog'lanadi (`setQueueOwner`): shu qurilmada boshqa foydalanuvchi kirsa oldingisining
 * yuborilmagan amallari (rasm, to'lov, GPS) unga ko'rinmaydi va uning sessiyasi bilan yuborilmaydi; egasi qayta
 * kirganda navbati joyida (yig'ilgan pul amallari yo'qolmaydi).
 */

export const DELIVERY_ACTIONS = ["accept", "start", "arrive", "delivering", "proofs", "payments", "confirm", "fail"] as const;
export type DeliveryAction = (typeof DELIVERY_ACTIONS)[number];

export type QueueError = { status: number; code: string; message: string; reason: string | null; details?: unknown };

export type QueuedAction = {
  id: string;
  taskId: string;
  action: DeliveryAction;
  body: Record<string, unknown> & { clientRequestId: string; occurredAt: string };
  /** Qurilmadagi belgi (serverga yuborilmaydi): tasdiqlash qisman bo'lsa. */
  meta?: { partial?: boolean };
  queuedAt: string;
  attempts: number;
  state: "pending" | "failed";
  error: QueueError | null;
};

export const QUEUE_STORAGE_KEY = "bum:delivery-queue";
export const QUEUE_EVENT = "bum:delivery-queue";

let owner: string | null = null;

/** Joriy navbat kaliti: foydalanuvchi ma'lum bo'lsa — `bum:delivery-queue:<userId>`. */
export function queueStorageKey(): string {
  return owner ? `${QUEUE_STORAGE_KEY}:${owner}` : QUEUE_STORAGE_KEY;
}

/**
 * Navbat egasi (kirgan foydalanuvchi). Eski (foydalanuvchiga bog'lanmagan) navbat birinchi kirgan foydalanuvchiga
 * o'tkaziladi — boshqa agentning yetkazmasiga tegishli amallarni server baribir rad etadi.
 */
export function setQueueOwner(userId: string | null) {
  if (owner === userId) return;
  owner = userId;
  if (!userId) return;
  try {
    const legacy = localStorage.getItem(QUEUE_STORAGE_KEY);
    if (legacy !== null) {
      if (localStorage.getItem(queueStorageKey()) === null) localStorage.setItem(queueStorageKey(), legacy);
      localStorage.removeItem(QUEUE_STORAGE_KEY);
    }
  } catch {
    // localStorage yopiq — ko'chiriladigan narsa yo'q
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(QUEUE_EVENT));
}

const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

export function readQueue(): QueuedAction[] {
  try {
    const raw = localStorage.getItem(queueStorageKey());
    const parsed = raw ? (JSON.parse(raw) as QueuedAction[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Saqlab bo'lmasa (xotira to'lgan) — `false`. */
export function writeQueue(items: QueuedAction[]): boolean {
  try {
    localStorage.setItem(queueStorageKey(), JSON.stringify(items));
    if (typeof window !== "undefined") window.dispatchEvent(new Event(QUEUE_EVENT));
    return true;
  } catch {
    return false;
  }
}

export function newRequestBody<T extends Record<string, unknown>>(body: T, now = new Date()) {
  return { clientRequestId: newId(), occurredAt: now.toISOString(), ...body };
}

export function enqueue(taskId: string, action: DeliveryAction, body: QueuedAction["body"], meta?: QueuedAction["meta"]): QueuedAction {
  const item: QueuedAction = { id: newId(), taskId, action, body, meta, queuedAt: new Date().toISOString(), attempts: 0, state: "pending", error: null };
  if (!writeQueue([...readQueue(), item])) throw new Error("QUEUE_FULL");
  return item;
}

export function discardAction(id: string) {
  writeQueue(readQueue().filter((item) => item.id !== id));
}

/** Rad etilgan amalni qayta navbatga (masalan, yangi GPS bilan qayta urinish emas — o'sha amalni qayta yuborish). */
export function retryAction(id: string) {
  writeQueue(readQueue().map((item) => (item.id === id ? { ...item, state: "pending" as const, error: null } : item)));
}

export type SendResult = { sent: number; failed: number; pending: number };

/**
 * Navbatni tartib bilan yuboradi. Tarmoq xatosida to'xtaydi (qolgani keyin); server rad etsa — amal `failed`,
 * shu yetkazmaning keyingi amallari yuborilmaydi (tartib buzilmasin), boshqa yetkazmalarniki davom etadi.
 */
export async function flushQueue(
  send: (item: QueuedAction) => Promise<void>,
  classify: (error: unknown) => { network: boolean; error: QueueError },
): Promise<SendResult> {
  let sent = 0;
  let failed = 0;
  const blockedTasks = new Set<string>();
  for (const item of readQueue()) {
    const current = readQueue().find((entry) => entry.id === item.id);
    if (!current) continue;
    if (current.state === "failed") {
      blockedTasks.add(current.taskId);
      continue;
    }
    if (blockedTasks.has(current.taskId)) continue;
    try {
      await send(current);
      writeQueue(readQueue().filter((entry) => entry.id !== current.id));
      sent += 1;
    } catch (error) {
      const result = classify(error);
      if (result.network) {
        writeQueue(readQueue().map((entry) => (entry.id === current.id ? { ...entry, attempts: entry.attempts + 1 } : entry)));
        break;
      }
      writeQueue(
        readQueue().map((entry) => (entry.id === current.id ? { ...entry, attempts: entry.attempts + 1, state: "failed" as const, error: result.error } : entry)),
      );
      blockedTasks.add(current.taskId);
      failed += 1;
    }
  }
  return { sent, failed, pending: readQueue().filter((item) => item.state === "pending").length };
}

/** Navbatdagi amallar yetkazmaning ko'rinadigan holatini oldindan ko'rsatadi (server tasdiqlaguncha "navbatda" belgisi bilan). */
export function projectedStatus<S extends string>(status: S, actions: QueuedAction[]): S | string {
  let result: string = status;
  for (const item of actions) {
    if (item.state !== "pending") continue;
    if (item.action === "accept") result = "accepted";
    else if (item.action === "start") result = "out_for_delivery";
    else if (item.action === "arrive") result = "arrived";
    else if (item.action === "delivering") result = "delivering";
    else if (item.action === "fail") result = "failed";
    else if (item.action === "confirm") result = item.meta?.partial ? "partially_delivered" : "delivered";
  }
  return result;
}
