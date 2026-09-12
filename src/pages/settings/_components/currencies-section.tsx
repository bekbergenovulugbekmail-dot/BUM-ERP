/**
 * Valyutalar va kurslar — `GET/PUT /api/finance/currencies`, `GET /api/finance/currencies/cbu`,
 * `POST /api/finance/currencies/refresh` (saqlash: `settings.manage`).
 * Kurs: 1 birlik valyuta necha asosiy valyuta. Manba — qo'lda yoki Markaziy bank (yoqilganda kuniga bir marta yangilanadi).
 */
import { useState } from "react";
import { toast } from "sonner";
import { Coins, History, Landmark, Plus, RefreshCw, RotateCcw, Save, Trash2 } from "lucide-react";
import {
  CURRENCY_OPTIONS, MAX_COMPANY_CURRENCIES,
  type CbuRate, type CurrencyRateChange, type CurrencyRateSource, type CurrencySettings,
} from "@bum/shared";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Switch } from "@/components/ui/switch.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { api, errorMessage } from "@/lib/api.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";
import { usePermissions } from "@/hooks/use-company.ts";
import { SettingsGroup, ToggleRow } from "./form-controls.tsx";

const CURRENCIES_PATH = "/api/finance/currencies";
const CBU_PATH = "/api/finance/currencies/cbu";
const HISTORY_PATH = "/api/finance/currencies/history";

const fmtDateTime = (value: string) => new Date(value).toLocaleString("uz-UZ", { dateStyle: "short", timeStyle: "short" });

type Row = { code: string; rate: string; source: CurrencyRateSource; isActive: boolean; rateDate?: string };
type Draft = { cbuEnabled: boolean; currencies: Row[] };

const fmtRate = (value: string | number) =>
  new Intl.NumberFormat("uz-UZ", { maximumFractionDigits: 4 }).format(Number(value));

const nameOf = (code: string) => CURRENCY_OPTIONS.find((c) => c.code === code)?.name ?? code;

function draftError(draft: Draft, baseCurrency: string): string | null {
  const codes = draft.currencies.map((c) => c.code);
  if (new Set(codes).size !== codes.length) return "Valyuta ikki marta ko'rsatilgan";
  if (codes.includes(baseCurrency)) return `${baseCurrency} — asosiy valyuta`;
  for (const row of draft.currencies) {
    if (row.source === "cbu" && !draft.cbuEnabled) return "Markaziy bank kursi uchun uni yoqing";
    if (row.source === "manual" && !(Number(row.rate) > 0)) return `${row.code}: kursni kiriting`;
  }
  return null;
}

export default function CurrenciesSection() {
  const { can } = usePermissions();
  const canManage = can("settings.manage");
  const saved = useApiQuery<CurrencySettings>(CURRENCIES_PATH).data;
  const [draft, setDraft] = useState<Draft | null>(null);

  const state: Draft | undefined =
    draft ?? (saved ? { cbuEnabled: saved.cbuEnabled, currencies: saved.currencies.map((c) => ({ ...c })) } : undefined);

  const cbuQuery = useApiQuery<{ rates: CbuRate[] }>(state?.cbuEnabled ? CBU_PATH : null, undefined, {
    staleTime: 30 * 60_000,
    retry: false,
  });

  const save = useApiMutation(
    (body: Draft) =>
      api.put<CurrencySettings>(CURRENCIES_PATH, {
        cbuEnabled: body.cbuEnabled,
        currencies: body.currencies.map(({ code, rate, source, isActive }) => ({
          code,
          source,
          isActive,
          ...(source === "manual" ? { rate } : {}),
        })),
      }),
    { invalidate: [CURRENCIES_PATH] },
  );
  const refresh = useApiMutation(() => api.post<CurrencySettings>(`${CURRENCIES_PATH}/refresh`), {
    invalidate: [CURRENCIES_PATH],
  });
  // Kurs tarixi va bitta kursni o'zgartirish (sozlamalarni boshqarish huquqisiz ham — `currency_rates.manage`)
  const canEditRates = can("currency_rates.manage");
  const canViewHistory = canManage || canEditRates || can("currency_rates.view");
  const historyQuery = useApiQuery<{ history: CurrencyRateChange[] }>(canViewHistory ? HISTORY_PATH : null, { limit: 50 });
  const [quickRates, setQuickRates] = useState<Record<string, string>>({});
  const setRate = useApiMutation(
    ({ code, rate }: { code: string; rate: string }) => api.put(`${CURRENCIES_PATH}/${code}/rate`, { rate }),
    { invalidate: [CURRENCIES_PATH] },
  );

  if (!state || !saved) return <Skeleton className="h-[420px] rounded-2xl" />;

  const baseCurrency = saved.baseCurrency;
  const update = (patch: Partial<Draft>) => setDraft({ ...state, ...patch });
  const updateRow = (index: number, patch: Partial<Row>) =>
    update({ currencies: state.currencies.map((row, i) => (i === index ? { ...row, ...patch } : row)) });
  const cbuRate = (code: string) => cbuQuery.data?.rates.find((r) => r.code === code);
  const usedCodes = new Set(state.currencies.map((c) => c.code));
  const available = CURRENCY_OPTIONS.filter((c) => c.code !== baseCurrency);
  const error = draftError(state, baseCurrency);

  const addCurrency = () => {
    const next = available.find((c) => !usedCodes.has(c.code));
    if (!next) return;
    update({ currencies: [...state.currencies, { code: next.code, rate: "", source: "manual", isActive: true }] });
  };

  const handleSave = async () => {
    try {
      await save.mutateAsync(state);
      setDraft(null);
      toast.success("Valyutalar saqlandi");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const handleRefresh = async () => {
    try {
      await refresh.mutateAsync();
      toast.success("Markaziy bank kurslari yangilandi");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex items-center gap-3 pb-2 border-b border-border">
        <div className="h-10 w-10 rounded-xl bg-sky-500/10 flex items-center justify-center">
          <Coins className="h-5 w-5 text-sky-500" />
        </div>
        <div>
          <p className="font-semibold">Valyutalar va kurslar</p>
          <p className="text-xs text-muted-foreground">
            Asosiy valyuta: <span className="font-medium text-foreground">{baseCurrency}</span> (kompaniya ma'lumotlarida).
            Kurs — 1 birlik valyuta necha {baseCurrency}.
          </p>
        </div>
      </div>

      <fieldset disabled={!canManage} className="space-y-4">
        <SettingsGroup
          title="Markaziy bank kursi"
          description="Yoqilsa Markaziy bank (cbu.uz) kurslari yonma-yon ko'rinadi; manbasi «Markaziy bank» bo'lgan valyuta kursi har kuni avtomatik yangilanadi"
        >
          <ToggleRow
            label="Markaziy bank kurslaridan foydalanish"
            checked={state.cbuEnabled}
            onChange={(cbuEnabled) =>
              update({
                cbuEnabled,
                // O'chirilganda CBU manbali valyutalar qo'lda kiritilgan joriy kurs bilan qoladi
                currencies: cbuEnabled ? state.currencies : state.currencies.map((row) => ({ ...row, source: "manual" })),
              })
            }
          />
          {state.cbuEnabled && cbuQuery.isError && (
            <p className="text-xs text-destructive">{errorMessage(cbuQuery.error)}</p>
          )}
          {saved.cbuEnabled && saved.currencies.some((c) => c.source === "cbu") && canManage && (
            <Button type="button" size="sm" variant="secondary" onClick={() => { void handleRefresh(); }} disabled={refresh.isPending}>
              <RefreshCw className={`h-4 w-4 mr-1.5 ${refresh.isPending ? "animate-spin" : ""}`} /> Hozir yangilash
            </Button>
          )}
        </SettingsGroup>

        <SettingsGroup title="Valyutalar" description="Ro'yxatdan olib tashlangan valyuta o'chirilmaydi — nofaol bo'ladi">
          {state.currencies.length === 0 ? (
            <p className="text-sm text-muted-foreground">Faqat asosiy valyuta ({baseCurrency}) ishlatiladi</p>
          ) : (
            <div className="overflow-x-auto -mx-1">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-muted-foreground">
                    <th className="text-left font-medium px-1 py-1.5">Valyuta</th>
                    <th className="text-left font-medium px-1 py-1.5">Kurs, {baseCurrency}</th>
                    <th className="text-left font-medium px-1 py-1.5">Manba</th>
                    {state.cbuEnabled && <th className="text-left font-medium px-1 py-1.5">Markaziy bank</th>}
                    <th className="text-center font-medium px-1 py-1.5">Faol</th>
                    <th className="px-1 py-1.5" />
                  </tr>
                </thead>
                <tbody>
                  {state.currencies.map((row, index) => {
                    const bank = cbuRate(row.code);
                    return (
                      <tr key={index} className="border-t border-border/60 align-middle">
                        <td className="px-1 py-2 min-w-[170px]">
                          <Select value={row.code} onValueChange={(code) => updateRow(index, { code })} disabled={!canManage}>
                            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                            <SelectContent position="popper">
                              {available.map((option) => (
                                <SelectItem
                                  key={option.code}
                                  value={option.code}
                                  disabled={option.code !== row.code && usedCodes.has(option.code)}
                                >
                                  {option.code} — {option.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="px-1 py-2 min-w-[140px]">
                          <Input
                            type="number"
                            min={0}
                            step="any"
                            value={row.rate}
                            disabled={row.source === "cbu"}
                            onChange={(e) => updateRow(index, { rate: e.target.value })}
                            placeholder="0"
                          />
                          {row.rateDate && <p className="text-[11px] text-muted-foreground mt-0.5">{row.rateDate}</p>}
                        </td>
                        <td className="px-1 py-2 min-w-[150px]">
                          <Select
                            value={row.source}
                            onValueChange={(source) => updateRow(index, { source: source === "cbu" ? "cbu" : "manual" })}
                            disabled={!canManage}
                          >
                            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                            <SelectContent position="popper">
                              <SelectItem value="manual">Qo'lda</SelectItem>
                              <SelectItem value="cbu" disabled={!state.cbuEnabled}>Markaziy bank</SelectItem>
                            </SelectContent>
                          </Select>
                        </td>
                        {state.cbuEnabled && (
                          <td className="px-1 py-2 min-w-[150px]">
                            {bank ? (
                              <div className="flex items-center gap-1.5">
                                <span className="tabular-nums">{fmtRate(bank.rate)}</span>
                                {row.source === "manual" && canManage && (
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 px-2 text-xs"
                                    title="Bank kursini qo'lda kursga ko'chirish"
                                    onClick={() => updateRow(index, { rate: bank.rate })}
                                  >
                                    <Landmark className="h-3.5 w-3.5 mr-1" /> Qo'llash
                                  </Button>
                                )}
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground">{cbuQuery.isPending ? "…" : "—"}</span>
                            )}
                          </td>
                        )}
                        <td className="px-1 py-2 text-center">
                          <Switch
                            checked={row.isActive}
                            onCheckedChange={(isActive) => updateRow(index, { isActive })}
                            aria-label={`${nameOf(row.code)} faol`}
                          />
                        </td>
                        <td className="px-1 py-2 text-right">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            title="Olib tashlash"
                            onClick={() => update({ currencies: state.currencies.filter((_, i) => i !== index) })}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={addCurrency}
            disabled={state.currencies.length >= Math.min(MAX_COMPANY_CURRENCIES, available.length)}
          >
            <Plus className="h-4 w-4 mr-1.5" /> Valyuta qo'shish
          </Button>
        </SettingsGroup>
      </fieldset>

      {!canManage && canEditRates && saved.currencies.some((currency) => currency.isActive) && (
        <SettingsGroup title="Kursni o'zgartirish" description="Yangi kurs keyingi hujjatlarga qo'llanadi; oldingi savdolar o'z kursini saqlaydi">
          <div className="space-y-2">
            {saved.currencies.filter((currency) => currency.isActive).map((currency) => (
              <div key={currency.code} className="flex flex-wrap items-center gap-2">
                <span className="w-16 font-medium">{currency.code}</span>
                <span className="w-32 text-sm text-muted-foreground tabular-nums">{fmtRate(currency.rate)} {baseCurrency}</span>
                <Input
                  id={`quick-rate-${currency.code}`}
                  type="number"
                  min={0}
                  step="any"
                  className="w-36"
                  placeholder="Yangi kurs"
                  value={quickRates[currency.code] ?? ""}
                  onChange={(e) => setQuickRates((current) => ({ ...current, [currency.code]: e.target.value }))}
                />
                <Button
                  size="sm"
                  disabled={setRate.isPending || !(Number(quickRates[currency.code]) > 0)}
                  onClick={() => {
                    void setRate
                      .mutateAsync({ code: currency.code, rate: quickRates[currency.code]! })
                      .then(() => {
                        setQuickRates(({ [currency.code]: _done, ...rest }) => rest);
                        toast.success(`${currency.code} kursi saqlandi`);
                      })
                      .catch((err: unknown) => toast.error(errorMessage(err)));
                  }}
                >
                  <Save className="h-4 w-4 mr-1.5" /> Saqlash
                </Button>
              </div>
            ))}
          </div>
        </SettingsGroup>
      )}

      {canViewHistory && (
        <SettingsGroup title="Kurs o'zgarishlari tarixi" description="Kim, qachon, qaysi valyuta, eski va yangi kurs (kassadan o'zgartirilgan bo'lsa — kassa nomi)">
          {historyQuery.error ? (
            <p className="text-xs text-destructive">{errorMessage(historyQuery.error)}</p>
          ) : !historyQuery.data ? (
            <Skeleton className="h-24 rounded-xl" />
          ) : historyQuery.data.history.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground"><History className="h-4 w-4" /> Hali o'zgarish yo'q</p>
          ) : (
            <div className="overflow-x-auto -mx-1">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-muted-foreground">
                    <th className="text-left font-medium px-1 py-1.5">Sana</th>
                    <th className="text-left font-medium px-1 py-1.5">Valyuta</th>
                    <th className="text-right font-medium px-1 py-1.5">Eski kurs</th>
                    <th className="text-right font-medium px-1 py-1.5">Yangi kurs</th>
                    <th className="text-left font-medium px-1 py-1.5">Manba</th>
                    <th className="text-left font-medium px-1 py-1.5">Kim</th>
                  </tr>
                </thead>
                <tbody>
                  {historyQuery.data.history.map((row) => (
                    <tr key={row.id} className="border-t border-border/60">
                      <td className="px-1 py-1.5 whitespace-nowrap tabular-nums">{fmtDateTime(row.createdAt)}</td>
                      <td className="px-1 py-1.5 font-medium">{row.code}</td>
                      <td className="px-1 py-1.5 text-right tabular-nums text-muted-foreground">{row.oldRate ? fmtRate(row.oldRate) : "—"}</td>
                      <td className="px-1 py-1.5 text-right tabular-nums">{fmtRate(row.rate)}</td>
                      <td className="px-1 py-1.5">{row.source === "cbu" ? "Markaziy bank" : "Qo'lda"}</td>
                      <td className="px-1 py-1.5 text-xs">
                        {row.createdByName ?? (row.source === "cbu" ? "avtomatik" : "—")}
                        {row.deviceName && <span className="text-muted-foreground"> · {row.deviceName}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SettingsGroup>
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
