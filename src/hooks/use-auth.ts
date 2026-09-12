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
import { api, ApiError, errorMessage } from "@/lib/api.ts";
import { AUTH_ME_KEY } from "@/lib/query.ts";
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
  /** Amaldagi holat — faol emas yoki sinov muddati tugagan kompaniya "suspended". */
  companyStatus: CompanyStatus | null;
  companySuspendReason: string | null;
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
  return `/${lng}/login`;
}

async function fetchMe(signal?: AbortSignal): Promise<Me | null> {
  try {
    return (await api.get<{ user: Me }>("/api/auth/me", undefined, signal)).user;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

function useMeQuery() {
  return useQuery<Me | null, ApiError>({
    queryKey: AUTH_ME_KEY,
    queryFn: ({ signal }) => fetchMe(signal),
    staleTime: 60_000,
  });
}

/** Convex'dagi `users.getCurrentUser` kabi: `undefined` — yuklanmoqda, `null` — kirilmagan. */
export function useCurrentUser(): Me | null | undefined {
  return useMeQuery().data;
}

export function useAuth() {
  const queryClient = useQueryClient();
  const meQuery = useMeQuery();
  const me = meQuery.data;
  const [error, setError] = useState<string | undefined>(undefined);

  /** Boshqa foydalanuvchi yoki kompaniya ma'lumoti keshda qolmasligi uchun. */
  const replaceSession = useCallback(
    (user: Me | null) => {
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== AUTH_ME_KEY[0] });
      queryClient.setQueryData(AUTH_ME_KEY, user);
    },
    [queryClient],
  );

  /** Telefon + parol bilan kirish. Xato bo'lsa qayta tashlaydi. */
  const signInWithPassword = useCallback(
    async (phone: string, password: string) => {
      setError(undefined);
      try {
        const { user } = await api.post<{ user: Me }>("/api/auth/login", { phone, password });
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
