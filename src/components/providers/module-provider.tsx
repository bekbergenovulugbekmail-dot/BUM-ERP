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

const ModuleContext = createContext<ModuleContextType>({
  modules: defaultModules,
  isEnabled: () => true,
  toggleModule: () => {},
  enabledModules: [],
});

export function ModuleProvider({ children }: { children: ReactNode }) {
  const [modules, setModules] = useState<ModuleSettings>(() => {
    try {
      const stored = localStorage.getItem("erp_modules");
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<ModuleSettings>;
        return { ...defaultModules, ...parsed };
      }
    } catch {
      // ignore
    }
    return defaultModules;
  });

  useEffect(() => {
    try {
      localStorage.setItem("erp_modules", JSON.stringify(modules));
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

export function useModules() {
  return useContext(ModuleContext);
}
