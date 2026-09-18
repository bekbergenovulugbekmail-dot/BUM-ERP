/**
 * Integratsiyalar → Telegram: biznesning MIJOZLAR boti.
 *
 * Egasi BotFather'dan olingan tokenni qo'yadi (`PUT /api/telegram/customer-bot`), so'ng qaysi xabarlar
 * mijozga borishini ptichkalar bilan boshqaradi (`PUT /api/telegram/customer-bot/features`).
 * Token hech qachon to'liq ko'rsatilmaydi — serverdan niqoblangan holda keladi.
 */
import { useState } from "react";
import { toast } from "sonner";
import { ExternalLink, Send, Trash2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { api, errorMessage } from "@/lib/api.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";
import { usePermissions } from "@/hooks/use-company.ts";
import { SettingsGroup, ToggleRow } from "./form-controls.tsx";

const PATH = "/api/telegram/customer-bot";

type Bot = {
  id: string;
  kind: "owner" | "customer";
  username: string | null;
  isActive: boolean;
  features: Record<string, boolean>;
  lastError: string | null;
  token: string;
  link: string | null;
};

type Response = { bot: Bot | null; availableFeatures: Record<string, string> };

export default function TelegramSection() {
  const { can } = usePermissions();
  const canManage = can("settings.manage");
  const query = useApiQuery<Response>(PATH);
  const bot = query.data?.bot ?? null;
  const features = query.data?.availableFeatures ?? {};
  const [token, setToken] = useState("");

  const saveToken = useApiMutation((value: string) => api.put<{ bot: Bot; webhookError?: string | null }>(PATH, { token: value }), { invalidate: [PATH] });
  const saveFeatures = useApiMutation((value: Record<string, boolean>) => api.put<{ bot: Bot }>(`${PATH}/features`, { features: value }), { invalidate: [PATH] });
  const remove = useApiMutation(() => api.delete(PATH), { invalidate: [PATH] });

  if (query.isLoading) return <Skeleton className="h-[320px] rounded-2xl" />;

  const submitToken = async () => {
    const value = token.trim();
    if (value.length < 20) {
      toast.error("BotFather bergan to'liq tokenni qo'ying");
      return;
    }
    try {
      const result = await saveToken.mutateAsync(value);
      setToken("");
      if (result.webhookError) toast.warning(`Bot saqlandi, lekin webhook o'rnatilmadi: ${result.webhookError}`);
      else toast.success("Bot ulandi");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const toggle = async (key: string, value: boolean) => {
    try {
      await saveFeatures.mutateAsync({ ...(bot?.features ?? {}), [key]: value });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const disconnect = async () => {
    if (!confirm("Bot o'chirilsinmi? Mijozlarga xabarlar to'xtaydi.")) return;
    try {
      await remove.mutateAsync();
      toast.success("Bot o'chirildi");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <div className="space-y-4">
      <SettingsGroup
        title="Mijozlar uchun Telegram bot"
        description="Token faqat shu yerdan kiritiladi va bazada shifrlangan holda saqlanadi — kodda ham, serverda ham yozilmaydi."
      >
        <ol className="list-decimal space-y-1 pl-5 text-xs text-muted-foreground">
          <li>Telegram'da <span className="font-medium">@BotFather</span> ga kiring va <code>/newbot</code> deb yozing.</li>
          <li>Bot nomi va foydalanuvchi nomini tanlang (oxiri <code>_bot</code> bilan tugashi kerak).</li>
          <li>BotFather bergan tokenni (<code>1234567890:AA…</code>) nusxalab, quyidagi maydonga qo'ying.</li>
          <li>Mijozlaringizga bot havolasini yuboring — ular telefon raqamini ulashadi va xabarlarni oladi.</li>
        </ol>
        {bot ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="rounded-lg bg-muted px-2 py-1 font-mono">{bot.token}</span>
              {bot.link && (
                <a href={bot.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                  {bot.username ? `@${bot.username}` : "Botni ochish"} <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
              <span className={bot.isActive ? "text-emerald-600" : "text-muted-foreground"}>{bot.isActive ? "Faol" : "O'chirilgan"}</span>
            </div>
            {bot.lastError && (
              <p className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-400">
                <TriangleAlert className="h-4 w-4 shrink-0" /> {bot.lastError}
              </p>
            )}
            {canManage && (
              <Button size="sm" variant="destructive" disabled={remove.isPending} onClick={() => void disconnect()}>
                <Trash2 className="h-4 w-4 mr-1" /> Botni uzish
              </Button>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Bot ulanmagan.</p>
        )}

        {canManage && (
          <div className="flex flex-wrap items-end gap-2 pt-1">
            <div className="flex-1 min-w-[16rem]">
              <Label htmlFor="telegram-token" className="text-xs">{bot ? "Tokenni almashtirish" : "Bot tokeni"}</Label>
              <Input
                id="telegram-token"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="1234567890:AA..."
                autoComplete="off"
              />
            </div>
            <Button disabled={saveToken.isPending} onClick={() => void submitToken()}>
              <Send className="h-4 w-4 mr-1" /> {bot ? "Almashtirish" : "Ulash"}
            </Button>
          </div>
        )}
      </SettingsGroup>

      <SettingsGroup title="Mijozga qanday xabarlar borsin" description="Har bir xabarni alohida yoqib-o'chirish mumkin">
        {Object.entries(features).map(([key, label]) => (
          <ToggleRow
            key={key}
            label={label}
            checked={bot?.features?.[key] === true}
            disabled={!canManage || !bot || saveFeatures.isPending}
            onChange={(value) => void toggle(key, value)}
          />
        ))}
        {!bot && <p className="text-xs text-muted-foreground">Avval bot tokenini qo'ying.</p>}
      </SettingsGroup>
    </div>
  );
}
