/**
 * Ishonchli qurilmalar: login va parolni bilgan begona odam kira olmasligi uchun ikkinchi to'siq.
 *
 * Qoida:
 *  - foydalanuvchining BIRINCHI qurilmasi avtomatik ishonchli (hisob ochilganda kimdir kirishi kerak);
 *  - keyingi har bir yangi qurilma "tasdiq kutilmoqda" bo'lib yoziladi va kirish BERILMAYDI;
 *  - biznes egasi (`users.manage`) uni Sozlamalar → Qurilmalar bo'limida tasdiqlaydi;
 *  - bekor qilingan qurilma qayta kirmoqchi bo'lsa — yana tasdiq so'raladi.
 *
 * `deviceId` sir emas: u faqat "bu qaysi qurilma" degan savolga javob beradi. Kirish huquqini
 * qurilmaning TASDIQLANGANI beradi, shuning uchun uni o'g'irlash kirish imkonini bermaydi —
 * tasdiqlanmagan yangi identifikator har doim egadan so'raydi.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { AppError } from "@bum/shared";
import { userDevices } from "../../db/schema/platform.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";

export type DeviceContext = {
  /** Mijoz yuborgan qurilma identifikatori (`x-device-id`); yo'q bo'lsa — eski mijoz. */
  deviceId: string | null;
  userAgent: string | null;
  ipAddress: string | null;
};

/** Qurilma nomini User-Agent'dan taxmin qiladi — egasi keyin o'zgartiradi. */
export function guessDeviceName(userAgent: string | null): string {
  const ua = userAgent ?? "";
  if (/BUM POS KASSA|Electron/i.test(ua)) return "Kassa kompyuteri";
  if (/Android/i.test(ua)) return "Android telefon";
  if (/iPhone|iPad|iOS/i.test(ua)) return "iPhone/iPad";
  if (/Windows/i.test(ua)) return "Windows kompyuter";
  if (/Macintosh|Mac OS/i.test(ua)) return "Mac";
  if (/Linux/i.test(ua)) return "Linux kompyuter";
  return "Noma'lum qurilma";
}

/**
 * Qurilmani ro'yxatga oladi va kirishga ruxsat bor-yo'qligini QAYTARADI (xato tashlamaydi).
 *
 * Xato shu yerda tashlanmasligi muhim: tasdiq kutayotgan qurilma yozuvi saqlanib qolishi kerak,
 * aks holda tranzaksiya orqaga qaytib, egasi ro'yxatda hech narsa ko'rmaydi.
 *
 * `deviceId` yuborilmagan bo'lsa (eski mijoz) — tekshiruv o'tkazib yuboriladi, aks holda
 * yangilanmagan kassa va telefonlar birdan kira olmay qolardi.
 */
export async function registerDevice(tx: Tx, userId: string, context: DeviceContext): Promise<"allowed" | "pending" | "revoked"> {
  if (!context.deviceId) return "allowed";

  const [existing] = await tx
    .select({ id: userDevices.id, status: userDevices.status })
    .from(userDevices)
    .where(and(eq(userDevices.userId, userId), eq(userDevices.deviceId, context.deviceId)))
    .limit(1);

  if (existing?.status === "approved") {
    await tx
      .update(userDevices)
      .set({ lastSeenAt: new Date(), lastIp: context.ipAddress, userAgent: context.userAgent, updatedAt: new Date() })
      .where(eq(userDevices.id, existing.id));
    return "allowed";
  }

  if (existing) {
    // Kutilmoqda yoki bekor qilingan — kirish yo'q, lekin ko'rinib turishi uchun vaqti yangilanadi
    await tx
      .update(userDevices)
      .set({ lastSeenAt: new Date(), lastIp: context.ipAddress, updatedAt: new Date() })
      .where(eq(userDevices.id, existing.id));
    return existing.status === "revoked" ? "revoked" : "pending";
  }

  // Yangi qurilma: birinchisi bo'lsa — avtomatik ishonchli
  const [row] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(userDevices)
    .where(and(eq(userDevices.userId, userId), eq(userDevices.status, "approved")));
  const first = (row?.count ?? 0) === 0;

  await tx.insert(userDevices).values({
    userId,
    deviceId: context.deviceId,
    name: guessDeviceName(context.userAgent),
    status: first ? "approved" : "pending",
    userAgent: context.userAgent,
    lastIp: context.ipAddress,
    ...(first ? { approvedAt: new Date() } : {}),
  });

  return first ? "allowed" : "pending";
}

/** Rad etish xatosi — yozuv saqlangandan KEYIN tashlanadi. */
export function deviceError(revoked: boolean) {
  return new AppError(
    "FORBIDDEN",
    revoked
      ? "Bu qurilmadan kirish bekor qilingan. Biznes egasi qayta tasdiqlashi kerak."
      : "Yangi qurilma qo'shilmagan. Biznes egasi uni tasdiqlagandan keyin kira olasiz.",
    { reason: "device_not_approved" },
  );
}

/** Foydalanuvchining qurilmalari (egasi ko'radi). */
export function listUserDevices(conn: DbOrTx, userId: string) {
  return conn
    .select({
      id: userDevices.id,
      name: userDevices.name,
      status: userDevices.status,
      userAgent: userDevices.userAgent,
      lastIp: userDevices.lastIp,
      firstSeenAt: userDevices.firstSeenAt,
      lastSeenAt: userDevices.lastSeenAt,
      approvedAt: userDevices.approvedAt,
    })
    .from(userDevices)
    .where(eq(userDevices.userId, userId))
    .orderBy(desc(userDevices.lastSeenAt));
}

/** Qurilmani tasdiqlash yoki bekor qilish; nomini ham shu yerda o'zgartirsa bo'ladi. */
export async function setDeviceStatus(
  tx: Tx,
  input: { deviceRowId: string; userId: string; status: "approved" | "revoked"; name?: string; actorId: string },
) {
  const [updated] = await tx
    .update(userDevices)
    .set({
      status: input.status,
      ...(input.name ? { name: input.name } : {}),
      ...(input.status === "approved" ? { approvedAt: new Date(), approvedBy: input.actorId } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(userDevices.id, input.deviceRowId), eq(userDevices.userId, input.userId)))
    .returning({ id: userDevices.id, name: userDevices.name, status: userDevices.status });
  return updated ?? null;
}
