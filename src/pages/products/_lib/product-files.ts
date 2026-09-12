/**
 * Mahsulot rasmi — `/api/files` oqimi (apps/api/src/modules/files):
 *   1) POST /uploads → imzolangan PUT URL  2) faylni aynan qaytgan sarlavhalar bilan PUT
 *   3) POST /attach → mahsulotga biriktirish. Saqlash ochiq emas: ko'rish GET /url (5 daqiqa).
 * Fayl saqlash (S3) sozlanmagan bo'lsa (/uploads → 503) rasm to'g'ridan-to'g'ri API'ga yuklanadi va bazada saqlanadi.
 */
import { ApiError, api, apiUrl } from "@/lib/api.ts";
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

async function uploadToDatabase(productId: string, file: File): Promise<void> {
  let response: Response;
  try {
    response = await fetch(apiUrl(`/api/files/product-image/${productId}/content`), {
      method: "PUT",
      credentials: "include",
      headers: { "content-type": file.type },
      body: file,
    });
  } catch {
    throw new Error("Rasmni yuklab bo'lmadi — aloqani tekshiring");
  }
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(payload?.message ?? "Rasmni yuklab bo'lmadi");
  }
}

export async function uploadProductImage(productId: string, file: File): Promise<void> {
  let ticket: UploadTicket;
  try {
    ticket = await api.post<UploadTicket>("/api/files/uploads", {
      kind: "product-image",
      contentType: file.type,
      size: file.size,
    });
  } catch (err) {
    if (err instanceof ApiError && err.status === 503) return uploadToDatabase(productId, file);
    throw err;
  }
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

/** Ko'rish URL (bazadagi rasm — API manzili); rasm yo'q, saqlash sozlanmagan (503) yoki ruxsat yo'q — `undefined`. */
export function useProductImageUrl(productId: string | null, imageKey: string | null | undefined): string | undefined {
  const url = useApiQuery<{ url: string }>(
    productId && imageKey ? "/api/files/url" : null,
    // `key` — rasm almashtirilganda keshdagi eski URL ishlatilmasligi uchun
    { kind: "product-image", targetId: productId, key: imageKey },
    { staleTime: 4 * 60_000, retry: false },
  ).data?.url;
  return url?.startsWith("/api/") ? apiUrl(url) : url;
}
