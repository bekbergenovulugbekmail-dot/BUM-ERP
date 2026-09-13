/**
 * BUM ERP API mijozi (PHASE 16) — Convex o'rniga Fastify API (`apps/api`).
 *
 * - sessiya httpOnly cookie'da: har so'rov `credentials: "include"`, token JS'ga ko'rinmaydi
 * - xato javobi `{ code, message }` → `ApiError` (Convex'dagi `ConvexError({ code, message })` bilan bir xil ma'no)
 * - himoyalangan so'rov 401 qaytarsa `UNAUTHENTICATED_EVENT` — sessiya tugagan, login sahifasiga o'tiladi
 * - `VITE_API_URL` bo'sh bo'lsa so'rovlar shu domenga ketadi (dev'da Vite proxy, prod'da bir domen)
 */
const BASE_URL = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");

export const UNAUTHENTICATED_EVENT = "bum:unauthenticated";
/** 423 LOCKED — sessiya ekrani qulflangan (boshqa oynada ham): ilova qulf ekranini ko'rsatadi. */
export const LOCKED_EVENT = "bum:locked";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export type QueryParams = Record<string, string | number | boolean | null | undefined>;

export function apiUrl(path: string, query?: QueryParams): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
  }
  const search = params.toString();
  return `${BASE_URL}${path}${search ? `?${search}` : ""}`;
}

type RequestOptions = { query?: QueryParams; body?: unknown; signal?: AbortSignal };

async function send(method: string, path: string, options: RequestOptions): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(apiUrl(path, options.query), {
      method,
      credentials: "include",
      headers: options.body !== undefined ? { "content-type": "application/json" } : undefined,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError(0, "NETWORK", "Server bilan aloqa yo'q. Internet aloqasini tekshiring");
  }

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | { code?: string; message?: string; details?: unknown }
      | null;
    // /api/auth/* ning 401 i sessiya holatini bildirmaydi (noto'g'ri parol, /me tekshiruvi)
    if (response.status === 401 && !path.startsWith("/api/auth/") && typeof window !== "undefined") {
      window.dispatchEvent(new Event(UNAUTHENTICATED_EVENT));
    }
    if (response.status === 423 && typeof window !== "undefined") window.dispatchEvent(new Event(LOCKED_EVENT));
    throw new ApiError(
      response.status,
      payload?.code ?? (response.status >= 500 ? "INTERNAL" : "BAD_REQUEST"),
      payload?.message ?? "Xatolik yuz berdi",
      payload?.details,
    );
  }
  return response;
}

async function json<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
  const response = await send(method, path, options);
  const text = await response.text();
  return (text ? JSON.parse(text) : null) as T;
}

export const api = {
  get: <T>(path: string, query?: QueryParams, signal?: AbortSignal) => json<T>("GET", path, { query, signal }),
  post: <T>(path: string, body?: unknown) => json<T>("POST", path, { body: body ?? {} }),
  put: <T>(path: string, body?: unknown) => json<T>("PUT", path, { body: body ?? {} }),
  patch: <T>(path: string, body?: unknown) => json<T>("PATCH", path, { body: body ?? {} }),
  delete: <T>(path: string, query?: QueryParams) => json<T>("DELETE", path, { query }),
  /** Fayl javoblari (masalan CSV eksport). */
  blob: async (path: string, query?: QueryParams) => (await send("GET", path, { query })).blob(),
};

/** Foydalanuvchiga ko'rsatiladigan xabar — `catch` bloklari uchun. */
export function errorMessage(error: unknown, fallback = "Xatolik yuz berdi"): string {
  if (error instanceof ApiError || error instanceof Error) return error.message || fallback;
  return fallback;
}
