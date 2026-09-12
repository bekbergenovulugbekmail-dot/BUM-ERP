import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Save } from "lucide-react";
import { GEOFENCE_RADIUS_PRESETS, SALES_AGENT_POLICY_LIMITS, type SalesAgentPolicy } from "@bum/shared";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Switch } from "@/components/ui/switch.tsx";
import { api, errorMessage } from "@/lib/api.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";
import { cn } from "@/lib/utils.ts";

type NumericField = keyof typeof SALES_AGENT_POLICY_LIMITS;
type Options = Omit<SalesAgentPolicy, NumericField>;
type SwitchField = { [K in keyof Options]: Options[K] extends boolean ? K : never }[keyof Options];

const LOCATION_FIELDS: NumericField[] = [
  "maxAccuracyMeters",
  "maxLocationAgeSeconds",
  "trackingIntervalSeconds",
  "maxJumpSpeedKmh",
  "locationRetentionDays",
];
const NUMERIC_FIELDS = Object.keys(SALES_AGENT_POLICY_LIMITS) as NumericField[];

/** Sotuv agenti siyosati (`sales_agent.supervise`): lokatsiya sifati, geofence, kuzatuv, tashrif va buyurtma qoidalari. */
export default function AgentPolicySection() {
  const policy = useApiQuery<{ policy: SalesAgentPolicy }>("/api/sales-agent/policy").data?.policy;
  if (!policy) return <Skeleton className="h-96 rounded-2xl" />;
  return <PolicyForm initial={policy} />;
}

function PolicyForm({ initial }: { initial: SalesAgentPolicy }) {
  const { t } = useTranslation("distribution");
  const [numbers, setNumbers] = useState(
    () => Object.fromEntries(NUMERIC_FIELDS.map((field) => [field, String(initial[field])])) as Record<NumericField, string>,
  );
  const [options, setOptions] = useState<Options>(() => {
    const picked = { ...initial } as Partial<SalesAgentPolicy>;
    for (const field of NUMERIC_FIELDS) delete picked[field];
    return picked as Options;
  });
  const save = useApiMutation((body: SalesAgentPolicy) => api.put("/api/sales-agent/policy", body), {
    invalidate: ["/api/sales-agent/policy"],
  });

  const handleSave = async () => {
    const parsed = {} as Record<NumericField, number>;
    for (const field of NUMERIC_FIELDS) {
      const [min, max] = SALES_AGENT_POLICY_LIMITS[field];
      const value = Number(numbers[field]);
      if (!Number.isInteger(value) || value < min || value > max || numbers[field].trim() === "") {
        toast.error(t("policy.invalid", { field: t(`policy.field.${field}`), min, max }));
        return;
      }
      parsed[field] = value;
    }
    try {
      await save.mutateAsync({ ...options, ...parsed });
      toast.success(t("policy.saved"));
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const setNumber = (field: NumericField, value: string) => setNumbers((current) => ({ ...current, [field]: value }));

  const numberField = (field: NumericField) => {
    const [min, max] = SALES_AGENT_POLICY_LIMITS[field];
    return (
      <div key={field} className="space-y-1">
        <Label htmlFor={`policy-${field}`}>{t(`policy.field.${field}`)}</Label>
        <Input
          id={`policy-${field}`}
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          step={1}
          value={numbers[field]}
          onChange={(e) => setNumber(field, e.target.value)}
        />
        <p className="text-[11px] text-muted-foreground">
          {t(`policy.hint.${field}`)} · {min}–{max}
        </p>
      </div>
    );
  };

  const switchRow = (key: SwitchField) => (
    <label key={key} className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-2.5 cursor-pointer">
      <span className="text-sm">{t(`policy.${key}`)}</span>
      <Switch checked={options[key]} onCheckedChange={(checked) => setOptions((current) => ({ ...current, [key]: checked }))} />
    </label>
  );

  const selectRow = <K extends "deliveryDateMode" | "creditLimitPolicy" | "visitExitPolicy">(key: K, values: readonly Options[K][]) => (
    <div key={key} className="space-y-1">
      <Label>{t(`policy.${key}`)}</Label>
      <Select value={options[key]} onValueChange={(value) => setOptions((current) => ({ ...current, [key]: value as Options[K] }))}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          {values.map((value) => (
            <SelectItem key={value} value={value}>{t(`policy.option.${value}`)}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <div className="space-y-5 max-w-4xl">
      <div>
        <p className="text-base font-semibold">{t("policy.title")}</p>
        <p className="text-sm text-muted-foreground">{t("policy.subtitle")}</p>
      </div>

      <div className="bg-card border border-border rounded-2xl p-4 space-y-4">
        <p className="text-sm font-semibold">{t("policy.section.location")}</p>
        <div className="space-y-2">
          <Label htmlFor="policy-geofenceRadiusMeters">{t("policy.field.geofenceRadiusMeters")}</Label>
          <div className="flex flex-wrap items-center gap-2">
            {GEOFENCE_RADIUS_PRESETS.map((preset) => (
              <Button
                key={preset}
                type="button"
                size="sm"
                variant={numbers.geofenceRadiusMeters === String(preset) ? "default" : "secondary"}
                className={cn("tabular-nums min-w-16")}
                onClick={() => setNumber("geofenceRadiusMeters", String(preset))}
              >
                {preset} m
              </Button>
            ))}
            <Input
              id="policy-geofenceRadiusMeters"
              type="number"
              inputMode="numeric"
              className="w-28"
              min={SALES_AGENT_POLICY_LIMITS.geofenceRadiusMeters[0]}
              max={SALES_AGENT_POLICY_LIMITS.geofenceRadiusMeters[1]}
              value={numbers.geofenceRadiusMeters}
              onChange={(e) => setNumber("geofenceRadiusMeters", e.target.value)}
            />
          </div>
          <p className="text-[11px] text-muted-foreground">{t("policy.hint.geofenceRadiusMeters")}</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">{LOCATION_FIELDS.map(numberField)}</div>
      </div>

      <div className="bg-card border border-border rounded-2xl p-4 space-y-4">
        <p className="text-sm font-semibold">{t("policy.section.visits")}</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {numberField("minVisitMinutes")}
          {selectRow("visitExitPolicy", ["pause", "invalidate", "flag"])}
          {switchRow("storefrontPhotoRequired")}
          {switchRow("shelfPhotoRequired")}
          {switchRow("orderRequiresVisit")}
        </div>
      </div>

      <div className="bg-card border border-border rounded-2xl p-4 space-y-4">
        <p className="text-sm font-semibold">{t("policy.section.orders")}</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {selectRow("deliveryDateMode", ["assigned", "choose"])}
          {numberField("maxDeliveryDays")}
          {switchRow("creditDueDateRequired")}
          {selectRow("creditLimitPolicy", ["block", "approval"])}
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={() => void handleSave()} disabled={save.isPending}>
          <Save className="h-4 w-4 mr-1.5" /> {save.isPending ? "..." : t("policy.save")}
        </Button>
      </div>
    </div>
  );
}
