import { describe, expect, it } from "vitest";
import {
  alignRects, clampDelta, copiesPerPage, distributeRects, reorderLayers, resizeRect, snapMove, type Rect,
} from "./canvas-geometry.ts";

const page = { width: 210, height: 297 };
const logo: Rect = { x: 20, y: 20, w: 40, h: 20 };

describe("o'lcham o'zgartirish (burchak/qirra)", () => {
  it("pastki o'ng burchakdan tortish — eni va bo'yi o'sadi, chap-tepa joyida", () => {
    expect(resizeRect(logo, "se", 10, 6, { page })).toEqual({ x: 20, y: 20, w: 50, h: 26 });
  });

  it("nisbat qulfi — rasm cho'zilmaydi", () => {
    const result = resizeRect(logo, "se", 20, 2, { page, lockRatio: true });
    expect(result.w / result.h).toBeCloseTo(2, 5);
    expect(result).toMatchObject({ x: 20, y: 20, w: 60, h: 30 });
  });

  it("yuqori chap burchakdan kichraytirish — pastki o'ng burchak joyida", () => {
    const result = resizeRect(logo, "nw", 10, 5, { page });
    expect(result).toEqual({ x: 30, y: 25, w: 30, h: 15 });
    expect(result.x + result.w).toBe(60);
    expect(result.y + result.h).toBe(40);
  });

  it("qirradan tortish faqat bitta o'qni o'zgartiradi", () => {
    expect(resizeRect(logo, "e", 15, 99, { page })).toEqual({ x: 20, y: 20, w: 55, h: 20 });
    expect(resizeRect(logo, "n", 99, -5, { page })).toEqual({ x: 20, y: 15, w: 40, h: 25 });
  });

  it("minimal o'lchamdan kichraymaydi, teskari aylanmaydi", () => {
    expect(resizeRect(logo, "se", -100, -100, { page, min: { w: 2, h: 2 } })).toEqual({ x: 20, y: 20, w: 2, h: 2 });
  });

  it("sahifadan chiqib ketmaydi", () => {
    expect(resizeRect(logo, "se", 500, 500, { page })).toEqual({ x: 20, y: 20, w: 190, h: 277 });
    const locked = resizeRect(logo, "se", 500, 500, { page, lockRatio: true });
    expect(locked.x + locked.w).toBeLessThanOrEqual(210);
    expect(locked.w / locked.h).toBeCloseTo(2, 5);
  });

  it("katakka yopishish — harakatlanayotgan qirra 5 mm ga", () => {
    expect(resizeRect(logo, "e", 12, 0, { page, grid: 5 })).toEqual({ x: 20, y: 20, w: 50, h: 20 });
  });
});

describe("surish va yopishish", () => {
  it("sahifa chegarasidan chiqarilmaydi", () => {
    expect(clampDelta(logo, -50, 400, page)).toEqual({ dx: -20, dy: 257 });
  });

  it("katakka yopishadi (5 mm)", () => {
    expect(snapMove(logo, 12.4, 3.1, { x: [], y: [] }, { threshold: 1, grid: 5 })).toMatchObject({ dx: 10, dy: 5 });
  });

  it("yaqin element qirrasiga yopishadi va yo'l-yo'riq chizig'i beradi", () => {
    // Chap qirra 20 + 49.2 = 69.2 → 70 dagi nishonga yopishadi
    const result = snapMove(logo, 49.2, 0, { x: [70], y: [] }, { threshold: 1.5, grid: 0 });
    expect(result.dx).toBeCloseTo(50, 5);
    expect(result.guides).toEqual([{ axis: "x", at: 70 }]);
  });

  it("yopishish o'chiq — erkin joylashadi", () => {
    expect(snapMove(logo, 12.37, 3.11, { x: [], y: [] }, { threshold: 0, grid: 0 })).toMatchObject({ dx: 12.37, dy: 3.11 });
  });
});

describe("tekislash, taqsimlash, qatlam", () => {
  const rects: Rect[] = [
    { x: 10, y: 10, w: 20, h: 10 },
    { x: 50, y: 30, w: 10, h: 10 },
    { x: 100, y: 60, w: 30, h: 20 },
  ];

  it("chapga, o'ngga, markazga", () => {
    expect(alignRects(rects, "left", page).map((rect) => rect.x)).toEqual([10, 10, 10]);
    expect(alignRects(rects, "right", page).map((rect) => rect.x + rect.w)).toEqual([130, 130, 130]);
    expect(alignRects(rects, "center", page).map((rect) => rect.x + rect.w / 2)).toEqual([70, 70, 70]);
    expect(alignRects(rects, "bottom", page).map((rect) => rect.y + rect.h)).toEqual([80, 80, 80]);
  });

  it("bitta element sahifaga nisbatan tekislanadi", () => {
    expect(alignRects([{ x: 0, y: 0, w: 50, h: 10 }], "center", page)[0]!.x).toBe(80);
  });

  it("oradagi bo'shliqlar tenglashadi", () => {
    const result = distributeRects(rects, "horizontal");
    const gap1 = result[1]!.x - (result[0]!.x + result[0]!.w);
    const gap2 = result[2]!.x - (result[1]!.x + result[1]!.w);
    expect(gap1).toBeCloseTo(gap2, 5);
    expect(result[0]!.x).toBe(10);
    expect(result[2]!.x).toBe(100);
  });

  it("oldinga / orqaga / eng yuqoriga / eng pastga", () => {
    const order = ["logo", "rect", "text", "qr"];
    expect(reorderLayers(order, ["rect"], "front")).toEqual(["logo", "text", "qr", "rect"]);
    expect(reorderLayers(order, ["text"], "back")).toEqual(["text", "logo", "rect", "qr"]);
    expect(reorderLayers(order, ["rect"], "forward")).toEqual(["logo", "text", "rect", "qr"]);
    expect(reorderLayers(order, ["rect"], "backward")).toEqual(["rect", "logo", "text", "qr"]);
  });
});

describe("bitta A4 ga nechta hujjat", () => {
  it("120 mm lik nakladnoy — ikkita", () => {
    expect(copiesPerPage(14, 134, 283)).toBe(2);
  });
  it("200 mm lik — bitta", () => {
    expect(copiesPerPage(14, 214, 283)).toBe(1);
  });
});
