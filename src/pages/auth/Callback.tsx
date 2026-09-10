import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useConvexAuth, useMutation } from "convex/react";
import { useAuth } from "react-oidc-context";
import { ErrorResponse } from "oidc-client-ts";
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

/**
 * Bu kodlar haqiqiy xato emas — provayder shunchaki interaktiv login
 * kerakligini bildiradi. Foydalanuvchiga xato ko'rsatmay, qayta yo'naltiramiz.
 */
const RETRYABLE_ERRORS = ["login_required", "consent_required"];

function retryableErrorCode(error: unknown): string | undefined {
  if (error instanceof ErrorResponse && error.error && RETRYABLE_ERRORS.includes(error.error)) {
    return error.error;
  }
  return undefined;
}

export default function AuthCallback() {
  const navigate = useNavigate();
  const oidc = useAuth();
  const { isAuthenticated: isConvexAuthenticated } = useConvexAuth();
  const updateCurrentUser = useMutation(api.users.updateCurrentUser);

  const [syncError, setSyncError] = useState<string | null>(null);
  const synced = useRef(false);
  const retriedSignin = useRef(false);

  const goHome = useCallback(() => navigate("/", { replace: true }), [navigate]);

  const retryableCode = retryableErrorCode(oidc.error);
  const { signinRedirect } = oidc;

  useEffect(() => {
    // OIDC hali ishlayapti
    if (oidc.isLoading || oidc.activeNavigator) return;

    // login_required / consent_required — qaytadan login qilish kifoya.
    // Ref faqat shu effekt ichida o'qiladi (StrictMode'da ikki marta
    // yo'naltirib yubormaslik uchun), render paytida emas.
    if (retryableCode) {
      if (retriedSignin.current) return;
      retriedSignin.current = true;
      void signinRedirect();
      return;
    }

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
    retryableCode,
    signinRedirect,
  ]);

  const error = syncError ?? (retryableCode ? undefined : oidc.error?.message);

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
