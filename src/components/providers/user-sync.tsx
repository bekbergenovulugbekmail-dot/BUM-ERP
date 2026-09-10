import { useEffect, useRef } from "react";
import { useConvexAuth, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api.js";

/**
 * Kirishdan keyin `users` yozuvini ERP maydonlari bilan to'ldiradi
 * (rol, isActive, platforma admini). Convex Auth foydalanuvchi hujjatini
 * o'zi yaratadi, lekin ERP maydonlarini bilmaydi.
 *
 * Avval buni /auth/callback sahifasi qilardi; OIDC olib tashlangach,
 * bu ish provayderlar daraxtiga ko'chdi.
 */
export function UserSync({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useConvexAuth();
  const updateCurrentUser = useMutation(api.users.updateCurrentUser);
  const syncedRef = useRef(false);

  useEffect(() => {
    if (!isAuthenticated) {
      syncedRef.current = false;
      return;
    }
    if (syncedRef.current) return;
    syncedRef.current = true;
    updateCurrentUser().catch(() => {
      // keyingi renderda qayta urinish uchun
      syncedRef.current = false;
    });
  }, [isAuthenticated, updateCurrentUser]);

  return <>{children}</>;
}
