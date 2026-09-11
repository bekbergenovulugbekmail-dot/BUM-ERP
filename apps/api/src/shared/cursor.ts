/**
 * Keyset sahifalash kursori — tartiblash kalitlarining qiymatlari, base64url JSON.
 * Mijoz uchun shaffof satr; buzilgan kursor 400.
 */
import { badRequest } from "@bum/shared";

export function encodeCursor(parts: string[]): string {
  return Buffer.from(JSON.stringify(parts)).toString("base64url");
}

export function decodeCursor(cursor: string, arity: number): string[] {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (Array.isArray(parsed) && parsed.length === arity && parsed.every((p) => typeof p === "string")) {
      return parsed as string[];
    }
  } catch {
    // quyida bir xil xato
  }
  throw badRequest("Kursor noto'g'ri");
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
