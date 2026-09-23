/**
 * KPI: oylik mukofot qoidalari — `/api/hr/kpi`.
 *
 * Qoida lavozimga yoziladi (shu lavozimdagi hamma xodimga tegadi); alohida xodimga yozilgani
 * o'sha xodim uchun lavozim qoidasining o'rniga ishlaydi. Hisob progressiv: har bosqich faqat
 * o'z oralig'iga tushgan qismga qo'llanadi.
 *
 * Ko'rish — `hr.view`, o'zgartirish va hisob-kitobni ko'rish — `hr.salary` (server ham tekshiradi).
 */
import { useState } from "react";
import { toast } from "sonner";
import { Calculator, Loader2, Plus, Trash2, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog.tsx";
import { api, errorMessage } from "@/lib/api.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";
import { usePermissions } from "@/hooks/use-company.ts";

const INVALIDATE = ["/api/hr"];

/** Ko'rsatkichlar — server `kpi_metric` enum'i bilan bir xil tartibda. */
const METRICS = [
  { key: "delivery_count", label: "Dostavka: yetkazma soni", unit: "dona" },
  { key: "delivery_amount", label: "Dostavka: yetkazilgan summa", unit: "so'm" },
  { key: "delivery_weight_kg", label: "Dostavka: yuk og'irligi", unit: "kg" },
  { key: "agent_sales_amount", label: "Savdo agenti: sotuv summasi", unit: "so'm" },
  { key: "agent_order_count", label: "Savdo agenti: buyurtma soni", unit: "dona" },
  { key: "agent_visit_count", label: "Savdo agenti: tashrif soni", unit: "dona" },
  // To'lov `created_by` bo'yicha hisoblanadi — dostavka agenti yig'gan pul ham shu yerga tushadi
  { key: "agent_collected_amount", label: "Yig'ilgan to'lov (agent yoki dostavshik)", unit: "so'm" },
  { key: "cashier_receipt_count", label: "Kassir: chek soni", unit: "dona" },
  { key: "cashier_sales_amount", label: "Kassir: kassa savdosi", unit: "so'm" },
  { key: "warehouse_receipt_count", label: "Ombor: qabul hujjatlari", unit: "dona" },
  { key: "warehouse_issue_count", label: "Ombor: chiqim hujjatlari", unit: "dona" },
] as const;

type Metric = (typeof METRICS)[number]["key"];
const metricOf = (key: string) => METRICS.find((item) => item.key === key);
/** Pul ko'rsatkichida stavka foizda, qolganida — bir birlik uchun summa. */
const isPercent = (key: string) => metricOf(key)?.unit === "so'm";

type Tier = { fromValue: string; toValue: string | null; rate: string };
type Rule = {
  id: string;
  positionId: string | null;
  employeeId: string | null;
  metric: Metric;
  rateType: "percent" | "per_unit";
  minValue: string | null;
  isActive: boolean;
  positionName: string | null;
  employeeName: string | null;
  tiers: Tier[];
};
type PreviewLine = { metric: Metric; metricValue: string; amount: string };
type Preview = { month: string; employees: { employeeId: string; name: string; positionName: string | null; total: string; lines: PreviewLine[] }[] };

const fmt = (value: string | number) => new Intl.NumberFormat("uz-UZ").format(Math.round(Number(value)));
const trim = (value: string) => String(Number(value));

/** Bosqichni odam o'qiydigan ko'rinishda: "0–100 → 4 000 so'm". */
function tierText(tier: Tier, metric: string) {
  const range = tier.toValue === null ? `${trim(tier.fromValue)}+` : `${trim(tier.fromValue)}–${trim(tier.toValue)}`;
  const rate = isPercent(metric) ? `${trim(tier.rate)}%` : `${fmt(tier.rate)} so'm`;
  return `${range} → ${rate}`;
}

export default function KpiSection() {
  const { can } = usePermissions();
  const canManage = can("hr.salary");
  const [editing, setEditing] = useState<Rule | "new" | null>(null);
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));

  const rules = useApiQuery<{ rules: Rule[] }>("/api/hr/kpi/rules").data?.rules;
  const preview = useApiQuery<Preview>(canManage ? "/api/hr/kpi/preview" : null, { month }).data;
  const remove = useApiMutation((ruleId: string) => api.delete(`/api/hr/kpi/rules/${ruleId}`), { invalidate: INVALIDATE });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">Oylik mukofot qoidalari (KPI)</p>
          <p className="text-xs text-muted-foreground">
            Qoida lavozimga yoziladi — shu lavozimdagi hamma xodimga tegadi. Bitta xodimga boshqacha bo'lsa,
            unga alohida qoida yoziladi va u lavozimnikining o'rniga ishlaydi.
          </p>
        </div>
        {canManage && (
          <Button size="sm" data-testid="kpi-add" onClick={() => setEditing("new")}>
            <Plus className="h-4 w-4 mr-1" /> Qoida qo'shish
          </Button>
        )}
      </div>

      {!rules ? (
        <Skeleton className="h-32 rounded-xl" />
      ) : rules.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          <TrendingUp className="mx-auto mb-2 h-8 w-8 opacity-30" />
          Qoida yo'q. Mukofot hisoblanmaydi — oylikda mukofot 0 bo'ladi.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border" data-testid="kpi-rules">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Kimga</th>
                <th className="px-4 py-2 font-medium">Ko'rsatkich</th>
                <th className="px-4 py-2 font-medium">Bosqichlar</th>
                <th className="w-20" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rules.map((rule) => (
                <tr key={rule.id}>
                  <td className="px-4 py-2">
                    <p className="font-medium">{rule.employeeName ?? rule.positionName ?? "—"}</p>
                    <p className="text-xs text-muted-foreground">
                      {rule.employeeId ? "Xodim (lavozim qoidasidan ustun)" : "Lavozim"}
                    </p>
                  </td>
                  <td className="px-4 py-2">{metricOf(rule.metric)?.label ?? rule.metric}</td>
                  <td className="px-4 py-2">
                    <div className="flex flex-wrap gap-1">
                      {rule.tiers.map((tier) => (
                        <span key={tier.fromValue} className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums">
                          {tierText(tier, rule.metric)}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-2 text-right">
                    {canManage && (
                      <>
                        <Button size="sm" variant="ghost" onClick={() => setEditing(rule)}>Tahrir</Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          aria-label={`${metricOf(rule.metric)?.label ?? rule.metric} qoidasini o'chirish`}
                          onClick={() => {
                            remove.mutate(rule.id, {
                              onSuccess: () => toast.success("Qoida o'chirildi"),
                              onError: (err) => toast.error(errorMessage(err)),
                            });
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canManage && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Calculator className="h-4 w-4 text-muted-foreground" />
            <p className="text-sm font-semibold">Hisob-kitob</p>
            <Input
              type="month"
              className="h-8 w-40"
              aria-label="Oy"
              value={month}
              onChange={(event) => setMonth(event.target.value)}
            />
            <span className="text-xs text-muted-foreground">Oylik tayyorlanmaydi — faqat ko'rsatiladi</span>
          </div>
          {!preview ? (
            <Skeleton className="h-20 rounded-xl" />
          ) : preview.employees.length === 0 ? (
            <p className="text-sm text-muted-foreground">Bu oyda KPI chiqadigan xodim yo'q.</p>
          ) : (
            <div className="overflow-hidden rounded-xl border border-border" data-testid="kpi-preview">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 font-medium">Xodim</th>
                    <th className="px-4 py-2 font-medium">Nimadan</th>
                    <th className="px-4 py-2 text-right font-medium">Mukofot</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {preview.employees.map((person) => (
                    <tr key={person.employeeId}>
                      <td className="px-4 py-2">
                        <p className="font-medium">{person.name}</p>
                        <p className="text-xs text-muted-foreground">{person.positionName ?? "—"}</p>
                      </td>
                      <td className="px-4 py-2">
                        {person.lines.map((line) => (
                          <p key={line.metric} className="text-xs">
                            {metricOf(line.metric)?.label}: <span className="tabular-nums">{fmt(line.metricValue)}</span>{" "}
                            {metricOf(line.metric)?.unit} → <span className="tabular-nums">{fmt(line.amount)}</span> so'm
                          </p>
                        ))}
                      </td>
                      <td className="px-4 py-2 text-right font-semibold tabular-nums">{fmt(person.total)} so'm</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {editing && <RuleDialog rule={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

type Position = { id: string; name: string };
type Employee = { id: string; name: string };

function RuleDialog({ rule, onClose }: { rule: Rule | null; onClose: () => void }) {
  const positions = useApiQuery<{ positions: Position[] }>("/api/hr/positions").data?.positions;
  const employees = useApiQuery<{ employees: Employee[] }>("/api/hr/employees").data?.employees;

  const [target, setTarget] = useState<"position" | "employee">(rule?.employeeId ? "employee" : "position");
  const [positionId, setPositionId] = useState(rule?.positionId ?? "");
  const [employeeId, setEmployeeId] = useState(rule?.employeeId ?? "");
  const [metric, setMetric] = useState<Metric>(rule?.metric ?? "delivery_count");
  const [tiers, setTiers] = useState<Tier[]>(
    rule?.tiers.length ? rule.tiers : [{ fromValue: "0", toValue: null, rate: "0" }],
  );
  /** PLAN: ko'rsatkich shundan kam bo'lsa pul berilmaydi. Bo'sh — chegara yo'q. */
  const [minValue, setMinValue] = useState(rule?.minValue ?? "");
  const [error, setError] = useState<string | null>(null);

  const save = useApiMutation(
    (body: object) => api.put("/api/hr/kpi/rules", body),
    { invalidate: INVALIDATE },
  );

  const setTier = (index: number, patch: Partial<Tier>) =>
    setTiers((current) => current.map((tier, i) => (i === index ? { ...tier, ...patch } : tier)));

  const submit = async () => {
    setError(null);
    try {
      await save.mutateAsync({
        ...(target === "position" ? { positionId } : { employeeId }),
        metric,
        minValue: minValue.trim() === "" ? null : minValue.trim(),
        tiers: tiers.map((tier) => ({
          fromValue: tier.fromValue || "0",
          toValue: tier.toValue === null || tier.toValue === "" ? null : tier.toValue,
          rate: tier.rate || "0",
        })),
      });
      toast.success("Qoida saqlandi");
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const unit = metricOf(metric)?.unit ?? "";
  const rateLabel = isPercent(metric) ? "Foiz (%)" : `Stavka (1 ${unit} uchun, so'm)`;

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-xl" data-testid="kpi-dialog">
        <DialogHeader>
          <DialogTitle>{rule ? "Qoidani tahrirlash" : "Yangi KPI qoidasi"}</DialogTitle>
          <DialogDescription>
            Hisob progressiv: har bosqich faqat o'z oralig'iga tushgan qismga qo'llanadi.
            Masalan 0–100 → 4 000 va 100+ → 6 000 bo'lsa, 120 dona uchun 100×4 000 + 20×6 000.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="kpi-target">Kimga</Label>
              <Select value={target} onValueChange={(value) => setTarget(value as "position" | "employee")}>
                <SelectTrigger id="kpi-target" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent position="popper">
                  <SelectItem value="position">Lavozimga</SelectItem>
                  <SelectItem value="employee">Alohida xodimga</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="kpi-who">{target === "position" ? "Lavozim" : "Xodim"}</Label>
              {target === "position" ? (
                <Select value={positionId} onValueChange={setPositionId}>
                  <SelectTrigger id="kpi-who" className="w-full"><SelectValue placeholder="Tanlang" /></SelectTrigger>
                  <SelectContent position="popper">
                    {(positions ?? []).map((item) => (
                      <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Select value={employeeId} onValueChange={setEmployeeId}>
                  <SelectTrigger id="kpi-who" className="w-full"><SelectValue placeholder="Tanlang" /></SelectTrigger>
                  <SelectContent position="popper">
                    {(employees ?? []).map((item) => (
                      <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="kpi-metric">Ko'rsatkich</Label>
            <Select value={metric} onValueChange={(value) => setMetric(value as Metric)}>
              <SelectTrigger id="kpi-metric" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent position="popper">
                {METRICS.map((item) => (
                  <SelectItem key={item.key} value={item.key}>{item.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="kpi-min-value">Plan ({unit}) — ixtiyoriy</Label>
            <Input
              id="kpi-min-value"
              inputMode="decimal"
              placeholder="Bo'sh — plan yo'q"
              value={minValue}
              onChange={(event) => setMinValue(event.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">
              Ko'rsatkich shu qiymatdan kam bo'lsa qoida bo'yicha pul BERILMAYDI. Masalan: plan 50 000 000,
              bosqich 0+ → 3% — agent 50 mln sotsa butun summadan 3%, sotmasa 0.
            </p>
          </div>

          <div className="space-y-2">
            <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 text-xs text-muted-foreground">
              <span>Dan ({unit})</span>
              <span>Gacha — bo'sh = cheksiz</span>
              <span>{rateLabel}</span>
              <span />
            </div>
            {tiers.map((tier, index) => (
              <div key={index} className="grid grid-cols-[1fr_1fr_1fr_auto] items-center gap-2">
                <Input
                  aria-label={`${index + 1}-bosqich: dan`}
                  value={tier.fromValue}
                  onChange={(event) => setTier(index, { fromValue: event.target.value })}
                />
                <Input
                  aria-label={`${index + 1}-bosqich: gacha`}
                  value={tier.toValue ?? ""}
                  placeholder="cheksiz"
                  onChange={(event) => setTier(index, { toValue: event.target.value || null })}
                />
                <Input
                  aria-label={`${index + 1}-bosqich: stavka`}
                  value={tier.rate}
                  onChange={(event) => setTier(index, { rate: event.target.value })}
                />
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8"
                  aria-label={`${index + 1}-bosqichni olib tashlash`}
                  disabled={tiers.length === 1}
                  onClick={() => setTiers((current) => current.filter((_, i) => i !== index))}
                >
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              </div>
            ))}
            <Button
              size="sm"
              variant="outline"
              data-testid="kpi-add-tier"
              onClick={() =>
                setTiers((current) => {
                  const last = current[current.length - 1];
                  // Yangi bosqich oldingisining oxiridan boshlanadi — bo'shliq qolmasin
                  const from = last?.toValue ?? "";
                  return [...current.map((tier, i) => (i === current.length - 1 && tier.toValue === null
                    ? { ...tier, toValue: tier.fromValue }
                    : tier)), { fromValue: from || "0", toValue: null, rate: "0" }];
                })
              }
            >
              <Plus className="h-3.5 w-3.5 mr-1" /> Bosqich qo'shish
            </Button>
          </div>

          {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>Bekor</Button>
          <Button
            data-testid="kpi-save"
            disabled={save.isPending || (target === "position" ? !positionId : !employeeId)}
            onClick={() => { void submit(); }}
          >
            {save.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
            Saqlash
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
