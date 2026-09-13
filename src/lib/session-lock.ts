/**
 * Ekran qulfi (LOCK ≠ LOGOUT). Sessiya serverda saqlanadi, `POST /api/auth/lock` uni qulflaydi; ochish —
 * faqat shu sessiyada PIN bilan (`POST /api/auth/unlock`). Chiqishdan keyin yoki yangi qurilmada PIN ishlamaydi.
 */
import type { QueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api.ts";
import { AUTH_ME_KEY } from "@/lib/query.ts";

export const PIN_REGEX = /^\d{4,8}$/;

/** PIN o'rnatilmagan bo'lsa qulflanmaydi (ochib bo'lmay qolardi) — avval PIN so'raladi. */
export async function requestLock(queryClient: QueryClient): Promise<"locked" | "needs_pin"> {
  const security = await api.get<{ hasPIN: boolean }>("/api/auth/security");
  if (!security.hasPIN) return "needs_pin";
  await api.post("/api/auth/lock");
  await queryClient.invalidateQueries({ queryKey: AUTH_ME_KEY });
  return "locked";
}

/** Server `reason` kodi → foydalanuvchi matni (`WRONG_PIN:4`, `PIN_LOCKED:300`, `PIN_NOT_SET`). */
export function pinFailureText(reason: string): string {
  const [code, value] = reason.split(":");
  if (code === "WRONG_PIN") return `PIN noto'g'ri. Yana ${value} ta urinish qoldi.`;
  if (code === "PIN_LOCKED") return `Juda ko'p noto'g'ri urinish. PIN ${Math.max(1, Math.ceil(Number(value) / 60) || 5)} daqiqaga bloklandi.`;
  if (code === "PIN_NOT_SET") return "PIN o'rnatilmagan. Chiqib, parol bilan qayta kiring.";
  return "Qulfni ochib bo'lmadi";
}
