import { afterEach, describe, expect, it, vi } from "vitest";
import { compareBuild, fetchServerBuild } from "./build-version.ts";

/**
 * Android ilovasi production saytini ochadi, lekin agent ilovani yopmaydi — shuning uchun WebView
 * eski JS bilan kunlab ishlab yurishi mumkin edi (brauzerda yangi ekran, telefonda eskisi).
 * Shu tekshiruv o'sha holatni ushlaydi.
 */
describe("build solishtirish", () => {
  it("bir xil belgi — yangilash kerak emas", () => {
    expect(compareBuild("A", "A")).toEqual({ status: "same" });
  });

  it("boshqa belgi — eskirgan", () => {
    expect(compareBuild("A", "B")).toEqual({ status: "stale", serverBuild: "B" });
  });

  it("internet yo'q yoki belgi topilmadi — hech narsa qilinmaydi", () => {
    // Bu muhim: tarmoq uzilganda agentga "yangilang" deb bezovta qilinmaydi
    expect(compareBuild("A", null)).toEqual({ status: "unknown" });
    expect(compareBuild(null, "B")).toEqual({ status: "unknown" });
  });
});

describe("serverdagi belgini olish", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("build.json dan o'qiydi va keshni chetlab o'tadi", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ build: "2026-09-24T12:00:00.000Z" }) });
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchServerBuild()).toBe("2026-09-24T12:00:00.000Z");
    expect(fetchMock).toHaveBeenCalledWith("/build.json", expect.objectContaining({ cache: "no-store" }));
  });

  it("javob xato, bo'sh yoki tarmoq uzilgan bo'lsa — null", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    expect(await fetchServerBuild()).toBeNull();

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ build: "" }) }));
    expect(await fetchServerBuild()).toBeNull();

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await fetchServerBuild()).toBeNull();
  });
});
