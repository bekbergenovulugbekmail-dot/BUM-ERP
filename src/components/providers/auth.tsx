import { AuthProvider as OidcProvider } from "react-oidc-context";
import { WebStorageStateStore } from "oidc-client-ts";

/**
 * Standart OIDC provayder. Hech qaysi vendor'ga bog'lanmagan —
 * .env dagi VITE_OIDC_* qiymatlarini almashtirish orqali
 * Keycloak / Logto / Auth0 / Clerk o'rtasida ko'chib yurish mumkin.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  return (
    <OidcProvider
      authority={import.meta.env.VITE_OIDC_AUTHORITY}
      client_id={import.meta.env.VITE_OIDC_CLIENT_ID}
      redirect_uri={`${window.location.origin}/auth/callback`}
      post_logout_redirect_uri={window.location.origin}
      response_type="code"
      scope={
        import.meta.env.VITE_OIDC_SCOPE ??
        "openid profile email offline_access"
      }
      // Sahifa yangilanganda sessiya yo'qolmasligi uchun
      userStore={new WebStorageStateStore({ store: window.localStorage })}
      // Login'dan keyin URL'dan ?code=&state= ni tozalash
      onSigninCallback={() => {
        window.history.replaceState({}, document.title, window.location.pathname);
      }}
    >
      {children}
    </OidcProvider>
  );
}
