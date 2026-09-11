import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Save } from "lucide-react";
import { SALES_AGENT_POLICY_LIMITS, type SalesAgentPolicy } from "@bum/shared";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Switch } from "@/components/ui/switch.tsx";
import { api, errorMessage } from "@/lib/api.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";

type NumericField = keyof typeof SALES_AGENT_POLICY_LIMITS;
type Options = Omit<SalesAgentPolicy, NumericField>;

const LOCATION_FIELDS: NumericField[] = [
  "geofenceRadiusMeters",
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
  const [options, setOptions] = useState<Options>(() => ({
    photoRequired: initial.photoRequired,
    deliveryDateMode: initial.deliveryDateMode,
    creditDueDateRequired: initial.creditDueDateRequired,
    creditLimitPolicy: initial.creditLimitPolicy,
  }));
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
      await save.mutateAsync({ ...parsed, ...options });
      toast.success(t("policy.saved"));
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

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
          onChange={(e) => setNumbers((current) => ({ ...current, [field]: e.target.value }))}
        />
        <p className="text-[11px] text-muted-foreground">
          {t(`policy.hint.${field}`)} · {min}–{max}
        </p>
      </div>
    );
  };

  const switchRow = (key: "photoRequired" | "creditDueDateRequired") => (
    <label className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-2.5 cursor-pointer">
      <span className="text-sm">{t(`policy.${key}`)}</span>
      <Switch checked={options[key]} onCheckedChange={(checked) => setOptions((current) => ({ ...current, [key]: checked }))} />
    </label>
  );

  return (
    <div className="space-y-5 max-w-4xl">
      <div>
        <p className="text-base font-semibold">{t("policy.title")}</p>
        <p className="text-sm text-muted-foreground">{t("policy.subtitle")}</p>
      </div>

      <div className="bg-card border border-border rounded-2xl p-4 space-y-4">
        <p className="text-sm font-semibold">{t("policy.section.location")}</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">{LOCATION_FIELDS.map(numberField)}</div>
      </div>

      <div className="bg-card border border-border rounded-2xl p-4 space-y-4">
        <p className="text-sm font-semibold">{t("policy.section.orders")}</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {switchRow("photoRequired")}
          {switchRow("creditDueDateRequired")}
          <div className="space-y-1">
            <Label>{t("policy.deliveryDateMode")}</Label>
            <Select
              value={options.deliveryDateMode}
              onValueChange={(value) => setOptions((current) => ({ ...current, deliveryDateMode: value as Options["deliveryDateMode"] }))}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="assigned">{t("policy.option.assigned")}</SelectItem>
                <SelectItem value="choose">{t("policy.option.choose")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {numberField("maxDeliveryDays")}
          <div className="space-y-1">
            <Label>{t("policy.creditLimitPolicy")}</Label>
            <Select
              value={options.creditLimitPolicy}
              onValueChange={(value) => setOptions((current) => ({ ...current, creditLimitPolicy: value as Options["creditLimitPolicy"] }))}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="block">{t("policy.option.block")}</SelectItem>
                <SelectItem value="approval">{t("policy.option.approval")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
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
