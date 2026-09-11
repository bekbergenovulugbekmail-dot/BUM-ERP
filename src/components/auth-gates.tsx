/**
 * Convex'dagi `<Authenticated>`, `<Unauthenticated>`, `<AuthLoading>` o'rniga — API sessiyasi bo'yicha.
 */
import { useAuth } from "@/hooks/use-auth.ts";

type Props = { children: React.ReactNode };

export function Authenticated({ children }: Props) {
  const { isLoading, isAuthenticated } = useAuth();
  return !isLoading && isAuthenticated ? <>{children}</> : null;
}

export function Unauthenticated({ children }: Props) {
  const { isLoading, isAuthenticated } = useAuth();
  return !isLoading && !isAuthenticated ? <>{children}</> : null;
}

export function AuthLoading({ children }: Props) {
  const { isLoading } = useAuth();
  return isLoading ? <>{children}</> : null;
}
