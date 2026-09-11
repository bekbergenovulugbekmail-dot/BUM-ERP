/**
 * Company Selector Page — /select-company  (or /:lng/select-company)
 *
 * Shown when an authenticated user belongs to 2+ companies and
 * has NOT yet set an activeCompanyId (or just logged in fresh).
 *
 * UX flow:
 *   1. User logs in (telefon + parol, /api/auth/login)
 *   2. Auth callback → / → RootRedirect → /:lng
 *   3. ERPLayout guard detects no activeCompany → this page
 *   4. User picks a company → switchCompany mutation → /dashboard
 *
 * Also accessible from the sidebar switcher for quick switching.
 */
import { useParams, useNavigate } from "react-router-dom";
import { useState } from "react";
import { useCurrentUser } from "@/hooks/use-auth.ts";
import { useMyCompanies, useSwitchCompany } from "@/hooks/use-company.ts";
import { motion } from "motion/react";
import {
  Building2, Layers, CheckCircle, Loader2, LogIn,
  ChevronRight, Clock,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { SignInButton } from "@/components/ui/signin.tsx";
import { Authenticated, Unauthenticated, AuthLoading } from "@/components/auth-gates.tsx";
import { format } from "date-fns";

export default function SelectCompanyPage() {
  return (
    <div className="min-h-screen bg-[oklch(0.09_0.02_255)] flex flex-col">
      {/* Ambient */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-15%] left-1/2 -translate-x-1/2 w-[500px] h-[500px] rounded-full bg-primary/6 blur-[120px]" />
      </div>

      {/* Top bar */}
      <header className="relative z-10 flex items-center gap-2 px-5 py-4 border-b border-white/6">
        <div className="h-6 w-6 rounded-md bg-primary/90 flex items-center justify-center">
          <Layers className="h-3.5 w-3.5 text-white" />
        </div>
        <span className="text-sm font-semibold text-white/60">BUM ERP</span>
      </header>

      <main className="relative z-10 flex-1 flex items-center justify-center px-4 py-12">
        <AuthLoading>
          <LoadingCard />
        </AuthLoading>
        <Unauthenticated>
          <UnauthCard />
        </Unauthenticated>
        <Authenticated>
          <CompanyList />
        </Authenticated>
      </main>
    </div>
  );
}

// ─── Company list (authenticated) ────────────────────────────────────────────
function CompanyList() {
  const { lng = "uz" } = useParams<{ lng: string }>();
  const navigate = useNavigate();
  const myCompanies = useMyCompanies();
  const switchCompany = useSwitchCompany();
  const currentUser = useCurrentUser();
  const [switching, setSwitching] = useState<string | null>(null);

  const handleSelect = async (companyId: string) => {
    setSwitching(companyId);
    try {
      await switchCompany.mutateAsync(companyId);
      navigate(`/${lng}/dashboard`, { replace: true });
    } catch {
      setSwitching(null);
    }
  };

  if (myCompanies === undefined || currentUser === undefined) {
    return <LoadingCard />;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className="w-full max-w-md"
    >
      {/* Header */}
      <div className="text-center mb-6">
        <div className="h-14 w-14 rounded-2xl bg-primary/15 border border-primary/25 flex items-center justify-center mx-auto mb-4">
          <Building2 className="h-7 w-7 text-primary" />
        </div>
        <h1 className="text-xl font-bold text-white">Biznesingizni tanlang</h1>
        <p className="text-sm text-white/40 mt-1">
          {currentUser?.name && (
            <span className="text-white/60">{currentUser.name} · </span>
          )}
          {myCompanies.length} ta kompaniya mavjud
        </p>
      </div>

      {/* Company cards */}
      <div className="space-y-2.5">
        {myCompanies.map((company, i) => {
          const isActive = company.isCurrent;
          const isSwitching = switching === company.id;
          const initials = company.name
            .split(/\s+/)
            .slice(0, 2)
            .map((w: string) => w[0]?.toUpperCase() ?? "")
            .join("");

          return (
            <motion.button
              key={company.id}
              initial={{ opacity: 0, x: -16 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.25, delay: i * 0.06 }}
              onClick={() => { void handleSelect(company.id); }}
              disabled={isSwitching || !company.membershipActive}
              className={[
                "w-full flex items-center gap-4 p-4 rounded-2xl border text-left transition-all cursor-pointer group",
                isActive
                  ? "bg-primary/10 border-primary/30 ring-1 ring-primary/20"
                  : "bg-white/5 border-white/8 hover:bg-white/8 hover:border-white/15",
              ].join(" ")}
            >
              {/* Avatar */}
              <div className={[
                "h-12 w-12 rounded-xl flex items-center justify-center text-sm font-bold shrink-0",
                isActive ? "bg-primary/20 text-primary" : "bg-white/10 text-white/60",
              ].join(" ")}>
                {initials}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-white truncate">{company.name}</p>
                  {isActive && (
                    <span className="text-[10px] font-medium text-primary bg-primary/15 px-1.5 py-0.5 rounded-full shrink-0">
                      Joriy
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className={[
                    "text-[11px] font-medium px-1.5 py-0.5 rounded-full",
                    company.status === "active"
                      ? "bg-green-500/15 text-green-400"
                      : company.status === "trial"
                      ? "bg-amber-500/15 text-amber-400"
                      : "bg-white/10 text-white/40",
                  ].join(" ")}>
                    {company.status === "active" ? "Aktiv"
                      : company.status === "trial" ? "Sinov"
                      : company.status === "suspended" ? "To'xtatilgan"
                      : company.status ?? "—"}
                  </span>
                  {company.trialEndsAt && company.status === "trial" && (
                    <span className="text-[11px] text-amber-400/70 flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {format(new Date(company.trialEndsAt), "dd.MM.yyyy")} gacha
                    </span>
                  )}
                  <span className="text-xs text-white/30">{company.currency}</span>
                </div>
              </div>

              {/* Arrow / check */}
              <div className="shrink-0 text-white/30 group-hover:text-white/60 transition-colors">
                {isSwitching
                  ? <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  : isActive
                  ? <CheckCircle className="h-5 w-5 text-primary" />
                  : <ChevronRight className="h-5 w-5" />}
              </div>
            </motion.button>
          );
        })}
      </div>

      {/* Create new */}
      <div className="mt-5 text-center">
        <button
          onClick={() => navigate(`/${lng}/onboarding`)}
          className="text-xs text-white/30 hover:text-white/60 transition-colors cursor-pointer"
        >
          + Yangi kompaniya yaratish
        </button>
      </div>
    </motion.div>
  );
}

// ─── Loading card ─────────────────────────────────────────────────────────────
function LoadingCard() {
  return (
    <div className="w-full max-w-md space-y-3">
      <Skeleton className="h-20 w-full rounded-2xl bg-white/5" />
      <Skeleton className="h-20 w-full rounded-2xl bg-white/5" />
      <Skeleton className="h-20 w-full rounded-2xl bg-white/5" />
    </div>
  );
}

// ─── Unauthenticated card ─────────────────────────────────────────────────────
function UnauthCard() {
  return (
    <div className="w-full max-w-sm text-center space-y-5">
      <Building2 className="h-10 w-10 text-white/30 mx-auto" />
      <div>
        <p className="text-white font-semibold">Iltimos tizimga kiring</p>
        <p className="text-sm text-white/40 mt-1">Biznesingizni ko'rish uchun kirish kerak</p>
      </div>
      <div className="flex justify-center">
        <SignInButton />
      </div>
    </div>
  );
}
