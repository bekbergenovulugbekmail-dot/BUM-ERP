import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { ERP_MODULES, type ModuleId } from "@/lib/modules.ts";

type ModuleSettings = Record<ModuleId, boolean>;

type ModuleContextType = {
  modules: ModuleSettings;
  isEnabled: (id: ModuleId) => boolean;
  toggleModule: (id: ModuleId) => void;
  enabledModules: ModuleId[];
};

const defaultModules = ERP_MODULES.reduce((acc, mod) => {
  acc[mod.id] = mod.defaultEnabled;
  return acc;
}, {} as ModuleSettings);

const STORAGE_KEY = "erp_modules_v2";
/** Eski kalitda "distribution" standart o'chiq saqlangan — endi CRM'dan alohida bo'lim, u qiymat olinmaydi. */
const LEGACY_STORAGE_KEY = "erp_modules";

function readStoredModules(): ModuleSettings {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) return { ...defaultModules, ...(JSON.parse(stored) as Partial<ModuleSettings>) };
  const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
  if (legacy) {
    const parsed = JSON.parse(legacy) as Partial<ModuleSettings>;
    delete parsed.distribution;
    return { ...defaultModules, ...parsed };
  }
  return defaultModules;
}

const ModuleContext = createContext<ModuleContextType>({
  modules: defaultModules,
  isEnabled: () => true,
  toggleModule: () => {},
  enabledModules: [],
});

export function ModuleProvider({ children }: { children: ReactNode }) {
  const [modules, setModules] = useState<ModuleSettings>(() => {
    try {
      return readStoredModules();
    } catch {
      return defaultModules;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(modules));
    } catch {
      // ignore
    }
  }, [modules]);

  const isEnabled = (id: ModuleId) => modules[id] ?? true;

  const toggleModule = (id: ModuleId) => {
    setModules((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const enabledModules = ERP_MODULES.filter((m) => modules[m.id]).map((m) => m.id);

  return (
    <ModuleContext.Provider value={{ modules, isEnabled, toggleModule, enabledModules }}>
      {children}
    </ModuleContext.Provider>
  );
}

// Provayder va uning hook'i bir faylda — shadcn/ui provayderlaridagi kabi
// eslint-disable-next-line react-refresh/only-export-components
export function useModules() {
  return useContext(ModuleContext);
}
