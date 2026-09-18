/** Versiyalarni solishtirish: ilova qaysi holatda "yangilanish bor" deyishini shu belgilaydi. */
import { describe, expect, it } from "vitest";
import { compareVersions } from "./version.ts";

describe("compareVersions", () => {
  it("kattaroq versiya musbat qaytaradi", () => {
    expect(compareVersions("1.0.1", "1.0.0")).toBeGreaterThan(0);
    expect(compareVersions("1.1.0", "1.0.9")).toBeGreaterThan(0);
    expect(compareVersions("2.0.0", "1.9.9")).toBeGreaterThan(0);
  });

  it("kichikroq versiya manfiy qaytaradi — yangilanish taklif qilinadi", () => {
    expect(compareVersions("1.0.0", "1.0.1")).toBeLessThan(0);
    expect(compareVersions("1.0.9", "1.1.0")).toBeLessThan(0);
    expect(compareVersions("1.0", "1.0.1")).toBeLessThan(0);
  });

  it("bir xil versiyada 0", () => {
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
    expect(compareVersions("1.2.0", "1.2")).toBe(0);
  });

  it("noto'g'ri qism 0 deb olinadi (ilova xato qilmasin)", () => {
    expect(compareVersions("1.0.x", "1.0.0")).toBe(0);
    expect(compareVersions("", "0.0.1")).toBeLessThan(0);
  });
});
