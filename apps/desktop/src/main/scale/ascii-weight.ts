/**
 * Umumiy og'irlik satri: ko'p tarozilar RS-232/TCP orqali og'irlikni matn bilan yuboradi — "ST,GS,+  1.234kg",
 * "US,NT,  0,50 kg", "  1250 g". `ST` — barqaror, `US` yoki belgisiz — barqaror emas. Bu biror ishlab chiqaruvchining
 * maxsus protokoli emas: faqat satrdagi son va birlik ajratiladi.
 */
import type { WeightReading } from "../../shared/scale-types.js";

export function parseAsciiWeight(line: string): WeightReading | null {
  const text = line.trim();
  const match = /([-+])?\s*(\d{1,6}(?:[.,]\d{1,4})?)\s*(kg|g)(?![a-z])/i.exec(text);
  if (!match) return null;
  let grams = Math.round(Number(match[2]!.replace(",", ".")) * (match[3]!.toLowerCase() === "kg" ? 1000 : 1));
  if (match[1] === "-") grams = -grams;
  const stable = /(^|[^A-Z])ST([^A-Z]|$)/.test(text.toUpperCase());
  return { weight: (grams / 1000).toFixed(3), unit: "kg", stable, raw: text.slice(0, 80) };
}

const STX = String.fromCharCode(0x02);
const ETX = String.fromCharCode(0x03);

/** Oxirgi to'liq satrdagi og'irlik (yakunlanmagan oxirgi satr hisobga olinmaydi). Kadr belgilari STX/ETX ham satr chegarasi. */
export function lastReading(data: Buffer): WeightReading | null {
  const text = data.toString("latin1").split(STX).join("\n").split(ETX).join("\n");
  const lines = text.split(/[\r\n]+/);
  const complete = /[\r\n]$/.test(text) ? lines : lines.slice(0, -1);
  let last: WeightReading | null = null;
  for (const line of complete) last = parseAsciiWeight(line) ?? last;
  return last;
}

/** Sozlamadagi so'rov buyrug'i: `\r`, `\n`, `\t`, `\xNN` baytlarga aylantiriladi. */
export function decodeCommand(command: string): Buffer {
  const text = command
    .replace(/\\x([0-9a-f]{2})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\r/g, "\r")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t");
  return Buffer.from(text, "latin1");
}
