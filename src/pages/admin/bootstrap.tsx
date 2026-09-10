/**
 * Platform Admin Bootstrap Page
 * Shown when authenticated but isPlatformAdmin = false AND no platform admins exist.
 *
 * Uses `platformSetAdminByEmail` mutation which requires PLATFORM_BOOTSTRAP_KEY secret.
 * One-time use: once the first admin exists, this page is no longer shown.
 */
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { ConvexError } from "convex/values";
import { useAuth } from "@/hooks/use-auth.ts";
import { motion } from "motion/react";
import { Layers, Shield, KeyRound, CheckCircle, AlertTriangle, LogOut, Loader2, ChevronDown } from "lucide-react";

interface BootstrapPageProps {
  userEmail: string | undefined;
  onBootstrapped: () => void;
}

export default function AdminBootstrapPage({ userEmail, onBootstrapped }: BootstrapPageProps) {
  const [secretKey, setSecretKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  const setAdminByEmail = useMutation(api.companies.platformSetAdminByEmail);
  const { signout } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!secretKey.trim() || !userEmail) return;

    setLoading(true);
    setError("");

    try {
      await setAdminByEmail({
        email: userEmail,
        secretKey: secretKey.trim(),
      });
      setSuccess(true);
      // Short delay, then forward
      setTimeout(() => onBootstrapped(), 1800);
    } catch (err) {
      const msg =
        err instanceof ConvexError
          ? (err.data as { message?: string }).message ?? "Xatolik yuz berdi"
          : "Xatolik yuz berdi";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[oklch(0.09_0.02_255)] flex flex-col items-center justify-center px-4">
      {/* Background glow */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-20%] left-1/2 -translate-x-1/2 w-[500px] h-[500px] rounded-full bg-amber-500/6 blur-[120px]" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="relative w-full max-w-md"
      >
        {/* Header */}
        <div className="flex flex-col items-center gap-3 mb-6">
          <div className="h-14 w-14 rounded-2xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center">
            <KeyRound className="h-7 w-7 text-amber-400" />
          </div>
          <div className="text-center">
            <h1 className="text-xl font-bold text-white">Platform Admin Bootstrap</h1>
            <p className="text-sm text-white/40 mt-1">
              Birinchi platform administratorini sozlash
            </p>
          </div>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-white/10 bg-white/4 backdrop-blur-xl p-6 shadow-2xl">
          {success ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex flex-col items-center gap-4 py-4"
            >
              <div className="h-14 w-14 rounded-full bg-green-500/20 border border-green-500/30 flex items-center justify-center">
                <CheckCircle className="h-7 w-7 text-green-400" />
              </div>
              <div className="text-center">
                <p className="text-white font-semibold">Muvaffaqiyatli!</p>
                <p className="text-sm text-white/50 mt-1">{userEmail} admin qilindi</p>
              </div>
              <div className="flex items-center gap-2 text-white/40 text-sm">
                <Loader2 className="h-4 w-4 animate-spin" />
                Admin paneliga o'tilmoqda...
              </div>
            </motion.div>
          ) : (
            <form onSubmit={(e) => { void handleSubmit(e); }} className="space-y-5">
              {/* Current user info */}
              <div className="flex items-center gap-3 p-3 rounded-xl bg-white/5 border border-white/8">
                <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center shrink-0 text-sm font-bold text-primary">
                  {(userEmail ?? "?")[0].toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-white/40">Joriy akkaunt</p>
                  <p className="text-sm text-white truncate font-medium">{userEmail ?? "—"}</p>
                </div>
                <Shield className="h-4 w-4 text-amber-400 shrink-0 ml-auto" />
              </div>

              {/* Secret key input */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-white/50">
                  PLATFORM_BOOTSTRAP_KEY
                </label>
                <input
                  type="password"
                  value={secretKey}
                  onChange={(e) => { setSecretKey(e.target.value); setError(""); }}
                  placeholder="Maxfiy kalitni kiriting..."
                  autoComplete="off"
                  className="w-full h-10 rounded-lg bg-white/5 border border-white/10 px-3 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/30 transition-all"
                />
              </div>

              {/* Error */}
              {error && (
                <div className="flex items-center gap-2 text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2.5">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  {error}
                </div>
              )}

              {/* Submit */}
              <button
                type="submit"
                disabled={loading || !secretKey.trim()}
                className="w-full h-11 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed text-black font-semibold text-sm transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                {loading ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> Tekshirilmoqda...</>
                ) : (
                  <><KeyRound className="h-4 w-4" /> Admin huquqlarini berish</>
                )}
              </button>
            </form>
          )}
        </div>

        {/* Help section */}
        <div className="mt-4 rounded-xl border border-white/6 bg-white/2 overflow-hidden">
          <button
            type="button"
            onClick={() => setShowHelp(!showHelp)}
            className="w-full flex items-center justify-between px-4 py-3 text-xs text-white/40 hover:text-white/60 transition-colors cursor-pointer"
          >
            <span>PLATFORM_BOOTSTRAP_KEY qayerdan olish kerak?</span>
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showHelp ? "rotate-180" : ""}`} />
          </button>
          {showHelp && (
            <div className="px-4 pb-4 text-xs text-white/40 space-y-2 border-t border-white/6 pt-3">
              <p>Convex backend muhit o'zgaruvchisi sifatida o'rnatiladi:</p>
              <p><code className="text-primary bg-primary/10 px-1.5 py-0.5 rounded">npx convex env set PLATFORM_BOOTSTRAP_KEY &lt;kalit&gt;</code></p>
              <p>Kalit: o'zingiz belgilagan maxfiy qiymat (kamida 12 belgi)</p>
            </div>
          )}
        </div>

        {/* Sign out link */}
        <div className="mt-4 text-center">
          <button
            type="button"
            onClick={() => { void signout(); }}
            className="inline-flex items-center gap-1.5 text-xs text-white/30 hover:text-white/60 transition-colors cursor-pointer"
          >
            <LogOut className="h-3 w-3" />
            Boshqa akkaunt bilan kiring
          </button>
        </div>
      </motion.div>
    </div>
  );
}
