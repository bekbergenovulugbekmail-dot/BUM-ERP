/**
 * Onboarding / Company Registration page.
 *
 * Two code paths:
 *   A. New user → 5-step wizard → registerCompany → dashboard
 *   B. Platform admin with pre-existing data → Quick Setup card (1-click)
 *
 * Collected data (as per spec):
 *   USER: name/email/phone are already on the user record from the OIDC provider
 *   COMPANY: legalName, displayName, taxId, country, region, city, address, phone, email, currency, language
 *   BRANCH: name, address, phone, city
 */
import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useNavigate, useParams, Navigate } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { isAdminSubdomain } from "@/lib/subdomain.ts";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { toast } from "sonner";
import {
  Building2, MapPin, Globe, ArrowRight, ArrowLeft,
  CheckCircle, Layers, Sparkles, DatabaseZap, Loader2,
  User, GitBranch, Settings2,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";

// ─── Constants ────────────────────────────────────────────────────────────────

const STEPS = [
  { id: "welcome",    title: "Xush kelibsiz!",              icon: Layers,    subtitle: "BUM ERP — O'zbekiston biznesiga mo'ljallangan SaaS ERP" },
  { id: "company",    title: "Kompaniya ma'lumotlari",      icon: Building2, subtitle: "Yuridik va ko'rsatma nomini kiriting" },
  { id: "location",   title: "Joylashuv va sozlamalar",     icon: MapPin,    subtitle: "Manzil, valyuta va til" },
  { id: "branch",     title: "Birinchi filial",             icon: GitBranch, subtitle: "Kompaniyangizning birinchi filialni sozlang" },
  { id: "finish",     title: "Tayyor!",                     icon: CheckCircle, subtitle: "Hamma narsa sozlandi, ERP'ni ishga tushiramiz" },
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
];

const LANGUAGES = [
  { code: "uz", name: "O'zbekcha",  flag: "🇺🇿" },
  { code: "ru", name: "Русский",    flag: "🇷🇺" },
  { code: "kk", name: "Қазақша",   flag: "🇰🇿" },
];

const UZ_REGIONS = [
  "Toshkent shahri", "Toshkent viloyati", "Samarqand", "Buxoro", "Farg'ona",
  "Andijon", "Namangan", "Xorazm", "Qashqadaryo", "Surxondaryo",
  "Sirdaryo", "Jizzax", "Navoiy", "Qoraqalpog'iston",
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
  companyName: string; legalName: string; taxId: string; phone: string;
  email: string; website: string;
  address: string; city: string; region: string; country: string;
  currency: string; language: string;
  branchName: string; branchAddress: string; branchPhone: string; branchCity: string;
};

const INITIAL_FORM: FormState = {
  companyName: "", legalName: "", taxId: "", phone: "",
  email: "", website: "",
  address: "", city: "", region: "", country: "UZ",
  currency: "UZS", language: "uz",
  branchName: "Asosiy filial", branchAddress: "", branchPhone: "", branchCity: "",
};

export default function OnboardingPage() {
  const { lng = "uz" } = useParams<{ lng: string }>();
  const navigate  = useNavigate();
  const register  = useMutation(api.companies.registerCompany);
  const migrate   = useMutation(api.companies.migrateExistingDataToTenant);
  const currentUser = useQuery(api.users.getCurrentUser);
  const platformSettings = useQuery(api.companies.platformGetSettings, {});
  const registrationEnabled = useQuery(api.companies.isRegistrationEnabled, {});

  const [step,    setStep]    = useState(0);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState<FormState>(INITIAL_FORM);

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
    if (step === 1) return form.companyName.trim().length >= 2;
    if (step === 2) return !!form.country && !!form.currency;
    if (step === 3) return form.branchName.trim().length >= 2;
    return true;
  };

  const handleFinish = async () => {
    setLoading(true);
    try {
      const result = await register({
        companyName:   form.companyName,
        legalName:     form.legalName     || undefined,
        taxId:         form.taxId         || undefined,
        phone:         form.phone         || undefined,
        email:         form.email         || undefined,
        website:       form.website       || undefined,
        address:       form.address       || undefined,
        city:          form.city          || undefined,
        region:        form.region        || undefined,
        country:       form.country,
        currency:      form.currency,
        language:      form.language,
        branchName:    form.branchName,
        branchAddress: form.branchAddress || undefined,
        branchPhone:   form.branchPhone   || undefined,
        branchCity:    form.branchCity    || form.city || undefined,
      });
      toast.success("Kompaniya muvaffaqiyatli yaratildi!");
      // Redirect to tenant portal URL if slug was generated, otherwise dashboard
      if (result.slug) {
        navigate(`/t/${result.slug}`, { replace: true });
      } else {
        navigate(`/${lng}/dashboard`, { replace: true });
      }
    } catch {
      toast.error("Xatolik yuz berdi. Qayta urinib ko'ring.");
    } finally {
      setLoading(false);
    }
  };

  const handleQuickSetup = async () => {
    if (!form.companyName.trim() || form.companyName.trim().length < 2) {
      toast.error("Kompaniya nomini kiriting");
      return;
    }
    setLoading(true);
    try {
      await register({
        companyName: form.companyName,
        country:     form.country,
        currency:    form.currency,
        language:    form.language,
        branchName:  "Asosiy filial",
      });
      const result = await migrate({});
      toast.success(
        result.migrated > 0
          ? `Kompaniya yaratildi. ${result.migrated} ta yozuv ko'chirildi!`
          : "Kompaniya muvaffaqiyatli yaratildi!",
      );
      navigate(`/${lng}/dashboard`, { replace: true });
    } catch {
      toast.error("Xatolik yuz berdi. Qayta urinib ko'ring.");
    } finally {
      setLoading(false);
    }
  };

  const [showWizard, setShowWizard] = useState(false);
  const isPlatformAdmin = currentUser?.isPlatformAdmin === true;
  const isLoading       = currentUser === undefined || registrationEnabled === undefined;
  const trialDays       = platformSettings?.defaultTrialDays ?? 14;

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

        {/* Loading */}
        {isLoading && (
          <div className="bg-white/5 backdrop-blur border border-white/10 rounded-2xl p-10 shadow-2xl flex items-center justify-center gap-3 text-white/60">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">Yuklanmoqda...</span>
          </div>
        )}

        {/* Platform admin quick-setup */}
        {!isLoading && isPlatformAdmin && !showWizard && (
          <QuickSetupCard
            form={form}
            upd={upd}
            loading={loading}
            onSetup={handleQuickSetup}
            onShowWizard={() => setShowWizard(true)}
          />
        )}

        {/* Registration disabled screen — only for non-admin users */}
        {!isLoading && !isPlatformAdmin && registrationEnabled === false && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white/[0.06] backdrop-blur-md border border-white/10 rounded-2xl p-10 shadow-2xl text-center space-y-4"
          >
            <div className="h-16 w-16 rounded-2xl bg-amber-500/15 border border-amber-500/20 flex items-center justify-center mx-auto">
              <Settings2 className="h-8 w-8 text-amber-400" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">Ro'yxatdan o'tish yopiq</h2>
              <p className="text-sm text-white/50 mt-2">
                Hozirda yangi kompaniya ro'yxatdan o'tishi to'xtatilgan.
                Platforma admini bilan bog'laning.
              </p>
            </div>
            <p className="text-xs text-white/30">support@bum-erp.uz</p>
          </motion.div>
        )}

        {/* Normal wizard (new user OR admin who clicked "full wizard") */}
        {!isLoading && (isPlatformAdmin || registrationEnabled !== false) && (!isPlatformAdmin || showWizard) && (
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
                  {(() => { const Icon = STEPS[step].icon; return (
                    <div className="h-10 w-10 rounded-xl bg-primary/15 border border-primary/25 flex items-center justify-center shrink-0">
                      <Icon className="h-5 w-5 text-primary" />
                    </div>
                  ); })()}
                  <div>
                    <h2 className="text-lg font-bold text-white leading-none">{STEPS[step].title}</h2>
                    <p className="text-xs text-white/45 mt-1">{STEPS[step].subtitle}</p>
                  </div>
                </div>

                {/* Step body */}
                <StepContent step={step} form={form} upd={upd} trialDays={trialDays} />

                {/* Navigation */}
                <div className="flex gap-3 mt-7">
                  {step > 0 && step < STEPS.length - 1 && (
                    <Button variant="secondary" onClick={() => setStep((s) => s - 1)} disabled={loading}>
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
                  {step > 0 && step < STEPS.length - 2 && (
                    <Button onClick={() => setStep((s) => s + 1)} disabled={!canProceed()} className="gap-1.5">
                      Davom etish
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  )}
                  {step === STEPS.length - 2 && (
                    <Button onClick={() => { if (canProceed()) setStep(STEPS.length - 1); }} disabled={!canProceed()} className="gap-1.5">
                      Ko'rib chiqish
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  )}
                  {step === STEPS.length - 1 && (
                    <Button onClick={handleFinish} disabled={loading} className="gap-1.5 min-w-[160px]">
                      {loading
                        ? <><Loader2 className="h-4 w-4 animate-spin" />Yaratilmoqda...</>
                        : <><CheckCircle className="h-4 w-4" />ERP'ni ishga tushirish</>
                      }
                    </Button>
                  )}
                </div>
              </motion.div>
            </AnimatePresence>

            {/* Sign out link */}
            <p className="text-center text-xs text-white/30 mt-4">
              Allaqachon kompaniyangiz bormi?{" "}
              <a href="/uz/select-company" className="text-primary/80 underline cursor-pointer hover:text-primary">
                Kompaniyani tanlash
              </a>
            </p>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Step Content ─────────────────────────────────────────────────────────────

function StepContent({
  step, form, upd, trialDays,
}: {
  step: number;
  form: FormState;
  upd: (k: keyof FormState, v: string) => void;
  trialDays: number;
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

  // Step 1 — Company info
  if (step === 1) return (
    <div className="space-y-4">
      <Field label="Kompaniya nomi (ko'rsatma)" required dark>
        <Input
          placeholder="Aziz Savdo"
          value={form.companyName}
          onChange={(e) => upd("companyName", e.target.value)}
          autoFocus
          className="bg-white/8 border-white/15 text-white placeholder:text-white/30 focus:border-primary/60"
        />
      </Field>
      <Field label="Yuridik nom (to'liq)" dark>
        <Input
          placeholder={'MChJ "Aziz Savdo"'}
          value={form.legalName}
          onChange={(e) => upd("legalName", e.target.value)}
          className="bg-white/8 border-white/15 text-white placeholder:text-white/30 focus:border-primary/60"
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="STIR / Soliq ID" dark>
          <Input
            placeholder="123456789"
            value={form.taxId}
            onChange={(e) => upd("taxId", e.target.value)}
            className="bg-white/8 border-white/15 text-white placeholder:text-white/30 focus:border-primary/60"
          />
        </Field>
        <Field label="Telefon" dark>
          <Input
            placeholder="+998 90 123 45 67"
            value={form.phone}
            onChange={(e) => upd("phone", e.target.value)}
            className="bg-white/8 border-white/15 text-white placeholder:text-white/30 focus:border-primary/60"
          />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Email" dark>
          <Input
            type="email"
            placeholder="info@company.uz"
            value={form.email}
            onChange={(e) => upd("email", e.target.value)}
            className="bg-white/8 border-white/15 text-white placeholder:text-white/30 focus:border-primary/60"
          />
        </Field>
        <Field label="Veb-sayt" dark>
          <Input
            placeholder="www.company.uz"
            value={form.website}
            onChange={(e) => upd("website", e.target.value)}
            className="bg-white/8 border-white/15 text-white placeholder:text-white/30 focus:border-primary/60"
          />
        </Field>
      </div>
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
        <Field label="Viloyat / Region" dark>
          <Select value={form.region} onValueChange={(v) => upd("region", v)}>
            <SelectTrigger className="bg-white/8 border-white/15 text-white">
              <SelectValue placeholder="Tanlang" />
            </SelectTrigger>
            <SelectContent>
              {UZ_REGIONS.map((r) => (
                <SelectItem key={r} value={r}>{r}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Shahar" dark>
          <Input
            placeholder="Toshkent"
            value={form.city}
            onChange={(e) => upd("city", e.target.value)}
            className="bg-white/8 border-white/15 text-white placeholder:text-white/30 focus:border-primary/60"
          />
        </Field>
        <Field label="Manzil" dark>
          <Input
            placeholder="Chilonzor, 1-uy"
            value={form.address}
            onChange={(e) => upd("address", e.target.value)}
            className="bg-white/8 border-white/15 text-white placeholder:text-white/30 focus:border-primary/60"
          />
        </Field>
      </div>
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

  // Step 3 — First branch
  if (step === 3) return (
    <div className="space-y-4">
      <div className="p-3 rounded-xl bg-primary/10 border border-primary/20 text-xs text-primary/90 flex items-start gap-2">
        <GitBranch className="h-4 w-4 shrink-0 mt-0.5" />
        <span>Keyinchalik Settings → Filiallar bo'limida qo'shimcha filiallar qo'shishingiz mumkin.</span>
      </div>
      <Field label="Filial nomi" required dark>
        <Input
          placeholder="Asosiy filial"
          value={form.branchName}
          onChange={(e) => upd("branchName", e.target.value)}
          autoFocus
          className="bg-white/8 border-white/15 text-white placeholder:text-white/30 focus:border-primary/60"
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Filial shahri" dark>
          <Input
            placeholder={form.city || "Toshkent"}
            value={form.branchCity}
            onChange={(e) => upd("branchCity", e.target.value)}
            className="bg-white/8 border-white/15 text-white placeholder:text-white/30 focus:border-primary/60"
          />
        </Field>
        <Field label="Filial telefoni" dark>
          <Input
            placeholder="+998 71 123 45 67"
            value={form.branchPhone}
            onChange={(e) => upd("branchPhone", e.target.value)}
            className="bg-white/8 border-white/15 text-white placeholder:text-white/30 focus:border-primary/60"
          />
        </Field>
      </div>
      <Field label="Filial manzili" dark>
        <Input
          placeholder="Ko'cha, bino"
          value={form.branchAddress}
          onChange={(e) => upd("branchAddress", e.target.value)}
          className="bg-white/8 border-white/15 text-white placeholder:text-white/30 focus:border-primary/60"
        />
      </Field>
    </div>
  );

  // Step 4 — Review & finish
  if (step === 4) return (
    <div className="space-y-3">
      <SummarySection title="Kompaniya" icon={Building2}>
        {[
          ["Ko'rsatma nomi", form.companyName],
          ["Yuridik nom",    form.legalName    || "—"],
          ["STIR",           form.taxId         || "—"],
          ["Telefon",        form.phone         || "—"],
          ["Email",          form.email         || "—"],
        ]}
      </SummarySection>
      <SummarySection title="Joylashuv" icon={MapPin}>
        {[
          ["Davlat",  `${COUNTRIES.find((c) => c.code === form.country)?.flag ?? ""} ${COUNTRIES.find((c) => c.code === form.country)?.name ?? form.country}`],
          ["Viloyat", form.region    || "—"],
          ["Shahar",  form.city      || "—"],
          ["Manzil",  form.address   || "—"],
          ["Valyuta", form.currency],
          ["Til",     LANGUAGES.find((l) => l.code === form.language)?.name ?? form.language],
        ]}
      </SummarySection>
      <SummarySection title="Birinchi filial" icon={GitBranch}>
        {[
          ["Filial nomi",    form.branchName],
          ["Filial shahri",  form.branchCity    || form.city || "—"],
          ["Filial telefoni",form.branchPhone   || "—"],
        ]}
      </SummarySection>
      {/* Trial period notice */}
      {trialDays > 0 && (
        <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-start gap-2.5">
          <Sparkles className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
          <div className="text-xs text-amber-300/90">
            <span className="font-semibold">Sinov muddati:</span>{" "}
            Kompaniya yaratilgandan keyin <span className="font-bold">{trialDays} kun</span> bepul sinov rejimida ishlaydi.
            Sinov tugagach platforma admini bilan bog'laning.
          </div>
        </div>
      )}
      {trialDays === 0 && (
        <div className="p-3 rounded-xl bg-green-500/10 border border-green-500/20 flex items-start gap-2.5">
          <CheckCircle className="h-4 w-4 text-green-400 shrink-0 mt-0.5" />
          <div className="text-xs text-green-300/90">
            Kompaniya <span className="font-semibold">sinov muddatisiz</span> aktiv rejimda yaratiladi.
          </div>
        </div>
      )}
    </div>
  );

  return null;
}

// ─── Quick Setup Card ─────────────────────────────────────────────────────────

function QuickSetupCard({
  form, upd, loading, onSetup, onShowWizard,
}: {
  form: FormState;
  upd: (k: keyof FormState, v: string) => void;
  loading: boolean;
  onSetup: () => void;
  onShowWizard: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white/[0.06] backdrop-blur-md border border-white/10 rounded-2xl p-7 shadow-2xl space-y-5"
    >
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-amber-500/15 border border-amber-500/25 flex items-center justify-center">
          <Sparkles className="h-5 w-5 text-amber-400" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-white leading-none">Platform Admin — Tezkor sozlash</h2>
          <p className="text-xs text-white/45 mt-1">Siz birinchi foydalanuvchisiz — kompaniyani yarating va mavjud ma'lumotlarni ko'chiring</p>
        </div>
      </div>

      <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300">
        <DatabaseZap className="h-4 w-4 shrink-0 mt-0.5" />
        <span>Barcha mavjud mahsulotlar, buyurtmalar, xodimlar va boshqa ma'lumotlar yangi kompaniyaga avtomatik ko'chiriladi.</span>
      </div>

      <div className="space-y-3">
        <Field label="Kompaniya nomi" required dark>
          <Input
            placeholder="Aziz Savdo MChJ"
            value={form.companyName}
            onChange={(e) => upd("companyName", e.target.value)}
            autoFocus
            className="bg-white/8 border-white/15 text-white placeholder:text-white/30"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Davlat" dark>
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
          <Field label="Valyuta" dark>
            <Select value={form.currency} onValueChange={(v) => upd("currency", v)}>
              <SelectTrigger className="bg-white/8 border-white/15 text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CURRENCIES.map((c) => (
                  <SelectItem key={c.code} value={c.code}>{c.symbol} {c.code}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
      </div>

      <Button
        className="w-full"
        size="lg"
        onClick={onSetup}
        disabled={loading || form.companyName.trim().length < 2}
      >
        {loading
          ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Sozlanmoqda...</>
          : <><DatabaseZap className="h-4 w-4 mr-2" />Kompaniyani yaratish va ma'lumotlarni ko'chirish</>
        }
      </Button>

      <p className="text-center text-xs text-white/30">
        Yoki{" "}
        <button onClick={onShowWizard} className="text-primary/80 underline cursor-pointer hover:text-primary">
          to'liq wizardni oching
        </button>
        {" "}(qo'shimcha ma'lumotlar kiriting)
      </p>
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
