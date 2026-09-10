import { useCallback, useMemo } from "react";
import { ConvexReactClient, ConvexProviderWithAuth } from "convex/react";
import { useAuth as useOidcAuth } from "react-oidc-context";

const convexUrl = import.meta.env.VITE_CONVEX_URL;
if (!convexUrl) {
  throw new Error("VITE_CONVEX_URL o'rnatilmagan (.env.local ga qarang)");
}
const convex = new ConvexReactClient(convexUrl);

/**
 * Convex `ConvexProviderWithAuth` talab qiladigan shakl:
 * { isLoading, isAuthenticated, fetchAccessToken }
 *
 * Convex backend id_token'ni OIDC issuer'ning JWKS'i orqali tekshiradi,
 * shuning uchun access_token emas, aynan id_token yuboriladi.
 */
function useAuthForConvex() {
  const { isLoading, isAuthenticated, user, signinSilent } = useOidcAuth();

  const fetchAccessToken = useCallback(
    async ({ forceRefreshToken }: { forceRefreshToken: boolean }) => {
      try {
        if (forceRefreshToken) {
          const refreshed = await signinSilent();
          return refreshed?.id_token ?? null;
        }
        return user?.id_token ?? null;
      } catch {
        return null;
      }
    },
    [user, signinSilent],
  );

  return useMemo(
    () => ({ isLoading, isAuthenticated, fetchAccessToken }),
    [isLoading, isAuthenticated, fetchAccessToken],
  );
}

export function ConvexProvider({ children }: { children: React.ReactNode }) {
  return (
    <ConvexProviderWithAuth client={convex} useAuth={useAuthForConvex}>
      {children}
    </ConvexProviderWithAuth>
  );
}
