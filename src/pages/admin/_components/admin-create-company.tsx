/**
 * Admin Create Company — platform admini yangi kompaniya (tenant) va uning egasi uchun
 * kirish akkauntini BIR amalda ochadi: `POST /api/platform/companies`.
 *
 * Server bitta tranzaksiyada yaratadi: kompaniya, "Asosiy filial", standart rollar,
 * "Asosiy ombor", hisoblar rejasi va egasining "Business Owner" a'zoligi.
 * Telefon raqami band bo'lsa — 409 (xabar ko'rsatiladi).
 */
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  DEFAULT_MODULE_SELECTION,
  MODULE_KEYS,
  MODULE_REGISTRY,
  withModuleDependencies,
  withoutModule,
  type ModuleKey,
} from "@bum/shared";
import { toast } from "sonner";
import {
  Building2, PlusCircle, Phone, Lock, Eye, EyeOff,
  Info, Copy, Check, AlertCircle, User,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Button } from "@/components/ui/button.tsx";
import { api, errorMessage } from "@/lib/api.ts";
import { useApiMutation } from "@/lib/query.ts";

const schema = z.object({
  companyName:   z.string().trim().min(2, "Kompaniya nomi kamida 2 ta belgi").max(200),
  ownerName:     z.string().max(200).optional(),
  ownerPhone:    z.string().trim().min(9, "Telefon raqam majburiy").regex(/^\+?[0-9\s-]{9,20}$/, "Telefon raqam noto'g'ri"),
  ownerPassword: z.string().min(8, "Parol kamida 8 ta belgi").max(256),
  country:       z.string().trim().regex(/^[A-Za-z]{2}$/, "2 harfli kod, masalan UZ"),
  currency:      z.string().trim().regex(/^[A-Za-z]{3}$/, "3 harfli kod, masalan UZS"),
  legalName:     z.string().max(300).optional(),
  taxId:         z.string().max(32).optional(),
  address:       z.string().max(500).optional(),
  city:          z.string().max(100).optional(),
});

type FormValues = z.infer<typeof schema>;

type CreatedCompany = {
  company: { id: string; name: string; slug: string | null; status: string; trialEndsAt: string | null };
  owner: { id: string; phone: string; name: string | null };
};

const DEFAULTS: Partial<FormValues> = { country: "UZ", currency: "UZS" };

const inputClass = "bg-white/5 border-white/10 text-white placeholder:text-white/30 focus-visible:ring-primary/40";
const labelClass = "text-xs text-white/50";

/** Bo'sh ixtiyoriy maydon yuborilmaydi (API `min(1)` talab qiladi). */
const optional = (value?: string) => value?.trim() || undefined;

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }}
      className="h-8 w-8 rounded-lg bg-white/8 hover:bg-white/15 flex items-center justify-center text-white/40 hover:text-white transition-colors cursor-pointer"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

export default function AdminCreateCompany() {
  const createCompany = useApiMutation(
    (body: Record<string, unknown>) => api.post<CreatedCompany>("/api/platform/companies", body),
    { invalidate: ["/api/platform"] },
  );
  const [showPw, setShowPw] = useState(false);
  /**
   * Qaysi modullar bilan ishlaydi — kompaniya yaratilayotganda shu yerda belgilanadi.
   * Keyinchalik o'zgartirish faqat admin panelidan (kompaniya o'zi yoqa olmaydi).
   */
  const [modules, setModules] = useState<ModuleKey[]>(() => [...DEFAULT_MODULE_SELECTION]);
  const toggleModule = (key: ModuleKey) =>
    setModules((current) =>
      // Bog'liq modullar avtomatik qo'shiladi/olib tashlanadi (masalan kassa → sotuv)
      current.includes(key)
        ? withoutModule(current, key)
        : withModuleDependencies([...current, key]),
    );
  const [created, setCreated] = useState<{ companyName: string; phone: string; password: string; slug: string } | null>(null);

  const {
    register, handleSubmit, reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: DEFAULTS,
  });

  const onSubmit = async (values: FormValues) => {
    try {
      const result = await createCompany.mutateAsync({
        name:      values.companyName.trim(),
        country:   values.country.trim().toUpperCase(),
        currency:  values.currency.trim().toUpperCase(),
        legalName: optional(values.legalName),
        taxId:     optional(values.taxId),
        address:   optional(values.address),
        city:      optional(values.city),
        modules,
        owner: {
          phone:    values.ownerPhone.trim(),
          password: values.ownerPassword,
          name:     optional(values.ownerName),
        },
      });
      setCreated({
        companyName: result.company.name,
        phone: result.owner.phone,
        password: values.ownerPassword,
        slug: result.company.slug ?? "",
      });
      toast.success("Kompaniya va egasining akkaunti yaratildi");
      reset(DEFAULTS);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <div className="space-y-5 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <PlusCircle className="h-6 w-6 text-primary" />
          Kompaniya yaratish
        </h1>
        <p className="text-sm text-white/40 mt-0.5">
          Yangi kompaniya (tenant) va biznes egasining kirish akkaunti
        </p>
      </div>

      <div className="flex items-start gap-3 p-4 rounded-xl bg-blue-500/8 border border-blue-500/20">
        <Info className="h-4 w-4 text-blue-400 shrink-0 mt-0.5" />
        <div className="text-xs text-blue-300/80 space-y-1">
          <p className="font-semibold text-blue-300">Egasi akkaunti shu yerda ochiladi</p>
          <p>
            Telefon raqam — login, parol — dastlabki parol. Biznes egasi kirgach
            Sozlamalar → Xavfsizlik bo'limida parolni almashtiradi va
            Sozlamalar → Foydalanuvchilar bo'limida xodimlar loginini o'zi ochadi.
          </p>
        </div>
      </div>

      {/* Success card — show credentials to copy */}
      {created && (
        <div className="p-5 rounded-2xl bg-green-500/8 border border-green-500/20 space-y-4">
          <div className="flex items-center gap-2">
            <Check className="h-5 w-5 text-green-400" />
            <p className="font-semibold text-green-300">
              "{created.companyName}" yaratildi!
            </p>
          </div>
          <p className="text-xs text-green-300/70">
            Quyidagi ma'lumotlarni biznes egasiga xavfsiz kanal orqali bering:
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <CredBox label="Telefon / Login" value={created.phone} />
            <CredBox label="Dastlabki parol" value={created.password} secret />
            {created.slug && <CredBox label="Portal URL" value={`app.bum-erp.uz/t/${created.slug}`} />}
          </div>
          <div className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
            <AlertCircle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-300/80">
              Parol serverda ochiq saqlanmaydi — bu oynadan keyin uni ko'rib bo'lmaydi.
              Unutilsa, Foydalanuvchilar bo'limida yangi parol o'rnatiladi.
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setCreated(null)}
            className="bg-white/8 text-white/70"
          >
            Yangi kompaniya yaratish
          </Button>
        </div>
      )}

      {!created && (
        <Card className="bg-white/5 border-white/8">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-white/80 flex items-center gap-2">
              <Building2 className="h-4 w-4" />
              Kompaniya ma'lumotlari
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">

              {/* Required fields — prominent section */}
              <div className="p-4 rounded-xl bg-primary/5 border border-primary/15 space-y-4">
                <p className="text-xs font-semibold text-primary/80 uppercase tracking-wide">Majburiy maydonlar</p>

                <div className="space-y-1.5">
                  <Label className={labelClass}>Kompaniya nomi *</Label>
                  <Input {...register("companyName")} placeholder='ALKON MChJ' className={inputClass} autoFocus />
                  {errors.companyName && <p className="text-xs text-red-400">{errors.companyName.message}</p>}
                </div>

                <div className="space-y-1.5">
                  <Label className={`${labelClass} flex items-center gap-1.5`}>
                    <Phone className="h-3 w-3" />
                    Biznes egasining telefon raqami (login) *
                  </Label>
                  <Input
                    {...register("ownerPhone")}
                    placeholder="+998901234567"
                    className={inputClass}
                    type="tel"
                  />
                  {errors.ownerPhone && <p className="text-xs text-red-400">{errors.ownerPhone.message}</p>}
                </div>

                <div className="space-y-1.5">
                  <Label className={`${labelClass} flex items-center gap-1.5`}>
                    <Lock className="h-3 w-3" />
                    Dastlabki parol *
                  </Label>
                  <div className="relative">
                    <Input
                      {...register("ownerPassword")}
                      type={showPw ? "text" : "password"}
                      placeholder="kamida 8 ta belgi"
                      className={`${inputClass} pr-10`}
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw(!showPw)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 cursor-pointer"
                    >
                      {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {errors.ownerPassword && <p className="text-xs text-red-400">{errors.ownerPassword.message}</p>}
                </div>

                <div className="space-y-1.5">
                  <Label className={`${labelClass} flex items-center gap-1.5`}>
                    <User className="h-3 w-3" />
                    Biznes egasining ismi
                  </Label>
                  <Input {...register("ownerName")} placeholder="Aziz Karimov" className={inputClass} />
                </div>
              </div>

              {/* Company details */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className={labelClass}>Davlat *</Label>
                  <Input {...register("country")} placeholder="UZ" className={inputClass} maxLength={2} />
                  {errors.country && <p className="text-xs text-red-400">{errors.country.message}</p>}
                </div>

                <div className="space-y-1.5">
                  <Label className={labelClass}>Valyuta *</Label>
                  <Input {...register("currency")} placeholder="UZS" className={inputClass} maxLength={3} />
                  {errors.currency && <p className="text-xs text-red-400">{errors.currency.message}</p>}
                </div>

                <div className="space-y-1.5">
                  <Label className={labelClass}>Yuridik nom</Label>
                  <Input {...register("legalName")} placeholder='MChJ "ALKON"' className={inputClass} />
                </div>

                <div className="space-y-1.5">
                  <Label className={labelClass}>STIR / soliq raqami</Label>
                  <Input {...register("taxId")} placeholder="123456789" className={inputClass} />
                </div>

                <div className="space-y-1.5">
                  <Label className={labelClass}>Shahar</Label>
                  <Input {...register("city")} placeholder="Toshkent" className={inputClass} />
                </div>

                <div className="space-y-1.5">
                  <Label className={labelClass}>Manzil</Label>
                  <Input {...register("address")} placeholder="Ko'cha, uy" className={inputClass} />
                </div>
                {/* API'da yo'q: mavjud foydalanuvchini egasi qilib biriktirish — egasi har doim yangi akkaunt */}
              </div>

              {/* Modullar — kompaniya qaysi bo'limlar bilan ishlaydi */}
              <div className="space-y-2" data-testid="create-company-modules">
                <Label className={labelClass}>Modullar — kompaniya qaysi bo'limlardan foydalanadi</Label>
                <div className="flex flex-wrap gap-2">
                  {MODULE_KEYS.map((key) => {
                    const on = modules.includes(key);
                    return (
                      <button
                        key={key}
                        type="button"
                        aria-pressed={on}
                        onClick={() => toggleModule(key)}
                        className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors cursor-pointer ${
                          on
                            ? "border-indigo-400/60 bg-indigo-500/20 text-indigo-200"
                            : "border-white/15 text-white/50 hover:bg-white/10"
                        }`}
                      >
                        {MODULE_REGISTRY[key].name}
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-white/40">
                  Keyinchalik modul kerak bo'lsa — shu panelning "Kompaniyalar" bo'limidan ochiladi.
                  Kompaniya o'zi yoqa olmaydi.
                </p>
              </div>

              <div className="flex justify-end pt-1">
                <Button type="submit" disabled={createCompany.isPending || modules.length === 0} className="gap-2">
                  {createCompany.isPending ? (
                    <><span className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Yaratilmoqda...</>
                  ) : (
                    <><PlusCircle className="h-4 w-4" />Kompaniya yaratish</>
                  )}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Credential display box ───────────────────────────────────────────────────
function CredBox({ label, value, secret }: { label: string; value: string; secret?: boolean }) {
  const [show, setShow] = useState(!secret);
  return (
    <div className="flex flex-col gap-1.5 p-3 rounded-xl bg-white/5 border border-white/10">
      <p className="text-[10px] text-white/40 uppercase tracking-wide font-medium">{label}</p>
      <div className="flex items-center gap-2">
        <code className="text-sm text-white font-mono flex-1 truncate">
          {show ? value : "••••••••"}
        </code>
        <div className="flex items-center gap-1">
          {secret && (
            <button
              type="button"
              onClick={() => setShow(!show)}
              className="h-7 w-7 rounded-lg bg-white/8 hover:bg-white/15 flex items-center justify-center text-white/40 hover:text-white transition-colors cursor-pointer"
            >
              {show ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
            </button>
          )}
          <CopyBtn text={value} />
        </div>
      </div>
    </div>
  );
}
