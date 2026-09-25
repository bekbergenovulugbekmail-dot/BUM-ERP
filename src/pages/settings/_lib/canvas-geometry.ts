/**
 * Vizual dizayner geometriyasi — SOF funksiyalar (DOM yo'q, test qilinadi).
 *
 * Hamma qiymat MILLIMETRDA. Ekran pikseli faqat chizishda (`pxPerMm`) paydo bo'ladi, shuning
 * uchun zoom, ekran o'lchami yoki qurilma elementning joyini o'zgartirmaydi: 100% da 25 mm
 * bo'lgan joy 200% da ham 25 mm, PDF da ham 25 mm.
 */

export type Rect = { x: number; y: number; w: number; h: number };
export type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
export const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

/** CSS piksel / mm (96 dpi). */
export const PX_PER_MM = 96 / 25.4;
export const ZOOM_LEVELS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2] as const;
export const GRID_SIZES = [1, 2, 5, 10] as const;

/** 0.1 mm gacha yaxlitlash — shablonda "25.000000001" kabi qiymat qolmasin. */
export const round = (value: number) => Math.round(value * 10) / 10;

export const snapTo = (value: number, step: number) => (step > 0 ? Math.round(value / step) * step : value);

export function boundsOf(rects: Rect[]): Rect {
  const left = Math.min(...rects.map((rect) => rect.x));
  const top = Math.min(...rects.map((rect) => rect.y));
  const right = Math.max(...rects.map((rect) => rect.x + rect.w));
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.h));
  return { x: left, y: top, w: right - left, h: bottom - top };
}

/** Ikki quti kesishadimi (sichqoncha bilan to'rtburchak chizib tanlash uchun). */
export const intersects = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Guruhni sahifa ichida saqlagan holda siljish miqdorini cheklaydi. */
export function clampDelta(group: Rect, dx: number, dy: number, page: { width: number; height: number }): { dx: number; dy: number } {
  return {
    dx: Math.min(Math.max(dx, -group.x), page.width - group.x - group.w),
    dy: Math.min(Math.max(dy, -group.y), page.height - group.y - group.h),
  };
}

/** Yopishish chizig'i — sichqoncha bilan surilganda ko'rsatiladi. */
export type Guide = { axis: "x" | "y"; at: number };

/**
 * "Aqlli" yopishish: guruhning chap/o'rta/o'ng (va tepa/o'rta/past) chizig'i yaqin
 * nishonga (sahifa o'rtasi, chekka, boshqa element qirrasi) `threshold` mm dan yaqin bo'lsa
 * — o'sha joyga yopishadi. Topilmasa `grid` qadamiga yopishadi (0 — yopishmaydi).
 */
export function snapMove(
  group: Rect,
  dx: number,
  dy: number,
  targets: { x: number[]; y: number[] },
  options: { threshold: number; grid: number },
): { dx: number; dy: number; guides: Guide[] } {
  const guides: Guide[] = [];
  const axis = (start: number, size: number, delta: number, lines: number[], name: "x" | "y") => {
    const moved = start + delta;
    let best: { diff: number; line: number } | null = null;
    for (const edge of [moved, moved + size / 2, moved + size]) {
      for (const line of lines) {
        const diff = line - edge;
        if (Math.abs(diff) <= options.threshold && (!best || Math.abs(diff) < Math.abs(best.diff))) best = { diff, line };
      }
    }
    if (best) {
      guides.push({ axis: name, at: best.line });
      return delta + best.diff;
    }
    return options.grid > 0 ? snapTo(moved, options.grid) - start : delta;
  };
  return { dx: axis(group.x, group.w, dx, targets.x, "x"), dy: axis(group.y, group.h, dy, targets.y, "y"), guides };
}

/**
 * Burchak/qirradan tortib o'lcham o'zgartirish.
 *
 * - qarama-qarshi burchak/qirra JOYIDA qoladi;
 * - `lockRatio` — nisbat saqlanadi (burchakdan tortganda ko'proq o'zgargan o'q hal qiladi);
 * - `grid` — harakatlanayotgan qirra katakka yopishadi;
 * - sahifadan chiqib ketmaydi va `min` dan kichraymaydi.
 */
export function resizeRect(
  start: Rect,
  handle: Handle,
  dx: number,
  dy: number,
  options: { lockRatio?: boolean; min?: { w: number; h: number }; page: { width: number; height: number }; grid?: number },
): Rect {
  const min = options.min ?? { w: 2, h: 2 };
  const grid = options.grid ?? 0;
  const west = handle.includes("w");
  const east = handle.includes("e");
  const north = handle.startsWith("n");
  const south = handle.startsWith("s");
  const right = start.x + start.w;
  const bottom = start.y + start.h;

  let left = start.x;
  let top = start.y;
  let newRight = right;
  let newBottom = bottom;
  if (west) left = Math.min(Math.max(0, snapTo(start.x + dx, grid)), right - min.w);
  if (east) newRight = Math.max(Math.min(options.page.width, snapTo(right + dx, grid)), start.x + min.w);
  if (north) top = Math.min(Math.max(0, snapTo(start.y + dy, grid)), bottom - min.h);
  if (south) newBottom = Math.max(Math.min(options.page.height, snapTo(bottom + dy, grid)), start.y + min.h);

  let w = newRight - left;
  let h = newBottom - top;

  if (options.lockRatio && start.w > 0 && start.h > 0) {
    const ratio = start.w / start.h;
    const horizontal = west || east;
    const vertical = north || south;
    let scale: number;
    if (horizontal && vertical) scale = Math.max(w / start.w, h / start.h);
    else if (horizontal) scale = w / start.w;
    else scale = h / start.h;
    // Minimal o'lcham va sahifa chegarasi — nisbatni buzmasdan
    scale = Math.max(scale, min.w / start.w, min.h / start.h);
    const maxW = east ? options.page.width - start.x : west ? right : options.page.width;
    const maxH = south ? options.page.height - start.y : north ? bottom : options.page.height;
    scale = Math.min(scale, maxW / start.w, maxH / start.h);
    w = start.w * scale;
    h = w / ratio;
    // Qarama-qarshi tomon joyida; bitta qirradan tortilganda ikkinchi o'q markazdan o'sadi
    left = west ? right - w : horizontal ? start.x : start.x + (start.w - w) / 2;
    top = north ? bottom - h : vertical ? start.y : start.y + (start.h - h) / 2;
  }

  return { x: round(left), y: round(top), w: round(w), h: round(h) };
}

export type AlignMode = "left" | "center" | "right" | "top" | "middle" | "bottom";

/**
 * Tekislash: bir nechta element — o'zaro (tanlov chegarasiga), bitta element — sahifaga.
 * Qaytadi: har qutining yangi joyi (o'lcham o'zgarmaydi).
 */
export function alignRects(rects: Rect[], mode: AlignMode, page: { width: number; height: number }): Rect[] {
  const frame = rects.length > 1 ? boundsOf(rects) : { x: 0, y: 0, w: page.width, h: page.height };
  return rects.map((rect) => {
    switch (mode) {
      case "left": return { ...rect, x: round(frame.x) };
      case "center": return { ...rect, x: round(frame.x + (frame.w - rect.w) / 2) };
      case "right": return { ...rect, x: round(frame.x + frame.w - rect.w) };
      case "top": return { ...rect, y: round(frame.y) };
      case "middle": return { ...rect, y: round(frame.y + (frame.h - rect.h) / 2) };
      default: return { ...rect, y: round(frame.y + frame.h - rect.h) };
    }
  });
}

/**
 * Teng taqsimlash: chetdagi ikki element joyida, oradagilar orasidagi BO'SHLIQ tenglashadi.
 * Kamida 3 ta element kerak. Qaytadi: kirishdagi tartibda.
 */
export function distributeRects(rects: Rect[], axis: "horizontal" | "vertical"): Rect[] {
  if (rects.length < 3) return rects;
  const key = axis === "horizontal" ? "x" : "y";
  const size = axis === "horizontal" ? "w" : "h";
  const order = rects.map((rect, index) => ({ rect, index })).sort((a, b) => a.rect[key] - b.rect[key]);
  const first = order[0]!.rect;
  const last = order[order.length - 1]!.rect;
  const span = last[key] + last[size] - first[key];
  const occupied = order.reduce((sum, item) => sum + item.rect[size], 0);
  const gap = (span - occupied) / (order.length - 1);
  const result = [...rects];
  let cursor = first[key];
  for (const item of order) {
    result[item.index] = { ...item.rect, [key]: round(cursor) };
    cursor += item.rect[size] + gap;
  }
  return result;
}

export type LayerOp = "front" | "back" | "forward" | "backward";

/**
 * Qatlam tartibi. Kirish — pastdan yuqoriga tartiblangan id lar; natija — yangi tartib.
 * Keyin har elementga `zIndex = o'rni` beriladi (0..n-1), ya'ni qiymatlar ixcham qoladi.
 */
export function reorderLayers(order: string[], selected: string[], op: LayerOp): string[] {
  const chosen = new Set(selected);
  if (op === "front") return [...order.filter((id) => !chosen.has(id)), ...order.filter((id) => chosen.has(id))];
  if (op === "back") return [...order.filter((id) => chosen.has(id)), ...order.filter((id) => !chosen.has(id))];
  const next = [...order];
  if (op === "forward") {
    for (let index = next.length - 2; index >= 0; index -= 1) {
      if (chosen.has(next[index]!) && !chosen.has(next[index + 1]!)) [next[index], next[index + 1]] = [next[index + 1]!, next[index]!];
    }
  } else {
    for (let index = 1; index < next.length; index += 1) {
      if (chosen.has(next[index]!) && !chosen.has(next[index - 1]!)) [next[index], next[index - 1]] = [next[index - 1]!, next[index]!];
    }
  }
  return next;
}

/** Nechta hujjat bitta sahifaga sig'adi (bir nechta nakladnoyni bitta A4 ga chiqarishda). */
export function copiesPerPage(top: number, bottom: number, pageBottom: number, separator = 10): number {
  const height = bottom - top;
  if (height <= 0) return 1;
  return Math.max(1, 1 + Math.floor((pageBottom - top - height) / (height + separator)));
}
