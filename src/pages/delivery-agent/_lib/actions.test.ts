import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, api } from "@/lib/api.ts";
import { classifyQueueError, performAction } from "./actions.ts";
import { newRequestBody, readQueue } from "./offline-queue.ts";

describe("agent amali: onlayn yoki navbat", () => {
  beforeEach(() => localStorage.clear());

  it("onlayn — serverga yuboriladi, navbatga tushmaydi", async () => {
    const post = vi.spyOn(api, "post").mockResolvedValue({ task: { id: "t1" } });
    const body = newRequestBody({});
    const outcome = await performAction("t1", "accept", body, { offlineAllowed: true });
    expect(outcome).toEqual({ queued: false, data: { task: { id: "t1" } } });
    expect(post).toHaveBeenCalledWith("/api/delivery/agent/tasks/t1/accept", body);
    expect(readQueue()).toEqual([]);
  });

  it("tarmoq xatosi va siyosat ruxsat bersa — navbatga (so'rov kaliti o'sha)", async () => {
    vi.spyOn(api, "post").mockRejectedValue(new ApiError(0, "NETWORK", ""));
    const body = newRequestBody({ reason: "no_answer" });
    const outcome = await performAction("t1", "fail", body, { offlineAllowed: true });
    expect(outcome).toEqual({ queued: true });
    expect(readQueue()).toMatchObject([{ taskId: "t1", action: "fail", body: { clientRequestId: body.clientRequestId } }]);
  });

  it("siyosat oflaynni taqiqlasa — tarmoq xatosi qaytadi, navbat bo'sh", async () => {
    vi.spyOn(api, "post").mockRejectedValue(new ApiError(0, "NETWORK", ""));
    await expect(performAction("t1", "accept", newRequestBody({}), { offlineAllowed: false })).rejects.toMatchObject({ code: "NETWORK" });
    expect(readQueue()).toEqual([]);
  });

  it("server rad etsa (geofence) — navbatga tushmaydi, xato ko'rsatiladi", async () => {
    vi.spyOn(api, "post").mockRejectedValue(new ApiError(403, "FORBIDDEN", "Mijoz manziliga yaqinlashing", { reason: "geofence" }));
    await expect(performAction("t1", "arrive", newRequestBody({}), { offlineAllowed: true })).rejects.toMatchObject({ status: 403 });
    expect(readQueue()).toEqual([]);
  });

  it("yetkazmaning oldingi amali navbatda bo'lsa — keyingisi ham navbatga (tartib buzilmaydi)", async () => {
    const post = vi.spyOn(api, "post").mockRejectedValueOnce(new ApiError(0, "NETWORK", ""));
    await performAction("t1", "arrive", newRequestBody({}), { offlineAllowed: true });
    const outcome = await performAction("t1", "confirm", newRequestBody({}), { offlineAllowed: true, meta: { partial: false } });
    expect(outcome).toEqual({ queued: true });
    expect(post).toHaveBeenCalledTimes(1);
    expect(readQueue().map((item) => item.action)).toEqual(["arrive", "confirm"]);
  });

  it("navbat xatosi turi: tarmoq, 5xx, 429 va 401 — keyin qayta; 4xx — rad (sabab bilan)", () => {
    expect(classifyQueueError(new ApiError(0, "NETWORK", "")).network).toBe(true);
    expect(classifyQueueError(new ApiError(502, "INTERNAL", "")).network).toBe(true);
    expect(classifyQueueError(new ApiError(429, "RATE_LIMITED", "")).network).toBe(true);
    expect(classifyQueueError(new ApiError(401, "UNAUTHENTICATED", "")).network).toBe(true);
    const rejected = classifyQueueError(new ApiError(400, "BAD_REQUEST", "eski", { reason: "offline_too_old" }));
    expect(rejected).toEqual({
      network: false,
      error: { status: 400, code: "BAD_REQUEST", message: "eski", reason: "offline_too_old", details: { reason: "offline_too_old" } },
    });
  });
});
