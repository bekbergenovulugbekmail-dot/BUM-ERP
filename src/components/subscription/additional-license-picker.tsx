/**
 * Included litsenziyalar tugaganda — qo'shimcha litsenziya tarifini tanlash (tariflar bazadan).
 * Tanlangan tarif bilan foydalanuvchi yaratiladi, litsenziya to'lov tasdiqlanguncha yopiq (server).
 */
import { Info, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { errorMessage } from "@/lib/api.ts";
import { useApiQuery } from "@/lib/query.ts";
import { durationText, formatUzs, type LicenseCounts, type PlansResponse } from "@/lib/subscription.ts";

export default function AdditionalLicensePicker({
  counts,
  pending,
  onSelect,
}: {
  counts: LicenseCounts | null;
  pending?: boolean;
  onSelect: (planId: string) => void;
}) {
  const plans = useApiQuery<PlansResponse>("/api/subscription/plans");

  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 p-3 space-y-3">
      <div className="flex gap-2 text-sm text-amber-900 dark:text-amber-200">
        <Info className="h-4 w-4 shrink-0 mt-0.5" />
        <div>
          <p className="font-medium">
            {counts
              ? `${counts.includedTotal} ta included foydalanuvchi litsenziyasi ishlatilgan.`
              : "Included foydalanuvchi litsenziyalari ishlatilgan."}
          </p>
          <p className="text-xs mt-0.5 opacity-80">
            Yangi foydalanuvchi uchun qo'shimcha litsenziya tanlang. To'lov tasdiqlanmaguncha u dasturga kira olmaydi.
          </p>
        </div>
      </div>
      {plans.error ? (
        <p className="text-xs text-destructive">{errorMessage(plans.error)}</p>
      ) : !plans.data ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {plans.data.additional.map((plan) => (
            <Button
              key={plan.id}
              type="button"
              variant="outline"
              disabled={pending}
              className="h-auto flex-col items-start gap-0.5 whitespace-normal py-2 px-3 text-left"
              onClick={() => onSelect(plan.id)}
            >
              <span className="text-xs text-muted-foreground">{durationText(plan)}</span>
              <span className="font-semibold">{formatUzs(plan.price)}</span>
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
