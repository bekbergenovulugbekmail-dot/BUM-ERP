/**
 * Tenant Portal Page — /t/:slug
 *
 * This page is the entry point for a specific company's ERP app.
 * URL pattern: app.bum-erp.uz/t/alkon → ALKON company ERP
 *
 * Flow:
 *   1. Resolve slug → company (`GET /api/public/companies/:slug`, safe fields only)
 *   2. If company not found → 404
 *   3. If company suspended → suspended screen
 *   4. If user not authenticated → show login button
 *   5. If user is authenticated:
 *      - verify membership server-side (`GET /api/public/companies/:slug/access`)
 *      - member → switch active company → redirect to /:lng/dashboard
 *      - not member → "Access Denied"
 *      - platform admin → allowed (admin can view any company)
 */
import { useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { AuthLoading, Authenticated, Unauthenticated } from "@/components/auth-gates.tsx";
import { useAuth, useCurrentUser } from "@/hooks/use-auth.ts";
import { useSwitchCompany } from "@/hooks/use-company.ts";
import { errorMessage } from "@/lib/api.ts";
import { useApiQuery } from "@/lib/query.ts";
import { motion } from "motion/react";
import {
  Building2, Layers, Shield, AlertTriangle,
  LogIn, Loader2, XCircle, ArrowLeft, ExternalLink,
} from "lucide-react";
import { SAVED_OR_DEFAULT_LOCALE } from "@/i18n.ts";

type CompanyPublic = {
  id: string;
  name: string;
  legalName: string | null;
  logoUrl: string | null;
  country: string;
  currency: string;
  language: string;
  slug: string | null;
  status: string;
  city: string | null;
};

type TenantAccess = {
  allowed: boolean;
  companyId: string | null;
  reason: "ok" | "platform_admin" | "company_not_found" | "company_inactive" | "not_member";
};

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function TenantPortalPage() {
  const { slug = "" } = useParams<{ slug: string }>();

  const companyQuery = useApiQuery<{ company: CompanyPublic }>(
    slug ? `/api/public/companies/${encodeURIComponent(slug)}` : null,
  );
  const company = companyQuery.data?.company;

  // Still loading
  if (companyQuery.isLoading) {
    return <PortalScreen><LoadingView label="Yuklanmoqda..." /></PortalScreen>;
  }

  // Server/aloqa xatosi (404/400 — "topilmadi")
  if (companyQuery.error && companyQuery.error.status !== 404 && companyQuery.error.status !== 400) {
    return <PortalScreen><ErrorView message={errorMessage(companyQuery.error)} /></PortalScreen>;
  }

  // Not found
  if (!company) {
    return <PortalScreen><NotFoundView slug={slug} /></PortalScreen>;
  }

  // Suspended / cancelled
  if (company.status === "suspended" || company.status === "cancelled") {
    return <PortalScreen><SuspendedView name={company.name} /></PortalScreen>;
  }

  return (
    <PortalScreen logoUrl={company.logoUrl ?? undefined} companyName={company.name}>
      <AuthLoading>
        <LoadingView label="Autentifikatsiya tekshirilmoqda..." />
      </AuthLoading>
      <Unauthenticated>
        <SignInView company={company} />
      </Unauthenticated>
      <Authenticated>
        <AuthorizedView company={company} />
      </Authenticated>
    </PortalScreen>
  );
}

// ─── Authorized: check membership server-side ─────────────────────────────────
function AuthorizedView({ company }: { company: CompanyPublic }) {
  const { slug = "" } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const accessQuery = useApiQuery<TenantAccess>(`/api/public/companies/${encodeURIComponent(slug)}/access`);
  const access = accessQuery.data;
  const switchCompany = useSwitchCompany();
  const lng = SAVED_OR_DEFAULT_LOCALE;
  // Almashtirish keshni qayta o'rnatadi — effekt ikkinchi marta ishlamasin
  const started = useRef(false);

  useEffect(() => {
    if (!access?.allowed || started.current) return;
    started.current = true;

    const doSwitch = async () => {
      if (access.companyId) {
        try {
          await switchCompany.mutateAsync(access.companyId);
        } catch {
          // allaqachon aktiv yoki platforma admini a'zo emas
        }
      }
      navigate(`/${lng}/dashboard`, { replace: true });
    };
    void doSwitch();
  }, [access, switchCompany, navigate, lng]);

  if (accessQuery.error) {
    return <ErrorView message={errorMessage(accessQuery.error)} />;
  }

  if (access === undefined) {
    return <LoadingView label="Huquqlar tekshirilmoqda..." />;
  }

  if (!access.allowed) {
    return <AccessDeniedView company={company} reason={access.reason} />;
  }

  // Allowed — redirect happening in useEffect
  return <LoadingView label={`${company.name} ga o'tilmoqda...`} />;
}

// ─── Sign-in view (unauthenticated) ───────────────────────────────────────────
function SignInView({ company }: { company: CompanyPublic }) {
  const navigate = useNavigate();
  const lng = SAVED_OR_DEFAULT_LOCALE;

  return (
    <div className="flex flex-col items-center gap-6 text-center">
      <CompanyAvatar name={company.name} logoUrl={company.logoUrl ?? undefined} />

      <div>
        <h1 className="text-2xl font-bold text-white">{company.name}</h1>
        {company.legalName && company.legalName !== company.name && (
          <p className="text-sm text-white/40 mt-0.5">{company.legalName}</p>
        )}
        {company.city && (
          <p className="text-xs text-white/30 mt-1">{company.city}, {company.country}</p>
        )}
      </div>

      <div className="w-full max-w-xs space-y-3">
        <button
          onClick={() => navigate(`/${lng}/login`)}
          className="w-full h-11 rounded-xl bg-primary hover:bg-primary/90 text-white font-semibold text-sm flex items-center justify-center gap-2 cursor-pointer transition-all shadow-lg shadow-primary/20"
        >
          <LogIn className="h-4 w-4" /> Tizimga kirish
        </button>
        <p className="text-xs text-white/25">
          BUM ERP · {company.name} · {company.currency}
        </p>
      </div>
    </div>
  );
}

// ─── Access denied ─────────────────────────────────────────────────────────────
function AccessDeniedView({ company, reason }: { company: CompanyPublic; reason: TenantAccess["reason"] }) {
  const { signout } = useAuth();
  const currentUser = useCurrentUser();

  const message =
    reason === "not_member"
      ? `Siz ${company.name} kompaniyasining a'zosi emassiz.`
      : reason === "company_inactive"
      ? `${company.name} kompaniyasi hozirda faol emas.`
      : "Kirishga ruxsat yo'q.";

  return (
    <div className="flex flex-col items-center gap-5 text-center">
      <div className="h-16 w-16 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center">
        <XCircle className="h-8 w-8 text-red-400" />
      </div>
      <div>
        <h2 className="text-lg font-bold text-white">Kirish taqiqlangan</h2>
        <p className="text-sm text-white/50 mt-1 max-w-xs">{message}</p>
        {currentUser?.phone && (
          <p className="text-xs text-white/30 mt-2 font-mono">{currentUser.phone}</p>
        )}
      </div>
      <div className="flex flex-col gap-2 w-full max-w-xs">
        <button
          onClick={() => signout()}
          className="w-full h-10 rounded-xl bg-white/8 hover:bg-white/12 border border-white/10 text-white/70 hover:text-white text-sm font-medium flex items-center justify-center gap-2 cursor-pointer transition-all"
        >
          <LogIn className="h-4 w-4" />
          Boshqa akkaunt bilan kiring
        </button>
        <a
          href="https://app.bum-erp.uz"
          className="w-full h-10 rounded-xl bg-white/5 hover:bg-white/8 text-white/40 hover:text-white/70 text-sm flex items-center justify-center gap-2 cursor-pointer transition-all"
        >
          <ArrowLeft className="h-4 w-4" />
          app.bum-erp.uz ga qaytish
        </a>
      </div>
    </div>
  );
}

// ─── Not Found ────────────────────────────────────────────────────────────────
function NotFoundView({ slug }: { slug: string }) {
  return (
    <div className="flex flex-col items-center gap-5 text-center">
      <div className="h-16 w-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center">
        <AlertTriangle className="h-8 w-8 text-white/40" />
      </div>
      <div>
        <h2 className="text-lg font-bold text-white">Kompaniya topilmadi</h2>
        <p className="text-sm text-white/40 mt-1">
          <span className="font-mono text-white/60">"{slug}"</span> nomli kompaniya mavjud emas.
        </p>
      </div>
      <a
        href="https://app.bum-erp.uz"
        className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
      >
        <ExternalLink className="h-4 w-4" />
        app.bum-erp.uz ga o'tish
      </a>
    </div>
  );
}

// ─── Error ────────────────────────────────────────────────────────────────────
function ErrorView({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center gap-5 text-center">
      <div className="h-16 w-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center">
        <AlertTriangle className="h-8 w-8 text-amber-400" />
      </div>
      <div>
        <h2 className="text-lg font-bold text-white">Xatolik</h2>
        <p className="text-sm text-white/40 mt-1">{message}</p>
      </div>
    </div>
  );
}

// ─── Suspended ────────────────────────────────────────────────────────────────
function SuspendedView({ name }: { name: string }) {
  return (
    <div className="flex flex-col items-center gap-5 text-center">
      <div className="h-16 w-16 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
        <Shield className="h-8 w-8 text-amber-400" />
      </div>
      <div>
        <h2 className="text-lg font-bold text-white">Kompaniya to'xtatilgan</h2>
        <p className="text-sm text-white/40 mt-1">
          <span className="text-white/60 font-medium">{name}</span> hozirda faol emas.
          Platforma admini bilan bog'laning.
        </p>
      </div>
    </div>
  );
}

// ─── Loading ──────────────────────────────────────────────────────────────────
function LoadingView({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center gap-3">
      <Loader2 className="h-8 w-8 text-white/40 animate-spin" />
      <p className="text-sm text-white/40">{label}</p>
    </div>
  );
}

// ─── Company avatar ───────────────────────────────────────────────────────────
function CompanyAvatar({
  name, logoUrl,
}: { name: string; logoUrl?: string }) {
  if (logoUrl) {
    return (
      <div className="h-20 w-20 rounded-2xl overflow-hidden border border-white/10 bg-white/5">
        <img src={logoUrl} alt={name} className="h-full w-full object-cover" />
      </div>
    );
  }
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  return (
    <div className="h-20 w-20 rounded-2xl bg-primary/20 border border-primary/30 flex items-center justify-center">
      <span className="text-2xl font-bold text-primary">{initials}</span>
    </div>
  );
}

// ─── Portal Shell ─────────────────────────────────────────────────────────────
function PortalScreen({
  children, companyName, logoUrl: _logoUrl,
}: {
  children: React.ReactNode;
  companyName?: string;
  logoUrl?: string;
}) {
  return (
    <div className="min-h-screen bg-[oklch(0.09_0.02_255)] flex flex-col">
      {/* Ambient glow */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-20%] left-1/2 -translate-x-1/2 w-[600px] h-[600px] rounded-full bg-primary/6 blur-[120px]" />
      </div>

      {/* Top bar */}
      <header className="relative z-10 flex items-center justify-between px-5 py-4 border-b border-white/6">
        <div className="flex items-center gap-2">
          <div className="h-6 w-6 rounded-md bg-primary/90 flex items-center justify-center">
            <Layers className="h-3.5 w-3.5 text-white" />
          </div>
          <span className="text-sm font-semibold text-white/60">BUM ERP</span>
        </div>
        {companyName && (
          <div className="flex items-center gap-1.5">
            <Building2 className="h-3.5 w-3.5 text-white/30" />
            <span className="text-xs text-white/40 truncate max-w-[200px]">{companyName}</span>
          </div>
        )}
      </header>

      {/* Center content */}
      <main className="relative z-10 flex-1 flex items-center justify-center px-4 py-12">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: "easeOut" }}
          className="w-full max-w-sm"
        >
          <div className="rounded-2xl border border-white/10 bg-white/4 backdrop-blur-xl p-8 shadow-2xl">
            {children}
          </div>
        </motion.div>
      </main>

      <footer className="relative z-10 text-center text-xs text-white/20 pb-4">
        app.bum-erp.uz · Powered by BUM ERP
      </footer>
    </div>
  );
}
