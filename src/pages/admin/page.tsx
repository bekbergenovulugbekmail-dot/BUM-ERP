/**
 * Platform Admin Panel
 * Route: /:lng/admin   AND   admin.bum-erp.uz (any path)
 *
 * On admin subdomain: AdminLoginPage → AdminDashboard (faqat isPlatformAdmin)
 * On app subdomain: simple isPlatformAdmin guard (direct link to /admin)
 *
 * Bootstrap sahifasi yo'q: birinchi (bootstrap) admin serverda `.env` + `db:seed` orqali yaratiladi.
 */
import { useState } from "react";
import { useParams, Link, Navigate } from "react-router-dom";
import { motion } from "motion/react";
import {
  LayoutDashboard, Building2, Users, ListChecks,
  Shield, Layers, ArrowLeft, Settings, PlusCircle, ExternalLink, LogOut, MonitorDown,
} from "lucide-react";
import { cn } from "@/lib/utils.ts";
import { isAdminSubdomain } from "@/lib/subdomain.ts";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { useAuth, useCurrentUser } from "@/hooks/use-auth.ts";
import AdminOverview         from "./_components/admin-overview.tsx";
import AdminCompanies        from "./_components/admin-companies.tsx";
import AdminAuditLog         from "./_components/admin-audit-log.tsx";
import AdminUsers            from "./_components/admin-users.tsx";
import AdminCreateCompany    from "./_components/admin-create-company.tsx";
import AdminPlatformSettings from "./_components/admin-platform-settings.tsx";
import AdminDesktopReleases  from "./_components/admin-desktop-releases.tsx";
import AdminLoginPage        from "./login.tsx";

// ─── Types ────────────────────────────────────────────────────────────────────
type Tab = "overview" | "companies" | "create-company" | "users" | "audit" | "desktop" | "settings";

const TABS: { id: Tab; label: string; icon: React.FC<{ className?: string }> }[] = [
  { id: "overview",        label: "Umumiy ko'rinish",  icon: LayoutDashboard },
  { id: "companies",       label: "Kompaniyalar",       icon: Building2 },
  { id: "create-company",  label: "Yangi kompaniya",    icon: PlusCircle },
  { id: "users",           label: "Foydalanuvchilar",   icon: Users },
  { id: "audit",           label: "Audit jurnali",      icon: ListChecks },
  { id: "desktop",         label: "Desktop kassa",      icon: MonitorDown },
  { id: "settings",        label: "Sozlamalar",          icon: Settings },
];

// ─── Surface detection ────────────────────────────────────────────────────────
// On admin subdomain we enforce full login flow.
// On app subdomain we do a simple guard (user navigated to /admin directly).

export default function AdminPage() {
  const onAdminSurface = isAdminSubdomain();

  if (onAdminSurface) {
    return <AdminSurface />;
  }
  return <AdminDashboardGuarded />;
}

// ─── Admin subdomain: login → dashboard ──────────────────────────────────────
function AdminSurface() {
  const currentUser = useCurrentUser();

  // Kirish muvaffaqiyatli bo'lsa /me keshi yangilanadi va shu yerda panel ochiladi
  if (currentUser?.isPlatformAdmin) {
    return <AdminDashboard />;
  }
  return <AdminLoginPage />;
}

// ─── App subdomain: /admin route with simple guard ───────────────────────────
function AdminDashboardGuarded() {
  const { lng = "uz" } = useParams<{ lng: string }>();
  const currentUser = useCurrentUser();

  if (currentUser === undefined) return <AdminSkeleton />;
  if (currentUser === null) return <Navigate to={`/${lng}/login`} replace />;

  if (!currentUser.isPlatformAdmin) {
    return <AccessDenied lng={lng} showBack />;
  }

  return <AdminDashboard />;
}

// ─── The actual dashboard (shared) ───────────────────────────────────────────
function AdminDashboard() {
  const { lng = "uz" } = useParams<{ lng: string }>();
  const onAdminSurface = isAdminSubdomain();
  const { signout } = useAuth();
  const [tab, setTab] = useState<Tab>("overview");

  return (
    <div className="min-h-screen bg-[oklch(0.10_0.02_255)]">
      {/* ── Top navigation bar ─────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-white/8 bg-[oklch(0.12_0.025_255)]/95 backdrop-blur">
        <div className="max-w-7xl mx-auto flex items-center gap-3 px-4 h-14">

          {/* Logo */}
          <div className="flex items-center gap-2 text-white shrink-0 mr-2">
            <div className="h-7 w-7 rounded-lg bg-primary/90 flex items-center justify-center">
              <Layers className="h-4 w-4" />
            </div>
            <div className="hidden sm:flex items-center gap-1.5">
              <span className="font-bold text-sm tracking-tight">BUM ERP</span>
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-primary/20 text-primary border border-primary/30 leading-none">
                ADMIN
              </span>
            </div>
          </div>

          {/* Tab nav */}
          <nav className="flex items-center gap-0.5 flex-1 overflow-x-auto scrollbar-none min-w-0">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  "flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0",
                  tab === t.id
                    ? "bg-white/10 text-white"
                    : "text-white/50 hover:text-white/80 hover:bg-white/5",
                )}
              >
                <t.icon className="h-4 w-4 shrink-0" />
                <span className="hidden md:inline">{t.label}</span>
              </button>
            ))}
          </nav>

          {/* Right action */}
          {onAdminSurface ? (
            <div className="flex items-center gap-3 shrink-0 ml-auto">
              <a
                href="https://app.bum-erp.uz"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-xs text-white/50 hover:text-white transition-colors"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">app.bum-erp.uz</span>
              </a>
              <button
                onClick={() => signout()}
                className="flex items-center gap-1.5 text-xs text-white/50 hover:text-white transition-colors cursor-pointer"
                title="Chiqish"
              >
                <LogOut className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <Link
              to={`/${lng}/dashboard`}
              className="flex items-center gap-1.5 text-xs text-white/50 hover:text-white transition-colors shrink-0 ml-auto"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">ERP ga qaytish</span>
            </Link>
          )}
        </div>
      </header>

      {/* ── Page content ─────────────────────────────────────────────────── */}
      <main className="max-w-7xl mx-auto px-4 py-6">
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18 }}
        >
          {tab === "overview"        && <AdminOverview  />}
          {tab === "companies"       && <AdminCompanies />}
          {tab === "create-company"  && <AdminCreateCompany />}
          {tab === "users"           && <AdminUsers     />}
          {tab === "audit"           && <AdminAuditLog  />}
          {tab === "desktop"         && <AdminDesktopReleases />}
          {tab === "settings"        && <AdminPlatformSettings />}
        </motion.div>
      </main>
    </div>
  );
}

// ─── Shared: Access Denied ────────────────────────────────────────────────────
function AccessDenied({ lng, showBack = false }: { lng: string; showBack?: boolean }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[oklch(0.10_0.02_255)]">
      <div className="text-center space-y-4">
        <div className="h-16 w-16 rounded-2xl bg-destructive/10 flex items-center justify-center mx-auto">
          <Shield className="h-8 w-8 text-destructive" />
        </div>
        <h1 className="text-xl font-bold text-white">Kirish taqiqlangan</h1>
        <p className="text-sm text-white/50">Bu sahifa faqat platforma adminlari uchun</p>
        {showBack && (
          <Link
            to={`/${lng}/dashboard`}
            className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
          >
            <ArrowLeft className="h-4 w-4" />
            Dashboardga qaytish
          </Link>
        )}
      </div>
    </div>
  );
}

// ─── Loading skeleton ─────────────────────────────────────────────────────────
function AdminSkeleton() {
  return (
    <div className="min-h-screen bg-[oklch(0.10_0.02_255)]">
      <div className="h-14 border-b border-white/8 bg-[oklch(0.12_0.025_255)]" />
      <div className="max-w-7xl mx-auto px-4 py-6 space-y-4">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 bg-white/5" />
          ))}
        </div>
        <Skeleton className="h-96 bg-white/5" />
      </div>
    </div>
  );
}
