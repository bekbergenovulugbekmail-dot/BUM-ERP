import { ConvexReactClient } from "convex/react";
import { ConvexAuthProvider } from "@convex-dev/auth/react";

const convexUrl = import.meta.env.VITE_CONVEX_URL;
if (!convexUrl) {
  throw new Error("VITE_CONVEX_URL o'rnatilmagan (.env.local ga qarang)");
}
const convex = new ConvexReactClient(convexUrl);

/**
 * ConvexAuthProvider ham Convex mijozini, ham auth holatini beradi.
 * Tashqi OIDC provayder kerak emas — tokenni Convex Auth o'zi chiqaradi
 * va localStorage'da saqlaydi (sahifa yangilanganda sessiya saqlanadi).
 */
export function ConvexProvider({ children }: { children: React.ReactNode }) {
  return <ConvexAuthProvider client={convex}>{children}</ConvexAuthProvider>;
}
