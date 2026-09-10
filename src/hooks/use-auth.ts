/**
 * Auth adapter.
 *
 * Butun ilova auth'ga FAQAT shu fayl orqali murojaat qiladi.
 * Provayter almashtirilsa (Keycloak → Logto → Auth0), boshqa hech bir
 * fayl o'zgarmaydi. Hercules'dagi kabi lock-in takrorlanmasligi uchun.
 *
 * Asos: react-oidc-context (standart OIDC, hech kimga bog'lanmagan).
 */
import { useAuth as useOidcAuth } from "react-oidc-context";
import { useCallback, useMemo } from "react";

export type AppUser = {
  id: string;
  email?: string;
  name?: string;
  picture?: string;
  /** oidc-client-ts xom obyekti — kerak bo'lganda */
  profile?: Record<string, unknown>;
};

export function useAuth() {
  const oidc = useOidcAuth();

  const signin = useCallback(() => {
    void oidc.signinRedirect();
  }, [oidc]);

  const signout = useCallback(() => {
    void oidc.signoutRedirect({
      post_logout_redirect_uri: window.location.origin,
    });
  }, [oidc]);

  const user = useMemo<AppUser | undefined>(() => {
    const p = oidc.user?.profile;
    if (!p) return undefined;
    return {
      id: p.sub,
      email: p.email,
      name: p.name ?? p.preferred_username ?? p.email,
      picture: p.picture,
      profile: p as unknown as Record<string, unknown>,
    };
  }, [oidc.user]);

  return {
    user,
    isAuthenticated: oidc.isAuthenticated,
    isLoading: oidc.isLoading,
    error: oidc.error?.message,
    signin,
    signout,
    // Hercules API bilan moslik uchun aliaslar
    signinRedirect: signin,
    signoutRedirect: signout,
  };
}

/** Eski `useUser()` chaqiruvlari uchun moslik qatlami */
export function useUser() {
  const { user, isLoading, isAuthenticated } = useAuth();
  return { user, isLoading, isAuthenticated };
}
