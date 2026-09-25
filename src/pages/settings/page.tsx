import { useState } from "react";
import { motion } from "motion/react";
import {
  Settings, Shield, Users, Building2, ListChecks, Puzzle, Bell, MapPin, Lock, ReceiptText, Tag, Gift, Coins, Monitor, Scale, Send, FileText,
} from "lucide-react";
import { cn } from "@/lib/utils.ts";
import PageTabs from "@/components/page-tabs.tsx";
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
import LabelsSection from "./_components/labels-section.tsx";
import DocumentsSection from "./_components/documents-section.tsx";
import CashbackSection from "./_components/cashback-section.tsx";
import CurrenciesSection from "./_components/currencies-section.tsx";
import PosDevicesSection from "./_components/pos-devices-section.tsx";
import SalesPolicySection from "./_components/sales-policy-section.tsx";
import TelegramSection from "./_components/telegram-section.tsx";

// Takliflar (invitations) bo'limi yo'q — yakuniy qaror: xodim loginini kompaniya egasi o'zi ochadi
export default function SettingsPage() {
  const { t } = useTranslation("modules");
  const [tab, setTab] = useState<
    | "company" | "currencies" | "branches" | "receipt" | "labels" | "cashback" | "sales-policy" | "pos-devices" | "modules" | "roles" | "users"
    | "audit" | "notifications" | "security" | "telegram" | "documents"
  >("company");

  const TABS = [
    { key: "company"       as const, label: t("settings.tab.company"),  icon: Building2 },
    { key: "currencies"    as const, label: "Valyutalar",                icon: Coins },
    { key: "branches"      as const, label: "Filiallar",                 icon: MapPin },
    { key: "receipt"       as const, label: "Chek",                      icon: ReceiptText },
    { key: "labels"        as const, label: "Etiketka",                  icon: Tag },
    { key: "documents"     as const, label: "Hujjatlar",                 icon: FileText },
    { key: "cashback"      as const, label: "Keshbek",                   icon: Gift },
    { key: "sales-policy"  as const, label: "Savdo siyosati",            icon: Scale },
    { key: "pos-devices"   as const, label: "Kassa qurilmalari",         icon: Monitor },
    { key: "modules"       as const, label: t("settings.tab.modules"),   icon: Puzzle },
    { key: "roles"         as const, label: t("settings.tab.roles"),     icon: Shield },
    { key: "users"         as const, label: t("settings.tab.users"),     icon: Users },
    { key: "notifications" as const, label: "Bildirishnomalar",          icon: Bell },
    { key: "telegram"      as const, label: "Telegram",                  icon: Send },
    { key: "security"      as const, label: "Xavfsizlik",                icon: Lock },
    { key: "audit"         as const, label: t("settings.tab.audit"),     icon: ListChecks },
  ];

  // `w-full` shart: `mx-auto` (avtomatik chekka) flex ustunida cho'zilishni o'chiradi va
  // quti kengligi `max-w` ga qarab 1400 px bo'lib qolardi — sahifa yon tomonga suriladigan
  // bo'lib, o'ngdagi panellar ekrandan chiqib ketardi.
  return (
    <div className={`w-full ${tab === "documents" ? "max-w-[1840px]" : "max-w-[1400px]"} mx-auto p-4 md:p-6 space-y-6`}>
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
          <Settings className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-bold">{t("settings.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("settings.subtitle")}</p>
        </div>
      </motion.div>

      <PageTabs tabs={TABS.map((item) => ({ key: item.key, label: item.label, icon: item.icon }))} value={tab} onChange={setTab} />

      <motion.div key={tab} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.15 }}>
        {tab === "company"       && <CompanySection />}
        {tab === "currencies"    && <CurrenciesSection />}
        {tab === "branches"      && <BranchesSection />}
        {tab === "receipt"       && <ReceiptSection />}
        {tab === "labels"        && <LabelsSection />}
        {tab === "documents"     && <DocumentsSection />}
        {tab === "cashback"      && <CashbackSection />}
        {tab === "sales-policy"  && <SalesPolicySection />}
        {tab === "pos-devices"   && <PosDevicesSection />}
        {tab === "telegram"      && <TelegramSection />}
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
