/**
 * Sotuv agenti ish joyi — mobil birinchi: yuqorida agent, lokatsiya holati va til, pastda 5 bo'limli navigatsiya.
 * ERP menyusi ko'rinmaydi. Kirish: `sales_agent.use`; agent ma'lumoti `GET /api/sales-agent/me` dan
 * (bo'lmasa — "biriktirilmagan" ekrani). Lokatsiya kuzatuvi shu yerda bitta; ruxsat berilmasa ish joyi bloklanadi.
 * Asosiy himoya — serverda.
 */
import { useCallback, useEffect } from "react";
import ErrorBoundary from "@/components/error-boundary.tsx";
import { NavLink, Navigate, Outlet, useLocation, useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  LayoutDashboard, ShoppingCart, Users, Home, BadgePercent, BarChart3, LogOut, Globe, UserX, RefreshCw, MapPin, MapPinOff, WifiOff, UserCheck,
  type LucideIcon,
} from "lucide-react";
import { DEFAULT_SALES_AGENT_POLICY, type SalesAgentPolicy } from "@bum/shared";
import { cn } from "@/lib/utils.ts";
import { ApiError, api, errorMessage } from "@/lib/api.ts";
import { isAgentOnly } from "@/lib/agent-access.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";
import { useAuth, useCurrentUser } from "@/hooks/use-auth.ts";
import { usePermissions } from "@/hooks/use-company.ts";
import { Button } from "@/components/ui/button.tsx";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.tsx";
import { SUPPORTED_LOCALES, SUPPORTED_LOCALES_ARRAY, changeLocale, pathHasLocale, setLocaleInPath } from "@/i18n.ts";
import { AgentLocationContext } from "./_lib/agent-location.ts";
import { useLocationTracking, type AgentLocation } from "./_lib/use-location-tracking.ts";
import { useOnline } from "./_lib/use-online.ts";
import { setActAs, useActAs } from "@/lib/act-as.ts";
import type { AgentMe, WorkSession } from "./_lib/types.ts";

const NAV: { path: string; labelKey: string; icon: LucideIcon }[] = [
  { path: "dashboard", labelKey: "nav.dashboard", icon: LayoutDashboard },
  { path: "sales", labelKey: "nav.sales", icon: ShoppingCart },
  { path: "customers", labelKey: "nav.customers", icon: Users },
  { path: "promotions", labelKey: "nav.promotions", icon: BadgePercent },
  { path: "reports", labelKey: "nav.reports", icon: BarChart3 },
];

function Spinner() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
    </div>
  );
}

export function LanguageMenu() {
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
            onClick={() => {
              // Biznes manzilida (/{biznes}/sales-agent) til URL'da emas — faqat almashtiriladi
              if (pathHasLocale(location.pathname)) navigate(setLocaleInPath(code, location.pathname, location.search, location.hash));
              else void changeLocale(code);
            }}
          >
            <span className="mr-2">{SUPPORTED_LOCALES[code].emoji}</span>
            {SUPPORTED_LOCALES[code].nativeName}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Sarlavhadagi lokatsiya belgisi: yashil — faol, sariq — server rad etdi, qizil — o'chiq. */
function LocationIndicator({ location, onDuty }: { location: AgentLocation; onDuty: boolean }) {
  const { t } = useTranslation("agent");
  const off = !onDuty || location.status === "denied" || location.status === "unavailable";
  const label = !onDuty
    ? t("location.status.off_duty")
    : off
      ? t("location.status.off")
    : location.status === "active"
      ? t("location.status.active")
      : location.status === "rejected"
        ? t("location.status.problem")
        : t("location.locating");
  const Icon = off ? MapPinOff : MapPin;
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn(
        "flex h-10 w-10 items-center justify-center",
        !onDuty ? "text-muted-foreground" : off ? "text-destructive" : location.status === "active" ? "text-emerald-600" : location.status === "rejected" ? "text-amber-600" : "text-muted-foreground",
      )}
    >
      <Icon className={cn("h-5 w-5", location.status === "locating" && "animate-pulse")} />
    </span>
  );
}

function LocationRequired({ onRequest }: { onRequest: () => void }) {
  const { t } = useTranslation("agent");
  return (
    <div className="flex flex-col items-center justify-center text-center px-6 py-16">
      <div className="h-16 w-16 rounded-2xl bg-destructive/10 flex items-center justify-center mb-4">
        <MapPinOff className="h-8 w-8 text-destructive" />
      </div>
      <h2 className="text-lg font-semibold">{t("location.required.title")}</h2>
      <p className="text-sm mt-1 max-w-xs">{t("location.denied")}</p>
      <p className="text-xs text-muted-foreground mt-2 max-w-xs">{t("location.required.help")}</p>
      <Button className="mt-6 h-12 w-full max-w-xs text-base" onClick={onRequest}>
        <MapPin className="h-5 w-5 mr-2" /> {t("location.enable")}
      </Button>
    </div>
  );
}

export default function SalesAgentLayout() {
  const { t } = useTranslation("agent");
  const { lng = "uz" } = useParams<{ lng: string }>();
  const { signout } = useAuth();
  const currentUser = useCurrentUser();
  const { can, permissions, isLoading: permissionsLoading } = usePermissions();
  // Supervayzer agent nomidan: agent ish joyi shu agent kontekstida (server `sales_agent.supervise` va jamoani tekshiradi)
  const actAs = useActAs();
  const acting = Boolean(actAs && can("sales_agent.supervise"));
  const allowed = can("sales_agent.use") || acting;
  const meQuery = useApiQuery<AgentMe>(allowed ? "/api/sales-agent/me" : null);
  const policy = useApiQuery<{ policy: SalesAgentPolicy }>(meQuery.data ? "/api/sales-agent/policy" : null).data?.policy;
  // Lokatsiya faqat ish vaqtida (faol ish sessiyasi) kuzatiladi — shaxsiy vaqtda brauzer GPS'i so'ralmaydi
  // Agent nomidan ishlaganda supervayzer qurilmasining GPS'i agent nomidan kuzatilmaydi (ish sessiyasi — agentniki)
  const workSession = useApiQuery<{ session: WorkSession | null }>(meQuery.data && !acting ? "/api/sales-agent/work-session" : null, undefined, {
    refetchInterval: 60_000,
  }).data?.session;
  const onDuty = workSession?.status === "active";
  const queryClient = useQueryClient();
  const onSessionEnded = useCallback(() => void queryClient.invalidateQueries({ queryKey: ["/api/sales-agent/work-session"] }), [queryClient]);
  const location = useLocationTracking(
    onDuty,
    policy?.trackingIntervalSeconds ?? DEFAULT_SALES_AGENT_POLICY.trackingIntervalSeconds,
    onSessionEnded,
  );
  // Xato chegarasi sahifa almashganda tiklanishi uchun — YO'L, joylashuv holati emas
  const { pathname } = useLocation();
  const online = useOnline();
  const navigate = useNavigate();
  // Supervayzer agentdek savdo qiladi: o'z savdo profili bo'lmasa — bir marta yaratiladi (server faqat o'ziga yaratadi)
  const ensureProfile = useApiMutation(() => api.post("/api/sales-agent/supervisor/profile"), { invalidate: ["/api/sales-agent"] });
  const needsOwnProfile =
    !acting && can("sales_agent.supervise") && meQuery.error instanceof ApiError && meQuery.error.status === 403;
  const { mutate: createProfile, isIdle: profileIdle } = ensureProfile;
  useEffect(() => {
    if (needsOwnProfile && profileIdle) createProfile();
  }, [needsOwnProfile, profileIdle, createProfile]);

  if (currentUser === null) return <Navigate to={`/${lng}/login`} replace />;
  if (currentUser === undefined) return <Spinner />;
  if (!currentUser.hasCompany) return <Navigate to={`/${lng}/dashboard`} replace />;
  if (permissionsLoading) return <Spinner />;
  if (!allowed) return <Navigate to={`/${lng}/dashboard`} replace />;

  const stopActing = () => {
    setActAs(null);
    queryClient.removeQueries({ predicate: (query) => String(query.queryKey[0] ?? "").startsWith("/api/sales-agent") });
    navigate(`/${lng}/distribution?tab=supervisor`);
  };

  const header = (
    <>
    {acting && actAs && (
      <div role="status" data-testid="act-as-banner" className="sticky top-0 z-40 flex items-center gap-2 bg-indigo-600 px-4 py-2 text-xs font-medium text-white">
        <UserCheck className="h-4 w-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate">
          Agent nomidan: <b>{actAs.name}</b> · kiritgan: {currentUser.name ?? "supervayzer"} (audit)
        </span>
        <Button size="sm" variant="secondary" className="h-7" onClick={stopActing}>Tugatish</Button>
      </div>
    )}
    <header className="sticky top-0 z-30 flex items-center gap-1 px-4 h-14 border-b border-border bg-card/95 backdrop-blur">
      <div className="min-w-0 flex-1 pr-2">
        <p className="text-sm font-semibold truncate">{meQuery.data?.agent.name ?? currentUser.name ?? t("title")}</p>
        <p className="text-[11px] text-muted-foreground truncate">{currentUser.companyName}</p>
      </div>
      {meQuery.data && <LocationIndicator location={location} onDuty={onDuty} />}
      {permissions && !isAgentOnly(permissions) && (
        <Button asChild variant="ghost" size="icon" className="h-10 w-10" title="ERP">
          <NavLink to={`/${lng}/dashboard`} aria-label="ERP" data-testid="agent-back-to-erp">
            <Home className="h-5 w-5" />
          </NavLink>
        </Button>
      )}
      <LanguageMenu />
      <Button variant="ghost" size="icon" className="h-10 w-10" title={t("logout")} onClick={() => signout()}>
        <LogOut className="h-5 w-5" />
      </Button>
    </header>
    </>
  );

  // Supervayzer profili yaratilmoqda — "bog'lanmagan" xabari ko'rsatilmaydi
  if (meQuery.isError && needsOwnProfile && ((!ensureProfile.isSuccess && !ensureProfile.isError) || meQuery.isFetching)) return <Spinner />;

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
    <AgentLocationContext.Provider value={location}>
      <div className="min-h-screen bg-background flex flex-col">
        {header}
        {!online && (
          <div role="status" className="sticky top-14 z-20 flex items-center gap-2 bg-amber-500 px-4 py-2 text-xs font-medium text-white">
            <WifiOff className="h-4 w-4 shrink-0" /> {t("offline.banner")}
          </div>
        )}
        <main className="flex-1 pb-24">
          {!meQuery.data ? (
            <Spinner />
          ) : onDuty && location.status === "denied" ? (
            <LocationRequired onRequest={location.request} />
          ) : (
            <ErrorBoundary area="Sotuv agenti" resetKey={pathname}>
              <Outlet context={meQuery.data} />
            </ErrorBoundary>
          )}
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
    </AgentLocationContext.Provider>
  );
}
