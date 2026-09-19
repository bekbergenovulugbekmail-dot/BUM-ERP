/**
 * Auth adapter.
 *
 * Butun ilova auth'ga FAQAT shu fayl orqali murojaat qiladi.
 * Backend almashtirilsa, boshqa hech bir fayl o'zgarmaydi.
 *
 * Asos (PHASE 16): Fastify API sessiyasi — httpOnly cookie, `/api/auth/*`.
 * Login identifikatori telefon raqam. Ro'yxatdan o'tish — `/api/registration` (onboarding sahifasi).
 */
import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { AccessDenialReason, SubscriptionStatus } from "@bum/shared";
import { api, ApiError, errorMessage, getCompanyContext } from "@/lib/api.ts";
import { AUTH_ME_KEY, authMeKey } from "@/lib/query.ts";
import type { CompanyStatus } from "./use-company.ts";

/** `GET /api/auth/me` javobi. */
export type Me = {
  id: string;
  phone: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
  isPlatformAdmin: boolean;
  activeCompanyId: string | null;
  hasCompany: boolean;
  companyName: string | null;
  companyCurrency: string | null;
  companySlug: string | null;
  companyRole: string | null;
  /** Kompaniya holati (platforma admini qarori): faol emas — "suspended", tugatilgan — "cancelled". */
  companyStatus: CompanyStatus | null;
  companySuspendReason: string | null;
  isCompanyOwner: boolean;
  /** Obuna (server vaqti). Tugagan bo'lsa — faqat Bosh sahifa va Obuna ochiq. */
  subscription: {
    status: SubscriptionStatus;
    isTrial: boolean;
    expiresAt: string | null;
    daysLeft: number | null;
    trialWarning: number | null;
  } | null;
  /** Foydalanuvchi litsenziyasi bo'yicha kirish taqiqi (egasida doim null). */
  licenseDenial: AccessDenialReason | null;
  /** Ekran PIN bilan qulflangan — sessiya saqlangan. */
  sessionLocked: boolean;
};

export type AppUser = {
  id: string;
  email?: string;
  phone?: string;
  name?: string;
  picture?: string;
};

/** Login sahifasining manzili (joriy til prefiksi bilan) */
function loginPath(): string {
  const seg = window.location.pathname.split("/").filter(Boolean)[0];
  const lng = seg && ["uz", "ru", "kz"].includes(seg) ? seg : "uz";
  // Universal kirish sahifasi yo'q — biznes manzili so'raladi
  return "/";
}

async function fetchMe(signal: AbortSignal | undefined, company: string | null): Promise<Me | null> {
  try {
    return (await api.get<{ user: Me }>("/api/auth/me", undefined, signal, company)).user;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

function useMeQuery() {
  const company = getCompanyContext();
  return useQuery<Me | null, ApiError>({
    queryKey: [AUTH_ME_KEY[0], company],
    queryFn: ({ signal }) => fetchMe(signal, company),
    staleTime: 60_000,
  });
}

/** Convex'dagi `users.getCurrentUser` kabi: `undefined` — yuklanmoqda, `null` — kirilmagan. */
export function useCurrentUser(): Me | null | undefined {
  return useMeQuery().data;
}

/** `/me` xatosi (masalan, URL'dagi biznesga kirish yo'q — 403 `company_access_denied`). */
export function useMeError(): ApiError | null {
  return useMeQuery().error;
}

export function useAuth() {
  const queryClient = useQueryClient();
  const meQuery = useMeQuery();
  const me = meQuery.data;
  const [error, setError] = useState<string | undefined>(undefined);

  /** Boshqa foydalanuvchi yoki kompaniya ma'lumoti keshda qolmasligi uchun. */
  const replaceSession = useCallback(
    (user: Me | null) => {
      // Barcha bizneslar keshi (boshqa biznes kontekstidagi `/me` ham) — yangi sessiya bilan qayta olinadi
      queryClient.removeQueries();
      queryClient.setQueryData(authMeKey(), user);
    },
    [queryClient],
  );

  /**
   * Telefon + parol bilan kirish. Xato bo'lsa qayta tashlaydi.
   * `companySlug` berilsa (biznes manzilidan kirish) — aynan shu biznesga kiriladi.
   */
  const signInWithPassword = useCallback(
    async (phone: string, password: string, companySlug?: string) => {
      setError(undefined);
      try {
        const { user } = await api.post<{ user: Me }>("/api/auth/login", {
          phone,
          password,
          ...(companySlug ? { companySlug } : {}),
        });
        replaceSession(user);
        return user;
      } catch (e) {
        setError(errorMessage(e, "Kirishda xatolik"));
        throw e;
      }
    },
    [replaceSession],
  );

  const signout = useCallback(() => {
    // Agent ish joyining oflayn keshi (do'konlar, katalog, buyurtmalar) keyingi foydalanuvchiga qolmasin
    if (typeof navigator !== "undefined") navigator.serviceWorker?.controller?.postMessage({ type: "clear-agent-cache" });
    // Sahifa service worker nazoratida bo'lmasa ham (qattiq qayta yuklash) — kesh sahifaning o'zidan o'chiriladi
    if (typeof caches !== "undefined") void caches.delete("agent-api-v2").catch(() => undefined);
    // Yuborilmagan GPS nuqtalari keyingi foydalanuvchi nomidan yuborilmasin; buyurtma qoralamalari qurilmada qolmasin
    try {
      for (const key of Object.keys(localStorage)) {
        if (key === "bum:delivery-locations" || key.startsWith("bum:agent-order:") || /^bum:.*draft/i.test(key)) localStorage.removeItem(key);
      }
    } catch {
      // localStorage yopiq (xususiy rejim) — tozalanadigan narsa yo'q
    }
    void api
      .post("/api/auth/logout")
      .catch(() => undefined)
      .finally(() => replaceSession(null));
  }, [replaceSession]);

  /** Ilovaning login sahifasiga olib boradi (eski OIDC API bilan moslik). */
  const signin = useCallback(() => {
    window.location.assign(loginPath());
  }, []);

  const user = useMemo<AppUser | undefined>(() => {
    if (!me) return undefined;
    return {
      id: me.id,
      email: me.email ?? undefined,
      phone: me.phone,
      name: me.name ?? me.phone,
      picture: me.avatarUrl ?? undefined,
    };
  }, [me]);

  return {
    user,
    me,
    isAuthenticated: Boolean(me),
    // Tarmoq xatosida cheksiz yuklanish ko'rsatilmaydi
    isLoading: me === undefined && !meQuery.isError,
    error,
    signInWithPassword,
    signin,
    signout,
    // Eski chaqiruvlar bilan moslik uchun aliaslar
    signinRedirect: signin,
    signoutRedirect: signout,
  };
}

/** Eski `useUser()` chaqiruvlari uchun moslik qatlami */
export function useUser() {
  const { user, isLoading, isAuthenticated } = useAuth();
  return { user, isLoading, isAuthenticated };
}
