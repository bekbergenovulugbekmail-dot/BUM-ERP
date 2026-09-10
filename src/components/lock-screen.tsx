/**
 * LockScreen — overlaid on top of the ERP app when session is auto-locked.
 *
 * Shows:
 *  - BUM ERP logo
 *  - User avatar + name
 *  - PIN input (4-8 digits)
 *  - "Parol bilan kirish" fallback
 *
 * PIN verification is done server-side via verifyPin mutation.
 * Session userId and companyId are sent to backend for cross-checking.
 * PIN never unlocks a different user's session or crosses tenant boundary.
 */
import { useState, useRef, useEffect, useCallback } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { ConvexError } from "convex/values";
import { motion, AnimatePresence } from "motion/react";
import {
  Lock, LogOut, Eye, EyeOff, Delete, RefreshCw,
  AlertTriangle, Shield, KeyRound,
} from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { useAuth } from "@/hooks/use-auth.ts";
import { unlockScreen } from "@/hooks/use-lock-screen.ts";
import { toast } from "sonner";

const PIN_LENGTH = 6; // can be 4-8; we use 6 as default

type LockScreenProps = {
  onUnlocked: () => void;
};

type Mode = "pin" | "password";

export default function LockScreen({ onUnlocked }: LockScreenProps) {
  const { signout } = useAuth();
  const currentUser = useQuery(api.users.getCurrentUser);
  const securitySettings = useQuery(api.pin.getSecuritySettings);
  const verifyPinMutation = useMutation(api.pin.verifyPin);

  const [mode, setMode] = useState<Mode>("pin");
  const [pin, setPin] = useState("");
  const [showPin, setShowPin] = useState(false);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [shake, setShake] = useState(false);
  const [lockedUntil, setLockedUntil] = useState<Date | null>(null);
  const [lockedRemaining, setLockedRemaining] = useState(0);

  const pinInputRef = useRef<HTMLInputElement>(null);

  // Auto-focus PIN input on mount / mode change
  useEffect(() => {
    setTimeout(() => pinInputRef.current?.focus(), 100);
  }, [mode]);

  // Countdown timer for PIN lock
  useEffect(() => {
    if (!lockedUntil) return;
    const id = setInterval(() => {
      const rem = Math.max(0, Math.ceil((lockedUntil.getTime() - Date.now()) / 1000));
      setLockedRemaining(rem);
      if (rem <= 0) {
        setLockedUntil(null);
        setLockedRemaining(0);
        clearInterval(id);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [lockedUntil]);

  const triggerShake = useCallback(() => {
    setShake(true);
    setTimeout(() => setShake(false), 600);
  }, []);

  // ── PIN verification ─────────────────────────────────────────────────────

  const handlePinSubmit = async (pinValue: string) => {
    if (pinValue.length < 4) return;
    if (!currentUser) return;
    if (verifying) return;

    setVerifying(true);
    setError(null);

    try {
      const result = await verifyPinMutation({
        pin: pinValue,
        expectedUserId: currentUser._id,
        expectedCompanyId: currentUser.activeCompanyId,
      });

      if (result.success) {
        unlockScreen();
        onUnlocked();
        setPin("");
        setError(null);
      } else {
        const reason = result.reason ?? "WRONG_PIN";
        triggerShake();
        setPin("");

        if (reason.startsWith("PIN_LOCKED:")) {
          const secs = parseInt(reason.split(":")[1] ?? "300", 10);
          setLockedUntil(new Date(Date.now() + secs * 1000));
          setLockedRemaining(secs);
          setError(`PIN ${Math.ceil(secs / 60)} daqiqa bloklanди`);
        } else if (reason.startsWith("WRONG_PIN:")) {
          const remaining = reason.split(":")[1] ?? "?";
          setError(`PIN noto'g'ri. Yana ${remaining} ta urinish qoldi`);
        } else if (reason === "PIN_NOT_SET") {
          setError("PIN o'rnatilmagan. Parol bilan kiring.");
          setMode("password");
        } else if (reason === "UNAUTHENTICATED") {
          setError("Sessiya tugagan. Qayta kiring.");
        } else if (reason === "SESSION_MISMATCH" || reason === "COMPANY_MISMATCH") {
          setError("Sessiya xatosi. Qayta kiring.");
        } else {
          setError("PIN noto'g'ri");
        }
      }
    } catch (err) {
      const msg = err instanceof ConvexError
        ? (err.data as { message?: string }).message ?? "Xatolik"
        : "Xatolik yuz berdi";
      setError(msg);
      triggerShake();
      setPin("");
    } finally {
      setVerifying(false);
    }
  };

  // Auto-submit when PIN reaches expected length
  const handlePinChange = (val: string) => {
    const digits = val.replace(/\D/g, "").slice(0, 8);
    setPin(digits);
    setError(null);
    if (digits.length >= 4) {
      // small delay so user sees the last digit
      setTimeout(() => handlePinSubmit(digits), 120);
    }
  };

  // ── Password fallback (re-auth via Hercules Auth) ─────────────────────────
  // In Hercules Auth, "password unlock" = signout + signIn redirect.
  // The user will be redirected back after signing in again.
  const handlePasswordFallback = async () => {
    await signout();
  };

  const hasPIN = securitySettings?.hasPIN ?? false;

  return (
    <div className="fixed inset-0 z-[9999] bg-background/95 backdrop-blur-md flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ duration: 0.2 }}
        className="w-full max-w-sm"
      >
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2 mb-1">
            <Shield className="h-5 w-5 text-primary" />
            <span className="text-lg font-bold tracking-tight text-foreground">BUM ERP</span>
          </div>
          <p className="text-xs text-muted-foreground">Xavfsizlik tizimi</p>
        </div>

        {/* User card */}
        <div className="flex flex-col items-center gap-3 mb-8">
          <div className="h-16 w-16 rounded-2xl bg-primary/10 border-2 border-primary/20 flex items-center justify-center text-2xl font-bold text-primary select-none">
            {currentUser?.name
              ? currentUser.name[0].toUpperCase()
              : <Lock className="h-7 w-7" />}
          </div>
          <div className="text-center">
            <p className="font-semibold text-foreground">{currentUser?.name ?? "Foydalanuvchi"}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Tizim vaqtincha bloklandi</p>
          </div>
        </div>

        {/* Mode tabs */}
        {hasPIN && (
          <div className="flex rounded-xl bg-muted p-1 mb-6 gap-1">
            {(["pin", "password"] as const).map((m) => (
              <button
                key={m}
                onClick={() => { setMode(m); setError(null); setPin(""); setPassword(""); }}
                className={[
                  "flex-1 py-2 text-sm font-medium rounded-lg transition-all cursor-pointer",
                  mode === m
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                ].join(" ")}
              >
                {m === "pin" ? "PIN kod" : "Parol"}
              </button>
            ))}
          </div>
        )}

        {/* PIN locked notice */}
        {lockedUntil && lockedRemaining > 0 && (
          <div className="mb-4 p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-sm text-destructive flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>
              PIN bloklandi — {Math.ceil(lockedRemaining / 60)} daqiqa {lockedRemaining % 60} soniya qoldi
            </span>
          </div>
        )}

        {/* PIN mode */}
        <AnimatePresence mode="wait">
          {(!hasPIN || mode === "pin") && hasPIN && (
            <motion.div
              key="pin"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
              transition={{ duration: 0.15 } as const}
              className="space-y-4"
            >
              <div className="space-y-2">
                <p className="text-sm text-center text-muted-foreground mb-3">
                  {hasPIN ? "PIN kodingizni kiriting" : "PIN o'rnatilmagan. Parol bilan kiring."}
                </p>

                {/* Visual PIN dots */}
                <div className="flex justify-center gap-3 mb-4">
                  {Array.from({ length: PIN_LENGTH }).map((_, i) => (
                    <motion.div
                      key={i}
                      animate={shake ? { x: [0, -4, 4, -4, 4, 0] } : {}}
                      transition={{ duration: 0.4 } as const}
                      className={[
                        "h-4 w-4 rounded-full border-2 transition-all",
                        i < pin.length
                          ? "bg-primary border-primary"
                          : "bg-transparent border-muted-foreground/30",
                      ].join(" ")}
                    />
                  ))}
                </div>

                {/* Hidden actual input */}
                <div className="relative">
                  <Input
                    ref={pinInputRef}
                    type={showPin ? "text" : "password"}
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={pin}
                    onChange={(e) => {
                      if (!lockedUntil || lockedRemaining <= 0) {
                        handlePinChange(e.target.value);
                      }
                    }}
                    onKeyDown={(e) => e.key === "Enter" && pin.length >= 4 && handlePinSubmit(pin)}
                    disabled={verifying || (!!lockedUntil && lockedRemaining > 0)}
                    maxLength={8}
                    placeholder="••••••"
                    className="text-center text-2xl tracking-[0.5em] font-mono"
                    autoComplete="one-time-code"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPin(!showPin)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
                  >
                    {showPin ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {error && !lockedUntil && (
                <p className="text-sm text-destructive text-center flex items-center justify-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {error}
                </p>
              )}

              <div className="flex gap-2">
                <Button
                  onClick={() => handlePinSubmit(pin)}
                  disabled={pin.length < 4 || verifying || (!!lockedUntil && lockedRemaining > 0)}
                  className="flex-1 gap-2"
                >
                  {verifying ? (
                    <><span className="h-4 w-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />Tekshirilmoqda</>
                  ) : (
                    <><KeyRound className="h-4 w-4" />Ochish</>
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => { setPin(""); setError(null); }}
                  className="shrink-0"
                >
                  <Delete className="h-4 w-4" />
                </Button>
              </div>

              <div className="text-center">
                <button
                  type="button"
                  onClick={() => { setMode("password"); setPin(""); setError(null); }}
                  className="text-xs text-muted-foreground hover:text-foreground underline cursor-pointer"
                >
                  PINni unutdingizmi? Parol bilan kiring
                </button>
              </div>
            </motion.div>
          )}

          {/* Password fallback mode */}
          {(mode === "password" || !hasPIN) && (
            <motion.div
              key="password"
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              transition={{ duration: 0.15 } as const}
              className="space-y-4"
            >
              <p className="text-sm text-center text-muted-foreground">
                Telefon raqami va parolingiz bilan qayta kiring
              </p>

              <div className="p-4 rounded-xl bg-muted/50 border border-border text-sm text-muted-foreground text-center space-y-3">
                <p className="text-xs">
                  Parol bilan kirish uchun siz tizimdan chiqarilasiz va qayta autentifikatsiya qilishingiz kerak bo'ladi.
                </p>
                <Button onClick={handlePasswordFallback} className="w-full gap-2" variant="secondary">
                  <RefreshCw className="h-4 w-4" />
                  Qayta kirish
                </Button>
              </div>

              {error && (
                <p className="text-sm text-destructive text-center">{error}</p>
              )}

              {hasPIN && (
                <div className="text-center">
                  <button
                    type="button"
                    onClick={() => { setMode("pin"); setError(null); setPassword(""); }}
                    className="text-xs text-muted-foreground hover:text-foreground underline cursor-pointer"
                  >
                    PIN kod bilan ochish
                  </button>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Logout */}
        <div className="mt-8 pt-6 border-t border-border">
          <Button
            variant="ghost"
            className="w-full text-muted-foreground text-sm gap-2 hover:text-destructive"
            onClick={() => signout()}
          >
            <LogOut className="h-4 w-4" />
            Tizimdan to'liq chiqish
          </Button>
          <p className="text-[11px] text-muted-foreground/50 text-center mt-2">
            Chiqish — sessiyani to'liq tugatadi. PIN bilan ochib bo'lmaydi.
          </p>
        </div>
      </motion.div>
    </div>
  );
}
