/** Marshrut tartibi: aniq yechim (kichik), evristika sifati (katta), assimetrik matritsa va boshlang'ich nuqta. */
import { describe, expect, it } from "vitest";
import { pathCost, solveOpenPath } from "../src/shared/route-optimizer.js";

/** Deterministik tasodifiy sonlar (mulberry32). */
function random(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const euclid = (points: [number, number][]) => points.map(([ax, ay]) => points.map(([bx, by]) => Math.hypot(ax - bx, ay - by)));

function bruteForce(matrix: number[][], start: number | null): number {
  const n = matrix.length;
  let best = Number.POSITIVE_INFINITY;
  const used = new Array<boolean>(n).fill(false);
  const order: number[] = [];
  const walk = () => {
    if (order.length === n) {
      best = Math.min(best, pathCost(matrix, order));
      return;
    }
    for (let i = 0; i < n; i++) {
      if (used[i] || (order.length === 0 && start !== null && i !== start)) continue;
      used[i] = true;
      order.push(i);
      walk();
      order.pop();
      used[i] = false;
    }
  };
  walk();
  return best;
}

const isPermutation = (order: number[], n: number) => order.length === n && new Set(order).size === n && order.every((i) => i >= 0 && i < n);

describe("Marshrut tartibi", () => {
  it("chiziqdagi nuqtalar aralash berilsa ham ketma-ket yuriladi; boshlang'ich joy birinchi", () => {
    const xs = [5, 1, 9, 3, 7, 0, 8, 2, 6, 4];
    const matrix = euclid(xs.map((x) => [x, 0]));
    const order = solveOpenPath(matrix, { start: xs.indexOf(0) });
    expect(order.map((i) => xs[i])).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(pathCost(matrix, order)).toBeCloseTo(9);
  });

  it("kichik to'plam (≤ 9) — aniq eng qisqa yo'l (to'liq sanab chiqish bilan bir xil), boshlanish erkin va belgilangan", () => {
    const next = random(7);
    for (let round = 0; round < 12; round++) {
      const n = 3 + (round % 7);
      const matrix = euclid(Array.from({ length: n }, () => [next() * 1000, next() * 1000] as [number, number]));
      for (const start of [null, 0]) {
        const order = solveOpenPath(matrix, { start });
        expect(isPermutation(order, n)).toBe(true);
        if (start !== null) expect(order[0]).toBe(start);
        expect(pathCost(matrix, order)).toBeCloseTo(bruteForce(matrix, start), 6);
      }
    }
  });

  it("assimetrik matritsa (bir tomonlama ko'chalar) — aniq yechim yo'nalishni hisobga oladi", () => {
    // 0→1→2→3 arzon, teskari yo'nalish qimmat
    const matrix = [
      [0, 1, 50, 50],
      [50, 0, 1, 50],
      [50, 50, 0, 1],
      [1, 50, 50, 0],
    ];
    expect(solveOpenPath(matrix, { start: 0 })).toEqual([0, 1, 2, 3]);
    expect(pathCost(matrix, solveOpenPath(matrix, { start: null }))).toBe(3);
  });

  it("katta to'plam (120 nuqta) — to'g'ri almashtirish, boshlanish joyida, tasodifiy tartibdan ancha qisqa va tez", () => {
    const next = random(42);
    const n = 120;
    const matrix = euclid(Array.from({ length: n }, () => [next() * 10_000, next() * 10_000] as [number, number]));
    const started = performance.now();
    const order = solveOpenPath(matrix, { start: 5 });
    const elapsed = performance.now() - started;
    expect(isPermutation(order, n)).toBe(true);
    expect(order[0]).toBe(5);
    const naive = pathCost(matrix, [5, ...Array.from({ length: n }, (_, i) => i).filter((i) => i !== 5)]);
    // Tekis tarqalgan nuqtalarda yaxshi yo'l ≈ 0.7·√(n·A); tasodifiy tartib ≈ n·0.52·√A
    expect(pathCost(matrix, order)).toBeLessThan(naive * 0.2);
    expect(elapsed).toBeLessThan(5000);
  });

  it("chegaraviy holatlar: 0 va 1 nuqta, noto'g'ri boshlanish", () => {
    expect(solveOpenPath([], { start: null })).toEqual([]);
    expect(solveOpenPath([[0]], { start: 0 })).toEqual([0]);
    expect(() => solveOpenPath(euclid([[0, 0], [1, 1], [2, 2]]), { start: 3 })).toThrow(RangeError);
  });
});
