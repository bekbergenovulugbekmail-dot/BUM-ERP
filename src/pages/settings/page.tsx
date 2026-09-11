import { useState } from "react";
import { motion } from "motion/react";
import { Settings, Shield, Users, Building2, ListChecks, Puzzle, Bell, MapPin, Lock, ReceiptText } from "lucide-react";
import { cn } from "@/lib/utils.ts";
import { useTranslation } from "react-i18next";
import CompanySection from "./_components/company-section.tsx";
import RolesSection from "./_components/roles-section.tsx";
import UsersSection from "./_components/users-section.tsx";
import AuditLogSection from "./_components/audit-log-section.tsx";
import ModulesSection from "./_components/modules-section.tsx";
import NotificationsSection from "./_components/notifications-section.tsx";
import BranchesSection from "./_components/branches-section.tsx";
import SecuritySection from "./_components/security-section.tsx";
import ReceiptSection from "./_components/receipt-section.tsx";

// Takliflar (invitations) bo'limi yo'q — yakuniy qaror: xodim loginini kompaniya egasi o'zi ochadi
export default function SettingsPage() {
  const { t } = useTranslation("modules");
  const [tab, setTab] = useState<
    "company" | "branches" | "receipt" | "modules" | "roles" | "users" | "audit" | "notifications" | "security"
  >("company");

  const TABS = [
    { key: "company"       as const, label: t("settings.tab.company"),  icon: Building2 },
    { key: "branches"      as const, label: "Filiallar",                 icon: MapPin },
    { key: "receipt"       as const, label: "Chek",                      icon: ReceiptText },
    { key: "modules"       as const, label: t("settings.tab.modules"),   icon: Puzzle },
    { key: "roles"         as const, label: t("settings.tab.roles"),     icon: Shield },
    { key: "users"         as const, label: t("settings.tab.users"),     icon: Users },
    { key: "notifications" as const, label: "Bildirishnomalar",          icon: Bell },
    { key: "security"      as const, label: "Xavfsizlik",                icon: Lock },
    { key: "audit"         as const, label: t("settings.tab.audit"),     icon: ListChecks },
  ];

  return (
    <div className="p-6 space-y-6 max-w-[1400px] mx-auto">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
          <Settings className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-bold">{t("settings.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("settings.subtitle")}</p>
        </div>
      </motion.div>

      <div className="border-b border-border">
        <div className="flex gap-1 overflow-x-auto">
          {TABS.map((t_item) => (
            <button
              key={t_item.key}
              onClick={() => setTab(t_item.key)}
              className={cn(
                "flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-all cursor-pointer whitespace-nowrap",
                tab === t_item.key
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              <t_item.icon className="h-4 w-4" />
              {t_item.label}
            </button>
          ))}
        </div>
      </div>

      <motion.div key={tab} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.15 }}>
        {tab === "company"       && <CompanySection />}
        {tab === "branches"      && <BranchesSection />}
        {tab === "receipt"       && <ReceiptSection />}
        {tab === "modules"       && <ModulesSection />}
        {tab === "roles"         && <RolesSection />}
        {tab === "users"         && <UsersSection />}
        {tab === "notifications" && <NotificationsSection />}
        {tab === "security"      && <SecuritySection />}
        {tab === "audit"         && <AuditLogSection />}
      </motion.div>
    </div>
  );
}
