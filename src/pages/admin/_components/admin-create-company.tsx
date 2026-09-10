/**
 * Admin Create Company — platform admins can provision a new company (tenant)
 * and assign a Business Owner by phone number (Hercules Auth username).
 *
 * Majburiy maydonlar:
 *   1. Kompaniya nomi
 *   2. Biznes egasining telefon raqami (username sifatida)
 *   3. Dastlabki parol
 *
 * MUHIM: Hercules Auth akkauntlari faqat Hercules Dashboard → Branding → Users
 * bo'limidan yaratiladi. Bu forma biznes egasi uchun akkaunt yaratish
 * ko'rsatmasi va kompaniya DB yozuvini birga boshqaradi.
 */
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel";
import { ConvexError } from "convex/values";
import { toast } from "sonner";
import {
  Building2, PlusCircle, Phone, Lock, Eye, EyeOff,
  Info, Copy, Check, ExternalLink, AlertCircle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Button } from "@/components/ui/button.tsx";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select.tsx";

const schema = z.object({
  companyName:   z.string().min(2, "Kompaniya nomi kamida 2 ta belgi"),
  ownerPhone:    z.string().min(9, "Telefon raqam majburiy").regex(/^\+?[0-9]{9,15}$/, "Telefon raqam noto'g'ri"),
  ownerPassword: z.string().min(6, "Parol kamida 6 ta belgi"),
  country:       z.string().min(1, "Davlat majburiy"),
  currency:      z.string().min(1, "Valyuta majburiy"),
  legalName:     z.string().optional(),
  taxId:         z.string().optional(),
  email:         z.string().optional(),
  address:       z.string().optional(),
  city:          z.string().optional(),
  ownerUserId:   z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

const inputClass = "bg-white/5 border-white/10 text-white placeholder:text-white/30 focus-visible:ring-primary/40";
const labelClass = "text-xs text-white/50";

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
  const createCompany = useMutation(api.companies.platformCreateCompany);
  const users = useQuery(api.companies.platformListAllUsers);
  const [submitting, setSubmitting] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [created, setCreated] = useState<{ companyName: string; phone: string; password: string; slug: string } | null>(null);

  const {
    register, handleSubmit, reset, setValue, watch,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { country: "UZ", currency: "UZS", ownerUserId: "none" },
  });

  const ownerUserId = watch("ownerUserId");
  const watchPhone  = watch("ownerPhone");
  const watchPw     = watch("ownerPassword");

  const onSubmit = async (values: FormValues) => {
    setSubmitting(true);
    try {
      const result = await createCompany({
        companyName: values.companyName,
        country:     values.country,
        currency:    values.currency,
        legalName:   values.legalName || undefined,
        taxId:       values.taxId || undefined,
        email:       values.email || undefined,
        phone:       values.ownerPhone || undefined,
        address:     values.address || undefined,
        city:        values.city || undefined,
        ownerUserId:
          values.ownerUserId && values.ownerUserId !== "none"
            ? (values.ownerUserId as Id<"users">)
            : undefined,
      });
      setCreated({
        companyName: values.companyName,
        phone: values.ownerPhone,
        password: values.ownerPassword,
        slug: result?.slug ?? "",
      });
      toast.success("Kompaniya yaratildi");
      reset({ country: "UZ", currency: "UZS", ownerUserId: "none" });
    } catch (err) {
      const message =
        err instanceof ConvexError
          ? (err.data as { message?: string }).message ?? "Xatolik yuz berdi"
          : "Xatolik yuz berdi";
      toast.error(message);
    } finally {
      setSubmitting(false);
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
          Platforma nomidan yangi kompaniya (tenant) yarating
        </p>
      </div>

      {/* Hercules Auth notice */}
      <div className="flex items-start gap-3 p-4 rounded-xl bg-blue-500/8 border border-blue-500/20">
        <Info className="h-4 w-4 text-blue-400 shrink-0 mt-0.5" />
        <div className="text-xs text-blue-300/80 space-y-1">
          <p className="font-semibold text-blue-300">Muhim: Hercules Auth akkauntini ham yaratish kerak</p>
          <p>
            Bu forma faqat kompaniya yozuvini yaratadi. Biznes egasi tizimga kirishi uchun
            {" "}<strong>Hercules Dashboard → Branding → Users</strong>{" "}
            bo'limida ham username=telefon, parol=quyidagi parol bilan akkaunt yarating.
          </p>
          <a
            href="https://hercules.app/dashboard"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-blue-400 hover:text-blue-300 underline mt-1"
          >
            <ExternalLink className="h-3 w-3" />
            Hercules Dashboard
          </a>
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
            Quyidagi ma'lumotlarni biznes egasiga bering va Hercules Auth'da ham akkaunt oching:
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <CredBox label="Telefon / Username" value={created.phone} />
            <CredBox label="Dastlabki parol" value={created.password} secret />
            {created.slug && <CredBox label="Portal URL" value={`app.bum-erp.uz/t/${created.slug}`} />}
          </div>
          <div className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
            <AlertCircle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-300/80">
              Parolni xavfsiz saqlang. Keyinroq ko'rish imkoni yo'q.
              Biznes egasi kirganidan keyin parolni o'zgartirishi mumkin.
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
                  <p className="text-[11px] text-white/25">
                    Bu telefon raqam Hercules Auth'da username sifatida ishlatiladi
                  </p>
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
                      placeholder="kamida 6 ta belgi"
                      className={`${inputClass} pr-10`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw(!showPw)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 cursor-pointer"
                    >
                      {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  <p className="text-[11px] text-white/25">
                    Biznes egasi kirganidan keyin o'zgartirishi mumkin. Parolni xavfsiz saqlang.
                  </p>
                  {errors.ownerPassword && <p className="text-xs text-red-400">{errors.ownerPassword.message}</p>}
                </div>
              </div>

              {/* Company details */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className={labelClass}>Davlat *</Label>
                  <Input {...register("country")} placeholder="UZ" className={inputClass} />
                  {errors.country && <p className="text-xs text-red-400">{errors.country.message}</p>}
                </div>

                <div className="space-y-1.5">
                  <Label className={labelClass}>Valyuta *</Label>
                  <Input {...register("currency")} placeholder="UZS" className={inputClass} />
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
                  <Label className={labelClass}>Email</Label>
                  <Input {...register("email")} placeholder="company@example.com" className={inputClass} />
                </div>

                <div className="space-y-1.5">
                  <Label className={labelClass}>Shahar</Label>
                  <Input {...register("city")} placeholder="Toshkent" className={inputClass} />
                </div>

                <div className="space-y-1.5 sm:col-span-2">
                  <Label className={labelClass}>Manzil</Label>
                  <Input {...register("address")} placeholder="Ko'cha, uy" className={inputClass} />
                </div>

                {/* Optional: link to existing user */}
                <div className="space-y-1.5 sm:col-span-2">
                  <Label className={labelClass}>Mavjud foydalanuvchiga biriktirish (ixtiyoriy)</Label>
                  <Select
                    value={ownerUserId ?? "none"}
                    onValueChange={(val) => setValue("ownerUserId", val)}
                  >
                    <SelectTrigger className={inputClass}>
                      <SelectValue placeholder="Foydalanuvchi tanlang" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Egasiz (keyinroq biriktiriladi)</SelectItem>
                      {(users ?? []).map((u) => (
                        <SelectItem key={u._id} value={u._id}>
                          {u.name ?? u.email ?? u._id}
                          {u.email ? ` (${u.email})` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-white/30">
                    Tanlangan foydalanuvchi "Business Owner" sifatida biriktiriladi
                  </p>
                </div>
              </div>

              <div className="flex justify-end pt-1">
                <Button type="submit" disabled={submitting} className="gap-2">
                  {submitting ? (
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

      {/* Hercules Auth step-by-step guide */}
      <Card className="bg-white/5 border-white/8">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-white/80 flex items-center gap-2">
            <Info className="h-4 w-4 text-blue-400" />
            Hercules Auth'da akkaunt yaratish tartibi
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="space-y-2.5 text-xs text-white/50">
            {[
              ["Hercules.app ga o'ting", "https://hercules.app dashboard'iga kiring"],
              ["Branding → Users bo'limini oching", "Chap menyu → Branding → Users"],
              ["\"Username and password\" metodini yoqing", "Agar yoqilmagan bo'lsa, avval Configure tugmasini bosing"],
              ["\"+ Add user\" tugmasini bosing", "Yangi foydalanuvchi yaratish formasi ochiladi"],
              ["Username = telefon raqam", "Masalan: +998901234567"],
              ["Parolni kiriting", "Yuqoridagi formada ko'rsatilgan parolni kiriting"],
              ["Saqlang va biznes egasiga yuboring", "Endi biznes egasi shu ma'lumotlar bilan tizimga kira oladi"],
            ].map(([title, desc], i) => (
              <li key={i} className="flex items-start gap-2.5">
                <span className="h-5 w-5 rounded-full bg-white/10 text-white/50 text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                  {i + 1}
                </span>
                <div>
                  <p className="text-white/70 font-medium">{title}</p>
                  <p className="text-white/35 mt-0.5">{desc}</p>
                </div>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
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
