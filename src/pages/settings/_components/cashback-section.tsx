/**
 * Keshbek sozlamalari — `GET/PUT /api/sales/cashback/settings` (saqlash: `settings.manage`).
 * Foiz chek summasi pog'onasi yoki kategoriya bo'yicha; hisoblash va ishlatish POS kassada.
 */
import { useState } from "react";
import { toast } from "sonner";
import { Gift, Plus, RotateCcw, Save, Trash2 } from "lucide-react";
import { CASHBACK_LIMITS, type CashbackSettings } from "@bum/shared";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { api, errorMessage } from "@/lib/api.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";
import { usePermissions } from "@/hooks/use-company.ts";
import type { Category } from "@/pages/products/_lib/types.ts";
import { SettingsGroup, ToggleRow } from "./form-controls.tsx";

const CASHBACK_SETTINGS_PATH = "/api/sales/cashback/settings";

const fmt = (n: number) => new Intl.NumberFormat("uz-UZ", { maximumFractionDigits: 2 }).format(n);
const validPercent = (p: number) => Number.isFinite(p) && p >= 0 && p <= 100;
const numberOrNaN = (value: string) => (value.trim() === "" ? Number.NaN : Number(value));
const inputValue = (n: number) => (Number.isFinite(n) ? n : "");

function settingsError(s: CashbackSettings): string | null {
  if (!validPercent(s.maxUsagePercent)) return "Ishlatish chegarasi 0–100% bo'lishi kerak";
  for (const tier of s.tiers) {
    if (!Number.isFinite(tier.minAmount) || tier.minAmount < 0) return "Pog'ona summasini kiriting (0 yoki undan katta)";
    if (!validPercent(tier.percent)) return "Foiz 0–100 oralig'ida bo'lishi kerak";
  }
  if (new Set(s.tiers.map((t) => t.minAmount)).size !== s.tiers.length) return "Pog'ona summalari takrorlanmasligi kerak";
  for (const rate of s.categoryRates) {
    if (!rate.categoryId) return "Kategoriyani tanlang";
    if (!validPercent(rate.percent)) return "Foiz 0–100 oralig'ida bo'lishi kerak";
  }
  if (new Set(s.categoryRates.map((r) => r.categoryId)).size !== s.categoryRates.length) {
    return "Kategoriya ikki marta ko'rsatilgan";
  }
  return null;
}

export default function CashbackSection() {
  const { can } = usePermissions();
  const canManage = can("settings.manage");
  const saved = useApiQuery<{ settings: CashbackSettings }>(CASHBACK_SETTINGS_PATH).data?.settings;
  const categories = useApiQuery<{ categories: Category[] }>("/api/catalog/categories").data?.categories;
  const [draft, setDraft] = useState<CashbackSettings | null>(null);

  const save = useApiMutation(
    (body: CashbackSettings) => api.put<{ settings: CashbackSettings }>(CASHBACK_SETTINGS_PATH, body),
    { invalidate: [CASHBACK_SETTINGS_PATH] },
  );

  const settings = draft ?? saved;
  if (!settings) return <Skeleton className="h-[500px] rounded-2xl" />;

  const update = (patch: Partial<CashbackSettings>) => setDraft({ ...settings, ...patch });
  const updateTier = (index: number, patch: Partial<CashbackSettings["tiers"][number]>) =>
    update({ tiers: settings.tiers.map((tier, i) => (i === index ? { ...tier, ...patch } : tier)) });
  const updateRate = (index: number, patch: Partial<CashbackSettings["categoryRates"][number]>) =>
    update({ categoryRates: settings.categoryRates.map((rate, i) => (i === index ? { ...rate, ...patch } : rate)) });

  const error = settingsError(settings);
  const limited = settings.maxUsagePercent < 100;
  const usedCategoryIds = new Set(settings.categoryRates.map((rate) => rate.categoryId));
  const exampleTier = [...settings.tiers]
    .filter((tier) => Number.isFinite(tier.minAmount) && validPercent(tier.percent) && tier.percent > 0)
    .sort((a, b) => b.minAmount - a.minAmount)[0];
  const exampleAmount = exampleTier ? Math.max(exampleTier.minAmount, 100_000) : 0;

  const handleSave = async () => {
    try {
      await save.mutateAsync(settings);
      setDraft(null);
      toast.success("Keshbek sozlamalari saqlandi");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-center gap-3 pb-2 border-b border-border">
        <div className="h-10 w-10 rounded-xl bg-violet-500/10 flex items-center justify-center">
          <Gift className="h-5 w-5 text-violet-500" />
        </div>
        <div>
          <p className="font-semibold">Keshbek tizimi</p>
          <p className="text-xs text-muted-foreground">
            {canManage
              ? "Mijoz xarididan keshbek beriladi va keyingi xaridda to'lov sifatida ishlatiladi (POS kassa)"
              : "Faqat ko'rish — o'zgartirish uchun ruxsat yo'q"}
          </p>
        </div>
      </div>

      <fieldset disabled={!canManage} className="space-y-4">
        <SettingsGroup title="Umumiy">
          <ToggleRow label="Keshbek tizimi yoqilgan" checked={settings.enabled} onChange={(enabled) => update({ enabled })} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
            <div className="space-y-1.5">
              <Label>Keshbek nimaga hisoblanadi</Label>
              <Select
                value={settings.accrualBase}
                onValueChange={(v) => update({ accrualBase: v === "total" ? "total" : "paid" })}
                disabled={!canManage}
              >
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent position="popper">
                  <SelectItem value="paid">Faqat pul bilan to'langan qismiga</SelectItem>
                  <SelectItem value="total">Butun chek summasiga</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {settings.accrualBase === "paid"
                  ? "Keshbek bilan to'langan va qarzga yozilgan qismiga keshbek berilmaydi"
                  : "Qanday to'langanidan qat'i nazar butun chekka"}
              </p>
            </div>
            <div className="space-y-1.5">
              <ToggleRow
                label="Keshbek bilan to'lashni cheklash"
                checked={limited}
                onChange={(on) => update({ maxUsagePercent: on ? 50 : 100 })}
              />
              {limited ? (
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    step="any"
                    className="w-24"
                    value={inputValue(settings.maxUsagePercent)}
                    onChange={(e) => update({ maxUsagePercent: numberOrNaN(e.target.value) })}
                  />
                  <span className="text-xs text-muted-foreground">% gacha chekni keshbek bilan to'lash mumkin</span>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Cheklovsiz — butun chekni keshbek bilan to'lash mumkin</p>
              )}
            </div>
          </div>
        </SettingsGroup>

        <SettingsGroup
          title="Chek summasi bo'yicha"
          description="Chek summasi belgilangan summadan katta yoki teng bo'lsa — eng katta mos pog'ona foizi"
        >
          {settings.tiers.length === 0 && (
            <p className="text-sm text-muted-foreground">Pog'ona yo'q — faqat kategoriya foizlari qo'llanadi</p>
          )}
          {settings.tiers.map((tier, index) => (
            <div key={index} className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted-foreground">Chek ≥</span>
              <Input
                type="number"
                min={0}
                step="any"
                className="w-40"
                placeholder="0"
                value={inputValue(tier.minAmount)}
                onChange={(e) => updateTier(index, { minAmount: numberOrNaN(e.target.value) })}
              />
              <span className="text-sm text-muted-foreground">so'm →</span>
              <Input
                type="number"
                min={0}
                max={100}
                step="any"
                className="w-24"
                value={inputValue(tier.percent)}
                onChange={(e) => updateTier(index, { percent: numberOrNaN(e.target.value) })}
              />
              <span className="text-sm text-muted-foreground">%</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                title="O'chirish"
                onClick={() => update({ tiers: settings.tiers.filter((_, i) => i !== index) })}
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={settings.tiers.length >= CASHBACK_LIMITS.maxTiers}
            onClick={() => update({ tiers: [...settings.tiers, { minAmount: Number.NaN, percent: 1 }] })}
          >
            <Plus className="h-4 w-4 mr-1.5" /> Pog'ona qo'shish
          </Button>
        </SettingsGroup>

        <SettingsGroup
          title="Kategoriya bo'yicha"
          description="Kategoriya foizi pog'onadan ustun va uning ichki kategoriyalariga ham tegishli"
        >
          {settings.categoryRates.length === 0 && (
            <p className="text-sm text-muted-foreground">Kategoriya foizi yo'q</p>
          )}
          {settings.categoryRates.map((rate, index) => (
            <div key={index} className="flex items-center gap-2">
              <Select
                value={rate.categoryId}
                onValueChange={(categoryId) => updateRate(index, { categoryId })}
                disabled={!canManage}
              >
                <SelectTrigger className="flex-1 min-w-0"><SelectValue placeholder="Kategoriya" /></SelectTrigger>
                <SelectContent position="popper">
                  {categories?.map((category) => (
                    <SelectItem
                      key={category.id}
                      value={category.id}
                      disabled={category.id !== rate.categoryId && usedCategoryIds.has(category.id)}
                    >
                      {category.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                type="number"
                min={0}
                max={100}
                step="any"
                className="w-24"
                value={inputValue(rate.percent)}
                onChange={(e) => updateRate(index, { percent: numberOrNaN(e.target.value) })}
              />
              <span className="text-sm text-muted-foreground">%</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                title="O'chirish"
                onClick={() => update({ categoryRates: settings.categoryRates.filter((_, i) => i !== index) })}
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={settings.categoryRates.length >= CASHBACK_LIMITS.maxCategoryRates || !categories?.length}
            onClick={() => update({ categoryRates: [...settings.categoryRates, { categoryId: "", percent: 1 }] })}
          >
            <Plus className="h-4 w-4 mr-1.5" /> Kategoriya qo'shish
          </Button>
        </SettingsGroup>
      </fieldset>

      {exampleTier && (
        <p className="text-sm text-muted-foreground">
          Masalan: {fmt(exampleAmount)} so'mlik xaridda {fmt(exampleTier.percent)}% —{" "}
          <span className="font-medium text-foreground">{fmt((exampleAmount * exampleTier.percent) / 100)} so'm</span> keshbek
          (kategoriya foizi bo'lgan mahsulotlarga — o'sha foiz).
        </p>
      )}

      {canManage && (
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => { void handleSave(); }} disabled={save.isPending || !draft || error !== null}>
            <Save className="h-4 w-4 mr-2" />
            {save.isPending ? "Saqlanmoqda..." : "Saqlash"}
          </Button>
          {draft && (
            <Button variant="secondary" onClick={() => setDraft(null)}>
              <RotateCcw className="h-4 w-4 mr-2" /> Bekor qilish
            </Button>
          )}
          {draft && error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      )}
    </div>
  );
}
