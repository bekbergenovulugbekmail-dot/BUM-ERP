import {
  LayoutDashboard,
  ShoppingCart,
  Monitor,
  Package,
  Warehouse,
  ShoppingBag,
  Factory,
  Users,
  Truck,
  PackageCheck,
  DollarSign,
  Landmark,
  UserCheck,
  FileBarChart,
  BarChart3,
  BrainCircuit,
  Settings,
  ChevronLeft,
  ChevronRight,
  LogOut,
  Sun,
  Moon,
  Globe,
  Search,
  Menu,
  X,
  Building2,
  ChevronDown,
  Shield,
  CreditCard,
  Lock,
  KeyRound,
  ExternalLink,
  Smartphone,
  type LucideIcon,
} from "lucide-react";
import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { AccessDenialReason } from "@bum/shared";
import { NavLink, useParams, useNavigate, useLocation, Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils.ts";
import BrandLogo from "@/components/brand-logo.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.tsx";
import { useVisibleModules } from "@/hooks/use-visible-modules.ts";
import { MODULE_GROUPS } from "@/lib/modules.ts";
import {
  SUPPORTED_LOCALES,
  SUPPORTED_LOCALES_ARRAY,
  changeLocale,
  pathHasLocale,
  setLocaleInPath,
  type SupportedLocale,
} from "@/i18n.ts";
import { companyPathKey } from "@bum/shared";
import { SignInButton } from "@/components/ui/signin.tsx";
import NotificationCenter from "@/components/notification-center.tsx";
import PWAInstallBanner from "@/components/pwa-install-banner.tsx";
import { GlobalSearch } from "@/components/global-search.tsx";
import { useAuth, useCurrentUser } from "@/hooks/use-auth.ts";
import { useActiveCompany, useMyCompanies, usePermissions, useSwitchCompany } from "@/hooks/use-company.ts";
import { isAgentOnly, isDeliveryAgentOnly } from "@/lib/agent-access.ts";
import { Authenticated, Unauthenticated } from "@/components/auth-gates.tsx";
import { useTheme } from "next-themes";
import { isAdminSubdomain } from "@/lib/subdomain.ts";
import LockScreen from "@/components/lock-screen.tsx";
import SetPinDialog from "@/components/set-pin-dialog.tsx";
import { LOCKED_EVENT, errorMessage } from "@/lib/api.ts";
import { AUTH_ME_KEY } from "@/lib/query.ts";
import { requestLock } from "@/lib/session-lock.ts";
import { ACCESS_DENIAL_LABEL, formatDay, subscriptionBlocked } from "@/lib/subscription.ts";

const ICON_MAP: Record<string, LucideIcon> = {
  LayoutDashboard,
  ShoppingCart,
  Monitor,
  Package,
  Warehouse,
  ShoppingBag,
  Factory,
  Users,
  Truck,
  DollarSign,
  Landmark,
  UserCheck,
  FileBarChart,
  BarChart3,
  BrainCircuit,
  Settings,
  PackageCheck,
  CreditCard,
};

function getIcon(name: string): LucideIcon {
  return ICON_MAP[name] ?? Package;
}

type SidebarProps = {
  collapsed: boolean;
  onToggle: () => void;
  onLinkClick?: () => void;
};

function SidebarNav({ collapsed, onToggle, onLinkClick }: SidebarProps) {
  const { t, i18n } = useTranslation("common");
  const { lng = "uz" } = useParams<{ lng: string }>();
  const visibleModules = useVisibleModules();
  const location = useLocation();
  // Supervayzer kabi xodimda ERP ham, agent ish joyi ham bor — ERP menyusidan o'tib zakaz oladi
  // (faqat agent ruxsati bo'lsa foydalanuvchi allaqachon agent ish joyiga yo'naltiriladi)
  const { can } = usePermissions();
  const agentWorkspace = can("sales_agent.use");

  const GROUP_LABELS: Record<string, Record<string, string>> = {
    uz: { main: "Asosiy", operations: "Operatsiyalar", business: "Biznes", insights: "Tahlil", system: "Tizim" },
    ru: { main: "Главное", operations: "Операции", business: "Бизнес", insights: "Аналитика", system: "Система" },
    kk: { main: "Негізгі", operations: "Операциялар", business: "Бизнес", insights: "Талдау", system: "Жүйе" },
  };

  const currentLang = i18n.language as "uz" | "ru" | "kk";
  const groupLabels = GROUP_LABELS[currentLang] ?? GROUP_LABELS.uz;

  const groups = Object.entries(MODULE_GROUPS) as [keyof typeof MODULE_GROUPS, string][];

  return (
    <aside
      className={cn(
        "flex flex-col h-screen bg-sidebar text-sidebar-foreground border-r border-sidebar-border transition-all duration-300",
        collapsed ? "w-16" : "w-60"
      )}
    >
      {/* Logo */}
      <div className={cn("flex items-center h-14 px-4 border-b border-sidebar-border shrink-0", collapsed ? "justify-center" : "justify-between")}>
        {!collapsed ? (
          <span className="flex min-w-0 items-center gap-2">
            <BrandLogo variant="mark" className="h-6 w-auto shrink-0" />
            <span className="truncate text-sm font-bold tracking-wide text-sidebar-foreground">{t("app.name")}</span>
          </span>
        ) : (
          <BrandLogo variant="mark" className="h-6 w-auto" />
        )}
        <button
          onClick={onToggle}
          className="p-1 rounded-md hover:bg-sidebar-accent text-sidebar-foreground/60 hover:text-sidebar-foreground transition-colors cursor-pointer"
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-2 space-y-4 px-2">
        <TooltipProvider delayDuration={0}>
          {groups.map(([groupId]) => {
            const groupModules = visibleModules.filter((m) => m.group === groupId);
            if (groupModules.length === 0) return null;
            return (
              <div key={groupId}>
                {!collapsed && (
                  <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/40 select-none">
                    {groupLabels[groupId] ?? MODULE_GROUPS[groupId]}
                  </p>
                )}
                <div className="space-y-0.5">
                  {/*
                    "Zakaz olish" — alohida modul EMAS, Savdo ichidagi ruxsatga bog'liq amal
                    (`sales_agent.use`). Ruxsat o'chirilsa bu yerda ko'rinmaydi va server ham 403 beradi.
                  */}
                  {groupId === "operations" && agentWorkspace && (
                    <OrderTakingLink lng={lng} collapsed={collapsed} onLinkClick={onLinkClick} />
                  )}
                  {groupModules.map((mod) => {
                    const Icon = getIcon(mod.icon);
                    const to = `/${lng}/${mod.path}`;
                    const isActive = location.pathname === to || location.pathname.startsWith(`${to}/`);
                    const item = (
                      <NavLink
                        key={mod.id}
                        to={to}
                        onClick={onLinkClick}
                        className={cn(
                          "flex items-center gap-3 px-2 py-2 rounded-md text-sm transition-colors",
                          isActive
                            ? "bg-sidebar-primary text-sidebar-primary-foreground font-medium"
                            : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                        )}
                      >
                        <Icon className={cn("shrink-0", collapsed ? "h-5 w-5" : "h-4 w-4")} />
                        {!collapsed && <span className="truncate">{t(mod.labelKey)}</span>}
                      </NavLink>
                    );
                    if (collapsed) {
                      return (
                        <Tooltip key={mod.id}>
                          <TooltipTrigger asChild>{item}</TooltipTrigger>
                          <TooltipContent side="right" className="text-xs">
                            {t(mod.labelKey)}
                          </TooltipContent>
                        </Tooltip>
                      );
                    }
                    return item;
                  })}
                </div>
              </div>
            );
          })}
        </TooltipProvider>

      </nav>
    </aside>
  );
}

/**
 * "Zakaz olish" havolasi — Savdo guruhida, `sales_agent.use` ruxsati bilan.
 * Alohida modul sifatida emas: buyurtma oqimi mavjud agent ish joyiniki, dublikat yo'q.
 */
function OrderTakingLink({
  lng,
  collapsed,
  onLinkClick,
}: {
  lng: string;
  collapsed: boolean;
  onLinkClick?: () => void;
}) {
  return (
    <NavLink
      to={`/${lng}/sales-agent`}
      onClick={onLinkClick}
      title="Zakaz olish"
      className="flex items-center gap-3 rounded-md px-2 py-2 text-sm text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
    >
      <Smartphone className={cn("shrink-0", collapsed ? "h-5 w-5" : "h-4 w-4")} />
      {!collapsed && <span className="truncate">Zakaz olish</span>}
    </NavLink>
  );
}

function TopBar({ onMenuToggle }: { onMenuToggle?: () => void }) {
  const { t } = useTranslation("common");
  const { user } = useAuth();
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const { i18n } = useTranslation();
  const [searchOpen, setSearchOpen] = useState(false);

  // Ctrl+K global search shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleLocale = (lng: SupportedLocale) => {
    // Biznes manzilida (/{biznes}/...) til URL'da emas — faqat almashtiriladi va saqlanadi
    if (!pathHasLocale(location.pathname)) {
      void changeLocale(lng);
      return;
    }
    navigate(setLocaleInPath(lng, location.pathname, location.search, location.hash));
  };

  return (
    <header className="h-14 short:h-10 border-b border-border bg-card flex items-center px-4 gap-2 sm:gap-3 shrink-0">
      {/* Mobile hamburger menu */}
      {onMenuToggle && (
        <Button variant="ghost" size="icon" className="h-8 w-8 wide:hidden shrink-0" onClick={onMenuToggle}>
          <Menu className="h-5 w-5" />
        </Button>
      )}

      {/* Search — icon-only on xs, full bar on sm+ */}
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 sm:hidden shrink-0"
        onClick={() => setSearchOpen(!searchOpen)}
      >
        <Search className="h-4 w-4" />
      </Button>
      <div className="hidden sm:flex flex-1 max-w-md">
        <button
          onClick={() => setSearchOpen(!searchOpen)}
          className="flex items-center gap-2 w-full px-3 py-1.5 rounded-md border border-border bg-muted/50 text-muted-foreground text-sm hover:bg-muted transition-colors cursor-pointer"
        >
          <Search className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{t("search.global")}</span>
          <kbd className="ml-auto hidden sm:inline-flex items-center gap-1 rounded border bg-background px-1.5 text-[10px] font-medium">
            Ctrl K
          </kbd>
        </button>
      </div>
      <div className="flex-1 sm:hidden" />

      <div className="flex min-w-0 items-center gap-1">
        {/* Company switcher */}
        <Authenticated>
          <CompanySwitcher />
        </Authenticated>

        {/* Notifications */}
        <Authenticated>
          <NotificationCenter />
        </Authenticated>

        {/* Theme toggle */}
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        >
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>

        {/* Language switcher */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
              <Globe className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {SUPPORTED_LOCALES_ARRAY.map((code) => {
              const meta = SUPPORTED_LOCALES[code];
              const isActive = i18n.language === code;
              return (
                <DropdownMenuItem
                  key={code}
                  onClick={() => handleLocale(code)}
                  className={cn("cursor-pointer", isActive && "font-medium")}
                >
                  <span className="mr-2">{meta.emoji}</span>
                  {meta.nativeName}
                  {isActive && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" />}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* User menu */}
        <Authenticated>
          <UserMenu />
        </Authenticated>
        <Unauthenticated>
          <SignInButton size="sm" className="h-8" signInText="Kirish" />
        </Unauthenticated>
      </div>
      {/* Global search */}
      <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
    </header>
  );
}

// User menu with platform admin link
function UserMenu() {
  const { t } = useTranslation("common");
  const { user, signout } = useAuth();
  const { lng } = useParams<{ lng: string }>();
  const navigate = useNavigate();
  const currentUser = useCurrentUser();
  const queryClient = useQueryClient();
  const [pinDialogOpen, setPinDialogOpen] = useState(false);

  // LOCK — sessiya saqlanadi (LOGOUT emas); PIN bo'lmasa avval o'rnatiladi
  const lockScreen = async () => {
    try {
      if ((await requestLock(queryClient)) === "needs_pin") setPinDialogOpen(true);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <>
    <SetPinDialog
      open={pinDialogOpen}
      onOpenChange={setPinDialogOpen}
      onSaved={() => {
        setPinDialogOpen(false);
        void lockScreen();
      }}
    />
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 gap-2 px-2">
          <div className="h-6 w-6 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-xs font-bold">
            {user?.name?.[0]?.toUpperCase() ?? "U"}
          </div>
          <span className="hidden sm:inline text-xs max-w-[100px] truncate">
            {user?.name ?? t("auth.welcome")}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <div className="px-3 py-2">
          <p className="font-medium text-sm">{user?.name ?? t("auth.welcome")}</p>
          <p className="text-xs text-muted-foreground">{user?.email}</p>
          {currentUser?.isPlatformAdmin && (
            <span className="inline-flex items-center gap-1 mt-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-500 border border-purple-500/20">
              <Shield className="h-2.5 w-2.5" />
              Platform Admin
            </span>
          )}
        </div>
        <DropdownMenuSeparator />
        {currentUser?.isPlatformAdmin && (
          <>
            <DropdownMenuItem
              className="cursor-pointer"
              onClick={() => navigate(`/${lng ?? "uz"}/admin`)}
            >
              <Shield className="mr-2 h-4 w-4 text-purple-500" />
              <span>Admin Panel</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem className="cursor-pointer" onClick={() => { void lockScreen(); }}>
          <Lock className="mr-2 h-4 w-4" />
          Ekranni bloklash
        </DropdownMenuItem>
        <DropdownMenuItem
          className="cursor-pointer text-destructive focus:text-destructive"
          onClick={() => signout?.()}
        >
          <LogOut className="mr-2 h-4 w-4" />
          {t("auth.sign_out")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    </>
  );
}

// Company switcher shown in topbar
function CompanySwitcher() {
  const { lng } = useParams<{ lng: string }>();
  const navigate = useNavigate();
  const currentUser = useCurrentUser();
  const myCompanies = useMyCompanies();
  const switchCompany = useSwitchCompany();
  const companies = (myCompanies ?? []).filter((c) => c.membershipActive);

  if (!currentUser || !currentUser.hasCompany) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="flex h-8 min-w-0 max-w-[110px] shrink gap-1.5 px-2 sm:max-w-[180px]">
          <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="text-xs font-medium truncate">
            <span className="md:hidden">
              {(currentUser.companyName ?? "").slice(0, 12)}
              {(currentUser.companyName ?? "").length > 12 ? "…" : ""}
            </span>
            <span className="hidden md:inline">{currentUser.companyName}</span>
          </span>
          {companies.length > 1 && <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />}
        </Button>
      </DropdownMenuTrigger>
      {/* Dropdown har doim ochiladi: bitta kompaniyasi bor foydalanuvchi ham
          "+ Yangi kompaniya" orqali ikkinchisini qo'sha olishi kerak. */}
      <DropdownMenuContent align="start" className="w-52">
        {companies.length > 1 &&
          companies.map((c) => (
          <DropdownMenuItem
            key={c.id}
            className="cursor-pointer"
            onClick={async () => {
              await switchCompany.mutateAsync(c.id);
              navigate(`/${companyPathKey(c.slug, c.id) ?? lng}/dashboard`);
            }}
          >
            <Building2 className="mr-2 h-4 w-4" />
            <span className="truncate">{c.name}</span>
            {c.isCurrent ? (
              <span className="ml-auto text-xs text-primary">✓</span>
            ) : (
              // Bir nechta biznes bitta brauzerda parallel — yangi tabda
              <a
                href={`/${companyPathKey(c.slug, c.id)}/dashboard`}
                target="_blank"
                rel="noopener"
                title="Yangi tabda ochish"
                aria-label={`${c.name} — yangi tabda ochish`}
                className="ml-auto rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={(event) => event.stopPropagation()}
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
          </DropdownMenuItem>
        ))}
        {companies.length > 1 && <DropdownMenuSeparator />}
        <DropdownMenuItem
          className="cursor-pointer text-muted-foreground text-xs"
          onClick={() => navigate(`/${lng}/onboarding`)}
        >
          + Yangi kompaniya
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MobileDrawerSidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <div className={cn("fixed inset-0 z-50 wide:hidden", !open && "pointer-events-none")}>
      {/* Backdrop overlay */}
      <div
        className={cn(
          "absolute inset-0 bg-black/50 transition-opacity duration-300",
          open ? "opacity-100" : "opacity-0"
        )}
        onClick={onClose}
      />
      {/* Sliding drawer panel */}
      <div
        className={cn(
          "absolute inset-y-0 left-0 transition-transform duration-300 ease-in-out shadow-2xl",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <SidebarNav collapsed={false} onToggle={onClose} onLinkClick={onClose} />
      </div>
    </div>
  );
}

function MobileBottomNav() {
  const { t } = useTranslation("common");
  const { lng } = useParams<{ lng: string }>();
  const location = useLocation();
  const mainModules = useVisibleModules().slice(0, 5);

  return (
    <nav className="fixed bottom-0 left-0 right-0 flex justify-around border-t border-border bg-card wide:hidden z-40 pb-safe">
      {mainModules.map((mod) => {
        const Icon = getIcon(mod.icon);
        const to = `/${lng}/${mod.path}`;
        const isActive = location.pathname === to || location.pathname.startsWith(`${to}/`);
        return (
          <NavLink
            key={mod.id}
            to={to}
            className={cn(
              "flex flex-col items-center gap-0.5 py-2 px-3 text-[10px] transition-colors",
              isActive ? "text-primary" : "text-muted-foreground"
            )}
          >
            <Icon className="h-5 w-5" />
            <span className="truncate max-w-[48px]">{t(mod.labelKey)}</span>
          </NavLink>
        );
      })}
    </nav>
  );
}

// ─── Suspended company screen ─────────────────────────────────────────────────

function SuspendedScreen({
  status, reason, companyName, lng,
}: {
  status: "suspended" | "cancelled";
  reason?: string;
  companyName: string;
  lng: string;
}) {
  const { signout } = useAuth();
  const myCompanies = useMyCompanies();
  const switchCompany = useSwitchCompany();
  const navigate = useNavigate();

  const otherCompanies = (myCompanies ?? []).filter(
    (c) => !c.isCurrent && c.membershipActive && c.isActive && c.status !== "suspended" && c.status !== "cancelled",
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-muted flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        <div className="text-center space-y-6">
          {/* Icon */}
          <div className={[
            "mx-auto h-20 w-20 rounded-2xl flex items-center justify-center",
            status === "suspended" ? "bg-amber-500/10 border-2 border-amber-500/30" : "bg-red-500/10 border-2 border-red-500/30",
          ].join(" ")}>
            <Shield className={`h-10 w-10 ${status === "suspended" ? "text-amber-500" : "text-red-500"}`} />
          </div>

          {/* Title */}
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              {status === "suspended" ? "Hisob to'xtatilgan" : "Hisob tugatilgan"}
            </h1>
            <p className="text-muted-foreground mt-2 text-sm">
              <span className="font-medium">{companyName}</span>{" "}
              {status === "suspended"
                ? "kompaniyasi vaqtincha to'xtatilgan."
                : "kompaniyasi tugatilgan."}
            </p>
          </div>

          {/* Reason */}
          {reason && (
            <div className={[
              "p-4 rounded-xl text-sm text-left border",
              status === "suspended"
                ? "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300"
                : "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800 text-red-800 dark:text-red-300",
            ].join(" ")}>
              <p className="font-semibold mb-1 text-xs uppercase tracking-wide">Sabab</p>
              <p>{reason}</p>
            </div>
          )}

          {/* Contact info */}
          <div className="p-4 rounded-xl bg-muted/50 border border-border text-sm text-muted-foreground text-left">
            <p className="font-semibold text-foreground mb-1">Nima qilish kerak?</p>
            <ul className="list-disc list-inside space-y-1 text-xs">
              <li>BUM ERP qo'llab-quvvatlash bilan bog'laning</li>
              <li>Email: <span className="text-primary">support@bum-erp.uz</span></li>
              <li>Muammo hal bo'lgandan keyin kirish tiklangach sizga xabar beriladi</li>
            </ul>
          </div>

          {/* Switch to another company if available */}
          {otherCompanies.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
                Boshqa kompaniyaga o'ting
              </p>
              {otherCompanies.map((c) => (
                <button
                  key={c.id}
                  onClick={async () => {
                    await switchCompany.mutateAsync(c.id);
                    navigate(`/${lng}/dashboard`);
                  }}
                  className="w-full flex items-center gap-3 p-3 rounded-xl border border-border hover:border-primary/40 hover:bg-accent transition-colors text-left"
                >
                  <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="text-sm font-medium">{c.name}</span>
                </button>
              ))}
            </div>
          )}

          {/* Sign out */}
          <Button variant="ghost" onClick={() => signout()} className="w-full text-muted-foreground">
            <LogOut className="h-4 w-4 mr-2" />
            Tizimdan chiqish
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Litsenziyasi yo'q xodim ekrani ───────────────────────────────────────────

function LicenseBlockedScreen({ reason, companyName, lng }: { reason: AccessDenialReason; companyName: string; lng: string }) {
  const { signout } = useAuth();
  const myCompanies = useMyCompanies();
  const switchCompany = useSwitchCompany();
  const navigate = useNavigate();
  const otherCompanies = (myCompanies ?? []).filter((c) => !c.isCurrent && c.membershipActive && c.isActive);

  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-muted flex items-center justify-center p-4">
      <div className="max-w-md w-full text-center space-y-6">
        <div className="mx-auto h-20 w-20 rounded-2xl flex items-center justify-center bg-amber-500/10 border-2 border-amber-500/30">
          <KeyRound className="h-10 w-10 text-amber-500" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">{ACCESS_DENIAL_LABEL[reason]}</h1>
          <p className="text-muted-foreground mt-2 text-sm">
            <span className="font-medium">{companyName}</span> kompaniyasida BUM ERP dasturidan foydalanish uchun faol litsenziya kerak.
            Kompaniya egasiga murojaat qiling.
          </p>
        </div>
        {otherCompanies.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Boshqa kompaniyaga o'ting</p>
            {otherCompanies.map((c) => (
              <button
                key={c.id}
                onClick={async () => {
                  await switchCompany.mutateAsync(c.id);
                  navigate(`/${companyPathKey(c.slug, c.id) ?? lng}/dashboard`);
                }}
                className="w-full flex items-center gap-3 p-3 rounded-xl border border-border hover:border-primary/40 hover:bg-accent transition-colors text-left"
              >
                <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="text-sm font-medium">{c.name}</span>
              </button>
            ))}
          </div>
        )}
        <Button variant="ghost" onClick={() => signout()} className="w-full text-muted-foreground">
          <LogOut className="h-4 w-4 mr-2" />
          Tizimdan chiqish
        </Button>
      </div>
    </div>
  );
}

// ─── Trial ogohlantirishi / obuna tugagani ────────────────────────────────────

function SubscriptionBanner() {
  const { lng = "uz" } = useParams<{ lng: string }>();
  const me = useCurrentUser();
  const permissions = useActiveCompany(Boolean(me?.hasCompany)).data?.permissions;
  const subscription = me?.subscription;
  if (!subscription) return null;
  const blocked = subscriptionBlocked(subscription);
  if (!blocked && subscription.trialWarning === null) return null;
  const canView = permissions?.includes("subscription.view") ?? false;

  return (
    <div
      role="status"
      className={cn(
        "px-4 py-2 text-sm flex flex-wrap items-center gap-x-3 gap-y-1 border-b shrink-0",
        blocked
          ? "bg-destructive/10 border-destructive/20 text-destructive"
          : "bg-amber-50 border-amber-200 text-amber-900 dark:bg-amber-950/30 dark:border-amber-800 dark:text-amber-200",
      )}
    >
      <span className="font-medium">
        {blocked
          ? `BUM ERP obunangiz muddati tugagan (${formatDay(subscription.expiresAt)}). Faqat Bosh sahifa va Obuna ochiq.`
          : `BUM ERP sinov muddati tugashiga ${subscription.daysLeft} kun qoldi (${formatDay(subscription.expiresAt)}).`}
      </span>
      {canView ? (
        <NavLink to={`/${lng}/subscription`} className="underline font-semibold">
          {blocked ? "OBUNANI UZAYTIRISH" : "Obunani faollashtirish"}
        </NavLink>
      ) : (
        <span className="opacity-80">Kompaniya egasiga murojaat qiling.</span>
      )}
    </div>
  );
}

// Main layout
export default function ERPLayout({ children }: { children: React.ReactNode }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const { lng } = useParams<{ lng: string }>();
  const location = useLocation();
  const currentUser = useCurrentUser();
  const myCompanies = useMyCompanies(Boolean(currentUser));
  const permissions = useActiveCompany(Boolean(currentUser?.hasCompany)).data?.permissions;
  const queryClient = useQueryClient();

  // Boshqa oynada qulflangan sessiya (423) — /me qayta olinadi va qulf ekrani chiqadi
  useEffect(() => {
    const onLocked = () => { void queryClient.invalidateQueries({ queryKey: AUTH_ME_KEY }); };
    window.addEventListener(LOCKED_EVENT, onLocked);
    return () => window.removeEventListener(LOCKED_EVENT, onLocked);
  }, [queryClient]);

  // HARD BLOCK: admin subdomain must NEVER show ERP layout or onboarding.
  // Redirect to /admin immediately regardless of auth state.
  if (isAdminSubdomain()) {
    return <Navigate to={`/${lng ?? "uz"}/admin`} replace />;
  }

  // Guard: unauthenticated user → BUM ERP branded login page
  // currentUser===undefined means still loading — don't redirect yet.
  if (currentUser === null) {
    return <Navigate to="/" replace state={{ from: location }} />;
  }

  // Ekran qulflangan — sessiya saqlangan, faqat PIN bilan ochiladi
  if (currentUser?.sessionLocked) {
    return <LockScreen me={currentUser} />;
  }

  // Guard: authenticated user with no company.
  // Platform admins without a company go to the admin panel; everyone else onboards.
  // currentUser===undefined means still loading — don't redirect yet.
  if (currentUser !== undefined && currentUser !== null) {
    if (!currentUser.hasCompany && currentUser.isPlatformAdmin) {
      return <Navigate to={`/${lng ?? "uz"}/admin`} replace />;
    }
    // User has multiple memberships but no active company → show selector
    const companies = myCompanies ?? [];
    if (!currentUser.activeCompanyId && companies.length > 1 && myCompanies !== undefined) {
      return <Navigate to={`/${lng ?? "uz"}/select-company`} replace />;
    }
    if (!currentUser.hasCompany && !currentUser.isPlatformAdmin) {
      return <Navigate to={`/${lng ?? "uz"}/onboarding`} replace state={{ from: location }} />;
    }
  }

  // Guard: company suspended or cancelled — show professional block screen
  // (holat /me dan — bunday kompaniyada tenant so'rovlari 403 qaytaradi)
  if (currentUser && (currentUser.companyStatus === "suspended" || currentUser.companyStatus === "cancelled")) {
    return (
      <SuspendedScreen
        status={currentUser.companyStatus}
        reason={currentUser.companySuspendReason ?? undefined}
        companyName={currentUser.companyName ?? ""}
        lng={lng ?? "uz"}
      />
    );
  }

  // Litsenziyasi yo'q / to'lanmagan / tugagan xodim — server ham rad etadi
  if (currentUser?.licenseDenial) {
    return (
      <LicenseBlockedScreen reason={currentUser.licenseDenial} companyName={currentUser.companyName ?? ""} lng={lng ?? "uz"} />
    );
  }

  // Obuna tugagan — faqat Bosh sahifa va Obuna (ma'lumot o'chmaydi, uzaytirilgach hammasi ochiladi)
  if (currentUser && subscriptionBlocked(currentUser.subscription)) {
    const section = location.pathname.split("/")[2] ?? "";
    if (section !== "dashboard" && section !== "subscription") {
      return <Navigate to={`/${lng ?? "uz"}/dashboard`} replace />;
    }
  }

  // Faqat sotuv agenti ruxsati bor xodim — mobil ish joyiga (ERP menyusi unga kerak emas)
  if (permissions && isAgentOnly(permissions)) {
    return <Navigate to={`/${lng ?? "uz"}/sales-agent`} replace />;
  }
  // Faqat yetkazuvchi (DELIVERY_AGENT) ruxsati bor xodim — yetkazuvchi mobil ish joyiga
  if (permissions && isDeliveryAgentOnly(permissions)) {
    return <Navigate to={`/${lng ?? "uz"}/delivery-agent`} replace />;
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Desktop sidebar */}
      <div className="hidden wide:flex shrink-0">
        <SidebarNav collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(!sidebarCollapsed)} />
      </div>

      {/* Mobile drawer sidebar */}
      <MobileDrawerSidebar open={mobileDrawerOpen} onClose={() => setMobileDrawerOpen(false)} />

      {/* Main content area */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <TopBar onMenuToggle={() => setMobileDrawerOpen(true)} />
        <SubscriptionBanner />
        {/* flex-col: to'liq balandlikni egallashi kerak sahifalar (kassa) `flex-1 min-h-0` bilan aynan
            shu joyga sig'adi. pb-16 — pastki mobil menyu uchun, u `wide:` da yashiriladi. */}
        <main className="flex flex-col flex-1 overflow-auto pb-16 wide:pb-0">
          {children}
        </main>
      </div>

      {/* Mobile bottom nav */}
      <MobileBottomNav />

      {/* PWA install banner */}
      <PWAInstallBanner />
    </div>
  );
}
