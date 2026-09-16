/**
 * Kassa mahsulot kartasi uchun sof yordamchilar (komponentsiz fayl — Fast Refresh buzilmasin).
 * Desktop kassadagi (`apps/desktop/src/renderer/pos/product-grid.tsx`) qoidalar bilan bir xil.
 */

/** Rasm yo'q bo'lsa — nomning bosh harflari ("Non (tandir)" → "NT"; qavs va belgilar hisobga olinmaydi). */
export function productInitials(name: string): string {
  const letters = name
    .split(/\s+/)
    .map((word) => /[\p{L}\p{N}]/u.exec(word)?.[0])
    .filter((letter): letter is string => Boolean(letter))
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return letters || "?";
}

/** Qoldiq holati: tugagan (≤ 0), kam (minimal qoldiqqa yetgan), bor. Rang bilan birga matn — faqat rangga tayanilmaydi. */
export function stockState(stock: number, minStock: number): "out" | "low" | "ok" {
  if (stock <= 0) return "out";
  return minStock > 0 && stock <= minStock ? "low" : "ok";
}
