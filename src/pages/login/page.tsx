/**
 * BUM ERP Login Page
 *
 * Bu sahifa foydalanuvchilarga BUM ERP uslubida login UI ko'rsatadi.
 * "Kirish" bosilganda Hercules Auth portali ochiladi — lekin unda
 * faqat "Username (telefon) + Parol" metodi ko'rsatilishi uchun
 * Hercules Dashboard → Users & Access → Auth Portal sozlamalarida
 * faqat "Username and password" metodi yoqilishi kerak.
 *
 * Platform Admin uchun admin.bum-erp.uz alohida.
 */
import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "@/hooks/use-auth.ts";
import { useConvexAuth } from "convex/react";
import { motion } from "motion/react";
import {
  Phone, Lock, ArrowRight, Shield, Building2,
  ChevronRight, Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button.tsx";

export default function LoginPage() {
  const { signinRedirect } = useAuth();
  const { isAuthenticated } = useConvexAuth();
  const navigate = useNavigate();
  const { lng } = useParams<{ lng: string }>();

  // If already authenticated, redirect to dashboard
  useEffect(() => {
    if (isAuthenticated) {
      navigate(`/${lng ?? "uz"}/dashboard`, { replace: true });
    }
  }, [isAuthenticated, navigate, lng]);

  const handleLogin = async () => {
    await signinRedirect();
  };

  return (
    <div className="min-h-screen bg-[oklch(0.13_0.02_255)] flex">
      {/* Left panel — branding */}
      <div className="hidden lg:flex flex-col justify-between w-1/2 p-12 bg-gradient-to-br from-[oklch(0.15_0.04_260)] to-[oklch(0.11_0.025_255)] border-r border-white/5">
        {/* Logo */}
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-primary flex items-center justify-center">
            <Shield className="h-5 w-5 text-white" />
          </div>
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
            <div className="h-9 w-9 rounded-xl bg-primary flex items-center justify-center">
              <Shield className="h-4 w-4 text-white" />
            </div>
            <p className="font-bold text-white text-lg">BUM ERP</p>
          </div>

          {/* Heading */}
          <div>
            <h2 className="text-2xl font-bold text-white">Tizimga kirish</h2>
            <p className="text-white/40 mt-1.5 text-sm">
              BUM ERP boshqaruv paneliga kirish uchun hisob ma'lumotlaringizni kiriting
            </p>
          </div>

          {/* Info card — explains credentials */}
          <div className="space-y-3 p-4 rounded-2xl bg-white/5 border border-white/8">
            <div className="flex items-start gap-3">
              <div className="h-8 w-8 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
                <Phone className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="text-sm font-medium text-white">Telefon raqami</p>
                <p className="text-xs text-white/40 mt-0.5">
                  Login sahifasida "Username" maydoniga telefon raqamingizni kiriting
                </p>
                <p className="text-xs text-primary/70 mt-1 font-mono">Masalan: +998901234567</p>
              </div>
            </div>
            <div className="border-t border-white/5" />
            <div className="flex items-start gap-3">
              <div className="h-8 w-8 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
                <Lock className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="text-sm font-medium text-white">Parol</p>
                <p className="text-xs text-white/40 mt-0.5">
                  Sizga admin tomonidan berilgan parolni kiriting
                </p>
              </div>
            </div>
          </div>

          {/* Login button */}
          <div className="space-y-3">
            <Button
              onClick={handleLogin}
              size="lg"
              className="w-full gap-2 h-12 text-base font-semibold"
            >
              <Sparkles className="h-5 w-5" />
              Tizimga kirish
              <ArrowRight className="h-4 w-4 ml-auto" />
            </Button>

            <p className="text-xs text-white/30 text-center leading-relaxed">
              Kirish tugmasini bosganda BUM ERP autentifikatsiya sahifasi ochiladi.
              Telefon raqamingiz va parolingizni u yerda kiriting.
            </p>
          </div>

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
                    href="https://admin.bum-erp.uz"
                    className="text-primary/60 hover:text-primary underline"
                  >
                    admin.bum-erp.uz
                  </a>
                  {" "}dan kiring
                </span>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
