import { beforeEach, describe, expect, it } from "vitest";
import {
  QUEUE_STORAGE_KEY,
  discardAction,
  enqueue,
  flushQueue,
  newRequestBody,
  projectedStatus,
  readQueue,
  retryAction,
  setQueueOwner,
} from "./offline-queue.ts";

const network = () => ({ network: true, error: { status: 0, code: "NETWORK", message: "", reason: null } });
const rejected = (reason: string) => () => ({ network: false, error: { status: 403, code: "FORBIDDEN", message: reason, reason } });

describe("yetkazuvchi oflayn navbati", () => {
  beforeEach(() => {
    setQueueOwner(null);
    localStorage.clear();
  });

  it("navbat foydalanuvchiga bog'langan: boshqa foydalanuvchi oldingisining amallarini ko'rmaydi, egasi qaytganda joyida", () => {
    enqueue("eski", "accept", newRequestBody({}));
    setQueueOwner("agent-a");
    expect(readQueue().map((item) => item.taskId)).toEqual(["eski"]);
    expect(localStorage.getItem(QUEUE_STORAGE_KEY)).toBeNull();
    enqueue("t1", "payments", newRequestBody({ method: "cash", amount: "50000" }));

    setQueueOwner("agent-b");
    expect(readQueue()).toEqual([]);
    enqueue("t9", "accept", newRequestBody({}));

    setQueueOwner("agent-a");
    expect(readQueue().map((item) => item.taskId)).toEqual(["eski", "t1"]);
    setQueueOwner("agent-b");
    expect(readQueue().map((item) => item.taskId)).toEqual(["t9"]);
  });

  it("amal so'rov kaliti va amal vaqti bilan qurilmada saqlanadi", () => {
    const body = newRequestBody({ reason: "no_answer" }, new Date("2026-09-13T08:00:00Z"));
    expect(body.occurredAt).toBe("2026-09-13T08:00:00.000Z");
    expect(body.clientRequestId.length).toBeGreaterThan(10);
    expect(newRequestBody({}).clientRequestId).not.toBe(body.clientRequestId);
    enqueue("t1", "fail", body);
    expect(readQueue()).toMatchObject([{ taskId: "t1", action: "fail", state: "pending", attempts: 0, body: { reason: "no_answer" } }]);
  });

  it("tartib bilan yuboradi; tarmoq xatosida to'xtaydi va qolganini saqlaydi", async () => {
    enqueue("t1", "accept", newRequestBody({}));
    enqueue("t1", "start", newRequestBody({}));
    enqueue("t2", "accept", newRequestBody({}));
    const sent: string[] = [];
    const result = await flushQueue(async (item) => {
      if (item.action === "start") throw new Error("offline");
      sent.push(`${item.taskId}:${item.action}`);
    }, network);
    expect(sent).toEqual(["t1:accept"]);
    expect(result).toEqual({ sent: 1, failed: 0, pending: 2 });
    expect(readQueue().map((item) => [item.action, item.attempts, item.state])).toEqual([
      ["start", 1, "pending"],
      ["accept", 0, "pending"],
    ]);
  });

  it("server rad etsa — amal belgilanadi, shu yetkazmaning keyingi amallari kutadi, boshqa yetkazmalar yuboriladi", async () => {
    enqueue("t1", "arrive", newRequestBody({}));
    enqueue("t1", "confirm", newRequestBody({}), { partial: true });
    enqueue("t2", "accept", newRequestBody({}));
    const sent: string[] = [];
    const result = await flushQueue(async (item) => {
      if (item.action === "arrive") throw new Error("geofence");
      sent.push(`${item.taskId}:${item.action}`);
    }, rejected("geofence"));
    expect(sent).toEqual(["t2:accept"]);
    expect(result).toEqual({ sent: 1, failed: 1, pending: 1 });
    const [arrive, confirm] = readQueue();
    expect(arrive).toMatchObject({ action: "arrive", state: "failed", error: { reason: "geofence", status: 403 } });
    expect(confirm).toMatchObject({ action: "confirm", state: "pending" });

    // Keyingi yuborishda ham bloklangan yetkazma o'tkazib yuboriladi
    const again = await flushQueue(async () => {
      throw new Error("yuborilmasligi kerak");
    }, network);
    expect(again).toEqual({ sent: 0, failed: 0, pending: 1 });

    retryAction(arrive!.id);
    expect(readQueue()[0]).toMatchObject({ state: "pending", error: null });
    discardAction(arrive!.id);
    expect(readQueue().map((item) => item.action)).toEqual(["confirm"]);
  });

  it("navbatdagi amallar ko'rinadigan holatni oldindan ko'rsatadi (rad etilgani hisobga olinmaydi)", () => {
    enqueue("t1", "arrive", newRequestBody({}));
    enqueue("t1", "delivering", newRequestBody({}));
    enqueue("t1", "confirm", newRequestBody({}), { partial: true });
    expect(projectedStatus("out_for_delivery", readQueue())).toBe("partially_delivered");
    expect(projectedStatus("assigned", [])).toBe("assigned");
    const failed = readQueue().map((item) => ({ ...item, state: "failed" as const }));
    expect(projectedStatus("out_for_delivery", failed)).toBe("out_for_delivery");
  });

  it("buzilgan saqlangan ma'lumot — bo'sh navbat", () => {
    localStorage.setItem(QUEUE_STORAGE_KEY, "{buzilgan");
    expect(readQueue()).toEqual([]);
  });
});
