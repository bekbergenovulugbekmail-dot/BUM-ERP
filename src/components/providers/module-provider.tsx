/**
 * Kompaniya modullari holati — serverdan (`GET /api/company` → `modules`), boshqa qurilma yoki foydalanuvchida ham bir xil.
 * Modul o'chiq bo'lsa menyu va sahifa yashiriladi; API baribir MODULE_DISABLED qaytaradi (asosiy himoya — serverda).
 * Tizim bo'limlari (bosh sahifa, obuna, sozlamalar) modul emas — doim ochiq.
 */
import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import type { CompanyModuleStates } from "@bum/shared";
import { useCurrentUser } from "@/hooks/use-auth.ts";
import { useActiveCompany } from "@/hooks/use-company.ts";
import { ERP_MODULES, type ModuleId } from "@/lib/modules.ts";

type ModuleContextType = {
  /** `undefined` — yuklanmoqda yoki kompaniya yo'q. */
  states: CompanyModuleStates | undefined;
  isEnabled: (id: ModuleId) => boolean;
  enabledModules: ModuleId[];
  isLoading: boolean;
};

const ModuleContext = createContext<ModuleContextType>({
  states: undefined,
  isEnabled: () => true,
  enabledModules: [],
  isLoading: false,
});

export function ModuleProvider({ children }: { children: ReactNode }) {
  const user = useCurrentUser();
  // Kirmagan sahifalarda (login, ro'yxatdan o'tish) kompaniya so'rovi yuborilmaydi
  const { data, isLoading } = useActiveCompany(Boolean(user?.hasCompany));
  const states = data?.modules;

  const isEnabled = useCallback(
    (id: ModuleId) => {
      const key = ERP_MODULES.find((module) => module.id === id)?.moduleKey;
      return key ? (states?.[key] ?? true) : true;
    },
    [states],
  );
  const value = useMemo(
    () => ({ states, isEnabled, enabledModules: ERP_MODULES.filter((module) => isEnabled(module.id)).map((module) => module.id), isLoading }),
    [states, isEnabled, isLoading],
  );

  return <ModuleContext.Provider value={value}>{children}</ModuleContext.Provider>;
}

// Provayder va uning hook'i bir faylda — shadcn/ui provayderlaridagi kabi
// eslint-disable-next-line react-refresh/only-export-components
export function useModules() {
  return useContext(ModuleContext);
}
