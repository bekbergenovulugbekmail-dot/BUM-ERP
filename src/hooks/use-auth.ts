/**
 * Auth adapter.
 *
 * Butun ilova auth'ga FAQAT shu fayl orqali murojaat qiladi.
 * Backend almashtirilsa, boshqa hech bir fayl o'zgarmaydi.
 *
 * Asos: Convex Auth (@convex-dev/auth) — parol provayderi, tashqi
 * OIDC provayderisiz. Login identifikatori telefon raqam
 * (qarang: convex/auth.ts).
 */
import { useCallback, useMemo, useState } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";

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

export function useAuth() {
  const { signIn: convexSignIn, signOut } = useAuthActions();
  const { isLoading, isAuthenticated } = useConvexAuth();
  const [error, setError] = useState<string | undefined>(undefined);

  const me = useQuery(api.users.getCurrentUser, isAuthenticated ? {} : "skip");

  /** Telefon + parol bilan kirish. Xato bo'lsa qayta tashlaydi. */
  const signInWithPassword = useCallback(
    async (phone: string, password: string) => {
      setError(undefined);
      try {
        await convexSignIn("password", { email: phone, password, flow: "signIn" });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Kirishda xatolik";
        setError(msg);
        throw e;
      }
    },
    [convexSignIn],
  );

  /** Yangi hisob yaratish. */
  const signUpWithPassword = useCallback(
    async (phone: string, password: string, name?: string) => {
      setError(undefined);
      try {
        await convexSignIn("password", {
          email: phone,
          password,
          flow: "signUp",
          ...(name ? { name } : {}),
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Ro'yxatdan o'tishda xatolik";
        setError(msg);
        throw e;
      }
    },
    [convexSignIn],
  );

  const signout = useCallback(() => {
    void signOut();
  }, [signOut]);

  /**
   * Eski OIDC API bilan moslik: avval tashqi provayder sahifasiga
   * yo'naltirardi, endi ilovaning o'z login sahifasiga olib boradi.
   */
  const signin = useCallback(() => {
    window.location.assign(loginPath());
  }, []);

  const user = useMemo<AppUser | undefined>(() => {
    if (!me) return undefined;
    return {
      id: me._id,
      email: me.email,
      phone: me.phone,
      name: me.name ?? me.phone ?? me.email,
      picture: me.avatar ?? me.image,
    };
  }, [me]);

  return {
    user,
    isAuthenticated,
    isLoading,
    error,
    signInWithPassword,
    signUpWithPassword,
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
