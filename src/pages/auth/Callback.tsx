import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useConvexAuth, useMutation } from "convex/react";
import { useAuth } from "react-oidc-context";
import { api } from "@/convex/_generated/api.js";
import { Spinner } from "@/components/ui/spinner.tsx";
import { Button } from "@/components/ui/button.tsx";

/**
 * OIDC redirect callback.
 *
 * react-oidc-context `AuthProvider` URL'dagi ?code=&state= ni avtomatik
 * qayta ishlaydi. Bu sahifa faqat kutadi: OIDC tugagach → Convex auth
 * tasdiqlangach → users jadvalini sinxronlaydi → bosh sahifaga o'tadi.
 */
export default function AuthCallback() {
  const navigate = useNavigate();
  const oidc = useAuth();
  const { isAuthenticated: isConvexAuthenticated } = useConvexAuth();
  const updateCurrentUser = useMutation(api.users.updateCurrentUser);

  const [syncError, setSyncError] = useState<string | null>(null);
  const synced = useRef(false);

  const goHome = useCallback(() => navigate("/", { replace: true }), [navigate]);

  useEffect(() => {
    // OIDC hali ishlayapti
    if (oidc.isLoading || oidc.activeNavigator) return;

    // Login bo'lmagan holda bu sahifaga tushib qolgan
    if (!oidc.isAuthenticated) {
      if (!oidc.error) goHome();
      return;
    }

    // Convex tokenni hali qabul qilmagan
    if (!isConvexAuthenticated) return;

    if (synced.current) return;
    synced.current = true;

    updateCurrentUser()
      .then(goHome)
      .catch((e: unknown) => {
        synced.current = false;
        setSyncError(e instanceof Error ? e.message : "Sinxronlashda xatolik");
      });
  }, [
    oidc.isLoading,
    oidc.isAuthenticated,
    oidc.activeNavigator,
    oidc.error,
    isConvexAuthenticated,
    updateCurrentUser,
    goHome,
  ]);

  const error = syncError ?? oidc.error?.message;

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-svh gap-6 px-4">
        <div className="flex flex-col items-center gap-2 text-center">
          <p className="text-destructive font-medium">Xatolik yuz berdi</p>
          <p className="text-sm text-muted-foreground max-w-md">{error}</p>
        </div>
        <div className="flex gap-3">
          <Button variant="secondary" onClick={goHome}>
            Bosh sahifa
          </Button>
          <Button
            onClick={() => {
              setSyncError(null);
              void oidc.signinRedirect();
            }}
          >
            Qayta urinish
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center h-svh gap-4">
      <Spinner className="size-8" />
      <p className="text-sm text-muted-foreground">Yuklanmoqda...</p>
    </div>
  );
}
