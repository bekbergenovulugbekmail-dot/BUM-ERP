/**
 * Admin Platform Settings
 * - Registration on/off toggle
 * - Default trial days input
 * - Bootstrap admin
 * - Legacy data cleanup
 * - Platform info
 */
import { useState, useEffect } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { ConvexError } from "convex/values";
import { toast } from "sonner";
import {
  KeyRound, ShieldAlert, Info, Settings,
  ToggleLeft, ToggleRight, Clock, Save, Loader2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";

const inputClass = "bg-white/5 border-white/10 text-white placeholder:text-white/30";
const labelClass = "text-xs text-white/50";

export default function AdminPlatformSettings() {
  const setAdminByEmail = useMutation(api.companies.platformSetAdminByEmail);
  const markLegacy      = useMutation(api.companies.platformMarkOrphanedDataAsLegacy);
  const saveSettings    = useMutation(api.companies.platformSaveSettings);
  const platformSettings = useQuery(api.companies.platformGetSettings, {});

  // Bootstrap admin
  const [email,       setEmail]       = useState("");
  const [secretKey,   setSecretKey]   = useState("");
  const [bootstrapping, setBootstrapping] = useState(false);
  const [migrating,   setMigrating]   = useState(false);

  // Platform settings form
  const [regEnabled,  setRegEnabled]  = useState(true);
  const [trialDays,   setTrialDays]   = useState(14);
  const [saving,      setSaving]      = useState(false);

  // Sync from DB when loaded
  useEffect(() => {
    if (platformSettings) {
      setRegEnabled(platformSettings.registrationEnabled);
      setTrialDays(platformSettings.defaultTrialDays);
    }
  }, [platformSettings]);

  const deploymentUrl = typeof window !== "undefined" ? window.location.origin : "—";

  const handleBootstrap = async () => {
    if (!email.trim() || !secretKey.trim()) {
      toast.error("Email va maxfiy kalitni kiriting");
      return;
    }
    setBootstrapping(true);
    try {
      const result = await setAdminByEmail({ email: email.trim(), secretKey: secretKey.trim() });
      toast.success(`Admin huquqlari berildi: ${result.email ?? result.userId}`);
      setEmail("");
      setSecretKey("");
    } catch (err) {
      const message =
        err instanceof ConvexError
          ? (err.data as { message?: string }).message ?? "Xatolik yuz berdi"
          : "Xatolik yuz berdi";
      toast.error(message);
    } finally {
      setBootstrapping(false);
    }
  };

  const handleMarkLegacy = async () => {
    setMigrating(true);
    try {
      const result = await markLegacy({});
      toast.success(`${result.marked} ta eskirgan yozuv belgilandi`);
    } catch {
      toast.error("Xatolik yuz berdi");
    } finally {
      setMigrating(false);
    }
  };

  const handleSaveSettings = async () => {
    const days = Math.max(0, Math.round(trialDays));
    setSaving(true);
    try {
      await saveSettings({ registrationEnabled: regEnabled, defaultTrialDays: days });
      toast.success("Sozlamalar saqlandi");
    } catch {
      toast.error("Xatolik yuz berdi");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <Settings className="h-6 w-6 text-primary" />
          Platforma sozlamalari
        </h1>
        <p className="text-sm text-white/40 mt-0.5">
          Ro'yxatdan o'tish, sinov muddati, bootstrap va ma'lumotlar
        </p>
      </div>

      {/* Registration & Trial Settings */}
      <Card className="bg-white/5 border-white/8">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-white/80 flex items-center gap-2">
            <ToggleRight className="h-4 w-4 text-primary" />
            Ro'yxatdan o'tish sozlamalari
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {platformSettings === undefined ? (
            <div className="space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : (
            <>
              {/* Registration toggle */}
              <div className="flex items-center justify-between p-3 rounded-xl bg-white/4 border border-white/8">
                <div>
                  <p className="text-sm font-medium text-white">Ro'yxatdan o'tishni yoqish</p>
                  <p className="text-xs text-white/40 mt-0.5">
                    O'chirilsa yangi biznes egalari ro'yxatdan o'ta olmaydi
                  </p>
                </div>
                <button
                  onClick={() => setRegEnabled(!regEnabled)}
                  className="cursor-pointer transition-colors"
                >
                  {regEnabled
                    ? <ToggleRight className="h-8 w-8 text-primary" />
                    : <ToggleLeft  className="h-8 w-8 text-white/30" />}
                </button>
              </div>

              {/* Trial days */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-amber-400" />
                  <Label className="text-xs text-white/70 font-medium">
                    Sinov muddati (kun)
                  </Label>
                </div>
                <div className="flex items-center gap-3">
                  <Input
                    type="number"
                    min={0}
                    max={365}
                    value={trialDays}
                    onChange={(e) => setTrialDays(parseInt(e.target.value) || 0)}
                    className={`${inputClass} w-28`}
                  />
                  <p className="text-xs text-white/40">
                    {trialDays === 0
                      ? "0 = sinov muddatisiz, kompaniya to'g'ridan-to'g'ri aktiv bo'ladi"
                      : `Yangi kompaniya ro'yxatdan o'tgandan keyin ${trialDays} kun sinov rejimida bo'ladi`}
                  </p>
                </div>
              </div>

              <div className="flex justify-end">
                <Button onClick={handleSaveSettings} disabled={saving} className="gap-2">
                  {saving
                    ? <><Loader2 className="h-4 w-4 animate-spin" />Saqlanmoqda...</>
                    : <><Save className="h-4 w-4" />Saqlash</>}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Bootstrap Admin */}
      <Card className="bg-white/5 border-white/8">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-white/80 flex items-center gap-2">
            <KeyRound className="h-4 w-4" />
            Bootstrap admin
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-white/40">
            Maxfiy kalit yordamida foydalanuvchiga platforma admin huquqlarini bering.
            Foydalanuvchi avval tizimga kirgan bo'lishi kerak.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className={labelClass}>Email</Label>
              <Input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="example@gmail.com"
                className={inputClass}
              />
            </div>
            <div className="space-y-1.5">
              <Label className={labelClass}>Maxfiy kalit</Label>
              <Input
                type="password"
                value={secretKey}
                onChange={(e) => setSecretKey(e.target.value)}
                placeholder="••••••••"
                className={inputClass}
              />
            </div>
          </div>
          <div className="flex justify-end">
            <Button onClick={handleBootstrap} disabled={bootstrapping}>
              {bootstrapping ? "Bajarilmoqda..." : "Admin huquqlarini berish"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Legacy Data Cleanup */}
      <Card className="bg-white/5 border-white/8">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-white/80 flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-amber-400" />
            Eskirgan ma'lumotlarni tozalash
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-white/40">
            Multi-tenant tizimga o'tishdan oldin yaratilgan companyId-siz yozuvlarni sentinel
            belgisi bilan belgilaydi. Bu yozuvlar hech bir tenant uchun ko'rinmaydi.
          </p>
          <div className="flex justify-end">
            <Button
              variant="secondary"
              className="bg-amber-500/20 border-amber-500/30 text-amber-300 hover:bg-amber-500/30"
              onClick={handleMarkLegacy}
              disabled={migrating}
            >
              {migrating ? "Bajarilmoqda..." : "Belgilash"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Platform info */}
      <Card className="bg-white/5 border-white/8">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-white/80 flex items-center gap-2">
            <Info className="h-4 w-4" />
            Platforma ma'lumotlari
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <div className="flex flex-col gap-0.5">
              <dt className="text-xs text-white/40">Versiya</dt>
              <dd className="text-white font-medium">BUM ERP v1.0</dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-xs text-white/40">Deployment URL</dt>
              <dd className="text-white font-medium break-all">{deploymentUrl}</dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-xs text-white/40">Ro'yxatdan o'tish holati</dt>
              <dd className={platformSettings?.registrationEnabled ? "text-green-400 font-medium" : "text-red-400 font-medium"}>
                {platformSettings === undefined ? "—" : platformSettings.registrationEnabled ? "Yoqiq" : "O'chirilgan"}
              </dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-xs text-white/40">Standart sinov muddati</dt>
              <dd className="text-white font-medium">
                {platformSettings === undefined ? "—" : platformSettings.defaultTrialDays === 0 ? "Yo'q" : `${platformSettings.defaultTrialDays} kun`}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
