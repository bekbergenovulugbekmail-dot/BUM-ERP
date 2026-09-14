import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Save } from "lucide-react";
import {
  DELIVERY_AUTO_ASSIGN_LIMITS,
  DELIVERY_AUTO_ASSIGN_STRATEGIES,
  DELIVERY_COLLECTION_METHODS,
  DELIVERY_MISMATCH_POLICIES,
  DELIVERY_POLICY_LIMITS,
  GEOFENCE_RADIUS_PRESETS,
  type DeliveryAutoAssignPolicy,
  type DeliveryAutoAssignStrategy,
  type DeliveryMismatchPolicy,
  type DeliveryPolicy,
} from "@bum/shared";
import { Button } from "@/components/ui/button.tsx";
import { Checkbox } from "@/components/ui/checkbox.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Switch } from "@/components/ui/switch.tsx";
import { api } from "@/lib/api.ts";
import { deliveryErrorMessage } from "@/lib/delivery/errors.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";

type NumericField = keyof typeof DELIVERY_POLICY_LIMITS;
type AutoNumericField = keyof typeof DELIVERY_AUTO_ASSIGN_LIMITS;
type Options = Omit<DeliveryPolicy, NumericField>;
type SwitchField = "deliveryRequiredByDefault" | "collectOnDelivery" | "requireCustomerLocation" | "offlineActionsAllowed" | "geofenceAlerts";
type AutoSwitchField = "enabled" | "onCreate" | "respectSchedule" | "requireOnDuty" | "respectCapacity" | "respectBranch";
type Recipient = { userId: string; name: string; role: string };

const NUMERIC_FIELDS = Object.keys(DELIVERY_POLICY_LIMITS) as NumericField[];
const AUTO_NUMERIC_FIELDS = Object.keys(DELIVERY_AUTO_ASSIGN_LIMITS) as AutoNumericField[];
const AUTO_SWITCHES: AutoSwitchField[] = ["enabled", "onCreate", "respectSchedule", "requireOnDuty", "respectCapacity", "respectBranch"];
const LOCATION_FIELDS: NumericField[] = [
  "maxAccuracyMeters",
  "maxLocationAgeSeconds",
  "trackingIntervalSeconds",
  "trackingDistanceMeters",
  "maxJumpSpeedKmh",
  "locationRetentionDays",
];
const CONFIRMATION_KEYS = ["photo", "signature", "otp"] as const;
const NOTIFY_EVENTS = ["failed", "mismatch", "geofence"] as const;
type NotifyEvent = (typeof NOTIFY_EVENTS)[number];

/**
 * Dostavka siyosati (`delivery.manage`): geofence va GPS sifati, tasdiqlash usullari, to'lov farqi, oflayn,
 * avtomatik biriktirish qoidalari, bildirishnomalar.
 */
export default function PolicySection() {
  const policy = useApiQuery<{ policy: DeliveryPolicy }>("/api/delivery/policy").data?.policy;
  if (!policy) return <Skeleton className="h-96 rounded-2xl" />;
  return <PolicyForm initial={policy} />;
}

function PolicyForm({ initial }: { initial: DeliveryPolicy }) {
  const { t } = useTranslation("delivery");
  const [numbers, setNumbers] = useState(
    () => Object.fromEntries(NUMERIC_FIELDS.map((field) => [field, String(initial[field])])) as Record<NumericField, string>,
  );
  const [autoNumbers, setAutoNumbers] = useState(
    () => Object.fromEntries(AUTO_NUMERIC_FIELDS.map((field) => [field, String(initial.autoAssign[field])])) as Record<AutoNumericField, string>,
  );
  const [options, setOptions] = useState<Options>(() => {
    const picked = { ...initial } as Partial<DeliveryPolicy>;
    for (const field of NUMERIC_FIELDS) delete picked[field];
    return picked as Options;
  });
  const save = useApiMutation((body: DeliveryPolicy) => api.put("/api/delivery/policy", body), { invalidate: ["/api/delivery/policy"] });
  const candidates = useApiQuery<{ recipients: Recipient[] }>("/api/delivery/policy/recipients").data?.recipients;

  const setNumber = (field: NumericField, value: string) => setNumbers((current) => ({ ...current, [field]: value }));
  const setAuto = (patch: Partial<DeliveryAutoAssignPolicy>) => setOptions((current) => ({ ...current, autoAssign: { ...current.autoAssign, ...patch } }));

  const toggleRecipient = (event: NotifyEvent, userId: string, checked: boolean) =>
    setOptions((current) => {
      const list = current.notificationRecipients[event].filter((id) => id !== userId);
      return { ...current, notificationRecipients: { ...current.notificationRecipients, [event]: checked ? [...list, userId] : list } };
    });

  const parseBounded = (raw: string, [min, max]: readonly [number, number]) => {
    const value = Number(raw);
    return raw.trim() !== "" && Number.isInteger(value) && value >= min && value <= max ? value : null;
  };

  const handleSave = async () => {
    const parsed = {} as Record<NumericField, number>;
    for (const field of NUMERIC_FIELDS) {
      const value = parseBounded(numbers[field], DELIVERY_POLICY_LIMITS[field]);
      if (value === null) {
        const [min, max] = DELIVERY_POLICY_LIMITS[field];
        toast.error(t("policy.invalid", { field: t(`policy.field.${field}`), min, max }));
        return;
      }
      parsed[field] = value;
    }
    const autoParsed = {} as Record<AutoNumericField, number>;
    for (const field of AUTO_NUMERIC_FIELDS) {
      const value = parseBounded(autoNumbers[field], DELIVERY_AUTO_ASSIGN_LIMITS[field]);
      if (value === null) {
        const [min, max] = DELIVERY_AUTO_ASSIGN_LIMITS[field];
        toast.error(t("policy.invalid", { field: t(`policy.auto.${field}`), min, max }));
        return;
      }
      autoParsed[field] = value;
    }
    try {
      await save.mutateAsync({ ...options, ...parsed, autoAssign: { ...options.autoAssign, ...autoParsed } });
      toast.success(t("policy.saved"));
    } catch (error) {
      toast.error(deliveryErrorMessage(error, t));
    }
  };

  const numberField = (field: NumericField) => {
    const [min, max] = DELIVERY_POLICY_LIMITS[field];
    return (
      <div key={field} className="space-y-1">
        <Label htmlFor={`delivery-policy-${field}`}>{t(`policy.field.${field}`)}</Label>
        <Input
          id={`delivery-policy-${field}`}
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
    <label key={key} className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-border px-3 py-2.5">
      <span className="text-sm">{t(`policy.${key}`)}</span>
      <Switch checked={options[key]} onCheckedChange={(checked) => setOptions((current) => ({ ...current, [key]: checked }))} />
    </label>
  );

  return (
    <div className="max-w-4xl space-y-5">
      <div>
        <p className="text-base font-semibold">{t("policy.title")}</p>
        <p className="text-sm text-muted-foreground">{t("policy.subtitle")}</p>
      </div>

      <div className="space-y-4 rounded-2xl border border-border bg-card p-4">
        <p className="text-sm font-semibold">{t("policy.section.location")}</p>
        <div className="space-y-2">
          <Label htmlFor="delivery-policy-geofenceRadiusMeters">{t("policy.field.geofenceRadiusMeters")}</Label>
          <div className="flex flex-wrap items-center gap-2">
            {GEOFENCE_RADIUS_PRESETS.map((preset) => (
              <Button
                key={preset}
                type="button"
                size="sm"
                variant={numbers.geofenceRadiusMeters === String(preset) ? "default" : "secondary"}
                className="min-w-16 tabular-nums"
                onClick={() => setNumber("geofenceRadiusMeters", String(preset))}
              >
                {preset} m
              </Button>
            ))}
            <Input
              id="delivery-policy-geofenceRadiusMeters"
              type="number"
              inputMode="numeric"
              className="w-28"
              min={DELIVERY_POLICY_LIMITS.geofenceRadiusMeters[0]}
              max={DELIVERY_POLICY_LIMITS.geofenceRadiusMeters[1]}
              value={numbers.geofenceRadiusMeters}
              onChange={(e) => setNumber("geofenceRadiusMeters", e.target.value)}
            />
          </div>
          <p className="text-[11px] text-muted-foreground">{t("policy.hint.geofenceRadiusMeters")}</p>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">{LOCATION_FIELDS.map(numberField)}</div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {switchRow("requireCustomerLocation")}
          {switchRow("geofenceAlerts")}
        </div>
      </div>

      <div className="space-y-4 rounded-2xl border border-border bg-card p-4">
        <p className="text-sm font-semibold">{t("policy.section.orders")}</p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {switchRow("deliveryRequiredByDefault")}
          {switchRow("collectOnDelivery")}
        </div>
        <div className="space-y-2">
          <Label>{t("policy.collectionMethods")}</Label>
          <div className="flex flex-wrap gap-3">
            {DELIVERY_COLLECTION_METHODS.map((method) => {
              const checked = options.collectionMethods.includes(method);
              return (
                <label key={method} className="flex cursor-pointer items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm">
                  <Checkbox
                    id={`delivery-policy-method-${method}`}
                    checked={checked}
                    // Kamida bitta usul qoladi
                    disabled={checked && options.collectionMethods.length === 1}
                    onCheckedChange={(value) =>
                      setOptions((current) => ({
                        ...current,
                        collectionMethods:
                          value === true
                            ? DELIVERY_COLLECTION_METHODS.filter((item) => item === method || current.collectionMethods.includes(item))
                            : current.collectionMethods.filter((item) => item !== method),
                      }))
                    }
                  />
                  {t(`method.${method}`)}
                </label>
              );
            })}
          </div>
        </div>
        <div className="max-w-sm space-y-1">
          <Label>{t("policy.mismatchPolicy")}</Label>
          <Select
            value={options.mismatchPolicy}
            onValueChange={(value) => setOptions((current) => ({ ...current, mismatchPolicy: value as DeliveryMismatchPolicy }))}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DELIVERY_MISMATCH_POLICIES.map((value) => (
                <SelectItem key={value} value={value}>
                  {t(`policy.mismatch.${value}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-4 rounded-2xl border border-border bg-card p-4">
        <div>
          <p className="text-sm font-semibold">{t("policy.section.auto")}</p>
          <p className="text-xs text-muted-foreground">{t("policy.auto.hint")}</p>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {AUTO_SWITCHES.map((key) => (
            <label key={key} className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-border px-3 py-2.5">
              <span className="text-sm">{t(`policy.auto.${key}`)}</span>
              <Switch checked={options.autoAssign[key]} onCheckedChange={(checked) => setAuto({ [key]: checked })} />
            </label>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="space-y-1">
            <Label>{t("policy.auto.strategy")}</Label>
            <Select value={options.autoAssign.strategy} onValueChange={(value) => setAuto({ strategy: value as DeliveryAutoAssignStrategy })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DELIVERY_AUTO_ASSIGN_STRATEGIES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {t(`auto.strategy_option.${value}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {AUTO_NUMERIC_FIELDS.map((field) => {
            const [min, max] = DELIVERY_AUTO_ASSIGN_LIMITS[field];
            return (
              <div key={field} className="space-y-1">
                <Label htmlFor={`delivery-auto-${field}`}>{t(`policy.auto.${field}`)}</Label>
                <Input
                  id={`delivery-auto-${field}`}
                  type="number"
                  inputMode="numeric"
                  min={min}
                  max={max}
                  step={1}
                  value={autoNumbers[field]}
                  onChange={(e) => setAutoNumbers((current) => ({ ...current, [field]: e.target.value }))}
                />
                <p className="text-[11px] text-muted-foreground">
                  {t(`policy.auto.${field}_hint`)} · {min}–{max}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      <div className="space-y-4 rounded-2xl border border-border bg-card p-4">
        <div>
          <p className="text-sm font-semibold">{t("policy.section.confirmation")}</p>
          <p className="text-xs text-muted-foreground">{t("policy.confirmation_hint")}</p>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {CONFIRMATION_KEYS.map((key) => (
            <label key={key} className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-border px-3 py-2.5">
              <span className="text-sm">{t(`policy.confirmation.${key}`)}</span>
              <Switch
                checked={options.confirmation[key]}
                onCheckedChange={(checked) => setOptions((current) => ({ ...current, confirmation: { ...current.confirmation, [key]: checked } }))}
              />
            </label>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {numberField("otpTtlMinutes")}
          {numberField("otpMaxAttempts")}
        </div>
        <p className="text-[11px] text-muted-foreground">{t("policy.sms_note")}</p>
      </div>

      <div className="space-y-4 rounded-2xl border border-border bg-card p-4">
        <p className="text-sm font-semibold">{t("policy.section.offline")}</p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {switchRow("offlineActionsAllowed")}
          {numberField("offlineMaxAgeHours")}
        </div>
      </div>

      <div className="space-y-4 rounded-2xl border border-border bg-card p-4">
        <div>
          <p className="text-sm font-semibold">{t("policy.section.notifications")}</p>
          <p className="text-xs text-muted-foreground">{t("policy.recipients.hint")}</p>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {NOTIFY_EVENTS.map((event) => {
            const chosen = options.notificationRecipients[event];
            return (
              <fieldset key={event} className="space-y-2 rounded-xl border border-border p-3">
                <legend className="px-1 text-sm font-medium">{t(`policy.recipients.${event}`)}</legend>
                <p className="text-[11px] text-muted-foreground">
                  {chosen.length === 0 ? t("policy.recipients.default") : t("policy.recipients.selected", { count: chosen.length })}
                </p>
                <div className="max-h-48 space-y-0.5 overflow-y-auto">
                  {(candidates ?? []).map((candidate) => (
                    <label
                      key={candidate.userId}
                      htmlFor={`delivery-recipient-${event}-${candidate.userId}`}
                      className="flex cursor-pointer items-center gap-2 rounded-lg px-1 py-1 text-sm hover:bg-muted/50"
                    >
                      <Checkbox
                        id={`delivery-recipient-${event}-${candidate.userId}`}
                        checked={chosen.includes(candidate.userId)}
                        onCheckedChange={(checked) => toggleRecipient(event, candidate.userId, checked === true)}
                      />
                      <span className="min-w-0 flex-1 truncate">{candidate.name}</span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">{candidate.role}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            );
          })}
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={() => void handleSave()} disabled={save.isPending}>
          <Save className="mr-1.5 h-4 w-4" /> {save.isPending ? "..." : t("policy.save")}
        </Button>
      </div>
    </div>
  );
}
