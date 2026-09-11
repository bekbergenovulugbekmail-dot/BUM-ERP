/**
 * Mahsulot rasmi — `/api/files` oqimi (apps/api/src/modules/files):
 *   1) POST /uploads → imzolangan PUT URL  2) faylni aynan qaytgan sarlavhalar bilan PUT
 *   3) POST /attach → mahsulotga biriktirish. Saqlash ochiq emas: ko'rish GET /url (5 daqiqa).
 */
import { api } from "@/lib/api.ts";
import { useApiQuery } from "@/lib/query.ts";

export const PRODUCT_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
export const PRODUCT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

type UploadTicket = { key: string; uploadUrl: string; headers: Record<string, string> };

/** Tanlangan faylni oldindan tekshirish; xato bo'lsa xabar, aks holda `null`. */
export function validateProductImage(file: File): string | null {
  if (!PRODUCT_IMAGE_TYPES.includes(file.type)) return "Faqat JPG, PNG yoki WEBP rasm";
  if (file.size > PRODUCT_IMAGE_MAX_BYTES) return "Rasm hajmi 5 MB dan oshmasligi kerak";
  return null;
}

export async function uploadProductImage(productId: string, file: File): Promise<void> {
  const ticket = await api.post<UploadTicket>("/api/files/uploads", {
    kind: "product-image",
    contentType: file.type,
    size: file.size,
  });
  let response: Response;
  try {
    response = await fetch(ticket.uploadUrl, { method: "PUT", headers: ticket.headers, body: file });
  } catch {
    throw new Error("Rasmni saqlashga yuklab bo'lmadi — aloqani tekshiring");
  }
  if (!response.ok) throw new Error("Rasmni saqlashga yuklab bo'lmadi");
  await api.post("/api/files/attach", { kind: "product-image", key: ticket.key, targetId: productId });
}

export async function removeProductImage(productId: string): Promise<void> {
  await api.post("/api/files/detach", { kind: "product-image", targetId: productId });
}

/** Imzolangan ko'rish URL; rasm yo'q, saqlash sozlanmagan (503) yoki ruxsat yo'q — `undefined`. */
export function useProductImageUrl(productId: string | null, imageKey: string | null | undefined): string | undefined {
  return useApiQuery<{ url: string }>(
    productId && imageKey ? "/api/files/url" : null,
    // `key` — rasm almashtirilganda keshdagi eski URL ishlatilmasligi uchun
    { kind: "product-image", targetId: productId, key: imageKey },
    { staleTime: 4 * 60_000, retry: false },
  ).data?.url;
}
