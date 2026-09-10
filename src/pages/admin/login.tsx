/**
 * Platform Admin Login Page
 * Route: admin.bum-erp.uz (entry point before auth)
 *
 * Uses the OIDC auth adapter (@/hooks/use-auth) — auth is always through the OIDC provider.
 * After sign-in, checks isPlatformAdmin:
 *   - true  → onAuthorized()
 *   - false AND no admins exist → onNeedBootstrap()
 *   - false AND admins exist    → "Access denied"
 */
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth.ts";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { AuthLoading, Authenticated, Unauthenticated } from "convex/react";
import { motion } from "motion/react";
import { Shield, Layers, Lock, LogOut, AlertTriangle, Loader2, KeyRound, Phone } from "lucide-react";

// ─── Props ────────────────────────────────────────────────────────────────────
interface AdminLoginPageProps {
  onAuthorized: () => void;
  onNeedBootstrap: () => void;
  /** If false, a "setup first admin" button is shown */
  hasExistingAdmins: boolean;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function AdminLoginPage({ onAuthorized, onNeedBootstrap, hasExistingAdmins }: AdminLoginPageProps) {
  return (
    <div className="min-h-screen bg-[oklch(0.09_0.02_255)] flex flex-col">
      <AuthLoading>
        <AdminLoadingScreen label="Yuklanmoqda..." />
      </AuthLoading>
      <Unauthenticated>
        <AdminSignInScreen
          onNeedBootstrap={onNeedBootstrap}
          hasExistingAdmins={hasExistingAdmins}
        />
      </Unauthenticated>
      <Authenticated>
        <AdminAuthCheck
          onAuthorized={onAuthorized}
          onNeedBootstrap={onNeedBootstrap}
          hasExistingAdmins={hasExistingAdmins}
        />
      </Authenticated>
    </div>
  );
}

// ─── Full-screen loader ────────────────────────────────────────────────────────
function AdminLoadingScreen({ label }: { label: string }) {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <AdminLogo pulse />
        <div className="flex items-center gap-2 text-white/40 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          {label}
        </div>
      </div>
    </div>
  );
}

// ─── Not signed in ─────────────────────────────────────────────────────────────
function AdminSignInScreen({
  onNeedBootstrap,
  hasExistingAdmins,
}: {
  onNeedBootstrap: () => void;
  hasExistingAdmins: boolean;
}) {
  const { signInWithPassword, isLoading } = useAuth();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone.trim() || !password) return;
    setSubmitting(true);
    setError(null);
    try {
      await signInWithPassword(phone.trim(), password);
    } catch {
      setError("Telefon raqam yoki parol noto'g'ri");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex-1 flex items-center justify-center px-4">
      {/* Ambient glow */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-20%] left-1/2 -translate-x-1/2 w-[600px] h-[600px] rounded-full bg-primary/8 blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[400px] h-[400px] rounded-full bg-blue-600/5 blur-[100px]" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="relative w-full max-w-sm"
      >
        {/* Card */}
        <div className="rounded-2xl border border-white/10 bg-white/4 backdrop-blur-xl p-8 shadow-2xl">
          {/* Logo + title */}
          <div className="flex flex-col items-center gap-3 mb-8">
            <AdminLogo />
            <div className="text-center">
              <h1 className="text-xl font-bold text-white tracking-tight">BUM ERP Admin</h1>
              <p className="text-sm text-white/40 mt-0.5">Platform boshqaruv paneli</p>
            </div>
          </div>

          {/* Security badge */}
          <div className="flex items-start gap-3 rounded-xl border border-white/8 bg-white/3 p-3.5 mb-6">
            <Lock className="h-4 w-4 text-primary shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-white/80">Cheklangan kirish</p>
              <p className="text-xs text-white/40 mt-0.5 leading-relaxed">
                Faqat <span className="text-primary font-medium">Platform Admin</span> huquqiga
                ega akkauntlar kirishi mumkin.
              </p>
            </div>
          </div>

          {/* Sign in form */}
          <form onSubmit={(e) => { void handleSubmit(e); }} className="space-y-3 mb-3">
            <div className="relative">
              <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/25" />
              <input
                type="tel"
                autoComplete="username"
                value={phone}
                onChange={(e) => { setPhone(e.target.value); setError(null); }}
                placeholder="+998901234567"
                className="w-full h-11 rounded-xl bg-white/5 border border-white/10 pl-9 pr-3 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/30 transition-all"
              />
            </div>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/25" />
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(null); }}
                placeholder="Parol"
                className="w-full h-11 rounded-xl bg-white/5 border border-white/10 pl-9 pr-3 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/30 transition-all"
              />
            </div>

            {error && (
              <div className="flex items-center gap-2 text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2.5">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading || submitting || !phone.trim() || !password}
              className="w-full h-11 rounded-xl bg-primary hover:bg-primary/90 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold text-sm transition-all duration-200 flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-primary/20"
            >
              {isLoading || submitting ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Yuklanmoqda...</>
              ) : (
                <><Shield className="h-4 w-4" /> Tizimga kirish</>
              )}
            </button>
          </form>

          {/* Bootstrap link (only if no admins yet) */}
          {!hasExistingAdmins && (
            <button
              type="button"
              onClick={onNeedBootstrap}
              className="w-full h-9 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 text-amber-400 text-xs font-medium flex items-center justify-center gap-2 transition-all cursor-pointer"
            >
              <KeyRound className="h-3.5 w-3.5" />
              Birinchi adminni sozlash (bootstrap)
            </button>
          )}

          <p className="text-center text-xs text-white/25 mt-4 leading-relaxed">
            Telefon raqamingiz va parolingiz bilan kiring
          </p>
        </div>

        <p className="text-center text-xs text-white/20 mt-4">
          BUM ERP · Platform v1.0
        </p>
      </motion.div>
    </div>
  );
}

// ─── Signed in → role check ───────────────────────────────────────────────────
function AdminAuthCheck({
  onAuthorized,
  onNeedBootstrap,
  hasExistingAdmins,
}: {
  onAuthorized: () => void;
  onNeedBootstrap: () => void;
  hasExistingAdmins: boolean;
}) {
  const currentUser = useQuery(api.users.getCurrentUser);
  const { signout } = useAuth();

  useEffect(() => {
    if (currentUser?.isPlatformAdmin) {
      onAuthorized();
    }
  }, [currentUser?.isPlatformAdmin, onAuthorized]);

  // Still loading
  if (currentUser === undefined) {
    return <AdminLoadingScreen label="Rol tekshirilmoqda..." />;
  }

  // Authorized — redirect happening via useEffect
  if (currentUser?.isPlatformAdmin) {
    return <AdminLoadingScreen label="Admin paneliga o'tilmoqda..." />;
  }

  // Not admin, but bootstrap needed
  if (!hasExistingAdmins) {
    return (
      <div className="flex-1 flex items-center justify-center px-4">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-sm text-center space-y-4"
        >
          <div className="h-14 w-14 rounded-2xl bg-amber-500/15 border border-amber-500/25 flex items-center justify-center mx-auto">
            <KeyRound className="h-7 w-7 text-amber-400" />
          </div>
          <div>
            <p className="text-white font-semibold">Admin sozlash kerak</p>
            <p className="text-sm text-white/50 mt-1">
              Hali birorta platform admin yo'q. Bootstrap jarayonini boshlang.
            </p>
          </div>
          <button
            onClick={onNeedBootstrap}
            className="px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-semibold text-sm flex items-center gap-2 mx-auto cursor-pointer transition-all"
          >
            <KeyRound className="h-4 w-4" />
            Bootstrap boshlash
          </button>
          <button
            onClick={() => { void signout(); }}
            className="text-xs text-white/30 hover:text-white/60 transition-colors cursor-pointer"
          >
            Boshqa akkaunt bilan kiring
          </button>
        </motion.div>
      </div>
    );
  }

  // Not admin, admins exist → access denied
  return (
    <div className="flex-1 flex items-center justify-center px-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3 }}
        className="w-full max-w-sm text-center space-y-5"
      >
        <div className="h-16 w-16 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto">
          <AlertTriangle className="h-8 w-8 text-red-400" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-white">Kirish taqiqlangan</h2>
          <p className="text-sm text-white/50 mt-1">
            Sizning akkauntingizda{" "}
            <span className="text-white/70 font-medium">Platform Admin</span> huquqlari yo'q.
          </p>
          {currentUser?.email && (
            <p className="text-xs text-white/30 mt-2 font-mono">{currentUser.email}</p>
          )}
        </div>
        <button
          onClick={() => { void signout(); }}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-white/8 hover:bg-white/12 text-white/70 hover:text-white text-sm font-medium transition-all cursor-pointer border border-white/10"
        >
          <LogOut className="h-4 w-4" />
          Boshqa akkaunt bilan kiring
        </button>
        <p className="text-xs text-white/25">
          Agar bu xato bo'lsa, platforma administratori bilan bog'laning.
        </p>
      </motion.div>
    </div>
  );
}

// ─── Logo ─────────────────────────────────────────────────────────────────────
function AdminLogo({ pulse = false }: { pulse?: boolean }) {
  return (
    <div className={`relative h-14 w-14 rounded-2xl bg-primary/90 flex items-center justify-center shadow-lg shadow-primary/30 ${pulse ? "animate-pulse" : ""}`}>
      <Layers className="h-7 w-7 text-white" />
      <div className="absolute -bottom-1.5 -right-1.5 h-5 w-5 rounded-full bg-[oklch(0.09_0.02_255)] border-2 border-primary/50 flex items-center justify-center">
        <Shield className="h-2.5 w-2.5 text-primary" />
      </div>
    </div>
  );
}
