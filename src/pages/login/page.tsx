/**
 * BUM ERP Login Page
 *
 * Telefon raqam + parol formasi. Autentifikatsiya API sessiyasi orqali (httpOnly cookie) —
 * tashqi provayder sahifasiga yo'naltirish yo'q, hammasi shu sahifada.
 *
 * Platform Admin paneli — `/:lng/admin` (admin.bum-erp.uz subdomeni ham ishlaydi, agar ulangan bo'lsa).
 */
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "@/hooks/use-auth.ts";
import { errorMessage } from "@/lib/api.ts";
import { toast } from "sonner";
import { PasswordResetForm } from "./_components/password-reset-form.tsx";
import { PasswordToggle } from "@/components/password-toggle.tsx";
import { motion } from "motion/react";
import {
  Phone, Lock, ArrowRight, Shield, Building2,
  ChevronRight, Loader2, AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import BrandLogo from "@/components/brand-logo.tsx";

export default function LoginPage() {
  const { signInWithPassword, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const { lng } = useParams<{ lng: string }>();

  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"login" | "reset">("login");
  const [showPassword, setShowPassword] = useState(false);

  // If already authenticated, redirect to dashboard
  useEffect(() => {
    if (isAuthenticated) {
      navigate(`/${lng ?? "uz"}/dashboard`, { replace: true });
    }
  }, [isAuthenticated, navigate, lng]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone.trim() || !password) return;
    setSubmitting(true);
    setError(null);
    try {
      await signInWithPassword(phone.trim(), password);
      // muvaffaqiyatli bo'lsa yuqoridagi useEffect dashboard'ga o'tkazadi
    } catch (err) {
      // Serverdan: noto'g'ri parol, bloklangan hisob, juda ko'p urinish yoki aloqa yo'q
      setError(errorMessage(err, "Telefon raqam yoki parol noto'g'ri"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[oklch(0.13_0.02_255)] flex">
      {/* Left panel — branding */}
      <div className="hidden lg:flex flex-col justify-between w-1/2 p-12 bg-gradient-to-br from-[oklch(0.15_0.04_260)] to-[oklch(0.11_0.025_255)] border-r border-white/5">
        {/* Logo */}
        <div className="flex items-center gap-3">
          <BrandLogo variant="mark" className="h-10 w-auto" />
          <div>
            <p className="font-bold text-white text-lg leading-none">BUM ERP</p>
            <p className="text-xs text-white/40 mt-0.5">Business Management Platform</p>
          </div>
        </div>

        {/* Center content */}
        <div className="space-y-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 } as const}
          >
            <h1 className="text-4xl font-bold text-white leading-tight">
              O'zbekiston biznesiga mo'ljallangan
              <span className="text-primary block mt-1">Universal ERP</span>
            </h1>
            <p className="text-white/50 mt-4 text-lg leading-relaxed">
              Savdo, ombor, moliya, ishlab chiqarish — barchasi bir joyda.
            </p>
          </motion.div>

          <div className="space-y-3">
            {[
              "Kassa va POS tizimi",
              "Xarid va sotish boshqaruvi",
              "Moliyaviy hisobot va tahlil",
              "Ko'p filial va ko'p valyuta",
              "Xodimlar va HR moduli",
            ].map((item, i) => (
              <motion.div
                key={item}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.1 * i, duration: 0.3 } as const}
                className="flex items-center gap-3 text-white/60"
              >
                <ChevronRight className="h-4 w-4 text-primary shrink-0" />
                <span className="text-sm">{item}</span>
              </motion.div>
            ))}
          </div>
        </div>

        {/* Bottom */}
        <div className="flex items-center gap-2 text-xs text-white/25">
          <Building2 className="h-3.5 w-3.5" />
          <span>© {new Date().getFullYear()} BUM ERP — O'zbekiston</span>
        </div>
      </div>

      {/* Right panel — login form */}
      <div className="flex-1 flex items-center justify-center p-6">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 } as const}
          className="w-full max-w-sm space-y-8"
        >
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center gap-3">
            <BrandLogo variant="mark" className="h-9 w-auto" />
            <p className="font-bold text-white text-lg">BUM ERP</p>
          </div>

          {mode === "reset" ? (
            <PasswordResetForm
              initialPhone={phone}
              onCancel={() => setMode("login")}
              onDone={(resetPhone) => {
                setPhone(resetPhone);
                setPassword("");
                setMode("login");
                toast.success("Parol yangilandi. Yangi parol bilan kiring");
              }}
            />
          ) : (
          <>
          {/* Heading */}
          <div>
            <h2 className="text-2xl font-bold text-white">Tizimga kirish</h2>
            <p className="text-white/40 mt-1.5 text-sm">
              BUM ERP boshqaruv paneliga kirish uchun hisob ma'lumotlaringizni kiriting
            </p>
          </div>

          {/* Login form */}
          <form onSubmit={(e) => { void handleSubmit(e); }} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="phone" className="text-xs font-medium text-white/50">
                Telefon raqam
              </label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/25" />
                <input
                  id="phone"
                  name="phone"
                  type="tel"
                  autoComplete="username"
                  value={phone}
                  onChange={(e) => { setPhone(e.target.value); setError(null); }}
                  placeholder="+998901234567"
                  className="w-full h-11 rounded-xl bg-white/5 border border-white/10 pl-9 pr-3 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/30 transition-all"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="password" className="text-xs font-medium text-white/50">
                Parol
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/25" />
                <input
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setError(null); }}
                  placeholder="••••••••"
                  className="w-full h-11 rounded-xl bg-white/5 border border-white/10 pl-9 pr-10 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/30 transition-all"
                />
                <PasswordToggle shown={showPassword} onToggle={() => setShowPassword((s) => !s)} />
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-2 text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2.5">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                {error}
              </div>
            )}

            <Button
              type="submit"
              size="lg"
              disabled={submitting || !phone.trim() || !password}
              className="w-full gap-2 h-12 text-base font-semibold"
            >
              {submitting ? (
                <><Loader2 className="h-5 w-5 animate-spin" /> Kirilmoqda...</>
              ) : (
                <>Tizimga kirish <ArrowRight className="h-4 w-4 ml-auto" /></>
              )}
            </Button>

            <button
              type="button"
              onClick={() => {
                setMode("reset");
                setError(null);
              }}
              className="w-full text-center text-xs text-white/40 hover:text-white/70 transition-colors cursor-pointer"
            >
              Parolni unutdingizmi?
            </button>
          </form>
          </>
          )}

          {/* Help section */}
          <div className="space-y-2 border-t border-white/5 pt-5">
            <p className="text-xs font-medium text-white/40 uppercase tracking-wide">Yordam</p>
            <div className="space-y-2">
              <div className="flex items-start gap-2 text-xs text-white/30">
                <span className="text-white/20 mt-0.5">•</span>
                <span>
                  <span className="text-white/50">Hisob ma'lumotlarini unutdingizmi?</span>
                  {" "}Kompaniyangiz administratoriga murojaat qiling
                </span>
              </div>
              <div className="flex items-start gap-2 text-xs text-white/30">
                <span className="text-white/20 mt-0.5">•</span>
                <span>
                  <span className="text-white/50">Birinchi marta kirmoqdasizmi?</span>
                  {" "}Admin sizga telefon va parol beradi
                </span>
              </div>
              <div className="flex items-start gap-2 text-xs text-white/30">
                <span className="text-white/20 mt-0.5">•</span>
                <span>
                  <span className="text-white/50">Platform Admin?</span>
                  {" "}
                  <a
                    href={`/${lng ?? "uz"}/admin`}
                    className="text-primary/60 hover:text-primary underline"
                  >
                    Admin panel
                  </a>
                  {" "}orqali kiring
                </span>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
