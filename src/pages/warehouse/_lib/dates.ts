/** Foydalanuvchining mahalliy bugungi sanasi "YYYY-MM-DD" — UTC emas (Toshkentda 00:00–05:00 oralig'ida farq qiladi). */
export function localIsoDate(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Tanlangan kun bugun bo'lmasa — shu kunning mahalliy tushi (ISO), bugun bo'lsa server vaqti ishlatiladi. */
export function occurredAtFor(date: string): string | undefined {
  return date && date !== localIsoDate() ? new Date(`${date}T12:00:00`).toISOString() : undefined;
}

/** Float xatosiz 4 kasr xonagacha: 2000 × 1.1 → 2200 (API 4 xonadan ortig'ini rad etadi). */
export function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
