/**
 * Sotuv agenti ish joyi — mobil birinchi: yuqorida agent va til, pastda 5 bo'limli navigatsiya.
 * ERP menyusi ko'rinmaydi. Kirish: `sales_agent.use`; agent ma'lumoti `GET /api/sales-agent/me` dan
 * (bo'lmasa — "biriktirilmagan" ekrani). Asosiy himoya — serverda.
 */
import { NavLink, Navigate, Outlet, useLocation, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  LayoutDashboard, ShoppingCart, Wallet, Store, BadgePercent, LogOut, Globe, UserX, RefreshCw,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils.ts";
import { ApiError, errorMessage } from "@/lib/api.ts";
import { useApiQuery } from "@/lib/query.ts";
import { useAuth, useCurrentUser } from "@/hooks/use-auth.ts";
import { usePermissions } from "@/hooks/use-company.ts";
import { Button } from "@/components/ui/button.tsx";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.tsx";
import { SUPPORTED_LOCALES, SUPPORTED_LOCALES_ARRAY, setLocaleInPath } from "@/i18n.ts";
import type { AgentMe } from "./_lib/types.ts";

const NAV: { path: string; labelKey: string; icon: LucideIcon }[] = [
  { path: "dashboard", labelKey: "nav.dashboard", icon: LayoutDashboard },
  { path: "sales", labelKey: "nav.sales", icon: ShoppingCart },
  { path: "debtors", labelKey: "nav.debtors", icon: Wallet },
  { path: "stores", labelKey: "nav.stores", icon: Store },
  { path: "promotions", labelKey: "nav.promotions", icon: BadgePercent },
];

function Spinner() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
    </div>
  );
}

function LanguageMenu() {
  const { i18n } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-10 w-10">
          <Globe className="h-5 w-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {SUPPORTED_LOCALES_ARRAY.map((code) => (
          <DropdownMenuItem
            key={code}
            className={cn("cursor-pointer", i18n.language === code && "font-medium")}
            onClick={() => navigate(setLocaleInPath(code, location.pathname, location.search, location.hash))}
          >
            <span className="mr-2">{SUPPORTED_LOCALES[code].emoji}</span>
            {SUPPORTED_LOCALES[code].nativeName}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default function SalesAgentLayout() {
  const { t } = useTranslation("agent");
  const { lng = "uz" } = useParams<{ lng: string }>();
  const { signout } = useAuth();
  const currentUser = useCurrentUser();
  const { can, isLoading: permissionsLoading } = usePermissions();
  const allowed = can("sales_agent.use");
  const meQuery = useApiQuery<AgentMe>(allowed ? "/api/sales-agent/me" : null);

  if (currentUser === null) return <Navigate to={`/${lng}/login`} replace />;
  if (currentUser === undefined) return <Spinner />;
  if (!currentUser.hasCompany) return <Navigate to={`/${lng}/dashboard`} replace />;
  if (permissionsLoading) return <Spinner />;
  if (!allowed) return <Navigate to={`/${lng}/dashboard`} replace />;

  const header = (
    <header className="sticky top-0 z-30 flex items-center gap-3 px-4 h-14 border-b border-border bg-card/95 backdrop-blur">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold truncate">{meQuery.data?.agent.name ?? currentUser.name ?? t("title")}</p>
        <p className="text-[11px] text-muted-foreground truncate">{currentUser.companyName}</p>
      </div>
      <LanguageMenu />
      <Button variant="ghost" size="icon" className="h-10 w-10" title={t("logout")} onClick={() => signout()}>
        <LogOut className="h-5 w-5" />
      </Button>
    </header>
  );

  if (meQuery.isError) {
    const notLinked = meQuery.error instanceof ApiError && (meQuery.error.status === 403 || meQuery.error.status === 404);
    return (
      <div className="min-h-screen bg-background">
        {header}
        <div className="flex flex-col items-center justify-center text-center px-6 py-20">
          <div className="h-16 w-16 rounded-2xl bg-amber-500/10 flex items-center justify-center mb-4">
            <UserX className="h-8 w-8 text-amber-600" />
          </div>
          <h2 className="text-lg font-semibold">{notLinked ? t("not_linked.title") : t("error.title")}</h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-xs">
            {notLinked ? t("not_linked.message") : errorMessage(meQuery.error)}
          </p>
          {!notLinked && (
            <Button variant="secondary" className="mt-5 h-11" onClick={() => void meQuery.refetch()}>
              <RefreshCw className="h-4 w-4 mr-2" /> {t("error.retry")}
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {header}
      <main className="flex-1 pb-24">
        {meQuery.data ? <Outlet context={meQuery.data} /> : <Spinner />}
      </main>
      <nav className="fixed bottom-0 inset-x-0 z-30 grid grid-cols-5 border-t border-border bg-card pb-safe">
        {NAV.map((item) => (
          <NavLink
            key={item.path}
            to={`/${lng}/sales-agent/${item.path}`}
            className={({ isActive }) =>
              cn(
                "flex flex-col items-center justify-center gap-1 min-h-16 text-[11px] font-medium transition-colors",
                isActive ? "text-primary" : "text-muted-foreground",
              )
            }
          >
            <item.icon className="h-6 w-6" />
            <span className="truncate max-w-full px-1">{t(item.labelKey)}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
