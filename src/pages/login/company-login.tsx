/**
 * Biznes manzilidagi kirish sahifasi: `app.bum-erp.uz/bonnu-market`.
 *
 * Sahifa aynan shu biznesning nomi bilan ochiladi va kirish FAQAT shu biznesga bo'ladi —
 * server foydalanuvchi shu biznesning faol xodimi ekanini tekshiradi (`companySlug` bilan login).
 * Manzil noto'g'ri bo'lsa yoki biznes to'xtatilgan bo'lsa — tushunarli xabar.
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import { AlertTriangle, ArrowRight, Loader2, Lock, Phone } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { PasswordResetForm } from "./_components/password-reset-form.tsx";
import BrandLogo from "@/components/brand-logo.tsx";
import { PasswordToggle } from "@/components/password-toggle.tsx";
import { useAuth } from "@/hooks/use-auth.ts";
import { api, errorMessage } from "@/lib/api.ts";
import { useApiQuery } from "@/lib/query.ts";
import { SAVED_OR_DEFAULT_LOCALE } from "@/i18n.ts";

type CompanyPublic = { id: string; name: string; logoUrl: string | null; slug: string | null; status: string };

export default function CompanyLoginPage({ slug }: { slug: string }) {
  const { signInWithPassword, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  /** Parolni SMS kod bilan tiklash (universal kirish sahifasi o'rniga shu yerda). */
  const [mode, setMode] = useState<"login" | "reset">("login");

  // Biznes nomi va logotipi — sessiyasiz ochiq ma'lumot
  const companyQuery = useApiQuery<{ company: CompanyPublic }>(`/api/public/companies/${encodeURIComponent(slug)}`, undefined, {
    retry: false,
  });
  const company = companyQuery.data?.company;
  const notFound = companyQuery.isError;
  const suspended = company?.status === "suspended" || company?.status === "cancelled";

  useEffect(() => {
    if (isAuthenticated) navigate(`/${slug}/dashboard`, { replace: true });
  }, [isAuthenticated, navigate, slug]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!phone.trim() || !password) {
      setError("Telefon va parolni kiriting");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await signInWithPassword(phone.trim(), password, slug);
      navigate(`/${slug}/dashboard`, { replace: true });
    } catch (err) {
      setError(errorMessage(err, "Kirishda xatolik"));
    } finally {
      setSubmitting(false);
    }
  };

  if (companyQuery.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (notFound || suspended) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="w-full max-w-md space-y-4 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-destructive/10">
            <AlertTriangle className="h-7 w-7 text-destructive" />
          </div>
          <h1 className="text-xl font-bold">{notFound ? "Bunday biznes manzili yo'q" : `${company?.name} vaqtincha to'xtatilgan`}</h1>
          <p className="text-sm text-muted-foreground">
            {notFound
              ? `«${slug}» manzili topilmadi. Manzilni tekshiring yoki rahbaringizdan so'rang.`
              : "Obuna yoki hisob bilan bog'liq masala — administratorga murojaat qiling."}
          </p>
          <Button variant="secondary" onClick={() => navigate(`/${SAVED_OR_DEFAULT_LOCALE}/login`)}>
            Umumiy kirish sahifasi
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-sm space-y-6"
      >
        <div className="space-y-3 text-center">
          {company?.logoUrl ? (
            <img src={company.logoUrl} alt={company.name} className="mx-auto h-14 w-14 rounded-2xl object-contain" />
          ) : (
            <BrandLogo className="mx-auto h-12 w-auto" />
          )}
          <div>
            <h1 className="text-2xl font-bold uppercase tracking-wide">{company?.name}</h1>
            <p className="text-sm text-muted-foreground">Xodimlar uchun kirish · {slug}</p>
          </div>
        </div>

        {mode === "reset" ? (
          <PasswordResetForm
            initialPhone={phone}
            onCancel={() => setMode("login")}
            onDone={(resetPhone) => {
              setPhone(resetPhone);
              setMode("login");
            }}
          />
        ) : (
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="relative">
            <Phone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              id="phone"
              type="tel"
              autoComplete="username"
              className="h-11 w-full rounded-xl border border-input bg-background pl-9 pr-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              placeholder="+998 90 123 45 67"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
            />
          </div>
          <div className="relative">
            <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              id="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              className="h-11 w-full rounded-xl border border-input bg-background pl-9 pr-11 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              placeholder="Parol"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <PasswordToggle shown={showPassword} onToggle={() => setShowPassword((current) => !current)} />
          </div>

          {error && (
            <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
              {error}
            </p>
          )}

          <Button type="submit" className="h-11 w-full" disabled={submitting}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Kirish <ArrowRight className="ml-1 h-4 w-4" /></>}
          </Button>
        </form>
        )}

        {mode === "login" && (
          <p className="text-center text-xs text-muted-foreground">
            Parolni unutdingizmi?{" "}
            <button type="button" className="text-primary hover:underline" onClick={() => setMode("reset")}>
              SMS kod bilan tiklash
            </button>{" "}
            yoki rahbaringizga murojaat qiling.
          </p>
        )}
      </motion.div>
    </div>
  );
}

/** Manzilsiz kirilganda (`app.bum-erp.uz`): biznes manzilini so'raydi. */
export function BusinessAddressPage() {
  const navigate = useNavigate();
  const [value, setValue] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = async (event: React.FormEvent) => {
    event.preventDefault();
    const slug = value.trim().toLowerCase().replace(/^https?:\/\/[^/]+\//, "").replace(/\/.*$/, "");
    if (!slug) {
      setError("Biznes manzilini kiriting");
      return;
    }
    setChecking(true);
    setError(null);
    try {
      await api.get(`/api/public/companies/${encodeURIComponent(slug)}`);
      navigate(`/${slug}`);
    } catch {
      setError(`«${slug}» manzili topilmadi — manzilni tekshiring`);
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-2 text-center">
          <BrandLogo className="mx-auto h-12 w-auto" />
          <h1 className="text-xl font-bold">Biznes manzili</h1>
          <p className="text-sm text-muted-foreground">
            O'z biznesingiz manzilini kiriting — masalan, <span className="font-mono">bum</span>
          </p>
        </div>
        <form onSubmit={open} className="space-y-3">
          <div className="flex items-center rounded-xl border border-input bg-background pl-3">
            <span className="text-sm text-muted-foreground">app.bum-erp.uz/</span>
            <input
              className="h-11 flex-1 bg-transparent px-1 text-sm outline-none"
              placeholder="bum"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              autoFocus
            />
          </div>
          {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
          <Button type="submit" className="h-11 w-full" disabled={checking}>
            {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Davom etish <ArrowRight className="ml-1 h-4 w-4" /></>}
          </Button>
        </form>
      </div>
    </div>
  );
}
