/**
 * Admin Platform Settings — `GET/PUT /api/platform/settings`
 * - Ro'yxatdan o'tishni yoqish/o'chirish (standart holatda YOPIQ)
 * - Sinov muddati, platforma nomi, qo'llab-quvvatlash email
 * - Bootstrap admin haqida ma'lumot (UI orqali emas — `.env` + `db:seed`)
 */
import { useState, useEffect } from "react";
import { toast } from "sonner";
import {
  KeyRound, Info, Settings,
  ToggleLeft, ToggleRight, Clock, Save, Loader2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { api, errorMessage } from "@/lib/api.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";
import type { PlatformSettings } from "../_lib/types.ts";

const inputClass = "bg-white/5 border-white/10 text-white placeholder:text-white/30";

export default function AdminPlatformSettings() {
  const settingsQuery = useApiQuery<{ settings: PlatformSettings }>("/api/platform/settings");
  const platformSettings = settingsQuery.data?.settings;
  const saveSettings = useApiMutation(
    (patch: Partial<PlatformSettings>) => api.put<{ settings: PlatformSettings }>("/api/platform/settings", patch),
    { invalidate: ["/api/platform/settings", "/api/registration"] },
  );

  // Platform settings form
  const [regEnabled,   setRegEnabled]   = useState(false);
  const [trialDays,    setTrialDays]    = useState(14);
  const [platformName, setPlatformName] = useState("");
  const [supportEmail, setSupportEmail] = useState("");

  // Serverdan kelgan (yoki saqlashdan keyin qayta olingan) qiymatlar formaga — render paytida moslash
  const [syncedFrom, setSyncedFrom] = useState<PlatformSettings | undefined>(undefined);
  if (platformSettings && platformSettings !== syncedFrom) {
    setSyncedFrom(platformSettings);
    setRegEnabled(platformSettings.registrationEnabled);
    setTrialDays(platformSettings.defaultTrialDays);
    setPlatformName(platformSettings.platformName);
    setSupportEmail(platformSettings.supportEmail);
  }

  const deploymentUrl = typeof window !== "undefined" ? window.location.origin : "—";

  const handleSaveSettings = async () => {
    const days = Math.min(365, Math.max(0, Math.round(trialDays)));
    if (!platformName.trim()) {
      toast.error("Platforma nomi bo'sh bo'lmasin");
      return;
    }
    try {
      await saveSettings.mutateAsync({
        registrationEnabled: regEnabled,
        defaultTrialDays: days,
        platformName: platformName.trim(),
        supportEmail: supportEmail.trim(),
      });
      toast.success("Sozlamalar saqlandi");
    } catch (err) {
      toast.error(errorMessage(err));
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
          Ro'yxatdan o'tish, sinov muddati va platforma ma'lumotlari
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
          {settingsQuery.error ? (
            <p className="text-sm text-white/40">{errorMessage(settingsQuery.error)}</p>
          ) : platformSettings === undefined ? (
            <div className="space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : (
            <>
              {/* Registration toggle */}
              <div className="flex items-center justify-between p-3 rounded-xl bg-white/4 border border-white/8">
                <div>
                  <p className="text-sm font-medium text-white">O'zi ro'yxatdan o'tishni yoqish</p>
                  <p className="text-xs text-white/40 mt-0.5">
                    Yoqilsa yangi biznes egalari o'zi kompaniya ochadi. O'chiq bo'lsa — faqat
                    "Yangi kompaniya" bo'limi orqali.
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
                      : `O'zi ro'yxatdan o'tgan kompaniya ${trialDays} kun sinov rejimida bo'ladi`}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs text-white/50">Platforma nomi</Label>
                  <Input value={platformName} onChange={(e) => setPlatformName(e.target.value)} className={inputClass} maxLength={100} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-white/50">Qo'llab-quvvatlash email</Label>
                  <Input
                    type="email"
                    value={supportEmail}
                    onChange={(e) => setSupportEmail(e.target.value)}
                    placeholder="support@bum-erp.uz"
                    className={inputClass}
                  />
                </div>
              </div>

              <div className="flex justify-end">
                <Button onClick={() => { void handleSaveSettings(); }} disabled={saveSettings.isPending} className="gap-2">
                  {saveSettings.isPending
                    ? <><Loader2 className="h-4 w-4 animate-spin" />Saqlanmoqda...</>
                    : <><Save className="h-4 w-4" />Saqlash</>}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Bootstrap Admin — faqat ma'lumot */}
      <Card className="bg-white/5 border-white/8">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-white/80 flex items-center gap-2">
            <KeyRound className="h-4 w-4" />
            Bootstrap admin
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-xs text-white/50">
          <p>
            Ildiz (bootstrap) platforma admini brauzer orqali yaratilmaydi — serverdagi{" "}
            <code className="text-primary bg-primary/10 px-1 py-0.5 rounded">.env</code> faylidagi{" "}
            <code className="text-primary bg-primary/10 px-1 py-0.5 rounded">BOOTSTRAP_ADMIN_PHONE</code> va{" "}
            <code className="text-primary bg-primary/10 px-1 py-0.5 rounded">BOOTSTRAP_ADMIN_PASSWORD</code> dan{" "}
            <code className="text-primary bg-primary/10 px-1 py-0.5 rounded">pnpm --filter @bum/api db:seed</code> buyrug'i bilan.
            Uni o'chirib yoki bloklab bo'lmaydi; parolini almashtirish ham shu yo'l bilan.
          </p>
          <p>
            Qo'shimcha platforma adminlarini faqat bootstrap admin <strong>Foydalanuvchilar</strong> bo'limida tayinlaydi.
          </p>
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
              <dd className="text-white font-medium">{platformSettings?.platformName ?? "BUM ERP"} v1.0</dd>
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
