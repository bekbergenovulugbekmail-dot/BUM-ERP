/**
 * Savdo siyosati — `GET/PUT /api/sales/policy` (saqlash: `settings.manage`) va kassa farqi chegaradan oshgan smenalarni
 * ko'rib chiqish — `GET /api/sales/pos/shift-reviews`, `POST /api/sales/pos/shifts/:id/review` (`sales.approve`).
 */
import { useState } from "react";
import { toast } from "sonner";
import { Check, RotateCcw, Save, Scale, X } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { api, errorMessage } from "@/lib/api.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";
import { cn } from "@/lib/utils.ts";
import { usePermissions } from "@/hooks/use-company.ts";
import { num, type PosShift } from "@/pages/sales/_lib/types.ts";
import { SettingsGroup, ToggleRow } from "./form-controls.tsx";

const POLICY_PATH = "/api/sales/policy";
const REVIEWS_PATH = "/api/sales/pos/shift-reviews";

type SalesPolicy = { maxDiscountPercent: string | null; cashierDepositLimit: string | null; shiftDifferenceTolerance: string };

const fmt = (n: number) => new Intl.NumberFormat("uz-UZ", { maximumFractionDigits: 2 }).format(n);
const validNumber = (value: string, max?: number) => value.trim() !== "" && Number.isFinite(Number(value)) && Number(value) >= 0 && (max === undefined || Number(value) <= max);

function policyError(policy: SalesPolicy): string | null {
  if (policy.maxDiscountPercent !== null && !validNumber(policy.maxDiscountPercent, 100)) return "Chegirma chegarasi 0–100% bo'lishi kerak";
  if (policy.cashierDepositLimit !== null && !validNumber(policy.cashierDepositLimit)) return "Depozit chegarasini kiriting";
  if (!validNumber(policy.shiftDifferenceTolerance)) return "Smena farqi chegarasini kiriting (0 yoki undan katta)";
  return null;
}

function ShiftReviews() {
  const reviews = useApiQuery<{ shifts: PosShift[] }>(REVIEWS_PATH).data?.shifts;
  const [notes, setNotes] = useState<Record<string, string>>({});
  const review = useApiMutation(
    (input: { shiftId: string; decision: "approved" | "rejected"; note: string | null }) =>
      api.post<{ shift: PosShift }>(`/api/sales/pos/shifts/${input.shiftId}/review`, { decision: input.decision, note: input.note }),
    { invalidate: [REVIEWS_PATH, "/api/sales/pos/shifts"] },
  );

  const submit = async (shift: PosShift, decision: "approved" | "rejected") => {
    const note = notes[shift.id]?.trim() || null;
    if (decision === "rejected" && !note) {
      toast.error("Rad etish sababini yozing");
      return;
    }
    try {
      await review.mutateAsync({ shiftId: shift.id, decision, note });
      toast.success(decision === "approved" ? "Farq tasdiqlandi" : "Farq rad etildi");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <SettingsGroup title="Ko'rib chiqilishi kerak smenalar" description="Yopilishdagi kassa farqi chegaradan oshgan yoki valyutada farq bo'lgan smenalar">
      {!reviews ? (
        <Skeleton className="h-24 rounded-xl" />
      ) : reviews.length === 0 ? (
        <p className="text-sm text-muted-foreground">Ko'rib chiqiladigan smena yo'q</p>
      ) : (
        <ul className="space-y-2">
          {reviews.map((shift) => {
            const difference = num(shift.cashDifference);
            return (
              <li key={shift.id} className="rounded-xl border border-border p-3 space-y-2">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{shift.cashierName ?? "Kassir"} · {shift.warehouseName}</p>
                    <p className="text-xs text-muted-foreground">
                      {shift.closedAt ? new Date(shift.closedAt).toLocaleString("uz-UZ") : "—"} · kutilgan {fmt(num(shift.expectedCash))}, sanalgan {fmt(num(shift.closingCash))}
                    </p>
                  </div>
                  <span className={cn("text-sm font-semibold tabular-nums", difference < 0 ? "text-destructive" : difference > 0 ? "text-blue-600" : "text-muted-foreground")}>
                    {difference === 0 ? "Valyutada farq" : `${difference > 0 ? "Ortiqcha" : "Kamomad"} ${fmt(Math.abs(difference))} so'm`}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    id={`shift-review-note-${shift.id}`}
                    className="flex-1 min-w-[12rem]"
                    placeholder="Izoh (rad etishda majburiy)"
                    value={notes[shift.id] ?? ""}
                    onChange={(e) => setNotes((prev) => ({ ...prev, [shift.id]: e.target.value }))}
                  />
                  <Button size="sm" disabled={review.isPending} onClick={() => void submit(shift, "approved")}>
                    <Check className="h-4 w-4 mr-1" /> Tasdiqlash
                  </Button>
                  <Button size="sm" variant="destructive" disabled={review.isPending} onClick={() => void submit(shift, "rejected")}>
                    <X className="h-4 w-4 mr-1" /> Rad etish
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </SettingsGroup>
  );
}

export default function SalesPolicySection() {
  const { can } = usePermissions();
  const canManage = can("settings.manage");
  const saved = useApiQuery<{ policy: SalesPolicy }>(POLICY_PATH).data?.policy;
  const [draft, setDraft] = useState<SalesPolicy | null>(null);
  const save = useApiMutation((body: SalesPolicy) => api.put<{ policy: SalesPolicy }>(POLICY_PATH, body), { invalidate: [POLICY_PATH] });

  const policy = draft ?? saved;
  if (!policy) return <Skeleton className="h-[360px] rounded-2xl" />;
  const update = (patch: Partial<SalesPolicy>) => setDraft({ ...policy, ...patch });
  const error = policyError(policy);

  const handleSave = async () => {
    try {
      await save.mutateAsync(policy);
      setDraft(null);
      toast.success("Savdo siyosati saqlandi");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-center gap-3 pb-2 border-b border-border">
        <div className="h-10 w-10 rounded-xl bg-amber-500/10 flex items-center justify-center">
          <Scale className="h-5 w-5 text-amber-600" />
        </div>
        <div>
          <p className="font-semibold">Savdo siyosati</p>
          <p className="text-xs text-muted-foreground">
            {canManage ? "Chegirma, kassada balansga yozish va smena kassa farqi chegaralari" : "Faqat ko'rish — o'zgartirish uchun ruxsat yo'q"}
          </p>
        </div>
      </div>

      <fieldset disabled={!canManage} className="space-y-4">
        <SettingsGroup title="Chegirma" description="Mijozning o'z chegirmasi cheklanmaydi; offline kassa chegirmasi nomuvofiqlik sifatida yoziladi">
          <ToggleRow
            label="Qo'lda beriladigan chegirmani cheklash"
            checked={policy.maxDiscountPercent !== null}
            onChange={(on) => update({ maxDiscountPercent: on ? "10" : null })}
          />
          {policy.maxDiscountPercent !== null && (
            <div className="flex items-center gap-2">
              <Input id="policy-max-discount" type="number" min={0} max={100} step="any" className="w-28"
                value={policy.maxDiscountPercent} onChange={(e) => update({ maxDiscountPercent: e.target.value })} />
              <span className="text-xs text-muted-foreground">% dan kattasini faqat rahbar (Savdoni tasdiqlash ruxsati) beradi</span>
            </div>
          )}
        </SettingsGroup>

        <SettingsGroup title="Kassada mijoz balansiga yozish" description="Balansni to'ldirish va qaytimni balansga o'tkazish">
          <ToggleRow
            label="Kassir chegarasi"
            checked={policy.cashierDepositLimit !== null}
            onChange={(on) => update({ cashierDepositLimit: on ? "1000000" : null })}
          />
          {policy.cashierDepositLimit !== null && (
            <div className="flex items-center gap-2">
              <Input id="policy-deposit-limit" type="number" min={0} step="any" className="w-40"
                value={policy.cashierDepositLimit} onChange={(e) => update({ cashierDepositLimit: e.target.value })} />
              <span className="text-xs text-muted-foreground">so'mdan ortig'ini rahbar tasdiqlaydi</span>
            </div>
          )}
        </SettingsGroup>

        <SettingsGroup title="Smena kassa farqi" description="Farq shu summadan oshsa rahbarlarga bildirishnoma boradi va smena ko'rib chiqiladi">
          <div className="space-y-1.5">
            <Label htmlFor="policy-shift-tolerance">Ruxsat etilgan farq (so'm)</Label>
            <Input id="policy-shift-tolerance" type="number" min={0} step="any" className="w-40"
              value={policy.shiftDifferenceTolerance} onChange={(e) => update({ shiftDifferenceTolerance: e.target.value })} />
            <p className="text-xs text-muted-foreground">0 — har qanday farq ko'rib chiqiladi</p>
          </div>
        </SettingsGroup>
      </fieldset>

      {canManage && (
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => void handleSave()} disabled={save.isPending || !draft || error !== null}>
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

      {can("sales.approve") && <ShiftReviews />}
    </div>
  );
}
