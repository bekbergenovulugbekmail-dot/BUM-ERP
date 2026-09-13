/**
 * Marshrut tartibini optimallashtirish (ochiq yo'l — oxirgi nuqtadan qaytilmaydi): nuqtalar orasidagi masofa matritsasi
 * bo'yicha jami yo'lni eng qisqa qiladigan tartib. Matritsa assimetrik bo'lishi mumkin (bir tomonlama ko'chalar).
 *  - 12 nuqtagacha — aniq yechim (Held–Karp dinamik dasturlash)
 *  - ko'prog'i — eng yaqin qo'shni (bir necha boshlang'ich bilan) + 2-opt + Or-opt yaxshilash
 * Tashqi xizmatsiz, deterministik (bir xil kirishga bir xil natija).
 */

export type DistanceMatrix = readonly (readonly number[])[];

const EXACT_LIMIT = 12;
const MAX_STARTS = 12;
const MAX_PASSES = 50;
const EPSILON = 1e-7;

/** Tartib bo'yicha jami masofa. */
export function pathCost(matrix: DistanceMatrix, order: readonly number[]): number {
  let cost = 0;
  for (let i = 1; i < order.length; i++) cost += matrix[order[i - 1]!]![order[i]!]!;
  return cost;
}

/** Aniq yechim: `start` berilsa — o'sha nuqtadan boshlanadi, aks holda eng yaxshi boshlanish ham tanlanadi. */
function exactOpenPath(matrix: DistanceMatrix, start: number | null): number[] {
  const n = matrix.length;
  const full = (1 << n) - 1;
  const dp = new Float64Array((1 << n) * n).fill(Number.POSITIVE_INFINITY);
  const parent = new Int8Array((1 << n) * n).fill(-1);
  for (let j = 0; j < n; j++) if (start === null || j === start) dp[(1 << j) * n + j] = 0;

  for (let mask = 1; mask <= full; mask++) {
    for (let last = 0; last < n; last++) {
      if (!(mask & (1 << last))) continue;
      const base = dp[mask * n + last]!;
      if (base === Number.POSITIVE_INFINITY) continue;
      for (let next = 0; next < n; next++) {
        if (mask & (1 << next)) continue;
        const nextMask = mask | (1 << next);
        const cost = base + matrix[last]![next]!;
        if (cost < dp[nextMask * n + next]! - EPSILON) {
          dp[nextMask * n + next] = cost;
          parent[nextMask * n + next] = last;
        }
      }
    }
  }

  let last = 0;
  for (let j = 1; j < n; j++) if (dp[full * n + j]! < dp[full * n + last]! - EPSILON) last = j;
  const order: number[] = [];
  let mask = full;
  while (last !== -1) {
    order.push(last);
    const previous = parent[mask * n + last]!;
    mask &= ~(1 << last);
    last = previous;
  }
  return order.reverse();
}

function nearestNeighbor(matrix: DistanceMatrix, start: number): number[] {
  const n = matrix.length;
  const visited = new Uint8Array(n);
  const order = [start];
  visited[start] = 1;
  for (let step = 1; step < n; step++) {
    const from = order[order.length - 1]!;
    let best = -1;
    for (let j = 0; j < n; j++) {
      if (!visited[j] && (best === -1 || matrix[from]![j]! < matrix[from]![best]! - EPSILON)) best = j;
    }
    visited[best] = 1;
    order.push(best);
  }
  return order;
}

/**
 * 2-opt (segmentni teskari aylantirish) va Or-opt (1–3 nuqtali segmentni boshqa joyga ko'chirish) — yaxshilanish
 * qolmaguncha. `fixedFirst` — birinchi nuqta (boshlang'ich joy) o'rnida qoladi.
 */
function improve(matrix: DistanceMatrix, initial: number[], fixedFirst: boolean): number[] {
  const route = [...initial];
  const n = route.length;
  const from = fixedFirst ? 1 : 0;
  const edge = (a: number | undefined, b: number | undefined) => (a === undefined || b === undefined ? 0 : matrix[a]![b]!);

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let improved = false;

    // 2-opt: [i..k] teskari. Assimetrik matritsa uchun segment ichidagi yo'nalish ham hisoblanadi (prefiks yig'indilar)
    const forward = new Float64Array(n);
    const backward = new Float64Array(n);
    for (let i = 1; i < n; i++) {
      forward[i] = forward[i - 1]! + matrix[route[i - 1]!]![route[i]!]!;
      backward[i] = backward[i - 1]! + matrix[route[i]!]![route[i - 1]!]!;
    }
    let bestDelta = -EPSILON;
    let bestMove: [number, number] | null = null;
    for (let i = from; i < n - 1; i++) {
      for (let k = i + 1; k < n; k++) {
        const before = route[i - 1];
        const after = route[k + 1];
        const removed = edge(before, route[i]) + (forward[k]! - forward[i]!) + edge(route[k], after);
        const added = edge(before, route[k]) + (backward[k]! - backward[i]!) + edge(route[i], after);
        const delta = added - removed;
        if (delta < bestDelta) {
          bestDelta = delta;
          bestMove = [i, k];
        }
      }
    }
    if (bestMove) {
      const [i, k] = bestMove;
      const reversed = route.slice(i, k + 1).reverse();
      route.splice(i, k - i + 1, ...reversed);
      improved = true;
    }

    // Or-opt: segment [i..i+len-1] ni j pozitsiyaga ko'chirish (yo'nalish saqlanadi)
    outer: for (let len = 1; len <= 3; len++) {
      for (let i = from; i + len <= n; i++) {
        const head = route[i]!;
        const tail = route[i + len - 1]!;
        const before = route[i - 1];
        const after = route[i + len];
        const removeGain = edge(before, head) + edge(tail, after) - edge(before, after);
        const rest = [...route.slice(0, i), ...route.slice(i + len)];
        for (let j = from; j <= rest.length; j++) {
          if (j === i) continue;
          const p = rest[j - 1];
          const q = rest[j];
          const insertCost = edge(p, head) + edge(tail, q) - edge(p, q);
          if (insertCost - removeGain < -EPSILON) {
            rest.splice(j, 0, ...route.slice(i, i + len));
            route.splice(0, n, ...rest);
            improved = true;
            break outer;
          }
        }
      }
    }

    if (!improved) break;
  }
  return route;
}

/**
 * Eng qisqa ochiq yo'l tartibi (matritsa indekslari). `start` — boshlang'ich nuqta indeksi (masalan, yetkazuvchining
 * joriy joyi) yoki `null` — boshlanish ham erkin.
 */
export function solveOpenPath(matrix: DistanceMatrix, options: { start: number | null }): number[] {
  const n = matrix.length;
  if (n === 0) return [];
  if (n === 1) return [0];
  if (options.start !== null && (options.start < 0 || options.start >= n)) throw new RangeError("start matritsa chegarasidan tashqarida");
  if (n <= EXACT_LIMIT) return exactOpenPath(matrix, options.start);

  const starts =
    options.start !== null
      ? [options.start]
      : Array.from({ length: Math.min(n, MAX_STARTS) }, (_, i) => Math.floor((i * n) / Math.min(n, MAX_STARTS)));
  let best: number[] = [];
  let bestCost = Number.POSITIVE_INFINITY;
  for (const start of starts) {
    const route = improve(matrix, nearestNeighbor(matrix, start), options.start !== null);
    const cost = pathCost(matrix, route);
    if (cost < bestCost - EPSILON) {
      best = route;
      bestCost = cost;
    }
  }
  return best;
}
