import { describe, expect, it } from "vitest";
import { agentNoticeOf, agentNoticeText, invalidationPrefixes, parseRealtimeMessage, realtimeUrl, reconnectDelay } from "./realtime.ts";

describe("dostavka real-time mijozi", () => {
  it("xabar turi bo'yicha yangilanadigan so'rovlar", () => {
    const task = invalidationPrefixes({ type: "task", taskId: "t1", status: "assigned", action: "ASSIGNED" });
    expect(task).toContain("/api/delivery/tasks");
    expect(task).toContain("/api/delivery/agent/tasks");
    expect(task).toContain("/api/delivery/dashboard");
    expect(invalidationPrefixes({ type: "location", deliveryAgentId: "a1" })).toEqual(["/api/delivery/agents/live"]);
    expect(invalidationPrefixes({ type: "session", deliveryAgentId: "a1" })).toContain("/api/delivery/agent/work-session");
    expect(invalidationPrefixes({ type: "policy" })).toEqual(["/api/delivery/policy"]);
    expect(invalidationPrefixes({ type: "ready", manager: true, agent: false })).toEqual(["/api/delivery"]);
    expect(invalidationPrefixes({ type: "pong" })).toEqual([]);
  });

  it("qayta ulanish kutishi 1 s dan 30 s gacha o'sadi, yarmi tasodifiy", () => {
    expect(reconnectDelay(0, () => 0)).toBe(500);
    expect(reconnectDelay(0, () => 1)).toBe(1000);
    expect(reconnectDelay(3, () => 1)).toBe(8000);
    expect(reconnectDelay(10, () => 1)).toBe(30_000);
    expect(reconnectDelay(10, () => 0)).toBe(15_000);
  });

  it("manzil: shu domen, http → ws", () => {
    expect(realtimeUrl()).toBe(`ws://${window.location.host}/api/delivery/ws`);
  });

  it("yetkazuvchi bildirishnomasi: faqat biriktirish, bekor qilish va o'zgarish; bir paket — bitta matn", () => {
    const task = (action: string) => ({ type: "task" as const, taskId: "t1", status: null, action });
    expect(agentNoticeOf(task("ASSIGNED"))).toBe("assigned");
    expect(agentNoticeOf(task("CANCELLED"))).toBe("cancelled");
    expect(agentNoticeOf(task("REASSIGNED"))).toBe("changed");
    expect(agentNoticeOf(task("RESCHEDULED"))).toBe("changed");
    expect(agentNoticeOf(task("ROUTE_ORDER"))).toBeNull();
    expect(agentNoticeOf(task("ARRIVED"))).toBeNull();
    expect(agentNoticeOf({ type: "location", deliveryAgentId: "a1" })).toBeNull();

    expect(agentNoticeText({ assigned: 3, changed: 1, cancelled: 1 })?.body).toBe("Sizga 3 ta yangi yetkazma biriktirildi");
    expect(agentNoticeText({ assigned: 0, changed: 2, cancelled: 1 })?.title).toBe("Yetkazma bekor qilindi");
    expect(agentNoticeText({ assigned: 0, changed: 1, cancelled: 0 })?.title).toBe("Yetkazmalar o'zgardi");
    expect(agentNoticeText({ assigned: 0, changed: 0, cancelled: 0 })).toBeNull();
  });

  it("buzilgan xabar e'tiborsiz qoladi", () => {
    expect(parseRealtimeMessage("{oops")).toBeNull();
    expect(parseRealtimeMessage("42")).toBeNull();
    expect(parseRealtimeMessage('{"type":"agents"}')).toEqual({ type: "agents" });
  });
});
