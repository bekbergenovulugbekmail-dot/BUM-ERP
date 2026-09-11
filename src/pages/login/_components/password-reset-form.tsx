/**
 * SMS kod orqali parolni tiklash — kirish sahifasi ichida (`/api/auth/password-reset/*`).
 *
 * - server raqam ro'yxatdan o'tganini oshkor qilmaydi: so'rov har doim "yuborildi" deydi
 * - SMS sozlanmagan bo'lsa (503) server xabari ko'rsatiladi — administratorga murojaat
 * - muvaffaqiyatli tiklashda serverda barcha sessiyalar bekor qilinadi; foydalanuvchi yangi parol bilan kiradi
 */
import { useEffect, useState } from "react";
import { AlertTriangle, ArrowLeft, KeyRound, Loader2, Lock, MessageSquare, Phone } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { api, errorMessage } from "@/lib/api.ts";

const RESEND_SECONDS = 60;

const inputClass =
  "w-full h-11 rounded-xl bg-white/5 border border-white/10 pl-9 pr-3 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/30 transition-all";

type Props = {
  initialPhone: string;
  onDone: (phone: string) => void;
  onCancel: () => void;
};

export function PasswordResetForm({ initialPhone, onDone, onCancel }: Props) {
  const [step, setStep] = useState<"request" | "confirm">("request");
  const [phone, setPhone] = useState(initialPhone);
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [repeatPassword, setRepeatPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const requestCode = async () => {
    if (!phone.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await api.post<{ message?: string }>("/api/auth/password-reset/request", { phone: phone.trim() });
      setInfo(result?.message ?? "Agar raqam ro'yxatdan o'tgan bo'lsa, SMS kod yuborildi");
      setStep("confirm");
      setCooldown(RESEND_SECONDS);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const confirmReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== repeatPassword) {
      setError("Parollar bir xil emas");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await api.post("/api/auth/password-reset/confirm", { phone: phone.trim(), code, newPassword });
      onDone(phone.trim());
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">Parolni tiklash</h2>
        <p className="text-white/40 mt-1.5 text-sm">
          {step === "request"
            ? "Telefon raqamingizga 6 xonali tasdiqlash kodi yuboriladi"
            : "SMS dagi kodni va yangi parolni kiriting"}
        </p>
      </div>

      {step === "request" ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void requestCode();
          }}
          className="space-y-4"
        >
          <div className="space-y-1.5">
            <label htmlFor="reset-phone" className="text-xs font-medium text-white/50">
              Telefon raqam
            </label>
            <div className="relative">
              <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/25" />
              <input
                id="reset-phone"
                type="tel"
                autoComplete="username"
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value);
                  setError(null);
                }}
                placeholder="+998901234567"
                className={inputClass}
              />
            </div>
          </div>

          {error && <ErrorBanner message={error} />}

          <Button type="submit" size="lg" disabled={submitting || !phone.trim()} className="w-full gap-2 h-12 text-base font-semibold">
            {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : <MessageSquare className="h-4 w-4" />}
            Kod yuborish
          </Button>
        </form>
      ) : (
        <form onSubmit={(e) => void confirmReset(e)} className="space-y-4">
          {info && (
            <div className="text-xs text-emerald-300 bg-emerald-400/10 border border-emerald-400/20 rounded-lg px-3 py-2.5">
              {info} <span className="text-white/40">({phone.trim()})</span>
            </div>
          )}

          <div className="space-y-1.5">
            <label htmlFor="reset-code" className="text-xs font-medium text-white/50">
              SMS kod
            </label>
            <div className="relative">
              <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/25" />
              <input
                id="reset-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => {
                  setCode(e.target.value.replace(/\D/g, "").slice(0, 6));
                  setError(null);
                }}
                placeholder="••••••"
                className={`${inputClass} tracking-[0.4em] font-mono`}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="reset-password" className="text-xs font-medium text-white/50">
              Yangi parol
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/25" />
              <input
                id="reset-password"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => {
                  setNewPassword(e.target.value);
                  setError(null);
                }}
                className={inputClass}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="reset-password-repeat" className="text-xs font-medium text-white/50">
              Yangi parolni takrorlang
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/25" />
              <input
                id="reset-password-repeat"
                type="password"
                autoComplete="new-password"
                value={repeatPassword}
                onChange={(e) => {
                  setRepeatPassword(e.target.value);
                  setError(null);
                }}
                className={inputClass}
              />
            </div>
          </div>

          {error && <ErrorBanner message={error} />}

          <Button
            type="submit"
            size="lg"
            disabled={submitting || code.length !== 6 || !newPassword || !repeatPassword}
            className="w-full gap-2 h-12 text-base font-semibold"
          >
            {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
            Parolni yangilash
          </Button>

          <div className="flex items-center justify-between text-xs">
            <button
              type="button"
              onClick={() => {
                setStep("request");
                setCode("");
                setError(null);
              }}
              className="text-white/40 hover:text-white/70 transition-colors cursor-pointer"
            >
              Raqamni o'zgartirish
            </button>
            <button
              type="button"
              disabled={cooldown > 0 || submitting}
              onClick={() => void requestCode()}
              className="text-primary/70 hover:text-primary disabled:text-white/25 disabled:cursor-not-allowed transition-colors cursor-pointer"
            >
              {cooldown > 0 ? `Qayta yuborish (${cooldown})` : "Kodni qayta yuborish"}
            </button>
          </div>
        </form>
      )}

      <button
        type="button"
        onClick={onCancel}
        className="flex items-center gap-1.5 text-xs text-white/40 hover:text-white/70 transition-colors cursor-pointer"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Kirish sahifasiga qaytish
      </button>
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2.5">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      {message}
    </div>
  );
}
