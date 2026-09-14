/**
 * Onboarding — o'zi ro'yxatdan o'tish (`/api/registration`).
 *
 *   - `GET /api/registration` → `{ enabled }`; o'chiq bo'lsa "yopiq" ekrani (standart holat)
 *   - `POST /api/registration` yangi kompaniya VA yangi ega akkauntini ochadi (telefon + parol);
 *     201 da sessiya cookie'si allaqachon o'rnatilgan — /me keshi yangilanib dashboard'ga o'tiladi
 *   - Kirgan foydalanuvchi bu yerda kompaniya ocholmaydi (API ro'yxatdan o'tish yangi akkaunt yaratadi):
 *     platforma admini — Admin panel → Yangi kompaniya, boshqalar — platforma adminiga murojaat
 *
 * API faqat quyidagilarni qabul qiladi: kompaniya nomi, ega ismi, telefon, parol, shahar, manzil,
 * davlat, valyuta, til. Yuridik nom, STIR va boshqalar keyin Sozlamalar → Kompaniya bo'limida.
 * Asosiy filial, ombor, rollar va hisoblar rejasi serverda avtomatik yaratiladi.
 */
import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  Building2, MapPin, ArrowRight, ArrowLeft,
  CheckCircle, Layers, Sparkles, Loader2,
  Settings2, User, Shield, LogOut, Check, LayoutGrid,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";
import { api, errorMessage } from "@/lib/api.ts";
import {
  DEFAULT_MODULE_SELECTION,
  MODULE_KEYS,
  MODULE_REGISTRY,
  companyPathKey,
  withModuleDependencies,
  type ModuleKey,
} from "@bum/shared";
import { authMeKey, useApiQuery } from "@/lib/query.ts";
import { useAuth, useCurrentUser, type Me } from "@/hooks/use-auth.ts";

// ─── Constants ────────────────────────────────────────────────────────────────

const STEPS = [
  { id: "welcome",  title: "Xush kelibsiz!",            icon: Layers,      subtitle: "BUM ERP — O'zbekiston biznesiga mo'ljallangan SaaS ERP" },
  { id: "company",  title: "Kompaniya va hisob",        icon: Building2,   subtitle: "Kompaniya nomi va kirish ma'lumotlaringiz" },
  { id: "location", title: "Joylashuv va sozlamalar",   icon: MapPin,      subtitle: "Manzil, valyuta va til" },
  { id: "modules",  title: "Modullar",                  icon: LayoutGrid,  subtitle: "Qaysi modullardan foydalanasiz?" },
  { id: "finish",   title: "Tayyor!",                   icon: CheckCircle, subtitle: "Ma'lumotlarni tekshiring va ERP'ni ishga tushiring" },
];

const COUNTRIES = [
  { code: "UZ", name: "O'zbekiston",   flag: "🇺🇿", currency: "UZS" },
  { code: "RU", name: "Rossiya",       flag: "🇷🇺", currency: "RUB" },
  { code: "KZ", name: "Qozog'iston",  flag: "🇰🇿", currency: "KZT" },
  { code: "TR", name: "Turkiya",       flag: "🇹🇷", currency: "TRY" },
  { code: "US", name: "AQSh",          flag: "🇺🇸", currency: "USD" },
];

const CURRENCIES = [
  { code: "UZS", symbol: "so'm", name: "O'zbek so'mi" },
  { code: "USD", symbol: "$",    name: "AQSh dollari" },
  { code: "RUB", symbol: "₽",   name: "Rossiya rubli" },
  { code: "KZT", symbol: "₸",   name: "Qozog'iston tengesi" },
  { code: "EUR", symbol: "€",   name: "Yevro" },
  { code: "TRY", symbol: "₺",   name: "Turk lirasi" },
];

const LANGUAGES = [
  { code: "uz", name: "O'zbekcha",  flag: "🇺🇿" },
  { code: "ru", name: "Русский",    flag: "🇷🇺" },
  { code: "kk", name: "Қазақша",   flag: "🇰🇿" },
];

const FEATURES = [
  { icon: "📦", label: "Mahsulotlar",   desc: "Tovar katalogi va narxlar" },
  { icon: "🏪", label: "Savdo & POS",  desc: "Kassa va buyurtmalar" },
  { icon: "🏭", label: "Ombor",         desc: "Zaxira boshqaruv" },
  { icon: "👥", label: "Xodimlar",      desc: "HR va maosh" },
  { icon: "💰", label: "Moliya",        desc: "Hisob-kitob va balans" },
  { icon: "📊", label: "Analitika",    desc: "Hisobot va AI tahlil" },
];

type FormState = {
  companyName: string; ownerName: string; phone: string; password: string; confirmPassword: string;
  address: string; city: string; country: string;
  currency: string; language: string;
};

const INITIAL_FORM: FormState = {
  companyName: "", ownerName: "", phone: "", password: "", confirmPassword: "",
  address: "", city: "", country: "UZ",
  currency: "UZS", language: "uz",
};

/** Modulni olib tashlash — unga (bilvosita ham) bog'liq tanlangan modullar bilan birga. */
function withoutModule(selected: readonly ModuleKey[], key: ModuleKey): ModuleKey[] {
  const removed = new Set<ModuleKey>([key]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const candidate of selected) {
      if (!removed.has(candidate) && MODULE_REGISTRY[candidate].dependsOn.some((dependency) => removed.has(dependency))) {
        removed.add(candidate);
        grew = true;
      }
    }
  }
  return selected.filter((candidate) => !removed.has(candidate));
}

type RegistrationResult = {
  company: { id: string; name: string; slug: string | null; status: string; trialEndsAt: string | null };
  user: Me;
};

const inputDark = "bg-white/8 border-white/15 text-white placeholder:text-white/30 focus:border-primary/60";

export default function OnboardingPage() {
  const currentUser = useCurrentUser();
  const registration = useApiQuery<{ enabled: boolean }>("/api/registration");

  const isLoading = currentUser === undefined || registration.isLoading;

  return (
    <div className="min-h-screen bg-gradient-to-br from-[oklch(0.11_0.025_255)] via-[oklch(0.14_0.03_260)] to-[oklch(0.18_0.04_270)] flex items-center justify-center p-4">

      {/* Background decorations */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-48 -left-48 h-96 w-96 rounded-full bg-primary/8 blur-3xl" />
        <div className="absolute -bottom-48 -right-48 h-[500px] w-[500px] rounded-full bg-indigo-600/8 blur-3xl" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-64 w-64 rounded-full bg-violet-600/5 blur-3xl" />
      </div>

      <div className="relative w-full max-w-[520px]">

        {/* Logo */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-8"
        >
          <div className="inline-flex items-center gap-3 text-white">
            <div className="h-11 w-11 rounded-xl bg-primary flex items-center justify-center shadow-lg shadow-primary/30">
              <Layers className="h-6 w-6" />
            </div>
            <div className="text-left">
              <div className="text-2xl font-bold tracking-tight leading-none">BUM ERP</div>
              <div className="text-[11px] text-white/50 leading-none mt-0.5 font-medium">app.bum-erp.uz</div>
            </div>
          </div>
        </motion.div>

        {isLoading ? (
          <div className="bg-white/5 backdrop-blur border border-white/10 rounded-2xl p-10 shadow-2xl flex items-center justify-center gap-3 text-white/60">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">Yuklanmoqda...</span>
          </div>
        ) : currentUser ? (
          <SignedInCard user={currentUser} />
        ) : registration.data?.enabled !== true ? (
          <ClosedCard failed={Boolean(registration.error)} />
        ) : (
          <RegistrationWizard />
        )}
      </div>
    </div>
  );
}

// ─── Registration wizard ──────────────────────────────────────────────────────

function RegistrationWizard() {
  const { lng = "uz" } = useParams<{ lng: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [step,    setStep]    = useState(0);
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  // Standart tanlov — reyestrdagi `defaultEnabled`; bog'liqliklar avtomatik qo'shiladi
  const [modules, setModules] = useState<ModuleKey[]>(() => [...DEFAULT_MODULE_SELECTION]);
  const toggleModule = (key: ModuleKey) =>
    setModules((current) => (current.includes(key) ? withoutModule(current, key) : withModuleDependencies([...current, key])));
  const register = useApiMutation();

  const upd = (key: keyof FormState, value: string) => {
    setForm((p) => {
      const next = { ...p, [key]: value };
      // Auto-fill currency when country changes
      if (key === "country") {
        const found = COUNTRIES.find((c) => c.code === value);
        if (found) next.currency = found.currency;
      }
      return next;
    });
  };

  const canProceed = (): boolean => {
    if (step === 1) {
      return (
        form.companyName.trim().length >= 2 &&
        form.phone.trim().length >= 9 &&
        form.password.length > 0 &&
        form.password === form.confirmPassword
      );
    }
    if (step === 2) return !!form.country && !!form.currency;
    if (step === 3) return modules.length > 0;
    return true;
  };

  const handleFinish = async () => {
    try {
      const result = await register.mutateAsync({
        companyName: form.companyName.trim(),
        ownerName:   form.ownerName.trim() || undefined,
        phone:       form.phone.trim(),
        password:    form.password,
        city:        form.city.trim() || undefined,
        address:     form.address.trim() || undefined,
        country:     form.country,
        currency:    form.currency,
        language:    form.language,
        modules,
      });
      // Sessiya cookie'si serverda o'rnatildi — boshqa keshlar tozalanib, joriy foydalanuvchi yoziladi
      queryClient.removeQueries();
      queryClient.setQueryData(authMeKey(), result.user);
      toast.success("Kompaniya muvaffaqiyatli yaratildi!", {
        description: result.company.trialEndsAt
          ? `Sinov muddati: ${format(new Date(result.company.trialEndsAt), "dd.MM.yyyy")} gacha`
          : undefined,
      });
      // Yangi biznes manziliga (`/{slug}/dashboard`)
      navigate(`/${companyPathKey(result.company.slug, result.company.id) ?? lng}/dashboard`, { replace: true });
    } catch (err) {
      toast.error(errorMessage(err, "Xatolik yuz berdi. Qayta urinib ko'ring."));
      // Telefon band / parol talabi — ma'lumot kiritish qadamiga qaytiladi
      if (err instanceof Error) setStep(1);
    }
  };

  const StepIcon = STEPS[step]!.icon;

  return (
    <>
      {/* Progress dots */}
      <div className="flex items-center justify-center gap-1.5 mb-6">
        {STEPS.map((s, i) => (
          <div key={s.id} className="flex items-center gap-1.5">
            <div className={[
              "flex items-center justify-center rounded-full text-[11px] font-semibold transition-all duration-300",
              i < step
                ? "h-7 w-7 bg-green-500 text-white shadow shadow-green-500/40"
                : i === step
                  ? "h-8 w-8 bg-primary text-white shadow-lg shadow-primary/40 ring-2 ring-primary/30"
                  : "h-7 w-7 bg-white/10 text-white/40",
            ].join(" ")}>
              {i < step ? <CheckCircle className="h-3.5 w-3.5" /> : i + 1}
            </div>
            {i < STEPS.length - 1 && (
              <div className={`h-px w-6 transition-all ${i < step ? "bg-green-500" : "bg-white/15"}`} />
            )}
          </div>
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -24 }}
          transition={{ duration: 0.2 }}
          className="bg-white/[0.06] backdrop-blur-md border border-white/10 rounded-2xl p-7 shadow-2xl"
        >
          {/* Step header */}
          <div className="flex items-center gap-3 mb-6">
            <div className="h-10 w-10 rounded-xl bg-primary/15 border border-primary/25 flex items-center justify-center shrink-0">
              <StepIcon className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white leading-none">{STEPS[step]!.title}</h2>
              <p className="text-xs text-white/45 mt-1">{STEPS[step]!.subtitle}</p>
            </div>
          </div>

          {/* Step body */}
          <StepContent step={step} form={form} upd={upd} modules={modules} toggleModule={toggleModule} />

          {/* Navigation */}
          <div className="flex gap-3 mt-7">
            {step > 0 && (
              <Button variant="secondary" onClick={() => setStep((s) => s - 1)} disabled={register.isPending}>
                <ArrowLeft className="h-4 w-4 mr-1" />
                Orqaga
              </Button>
            )}
            <div className="flex-1" />
            {step === 0 && (
              <Button onClick={() => setStep(1)} className="gap-1.5">
                Boshlash
                <ArrowRight className="h-4 w-4" />
              </Button>
            )}
            {step > 0 && step < STEPS.length - 1 && (
              <Button onClick={() => setStep((s) => s + 1)} disabled={!canProceed()} className="gap-1.5">
                {step === STEPS.length - 2 ? "Ko'rib chiqish" : "Davom etish"}
                <ArrowRight className="h-4 w-4" />
              </Button>
            )}
            {step === STEPS.length - 1 && (
              <Button onClick={() => { void handleFinish(); }} disabled={register.isPending} className="gap-1.5 min-w-[160px]">
                {register.isPending
                  ? <><Loader2 className="h-4 w-4 animate-spin" />Yaratilmoqda...</>
                  : <><CheckCircle className="h-4 w-4" />ERP'ni ishga tushirish</>
                }
              </Button>
            )}
          </div>
        </motion.div>
      </AnimatePresence>

      <p className="text-center text-xs text-white/30 mt-4">
        Hisobingiz bormi?{" "}
        <Link to={`/${lng}/login`} className="text-primary/80 underline cursor-pointer hover:text-primary">
          Tizimga kirish
        </Link>
      </p>
    </>
  );
}

/** `POST /api/registration` — onboarding ichida alohida hook (kesh qo'lda yangilanadi). */
function useApiMutation() {
  const [isPending, setPending] = useState(false);
  return {
    isPending,
    mutateAsync: async (body: Record<string, unknown>) => {
      setPending(true);
      try {
        return await api.post<RegistrationResult>("/api/registration", body);
      } finally {
        setPending(false);
      }
    },
  };
}

// ─── Step Content ─────────────────────────────────────────────────────────────

function StepContent({
  step, form, upd, modules, toggleModule,
}: {
  step: number;
  form: FormState;
  upd: (k: keyof FormState, v: string) => void;
  modules: ModuleKey[];
  toggleModule: (key: ModuleKey) => void;
}) {

  // Step 0 — Welcome / features overview
  if (step === 0) return (
    <div className="grid grid-cols-2 gap-2.5">
      {FEATURES.map((f) => (
        <div key={f.label}
          className="flex items-center gap-2.5 p-3 rounded-xl bg-white/[0.05] border border-white/10 hover:border-primary/30 transition-colors">
          <span className="text-xl">{f.icon}</span>
          <div>
            <div className="text-sm font-medium text-white">{f.label}</div>
            <div className="text-xs text-white/45">{f.desc}</div>
          </div>
        </div>
      ))}
    </div>
  );

  // Step 1 — Company + owner account
  if (step === 1) return (
    <div className="space-y-4">
      <Field label="Kompaniya nomi" required dark>
        <Input
          placeholder="Aziz Savdo"
          value={form.companyName}
          onChange={(e) => upd("companyName", e.target.value)}
          autoFocus
          maxLength={200}
          className={inputDark}
        />
      </Field>
      <Field label="Ismingiz" dark>
        <Input
          placeholder="Aziz Karimov"
          value={form.ownerName}
          onChange={(e) => upd("ownerName", e.target.value)}
          maxLength={200}
          className={inputDark}
        />
      </Field>
      <Field label="Telefon raqam (login)" required dark>
        <Input
          type="tel"
          autoComplete="username"
          placeholder="+998901234567"
          value={form.phone}
          onChange={(e) => upd("phone", e.target.value)}
          className={inputDark}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Parol" required dark>
          <Input
            type="password"
            autoComplete="new-password"
            value={form.password}
            onChange={(e) => upd("password", e.target.value)}
            className={inputDark}
          />
        </Field>
        <Field label="Parolni tasdiqlang" required dark>
          <Input
            type="password"
            autoComplete="new-password"
            value={form.confirmPassword}
            onChange={(e) => upd("confirmPassword", e.target.value)}
            className={inputDark}
          />
        </Field>
      </div>
      {form.confirmPassword && form.password !== form.confirmPassword && (
        <p className="text-xs text-red-400">Parollar mos emas</p>
      )}
    </div>
  );

  // Step 2 — Location + currency + language
  if (step === 2) return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Davlat" required dark>
          <Select value={form.country} onValueChange={(v) => upd("country", v)}>
            <SelectTrigger className="bg-white/8 border-white/15 text-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {COUNTRIES.map((c) => (
                <SelectItem key={c.code} value={c.code}>{c.flag} {c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Shahar" dark>
          <Input
            placeholder="Toshkent"
            value={form.city}
            onChange={(e) => upd("city", e.target.value)}
            maxLength={100}
            className={inputDark}
          />
        </Field>
      </div>
      <Field label="Manzil" dark>
        <Input
          placeholder="Chilonzor, 1-uy"
          value={form.address}
          onChange={(e) => upd("address", e.target.value)}
          maxLength={500}
          className={inputDark}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Asosiy valyuta" required dark>
          <Select value={form.currency} onValueChange={(v) => upd("currency", v)}>
            <SelectTrigger className="bg-white/8 border-white/15 text-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CURRENCIES.map((c) => (
                <SelectItem key={c.code} value={c.code}>{c.symbol} {c.code} — {c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Tizim tili" dark>
          <Select value={form.language} onValueChange={(v) => upd("language", v)}>
            <SelectTrigger className="bg-white/8 border-white/15 text-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LANGUAGES.map((l) => (
                <SelectItem key={l.code} value={l.code}>{l.flag} {l.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>
    </div>
  );

  // Step 3 — Modullar: tanlanmaganlari keyin Sozlamalar → Modullar'da yoqiladi
  if (step === 3) return (
    <div className="space-y-3">
      <p className="text-xs text-white/50">
        Bog'liq modullar avtomatik belgilanadi (masalan, POS — Mahsulot va Omborga). Keyin Sozlamalar → Modullar bo'limida o'zgartirish mumkin.
      </p>
      <div className="grid grid-cols-2 gap-2">
        {MODULE_KEYS.map((key) => {
          const definition = MODULE_REGISTRY[key];
          const on = modules.includes(key);
          return (
            <button
              key={key}
              type="button"
              role="checkbox"
              aria-checked={on}
              onClick={() => toggleModule(key)}
              className={`flex items-start gap-2 rounded-xl border p-2.5 text-left transition-colors cursor-pointer ${
                on ? "border-primary/50 bg-primary/15" : "border-white/10 bg-white/[0.04] hover:border-white/25"
              }`}
            >
              <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${on ? "border-primary bg-primary" : "border-white/30"}`}>
                {on && <Check className="h-3 w-3 text-white" />}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium text-white">{definition.name}</span>
                <span className="block text-[11px] leading-snug text-white/45">{definition.description}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );

  // Step 4 — Review & finish
  if (step === 4) return (
    <div className="space-y-3">
      <SummarySection title="Kompaniya va hisob" icon={Building2}>
        {[
          ["Kompaniya nomi", form.companyName],
          ["Ism",            form.ownerName || "—"],
          ["Telefon (login)", form.phone],
        ]}
      </SummarySection>
      <SummarySection title="Joylashuv" icon={MapPin}>
        {[
          ["Davlat",  `${COUNTRIES.find((c) => c.code === form.country)?.flag ?? ""} ${COUNTRIES.find((c) => c.code === form.country)?.name ?? form.country}`],
          ["Shahar",  form.city      || "—"],
          ["Manzil",  form.address   || "—"],
          ["Valyuta", form.currency],
          ["Til",     LANGUAGES.find((l) => l.code === form.language)?.name ?? form.language],
        ]}
      </SummarySection>
      <SummarySection title="Modullar" icon={LayoutGrid}>
        {[["Tanlangan", modules.map((key) => MODULE_REGISTRY[key].name).join(", ")]]}
      </SummarySection>
      <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-start gap-2.5">
        <Sparkles className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
        <div className="text-xs text-amber-300/90">
          Asosiy filial, ombor, rollar va hisoblar rejasi avtomatik yaratiladi.
          Platforma sozlamasiga ko'ra kompaniya sinov rejimida ochilishi mumkin —
          muddat tugagach platforma admini bilan bog'laning.
        </div>
      </div>
    </div>
  );

  return null;
}

// ─── Kirgan foydalanuvchi ─────────────────────────────────────────────────────

function SignedInCard({ user }: { user: Me }) {
  const { lng = "uz" } = useParams<{ lng: string }>();
  const { signout } = useAuth();

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white/[0.06] backdrop-blur-md border border-white/10 rounded-2xl p-8 shadow-2xl text-center space-y-5"
    >
      <div className="h-16 w-16 rounded-2xl bg-primary/15 border border-primary/25 flex items-center justify-center mx-auto">
        {user.isPlatformAdmin ? <Shield className="h-8 w-8 text-primary" /> : <User className="h-8 w-8 text-primary" />}
      </div>

      {/* API'da yo'q: mavjud akkaunt uchun o'zi ikkinchi kompaniya ochish — ro'yxatdan o'tish yangi akkaunt yaratadi */}
      {user.isPlatformAdmin ? (
        <div className="space-y-2">
          <h2 className="text-xl font-bold text-white">Yangi kompaniya</h2>
          <p className="text-sm text-white/50">
            Platforma admini kompaniyani va uning egasi loginini Admin paneldan ochadi.
          </p>
          <Button asChild className="mt-2">
            <Link to={`/${lng}/admin`}>Admin paneliga o'tish</Link>
          </Button>
        </div>
      ) : user.hasCompany ? (
        <div className="space-y-2">
          <h2 className="text-xl font-bold text-white">Yangi kompaniya ochish</h2>
          <p className="text-sm text-white/50">
            Qo'shimcha kompaniyani platforma admini ochadi — support@bum-erp.uz ga murojaat qiling.
          </p>
          <Button asChild variant="secondary" className="mt-2">
            <Link to={`/${lng}/dashboard`}>Dashboardga qaytish</Link>
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <h2 className="text-xl font-bold text-white">Kompaniya biriktirilmagan</h2>
          <p className="text-sm text-white/50">
            Hisobingiz ({user.phone}) hech bir faol kompaniyaga biriktirilmagan.
            Kompaniya egasi yoki platforma admini bilan bog'laning.
          </p>
        </div>
      )}

      <button
        onClick={() => signout()}
        className="inline-flex items-center gap-2 text-xs text-white/40 hover:text-white/70 transition-colors cursor-pointer"
      >
        <LogOut className="h-3.5 w-3.5" />
        Boshqa akkaunt bilan kirish
      </button>
    </motion.div>
  );
}

// ─── Ro'yxatdan o'tish yopiq ─────────────────────────────────────────────────

function ClosedCard({ failed }: { failed: boolean }) {
  const { lng = "uz" } = useParams<{ lng: string }>();
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white/[0.06] backdrop-blur-md border border-white/10 rounded-2xl p-10 shadow-2xl text-center space-y-4"
    >
      <div className="h-16 w-16 rounded-2xl bg-amber-500/15 border border-amber-500/20 flex items-center justify-center mx-auto">
        <Settings2 className="h-8 w-8 text-amber-400" />
      </div>
      <div>
        <h2 className="text-xl font-bold text-white">
          {failed ? "Server bilan aloqa yo'q" : "Ro'yxatdan o'tish yopiq"}
        </h2>
        <p className="text-sm text-white/50 mt-2">
          {failed
            ? "Keyinroq qayta urinib ko'ring."
            : "Yangi kompaniya platforma admini tomonidan ochiladi. Platforma admini bilan bog'laning."}
        </p>
      </div>
      <p className="text-xs text-white/30">support@bum-erp.uz</p>
      <Link to={`/${lng}/login`} className="inline-block text-xs text-primary/80 underline hover:text-primary">
        Tizimga kirish
      </Link>
    </motion.div>
  );
}

// ─── Summary section ──────────────────────────────────────────────────────────

function SummarySection({
  title, icon: Icon, children,
}: {
  title: string;
  icon: React.ElementType;
  children: [string, string][];
}) {
  return (
    <div className="rounded-xl border border-white/10 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 bg-white/[0.06] border-b border-white/8">
        <Icon className="h-4 w-4 text-primary/70" />
        <span className="text-xs font-semibold text-white/60 uppercase tracking-wide">{title}</span>
      </div>
      <div className="divide-y divide-white/5">
        {children.map(([label, value]) => value && value !== "—" ? (
          <div key={label} className="flex justify-between px-4 py-2 text-sm">
            <span className="text-white/45">{label}</span>
            <span className="text-white font-medium text-right max-w-[240px] truncate">{value}</span>
          </div>
        ) : null)}
      </div>
    </div>
  );
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function Field({
  label, required, dark, children,
}: {
  label: string;
  required?: boolean;
  dark?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className={`text-sm ${dark ? "text-white/70" : ""}`}>
        {label}{required && <span className="text-red-400 ml-0.5">*</span>}
      </Label>
      {children}
    </div>
  );
}
